import { buildShipLayout } from '../../src/world/shipLayout.js';
const s = buildShipLayout(7);
for (const p of s.plans.slice(1)) {
  const list = p.rooms.filter(r => r && r.type !== 'cabin' && !/Stateroom|Suite/.test(r.name||'')).map(r => `${r.name}|${r.type}|${r.zone}|x${r.x0}..${r.x1} z${r.z0}..${r.z1}`);
  console.log('D' + p.deck, list.length, '::', list.join(' ; '));
}
