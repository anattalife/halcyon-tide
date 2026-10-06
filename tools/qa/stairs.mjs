import { buildShipLayout } from '../../src/world/shipLayout.js';
const s = buildShipLayout(7);
for (const d of [1,2,3,15,16]) { const p = s.plans[d];
  for (const r of p.rooms) if (r && r.ramp) console.log('D'+d, r.name, `x${r.x0}..${r.x1} z${r.z0}..${r.z1}`, JSON.stringify(r.ramp)); }
