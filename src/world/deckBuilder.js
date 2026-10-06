// Converts DeckPlans into renderable geometry.
// Per deck three layers:
//   ext    – everything visible from outside (facade outer skin, open decks, rails, soffits, roofs). Always drawn.
//            Accumulated into ship-wide CHUNK-metre x-slices shared by all decks (world.js builds the meshes), so
//            frustum culling, shadow-camera culling and distance LOD work per slice and draw calls stay low.
//   shell  – opaque lit window panes, drawn for chunks whose interior is not shown (per-deck, per-chunk meshes).
//   detail – interior skin: floors, ceilings, inner wall faces, transparent glass, stairs, fixtures, contact shadows,
//            cove washes. Per-deck, per-chunk meshes (userData.chunk = {deck, c, box}).
import * as THREE from 'three';
import { GRID, SHIP, deckY, cellX, cellZ, idx } from '../core/config.js';
import { FLOOR_TILE, FLOOR_ROUGH, WALL_TILE, WALL_ROUGH, CEIL_TILE } from './textures.js';
import { FLOOR, WALL, CEIL } from './plan.js';
import { hash32 } from '../core/util.js';

const H = 3.0;              // deck-to-deck
const T_IN = 0.14;          // interior partition thickness
const T_EXT = 0.3;          // facade thickness
const SLAB = 0.32;          // floor slab depth shown at soffits/fascias
export const CHUNK = 40;    // x-slice size for culling / LOD (m)
export const NCHUNK = Math.ceil(SHIP.length / CHUNK);
export const chunkOf = (x) => Math.max(0, Math.min(NCHUNK - 1, Math.floor((x - SHIP.xMin) / CHUNK)));
export const chunkX0 = (c) => SHIP.xMin + c * CHUNK;

class Acc {
  constructor(colorSize = 3) { this.p = []; this.n = []; this.u = []; this.c = []; this.L = []; this.I = []; this.R = []; this.cs = colorSize; this.count = 0; }
  // o: origin, U & V edge vectors; uv0/uv1 ranges; normal = U×V
  quad(o, U, V, uv, layer = 0, int = 0, rough = 0.8, col = [1, 1, 1], col2 = null) {
    const nx = U[1] * V[2] - U[2] * V[1], ny = U[2] * V[0] - U[0] * V[2], nz = U[0] * V[1] - U[1] * V[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    const pts = [o, [o[0] + U[0], o[1] + U[1], o[2] + U[2]], [o[0] + U[0] + V[0], o[1] + U[1] + V[1], o[2] + U[2] + V[2]], [o[0] + V[0], o[1] + V[1], o[2] + V[2]]];
    const uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
    for (let k = 0; k < 4; k++) {
      this.p.push(pts[k][0], pts[k][1], pts[k][2]);
      this.n.push(nx / l, ny / l, nz / l);
      this.u.push(uvs[k][0], uvs[k][1]);
      const cc = col2 && k >= 2 ? col2 : col;
      if (this.cs === 4) this.c.push(cc[0], cc[1], cc[2], cc[3] ?? 1); else this.c.push(cc[0], cc[1], cc[2]);
      this.L.push(layer); this.I.push(int); this.R.push(rough);
    }
    this.count++;
  }
  geometry() {
    if (!this.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, this.cs));
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(this.L, 1));
    g.setAttribute('aInt', new THREE.Float32BufferAttribute(this.I, 1));
    g.setAttribute('aRough', new THREE.Float32BufferAttribute(this.R, 1));
    const ind = new (this.count * 4 > 65535 ? Uint32Array : Uint16Array)(this.count * 6);
    for (let q = 0; q < this.count; q++) { const b = q * 4; ind.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6); }
    g.setIndex(new THREE.BufferAttribute(ind, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// Chunked accumulator: routes each quad to the x-slice containing it; quads crossing slice boundaries along an
// axis-aligned edge are split (uv interpolated) so every slice's bounding volume stays tight.
export class CAcc {
  constructor(colorSize = 3) { this.cs = colorSize; this.parts = []; }
  part(c) { return this.parts[c] || (this.parts[c] = new Acc(this.cs)); }
  quad(o, U, V, uv, layer = 0, int = 0, rough = 0.8, col = [1, 1, 1], col2 = null) {
    const xa = o[0], xb = o[0] + U[0], xc = o[0] + V[0], xd = xb + V[0];
    const mn = Math.min(xa, xb, xc, xd), mx = Math.max(xa, xb, xc, xd);
    const c0 = chunkOf(mn + 1e-4), c1 = chunkOf(mx - 1e-4);
    if (c0 === c1) return this.part(c0).quad(o, U, V, uv, layer, int, rough, col, col2);
    let along = null;
    if (U[0] !== 0 && U[1] === 0 && U[2] === 0 && V[0] === 0) along = 'U';
    else if (V[0] !== 0 && V[1] === 0 && V[2] === 0 && U[0] === 0) along = 'V';
    if (!along) return this.part(chunkOf((mn + mx) / 2)).quad(o, U, V, uv, layer, int, rough, col, col2);
    const E = along === 'U' ? U : V;
    const ts = [0, 1];
    for (let c = c0 + 1; c <= c1; c++) { const t = (chunkX0(c) - o[0]) / E[0]; if (t > 1e-6 && t < 1 - 1e-6) ts.push(t); }
    ts.sort((a, b) => a - b);
    for (let k = 0; k < ts.length - 1; k++) {
      const ta = ts[k], tb = ts[k + 1];
      const oo = [o[0] + E[0] * ta, o[1], o[2]];
      if (along === 'U') {
        const uu = [U[0] * (tb - ta), 0, 0];
        const u0 = uv[0] + (uv[2] - uv[0]) * ta, u1 = uv[0] + (uv[2] - uv[0]) * tb;
        this.part(chunkOf(oo[0] + uu[0] / 2)).quad(oo, uu, V, [u0, uv[1], u1, uv[3]], layer, int, rough, col, col2);
      } else {
        const vv = [V[0] * (tb - ta), 0, 0];
        const v0 = uv[1] + (uv[3] - uv[1]) * ta, v1 = uv[1] + (uv[3] - uv[1]) * tb;
        this.part(chunkOf(oo[0] + vv[0] / 2)).quad(oo, U, vv, [uv[0], v0, uv[2], v1], layer, int, rough, col, col2);
      }
    }
  }
  get count() { let n = 0; for (const p of this.parts) if (p) n += p.count; return n; }
  geometries() { const out = []; this.parts.forEach((p, c) => { const g = p && p.geometry(); if (g) out.push({ c, geo: g }); }); return out; }
}

// Box helper (axis aligned) into an Acc with flat color, all 6 faces (or subset)
function box(acc, x0, y0, z0, x1, y1, z1, col, int = 0, rough = 0.6, faces = 'all') {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const F = faces === 'all' ? 'xXyYzZ' : faces;
  if (F.includes('Y')) acc.quad([x0, y1, z1], [dx, 0, 0], [0, 0, -dz], [0, 0, 1, 1], 0, int, rough, col);
  if (F.includes('y')) acc.quad([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, 0, 1, 1], 0, int, rough, col);
  if (F.includes('Z')) acc.quad([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1, 1], 0, int, rough, col);
  if (F.includes('z')) acc.quad([x1, y0, z0], [-dx, 0, 0], [0, dy, 0], [0, 0, 1, 1], 0, int, rough, col);
  if (F.includes('X')) acc.quad([x1, y0, z1], [0, 0, -dz], [0, dy, 0], [0, 0, 1, 1], 0, int, rough, col);
  if (F.includes('x')) acc.quad([x0, y0, z0], [0, 0, dz], [0, dy, 0], [0, 0, 1, 1], 0, int, rough, col);
}

// Greedy rectangle decomposition of cells satisfying pred(k) → key (same key merges)
function greedy(keyAt) {
  const { nx, nz } = GRID;
  const seen = new Uint8Array(nx * nz);
  const rects = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = idx(i, j);
    if (seen[k]) continue;
    const key = keyAt(i, j);
    if (key === null) { seen[k] = 1; continue; }
    let w = 1;
    while (i + w < nx && !seen[idx(i + w, j)] && keyAt(i + w, j) === key) w++;
    let h = 1;
    outer: while (j + h < nz) {
      for (let a = 0; a < w; a++) { const kk = idx(i + a, j + h); if (seen[kk] || keyAt(i + a, j + h) !== key) break outer; }
      h++;
    }
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) seen[idx(i + a, j + b)] = 1;
    rects.push({ i, j, w, h, key, x0: GRID.x0 + i * GRID.cell, x1: GRID.x0 + (i + w) * GRID.cell, z0: GRID.z0 + j * GRID.cell, z1: GRID.z0 + (j + h) * GRID.cell });
  }
  return rects;
}

function tint(room, salt = 0) {
  const h = hash32(room.uid, salt);
  const v = 0.94 + ((h & 255) / 255) * 0.08;
  return [v, v * (0.985 + ((h >> 8) & 15) / 600), v * (0.97 + ((h >> 12) & 15) / 500)];
}

// interior walls: light pools at ~1.2 m, falls off toward ceiling and floor (cheap ambient occlusion)
function shadeY(col, h, int) {
  if (!int) return col;
  const k = h <= 0.05 ? 0.78 : h >= 2.3 ? 0.72 : 1.0;
  return [col[0] * k, col[1] * k, col[2] * k];
}
const intOf = (r) => (r && !r.exterior && !r.isVoid ? (r.light ?? 0.9) : 0);

// Venue rooms that get cove light strips + soft wall washes along their partitions.
const COVE = { dining: [1.0, 0.78, 0.5], bar: [1.0, 0.62, 0.32], pub: [1.0, 0.66, 0.36], lounge: [1.0, 0.74, 0.46], casino: [1.0, 0.7, 0.32],
  theater: [1.0, 0.56, 0.3], nightclub: [0.62, 0.3, 1.0], atrium: [1.0, 0.82, 0.58], lobby: [1.0, 0.8, 0.56], library: [1.0, 0.7, 0.42],
  spa: [0.55, 0.85, 1.0], gallery: [1.0, 0.86, 0.66], services: [1.0, 0.8, 0.56], suite: [1.0, 0.76, 0.5] };
// Balcony tier styling per deck (exterior variety): divider tint, cap-rail colour, solid lower fascia, slab accent stripe.
const TIER = {
  6: { div: [0.93, 0.93, 0.92], cap: [0.55, 0.36, 0.2], glass: [0.75, 0.86, 0.9], stripe: null },
  7: { div: [0.86, 0.9, 0.93], cap: [0.55, 0.36, 0.2], glass: [0.72, 0.84, 0.9], stripe: null },
  8: { div: [0.95, 0.94, 0.9], cap: [0.18, 0.24, 0.3], glass: [0.62, 0.78, 0.84], stripe: [0.05, 0.33, 0.38], solid: true },
  9: { div: [0.9, 0.93, 0.95], cap: [0.55, 0.36, 0.2], glass: [0.74, 0.86, 0.92], stripe: null },
  10: { div: [0.82, 0.88, 0.9], cap: [0.55, 0.36, 0.2], glass: [0.7, 0.82, 0.88], stripe: null },
  11: { div: [0.95, 0.93, 0.88], cap: [0.18, 0.24, 0.3], glass: [0.6, 0.74, 0.8], stripe: [0.78, 0.62, 0.3], solid: true },
  12: { div: [0.88, 0.92, 0.94], cap: [0.55, 0.36, 0.2], glass: [0.74, 0.86, 0.92], stripe: null },
  13: { div: [0.92, 0.92, 0.9], cap: [0.55, 0.36, 0.2], glass: [0.7, 0.82, 0.86], stripe: [0.05, 0.33, 0.38] },
  14: { div: [0.86, 0.9, 0.92], cap: [0.18, 0.24, 0.3], glass: [0.6, 0.76, 0.82], stripe: null, solid: true },
};
const TIER_DEF = { div: [0.9, 0.9, 0.9], cap: [0.55, 0.36, 0.2], glass: [0.75, 0.86, 0.9], stripe: null };

// Ship-wide exterior accumulators (one CAcc per material; world.js turns each x-slice into a mesh).
export function makeExtAccumulators() {
  return { floorE: new CAcc(), wallE: new CAcc(), plainE: new CAcc(), ceilE: new CAcc(), metalE: new CAcc(), railGlass: new CAcc(), water: new CAcc(),
    fineMetal: new CAcc(), finePlain: new CAcc(), shellFrame: new CAcc() };
}

export function buildDeck(plans, d, mats, E = makeExtAccumulators()) {
  const P = plans[d], above = plans[d + 1] || null, below = plans[d - 1] || null;
  const y = deckY(d);
  const { nx, nz, cell } = GRID;
  const R = P.rooms;
  const roomAt = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz) ? 0 : P.room[idx(i, j)];
  const aboveAt = (i, j) => (above ? above.room[idx(i, j)] : 0);
  const belowAt = (i, j) => (below ? below.room[idx(i, j)] : 0);
  const tier = TIER[d] || TIER_DEF;

  const A = {
    floorD: new CAcc(), wallD: new CAcc(), ceilD: new CAcc(), plainD: new CAcc(), metalD: new CAcc(),
    glassD: new CAcc(), shell: new CAcc(), fixtures: new CAcc(), contact: new CAcc(4), cove: new CAcc(), wash: new CAcc(4),
    floorE: E.floorE, wallE: E.wallE, plainE: E.plainE, ceilE: E.ceilE, metalE: E.metalE, railGlass: E.railGlass, water: E.water,
    fineMetal: E.fineMetal, finePlain: E.finePlain, shellFrame: E.shellFrame,
  };
  const fixtures = [];

  // ── FLOORS ───────────────────────────────────────────────────────────────
  const floorRects = greedy((i, j) => {
    const r = R[P.room[idx(i, j)]];
    if (!r || r.isVoid || r.type === 'shaft' || r.ramp) return null;
    return r.id;
  });
  for (const fr of floorRects) {
    const r = R[fr.key];
    const L = r.floor ?? 0, tile = FLOOR_TILE[L];
    const fy = y + (r.pool ? -r.pool : 0);
    const acc = r.exterior ? A.floorE : A.floorD;
    acc.quad([fr.x0, fy, fr.z1], [fr.x1 - fr.x0, 0, 0], [0, 0, -(fr.z1 - fr.z0)], [fr.x0 / tile, -fr.z1 / tile, fr.x1 / tile, -fr.z0 / tile], L, intOf(r), FLOOR_ROUGH[L], tint(r));
  }
  // pool tubs: walls of the recess
  for (const r of R) if (r && r.pool) {
    const depth = r.pool;
    const L = FLOOR.pool;
    const x0 = r.x0, x1 = r.x1, z0 = r.z0, z1 = r.z1;
    const acc = r.exterior ? A.floorE : A.floorD;
    acc.quad([x0, y - depth, z1], [0, 0, -(z1 - z0)], [0, depth, 0], [z0, 0, z1, depth], L, 0, 0.3, [1, 1, 1]);   // faces +x
    acc.quad([x1, y - depth, z0], [0, 0, z1 - z0], [0, depth, 0], [z0, 0, z1, depth], L, 0, 0.3, [1, 1, 1]);      // faces -x
    acc.quad([x0, y - depth, z0], [x1 - x0, 0, 0], [0, depth, 0], [x0, 0, x1, depth], L, 0, 0.3, [1, 1, 1]);      // faces +z
    acc.quad([x1, y - depth, z1], [-(x1 - x0), 0, 0], [0, depth, 0], [x0, 0, x1, depth], L, 0, 0.3, [1, 1, 1]);   // faces -z
    // water surface
    A.water.quad([x0, y - 0.15, z1], [x1 - x0, 0, 0], [0, 0, -(z1 - z0)], [0, 0, 1, 1], 0, 0, 0.05, [1, 1, 1]);
    // coping stones
    const cp = [0.92, 0.9, 0.85];
    box(A.plainE, x0 - 0.35, y, z0 - 0.35, x1 + 0.35, y + 0.06, z0, cp, 0, 0.5, 'Yzx X');
    box(A.plainE, x0 - 0.35, y, z1, x1 + 0.35, y + 0.06, z1 + 0.35, cp, 0, 0.5, 'YZxX');
    box(A.plainE, x0 - 0.35, y, z0, x0, y + 0.06, z1, cp, 0, 0.5, 'Yx');
    box(A.plainE, x1, y, z0, x1 + 0.35, y + 0.06, z1, cp, 0, 0.5, 'YX');
  }

  // ── SOFFITS (underside of this deck where it overhangs exterior space) & ROOFS ──
  const soffit = greedy((i, j) => {
    const r = R[P.room[idx(i, j)]];
    if (!r || r.isVoid) return null;
    const b = below ? below.rooms[belowAt(i, j)] : null;
    if (d > 1 && (!b || b.exterior)) return 1;
    return null;
  });
  // finished soffit: white panelled ceiling (acoustic grid layer) with a recessed perimeter reveal; the soffit
  // downlights themselves are instanced by lights.js. aInt 0.3 = soft bounce so the underside never goes flat grey.
  for (const s of soffit) {
    const tile = 2.4;
    A.ceilE.quad([s.x0, y - SLAB, s.z0], [s.x1 - s.x0, 0, 0], [0, 0, s.z1 - s.z0], [s.x0 / tile, s.z0 / tile, s.x1 / tile, s.z1 / tile], CEIL.acoustic, 0.55, 0.75, [0.98, 0.98, 0.96]);
  }
  const roofs = greedy((i, j) => {
    const r = R[P.room[idx(i, j)]];
    if (!r || r.exterior || r.isVoid) return null;
    const a = above ? above.rooms[aboveAt(i, j)] : null;
    if (!a || (a.exterior === undefined && false)) return 1;
    return null;
  });
  for (const s of roofs) {
    A.floorE.quad([s.x0, y + H, s.z1], [s.x1 - s.x0, 0, 0], [0, 0, -(s.z1 - s.z0)], [s.x0 / 3, -s.z1 / 3, s.x1 / 3, -s.z0 / 3], FLOOR.deckpaint, 0, 0.8, [0.78, 0.8, 0.8]);
    A.ceilD.quad([s.x0, y + H - 0.02, s.z0], [s.x1 - s.x0, 0, 0], [0, 0, s.z1 - s.z0], [0, 0, 1, 1], CEIL.crew, 0.8, 0.9, [0.6, 0.6, 0.62]);
  }

  // ── CEILINGS ────────────────────────────────────────────────────────────
  const ceilRects = greedy((i, j) => {
    const k = idx(i, j);
    const r = R[P.room[k]];
    if (!r || r.exterior) return null;
    const a = above ? above.rooms[aboveAt(i, j)] : null;
    if (!a) return null;            // roof handles it
    if (a.isVoid && !r.isVoid) return null;   // open to the deck above (atrium, theatre)
    if (r.isVoid) { if (a.isVoid) return null; return 'v' + r.id; }
    if (r.ramp || r.type === 'shaft') return null;
    return r.id;
  });
  for (const cr of ceilRects) {
    const r = typeof cr.key === 'string' ? R[+cr.key.slice(1)] : R[cr.key];
    const isVoidTop = typeof cr.key === 'string';
    const L = isVoidTop ? CEIL.coffer : (r.ceil ?? CEIL.plaster);
    const ch = isVoidTop ? 2.85 : (r.ceil === CEIL.none ? 2.95 : (r.ceilH ?? 2.5));
    // dark venue ceilings: casino = lacquered coffers with gold cove lines (layer 4); theatre / nightclub / bridge =
    // dark acoustic panels with rigging spots (layer 5, otherwise unused because CEIL.none renders as crew panels)
    const darkAlt = L === CEIL.dark && (r.type === 'theater' || r.type === 'nightclub' || r.type === 'bridge');
    const tile = darkAlt ? 3.0 : CEIL_TILE[L];
    const layer = L === CEIL.none ? CEIL.crew : darkAlt ? 5 : L;
    const col = L === CEIL.none ? [0.45, 0.46, 0.47] : L === CEIL.dark ? [1, 1, 1] : tint(r, 3);
    A.ceilD.quad([cr.x0, y + ch, cr.z0], [cr.x1 - cr.x0, 0, 0], [0, 0, cr.z1 - cr.z0], [cr.x0 / tile, cr.z0 / tile, cr.x1 / tile, cr.z1 / tile], layer, isVoidTop ? 1.0 : intOf(r) * 0.9, 0.9, col);
  }
  // Light fixtures on ceilings (and record positions for the dynamic light pool)
  const fixtureSpacing = { corridor: 3.0, crew_corridor: 3.0, cabin: 99, suite: 99, crew_cabin: 99 };
  for (const r of R) {
    if (!r || r.exterior || r.isVoid || r.ramp || r.type === 'shaft' || !r.cells) continue;
    const ch = r.ceil === CEIL.none ? 2.95 : (r.ceilH ?? 2.5);
    const sp = fixtureSpacing[r.type] ?? (r.area > 300 ? 3.6 : 2.8);
    const small = sp === 99;
    const pts = [];
    if (small) pts.push([r.x0 + (r.x1 - r.x0) * 0.5, r.z0 + (r.z1 - r.z0) * (r.cz > 0 ? 0.62 : 0.38)], [r.x0 + (r.x1 - r.x0) * 0.5, r.z0 + (r.z1 - r.z0) * (r.cz > 0 ? 0.2 : 0.8)]);
    else for (let x = r.x0 + sp / 2; x < r.x1; x += sp) for (let z = r.z0 + sp / 2; z < r.z1; z += sp) pts.push([x, z]);
    let n = 0;
    for (const [x, z] of pts) {
      if (P.roomAt(x, z) !== r) continue;
      const a = above ? above.roomAt(x, z) : null;
      if (a && a.isVoid) continue;
      const s = r.type.includes('crew') || r.type === 'store' || r.type === 'engine' || r.type === 'galley' || r.type === 'laundry' ? 'tube' : 'disc';
      if (s === 'tube') A.fixtures.quad([x - 0.6, y + ch - 0.015, z - 0.08], [1.2, 0, 0], [0, 0, 0.16], [0, 0, 1, 1]);
      else { const q = 0.11; A.fixtures.quad([x - q, y + ch - 0.015, z - q], [2 * q, 0, 0], [0, 0, 2 * q], [0, 0, 1, 1]); }
      fixtures.push({ x, y: y + ch - 0.25, z, room: r.id, warm: s === 'disc', big: r.area > 120 || !!COVE[r.type], k: n++ });
    }
  }

  // ── WALLS / DOORS / RAILS / FACADES ─────────────────────────────────────
  const runs = [];
  // constant-x lines (edges ex between i and i+1)
  for (let i = 0; i < nx - 1; i++) {
    let cur = null;
    for (let j = 0; j <= nz; j++) {
      let sig = null;
      if (j < nz) {
        const k = idx(i, j), t = P.ex[k];
        if (t) sig = `${t}|${P.room[k]}|${P.room[k + 1]}|${t === 2 ? P.dx[k] : ''}`;
      }
      if (cur && sig !== cur.sig) { cur.s1 = GRID.z0 + j * cell; runs.push(cur); cur = null; }
      if (sig && !cur) { const k = idx(i, j); cur = { sig, normal: 'x', line: GRID.x0 + (i + 1) * cell, s0: GRID.z0 + j * cell, t: P.ex[k], a: P.room[k], b: P.room[k + 1], door: P.ex[k] === 2 ? P.dx[k] : -1 }; }
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    let cur = null;
    for (let i = 0; i <= nx; i++) {
      let sig = null;
      if (i < nx) {
        const k = idx(i, j), t = P.ez[k];
        if (t) sig = `${t}|${P.room[k]}|${P.room[k + nx]}|${t === 2 ? P.dz[k] : ''}`;
      }
      if (cur && sig !== cur.sig) { cur.s1 = GRID.x0 + i * cell; runs.push(cur); cur = null; }
      if (sig && !cur) { const k = idx(i, j); cur = { sig, normal: 'z', line: GRID.z0 + (j + 1) * cell, s0: GRID.x0 + i * cell, t: P.ez[k], a: P.room[k], b: P.room[k + nx], door: P.ez[k] === 2 ? P.dz[k] : -1 }; }
    }
  }

  // face helper: a wall face on side `side` (-1 = toward room a / negative axis, +1 = toward b)
  function face(acc, run, side, off, s0, s1, y0, y1, layer, int, rough, col) {
    if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) return;
    const L = run.line + side * off;
    // Normal points toward the room on that side: side -1 → -axis
    if (run.normal === 'x') {
      // U = (Nz,0,-Nx); N = (side,0,0) → U = (0,0,-side)
      const o = side > 0 ? [L, y0, s1] : [L, y0, s0];
      const U = [0, 0, side > 0 ? -(s1 - s0) : (s1 - s0)];
      const ua = side > 0 ? -s1 : s0, ub = side > 0 ? -s0 : s1;
      acc.quad(o, U, [0, y1 - y0, 0], [ua / WALL_TILE, (y0 - y) / H, ub / WALL_TILE, (y1 - y) / H], layer, int, rough, shadeY(col, y0 - y, int), shadeY(col, y1 - y, int));
    } else {
      const o = side > 0 ? [s0, y0, L] : [s1, y0, L];
      const U = [side > 0 ? (s1 - s0) : -(s1 - s0), 0, 0];
      const ua = side > 0 ? s0 : -s1, ub = side > 0 ? s1 : -s0;
      acc.quad(o, U, [0, y1 - y0, 0], [ua / WALL_TILE, (y0 - y) / H, ub / WALL_TILE, (y1 - y) / H], layer, int, rough, shadeY(col, y0 - y, int), shadeY(col, y1 - y, int));
    }
  }
  // horizontal strip (sill/head reveal) spanning thickness between offsets
  function reveal(acc, run, s0, s1, yy, up, t, layer, int, col) {
    const a = run.line - t / 2, b = run.line + t / 2;
    if (run.normal === 'x') {
      if (up) acc.quad([a, yy, s1], [t, 0, 0], [0, 0, -(s1 - s0)], [0, 0, (s1 - s0) / 2, t], layer, int, 0.6, col);
      else acc.quad([a, yy, s0], [t, 0, 0], [0, 0, s1 - s0], [0, 0, (s1 - s0) / 2, t], layer, int, 0.6, col);
    } else {
      if (up) acc.quad([s0, yy, b], [s1 - s0, 0, 0], [0, 0, -t], [0, 0, (s1 - s0) / 2, t], layer, int, 0.6, col);
      else acc.quad([s0, yy, a], [s1 - s0, 0, 0], [0, 0, t], [0, 0, (s1 - s0) / 2, t], layer, int, 0.6, col);
    }
  }
  function jamb(acc, run, s, y0, y1, dir, t, layer, int, col) {
    // vertical reveal at position s, facing `dir` along the run axis
    const a = run.line - t / 2;
    if (run.normal === 'x') {
      if (dir > 0) acc.quad([a, y0, s], [t, 0, 0], [0, y1 - y0, 0], [0, 0, t, (y1 - y0) / H], layer, int, 0.6, col);
      else acc.quad([a + t, y0, s], [-t, 0, 0], [0, y1 - y0, 0], [0, 0, t, (y1 - y0) / H], layer, int, 0.6, col);
    } else {
      if (dir > 0) acc.quad([s, y0, a + t], [0, 0, -t], [0, y1 - y0, 0], [0, 0, t, (y1 - y0) / H], layer, int, 0.6, col);
      else acc.quad([s, y0, a], [0, 0, t], [0, y1 - y0, 0], [0, 0, t, (y1 - y0) / H], layer, int, 0.6, col);
    }
  }
  function glassPane(acc, run, s0, s1, y0, y1, lit = 0, shellCol = null) {
    const L = run.line;
    if (run.normal === 'x') acc.quad([L, y0, s0], [0, 0, s1 - s0], [0, y1 - y0, 0], [0, 0, 1, 1], 0, lit, 0.1, shellCol || [1, 1, 1]);
    else acc.quad([s1, y0, L], [-(s1 - s0), 0, 0], [0, y1 - y0, 0], [0, 0, 1, 1], 0, lit, 0.1, shellCol || [1, 1, 1]);
  }
  function shellPane(run, side, s0, s1, y0, y1, lit) {
    // outward-facing opaque pane
    const L = run.line + side * (T_EXT / 2 - 0.06);
    const col = [0.1, 0.13, 0.17];
    if (run.normal === 'x') {
      if (side > 0) A.shell.quad([L, y0, s1], [0, 0, -(s1 - s0)], [0, y1 - y0, 0], [0, 0, 1, 1], 0, lit, 0.1, col);
      else A.shell.quad([L, y0, s0], [0, 0, s1 - s0], [0, y1 - y0, 0], [0, 0, 1, 1], 0, lit, 0.1, col);
    } else {
      if (side > 0) A.shell.quad([s0, y0, L], [s1 - s0, 0, 0], [0, y1 - y0, 0], [0, 0, 1, 1], 0, lit, 0.1, col);
      else A.shell.quad([s1, y0, L], [-(s1 - s0), 0, 0], [0, y1 - y0, 0], [0, 0, 1, 1], 0, lit, 0.1, col);
    }
  }
  // contact shadow strip on the floor along a wall face
  function contactStrip(run, side, s0, s1, off, w = 0.32, a = 0.32) {
    const L = run.line + side * off;
    const c0 = [0, 0, 0, a], c1 = [0, 0, 0, 0];
    const yy = y + 0.004;
    if (run.normal === 'x') {
      if (side > 0) A.contact.quad([L, yy, s0], [0, 0, s1 - s0], [w, 0, 0], [0, 0, 1, 1], 0, 0, 1, c0, c1);
      else A.contact.quad([L, yy, s1], [0, 0, -(s1 - s0)], [-w, 0, 0], [0, 0, 1, 1], 0, 0, 1, c0, c1);
    } else {
      if (side > 0) A.contact.quad([s1, yy, L], [-(s1 - s0), 0, 0], [0, 0, w], [0, 0, 1, 1], 0, 0, 1, c0, c1);
      else A.contact.quad([s0, yy, L], [s1 - s0, 0, 0], [0, 0, -w], [0, 0, 1, 1], 0, 0, 1, c0, c1);
    }
  }

  // generic wall-parallel quad on one side of a run with separate bottom/top vertex colours
  function wallQuad(acc, run, side, off, s0, s1, y0, y1, cBot, cTop, int = 0) {
    if (s1 - s0 < 1e-3) return;
    const L = run.line + side * off;
    if (run.normal === 'x') {
      if (side > 0) acc.quad([L, y0, s1], [0, 0, -(s1 - s0)], [0, y1 - y0, 0], [0, 0, 1, 1], 0, int, 1, cBot, cTop);
      else acc.quad([L, y0, s0], [0, 0, s1 - s0], [0, y1 - y0, 0], [0, 0, 1, 1], 0, int, 1, cBot, cTop);
    } else {
      if (side > 0) acc.quad([s0, y0, L], [s1 - s0, 0, 0], [0, y1 - y0, 0], [0, 0, 1, 1], 0, int, 1, cBot, cTop);
      else acc.quad([s1, y0, L], [-(s1 - s0), 0, 0], [0, y1 - y0, 0], [0, 0, 1, 1], 0, int, 1, cBot, cTop);
    }
  }
  // venue cove: a thin warm light strip just under the ceiling plus a soft additive wash fading down the wall
  function cove(run, side, off, r, s0, s1) {
    const cc = COVE[r.type]; if (!cc || s1 - s0 < 0.8) return;
    const ch = r.ceil === CEIL.none ? 2.95 : (r.ceilH ?? 2.5);
    const mx = run.normal === 'x' ? run.line + side * 0.4 : (s0 + s1) / 2, mz = run.normal === 'x' ? (s0 + s1) / 2 : run.line + side * 0.4;
    const a = above ? above.roomAt(mx, mz) : null;
    if (a && a.isVoid) return;     // open to the deck above — no ceiling to hide a cove in
    const yt = y + ch - 0.03;
    const k = r.type === 'nightclub' ? 2.4 : 1.8;
    wallQuad(A.cove, run, side, off + 0.012, s0 + 0.15, s1 - 0.15, yt - 0.05, yt, [cc[0] * k, cc[1] * k, cc[2] * k], [cc[0] * k, cc[1] * k, cc[2] * k]);
    const wa = r.type === 'nightclub' ? 0.32 : 0.22;
    wallQuad(A.wash, run, side, off + 0.008, s0 + 0.1, s1 - 0.1, yt - 1.25, yt - 0.05, [cc[0], cc[1], cc[2], 0], [cc[0], cc[1], cc[2], wa]);
  }

  const roomWall = (r) => r ? (r.wall ?? WALL.corridor) : WALL.exterior;
  const extLayer = (d <= 6) ? WALL.exterior : WALL.exterior;
  const railRuns = [];

  for (const run of runs) {
    const ra = R[run.a], rb = R[run.b];
    const len = run.s1 - run.s0;
    if (run.t === 1) {
      // interior partition (or exterior/exterior partition such as balcony dividers)
      const extPair = (ra && ra.exterior) || (rb && rb.exterior);
      const top = y + H;
      const isDivider = ra && rb && ra.exterior && rb.exterior;
      const hTop = isDivider ? y + 2.4 : top;
      const t = isDivider ? 0.08 : T_IN;
      for (const [side, r] of [[-1, ra], [1, rb]]) {
        if (!r || r.isVoid) continue;
        const ext = r.exterior;
        const acc = ext ? A.wallE : A.wallD;
        const layer = ext ? WALL.exterior : roomWall(r);
        face(acc, run, side, t / 2, run.s0, run.s1, y + (r.pool ? -r.pool : 0), hTop, layer, intOf(r), WALL_ROUGH[layer], isDivider ? tier.div : tint(r, 1));
        if (!ext && r.type !== 'shaft') { contactStrip(run, side, run.s0, run.s1, t / 2); cove(run, side, t / 2, r, run.s0, run.s1); }
      }
      if (isDivider) {
        // top cap of divider
        reveal(A.wallE, run, run.s0, run.s1, hTop, true, t, WALL.exterior, 0, tier.div);
      }
    } else if (run.t === 2) {
      const door = P.doors[run.door];
      const dh = door.type === 'watertight' ? 1.95 : door.type === 'glass' || door.type === 'balcony' ? 2.3 : 2.12;
      for (const [side, r] of [[-1, ra], [1, rb]]) {
        if (!r) continue;
        const ext = r.exterior;
        const acc = ext ? A.wallE : A.wallD;
        const layer = ext ? WALL.exterior : roomWall(r);
        face(acc, run, side, (door.type === 'balcony' ? T_EXT : T_IN) / 2, run.s0, run.s1, y + dh, y + H, layer, intOf(r), WALL_ROUGH[layer], tint(r, 1));
      }
      // frame / jambs (metal trim)
      const fr = door.type === 'cabin' ? [0.32, 0.22, 0.14] : door.type === 'crew' || door.type === 'watertight' ? [0.55, 0.58, 0.6] : [0.72, 0.6, 0.38];
      const t = door.type === 'balcony' ? T_EXT : T_IN;
      const acc = (ra && ra.exterior) || (rb && rb.exterior) ? A.metalE : A.metalD;
      jamb(acc, run, run.s0, y, y + dh, 1, t, 0, 0.6, fr);
      jamb(acc, run, run.s1, y, y + dh, -1, t, 0, 0.6, fr);
      reveal(acc, run, run.s0, run.s1, y + dh, false, t, 0, 0.6, fr);
    } else if (run.t === 3 || run.t === 6) {
      railRuns.push(run);
    } else if (run.t === 4) {
      // facade: interior room on one side, outside or exterior room on the other
      const inSide = ra && !ra.exterior && !ra.isVoid ? -1 : 1;
      const rin = inSide < 0 ? ra : rb, rout = inSide < 0 ? rb : ra;
      if (!rin) continue;
      const style = rin.isVoid ? 'solid' : (rin.facade || 'solid');
      const opens = [];
      if (style === 'window') {
        const bay = rin.type === 'cabin' || rin.type === 'crew_cabin' ? len : 2.2;
        const n = Math.max(1, Math.round(len / bay));
        const b = len / n;
        for (let k = 0; k < n; k++) { const w = Math.min(b - 0.5, rin.type === 'cabin' ? 1.8 : 1.5); if (w < 0.6) continue; const c = run.s0 + b * (k + 0.5); opens.push([c - w / 2, c + w / 2, 0.82, 2.2]); }
      } else if (style === 'glass') {
        const n = Math.max(1, Math.round(len / 1.5)); const b = len / n;
        for (let k = 0; k < n; k++) { const c = run.s0 + b * (k + 0.5); opens.push([c - b / 2 + 0.04, c + b / 2 - 0.04, 0.08, Math.min(2.65, (rin.ceilH ?? 2.6) - 0.05)]); }
      } else if (style === 'porthole') {
        const n = Math.max(1, Math.floor(len / 2.4)); const b = len / n;
        for (let k = 0; k < n; k++) { const c = run.s0 + b * (k + 0.5); if (b > 0.9) opens.push([c - 0.27, c + 0.27, 1.25, 1.79]); }
      }
      const thick = T_EXT;
      const lay = roomWall(rin);
      const intL = intOf(rin);
      const col = tint(rin, 1);
      const outsideHull = d <= 4 && !rout;    // hull plating provides the outer skin
      const outAcc = A.wallE;
      const outLayer = WALL.exterior;
      const outCol = d <= 6 ? [0.96, 0.96, 0.96] : [0.97, 0.97, 0.96];
      const sides = [[inSide, A.wallD, lay, intL, col], ...(outsideHull ? [] : [[-inSide, outAcc, outLayer, 0, outCol]])];
      for (const [side, acc, L, it, cc] of sides) {
        const rr = WALL_ROUGH[L];
        if (!opens.length) { face(acc, run, side, thick / 2, run.s0, run.s1, y, y + H, L, it, rr, cc); continue; }
        // below sills / above heads / piers
        let prev = run.s0;
        for (const [o0, o1, yb, yt] of opens) {
          face(acc, run, side, thick / 2, prev, o0, y, y + H, L, it, rr, cc);
          face(acc, run, side, thick / 2, o0, o1, y, y + yb, L, it, rr, cc);
          face(acc, run, side, thick / 2, o0, o1, y + yt, y + H, L, it, rr, cc);
          prev = o1;
        }
        face(acc, run, side, thick / 2, prev, run.s1, y, y + H, L, it, rr, cc);
      }
      if (!rin.isVoid) { contactStrip(run, inSide, run.s0, run.s1, thick / 2); if (style !== 'glass') cove(run, inSide, thick / 2, rin, run.s0, run.s1); }
      for (const [o0, o1, yb, yt] of opens) {
        reveal(A.wallD, run, o0, o1, y + yb, true, thick, lay, intL, col);
        reveal(A.wallD, run, o0, o1, y + yt, false, thick, lay, intL, col);
        jamb(A.wallD, run, o0, y + yb, y + yt, 1, thick, lay, intL, col);
        jamb(A.wallD, run, o1, y + yb, y + yt, -1, thick, lay, intL, col);
        glassPane(A.glassD, run, o0, o1, y + yb, y + yt);
        if (!outsideHull) {
          // per-pane night level: cabins ~40 % lit, venues mostly lit; level & colour vary (see materials shellGlass)
          const h = hash32(d, Math.round(o0 * 10), run.line);
          const on = (h % 100) < (rin.type === 'cabin' || rin.type === 'suite' ? 40 : rin.type.includes('crew') ? 30 : 72);
          const lit = on ? 0.35 + ((h >> 8) % 1000) / 1000 * 0.65 : 0;
          shellPane(run, -inSide, o0, o1, y + yb, y + yt, lit);
          // exterior frame: thin mullion at each side of the opening + a sill (reads as real glazing, not a dark hole)
          const sideOut = -inSide, Lo = run.line + sideOut * (T_EXT / 2 + 0.015);
          const fc = [0.82, 0.84, 0.86];
          if (run.normal === 'x') {
            box(A.shellFrame, Lo - 0.03, y + yb, o0 - 0.05, Lo + 0.03, y + yt, o0, fc, 0, 0.4, 'xXzZ');
            box(A.shellFrame, Lo - 0.03, y + yb, o1, Lo + 0.03, y + yt, o1 + 0.05, fc, 0, 0.4, 'xXzZ');
            box(A.shellFrame, Lo - 0.05, y + yb - 0.06, o0 - 0.05, Lo + 0.05, y + yb, o1 + 0.05, fc, 0, 0.4, 'YxX');
          } else {
            box(A.shellFrame, o0 - 0.05, y + yb, Lo - 0.03, o0, y + yt, Lo + 0.03, fc, 0, 0.4, 'xXzZ');
            box(A.shellFrame, o1, y + yb, Lo - 0.03, o1 + 0.05, y + yt, Lo + 0.03, fc, 0, 0.4, 'xXzZ');
            box(A.shellFrame, o0 - 0.05, y + yb - 0.06, Lo - 0.05, o1 + 0.05, y + yb, Lo + 0.05, fc, 0, 0.4, 'YzZ');
          }
        }
      }
    }
  }

  // ── RAILINGS ─────────────────────────────────────────────────────────────
  // Glass balustrade with teak cap rail (exterior), or glass + brass rail around atrium wells.
  const posts = [];
  for (const run of railRuns) {
    const ra = R[run.a], rb = R[run.b];
    const r = ra && !ra.isVoid ? ra : rb;
    if (!r) continue;
    const interior = !r.exterior;
    const bulwark = r.exterior && (d <= 6 && (r.type === 'promenade' || r.type === 'mooring')) && (!ra || !rb);
    const hh = bulwark ? 1.12 : 1.08;
    const acc = interior ? A.plainD : A.plainE;
    const isBal = r.type === 'balcony';
    const capCol = interior ? [0.78, 0.6, 0.3] : isBal ? tier.cap : [0.55, 0.36, 0.2];
    const len = run.s1 - run.s0;
    if (bulwark) {
      // solid steel bulwark painted white, teak cap rail
      for (const side of [-1, 1]) face(A.wallE, run, side, 0.06, run.s0, run.s1, y, y + hh, WALL.exterior, 0, 0.6, [0.95, 0.95, 0.94]);
      reveal(A.plainE, run, run.s0, run.s1, y + hh, true, 0.2, 0, 0, capCol);
    } else {
      // balcony tiers alternate between all-glass and a solid painted lower panel (exterior variety)
      const solidH = isBal && tier.solid ? 0.62 : 0;
      if (solidH) for (const side of [-1, 1]) face(A.wallE, run, side, 0.03, run.s0, run.s1, y, y + solidH, WALL.exterior, 0, 0.6, side === -1 ? tier.div : tier.div);
      glassPane(A.railGlass, run, run.s0 + 0.02, run.s1 - 0.02, y + 0.06 + solidH, y + hh - 0.06, 0, interior ? [1, 1, 1] : tier.glass);
      // cap rail (box)
      const t = 0.07;
      if (run.normal === 'x') box(acc, run.line - t, y + hh - 0.06, run.s0, run.line + t, y + hh, run.s1, capCol, interior ? intOf(r) : 0, 0.4, 'Yxz XZ'.replace(' ', ''));
      else box(acc, run.s0, y + hh - 0.06, run.line - t, run.s1, y + hh, run.line + t, capCol, interior ? intOf(r) : 0, 0.4, 'YxXzZ');
      const fm = interior ? A.metalD : A.fineMetal;
      if (run.normal === 'x') box(fm, run.line - 0.02, y, run.s0, run.line + 0.02, y + 0.06, run.s1, [0.7, 0.72, 0.74], 0, 0.3, 'YxX');
      else box(fm, run.s0, y, run.line - 0.02, run.s1, y + 0.06, run.line + 0.02, [0.7, 0.72, 0.74], 0, 0.3, 'YzZ');
      for (let s = run.s0; s <= run.s1 + 1e-3; s += Math.max(0.5, len / Math.max(1, Math.round(len / 1.5)))) posts.push(run.normal === 'x' ? [run.line, s, interior] : [s, run.line, interior]);
    }
  }
  // posts are fine detail: interior ones stream with the deck, exterior ones are dropped beyond the LOD distance
  for (const [px, pz, inter] of posts) box(inter ? A.metalD : A.fineMetal, px - 0.025, y, pz - 0.025, px + 0.025, y + 1.02, pz + 0.025, [0.75, 0.77, 0.79], 0, 0.3, 'xXzZ');

  // ── FASCIAS (slab edge facing outside or a void) ─────────────────────────
  // merged along straight runs (was one quad per 0.5 m cell); balcony edges on accent tiers get a coloured stripe
  {
    const fy0 = y - SLAB;
    const isEdgeR = (q) => !q || q.isVoid;
    const colFor = (r) => (r.type === 'balcony' && tier.stripe) ? tier.stripe : [0.9, 0.9, 0.9];
    // constant-x edges (faces ±x)
    for (const dir of [1, -1]) for (let i = 0; i < nx; i++) {
      let j0 = -1, cur = null;
      for (let j = 0; j <= nz; j++) {
        let key = null, r = null;
        if (j < nz) { r = R[P.room[idx(i, j)]]; if (r && !r.isVoid && isEdgeR(R[roomAt(i + dir, j)])) key = colFor(r).join(); }
        if (key !== cur) {
          if (cur !== null) { const x = GRID.x0 + (i + (dir > 0 ? 1 : 0)) * cell, za = GRID.z0 + j0 * cell, zb = GRID.z0 + j * cell; const c = cur.split(',').map(Number);
            if (dir > 0) A.plainE.quad([x, fy0, zb], [0, 0, -(zb - za)], [0, SLAB, 0], [0, 0, 1, 1], 0, 0, 0.6, c); else A.plainE.quad([x, fy0, za], [0, 0, zb - za], [0, SLAB, 0], [0, 0, 1, 1], 0, 0, 0.6, c); }
          cur = key; j0 = j;
        }
      }
    }
    for (const dir of [1, -1]) for (let j = 0; j < nz; j++) {
      let i0 = -1, cur = null;
      for (let i = 0; i <= nx; i++) {
        let key = null, r = null;
        if (i < nx) { r = R[P.room[idx(i, j)]]; if (r && !r.isVoid && isEdgeR(R[roomAt(i, j + dir)])) key = colFor(r).join(); }
        if (key !== cur) {
          if (cur !== null) { const z = GRID.z0 + (j + (dir > 0 ? 1 : 0)) * cell, xa = GRID.x0 + i0 * cell, xb = GRID.x0 + i * cell; const c = cur.split(',').map(Number);
            if (dir > 0) A.plainE.quad([xa, fy0, z], [xb - xa, 0, 0], [0, SLAB, 0], [0, 0, 1, 1], 0, 0, 0.6, c); else A.plainE.quad([xb, fy0, z], [-(xb - xa), 0, 0], [0, SLAB, 0], [0, 0, 1, 1], 0, 0, 0.6, c); }
          cur = key; i0 = i;
        }
      }
    }
  }

  // ── STAIRS (each deck builds the flight that rises from it) ─────────────
  for (const r of R) {
    if (!r || !r.ramp || r.role !== 'up') continue;
    const { xb, xt } = r.ramp;
    const dir = Math.sign(xt - xb), run = Math.abs(xt - xb);
    const nSteps = 18, rise = H / nSteps, tread = run / nSteps;
    const z0 = r.z0, z1 = r.z1;
    const crew = r.zone === 'crew';
    const treadCol = crew ? [0.55, 0.58, 0.6] : [1, 1, 1];
    const L = crew ? FLOOR.steel : FLOOR.corridor;
    for (let s = 0; s < nSteps; s++) {
      const xa = xb + dir * s * tread, xc = xa + dir * tread;
      const yt = y + (s + 1) * rise;
      const lo = Math.min(xa, xc), hi = Math.max(xa, xc);
      // tread
      A.floorD.quad([lo, yt, z1], [hi - lo, 0, 0], [0, 0, -(z1 - z0)], [lo / 1.2, -z1 / 1.2, hi / 1.2, -z0 / 1.2], L, intOf(r), 0.9, treadCol);
      // riser (faces back toward xb)
      if (dir > 0) A.plainD.quad([xa, yt - rise, z0], [0, 0, z1 - z0], [0, rise, 0], [0, 0, 1, 1], 0, intOf(r), 0.6, crew ? [0.5, 0.52, 0.54] : [0.36, 0.26, 0.18]);
      else A.plainD.quad([xa, yt - rise, z1], [0, 0, -(z1 - z0)], [0, rise, 0], [0, 0, 1, 1], 0, intOf(r), 0.6, crew ? [0.5, 0.52, 0.54] : [0.36, 0.26, 0.18]);
      // nosing
      box(A.metalD, Math.min(xa, xa + dir * 0.04), yt - 0.025, z0, Math.max(xa, xa + dir * 0.04), yt + 0.004, z1, [0.75, 0.66, 0.42], intOf(r), 0.35, 'Y' + (dir > 0 ? 'x' : 'X'));
    }
    // soffit under the flight
    const len = Math.hypot(run, H);
    if (dir > 0) A.plainD.quad([xb, y - 0.15, z0], [run, H, 0], [0, 0, z1 - z0], [0, 0, 1, 1], 0, intOf(r) * 0.7, 0.8, [0.8, 0.8, 0.78]);
    else A.plainD.quad([xb, y - 0.15, z1], [-run, H, 0], [0, 0, -(z1 - z0)], [0, 0, 1, 1], 0, intOf(r) * 0.7, 0.8, [0.8, 0.8, 0.78]);
    // handrails along both sides
    for (const zz of [z0 + 0.06, z1 - 0.06]) {
      const segs = 9;
      for (let s = 0; s < segs; s++) {
        const xa = xb + dir * run * s / segs, xc = xb + dir * run * (s + 1) / segs;
        const ya = y + 0.95 + H * s / segs, yc = y + 0.95 + H * (s + 1) / segs;
        const lo = Math.min(xa, xc), hi = Math.max(xa, xc);
        A.metalD.quad([lo, dir > 0 ? ya : yc, zz - 0.025], [hi - lo, dir > 0 ? yc - ya : ya - yc, 0], [0, 0, 0.05], [0, 0, 1, 1], 0, intOf(r), 0.3, [0.78, 0.64, 0.36]);
        A.metalD.quad([lo, (dir > 0 ? ya : yc) - 0.05, zz - 0.025], [0, 0.05, 0], [hi - lo, dir > 0 ? yc - ya : ya - yc, 0], [0, 0, 1, 1], 0, intOf(r), 0.3, [0.68, 0.55, 0.3]);
      }
    }
  }

  // ── Assemble meshes ─────────────────────────────────────────────────────
  // detail & shell: per-deck groups holding one mesh per (material, x-chunk). Exterior geometry went into the
  // shared accumulators E (world.js assembles it once all decks are built).
  const detail = new THREE.Group(); detail.name = `deck${d}-detail`;
  const shellGrp = new THREE.Group(); shellGrp.name = `deck${d}-shell`;
  const add = (grp, acc, mat, opts = {}) => {
    for (const { c, geo } of acc.geometries()) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      if (opts.order != null) m.renderOrder = opts.order;
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.userData.chunk = { deck: d, c, kind: opts.kind || 'detail' };
      m.name = `d${d}-${opts.name || 'm'}-c${c}`;
      grp.add(m);
    }
  };
  add(detail, A.floorD, mats.floor, { name: 'floor' });
  add(detail, A.wallD, mats.wall, { name: 'wall', cast: true });
  add(detail, A.ceilD, mats.ceil, { name: 'ceil', cast: true });
  add(detail, A.plainD, mats.plain, { name: 'plain' });
  add(detail, A.metalD, mats.metal, { name: 'metal' });
  add(detail, A.fixtures, mats.fixture, { name: 'fix', receive: false });
  add(detail, A.cove, mats.cove, { name: 'cove', receive: false });
  add(detail, A.contact, mats.contact, { name: 'contact', receive: false, order: 2 });
  add(detail, A.wash, mats.wash, { name: 'wash', receive: false, order: 3 });
  add(detail, A.glassD, mats.glass, { name: 'glass', receive: false, order: 6 });
  add(shellGrp, A.shell, mats.shellGlass, { name: 'shell', kind: 'shell' });
  return { detail, shell: shellGrp.children.length ? shellGrp : null, fixtures };
}

// Build the shared exterior meshes from the accumulators: returns [{mesh, c, kind:'ext'|'fine'}]
export function buildExterior(E, mats) {
  const out = [];
  const add = (acc, mat, name, opts = {}) => {
    for (const { c, geo } of acc.geometries()) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      if (opts.order != null) m.renderOrder = opts.order;
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.name = `ext-${name}-c${c}`;
      m.userData.chunk = { c, kind: opts.fine ? 'fine' : 'ext' };
      out.push({ mesh: m, c, kind: opts.fine ? 'fine' : 'ext' });
    }
  };
  add(E.floorE, mats.floor, 'floor', { cast: true });
  add(E.wallE, mats.wall, 'wall', { cast: true });
  add(E.plainE, mats.plain, 'plain', { cast: true });
  add(E.ceilE, mats.ceil, 'soffit', { cast: false });
  add(E.metalE, mats.metal, 'metal');
  add(E.shellFrame, mats.plain, 'mullion');
  add(E.railGlass, mats.railGlass, 'railGlass', { receive: false, order: 5, fine: true });
  add(E.fineMetal, mats.metal, 'posts', { fine: true });
  add(E.finePlain, mats.plain, 'fine', { fine: true });
  add(E.water, mats.water, 'water', { order: 4 });
  return out;
}
