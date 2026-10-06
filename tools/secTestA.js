// (a) punch a passenger in the deck 5 atrium in front of witnesses; (b) same in an empty cabin
const S = game.security, C = game.combat, P = game.player, N = game.npcs;
const R = {}; const T0 = performance.now(); const log = (...a) => console.log('[T]', ((performance.now()-T0)/1000).toFixed(1), ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)));
const stepS = (sec) => H.step(Math.round(sec * 60));
const reset = () => { S.clear(); S.lockdown(false); S.crime.pending.length = 0; S.record.strikes = 0; for (const n of N.list) if (n.sec) { n.sec.aware = 0; } };
game.minutes = 1440 + 15 * 60;
// ── (a) ──
P.teleport(5, 0, 10, Math.PI / 2); H.camYaw(Math.PI / 2);
stepS(6);   // populate
const pax = N.list.filter(n => n.deck === 5 && (n.role === 'passenger') && n.state !== 'ko' && Math.abs(n.x) < 40 && Math.abs(n.z) < 16);
R.a_pax = pax.length;
let victim = pax.sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
// spawn a mission passenger as a controlled victim in the atrium
victim = N.spawnAt('passenger', 5, 2, 12, { name: 'Test Victim' });
P.teleport(5, 2, 10.9, 0); H.camYaw(0);
stepS(0.2);
const guards0 = N.list.filter(n => n.role === 'security').map(n => ({ id: n.id, deck: n.deck, d: +Math.hypot(n.x - P.x, n.z - P.z).toFixed(1) }));
R.a_guards0 = guards0;
const seeing = N.list.filter(n => n.deck === 5 && n !== victim && n.perception.canSee(P.x, P.y + 1.4, P.z, 5)).length;
R.a_npcsSeeingPlayer = seeing;
const t = C.melee(false); C.cd = 0; stepS(0.3); C.melee(false); C.cd = 0; stepS(0.3); C.melee(true);
R.a_hitTarget = t ? t.name : null;
R.a_pending = S.crime.pending.map(r => ({ kind: r.kind, delay: +r.delay.toFixed(1), sighted: r.sighted }));
const track = [];
for (let k = 0; k <= 30; k++) {
  const g5 = N.list.filter(n => n.role === 'security' && n.deck === 5);
  const dists = g5.map(n => +Math.hypot(n.x - P.x, n.z - P.z).toFixed(1)).sort((a, b) => a - b).slice(0, 4);
  track.push([k, S.heat, +S.heatValue.toFixed(2), dists.join(','), [...S.ai.engaged].map(n => n.sec.mode[0]).join('')]);
  if (k === 12) { log('pre-shot'); await shot('a_atrium_response'); log('post-shot'); }
  log('a', track[track.length-1]);
  stepS(1);
}
R.a_track = track;
R.a_desc = S.describe();
R.a_radio = S.hud.radioLines.map(r => r.el.textContent).slice(-4);
R.a_stats = { ...S.ai.stats };
log('A done', R);
// ── (b) ──
reset();
for (const n of [...S.ai.engaged]) S.ai._finish(n);
const cab = game.layout.cabins.find(c => c.deck === 9 && !c.crew && c.x > 40 && c.side === 1);
const plan = game.world.plans[9], room = plan.rooms[cab.room];
P.teleport(9, room.cx, room.cz, 0);
const v2 = N.spawnAt('passenger', 9, room.cx + Math.sin(0) * 0.9, room.cz + 0.9, { name: 'Cabin Victim' });
H.camYaw(Math.atan2(v2.x - P.x, v2.z - P.z)); P.yaw = H.camYaw && Math.atan2(v2.x - P.x, v2.z - P.z);
stepS(0.2);
// takedown from behind → nobody else sees; victim KO'd; when they wake they report without a description
v2.yaw = Math.atan2(v2.x - P.x, v2.z - P.z);
R.b_canTakedown = C.canTakedown(v2);
R.b_witnessesBefore = N.list.filter(n => n !== v2 && n.deck === 9 && n.perception.canSee(P.x, P.y + 1.4, P.z, 9)).length;
C.takedown(v2); stepS(1.5);
R.b_victimState = v2.state;
R.b_pending = S.crime.pending.filter(r => !r.cancelled && !r.done).map(r => r.kind);
stepS(10);
R.b_heat = S.heat; R.b_heatValue = S.heatValue;
R.b_cameras = S.camerasSeeing(9, P.x, P.y + 1.4, P.z).length;
// loud punch on a second victim in the same cabin (awake)
const v3 = N.spawnAt('passenger', 9, room.cx, room.cz + 0.9, { name: 'Cabin Victim 2' });
P.yaw = 0; H.camYaw(0); stepS(0.2);
C.melee(false); stepS(0.5);
R.b_punch_pending = S.crime.pending.filter(r => !r.cancelled && !r.done).map(r => [r.kind, r.npc?.name, r.sighted]);
stepS(20);
R.b_heatAfterPunch = S.heat;
R.b_desc = S.describe();
return R;
