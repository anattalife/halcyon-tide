// HALCYON TIDE — guard AI. Takes over security NPCs (role 'security' — ambient patrols, posted guards and spawned
// reinforcements) when something happens, and hands them back to the NPC system afterwards.
//
// Modes (npc.sec.mode):
//   patrol      not engaged — the NPC system drives them; we only run recognition checks ("?" fills)
//   investigate walk to an incident spot, look around, return
//   respond     run to a dispatch point (last known position / predicted cut-off), then search
//   confront    heat 1 & description matches: walk up, ID check dialogue (comply / bluff / bribe / walk away)
//   chase       heat ≥ 2 & eyes on: run at the player, radio position. Escalation ladder (fair play):
//                 heat ≤ 3  baton only (a suspect who stands still unarmed is cuffed, a battered one goes down → cuffed)
//                 heat 4    taser first (2–7 m), baton up close; pistol ONLY if the player carries a pistol AND has fired
//                           in the last 30 s; guard hits never kill at heat ≤ 4 — the suspect goes down and is cuffed
//                 heat 5    pistols authorised (taser still preferred while charged)
//               Whatever the heat: a suspect who surrenders, is stunned or down is closed in on and cuffed, never shot.
//   cuff        player stunned / surrendered / beaten down within reach: 1.6 s cuffing → security.arrest()
//   search      sweep points around the last known position, radius grows; checks rooms (not locked cabins)
//   return      walk back; spawned reinforcements leave via the nearest crew stair core
// Telegraphing: "?" / "!" icons (HUD projects ai.indicators()), radio barks (bus 'bark' + 'security:radio' + sfx
// 'radio_chatter'), 0.45 s melee wind-up (swing_baton), 0.6 s aim before a pistol shot.
import { deckY, CREW_CORES } from '../core/config.js';
import { npcClass, placeName, sectionOf } from './crime.js';

const conscious = (n) => n && !n.gone && n.state !== 'ko' && n.state !== 'dead' && n.state !== 'hidden';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const WANT = [0, 2, 4, 6, 7, 9];        // engaged guards per heat level
const RADIO = {
  spot: ['Control, eyes on the suspect — {place}.', 'Control, I have the suspect, {place}. Moving in.', 'Got them! {place}.'],
  lost: ['Lost visual. Last seen {place}.', 'Control, suspect is out of sight — {place}.', 'I lost them. Sweeping the area.'],
  stop: ['Security! Stop right there!', 'Ship\'s security — stay where you are!', 'Hands where I can see them!'],
  confront: ['Excuse me — ship\'s security. A word, please.', 'Hold on a moment. Can I see your cruise card?'],
  search: ['Checking this section.', 'Nothing here. Moving on.', 'Control, area clear so far.'],
  standDown: ['Copy, standing down.', 'Roger that, back to patrol.'],
  armed: ['Suspect is armed! Taser out!', 'Weapon! Weapon!', 'Shots fired, shots fired!'],
  cuff: ['Don\'t move. You\'re coming with me.', 'Hands behind your back.'],
  respond: ['Copy, on my way.', 'Responding.', 'Copy, en route to {place}.'],
  hit: ['Officer down! Need backup!', 'Argh — suspect is fighting!'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class SecurityAI {
  constructor(game, sec) {
    this.game = game; this.sec = sec; this.bus = game.bus;
    this.engaged = new Set();
    this.time = 0; this._t = 0; this._spawnT = 0; this._barkT = 0;
    this.spawned = new Set();
    this.searchPts = [];
    this.stats = { spawned: 0, cuffs: 0, shots: 0, swings: 0, tasers: 0 };
    this.confronting = null; this._dlg = false;
    this.enabled = true;
  }
  get guards() { return (this.game.npcs?.list || []).filter(n => n.role === 'security' || n.job === 'guard' || n.job === 'patrol'); }
  st(n) {
    if (!n.sec) n.sec = { mode: 'patrol', aware: 0, t: 0, goalT: -9, gx: 0, gz: 0, gd: 0, atkCD: 0, atk: null, seenT: -99, lostT: 0, armed: false, icon: null, wasPersistent: n.persistent, barked: {} };
    return n.sec;
  }

  // ── events from security / crime / combat ─────────────────────────────
  witness(n, crime, sighted) {
    if (!conscious(n)) return;
    const s = this.st(n);
    if (sighted) { s.aware = 1; s.seenT = this.time; this._engage(n, this.sec.heat >= 2 || crime.spec.min >= 2 ? 'chase' : 'confront'); }
    else this._engage(n, 'investigate', { deck: crime.deck, x: crime.x, z: crime.z });
  }
  attacked(n, o) {
    if (!conscious(n)) return;
    const s = this.st(n); s.aware = 1; s.seenT = this.time;
    this._bark(n, RADIO.hit, true);
    if (this.confronting === n) this._endConfront(null);
    this._engage(n, 'chase');
  }
  blinded(n) { const s = this.st(n); s.blindUntil = this.time + 4.5; s.atk = null; }
  onLevel(prev, lvl) {
    if (lvl >= 4 && prev < 4) for (const n of this.engaged) { const s = this.st(n); s.taser = true; if (n.held !== 'pistol') n.held = 'taser'; }
    if (lvl >= 5) for (const n of this.engaged) this.st(n).armed = true;
  }
  // force: also releases guards mid-cuff / returning and forgets pending reinforcements (arrest, revive, load)
  standDown(force = false) {
    for (const n of [...this.engaged]) { const s = this.st(n); if (force || s.mode !== 'return') { s.atk = null; s.barked = {}; s.stillT = 0; this._release(n); } }
    if (force) { this._needSpawn = null; this._spawnT = Math.max(this._spawnT, 6); }
    if (this.confronting) this._endConfront(null);
  }

  // security asks for units at a location
  dispatch(deck, x, z, o = {}) {
    const lvl = this.sec.heat;
    const want = o.count ?? (o.sighted ? Math.max(1, WANT[lvl] || 1) : 1);
    const cand = this.guards.filter(n => conscious(n) && !(this.st(n).mode === 'chase' || this.st(n).mode === 'cuff' || this.st(n).mode === 'confront'))
      .map(n => ({ n, d: Math.hypot(n.x - x, n.z - z) + Math.abs(n.deck - deck) * 35 }))
      .filter(c => c.d < 160).sort((a, b) => a.d - b.d);
    let k = [...this.engaged].filter(n => this.st(n).mode !== 'return' && this.st(n).mode !== 'investigate').length;
    const p = this.game.player;
    for (const c of cand) {
      if (k >= want) break;
      const n = c.n, s = this.st(n);
      if (o.sighted || o.urgent) {
        // cut off: aim a little ahead of the suspect's motion
        const lead = Math.min(6, Math.hypot(p.vx, p.vz) * 2);
        const sp = Math.hypot(p.vx, p.vz) || 1;
        this._engage(n, 'respond', { deck, x: x + (p.vx / sp) * lead * (k % 2 ? 1 : 0.4), z: z + (p.vz / sp) * lead * (k % 2 ? 1 : 0.4) });
        if (Math.random() < 0.5) this._bark(n, RADIO.respond, false, placeName(this.game.world, deck, x, z));
      } else if (s.mode === 'patrol') this._engage(n, 'investigate', { deck, x, z });
      k++;
    }
    if (o.sighted && k < want && lvl >= 1) this._needSpawn = { deck, x, z, n: want - k };
  }

  // ── engagement ────────────────────────────────────────────────────────
  _engage(n, mode, tgt = null) {
    const s = this.st(n);
    if (!this.engaged.has(n)) { s.wasPersistent = n.persistent; n.persistent = true; this.engaged.add(n); }
    if (s.mode === 'cuff') return;
    s.mode = mode; s.t = 0; s.goalT = -9; s.atk = null;
    if (tgt) { s.tx = tgt.x; s.tz = tgt.z; s.td = tgt.deck; }
    if (mode === 'chase' || mode === 'respond') { if (n.held === 'none' || n.held === 'radio') n.held = this.sec.heat >= 4 ? 'taser' : 'baton'; }
    if (mode === 'investigate' || mode === 'respond') this._go(n, s.td, s.tx, s.tz, mode === 'respond');
  }
  _release(n) {
    const s = this.st(n), g = this.game, sys = g.npcs.system;
    s.mode = 'return'; s.t = 0; s.aware = 0; s.atk = null; n.held = 'none'; s.icon = null;
    if (n.tag === 'secRRT') {
      // leave via the nearest crew stair core
      const lob = g.npcs.nav.lobbyNear(n.deck, n.x, 0xff);
      if (lob) this._go(n, n.deck, lob.x, 0, false); else this._finish(n);
      return;
    }
    this._finish(n);
  }
  _finish(n) {
    const s = this.st(n), g = this.game, sys = g.npcs.system;
    this.engaged.delete(n);
    s.mode = 'patrol'; s.aware = 0; s.icon = null;
    if (n.tag === 'secRRT') { if (!sys.seen(n.deck, n.x, n.y + 1, n.z) || Math.hypot(n.x - g.player.x, n.z - g.player.z) > 30) { g.npcs.remove(n); this.spawned.delete(n); } else { s.mode = 'return'; this.engaged.add(n); s.t = 0; } return; }
    n.persistent = !!s.wasPersistent;
    try {
      if (n.kind === 'staff' && n.post) { n.post.taken = null; g.npcs.setGoal(n, { type: 'use', poi: n.post }); }
      else if (n.kind === 'roamer') { n.goal = null; sys.roamNext(n); }
      else g.npcs.setGoal(n, { type: 'idle' });
    } catch {}
  }
  _go(n, deck, x, z, run) {
    const s = this.st(n);
    s.goalT = this.time; s.gx = x; s.gz = z; s.gd = deck ?? n.deck;
    this.game.npcs.setGoal(n, { type: 'move', deck: s.gd, x, z, run: !!run });
  }
  _stop(n, face) {
    const sys = this.game.npcs.system;
    if (n.state !== 'idle' || n.goal) { n.goal = null; n.path = null; n.state = 'idle'; n.timer = Infinity; n.vx = n.vz = 0; n.speed = 0; n.run = false; }
    if (face) n.yaw = Math.atan2(face.x - n.x, face.z - n.z);
    if (sys && (n.anim === 'run' || n.anim === 'walk')) sys.setAnim(n, 'idle', n.held, 0);
  }
  _anim(n, a, held) { this.game.npcs.system?.setAnim(n, a, held ?? n.held, 0); }

  // ── barks ─────────────────────────────────────────────────────────────
  _bark(n, lines, force = false, place = null) {
    if (!n) return;
    const sq = this.sec;
    if ((sq.jailed && sq.heat === 0) || sq._arresting || sq._reviving || sq._loading || this.game.player.state === 'dead') return;
    const s = this.st(n);
    if (!force && this.time - (s.barkT || -99) < 6) return;
    if (!force && this.time - this._barkT < 1.6) return;
    s.barkT = this.time; this._barkT = this.time;
    const p = this.game.player;
    const text = pick(lines).replace('{place}', place || placeName(this.game.world, p.deck, p.x, p.z));
    this.bus.emit('bark', { text, x: n.x, y: n.y, z: n.z, deck: n.deck, voice: n.identity?.voice || { sex: n.appearance?.sex || 'm', pitch: 0.95, rate: 1.05 }, npc: n, ctx: 'security_radio' });
    this.bus.emit('sfx', { name: 'radio_chatter', x: n.x, y: n.y + 1.5, z: n.z, deck: n.deck, vol: 0.55 });
    this.bus.emit('security:radio', { text: `${n.name || 'Guard'}: ${text}`, npc: n });
    // the UI shows barks as subtitles; only mirror into the radio feed when the guard is out of earshot
    const pl = this.game.player;
    if (!this.game.ui || n.deck !== pl.deck || Math.hypot(n.x - pl.x, n.z - pl.z) > 14) this.sec.hud?.radio(`${(n.name || 'Guard').split(' ')[0]}: ${text}`);
  }

  // ── perception ────────────────────────────────────────────────────────
  _sees(n) {
    const p = this.game.player;
    if (p.deck !== n.deck || p.state === 'elevator') return false;
    const s = this.st(n);
    if (s.blindUntil > this.time) return false;
    const d = Math.hypot(p.x - n.x, p.z - n.z);
    if (d < 1.2) return true;
    // engaged guards look around (wider than the 110° ambient cone)
    if (s.mode !== 'patrol' && d < 22) return this.game.world.lineClear(n.deck, n.x, n.z, p.x, p.z);
    return n.perception.canSee(p.x, p.y + 1.4, p.z, p.deck);
  }

  // ── main update ───────────────────────────────────────────────────────
  update(dt) {
    if (!this.enabled) return;
    this.time += dt;
    this._t += dt;
    for (const n of this.engaged) this._fast(n, dt);
    if (this._t < 0.1) return;
    const tdt = this._t; this._t = 0;
    const g = this.game, p = g.player, sec = this.sec;
    // recognition by patrolling guards
    if (sec.heat > 0 && p.state === 'free' && !sec._arresting) {
      for (const n of g.npcs.query(p.deck, p.x, p.z, 26)) {
        if (n.role !== 'security' || !conscious(n)) continue;
        const s = this.st(n);
        if (s.mode !== 'patrol' && s.mode !== 'investigate' && s.mode !== 'return' && s.mode !== 'search' && s.mode !== 'respond') continue;
        if (!sec.known) { s.aware = Math.max(0, s.aware - tdt * 0.5); continue; }
        if (!this._sees(n)) { s.aware = Math.max(0, s.aware - tdt * 0.25); continue; }
        const d = Math.hypot(p.x - n.x, p.z - n.z);
        const crowd = g.npcs.countNear(p.x, p.y, p.z, 3);
        let rate = (1.5 - d / 18) * (sec.heat >= 2 ? 1.6 : 1) * (p.crouch ? 0.7 : 1) * (crowd > 4 ? 0.65 : 1) * (s.mode === 'patrol' ? 1 : 1.5);
        if (p.sprint) rate *= 1.4;
        s.aware = clamp(s.aware + Math.max(0.12, rate) * tdt, 0, 1);
        if (s.aware >= 1) { s.seenT = this.time; this._engage(n, sec.heat >= 2 ? 'chase' : 'confront'); }
      }
    } else for (const n of this.engaged) if (this.st(n).mode === 'patrol') this.st(n).aware = 0;
    // engaged
    for (const n of [...this.engaged]) {
      if (n.gone) { this.engaged.delete(n); continue; }
      this._think(n, tdt);
    }
    // reinforcements
    this._spawnT -= tdt;
    if (this._needSpawn && this._spawnT <= 0 && sec.heat >= 1) {
      const ns = this._needSpawn;
      const active = [...this.engaged].filter(n => conscious(n) && this.st(n).mode !== 'return').length;
      if (active < WANT[sec.heat] && this._spawnOne(ns)) { ns.n--; this._spawnT = sec.heat >= 3 ? 2.5 : 4.5; }
      else this._spawnT = 2;
      if (ns.n <= 0 || active >= WANT[sec.heat]) this._needSpawn = null;
    }
    if (sec.heat >= 2 && !this._needSpawn && this._spawnT <= 0) {
      const active = [...this.engaged].filter(n => conscious(n) && this.st(n).mode !== 'return').length;
      if (active < WANT[sec.heat]) { const lk = sec.lastKnown || p; this._needSpawn = { deck: lk.deck, x: lk.x, z: lk.z, n: WANT[sec.heat] - active }; }
    }
  }

  _spawnOne(ns) {
    const g = this.game, p = g.player, sys = g.npcs.system, nav = g.npcs.nav;
    if (!g.chars || g.chars.free.length < 6) return false;
    const deck = ns.deck;
    const dn = nav.deck(deck);
    let spot = null;
    if (dn) {
      const lobs = dn.lobbies.filter(l => l.crew).map(l => ({ l, d: Math.abs(l.x - ns.x) }))
        .filter(o => Math.abs(o.l.x - p.x) > 12 || p.deck !== deck).sort((a, b) => a.d - b.d);
      for (const { l } of lobs) {
        const q = nav.randomPointInRoom(deck, l.room, Math.random, 0xff) || nav.nearestPoint(deck, l.x, 0, 0xff, 6);
        if (q && !sys.seen(deck, q.x, deckY(deck) + 1, q.z)) { spot = { deck, ...q }; break; }
      }
    }
    if (!spot) {
      const off = g.world.plans[2]?.rooms.find(r => r && r.secOffice);
      const q = off && nav.randomPointInRoom(2, off.id, Math.random, 0xff);
      if (q) spot = { deck: 2, ...q };
    }
    if (!spot) return false;
    const n = g.npcs.spawnAt('security', spot.deck, spot.x, spot.z, { job: 'patrol', access: ['crew', 'security', 'officer', 'casino', 'engineer'], tag: 'secRRT' });
    if (!n) return false;
    this.spawned.add(n); this.stats.spawned++;
    const s = this.st(n); s.wasPersistent = false;
    if (this.sec.heat >= 4) { s.taser = true; n.held = 'taser'; }
    if (this.sec.heat >= 5 || (this.sec.heat >= 4 && this._playerArmed())) s.armed = true;
    this._engage(n, 'respond', { deck: ns.deck, x: ns.x, z: ns.z });
    return true;
  }
  // armed AND dangerous: carries a pistol and fired it in the last 30 s (a pistol in the pocket alone is not enough)
  _playerArmed() { const c = this.game.combat, p = this.game.player; if (!c) return false; const hasGun = p.held === 'pistol' || c.owned?.('pistol'); return !!hasGun && c.time - (c._lastShotT ?? -99) < 30; }

  _think(n, dt) {
    const s = this.st(n), g = this.game, p = g.player, sec = this.sec;
    s.t += dt;
    if (!conscious(n)) { if (s.mode === 'cuff') { s.mode = 'chase'; p.lockControls(false); if (p.state === 'arrested' && !sec._arresting) p.state = 'free'; } s.icon = null; if (n.state === 'dead' || n.gone) { this.engaged.delete(n); } return; }
    if (n.secStagger > 0 || s.blindUntil > this.time) { s.icon = 'blind'; return; }
    const sees = this._sees(n);
    const d = Math.hypot(p.x - n.x, p.z - n.z) + (p.deck !== n.deck ? 50 : 0);
    if (sees && sec.heat > 0 && (sec.known || s.mode === 'chase' || s.mode === 'cuff')) { s.seenT = this.time; sec.sighted(n); }
    const sinceSeen = this.time - s.seenT;
    switch (s.mode) {
      case 'investigate': {
        s.icon = '?';
        if (this._arrived(n, 1.6)) {
          if (!s.looked) { s.looked = this.time; this._stop(n); this._anim(n, 'radio'); }
          if (this.time - s.looked > 6) { s.looked = 0; this._release(n); }
        } else if (s.t > 50) this._release(n);
        if (sees && sec.heat > 0 && sec.known) { s.aware = Math.min(1, s.aware + dt * 0.8); if (s.aware >= 1) this._engage(n, sec.heat >= 2 ? 'chase' : 'confront'); }
        break;
      }
      case 'respond': {
        s.icon = sec.heat >= 2 ? '!' : '?';
        if (sees && (sec.known || sinceSeen < 0.2) && sec.heat >= 1) { this._engage(n, sec.heat >= 2 ? 'chase' : 'confront'); break; }
        // follow updates of the last known position
        const lk = sec.lastKnown;
        if (lk && (lk.deck !== s.gd || Math.hypot(lk.x - s.gx, lk.z - s.gz) > 6) && this.time - s.goalT > 2) this._go(n, lk.deck, lk.x, lk.z, true);
        if (this._arrived(n, 2.2) || s.t > 45) this._startSearch(n);
        if (sec.heat === 0) this._release(n);
        break;
      }
      case 'confront': {
        s.icon = '?';
        if (sec.heat >= 2) { this._engage(n, 'chase'); break; }
        if (sec.heat === 0) { this._release(n); break; }
        if (this.confronting && this.confronting !== n) { if (d > 6) this._go(n, p.deck, p.x, p.z, false); else this._stop(n, p); break; }
        if (!sees && sinceSeen > 5) { this._startSearch(n); break; }
        if (g.combat?.surrendering && d < 2) { this._startCuff(n); break; }
        if (d > 2.0) { if (this.time - s.goalT > 0.8 || Math.hypot(p.x - s.gx, p.z - s.gz) > 1.2) this._go(n, p.deck, p.x, p.z, d > 7); if (d < 8 && !s.barked.confront) { s.barked.confront = 1; this._bark(n, RADIO.confront, true); } }
        else { this._stop(n, p); if (!this.confronting) this._beginConfront(n); }
        // walking away mid-confrontation
        if (this.confronting === n && d > 5.5 && this._dlg) { this._endConfront('flee'); }
        break;
      }
      case 'chase': {
        s.icon = '!';
        if (sec.heat === 0) { this._release(n); break; }
        if (sees) {
          if (!s.barked.spot || this.time - s.barked.spot > 20) { s.barked.spot = this.time; this._bark(n, d < 8 ? RADIO.stop : RADIO.spot, true); }
          // cuffing opportunities
          const c = g.combat;
          if (d < 1.9 && (c?.stunned > 0.2 || c?.surrendering)) { this._startCuff(n); break; }
          // fair play at low heat: a suspect who stops when told (standing still, unarmed, not fighting) gets cuffed, not beaten
          const resisting = (c && c.time - (c._lastAttackT ?? -99) < 8) || p.held === 'pistol' || p.held === 'taser' || p.held === 'baton';
          if (sec.heat <= 3 && d < 1.7 && p.speed < 0.4 && !resisting) { s.stillT = (s.stillT || 0) + dt; if (s.stillT > 0.8) { s.stillT = 0; this._startCuff(n); break; } } else s.stillT = 0;
          this._combat(n, d, dt);
        } else {
          if (s.atk) s.atk = null;
          if (sinceSeen > 1.0 && sinceSeen < 1.0 + dt * 1.5) this._bark(n, RADIO.lost, false);
          const lk = sec.lastKnown;
          if (lk && (this.time - s.goalT > 1 || Math.hypot(lk.x - s.gx, lk.z - s.gz) > 2)) this._go(n, lk.deck, lk.x, lk.z, true);
          if (sinceSeen > 5 && this._arrived(n, 2.5)) this._startSearch(n);
          if (sinceSeen > 20) this._startSearch(n);
        }
        break;
      }
      case 'cuff': {
        s.icon = '!';
        const c = g.combat;
        this._stop(n, p); this._anim(n, 'takedown', 'none');
        if (d > 2.2 && p.state !== 'arrested') { s.mode = 'chase'; p.lockControls(false); break; }
        if (sec.jailed) { this._release(n); break; }
        if (s.t > 1.6 && !sec._arresting) { this.stats.cuffs++; s.mode = 'return'; s.t = 0; sec.arrest().then(() => this.standDown(true)); }
        break;
      }
      case 'search': {
        s.icon = sec.heat >= 2 ? '!' : '?';
        if (sees && sec.known && sec.heat >= 1) { s.aware = Math.min(1, s.aware + dt * 2.5); if (s.aware >= 1) this._engage(n, sec.heat >= 2 ? 'chase' : 'confront'); break; }
        if (sec.heat === 0 || s.t > 75) { this._bark(n, RADIO.standDown, false); this._release(n); break; }
        if (this._arrived(n, 1.2) || (n.state === 'idle' && this.time - s.goalT > 6)) {
          if (!s.paused) { s.paused = this.time + 1.5 + Math.random() * 2.5; this._stop(n); this._anim(n, Math.random() < 0.3 ? 'radio' : 'idle'); if (Math.random() < 0.25) this._bark(n, RADIO.search, false); }
          else if (this.time > s.paused) { s.paused = 0; this._nextSearchPoint(n); }
        }
        break;
      }
      case 'return': {
        s.icon = null;
        if (n.tag === 'secRRT') { if (this._arrived(n, 2) || s.t > 40) this._finish(n); }
        else this._finish(n);
        break;
      }
      default: break;
    }
  }
  _arrived(n, r) { const s = this.st(n); return n.deck === s.gd && Math.hypot(n.x - s.gx, n.z - s.gz) < r && (n.state === 'idle' || n.state === 'pause' || Math.hypot(n.x - s.gx, n.z - s.gz) < r * 0.5); }

  _startSearch(n) {
    const s = this.st(n), lk = this.sec.lastKnown || { deck: n.deck, x: n.x, z: n.z };
    s.mode = 'search'; s.t = 0; s.paused = 0; s.center = { ...lk }; s.radius = 6; s.atk = null;
    this._nextSearchPoint(n);
  }
  _nextSearchPoint(n) {
    const s = this.st(n), g = this.game, nav = g.npcs.nav;
    const c = s.center; s.radius = Math.min(32, s.radius + 4);
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, r = s.radius * (0.4 + Math.random() * 0.6);
      const q = nav.nearestPoint(c.deck, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r * 0.5, n.mask, 4);
      if (!q) continue;
      // spread: avoid points another searcher already took
      if ([...this.engaged].some(m => m !== n && this.st(m).mode === 'search' && Math.hypot(this.st(m).gx - q.x, this.st(m).gz - q.z) < 4)) continue;
      this._go(n, c.deck, q.x, q.z, this.sec.heat >= 2);
      return;
    }
    this._go(n, c.deck, c.x, c.z, false);
  }

  // close-range fighting (called on the 0.1 s tick with eyes on the player)
  _combat(n, d, dt) {
    const s = this.st(n), g = this.game, p = g.player, sec = this.sec, c = g.combat;
    s.atkCD -= dt;
    if (sec.heat >= 4) s.taser = true;
    // lethal force: heat 5, or heat 4 against a suspect who has actually been shooting
    const lethalOK = sec.heat >= 5 || (sec.heat >= 4 && this._playerArmed());
    if (lethalOK && !s.armed) { s.armed = true; this._bark(n, RADIO.armed, true); }
    else if (!lethalOK && s.armed && sec.heat < 5) s.armed = false;
    if (s.atk) return;   // wind-up in progress (resolved in _fast)
    // suspect is down / stunned / has hands up: close in and cuff — never shoot a subdued suspect
    if (c && (c.stunned > 0 || c.surrendering) || p.state !== 'free') { if (n.held === 'pistol') n.held = 'taser'; if (d > 1.2 && this.time - s.goalT > 0.4) this._go(n, p.deck, p.x, p.z, true); return; }
    const taserReady = s.taser && this.time >= (s.taserReadyT ?? 0);
    const weapon = taserReady && d > 1.8 && d < 7 ? 'taser' : s.armed && d > 2.2 ? 'pistol' : s.taser && d > 1.8 && d < 7 && !s.armed ? 'taser' : 'baton';
    if (weapon === 'baton') {
      n.held = 'baton';
      if (d > 1.55) { if (this.time - s.goalT > 0.5 || Math.hypot(p.x - s.gx, p.z - s.gz) > 1) this._go(n, p.deck, p.x, p.z, true); }
      else { this._stop(n, p); if (s.atkCD <= 0) { s.atk = { kind: 'baton', t: 0.45 }; this._anim(n, 'swing_baton', 'baton'); this.stats.swings++; } }
    } else if (weapon === 'taser') {
      n.held = 'taser';
      if (taserReady && s.atkCD <= 0) { this._stop(n, p); s.atk = { kind: 'taser', t: 0.55 }; this._anim(n, 'aim_taser', 'taser'); }
      else if (d > 1.55) { if (this.time - s.goalT > 0.5) this._go(n, p.deck, p.x, p.z, true); }   // recharging: close in with the baton
      else { this._stop(n, p); if (s.atkCD <= 0) { n.held = 'baton'; s.atk = { kind: 'baton', t: 0.45 }; this._anim(n, 'swing_baton', 'baton'); this.stats.swings++; } }
    } else {
      n.held = 'pistol';
      if (s.atkCD <= 0 && d < 30) { this._stop(n, p); s.atk = { kind: 'pistol', t: 0.6 }; this._anim(n, 'aim_pistol', 'pistol'); }
      else if (d > 14) this._go(n, p.deck, p.x, p.z, true);
      else { this._stop(n, p); this._anim(n, 'aim_pistol', 'pistol'); }
    }
  }
  // per-frame: attack wind-ups, facing
  _fast(n, dt) {
    const s = n.sec; if (!s) return;
    if (n.secStagger > 0) { n.secStagger -= dt; if (n.secStagger <= 0) { n.state = 'idle'; n.timer = Infinity; s.goalT = -9; } return; }
    if (!s.atk || !conscious(n)) return;
    const g = this.game, p = g.player;
    n.yaw = Math.atan2(p.x - n.x, p.z - n.z);
    s.atk.t -= dt;
    if (s.atk.t > 0) return;
    const kind = s.atk.kind; s.atk = null;
    const c = g.combat;
    // the suspect gave up / went down during the wind-up: hold fire
    if (p.state !== 'free' || (c && (c.surrendering || c.stunned > 0)) || this.sec.jailed) { s.atkCD = 0.6; return; }
    const nonLethal = this.sec.heat <= 4;
    const res = c ? c.attackPlayer(n, kind, { nonLethal }) : 'miss';
    s.atkCD = kind === 'baton' ? 1.05 + Math.random() * 0.3 : kind === 'taser' ? 1.2 : 0.9 + Math.random() * 0.6;
    if (kind === 'taser') { this.stats.tasers = (this.stats.tasers || 0) + 1; s.taserReadyT = this.time + 3.5; }
    if (kind === 'pistol') { this.stats.shots++; this._anim(n, 'fire_pistol', 'pistol'); }
    // non-lethal: at heat ≤ 4 a battered suspect goes down (then gets cuffed) instead of dying
    if (res === 'hit' && nonLethal && p.health < 22 && c && !(c.stunned > 0)) { c.stunPlayer(4.5, n); }
  }

  _startCuff(n) {
    const s = this.st(n), p = this.game.player;
    if (this.sec.jailed || this.sec._arresting || p.state === 'dead') return;
    s.mode = 'cuff'; s.t = 0; s.atk = null;
    this._bark(n, RADIO.cuff, true);
    p.lockControls(true); p.state = 'arrested';
    if (this.confronting) this._endConfront(null);
  }

  // ── ID check dialogue ─────────────────────────────────────────────────
  async _beginConfront(n) {
    if (this._dlg) return;
    this.confronting = n; this._dlg = true;
    const g = this.game, sec = this.sec, p = g.player;
    const cash = g.economy ? g.economy.cash : (p.money || 0);
    const disguised = !!p.disguise && p.disguise !== 'player';
    const opts = {
      speaker: n.name ? `${n.name} · Ship's Security` : 'Ship\'s Security',
      lines: [sec.description?.text ? `"We've had a report about a ${sec.description.text}. That matches you. Cruise card, please."` : '"Ship\'s security. May I see your cruise card?"'],
      options: [
        { id: 'comply', text: 'Comply — hand over your card', enabled: true, hint: 'Small fine if it\'s minor; arrest if they\'re after you for something serious' },
        { id: 'bluff', text: disguised ? '"I\'m crew — I\'m on shift, mate."' : '"There must be some mistake."', enabled: true, hint: disguised ? 'Good odds in uniform' : 'Risky' },
        { id: 'bribe', text: 'Slip them §200', enabled: cash >= 200, hint: cash >= 200 ? 'Most guards take it' : 'Not enough cash' },
        { id: 'flee', text: 'Walk away', enabled: true, hint: 'They will give chase' },
      ],
    };
    let choice = null;
    try {
      if (this._forcedChoice) { choice = this._forcedChoice; this._forcedChoice = null; }
      else if (g.ui?.dialogue) choice = await g.ui.dialogue(opts);
      else if (sec.hud?.dialogue) choice = await sec.hud.dialogue(opts);
      else choice = 'comply';
    } catch { choice = 'comply'; }
    if (this.confronting === n) this._endConfront(choice || 'flee');
  }
  resolveConfront(choice) { if (this.confronting) { this.sec.hud?.closeDialogue?.(choice); this._endConfront(choice); } else this._forcedChoice = choice; }
  _endConfront(choice) {
    const n = this.confronting; this.confronting = null; this._dlg = false;
    this.sec.hud?.closeDialogue?.();
    if (!n || choice == null) return;
    const g = this.game, sec = this.sec, p = g.player, s = this.st(n);
    const lastCrime = sec.crime.log[sec.crime.log.length - 1];
    const serious = sec.heatValue >= 1.6 || (lastCrime && lastCrime.spec.min >= 2);
    const say = (t) => { this.bus.emit('bark', { text: t, x: n.x, y: n.y, z: n.z, deck: n.deck, npc: n, ctx: 'security', voice: n.identity?.voice }); sec.hud?.radio(`${(n.name || 'Guard').split(' ')[0]}: ${t}`); };
    this.lastChoice = choice;
    if (choice === 'comply') {
      if (serious) { say('Thank you. You\'ll need to come with me.'); this._startCuff(n); return; }
      const fine = 75; const paid = sec._takeMoney(fine);
      say(`Right. That's a §${fine} fine and a warning. Stay out of crew areas.`);
      sec.record.fines += paid; sec.clear();
      this._release(n);
    } else if (choice === 'bluff') {
      const disguised = !!p.disguise && p.disguise !== 'player';
      let chance = (disguised ? 0.7 : 0.3) - (serious ? 0.25 : 0) - (sec.record.strikes * 0.08);
      if (Math.random() < chance) { say(disguised ? 'Hm. Sorry, colleague. Carry on.' : 'Fine. Move along.'); sec.setHeat(0.6, 'bluffed'); sec.description = null; s.aware = 0; this._release(n); }
      else { say('Nice try. Don\'t move!'); sec.raiseTo(2, 0.2, 'Lying to security'); this._engage(n, 'chase'); }
    } else if (choice === 'bribe') {
      const chance = serious ? 0.45 : 0.8;
      if (sec._takeMoney(200) >= 200 && Math.random() < chance) { say('I didn\'t see you. Off you go.'); sec.clear(); this._release(n); }
      else { say('Bribing an officer? You\'re nicked.'); sec.raiseTo(2, 0.4, 'Bribery'); this._engage(n, 'chase'); }
    } else {
      say('Hey! Stop!');
      sec.report({ type: 'evading', witnessed: true });
      this._engage(n, 'chase');
    }
  }

  // ── indicators for the HUD ────────────────────────────────────────────
  indicators(out = []) {
    out.length = 0;
    const g = this.game, p = g.player;
    for (const n of this.game.npcs?.query(p.deck, p.x, p.z, 30) || []) {
      const s = n.sec; if (!s || !conscious(n)) continue;
      let icon = s.icon, k = 1;
      if (s.mode === 'patrol' && s.aware > 0.02) { icon = '?'; k = s.aware; }
      if (!icon) continue;
      out.push({ npc: n, icon, k, x: n.x, y: n.y + 2.15, z: n.z, deck: n.deck });
    }
    const reps = this.sec.crime.active.filter(r => r.npc && r.kind !== 'guard' && conscious(r.npc) && r.npc.deck === p.deck && Math.hypot(r.npc.x - p.x, r.npc.z - p.z) < 35)
      .sort((a, b) => b.t / b.delay - a.t / a.delay).slice(0, 3);   // the three closest to getting through
    for (const r of reps) {
      const n = r.npc;
      out.push({ npc: n, icon: r.kind === 'crew' ? 'radio' : 'phone', k: clamp(r.t / r.delay, 0, 1), x: n.x, y: n.y + 2.15, z: n.z, deck: n.deck });
    }
    if (this.sec.watcher && conscious(this.sec.watcher) && this.sec.suspicion > 0.05) {
      const n = this.sec.watcher; if (!out.some(o => o.npc === n)) out.push({ npc: n, icon: 'eye', k: this.sec.suspicion, x: n.x, y: n.y + 2.15, z: n.z, deck: n.deck });
    }
    return out;
  }
}
