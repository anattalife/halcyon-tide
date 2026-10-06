// HALCYON TIDE — ship's security: heat, wanted description, CCTV, trespass suspicion, lockdowns, arrest & the brig.
//
// game.security API (docs/ARCHITECTURE.md "Security"):
//   heat            0..5 integer wanted level (heatValue = float, decays fractionally)
//   status          '' | 'Person of interest' | 'Pursuit' | 'Section lockdown' | 'Armed response' | 'Ship lockdown'
//   known           true while heat > 0 AND the circulated description matches the player's current outfit
//   isWanted        heat > 0
//   description     {key, text, role} last circulated description (or null) · describe() → text ('' if none)
//   lastKnown       {deck, x, z, t} last confirmed position · seen (bool, a guard/camera has eyes on the player now)
//   suspicion       0..1 trespass / impersonation meter (eye icon) · watcher (npc filling it)
//   report(crime)   commit a crime as the player: {type, severity?, x?, z?, deck?, victim?, witnessed?, stealth?} → crime record
//   addHeat(n, reason) / clear() / setHeat(level)
//   cameras         [{id, deck, x, z, yaw, dome, room, broken, obscuredUntil}] · camerasSeeing(deck,x,y,z) · cameraLive(cam)
//   setCamerasEnabled(on, deck?)   on=false kills all feeds (or one deck's); a bare number = disable that deck
//   breakCamera(cam) · obscureCameras(deck,x,z,r,seconds) · cctvDown(minutes) · loopFeed(deck,on) · wipeRecordings()
//   lockdown(on, deck?, opts)  section/ship lockdown (doors lock, elevators disabled, PA)
//   arrest()        busted → brig on deck 2, fine, confiscation, record strike
//   record          {strikes, fines, arrests} · evidenceLocker [{id, qty, meta}] confiscated goods (recoverable)
//   jailed          bool (in the holding cells)
//   ai              guard AI (securityAI.js) · crime (crime.js CrimeSystem) · hud (securityHud.js)
//   cctv            {open(), close(), view(i), next(), prev(), loop(deck,on), wipe(), active}
// Bus out: 'heat:change' {level, prev, status}, 'alarm' {kind:'security', on, deck}, 'announce' {text, chime},
//   'security:report' {report}, 'security:arrest' {fine, strikes, items}, 'security:released', 'security:suspicious' {npc},
//   'security:cctv' {on}, 'power:cut' {power:'cctv', minutes}, 'ui:toast'.
// Bus in: 'crime' (crime.js), 'npc:wake', 'npc:dead', 'npc:ko', 'player:appearance', 'player:dead'.
import { deckY, CORES, CREW_CORES } from '../core/config.js';
import { CrimeSystem, crimeSpec, describeAppearance, placeName, sectionOf, npcClass } from './crime.js';

export const STATUS = ['', 'Person of interest', 'Pursuit', 'Section lockdown', 'Armed response', 'Ship lockdown'];
const CODES = ['', 'Code Yellow', 'Code Bravo', 'Code Bravo', 'Code Bravo — armed', 'Code Zulu'];
const CREWISH = new Set(['crew_steward', 'crew_waiter', 'crew_bartender', 'crew_chef', 'crew_deckhand', 'crew_engineer', 'crew_housekeeping', 'crew_officer', 'captain', 'security', 'croupier', 'medic', 'lifeguard', 'entertainer']);
// restricted rooms: which uniforms belong there
function allowedRoles(room) {
  if (!room) return null;
  const t = room.type, a = room.access;
  if (t === 'security' || t === 'brig' || a === 'security' || room.secOffice || room.cctv || room.armory || room.evidence || isCells(room)) return ['security', 'captain'];
  if (t === 'bridge' || t === 'bridgewing' || t === 'officer' || a === 'officer' || room.server) return ['crew_officer', 'captain', 'security'];
  if (t === 'engine' || a === 'engineer') return ['crew_engineer', 'crew_deckhand', 'crew_officer', 'captain'];
  if (a === 'casino' || room.cage) return ['croupier', 'security', 'crew_officer'];
  return ['crew_officer', 'captain', 'security'];
}

const HELD_WEAPONS = new Set(['pistol', 'taser', 'baton']);
// NB: room.cells is the plan's cell COUNT — the holding-cells room is identified by type + name
export const isCells = (r) => !!r && r.type === 'brig' && /holding/i.test(r.name || '');

class Security {
  constructor(game) {
    this.game = game; this.bus = game.bus; this.world = game.world;
    this.heatValue = 0; this._level = 0;
    this.description = null; this.lastKnown = null;
    this.seen = false; this.lostT = 0; this.seenBy = null;
    this.suspicion = 0; this.watcher = null; this._suspCD = 0;
    this.time = 0; this._tick = 0;
    this.record = { strikes: 0, fines: 0, arrests: 0 };
    this.evidenceLocker = [];
    this.jailed = false; this._jail = null;
    this.locked = null;          // active lockdown {deck, section, doors:[[deck,id,prev]], cars:[]}
    this.disabledDecks = new Set(); this.allCamsOff = false;
    this.loops = new Set(); this.cctvDownUntil = -1;
    this.alert = 0;              // general security alertness (unattributed incidents)
    this.incidents = [];         // recent unattributed incidents {x,z,deck,t,kind}
    this._armedCD = 0; this._deadT = 0;
    this.handleDeath = true;     // revive in the medical centre when killed (disable if another system handles it)
    this.cameras = this._buildCameras();
    this.crime = new CrimeSystem(game, this);
    this.ai = null; this.hud = null;
    this.cctv = this._makeCCTV();
    this._listen();
  }

  // ── public getters ────────────────────────────────────────────────────
  get heat() { return this._level; }
  get status() { return STATUS[this._level]; }
  get isWanted() { return this._level > 0; }
  get known() { return this._level > 0 && !!this.description && this.description.key === this.currentDesc().key; }
  currentDesc() { return describeAppearance(this.game.player?.appearance); }
  describe() { return this.description ? this.description.text : ''; }

  // ── heat ──────────────────────────────────────────────────────────────
  setHeat(v, reason = '') {
    const prev = this._level;
    this.heatValue = Math.max(0, Math.min(5, v));
    const lvl = this.heatValue >= 1 ? Math.min(5, Math.floor(this.heatValue + 1e-6)) : 0;
    if (lvl !== prev) {
      this._level = lvl;
      this._onLevel(prev, lvl, reason);
      this.bus.emit('heat:change', { level: lvl, prev, status: STATUS[lvl], reason });
    }
    return lvl;
  }
  addHeat(n, reason = '') { return this.setHeat(Math.max(this.heatValue, this.heatValue + n), reason); }
  raiseTo(min, add = 0, reason = '') { return this.setHeat(Math.max(this.heatValue + add, min + Math.min(add, 0.95)), reason); }
  clear() { this.setHeat(0, 'cleared'); this.description = null; this.suspicion = 0; this.lostT = 0; this.seen = false; this.alert = 0; this.ai?.standDown(); }

  report(c = {}) {
    const p = this.game.player;
    return this.crime.commit({ deck: p.deck, x: p.x, y: p.y, z: p.z, actor: p, ...c });
  }

  // a report reached Control
  onReport(r) {
    const c = r.crime, spec = c.spec;
    if (this._arresting || this._reviving || this._loading) { c.reported = true; return; }   // mid-transition: already dealt with
    const g = this.game;
    this.bus.emit('security:report', { report: r });
    const first = !c.reported;
    if (r.sighted || r.kind === 'script') {
      // description circulates
      this.description = { ...c.desc, t: this.time, source: r.kind };
      if (!this.seen) this.lastKnown = { deck: c.deck, x: c.x, z: c.z, t: this.time };
      this.lostT = 0;
      if (!c.heated) {
        // one heat bump per crime, however many people report it
        c.heated = true;
        const target = spec.min + Math.min(spec.add, 0.95);
        this.setHeat(this.heatValue < target ? target : this.heatValue + spec.add * 0.5, spec.label);
      }
      if (first) {
        const who = r.kind === 'camera' ? 'CCTV' : r.kind === 'guard' ? 'patrol' : r.kind === 'crew' ? 'crew radio' : 'a passenger';
        this._radio(`Control: ${spec.label.toLowerCase()} reported by ${who} — ${c.place}. Suspect: ${c.desc.text}.`, r.npc);
        this.ai?.dispatch(c.deck, c.x, c.z, { reason: spec.type, urgent: this._level >= 2, sighted: true });
      }
    } else if (first) {
      // unattributed: security investigates but nobody is looking for *you*
      this.alert = Math.min(1, this.alert + 0.35);
      this.incidents.push({ x: c.x, z: c.z, deck: c.deck, t: this.time, kind: spec.type });
      if (this.incidents.length > 12) this.incidents.shift();
      this._radio(`Control: ${spec.label.toLowerCase()} — ${c.place}. Units respond.`, r.npc);
      this.ai?.dispatch(c.deck, c.x, c.z, { reason: spec.type, urgent: false, sighted: false });
    }
    c.reported = true;
  }

  // a guard / camera has positively identified the player right now
  sighted(byNpc = null, cam = null) {
    const p = this.game.player;
    this.seen = true; this.lostT = 0; this.seenBy = byNpc || cam;
    this.lastKnown = { deck: p.deck, x: p.x, z: p.z, t: this.time };
    // they see what you wear now
    const cur = this.currentDesc();
    if (this.description && this.description.key !== cur.key) { this.description = { ...cur, t: this.time, source: byNpc ? 'guard' : 'camera' }; this._radio(`Suspect changed clothes — now ${cur.text}.`, byNpc); }
  }

  // ── level effects ─────────────────────────────────────────────────────
  _onLevel(prev, lvl, reason) {
    const g = this.game, lk = this.lastKnown || { deck: g.player.deck, x: g.player.x, z: g.player.z };
    try { g.audio?.setHeat?.(lvl); } catch {}
    if (lvl >= 3 && prev < 3) this.lockdown(true, lk.deck, { section: sectionOf(lk.x), level: lvl });
    if (lvl >= 5 && prev < 5) this.lockdown(true, lk.deck, { ship: true, level: 5 });
    if (lvl < 3 && prev >= 3) this.lockdown(false);
    else if (lvl < 5 && prev >= 5 && this.locked) { this._shipOff(); }
    if (lvl === 4 && prev < 4) this._pa(`Bravo team, armed response authorised. Deck ${lk.deck} ${sectionOf(lk.x)}.`, 'security');
    if (lvl === 0 && prev > 0) { if (!this._quietClear && !this._loading) this._toast(prev >= 2 ? 'Security has lost your trail' : 'Security has stood down', 'good'); this.ai?.standDown(); }
    if (lvl > prev && lvl >= 1 && !this.hud) this._toast(`${STATUS[lvl]}${this.description ? ' — ' + this.description.text : ''}`, 'bad');
    this.ai?.onLevel(prev, lvl);
  }

  // ── cameras ───────────────────────────────────────────────────────────
  _buildCameras() {
    const out = []; const W = this.world;
    for (let d = 1; d < W.plans.length; d++) {
      const p = W.plans[d]; if (!p) continue;
      for (const it of p.items) {
        if (it.t !== 'camera') continue;
        const room = p.rooms[it.room] || W.roomAt(d, it.x, it.z);
        const dome = !((Math.abs(Math.round(it.x * 5 + it.z * 3)) % 3 === 0 || (room && (room.exterior || room.type === 'crew_corridor' || room.type === 'engine'))));
        out.push({ id: out.length, deck: d, x: it.x, z: it.z, y: deckY(d) + Math.min(room?.ceilH || 2.6, 2.62) - 0.15, yaw: it.rot || 0, dome, room: room?.id ?? 0,
          roomName: room?.name || room?.type || 'Deck ' + d, item: it, broken: false, obscuredUntil: -1 });
      }
    }
    return out;
  }
  cctvOn() { return !(this.cctvDownUntil > this.game.minutes); }
  cameraLive(c) { return c && !c.broken && !this.allCamsOff && !this.disabledDecks.has(c.deck) && !(c.obscuredUntil > this.time) && this.cctvOn(); }
  feedLooped(deck) { return this.loops.has(deck) || this.loops.has('all'); }
  cameraSees(c, deck, x, y, z) {
    if (c.deck !== deck) return false;
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
    if (d > (c.dome ? 15 : 22) || d < 0.3) return d < 0.3;
    if (!c.dome) { const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw); if ((dx * fx + dz * fz) / d < -0.17) return false; }   // ~200° wall-mount bullet cam
    return this.world.lineClear(deck, c.x, c.z, x, z);
  }
  camerasSeeing(deck, x, y, z, { includeLooped = false } = {}) {
    const out = [];
    if (!includeLooped && this.feedLooped(deck)) return out;
    for (const c of this.cameras) if (c.deck === deck && Math.abs(c.x - x) < 23 && this.cameraLive(c) && this.cameraSees(c, deck, x, y, z)) out.push(c);
    return out;
  }
  setCamerasEnabled(on, deck) {
    if (typeof on === 'number') { deck = on; on = false; }
    if (deck == null) { this.allCamsOff = !on; if (on) this.disabledDecks.clear(); }
    else if (on) this.disabledDecks.delete(deck); else this.disabledDecks.add(deck);
    this.bus.emit('security:cctv', { on: !!on, deck: deck ?? null });
  }
  breakCamera(c, byPlayer = true) {
    if (!c || c.broken) return false;
    c.broken = true;
    try { this.game.furniture?.setItemHidden(c.deck, c.item, true); } catch {}
    this.bus.emit('sfx', { name: 'glass_break', x: c.x, y: c.y, z: c.z, deck: c.deck, vol: 0.8 });
    if (byPlayer) this.report({ type: 'vandalism', x: c.x, z: c.z, deck: c.deck, loud: 10 });
    // a dead feed gets checked after a while
    this.incidents.push({ x: c.x, z: c.z, deck: c.deck, t: this.time, kind: 'camera' });
    this._camCheck = { cam: c, at: this.time + 25 };
    return true;
  }
  cameraAt(deck, x, y, z, r = 0.6) { let b = null, bd = r; for (const c of this.cameras) { if (c.deck !== deck || c.broken) continue; const d = Math.hypot(c.x - x, c.z - z, (c.y - y) * 0.7); if (d < bd) { bd = d; b = c; } } return b; }
  obscureCameras(deck, x, z, r = 5, seconds = 20) { let k = 0; for (const c of this.cameras) if (c.deck === deck && !c.broken && Math.hypot(c.x - x, c.z - z) < r) { c.obscuredUntil = this.time + seconds; k++; } return k; }
  cctvDown(minutes = 10) {
    this.cctvDownUntil = this.game.minutes + minutes;
    this.bus.emit('power:cut', { power: 'cctv', minutes });
    this.crime.wipeCameraReports();
    this._radio('Control: we just lost every camera feed. Send someone to the CCTV junction on Deck 2.', null);
    const j = this._junction;
    if (j) this._junctionCheck = { at: this.time + 18, x: j.x, z: j.z, deck: 2 };
  }
  loopFeed(deck, on = true) { if (on) this.loops.add(deck); else this.loops.delete(deck); this.crime.pending.forEach(r => { if (r.kind === 'camera' && r.deck === deck) r.cancelled = true; }); }
  wipeRecordings() {
    let k = this.crime.wipeCameraReports();
    if (this.description && this.description.source === 'camera') { this.description = null; k++; }
    if (this._level > 0 && !this.seen) { this.setHeat(Math.max(0, this.heatValue - 1.0), 'recordings wiped'); k++; }
    this._toast('Recordings wiped' + (k ? '' : ' (nothing incriminating on them)'), 'good');
    return k;
  }
  cctvManned() {
    const r = this.world.plans[2]?.rooms.find(r => r && r.cctv); if (!r) return false;
    return (this.game.npcs?.query(2, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 7) || []).some(n => n.state !== 'ko' && n.state !== 'dead' && n.room?.id === r.id);
  }

  // ── lockdown ──────────────────────────────────────────────────────────
  lockdown(on, deck, opts = {}) {
    const g = this.game, D = g.doors, E = g.elevators;
    if (!on) {
      const L = this.locked; if (!L) return false;
      for (const [d, id, prev] of L.doors) { try { const s = this.world.door(d, id); if (D) D.lock(d, id, prev); else s.lockedState = prev; } catch {} }
      for (const id of L.cars) { try { E?.setDisabled(id, false); } catch {} }
      if (L.ship) this._shipOff(true);
      this.bus.emit('alarm', { kind: 'security', on: false, deck: L.deck });
      this._pa(`Code Bravo, Deck ${L.deck}: stand down. Thank you for your patience.`, 'security', false);
      this.locked = null;
      return true;
    }
    deck = deck ?? g.player.deck;
    const section = opts.section || sectionOf(this.lastKnown?.x ?? g.player.x);
    const ship = !!opts.ship;
    let L = this.locked;
    if (!L) L = this.locked = { deck, section, doors: [], cars: [], ship: false, t: this.time };
    const xr = section === 'aft' ? [-170, -55] : section === 'forward' ? [55, 170] : [-55, 55];
    const decks = ship ? [deck - 1, deck, deck + 1] : [deck];
    const have = new Set(L.doors.map(([d, id]) => d * 100000 + id));
    for (const d of decks) {
      const plan = this.world.plans[d]; if (!plan) continue;
      for (const dr of plan.doors) {
        if (dr.type === 'cabin' || dr.type === 'elevator' || dr.type === 'balcony') continue;
        if (!ship && (dr.x < xr[0] || dr.x > xr[1])) continue;
        if (have.has(d * 100000 + dr.id)) continue;
        const s = this.world.door(d, dr.id);
        if (s.forcedOpen || s.ctrl) continue;
        // public doors become credential doors (security/officer/master open them), crew doors stay locked
        L.doors.push([d, dr.id, s.lockedState]);
        if (D) D.lock(d, dr.id, true); else s.lockedState = true;
      }
    }
    // lifts: the cores inside the locked section (all of them in a ship lockdown)
    const coreX = (id) => { const k = String(id).replace(/^(svc-)?/, ''); const c = CORES.find(c => k.startsWith(c.id)) || CREW_CORES.find(c => k === c.id || k.startsWith(c.id)); return c ? c.x : null; };
    if (E?.cars) for (const c of E.cars) {
      if (L.cars.includes(c.id) || c.disabled) continue;
      const cx = coreX(c.core);
      const inSection = cx == null ? true : cx >= xr[0] && cx <= xr[1];
      if (ship || (inSection && c.served?.includes(deck))) { try { E.setDisabled(c.id, true); L.cars.push(c.id); } catch {} }
    }
    if (ship && !L.ship) {
      L.ship = true;
      try { g.lights?.setEmergency?.(true); } catch {}
      this.bus.emit('alarm', { kind: 'security', on: true, deck: null });
      this._pa('This is the Captain speaking. We have a serious security incident aboard. All guests, please return to your staterooms immediately and remain there until further notice. Crew to emergency stations.', 'captain');
      try { this._densSave = g.npcs?.system?.density; g.npcs?.setDensity?.(Math.min(0.35, this._densSave ?? 1)); } catch {}
    } else if (!ship) {
      this.bus.emit('alarm', { kind: 'security', on: true, deck });
      this._pa(`${CODES[3]}, ${CODES[3]}. Deck ${deck} ${section}. All Bravo team respond. Section is now secured.`, 'security');
    }
    return true;
  }
  _shipOff(silent = false) {
    const g = this.game, L = this.locked;
    if (L) L.ship = false;
    try { g.lights?.setEmergency?.(false); } catch {}
    try { if (this._densSave != null) g.npcs?.setDensity?.(this._densSave); } catch {}
    this._densSave = null;
    if (!silent) this._pa('This is the Captain. The situation is contained; guests may resume normal activities.', 'captain', false);
  }

  // ── arrest & brig ─────────────────────────────────────────────────────
  async arrest(opts = {}) {
    const g = this.game, p = g.player;
    if (this._arresting || this.jailed) return false;
    this._arresting = true;
    const lvl = Math.max(1, this._level);
    try {
      p.lockControls(true); p.aiming = false;
      try { g.combat?.stopDrag?.(); g.combat?.holster?.(); if (g.combat) { g.combat.surrendering = false; g.combat.stunned = 0; } } catch {}
      p.state = 'arrested';
      // nobody keeps chasing / barking about a suspect in cuffs
      this._quietUntil = this.time + 4;
      this.crime.cancelAll('arrested');
      this.ai?.standDown(true);
      this.hud?.clearRadio?.();
      this.bus.emit('sfx', { name: 'radio_chatter', x: p.x, y: p.y, z: p.z, deck: p.deck, vol: 0.6 });
      this.hud?.busted(true);
      await this._fade(true, opts.instant ? 0 : 1400);
      // fine: cash first, then the onboard account (never past its limit — the rest is waived)
      const strikes = Math.min(3, this.record.strikes + 1);
      let fine = [0, 150, 400, 900, 1800, 3500][lvl] + (this.record.strikes * 150);
      if (strikes >= 3) fine *= 2;
      const bill = this._bill(fine, 'Security fine');
      const paid = bill.cash;
      // confiscation (evidence / mission items are never taken)
      const items = this._confiscate();
      this.record.strikes = strikes; this.record.fines += bill.cash + bill.account; this.record.arrests++;
      // into the cells
      const cell = this._cellSpot();
      this._resetPlayerPose();
      p.teleport(2, cell.x, cell.z, cell.yaw, { strict: true });
      p.health = Math.max(p.health, 60);
      this._quietClear = true; this.clear(); this._quietClear = false;
      this.lockdown(false);
      this._camSeen = 0; this._camLock = null; this.seen = false; this.lostT = 0; this.lastKnown = null;
      this.jailed = true;
      this._jail = { t: this.time, release: this.time + (opts.release ?? 75), door: cell.door };
      if (cell.door != null) { try { g.doors ? g.doors.lock(2, cell.door, 'sealed') : (this.world.door(2, cell.door).lockedState = 'sealed'); } catch {} }
      const hours = 3; g.minutes += 60 * hours;    // a few hours in a cell
      const summary = [
        `Fine §${fine}: §${bill.cash} from your wallet${bill.account ? `, §${bill.account} charged to your cabin account` : ''}${bill.waived ? ` (§${bill.waived} waived)` : ''}.`,
        items.length ? `Confiscated: ${items.map(i => i.name || i.id).join(', ')} — held in the Evidence Locker (deck 2).` : 'Nothing confiscated.',
        `Ship's record: ${strikes} strike${strikes > 1 ? 's' : ''} of 3. ${hours} hours in the holding cells.`,
      ];
      this.lastOutcome = { kind: 'busted', fine, bill, items: items.map(i => i.id), strikes, hours, summary };
      this.bus.emit('security:arrest', { fine, paid, strikes, items, bill, summary });
      this.hud?.busted(false);
      this.hud?.outcome?.('BUSTED', 'Ship\'s Security · Holding Cells, Deck 2', summary, 'busted');
      await this._wait(opts.instant ? 0 : 2600);
      this.hud?.outcome?.(null);
      await this._fade(false, opts.instant ? 0 : 900);
      this._resetPlayerPose();
      p.lockControls(false);
      try { g.ui?.showTitle?.('BUSTED', summary[0], 3200); } catch {}
      if (strikes >= 3) {
        this.hud?.title('DISEMBARKATION NOTICE', 'Third strike on the ship\'s record. You will be escorted ashore at the next port of call — unless you can make this go away.');
        this.bus.emit('security:disembark', { strikes });
      }
      this._toast(summary.join(' '), 'bad', 9000);
      return true;
    } finally { this._arresting = false; }
  }
  _resetPlayerPose() {
    const g = this.game, p = g.player;
    if (p.state === 'arrested' || p.state === 'dead') p.state = 'free';
    p.animOverride = null; p._animT = 0; p.aiming = false; p.crouch = false; p.vx = p.vz = 0; p.speed = 0;
    if (g.combat) { g.combat.surrendering = false; g.combat.surrT = 0; g.combat.stunned = 0; }
  }
  _wait(ms) { return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve(); }
  // Charge an amount: wallet first, then the onboard account down to its credit limit; anything beyond is waived.
  // → {cash, account, waived}
  _bill(amount, reason) {
    const g = this.game, eco = g.economy, p = g.player;
    const out = { cash: 0, account: 0, waived: 0 };
    try {
      if (eco) {
        out.cash = Math.max(0, Math.min(eco.cash ?? 0, amount));
        if (out.cash > 0) eco.spend(out.cash, reason, { silent: true });
        let rest = amount - out.cash;
        if (rest > 0 && typeof eco.credit === 'number') {
          const room = Math.max(0, eco.credit + (eco.creditLimit ?? 2000));
          out.account = Math.min(rest, room);
          if (out.account > 0) { if (eco._charge) eco._charge(out.account, reason, { silent: true }); else eco.credit -= out.account; }
          rest -= out.account;
        }
        out.waived = Math.max(0, rest);
      } else { out.cash = Math.min(p.money || 0, amount); p.money = (p.money || 0) - out.cash; out.waived = amount - out.cash; }
    } catch { /* keep partial result */ }
    return out;
  }
  _takeMoney(amount) { return this._bill(amount, 'Security fine').cash; }
  _confiscate() {
    const g = this.game, inv = g.inventory || g.player.inventory, out = [];
    const take = (id, qty, meta) => { out.push({ id, qty, meta, name: meta?.name || id }); };
    try {
      if (inv && inv.items instanceof Map) {
        for (const [id, it] of [...inv.items]) {
          const rec = typeof it === 'object' ? it : { qty: it };
          const kind = rec.kind || g.combat?.itemKind?.(id);
          if (kind === 'evidence' || rec.mission || rec.meta?.mission) continue;   // story evidence is never confiscated
          const stolen = rec.stolen || rec.meta?.stolen;
          if (kind === 'weapon' || kind === 'ammo' || stolen || id === 'pistol_ammo') {
            const qty = rec.qty ?? (typeof it === 'number' ? it : 1);
            take(id, qty, typeof it === 'object' ? { ...it } : null);
            inv.remove(id, qty);
          }
        }
      }
    } catch (e) { console.warn('[security] confiscate', e); }
    try { const cw = g.combat?.confiscate?.(); if (cw) for (const w of cw) if (!out.some(o => o.id === w.id)) out.push(w); } catch {}
    this.evidenceLocker.push(...out);
    return out;
  }
  recoverEvidence() {
    const g = this.game, inv = g.inventory || g.player.inventory, got = [];
    for (const it of this.evidenceLocker) {
      try {
        if (g.combat?.isWeaponId?.(it.id)) g.combat.give(it.id, it.qty, it.meta);
        else if (it.id === 'pistol_ammo' && g.combat && !inv?.has?.('pistol_ammo') && it.qty > 1 && !it.meta) g.combat.give('pistol_ammo', it.qty);
        else if (inv) inv.add(it.id, it.qty || 1, it.meta || undefined);
        got.push(it.name || it.id);
      } catch {}
    }
    this.evidenceLocker.length = 0;
    return got;
  }
  _cellSpot() {
    const plan = this.world.plans[2];
    const cells = plan?.rooms.find(r => isCells(r)) || plan?.rooms.find(r => r && r.brig);
    if (!cells) return { x: -44, z: -13, yaw: 0, door: null };
    const door = plan.doors.find(d => d.rooms && (d.rooms[0] === cells.id || d.rooms[1] === cells.id));
    // stand clear of the beds, a step inside the door
    let x = door ? door.x : (cells.x0 + cells.x1) / 2, z = door ? door.z : (cells.z0 + cells.z1) / 2;
    if (door) { if (door.normal === 'z') z += Math.sign(cells.cz - door.z) * 1.6; else x += Math.sign(cells.cx - door.x) * 1.6; }
    const nav = this.game.npcs?.nav;
    const q = nav?.nearestPoint(2, x, z, 0xff, 4);
    if (q && this.world.roomId(2, q.x, q.z) === cells.id) { x = q.x; z = q.z; }
    return { x, z, yaw: door ? Math.atan2(door.x - x, door.z - z) : 0, door: door?.id ?? null, room: cells.id };
  }
  release(how = 'served') {
    if (!this.jailed) return;
    const j = this._jail; this.jailed = false; this._jail = null;
    if (j?.door != null) { try { this.game.doors ? this.game.doors.lock(2, j.door, false) : (this.world.door(2, j.door).lockedState = false); this.game.doors?.open?.(2, j.door); } catch {} }
    this.bus.emit('security:released', { how });
    if (how === 'served') this._toast('"You\'re free to go. Don\'t make us regret it."', 'info');
  }
  jailbreak(method) {
    if (!this.jailed) return false;
    this.release(method);
    if (method === 'pick' || method === 'force') this.report({ type: 'jailbreak' });
    return true;
  }

  // ── trespass / impersonation suspicion ────────────────────────────────
  _trespassRule() {
    const p = this.game.player, r = p.room;
    if (!r || this.jailed) return { zone: 'public' };
    const role = p.disguise && CREWISH.has(p.disguise) ? p.disguise : null;
    const z = r.zone || 'public';
    if (z === 'private') {
      if (r.type === 'cabin' || r.type === 'suite' || r.type === 'balcony') {
        const mine = p.cabin && (r.cabin === p.cabin || r.no === p.cabin || String(r.name || '').includes(String(p.cabin)));
        if (mine || role) return { zone: z, ok: true };
        return { zone: z, ok: false, rate: 0.12, crime: 'trespass', who: 'any' };
      }
      return { zone: z, ok: true };
    }
    if (z === 'crew') {
      if (role) return { zone: z, ok: true, blend: true, role };
      return { zone: z, ok: false, rate: 0.24, crime: 'trespass', who: 'crew' };
    }
    if (z === 'restricted') {
      const allow = allowedRoles(r);
      if (role && allow.includes(role)) return { zone: z, ok: true, blend: true, role };
      if (role) return { zone: z, ok: false, rate: 0.16, crime: 'impersonation', who: 'crew' };
      return { zone: z, ok: false, rate: 0.4, crime: 'trespass', who: 'crew' };
    }
    return { zone: 'public', ok: true };
  }
  _updateSuspicion(dt) {
    const g = this.game, p = g.player;
    const rule = this._trespassRule();
    let rise = 0, watcher = null, best = 0;
    if (p.state === 'free' && !rule.ok || rule.blend || (HELD_WEAPONS.has(p.held) && p.disguise !== 'security')) {
      const near = g.npcs?.query(p.deck, p.x, p.z, rule.ok ? 6 : 16) || [];
      const py = p.y + 1.3;
      for (const n of near) {
        if (n.state === 'ko' || n.state === 'dead' || n.state === 'hidden' || n.state === 'flee') continue;
        const cls = npcClass(n);
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (!n.perception.canSee(p.x, py, p.z, p.deck)) continue;
        let k = 0;
        const still = p.speed < 0.6;
        if (!rule.ok) {
          if (rule.who === 'crew' && cls === 'pax') continue;
          // ~3–5 s for crew to challenge a stranger, ~2 s for a guard close by
          k = rule.rate * (cls === 'guard' ? 1.7 : n.role === 'crew_officer' ? 1.3 : 1) * (d < 4 ? 1.25 : d < 10 ? 1 : 0.55);
        } else if (rule.blend) {
          if (cls === 'pax' || d > 4) continue;
          // colleagues only notice an unfamiliar face if you hang around them (walking past is fine)
          k = (cls === 'guard' ? 0.045 : n.role === 'crew_officer' ? 0.035 : 0.018) * (d < 2 ? 1.5 : 1) * (still ? 1 : 0.25);
          if (rule.role === n.role) k *= 1.4;   // same department knows its people
        }
        if (p.sprint) k *= rule.ok ? 5 : 1.5;
        if (p.crouch) k *= rule.ok ? 5 : 1.4;
        if (HELD_WEAPONS.has(p.held) && p.disguise !== 'security') k += (cls === 'pax' ? 0 : cls === 'guard' ? 0.5 : 0.25);
        if (k > best) { best = k; watcher = n; }
        rise += k;   // combined below: strongest watcher + a quarter of the rest
      }
    }
    rise = Math.min(best + (rise - best) * 0.25, 0.9);
    if (rise > 0) this.suspicion = Math.min(1, this.suspicion + rise * dt);
    else this.suspicion = Math.max(0, this.suspicion - dt * (rule.ok ? 0.12 : 0.06));
    this.watcher = rise > 0 ? watcher : null;
    if (this.suspicion >= 1 && watcher && this._suspCD <= 0) {
      this._suspCD = 6;
      const cls = npcClass(watcher);
      const type = rule.crime || (HELD_WEAPONS.has(p.held) ? 'armed' : 'impersonation');
      // first time (and not a guard catching you somewhere restricted): a verbal warning, not a report
      const warnable = type === 'trespass' && !(cls === 'guard' && rule.zone === 'restricted') && this.time - (this._warnedT ?? -999) > 60;
      if (warnable) {
        this._warnedT = this.time; this.suspicion = 0.35;
        const line = rule.zone === 'private' ? 'Excuse me — this isn\'t your stateroom!' : cls === 'guard' ? 'Guests aren\'t allowed back here. Turn around, please.' : 'Sorry, crew only past this point — you need to head back.';
        this.bus.emit('bark', { text: line, x: watcher.x, y: watcher.y, z: watcher.z, deck: watcher.deck, npc: watcher, ctx: 'warning', voice: watcher.identity?.voice });
        this.bus.emit('security:warning', { npc: watcher, zone: rule.zone });
        this._toast('You have been warned — leave the area or they will call security', 'warn');
      } else {
        this.suspicion = 0.45;
        this.bus.emit('security:suspicious', { npc: watcher, type });
        const cr = this.crime.commit({ type, actor: p, x: p.x, y: p.y, z: p.z, deck: p.deck, _suspicion: true, witnessed: false, quiet: true });
        if (cr && !this.crime.pending.some(r => r.crime === cr && r.npc === watcher)) this.crime.queue({ crime: cr, kind: cls === 'guard' ? 'guard' : 'crew', npc: watcher, sighted: true, delay: cls === 'guard' ? 0.5 : 3 });
        if (cls === 'guard') this.ai?.witness(watcher, cr, true);
      }
    }
    if (this._suspCD > 0) this._suspCD -= dt;
  }

  // ── per-frame ─────────────────────────────────────────────────────────
  update(dt) {
    if (!(dt > 0)) return;
    this.time += dt;
    const g = this.game, p = g.player; if (!p) return;
    this.crime.update(dt);
    this._tick += dt;
    const tick = this._tick >= 0.1; if (tick) { const tdt = this._tick; this._tick = 0; this._slow(tdt); }
    this.ai?.update(dt);
    // heat decay: only out of sight
    if (this._level > 0) {
      if (this.seen) this.lostT = 0; else this.lostT += dt;
      const grace = 6 + this._level * 3;
      if (this.lostT > grace && !this.jailed) {
        let rate = 0.03;                                   // ~33 s per level baseline
        if (!this.known) rate *= 2.5;                      // they're looking for someone else
        const r = p.room;
        if (r && (r.type === 'cabin' || r.type === 'suite') && (this._ownCabin(r))) rate *= 1.7;
        else if (r && (r.type === 'cabin' || r.type === 'crew_cabin' || r.type === 'store' || r.type === 'service')) rate *= 1.5;
        if (this.lastKnown && (p.deck !== this.lastKnown.deck || Math.hypot(p.x - this.lastKnown.x, p.z - this.lastKnown.z) > 40)) rate *= 1.4;
        if (this._level >= 4) rate *= 0.6;
        this.setHeat(this.heatValue - rate * dt, 'decay');
      }
    } else if (this.description && this.time - (this.description.t || 0) > 120) this.description = null;
    this.alert = Math.max(0, this.alert - dt * 0.01);
    // jail
    if (this.jailed && this._jail && this.time > this._jail.release) this.release('served');
    // armed-in-public check & dead handling
    if (this._armedCD > 0) this._armedCD -= dt;
    if (p.state === 'dead' && this.handleDeath) { this._deadT += dt; if (this._deadT > 3 && !this._reviving) this._revive(); } else this._deadT = 0;
  }
  _ownCabin(r) { const p = this.game.player; return p.cabin && (r.cabin === p.cabin || r.no === p.cabin || String(r.name || '').includes(String(p.cabin))); }

  _slow(dt) {
    const g = this.game, p = g.player;
    this.seen = false; this.seenBy = null;
    if (p.state === 'free' || p.state === 'arrested') {
      this._updateSuspicion(dt);
      // cameras re-acquire a known suspect
      if (this._level > 0 && this.known) {
        const cams = this.camerasSeeing(p.deck, p.x, p.y + 1.4, p.z);
        if (cams.length) {
          this._camSeen = (this._camSeen || 0) + dt;
          if (this._camSeen > (this.cctvManned() ? 0.8 : 2.5)) {
            const first = !this._camLock;
            this._camLock = cams[0];
            this.sighted(null, cams[0]);
            if (first) { this._radio(`Control: suspect on camera — ${placeName(this.world, p.deck, p.x, p.z)}.`, null); this.ai?.dispatch(p.deck, p.x, p.z, { reason: 'camera', urgent: true, sighted: true }); }
          }
        } else { this._camSeen = 0; this._camLock = null; }
      } else { this._camSeen = 0; this._camLock = null; }
      // brandishing a weapon in public
      if (HELD_WEAPONS.has(p.held) && p.disguise !== 'security' && this._armedCD <= 0 && (p.room?.zone || 'public') === 'public') {
        const seers = (g.npcs?.query(p.deck, p.x, p.z, 14) || []).filter(n => n.state !== 'ko' && n.state !== 'dead' && n.perception.canSee(p.x, p.y + 1.2, p.z, p.deck));
        if (seers.length && (p.aiming || p.held === 'pistol' || seers.some(n => Math.hypot(n.x - p.x, n.z - p.z) < 6))) {
          this._armedCD = 25;
          this.report({ type: 'armed' });
          for (const n of seers.slice(0, 4)) if (npcClass(n) === 'pax' && n.state !== 'flee' && !(n._handsUpT > (g.combat?.time ?? 0))) g.npcs.system?.react?.(n, { type: 'scream', x: p.x, z: p.z, deck: p.deck });
        }
      }
    }
    // physical evidence: bodies
    g.combat?.scanBodies?.();
    if (this.npcFlags?.size && ((this.time * 2) | 0) % 4 === 0) this._applyNpcFlags();
    // queued checks
    if (this._junctionCheck && this.time > this._junctionCheck.at) { const j = this._junctionCheck; this._junctionCheck = null; this.ai?.dispatch(j.deck, j.x, j.z, { reason: 'junction', urgent: false, count: 1 }); }
    if (this._camCheck && this.time > this._camCheck.at) { const c = this._camCheck.cam; this._camCheck = null; this.ai?.dispatch(c.deck, c.x, c.z, { reason: 'camera_check', urgent: false, count: 1 }); }
  }

  // MEDICAL EMERGENCY: wake up in the Medical Centre (deck 3). Bill §250 (wallet first, then the cabin account down to
  // its limit, the rest covered by travel insurance), ≤ 1 h passes; if security was after you, they took your weapons.
  async _revive() {
    const g = this.game, p = g.player;
    this._deadT = 0;
    if (this._reviving) return;
    this._reviving = true;
    try {
      const wasWanted = this._level;
      this._quietUntil = this.time + 4;
      this.crime.cancelAll('downed');
      this.ai?.standDown(true);
      this.hud?.clearRadio?.();
      p.lockControls(true);
      await this._fade(true, 1200);
      const plan = this.world.plans[3]; const med = plan?.rooms.find(r => r && r.type === 'medical' && (r.zone || 'public') === 'public') || plan?.rooms.find(r => r && r.type === 'medical');
      const x = med ? (med.x0 + med.x1) / 2 : 14, z = med ? (med.z0 + med.z1) / 2 : 10;
      this._quietClear = true; this.clear(); this._quietClear = false;
      this.lockdown(false);
      this._camSeen = 0; this._camLock = null; this.lastKnown = null;
      const items = wasWanted >= 2 ? this._confiscate() : [];
      const BILL = 250;
      const bill = this._bill(BILL, 'Medical Centre');
      this._resetPlayerPose();
      p.revive(3, x, z);
      p.health = 70;
      const mins = 45; g.minutes += mins;
      const summary = [
        `Medical bill §${BILL}: §${bill.cash} from your wallet${bill.account ? `, §${bill.account} charged to your cabin account` : ''}${bill.waived ? `, §${bill.waived} covered by travel insurance` : ''}.`,
        items.length ? `Security confiscated: ${items.map(i => i.name || i.id).join(', ')} (Evidence Locker, deck 2).` : 'Your belongings are with you.',
        `You were out for ${mins} minutes. Security has stood down — for now.`,
      ];
      this.lastOutcome = { kind: 'medical', bill, billTotal: BILL, items: items.map(i => i.id), minutes: mins, summary };
      this.hud?.outcome?.('MEDICAL EMERGENCY', 'Medical Centre · Deck 3', summary, 'medical');
      await this._wait(2600);
      this.hud?.outcome?.(null);
      await this._fade(false, 900);
      this._resetPlayerPose(); p.lockControls(false);
      try { g.ui?.showTitle?.('MEDICAL EMERGENCY', summary[0], 3200); } catch {}
      this._toast(summary.join(' '), 'bad', 8000);
      this.bus.emit('security:revived', { bill: bill.cash + bill.account, billDetail: bill, items, summary });
    } finally { this._reviving = false; }
  }

  // ── helpers ───────────────────────────────────────────────────────────
  _radio(text, npc) {
    if (this._loading || (this._quietUntil > this.time && this._level === 0)) return;
    this.bus.emit('security:radio', { text, npc: npc || null });
    this.hud?.radio(text);
  }
  _pa(text, tone = 'security', chime = true) {
    if (this._loading) return;
    const cap = this.game.schedule?.CREW?.captain || 'Captain Rhiannon Holt';
    text = text.replace('This is the Captain speaking', `This is ${cap} speaking`).replace('This is the Captain.', `This is ${cap}.`);
    this.bus.emit('announce', { text, chime, tone, source: 'security', speaker: tone === 'captain' ? cap : 'Security announcement' });
    if (!this.game.ui) this.hud?.pa(text);
  }
  _toast(text, kind = 'info', ms = 4000) {
    const g = this.game;
    if (this._loading) return;
    if (g.ui?.toast) { try { g.ui.toast(text, { kind, ms }); return; } catch {} }
    this.bus.emit('ui:toast', { text, kind });
    this.hud?.toast(text, kind, ms);
  }
  async _fade(on, ms) {
    const g = this.game;
    if (g.ui?.fade) { try { await g.ui.fade(on, ms); return; } catch {} }
    await this.hud?.fade(on, ms);
  }

  _listen() {
    const b = this.bus;
    b.on('npc:wake', (e) => {
      const n = e?.npc; if (!n || !n._downBy) return;
      // the victim reports the assault once they come round
      const info = n._downBy; n._downBy = null;
      const cr = info.crime;
      if (!cr) return;
      if (info.stealth) { this.crime.queue({ crime: { ...cr, spec: crimeSpec('assault'), type: 'assault', label: 'Assault' }, kind: npcClass(n) === 'guard' ? 'guard' : 'crew', npc: n, sighted: false, delay: 4 }); n.alert = 1; }
      else this.crime.queue({ crime: cr, kind: npcClass(n) === 'guard' ? 'guard' : npcClass(n) === 'crew' ? 'crew' : 'pax', npc: n, sighted: true, delay: npcClass(n) === 'guard' ? 2 : 6 });
      try { g().npcs.system._bark(n, 'scream', true); } catch {}
    });
    const g = () => this.game;
    b.on('player:appearance', () => { this.suspicion = Math.max(0, this.suspicion - 0.2); });
  }

  // ── CCTV console ──────────────────────────────────────────────────────
  _makeCCTV() {
    const sec = this, g = this.game;
    const st = { active: false, idx: 0, deckFilter: null, saved: null };
    const api = {
      get active() { return st.active; }, get index() { return st.idx; }, get camera() { return st.active ? sec.cameras[st.idx] : null; },
      open() {
        if (st.active) return;
        st.active = true;
        const p = g.player;
        p.lockControls(true);
        st.saved = { rig: g.cameraRig?.enabled, fov: g.camera.fov, deck: p.deck };
        const nearest = sec.cameras.findIndex(c => c.deck === p.deck);
        st.idx = nearest >= 0 ? nearest : 0;
        try { g.input?.setContext?.('ui'); } catch {}
        // the NPC sim + streaming follow the watched camera (people appear on the feeds)
        st.saved.debugCam = g.debugCam; st.saved.focus = g.focus; g.debugCam = true; g.focus = g.camera.position;
        try { g.ui?.hideHud?.('cctv', true); g.playerHud?.setVisible(false); } catch {}
        sec.hud?.cctv(true, api);
        api.view(st.idx);
        g.bus.emit('security:cctvConsole', { on: true });
      },
      close() {
        if (!st.active) return;
        st.active = false;
        const p = g.player;
        if (g.cameraRig) { g.cameraRig.enabled = st.saved?.rig ?? true; g.cameraRig.snap(); }
        g.camera.fov = st.saved?.fov || 62; g.camera.updateProjectionMatrix();
        g.world.setActiveDeck(p.deck);
        g.debugCam = !!st.saved?.debugCam; g.focus = st.saved?.focus || null;
        try { g.ui?.hideHud?.('cctv', false); g.playerHud?.setVisible(true); } catch {}
        p.lockControls(false);
        try { g.input?.setContext?.('play'); } catch {}
        sec.hud?.cctv(false, api);
        g.bus.emit('security:cctvConsole', { on: false });
      },
      view(i) {
        const n = sec.cameras.length; if (!n) return null;
        st.idx = ((i % n) + n) % n;
        const c = sec.cameras[st.idx];
        if (g.cameraRig) g.cameraRig.enabled = false;
        g.world.setActiveDeck(c.deck, 1);
        api._place(c);
        sec.hud?.cctvInfo(api);
        return c;
      },
      _place(c) {
        const cam = g.camera;
        // pull the view back from the lens toward the room so we look *into* it
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        cam.position.set(c.x + fx * 0.25, c.y - 0.1, c.z + fz * 0.25);
        cam.fov = 78; cam.updateProjectionMatrix();
        // domes look toward the middle of their room; both kinds pan slowly
        if (c.baseYaw == null) { const r = sec.world.plans[c.deck]?.rooms[c.room]; c.baseYaw = c.dome && r ? Math.atan2(r.cx - c.x, r.cz - c.z) : c.yaw; }
        const yaw = c.baseYaw + Math.sin(sec.time * 0.25) * (c.dome ? 0.8 : 0.5);
        cam.up.set(0, 1, 0);
        cam.lookAt(cam.position.x + Math.sin(yaw) * 4, cam.position.y - 1.25, cam.position.z + Math.cos(yaw) * 4);
      },
      next() { return api.view(st.idx + 1); }, prev() { return api.view(st.idx - 1); },
      nextDeck(dir = 1) { const cur = sec.cameras[st.idx]?.deck ?? 1; for (let k = 1; k <= 17; k++) { const d = ((cur - 1 + dir * k) % 17 + 17) % 17 + 1; const i = sec.cameras.findIndex(c => c.deck === d); if (i >= 0) return api.view(i); } return null; },
      loop(deck, on) { deck = deck ?? sec.cameras[st.idx]?.deck; if (on == null) on = !sec.loops.has(deck); sec.loopFeed(deck, on); sec.hud?.cctvInfo(api); return on; },
      wipe() { const k = sec.wipeRecordings(); sec.hud?.cctvInfo(api); return k; },
      update() { if (!st.active) return; const c = sec.cameras[st.idx]; if (c) api._place(c); const I = g.input; if (!I) return;
        if (I.pressed('ArrowRight') || I.pressed('KeyD')) api.next(); if (I.pressed('ArrowLeft') || I.pressed('KeyA')) api.prev();
        if (I.pressed('ArrowUp') || I.pressed('KeyW')) api.nextDeck(1); if (I.pressed('ArrowDown') || I.pressed('KeyS')) api.nextDeck(-1);
        if (I.pressed('KeyL')) api.loop(); if (I.pressed('KeyX')) api.wipe();
        if (I.pressed('Escape') || I.pressed('KeyE') || I.pressed('Backspace')) api.close(); },
    };
    return api;
  }

  // ── save / load (game.save key 'security') ───────────────────────────
  // heat (restored as "searching": nobody has eyes on you, guards are not re-dispatched), description, record,
  // evidence locker, jail (time left), CCTV/power state (broken cameras, disabled decks, looped feeds, junction
  // outage), lockdown follows from the heat level. Mission-relevant NPC fates (cast / mission NPCs killed or KO'd)
  // are kept in npcFlags {key: {state:'dead'|'ko', until}} and re-applied when that NPC is around again.
  _snapshot() {
    const g = this.game;
    const lite = (m) => { if (!m || typeof m !== 'object') return m ?? null; const o = {}; for (const [k, v] of Object.entries(m)) if (v == null || typeof v !== 'object' || Array.isArray(v)) o[k] = v; return o; };
    return {
      v: 1,
      heat: +this.heatValue.toFixed(3),
      description: this.description ? { key: this.description.key, text: this.description.text, role: this.description.role ?? null, source: this.description.source || null } : null,
      lastKnown: this.lastKnown ? { deck: this.lastKnown.deck, x: this.lastKnown.x, z: this.lastKnown.z } : null,
      record: { ...this.record },
      evidenceLocker: this.evidenceLocker.map(it => ({ id: it.id, qty: it.qty ?? 1, name: it.name || it.id, meta: lite(it.meta) })),
      jail: this.jailed && this._jail ? { left: Math.max(5, this._jail.release - this.time), door: this._jail.door ?? null } : null,
      cams: { broken: this.cameras.filter(c => c.broken).map(c => c.id), allOff: this.allCamsOff, decks: [...this.disabledDecks], loops: [...this.loops], downLeft: this.cctvOn() ? 0 : this.cctvDownUntil - g.minutes },
      alert: +this.alert.toFixed(2),
      warnedAgo: this._warnedT != null ? Math.min(999, this.time - this._warnedT) : null,
      npcFlags: this._npcFlagsSnapshot(),
    };
  }
  _restore(d) {
    if (!d) return;
    const g = this.game, p = g.player;
    this._loading = true;
    try {
      // wipe the live situation first
      if (this.jailed) { const j = this._jail; this.jailed = false; this._jail = null; if (j?.door != null) try { g.doors?.lock(2, j.door, false); } catch {} }
      this.crime.cancelAll('loaded');
      this.ai?.standDown(true);
      this.hud?.clearRadio?.();
      this.setHeat(0, 'loaded'); this.lockdown(false);
      this.description = null; this.suspicion = 0; this.seen = false; this._camSeen = 0; this._camLock = null; this.watcher = null;
      // record & locker
      if (d.record) this.record = { strikes: d.record.strikes | 0, fines: d.record.fines || 0, arrests: d.record.arrests | 0 };
      this.evidenceLocker = Array.isArray(d.evidenceLocker) ? d.evidenceLocker.map(it => ({ id: it.id, qty: it.qty ?? 1, name: it.name || it.id, meta: it.meta || null })) : [];
      // CCTV / power
      for (const c of this.cameras) { if (c.broken) { c.broken = false; try { g.furniture?.setItemHidden(c.deck, c.item, false); } catch {} } c.obscuredUntil = -1; }
      const broken = new Set(d.cams?.broken || []);
      for (const c of this.cameras) if (broken.has(c.id)) { c.broken = true; try { g.furniture?.setItemHidden(c.deck, c.item, true); } catch {} }
      this.allCamsOff = !!d.cams?.allOff; this.disabledDecks = new Set(d.cams?.decks || []); this.loops = new Set(d.cams?.loops || []);
      this.cctvDownUntil = d.cams?.downLeft > 0 ? g.minutes + d.cams.downLeft : -1;
      this.alert = d.alert || 0;
      this._warnedT = d.warnedAgo != null ? this.time - d.warnedAgo : undefined;
      this._loadNpcFlags(d.npcFlags);
      // jail
      if (d.jail) {
        const cell = this._cellSpot();
        const door = d.jail.door ?? cell.door;
        this.jailed = true; this._jail = { t: this.time, release: this.time + (d.jail.left || 30), door };
        if (door != null) try { g.doors ? g.doors.lock(2, door, 'sealed') : (this.world.door(2, door).lockedState = 'sealed'); } catch {}
        if (p && (p.deck !== 2 || this.world.roomId(2, p.x, p.z) !== cell.room)) p.teleport(2, cell.x, cell.z, cell.yaw, { strict: true });
      }
      // heat → "searching": description circulates, last known = where you were, nobody sees you right now
      if (d.heat > 0 && !d.jail) {
        this.description = d.description ? { ...d.description, t: this.time } : null;
        this.lastKnown = d.lastKnown ? { ...d.lastKnown, t: this.time } : (p ? { deck: p.deck, x: p.x, z: p.z, t: this.time } : null);
        this.setHeat(d.heat, 'loaded');
        this.seen = false; this.lostT = 3.5;   // HUD: "· searching"
        this.ai?.standDown(true);
        if (this.ai) this.ai._spawnT = 25;      // no instant reinforcement wave on load — patrols are already looking
      } else this.lastKnown = null;
      this._resetPlayerPose();
    } finally { this._loading = false; }
  }
  _registerSave() {
    const g = this.game;
    this.npcFlags = new Map();
    const keyOf = (n) => n && (n.castKey || (n.kind === 'mission' && n.tag) || null);
    g.bus.on('npc:dead', (e) => { const k = keyOf(e?.npc); if (k) this.npcFlags.set(k, { state: 'dead' }); });
    g.bus.on('npc:ko', (e) => { const n = e?.npc, k = keyOf(n); if (k && !(this.npcFlags.get(k)?.state === 'dead')) this.npcFlags.set(k, { state: 'ko', until: g.minutes + Math.max(1, (n.timer || 60) / 1.25) }); });
    g.bus.on('npc:wake', (e) => { const k = keyOf(e?.npc); if (k && this.npcFlags.get(k)?.state === 'ko') this.npcFlags.delete(k); });
    const reg = () => g.save?.register?.('security', { save: () => this._snapshot(), load: (d) => this._restore(d) });
    if (g.save) reg(); else g.bus.on('save:ready', reg);
  }
  _npcFlagsSnapshot() {
    const o = {}; const now = this.game.minutes;
    for (const [k, f] of this.npcFlags || []) if (f.state === 'dead' || (f.until ?? 0) > now) o[k] = { state: f.state, left: f.state === 'ko' ? f.until - now : null };
    return o;
  }
  _loadNpcFlags(d) {
    this.npcFlags = new Map(); this._flagsApplied = new Set();
    if (d) for (const [k, f] of Object.entries(d)) this.npcFlags.set(k, { state: f.state, until: f.state === 'ko' ? this.game.minutes + (f.left || 1) : null });
  }
  // re-apply saved fates to cast / mission NPCs that (re)spawn after a load
  _applyNpcFlags() {
    const g = this.game; if (!this.npcFlags?.size || !g.npcs) return;
    const cast = g.missions?.cast;
    for (const [k, f] of this.npcFlags) {
      if (f.state === 'ko' && !(f.until > g.minutes)) { this.npcFlags.delete(k); continue; }
      const n = cast?.get?.(k) || g.npcs.list.find(m => m.kind === 'mission' && m.tag === k && !m.gone);
      if (!n || n.state === f.state || n._flagApplied === f.state) continue;
      n._flagApplied = f.state;
      try {
        if (f.state === 'dead') g.npcs.kill(n, { source: null, restored: true });
        else g.npcs.knockOut(n, Math.max(5, (f.until - g.minutes) * 1.25), { source: null, restored: true });
        n._found = true;
      } catch {}
    }
  }

  // ── interactions ──────────────────────────────────────────────────────
  _providers() {
    const g = this.game, sec = this;
    const plan2 = this.world.plans[2];
    const consoleItem = plan2?.items.find(i => i.cctvConsole);
    const junction = this._junction = plan2?.items.find(i => i.t === 'junction' && i.power === 'cctv');
    const evid = plan2?.rooms.find(r => r && r.evidence);
    g.interact?.addProvider((ctx) => {
      const out = []; const p = ctx.player;
      if (p.state !== 'free') return out;
      if (ctx.deck === 2 && consoleItem) {
        const d = Math.hypot(consoleItem.x - ctx.x, consoleItem.z - ctx.z);
        if (d < 2.2 && p.room?.cctv) out.push({ id: 'sec:cctv', label: 'Use CCTV console', key: 'E', x: consoleItem.x, y: deckY(2) + 1.1, z: consoleItem.z, dist: d, priority: 4, enabled: true, run: () => sec.cctv.open() });
      }
      if (ctx.deck === 2 && junction) {
        const d = Math.hypot(junction.x - ctx.x, junction.z - ctx.z);
        if (d < 1.8) {
          const tool = (g.inventory || p.inventory)?.has?.('screwdriver') || p.disguise === 'crew_engineer' || p.disguise === 'crew_deckhand';
          const down = !sec.cctvOn();
          out.push({ id: 'sec:junction', label: down ? 'CCTV junction (feeds offline)' : 'Sabotage CCTV junction', key: 'E', hold: 3, x: junction.x, y: deckY(2) + 1.2, z: junction.z, dist: d, priority: 3,
            enabled: !!tool && !down, reason: down ? 'Already disabled' : 'Needs a screwdriver (or an engineer\'s uniform)',
            run: () => { sec.cctvDown(10); sec.report({ type: 'vandalism', quiet: true, loud: 0 }); g.bus.emit('sfx', { name: 'lockpick', x: junction.x, y: deckY(2) + 1.2, z: junction.z, deck: 2 }); sec._toast('CCTV feeds down for 10 minutes — someone will come to check.', 'good'); } });
        }
      }
      if (ctx.deck === 2 && evid && p.room?.id === evid.id && sec.evidenceLocker.length) {
        out.push({ id: 'sec:evidence', label: `Recover confiscated items (${sec.evidenceLocker.length})`, key: 'E', hold: 1.2, x: (evid.x0 + evid.x1) / 2, y: deckY(2) + 1, z: (evid.z0 + evid.z1) / 2, dist: 0.5, priority: 3, enabled: true,
          run: () => { const got = sec.recoverEvidence(); sec.report({ type: 'theft' }); sec._toast('Recovered: ' + got.join(', '), 'good'); } });
      }
      if (sec.jailed && sec._jail?.door != null && ctx.deck === 2) {
        const dr = plan2.doors[sec._jail.door];
        const d = dr ? Math.hypot(dr.x - ctx.x, dr.z - ctx.z) : 99;
        if (d < 2.4) {
          const inv = g.inventory || p.inventory;
          const pick = inv?.has?.('lockpick');
          out.push({ id: 'sec:cellpick', label: 'Pick the cell lock', key: 'E', hold: 4, x: dr.x, y: deckY(2) + 1.1, z: dr.z, dist: d, priority: 5, enabled: !!pick, reason: 'You need a lockpick', run: () => { sec.jailbreak('pick'); sec._toast('The lock gives. Move — quietly.', 'good'); } });
          const cash = g.economy ? g.economy.cash : p.money;
          const guard = g.npcs?.nearest(2, dr.x, dr.z, 12, (n) => n.role === 'security' && n.state !== 'ko' && n.state !== 'dead');
          out.push({ id: 'sec:cellbribe', label: 'Bribe the guard (§300)', key: 'F', x: dr.x, y: deckY(2) + 1.4, z: dr.z, dist: d + 0.1, priority: 4, enabled: !!guard && cash >= 300, reason: guard ? 'Not enough cash' : 'No guard within earshot',
            run: () => { sec._takeMoney(300); sec.release('bribe'); sec._toast('"I didn\'t see anything." The door clicks open.', 'good'); } });
        }
      }
      return out;
    }, 'security');
  }
}

export async function installSecurity(game) {
  const sec = new Security(game);
  game.security = sec;
  try { const { SecurityAI } = await import('./securityAI.js'); sec.ai = new SecurityAI(game, sec); } catch (e) { console.error('[security] AI failed', e); }
  try { const { SecurityHud } = await import('../ui/securityHud.js'); sec.hud = new SecurityHud(game, sec); } catch (e) { console.error('[security] HUD failed', e); }
  sec._providers();
  sec._registerSave();
  game.addSystem({ name: 'security', order: 62, update: (dt) => sec.update(dt) });
  game.addSystem({ name: 'securityCCTV', order: 95.5, runWhilePaused: true, lateUpdate: () => sec.cctv.update() });
  game.addSystem({ name: 'securityHud', order: 97, runWhilePaused: true, lateUpdate: (dt, rdt) => sec.hud?.update(rdt ?? dt) });
  return sec;
}
export { Security, allowedRoles };
