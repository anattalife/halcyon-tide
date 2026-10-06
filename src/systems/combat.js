// HALCYON TIDE — combat: player weapons (fists, baton, taser, pistol, fire extinguisher), stealth takedowns,
// dragging bodies, body discovery, guard weapon attacks (shared damage/FX path), pickups (armoury, downed guards,
// hose boxes), surrender.
//
// game.combat API
//   weapon (def of the selected weapon) · weaponId · owned(id) · give(id, qty?, meta?) · take(id) · select(id|slot)
//   ammo {pistol:{mag, reserve}} · taserReadyIn (s) · extCharge (0..100) · reloading (bool)
//   holster() · confiscate() → [{id, qty, name}] · isWeaponId(id) · itemKind(id)
//   blocking (bool) · surrendering (bool) · stunned (s left) · dragging (npc|null) · stopDrag()
//   attackPlayer(npc, kind, opts) → guards use 'baton' | 'taser' | 'pistol' | 'punch' against the player
//   scanBodies() (called by security) · downed (Set of NPCs downed by the player) · fx (CombatFX)
//   rayWorld(origin, dir, maxDist, deck) → {t, point, normal, glass, kind} first wall/floor/ceiling hit
// Controls: 1–5 / wheel (while armed or aiming) select · LMB attack/fire (hold for heavy melee / spray) · RMB aim (block
//   when unarmed) · R reload · crouch + E behind an unaware person: takedown · hold G drag body · hold H surrender.
// Bus out: 'combat:shot' {weapon, x,y,z, deck, silenced, actor}, 'combat:hit' {weapon, target, part, damage, lethal, by},
//   'crime' (via security.report), 'sfx' (punch, baton_hit, taser, gunshot, gun_click, reload, glass_break, body_fall,
//   grunt, scream, spray), 'combat:weapon' {id}.
import * as THREE from 'three';
import { deckY, GRID, idx, toI, toJ } from '../core/config.js';
import { WEAPONS, SLOTS, PART_MULT, CombatFX } from './weapons.js';
import { npcClass } from './crime.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _h = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const conscious = (n) => n && !n.gone && n.state !== 'ko' && n.state !== 'dead' && n.state !== 'hidden';
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];

class Combat {
  constructor(game) {
    this.game = game; this.bus = game.bus; this.world = game.world;
    this.fx = new CombatFX(game);
    this._owned = new Set(['fists']);
    this.weaponId = 'fists';
    this.ammo = { pistol: { mag: 0, reserve: 0 } };
    this.taserCD = 0; this.extCharge = 0;
    this.cd = 0; this.combo = 0; this.comboT = 0; this.chargeT = 0; this.reloadT = 0;
    this.blocking = false; this.surrendering = false; this.surrT = 0; this.stunned = 0;
    this.dragging = null; this.downed = new Set();
    this.time = 0; this._scanT = 0; this._intimT = 0;
    this._victims = new Map();   // npc → last crime time (one crime per beating)
    this.looted = new WeakMap();
    this.boxTaken = new Set();
    this.hits = 0;               // stats
    this.lastShot = null;
  }

  // ── inventory ─────────────────────────────────────────────────────────
  get inv() { return this.game.inventory || this.game.player?.inventory || null; }
  isWeaponId(id) { return !!WEAPONS[id] && id !== 'fists'; }
  itemKind(id) { return this.isWeaponId(id) ? 'weapon' : id === 'pistol_ammo' ? 'ammo' : null; }
  owned(id) {
    if (id === 'fists') return true;
    if (this._owned.has(id)) return true;
    const inv = this.inv;
    if (inv?.has?.(id)) return true;
    if (inv?.items instanceof Map) for (const [, it] of inv.items) if (it && typeof it === 'object' && it.kind === 'weapon' && it.weapon === id && (it.qty ?? 1) > 0) return true;
    return false;
  }
  give(id, qty = 1, meta = null) {
    if (id === 'pistol_ammo') { this.ammo.pistol.reserve += qty; this.bus.emit('combat:weapon', { id, gained: true }); return true; }
    if (!WEAPONS[id]) return false;
    const fresh = !this.owned(id);
    this._owned.add(id);
    const inv = this.inv;
    try { if (inv && !inv.has?.(id)) inv.add(id, 1, { kind: 'weapon', weapon: id, name: WEAPONS[id].name, ...(meta || {}) }); } catch {}
    if (id === 'pistol') { if (fresh && this.ammo.pistol.mag === 0) this.ammo.pistol.mag = meta?.mag ?? WEAPONS.pistol.mag; this.ammo.pistol.reserve += meta?.reserve ?? (fresh ? 15 : 15); }
    if (id === 'extinguisher') this.extCharge = WEAPONS.extinguisher.charge;
    this.bus.emit('combat:weapon', { id, gained: true });
    return true;
  }
  take(id) { this._owned.delete(id); try { this.inv?.remove?.(id, this.inv.count?.(id) || 1); } catch {} if (this.weaponId === id) this.select('fists'); }
  confiscate() {
    const out = [];
    for (const id of SLOTS) if (id !== 'fists' && this.owned(id)) { out.push({ id, qty: 1, name: WEAPONS[id].name, meta: id === 'pistol' ? { mag: this.ammo.pistol.mag, reserve: this.ammo.pistol.reserve } : null }); this.take(id); }
    if (this.ammo.pistol.reserve > 0 && !out.some(o => o.id === 'pistol')) out.push({ id: 'pistol_ammo', qty: this.ammo.pistol.reserve, name: `${this.ammo.pistol.reserve} rounds` });
    this.ammo.pistol.mag = 0; this.ammo.pistol.reserve = 0; this.extCharge = 0;
    this.select('fists');
    return out;
  }
  get weapon() { return WEAPONS[this.weaponId]; }
  get taserReadyIn() { return Math.max(0, this.taserCD); }
  get reloading() { return this.reloadT > 0; }
  select(id) {
    if (typeof id === 'number') id = SLOTS[id - 1];
    if (!id || !WEAPONS[id] || !this.owned(id)) return false;
    if (id === this.weaponId) return true;
    this.weaponId = id; this.reloadT = 0; this.chargeT = 0;
    const p = this.game.player; if (p) p.held = WEAPONS[id].held;
    this.bus.emit('combat:weapon', { id });
    return true;
  }
  holster() { this.select('fists'); }
  cycle(dir) {
    const list = SLOTS.filter(s => this.owned(s)); if (list.length < 2) return;
    const i = list.indexOf(this.weaponId);
    this.select(list[((i + dir) % list.length + list.length) % list.length]);
  }

  // ── per frame ─────────────────────────────────────────────────────────
  update(dt) {
    if (!(dt > 0)) return;
    this.time += dt;
    const g = this.game, p = g.player, I = g.input; if (!p) return;
    if (this.cd > 0) this.cd -= dt;
    if (this.taserCD > 0) this.taserCD -= dt;
    if (this.comboT > 0) this.comboT -= dt; else this.combo = 0;
    if (this._intimT > 0) this._intimT -= dt;
    // keep the held prop consistent (other systems may set held)
    if (!this.owned(this.weaponId)) this.select('fists');
    if (p.state === 'free' && p.held !== this.weapon.held && (p.held === 'none' || WEAPONS[p.held] || p.held === 'extinguisher')) p.held = this.weapon.held;
    // stun (taser hit)
    if (this.stunned > 0) {
      this.stunned -= dt;
      p.animOverride = this.stunned > 0.6 ? 'knocked_out' : 'stagger'; p._animT = 0.2;
      if (this.stunned <= 0) { p.lockControls(false); p.animOverride = null; }
      this.blocking = false;
      return;
    }
    const play = I && I.context === 'play' && !p.controlsLocked && p.state === 'free' && !g.security?.cctv?.active;
    this.blocking = false;
    if (this.dragging) this._dragUpdate(dt, play);
    // reload
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this._finishReload(); }
    if (!play) { this.chargeT = 0; this._surrender(dt, I, false); return; }
    this._surrender(dt, I, true);
    if (this.surrendering) return;
    // selection
    for (let k = 0; k < DIGITS.length; k++) if (I.pressed(DIGITS[k])) this.select(SLOTS[k]);
    if (I.mouse.wheel && (p.aiming || this.weaponId !== 'fists')) { this.cycle(Math.sign(I.mouse.wheel)); I.mouse.wheel = 0; }
    if (I.pressed('KeyR') && this.weaponId === 'pistol') this.reload();
    const w = this.weapon;
    const fireDown = I.action('Fire'), firePressed = I.actionPressed('Fire'), fireReleased = I.actionReleased('Fire');
    if (w.kind === 'melee') {
      if (this.weaponId === 'fists' && p.aiming) { this.blocking = true; p.animOverride = 'guard'; p._animT = 0.1; }
      if (fireDown) this.chargeT += dt;
      if (fireReleased || (fireDown && this.chargeT > 0.55)) {
        const heavy = this.chargeT > 0.45;
        if (this.cd <= 0 && (fireReleased || heavy)) this.melee(heavy);
        this.chargeT = fireDown ? -10 : 0;   // a held heavy fires once
      }
      if (!fireDown && this.chargeT < 0) this.chargeT = 0;
    } else if (w.kind === 'gun') {
      if (firePressed || (fireDown && this.cd <= 0 && false)) this.shoot();
    } else if (w.kind === 'taser') {
      if (firePressed) this.tase();
    } else if (w.kind === 'spray') {
      if (fireDown) this.spray(dt); else this._sprayOn = false;
    }
    // intimidation: aiming a weapon at someone
    if (p.aiming && w.kind !== 'melee' && this._intimT <= 0) { this._intimT = 0.4; this._intimidate(); }
  }

  _surrender(dt, I, play) {
    const p = this.game.player;
    const held = play && I?.down('KeyH');
    if (!this.surrendering) {
      if (held) { this.surrT += dt; if (this.surrT > 0.8) { this.surrendering = true; this.surrT = 0; this.holster(); this.bus.emit('player:surrender', { on: true }); } }
      else this.surrT = 0;
    } else {
      p.animOverride = 'hands_up'; p._animT = 0.2; p.vx *= 0.5; p.vz *= 0.5;
      // moving or pressing H again ends it
      if ((I?.pressed('KeyH') && this.surrT > 0.5) || (play && I?.move().mag > 0.5 && this.surrT > 0.5)) { this.surrendering = false; this.surrT = 0; p.animOverride = null; this.bus.emit('player:surrender', { on: false }); }
      else this.surrT += dt;
    }
  }

  // ── aiming ray ────────────────────────────────────────────────────────
  _aimRay(spread = 0) {
    const g = this.game, rig = g.cameraRig, p = g.player;
    if (rig && !g.debugCam) { _o.copy(rig.camPos); _d.copy(rig.lookDir).normalize(); }
    else { _o.set(p.x, p.y + 1.5, p.z); _d.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)); }
    if (spread > 0) { _d.x += (Math.random() - 0.5) * 2 * spread; _d.y += (Math.random() - 0.5) * 2 * spread; _d.z += (Math.random() - 0.5) * 2 * spread; _d.normalize(); }
    // skip the stretch between the camera and the player
    const skip = Math.max(0, (p.x - _o.x) * _d.x + (p.y + 1.4 - _o.y) * _d.y + (p.z - _o.z) * _d.z - 0.25);
    return { o: _o, d: _d, skip };
  }
  _faceAim() { const g = this.game, p = g.player; if (g.cameraRig) p.yaw = g.cameraRig.yaw + (g.cameraRig.mode === 'first' ? 0 : 0); }

  // first blocking surface along a ray on a deck (walls, closed doors, floor, ceiling)
  rayWorld(o, d, maxD, deck) {
    const w = this.world, plan = w.plans[deck];
    const fy = w.floorY(deck, o.x, o.z);
    const ceil = this.game.cameraRig?.ceilingAt ? this.game.cameraRig.ceilingAt(deck, o.x, o.z) : fy + 2.6;
    let best = { t: maxD, kind: 'none', normal: new THREE.Vector3(0, 1, 0), glass: false };
    if (d.y < -1e-4) { const t = (fy + 0.01 - o.y) / d.y; if (t > 0 && t < best.t) best = { t, kind: 'floor', normal: new THREE.Vector3(0, 1, 0), glass: false }; }
    if (d.y > 1e-4 && Number.isFinite(ceil)) { const t = (ceil - o.y) / d.y; if (t > 0 && t < best.t) best = { t, kind: 'ceiling', normal: new THREE.Vector3(0, -1, 0), glass: false }; }
    if (!plan) return this._fin(best, o, d);
    const x1 = o.x + d.x * best.t, z1 = o.z + d.z * best.t;
    let i = toI(o.x), j = toJ(o.z); const ie = toI(x1), je = toJ(z1);
    const dx = x1 - o.x, dz = z1 - o.z;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = dx !== 0 ? Math.abs(GRID.cell / dx) : Infinity, tDZ = dz !== 0 ? Math.abs(GRID.cell / dz) : Infinity;
    let tMX = dx !== 0 ? ((dx > 0 ? GRID.x0 + (i + 1) * GRID.cell : GRID.x0 + i * GRID.cell) - o.x) / dx : Infinity;
    let tMZ = dz !== 0 ? ((dz > 0 ? GRID.z0 + (j + 1) * GRID.cell : GRID.z0 + j * GRID.cell) - o.z) / dz : Infinity;
    let guard = 0;
    const T = best.t;
    const blocks = (t, door, f) => {
      const y = o.y + d.y * T * f;
      if (t === 1 || t === 4) return t === 4 ? 'facade' : 'wall';
      if (t === 2) { const s = w.doorState.get(w.doorKey(deck, door)); const dr = plan.doors[door]; if (!s || s.open < 0.7) return dr && (dr.type === 'glass' || dr.type === 'balcony') ? 'glassdoor' : 'door'; return null; }
      if ((t === 3 || t === 6) && y < fy + 1.05) return t === 6 ? 'glassrail' : 'rail';
      return null;
    };
    while ((i !== ie || j !== je) && guard++ < 600) {
      if (tMX < tMZ) {
        if (tMX > 1) break;
        const ei = stepX > 0 ? i : i - 1; if (ei < 0 || ei >= GRID.nx - 1) break;
        const k = idx(ei, j), kind = blocks(plan.ex[k], plan.dx[k], tMX);
        if (kind) { best = { t: tMX * T, kind, normal: new THREE.Vector3(-stepX, 0, 0), glass: this._isGlass(plan, kind, k, 'x') }; return this._fin(best, o, d); }
        i += stepX; tMX += tDX;
      } else {
        if (tMZ > 1) break;
        const ej = stepZ > 0 ? j : j - 1; if (ej < 0 || ej >= GRID.nz - 1) break;
        const k = idx(i, ej), kind = blocks(plan.ez[k], plan.dz[k], tMZ);
        if (kind) { best = { t: tMZ * T, kind, normal: new THREE.Vector3(0, 0, -stepZ), glass: this._isGlass(plan, kind, k, 'z') }; return this._fin(best, o, d); }
        j += stepZ; tMZ += tDZ;
      }
    }
    return this._fin(best, o, d);
  }
  _isGlass(plan, kind, k, n) {
    if (kind === 'glassdoor' || kind === 'glassrail') return true;
    if (kind !== 'facade') return false;
    const a = plan.rooms[plan.room[k]], b = plan.rooms[plan.room[n === 'x' ? k + 1 : k + GRID.nx]];
    const r = a && !a.exterior ? a : b;
    return !!r && (r.facade === 'glass' || r.facade === 'window');
  }
  _fin(b, o, d) { b.point = new THREE.Vector3(o.x + d.x * b.t, o.y + d.y * b.t, o.z + d.z * b.t); return b; }

  // character hit along the ray (excluding the player), limited by walls
  _hitChar(o, d, maxD, skip = 0) {
    const g = this.game, p = g.player;
    const ch = g.chars; if (!ch) return null;
    const pv = p.charId >= 0 ? ch.get(p.charId) : null;
    const was = pv ? pv.visible : null; if (pv) pv.visible = false;
    let hit = null;
    try { _h.copy(o).addScaledVector(d, skip); hit = ch.hitTest(_h, d, maxD - skip); } finally { if (pv) pv.visible = was; }
    if (!hit) return null;
    const npc = g.npcs?.fromChar(hit.id);
    if (!npc || npc.gone) return null;
    return { npc, part: hit.part, dist: hit.dist + skip };
  }

  // ── melee ─────────────────────────────────────────────────────────────
  melee(heavy = false) {
    const g = this.game, p = g.player, w = this.weapon;
    const cost = heavy ? w.heavyStamina : w.stamina;
    const tired = p.stamina < cost;
    p.stamina = Math.max(0, p.stamina - cost);
    this.cd = w.cooldown * (heavy ? 1.6 : 1);
    if (this.comboT > 0) this.combo++; else this.combo = 0;
    this.comboT = 0.75;
    p.playAnim(this.weaponId === 'baton' ? 'swing_baton' : 'punch', heavy ? 0.6 : 0.36);
    this._lastAttackT = this.time;
    if (g.cameraRig) p.yaw = g.cameraRig.yaw;
    const target = this._meleeTarget(w.range + (heavy ? 0.2 : 0));
    this.bus.emit('sfx', { name: 'swing', x: p.x, y: p.y + 1.3, z: p.z, deck: p.deck, vol: 0.4 });
    if (!target) return null;
    let dmg = (heavy ? w.heavy : w.damage) * (tired ? 0.5 : 1) * (this.combo >= 2 ? 1.4 : 1);
    if (target.state === 'ko' || target.state === 'dead') dmg *= 1.5;
    this._damageNpc(target, dmg, { weapon: this.weaponId, part: 'body', heavy, lethal: false });
    this.bus.emit('sfx', { name: w.sfx, x: target.x, y: target.y + 1.4, z: target.z, deck: target.deck, vol: heavy ? 1 : 0.8 });
    g.cameraRig?.shake(heavy ? 0.28 : 0.12);
    return target;
  }
  _meleeTarget(range) {
    const g = this.game, p = g.player;
    const yaw = g.cameraRig ? g.cameraRig.yaw : p.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = null, bs = 1e9;
    for (const n of g.npcs?.query(p.deck, p.x, p.z, range + 0.4) || []) {
      const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz) || 0.01;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < 0.45 && d > 0.7) continue;
      if (!this.world.lineClear(p.deck, p.x, p.z, n.x, n.z)) continue;
      const s = d - dot * 0.6 + (conscious(n) ? 0 : 0.8);
      if (s < bs) { bs = s; best = n; }
    }
    return best;
  }

  // shared NPC damage path (player as attacker)
  _damageNpc(n, dmg, o = {}) {
    const g = this.game, p = g.player, sys = g.npcs?.system;
    const wasDown = n.state === 'ko' || n.state === 'dead';
    const cls = npcClass(n);
    const aware = n.alert > 0.4 || (n.perception?.canSee(p.x, p.y + 1.4, p.z, p.deck) && Math.hypot(n.x - p.x, n.z - p.z) < 6);
    n.health -= dmg;
    this.hits++;
    let outcome = 'hit';
    if (o.lethal) {
      if (n.health <= 0) { if (n.state !== 'dead') { g.npcs.kill(n, { source: p }); outcome = 'killed'; } }
      else this._react(n, o);
    } else if (n.health <= 0 || o.ko) {
      if (wasDown && n.health < -60 && n.state !== 'dead') { g.npcs.kill(n, { source: p }); outcome = 'killed'; }
      else if (!wasDown) { g.npcs.knockOut(n, o.koTime ?? (40 + Math.random() * 40), { source: p }); n.health = Math.max(n.health, -20); outcome = 'ko'; this.bus.emit('sfx', { name: 'body_fall', x: n.x, y: n.y, z: n.z, deck: n.deck, vol: 0.8 }); }
    } else this._react(n, o);
    if (outcome === 'ko' || outcome === 'killed') this.downed.add(n);
    this.bus.emit('combat:hit', { weapon: o.weapon, target: n, part: o.part, damage: dmg, outcome, lethal: !!o.lethal, by: 'player' });
    this.game.security?.hud?.hitMarker(outcome === 'killed' ? 'kill' : outcome === 'ko' ? 'ko' : o.part === 'head' ? 'head' : 'hit');
    // crime
    const sec = g.security;
    const last = this._victims.get(n) ?? -99;
    let type = null;
    if (outcome === 'killed') type = 'murder';
    else if (o.weapon === 'pistol') type = 'shooting';
    else if (wasDown) type = 'grievous';
    else if (this.time - last > 6 || outcome === 'ko') type = cls === 'guard' ? 'assault_officer' : 'assault';
    if (o.weapon === 'pistol' && outcome === 'killed') type = 'murder';
    if (type && sec) {
      this._victims.set(n, this.time);
      const cr = sec.report({ type, victim: n, x: p.x, z: p.z, deck: p.deck, stealth: !!o.stealth || (!aware && outcome === 'ko'), quiet: !!o.quiet });
      if (cr && (outcome === 'ko')) n._downBy = { crime: cr, stealth: !!o.stealth || !aware };
      if (cr && outcome === 'killed') n._downBy = { crime: cr, stealth: false };
    } else if (outcome === 'ko' && !n._downBy) n._downBy = { crime: null, stealth: true };
    // guards react to being hit
    if (cls === 'guard' && outcome === 'hit') g.security?.ai?.attacked(n, o);
    if (sys && cls !== 'guard' && outcome === 'hit' && Math.random() < 0.5) sys._bark?.(n, 'scream', true);
    return outcome;
  }
  _react(n, o) {
    const sys = this.game.npcs?.system, p = this.game.player;
    if (!sys) return;
    const cls = npcClass(n);
    if (cls === 'guard') { n.state = 'stagger'; n.prev = null; n.after = null; n.timer = 0.45; sys.setAnim(n, 'hit_react', n.held); const dx = n.x - p.x, dz = n.z - p.z, l = Math.hypot(dx, dz) || 1; n.vx = dx / l * 1.2; n.vz = dz / l * 1.2; n.secStagger = 0.45; return; }
    sys.react(n, { type: 'hit', damage: 0, source: p, x: p.x, z: p.z });
    if (o.heavy) { n.timer = 0.9; sys.setAnim(n, 'stagger', 'none'); }
  }

  // ── takedown ──────────────────────────────────────────────────────────
  canTakedown(n) {
    const p = this.game.player;
    if (!conscious(n) || n.deck !== p.deck || n.state === 'flee') return false;
    const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz);
    if (d > 1.4 || d < 0.2) return false;
    const fx = Math.sin(n.yaw), fz = Math.cos(n.yaw);
    const behind = (dx * fx + dz * fz) / d < -0.35;
    const unaware = n.alert < 0.45 && !(n.sec && (n.sec.mode === 'chase' || n.sec.mode === 'subdue' || n.sec.mode === 'confront'));
    return behind && unaware;
  }
  takedown(n) {
    const g = this.game, p = g.player;
    p.lockControls(true); p.yaw = Math.atan2(n.x - p.x, n.z - p.z);
    p.playAnim('takedown', 1.5);
    const sys = g.npcs.system;
    n.state = 'idle'; n.timer = Infinity; sys.setAnim(n, 'stagger', 'none'); n.vx = n.vz = 0;
    // pull them in front of the player
    const tx = p.x + Math.sin(p.yaw) * 0.55, tz = p.z + Math.cos(p.yaw) * 0.55;
    if (g.npcs.nav.passable(n.deck, tx, tz, 0xff)) { n.x = tx; n.z = tz; }
    n.yaw = p.yaw;
    this._pendingTD = { n, t: 1.15 };
    this.bus.emit('sfx', { name: 'grunt', x: n.x, y: n.y + 1.5, z: n.z, deck: n.deck, vol: 0.35 });
  }
  _tdUpdate(dt) {
    const td = this._pendingTD; if (!td) return;
    td.t -= dt;
    const p = this.game.player;
    if (td.t <= 0) {
      this._pendingTD = null;
      p.lockControls(false);
      if (!td.n.gone && td.n.state !== 'dead') this._damageNpc(td.n, 0, { weapon: 'takedown', ko: true, koTime: 110 + Math.random() * 30, stealth: true, quiet: true });
    }
  }

  // ── guns ──────────────────────────────────────────────────────────────
  reload() {
    const a = this.ammo.pistol, w = WEAPONS.pistol;
    if (this.reloadT > 0 || a.mag >= w.mag) return false;
    const invAmmo = this.inv?.count?.('pistol_ammo') || 0;
    if (a.reserve <= 0 && invAmmo <= 0) { this.bus.emit('sfx', this._sfx('gun_click')); return false; }
    this.reloadT = w.reload;
    this.game.player.playAnim('radio', 0.6);
    this.bus.emit('sfx', this._sfx('reload'));
    return true;
  }
  _finishReload() {
    const a = this.ammo.pistol, w = WEAPONS.pistol;
    let need = w.mag - a.mag;
    const fromRes = Math.min(need, a.reserve); a.reserve -= fromRes; a.mag += fromRes; need -= fromRes;
    // spare magazines in the inventory (ITEMS.pistol_ammo = one 15-round magazine)
    const inv = this.inv;
    while (need > 0 && (inv?.count?.('pistol_ammo') || 0) > 0) { inv.remove('pistol_ammo', 1); a.reserve += WEAPONS.pistol.mag; const k = Math.min(need, a.reserve); a.reserve -= k; a.mag += k; need -= k; }
  }
  _sfx(name, vol = 1) { const p = this.game.player; return { name, x: p.x, y: p.y + 1.3, z: p.z, deck: p.deck, vol }; }
  _muzzlePos(out) {
    const g = this.game, p = g.player;
    if (g.chars && p.charId >= 0) { g.chars.handPos(p.charId, out); if (out.lengthSq() > 0) return out; }
    return out.set(p.x + Math.sin(p.yaw) * 0.5, p.y + 1.35, p.z + Math.cos(p.yaw) * 0.5);
  }
  shoot() {
    const g = this.game, p = g.player, w = WEAPONS.pistol, a = this.ammo.pistol;
    if (this.cd > 0 || this.reloadT > 0) return null;
    if (a.mag <= 0) { this.bus.emit('sfx', this._sfx('gun_click')); this.cd = 0.25; if (a.reserve > 0 || (this.inv?.count?.('pistol_ammo') || 0) > 0) this.reload(); return null; }
    a.mag--; this.cd = w.rof; this._lastAttackT = this.time;
    this._faceAim();
    p.playAnim(p.aiming ? 'fire_pistol' : 'fire_pistol', 0.22);
    const moving = clamp(p.speed / 3, 0, 1);
    // bloom recovers ~0.5 s after the last shot: deliberate fire is accurate, spamming is not
    if (this.time - (this._lastShotT ?? -9) > 0.5) this._bloom = 0;
    const spread = (p.aiming ? w.spread : w.hipSpread) + moving * w.moveSpread + (this._bloom || 0);
    this._bloom = Math.min(w.bloomMax, (this._bloom || 0) + w.bloom);
    this._lastShotT = this.time;
    const res = this._fireRay(spread, w.range, (hit) => {
      const mult = PART_MULT[hit.part] || 1;
      return this._damageNpc(hit.npc, w.damage * mult * (0.85 + Math.random() * 0.3), { weapon: 'pistol', part: hit.part, lethal: true });
    }, 'pistol');
    // recoil & feedback
    if (g.cameraRig) { g.cameraRig.pitch -= w.recoil * (p.aiming ? 0.7 : 1); g.cameraRig.yaw += (Math.random() - 0.5) * w.recoil * 0.5; g.cameraRig.shake(0.08); }
    this.bus.emit('combat:shot', { weapon: 'pistol', x: p.x, y: p.y + 1.3, z: p.z, deck: p.deck, actor: p, silenced: false });
    this.bus.emit('sfx', this._sfx('gunshot'));
    // a person hit is already reported as 'shooting' / 'murder' by _damageNpc; otherwise it's a discharge
    if (!res?.hit) g.security?.report({ type: 'discharge' });
    return res;
  }
  // aim point: what the crosshair (camera ray, no spread) rests on — first character or wall/floor/ceiling,
  // else a point far down the ray.
  aimPoint(range = 60) {
    const p = this.game.player;
    const { o, d, skip } = this._aimRay(0);
    const wall = this.rayWorld(o, d, range + skip, p.deck);
    const ch = this._hitChar(o, d, Math.min(range + skip, wall.t), skip);
    const t = ch ? ch.dist : wall.kind !== 'none' ? wall.t : range + skip;
    return new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
  }
  // common hitscan: camera ray → aim point; then the shot travels from the muzzle to that point (+ spread):
  // first character, camera, glass or wall along the MUZZLE ray is what gets hit.
  _fireRay(spread, range, onHit, weapon) {
    const g = this.game, p = g.player;
    const muzzle = this._muzzlePos(new THREE.Vector3());
    const aim = this.aimPoint(range);
    const d = new THREE.Vector3().subVectors(aim, muzzle);
    if (d.lengthSq() < 0.04) { const a = this._aimRay(0); d.copy(a.d); } else d.normalize();
    // never shoot backwards through the player (aim point behind the muzzle in tight spaces)
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    if (d.x * fwd.x + d.z * fwd.z < -0.2) { d.x = fwd.x; d.z = fwd.z; d.normalize(); }
    if (spread > 0) { d.x += (Math.random() - 0.5) * 2 * spread; d.y += (Math.random() - 0.5) * 2 * spread; d.z += (Math.random() - 0.5) * 2 * spread; d.normalize(); }
    const o = muzzle.clone(), skip = 0;
    const wall = this.rayWorld(o, d, range, p.deck);
    const ch = this._hitChar(o, d, Math.min(range, wall.t), 0);
    let end, result = { hit: null, wall: null };
    // cameras on the line
    const sec = g.security;
    let camHit = null;
    if (sec && weapon === 'pistol') {
      let bt = ch ? ch.dist : wall.t;
      for (const c of sec.cameras) {
        if (c.deck !== p.deck || c.broken || Math.abs(c.x - o.x) > range) continue;
        _p.set(c.x - o.x, c.y + 0.05 - o.y, c.z - o.z); const t = _p.dot(d); if (t < skip || t > bt) continue;
        const dist2 = _p.lengthSq() - t * t; if (dist2 < 0.2 * 0.2) { bt = t; camHit = c; }
      }
    }
    if (camHit) {
      end = new THREE.Vector3(camHit.x, camHit.y, camHit.z);
      sec.breakCamera(camHit, true); this.fx.sparks(end, 14); result.camera = camHit;
    } else if (ch) {
      end = _p.copy(o).addScaledVector(d, ch.dist).clone();
      const outcome = onHit(ch);
      this.fx.puff(end, weapon === 'taser' ? 0x9fd8ff : 0x4a0d0d);
      result.hit = { npc: ch.npc, part: ch.part, dist: ch.dist, outcome };
    } else {
      end = wall.point.clone();
      if (wall.kind !== 'none') {
        result.wall = wall;
        if (weapon === 'pistol') {
          if (wall.glass) { this.fx.glass(end); this.bus.emit('sfx', { name: 'glass_break', x: end.x, y: end.y, z: end.z, deck: p.deck }); g.security?.report({ type: 'vandalism', x: end.x, z: end.z, deck: p.deck }); result.property = 'glass'; }
          else { this.fx.decal(end, wall.normal, p.deck); this.fx.sparks(end, 6); this.fx.dust(end, wall.normal); }
        }
      }
    }
    if (weapon === 'pistol') { this.fx.muzzle(muzzle, d); this.fx.tracer(muzzle, end); }
    if (weapon === 'taser') this.fx.wires(muzzle, end);
    this.lastShot = { from: muzzle.clone(), to: end.clone(), dir: d.clone(), aim: aim.clone(), hit: result.hit ? { id: result.hit.npc.id, part: result.hit.part, outcome: result.hit.outcome } : null, wall: result.wall?.kind || null };
    return result;
  }
  tase() {
    const g = this.game, p = g.player, w = WEAPONS.taser;
    if (this.taserCD > 0) { this.bus.emit('sfx', this._sfx('gun_click', 0.5)); return null; }
    this.taserCD = w.reload; this._faceAim(); this._lastAttackT = this.time;
    p.playAnim('aim_taser', 0.35);
    this.bus.emit('sfx', this._sfx('taser'));
    const res = this._fireRay(p.aiming ? 0.01 : 0.03, w.range + 3, (hit) => {
      const pd = Math.hypot(hit.npc.x - p.x, hit.npc.z - p.z);
      if (pd > w.range) return 'miss';
      return this._damageNpc(hit.npc, 0, { weapon: 'taser', ko: true, koTime: w.stun[0] + Math.random() * (w.stun[1] - w.stun[0]), part: hit.part });
    }, 'taser');
    this.bus.emit('combat:shot', { weapon: 'taser', x: p.x, y: p.y + 1.3, z: p.z, deck: p.deck, actor: p, silenced: true });
    return res;
  }
  spray(dt) {
    const g = this.game, p = g.player, w = WEAPONS.extinguisher;
    if (this.extCharge <= 0) { if (!this._sprayEmpty) { this._sprayEmpty = true; this.bus.emit('sfx', this._sfx('gun_click', 0.4)); } return; }
    this._sprayEmpty = false;
    this.extCharge = Math.max(0, this.extCharge - w.drain * dt);
    this._faceAim();
    p.animOverride = 'aim_pistol'; p._animT = 0.15;
    const { d } = this._aimRay(0);
    const m = this._muzzlePos(new THREE.Vector3());
    this.fx.spray(m, d, 5);
    this._sprayAcc = (this._sprayAcc || 0) + dt;
    if (!this._sprayOn || this._sprayAcc > 0.6) { this._sprayOn = true; this._sprayAcc = 0; this.bus.emit('sfx', { ...this._sfx('spray', 0.7) }); }
    // targets in the cone
    const yaw = Math.atan2(d.x, d.z);
    for (const n of g.npcs?.query(p.deck, p.x, p.z, w.range) || []) {
      if (!conscious(n)) continue;
      const dx = n.x - p.x, dz = n.z - p.z, dist = Math.hypot(dx, dz) || 0.1;
      if (Math.abs(wrap(Math.atan2(dx, dz) - yaw)) > w.cone || !this.world.lineClear(p.deck, p.x, p.z, n.x, n.z)) continue;
      n._sprayT = (n._sprayT || 0) + dt;
      if (n._sprayT > 0.35 && !(n.blindUntil > this.time)) {
        n.blindUntil = this.time + 4.5;
        n._sprayT = 0;
        const cls = npcClass(n);
        const sys = g.npcs.system;
        if (cls === 'guard') { n.state = 'stagger'; n.prev = null; n.after = null; n.timer = 1.2; sys.setAnim(n, 'cower', 'none'); n.secStagger = 4.5; g.security?.ai?.blinded(n); }
        else { sys.react(n, { type: 'hit', damage: 0, source: p, x: p.x, z: p.z }); sys.setAnim(n, 'cower', 'none'); n.timer = 1.4; }
        this.bus.emit('sfx', { name: 'grunt', x: n.x, y: n.y + 1.5, z: n.z, deck: n.deck, vol: 0.5 });
        const last = this._victims.get(n) ?? -99;
        if (this.time - last > 8) { this._victims.set(n, this.time); g.security?.report({ type: 'assault', victim: n }); }
      }
    }
    // fog the cameras in front of the nozzle
    const cx = p.x + d.x * 3, cz = p.z + d.z * 3;
    g.security?.obscureCameras(p.deck, cx, cz, 3.5, 22);
  }
  _intimidate() {
    const g = this.game, p = g.player;
    const { o, d, skip } = this._aimRay(0);
    const wall = this.rayWorld(o, d, 18 + skip, p.deck);
    const ch = this._hitChar(o, d, Math.min(18 + skip, wall.t), skip);
    const n = ch?.npc;
    if (!n || !conscious(n) || npcClass(n) === 'guard') return;
    if (n._handsUpT > this.time) return;
    n._handsUpT = this.time + 6;
    g.npcs.system?.react?.(n, { type: 'handsUp', duration: 7 });
    g.security?.crime.intimidate(n);
    if (!g.security?.isWanted || true) { const last = this._victims.get(n) ?? -99; if (this.time - last > 15) { this._victims.set(n, this.time); g.security?.report({ type: 'armed', victim: n }); } }
  }

  // ── guards attacking the player ───────────────────────────────────────
  // kind: 'baton' | 'punch' | 'taser' | 'pistol'. Returns 'hit' | 'blocked' | 'miss'.
  // o.nonLethal: the hit can't kill — at ≤ 1 hp the suspect is stunned (down) instead, to be cuffed.
  attackPlayer(n, kind, o = {}) {
    const g = this.game, p = g.player;
    if (p.state === 'dead' || g.security?.jailed) return 'miss';
    return this._attackPlayer(n, kind, o);
  }
  _hurtPlayer(dmg, n, o) {
    const p = this.game.player;
    if (o.nonLethal && p.health - dmg < 1) { dmg = Math.max(0, p.health - 1); p.damage(dmg, n); if (!(this.stunned > 0)) this.stunPlayer(4.5, n); return; }
    p.damage(dmg, n);
  }
  _attackPlayer(n, kind, o = {}) {
    const g = this.game, p = g.player;
    const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz);
    const los = n.deck === p.deck && this.world.lineClear(n.deck, n.x, n.z, p.x, p.z);
    const hand = new THREE.Vector3(); if (g.chars && n.charId >= 0) g.chars.handPos(n.charId, hand); if (hand.lengthSq() === 0) hand.set(n.x, n.y + 1.35, n.z);
    const chest = new THREE.Vector3(p.x, p.y + 1.25, p.z);
    if (kind === 'baton' || kind === 'punch') {
      if (d > 2.0 || !los) return 'miss';
      const facing = (Math.sin(p.yaw) * -dx + Math.cos(p.yaw) * -dz) / (d || 1) > 0.2;
      let dmg = kind === 'baton' ? 13 : 7;
      let res = 'hit';
      if (this.blocking && facing) { dmg *= 0.25; res = 'blocked'; p.stamina = Math.max(0, p.stamina - 12); }
      this._hurtPlayer(dmg, n, o);
      this.bus.emit('sfx', { name: kind === 'baton' ? 'baton_hit' : 'punch', x: p.x, y: p.y + 1.4, z: p.z, deck: p.deck, vol: res === 'blocked' ? 0.5 : 1 });
      if (res === 'hit') { p.vx += dx / (d || 1) * 2.2; p.vz += dz / (d || 1) * 2.2; g.cameraRig?.shake(0.3); }
      return res;
    }
    if (kind === 'taser') {
      if (d > 7 || !los) return 'miss';
      const chance = clamp(0.85 - p.speed * 0.08 - (p.crouch ? 0.1 : 0) - d * 0.02, 0.25, 0.9);
      const hit = Math.random() < (o.chance ?? chance);
      const end = hit ? chest : chest.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.3), (Math.random() - 0.5) * 1.6));
      this.fx.wires(hand, end);
      this.bus.emit('sfx', { name: 'taser', x: n.x, y: n.y + 1.3, z: n.z, deck: n.deck, vol: 0.9 });
      if (hit) this.stunPlayer(3.2, n);
      return hit ? 'hit' : 'miss';
    }
    if (kind === 'pistol') {
      if (!los || d > 40) return 'miss';
      const chance = clamp(0.62 - d * 0.014 - (p.sprint ? 0.22 : p.speed > 2 ? 0.12 : 0) - (p.crouch ? 0.1 : 0), 0.08, 0.7);
      const hit = Math.random() < (o.chance ?? chance);
      const dir = chest.clone().sub(hand).normalize();
      let end;
      if (hit) { end = chest; this._hurtPlayer(o.damage ?? 13, n, o); this.fx.puff(chest, 0x4a0d0d); g.cameraRig?.shake(0.35); }
      else {
        dir.x += (Math.random() - 0.5) * 0.12; dir.y += (Math.random() - 0.5) * 0.08; dir.z += (Math.random() - 0.5) * 0.12; dir.normalize();
        const w = this.rayWorld(hand, dir, 45, n.deck); end = w.point;
        if (w.kind !== 'none') { if (w.glass) this.fx.glass(end); else { this.fx.decal(end, w.normal, n.deck); this.fx.sparks(end, 5); } }
        this.bus.emit('sfx', { name: 'whiz', x: p.x, y: p.y + 1.5, z: p.z, deck: p.deck, vol: 0.5 });
      }
      this.fx.muzzle(hand, dir); this.fx.tracer(hand, end);
      this.bus.emit('combat:shot', { weapon: 'pistol', x: n.x, y: n.y + 1.3, z: n.z, deck: n.deck, actor: n, silenced: false });
      this.bus.emit('sfx', { name: 'gunshot', x: n.x, y: n.y + 1.3, z: n.z, deck: n.deck });
      return hit ? 'hit' : 'miss';
    }
    return 'miss';
  }
  stunPlayer(secs, by) {
    const p = this.game.player;
    this.stunned = secs; this.surrendering = false;
    p.lockControls(true); p.aiming = false;
    this.stopDrag();
    this.bus.emit('sfx', { name: 'grunt', x: p.x, y: p.y + 1.4, z: p.z, deck: p.deck });
    this.bus.emit('player:stunned', { secs, by });
    this.game.cameraRig?.shake(0.6);
  }

  // ── bodies ────────────────────────────────────────────────────────────
  startDrag(n) {
    if (!n || conscious(n)) return false;
    this.dragging = n; n._dragged = true; n._found = n._found || false;
    this.holster();
    return true;
  }
  stopDrag() {
    const n = this.dragging; if (!n) return;
    this.dragging = null; n._dragged = false;
    this.bus.emit('sfx', { name: 'body_fall', x: n.x, y: n.y, z: n.z, deck: n.deck, vol: 0.4 });
  }
  _dragUpdate(dt, play) {
    const g = this.game, p = g.player, n = this.dragging, I = g.input;
    if (!n || n.gone || conscious(n) || n.deck !== p.deck || (play && !I.down('KeyG') && this.time - (this._dragStart || 0) > 0.3) || p.state !== 'free') { this.stopDrag(); return; }
    // slow the player down
    const sp = Math.hypot(p.vx, p.vz), max = 1.25;
    if (sp > max) { p.vx *= max / sp; p.vz *= max / sp; }
    p.sprint = false;
    // body trails behind
    const bx = p.x - Math.sin(p.yaw) * 1.05, bz = p.z - Math.cos(p.yaw) * 1.05;
    const nav = g.npcs.nav;
    if (nav.passable(p.deck, bx, bz, 0xff) && this.world.lineClear(p.deck, p.x, p.z, bx, bz)) { n.x += (bx - n.x) * Math.min(1, dt * 10); n.z += (bz - n.z) * Math.min(1, dt * 10); }
    else { n.x += (p.x - n.x) * Math.min(1, dt * 4); n.z += (p.z - n.z) * Math.min(1, dt * 4); }
    n.y = this.world.floorY(p.deck, n.x, n.z);
    n.yaw = p.yaw + Math.PI;
    if ((this.time * 4 | 0) % 2 === 0) g.npcs.system?._updateRoom?.(n);
    if (n.state === 'ko') n.timer = Math.max(n.timer, 5);   // nobody wakes up while being dragged
    p.animOverride = p.speed > 0.15 ? 'drag' : 'crouch_idle'; p._animT = 0.15;
  }
  // physical evidence: someone (or a camera) finds a body
  scanBodies() {
    this._scanT -= 0.1; if (this._scanT > 0) return; this._scanT = 0.5;
    const g = this.game, sec = g.security;
    for (const b of this.downed) {
      if (b.gone || (b.state !== 'ko' && b.state !== 'dead')) { this.downed.delete(b); continue; }
      if (b._found || b._dragged) continue;
      const dead = b.state === 'dead';
      let finder = null;
      for (const n of g.npcs.query(b.deck, b.x, b.z, 14)) {
        if (n === b || !conscious(n) || n.state === 'flee') continue;
        if (n.perception.canSee(b.x, b.y + 0.3, b.z, b.deck)) { finder = n; break; }
      }
      let cam = null;
      if (!finder && sec) cam = sec.camerasSeeing(b.deck, b.x, b.y + 0.3, b.z)[0] || null;
      if (!finder && !cam) continue;
      b._found = true;
      const p = g.player;
      if (finder) g.npcs.broadcast('body', b.x, b.y, b.z, b.deck, 12, { victim: b });
      // suspect standing over the body?
      const nearBody = p.deck === b.deck && Math.hypot(p.x - b.x, p.z - b.z) < 5;
      const seesPlayer = finder ? finder.perception.canSee(p.x, p.y + 1.4, p.z, p.deck) : cam && sec.cameraSees(cam, p.deck, p.x, p.y + 1.4, p.z);
      if (sec) {
        if (nearBody && seesPlayer) sec.report({ type: dead ? 'murder' : 'assault', victim: b, witnessed: false });
        else sec.crime.commit({ type: dead ? 'body_found' : 'ko_found', actor: p, x: b.x, y: b.y, z: b.z, deck: b.deck, evidence: true, reporter: finder, reporterKind: finder ? npcClass(finder) : 'camera', delay: finder ? (npcClass(finder) === 'pax' ? 8 : 3) : 7 });
      }
      this.bus.emit('combat:bodyFound', { body: b, by: finder, camera: cam });
    }
  }

  // ── interactions ──────────────────────────────────────────────────────
  _providers() {
    const g = this.game, c = this;
    g.interact?.addProvider((ctx) => {
      const p = ctx.player, out = [];
      if (p.state !== 'free' || c.dragging || c.stunned > 0 || c.surrendering) return out;
      const near = g.npcs?.query(ctx.deck, ctx.x, ctx.z, 2.0) || [];
      for (const n of near) {
        const d = Math.hypot(n.x - ctx.x, n.z - ctx.z);
        // crime prompt: alt key (F); outranks social prompts only when sneaking (crouched) / in crime mode
        // crime prompt: only while sneaking (crouched) or in crime mode — then it's the top prompt on E
        // (stand behind = Pickpocket on F, crouch behind = Takedown); never offered over Talk/Sit/Buy/Open otherwise
        if ((p.crouch || p.crimeMode || g.activities?.crimeMode) && c.canTakedown(n)) out.push({ id: 'cb:td:' + n.id, label: 'Takedown', key: 'E', x: n.x, y: n.y + 1.6, z: n.z, dist: d, priority: 6, crimePrompt: true, enabled: true, run: () => c.takedown(n) });
        if (!conscious(n) && d < 1.6) {
          out.push({ id: 'cb:drag:' + n.id, label: 'Drag body (hold G)', key: 'G', x: n.x, y: n.y + 0.4, z: n.z, dist: d, priority: 2, enabled: true, run: () => { c._dragStart = c.time; c.startDrag(n); } });
          if (n.role === 'security') {
            const L = c.looted.get(n) || new Set(); c.looted.set(n, L);
            const loot = [['baton', 'Take baton'], ['taser', 'Take taser'], ['keycard', 'Take security keycard'], ['uniform', 'Take uniform']];
            if (n.sec?.armed) loot.splice(2, 0, ['pistol', 'Take pistol']);
            for (const [id, label] of loot) {
              if (L.has(id)) continue;
              if (id === 'uniform' && p.disguise === 'security') continue;
              if (id === 'keycard' && p.keycards?.has('security')) continue;
              if (WEAPONS[id] && c.owned(id) && id !== 'pistol') continue;
              out.push({ id: `cb:loot:${n.id}:${id}`, label, key: 'E', hold: id === 'uniform' ? 2.5 : 0.6, x: n.x, y: n.y + 0.5, z: n.z, dist: d + 0.05, priority: 3, enabled: true,
                run: () => {
                  L.add(id);
                  if (id === 'keycard') { try { g.inventory?.add?.('security_keycard', 1); } catch {} p.keycards?.add('security'); p.keycards?.add('crew'); }
                  else if (id === 'uniform') { try { p.wearDisguise?.('security'); } catch {} n.appearance && (n._stripped = true); }
                  else c.give(id, 1, id === 'pistol' ? { mag: 15, reserve: 15 } : null);
                  g.security?.report({ type: 'theft', victim: n, quiet: true });
                  g.security?._toast?.({ baton: 'Baton acquired [2]', taser: 'Taser acquired [3]', pistol: 'Pistol acquired [4]', keycard: 'Security keycard acquired', uniform: 'Disguised as security' }[id], 'good');
                } });
            }
          }
        }
      }
      // armoury cabinets & hose boxes
      const plan = g.world.plans[ctx.deck];
      if (plan && p.room) {
        if (p.room.armory) {
          const items = [['pistol', 'Take pistol'], ['taser', 'Take taser'], ['baton', 'Take baton'], ['pistol_ammo', 'Take ammunition (30)']];
          let k = 0;
          for (const [id, label] of items) {
            if (id !== 'pistol_ammo' && c.owned(id)) continue;
            if (id === 'pistol_ammo' && !c.owned('pistol')) continue;
            out.push({ id: 'cb:arm:' + id, label, key: 'E', hold: 0.8, x: ctx.x, y: ctx.y + 1.2, z: ctx.z, dist: 0.5 + k++ * 0.01, priority: 2, enabled: true,
              run: () => { c.give(id, id === 'pistol_ammo' ? 30 : 1, id === 'pistol' ? { mag: 15, reserve: 15 } : null); g.security?.report({ type: 'theft', quiet: true }); } });
          }
        }
        if (!c.owned('extinguisher') || c.extCharge < 30) {
          const box = c._nearItem(plan, 'hose_box', ctx.x, ctx.z, 1.6);
          if (box && !c.boxTaken.has(box)) out.push({ id: 'cb:ext', label: 'Take fire extinguisher', key: 'E', x: box.x, y: deckY(ctx.deck) + 1, z: box.z, dist: Math.hypot(box.x - ctx.x, box.z - ctx.z), priority: 1, enabled: true,
            run: () => { c.boxTaken.add(box); c.give('extinguisher'); c.select('extinguisher'); g.security?._toast?.('Fire extinguisher [5] — hold LMB to spray', 'info'); } });
        }
      }
      return out;
    }, 'combat');
  }
  _nearItem(plan, t, x, z, r) {
    if (!plan._ciIdx) { plan._ciIdx = new Map(); for (const it of plan.items) { if (it.t !== 'hose_box' && it.t !== 'cabinet') continue; const k = Math.floor((it.x + 200) / 4) * 1000 + Math.floor((it.z + 50) / 4); if (!plan._ciIdx.has(k)) plan._ciIdx.set(k, []); plan._ciIdx.get(k).push(it); } }
    const bx = Math.floor((x + 200) / 4), bz = Math.floor((z + 50) / 4); let best = null, bd = r;
    for (let a = bx - 1; a <= bx + 1; a++) for (let b = bz - 1; b <= bz + 1; b++) for (const it of plan._ciIdx.get(a * 1000 + b) || []) { if (it.t !== t) continue; const d = Math.hypot(it.x - x, it.z - z); if (d < bd) { bd = d; best = it; } }
    return best;
  }
}

export async function installCombat(game) {
  const c = new Combat(game);
  game.combat = c;
  c._providers();
  game.addSystem({ name: 'combat', order: 22, update: (dt) => { c.update(dt); c._tdUpdate(dt); } });
  game.addSystem({ name: 'combatFX', order: 94, runWhilePaused: false, lateUpdate: (dt, rdt) => c.fx.update(rdt || dt) });
  return c;
}
export { Combat };
