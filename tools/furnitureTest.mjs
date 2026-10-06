// Node test for src/world/furniture.js: builds every deck headlessly (no signs), reports
// per-type triangle counts, per-deck budgets, footprint violations and build time.
// Usage: node --import ./tools/registerThree.mjs tools/furnitureTest.mjs
import * as THREE from 'three';
import { buildShipLayout } from '../src/world/shipLayout.js';
import { FDEF } from '../src/world/furnitureDefs.js';
import { MODELS } from '../src/world/furnitureModels.js';
import { GB, prng } from '../src/world/propsGeo.js';
import { installFurniture } from '../src/world/furniture.js';
const L = buildShipLayout(7);
const decks = [null];
for (let d = 1; d <= 17; d++) decks.push({ ext: new THREE.Group(), detail: new THREE.Group() });
const game = { world: { plans: L.plans, decks }, addSystem() {} };
const t0 = performance.now();
const F = installFurniture(game);
console.log('install ms', Math.round(performance.now() - t0));
for (let d = 1; d <= 17; d++) { const s = F.stats.perDeck[d]; console.log(`D${d}: meshes ${s.meshes} inst ${s.instances} tris ${(s.tris / 1e6).toFixed(2)}M`); }
// per-type model stats + footprint check (default size, all variants seen)
const missing = Object.keys(FDEF).filter(t => !MODELS[t] && !['post', 'standing', 'rail_spot'].includes(t));
console.log('types without model:', missing.join(',') || 'none');
const variants = new Map();
for (let d = 1; d <= 17; d++) { const p = L.plans[d]; for (const it of p.items) { const M = MODELS[it.t]; if (!M) continue; const room = p.rooms[it.room]; const v = M.variant ? String(M.variant(it, room, it.w ?? FDEF[it.t].w)) : ''; const k = it.t + '|' + v; if (!variants.has(k)) variants.set(k, { it, v }); } }
const rows = [];
for (const [k, { it, v }] of variants) {
  const def = FDEF[it.t]; const W = it.w ?? def.w, D = it.d ?? def.d, H = it.h ?? def.h;
  const g = new GB(); MODELS[it.t].build(g, W, D, H, v, prng(1));
  const geo = g.build(); geo.computeBoundingBox(); const b = geo.boundingBox;
  const tol = 0.03;
  const over = [];
  if (b.min.x < -W / 2 - tol || b.max.x > W / 2 + tol) over.push(`x[${b.min.x.toFixed(2)},${b.max.x.toFixed(2)}] vs ±${(W / 2).toFixed(2)}`);
  if (b.min.z < -D / 2 - tol || b.max.z > D / 2 + tol) over.push(`z[${b.min.z.toFixed(2)},${b.max.z.toFixed(2)}] vs ±${(D / 2).toFixed(2)}`);
  if (it.t !== 'camera' && (b.max.y > H + 0.12 || b.min.y < -0.01)) over.push(`y[${b.min.y.toFixed(2)},${b.max.y.toFixed(2)}] vs ${H}`);
  rows.push([k, g.tris, over.join(' ')]);
}
rows.sort((a, b) => b[1] - a[1]);
for (const r of rows) console.log(r[0].padEnd(28), String(r[1]).padStart(6), r[2]);
// API check: hide/unhide one bed
{
  const it = L.plans[9].items.find(i => i.t === 'bed_q');
  const ok = F.setItemHidden(9, it, true);
  const m = F.meshesFor(9).find(x => x.userData.furniture && x.userData.furniture.type === 'bed_q');
  console.log('setItemHidden', ok, 'item.hidden', it.hidden, 'meshesFor(9)', F.meshesFor(9).length);
  F.setItemHidden(9, it, false); console.log('unhidden', it.hidden === false);
}
