// HALCYON TIDE — the Undertow cast: persistent named NPCs spawned at plausible posts, with light
// day/time schedules that move them between venues when the player isn't looking.
import { room, roomCentre, placeNpc, spawnCast } from './util.js';

// Each cast member: where they live by default, and schedule entries [dayPredicate, hourFrom, hourTo, deck, x, z, yaw, anim]
// Spawned lazily (when first needed or when the player is on their deck) and kept persistent thereafter.
const CAST = {
  teodor: { name: 'Teodor Brask', role: 'crew_bartender', job: 'bartender', home: { deck: 6, x: 11.3, z: 11.4, yaw: Math.PI }, noFlee: true,
    desc: 'bartender · The Lantern' },
  sunny: { name: 'Sunny Marsh', role: 'entertainer', job: 'host', home: { deck: 4, x: 5.0, z: 11.0, yaw: Math.PI }, noFlee: true,
    desc: 'cruise director' },
  okafor: { name: 'Ines Okafor', role: 'security', job: 'guard', home: { deck: 2, x: -51, z: 5.9, yaw: Math.PI }, noFlee: true,
    desc: 'security chief' },
  daan: { name: 'Leopold Daan', role: 'crew_officer', job: 'clerk', home: { deck: 2, x: -22.5, z: 4.5, yaw: Math.PI }, noFlee: true,
    desc: 'chief purser' },
  venn: { name: 'Dr. Asha Venn', role: 'medic', job: 'nurse', home: { deck: 3, x: 15, z: 11.8, yaw: Math.PI }, noFlee: true,
    desc: "ship's doctor" },
  holt: { name: 'Captain Rhiannon Holt', role: 'captain', job: 'officer', home: { deck: 13, x: 125.3, z: 0, yaw: -Math.PI / 2 }, noFlee: true,
    desc: 'master' },
  varga: { name: 'Hollis Varga', role: 'passenger', job: null, home: { deck: 14, x: 113.5, z: -2, yaw: 0 }, dress: 'evening', noFlee: true,
    desc: "owner, Larkspur Oceanic" },
  reyes: { name: 'Petra Reyes', role: 'crew_officer', job: 'officer', home: { deck: 6, x: 13.9, z: 9.8, yaw: 0 }, noFlee: true,
    desc: 'nervous junior officer' },
  vane: { name: 'Celeste Vane', role: 'passenger', job: null, home: { deck: 5, x: 35, z: 7, yaw: Math.PI }, dress: 'evening', noFlee: true,
    desc: 'jewel thief (rival)' },
  pike: { name: 'Jonah Pike', role: 'passenger', job: null, home: { deck: 6, x: 41, z: 0, yaw: 0 }, noFlee: true,
    desc: 'guest journalist' },
};

export class CastManager {
  constructor(game, engine) { this.game = game; this.engine = engine; this.npcs = new Map(); engine._cast = this; }

  def(key) { return CAST[key]; }
  get(key) { const n = this.npcs.get(key); return n && !n.gone ? n : null; }

  ensure(key) {
    let n = this.get(key);
    if (n) return n;
    const c = CAST[key]; if (!c) return null;
    n = spawnCast(this.game, key, c.role, c.home.deck, c.home.x, c.home.z, { name: c.name, job: c.job, dress: c.dress, yaw: c.home.yaw, noFlee: c.noFlee });
    if (n) { n.castKey = key; n.workAnimName = key === 'teodor' ? 'wipe_bar' : 'idle'; this.npcs.set(key, n); }
    return n;
  }

  // spawn whichever cast a mission needs when it begins
  ensureFor(missionId) {
    const need = NEED[missionId];
    if (need) for (const k of need) this.ensure(k);
  }

  // move a cast member to a position (only when off-screen, unless forced)
  move(key, deck, x, z, yaw, forced = false) {
    const n = this.ensure(key); if (!n) return false;
    return placeNpc(this.game, n, deck, x, z, yaw, !forced);
  }

  // per-frame: keep key cast near their scheduled posts, lazily spawn when the player enters their deck
  update() {
    const g = this.game, p = g.player; if (!p) return;
    const vd = g.schedule?.voyageDay ?? ((g.day % 7) + 1), h = g.hour;
    // lazy spawn cast on the player's deck (so they're there when encountered)
    for (const key of Object.keys(CAST)) {
      const c = CAST[key];
      if (!this.npcs.has(key) && c.home.deck === p.deck && Math.hypot(c.home.x - p.x, c.home.z - p.z) < 40) this.ensure(key);
    }
    // Teodor: works The Lantern bar evenings; Sunday day he's off (still there). Keep anim lively.
    const teo = this.get('teodor'); if (teo && teo.state === 'idle') { teo.workAnimName = 'wipe_bar'; }
    // Varga: Owner's Suite by day; gala venue in the evening on formal nights handled by missions.
  }

  save() { const o = {}; for (const [k, n] of this.npcs) if (n && !n.gone) o[k] = { deck: n.deck, x: n.x, z: n.z, yaw: n.yaw }; return o; }
  load(d) { /* cast respawns lazily; positions re-derived by missions */ }
}

// which cast each mission wants on stage
const NEED = {
  undertow_1: ['teodor', 'sunny'],
  undertow_2: ['teodor'],
  undertow_3: ['daan'],
  undertow_4: ['teodor', 'vane'],
  undertow_5: ['reyes'],
  undertow_6: ['teodor'],
  undertow_7: ['pike'],
  undertow_8: ['daan', 'varga'],
  undertow_9: ['okafor'],
  undertow_10: ['okafor', 'holt', 'pike', 'varga'],
};

export { CAST };
