import { buildShipLayout } from '../src/world/shipLayout.js';
import { GRID, idx } from '../src/core/config.js';
const s = buildShipLayout();
let total=0;
for (const p of s.plans.slice(1)) {
  const {nx,nz}=GRID; const seen=new Uint8Array(nx*nz); const q=[];
  for (const c of p.cores) { const r=p.rooms[c.lobby]; for (let k=0;k<nx*nz;k++) if (p.room[k]===c.lobby && !seen[k]) { seen[k]=1; q.push(k); } }
  if (!q.length) { // start anywhere
    for (let k=0;k<nx*nz;k++) if (p.room[k]) { seen[k]=1;q.push(k);break; } }
  while(q.length){ const k=q.pop(); const i=k%nx, j=(k/nx)|0;
    const tryE=(nk,t)=>{ if(seen[nk]||!p.room[nk]) return; const r=p.rooms[p.room[nk]]; if(r.isVoid) return; if(t===0||t===2){seen[nk]=1;q.push(nk);} };
    if(i<nx-1) tryE(k+1,p.ex[k]); if(i>0) tryE(k-1,p.ex[k-1]); if(j<nz-1) tryE(k+nx,p.ez[k]); if(j>0) tryE(k-nx,p.ez[k-nx]); }
  const bad=[];
  for (const r of p.rooms) { if(!r||r.isVoid||!r.cells||r.name==='Stair Store') continue; let any=false; for(let k=0;k<nx*nz;k++) if(p.room[k]===r.id&&seen[k]){any=true;break;} if(!any) bad.push(`${r.name||r.type}(${r.type}) @${r.cx.toFixed(0)},${r.cz.toFixed(0)}`); }
  total+=bad.length;
  if (bad.length) console.log('D'+p.deck, bad.length, 'unreachable:', bad.slice(0,25).join(' | '));
}
console.log('total unreachable', total);
const p13=s.plans[13]; const br=p13.rooms.find(r=>r&&r.name==='Navigation Bridge'); const w=p13.rooms.find(r=>r&&r.name==='Starboard Bridge Wing');
console.log('bridge',br.x0,br.x1,br.z0,br.z1,'wing',w.x0,w.x1,w.z0,w.z1, 'runs', p13.sharedRuns(br.id,w.id).length, 'doors to wing', p13.doors.filter(d=>d.rooms.includes(w.id)).map(d=>[d.x,d.z,d.normal]));
