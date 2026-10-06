// DeckPlan — the authoritative 2D description of one deck.
// Rooms are painted onto a 0.5 m grid; walls are derived from room boundaries;
// doors and "open" adjacencies punch through. Everything else (geometry,
// collision, navigation, NPC points of interest, the map UI) is derived from this.

import { GRID, deckY, cellX, cellZ, toI, toJ, idx } from '../core/config.js';
import { FDEF } from './furnitureDefs.js';

// Material tile indices (atlas slots) — see textures.js
export const FLOOR = { corridor: 0, cabin: 1, casino: 2, theater: 3, teak: 4, marble: 5, tile: 6, vinyl: 7, steel: 8, pool: 9, rubber: 10, parquet: 11, lounge: 12, bathtile: 13, deckpaint: 14, dance: 15 };
export const WALL = { corridor: 0, cabin: 1, wood: 2, marble: 3, crew: 4, bulkhead: 5, whitetile: 6, casino: 7, velvet: 8, exterior: 9, hull: 10, glass: 11, spa: 12, dark: 13, kids: 14, brick: 15 };
export const CEIL = { plaster: 0, acoustic: 1, slat: 2, crew: 3, dark: 4, none: 5, coffer: 6, glass: 7 };

// Room archetypes. zone: public | private | crew | restricted
export const RT = {
  corridor:     { floor: FLOOR.corridor, wall: WALL.corridor, ceil: CEIL.plaster, ceilH: 2.4, zone: 'public', facade: 'solid', light: 0.85, dens: 'transit' },
  cabin:        { floor: FLOOR.cabin, wall: WALL.cabin, ceil: CEIL.plaster, ceilH: 2.45, zone: 'private', facade: 'window', light: 0.75 },
  suite:        { floor: FLOOR.parquet, wall: WALL.cabin, ceil: CEIL.coffer, ceilH: 2.6, zone: 'private', facade: 'glass', light: 0.8 },
  balcony:      { floor: FLOOR.teak, zone: 'private', exterior: true },
  lobby:        { floor: FLOOR.marble, wall: WALL.wood, ceil: CEIL.coffer, ceilH: 2.7, zone: 'public', facade: 'window', light: 1.0, dens: 'transit' },
  stair:        { floor: FLOOR.corridor, wall: WALL.wood, ceil: CEIL.none, ceilH: 3.0, zone: 'public', light: 0.9 },
  shaft:        { floor: FLOOR.steel, wall: WALL.bulkhead, ceil: CEIL.none, zone: 'public', light: 0.0 },
  atrium:       { floor: FLOOR.marble, wall: WALL.marble, ceil: CEIL.coffer, ceilH: 2.8, zone: 'public', facade: 'glass', light: 1.15, dens: 'atrium' },
  void:         { zone: 'public', isVoid: true },
  dining:       { floor: FLOOR.lounge, wall: WALL.wood, ceil: CEIL.coffer, ceilH: 2.8, zone: 'public', facade: 'glass', light: 1.0, dens: 'dining' },
  buffet:       { floor: FLOOR.tile, wall: WALL.wood, ceil: CEIL.acoustic, ceilH: 2.7, zone: 'public', facade: 'glass', light: 1.15, dens: 'buffet' },
  bar:          { floor: FLOOR.lounge, wall: WALL.dark, ceil: CEIL.slat, ceilH: 2.7, zone: 'public', facade: 'window', light: 0.7, dens: 'bar' },
  pub:          { floor: FLOOR.parquet, wall: WALL.brick, ceil: CEIL.slat, ceilH: 2.7, zone: 'public', facade: 'window', light: 0.75, dens: 'bar' },
  nightclub:    { floor: FLOOR.dance, wall: WALL.dark, ceil: CEIL.dark, ceilH: 2.8, zone: 'public', facade: 'solid', light: 0.35, dens: 'club' },
  casino:       { floor: FLOOR.casino, wall: WALL.casino, ceil: CEIL.dark, ceilH: 2.8, zone: 'public', facade: 'solid', light: 0.8, dens: 'casino' },
  theater:      { floor: FLOOR.theater, wall: WALL.velvet, ceil: CEIL.dark, ceilH: 2.9, zone: 'public', facade: 'solid', light: 0.45, dens: 'theater' },
  shop:         { floor: FLOOR.parquet, wall: WALL.corridor, ceil: CEIL.plaster, ceilH: 2.7, zone: 'public', facade: 'window', light: 1.2, dens: 'shop' },
  gallery:      { floor: FLOOR.parquet, wall: WALL.cabin, ceil: CEIL.plaster, ceilH: 2.7, zone: 'public', facade: 'window', light: 1.05, dens: 'lounge' },
  library:      { floor: FLOOR.lounge, wall: WALL.wood, ceil: CEIL.slat, ceilH: 2.6, zone: 'public', facade: 'window', light: 0.8, dens: 'lounge' },
  lounge:       { floor: FLOOR.lounge, wall: WALL.wood, ceil: CEIL.coffer, ceilH: 2.7, zone: 'public', facade: 'glass', light: 0.85, dens: 'lounge' },
  spa:          { floor: FLOOR.tile, wall: WALL.spa, ceil: CEIL.slat, ceilH: 2.7, zone: 'public', facade: 'glass', light: 0.8, dens: 'spa' },
  gym:          { floor: FLOOR.rubber, wall: WALL.corridor, ceil: CEIL.acoustic, ceilH: 2.7, zone: 'public', facade: 'glass', light: 1.15, dens: 'gym' },
  kids:         { floor: FLOOR.rubber, wall: WALL.kids, ceil: CEIL.acoustic, ceilH: 2.6, zone: 'public', facade: 'window', light: 1.2, dens: 'kids' },
  medical:      { floor: FLOOR.tile, wall: WALL.whitetile, ceil: CEIL.acoustic, ceilH: 2.5, zone: 'public', facade: 'porthole', light: 1.2, dens: 'medical' },
  services:     { floor: FLOOR.marble, wall: WALL.wood, ceil: CEIL.coffer, ceilH: 2.7, zone: 'public', facade: 'porthole', light: 1.1, dens: 'atrium' },
  // crew & technical
  crew_corridor:{ floor: FLOOR.vinyl, wall: WALL.crew, ceil: CEIL.crew, ceilH: 2.35, zone: 'crew', facade: 'porthole', light: 1.0, dens: 'crewtransit' },
  crew_cabin:   { floor: FLOOR.vinyl, wall: WALL.crew, ceil: CEIL.crew, ceilH: 2.3, zone: 'crew', facade: 'porthole', light: 0.8 },
  crew_mess:    { floor: FLOOR.vinyl, wall: WALL.crew, ceil: CEIL.acoustic, ceilH: 2.4, zone: 'crew', facade: 'porthole', light: 1.15, dens: 'crewmess' },
  crew_bar:     { floor: FLOOR.parquet, wall: WALL.brick, ceil: CEIL.crew, ceilH: 2.4, zone: 'crew', facade: 'porthole', light: 0.7, dens: 'crewbar' },
  office:       { floor: FLOOR.cabin, wall: WALL.crew, ceil: CEIL.acoustic, ceilH: 2.4, zone: 'crew', facade: 'porthole', light: 1.1, dens: 'office' },
  service:      { floor: FLOOR.vinyl, wall: WALL.crew, ceil: CEIL.crew, ceilH: 2.3, zone: 'crew', facade: 'solid', light: 0.9 },
  galley:       { floor: FLOOR.tile, wall: WALL.whitetile, ceil: CEIL.crew, ceilH: 2.5, zone: 'crew', facade: 'solid', light: 1.3, dens: 'galley' },
  store:        { floor: FLOOR.steel, wall: WALL.bulkhead, ceil: CEIL.crew, ceilH: 2.6, zone: 'crew', facade: 'solid', light: 0.7, dens: 'store' },
  laundry:      { floor: FLOOR.vinyl, wall: WALL.whitetile, ceil: CEIL.crew, ceilH: 2.4, zone: 'crew', facade: 'solid', light: 1.1, dens: 'laundry' },
  engine:       { floor: FLOOR.steel, wall: WALL.bulkhead, ceil: CEIL.none, ceilH: 3.0, zone: 'restricted', facade: 'solid', light: 0.85, dens: 'engine' },
  security:     { floor: FLOOR.vinyl, wall: WALL.crew, ceil: CEIL.acoustic, ceilH: 2.4, zone: 'restricted', facade: 'porthole', light: 1.0, dens: 'security' },
  brig:         { floor: FLOOR.steel, wall: WALL.bulkhead, ceil: CEIL.crew, ceilH: 2.4, zone: 'restricted', facade: 'solid', light: 0.6 },
  bridge:       { floor: FLOOR.lounge, wall: WALL.dark, ceil: CEIL.dark, ceilH: 2.6, zone: 'restricted', facade: 'glass', light: 0.45, dens: 'bridge' },
  officer:      { floor: FLOOR.cabin, wall: WALL.wood, ceil: CEIL.plaster, ceilH: 2.45, zone: 'restricted', facade: 'window', light: 0.85 },
  // exterior
  deck:         { floor: FLOOR.teak, zone: 'public', exterior: true, dens: 'deck' },
  promenade:    { floor: FLOOR.teak, zone: 'public', exterior: true, dens: 'promenade' },
  pooldeck:     { floor: FLOOR.teak, zone: 'public', exterior: true, dens: 'pool' },
  pool:         { floor: FLOOR.pool, zone: 'public', exterior: true, pool: 1.45, dens: 'swim' },
  sportdeck:    { floor: FLOOR.rubber, zone: 'public', exterior: true, dens: 'sport' },
  mooring:      { floor: FLOOR.deckpaint, zone: 'crew', exterior: true, dens: 'crewtransit' },
  bridgewing:   { floor: FLOOR.deckpaint, zone: 'restricted', exterior: true },
};

let ROOM_SEQ = 0;

export class DeckPlan {
  constructor(deck, halfWidthFn) {
    this.deck = deck;
    this.y = deckY(deck);
    const N = GRID.nx * GRID.nz;
    this.room = new Int16Array(N);
    this.rooms = [null];
    this.doors = [];
    this.opens = new Set();
    this.items = [];
    this.cabins = [];
    this.signs = [];
    this.forced = [];          // forced wall edges [{normal, line, a0, a1}]
    this.halfW = new Float32Array(GRID.nx);
    for (let i = 0; i < GRID.nx; i++) this.halfW[i] = Math.max(0, halfWidthFn(cellX(i)));
    this.cores = [];
  }

  halfAt(x) { const i = toI(x); return i < 0 || i >= GRID.nx ? 0 : this.halfW[i]; }

  addRoom(type, props = {}) {
    const base = RT[type];
    if (!base) throw new Error('Unknown room type ' + type);
    const r = { id: this.rooms.length, uid: ++ROOM_SEQ, type, deck: this.deck, ...base, ...props, cells: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, bi0: 1e9, bi1: -1, bj0: 1e9, bj1: -1 };
    this.rooms.push(r);
    return r;
  }

  // Paint a rectangle. opts.force ignores the hull outline; opts.only restricts to cells currently owned by given room ids.
  fill(room, x0, x1, z0, z1, opts = {}) {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    const i0 = Math.max(0, Math.round((x0 - GRID.x0) / GRID.cell)), i1 = Math.min(GRID.nx, Math.round((x1 - GRID.x0) / GRID.cell));
    const j0 = Math.max(0, Math.round((z0 - GRID.z0) / GRID.cell)), j1 = Math.min(GRID.nz, Math.round((z1 - GRID.z0) / GRID.cell));
    const id = room ? room.id : 0;
    let n = 0;
    for (let i = i0; i < i1; i++) {
      const hw = this.halfW[i];
      for (let j = j0; j < j1; j++) {
        const z = cellZ(j);
        if (!opts.force && Math.abs(z) > hw) continue;
        const k = idx(i, j);
        if (opts.only && !opts.only.includes(this.room[k])) continue;
        if (opts.onlyEmpty && this.room[k] !== 0) continue;
        this.room[k] = id; n++;
        if (room) { if (i < room.bi0) room.bi0 = i; if (i > room.bi1) room.bi1 = i; if (j < room.bj0) room.bj0 = j; if (j > room.bj1) room.bj1 = j; }
      }
    }
    return n;
  }

  open(a, b) { if (a && b) { this.opens.add(a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id); } }
  isOpen(a, b) { return this.opens.has(a < b ? a + ':' + b : b + ':' + a); }

  // Forced wall along a grid line. normal 'x': line at x=const spanning z∈[a0,a1]; normal 'z': line at z=const spanning x.
  wall(normal, line, a0, a1) { this.forced.push({ normal, line, a0: Math.min(a0, a1), a1: Math.max(a0, a1) }); }

  item(t, x, z, rot = 0, extra = {}) {
    const def = FDEF[t];
    if (!def) throw new Error('Unknown item ' + t);
    const it = { t, x, z, rot, y: 0, ...extra };
    it.room = this.room[idx(toI(x), toJ(z))] || extra.room || 0;
    this.items.push(it);
    return it;
  }

  // Does an item of type t (optionally w/d override) fit entirely inside one non-void room at (x,z)?
  fits(t, x, z, rot = 0, w = null, d = null, margin = 0.04) {
    const def = FDEF[t]; if (!def) return false;
    const W = (w ?? def.w) / 2 - margin, D = (d ?? def.d) / 2 - margin;
    const c = Math.cos(rot), s = Math.sin(rot);
    const hx = Math.abs(c) * W + Math.abs(s) * D, hz = Math.abs(s) * W + Math.abs(c) * D;
    const r0 = this.room[idx(toI(x), toJ(z))];
    const R = this.rooms[r0];
    if (!R || R.isVoid || R.type === 'stair' || R.type === 'shaft' || R.pool) return false;
    for (let i = toI(x - hx); i <= toI(x + hx); i++) for (let j = toJ(z - hz); j <= toJ(z + hz); j++) {
      if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) return false;
      if (this.room[idx(i, j)] !== r0) return false;
    }
    return true;
  }
  // place only if it fits
  itemFit(t, x, z, rot = 0, extra = {}) { return this.fits(t, x, z, rot, extra.w, extra.d) ? this.item(t, x, z, rot, extra) : null; }

  // wSet: the layout chose an explicit width; otherwise the renderer sizes the sign by style & text (furniture.js signWidth)
  sign(text, x, z, rot, opts = {}) { this.signs.push({ text, x, z, rot, y: opts.y ?? 2.05, w: opts.w ?? Math.max(1.2, text.length * 0.13), wSet: opts.w != null, style: opts.style || 'brass', sub: opts.sub || '' }); }

  // Place a door on the boundary between rooms a and b. Finds the shared boundary runs and
  // chooses the one nearest `near` (or the longest), centred on near if given.
  connect(a, b, opts = {}) {
    if (!a || !b) return null;
    const w = opts.w ?? 1.0;
    const runs = this.sharedRuns(a.id, b.id);
    if (!runs.length) { if (opts.debug !== false && !opts.quiet) console.warn(`[plan] D${this.deck} no shared boundary ${a.name || a.type} ↔ ${b.name || b.type}`); return null; }
    let best = null, bestScore = Infinity;
    for (const r of runs) {
      let score;
      if (opts.near) {
        const c = Math.max(r.a0, Math.min(r.a1, r.normal === 'x' ? opts.near[1] : opts.near[0]));
        const px = r.normal === 'x' ? r.line : c, pz = r.normal === 'x' ? c : r.line;
        score = Math.hypot(px - opts.near[0], pz - opts.near[1]);
      } else score = -(r.a1 - r.a0);
      if ((r.a1 - r.a0) < Math.min(w, 1.0) - 1e-6) score += 1e6;
      if (score < bestScore) { bestScore = score; best = r; }
    }
    const r = best; if (!r) return null;
    const len = Math.min(w, r.a1 - r.a0);
    let c;
    if (opts.near) c = r.normal === 'x' ? opts.near[1] : opts.near[0];
    else c = (r.a0 + r.a1) / 2;
    c = Math.max(r.a0 + len / 2, Math.min(r.a1 - len / 2, c));
    let s0 = Math.round((c - len / 2) / GRID.cell) * GRID.cell, s1 = s0 + Math.round(len / GRID.cell) * GRID.cell;
    // snap relative to grid origin
    const org = r.normal === 'x' ? GRID.z0 : GRID.x0;
    s0 = org + Math.round((c - len / 2 - org) / GRID.cell) * GRID.cell; s1 = s0 + Math.max(1, Math.round(len / GRID.cell)) * GRID.cell;
    if (s0 < r.a0 - 1e-6) { s1 += r.a0 - s0; s0 = r.a0; }
    if (s1 > r.a1 + 1e-6) { s0 -= s1 - r.a1; s1 = r.a1; }
    const door = {
      id: this.doors.length, deck: this.deck, normal: r.normal, line: r.line, a0: s0, a1: s1,
      type: opts.type || 'swing', access: opts.access || 'none', rooms: [a.id, b.id],
      x: r.normal === 'x' ? r.line : (s0 + s1) / 2, z: r.normal === 'x' ? (s0 + s1) / 2 : r.line,
      w: s1 - s0, label: opts.label || '', open: 0, locked: !!opts.locked, sideA: r.sideA === a.id ? a.id : b.id,
      ...opts.extra,
    };
    this.doors.push(door);
    return door;
  }

  // Shared boundary runs between room ids A and B. normal 'x' = boundary at constant x (runs along z).
  sharedRuns(A, B) {
    const { nx, nz, cell, x0, z0 } = GRID;
    const runs = [];
    const ra = this.rooms[A], rb = this.rooms[B];
    if (!ra || !rb || ra.bi1 < 0 || rb.bi1 < 0) return runs;
    // search only where the two (stale-safe, grown) boxes touch
    const I0 = Math.max(0, Math.max(ra.bi0, rb.bi0) - 1), I1 = Math.min(nx - 1, Math.min(ra.bi1, rb.bi1) + 1);
    const J0 = Math.max(0, Math.max(ra.bj0, rb.bj0) - 1), J1 = Math.min(nz - 1, Math.min(ra.bj1, rb.bj1) + 1);
    if (I0 > I1 || J0 > J1) return runs;
    // constant-x boundaries
    for (let i = I0; i < Math.min(I1 + 1, nx - 1); i++) {
      let start = -1, sideA = 0;
      for (let j = J0; j <= J1 + 1; j++) {
        let hit = false, sa = 0;
        if (j <= J1) {
          const p = this.room[idx(i, j)], q = this.room[idx(i + 1, j)];
          if ((p === A && q === B) || (p === B && q === A)) { hit = true; sa = p; }
        }
        if (hit && start < 0) { start = j; sideA = sa; }
        if (!hit && start >= 0) { runs.push({ normal: 'x', line: x0 + (i + 1) * cell, a0: z0 + start * cell, a1: z0 + j * cell, sideA }); start = -1; }
      }
    }
    for (let j = J0; j < Math.min(J1 + 1, nz - 1); j++) {
      let start = -1, sideA = 0;
      for (let i = I0; i <= I1 + 1; i++) {
        let hit = false, sa = 0;
        if (i <= I1) {
          const p = this.room[idx(i, j)], q = this.room[idx(i, j + 1)];
          if ((p === A && q === B) || (p === B && q === A)) { hit = true; sa = p; }
        }
        if (hit && start < 0) { start = i; sideA = sa; }
        if (!hit && start >= 0) { runs.push({ normal: 'z', line: z0 + (j + 1) * cell, a0: x0 + start * cell, a1: x0 + i * cell, sideA }); start = -1; }
      }
    }
    return runs;
  }

  // ── Derive edges, bounds, POIs ────────────────────────────────────────────
  finalize() {
    const { nx, nz, cell } = GRID;
    const N = nx * nz;
    // room bounds
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const r = this.rooms[this.room[idx(i, j)]];
      if (!r) continue;
      r.cells++;
      const x = cellX(i), z = cellZ(j);
      if (x - 0.25 < r.x0) r.x0 = x - 0.25; if (x + 0.25 > r.x1) r.x1 = x + 0.25;
      if (z - 0.25 < r.z0) r.z0 = z - 0.25; if (z + 0.25 > r.z1) r.z1 = z + 0.25;
    }
    for (const r of this.rooms) if (r) { r.cx = (r.x0 + r.x1) / 2; r.cz = (r.z0 + r.z1) / 2; r.area = r.cells * cell * cell; }

    // edge types: 0 none, 1 wall, 2 door, 3 rail, 4 facade (interior↔outside/exterior), 6 glass rail (void/balcony)
    this.ex = new Uint8Array(N); this.ez = new Uint8Array(N);
    this.dx = new Int16Array(N).fill(-1); this.dz = new Int16Array(N).fill(-1);
    for (const d of this.doors) {
      if (d.normal === 'x') {
        const i = Math.round((d.line - GRID.x0) / cell) - 1;
        for (let j = Math.round((d.a0 - GRID.z0) / cell); j < Math.round((d.a1 - GRID.z0) / cell); j++) this.dx[idx(i, j)] = d.id;
      } else {
        const j = Math.round((d.line - GRID.z0) / cell) - 1;
        for (let i = Math.round((d.a0 - GRID.x0) / cell); i < Math.round((d.a1 - GRID.x0) / cell); i++) this.dz[idx(i, j)] = d.id;
      }
    }
    const classify = (a, b) => {
      if (a === b) return 0;
      if (this.isOpen(a, b)) return 0;
      const ra = this.rooms[a], rb = this.rooms[b];
      if (!ra || !rb) {
        const r = ra || rb;
        if (r.isVoid) return 4;
        return r.exterior ? (r.type === 'balcony' || r.type === 'pooldeck' || r.type === 'deck' ? 6 : 3) : 4;
      }
      if (ra.isVoid || rb.isVoid) {
        const o = ra.isVoid ? rb : ra;
        if (ra.isVoid && rb.isVoid) return 0;
        if (o.type === 'stair' || o.type === 'shaft') return 1;
        return 6;
      }
      if (ra.pool || rb.pool) return 0;
      if (ra.exterior && rb.exterior) {
        if (ra.type === 'balcony' || rb.type === 'balcony' || ra.zone !== rb.zone) return 1;
        return 0;
      }
      if (ra.exterior || rb.exterior) return 4;
      return 1;
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = idx(i, j);
      const a = this.room[k];
      if (i < nx - 1) { const t = this.dx[k] >= 0 ? 2 : classify(a, this.room[k + 1]); this.ex[k] = t; }
      if (j < nz - 1) { const t = this.dz[k] >= 0 ? 2 : classify(a, this.room[k + nx]); this.ez[k] = t; }
    }
    for (const f of this.forced) {
      if (f.normal === 'x') {
        const i = Math.round((f.line - GRID.x0) / cell) - 1;
        for (let j = Math.round((f.a0 - GRID.z0) / cell); j < Math.round((f.a1 - GRID.z0) / cell); j++) if (i >= 0 && j >= 0 && j < nz) this.ex[idx(i, j)] = 1;
      } else {
        const j = Math.round((f.line - GRID.z0) / cell) - 1;
        for (let i = Math.round((f.a0 - GRID.x0) / cell); i < Math.round((f.a1 - GRID.x0) / cell); i++) if (j >= 0 && i >= 0 && i < nx) this.ez[idx(i, j)] = 1;
      }
    }

    // Nav blocking from furniture
    this.block = new Uint8Array(N);
    for (const it of this.items) {
      const def = FDEF[it.t];
      if (!def.block) continue;
      const w = it.w ?? def.w, d = it.d ?? def.d;
      const c = Math.cos(it.rot), s = Math.sin(it.rot);
      const hx = Math.abs(c) * w / 2 + Math.abs(s) * d / 2, hz = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;
      it.hx = hx; it.hz = hz;
      for (let i = toI(it.x - hx + 0.05); i <= toI(it.x + hx - 0.05); i++) for (let j = toJ(it.z - hz + 0.05); j <= toJ(it.z + hz - 0.05); j++) {
        if (i >= 0 && j >= 0 && i < nx && j < nz && (!it.room || this.room[idx(i, j)] === it.room)) this.block[idx(i, j)] = 1;
      }
    }
    for (let k = 0; k < N; k++) { const r = this.rooms[this.room[k]]; if (!r || r.isVoid || r.type === 'shaft') this.block[k] = 1; }

    // POIs from item anchors
    this.pois = [];
    for (const it of this.items) {
      const def = FDEF[it.t];
      if (!def.anchors) continue;
      const c = Math.cos(it.rot), s = Math.sin(it.rot);
      for (const a of def.anchors) {
        const px = it.x + a.x * c + a.z * s, pz = it.z - a.x * s + a.z * c;
        const room = this.rooms[it.room];
        this.pois.push({
          deck: this.deck, x: px, z: pz, rot: it.rot + (a.rot || 0), pose: a.pose, h: a.h || 0,
          act: a.act || it.act || (room ? actFor(room) : 'idle'), role: it.role || a.role || null,
          room: it.room, item: it, taken: null,
        });
      }
    }
  }

  roomAt(x, z) { const i = toI(x), j = toJ(z); if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) return null; return this.rooms[this.room[idx(i, j)]] || null; }
}

function actFor(room) {
  switch (room.dens) {
    case 'dining': case 'buffet': case 'crewmess': return 'eat';
    case 'bar': case 'club': case 'crewbar': return 'drink';
    case 'casino': return 'gamble';
    case 'theater': return 'watch';
    case 'pool': return 'sunbathe';
    case 'lounge': return 'relax';
    default: return 'idle';
  }
}
