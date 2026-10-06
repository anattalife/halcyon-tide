// HALCYON TIDE — NPC navigation on the 0.5 m deck grid.
//  • Per-deck nav masks derived from DeckPlan (walkable cells, zone requirements, soft costs near walls/seats,
//    door access bits), built lazily the first time a deck is used.
//  • A* (8-connected, no corner cutting) with a binary heap over typed arrays + generation counters,
//    bounded expansions, slight heuristic weighting. Edge types 1/3/4/6 block; doors (2) pass if the
//    agent's access mask satisfies the door; elevator doors never.
//  • String-pulling smoothing with clearance (three parallel grid rays).
//  • Path cache, per-frame search budget (count + milliseconds), request queue with priorities.
//  • Stair lanes (rooms with `ramp`) are exposed for cross-deck routing (walk the ramp; deck changes when the
//    relative height passes ±1.5 m — same rule as the player).
import { GRID, deckY, cellX, cellZ, toI, toJ } from '../core/config.js';
import { FDEF } from '../world/furnitureDefs.js';

const NX = GRID.nx, NZ = GRID.nz, N = NX * NZ, CELL = GRID.cell;
// Access bits
export const ACC = { crew: 2, officer: 4, security: 8, engineer: 16, casino: 32, vip: 64, cabins: 128 };
const NEVER = 255;
const SOFT = 8;            // cost value marking seats (avoid walking through, block smoothing)
const SOFT_ITEMS = new Set(['chair', 'stool', 'theater_seat', 'deck_chair', 'office_chair']);
const EXTRA_BLOCK = new Set(['hot_tub', 'stage', 'slide', 'luggage', 'linen_cart', 'parasol']);

export function accessBit(a) {
  if (!a || a === 'none') return 0;
  if (a.startsWith('cabin:')) return ACC.cabins;
  return ACC[a] || ACC.crew;
}
export function maskFromAccess(set) {
  let m = 0;
  if (!set) return 0;
  for (const a of set) m |= a.startsWith?.('cabin:') ? 0 : (ACC[a] || 0);
  if (set.has?.('master')) m |= ACC.cabins;
  return m;
}

class DeckNav {
  constructor(plan, staged = false) {
    this.plan = plan; this.deck = plan.deck; this.ready = false;
    this._it = this._build();
    if (!staged) this.finish();
  }
  finish() { if (!this.ready) { while (!this._it.next().done); } }
  step() { if (this.ready) return true; return !!this._it.next().done; }
  *_build() {
    const plan = this.plan;
    const walk = this.walk = new Uint8Array(N), req = this.req = new Uint8Array(N), cost = this.cost = new Uint8Array(N), pool = this.pool = new Uint8Array(N);
    const rooms = plan.rooms, room = plan.room, block = plan.block;
    // Own furniture mask: plan.block bleeds footprints a few cm across walls into neighbouring rooms
    // (e.g. cabin armchairs blocking the corridor's edge row). Only block cells of the item's own room.
    const fblock = new Uint8Array(N);
    for (const it of plan.items) {
      const def = FDEF[it.t]; if (!def || !def.block || !it.hx) continue;
      for (let i = toI(it.x - it.hx + 0.05); i <= toI(it.x + it.hx - 0.05); i++) for (let j = toJ(it.z - it.hz + 0.05); j <= toJ(it.z + it.hz - 0.05); j++) {
        if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
        const k = j * NX + i;
        if (room[k] !== it.room && it.room) {
          // keep only if the cell centre is well inside the footprint
          const cx = cellX(i), cz = cellZ(j);
          if (Math.abs(cx - it.x) > it.hx - 0.2 || Math.abs(cz - it.z) > it.hz - 0.2) continue;
        }
        fblock[k] = 1;
      }
    }
    yield 1;
    for (let k = 0; k < N; k++) {
      if (k % (NX * 10) === 0 && k) yield 1;
      const r = rooms[room[k]];
      if (!r || r.isVoid || r.type === 'shaft' || r.type === 'stair' || fblock[k]) continue;   // stairs: scripted lane traversal only
      walk[k] = 1;
      if (r.pool) pool[k] = 1;
      if (r.zone === 'crew') req[k] = ACC.crew;
      else if (r.zone === 'restricted') req[k] = r.access && r.access !== 'none' ? (accessBit(r.access) | ACC.security) : (ACC.officer | ACC.security | ACC.engineer);
    }
    for (const it of plan.items) {
      const soft = SOFT_ITEMS.has(it.t), hard = EXTRA_BLOCK.has(it.t);
      if (!soft && !hard) continue;
      const w = (it.w ?? defW(it.t)) * (soft ? 0.8 : 1), d = (it.d ?? defD(it.t)) * (soft ? 0.8 : 1);
      const c = Math.abs(Math.cos(it.rot)), s = Math.abs(Math.sin(it.rot));
      const hx = c * w / 2 + s * d / 2, hz = s * w / 2 + c * d / 2;
      for (let i = toI(it.x - hx + 0.06); i <= toI(it.x + hx - 0.06); i++) for (let j = toJ(it.z - hz + 0.06); j <= toJ(it.z + hz - 0.06); j++) {
        if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
        const k = j * NX + i;
        if (hard) walk[k] = 0; else if (walk[k]) cost[k] = SOFT;
      }
    }
    yield 2;
    // near-wall penalty (keeps agents off walls, in the middle of corridors)
    const ex = plan.ex, ez = plan.ez;
    for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) {
      if (i === 1 && j % 10 === 0) yield 2;
      const k = j * NX + i; if (!walk[k] || cost[k]) continue;
      const wl = (t) => t === 1 || t === 3 || t === 4 || t === 6;
      if (wl(ex[k]) || wl(ex[k - 1]) || wl(ez[k]) || wl(ez[k - NX]) || !walk[k + 1] || !walk[k - 1] || !walk[k + NX] || !walk[k - NX]) cost[k] = 3;
    }
    yield 3;
    const D = plan.doors.length;
    this.doorReq = new Uint8Array(D); this.doorCabin = new Int32Array(D);
    for (const d of plan.doors) {
      if (d.type === 'elevator') { this.doorReq[d.id] = NEVER; continue; }
      this.doorReq[d.id] = accessBit(d.access);
      if (d.access && d.access.startsWith('cabin:')) this.doorCabin[d.id] = parseInt(d.access.slice(6), 10) || 0;
    }
    // stair lanes
    this.lanes = [];
    for (const r of rooms) if (r && r.ramp) {
      const dir = Math.sign(r.ramp.xt - r.ramp.xb);
      this.lanes.push({ room: r.id, core: r.core, up: r.ramp.dy > 0, xb: r.ramp.xb, xt: r.ramp.xt, dir, zc: (r.z0 + r.z1) / 2, crew: r.zone === 'crew', toDeck: plan.deck + (r.ramp.dy > 0 ? 1 : -1) });
    }
    yield 4;
    // room adjacency graph (for corridor-restricted A* on long paths): one entry per room pair with the
    // portal (door id or -1 for an open boundary) and a representative crossing point
    const adj = new Map();
    const addAdj = (a, b, door, x, z) => {
      if (a === b || !rooms[a] || !rooms[b]) return;
      const key = a < b ? a * 65536 + b + (door >= 0 ? door * 4294967296 : 0) : b * 65536 + a + (door >= 0 ? door * 4294967296 : 0);
      if (!adj.has(key)) adj.set(key, { a, b, door, x, z, n: 1 }); else { const e = adj.get(key); e.x += x; e.z += z; e.n++; }
    };
    for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) {
      if (i === 1 && j % 12 === 0) yield 5;
      const k = j * NX + i; if (!walk[k]) continue;
      if (walk[k + 1] && room[k + 1] !== room[k] && (ex[k] === 0 || ex[k] === 2)) addAdj(room[k], room[k + 1], ex[k] === 2 ? plan.dx[k] : -1, cellX(i) + CELL / 2, cellZ(j));
      if (walk[k + NX] && room[k + NX] !== room[k] && (ez[k] === 0 || ez[k] === 2)) addAdj(room[k], room[k + NX], ez[k] === 2 ? plan.dz[k] : -1, cellX(i), cellZ(j) + CELL / 2);
    }
    this.radj = rooms.map(() => []);
    for (const e of adj.values()) { e.x /= e.n; e.z /= e.n; this.radj[e.a].push(e); this.radj[e.b].push(e); }
    // passenger lobbies (elevator hall) per core
    this.lobbies = [];
    for (const c of plan.cores) {
      const r = rooms[c.lobby];
      const doors = plan.doors.filter(d => d.type === 'elevator' && d.rooms.includes(c.lobby));
      this.lobbies.push({ core: c.core, kind: c.kind, room: c.lobby, x: c.x, crew: r.zone === 'crew', doors });
    }
    this.ready = true;
  }
}
function defW(t) { return FDEF[t]?.w ?? 0.5; }
function defD(t) { return FDEF[t]?.d ?? 0.5; }

const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
const DC = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export class NavSystem {
  constructor(game) {
    this.game = game; this.world = game.world; this.plans = game.world.plans;
    this.decks = [];
    this.g = new Float32Array(N); this.par = new Int32Array(N); this.gen = new Uint32Array(N); this.closed = new Uint32Array(N);
    this.curGen = 1;
    const HC = 1 << 17;
    this.hk = new Int32Array(HC); this.hf = new Float32Array(HC); this.hn = 0; this.hcap = HC;
    this.cells = new Int32Array(4096);
    this.cache = new Map(); this.cacheMax = 400;
    this.blockedDoors = new Map();     // deck*100000+id → expiry (game seconds)
    this.queue = []; this.hiQueue = [];
    this.maxNodes = 9000;
    this.roomMark = new Uint32Array(4096); this.roomGen = 1;
    this.rDist = new Float32Array(4096); this.rPrev = new Int32Array(4096); this.rGen = new Uint32Array(4096); this.rGenC = 1;
    this.coarse = new Map();
    this.negCache = new Map();        // unreachable (deck:startBlock:goalRoom:mask:own) → expiry
    this.routeCache = new Map();      // room-graph routes (deck:roomA:roomB:mask:own) → room id list | null          // coarse path cache: 2 m start block × 2 m goal block
    this.stats = { searches: 0, fails: 0, cacheHits: 0, nodes: 0, ms: 0, frameSearches: 0, pathLenSum: 0, pathCount: 0 };
    this.time = 0;
  }

  deck(d) {
    const dn = this.decks[d];
    if (dn) { if (!dn.ready) dn.finish(); return dn; }
    return this.plans[d] ? (this.decks[d] = new DeckNav(this.plans[d])) : null;
  }
  // background build: one stage (~10–25 ms) per call so a later deck change does not pay for it
  buildStep(d) {
    if (!this.plans[d]) return false;
    let dn = this.decks[d];
    if (!dn) { dn = this.decks[d] = new DeckNav(this.plans[d], true); return true; }
    if (dn.ready) return false;
    dn.step(); return true;
  }
  isBuilt(d) { return !!this.decks[d]?.ready; }

  // ── cell predicates ────────────────────────────────────────────────────
  canEnter(dn, k, mask, swim) {
    if (!dn.walk[k]) return false;
    const r = dn.req[k]; if (r && !(mask & r)) return false;
    if (dn.pool[k] && !swim) return false;
    return true;
  }
  doorOk(dn, id, mask, own) {
    const r = dn.doorReq[id];
    if (r === NEVER) return false;
    if (this.blockedDoors.size && this.blockedDoors.has(dn.deck * 100000 + id)) return false;
    if (r === 0 || (mask & r)) return true;
    return own > 0 && dn.doorCabin[id] === own;
  }
  edge(dn, t, door, mask, own) { return t === 0 || (t === 2 && this.doorOk(dn, door, mask, own)); }
  blockDoor(deck, id, seconds = 30) { this.blockedDoors.set(deck * 100000 + id, this.time + seconds); this.cache.clear(); this.coarse.clear(); this.negCache.clear(); this.routeCache.clear(); }

  // can an agent step from (x0,z0) to (x1,z1) (adjacent or same cell) without crossing a wall edge?
  stepOk(d, x0, z0, x1, z1, mask = 0, swim = false, own = 0) {
    const dn = this.deck(d); if (!dn) return false;
    const i0 = toI(x0), j0 = toJ(z0), i1 = toI(x1), j1 = toJ(z1);
    if (i1 < 1 || j1 < 1 || i1 >= NX - 1 || j1 >= NZ - 1) return false;
    if (!this.canEnter(dn, j1 * NX + i1, mask, swim)) return false;
    if (i0 === i1 && j0 === j1) return true;
    if (Math.abs(i1 - i0) > 1 || Math.abs(j1 - j0) > 1) return this.segClearRaw(dn, x0, z0, x1, z1, mask, own, swim);
    const ex = dn.plan.ex, ez = dn.plan.ez;
    const okX = (i, j) => { const k = j * NX + Math.min(i, i + 1); return this.edge(dn, ex[k], dn.plan.dx[k], mask, own); };
    const eX = (ia, ib, j) => { const k = j * NX + Math.min(ia, ib); return this.edge(dn, ex[k], dn.plan.dx[k], mask, own); };
    const eZ = (i, ja, jb) => { const k = Math.min(ja, jb) * NX + i; return this.edge(dn, ez[k], dn.plan.dz[k], mask, own); };
    void okX;
    if (j0 === j1) return eX(i0, i1, j0);
    if (i0 === i1) return eZ(i0, j0, j1);
    // diagonal: either L-shaped route must be open
    return (eX(i0, i1, j0) && eZ(i1, j0, j1) && this.canEnter(dn, j0 * NX + i1, mask, swim)) || (eZ(i0, j0, j1) && eX(i0, i1, j1) && this.canEnter(dn, j1 * NX + i0, mask, swim));
  }
  segClearRaw(dn, x0, z0, x1, z1, mask, own, swim) { return this._ray(dn, x0, z0, x1, z1, mask, own, swim, false); }

  passable(d, x, z, mask = 0, swim = false) {
    const dn = this.deck(d); if (!dn) return false;
    const i = toI(x), j = toJ(z); if (i < 0 || j < 0 || i >= NX || j >= NZ) return false;
    return this.canEnter(dn, j * NX + i, mask, swim);
  }
  isPool(d, x, z) { const dn = this.deck(d); const i = toI(x), j = toJ(z); if (!dn || i < 0 || j < 0 || i >= NX || j >= NZ) return false; return dn.pool[j * NX + i] === 1; }

  nearest(dn, x, z, mask, swim = false, maxR = 6) {
    const ci = toI(x), cj = toJ(z);
    const r0 = ci >= 0 && cj >= 0 && ci < NX && cj < NZ ? dn.plan.room[cj * NX + ci] : -1;
    const ex = dn.plan.ex, ez = dn.plan.ez;
    for (let r = 0; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj; if (i < 1 || j < 1 || i >= NX - 1 || j >= NZ - 1) continue;
        const k = j * NX + i;
        if (!this.canEnter(dn, k, mask, swim)) continue;
        let dd = (cellX(i) - x) ** 2 + (cellZ(j) - z) ** 2 + (dn.cost[k] >= SOFT ? 1 : 0);
        if (dn.plan.room[k] !== r0) {
          // different room: only acceptable if no wall separates it from the query cell's neighbourhood
          const open = (di === 1 && dj === 0 && (ex[cj * NX + ci] === 0 || ex[cj * NX + ci] === 2)) || (di === -1 && dj === 0 && (ex[cj * NX + ci - 1] === 0 || ex[cj * NX + ci - 1] === 2))
            || (dj === 1 && di === 0 && (ez[cj * NX + ci] === 0 || ez[cj * NX + ci] === 2)) || (dj === -1 && di === 0 && (ez[(cj - 1) * NX + ci] === 0 || ez[(cj - 1) * NX + ci] === 2));
          dd += open ? 0.5 : 25;
        }
        if (dd < bd) { bd = dd; best = k; }
      }
      if (best >= 0 && (bd < 25 || r >= maxR)) return best;
      if (best >= 0 && r >= 2) return best;
    }
    return -1;
  }
  nearestPoint(d, x, z, mask = 0, maxR = 6) {
    const dn = this.deck(d); if (!dn) return null;
    const k = this.nearest(dn, x, z, mask, false, maxR); if (k < 0) return null;
    return { x: cellX(k % NX), z: cellZ((k / NX) | 0), k };
  }

  // ── A* ─────────────────────────────────────────────────────────────────
  _push(k, f) {
    if (this.hn >= this.hcap) return;
    const hk = this.hk, hf = this.hf; let i = this.hn++;
    while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hk[i] = hk[p]; hf[i] = hf[p]; i = p; }
    hk[i] = k; hf[i] = f;
  }
  _pop() {
    const hk = this.hk, hf = this.hf; const top = hk[0]; const n = --this.hn;
    if (n > 0) {
      const k = hk[n], f = hf[n]; let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        hk[i] = hk[c]; hf[i] = hf[c]; i = c;
      }
      hk[i] = k; hf[i] = f;
    }
    return top;
  }

  // Synchronous path. Returns Float32Array [x0,z0,x1,z1,...] (first = start position) or null.
  findPath(d, sx, sz, gx, gz, mask = 0, opts = {}) {
    const st = this._begin(d, sx, sz, gx, gz, mask, opts);
    if (!st.search) return st.result;
    this._run(st, Infinity);
    return st.result;
  }

  // Set up a search. Returns {search:false, result} for trivial / cached / known-unreachable queries, else a
  // search state that _run() advances (resumable: the open set lives in the shared heap until done).
  _begin(d, sx, sz, gx, gz, mask = 0, opts = {}) {
    const dn = this.deck(d); if (!dn) return { search: false, result: null };
    const own = opts.own || 0, swim = !!opts.swim;
    const s = this.nearest(dn, sx, sz, mask, swim, 4), g = this.nearest(dn, gx, gz, mask, swim, opts.goalR ?? 6);
    if (s < 0 || g < 0) { this.stats.fails++; return { search: false, result: null }; }
    const key = d + ':' + s + ':' + g + ':' + mask + ':' + own + (swim ? 's' : '');
    const hit = this.cache.get(key);
    if (hit) { this.stats.cacheHits++; this.cache.delete(key); this.cache.set(key, hit); return { search: false, result: this._withEnds(hit, sx, sz, gx, gz, dn, g) }; }
    // coarse cache: a path between the same 2 m blocks, usable if we can walk straight onto / off it
    const ck = d + ':' + (((s % NX) >> 2) + ((((s / NX) | 0) >> 2) << 10)) + ':' + (((g % NX) >> 2) + ((((g / NX) | 0) >> 2) << 10)) + ':' + mask + ':' + own + (swim ? 's' : '');
    const ch = this.coarse.get(ck);
    if (ch && ch.length >= 4) {
      const n = ch.length;
      if (this.segClear(dn, sx, sz, ch[2], ch[3], mask, own, swim) && this.segClear(dn, ch[n - 4], ch[n - 3], gx, gz, mask, own, swim)) {
        this.stats.cacheHits++;
        const p = new Float32Array(n); p.set(ch); p[0] = sx; p[1] = sz; p[n - 2] = gx; p[n - 1] = gz;
        if (!this.canEnter(dn, g, mask, swim) || toI(gx) !== g % NX || toJ(gz) !== ((g / NX) | 0)) { p[n - 2] = ch[n - 2]; p[n - 1] = ch[n - 1]; }
        return { search: false, result: p };
      }
    }
    const nk = d + ':' + (((s % NX) >> 2) + ((((s / NX) | 0) >> 2) << 10)) + ':' + dn.plan.room[g] + ':' + mask + ':' + own + (swim ? 's' : '');
    const neg = this.negCache.get(nk);
    if (neg !== undefined && neg > this.time) { this.stats.fails++; this.stats.negHits = (this.stats.negHits || 0) + 1; return { search: false, result: null }; }
    this.stats.searches++; this.stats.frameSearches++;
    // long trips: restrict the cell search to the rooms along the best room-graph route (+ neighbours)
    const far = Math.hypot((s % NX) - (g % NX), ((s / NX) | 0) - ((g / NX) | 0)) > 80;
    let rgen = 0;
    if (far && !opts.noCorridor) {
      rgen = this._roomRoute(dn, dn.plan.room[s], dn.plan.room[g], mask, own);
      if (!rgen && this._lastRouteNone) { this.stats.fails++; this.negCache.set(nk, this.time + 10); return { search: false, result: null }; }
    }
    if (++this.curGen > 0xfffffff0) { this.gen.fill(0); this.closed.fill(0); this.curGen = 1; }
    const st = { search: true, done: false, result: null, d, dn, sx, sz, gx, gz, mask, own, swim, opts, s, g, key, ck, nk, far, rgen,
      gen: this.curGen, exp: 0, maxN: opts.maxNodes || (opts.hi ? this.maxNodes * 1.6 : this.maxNodes), W: far ? 1.3 : 1.12, ms: 0 };
    this.hn = 0;
    this.G = this.g;
    this.g[s] = 0; this.par[s] = -1; this.gen[s] = st.gen; this._push(s, this._h(st, s));
    return st;
  }
  _h(st, k) { const gi = st.g % NX, gj = (st.g / NX) | 0, i = k % NX, j = (k / NX) | 0; const ax = Math.abs(i - gi), az = Math.abs(j - gj); return (ax > az ? ax + 0.4142 * az : az + 0.4142 * ax) * st.W; }

  // advance a search until done or the deadline (performance.now() ms) passes; returns true when done
  _run(st, deadline) {
    if (st.cellsOut) return this._finish(st, deadline);   // search done, smoothing in progress
    const t0 = performance.now();
    const dn = st.dn, mask = st.mask, own = st.own, swim = st.swim, gen = st.gen, g = st.g;
    const G = this.g, par = this.par, GEN = this.gen, CL = this.closed;
    const walk = dn.walk, req = dn.req, pool = dn.pool, cost = dn.cost, ex = dn.plan.ex, ez = dn.plan.ez, dxA = dn.plan.dx, dzA = dn.plan.dz;
    const gi = g % NX, gj = (g / NX) | 0, W = st.W;
    const roomA = dn.plan.room, rmark = st.rgen ? this.roomMark : null, rgen = st.rgen;
    const enter = rmark ? (k) => walk[k] && (!req[k] || (mask & req[k])) && (!pool[k] || swim) && rmark[roomA[k]] === rgen
      : (k) => walk[k] && (!req[k] || (mask & req[k])) && (!pool[k] || swim);
    const E = (k) => { const t = ex[k]; return t === 0 || (t === 2 && this.doorOk(dn, dxA[k], mask, own)); };
    const S = (k) => { const t = ez[k]; return t === 0 || (t === 2 && this.doorOk(dn, dzA[k], mask, own)); };
    let found = false, exp = st.exp, tick = 0, paused = false;
    while (this.hn > 0) {
      if ((++tick & 63) === 0 && performance.now() > deadline) { paused = true; break; }
      const k = this._pop();
      if (CL[k] === gen) continue;
      CL[k] = gen;
      if (k === g) { found = true; break; }
      if (++exp > st.maxN) break;
      const i = k % NX, j = (k / NX) | 0;
      if (i < 1 || j < 1 || i >= NX - 1 || j >= NZ - 1) continue;
      const gk = G[k];
      const okE = E(k) && enter(k + 1), okW = E(k - 1) && enter(k - 1), okS = S(k) && enter(k + NX), okN = S(k - NX) && enter(k - NX);
      for (let dI = 0; dI < 8; dI++) {
        let ok;
        switch (dI) {
          case 0: ok = okE; break; case 1: ok = okW; break; case 2: ok = okS; break; case 3: ok = okN; break;
          case 4: ok = okE && okS && S(k + 1) && E(k + NX) && enter(k + NX + 1); break;               // +i +j
          case 5: ok = okE && okN && S(k + 1 - NX) && E(k - NX) && enter(k - NX + 1); break;          // +i -j
          case 6: ok = okW && okS && S(k - 1) && E(k + NX - 1) && enter(k + NX - 1); break;           // -i +j
          default: ok = okW && okN && S(k - 1 - NX) && E(k - NX - 1) && enter(k - NX - 1); break;     // -i -j
        }
        if (!ok) continue;
        const q = k + DI[dI] + DJ[dI] * NX;
        if (CL[q] === gen) continue;
        const ng = gk + DC[dI] * (1 + cost[q] * 0.12);
        if (GEN[q] === gen && G[q] <= ng) continue;
        GEN[q] = gen; G[q] = ng; par[q] = k;
        const ax = Math.abs((q % NX) - gi), az = Math.abs(((q / NX) | 0) - gj);
        this._push(q, ng + (ax > az ? ax + 0.4142 * az : az + 0.4142 * ax) * W);
      }
    }
    this.stats.nodes += exp - st.exp; st.exp = exp;
    st.ms += performance.now() - t0; this.stats.ms += performance.now() - t0;
    if (paused) return false;
    st.done = true;
    if (found) {
      let n = 0, c = g;
      while (c >= 0 && n < this.cells.length) { this.cells[n++] = c; c = par[c]; }
      st.cellsOut = this.cells.subarray(0, n).slice().reverse();
      st.done = false;
      return this._finish(st, deadline);
    }
    if (rmark) {
      // corridor too tight (route through rooms the graph mis-ranked): restart unrestricted
      this.stats.retries = (this.stats.retries || 0) + 1;
      const st2 = this._begin(st.d, st.sx, st.sz, st.gx, st.gz, mask, { ...st.opts, noCorridor: true });
      if (!st2.search) { st.result = st2.result; return true; }
      Object.assign(st, st2, { ms: st.ms }); st.done = false;
      return this._run(st, deadline);
    }
    this.stats.fails++;
    // remember only truly unreachable goals (open set exhausted); a capped search may succeed next time
    if (st.exp <= st.maxN) { this.negCache.set(st.nk, this.time + 10); if (this.negCache.size > 300) this.negCache.delete(this.negCache.keys().next().value); }
    else this.stats.capFails = (this.stats.capFails || 0) + 1;
    st.result = null;
    return true;
  }

  _finish(st, deadline) {
    const t0 = performance.now();
    st.sm = st.sm || { a: 0, pts: null };
    if (!st.sm.pts) st.sm.pts = [cellX(st.cellsOut[0] % NX), cellZ((st.cellsOut[0] / NX) | 0)];
    const out = this._smooth(st.dn, st.cellsOut, st.mask, st.own, st.swim, st.sm, deadline);
    st.ms += performance.now() - t0; this.stats.ms += performance.now() - t0;
    if (!out) return false;
    st.done = true;
    this.cache.set(st.key, out);
    if (this.cache.size > this.cacheMax) this.cache.delete(this.cache.keys().next().value);
    this.coarse.set(st.ck, out); if (this.coarse.size > 600) this.coarse.delete(this.coarse.keys().next().value);
    st.result = this._withEnds(out, st.sx, st.sz, st.gx, st.gz, st.dn, st.g);
    return true;
  }

  // Dijkstra on the room adjacency graph; marks route rooms + their direct neighbours with a fresh generation.
  _roomRoute(dn, ra, rb, mask, own) {
    this._lastRouteNone = false;
    if (ra === rb || !dn.radj) return 0;
    const rooms = dn.plan.rooms, nR = rooms.length;
    if (nR > this.rDist.length) { this.rDist = new Float32Array(nR * 2); this.rPrev = new Int32Array(nR * 2); this.rGen = new Uint32Array(nR * 2); this.roomMark = new Uint32Array(nR * 2); }
    // cached route (room pairs repeat a lot: everyone walks the same corridors)
    const rk = dn.deck + ':' + ra + ':' + rb + ':' + mask + ':' + own;
    let route = this.routeCache.get(rk);
    if (route === undefined) {
      route = this._roomAstar(dn, ra, rb, mask, own);
      this.routeCache.set(rk, route); if (this.routeCache.size > 500) this.routeCache.delete(this.routeCache.keys().next().value);
    }
    if (!route) { this._lastRouteNone = true; return 0; }
    const mg = ++this.roomGen, MK = this.roomMark;
    for (const r of route) { MK[r] = mg; for (const e of dn.radj[r]) MK[e.a === r ? e.b : e.a] = mg; }
    return mg;
  }
  // A* over rooms (binary heap, generation-stamped arrays); returns the room list or null
  _roomAstar(dn, ra, rb, mask, own) {
    const rooms = dn.plan.rooms;
    const gen = ++this.rGenC, D = this.rDist, PV = this.rPrev, G = this.rGen, CLs = this.rClosed || (this.rClosed = new Uint32Array(this.rGen.length));
    if (CLs.length < G.length) this.rClosed = new Uint32Array(G.length);
    const CL = this.rClosed, RB = rooms[rb];
    const hk = [], hf = [];
    const push = (k, f) => { let i = hk.length; hk.push(k); hf.push(f); while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hk[i] = hk[p]; hf[i] = hf[p]; i = p; } hk[i] = k; hf[i] = f; };
    const pop = () => { const top = hk[0], lk = hk.pop(), lf = hf.pop(), n = hk.length; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hk[i] = hk[c]; hf[i] = hf[c]; i = c; } hk[i] = lk; hf[i] = lf; } return top; };
    const hh = (r) => { const q = rooms[r]; return Math.hypot((q.cx ?? 0) - (RB.cx ?? 0), (q.cz ?? 0) - (RB.cz ?? 0)); };
    D[ra] = 0; PV[ra] = -1; G[ra] = gen; push(ra, hh(ra));
    let found = false, it = 0;
    while (hk.length && it++ < 3000) {
      const r = pop();
      if (CL[r] === gen) continue; CL[r] = gen;
      if (r === rb) { found = true; break; }
      const R0 = rooms[r];
      for (const e of dn.radj[r]) {
        const o = e.a === r ? e.b : e.a; if (CL[o] === gen) continue;
        if (e.door >= 0 && !this.doorOk(dn, e.door, mask, own)) continue;
        const ro = rooms[o]; if (!ro) continue;
        if (ro.zone === 'crew' && !(mask & ACC.crew)) continue;
        if (ro.zone === 'restricted' && !(mask & (ACC.officer | ACC.security | ACC.engineer))) continue;
        // cabins are dead ends for through-routing unless they are the goal
        if ((ro.type === 'cabin' || ro.type === 'suite') && o !== rb) continue;
        const nd = D[r] + Math.hypot(e.x - (R0.cx ?? e.x), e.z - (R0.cz ?? e.z)) + Math.hypot((ro.cx ?? e.x) - e.x, (ro.cz ?? e.z) - e.z) + 1;
        if (G[o] !== gen || nd < D[o]) { G[o] = gen; D[o] = nd; PV[o] = r; push(o, nd + hh(o)); }
      }
    }
    if (!found) return null;
    const out = []; for (let r = rb; r >= 0; r = PV[r]) { out.push(r); if (r === ra) break; }
    return out;
  }
  // replace first/last points with the real start/goal when they are in the same cell
  _withEnds(path, sx, sz, gx, gz, dn, g) {
    const p = path.slice();
    p[0] = sx; p[1] = sz;
    const n = p.length;
    if (toI(gx) === g % NX && toJ(gz) === ((g / NX) | 0)) { p[n - 2] = gx; p[n - 1] = gz; }
    let len = 0; for (let i = 2; i < n; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    this.stats.pathLenSum += len; this.stats.pathCount++;
    return p;
  }

  _smooth(dn, cells, mask, own, swim, sm = null, deadline = Infinity) {
    const n = cells.length;
    const cx = (k) => cellX(k % NX), cz = (k) => cellZ((k / NX) | 0);
    if (n === 1) return new Float32Array([cx(cells[0]), cz(cells[0]), cx(cells[0]), cz(cells[0])]);
    // resumable greedy string pulling with a stride (probe 4 cells ahead, back off inside a failed stride);
    // `sm` keeps {a, pts} between calls when a deadline interrupts it
    const s = sm || { a: 0, pts: [cx(cells[0]), cz(cells[0])] };
    const pts = s.pts;
    let a = s.a, probes = 0;
    const ok = (i) => { probes++; return i - a <= 48 && this.segClear(dn, cx(cells[a]), cz(cells[a]), cx(cells[i]), cz(cells[i]), mask, own, swim); };
    while (a < n - 1) {
      if (probes > 24 && performance.now() > deadline) { s.a = a; return null; }
      let good = a + 1, i = a + 4;
      while (i < n && ok(i)) { good = i; i += 4; }
      for (let k = Math.min(i, n - 1); k > good; k--) if (k < n && ok(k)) { good = k; break; }
      if (good >= n - 1) break;
      a = good; pts.push(cx(cells[a]), cz(cells[a]));
    }
    pts.push(cx(cells[n - 1]), cz(cells[n - 1]));
    return new Float32Array(pts);
  }

  // straight walk clear between two points with ~0.2 m clearance
  segClear(dn, x0, z0, x1, z1, mask = 0, own = 0, swim = false) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 1e-4) return true;
    const px = -dz / L * 0.2, pz = dx / L * 0.2;
    return this._ray(dn, x0, z0, x1, z1, mask, own, swim, true) && this._ray(dn, x0 + px, z0 + pz, x1 + px, z1 + pz, mask, own, swim, false) && this._ray(dn, x0 - px, z0 - pz, x1 - px, z1 - pz, mask, own, swim, false);
  }
  _ray(dn, x0, z0, x1, z1, mask, own, swim, center) {
    const P = dn.plan, ex = P.ex, ez = P.ez;
    let i = toI(x0), j = toJ(z0); const ie = toI(x1), je = toJ(z1);
    const dx = x1 - x0, dz = z1 - z0;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = Math.abs(CELL / (dx || 1e-9)), tDZ = Math.abs(CELL / (dz || 1e-9));
    let tMX = dx ? (dx > 0 ? (GRID.x0 + (i + 1) * CELL - x0) / dx : (GRID.x0 + i * CELL - x0) / dx) : Infinity;
    let tMZ = dz ? (dz > 0 ? (GRID.z0 + (j + 1) * CELL - z0) / dz : (GRID.z0 + j * CELL - z0) / dz) : Infinity;
    let guard = 0;
    while ((i !== ie || j !== je) && guard++ < 400) {
      let k;
      if (tMX < tMZ) {
        const ei = stepX > 0 ? i : i - 1; if (ei < 0 || ei >= NX - 1) return false;
        const kk = j * NX + ei;
        if (!this.edge(dn, ex[kk], P.dx[kk], mask, own)) return false;
        i += stepX; tMX += tDX;
      } else {
        const ej = stepZ > 0 ? j : j - 1; if (ej < 0 || ej >= NZ - 1) return false;
        const kk = ej * NX + i;
        if (!this.edge(dn, ez[kk], P.dz[kk], mask, own)) return false;
        j += stepZ; tMZ += tDZ;
      }
      k = j * NX + i;
      if (!this.canEnter(dn, k, mask, swim)) return false;
      if (dn.cost[k] >= SOFT && (i !== ie || j !== je)) return false;
    }
    return true;
  }

  // world-coordinate clear test for steering shortcuts
  clear(d, x0, z0, x1, z1, mask = 0, own = 0) { const dn = this.deck(d); return dn ? this.segClear(dn, x0, z0, x1, z1, mask, own, false) : false; }

  // ── async requests ─────────────────────────────────────────────────────
  request(req) { (req.hi ? this.hiQueue : this.queue).push(req); return req; }
  cancel(npc) {
    if (this.active && this.active.req.npc === npc) this.active.req.cancelled = true;
    for (const q of [this.queue, this.hiQueue]) for (let i = q.length - 1; i >= 0; i--) if (q[i].npc === npc) q.splice(i, 1);
  }
  process(maxSearches = 4, maxMs = 1.2) {
    this.stats.frameSearches = 0;
    const t0 = performance.now(), deadline = t0 + maxMs;
    let n = 0;
    // continue the in-flight search first
    if (this.active) {
      const a = this.active;
      if (a.req.cancelled) this.active = null;
      else if (this._run(a.st, deadline)) { this.active = null; n++; try { a.req.cb(a.st.result); } catch (e) { console.error('[nav] cb', e); } }
    }
    while (!this.active && (this.hiQueue.length || this.queue.length) && n < maxSearches && performance.now() < deadline) {
      const r = this.hiQueue.length ? this.hiQueue.shift() : this.queue.shift();
      if (r.cancelled) continue;
      if (!this.decks[r.deck] || !this.decks[r.deck].ready) {
        // deck nav not built yet: build it a stage per frame instead of all at once (deck-change hitch)
        if (!this.plans[r.deck]) { try { r.cb(null); } catch {} continue; }
        this.buildStep(r.deck); (r.hi ? this.hiQueue : this.queue).unshift(r); break;
      }
      const st = this._begin(r.deck, r.sx, r.sz, r.gx, r.gz, r.mask, r);
      if (st.search && !this._run(st, deadline)) { this.active = { req: r, st }; break; }
      n++;
      try { r.cb(st.result); } catch (e) { console.error('[nav] cb', e); }
    }
    // expire blocked doors
    if (this.blockedDoors.size) for (const [k, t] of this.blockedDoors) if (t < this.time) { this.blockedDoors.delete(k); this.cache.clear(); this.coarse.clear(); this.negCache.clear(); this.routeCache.clear(); }
  }
  get pending() { return this.queue.length + this.hiQueue.length + (this.active ? 1 : 0); }

  // ── helpers for behaviours ────────────────────────────────────────────
  randomPointInRoom(d, roomId, rnd, mask = 0, avoidSoft = true) {
    const dn = this.deck(d); if (!dn) return null;
    const r = dn.plan.rooms[roomId]; if (!r || r.bi1 < 0) return null;
    for (let t = 0; t < 40; t++) {
      const i = r.bi0 + Math.floor(rnd() * (r.bi1 - r.bi0 + 1)), j = r.bj0 + Math.floor(rnd() * (r.bj1 - r.bj0 + 1));
      const k = j * NX + i;
      if (dn.plan.room[k] !== roomId || !this.canEnter(dn, k, mask, false)) continue;
      if (avoidSoft && dn.cost[k] >= 3) continue;
      return { x: cellX(i) + (rnd() - 0.5) * 0.2, z: cellZ(j) + (rnd() - 0.5) * 0.2 };
    }
    return null;
  }
  // stair lane on deck d heading toward `toDeck`, nearest to x
  laneToward(d, toDeck, x, z, mask, exclude = null) {
    const dn = this.deck(d); if (!dn) return null;
    const up = toDeck > d; let best = null, bd = 1e9;
    for (const l of dn.lanes) {
      if (l.up !== up || (l.crew && !(mask & ACC.crew))) continue;
      if (exclude && exclude.has(d + ':' + l.core)) continue;
      if (!l.crew) bd -= 0;   // passenger stairs are fine for everyone
      if (!this.plans[l.toDeck]) continue;
      const dd = Math.abs(l.xb - x) + Math.abs(l.zc - z) * 0.5;
      if (dd < bd) { bd = dd; best = l; }
    }
    return best;
  }
  lobbyNear(d, x, mask, exclude = null) {
    const dn = this.deck(d); if (!dn) return null;
    let best = null, bd = 1e9;
    for (const l of dn.lobbies) {
      if (l.crew && !(mask & ACC.crew)) continue;
      if (exclude && exclude.has('L' + d + ':' + l.core)) continue;
      const dd = Math.abs(l.x - x) + (l.kind === 'passenger' ? 0 : 25);
      if (dd < bd) { bd = dd; best = l; }
    }
    return best;
  }
}
