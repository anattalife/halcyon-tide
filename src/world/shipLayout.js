// Generates the complete general arrangement of MS Halcyon Tide: 17 decks of rooms,
// corridors, cabins, venues, crew & technical spaces, stair/elevator cores and furniture.
import { SHIP, CORES, CREW_CORES, deckY, GRID, toI, toJ, idx } from '../core/config.js';
import { Rng, hash32 } from '../core/util.js';
import { DeckPlan, CEIL } from './plan.js';
import { FDEF } from './furnitureDefs.js';
import { deckHalfFn, superLimits } from './hullShape.js';

let rng = new Rng(1);
const ang = (du, dv, side) => Math.atan2(du, dv * side);

// ═════════════════════════════════════════════════════════════════════════════
//  CORES
// ═════════════════════════════════════════════════════════════════════════════
function passengerCore(p, core, { lobbyType = 'lobby', zHalf = 8.5, crewOnly = false } = {}) {
  const d = p.deck, cx = core.x;
  const lobby = p.addRoom(crewOnly ? 'crew_corridor' : lobbyType, { name: `${core.label} Stair Lobby · Deck ${d}`, core: core.id, isLobby: true });
  p.fill(lobby, cx - 7, cx + 7, -zHalf, zHalf);
  const st = stairs(p, core, cx, lobby, crewOnly ? 'crew' : 'public');
  const cars = [];
  for (const side of [1, -1]) for (let k = 0; k < 4; k++) {
    const id = `${core.id}-${side > 0 ? 'S' : 'P'}${k + 1}`;
    const sh = p.addRoom('shaft', { name: `Elevator ${id}`, car: id, core: core.id });
    const xa = cx - 5 + 2.5 * k;
    p.fill(sh, xa, xa + 2.5, side > 0 ? 6 : -8.5, side > 0 ? 8.5 : -6);
    cars.push({ id, room: sh, xa, side });
  }
  for (const c of cars) p.connect(c.room, lobby, { type: 'elevator', w: 1.5, extra: { car: c.id, core: core.id }, quiet: true });
  p.cores.push({ core: core.id, kind: 'passenger', lobby: lobby.id, cars: cars.map(c => c.id), x: cx });
  // deck directory sign facing the elevators
  p.sign(`DECK ${d}`, cx + 6.9, 0, -Math.PI / 2, { y: 2.1, w: 1.6, style: 'deck', sub: core.label.toUpperCase() });
  p.item('plant', cx - 6.4, 4.4, 0); p.item('plant', cx - 6.4, -4.4, 0);
  p.item('camera', cx + 6.7, zHalf - 0.4, Math.PI);
  return { lobby, x: cx, ...st };
}

function stairs(p, core, cx, lobby, zone) {
  const d = p.deck;
  const even = d % 2 === 0;
  const xs0 = cx - 2.5, xs1 = cx + 3;
  const dir = even ? 1 : -1;
  const xb = dir > 0 ? xs0 : xs1, xt = dir > 0 ? xs1 : xs0;
  const upZ = even ? [-2, 0] : [0, 2], dnZ = even ? [0, 2] : [-2, 0];
  let up = null, dn = null;
  if (d < core.maxDeck) {
    up = p.addRoom('stair', { name: 'Stairs (up)', ramp: { xb, xt, dy: 3 }, role: 'up', core: core.id, zone: zone === 'crew' ? 'crew' : 'public' });
    p.fill(up, xs0, xs1, upZ[0], upZ[1]);
    p.open(lobby, up);
  } else {
    const cl = p.addRoom('service', { name: 'Stair Store' }); p.fill(cl, xs0, xs1, upZ[0], upZ[1]);
  }
  if (d > core.minDeck) {
    dn = p.addRoom('stair', { name: 'Stairs (down)', ramp: { xb, xt, dy: -3 }, role: 'down', core: core.id, zone: zone === 'crew' ? 'crew' : 'public' });
    p.fill(dn, xs0, xs1, dnZ[0], dnZ[1]);
    p.open(lobby, dn);
  } else {
    const cl = p.addRoom('service', { name: 'Stair Store' }); p.fill(cl, xs0, xs1, dnZ[0], dnZ[1]);
  }
  // Seal the far end of the flights (the cliff side)
  p.wall('x', xt, -2, 2);
  return { up, dn };
}

function crewCore(p, core) {
  const d = p.deck, cx = core.x;
  const lob = p.addRoom('crew_corridor', { name: `Crew Stairs ${core.id.toUpperCase()} · Deck ${d}`, core: core.id, isLobby: true });
  p.fill(lob, cx - 4.5, cx + 7.5, -3.5, 3.5);
  stairs(p, core, cx, lob, 'crew');
  const sh = p.addRoom('shaft', { name: `Service Lift ${core.id}`, car: `svc-${core.id}`, core: core.id, zone: 'crew' });
  p.fill(sh, cx + 5.5, cx + 7.5, 1.5, 3.5);
  p.connect(sh, lob, { type: 'elevator', w: 1.0, extra: { car: `svc-${core.id}`, core: core.id }, quiet: true });
  p.cores.push({ core: core.id, kind: 'crew', lobby: lob.id, cars: [`svc-${core.id}`], x: cx });
  return lob;
}

function layCores(p, opts = {}) {
  const out = { pax: {}, crew: {} };
  for (const c of CORES) if (p.deck >= c.minDeck && p.deck <= c.maxDeck) out.pax[c.id] = passengerCore(p, c, opts[c.id] || opts.all || {});
  for (const c of CREW_CORES) if (p.deck >= c.minDeck && p.deck <= c.maxDeck && !(opts.skipCrew || []).includes(c.id)) out.crew[c.id] = crewCore(p, c);
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CABINS
// ═════════════════════════════════════════════════════════════════════════════
const counters = {};
function nextCabinNo(d, side) {
  const k = d + ':' + side;
  counters[k] = (counters[k] ?? (side > 0 ? -1 : 0)) + 2;
  return d * 1000 + counters[k];
}

function overlaps(a, b, res) { for (const r of res) if (a < r[1] - 0.01 && b > r[0] + 0.01) return r; return null; }

function cabinRow(p, o) {
  // o: xa, xb, zIn, zOut, side, kind ('balcony'|'ocean'|'inside'|'suite'|'crew'), corr, reserved, width
  const width = o.width ?? 3.5;
  const out = [];
  let x = o.xb;
  while (x - width >= o.xa - 0.01) {
    const a = x - width, b = x;
    const r = overlaps(a, b, o.reserved || []);
    if (r) { x = Math.min(x - 0.5, r[0]); x = Math.round(x * 2) / 2; continue; }
    const hw = Math.min(p.halfAt(a + 0.3), p.halfAt(b - 0.3));
    if (hw < o.zIn + (o.kind === 'crew' ? 3 : 4.2)) { x -= width; continue; }
    out.push(makeCabin(p, a, b, o, hw));
    x -= width;
  }
  return out;
}

function makeCabin(p, a, b, o, hw) {
  const { side, kind } = o;
  const crew = kind === 'crew';
  const rev = !!o.corrAtOut;                 // inside cabins: corridor on the outboard edge
  const zOut = Math.min(o.zOut, hw);
  const zIn = o.zIn;
  const D = zOut - zIn, W = b - a;
  const zC = rev ? zOut : zIn, dv = rev ? -1 : 1;  // corridor boundary & direction into the cabin
  const no = crew ? null : nextCabinNo(p.deck, side);
  const crewNo = crew ? `C${p.deck}-${String(p.cabinsCrew = (p.cabinsCrew || 0) + 1).padStart(3, '0')}` : null;
  const type = crew ? 'crew_cabin' : kind === 'suite' ? 'suite' : 'cabin';
  const room = p.addRoom(type, { name: crew ? `Crew Cabin ${crewNo}` : `${kind === 'suite' ? 'Suite' : 'Stateroom'} ${no}`, cabin: no || crewNo, cabinKind: kind });
  p.fill(room, a, b, side > 0 ? zIn : -zOut, side > 0 ? zOut : -zIn);
  const W2 = (u, v) => [a + u, side * (zC + dv * v)];
  const doorU = kind === 'suite' ? 3.0 : crew ? 1.5 : 2.4;
  const door = p.connect(room, o.corr, { type: crew ? 'crew' : 'cabin', w: 1.0, near: W2(doorU, 0), access: crew ? 'crew' : `cabin:${no}`, label: String(no || crewNo), quiet: true, locked: true });
  let bal = null;
  if ((kind === 'balcony' || kind === 'suite') && hw >= (o.zOut + 1.6)) {
    bal = p.addRoom('balcony', { name: `Balcony ${no}`, cabin: no });
    p.fill(bal, a, b, side > 0 ? o.zOut : -hw, side > 0 ? hw : -o.zOut);
    p.connect(room, bal, { type: 'balcony', w: Math.min(2.0, W - 1.2), near: W2(W / 2 + 0.2, D), access: `cabin:${no}`, quiet: true });
  }
  const it = (t, u, v, du, dvv, ex) => { const [x, z] = W2(u, v); return p.item(t, x, z, ang(du, dvv * dv, side), ex); };
  if (crew) {
    it('bunk', 0.5, 2.3, 0, 1);
    it('locker', W - 0.25, 0.55, -1, 0); it('locker', W - 0.25, 1.05, -1, 0);
    if (D > 3.8) { it('desk', W - 0.3, D - 0.75, -1, 0, { w: 1.0 }); it('chair', W - 0.9, D - 0.75, 1, 0); }
  } else if (kind === 'suite') {
    it('bath_pod', 1.0, 1.0, 1, 0, { w: 2.0, d: 2.0 });
    it('wardrobe', W - 0.3, 1.0, -1, 0); it('wardrobe', W - 0.3, 2.05, -1, 0);
    it('bed_q', 1.025, 3.6, 1, 0, { w: 1.8 });
    it('tv', W - 0.04, 3.6, -1, 0);
    it('vanity', W - 0.24, 5.0, -1, 0); it('chair', W - 0.75, 5.0, 1, 0);
    it('sofa_long', 4.1, D - 0.5, 0, -1); it('table_low', 4.1, D - 1.5, 0, 1);
    it('armchair', 1.7, D - 1.35, 1, -0.3); it('table_r', 5.6, 4.6, 0, 1); it('chair', 5.6, 4.0, 0, 1); it('chair', 5.6, 5.2, 0, -1);
    it('plant', 0.45, D - 0.45, 0, 1);
    if (bal) { it('lounger', 1.2, D + 1.2, 0, 1); it('lounger', 2.2, D + 1.2, 0, 1); it('deck_chair', W - 1.4, D + 1.1, 0, 1); it('deck_chair', W - 2.4, D + 1.1, 0, 1); it('table_sq', W - 1.9, D + 0.95, 0, 1); }
    if (no % 3 === 0) it('safe', W - 0.3, 1.55, -1, 0);
  } else {
    it('bath_pod', 0.85, 1.0, 1, 0);
    it('wardrobe', W - 0.3, 1.25, -1, 0);
    const bv = D > 6 ? 3.3 : 3.15;
    it('bed_q', 1.025, bv, 1, 0);
    it('desk', W - 0.28, bv, -1, 0);
    it('office_chair', W - 0.95, bv, 1, 0);
    it('tv', W - 0.04, bv + 0.65, -1, 0);
    if (D > 6) {
      it('sofa', W / 2, D - 0.5, 0, -1);
      it('table_low', W / 2, D - 1.45, 0, 1);
    } else if (D > 4.6) it('armchair', W - 0.6, D - 0.5, -0.6, -1);
    if (bal) { it('deck_chair', 0.8, D + 1.05, 0, 1); it('deck_chair', W - 0.8, D + 1.05, 0, 1); it('table_sq', W / 2, D + 1.0, 0, 1, { w: 0.6, d: 0.6 }); }
    if (no % 4 === 1) it('safe', W - 0.3, 0.45, -1, 0);
    if (rng.chance(0.35)) it('luggage', 1.6 + rng.range(-0.1, 0.4), bv + 1.2, rng.range(-1, 1), 1);
  }
  const cab = { no: no || crewNo, deck: p.deck, side, kind, room: room.id, door: door ? door.id : -1, x: (a + b) / 2, z: side * (zIn + D / 2), balcony: bal ? bal.id : -1, crew,
    doorX: W2(doorU, 0)[0], doorZ: W2(doorU, 0)[1], inX: W2(doorU, 1.2)[0], inZ: W2(doorU, 1.2)[1] };
  p.cabins.push(cab);
  return cab;
}

// ═════════════════════════════════════════════════════════════════════════════
//  FURNISHING HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function diningTables(p, x0, x1, z0, z1, { spacing = 3.0, kind = 'r', rows = null, rot = 0 } = {}) {
  for (let x = x0 + spacing / 2; x <= x1 - spacing / 2 + 0.01; x += spacing) {
    for (let z = z0 + spacing / 2; z <= z1 - spacing / 2 + 0.01; z += spacing) {
      const r = p.roomAt(x, z); if (!r || r.isVoid) continue;
      // the whole set (table + chairs) must fit inside one room, clear of cores, wells and walls
      const set = [];
      if (kind === 'r') {
        set.push(['table_r', x, z, 0]);
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; set.push(['chair', x + Math.sin(a) * 0.78, z + Math.cos(a) * 0.78, a + Math.PI]); }
      } else if (kind === 'big') {
        set.push(['table_r_big', x, z, 0]);
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; set.push(['chair', x + Math.sin(a) * 1.15, z + Math.cos(a) * 1.15, a + Math.PI]); }
      } else if (kind === 'sq2') {
        set.push(['table_sq', x, z, 0], ['chair', x, z - 0.68, 0], ['chair', x, z + 0.68, Math.PI]);
      } else if (kind === 'rect') {
        set.push(['table_rect', x, z, rot]);
        for (const s of [-1, 1]) for (const o of [-0.45, 0.45]) set.push(['chair', x + o, z + s * 0.7, s > 0 ? Math.PI : 0]);
      } else if (kind === 'lounge') {
        set.push(['table_low', x, z, 0, { w: 0.8, d: 0.8 }], ['armchair', x - 0.95, z, Math.PI / 2], ['armchair', x + 0.95, z, -Math.PI / 2]);
        if (rng.chance(0.5)) set.push(['armchair', x, z + 0.95, Math.PI]);
      } else if (kind === 'cocktail') {
        set.push(['table_r', x, z, 0, { w: 0.6, d: 0.6 }], ['chair', x - 0.6, z, Math.PI / 2], ['chair', x + 0.6, z, -Math.PI / 2]);
      }
      if (set.every(([t, a, b, c, e]) => p.fits(t, a, b, c, e?.w, e?.d, -0.25))) for (const [t, a, b, c, e] of set) p.item(t, a, b, c, e || {});
    }
  }
}

function barCounter(p, x, z, len, rot, { stools = true, back = true, role = 'bartender' } = {}) {
  // rot: direction the customer side faces (local +Z = customer side)
  const c = Math.cos(rot), s = Math.sin(rot);
  p.item('bar_counter', x, z, rot, { w: len, act: 'drink' });
  if (back) p.item('back_bar', x - s * 1.55, z - c * 1.55, rot, { w: len });
  const nStool = Math.floor(len / 0.75);
  if (stools) for (let k = 0; k < nStool; k++) {
    const o = -len / 2 + 0.38 + k * (len - 0.76) / Math.max(1, nStool - 1);
    p.item('stool', x + c * o + s * 0.75, z - s * o + c * 0.75, rot + Math.PI, { act: 'drink' });
  }
  // bartender work spots behind the counter
  for (const o of [-len / 4, len / 4]) p.item('post', x + c * o - s * 0.8, z - s * o - c * 0.8, rot, { role, act: 'work' });
}

function theaterSeats(p, x0, x1, z0, z1, facing, rowGap = 1.0, aisleEvery = 12) {
  // facing: +1 seats face +x, -1 face -x
  const rot = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
  for (let x = x0; x <= x1; x += rowGap) {
    let n = 0;
    for (let z = z0; z <= z1; z += 0.56) {
      n++;
      if (n % (aisleEvery + 1) === 0) continue;
      const r = p.roomAt(x, z); if (!r || r.isVoid || r.type === 'stair') continue;
      p.itemFit('theater_seat', x, z, rot, { act: 'watch' });
    }
  }
}

function loungerRows(p, x0, x1, z0, z1, { rot = 0, dx = 1.0, dz = 2.6 } = {}) {
  for (let x = x0; x <= x1; x += dx) for (let z = z0; z <= z1; z += dz) {
    const r = p.roomAt(x, z); if (!r || !r.exterior || r.pool) continue;
    p.item('lounger', x, z, rot, { act: 'sunbathe' });
  }
}

function slotBank(p, x0, x1, z, rot) {
  for (let x = x0; x <= x1; x += 0.78) p.itemFit('slot', x, z, rot, { act: 'gamble' });
}

function shelves(p, x0, x1, z, rot) { for (let x = x0; x <= x1 - 2; x += 2.3) p.itemFit('shelf', x + 1, z, rot, { act: 'shop' }); }

// Subdivide a band into rooms connecting to a corridor.
function bandRooms(p, list, corr, z0, z1, doorZ) {
  const made = [];
  for (const spec of list) {
    const [x0, x1, type, name, extra = {}] = spec;
    const r = p.addRoom(type, { name, ...extra });
    const n = p.fill(r, x0, x1, z0, z1, extra.onlyEmpty ? { onlyEmpty: true } : {});
    if (!n) continue;
    if (corr) p.connect(r, corr, { type: extra.door || (r.zone === 'public' ? 'glass' : 'crew'), w: extra.doorW || (r.zone === 'public' ? 1.8 : 1.0), access: r.zone === 'public' ? 'none' : r.zone === 'restricted' ? (extra.access || 'officer') : 'crew', near: [(x0 + x1) / 2, doorZ], quiet: true, label: name });
    made.push(r);
  }
  return made;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT DRESSING HELPERS
//  put() places an item only when it fits its room, keeps clear of doors and does not
//  overlap anything already placed. Wall scans (wallSegs) need the plan's edge arrays,
//  so wall/ceiling dressing runs in a post-finalize pass (dressDeck) followed by a re-finalize.
// ═════════════════════════════════════════════════════════════════════════════
const NO_OVERLAP = new Set(['post', 'standing', 'rail_spot', 'camera', 'floor_stripe', 'floor_mark', 'aisle_light']);
const DECAL = new Set(['floor_stripe', 'floor_mark', 'aisle_light']);
const ceilOf = (r) => (r.ceil === CEIL.none ? 2.95 : (r.ceilH ?? 2.5));
function fpHalf(t, rot, w, d) {
  const def = FDEF[t]; const W = (w ?? def.w) / 2, D = (d ?? def.d) / 2;
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  return [c * W + s * D, s * W + c * D];
}
// does an axis-aligned box (centre x,z; half extents hx,hz) come within m of any door opening?
function nearDoor(p, x, z, hx, hz, m = 0.9) {
  for (const d of p.doors) {
    let x0, x1, z0, z1;
    if (d.normal === 'x') { x0 = d.line - m; x1 = d.line + m; z0 = d.a0 - 0.25; z1 = d.a1 + 0.25; }
    else { z0 = d.line - m; z1 = d.line + m; x0 = d.a0 - 0.25; x1 = d.a1 + 0.25; }
    if (x + hx > x0 && x - hx < x1 && z + hz > z0 && z - hz < z1) return true;
  }
  return false;
}
function hitsItems(p, x, z, hx, hz, pad = 0.05) {
  for (const it of p.items) {
    if (NO_OVERLAP.has(it.t) || FDEF[it.t].wallY || (it.y || 0) > 1.2) continue;
    const [ihx, ihz] = fpHalf(it.t, it.rot, it.w, it.d);
    if (Math.abs(it.x - x) < hx + ihx + pad && Math.abs(it.z - z) < hz + ihz + pad) return true;
  }
  return false;
}
function put(p, t, x, z, rot = 0, ex = {}, o = {}) {
  const [hx, hz] = fpHalf(t, rot, ex.w, ex.d);
  if (o.fit !== false && !p.fits(t, x, z, rot, ex.w, ex.d, o.margin ?? 0.04)) return null;
  if (o.door !== 0 && nearDoor(p, x, z, hx, hz, o.door ?? 0.9)) return null;
  if (o.items !== false && !DECAL.has(t) && hitsItems(p, x, z, hx, hz, o.pad ?? 0.05)) return null;
  if (inLane(o.lanes, x, z, hx, hz)) return null;
  return p.item(t, x, z, rot, ex);
}
// all-or-nothing group placement (table + chairs, banquette + table …): [[t,x,z,rot,ex], …]
const inLane = (lanes, x, z, hx, hz) => !!lanes && lanes.some(([x0, x1, z0, z1]) => x + hx > x0 && x - hx < x1 && z + hz > z0 && z - hz < z1);
function putSet(p, set, o = {}) {
  for (const [t, x, z, rot = 0, ex = {}] of set) {
    const [hx, hz] = fpHalf(t, rot, ex.w, ex.d);
    if (inLane(o.lanes, x, z, hx, hz)) return false;
    if (!p.fits(t, x, z, rot, ex.w, ex.d, o.margin ?? -0.2)) return false;
    if (nearDoor(p, x, z, hx, hz, o.door ?? 1.0)) return false;
    if (hitsItems(p, x, z, hx, hz, o.pad ?? 0.1)) return false;
  }
  for (const [t, x, z, rot = 0, ex = {}] of set) p.item(t, x, z, rot, ex);
  return true;
}
// Solid wall runs bounding room rid along a grid line.
//   axis 'z': wall at z = line, s = +1 when the wall is on the room's +z side; runs span x ∈ [a0,a1]
//   axis 'x': wall at x = line, s = +1 when the wall is on the room's +x side; runs span z
function wallSegs(p, rid, axis, line, s, a0, a1) {
  const out = []; let cur = null;
  const step = GRID.cell;
  for (let a = a0 + step / 2; a < a1; a += step) {
    let ok = false;
    if (axis === 'z') {
      const i = toI(a), jin = toJ(line - s * 0.25);
      if (i > 0 && i < GRID.nx && jin > 0 && jin < GRID.nz - 1 && p.room[idx(i, jin)] === rid) { const e = s > 0 ? p.ez[idx(i, jin)] : p.ez[idx(i, jin - 1)]; ok = e === 1 || e === 4; }
    } else {
      const j = toJ(a), iin = toI(line - s * 0.25);
      if (j > 0 && j < GRID.nz && iin > 0 && iin < GRID.nx - 1 && p.room[idx(iin, j)] === rid) { const e = s > 0 ? p.ex[idx(iin, j)] : p.ex[idx(iin - 1, j)]; ok = e === 1 || e === 4; }
    }
    if (ok) { if (!cur) cur = [a - step / 2, a + step / 2]; else cur[1] = a + step / 2; }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
// Wall-mounted item centred at along-wall coordinate a on a wall line (faces into the room).
function wallItem(p, t, axis, line, s, a, ex = {}) {
  const d = FDEF[t].d, off = 0.07 + d / 2 + 0.01;
  if (axis === 'z') return p.item(t, a, line - s * off, s > 0 ? Math.PI : 0, ex);
  return p.item(t, line - s * off, a, s > 0 ? -Math.PI / 2 : Math.PI / 2, ex);
}
// Floor item backed against a wall line (front faces into the room); checked with put().
function wallFloor(p, t, axis, line, s, a, ex = {}, o = {}) {
  const d = ex.d ?? FDEF[t].d, off = 0.07 + d / 2 + 0.03;
  if (axis === 'z') return put(p, t, a, line - s * off, s > 0 ? Math.PI : 0, ex, o);
  return put(p, t, line - s * off, a, s > 0 ? -Math.PI / 2 : Math.PI / 2, ex, o);
}
// Wall kit: walk every solid wall run of the four bounding lines of a room and mount a rhythm of
// wall items picked deterministically from kit (list of types), >= 0.3 m from run ends.
function wallKit(p, r, kit, { sides = [1, 2, 3, 4], seed = 0, gap = 1.6, jitter = 1.4 } = {}) {
  const lines = [['z', r.z1, 1, r.x0, r.x1], ['z', r.z0, -1, r.x0, r.x1], ['x', r.x1, 1, r.z0, r.z1], ['x', r.x0, -1, r.z0, r.z1]];
  let n = 0;
  for (const si of sides) {
    const [axis, line, s, a0, a1] = lines[si - 1];
    for (const [sa, sb] of wallSegs(p, r.id, axis, line, s, a0, a1)) {
      let a = sa + 0.3;
      while (a < sb - 0.3) {
        const h = hash32(seed, Math.round(a * 4), si, r.id);
        const t = kit[h % kit.length], w = FDEF[t].w;
        if (a + w > sb - 0.3) { a += 0.5; continue; }
        wallItem(p, t, axis, line, s, a + w / 2); n++;
        a += w + gap + ((h >>> 5) % 8) / 8 * jitter;
      }
    }
  }
  return n;
}
// The whole footprint of an overhead run lies inside room r (no wall/door edge inside it).
function runInRoom(p, r, x, z, hx, hz) {
  const i0 = toI(x - hx + 0.06), i1 = toI(x + hx - 0.06), j0 = toJ(z - hz + 0.06), j1 = toJ(z + hz - 0.06);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    if (i < 1 || j < 1 || i >= GRID.nx - 1 || j >= GRID.nz - 1 || p.room[idx(i, j)] !== r.id) return false;
    if (i < i1 && p.ex[idx(i, j)]) return false;
    if (j < j1 && p.ez[idx(i, j)]) return false;
  }
  return true;
}
// Overhead services along a straight run (axis x): segments of `seg` metres at line z, hanging
// from the deckhead. Skips stretches over stairs / shafts / voids / rooms with another ceiling height.
function ceilRun(p, t, x0, x1, z, ex = {}, { seg = 6, avoidZ = null } = {}) {
  let n = 0;
  const H = FDEF[t].h;
  for (let x = x0; x + seg <= x1 + 0.01; x += seg) {
    const r = p.roomAt(x + seg / 2, z); if (!r || r.isVoid || r.ramp || r.type === 'shaft' || r.exterior) continue;
    const ch = ceilOf(r);
    const [hx, hz] = fpHalf(t, 0, seg, ex.d);
    if (!runInRoom(p, r, x + seg / 2, z, hx, hz)) continue;
    p.item(t, x + seg / 2, z, 0, { ...ex, w: seg, y: +(ch - H - 0.045).toFixed(3) });
    n++;
  }
  return n;
}
// same along z
function ceilRunZ(p, t, z0, z1, x, ex = {}, { seg = 6 } = {}) {
  const H = FDEF[t].h; let n = 0;
  for (let z = z0; z + seg <= z1 + 0.01; z += seg) {
    const r = p.roomAt(x, z + seg / 2); if (!r || r.isVoid || r.ramp || r.type === 'shaft' || r.exterior) continue;
    const ch = ceilOf(r);
    const [hx, hz] = fpHalf(t, Math.PI / 2, seg, ex.d);
    if (!runInRoom(p, r, x, z + seg / 2, hx, hz)) continue;
    p.item(t, x, z + seg / 2, Math.PI / 2, { ...ex, w: seg, y: +(ch - H - 0.045).toFixed(3) }); n++;
  }
  return n;
}
// painted line along x (6 m decals) where the floor belongs to rooms accepted by test(room)
function stripe(p, x0, x1, z, col, test, { seg = 6, d = 0.08 } = {}) {
  for (let x = x0; x + seg <= x1 + 0.01; x += seg) {
    let ok = true;
    for (let a = x + 0.25; a < x + seg; a += 0.5) { const q = p.roomAt(a, z); if (!q || !test(q)) { ok = false; break; } }
    if (ok) p.item('floor_stripe', x + seg / 2, z, 0, { w: seg, d, col });
  }
}

// open (edge 0) runs from room rid into some other non-void room along a wall line
function openSegs(p, rid, axis, line, s, a0, a1) {
  const out = []; let cur = null; const step = GRID.cell;
  for (let a = a0 + step / 2; a < a1; a += step) {
    let ok = false;
    if (axis === 'z') {
      const i = toI(a), jin = toJ(line - s * 0.25), jout = toJ(line + s * 0.25);
      if (i > 0 && i < GRID.nx && jin > 0 && jout > 0 && jin < GRID.nz - 1 && jout < GRID.nz - 1 && p.room[idx(i, jin)] === rid) {
        const e = s > 0 ? p.ez[idx(i, jin)] : p.ez[idx(i, jout)]; const o = p.rooms[p.room[idx(i, jout)]];
        ok = e === 0 && !!o && o.id !== rid && !o.isVoid && !o.ramp && o.type !== 'shaft';
      }
    }
    if (ok) { if (!cur) cur = [a - step / 2, a + step / 2]; else cur[1] = a + step / 2; }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
const wallItemsNear = (p, x, z, r) => p.items.some(it => FDEF[it.t].wallY && Math.abs(it.x - x) < r && Math.abs(it.z - z) < 0.6);

// ── crew corridors ─────────────────────────────────────────────────────────
function dressCrewCorridor(p, r, { zA, zB, x0, x1, floorKit = true, heavy = false, seed = 1 }) {
  const width = zB - zA;
  const isCorr = (q) => q && q.id === r.id;
  if (width >= 2.9) {
    ceilRun(p, 'cable_tray', x0 + 0.5, x1 - 0.5, zB - 0.42, { v: heavy ? 'hv' : 'std' });
    ceilRun(p, 'pipe_run', x0 + 3.5, x1 - 0.5, zA + 0.4, { v: heavy ? 'mix' : (seed % 2 ? 'water' : 'mix') });
  } else {
    const tubeZ = r.z0 + 1.5, za = zA + 0.35, zb = zB - 0.35;
    ceilRun(p, 'cable_tray', x0 + 0.5, x1 - 0.5, Math.abs(za - tubeZ) > Math.abs(zb - tubeZ) ? za : zb, {});
  }
  stripe(p, x0, x1, zA + 0.28, 'yellow', isCorr); stripe(p, x0, x1, zB - 0.28, 'yellow', isCorr);
  if (width >= 2.9) for (let x = x0 + 8; x < x1 - 4; x += 16) {
    if (!isCorr(p.roomAt(x, (zA + zB) / 2))) continue;
    const fwd = (Math.round(x / 16) % 2) === 0;
    p.item('floor_mark', x, (zA + zB) / 2 + (fwd ? 0.5 : -0.5), fwd ? Math.PI / 2 : -Math.PI / 2, { mark: fwd ? 'fwd' : 'exit' });
  }
  // hatched keep-clear boxes where side alleys / stair lobbies join
  for (const [line, s] of [[zB, 1], [zA, -1]]) for (const [a, b] of openSegs(p, r.id, 'z', line, s, x0, x1)) {
    if (b - a < 1.2) continue;
    p.item('floor_stripe', (a + b) / 2, line - s * 0.62, 0, { w: Math.min(b - a, 6), d: 0.9, col: 'hatch' });
  }
  // wall dressing
  const kit = heavy ? ['poster', 'fire_ext', 'gauge_panel', 'poster', 'notice_board'] : ['poster', 'fire_ext', 'notice_board', 'poster', 'house_phone', 'poster'];
  for (const [line, s] of [[zB, 1], [zA, -1]]) for (const [a, b] of wallSegs(p, r.id, 'z', line, s, x0, x1)) {
    let x = a + 0.35;
    while (x < b - 0.35) {
      const h = hash32(seed, Math.round(x * 2), s + 2);
      const t = kit[h % kit.length], w = FDEF[t].w;
      if (x + w + 0.35 > b) { x += 0.5; continue; }
      if ((b - a > 3.2 || h % 3 === 0) && !wallItemsNear(p, x + w / 2, line, w / 2 + 0.6)) wallItem(p, t, 'z', line, s, x + w / 2);
      x += w + 1.4 + (h >>> 6) % 6 * 0.6;
    }
  }
  if (!floorKit || width < 2.4) return;
  const placed = [];
  const kitF = heavy ? ['roll_cage', 'crate', 'pallet_jack', 'locker_bank', 'roll_cage', 'pallet'] : ['locker_bank', 'roll_cage', 'pallet_jack', 'locker_bank', 'roll_cage', 'crate', 'linen_cart'];
  for (const [line, s] of [[zB, 1], [zA, -1]]) for (const [a, b] of wallSegs(p, r.id, 'z', line, s, x0, x1)) {
    let x = a + 0.9;
    while (x < b - 0.9) {
      const h = hash32(seed + 7, Math.round(x), s + 2);
      const t = kitF[h % kitF.length];
      const rot = t === 'pallet_jack' ? (s > 0 ? Math.PI / 2 : -Math.PI / 2) : (s > 0 ? Math.PI : 0);
      const [hx, hz] = fpHalf(t, rot);
      if (width - 0.14 - 2 * hz < 1.55 || x + 2 * hx + 0.6 > b) { x += 1; continue; }
      const cx = x + hx;
      if ((h >>> 4) % 3 === 0 || placed.some(q => Math.abs(q - cx) < hx + 2.2)) { x += 2.5; continue; }
      const it = put(p, t, cx, line - s * (0.07 + hz + 0.03), rot, {}, { door: 1.1 });
      if (it) { placed.push(cx); x = cx + hx + 5 + (h % 6); } else x += 1.5;
    }
  }
}



// ── generic store: racking backed onto every wall run, double rows down the middle of big rooms,
//    staging kit (pallet jack, roll cages, pallets, forklift) near the doors ─────────────────
function dressStore(p, r, { seed = 3, forklift = false, centre = true } = {}) {
  const W = r.x1 - r.x0, Dz = r.z1 - r.z0;
  if (W < 3 || Dz < 2.4) return;
  const lines = [['z', r.z1, 1, r.x0, r.x1], ['z', r.z0, -1, r.x0, r.x1], ['x', r.x1, 1, r.z0, r.z1], ['x', r.x0, -1, r.z0, r.z1]];
  // long walls first
  const order = W >= Dz ? [0, 1, 2, 3] : [2, 3, 0, 1];
  for (const k of order) {
    const [axis, line, s, a0, a1] = lines[k];
    for (const [sa, sb] of wallSegs(p, r.id, axis, line, s, a0, a1)) {
      for (let a = sa + 1.4; a + 1.35 <= sb + 0.01; a += 2.75) wallFloor(p, 'racking', axis, line, s, a, {}, { door: 1.3, pad: 0.04 });
    }
  }
  // central back-to-back rows along the long axis
  if (centre) {
    const long = W >= Dz ? 'x' : 'z';
    const across = long === 'x' ? Dz : W;
    if (across >= 9.2) {
      const nRows = Math.floor((across - 2 * 3.7 + 2.6) / (2.2 + 2.6));
      const c0 = long === 'x' ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
      for (let q = 0; q < nRows; q++) {
        const off = (q - (nRows - 1) / 2) * 4.8;
        for (const side of [-0.55, 0.55]) {
          const lo = long === 'x' ? r.x0 + 4.5 : r.z0 + 4.5, hi = long === 'x' ? r.x1 - 4.5 : r.z1 - 4.5;
          for (let a = lo + 1.35; a + 1.35 <= hi; a += 2.75) {
            if (long === 'x') put(p, 'racking', a, c0 + off + side, side > 0 ? 0 : Math.PI, {}, { door: 1.5 });
            else put(p, 'racking', c0 + off + side, a, side > 0 ? Math.PI / 2 : -Math.PI / 2, {}, { door: 1.5 });
          }
        }
      }
    }
  }
  // staging kit: just inside each door, offset to one side of the door's approach lane
  let fl = forklift;
  for (const d of p.doors) {
    if (!d.rooms.includes(r.id) || d.type === 'elevator') continue;
    const n = d.normal === 'x' ? [1, 0] : [0, 1];
    const probe = p.roomAt(d.x + n[0] * 0.3, d.z + n[1] * 0.3);
    const sg = probe === r ? 1 : -1;
    const ix = d.x + n[0] * sg * 2.6, iz = d.z + n[1] * sg * 2.6;
    const tx = n[1], tz = n[0];              // along the door line
    const cand = [['pallet_jack', 1.9], ['roll_cage', -1.9], ['roll_cage', -2.9], ['pallet', 3.1]];
    if (fl) cand.unshift(['forklift', -3.4]);
    for (const [t, o] of cand) {
      const rot = d.normal === 'x' ? 0 : Math.PI / 2;
      const it = put(p, t, ix + tx * o, iz + tz * o, rot, {}, { door: 1.0, pad: 0.15 });
      if (it && t === 'forklift') fl = false;
    }
  }
  // overhead tray + yellow aisle lines, wall safety kit
  if (W >= Dz) ceilRun(p, 'cable_tray', r.x0 + 0.5, r.x1 - 0.5, (r.z0 + r.z1) / 2 + 0.6, {}, { seg: Math.max(2, Math.min(6, Math.floor(W - 1))) });
  else ceilRunZ(p, 'cable_tray', r.z0 + 0.5, r.z1 - 0.5, (r.x0 + r.x1) / 2 + 0.6, {}, { seg: Math.max(2, Math.min(6, Math.floor(Dz - 1))) });
  wallKit(p, r, ['fire_ext', 'poster', 'notice_board'], { seed, gap: 6, jitter: 4 });
}

// ── stair stores (closed rooms beside the end-of-run flights) ────────────────
function dressStairStore(p, r) {
  const W = r.x1 - r.x0, cz = (r.z0 + r.z1) / 2;
  if (W < 3) return;
  const zr = r.z1 - 0.07 - 0.55 - 0.02;
  for (let x = r.x0 + 1.45; x + 1.35 <= r.x1 + 0.01; x += 2.75) put(p, 'racking', x, zr, Math.PI, { stock: 'parts' }, { door: 0, margin: 0.02 });
  put(p, 'roll_cage', r.x0 + 0.5, r.z0 + 0.45, 0, { load: 'boxes' }, { door: 0, margin: 0.0 });
  ceilRun(p, 'cable_tray', r.x0 + 0.25, r.x1 - 0.25, r.z0 + 0.35, {}, { seg: Math.floor(W - 0.5) });
}

// ── engine room (one side): catwalk between the gensets, exhaust trunks at the free ends,
//    pipe risers & valve manifolds on the hull side, local control panels, overhead pipe bundles ──
function dressEngineRoom(p, r, s) {
  const inb = s > 0 ? r.z0 : r.z1, outb = s > 0 ? r.z1 : r.z0;    // inboard wall (alley) / hull side
  // catwalk in the gap between the two engines (engines at |z| 7.5 and 14)
  put(p, 'catwalk', -126, s * 10.75, s > 0 ? 0 : Math.PI, { w: 11 }, { pad: 0.02 });
  // exhaust trunks rising from the turbocharger ends
  for (const z of [7.5, 14]) put(p, 'exhaust_trunk', -117.6, s * z, 0, {}, { pad: 0.05 });
  // control & gauge panels along the aft bulkhead and inboard wall
  for (const z of [6, 9.5, 15.5]) put(p, 'control_panel', -149.25, s * z, Math.PI / 2, {});
  for (let x = -146; x < -104; x += 7) put(p, 'valve_manifold', x, outb - s * 0.45, s > 0 ? Math.PI : 0, {}, { pad: 0.1 });
  for (let x = -143.5; x < -104; x += 7) put(p, 'pipe_riser', x, outb - s * 0.4, s > 0 ? Math.PI : 0, {}, { pad: 0.1 });
  for (let x = -136; x < -104; x += 9) put(p, 'pipe_riser', x, inb + s * 0.4, s > 0 ? 0 : Math.PI, {}, { pad: 0.1 });
  put(p, 'locker_bank', -104, inb + s * 0.4, s > 0 ? 0 : Math.PI, { w: 2.7 }, {});
  put(p, 'crate', -146.5, inb + s * 3.2, 0, {});
  // overhead: pipe bundles over the side aisles, cable trays over the catwalk
  ceilRun(p, 'pipe_run', -149, -101.5, inb + s * 2.2, { v: 'mix' });
  ceilRun(p, 'pipe_run', -149, -101.5, outb - s * 2.0, { v: 'water' });
  ceilRun(p, 'cable_tray', -146, -104, s * 10.75, { v: 'hv' });
  ceilRun(p, 'duct', -113, -101.5, s * 4.0, {}, { seg: 5.5 });
  // painted green walkways edged with yellow lines around the machinery
  for (const zc of [inb + s * 2.6, outb - s * 2.55]) {
    stripe(p, -149, -101, zc, 'green', (q) => q === r, { d: 1.6 });
    stripe(p, -149, -101, zc - 0.85, 'yellow', (q) => q === r); stripe(p, -149, -101, zc + 0.85, 'yellow', (q) => q === r);
  }
  // cross-ship pipe runs & ducts every ~9 m (overhead, spanning the room)
  for (const x of [-144.5, -135.5, -116.5, -108.5]) ceilRunZ(p, x % 2 ? 'pipe_run' : 'duct', Math.min(inb, outb) + 0.5, Math.max(inb, outb) - 0.5, x, { v: 'mix' }, { seg: 6 });
  for (const x of [-140, -112]) for (const z of [4.1, 17.6]) p.item('floor_mark', x, s * z, Math.PI / 2, { mark: 'exit' });
  wallKit(p, r, ['gauge_panel', 'poster', 'fire_ext', 'junction', 'notice_board'], { seed: 11 + s, gap: 2.2, jitter: 3 });
}

// ── laundry: rows of washer-extractors & tumble dryers, flatwork ironers, folding tables ──
function dressLaundry(p, r) {
  ceilRun(p, 'pipe_run', 19, 51, 5.4, { v: 'water' }, { seg: 4 });
  ceilRun(p, 'duct', 35, 51, 15.4, {}, { seg: 4 });
  ceilRun(p, 'cable_tray', 19, 35, 15.4, {}, { seg: 4 });
  for (const x of [23.5, 31.5]) put(p, 'ironer', x, 10.2, 0, {}, { pad: 0.05 });
  for (const x of [39.5, 45.5]) { put(p, 'prep_table', x, 10.6, 0, { role: 'laundry' }); }
  for (const [x, z] of [[42.5, 12.6], [48.5, 12.6], [37, 8.2], [27.5, 12.8], [49.5, 8.3]]) put(p, 'roll_cage', x, z, 0, { load: 'linen' }, { pad: 0.2 });
  put(p, 'linen_cart', 44, 8.3, 0, {}, { pad: 0.2 });
  stripe(p, 19, 51, 7.0, 'yellow', (q) => q === r, { seg: 4 }); stripe(p, 19, 51, 13.9, 'yellow', (q) => q === r, { seg: 4 });
  wallKit(p, r, ['poster', 'fire_ext', 'notice_board'], { sides: [3, 4], seed: 5, gap: 2 });
}

// ── galley line: continuous extraction hoods over each cooking line ──────────
function hoodOver(p, x0, x1, z, d = 1.5) {
  const r = p.roomAt((x0 + x1) / 2, z); if (!r) return;
  p.item('galley_hood', (x0 + x1) / 2, z, 0, { w: x1 - x0, d, y: +(ceilOf(r) - FDEF.galley_hood.h - 0.03).toFixed(3) });
}
function dressGalley(p, r, lines, extra = []) {
  for (const [x0, x1, z] of lines) hoodOver(p, x0, x1, z);
  for (const [t, x, z, rot, ex = {}] of extra) put(p, t, x, z, rot, ex, { pad: 0.1 });
  wallKit(p, r, ['poster', 'fire_ext', 'hose_box', 'notice_board'], { seed: 9, gap: 3.5, jitter: 3 });
  ceilRun(p, 'pipe_run', r.x0 + 0.3, r.x1 - 0.3, r.z1 - 0.45, { v: 'water' }, { seg: 4 });
}

// ── dining rooms: mixed 2/4/6/8-tops, booths, window two-tops, columns, waiter stations,
//    planter dividers and a floral centrepiece under a crystal chandelier ──────────────
const CH = 'chair';
function tableSet(kind, x, z, rot = 0) {
  const S = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  const L = (u, v) => [x + u * c + v * s, z - u * s + v * c];
  if (kind === 2) { S.push(['table_sq', x, z, rot]); for (const v of [-0.68, 0.68]) { const [a, b] = L(0, v); S.push([CH, a, b, rot + (v > 0 ? Math.PI : 0)]); } }
  else if (kind === 4) { S.push(['table_r', x, z, 0]); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + rot; S.push([CH, x + Math.sin(a) * 0.8, z + Math.cos(a) * 0.8, a + Math.PI]); } }
  else if (kind === 6) { S.push(['table_r_big', x, z, 0, { w: 1.5, d: 1.5 }]); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + rot; S.push([CH, x + Math.sin(a) * 1.1, z + Math.cos(a) * 1.1, a + Math.PI]); } }
  else if (kind === 8) { S.push(['table_r_big', x, z, 0, { w: 1.9, d: 1.9 }]); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + rot; S.push([CH, x + Math.sin(a) * 1.3, z + Math.cos(a) * 1.3, a + Math.PI]); } }
  else if (kind === 'long') { S.push(['table_rect', x, z, rot, { w: 2.6, d: 1.0 }]); for (const u of [-0.85, 0, 0.85]) for (const v of [-0.78, 0.78]) { const [a, b] = L(u, v); S.push([CH, a, b, rot + (v > 0 ? Math.PI : 0)]); } }
  return S;
}
// a booth: banquette backed onto a wall + table + two loose chairs. (x,z) = banquette centre, rot = facing.
function boothSet(x, z, rot, w = 2.4) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const L = (u, v) => [x + u * c + v * s, z - u * s + v * c];
  const [tx, tz] = L(0, 1.05), S = [['banquette', x, z, rot, { w }], ['table_rect', tx, tz, rot, { w: w - 0.6, d: 0.8 }]];
  for (const u of [-0.5, 0.5]) { const [a, b] = L(u * (w - 0.8) / 1.6 * 1.6 / 1.6, 1.78); S.push([CH, a, b, rot + Math.PI]); }
  return S;
}
function diningRoom(p, r, { cx, wellX0 = null, wellX1 = null, wellZ = 7, seed = 1, chandelierY = null }) {
  const hw = (x) => p.halfAt(x);
  const lanes = [[r.x0, r.x1, 13.4, 15.1], [r.x0, r.x1, -15.1, -13.4], [r.x1 - 7.5, r.x1, -6.6, 6.3], [cx - 0.75, cx + 0.75, r.z0, r.z1]];
  const ok = (set) => putSet(p, set, { pad: 0.7, door: 1.4, margin: -0.15, lanes });
  // structure first: columns at the well rim, floral centrepiece, waiter stations
  if (wellX0 != null) {
    for (const x of [wellX0, (wellX0 + wellX1) / 2, wellX1]) for (const s of [-1, 1]) put(p, 'column', x, s * (wellZ + 0.35), 0, { h: 2.95 }, { pad: 0.1 });
    put(p, 'floral_display', cx, 0, 0, {}, { pad: 0.2 });
    if (chandelierY != null) p.item('chandelier', cx, 0, 0, { w: 3.6, d: 3.6, h: 3.2, y: chandelierY });
  }
  // booths along the forward bulkhead (galley side) between the doors, facing aft
  for (const [line, s] of [[r.x1, 1]]) for (const [a, b] of wallSegs(p, r.id, 'x', line, s, r.z0, r.z1)) {
    for (let z = a + 1.75; z + 1.55 <= b; z += 2.9) putSet(p, boothSet(line - 0.07 - 0.68, z, -Math.PI / 2), { pad: 0.3, door: 0.5, margin: -0.15 });
  }
  // window two-tops along both sides (diners face each other across the glass)
  for (const sd of [-1, 1]) {
    for (let x = r.x0 + 4; x < r.x1 - 2; x += 2.35) {
      const z = sd * (Math.min(hw(x), sd > 0 ? r.z1 : -r.z0) - 0.07 - 1.05);
      if (Math.abs(z) < 12) continue;
      const kind = hash32(seed, Math.round(x), sd) % 5 === 0 ? 4 : 2;
      ok(kind === 2 ? tableSet(2, x, z, Math.PI / 2) : tableSet(4, x, z - sd * 0.25, 0));
    }
  }
  // planter dividers framing the central zone
  if (wellX0 != null) for (const x of [wellX0 + 4.5, (wellX0 + wellX1) / 2 - 3.5, (wellX0 + wellX1) / 2 + 3.5, wellX1 - 4.5]) for (const s of [-1, 1]) put(p, 'divider', x, s * (wellZ + 2.6), 0, { style: 'planter', w: 2.4 }, { pad: 0.3, lanes });
  // central well: 8-tops and 6-tops around the centrepiece
  if (wellX0 != null) {
    for (const [dx, dz, k] of [[-7.5, 3.6, 8], [7.5, 3.6, 8], [-7.5, -3.6, 8], [7.5, -3.6, 8], [-3.6, 4.4, 6], [3.6, 4.4, 6], [-3.6, -4.4, 6], [3.6, -4.4, 6], [-11.5, 0, 6], [11.5, 0, 6]]) ok(tableSet(k, cx + dx, dz, (dx + dz) * 0.3));
  }
  // the rest of the floor: jittered field of 4- and 6-tops, long tables near the aft end, waiter stations
  const sp = 3.3;
  for (let x = r.x0 + 2.6; x < r.x1 - 1.5; x += sp) for (let z = -18; z <= 18; z += sp) {
    const h = hash32(seed + 3, Math.round(x * 3), Math.round(z * 3));
    const jx = ((h % 7) - 3) * 0.12, jz = (((h >>> 3) % 7) - 3) * 0.12;
    const pickK = h % 11;
    if (pickK === 0) { put(p, 'waiter_station', x + jx, z + jz, ((h >>> 5) % 4) * Math.PI / 2, {}, { pad: 0.6, door: 1.4, lanes }); continue; }
    const kind = pickK < 5 ? 4 : pickK < 8 ? 6 : pickK < 9 ? 'long' : 2;
    ok(tableSet(kind, x + jx, z + jz, ((h >>> 7) % 8) * Math.PI / 4)) || ok(tableSet(4, x + jx, z + jz, Math.PI / 4)) || ok(tableSet(2, x, z, 0));
  }
  wallKit(p, r, ['sconce', 'art_frame', 'sconce'], { sides: [3, 4], seed, gap: 1.2, jitter: 1 });
}

// ── passenger corridors: art frames flanked by sconces between doors, occasional console tables
//    and house phones (decks 4–14) ───────────────────────────────────────────────
function dressCabinCorridor(p, r, zA, zB, x0, x1, seed, { gallery = false } = {}) {
  const width = zB - zA;
  for (const [line, s] of [[zB, 1], [zA, -1]]) {
    let k = 0;
    for (const [a, b] of wallSegs(p, r.id, 'z', line, s, x0, x1)) {
      const L = b - a;
      if (L < 0.9) continue;
      const nG = Math.max(1, Math.floor((L - 0.2) / (gallery ? 4.4 : 3.4)));
      for (let g = 0; g < nG; g++) {
        const c = a + (g + 0.5) * L / nG, h = hash32(seed, Math.round(c * 2), s + 2);
        const span = L / nG;
        k++;
        if (wallItemsNear(p, c, line, 1.0)) { if (span > 2.6) wallItem(p, 'sconce', 'z', line, s, c + 1.3); continue; }
        if (span >= 2.3 && (gallery || k % 2 === 0)) {
          wallItem(p, 'art_frame', 'z', line, s, c);
          wallItem(p, 'sconce', 'z', line, s, c - 0.85); wallItem(p, 'sconce', 'z', line, s, c + 0.85);
          if (h % (gallery ? 3 : 6) === 0 && width >= 1.9) wallFloor(p, 'console_table', 'z', line, s, c, {}, { door: 0.4, pad: 0.02 });
        } else if (span >= 1.0) {
          if (h % 11 === 3) wallItem(p, 'house_phone', 'z', line, s, c);
          else wallItem(p, 'sconce', 'z', line, s, c);
        }
      }
    }
  }
}

// ── Aurora Theatre: proscenium, stage, orchestra pit, curved stalls, boxes, circle fronts,
//    lighting trusses and a starburst house chandelier (decks 4–6 share one volume) ──────────
const SEAT_BLOCKERS = new Set(['pit_rail', 'theatre_box', 'stage', 'proscenium', 'circle_front', 'column', 'plant']);
function seatClear(p, x, z) {
  for (const it of p.items) {
    if (!SEAT_BLOCKERS.has(it.t)) continue;
    const [hx, hz] = fpHalf(it.t, it.rot, it.w, it.d);
    if (Math.abs(it.x - x) < hx + 0.35 && Math.abs(it.z - z) < hz + 0.35) return false;
  }
  return true;
}
function curvedStalls(p, { cx, R0, R1, rowGap = 0.95, xMin, xMax = 1e9, aisles = [0.21, -0.21] }) {
  let n = 0;
  for (let R = R0, k = 0; R <= R1 + 0.01; R += rowGap, k++) {
    const step = 0.56 / R;
    const half = Math.ceil(Math.PI / 2 / step);
    for (let q = -half; q <= half; q++) {
      const th = (q + (k % 2) * 0.5) * step;
      const x = cx - R * Math.cos(th), z = R * Math.sin(th);
      if (x < xMin || x > xMax) continue;
      if (aisles.some(a => Math.abs(R * (th - a)) < 0.6)) continue;
      if (Math.abs(z) > p.halfAt(x) - 1.25) continue;                 // side aisles along the walls
      const rot = Math.PI / 2 + th;
      if (!seatClear(p, x, z)) continue;
      if (!p.fits('theater_seat', x, z, rot, null, null, 0.02)) continue;
      if (nearDoor(p, x, z, 0.35, 0.35, 1.3)) continue;
      p.item('theater_seat', x, z, rot, { act: 'watch' }); n++;
    }
    // aisle step lights at the row ends along each aisle
    if (k % 2 === 0) for (const a of aisles) for (const sg of [-1, 1]) {
      const th = a + sg * 0.45 / R, x = cx - R * Math.cos(th), z = R * Math.sin(th);
      if (x > xMin && x < xMax && p.roomAt(x, z)?.type === 'theater') p.item('aisle_light', x, z, Math.PI / 2 + th);
    }
  }
  return n;
}
function dressTheatre(p, d) {
  const r = p.rooms.find(q => q && q.type === 'theater');
  if (!r) return;
  if (d === 4) {
    // stage + proscenium + backdrop + pit
    p.item('stage', 129.5, 0, -Math.PI / 2, { w: 24, d: 8, h: 0.9 });
    p.item('proscenium', 125.0, 0, -Math.PI / 2, { w: 26.9, h: 7.8, d: 1.0 });
    p.item('screen', 132.7, 0, -Math.PI / 2, { w: 18, h: 7.0, act: 'show' });
    p.item('pit_rail', 123.25, 0, -Math.PI / 2, { w: 20, d: 2.1 });
    p.item('fly_batten', 126.3, 0, Math.PI / 2, { w: 23, h: 1.8, y: 5.4 });
    p.item('fly_batten', 128.9, 0, Math.PI / 2, { w: 23, h: 1.8, y: 5.6 });
    p.item('light_truss', 127.6, 0, Math.PI / 2, { w: 22, y: 6.6 });
    p.item('light_truss', 113.5, 0, Math.PI / 2, { w: 24, y: 6.9 });
    p.item('light_truss', 120.0, 0, Math.PI / 2, { w: 24, y: 6.9 });
    p.item('chandelier', 117.0, 0, 0, { style: 'theatre', w: 6.5, d: 6.5, h: 1.75, y: 7.0 });
    // stage-side boxes at stalls level
    for (const s of [-1, 1]) put(p, 'theatre_box', 122.9, s * (p.halfAt(124.4) - 0.1 - 1.0), s > 0 ? Math.PI : 0, { w: 3.0, d: 2.0 }, { door: 1.3, margin: 0.0 });
    curvedStalls(p, { cx: 136, R0: 15.4, R1: 35, xMin: 100.6, xMax: 121.2 });
    // velvet walls get gilt sconces
    wallKit(p, r, ['sconce'], { sides: [1, 2, 4], seed: 41, gap: 2.6, jitter: 0.6 });
  } else {
    const rimX = d === 5 ? 112 : 106, rimZ = d === 5 ? 14 : 13;
    put(p, 'circle_front', rimX - 0.25, 0, Math.PI / 2, { w: rimZ * 2 - 0.4 }, { margin: 0.0, items: false, door: 0 });
    for (const x of d === 5 ? [117.8, 121.6] : [110.5, 115.0, 119.5, 124.0]) for (const s of [-1, 1]) {
      for (const [w, dd] of d === 5 ? [[3.4, 1.6], [3.0, 1.4]] : [[4.0, 2.2], [3.4, 2.0], [3.0, 1.8]]) {
        if (put(p, 'theatre_box', x, s * (rimZ + 0.04 + dd / 2), s > 0 ? Math.PI : 0, { w, d: dd }, { margin: 0.0, door: 1.3 })) break;
      }
    }
    wallKit(p, r, ['sconce'], { sides: [1, 2, 4], seed: 40 + d, gap: 2.6, jitter: 0.6 });
  }
}

// ── Meridian Atrium (deck 4): cascading light sculpture through the well, café, settee clusters, plants ──
function dressAtrium(p) {
  const r = p.rooms.find(q => q && q.name === 'Meridian Atrium'); if (!r) return;
  p.item('cascade', 13.5, 0, 0, { w: 7.6, d: 7.6, h: 5.5, y: 3.3, inner: 1.6 });
  for (const [x, z] of [[10.2, 10.1], [16.8, 10.1], [10.2, -10.1], [16.8, -10.1]]) put(p, 'atrium_settee', x, z, 0, {}, { pad: 0.3 });
  put(p, 'cafe_bar', 27.2, -10.4, -Math.PI / 2, {}, { pad: 0.3 });
  // café terrace: bistro two-tops in front of the counter
  for (const [x, z] of [[24.2, -12.6], [24.2, -9.9], [21.6, -12.6], [21.6, -9.9], [19.0, -12.6]]) putSet(p, [['table_r', x, z, 0, { w: 0.62, d: 0.62 }], ['chair', x - 0.6, z, Math.PI / 2], ['chair', x + 0.6, z, -Math.PI / 2]], { pad: 0.25, door: 1.2 });
  // lounge clusters under the gallery: low table + armchairs + sofa
  for (const [x, z] of [[21.5, 11.6], [7.0, -11.2]]) putSet(p, [['table_low', x, z, 0, { w: 1.0, d: 0.6 }], ['sofa', x, z + Math.sign(z) * 1.05, z > 0 ? Math.PI : 0], ['armchair', x - 1.25, z, Math.PI / 2], ['armchair', x + 1.25, z, -Math.PI / 2]], { pad: 0.25, door: 1.2 });
  put(p, 'floral_display', 0.9, 0, 0, {}, { pad: 0.3 });
  for (const [x, z] of [[-2.35, 12.3], [-2.35, -12.3], [29.3, 12.3], [29.3, -6.2], [-2.35, 6.5], [-2.35, -6.5], [6.5, -12.4], [20.5, 12.4]]) put(p, 'plant', x, z, 0, {}, { pad: 0.1 });
  wallKit(p, r, ['art_frame'], { sides: [3, 4], seed: 7, gap: 3, jitter: 0.5 });
}

// ── crew mess / officers' mess / crew bar (deck 2) ─────────────────────────
function dressMess(p, r, officers) {
  const s = r.cz > 0 ? 1 : -1;
  const zc = s * 4.5;
  put(p, 'buffet', r.x0 + 0.07 + 0.55, zc, Math.PI / 2, { w: 4, act: 'eat' }, { door: 1.0 });
  const cols = [-10.4, -7.4, -1.4, 1.6];
  for (const x of cols) {
    if (officers) putSet(p, tableSet(4, x, s * 3.5, Math.PI / 4).concat([]), { pad: 0.2, door: 1.2 }) && putSet(p, tableSet(4, x, s * 6.0, Math.PI / 4), { pad: 0.15, door: 1.2 });
    else putSet(p, tableSet('long', x, zc, Math.PI / 2), { pad: 0.2, door: 1.2, margin: -0.1 });
  }
  const far = s > 0 ? r.z1 : r.z0;
  wallItem(p, 'tv', 'z', far, s, -4.0);
  wallKit(p, r, officers ? ['art_frame', 'sconce'] : ['notice_board', 'poster', 'poster'], { sides: s > 0 ? [1] : [2], seed: officers ? 3 : 4, gap: 2.2, jitter: 1 });
  put(p, 'cafe_bar', r.x1 - 0.07 - 0.45 - 0.9, zc, -Math.PI / 2, { w: 2.6 }, { door: 1.0 }) || put(p, 'counter', r.x1 - 0.6, zc, -Math.PI / 2, {});
  ceilRun(p, 'duct', r.x0 + 1, r.x1 - 1, s * 6.95, {}, { seg: 6 });
}
function dressCrewBar(p, r) {
  put(p, 'pool_table', 34.4, 4.5, 0, {}, { pad: 0.2 });
  for (const [x, z] of [[47.4, 2.9], [49.9, 2.9], [47.4, 5.3], [46.0, 4.1]]) putSet(p, [['table_r', x, z, 0, { w: 0.6, d: 0.6 }], ['stool', x - 0.6, z, Math.PI / 2], ['stool', x + 0.6, z, -Math.PI / 2]], { pad: 0.25, door: 1.2 });
  wallItem(p, 'dartboard', 'x', r.x0, -1, 3.2);
  wallItem(p, 'neon_sign', 'x', r.x0, -1, 5.6, { neon: 'beer' });
  wallKit(p, r, ['poster', 'art_frame'], { sides: [2], seed: 21, gap: 2.5 });
}

// ── other machinery spaces: overhead services, panels & manifolds against the walls ───────
function dressPlantRoom(p, r, seed) {
  const W = r.x1 - r.x0, D = r.z1 - r.z0;
  if (/Control Room/.test(r.name)) { wallKit(p, r, ['gauge_panel', 'notice_board', 'poster'], { seed, gap: 1.5 }); ceilRun(p, 'cable_tray', r.x0 + 0.5, r.x1 - 0.5, (r.z0 + r.z1) / 2 + 2.5, {}, { seg: 5 }); return; }
  if (/Workshop/.test(r.name)) {
    for (const [sa, sb] of wallSegs(p, r.id, 'z', r.z0, -1, r.x0, r.x1)) for (let a = sa + 1.45; a + 1.35 <= sb; a += 2.75) wallFloor(p, 'racking', 'z', r.z0, -1, a, { stock: 'parts' }, { door: 1.2 });
    wallFloor(p, 'locker_bank', 'x', r.x0, -1, (r.z0 + r.z1) / 2 + 2, {}, { door: 1.2 });
    wallKit(p, r, ['notice_board', 'poster', 'fire_ext'], { seed, gap: 2 }); ceilRun(p, 'cable_tray', r.x0 + 0.5, r.x1 - 0.5, (r.z0 + r.z1) / 2, {}, { seg: 5 }); return;
  }
  if (W >= D) { ceilRun(p, 'pipe_run', r.x0 + 0.5, r.x1 - 0.5, r.z0 + 1.2, { v: seed % 2 ? 'water' : 'mix' }, { seg: Math.min(6, Math.floor(W - 1)) }); ceilRun(p, 'cable_tray', r.x0 + 0.5, r.x1 - 0.5, r.z1 - 1.0, {}, { seg: Math.min(6, Math.floor(W - 1)) }); }
  else { ceilRunZ(p, 'pipe_run', r.z0 + 0.5, r.z1 - 0.5, r.x0 + 1.2, { v: 'mix' }, { seg: Math.min(6, Math.floor(D - 1)) }); ceilRunZ(p, 'cable_tray', r.z0 + 0.5, r.z1 - 0.5, r.x1 - 1.0, {}, { seg: Math.min(6, Math.floor(D - 1)) }); }
  const lines = [['z', r.z1, 1, r.x0, r.x1], ['z', r.z0, -1, r.x0, r.x1], ['x', r.x1, 1, r.z0, r.z1], ['x', r.x0, -1, r.z0, r.z1]];
  const kinds = ['valve_manifold', 'pipe_riser', 'control_panel', 'pipe_riser'];
  let k = seed;
  for (const [axis, line, s, a0, a1] of lines) for (const [sa, sb] of wallSegs(p, r.id, axis, line, s, a0, a1)) {
    for (let a = sa + 1.3; a < sb - 1.0; a += 3.4) { wallFloor(p, kinds[k % kinds.length], axis, line, s, a, {}, { door: 1.2, pad: 0.15 }); k++; }
  }
  wallKit(p, r, ['gauge_panel', 'poster', 'fire_ext'], { seed, gap: 3, jitter: 3 });
}
// small service rooms off the service passage (accommodation decks) and similar closets
function dressServiceRoom(p, r) {
  const W = r.x1 - r.x0, D = r.z1 - r.z0;
  if (W < 2.5 || D < 1.8 || r.cells < 16) return;
  const n = r.name || '';
  const h = Math.min(2.4, ceilOf(r) - 0.08);
  const far = Math.abs(r.z1) > Math.abs(r.z0) ? ['z', r.z1, 1] : ['z', r.z0, -1];
  const [axis, line, s] = far;
  const segs = wallSegs(p, r.id, axis, line, s, r.x0, r.x1);
  const along = (fn) => { for (const [sa, sb] of segs) fn(sa, sb); };
  if (/Linen|Housekeeping|Stores?$|Bar Store|Club Store/.test(n)) { const stock = /Linen|Housekeeping/.test(n) ? 'linen' : /Bar|Club/.test(n) ? 'bev' : 'dry'; along((sa, sb) => { for (let a = sa + 1.45; a + 1.35 <= sb; a += 2.75) wallFloor(p, 'racking', axis, line, s, a, { stock, h }, { door: 0.9, pad: 0.04 }); }); }
  else if (/Fan Room/.test(n)) { ceilRun(p, 'duct', r.x0 + 0.3, r.x1 - 0.3, (r.z0 + r.z1) / 2, {}, { seg: Math.min(6, Math.floor(W - 0.6)) }); along((sa, sb) => { for (let a = sa + 1.0; a < sb - 1; a += 3.2) wallFloor(p, 'pump', axis, line, s, a, {}, { door: 0.9 }); }); }
  else if (/Electrical/.test(n)) along((sa, sb) => { for (let a = sa + 2.1; a + 2 <= sb; a += 4.3) wallFloor(p, 'switchboard', axis, line, s, a, { h }, { door: 0.9 }); });
  else if (/Trash/.test(n)) along((sa, sb) => { for (let a = sa + 0.6; a < sb - 0.5; a += 1.1) wallFloor(p, 'roll_cage', axis, line, s, a, { load: 'boxes' }, { door: 0.9 }); });
  else if (/Pantry/.test(n)) along((sa, sb) => { for (let a = sa + 1.1; a < sb - 1.1; a += 2.3) wallFloor(p, 'prep_table', axis, line, s, a, {}, { door: 0.9 }); });
  wallKit(p, r, ['poster', 'fire_ext'], { seed: r.id, gap: 4, jitter: 3 });
}

// ═════════════════════════════════════════════════════════════════════════════
//  POST-FINALIZE DRESSING PASS (needs edge arrays) — then the plan is finalized again
// ═════════════════════════════════════════════════════════════════════════════
function dressDeck(p) {
  const d = p.deck;
  const R = p.rooms.filter(Boolean);
  const byName = (n) => R.find(r => r.name === n);
  // venues & machinery first (they claim floor space), circulation dressing after
  if (d === 1) {
    for (const [n, s] of [['Engine Room No.1', 1], ['Engine Room No.2', -1]]) { const r = byName(n); if (r) dressEngineRoom(p, r, s); }
    const lau = byName('Main Laundry'); if (lau) dressLaundry(p, lau);
    let k = 0;
    for (const r of R) if (r.type === 'engine' && !/Engine Room No/.test(r.name)) dressPlantRoom(p, r, k++);
  }
  if (d === 2) {
    const m = byName('Crew Mess'), o = byName('Officers\' Mess'), b = byName('The Bilge — Crew Bar');
    if (m) dressMess(p, m, false); if (o) dressMess(p, o, true); if (b) dressCrewBar(p, b);
    const g = byName('Crew Galley'); if (g) dressGalley(p, g, [], [['dish_machine', 28.6, 6.6, Math.PI], ['roll_cage', 29.2, 3.0, 0]]);
  }
  if (d === 4) {
    const dine = byName('Coral & Compass Dining Room'); if (dine) diningRoom(p, dine, { cx: -137, wellX0: -150, wellX1: -124, wellZ: 7, seed: 4, chandelierY: 2.6 });
    const g = byName('Main Galley'); if (g) dressGalley(p, g, [], [['dish_machine', -100.5, -12.25, 0], ['pass_counter', -104.5, 12.4, Math.PI], ['fridge_walk', -95.6, 11.6, Math.PI], ['dish_machine', -96, -12.25, 0]]);
    dressAtrium(p); dressTheatre(p, 4);
  }
  if (d === 5) { const dine = byName('Coral & Compass Dining Room · Upper'); if (dine) diningRoom(p, dine, { cx: -137, seed: 5 }); dressTheatre(p, 5); }
  if (d === 6) dressTheatre(p, 6);
  // crew circulation
  for (const r of R) {
    if (r.type !== 'crew_corridor' || r.ramp) continue;
    if (r.name === 'The Spine') dressCrewCorridor(p, r, { zA: -1.5, zB: 1.5, x0: -155, x1: 148, seed: 2 });
    else if (r.name === 'Working Alley') {
      for (const x of [-30, 8, 58, 122]) put(p, 'forklift', x, -1.5 + 0.07 + 0.6, Math.PI / 2, {}, { door: 1.2 });
      dressCrewCorridor(p, r, { zA: -1.5, zB: 1.5, x0: -150, x1: 140, heavy: true, seed: 5 });
    }
    else if (/Crew Corridor$/.test(r.name) && d === 2) dressCrewCorridor(p, r, { zA: r.z0, zB: r.z1, x0: -150, x1: 140, floorKit: false, seed: r.z0 > 0 ? 6 : 7 });
    else if (/^Deck 3 (Aft|Forward) Crew Corridor/.test(r.name)) dressCrewCorridor(p, r, { zA: -1.5, zB: 1.5, x0: r.x0, x1: r.x1, seed: 8 });
    else if (r.name === 'Service Passage') dressCrewCorridor(p, r, { zA: -1, zB: 1, x0: r.x0, x1: r.x1, floorKit: false, seed: d });
  }
  // passenger corridors & galleries
  for (const r of R) {
    if (r.type !== 'corridor') continue;
    if (/Starboard Passage|Port Passage/.test(r.name)) { const s = r.cz > 0 ? 1 : -1; dressCabinCorridor(p, r, s > 0 ? 8.5 : -10.5, s > 0 ? 10.5 : -8.5, r.x0, r.x1, d * 10 + (s > 0 ? 1 : 2)); }
    else if (/Gallery$/.test(r.name) && d >= 4 && d <= 6) { const s = r.cz > 0 ? 1 : -1; dressCabinCorridor(p, r, s > 0 ? 13 : -15.5, s > 0 ? 15.5 : -13, r.x0, r.x1, d * 10 + 5 + s, { gallery: true }); }
  }
  // stores & closets
  for (const r of R) {
    if (r.name === 'Stair Store') dressStairStore(p, r);
    else if (r.type === 'store' && r.name !== 'Crew Shop' && !/Pump/.test(r.name) && r.cells > 40) dressStore(p, r, { seed: r.id, forklift: /Hotel Stores|Dry Provisions|Scenery Dock|Forward Store/.test(r.name), centre: d === 1 });
    else if (r.type === 'store' && /Pump/.test(r.name)) dressPlantRoom(p, r, r.id);
    else if (r.type === 'service') dressServiceRoom(p, r);
  }
}

function refinalize(p) {
  for (const r of p.rooms) if (r) { r.cells = 0; r.x0 = 1e9; r.x1 = -1e9; r.z0 = 1e9; r.z1 = -1e9; }
  p.finalize();
}

// ═════════════════════════════════════════════════════════════════════════════
//  DECK PROGRAMS
// ═════════════════════════════════════════════════════════════════════════════

// Standard accommodation deck (decks 7–12). Cross-section, starboard half:
//   z 18.5–20.5 balcony | 10.5–18.5 outside cabin | 8.5–10.5 corridor | 3.5–8.5 inside cabin | 0–3.5 service strip
function accommodationDeck(p, opts = {}) {
  const d = p.deck;
  const lim = superLimits(d);
  const xa = lim.aft + 9.5, xb = lim.fwd - (opts.fwdReserve ?? 13.5);
  const corS = p.addRoom('corridor', { name: `Deck ${d} Starboard Passage` });
  const corP = p.addRoom('corridor', { name: `Deck ${d} Port Passage` });
  p.fill(corS, xa, xb, 8.5, 10.5); p.fill(corP, xa, xb, -10.5, -8.5);
  // crossovers fore and aft
  const xAft = p.addRoom('corridor', { name: `Deck ${d} Aft Crossover` });
  p.fill(xAft, xa, xa + 2, -10.5, 10.5); p.open(xAft, corS); p.open(xAft, corP);
  const xFwd = p.addRoom('corridor', { name: `Deck ${d} Forward Crossover` });
  p.fill(xFwd, xb - 2, xb, -10.5, 10.5); p.open(xFwd, corS); p.open(xFwd, corP);
  const cores = layCores(p);
  // service passage
  const svc = p.addRoom('crew_corridor', { name: 'Service Passage' });
  p.fill(svc, xa + 2, xb - 2, -1, 1, { onlyEmpty: true });

  const resPax = CORES.filter(c => d >= c.minDeck && d <= c.maxDeck).map(c => [c.x - 7, c.x + 7]);
  const resCrew = CREW_CORES.filter(c => d >= c.minDeck && d <= c.maxDeck).map(c => [c.x - 4.5, c.x + 7.5]);
  const extraRes = opts.reserved || [];
  const kindOut = opts.kind || 'balcony';
  for (const side of [1, -1]) {
    const corr = side > 0 ? corS : corP;
    cabinRow(p, { xa: xa + 2, xb: xb - 2, zIn: 10.5, zOut: 18.5, side, kind: kindOut, corr, reserved: [...resPax, ...extraRes], width: opts.outerWidth ?? 3.5 });
    cabinRow(p, { xa: xa + 2, xb: xb - 2, zIn: 3.5, zOut: 8.5, side, kind: 'inside', corr, reserved: [...resPax, ...resCrew, ...extraRes], width: 3.5, corrAtOut: true });
  }
  // service strip rooms
  const strips = [];
  let k = 0;
  const svcNames = ['Housekeeping Pantry', 'Linen Store', 'Fan Room', 'Room Service Pantry', 'Electrical Locker', 'Trash & Recycling'];
  for (let x = xa + 2; x < xb - 2; x += 11) {
    for (const side of [1, -1]) {
      const name = svcNames[(k++) % svcNames.length];
      const r = p.addRoom('service', { name });
      const n = p.fill(r, x, Math.min(x + 11, xb - 2), side > 0 ? 1 : -3.5, side > 0 ? 3.5 : -1, { only: [0] });
      if (n > 12) { p.connect(r, svc, { type: 'crew', access: 'crew', quiet: true }); strips.push(r); }
      else if (n) p.fill(null, x, Math.min(x + 11, xb - 2), side > 0 ? 1 : -3.5, side > 0 ? 3.5 : -1, { only: [r.id] });
      if (n > 6 && name === 'Linen Store') p.item('linen_cart', Math.min(x + 3, xb - 4), side * 2.25, 0);
    }
  }
  // service passage ↔ passenger lobbies through crew doors; crew cores join the passage
  for (const c of Object.values(cores.pax)) {
    for (const run of p.sharedRuns(svc.id, c.lobby.id)) {
      const mid = (run.a0 + run.a1) / 2;
      p.connect(svc, c.lobby, { type: 'crew', access: 'crew', near: [run.line, mid], quiet: true, label: 'CREW ONLY' });
    }
    p.open(c.lobby, corS); p.open(c.lobby, corP);
  }
  for (const [id, lob] of Object.entries(cores.crew)) {
    p.open(lob, svc);
    const cc = CREW_CORES.find(c => c.id === id);
    for (const side of [1, -1]) {
      const v = p.addRoom('crew_corridor', { name: 'Crew Vestibule' });
      p.fill(v, cc.x + 5, cc.x + 7.5, side > 0 ? 3.5 : -8.5, side > 0 ? 8.5 : -3.5);
      p.open(v, lob);
      p.connect(v, side > 0 ? corS : corP, { type: 'crew', access: 'crew', quiet: true, label: 'CREW ONLY' });
    }
    // fill the leftover inside band next to the crew core with lockers
    for (const side of [1, -1]) {
      const st = p.addRoom('service', { name: 'Linen Store' });
      if (p.fill(st, cc.x - 4.5, cc.x + 5, side > 0 ? 3.5 : -8.5, side > 0 ? 8.5 : -3.5, { only: [0] }) > 4) p.connect(st, lob, { type: 'crew', access: 'crew', quiet: true });
    }
  }
  // fore/aft ends: suites facing the bow / wake
  const aftSuites = [];
  for (const side of [1, -1]) {
    const s = p.addRoom('suite', { name: `Aft Suite ${d}${side > 0 ? 'A' : 'B'}`, cabin: d * 1000 + (side > 0 ? 901 : 902), cabinKind: 'aftsuite' });
    p.fill(s, lim.aft + 3, xa, side > 0 ? 0 : -18.5, side > 0 ? 18.5 : 0);
    p.connect(s, xAft, { type: 'cabin', w: 1.0, access: `cabin:${s.cabin}`, quiet: true, label: String(s.cabin), locked: true });
    const ter = p.addRoom('balcony', { name: `Aft Terrace ${s.cabin}` });
    p.fill(ter, lim.aft - 2, lim.aft + 3, side > 0 ? 0.5 : -20.5, side > 0 ? 20.5 : -0.5);
    p.connect(s, ter, { type: 'balcony', w: 2.4, access: `cabin:${s.cabin}`, quiet: true });
    p.item('bed_q', lim.aft + 6, side * 6, Math.PI / 2, { w: 1.8 });
    p.item('sofa_long', xa - 2.5, side * 12, -Math.PI / 2);
    p.item('table_r', lim.aft + 6, side * 13, 0); p.item('chair', lim.aft + 6, side * 12.3, 0); p.item('chair', lim.aft + 6, side * 13.7, Math.PI);
    p.item('bath_pod', xa - 1.2, side * 3.5, -Math.PI / 2, { w: 2.0, d: 2.0 });
    p.item('lounger', lim.aft, side * 6, -Math.PI / 2); p.item('lounger', lim.aft, side * 9, -Math.PI / 2);
    p.cabins.push({ no: s.cabin, deck: d, side, kind: 'suite', room: s.id, door: p.doors.length - 2, x: s.cx || lim.aft + 6, z: side * 9, balcony: ter.id });
    aftSuites.push(s);
  }

  if (!opts.noFwd) {
    const fs = p.addRoom('suite', { name: `Forward Vista Suite ${d}00`, cabin: d * 1000 + 900, cabinKind: 'vista' });
    p.fill(fs, xb, lim.fwd, -20.5, 20.5, { onlyEmpty: true });
    p.connect(fs, xFwd, { type: 'cabin', access: `cabin:${d * 1000 + 900}`, quiet: true, label: String(d * 1000 + 900), locked: true });
    p.item('bed_q', xb + 4, 0, -Math.PI / 2, { w: 1.8 });
    p.item('sofa_long', xb + 7.5, -5, 0); p.item('armchair', xb + 8.5, 5, -Math.PI / 2);
    p.item('bath_pod', xb + 1.2, 7, Math.PI / 2, { w: 2, d: 2 });
    p.cabins.push({ no: d * 1000 + 900, deck: d, side: 1, kind: 'suite', room: fs.id, door: p.doors.length - 1, x: xb + 5, z: 0, balcony: -1 });
  }
  // corridor dressing & signs
  for (const side of [1, -1]) {
    const z = side * 9.5;
    for (let x = xa + 10; x < xb - 6; x += 27) {
      p.item('hose_box', x, side * 8.55, side > 0 ? 0 : Math.PI);
      p.item('camera', x + 13, side * 10.3, side > 0 ? Math.PI : 0);
    }
    p.item('life_ring', xa + 1, side * 10.45, side > 0 ? Math.PI : 0);
  }
  // cabin-range plaques at each stair lobby: the block of starboard staterooms between this core
  // and the next one (suites at the ends excluded), e.g. "◂ 9001–9045"
  const coreXs = CORES.filter(c => d >= c.minDeck && d <= c.maxDeck).map(c => c.x).sort((a, b) => a - b);
  for (const c of CORES) if (d >= c.minDeck && d <= c.maxDeck) {
    const k = coreXs.indexOf(c.x), nx = coreXs[k + 1] ?? 1e9, px = coreXs[k - 1] ?? -1e9;
    const row = p.cabins.filter(cb => !cb.crew && cb.side > 0 && (cb.kind === 'balcony' || cb.kind === 'ocean' || cb.kind === 'inside' || cb.kind === 'suite') && typeof cb.no === 'number' && cb.no % 1000 < 900);
    const fwdNos = row.filter(cb => cb.x > c.x && cb.x < nx).map(cb => cb.no);
    const aftNos = row.filter(cb => cb.x < c.x && cb.x > px).map(cb => cb.no);
    if (fwdNos.length) p.sign(`◂ ${Math.min(...fwdNos)}–${Math.max(...fwdNos)}`, c.x + 7.2, 10.45, Math.PI, { y: 1.75, w: 0.62, style: 'brass' });
    if (aftNos.length) p.sign(`${Math.min(...aftNos)}–${Math.max(...aftNos)} ▸`, c.x - 7.2, 10.45, Math.PI, { y: 1.75, w: 0.62, style: 'brass' });
  }
  return { corS, corP, svc, cores, xa, xb, xAft, xFwd };
}

// ── Deck 1: machinery & stores ───────────────────────────────────────────────
function deck1(p) {
  const alley = p.addRoom('crew_corridor', { name: 'Working Alley' });
  p.fill(alley, -150, 140, -1.5, 1.5);
  const spec = [
    [-150, -101, 'engine', 'Engine Room No.1', { zone: 'restricted', access: 'engineer', door: 'watertight' }],
    [-101, -89, 'engine', 'Engine Control Room', { zone: 'restricted', access: 'engineer', facade: 'solid', light: 1.1, door: 'watertight' }],
    [-89, -61, 'engine', 'Main Switchboard Room', { zone: 'restricted', access: 'engineer', door: 'watertight' }],
    [-61, -50, 'store', 'Meat & Fish Cold Store', { door: 'watertight' }],
    [-37, -20, 'store', 'Dry Provisions', { door: 'watertight' }],
    [-20, 0, 'store', 'Hotel Stores', { door: 'watertight' }],
    [0, 18, 'store', 'Bonded Store', { zone: 'restricted', access: 'officer', door: 'watertight', bonded: true }],
    [18, 52, 'laundry', 'Main Laundry', { door: 'watertight' }],
    [66, 95, 'engine', 'Waste Management Plant', { zone: 'crew', door: 'watertight' }],
    [95, 118, 'engine', 'Bow Thruster Room', { zone: 'restricted', access: 'engineer', door: 'watertight' }],
    [118, 140, 'store', 'Rope & Paint Store', { door: 'watertight' }],
  ];
  const specP = [
    [-150, -101, 'engine', 'Engine Room No.2', { zone: 'restricted', access: 'engineer', door: 'watertight' }],
    [-101, -89, 'engine', 'Engineering Workshop', { zone: 'crew', door: 'watertight', light: 1.1 }],
    [-89, -61, 'engine', 'Purifier Room', { zone: 'restricted', access: 'engineer', door: 'watertight' }],
    [-61, -50, 'store', 'Vegetable Cold Store', { door: 'watertight' }],
    [-37, -20, 'store', 'Beverage Store', { door: 'watertight' }],
    [-20, 0, 'store', 'Housekeeping Stores', { door: 'watertight' }],
    [0, 18, 'store', 'Spare Parts Store', { door: 'watertight' }],
    [18, 52, 'laundry', 'Uniform Issue & Tailor', { door: 'watertight', uniforms: true }],
    [66, 95, 'engine', 'Air-Conditioning Plant', { zone: 'crew', door: 'watertight' }],
    [95, 118, 'store', 'Ballast Pump Room', { door: 'watertight' }],
    [118, 140, 'store', 'Forward Store', { door: 'watertight' }],
  ];
  const S = bandRooms(p, spec, alley, 1.5, 21, 1.5);
  const P = bandRooms(p, specP, alley, -21, -1.5, -1.5);
  const cores = layCores(p);
  for (const lob of Object.values(cores.crew)) p.open(lob, alley);
  // machinery
  for (const [r, s] of [[S[0], 1], [P[0], -1]]) {
    p.item('engine', -126, s * 7.5, 0, { w: 13 }); p.item('engine', -126, s * 14, 0, { w: 13 });
    p.item('generator', -108, s * 8, 0); p.item('pump', -142, s * 4, 0); p.item('pump', -142, s * 12, 0); p.item('pump', -112, s * 15, 0);
    p.item('switchboard', -138, s * (r ? 17.2 : 17), s > 0 ? Math.PI : 0);
  }
  p.item('console', -95, 6, Math.PI, { w: 4.5 }); p.item('console', -95, 11, Math.PI, { w: 4.5 }); p.item('office_chair', -95, 5, Math.PI); p.item('office_chair', -95, 10, Math.PI);
  for (let x = -86; x < -64; x += 5) { p.item('switchboard', x, 8, 0); p.item('switchboard', x, 14, Math.PI); }
  for (let x = -86; x < -64; x += 6) p.item('pump', x, -8, 0);
  for (let x = -98; x < -91; x += 3) p.item('prep_table', x, -6, 0, { role: 'engineer' });
  for (let x = 20, k = 0; x < 50; x += 2.2, k++) { p.item(k % 3 === 2 ? 'dryer' : 'washer', x, 5.5, Math.PI); p.item(k % 3 === 1 ? 'dryer' : 'washer', x, 15.5, 0); }
  for (let x = 20; x < 50; x += 2.5) { p.item('cabinet', x, -14, 0, { act: 'uniform' }); p.item('cabinet', x, -5, Math.PI, { act: 'uniform' }); }
  p.item('counter', 26, -9, 0);
  for (let x = 70; x < 92; x += 7) { p.item('generator', x, 8, 0); p.item('generator', x, -8, 0); }
  p.item('junction', -61.5, 1.45, Math.PI, { act: 'power', power: 'aft' });
  p.item('camera', -60, 1.2, Math.PI); p.item('camera', 10, -1.2, 0); p.item('camera', 60, 1.2, Math.PI);
  p.sign('ENGINE ROOM — AUTHORISED ONLY', -100.5, 1.45, Math.PI, { style: 'warn' });
  p.sign('LAUNDRY', 35, 1.45, Math.PI, { style: 'crew' });
  p.sign('UNIFORM ISSUE', 35, -1.45, 0, { style: 'crew' });
}

// ── Deck 2: crew accommodation, security, administration ────────────────────
function deck2(p) {
  const spine = p.addRoom('crew_corridor', { name: 'The Spine', light: 1.1 });
  p.fill(spine, -155, 148, -1.5, 1.5);
  const sideS = p.addRoom('crew_corridor', { name: 'Starboard Crew Corridor' });
  const sideP = p.addRoom('crew_corridor', { name: 'Port Crew Corridor' });
  p.fill(sideS, -150, 140, 7.5, 9.5); p.fill(sideP, -150, 140, -9.5, -7.5);
  // cross alleys every ~30m
  for (let x = -146; x < 138; x += 30) { const a = p.addRoom('crew_corridor', { name: 'Cross Alley' }); p.fill(a, x, x + 1.5, -7.5, 7.5); p.open(a, spine); p.open(a, sideS); p.open(a, sideP); }
  const midS = [
    [-60, -48, 'security', 'Security Office', { access: 'security', secOffice: true }],
    [-37, -27, 'security', 'CCTV Monitoring Room', { access: 'security', cctv: true }],
    [-27, -14, 'office', 'Purser\'s Office' ],
    [-14, 6, 'crew_mess', 'Crew Mess'],
    [6, 30, 'galley', 'Crew Galley'],
    [30, 52, 'crew_bar', 'The Bilge — Crew Bar'],
    [66, 80, 'office', 'Crew Training Room'],
    [80, 90, 'store', 'Crew Shop'],
  ];
  const midP = [
    [-60, -48, 'brig', 'Ship\'s Brig', { access: 'security', brig: true }],
    [-37, -27, 'security', 'Armoury', { access: 'security', armory: true }],
    [-27, -14, 'office', 'Payroll & HR Office', { payroll: true }],
    [-14, 6, 'crew_mess', 'Officers\' Mess'],
    [6, 18, 'office', 'IT Server Room', { zone: 'restricted', access: 'officer', server: true }],
    [18, 30, 'store', 'Galley Stores'],
    [30, 52, 'gym', 'Crew Gym', { zone: 'crew' }],
    [66, 90, 'office', 'Hotel Director\'s Office'],
  ];
  const S1 = bandRooms(p, midS, spine, 1.5, 7.5, 1.5);
  const P1 = bandRooms(p, midP, spine, -7.5, -1.5, -1.5);
  // outer bands: crew cabins everywhere along side corridors, inner band crew cabins where not used
  const cores = layCores(p);
  const res = [[-60, -14], [-14, 52], [53.5, 66], [66, 90], ...CREW_CORES.map(c => [c.x - 4.5, c.x + 7.5])];
  const cross = []; for (let x = -146; x < 138; x += 30) cross.push([x, x + 1.5]);
  for (const side of [1, -1]) {
    cabinRow(p, { xa: -150, xb: 140, zIn: 9.5, zOut: 20.5, side, kind: 'crew', corr: side > 0 ? sideS : sideP, reserved: [[-60, -27], ...cross], width: 2.5 });
    cabinRow(p, { xa: -150, xb: 140, zIn: 1.5, zOut: 7.5, side, kind: 'crew', corr: spine, reserved: [...res, ...cross], width: 2.5 });
  }
  // outer security suite (starboard) — detention & interview
  const interview = p.addRoom('security', { name: 'Interview Room', access: 'security' }); p.fill(interview, -60, -48, 9.5, 20, { onlyEmpty: true }); p.connect(interview, sideS, { type: 'crew', access: 'security', quiet: true });
  const evid = p.addRoom('security', { name: 'Evidence Locker', access: 'security', evidence: true }); p.fill(evid, -48, -37, 9.5, 20, { onlyEmpty: true }); p.connect(evid, sideS, { type: 'crew', access: 'security', quiet: true });
  const cells = p.addRoom('brig', { name: 'Holding Cells', access: 'security', cells: true }); p.fill(cells, -60, -37, -20, -9.5, { onlyEmpty: true }); p.connect(cells, sideP, { type: 'crew', access: 'security', quiet: true });
  const lock = p.addRoom('store', { name: 'Security Equipment', access: 'security' }); p.fill(lock, -37, -27, 9.5, 20, { onlyEmpty: true }); p.connect(lock, sideS, { type: 'crew', access: 'security', quiet: true });
  for (const r of [...S1, ...P1, interview, evid, cells, lock]) r.zone = r.zone === 'crew' && r.access === 'security' ? 'restricted' : r.zone;
  for (const lob of Object.values(cores.crew)) p.open(lob, spine);
  // furnishings
  p.item('console', -54, 4.6, Math.PI, { w: 3 }); p.item('office_chair', -54, 3.6, Math.PI); p.item('desk', -50.5, 6.6, Math.PI); p.item('chair', -50.5, 5.9, 0);
  p.item('cabinet', -58.5, 6.9, Math.PI); p.item('locker', -59.5, 2.0, Math.PI / 2); p.item('locker', -59.5, 2.6, Math.PI / 2);
  p.item('console', -32, 6.5, Math.PI, { w: 6, cctvConsole: true }); p.item('office_chair', -33, 5.5, Math.PI); p.item('office_chair', -30.5, 5.5, Math.PI);
  for (let x = -36; x < -28; x += 1.2) p.item('cabinet', x, -6.9, 0, { act: 'weapons' });
  for (let x = -57; x < -50; x += 2.4) { p.item('bed_s', x + 1, -5, 0); }
  for (let x = -58; x < -38; x += 3.0) { p.item('bed_s', x + 1.4, -18, 0); }
  p.item('desk', -24, 4.5, Math.PI); p.item('office_chair', -24, 3.8, 0); p.item('file_cab', -26.5, 6.8, Math.PI); p.item('file_cab', -15.5, 6.8, Math.PI);
  p.item('desk', -24, -4.5, 0, { payrollDesk: true }); p.item('office_chair', -24, -3.8, Math.PI); p.item('safe', -15.2, -6.8, 0, { payrollSafe: true }); p.item('file_cab', -26.5, -6.8, 0);
  for (let x = 8; x < 28; x += 3) { p.item('range', x, 6.9, Math.PI); p.item('prep_table', x + 1, 3.6, 0); }
  barCounter(p, 41, 5.5, 7, Math.PI, { role: 'crew_bartender' });
  p.item('arcade', 51, 6.5, -Math.PI / 2);
  for (let x = 32; x < 50; x += 2.5) p.item(x < 42 ? 'treadmill' : 'weights', x, -6.4, 0);
  for (let x = 68; x < 78; x += 2.4) { p.item('table_rect', x, 4, 0); p.item('chair', x, 5, Math.PI); }
  p.item('shelf', 85, 6.6, Math.PI); p.item('counter', 85, 3.3, Math.PI);
  p.item('desk', 78, -4.5, 0); p.item('office_chair', 78, -3.7, Math.PI); p.item('sofa', 72, -6.6, 0); p.item('bookshelf', 86, -7.2, 0);
  for (let x = 7; x < 17; x += 1.6) p.item('cabinet', x, -6.9, 0);
  for (let x = -150; x < 140; x += 36) { p.item('camera', x, 1.3, Math.PI); }
  p.item('camera', -45, 9.3, Math.PI); p.item('camera', -45, -9.3, 0);
  p.item('junction', -27.5, 1.45, Math.PI, { act: 'power', power: 'cctv' });
  p.sign('THE SPINE', -152, 0, Math.PI / 2, { style: 'crew' });
  p.sign('SECURITY', -54, 1.45, Math.PI, { style: 'warn' });
  p.sign('CREW MESS', -4, 1.45, Math.PI, { style: 'crew' });
  p.sign('THE BILGE', 41, 1.45, Math.PI, { style: 'crew' });
}

// ── Deck 3: gangway, medical centre, crew cabins ─────────────────────────────
function deck3(p) {
  const gw = p.addRoom('services', { name: 'Gangway Lobby', light: 1.1, zone: 'public' });
  p.fill(gw, -24, 4, -21, 21);
  const med = p.addRoom('medical', { name: 'Medical Centre' }); p.fill(med, 4, 26, 2, 21);
  const ward = p.addRoom('medical', { name: 'Medical Ward', zone: 'crew' }); p.fill(ward, 26, 40, 2, 21);
  const tend = p.addRoom('services', { name: 'Tender Embarkation', zone: 'crew' }); p.fill(tend, 4, 40, -21, -2);
  const medCorr = p.addRoom('corridor', { name: 'Medical Corridor' }); p.fill(medCorr, 4, 40, -2, 2);
  p.open(gw, medCorr);
  p.connect(med, medCorr, { type: 'glass', w: 1.8, quiet: true, label: 'MEDICAL CENTRE' });
  p.connect(ward, med, { type: 'swing', w: 1.4, access: 'crew', quiet: true });
  p.connect(tend, medCorr, { type: 'crew', access: 'crew', w: 1.6, quiet: true });
  const spineA = p.addRoom('crew_corridor', { name: 'Deck 3 Aft Crew Corridor' }); p.fill(spineA, -160, -24, -1.5, 1.5);
  const spineF = p.addRoom('crew_corridor', { name: 'Deck 3 Forward Crew Corridor' }); p.fill(spineF, 40, 154, -1.5, 1.5);
  p.connect(spineF, medCorr, { type: 'crew', access: 'crew', w: 1.2, quiet: true, label: 'CREW ONLY' });
  const cores = layCores(p);
  p.connect(spineA, gw, { type: 'crew', access: 'crew', w: 1.2, quiet: true, label: 'CREW ONLY' });
  const res = CORES.map(c => [c.x - 7, c.x + 7]).concat(CREW_CORES.map(c => [c.x - 4.5, c.x + 7.5]));
  for (const side of [1, -1]) {
    cabinRow(p, { xa: -158, xb: -26, zIn: 1.5, zOut: 21, side, kind: 'crew', corr: spineA, reserved: res, width: 2.5 });
    cabinRow(p, { xa: 42, xb: 152, zIn: 1.5, zOut: 21, side, kind: 'crew', corr: spineF, reserved: res, width: 2.5 });
  }
  for (const [id, c] of Object.entries(cores.pax)) {
    const nb = id === 'mid' ? gw : id === 'aft' ? spineA : spineF;
    if (id === 'mid') p.open(c.lobby, gw);
    else { c.lobby.zone = 'crew'; c.lobby.type = 'crew_corridor'; Object.assign(c.lobby, { floor: 7, wall: 4, ceil: 3 }); p.open(c.lobby, nb); }
  }
  for (const lob of Object.values(cores.crew)) { p.open(lob, spineA); p.open(lob, spineF); p.open(lob, medCorr); p.open(lob, tend); }
  // gangway lobby: shell doors, security scanner, desk
  p.item('desk_svc', -10, -16, 0, { w: 5 }); p.item('podium', -18, -10, 0, { role: 'guard' }); p.item('post', -18, 10, Math.PI, { role: 'guard' });
  p.item('display', -4, 14, 0); p.item('plant', -22, 19, 0); p.item('plant', 2, 19, 0); p.item('plant', -22, -19, 0);
  p.item('sculpture', -2, 0, 0, { w: 1.6, d: 1.6, h: 2.8 });
  p.sign('GANGWAY · DECK 3', -10, 20.3, Math.PI, { style: 'deck', y: 2.2 });
  for (let x = 6; x < 24; x += 3.5) p.item('chair', x, 3, Math.PI);
  p.item('counter', 15, 12, Math.PI, { role: 'nurse' }); p.item('med_bed', 22, 17, 0); p.item('cabinet', 24, 19.5, Math.PI);
  for (let x = 28; x < 39; x += 2.6) { p.item('med_bed', x, 16, 0); p.item('med_bed', x, 6, Math.PI); }
  for (let x = 8; x < 38; x += 5) p.item('crate', x, -16, 0);
  p.item('camera', -22, 20.5, Math.PI); p.item('camera', -22, -20.5, 0); p.item('camera', 5, 1.8, Math.PI);
  p.sign('MEDICAL CENTRE', 15, 2.05, 0, { style: 'brass' });
}

// ── Public decks 4–6 ─────────────────────────────────────────────────────────
function publicSpine(p, x0 = -110, x1 = 99) {
  const cS = p.addRoom('corridor', { name: `Deck ${p.deck} Starboard Gallery`, wall: 2, light: 0.95 });
  const cP = p.addRoom('corridor', { name: `Deck ${p.deck} Port Gallery`, wall: 2, light: 0.95 });
  p.fill(cS, x0, x1, 13, 15.5); p.fill(cP, x0, x1, -15.5, -13);
  return { cS, cP };
}
function pubRoom(p, type, name, x0, x1, z0, z1, extra = {}) { const r = p.addRoom(type, { name, ...extra }); p.fill(r, x0, x1, z0, z1, extra.fillOpts || {}); r.rect = [x0, x1, z0, z1]; return r; }

function deck4(p) {
  const { cS, cP } = publicSpine(p);
  const dine = pubRoom(p, 'dining', 'Coral & Compass Dining Room', -163, -110, -21, 21, { light: 1.05, venue: 'dining' });
  const galley = pubRoom(p, 'galley', 'Main Galley', -110, -93, -13, 13);
  const photo = pubRoom(p, 'gallery', 'Snapshot Studio', -78, -52, -13, 13, { venue: 'photo' });
  const art = pubRoom(p, 'gallery', 'Saltlight Gallery', -52, -17, -13, 13, { venue: 'art' });
  const atr = pubRoom(p, 'atrium', 'Meridian Atrium', -3, 30, -15.5, 15.5, { venue: 'atrium' });
  const conf = pubRoom(p, 'lounge', 'Chart Room Conference Centre', 30, 52, -13, 13);
  const piano = pubRoom(p, 'bar', 'Ivory Keys Lounge', 52, 85, -13, 13, { venue: 'piano' });
  const thea = pubRoom(p, 'theater', 'Aurora Theatre · Orchestra', 99, 134, -21, 21, { venue: 'theater' });
  const back = pubRoom(p, 'store', 'Backstage & Scenery Dock', 134, 165, -21, 21);
  const cores = layCores(p, { all: { zHalf: 13 } });
  // outer bands
  const outS = [[-93, -78, 'office', 'Shore Excursions Office'], [-78, -52, 'shop', 'Snapshot Print Shop'], [-52, -17, 'gallery', 'Saltlight Gallery Annex'], [30, 52, 'lounge', 'Boardroom'], [52, 70, 'library', 'Card Room'], [70, 85, 'office', 'Guest Relations Back Office']];
  const outP = [[-93, -78, 'service', 'Galley Stores'], [-78, -52, 'shop', 'Sundries & Pharmacy'], [-52, -17, 'lounge', 'Quiet Room'], [30, 52, 'lounge', 'Seminar Room'], [52, 70, 'shop', 'Future Cruise Sales'], [70, 85, 'service', 'Bar Store']];
  bandRooms(p, outS, cS, 15.5, 21, 15.5); bandRooms(p, outP, cP, -21, -15.5, -15.5);
  stdConnect(p, cores, cS, cP, [dine, galley, photo, art, atr, conf, piano, thea]);
  p.open(atr, cS); p.open(atr, cP);
  p.connect(dine, cS, { type: 'glass', w: 3, quiet: true }); p.connect(dine, cP, { type: 'glass', w: 3, quiet: true });
  p.connect(galley, dine, { type: 'swing', w: 1.6, access: 'crew', near: [-110, -5], quiet: true }); p.connect(galley, dine, { type: 'swing', w: 1.6, access: 'crew', near: [-110, 5], quiet: true });
  p.connect(thea, cS, { type: 'swing', w: 2.4, quiet: true, label: 'AURORA THEATRE' }); p.connect(thea, cP, { type: 'swing', w: 2.4, quiet: true });
  p.connect(back, thea, { type: 'crew', access: 'crew', w: 2.0, near: [134, 15], quiet: true });
  p.connect(photo, cS, { type: 'glass', w: 2.4, quiet: true }); p.connect(art, cP, { type: 'glass', w: 2.4, quiet: true }); p.connect(art, cS, { type: 'glass', w: 2.4, quiet: true });
  p.connect(conf, cS, { type: 'swing', w: 1.8, quiet: true }); p.connect(piano, cP, { type: 'glass', w: 2.4, quiet: true }); p.connect(piano, cS, { type: 'glass', w: 2.4, quiet: true });
  p.connect(galley, cores.pax.aft.lobby, { type: 'crew', access: 'crew', quiet: true });
  // contents
  for (let x = -108; x < -95; x += 3) { p.item('range', x, -8, 0); p.item('range', x, 8, Math.PI); p.item('prep_table', x + 1, 0, 0); }
  for (let x = -75; x < -55; x += 3.5) { p.item('display', x, -6, 0); p.item('display', x, 6, 0); }
  for (let x = -48; x < -20; x += 5) { p.item('display', x, 7, 0); p.item('bench', x, -7, 0); }
  p.item('sculpture', 13.5, 0, 0); p.item('desk_svc', 4, 11, Math.PI, { w: 6, role: 'clerk' }); p.item('desk_svc', 4, -11, 0, { w: 6, role: 'clerk' });
  p.item('piano', 22, 9, 0, { act: 'listen' });
  for (const [x, z] of [[3.6, 7.9], [23.4, 7.9], [3.6, -7.9], [23.4, -7.9]]) p.item('palm', x, z, 0);
  for (let x = 33; x < 50; x += 2.8) for (let z = -9; z <= 9; z += 1.2) if (Math.abs(z) > 1) p.item('chair', x, z, -Math.PI / 2);
  barCounter(p, 68, -9.5, 9, 0); p.item('piano', 74, 5, -Math.PI / 2); diningTables(p, 55, 82, -5, 12, { kind: 'lounge', spacing: 3.4 });
  signsPublic(p, [[dine, 'CORAL & COMPASS'], [photo, 'SNAPSHOT STUDIO'], [art, 'SALTLIGHT GALLERY'], [conf, 'CHART ROOM'], [piano, 'IVORY KEYS'], [thea, 'AURORA THEATRE']], cS);
  p.item('camera', 13, 15.2, Math.PI); p.item('camera', -60, 15.2, Math.PI); p.item('camera', 60, -15.2, 0); p.item('camera', -100, 14.5, Math.PI);
}

function stdConnect(p, cores, cS, cP, venues) {
  for (const c of Object.values(cores.pax)) { p.open(c.lobby, cS); p.open(c.lobby, cP); }
  for (const [id, lob] of Object.entries(cores.crew)) {
    // crew stair island sits inside a venue: give it a crew door into whichever room surrounds it
    const nb = new Set();
    for (const r of p.rooms) if (r && r.id !== lob.id && p.sharedRuns(lob.id, r.id).length && r.type !== 'stair' && r.type !== 'shaft' && r.type !== 'service') nb.add(r);
    for (const r of nb) p.connect(lob, r, { type: 'crew', access: 'crew', quiet: true, label: 'CREW ONLY' });
  }
}

function signsPublic(p, list, cS) {
  for (const [r, text] of list) {
    if (r.x1 < -150 || !r.name) continue;
    const runs = p.sharedRuns(r.id, cS.id);
    if (runs.length) { const run = runs[0]; p.sign(text, (run.a0 + run.a1) / 2, run.line - 0.08, 0, { style: 'venue', y: 2.25 }); }
  }
}

function deck5(p) {
  const { cS, cP } = publicSpine(p);
  const promS = pubRoom(p, 'promenade', 'Promenade Deck (Starboard)', -163, 136, 18, 21);
  const promP = pubRoom(p, 'promenade', 'Promenade Deck (Port)', -163, 136, -21, -18);
  const promA = pubRoom(p, 'promenade', 'Promenade Deck (Stern)', -166, -159, -18, 18, { fillOpts: { force: false } });
  p.open(promA, promS); p.open(promA, promP);
  const dine = pubRoom(p, 'dining', 'Coral & Compass Dining Room · Upper', -159, -110, -18, 18, { venue: 'dining' });
  const dv = pubRoom(p, 'void', 'Dining Room Well', -150, -124, -7, 7);
  const pantry = pubRoom(p, 'galley', 'Upper Galley & Pantry', -110, -93, -13, 13);
  const pub = pubRoom(p, 'pub', 'The Driftwood Arms', -78, -52, -13, 13, { venue: 'pub' });
  const grill = pubRoom(p, 'dining', 'Saltgrass Grill', -52, -17, -13, 13, { venue: 'grill', light: 0.9 });
  const atr = pubRoom(p, 'atrium', 'Meridian Atrium · Promenade Level', -3, 30, -15.5, 15.5, { venue: 'atrium' });
  const av = pubRoom(p, 'void', 'Atrium Well', 3, 24, -6.5, 6.5);
  const row = pubRoom(p, 'corridor', 'Promenade Row', 30, 52, -3, 3, { floor: 11, wall: 2, light: 1.2, dens: 'shopstreet' });
  const shops = [
    pubRoom(p, 'shop', 'Tidewell Jewellers', 30, 41, 3, 13, { venue: 'jewellery', shop: 'jewellery' }),
    pubRoom(p, 'shop', 'Anchor Outfitters', 41, 52, 3, 13, { venue: 'clothes', shop: 'clothes' }),
    pubRoom(p, 'shop', 'Port & Parcel Sundries', 30, 41, -13, -3, { venue: 'sundries', shop: 'sundries' }),
    pubRoom(p, 'shop', 'Duty-Free Spirits', 41, 52, -13, -3, { venue: 'spirits', shop: 'spirits' }),
  ];
  const casino = pubRoom(p, 'casino', 'The Gilded Reef Casino', 52, 85, -13, 13, { venue: 'casino' });
  const cage = pubRoom(p, 'office', 'Casino Cage', 75, 85, 15.5, 18, { zone: 'restricted', access: 'casino', cage: true });
  const thea = pubRoom(p, 'theater', 'Aurora Theatre · Dress Circle', 99, 136, -18, 18, { venue: 'theater' });
  const tv = pubRoom(p, 'void', 'Theatre Well', 112, 128, -14, 14);
  const fly = pubRoom(p, 'store', 'Fly Gallery & Stage Crew', 136, 165, -21, 21);
  const cores = layCores(p, { all: { zHalf: 13 } });
  const outS = [[-93, -78, 'shop', 'Larkspur Logo Shop', { shop: 'logo' }], [-78, -52, 'bar', 'Driftwood Snug'], [-52, -17, 'lounge', 'Grill Private Dining'], [30, 52, 'shop', 'Tidewell Watches', { shop: 'jewellery' }], [52, 75, 'casino', 'High-Limit Salon', { venue: 'casino_hl' }]];
  const outP = [[-93, -78, 'service', 'Bar Store'], [-78, -52, 'shop', 'Fragrance & Beauty', { shop: 'sundries' }], [-52, -17, 'bar', 'Saltgrass Wine Bar'], [30, 52, 'shop', 'Snack Bar', { shop: 'food' }], [52, 85, 'casino', 'Slot Salon', { venue: 'casino' }]];
  bandRooms(p, outS, cS, 15.5, 18, 15.5); bandRooms(p, outP, cP, -18, -15.5, -15.5);
  stdConnect(p, cores, cS, cP, []);
  p.open(atr, cS); p.open(atr, cP); p.open(atr, row);
  for (const s of shops) { p.connect(s, row, { type: 'glass', w: 2.4, quiet: true, label: s.name }); }
  p.connect(row, casino, { type: 'glass', w: 3, quiet: true, label: 'CASINO' });
  p.connect(casino, cS, { type: 'glass', w: 2.4, quiet: true }); p.connect(casino, cP, { type: 'glass', w: 3, quiet: true });
  p.connect(cage, cS, { type: 'crew', access: 'casino', quiet: true, label: 'CAGE' });
  p.connect(dine, cS, { type: 'glass', w: 3, quiet: true }); p.connect(dine, cP, { type: 'glass', w: 3, quiet: true });
  p.connect(pantry, dine, { type: 'swing', access: 'crew', w: 1.6, near: [-110, 4], quiet: true });
  p.connect(pantry, cores.pax.aft.lobby, { type: 'crew', access: 'crew', quiet: true });
  p.connect(pub, cS, { type: 'swing', w: 2.0, quiet: true, label: 'DRIFTWOOD ARMS' }); p.connect(pub, cP, { type: 'swing', w: 2.0, quiet: true });
  p.connect(grill, cP, { type: 'glass', w: 2.4, quiet: true, label: 'SALTGRASS GRILL' }); p.connect(grill, cS, { type: 'glass', w: 2.0, quiet: true });
  p.connect(thea, cS, { type: 'swing', w: 2.4, quiet: true }); p.connect(thea, cP, { type: 'swing', w: 2.4, quiet: true });
  p.connect(fly, thea, { type: 'crew', access: 'crew', w: 1.4, near: [136, 10], quiet: true });
  // promenade access: doors from the side galleries out to the open deck at intervals
  for (const x of [-100, -60, -25, 40, 90]) {
    for (const [g, pr, s] of [[cS, promS, 1], [cP, promP, -1]]) {
      const nb = p.roomAt(x, s * 16.7);
      if (nb && !nb.exterior) p.connect(nb, pr, { type: 'glass', w: 1.6, near: [x, s * 18], quiet: true });
    }
  }
  p.connect(dine, promA, { type: 'glass', w: 2.4, quiet: true }); p.connect(dine, promS, { type: 'glass', w: 1.8, near: [-130, 18], quiet: true }); p.connect(dine, promP, { type: 'glass', w: 1.8, near: [-130, -18], quiet: true });
  p.connect(thea, promS, { type: 'swing', w: 1.4, near: [104, 18], quiet: true, access: 'crew' });
  // contents
  for (let x = -108; x < -95; x += 3) { p.item('prep_table', x, -5, 0); p.item('prep_table', x, 5, Math.PI); }
  barCounter(p, -65, -9.6, 10, 0); diningTables(p, -76, -54, -4, 11, { kind: 'cocktail', spacing: 2.6 }); p.item('stage', -76, 8, Math.PI / 2, { w: 5, d: 3, h: 0.4 });
  diningTables(p, -50, -19, -12, 12, { kind: 'sq2', spacing: 2.8 });
  p.item('piano', 26, 10, 0); for (let i = 0; i < 4; i++) { p.item('sofa', 1 + i * 6.5, 11.5, Math.PI); }
  for (const s of shops) {
    const [sx0, sx1, sz0, sz1] = s.rect; const up = sz0 + sz1 > 0;
    shelves(p, sx0 + 0.5, sx1 - 0.5, up ? 12.6 : -12.6, up ? Math.PI : 0);
    p.itemFit('display', (sx0 + sx1) / 2 - 2, (up ? 8.5 : -8.5), 0, { act: 'shop' }); p.itemFit('display', (sx0 + sx1) / 2 + 2, (up ? 8.5 : -8.5), 0, { act: 'shop' });
    p.itemFit('counter', sx1 - 1.8, up ? 5.0 : -5.0, up ? 0 : Math.PI, { role: 'clerk', shop: s.shop });
  }
  for (let x = 32; x < 51; x += 6) p.item('planter', x, 0, 0, { w: 2.0, d: 0.6 });
  // casino floor
  for (let z of [-11.8, -6.5, 6.5, 11.8]) slotBank(p, 54, 64, z, z < 0 ? 0 : Math.PI);
  for (let z of [-9, 9]) slotBank(p, 54, 64, z, z < 0 ? Math.PI : 0);
  for (const [x, z] of [[71, -7], [71, 7], [79, -7], [79, 7]]) {
    p.item('card_table', x, z, z < 0 ? 0 : Math.PI, { game: 'blackjack', act: 'gamble' });
    for (let k = -2; k <= 2; k++) { const a = k * 0.42; const s = z < 0 ? 1 : -1; p.item('stool', x + Math.sin(a) * 1.25, z + s * Math.cos(a) * 1.0 + s * 0.2, (s > 0 ? Math.PI : 0) - a * s, { act: 'gamble', seatOf: 'blackjack' }); }
  }
  p.item('roulette', 75, 0, Math.PI / 2, { game: 'roulette', act: 'gamble' });
  barCounter(p, 83, 0, 6, -Math.PI / 2, { stools: true });
  p.item('counter', 80, 16.5, Math.PI, { role: 'cashier', cageWindow: true }); p.item('safe', 83.5, 17.5, Math.PI, { casinoSafe: true });
  for (let x = 54; x < 74; x += 0.8) { p.item('slot', x, 17.4, Math.PI, { act: 'gamble' }); }
  for (let x = 54; x < 84; x += 0.8) { p.item('slot', x, -17.4, 0, { act: 'gamble' }); }
  p.item('card_table', 60, 16.6, Math.PI, { game: 'blackjack_hl', act: 'gamble' });
  theaterSeats(p, 100, 111, -16, 16, 1, 1.0, 14);
  // promenade: benches, life rings, rail spots
  for (let x = -150; x < 130; x += 9) {
    for (const s of [1, -1]) {
      if (rng.chance(0.55)) p.item('deck_chair', x, s * 19.2, s > 0 ? 0 : Math.PI, { act: 'view' });
      p.item('rail_spot', x + 4, s * (p.halfAt(x + 4) - 0.45), s > 0 ? 0 : Math.PI);
      if (x % 27 === 0) p.item('life_ring', x + 2, s * 18.05, s > 0 ? Math.PI : 0, {});
    }
  }
  for (const c of [[13, 15.2, Math.PI], [70, 12.6, Math.PI], [70, -12.6, 0], [56, 0, -Math.PI / 2], [-60, 15.2, Math.PI], [40, 2.8, Math.PI], [82, 17.8, Math.PI]]) p.item('camera', c[0], c[1], c[2]);
  signsPublic(p, [[pub, 'THE DRIFTWOOD ARMS'], [grill, 'SALTGRASS GRILL'], [casino, 'THE GILDED REEF'], [thea, 'AURORA THEATRE']], cS);
  p.sign('PROMENADE ROW', 30.1, 0, Math.PI / 2, { style: 'venue' });
}

function deck6(p) {
  const { cS, cP } = publicSpine(p, -110, 99);
  const ter = pubRoom(p, 'deck', 'Wake Terrace', -166, -140, -21, 21, { venue: 'wakebar' });
  const steak = pubRoom(p, 'dining', 'Ember & Brine Steakhouse', -140, -110, -21, 21, { venue: 'steak', light: 0.75, wall: 13 });
  const pantry = pubRoom(p, 'galley', 'Steakhouse Galley', -110, -93, -13, 13);
  const club = pubRoom(p, 'nightclub', 'Undertow Club', -78, -52, -13, 13, { venue: 'club' });
  const comedy = pubRoom(p, 'bar', 'The Laughing Gull', -52, -17, -13, 13, { venue: 'comedy', light: 0.55 });
  const atr = pubRoom(p, 'atrium', 'Meridian Atrium · Gallery Level', -3, 30, -15.5, 15.5, { venue: 'atrium' });
  const av = pubRoom(p, 'void', 'Atrium Well', 3, 24, -6.5, 6.5);
  const lib = pubRoom(p, 'library', 'Longitude Library', 30, 52, -13, 13, { venue: 'library' });
  const cigar = pubRoom(p, 'lounge', 'Smoke & Mirrors Lounge', 52, 85, -13, 13, { venue: 'cigar', wall: 13, light: 0.6 });
  const thea = pubRoom(p, 'theater', 'Aurora Theatre · Upper Circle', 99, 134, -21, 21, { venue: 'theater' });
  const tv = pubRoom(p, 'void', 'Theatre Well', 106, 131, -13, 13);
  const moor = pubRoom(p, 'mooring', 'Forward Mooring Deck', 134, 166, -21, 21);
  const cores = layCores(p, { all: { zHalf: 13 } });
  const outS = [[-93, -78, 'bar', 'Wake Bar Lounge'], [-78, -52, 'service', 'Club Store'], [-52, -17, 'lounge', 'Green Room'], [30, 52, 'lounge', 'Games & Puzzles'], [52, 85, 'lounge', 'Whisky Vault', { venue: 'cigar' }]];
  const outP = [[-93, -78, 'service', 'Pantry'], [-78, -52, 'bar', 'Undertow VIP Booth'], [-52, -17, 'lounge', 'Karaoke Studio'], [30, 52, 'gallery', 'Internet Café'], [52, 85, 'lounge', 'Captain\'s Club Lounge', { zone: 'private', access: 'vip' }]];
  bandRooms(p, outS, cS, 15.5, 21, 15.5); bandRooms(p, outP, cP, -21, -15.5, -15.5);
  stdConnect(p, cores, cS, cP, []);
  p.open(atr, cS); p.open(atr, cP);
  p.connect(steak, cS, { type: 'glass', w: 2.0, quiet: true }); p.connect(steak, cP, { type: 'glass', w: 2.0, quiet: true });
  p.connect(ter, steak, { type: 'glass', w: 3.0, quiet: true }); p.connect(pantry, steak, { type: 'swing', access: 'crew', w: 1.6, quiet: true });
  p.connect(pantry, cores.pax.aft.lobby, { type: 'crew', access: 'crew', quiet: true });
  p.connect(club, cS, { type: 'swing', w: 2.0, quiet: true, label: 'UNDERTOW' }); p.connect(comedy, cP, { type: 'swing', w: 2.0, quiet: true });
  p.connect(comedy, cS, { type: 'swing', w: 2.0, quiet: true });
  p.connect(lib, cS, { type: 'glass', w: 2.0, quiet: true }); p.connect(lib, atr, { type: 'glass', w: 3.0, quiet: true });
  p.connect(cigar, cP, { type: 'glass', w: 2.0, quiet: true }); p.connect(cigar, cS, { type: 'glass', w: 2.0, quiet: true });
  p.connect(thea, cS, { type: 'swing', w: 2.4, quiet: true }); p.connect(thea, cP, { type: 'swing', w: 2.4, quiet: true });
  p.connect(moor, thea, { type: 'watertight', access: 'crew', w: 1.2, near: [134, 0], quiet: true });
  // The Lantern — bar on the atrium gallery ring
  barCounter(p, 13.5, 10.6, 9, Math.PI, { role: 'bartender' });
  p.item('sofa', 0.5, -12.5, 0); p.item('sofa', 6, -12.5, 0); p.item('sofa', 21, -12.5, 0); p.item('sofa', 27, -12.5, 0);
  diningTables(p, -2, 3, -12, 12, { kind: 'cocktail', spacing: 2.6 }); diningTables(p, 25, 30, -12, 12, { kind: 'cocktail', spacing: 2.6 });
  atr.name = 'The Lantern · Atrium Gallery'; atr.venue = 'lantern';
  diningTables(p, -138, -112, -18, 18, { kind: 'r', spacing: 3.2 });
  barCounter(p, -150, 0, 8, -Math.PI / 2); loungerRows(p, -164, -156, -18, 18, { rot: -Math.PI / 2, dx: 3, dz: 1.2 });
  diningTables(p, -160, -152, -18, -6, { kind: 'cocktail', spacing: 2.6 }); diningTables(p, -160, -152, 6, 18, { kind: 'cocktail', spacing: 2.6 });
  p.item('dj_booth', -76, 0, Math.PI / 2); barCounter(p, -58, -10, 8, 0, { role: 'bartender' }); p.item('sofa_long', -55, 11.5, Math.PI); p.item('sofa_long', -70, 11.5, Math.PI);
  p.item('stage', -20.2, 0, -Math.PI / 2, { w: 9, d: 3.6, h: 0.5 }); diningTables(p, -36, -23, -11, 11, { kind: 'cocktail', spacing: 2.5 }); diningTables(p, -51, -37, -11, -4.5, { kind: 'cocktail', spacing: 2.5 }); diningTables(p, -51, -37, 4.5, 11, { kind: 'cocktail', spacing: 2.5 });
  for (let x = 31; x < 51; x += 3) { p.item('bookshelf', x + 1, 12.7, Math.PI); p.item('bookshelf', x + 1, -12.7, 0); }
  diningTables(p, 33, 50, -8, 8, { kind: 'lounge', spacing: 4 });
  diningTables(p, 54, 83, -11, 11, { kind: 'lounge', spacing: 3.6 }); barCounter(p, 84, 0, 6, -Math.PI / 2);
  theaterSeats(p, 100, 105, -18, 18, 1, 1.0, 14);
  p.item('crate', 150, 6, 0); p.item('crate', 150, -6, 0); p.item('pump', 158, 0, 0);
  for (const c of [[13, 15.2, Math.PI], [-60, 15.2, Math.PI], [60, -15.2, 0], [-100, 14.5, Math.PI], [140, 0, -Math.PI / 2]]) p.item('camera', c[0], c[1], c[2]);
  signsPublic(p, [[club, 'UNDERTOW CLUB'], [comedy, 'THE LAUGHING GULL'], [lib, 'LONGITUDE LIBRARY'], [cigar, 'SMOKE & MIRRORS'], [steak, 'EMBER & BRINE'], [thea, 'AURORA THEATRE']], cS);
  p.sign('THE LANTERN', 13.5, 12.95, Math.PI, { style: 'venue', y: 2.45 });
}

// ── Decks 7–12 accommodation; 13 bridge; 14 suites ──────────────────────────
function deck13(p) {
  const r = accommodationDeck(p, { fwdReserve: 30, noFwd: true, reserved: [] });
  const lim = superLimits(13);
  const lobD = r.cores.crew.cD;
  const off = p.addRoom('officer', { name: 'Officers\' Corridor', zone: 'restricted', access: 'officer', type: 'crew_corridor', floor: 1, wall: 2 });
  p.fill(off, r.xb, 112, -1.5, 1.5, { onlyEmpty: true });
  if (lobD) { p.open(lobD, off); p.connect(r.xFwd, lobD, { type: 'crew', access: 'officer', w: 1.2, quiet: true, label: 'BRIDGE — NO ENTRY' }); }
  p.connect(off, r.xFwd, { type: 'crew', access: 'officer', w: 1.2, quiet: true, label: 'BRIDGE — NO ENTRY' });
  const capt = p.addRoom('officer', { name: 'Captain\'s Day Room', captain: true }); p.fill(capt, r.xb, 112, 1.5, 19, { onlyEmpty: true });
  const staff = p.addRoom('officer', { name: 'Staff Captain\'s Office' }); p.fill(staff, r.xb, 112, -19, -1.5, { onlyEmpty: true });
  for (const rr of [capt, staff]) { p.connect(rr, off, { type: 'crew', access: 'officer', quiet: true }) || (lobD && p.connect(rr, lobD, { type: 'crew', access: 'officer', quiet: true })); }
  const chart = p.addRoom('bridge', { name: 'Chart Room' }); p.fill(chart, 112, 118, -10, 10, { onlyEmpty: true });
  const bridge = p.addRoom('bridge', { name: 'Navigation Bridge', bridge: true }); p.fill(bridge, 118, 132, -19.5, 19.5, { onlyEmpty: true });
  const wS = p.addRoom('bridgewing', { name: 'Starboard Bridge Wing' }); p.fill(wS, 120, 126, 14, 24.5, { force: true, onlyEmpty: true });
  const wP = p.addRoom('bridgewing', { name: 'Port Bridge Wing' }); p.fill(wP, 120, 126, -24.5, -14, { force: true, onlyEmpty: true });
  p.connect(chart, off, { type: 'crew', access: 'officer', quiet: true }); p.open(chart, bridge);
  p.connect(bridge, wS, { type: 'watertight', access: 'officer', w: 1.0, quiet: true }); p.connect(bridge, wP, { type: 'watertight', access: 'officer', w: 1.0, quiet: true });
  // fill rest
  const rest = p.addRoom('officer', { name: 'Radio Room' }); p.fill(rest, 112, 118, -19, 19, { onlyEmpty: true }); p.connect(rest, bridge, { type: 'crew', access: 'officer', quiet: true, near: [118, 12] }); p.connect(rest, bridge, { type: 'crew', access: 'officer', quiet: true, near: [118, -12] });
  p.item('console', 126, -9, -Math.PI / 2, { w: 6, role: 'officer' }); p.item('console', 126, 9, -Math.PI / 2, { w: 6 }); p.item('console', 126, 0, -Math.PI / 2, { w: 4 });
  p.item('helm', 124, 0, -Math.PI / 2); p.item('office_chair', 124.6, -6, -Math.PI / 2); p.item('office_chair', 124.6, 6, -Math.PI / 2);
  p.item('chart_table', 115, 0, Math.PI / 2, { routeLog: true }); p.item('console', 123, 22.5, -Math.PI / 2, { w: 1.6 }); p.item('console', 123, -22.5, -Math.PI / 2, { w: 1.6 });
  p.item('desk', 106, 10, Math.PI / 2, { w: 1.8 }); p.item('office_chair', 105.1, 10, Math.PI / 2); p.item('sofa_long', 103, 16.5, Math.PI); p.item('safe', 110.8, 18, -Math.PI / 2, { captainSafe: true });
  p.item('desk', 106, -10, Math.PI / 2); p.item('office_chair', 105.1, -10, Math.PI / 2); p.item('file_cab', 110.8, -15, -Math.PI / 2);
  p.item('camera', 110, 1.3, Math.PI); p.item('camera', r.xb + 1, 9.5, -Math.PI / 2);
}

function deck14(p) {
  const r = accommodationDeck(p, { outerWidth: 7, noFwd: true, fwdReserve: 24 });
  const lim = superLimits(14);
  const own = p.addRoom('suite', { name: 'The Larkspur Owner\'s Suite', cabin: 14000, cabinKind: 'owner', zone: 'private' });
  p.fill(own, r.xb, lim.fwd, -20.5, 20.5, { onlyEmpty: true });
  p.connect(own, r.xFwd, { type: 'cabin', w: 1.4, access: 'cabin:14000', quiet: true, label: 'OWNER\'S SUITE', locked: true });
  p.cabins.push({ no: 14000, deck: 14, side: 1, kind: 'owner', room: own.id, door: p.doors.length - 1, x: r.xb + 10, z: 0, balcony: -1 });
  p.item('bed_q', r.xb + 14, 9, -Math.PI / 2, { w: 2.0 }); p.item('sofa_long', r.xb + 8, -6, 0); p.item('sofa_long', r.xb + 8, -11, Math.PI);
  p.item('table_low', r.xb + 8, -8.5, 0, { w: 1.6 }); p.item('piano', r.xb + 18, -10, 0); p.item('desk', r.xb + 4, 12, Math.PI / 2, { w: 2.0 }); p.item('office_chair', r.xb + 3, 12, Math.PI / 2);
  p.item('safe', r.xb + 1, 15, Math.PI / 2, { ownerSafe: true }); p.item('bath_pod', r.xb + 3, 4, Math.PI / 2, { w: 3, d: 2.5 }); p.item('table_r_big', r.xb + 14, -2, 0);
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; p.item('chair', r.xb + 14 + Math.sin(a) * 1.15, -2 + Math.cos(a) * 1.15, a + Math.PI); }
  p.item('camera', r.xb - 1, 9.5, Math.PI / 2);
}

// ── Decks 15–17: lido, pools, sports, observation ───────────────────────────
function deck15(p) {
  const lim = superLimits(15);
  const aftDeck = pubRoom(p, 'pooldeck', 'Wake Pool Deck', lim.aft, -60, -21, 21, { venue: 'pool_aft' });
  const sol = pubRoom(p, 'spa', 'Solarium', -60, -17, -21, 21, { venue: 'solarium', ceil: 7, light: 1.2, name: 'Solarium Pool' });
  const main = pubRoom(p, 'pooldeck', 'Sunward Pool Deck', -3, 50, -21, 21, { venue: 'pool' });
  const buf = pubRoom(p, 'buffet', 'Horizon Market', 50, 85, -21, 21, { venue: 'buffet' });
  const spa = pubRoom(p, 'spa', 'Tidal Spa', 99, 113, -21, 21, { venue: 'spa' });
  const gym = pubRoom(p, 'gym', 'Tidal Fitness', 113, 130, -21, 21, { venue: 'gym' });
  const midDeck = pubRoom(p, 'pooldeck', 'Midship Deck', -17, -3, -21, 21, { fillOpts: {} });
  const pools = [
    pubRoom(p, 'pool', 'Sunward Pool', 6, 20, -6, 6), pubRoom(p, 'pool', 'Lagoon Pool', 26, 40, -6, 6),
    pubRoom(p, 'pool', 'Wake Pool', -112, -98, -5, 5), pubRoom(p, 'pool', 'Solarium Pool', -45, -31, -5, 5, { exterior: false }),
  ];
  const cores = layCores(p, { all: { zHalf: 8.5 } });
  for (const c of Object.values(cores.pax)) for (const r of p.rooms) if (r && r !== c.lobby && !r.isVoid && r.type !== 'stair' && r.type !== 'shaft' && p.sharedRuns(c.lobby.id, r.id).length) {
    p.connect(c.lobby, r, { type: r.exterior ? 'glass' : 'glass', w: 2.0, quiet: true, near: [c.x, 8.5] }); p.connect(c.lobby, r, { type: 'glass', w: 2.0, quiet: true, near: [c.x, -8.5] });
    p.connect(c.lobby, r, { type: 'glass', w: 2.0, quiet: true, near: [c.x + 7, 0] }); p.connect(c.lobby, r, { type: 'glass', w: 2.0, quiet: true, near: [c.x - 7, 0] });
  }
  stdConnect(p, { pax: {}, crew: cores.crew }, cores.pax.mid.lobby, cores.pax.mid.lobby, []);
  p.connect(sol, aftDeck, { type: 'glass', w: 3, quiet: true, near: [-60, 12] }); p.connect(sol, aftDeck, { type: 'glass', w: 3, quiet: true, near: [-60, -12] });
  p.connect(sol, midDeck, { type: 'glass', w: 3, quiet: true, near: [-17, 14] }); p.connect(sol, midDeck, { type: 'glass', w: 3, quiet: true, near: [-17, -14] });
  p.open(midDeck, main);
  p.connect(buf, main, { type: 'glass', w: 3, near: [50, 14], quiet: true }); p.connect(buf, main, { type: 'glass', w: 3, near: [50, -14], quiet: true });
  p.connect(spa, gym, { type: 'glass', w: 2, quiet: true });
  for (const pl of pools) pl.waterY = -0.15;
  // contents
  loungerRows(p, -2, 49, 8, 20, { rot: Math.PI, dx: 1.0, dz: 2.8 }); loungerRows(p, -2, 49, -20, -8, { rot: 0, dx: 1.0, dz: 2.8 });
  loungerRows(p, -138, -64, 7, 20, { rot: Math.PI, dx: 1.0, dz: 2.8 }); loungerRows(p, -138, -64, -20, -7, { rot: 0, dx: 1.0, dz: 2.8 });
  for (const [x, z] of [[2.5, 0], [44.5, 0], [-94, 0], [-118, 0]]) p.item('hot_tub', x, z, 0, { act: 'soak' });
  barCounter(p, 23, 7.2, 5, 0, { role: 'bartender', back: false }); p.item('back_bar', 23, 6.6, Math.PI, { w: 5, h: 1.1 });
  p.item('stage', 47.5, -6, -Math.PI / 2, { w: 6, d: 3, h: 0.5 }); p.item('screen', 49.6, 0, -Math.PI / 2, { w: 9, h: 5, act: 'show' });
  for (let k = 0; k < 8; k++) p.item('parasol', -1 + k * 7, (k % 2 ? 1 : -1) * 7.2, 0);
  barCounter(p, -125, -6, 6, Math.PI / 2, { role: 'cook' });
  diningTables(p, -138, -128, -16, 16, { kind: 'cocktail', spacing: 2.8 });
  loungerRows(p, -58, -48, -18, 18, { rot: Math.PI / 2, dx: 3.0, dz: 1.0 }); for (const pl of [[-40, 15], [-36, -15]]) p.item('palm', pl[0], pl[1], 0);
  for (const s of [1, -1]) for (let x = 53; x < 70; x += 4.2) p.item('buffet', x, s * 4.5, s > 0 ? Math.PI : 0, { w: 3.6, act: 'eat' });
  diningTables(p, 52, 83, 8, 20, { kind: 'rect', spacing: 3.0, rot: 0 }); diningTables(p, 52, 83, -20, -8, { kind: 'rect', spacing: 3.0, rot: 0 }); diningTables(p, 72, 83, -5, 5, { kind: 'r', spacing: 3 });
  for (let z = -18; z <= 18; z += 3) { p.item('med_bed', 104, z, Math.PI / 2, { act: 'massage' }); }
  p.item('counter', 110, 0, -Math.PI / 2, { role: 'clerk' });
  for (let z = -16; z <= 16; z += 1.4) p.itemFit('treadmill', 120.5, z, -Math.PI / 2, { act: 'exercise' });
  for (let z = -16; z <= 16; z += 4) p.itemFit('weights', 115.5, z, Math.PI / 2);
  for (let x = -136; x < 48; x += 7) for (const s of [1, -1]) p.item('rail_spot', x, s * (p.halfAt(x) - 0.45), s > 0 ? 0 : Math.PI);
  for (const c of [[13, -20, 0], [-100, 20, Math.PI], [70, 0, Math.PI / 2], [-40, 20, Math.PI]]) p.item('camera', c[0], c[1], c[2]);
  p.sign('HORIZON MARKET', 50.1, 0, Math.PI / 2, { style: 'venue', y: 2.5 }); p.sign('TIDAL SPA', 99.1, 0, Math.PI / 2, { style: 'venue' });
}

function deck16(p) {
  const lim = superLimits(16);
  const aft = pubRoom(p, 'deck', 'Aft Sun Terrace', lim.aft, -118, -21, 21);
  const fun = pubRoom(p, 'engine', 'Funnel Casing', -118, -92, -12, 12, { zone: 'restricted', access: 'engineer', name: 'Funnel Casing & Exhaust Uptakes' });
  const runS = pubRoom(p, 'sportdeck', 'Jogging Track', -118, 100, 14, 21);
  const runP = pubRoom(p, 'sportdeck', 'Jogging Track (Port)', -118, 100, -21, -14);
  const kids = pubRoom(p, 'kids', 'Seahorse Kids\' Club', -78, -52, -14, 14, { venue: 'kids' });
  const arc = pubRoom(p, 'kids', 'Wavelength Arcade', -52, -17, -14, 14, { venue: 'arcade', light: 0.6, wall: 13 });
  const sun = pubRoom(p, 'deck', 'Sun Deck', -3, 50, -14, 14);
  const well = pubRoom(p, 'void', 'Pool Deck Well', 2, 46, -10, 10);
  const court = pubRoom(p, 'sportdeck', 'Sports Court', 50, 85, -14, 14, { venue: 'sport' });
  const aftRing = pubRoom(p, 'deck', 'Funnel Terrace', -92, -78, -14, 14, { onlyEmpty: true });
  const fwd = pubRoom(p, 'deck', 'Forward Sun Deck', 99, lim.fwd, -21, 21);
  const cores = layCores(p, { all: { zHalf: 8.5 }, skipCrew: ['cB', 'cC'] });
  // make a path around the funnel
  p.open(aft, runS); p.open(aft, runP); p.open(sun, runS); p.open(sun, runP); p.open(court, runS); p.open(court, runP); p.open(fwd, runS); p.open(fwd, runP);
  p.open(aftRing, runS); p.open(aftRing, runP);
  for (const c of Object.values(cores.pax)) for (const r of p.rooms) if (r && r !== c.lobby && !r.isVoid && r.type !== 'stair' && r.type !== 'shaft' && p.sharedRuns(c.lobby.id, r.id).length) {
    for (const near of [[c.x, 8.5], [c.x, -8.5], [c.x + 7, 0], [c.x - 7, 0]]) p.connect(c.lobby, r, { type: 'glass', w: 2.0, quiet: true, near });
  }
  p.connect(kids, runS, { type: 'glass', w: 2.0, quiet: true }); p.connect(arc, runS, { type: 'glass', w: 2.0, quiet: true }); p.connect(arc, runP, { type: 'glass', w: 2.0, quiet: true });
  p.connect(fun, aft, { type: 'watertight', access: 'engineer', quiet: true, near: [-118, 0] });
  stdConnect(p, { pax: {}, crew: cores.crew }, null, null, []);
  loungerRows(p, -136, -120, -18, 18, { rot: -Math.PI / 2, dx: 2.6, dz: 1.0 });
  loungerRows(p, 101, 110, -18, 18, { rot: Math.PI / 2, dx: 2.6, dz: 1.0 });
  for (let x = 0; x < 48; x += 1.2) { if (p.roomAt(x, 11.5)?.id === sun.id) p.item('deck_chair', x, 11.8, Math.PI, { act: 'view' }); if (p.roomAt(x, -11.5)?.id === sun.id) p.item('deck_chair', x, -11.8, 0, { act: 'view' }); }
  p.item('sports_net', 67.5, 0, 0); p.item('slide', -68, 17, 0, { w: 6, d: 6 });
  for (let x = -75; x < -55; x += 4) p.item('table_r', x, 6, 0);
  for (let x = -48; x < -20; x += 1.6) { p.item('arcade', x, 12.9, Math.PI); p.item('arcade', x, -12.9, 0); }
  for (let x = -118; x < 100; x += 6) for (const s of [1, -1]) p.item('rail_spot', x, s * 20.05, s > 0 ? 0 : Math.PI);
  p.item('camera', -60, 14.5, Math.PI); p.item('camera', 60, -14.5, 0);
}

function deck17(p) {
  const lim = superLimits(17);
  const lounge = pubRoom(p, 'lounge', 'Zenith Lounge', lim.aft + 22, lim.fwd, -21, 21, { venue: 'zenith', facade: 'glass', light: 0.7 });
  const ter = pubRoom(p, 'deck', 'Zenith Terrace', lim.aft, lim.aft + 22, -21, 21);
  const cores = layCores(p, { all: { zHalf: 8.5 } });
  for (const c of Object.values(cores.pax)) { p.connect(c.lobby, ter, { type: 'glass', w: 2, quiet: true, near: [c.x - 7, 0] }); p.connect(c.lobby, lounge, { type: 'glass', w: 2, quiet: true, near: [c.x + 7, 0] }); p.connect(c.lobby, ter, { type: 'glass', w: 2, quiet: true, near: [c.x, 8.5] }); }
  barCounter(p, 101, 0, 6, -Math.PI / 2);
  diningTables(p, 87, 104, -17, 17, { kind: 'lounge', spacing: 3.2 });
  loungerRows(p, lim.aft + 1, lim.aft + 20, -18, -10, { rot: 0, dx: 1.1, dz: 3 }); loungerRows(p, lim.aft + 1, lim.aft + 20, 10, 18, { rot: Math.PI, dx: 1.1, dz: 3 });
}

// ═════════════════════════════════════════════════════════════════════════════
export function buildShipLayout(seed = 7) {
  rng = new Rng(seed);
  for (const k in counters) delete counters[k];
  const plans = [null];
  const t0 = performance.now();
  for (let d = 1; d <= SHIP.deckCount; d++) {
    const p = new DeckPlan(d, deckHalfFn(d));
    if (d === 1) deck1(p);
    else if (d === 2) deck2(p);
    else if (d === 3) deck3(p);
    else if (d === 4) deck4(p);
    else if (d === 5) deck5(p);
    else if (d === 6) deck6(p);
    else if (d >= 7 && d <= 12) accommodationDeck(p, { kind: 'balcony' });
    else if (d === 13) deck13(p);
    else if (d === 14) deck14(p);
    else if (d === 15) deck15(p);
    else if (d === 16) deck16(p);
    else if (d === 17) deck17(p);
    p.finalize();
    dressDeck(p);
    refinalize(p);
    plans.push(p);
  }
  const cabins = plans.slice(1).flatMap(p => p.cabins);
  const stats = {
    ms: Math.round(performance.now() - t0),
    rooms: plans.slice(1).reduce((s, p) => s + p.rooms.length - 1, 0),
    doors: plans.slice(1).reduce((s, p) => s + p.doors.length, 0),
    items: plans.slice(1).reduce((s, p) => s + p.items.length, 0),
    paxCabins: cabins.filter(c => !c.crew).length,
    crewCabins: cabins.filter(c => c.crew).length,
  };
  return { plans, cabins, stats };
}
