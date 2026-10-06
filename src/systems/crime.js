// HALCYON TIDE — crime model: catalogue, descriptions, witnesses and the reporting pipeline.
//
// A crime only becomes "known" to Security when somebody (or something) reports it:
//   • guards who see it → immediate (0.6–1 s, radio bark) and they engage personally
//   • crew who see it  → radio it in after 3–5 s (stand still with the 'radio' anim — interceptable)
//   • passengers       → phone / run to a guard: 9–18 s (faster if a guard is near). A phone icon with a progress
//                        ring floats over their head: knock them out, or aim a weapon at them (intimidation) to stop it.
//   • CCTV cameras     → operator notices after 7–10 s (2.5 s when someone is sitting in the CCTV room); nothing if the
//                        feed for that deck is looped, the camera is destroyed/obscured or the CCTV power is off.
//   • physical evidence (bodies, KO'd people, smashed cameras, forced safes) → reported without a description.
// A report carries the outfit description captured AT THE TIME OF THE CRIME (if the reporter saw the perpetrator).
//
// Input: bus 'crime' {type, severity?, x,y,z, deck, actor, victim, stealth?, witnessed?, evidence?, quiet?}
//        (player.js emits it for interactions with `crime`; combat.js / security.js emit their own).
// Output: security.onReport(report).
import { deckY } from '../core/config.js';

// min = heat level the crime raises you to at least (when the perpetrator was seen), add = extra heat on top.
// loud = hearing radius (m) — 0 means only eyes can witness it.
export const CRIMES = {
  trespass:        { label: 'Trespassing',              min: 1, add: 0.2,  loud: 0 },
  theft:           { label: 'Theft',                    min: 1, add: 0.35, loud: 0 },
  pickpocket:      { label: 'Pickpocketing',            min: 1, add: 0.35, loud: 0 },
  shoplifting:     { label: 'Shoplifting',              min: 1, add: 0.3,  loud: 0 },
  burglary:        { label: 'Burglary',                 min: 1, add: 0.6,  loud: 0 },
  fraud:           { label: 'Cheating / fraud',         min: 1, add: 0.3,  loud: 0 },
  vandalism:       { label: 'Vandalism',                min: 1, add: 0.35, loud: 10 },
  impersonation:   { label: 'Impersonating crew',       min: 1, add: 0.5,  loud: 0 },
  armed:           { label: 'Brandishing a weapon',     min: 2, add: 0.2,  loud: 0 },
  assault:         { label: 'Assault',                  min: 2, add: 0.4,  loud: 12 },
  assault_officer: { label: 'Assaulting an officer',    min: 2, add: 0.9,  loud: 12 },
  evading:         { label: 'Evading security',         min: 2, add: 0.3,  loud: 0 },
  ko_found:        { label: 'Unconscious person found', min: 1, add: 0.4,  loud: 0, evidence: true },
  discharge:       { label: 'Firearm discharge',        min: 3, add: 0.4,  loud: 45 },
  jailbreak:       { label: 'Jailbreak',                min: 3, add: 0.3,  loud: 0 },
  body_found:      { label: 'Body found',               min: 2, add: 0.8,  loud: 0, evidence: true },
  grievous:        { label: 'Grievous bodily harm',     min: 3, add: 0.6,  loud: 12 },
  shooting:        { label: 'Shooting a person',        min: 4, add: 0.4,  loud: 45 },
  murder:          { label: 'Murder',                   min: 4, add: 0.9,  loud: 14 },
};
const ALIAS = { fight: 'assault', gunshot: 'discharge', cheating: 'fraud', cheat: 'fraud', break_in: 'burglary', breakin: 'burglary', kill: 'murder',
  homicide: 'murder', steal: 'theft', shoplift: 'shoplifting', lockpick: 'burglary', smash: 'vandalism', disguise: 'impersonation', escape: 'jailbreak' };
export function crimeSpec(type, severity) {
  const t = ALIAS[type] || type;
  if (CRIMES[t]) return { type: t, ...CRIMES[t] };
  const s = Math.max(1, Math.min(5, severity ?? 1));
  return { type: t || 'misconduct', label: String(type || 'Misconduct').replace(/_/g, ' '), min: Math.min(4, Math.ceil(s)), add: 0.3, loud: s >= 3 ? 12 : 0 };
}

// ── descriptions ─────────────────────────────────────────────────────────────
const COLORS = [
  ['black', 0x18181b], ['charcoal', 0x2a2e34], ['dark grey', 0x3b3f45], ['grey', 0x6b6f78], ['light grey', 0xb4b8bc], ['white', 0xf2f0ea],
  ['cream', 0xe9e4d6], ['beige', 0xc8b48c], ['navy', 0x1c2440], ['blue', 0x2f86c4], ['light blue', 0xbfdcef], ['teal', 0x36b3b0],
  ['green', 0x4f9d5b], ['olive', 0x3e4f3a], ['red', 0xd9483b], ['burgundy', 0x7a1424], ['orange', 0xe57f2e], ['yellow', 0xf0c33c],
  ['gold', 0xc9a23a], ['pink', 0xe76f91], ['pale pink', 0xf4c7c3], ['purple', 0x5e5cc9], ['plum', 0x5a1a5e], ['brown', 0x6b4a32], ['tan', 0xb8a58a],
];
function rgb(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
export function colorName(hex) {
  if (hex == null) return '';
  const [r, g, b] = rgb(hex); let best = 'grey', bd = 1e9;
  for (const [n, c] of COLORS) { const [r2, g2, b2] = rgb(c); const d = (r - r2) ** 2 * 0.3 + (g - g2) ** 2 * 0.59 + (b - b2) ** 2 * 0.11; if (d < bd) { bd = d; best = n; } }
  return best;
}
const UNIFORM = {
  security: 'a security uniform', crew_officer: "an officer's whites", captain: "a captain's uniform", crew_steward: 'a steward uniform',
  crew_waiter: "a waiter's uniform", crew_bartender: "a bartender's waistcoat", crew_chef: 'chef whites', crew_deckhand: 'deckhand overalls',
  crew_engineer: 'engineer overalls', crew_housekeeping: 'a housekeeping tunic', croupier: "a croupier's waistcoat", medic: 'medical scrubs',
  lifeguard: 'lifeguard red', entertainer: 'a performer costume',
};
const TOPW = { jacket: 'jacket', suit: 'suit jacket', tshirt: 'T-shirt', polo: 'polo shirt', shirt: 'shirt', blouse: 'blouse', tank: 'tank top', sundress: 'sundress', gown: 'gown', bikini: 'bikini', swimsuit: 'swimsuit', coverup: 'cover-up', bare: 'bare top' };
const LEGW = { trousers: 'trousers', shorts: 'shorts', capri: 'capris', skirt: 'skirt', dress: '', swim: 'swim shorts', bikini: '', swimsuit: '' };
const q = (h) => (h == null ? 'x' : (((h >> 16) & 0xe0) << 16 | ((h >> 8) & 0xe0) << 8 | (h & 0xe0)).toString(16));
export function describeAppearance(ap) {
  if (!ap) return { key: 'unknown', text: 'unknown person', role: null };
  const o = ap.outfit || {};
  const who = ap.age === 'child' ? 'child' : ap.sex === 'm' ? 'man' : 'woman';
  let text;
  const role = ap.role && ap.role !== 'player' && ap.role !== 'passenger' ? ap.role : null;
  if (role && UNIFORM[role]) text = `${who} in ${UNIFORM[role]}`;
  else {
    const top = `${colorName(o.topColor)} ${TOPW[o.top] || 'top'}`;
    const lw = LEGW[o.legs] ?? LEGW[o.bottom] ?? 'trousers';
    const bot = lw ? ` and ${colorName(o.bottomColor)} ${lw}` : '';
    text = `${who} in a ${top}${bot}`;
  }
  if (o.hat && o.hat !== 'none' && !role) text += `, ${o.hat.replace('_', ' ')}`;
  const key = [ap.role || 'p', q(o.topColor), q(o.bottomColor), o.top || '', o.legs || '', o.hat || ''].join('|');
  return { key, text, role };
}

// ── locations ────────────────────────────────────────────────────────────────
export function sectionOf(x) { return x < -55 ? 'aft' : x > 55 ? 'forward' : 'midship'; }
export function placeName(world, deck, x, z) {
  const r = world.roomAt(deck, x, z);
  const nm = r && r.name ? r.name.replace(/ · .*/, '') : null;
  return `Deck ${deck} ${sectionOf(x)}${nm ? ', ' + nm : ''}`;
}

export function npcClass(n) {
  if (!n) return 'none';
  if (n.role === 'security') return 'guard';
  if (n.role === 'passenger' || n.role === 'child' || n.role === 'elderly') return n.offDuty ? 'crew' : 'pax';
  return 'crew';
}
const conscious = (n) => n && !n.gone && n.state !== 'ko' && n.state !== 'dead' && n.state !== 'hidden';

// ── witness system ───────────────────────────────────────────────────────────
export class CrimeSystem {
  constructor(game, sec) {
    this.game = game; this.sec = sec;
    this.pending = [];          // reports in flight
    this.log = [];              // committed crimes (last 40)
    this.nextId = 1;
    this.time = 0;
    game.bus.on('crime', (e) => { try { if (e && !e._sec) this.commit({ ...e, _bus: true }); } catch (err) { console.error('[crime]', err); } });
  }

  // player commits a crime (called via bus 'crime')
  commit(e) {
    if (!e || e._sec) return;
    const g = this.game, p = g.player;
    const actor = e.actor ?? p;
    if (actor !== p && actor !== 'player') return;   // NPC-on-NPC crimes are not tracked
    const spec = crimeSpec(e.type, e.severity);
    const deck = e.deck ?? p.deck, x = e.x ?? p.x, z = e.z ?? p.z, y = e.y ?? deckY(deck);
    // the same act reported twice (bus 'crime' + security.report()) counts once
    const dup = this.log.length && this.log[this.log.length - 1];
    if (dup && dup.type === spec.type && this.time - dup.t < 1 && dup.deck === deck && Math.hypot(dup.x - x, dup.z - z) < 2 && !e.evidence) return dup;
    const crime = { id: this.nextId++, type: spec.type, spec, label: spec.label, x, y, z, deck, t: this.time, victim: e.victim || null,
      stealth: !!e.stealth, desc: describeAppearance(p.appearance), place: placeName(g.world, deck, x, z), evidence: !!(e.evidence || spec.evidence) };
    this.log.push(crime); if (this.log.length > 40) this.log.shift();
    // re-broadcast for other listeners (NPC reactions, missions, audio) — flagged so we don't loop
    if (!e._bus) g.bus.emit('crime', { type: crime.stealth || e.quiet ? 'quiet_' + crime.type : crime.type, crimeType: crime.type, severity: spec.min, x, y, z, deck, actor: p, victim: crime.victim, stealth: crime.stealth, label: spec.label, _sec: true, id: crime.id });
    if (e.witnessed) { this.deliver({ crime, kind: 'script', sighted: e.sighted !== false, x, z, deck }); return crime; }
    if (crime.evidence) { this.queue({ crime, kind: e.reporterKind || 'evidence', npc: e.reporter || null, sighted: false, delay: e.delay ?? 2 }); return crime; }
    this.findWitnesses(crime, e);
    return crime;
  }

  // who saw / heard it?
  findWitnesses(crime, e = {}) {
    const g = this.game, p = g.player, sec = this.sec;
    const loud = e.quiet || crime.stealth ? 0 : (e.loud ?? crime.spec.loud ?? 0);
    const found = [];
    const list = g.npcs?.list || [];
    const py = p.y + 1.4;
    for (const n of list) {
      if (!conscious(n) || Math.abs(n.deck - crime.deck) > (loud > 20 ? 1 : 0)) continue;
      if (n === crime.victim && crime.stealth) continue;
      const d = Math.hypot(n.x - crime.x, n.z - crime.z);
      if (d > Math.max(26, loud)) continue;
      let sighted = false, aware = false;
      if (n.deck === crime.deck && (n === crime.victim || n.perception.canSee(p.x, py, p.z, p.deck))) { sighted = true; aware = true; }
      else if (loud && n.perception.hears(crime.x, crime.z, crime.deck, loud)) {
        aware = true;
        // turns toward the noise: sees the perpetrator if there is a line of sight and they are close enough
        sighted = n.deck === p.deck && d < 16 && g.world.lineClear(n.deck, n.x, n.z, p.x, p.z);
      }
      if (!aware) continue;
      // a crowd reacting: watching is not reporting — a few report
      found.push({ npc: n, kind: npcClass(n), sighted, d });
    }
    // CCTV
    const camHits = sec.camerasSeeing(crime.deck, p.x, py, p.z);
    // victim conscious and not taken from behind: they will report it themselves
    found.sort((a, b) => (a.kind === 'guard' ? -100 : a.kind === 'crew' ? -30 : 0) + a.d - ((b.kind === 'guard' ? -100 : b.kind === 'crew' ? -30 : 0) + b.d));
    let n = 0;
    for (const w of found) {
      if (n >= 4) break;
      if (w.kind === 'guard') { this.queue({ crime, kind: 'guard', npc: w.npc, sighted: w.sighted, delay: 0.6 + Math.random() * 0.4 }); sec.ai?.witness(w.npc, crime, w.sighted); }
      else if (w.kind === 'crew') this.queue({ crime, kind: 'crew', npc: w.npc, sighted: w.sighted, delay: 3 + Math.random() * 2 });
      else this.queue({ crime, kind: 'pax', npc: w.npc, sighted: w.sighted, delay: 9 + Math.random() * 9 });
      n++;
    }
    for (const c of camHits.slice(0, 1)) this.queue({ crime, kind: 'camera', camera: c, sighted: true, delay: sec.cctvManned() ? 2.5 : 7 + Math.random() * 3 });
    crime.witnesses = found.length; crime.cameras = camHits.length;
    return found;
  }

  queue(r) {
    const rep = { id: this.nextId++, t: 0, cancelled: false, done: false, x: r.crime.x, z: r.crime.z, deck: r.crime.deck, ...r };
    // one report per reporter per crime
    if (rep.npc && this.pending.some(o => o.npc === rep.npc && o.crime === rep.crime)) return null;
    this.pending.push(rep);
    const n = rep.npc;
    if (n && !n.gone && n.kind !== 'mission' && !n.sec?.engaged) {
      const npcs = this.game.npcs;
      if (rep.kind === 'crew') { npcs.setGoal(n, { type: 'idle', anim: 'radio', duration: rep.delay + 0.5, yaw: Math.atan2(this.game.player.x - n.x, this.game.player.z - n.z) }); }
      else if (rep.kind === 'pax' && n.state !== 'flee' && n.state !== 'cower') { npcs.setGoal(n, { type: 'idle', anim: 'phone', duration: rep.delay + 1 }); n.held = 'phone'; }
      if (rep.kind !== 'guard') n.reporting = rep;
    }
    return rep;
  }

  // an NPC was intimidated (aimed at) — their report may be dropped
  intimidate(n) {
    for (const r of this.pending) if (r.npc === n && !r.done && !r.cancelled && r.kind !== 'guard' && Math.random() < 0.85) { r.cancelled = true; r.why = 'intimidated'; n.reporting = null; this.game.bus.emit('security:reportStopped', { report: r, why: 'intimidated' }); }
  }

  update(dt) {
    this.time += dt;
    const g = this.game, sec = this.sec;
    for (const r of this.pending) {
      if (r.done || r.cancelled) continue;
      const n = r.npc;
      if (n) {
        if (n.state === 'ko' || n.state === 'dead') { r.cancelled = true; r.why = 'silenced'; g.bus.emit('security:reportStopped', { report: r, why: 'silenced' }); continue; }
        // a guard close by takes the report directly
        if ((r.kind === 'pax' || r.kind === 'crew') && !n.gone && r.t < r.delay - 2 && ((this.time * 4 + r.id) | 0) % 4 === 0) {
          const near = g.npcs.nearest(n.deck, n.x, n.z, 9, (m) => m.role === 'security' && conscious(m));
          if (near) r.t = Math.max(r.t, r.delay - 1.6);
        }
      }
      if (r.camera && !sec.cameraLive(r.camera)) { r.cancelled = true; r.why = 'camera offline'; continue; }
      if (r.kind === 'camera' && sec.feedLooped(r.deck)) { r.cancelled = true; r.why = 'feed looped'; continue; }
      r.t += dt;
      if (r.t >= r.delay) this.deliver(r);
    }
    if (this.pending.length > 24 || (this.pending.length && ((this.time * 2) | 0) % 10 === 0)) this.pending = this.pending.filter(r => !r.done && !r.cancelled);
  }

  deliver(r) {
    r.done = true;
    if (r.npc) { r.npc.reporting = null; if (r.npc.held === 'phone') r.npc.held = 'none'; }
    this.sec.onReport(r);
  }

  // drop every report in flight (arrest / revive: the slate is wiped)
  cancelAll(why = 'cleared') {
    let k = 0;
    for (const r of this.pending) if (!r.done && !r.cancelled) { r.cancelled = true; r.why = why; k++; if (r.npc) { r.npc.reporting = null; if (r.npc.held === 'phone') r.npc.held = 'none'; } }
    this.pending = [];
    return k;
  }
  // drop pending camera reports (recordings wiped)
  wipeCameraReports() { let k = 0; for (const r of this.pending) if (r.kind === 'camera' && !r.done && !r.cancelled) { r.cancelled = true; r.why = 'wiped'; k++; } return k; }
  get active() { return this.pending.filter(r => !r.done && !r.cancelled); }
}
