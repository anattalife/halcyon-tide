// HALCYON TIDE — population director.
// Decides WHO should exist around the focus (player/camera) and WHERE, from the deck plans and the daily
// schedule; spawns them out of sight (or directly at their seat when that seat is hidden), hands out
// activities, and retires people who are far away / surplus. Staff posts are filled deterministically
// (the same bartender always works the same bar). Behaviour/movement lives in npcs.js.
import { GRID, deckY, cellX, cellZ, toI, toJ } from '../core/config.js';
import { hash32 } from '../core/util.js';
import { occupancy, staffOn, curve, win, activityFits, isNight } from './schedule.js';
import { ACC } from './nav.js';

const NX = GRID.nx;
const STAND_DENS = new Set(['atrium', 'shop', 'shopstreet', 'deck', 'promenade', 'pool', 'sport', 'gym', 'kids', 'lounge', 'bar', 'club', 'casino', 'spa', 'buffet', 'dining', 'theater', 'medical', 'crewbar', 'crewmess', 'galley', 'laundry']);
const PASS_DENS = new Set(['transit', 'crewtransit', 'shopstreet', 'promenade']);
const isTrack = (room) => /Jogging/.test(room.name || '');
const EXT_TYPES = new Set(['pooldeck', 'deck', 'promenade', 'sportdeck']);

export class Population {
  constructor(sys) {
    this.sys = sys; this.game = sys.game; this.nav = sys.nav;
    this.decks = [];
    this.t = 0; this.tickT = 0;
    this.lastFocus = null;
    this.warm = 16;           // >0: frames of free in-place spawning (initial fill / teleport), budgeted per frame
    this.targets = [];        // debug
    this.staffWant = 0; this.ambWant = 0;
    this.patrolSlots = new Map();
  }

  // ── per-deck static data ───────────────────────────────────────────────
  deck(d) {
    if (this.decks[d]) return this.decks[d];
    if (!this.game.world.plans[d]) return null;
    const it = (this._bld && this._bld.d === d) ? this._bld.it : this._deckGen(d);
    this._bld = null;
    while (!it.next().done);
    return this.decks[d];
  }
  // staged build of the per-deck data (yields every few rooms) — used by prebuild() to spread the cost
  deckStep(d) {
    if (this.decks[d]) return false;
    if (!this._bld || this._bld.d !== d) this._bld = { d, it: this._deckGen(d) };
    if (this._bld.it.next().done) this._bld = null;
    return true;
  }
  *_deckGen(d) {
    const plan = this.game.world.plans[d];
    const dn = this.nav.deck(d);
    const info = new Map();
    const get = (id) => {
      let r = info.get(id);
      if (!r) {
        const room = plan.rooms[id];
        r = { id, room, deck: d, seats: [], stands: [], staff: [], swim: [], count: 0, cSeat: 0, cStand: 0, target: 0, tSeat: 0, tStand: 0, dist: 1e9, crew: room.zone === 'crew' };
        info.set(id, r);
      }
      return r;
    };
    let pc = 0;
    for (const p of plan.pois) {
      if (++pc % 500 === 0) yield 0;
      const room = plan.rooms[p.room]; if (!room) continue;
      // plan.js lets the FDEF anchor role ('post' → guard) override the item's role (bartender posts) — prefer the item's
      if (p.item && p.item.t === 'post' && p.item.role && p.role !== p.item.role) p.role = p.item.role;
      if (p.role) { get(p.room).staff.push(p); continue; }
      if (room.zone === 'private' || room.zone === 'restricted' || !room.dens) continue;
      if (room.type === 'crew_cabin' || room.type === 'cabin') continue;
      if (p.pose === 'lie' && room.dens !== 'pool' && room.dens !== 'deck' && room.dens !== 'spa' && p.act !== 'sunbathe') continue;
      get(p.room).seats.push(p);
    }
    // synthetic anchors: swim spots, hot-tub seats, dance floor, browse spots, mingling spots
    const rnd = mulberry(hash32('pois', d));
    const byRoom = new Map(); for (const it of plan.items) { let a = byRoom.get(it.room); if (!a) byRoom.set(it.room, a = []); a.push(it); }
    for (const room of plan.rooms) {
      if (!room || !room.dens || room.zone === 'private' || room.zone === 'restricted') continue;
      if (room.pool) {
        const R = get(room.id);
        for (let x = room.x0 + 1.2; x < room.x1 - 1.0; x += 1.7) for (let z = room.z0 + 1.2; z < room.z1 - 1.0; z += 1.7) {
          const jx = x + (rnd() - 0.5) * 0.6, jz = z + (rnd() - 0.5) * 0.6;
          if (plan.roomAt(jx, jz)?.id !== room.id) continue;
          R.swim.push(synth(d, jx, jz, rnd() * 6.28, 'swim', 'swim', room.id, 0));
        }
        continue;
      }
      if (!STAND_DENS.has(room.dens) && !PASS_DENS.has(room.dens)) continue;
      if (room.area > 60) yield 1;
      const R = get(room.id);
      if (room.dens === 'club') {
        // dance floor: open cells within ~7 m of the DJ booth front, else room centre
        const dj = plan.items.find(it => it.t === 'dj_booth' && it.room === room.id);
        const cx = dj ? dj.x + Math.sin(dj.rot) * 4 : room.cx, cz = dj ? dj.z + Math.cos(dj.rot) * 4 : room.cz;
        for (let x = cx - 4; x <= cx + 4; x += 0.95) for (let z = cz - 5; z <= cz + 5; z += 0.95) {
          const jx = x + (rnd() - 0.5) * 0.35, jz = z + (rnd() - 0.5) * 0.35;
          const k = toJ(jz) * NX + toI(jx);
          if (plan.room[k] !== room.id || !dn.walk[k] || dn.cost[k] >= 3) continue;
          R.stands.push(synth(d, jx, jz, Math.atan2((dj?.x ?? cx) - jx, (dj?.z ?? cz) - jz), 'stand', 'dance', room.id, 0));
        }
      }
      // shop browsing in front of shelves / displays
      for (const it of (byRoom.get(room.id) || NONE)) {
        if (it.act !== 'shop') continue;
        const fx = Math.sin(it.rot), fz = Math.cos(it.rot);
        const offs = it.t === 'shelf' ? [-0.6, 0.6] : [0];
        for (const o of offs) {
          const px = it.x + fx * ((it.hz ?? 0.4) + 0.55) + Math.cos(it.rot) * o, pz = it.z + fz * ((it.hz ?? 0.4) + 0.55) - Math.sin(it.rot) * o;
          const k = toJ(pz) * NX + toI(px);
          if (plan.room[k] !== room.id || !dn.walk[k]) continue;
          R.stands.push(synth(d, px, pz, it.rot + Math.PI, 'stand', 'shop', room.id, 0));
        }
      }
      // hot tubs
      for (const it of (byRoom.get(room.id) || NONE)) {
        if (it.t !== 'hot_tub') continue;
        for (let a = 0; a < 6; a++) {
          const ang = a / 6 * Math.PI * 2;
          R.seats.push(synth(d, it.x + Math.sin(ang) * 0.95, it.z + Math.cos(ang) * 0.95, ang + Math.PI, 'soak', 'soak', room.id, 0.08));
        }
      }
      // mingling spots on open floor
      if (room.dens !== 'transit' && room.dens !== 'crewtransit' && room.dens !== 'galley' && room.dens !== 'laundry' && !/Jogging/.test(room.name || '')) {
        const n = Math.min(160, Math.floor(room.area / (room.dens === 'casino' || room.dens === 'dining' || room.dens === 'theater' ? 14 : 5)));
        for (let t = 0, m = 0; t < n * 4 && m < n; t++) {
          if ((t & 127) === 127) yield 1;
          const i = room.bi0 + Math.floor(rnd() * (room.bi1 - room.bi0 + 1)), j = room.bj0 + Math.floor(rnd() * (room.bj1 - room.bj0 + 1));
          const k = j * NX + i;
          if (plan.room[k] !== room.id || !dn.walk[k] || dn.cost[k] >= 3) continue;
          // need some free space around (people standing between tables look wrong)
          if (!dn.walk[k + 1] || !dn.walk[k - 1] || !dn.walk[k + NX] || !dn.walk[k - NX] || dn.cost[k + 1] >= SOFTC || dn.cost[k - 1] >= SOFTC || dn.cost[k + NX] >= SOFTC || dn.cost[k - NX] >= SOFTC) continue;
          const x = cellX(i), z = cellZ(j);
          if (R.stands.some(s => Math.abs(s.x - x) < 1.6 && Math.abs(s.z - z) < 1.6)) continue;
          const view = room.exterior && Math.abs(z) > (plan.halfAt(x) - 3);
          R.stands.push(synth(d, x, z, view ? (z > 0 ? 0 : Math.PI) : rnd() * 6.28, 'stand', view ? 'view' : room.pool ? 'swim' : 'mingle', room.id, 0));
          m++;
        }
      }
    }
    yield 2;
    // patrol waypoints: public venues & corridors (passenger decks), crew corridors (crew decks)
    const patrol = [], crewPatrol = [];
    for (const room of plan.rooms) {
      if (!room || room.isVoid || !room.dens || room.cells < 20) continue;
      if (room.zone === 'public' && room.type !== 'stair') {
        const p = this.nav.randomPointInRoom(d, room.id, rnd, 0); if (p) patrol.push({ x: p.x, z: p.z, room: room.id });
        if (room.dens === 'transit' && room.x1 - room.x0 > 40) for (let x = room.x0 + 15; x < room.x1 - 10; x += 30) { const q = this.nav.nearestPoint(d, x, room.cz, 0, 3); if (q && plan.room[q.k] === room.id) patrol.push({ x: q.x, z: q.z, room: room.id }); }
      } else if (room.zone === 'crew' && room.dens === 'crewtransit') {
        const p = this.nav.randomPointInRoom(d, room.id, rnd, ACC.crew); if (p) crewPatrol.push({ x: p.x, z: p.z, room: room.id });
      }
    }
    patrol.sort((a, b) => a.x - b.x); crewPatrol.sort((a, b) => a.x - b.x);
    // spawn / exit anchors (both sides of every door; elevator lobby fronts; stair exits)
    const anchors = [];
    yield 3;
    for (const dr of plan.doors) {
      if (dr.id % 150 === 149) yield 4;
      const nx = dr.normal === 'x' ? 1 : 0, nz = dr.normal === 'z' ? 1 : 0;
      for (const s of [-1, 1]) {
        const x = dr.x + nx * s * 0.75, z = dr.z + nz * s * 0.75;
        const rid = plan.room[toJ(z) * NX + toI(x)]; const room = plan.rooms[rid];
        if (!room || room.isVoid || room.type === 'shaft') continue;
        let kind = 'door';
        if (dr.type === 'elevator') kind = 'elevator';
        else if (dr.type === 'cabin') kind = room.type === 'cabin' || room.type === 'suite' ? 'cabinIn' : 'cabinOut';
        else if (dr.type === 'balcony') continue;
        anchors.push({ x, z, room: rid, kind, door: dr.id, cabin: dr.access?.startsWith('cabin:') ? parseInt(dr.access.slice(6), 10) : 0, crew: room.zone !== 'public' && room.zone !== 'private', yaw: Math.atan2(-nx * s, -nz * s) });
      }
    }
    for (const l of dn.lanes) {
      const x = l.xb - l.dir * 0.8, z = l.zc;
      const rid = plan.room[toJ(z) * NX + toI(x)];
      anchors.push({ x, z, room: rid, kind: 'stair', lane: l, crew: l.crew });
    }
    anchors.sort((a, b) => a.x - b.x);
    const ax = new Float32Array(anchors.map(a => a.x));
    const rooms = [...info.values()];
    const D = { d, plan, dn, info, rooms, anchors, ax, patrol, crewPatrol, galleyDoors: [] };
    // waiter shuttle points: crew doors between galleys and dining rooms
    for (const dr of plan.doors) {
      const [a, b] = dr.rooms.map(id => plan.rooms[id]);
      if (!a || !b) continue;
      const din = a.dens === 'dining' ? a : b.dens === 'dining' ? b : null, gal = a.type === 'galley' ? a : b.type === 'galley' ? b : null;
      if (din && gal) D.galleyDoors.push({ door: dr, dining: din.id, galley: gal.id });
    }
    this.decks[d] = D;
  }

  // build nav + population data for decks around the focus ahead of time, one stage per call
  prebuild() {
    const f = this.sys.focus; if (!f) return;
    for (const d of [f.deck, f.deck + 1, f.deck - 1, f.deck + 2, f.deck - 2]) {
      if (!this.game.world.plans[d] || this.decks[d]) continue;
      if (!this.nav.isBuilt(d)) { this.nav.buildStep(d); return; }
      this.deckStep(d); return;
    }
    // then, in the background, every other deck's nav grid (teleports / elevator rides land on built decks)
    for (let d = 1; d < this.game.world.plans.length; d++) {
      if (!this.game.world.plans[d] || this.nav.isBuilt(d)) continue;
      this.nav.buildStep(d); return;
    }
  }

  // can people in `room` (on an adjacent deck) be seen from deck `fd` through an atrium/theatre well?
  hasWell(D, room, fd) {
    const key = 'well' + fd;
    if (room[key] !== undefined) return room[key];
    let ok = false;
    for (const d of [D.d, fd]) {
      const pl = this.game.world.plans[d]; if (!pl) continue;
      for (const r of pl.rooms) if (r && r.isVoid && r.x0 < room.x1 && r.x1 > room.x0 && r.z0 < room.z1 && r.z1 > room.z0) { ok = true; break; }
      if (ok) break;
    }
    room[key] = ok; return ok;
  }

  anchorsNear(D, x, r0, r1, out) {
    out.length = 0;
    const lo = lowerBound(D.ax, x - r1), hi = lowerBound(D.ax, x + r1);
    for (let i = lo; i < hi; i++) out.push(D.anchors[i]);
    return out;
  }

  // ── main tick ──────────────────────────────────────────────────────────
  update(dt, focus) {
    this.t += dt;
    this.tickT -= dt;
    // detect teleport / big jumps → warm fill
    const lf = this.lastFocus;
    if (!lf || lf.deck !== focus.deck && Math.abs(lf.deck - focus.deck) > 1 || Math.hypot(lf.x - focus.x, lf.z - focus.z) > 35) { this.warm = Math.max(this.warm, 16); if (lf) this.sys.purgeFar(); }
    this.lastFocus = { x: focus.x, z: focus.z, deck: focus.deck };
    if (this.tickT > 0 && !this.warm) return;
    // the focus deck's data is built in stages (a few ms per frame) instead of in one long frame
    if (!this.decks[focus.deck] && this.game.world.plans[focus.deck]) {
      const t0 = performance.now();
      while (!this.decks[focus.deck] && performance.now() - t0 < 2.5) {
        if (!this.nav.isBuilt(focus.deck)) this.nav.buildStep(focus.deck); else this.deckStep(focus.deck);
      }
      return;
    }
    this.tickT = 0.35;
    this.tick(focus);
    if (this.warm) this.warm--;
  }

  tick(focus) {
    const sys = this.sys, h = this.game.hour, cap = sys.cap();
    // adjacent decks join in once their data has been built in the background (prebuild); only the focus deck
    // is ever built synchronously
    const decks = [focus.deck, focus.deck - 1, focus.deck + 1].filter(d => this.game.world.plans[d] && (d === focus.deck || this.decks[d]));
    // reset counts
    for (const d of decks) { const D = this.deck(d); for (const R of D.rooms) { R.count = 0; R.cSeat = 0; R.cStand = 0; R.target = 0; } }
    let staffNow = 0;
    const WIN = 42;
    for (const n of sys.list) {
      if (n.kind === 'staff' || n.kind === 'roamer') { staffNow++; continue; }
      if (n.gone || n.kind !== 'pax') continue;
      if (n.passer || !n.homeRoom) {
        const D = this.decks[n.deck]; const rr = D && D.info.get(D.plan.room[toJ(n.z) * NX + toI(n.x)]);
        if (rr && (rr.room.x1 - rr.room.x0 < 60 || Math.abs(n.x - focus.x) < WIN)) rr.count++;
        continue;
      }
      const R = n.homeRoom;
      if (R.room.x1 - R.room.x0 >= 60 && Math.abs(n.x - focus.x) > WIN) continue;
      R.count++; if (n.useKind === 'seat') R.cSeat++; else R.cStand++;
    }
    // staff first
    const staffCap = Math.floor(cap * 0.34);
    this.fillStaff(decks, focus, h, staffCap, staffNow);
    // ambient targets
    let sum = 0;
    const list = this._list || (this._list = []); list.length = 0;
    const dens = sys.density;
    const shelter = sys.shelter, sched = this.game.schedule;
    // venue pull of running programme events (schedule.attendance), cached per tick per room name
    const attC = this._attC || (this._attC = new Map()); attC.clear();
    const attOf = (room) => {
      if (!sched?.attendance || !room.name) return 0;
      let v = attC.get(room.name);
      if (v === undefined) { try { v = +sched.attendance(room.name) || 0; } catch { v = 0; } v = Math.max(0, Math.min(1, v)); attC.set(room.name, v); }
      return v;
    };
    for (const d of decks) {
      const D = this.deck(d), adj = d !== focus.deck;
      const R0 = adj ? 38 : 72;
      for (const R of D.rooms) {
        const room = R.room;
        const dist = rectDist(room, focus.x, focus.z);
        R.dist = dist + (adj ? 10 : 0);
        if (dist > R0) continue;
        // on adjacent decks only exterior / atrium-ish spaces are visible enough to matter
        if (adj && !(room.exterior ? this.sys.camExterior : this.hasWell(D, room, focus.deck))) continue;
        const occ = occupancy(room, h);
        // bad weather: nobody new heads for the open decks (existing surplus retires)
        if (shelter && room.exterior && !R.crew) { occ.seat = 0; occ.stand = 0; }
        else {
          const att = attOf(room);
          if (att > 0) { occ.seat = Math.min(1, Math.max(occ.seat, att * 0.85)); occ.stand *= Math.min(1.6, 1 + att * 0.6); }
        }
        let closedCap = 1e9;
        const qx = Math.max(room.x0, Math.min(room.x1, focus.x)), qz = Math.max(room.z0, Math.min(room.z1, focus.z));
        const inView = this.sys.inFrustum(d, (qx + room.cx) / 2, (qz + room.cz) / 2) || this.sys.inFrustum(d, room.cx, room.cz);
        // GTA-style: what the player can see right now matters most
        let w = dist < 12 ? 1 : dist < 30 ? 1 - (dist - 12) / 18 * 0.6 : Math.max(0.05, 0.4 * (1 - (dist - 30) / (R0 - 30)));
        if (focus.room === room.id && !adj) w *= 1.6;
        else if (dist > 4) {
          // enclosed rooms we are not in are mostly invisible: keep them light (they fill as we approach)
          const open = room.exterior || room.dens === 'atrium' || room.dens === 'transit' || room.dens === 'shopstreet' || room.dens === 'crewtransit';
          w *= open ? 0.75 : 0.3;
          closedCap = open ? 1e9 : 9;
        }
        if (adj) w *= 0.45;
        w *= inView ? 1.25 : 0.8;
        // long rooms (corridors, promenades, pool decks): only the stretch around the focus counts
        const len = room.x1 - room.x0;
        const frac = len >= 60 ? Math.max(0, Math.min(room.x1, focus.x + WIN) - Math.max(room.x0, focus.x - WIN)) / len : 1;
        let tSeat = R.seats.length * occ.seat * frac, tStand = room.area * occ.stand * frac;
        // after dark the open decks hold a few couples at the rails, crew, and an event crowd only if one is on
        if (room.exterior && !room.pool && isNight(h)) tStand = Math.min(tStand, (attOf(room) > 0 ? 26 : 7) * frac + 1);
        if (room.pool) tStand = Math.min(R.swim.length * 0.8, tStand);
        // stand capacity bounded by spots (no crowds packed into furniture)
        else if (!PASS_DENS.has(room.dens)) tStand = Math.min(tStand, R.stands.length * 1.4 * frac + 1);
        R.tSeat = tSeat * w * dens; R.tStand = tStand * w * dens;
        R.target = R.tSeat + R.tStand;
        if (R.target > closedCap) { const k2 = closedCap / R.target; R.tSeat *= k2; R.tStand *= k2; R.target = closedCap; }
        if (R.target > 0.02 || R.count) { list.push(R); sum += R.target; }
      }
    }
    const ambCap = Math.max(0, cap - Math.min(staffCap, staffNow));
    const k = sum > ambCap ? ambCap / sum : 1;
    this.ambWant = Math.round(Math.min(sum, ambCap)); this.sumTarget = sum;
    for (const R of list) { R.tSeat *= k; R.tStand *= k; R.target *= k; }
    // order by relative deficit, nearest first
    list.sort((a, b) => (b.target - b.count) / (b.target + 1) - (a.target - a.count) / (a.target + 1) || a.dist - b.dist);
    let budget = this.warm ? 7 : 4;
    let ambNow = 0; for (const n of sys.list) if (n.kind === 'pax' && !n.gone && !n.leaving) ambNow++;
    for (const R of list) {
      if (budget <= 0 || sys.list.length >= cap) break;
      if (ambNow >= this.ambWant + 2) { if (R.target - R.count < -1.5 - R.target * 0.25) this.retireOne(R); continue; }
      let def = R.target - R.count;
      // retire surplus
      if (def < -1.5 - R.target * 0.25) { this.retireOne(R); continue; }
      while (def >= 0.6 && budget > 0 && sys.list.length < cap) {
        const seat = R.tSeat - R.cSeat >= R.tStand - R.cStand;
        const n = this.spawnFor(R, seat, focus);
        budget--;
        if (!n) break;
        def -= n.groupSize || 1; ambNow += n.groupSize || 1;
      }
    }
    this.targets = list;
  }

  retireOne(R) {
    let best = null, bt = -1;
    for (const n of this.sys.list) {
      if (n.homeRoom !== R || n.kind !== 'pax' || n.persistent || n.leader || n.state === 'flee') continue;
      const t = n.useT ?? 0;
      if (t > bt) { bt = t; best = n; }
    }
    if (best) this.sys.leave(best);
  }

  // ── ambient spawning ──────────────────────────────────────────────────
  // Spawn a person (or a small group) whose destination is room R.
  spawnFor(R, seat, focus) {
    const sys = this.sys, room = R.room, h = this.game.hour;
    const rnd = sys.rnd;
    const crew = R.crew;
    // open public spaces get a share of strollers walking through (no one stands around in a perfect grid)
    const night = isNight(h);
    const STROLL = { atrium: 0.6, promenade: 0.6, deck: night ? 0.5 : 0.35, pool: night ? 0.45 : 0.25, shopstreet: 1, lounge: 0.15, casino: 0.25, sport: 0.4, club: 0.1, bar: 0.1 };
    const passer = !seat && (room.dens === 'transit' || room.dens === 'crewtransit' || isTrack(room) || rnd() < (STROLL[room.dens] || 0));
    // group composition
    let size = 1, kind = 'solo';
    if (!crew) {
      const r = rnd();
      if (room.dens === 'club' || room.dens === 'bar' || room.dens === 'casino') { if (r < 0.4) { size = 2; kind = 'couple'; } else if (r < 0.6) { size = 3; kind = 'friends'; } }
      else if (room.dens === 'dining' || room.dens === 'buffet') { if (r < 0.45) { size = 2; kind = 'couple'; } else if (r < 0.8) { size = 3 + (rnd() < 0.5 ? 1 : 0); kind = rnd() < 0.5 && h < 21 ? 'family' : 'friends'; } }
      else if (room.dens === 'kids') { size = 2; kind = 'family'; }
      else if (room.exterior && night) { if (r < 0.65) { size = 2; kind = 'couple'; } }
      else if (r < 0.3) { size = 2; kind = 'couple'; } else if (r < 0.42) { size = 3; kind = h > 7 && h < 21 ? 'family' : 'friends'; }
    } else if (rnd() < 0.25) { size = 2; kind = 'friends'; }
    if (sys.list.length + size > sys.cap()) size = 1;
    // choose the destination use (seat / stand / swim) for the leader
    let use = null;
    if (passer) use = null;
    else if (room.pool) use = this.freeOf(R.swim, focus, rnd);
    else if (seat) use = this.freeOf(R.seats, focus, rnd, size);
    else use = this.freeOf(R.stands, focus, rnd, 1, room.exterior && night ? 'view' : null);
    if (!use && !passer) { if (seat && R.stands.length) use = this.freeOf(R.stands, focus, rnd); if (!use) return null; }
    // where does the leader appear?
    const D = this.decks[R.deck];
    let spawn = null, inPlace = false;
    if (use && (this.warm || !sys.seen(R.deck, use.x, deckY(R.deck) + 1, use.z))) { spawn = use; inPlace = true; }
    else if (passer && this.warm) {
      // initial fill: people already mid-stride in the corridor near the focus
      for (let t = 0; t < 10 && !spawn; t++) {
        const q = this.nav.randomPointInRoom(R.deck, room.id, rnd, crew ? ACC.crew : 0, true);
        if (q && Math.abs(q.x - focus.x) < 45) spawn = q;
      }
    }
    if (!spawn && !inPlace) spawn = this.hiddenAnchor(D, focus, crew, passer ? room : null);
    if (!spawn) { if (use && use.taken === -1) use.taken = null; return null; }
    const ids = [];
    const seed = (rnd() * 4294967295) >>> 0;
    const leader = sys.makeAmbient({ seed, crew, deck: R.deck, kind, idx: 0, room, h, dest: room });
    if (!leader) { if (use && use.taken === -1) use.taken = null; return null; }
    leader.homeRoom = R; leader.passer = passer;
    if (passer && isTrack(room) && rnd() < 0.7) { leader.jogger = true; size = 1; } leader.useKind = use ? (use.pose === 'stand' && use.act !== 'eat' ? 'stand' : 'seat') : 'pass';
    ids.push(leader);
    const group = size > 1 ? { id: seed, kind, members: [leader], leader } : null;
    if (group) leader.group = group;
    for (let i = 1; i < size; i++) {
      const m = sys.makeAmbient({ seed: (seed + i * 7919) >>> 0, crew, deck: R.deck, kind, idx: i, room, h, dest: room, group });
      if (!m) break;
      m.homeRoom = R; m.passer = passer; m.useKind = leader.useKind; m.group = group; m.follower = true;
      group.members.push(m); ids.push(m);
    }
    if (group) { leader.groupSize = group.members.length; leader.leader = true; }
    // place them
    if (inPlace) {
      sys.placeAt(leader, R.deck, use.x, use.z);
      sys.beginUse(leader, use, true);
      if (group) this.groupJoin(group, use, true);
    } else {
      sys.placeAt(leader, R.deck, spawn.x, spawn.z, spawn);
      for (let i = 1; i < ids.length; i++) {
        if (spawn.kind === 'stair') { sys.placeAt(ids[i], R.deck, spawn.x, spawn.z, spawn, i); continue; }
        // around the spawn point, on walkable cells only
        let px = spawn.x, pz = spawn.z;
        for (let t = 0; t < 6; t++) { const a = (i / ids.length + t * 0.17) * 6.28; const qx = spawn.x + Math.sin(a) * 0.6, qz = spawn.z + Math.cos(a) * 0.6; if (sys.nav.passable(R.deck, qx, qz, ids[i].mask)) { px = qx; pz = qz; break; } }
        sys.placeAt(ids[i], R.deck, px, pz, spawn);
      }
      if (passer) sys.setPasser(leader, D, focus);
      else sys.goUse(leader, use);
      if (group) for (let i = 1; i < ids.length; i++) sys.followLeader(ids[i]);
      if (group && !passer) this.groupJoin(group, use, false);
    }
    return leader;
  }

  // assign group members uses next to the leader's use
  groupJoin(group, use, inPlace) {
    const sys = this.sys, R = group.leader.homeRoom;
    let k = 0;
    for (const m of group.members) {
      if (m === group.leader) continue;
      k++;
      let u = null;
      if (use.pose === 'sit' || use.pose === 'soak' || use.pose === 'lie') {
        // nearest free seat sharing the same table / sofa cluster
        let bd = use.pose === 'lie' ? 3.2 : 1.9;
        for (const p of R.seats) { if (p.taken || p === use) continue; const d = Math.hypot(p.x - use.x, p.z - use.z); if (d < bd && p.act === use.act) { bd = d; u = p; } }
      }
      if (u) {
        u.taken = m.id;
        if (inPlace) { sys.placeAt(m, use.deck, u.x, u.z); sys.beginUse(m, u, true); }
        else { sys._releasePoi(m); m.pendingUse = u; sys.followLeader(m); }
      } else {
        // conversation cluster: everybody (leader included) stands on a loose circle / arc around a shared
        // centre in front of the leader's spot, facing it; spacing varies with group size and personality
        const n = group.members.length;
        const lr = use.rot || 0, rnd = sys.rnd;
        const cl = group._cl || (group._cl = (() => {
          const rad = use.act === 'dance' ? 0.75 + 0.1 * n : n === 2 ? 0.48 + rnd() * 0.16 : 0.5 + 0.13 * n + rnd() * 0.15;
          const cx = use.x + Math.sin(lr) * rad, cz = use.z + Math.cos(lr) * rad;
          // arc span: pairs face each other (slightly off-axis), trios+ spread over 200–300°
          const span = n === 2 ? Math.PI * (0.82 + rnd() * 0.2) : Math.PI * 2 * Math.min(0.86, 0.5 + 0.07 * n + rnd() * 0.08);
          return { cx, cz, rad, span, a0: lr + Math.PI };       // a0: angle (from centre) of the leader's spot
        })());
        // leader at angle a0; the others continue around the circle, leaving an open side (looks like an arc)
        let a = cl.a0 + (n === 2 ? cl.span : cl.span * k / (n - 1)) + (rnd() - 0.5) * 0.28;
        const rr = cl.rad * (0.9 + rnd() * 0.25);
        let x = cl.cx + Math.sin(a) * rr, z = cl.cz + Math.cos(a) * rr;
        if (!sys.nav.passable(use.deck, x, z, m.mask, m.swim) || !sys.nav.stepOk(use.deck, cl.cx, cl.cz, x, z, m.mask, m.swim)) {
          a += 0.9; x = cl.cx + Math.sin(a) * rr; z = cl.cz + Math.cos(a) * rr;
          if (!sys.nav.passable(use.deck, x, z, m.mask, m.swim)) { x = use.x + (k % 2 ? 0.6 : -0.6); z = use.z; }
        }
        const face = Math.atan2(cl.cx - x, cl.cz - z) + (rnd() - 0.5) * 0.3;
        const spot = { deck: use.deck, x, z, rot: face, pose: use.pose === 'sit' ? 'stand' : use.pose, act: use.act === 'eat' || use.act === 'watch' ? 'mingle' : use.act, room: use.room, synth: true, taken: m.id, h: 0, item: null, temp: true };
        if (use.act === 'swim') spot.act = 'swim';
        if (inPlace) { sys.placeAt(m, use.deck, x, z); sys.beginUse(m, spot, true); }
        else { sys._releasePoi(m); m.pendingUse = spot; sys.followLeader(m); }
      }
    }
    // leader faces the cluster centre when standing
    if (use.pose === 'stand' && group.members.length > 1 && group._cl && (use.act === 'mingle' || use.act === 'view' || use.act === 'dance')) {
      group.leader.faceYaw = Math.atan2(group._cl.cx - use.x, group._cl.cz - use.z) + (sys.rnd() - 0.5) * 0.2;
      if (group.leader.state === 'use' && group.leader.poi === use) group.leader.yaw = group.leader.faceYaw;
    }
    group._cl = null;
  }

  freeOf(arr, focus, rnd, groupSize = 1, pref = null) {
    if (!arr.length) return null;
    let best = null, bs = 1e9;
    const h = this.game.hour, wx = { rain: this.game.weather?.state?.rain ?? 0, shelter: this.sys.shelter };
    for (let t = 0; t < 28; t++) {
      const p = arr[Math.floor(rnd() * arr.length)];
      if (p.taken) continue;
      const room = this.game.world.plans[p.deck]?.rooms[p.room];
      if (room && room.exterior && !activityFits(p, room, h, wx)) continue;
      let s = Math.hypot(p.x - focus.x, p.z - focus.z) * (p.deck === focus.deck ? 1 : 1.5) + rnd() * 14;
      // GTA trick: fill what the camera looks at first (they walk in from hidden spawns)
      if (this.sys.inFrustum(p.deck, p.x, p.z)) s -= 14;
      if (pref && p.act !== pref) s += 25;
      if (groupSize > 1 && p.pose === 'sit' && p.item?.t !== 'chair' && p.item?.t !== 'sofa' && p.item?.t !== 'sofa_long' && p.item?.t !== 'armchair') s += 10;
      if (s < bs) { bs = s; best = p; }
    }
    if (best) best.taken = -1;   // provisional reservation; claimed by beginUse/goUse
    return best;
  }

  // an anchor out of the camera's sight, 10–65 m from focus, usable by this kind of person
  hiddenAnchor(D, focus, crew, passRoom = null) {
    const sys = this.sys, rnd = sys.rnd;
    const cands = this.anchorsNear(D, focus.x, 8, 66, this._anch || (this._anch = []));
    if (!cands.length) return null;
    const mask = crew ? ACC.crew : 0;
    const fy = deckY(D.d) + 1.2;
    for (let t = 0; t < 22; t++) {
      const a = cands[Math.floor(rnd() * cands.length)];
      const room = D.plan.rooms[a.room]; if (!room) continue;
      if (!crew && (room.zone === 'crew' || room.zone === 'restricted')) continue;
      if (crew && room.zone !== 'crew' && room.zone !== 'restricted') continue;   // crew appear from crew spaces only
      if (a.kind === 'cabinIn' && crew) continue;
      if (!crew && sys.shelter && room.exterior && t < 20) continue;
      if (passRoom && t < 16 && a.room !== passRoom.id && !(a.door !== undefined && D.plan.doors[a.door]?.rooms.includes(passRoom.id))) continue;
      const d = Math.hypot(a.x - focus.x, a.z - focus.z);
      if (d < 7 || d > 68) continue;
      if (sys.seen(D.d, a.x, fy, a.z)) continue;
      if (!this.nav.passable(D.d, a.x, a.z, mask | (a.kind === 'cabinIn' ? 128 : 0))) continue;
      return a;
    }
    return null;
  }

  // a far exit for passers / leavers: elevator lobby, stairs, cabin door, or venue door well away
  exitFor(n, D, focus) {
    const rnd = this.sys.rnd;
    // through-walkers head for the far side of the focus so they cross the player's view
    const through = n.passer && !n.leaving && focus && Math.abs(n.x - focus.x) > 6;
    const cx = through ? focus.x + (focus.x - n.x) * 0.8 : n.x;
    const cands = this.anchorsNear(D, cx, 0, through ? 40 : 75, this._ex || (this._ex = []));
    let best = null, bs = -1e9;
    for (let t = 0; t < 24 && cands.length; t++) {
      const a = cands[Math.floor(rnd() * cands.length)];
      if (a.kind === 'cabinIn') continue;
      if (a.kind === 'cabinOut' && (n.kind !== 'pax' || !n.identity.cabin || rnd() < 0.3)) {
        if (n.kind !== 'pax') continue;
      }
      const room = D.plan.rooms[a.room]; if (!room) continue;
      if (n.mask === 0 && (room.zone === 'crew' || room.zone === 'restricted')) continue;
      if (a.crew && !(n.mask & ACC.crew)) continue;
      if (n.offDuty && !a.crew && a.kind !== 'stair' && a.kind !== 'elevator') continue;
      const dd = Math.hypot(a.x - n.x, a.z - n.z);
      if (dd < 12) continue;
      let s = Math.min(dd, 55) + rnd() * 25 + (a.kind === 'elevator' || a.kind === 'stair' ? 12 : 0) + (a.kind === 'cabinOut' ? 8 : 0);
      if (n.passer && n.homeRoom && (a.room === n.homeRoom.id || (a.door !== undefined && D.plan.doors[a.door]?.rooms.includes(n.homeRoom.id)))) s += 45;
      if (through && (a.x - focus.x) * (n.x - focus.x) < 0) s += 40;
      if (n.kind === 'pax' && n.own && a.cabin === n.own) s += 60;
      if (s > bs) { bs = s; best = a; }
    }
    return best;
  }

  // ── staff ─────────────────────────────────────────────────────────────
  fillStaff(decks, focus, h, staffCap, staffNow) {
    const sys = this.sys;
    let budget = this.warm ? 4 : 3;
    // posts within range
    for (const d of decks) {
      if (budget <= 0 || staffNow >= staffCap) break;
      const D = this.deck(d), adj = d !== focus.deck;
      const R0 = adj ? 30 : 62;
      for (const R of D.rooms) {
        if (!R.staff.length || R.dist > R0 + 10) continue;
        for (const p of R.staff) {
          if (budget <= 0 || staffNow >= staffCap) break;
          if (p.taken) continue;
          const dist = Math.hypot(p.x - focus.x, p.z - focus.z);
          if (dist > R0) continue;
          if (adj && !R.room.exterior) continue;
          if (!staffOn(R.room, p.role, h)) continue;
          // only half the dealer tables / clerk desks are manned off-peak
          const seedK = hash32('post', d, p.x.toFixed(1), p.z.toFixed(1));
          if ((p.role === 'clerk' || p.role === 'dealer' || p.role === 'cook' || p.role === 'laundry') && (seedK % 100) / 100 > 0.35 + 0.65 * busyFor(R.room, h)) continue;
          const n = sys.spawnStaff(p, R, seedK, focus);
          if (n) { staffNow++; budget--; }
        }
      }
      // roaming crew on this deck
      if (!adj) staffNow += this.fillRoamers(D, focus, h, Math.min(budget, staffCap - staffNow));
    }
  }

  fillRoamers(D, focus, h, budget) {
    if (budget <= 0) return 0;
    const sys = this.sys, d = D.d;
    let made = 0;
    const want = [];
    const pub = D.plan.rooms.some(r => r && r.zone === 'public' && r.dens && r.dens !== 'transit');
    const crewDeck = d <= 3;
    // security patrols
    const nPatrol = crewDeck ? 2 : pub ? 3 : 2;
    for (let i = 0; i < nPatrol; i++) want.push(['patrol', i]);
    // stewards on accommodation decks during the day
    if (D.plan.cabins.some(c => !c.crew) && h >= 8 && h < 17) for (let i = 0; i < 3; i++) want.push(['steward', i]);
    // waiters in open dining rooms
    for (const g of D.galleyDoors) {
      const room = D.plan.rooms[g.dining];
      if (rectDist(room, focus.x, focus.z) > 45) continue;
      const occ = occupancy(room, h).seat;
      if (occ < 0.08) continue;
      const nW = Math.min(9, Math.max(2, Math.round(occ * 11)));
      for (let i = 0; i < nW; i++) want.push(['waiter', g.dining * 10 + i, g]);
    }
    // deckhands / cleaners on exterior decks by day, lifeguards at pools
    if (D.plan.rooms.some(r => r && EXT_TYPES.has(r.type))) {
      if (h >= 6 && h < 20) for (let i = 0; i < 2; i++) want.push(['deckhand', i]);
      else for (let i = 0; i < 2; i++) want.push(['deckhand', 10 + i]);       // night crew: stacking loungers, hosing down
      if (D.plan.rooms.some(r => r && r.pool && r.exterior !== false) && h >= 8 && h < 19.5) want.push(['lifeguard', 0]);
    }
    // night cleaners in passenger corridors and public rooms
    if (!crewDeck && (h >= 23.5 || h < 6.5) && pub) for (let i = 0; i < 2; i++) want.push(['cleaner', i]);
    for (const w of want) {
      if (made >= budget) break;
      const key = d + ':' + w[0] + ':' + w[1];
      if (sys.roamers.has(key)) continue;
      const n = sys.spawnRoamer(w[0], D, key, focus, w[2]);
      if (n) made++;
    }
    return made;
  }
}

function busyFor(room, h) {
  const o = occupancy(room, h); return Math.min(1, o.seat * 1.4 + o.stand * 20);
}

const SOFTC = 8;
const NONE = [];
function synth(deck, x, z, rot, pose, act, room, hh) { return { deck, x, z, rot, pose, act, role: null, room, item: null, taken: null, h: hh, synth: true }; }
function rectDist(r, x, z) { const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1); return Math.hypot(dx, dz); }
function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
