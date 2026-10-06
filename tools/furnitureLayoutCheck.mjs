// Reports furniture items whose FDEF footprint crosses walls/facades, sits in stairs/shafts/voids,
// or blocks doors. Layout is owned by the integrator; this only reports.
// Usage: node tools/furnitureLayoutCheck.mjs [deck]
import { buildShipLayout } from '../src/world/shipLayout.js';
import { FDEF } from '../src/world/furnitureDefs.js';
import { GRID, toI, toJ, idx } from '../src/core/config.js';
const L = buildShipLayout(7);
const only = process.argv[2] ? +process.argv[2] : 0;
const SKIP = new Set(['post', 'standing', 'rail_spot', 'camera']);
const summary = {};
for (let d = 1; d <= 17; d++) {
  if (only && d !== only) continue;
  const p = L.plans[d]; const out = [];
  for (const it of p.items) {
    if (SKIP.has(it.t)) continue;
    const def = FDEF[it.t]; if (def.wallY) continue;
    const w = it.w ?? def.w, dd = it.d ?? def.d;
    const c = Math.cos(it.rot), s = Math.sin(it.rot);
    const hx = Math.abs(c) * w / 2 + Math.abs(s) * dd / 2 - 0.06, hz = Math.abs(s) * w / 2 + Math.abs(c) * dd / 2 - 0.06;
    const i0 = toI(it.x - hx), i1 = toI(it.x + hx), j0 = toJ(it.z - hz), j1 = toJ(it.z + hz);
    const probs = new Set();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) { probs.add('outside grid'); continue; }
      const r = p.rooms[p.room[idx(i, j)]];
      if (!r) probs.add('off-plan'); else if (r.isVoid) probs.add('over void ' + r.name); else if (r.type === 'shaft') probs.add('in shaft'); else if (r.ramp) probs.add('on stairs');
      if (i < i1) { const e = p.ex[idx(i, j)]; if (e === 1 || e === 4) probs.add('crosses wall'); if (e === 2) probs.add('blocks door'); }
      if (j < j1) { const e = p.ez[idx(i, j)]; if (e === 1 || e === 4) probs.add('crosses wall'); if (e === 2) probs.add('blocks door'); }
    }
    if (probs.size) {
      const room = p.rooms[it.room];
      out.push(`  ${it.t} @(${it.x.toFixed(1)}, ${it.z.toFixed(1)}) rot ${(it.rot * 180 / Math.PI).toFixed(0)}° in "${room ? room.name : '?'}": ${[...probs].join(', ')}`);
      for (const pr of probs) { const k = it.t + ': ' + pr.replace(/over void .*/, 'over void'); summary[k] = (summary[k] || 0) + 1; }
    }
  }
  if (out.length) { console.log(`D${d}: ${out.length} issues`); const seen = new Map(); for (const l of out) { const k = l.replace(/@\([^)]*\)/, '').replace(/"[^"]*"/, m => m.replace(/\d+/g, '#')); seen.set(k, (seen.get(k) || []).concat(l)); } for (const [k, ls] of seen) console.log(ls[0] + (ls.length > 1 ? `   (+${ls.length - 1} similar)` : '')); }
}
console.log('\nSUMMARY'); for (const [k, v] of Object.entries(summary).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
