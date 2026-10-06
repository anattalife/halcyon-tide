// Furniture & signage renderer.
// For every deck: one InstancedMesh per (type, variant, size, interior|exterior) built from the
// DeckPlan items, plus merged sign quads (text atlas). Interior pieces join world.decks[d].detail
// (streamed with the deck), exterior pieces join world.decks[d].ext (always drawn).
//
// Shading: one shared MeshStandardMaterial (+ a transparent twin for glass parts) patched with
// materials.patchSurface (baked interior light via the per-instance attribute aInt) and extended
// with per-vertex roughness/metalness (aRM), per-instance upholstery tint (iTint × aTint) and
// vertex-driven emissive programs (aEmi): static glow, animated screens/LED walls, night-boosted
// LED strips. See propsGeo.js for the attribute contract.
//
// API: game.furniture = { meshesFor(deck), setItemHidden(deck, item, hidden), stats }
//
// Rendering hooks (perf): interior instances are grouped per room cluster (world.clusterOf: one venue, or a ~12 m block
// of small rooms) and exterior instances per 40 m x-slice, then registered with world.addFurniture so the world's
// portal/visibility pass can show only reachable clusters, and swap to a far-LOD geometry (same model with its small
// triangles dropped — no restyling) beyond the LOD distance.
import * as THREE from 'three';
import { deckY, GRID, toI, toJ, idx } from '../core/config.js';
import { hash32 } from '../core/util.js';
import { FDEF } from './furnitureDefs.js';
import { CEIL } from './plan.js';
import { patchSurface, shared } from './materials.js';
import { GB, prng, lin } from './propsGeo.js';
import { MODELS } from './furnitureModels.js';

const SKIP = new Set(['post', 'standing', 'rail_spot']);
const WALL_TYPES = new Set(['tv', 'life_ring', 'hose_box', 'junction']);
// interiors are lit by the baked aInt term; only large, sparse pieces near glass facades cast sun shadows
const BIG_INTERIOR = new Set(['engine', 'generator', 'sculpture', 'stage', 'piano', 'palm', 'bar_counter', 'back_bar', 'buffet', 'screen', 'slide']);
const T_IN = 0.14, T_EXT = 0.3;
const CHUNK = 40;

// ═════════════════════════════════════════════════════════════════════════
//  MATERIALS
// ═════════════════════════════════════════════════════════════════════════
const VERT = `
attribute float aEmi; attribute float aTint; attribute vec2 aRM; attribute vec3 iTint;
varying float vEmi; varying vec2 vRM; varying vec3 vLoc; varying float vPh;
`;
const FRAG = `
uniform float uFTime; uniform float uFNight;
varying float vEmi; varying vec2 vRM; varying vec3 vLoc; varying float vPh;
float fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(fh(i), fh(i+vec2(1,0)), f.x), mix(fh(i+vec2(0,1)), fh(i+vec2(1,1)), f.x), f.y); }
vec3 hue(float h){ return clamp(abs(mod(h*6.0 + vec3(0,4,2), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
vec3 screenFx(float c){
  vec2 p = vLoc.xy; float t = uFTime + vPh * 50.0;
  if (c < 2.1) {                     // radar / conning display
    vec2 q = fract(p / 0.34) - 0.5; float r = length(q); float a = atan(q.y, q.x);
    float sweep = fract((a / 6.2832) - t * 0.25); float rings = smoothstep(0.012, 0.0, abs(fract(r * 8.0) - 0.5) - 0.46);
    float blip = step(0.985, fh(floor(q * 18.0) + floor(t * 0.25)));
    vec3 col = vec3(0.02, 0.08, 0.05) + vec3(0.1, 0.9, 0.4) * (pow(sweep, 10.0) * 0.6 + rings * 0.25 + blip * pow(sweep, 3.0));
    return col * step(r, 0.48) + vec3(0.01, 0.02, 0.03);
  }
  if (c < 2.2) {                     // ECDIS chart
    float land = smoothstep(0.55, 0.6, fn(p * 7.0 + vec2(vPh * 9.0, 0.0)));
    vec3 col = mix(vec3(0.12, 0.28, 0.45), vec3(0.6, 0.5, 0.3), land);
    col += vec3(0.9, 0.3, 0.2) * smoothstep(0.006, 0.0, abs(p.y - 0.1 * sin(p.x * 9.0 + vPh * 6.0)));
    col *= 0.85 + 0.15 * step(0.5, fract(p.x * 20.0)) * step(0.5, fract(p.y * 20.0));
    return col * 0.8;
  }
  if (c < 2.4) {                     // generic UI / spreadsheet / booking screens
    float row = floor(p.y * 22.0); float line = step(0.4, fract(p.y * 22.0)) * step(0.3, fh(vec2(row, floor(p.x * 6.0) + vPh * 13.0)));
    float head = smoothstep(0.0, 0.01, fract(p.y * 3.0 + vPh) - 0.9);
    vec3 bg = c < 2.3 ? vec3(0.08, 0.13, 0.22) : vec3(0.9, 0.92, 0.95);
    vec3 ink = c < 2.3 ? vec3(0.55, 0.75, 0.95) : vec3(0.2, 0.25, 0.35);
    return mix(bg, ink, line * 0.7) + head * vec3(0.1, 0.35, 0.6);
  }
  if (c < 2.5) {                     // CCTV multi-view
    vec2 cell = floor(p / vec2(0.13, 0.1)); vec2 f = fract(p / vec2(0.13, 0.1));
    float img = fn(f * vec2(3.0, 2.0) + cell * 7.3) * 0.6 + f.y * 0.25 + 0.1 * fh(f * 80.0 + floor(t * 12.0));
    float scan = 0.85 + 0.15 * sin(f.y * 120.0 + t * 8.0);
    float border = step(0.04, f.x) * step(0.05, f.y);
    float live = step(0.12, fh(cell + floor(t * 0.2)));
    return vec3(0.8, 0.85, 0.82) * img * scan * border * live + vec3(0.9, 0.1, 0.1) * step(0.97, f.x) * step(0.9, f.y) * step(0.5, fract(t));
  }
  if (c < 2.55) {                    // slot reels
    float col = floor(p.x / 0.17); float sp = 2.0 + fh(vec2(col, vPh)) * 2.0;
    float cyc = fract(t * 0.08 + vPh); float spin = smoothstep(0.0, 0.05, cyc) * smoothstep(0.35 + col * 0.06, 0.3 + col * 0.06, cyc);
    float y = p.y / 0.13 + t * sp * 6.0 * spin; float sym = floor(y);
    vec2 f = vec2(fract(p.x / 0.17), fract(y));
    float shape = smoothstep(0.32, 0.28, length(f - 0.5));
    vec3 sc = hue(fh(vec2(sym, col)) );
    vec3 bg = vec3(0.95, 0.92, 0.85) * (0.75 + 0.25 * f.y);
    float sep = smoothstep(0.02, 0.0, abs(f.x - 0.5) - 0.48);
    return mix(bg, sc * 1.2, shape) * (1.0 - sep * 0.8) * (0.9 + 0.1 * spin);
  }
  if (c < 2.6) {                     // slot topper / jackpot banner
    vec2 q = vec2(p.x / 0.6, (p.y - 1.41) / 0.24);
    float bulbs = smoothstep(0.35, 0.2, length(fract(vec2(q.x * 22.0, q.y * 4.0)) - 0.5)) * step(0.5, fract(floor(q.x * 22.0) * 0.5 - t * 2.0)) * (step(q.y, 0.2) + step(0.8, q.y));
    float txt = step(0.3, q.y) * step(q.y, 0.7) * step(0.5, fh(floor(vec2(q.x * 14.0, q.y * 5.0)) + vPh)) * step(abs(q.x - 0.0), 0.42);
    vec3 bg = mix(vec3(0.25, 0.02, 0.12), vec3(0.05, 0.02, 0.25), q.y) * (0.7 + 0.3 * hue(fract(vPh + t * 0.02)));
    return bg + vec3(1.0, 0.82, 0.35) * (txt * 0.8 + bulbs * 0.9);
  }
  if (c < 2.7) {                     // arcade game
    vec2 q = p * vec2(30.0, 24.0); vec2 id = floor(q + vec2(0.0, t * 2.0));
    float star = step(0.97, fh(id));
    float blk = step(0.8, fh(floor(p * vec2(10.0, 8.0) + vec2(floor(t * 1.5), 0.0)))) * step(p.y, 0.05 * sin(t + p.x * 20.0) + 1.3);
    return vec3(0.02, 0.0, 0.08) + star * vec3(0.9) + blk * hue(fh(floor(p * 10.0)));
  }
  if (c < 2.8) {                     // DJ booth LED front: equaliser
    float bx = floor(p.x * 18.0); float lvl = 0.5 + 0.45 * sin(t * (3.0 + fh(vec2(bx, 1.0)) * 6.0) + bx);
    float on = step(fract(p.x * 18.0), 0.8) * step(p.y, 0.15 + lvl * 0.85);
    return hue(fract(p.y * 0.6 + t * 0.05)) * on * 1.3;
  }
  if (c < 2.9) {                     // water shimmer
    float w = fn(vLoc.xz * 6.0 + t * 0.6) * 0.5 + fn(vLoc.xz * 11.0 - t * 0.9) * 0.5;
    return vec3(0.12, 0.45, 0.55) * (0.6 + 0.8 * pow(w, 3.0));
  }
  // big LED show screen / TV programme
  vec2 q = p / 1.6;
  float wave = sin(q.x * 6.0 + t * 0.7) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.05, 0.1, 0.35), vec3(0.65, 0.15, 0.55), wave);
  col += vec3(1.0, 0.75, 0.35) * pow(max(0.0, sin(q.y * 4.0 - t * 1.3 + q.x * 2.0)), 18.0);
  col += vec3(0.9) * smoothstep(0.08, 0.0, length(fract(q * 2.0 + vec2(t * 0.05, 0.0)) - 0.5)) * 0.3;
  float px = step(0.12, fract(p.x * 40.0)) * step(0.12, fract(p.y * 40.0));
  return col * (0.55 + 0.45 * px);
}
`;

function makeMaterial(glass) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, transparent: glass, opacity: glass ? 0.26 : 1, depthWrite: !glass, envMapIntensity: glass ? 1.4 : 1.0 });
  patchSurface(mat, { key: glass ? 'furnG' : 'furn' });
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.uniforms.uFTime = shared.uTime;
    sh.uniforms.uFNight = shared.uNight;
    sh.vertexShader = VERT + sh.vertexShader
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.xyz *= mix(vec3(1.0), iTint, aTint);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vEmi = aEmi; vRM = aRM; vLoc = position;
        #ifdef USE_INSTANCING
        vPh = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        #else
        vPh = 0.0;
        #endif`);
    sh.fragmentShader = FRAG + sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vEmi > 0.001) {
          if (vEmi < 2.0) totalEmissiveRadiance += diffuseColor.rgb * vEmi * (0.8 + 0.7 * uFNight);
          else if (vEmi < 3.0) { totalEmissiveRadiance += screenFx(vEmi) * 1.25; diffuseColor.rgb *= 0.06; }
          else if (vEmi >= 4.0) totalEmissiveRadiance += diffuseColor.rgb * (vEmi - 4.0) * (0.3 + 0.9 * uFNight);
        }`);
  };
  mat.customProgramCacheKey = () => 'surf' + (glass ? 'furnG2' : 'furn2');
  return mat;
}

// ═════════════════════════════════════════════════════════════════════════
//  TINT PALETTES (deterministic per venue / room / item)
// ═════════════════════════════════════════════════════════════════════════
const P = {
  venue: ['#1f5a4a', '#b8862b', '#8a3a2a', '#2e3f66', '#6a2a3a', '#c9b8a0', '#3c3c40', '#7a5a3a', '#2f6f73', '#9a6a7a'],
  cabin: ['#46607a', '#8a7a62', '#2f6f73', '#7c4a3a', '#5d6e57'],
  suite: ['#3a4a5e', '#b8a98b', '#55705e', '#6a4a5a'],
  bedding: ['#1f3a5f', '#2f6f73', '#7a2e3a', '#b8863b', '#5d7a5a', '#3e4a6b', '#8a5a44', '#6a6f78'],
  leather: ['#5a1e1e', '#2a2a2e', '#7a4a2a', '#1f4a3a', '#3a2a4a', '#6a4a2a'],
  outdoor: ['#e4dccb', '#b8a58a', '#2f4a66', '#d8d2c6'],
  lounger: ['#1f6fb0', '#16808a', '#2a4f8a', '#c84a3a', '#6a8a5a'],
  slot: ['#ff3a8a', '#3ad8ff', '#ffc23a', '#ff4a3a', '#8a5aff', '#3aff8a'],
  arcade: ['#ff3a6a', '#3a8aff', '#ffd23a', '#3aff9a', '#c43aff', '#ff8a3a'],
  luggage: ['#1f3a5f', '#7a1f2a', '#2a2a2e', '#c9a050', '#5a7a8a', '#d8d2c6', '#e2702a', '#3a6a4a', '#8a8d90'],
  barFront: ['#6b4430', '#2a2a2e', '#1f4a4a', '#c9b89a', '#5a1e1e', '#8a6a3a', '#3a3f4a'],
  crew: ['#3a4a6a', '#4a5a6a', '#5a4a3a'],
};
const pick = (a, h) => a[h % a.length];
const venueHash = (room, d) => (room ? hash32(room.name || room.type, d) : d);

function tintFor(cat, room, it, d) {
  const rh = venueHash(room, d), ih = hash32(Math.round(it.x * 10), Math.round(it.z * 10));
  const t = room ? room.type : '';
  const name = room ? room.name || '' : '';
  switch (cat) {
    case 'bedding': return t === 'suite' ? pick(['#1f3a5f', '#b8863b', '#55705e'], hash32(d, room.cabinKind)) : pick(P.bedding, hash32(d, Math.floor(it.x / 21), it.z > 0));
    case 'crew': return t === 'brig' ? '#5a5d60' : pick(P.crew, hash32(d, Math.floor(it.x / 15)));
    case 'upholstery':
      if (!room) return '#8a8d90';
      if (room.exterior) return pick(P.outdoor, rh);
      if (t === 'cabin') return pick(P.cabin, hash32(d, Math.floor(it.x / 21), it.z > 0));
      if (t === 'suite') return pick(P.suite, rh);
      if (t === 'library') return '#7a4a2a';
      if (room.venue === 'cigar') return '#5a1e1e';
      if (t === 'officer') return '#3a3a40';
      if (t === 'office' || t === 'crew_bar' || t === 'crew_mess') return '#4a5a6a';
      return pick(P.venue, rh);
    case 'chair':
      if (!room) return '#8a8d90';
      if (room.exterior || t === 'buffet') return pick(P.outdoor, rh);
      if (room.venue === 'dining') return /Upper/.test(name) ? '#2e5a5e' : '#9c4a40';
      if (room.venue === 'steak') return '#5a1e1e';
      if (room.venue === 'grill') return '#8a6a4a';
      if (t === 'crew_mess') return /Officer/.test(name) ? '#7a2a2a' : '#2f5f8f';
      if (t === 'crew_cabin' || t === 'office' || t === 'security' || t === 'medical' || t === 'galley' || t === 'services') return '#3f5f7f';
      if (t === 'cabin' || t === 'suite') return pick(P.cabin, hash32(d, Math.floor(it.x / 21)));
      return pick(P.venue, rh + 3);
    case 'bar': return room && room.exterior ? '#e4dccb' : pick(P.leather, rh);
    case 'theatre': { const v = 0.92 + (ih % 9) * 0.012; const c = lin('#8e1a24'); return [c[0] * v, c[1] * v, c[2] * v]; }
    case 'lounger':
      if (!room) return P.lounger[0];
      if (/Sunward/.test(name)) return '#1f6fb0';
      if (/Wake/.test(name)) return '#16808a';
      if (/Solarium/.test(name)) return '#6a8a5a';
      if (/Zenith/.test(name)) return '#2a4f8a';
      if (t === 'balcony') return pick(['#2f4a66', '#d8d2c6', '#16808a'], hash32(d, Math.floor(it.x / 21)));
      return pick(P.lounger, rh);
    case 'parasol': return pick(['#1f4a7a', '#e2702a', '#16808a'], hash32(d, Math.floor(it.x / 15)));
    case 'slot': return pick(P.slot, hash32(Math.round(it.z), d, room && room.name));
    case 'felt': return it.game === 'blackjack_hl' ? '#1f3f6b' : room && room.venue === 'casino_hl' ? '#5a1e2a' : '#1f6b46';
    case 'locker': return room && (room.type === 'security' || room.zone === 'restricted') ? '#4a5560' : pick(['#5a7a9a', '#6a8a7a', '#8a8a92'], rh);
    case 'arcade': return pick(P.arcade, ih);
    case 'luggage': return pick(P.luggage, ih);
    case 'office': return room && (room.type === 'bridge' || room.type === 'officer') ? '#1f2328' : room && room.type === 'engine' ? '#3a4048' : '#2a3a4a';
    case 'barFront': return room && room.venue === 'cigar' ? '#3a1e16' : pick(P.barFront, rh);
    default: return '#ffffff';
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  MODEL CACHE
// ═════════════════════════════════════════════════════════════════════════
const modelCache = new Map();
let trisBuilt = 0;
function getModel(t, variant, W, D, H) {
  const key = `${t}|${variant}|${W.toFixed(3)}|${D.toFixed(3)}|${H.toFixed(3)}`;
  let m = modelCache.get(key);
  if (m) return m;
  const M = MODELS[t];
  const g = new GB();
  try {
    if (M && M.build) M.build(g, W, D, H, variant, prng(hash32(t, variant, W.toFixed(2))));
    else fallback(g, W, D, H);
  } catch (e) {
    console.error(`[furniture] model ${t}/${variant} failed`, e);
    g.P.length = g.N.length = g.C.length = g.E.length = g.T.length = g.R.length = g.I.length = 0; g.vc = 0; g.glass = null;
    fallback(g, W, D, H);
  }
  m = { geo: g.build(), glass: g.glass ? g.glass.build() : null, tris: g.tris };
  trisBuilt += m.tris;
  modelCache.set(key, m);
  return m;
}
function fallback(g, W, D, H) { g.box(0, H / 2, 0, W, H, D, '#9a9a9a', { r: 0.02, steps: 1 }); }

// Make a per-mesh geometry sharing the cached vertex data but carrying its own instanced attributes.
function instGeo(base, aInt, iTint) {
  const g = new THREE.BufferGeometry();
  for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
  g.setIndex(base.index);
  g.boundingBox = base.boundingBox; g.boundingSphere = base.boundingSphere;
  g.setAttribute('aInt', aInt); g.setAttribute('iTint', iTint);
  return g;
}

// Far LOD: the same model with its smallest triangles dropped (keeps the silhouette-defining large faces, ~30 %
// of the triangles). Cached per model; null for models that are already cheap.
function lodModel(model) {
  if ('lodGeo' in model) return model.lodGeo;
  model.lodGeo = null;
  const g = model.geo, ix = g.index; if (!ix) return null;
  const nt = ix.count / 3; if (nt < 160) return null;
  const P = g.attributes.position.array, I = ix.array;
  const area = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    area[t] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  const sorted = Float32Array.from(area).sort();
  const keep = Math.max(48, Math.floor(nt * 0.3));
  const thr = sorted[Math.max(0, nt - keep)];
  const out = [];
  for (let t = 0; t < nt; t++) if (area[t] >= thr) out.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
  const lg = new THREE.BufferGeometry();
  for (const k in g.attributes) lg.setAttribute(k, g.attributes[k]);
  lg.setIndex(out); lg.boundingBox = g.boundingBox; lg.boundingSphere = g.boundingSphere;
  model.lodGeo = lg;
  return lg;
}

// ═════════════════════════════════════════════════════════════════════════
//  PLACEMENT HELPERS
// ═════════════════════════════════════════════════════════════════════════
function ceilingOf(plans, d, room, x, z) {
  if (!room) return 2.6;
  const above = plans[d + 1];
  const a = above ? above.roomAt(x, z) : null;
  if (room.exterior) return a && !a.isVoid ? 2.66 : 99;
  if (a && a.isVoid) return 99;
  if (!a && !above) return 2.95;
  return room.ceil === CEIL.none ? 2.95 : (room.ceilH ?? 2.5);
}

// Edge type crossing between cell (i,j) and its neighbour in direction (di,dj).
function edgeBetween(p, i, j, di, dj) {
  if (di === 1) return p.ex[idx(i, j)];
  if (di === -1) return p.ex[idx(i - 1, j)];
  if (dj === 1) return p.ez[idx(i, j)];
  return p.ez[idx(i, j - 1)];
}

// Find the nearest wall/facade face along direction (dx,dz) (axis-aligned) from (x,z) within maxD.
// Returns {line, thick} where line is the grid line coordinate along the axis.
function wallAlong(p, x, z, dx, dz, maxD = 0.9) {
  const ax = Math.abs(dx) > Math.abs(dz);
  const s = ax ? Math.sign(dx) : Math.sign(dz);
  let i = toI(x), j = toJ(z);
  const n = Math.ceil(maxD / GRID.cell) + 1;
  for (let k = 0; k < n; k++) {
    if (i < 1 || j < 1 || i >= GRID.nx - 1 || j >= GRID.nz - 1) return null;
    const e = ax ? edgeBetween(p, i, j, s, 0) : edgeBetween(p, i, j, 0, s);
    if (e === 1 || e === 4 || e === 2) {
      const line = ax ? GRID.x0 + (s > 0 ? i + 1 : i) * GRID.cell : GRID.z0 + (s > 0 ? j + 1 : j) * GRID.cell;
      const dist = ax ? (line - x) * s : (line - z) * s;
      if (dist > maxD) return null;
      return { line, thick: e === 4 ? T_EXT : T_IN, ax, s, dist };
    }
    if (ax) i += s; else j += s;
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════
//  SIGNS (text atlas)
// ═════════════════════════════════════════════════════════════════════════
const SLOT_W = 512, SLOT_H = 128, ATLAS = 2048, COLS = ATLAS / SLOT_W, ROWS = ATLAS / SLOT_H;
function paintSign(ctx, x0, y0, text, style, sub) {
  const w = SLOT_W, h = SLOT_H;
  ctx.save(); ctx.translate(x0, y0);
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  const fit = (font, size, maxW) => { let s = size; ctx.font = font.replace('#', s); while (ctx.measureText(text).width > maxW && s > 14) { s -= 2; ctx.font = font.replace('#', s); } return s; };
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (style === 'venue') {
    ctx.clearRect(0, 0, w, h);
    fit('italic 600 #px Georgia, "Times New Roman", serif', 74, w - 40);
    ctx.shadowColor = 'rgba(255,170,70,0.95)'; ctx.shadowBlur = 16;
    const gr = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.8); gr.addColorStop(0, '#fff2c8'); gr.addColorStop(0.55, '#f4cf7c'); gr.addColorStop(1, '#d9a24a');
    ctx.fillStyle = gr; ctx.fillText(text, w / 2, h * 0.44);
    ctx.shadowBlur = 8; ctx.fillStyle = '#f4cf7c';
    const tw = Math.min(w - 60, ctx.measureText(text).width);
    ctx.fillRect(w / 2 - tw / 2, h * 0.8, tw, 3); ctx.beginPath(); ctx.arc(w / 2, h * 0.8 + 1.5, 6, 0, Math.PI * 2); ctx.fill();
  } else if (style === 'deck') {
    const gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#163556'); gr.addColorStop(1, '#0c1f35');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c9a45b'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, w - 12, h - 12);
    fit('700 #px "Helvetica Neue", Arial, sans-serif', sub ? 62 : 78, w - 60);
    ctx.fillStyle = '#f4efe4'; ctx.fillText(text, w / 2, sub ? h * 0.4 : h * 0.52);
    if (sub) { ctx.fillStyle = '#c9a45b'; ctx.fillRect(w * 0.3, h * 0.66, w * 0.4, 2); ctx.font = '600 24px Arial, sans-serif'; ctx.fillText(sub.split('').join(' '), w / 2, h * 0.8); }
  } else if (style === 'crew') {
    ctx.fillStyle = '#e8ece9'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1f4766'; ctx.fillRect(0, 0, 18, h);
    fit('700 #px Arial, sans-serif', 64, w - 70); ctx.fillText(text, w / 2 + 8, h / 2);
  } else if (style === 'warn') {
    ctx.fillStyle = '#f2c230'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    for (let k = -2; k < 30; k++) { ctx.beginPath(); ctx.moveTo(k * 28, 0); ctx.lineTo(k * 28 + 14, 0); ctx.lineTo(k * 28 - 6, 14); ctx.lineTo(k * 28 - 20, 14); ctx.fill(); ctx.beginPath(); ctx.moveTo(k * 28, h - 14); ctx.lineTo(k * 28 + 14, h - 14); ctx.lineTo(k * 28 - 6, h); ctx.lineTo(k * 28 - 20, h); ctx.fill(); }
    fit('800 #px Arial, sans-serif', 46, w - 40); ctx.fillText(text, w / 2, h / 2);
  } else { // brass
    const gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a241b'); gr.addColorStop(1, '#16120d');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b48d45'; ctx.lineWidth = 4; ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.strokeStyle = 'rgba(180,141,69,0.5)'; ctx.lineWidth = 1.5; ctx.strokeRect(12, 12, w - 24, h - 24);
    fit('600 #px Georgia, "Times New Roman", serif', 58, w - 60);
    ctx.fillStyle = '#000'; ctx.globalAlpha = 0.5; ctx.fillText(text, w / 2 + 1.5, h / 2 + 2); ctx.globalAlpha = 1;
    const g2 = ctx.createLinearGradient(0, h * 0.25, 0, h * 0.75); g2.addColorStop(0, '#f2d58e'); g2.addColorStop(1, '#b8893e');
    ctx.fillStyle = g2; ctx.fillText(text, w / 2, h / 2);
  }
  ctx.restore();
}

// Venue signage fallback: venues whose plan carries no sign get a glowing name sign above their
// main door on the corridor side (skipped when a plan sign already exists within 8 m).
const SIGN_VENUE_TYPES = new Set(['dining', 'bar', 'pub', 'nightclub', 'casino', 'theater', 'shop', 'gallery', 'library', 'lounge', 'spa', 'gym', 'kids', 'buffet', 'medical']);
export function autoVenueSigns(p) {
  const out = [];
  const near = (x, z) => p.signs.some(s => Math.hypot(s.x - x, s.z - z) < 8) || out.some(s => Math.hypot(s.x - x, s.z - z) < 4);
  const done = new Set();
  for (const door of p.doors) {
    if (door.type !== 'glass' && door.type !== 'swing') continue;
    for (const [a, b] of [[door.rooms[0], door.rooms[1]], [door.rooms[1], door.rooms[0]]]) {
      const v = p.rooms[a], c = p.rooms[b];
      if (!v || !c || done.has(v.id) || v.zone !== 'public' || !SIGN_VENUE_TYPES.has(v.type) || !v.name) continue;
      if (!(c.type === 'corridor' || c.type === 'lobby' || c.type === 'atrium' || c.exterior)) continue;
      if (v.cells < 40) continue;
      // which side of the door line is the corridor?
      const n = door.normal === 'x' ? [1, 0] : [0, 1];
      const probe = p.roomAt(door.x + n[0] * 0.3, door.z + n[1] * 0.3);
      const sgn = probe === c ? 1 : -1;
      const rot = Math.atan2(n[0] * sgn, n[1] * sgn);
      const x = door.x + n[0] * sgn * 0.02, z = door.z + n[1] * sgn * 0.02;
      if (near(x, z)) { done.add(v.id); continue; }
      const text = v.name.split(' · ')[0].replace(/^The /, 'THE ').toUpperCase();
      out.push({ text, x, z, rot, y: 2.55, w: Math.max(1.4, Math.min(3.2, text.length * 0.16)), style: 'venue', sub: '', auto: true });
      done.add(v.id);
    }
  }
  return out;
}

// Real-world sign widths (m). Quads are 4:1, so this also sets the height. Explicit layout widths
// win; otherwise: brass cabin-range / door plaques 0.45–0.8 m, crew door signs 0.6–1.2 m, hazard
// signs 0.9–1.7 m, glowing venue script proportional to the name (1.4–3.2 m).
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function signWidth(s) {
  if (s.wSet || s.auto) return s.w;
  const n = [...(s.text || '')].length;
  switch (s.style) {
    case 'brass': return clampN(0.1 + n * 0.05, 0.45, 0.8);
    case 'crew': return clampN(0.25 + n * 0.06, 0.6, 1.2);
    case 'warn': return clampN(0.35 + n * 0.045, 0.9, 1.7);
    case 'venue': return clampN(n * 0.16, 1.4, 3.2);
    default: return s.w;
  }
}

function buildSigns(game, plans) {
  const all = [];
  for (let d = 1; d < plans.length; d++) { const p = plans[d]; if (!p) continue; for (const s of p.signs) all.push({ d, s }); for (const s of autoVenueSigns(p)) all.push({ d, s }); }
  if (!all.length || typeof document === 'undefined') return [];
  const nAtlas = Math.ceil(all.length / (COLS * ROWS));
  const atlases = [];
  for (let a = 0; a < nAtlas; a++) { const c = document.createElement('canvas'); c.width = ATLAS; c.height = ATLAS; atlases.push(c); }
  const groups = new Map();   // key d|ext|atlas|glow → {pos, nor, uv, int}
  all.forEach(({ d, s }, k) => {
    const a = Math.floor(k / (COLS * ROWS)), slot = k % (COLS * ROWS), cx = (slot % COLS) * SLOT_W, cy = Math.floor(slot / COLS) * SLOT_H;
    const ctx = atlases[a].getContext('2d');
    paintSign(ctx, cx, cy, s.text, s.style, s.sub);
    const p = plans[d];
    let nx = Math.sin(s.rot), nz = Math.cos(s.rot);
    let x = s.x, z = s.z;
    // facing into a wall within 0.35 m? → move to the far face of that wall (layout quirk)
    const front = wallAlong(p, x, z, nx, nz, 0.35);
    if (front) { const off = front.thick / 2 + 0.012; if (front.ax) x = front.line + front.s * off; else z = front.line + front.s * off; }
    else {
      const back = wallAlong(p, x, z, -nx, -nz, 0.5);
      if (back) { const off = back.thick / 2 + 0.012; if (back.ax) x = back.line + back.s * -off; else z = back.line + back.s * -off; }
    }
    const room = p.roomAt(x + nx * 0.2, z + nz * 0.2);
    const ext = !room || !!room.exterior;
    const w = signWidth(s), h = w / 4;
    let yc = s.y;
    const ceil = ceilingOf(plans, d, room, x, z);
    if (yc + h / 2 > ceil - 0.04) yc = ceil - 0.04 - h / 2;
    const y = deckY(d) + yc;
    const glow = s.style === 'venue';
    const key = `${d}|${ext ? 1 : 0}|${a}|${glow ? 1 : 0}`;
    let G = groups.get(key);
    if (!G) { G = { d, ext, a, glow, pos: [], nor: [], uv: [], int: [], idx: [] }; groups.set(key, G); }
    // quad: right vector r = (cos rot, 0, -sin rot) for a plane facing n=(sin rot,0,cos rot)
    const rx = Math.cos(s.rot), rz = -Math.sin(s.rot);
    const b = G.pos.length / 3;
    const u0 = cx / ATLAS, u1 = (cx + SLOT_W) / ATLAS, v1 = 1 - cy / ATLAS, v0 = 1 - (cy + SLOT_H) / ATLAS;
    const corners = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
    for (const [sx, sy, u, v] of corners) {
      G.pos.push(x + rx * sx * w / 2, y + sy * h / 2, z + rz * sx * w / 2);
      G.nor.push(nx, 0, nz); G.uv.push(u, v); G.int.push(ext ? 0 : (room ? room.light ?? 0.9 : 0.9));
    }
    G.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    // backing plate (thin dark slab) for plaques, not for glowing script
    if (!glow) {
      const t = 0.02, ox = -nx * t, oz = -nz * t;
      const bb = G.pos.length / 3;
      const pw = w / 2 + 0.01, ph = h / 2 + 0.01;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { G.pos.push(x + ox * 0.5 + rx * sx * pw - nx * 0.001, y + sy * ph, z + oz * 0.5 + rz * sx * pw - nz * 0.001); G.nor.push(nx, 0, nz); G.uv.push(u0 + 0.001, v0 + 0.001); G.int.push(G.int[G.int.length - 1]); }
      G.idx.push(bb, bb + 1, bb + 2, bb, bb + 2, bb + 3);
    }
  });
  const texes = atlases.map(c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; return t; });
  const mats = texes.map(t => {
    const plain = patchSurface(new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0.15 }), { key: 'sign' });
    const glow = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    glow.color.setScalar(1.4);
    return { plain, glow };
  });
  const meshes = [];
  for (const G of groups.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
    g.setAttribute('aInt', new THREE.Float32BufferAttribute(G.int, 1));
    g.setIndex(G.idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, G.glow ? mats[G.a].glow : mats[G.a].plain);
    m.name = `signs-d${G.d}${G.ext ? 'e' : 'i'}`;
    m.renderOrder = G.glow ? 3 : 0;
    const D = game.world.decks[G.d];
    (G.ext ? D.ext : D.detail).add(m);
    meshes.push({ d: G.d, mesh: m });
  }
  // venue signs glow a little brighter at night
  game.addSystem?.({ name: 'furnitureSigns', order: 89, update() { const k = 1.15 + shared.uNight.value * 0.9; for (const m of mats) m.glow.color.setScalar(k); } });
  return meshes;
}

// ═════════════════════════════════════════════════════════════════════════
//  INSTALL
// ═════════════════════════════════════════════════════════════════════════
export function installFurniture(game) {
  const t0 = performance.now();
  const world = game.world, plans = world.plans;
  const matO = makeMaterial(false), matG = makeMaterial(true);
  const perDeck = [];        // d → [meshes]
  const itemRef = new Map(); // item → {mesh, glass, i}
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  const stats = { instances: 0, meshes: 0, tris: 0, perDeck: [] };

  const badItems = [];
  for (let d = 1; d < plans.length; d++) {
    const p = plans[d], D = world.decks[d];
    if (!p || !D) continue;
    const groups = new Map();
    for (const it of p.items) {
      if (SKIP.has(it.t)) continue;
      const def = FDEF[it.t]; if (!def) continue;
      if (!(Math.abs(it.x) < 200 && Math.abs(it.z) < 40)) { badItems.push(it); continue; }   // layout placed it off the ship
      const room = p.rooms[it.room] || p.roomAt(it.x, it.z);
      const M = MODELS[it.t];
      const W = it.w ?? def.w, Dd = it.d ?? def.d;
      let H = it.h ?? def.h;
      let variant = M && M.variant ? String(M.variant(it, room, W)) : '';
      const ext = !room || !!room.exterior;
      // headroom clamp (e.g. 4.4 m gensets under a 2.95 m deckhead) → squash vertically
      let sy = 1;
      if (it.t !== 'camera' && !def.wallY) {
        const ceil = ceilingOf(plans, d, room, it.x, it.z) - 0.04 - (it.y || 0);
        if (H > ceil) sy = ceil / H;
      }
      const cluster = world.clusterOf ? (ext ? 'E' + Math.floor((it.x + 165) / CHUNK) : world.clusterOf(d, room, it.x)) : '';
      const key = `${it.t}|${variant}|${W}|${Dd}|${H}|${ext ? 1 : 0}|${cluster}`;
      let G = groups.get(key);
      if (!G) { G = { t: it.t, variant, W, D: Dd, H, ext, cluster, list: [] }; groups.set(key, G); }
      G.list.push({ it, room, sy });
    }
    const chunked = [...groups.values()];
    const meshes = [];
    let deckTris = 0, deckInst = 0;
    for (const G of chunked) {
      const model = getModel(G.t, G.variant, G.W, G.D, G.H);
      if (!model.geo) continue;
      const n = G.list.length;
      const aInt = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      const iTint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      const M = MODELS[G.t] || {};
      const mesh = new THREE.InstancedMesh(instGeo(model.geo, aInt, iTint), matO, n);
      const glass = model.glass ? new THREE.InstancedMesh(instGeo(model.glass, aInt, iTint), matG, n) : null;
      const def = FDEF[G.t];
      for (let k = 0; k < n; k++) {
        const { it, room, sy } = G.list[k];
        let x = it.x, z = it.z, yaw = it.rot || 0;
        let y = deckY(d) + (it.y || 0);
        if (G.t === 'camera') {
          y = deckY(d) + Math.min(ceilingOf(plans, d, room, x, z), 2.62) - 0.005;
        } else if (def.wallY) {
          y += def.wallY - G.H / 2;
          // seat the item on the wall face behind it
          const w = wallAlong(p, x, z, -Math.sin(yaw), -Math.cos(yaw), 0.6);
          if (w) {
            const off = w.thick / 2 + G.D / 2 + 0.004;
            if (w.ax) x = w.line - w.s * off; else z = w.line - w.s * off;
          }
        }
        if (M.jitter) {
          const h = hash32(Math.round(it.x * 10), Math.round(it.z * 10));
          if (G.t === 'plant') yaw += (h % 628) / 100;
          else if (G.t === 'palm') yaw += (h % 4) * Math.PI / 2;
          else if (G.t === 'luggage') yaw += ((h % 61) - 30) / 100;
          else yaw += ((h % 11) - 5) / 100;
        }
        _q.setFromAxisAngle(_Y, yaw); _p.set(x, y, z); _s.set(1, sy, 1);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(k, _m); if (glass) glass.setMatrixAt(k, _m);
        aInt.array[k] = G.ext ? 0 : (room ? (room.isVoid ? 1.0 : room.light ?? 0.9) : 0.9);
        const tc = M.tints ? tintFor(M.tints, room, it, d) : '#ffffff';
        const c = Array.isArray(tc) ? tc : (tint.set(tc), [tint.r, tint.g, tint.b]);
        iTint.array[k * 3] = c[0]; iTint.array[k * 3 + 1] = c[1]; iTint.array[k * 3 + 2] = c[2];
        itemRef.set(it, { mesh, glass, i: k, m: _m.clone() });
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere(); mesh.computeBoundingBox?.();
      mesh.name = `furn-${G.t}${G.variant ? ':' + G.variant : ''}-d${d}${G.ext ? 'e' : 'i'}`;
      mesh.castShadow = G.ext || BIG_INTERIOR.has(G.t);
      mesh.receiveShadow = true;
      mesh.userData.furniture = { type: G.t, variant: G.variant, deck: d, ext: G.ext, cluster: G.cluster };
      meshes.push(mesh);
      if (glass) {
        glass.instanceMatrix.needsUpdate = true; glass.computeBoundingSphere();
        glass.name = mesh.name + '-glass'; glass.castShadow = false; glass.receiveShadow = false; glass.renderOrder = 4;
        meshes.push(glass);
      }
      const lodBase = lodModel(model);
      const lod = lodBase ? instGeo(lodBase, aInt, iTint) : null;
      if (world.addFurniture) world.addFurniture(d, { mesh, glass, ext: G.ext, cluster: G.cluster, lod });
      else { (G.ext ? D.ext : D.detail).add(mesh); if (glass) (G.ext ? D.ext : D.detail).add(glass); }
      deckTris += model.tris * n; deckInst += n;
    }
    perDeck[d] = meshes;
    stats.perDeck[d] = { meshes: meshes.length, instances: deckInst, tris: deckTris };
    stats.instances += deckInst; stats.meshes += meshes.length; stats.tris += deckTris;
  }
  const signMeshes = buildSigns(game, plans);
  for (const { d, mesh } of signMeshes) (perDeck[d] ||= []).push(mesh);
  stats.models = modelCache.size; stats.modelTris = trisBuilt; stats.signs = signMeshes.length;
  stats.ms = Math.round(performance.now() - t0);
  if (badItems.length) console.warn(`[furniture] skipped ${badItems.length} items placed off the ship (layout bug):`, badItems.map(i => `${i.t}@${i.x.toFixed(1)},${i.z.toFixed(1)}`).join(' '));
  console.info(`[furniture] built ${stats.instances} items in ${stats.meshes} instanced meshes (${stats.models} unique models, ${(stats.modelTris / 1000).toFixed(1)}k tris of source geometry, ${(stats.tris / 1e6).toFixed(2)}M instanced tris), ${signMeshes.length} sign meshes in ${stats.ms} ms`);

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  game.furniture = {
    stats,
    meshesFor: (deck) => perDeck[deck] || [],
    setItemHidden(deck, item, hidden = true) {
      item.hidden = !!hidden;
      const r = itemRef.get(item);
      if (!r) return false;
      const m = hidden ? zero : r.m;
      r.mesh.setMatrixAt(r.i, m); r.mesh.instanceMatrix.needsUpdate = true;
      if (r.glass) { r.glass.setMatrixAt(r.i, m); r.glass.instanceMatrix.needsUpdate = true; }
      return true;
    },
  };
  return game.furniture;
}
