import { buildShipLayout } from '../src/world/shipLayout.js';
const t=Date.now(); const s = buildShipLayout();
console.log(JSON.stringify(s.stats));
for (const p of s.plans.slice(1)) {
  const types={}; for (const r of p.rooms) if (r) types[r.type]=(types[r.type]||0)+1;
  const empty = p.rooms.filter(r=>r&&r.cells===0).length;
  console.log('D'+p.deck, 'rooms',p.rooms.length-1,'doors',p.doors.length,'items',p.items.length,'pois',p.pois.length,'cabins',p.cabins.length,'emptyRooms',empty);
}
