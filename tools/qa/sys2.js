(() => {
  const g = __game, P = g.player, R = {};
  const evts = {}; const cnt = (n) => g.bus.on(n, (e) => { (evts[n] = evts[n] || []).push(typeof e === 'object' ? JSON.stringify(e, (k, v) => (k === 'npc' || k === 'actor' || k === 'victim' || k === 'source' || k === 'target' || k === 'by' || k==='game' || k==='crime') ? undefined : v).slice(0, 200) : String(e)); });
  ['heat:change', 'security:arrest', 'security:released', 'ui:toast', 'alarm', 'save:done', 'save:error', 'npc:dead', 'combat:hit', 'security:report', 'player:surrender', 'player:stunned', 'bark', 'player:damage', 'player:dead'].forEach(cnt);
  const shotsLos=[]; const oa=g.combat.attackPlayer.bind(g.combat); g.combat.attackPlayer=(n,k,o)=>{ const los=n.deck===P.deck&&g.world.lineClear(n.deck,n.x,n.z,P.x,P.z); const r=oa(n,k,o); shotsLos.push([k,los,+Math.hypot(n.x-P.x,n.z-P.z).toFixed(1),r]); return r; }; window.__shotsLos=shotsLos;
  const near = () => g.npcs.query(P.deck, P.x, P.z, 25).map(n => ({ r: n.role, st: n.state, a: n.activity, d: +Math.hypot(n.x - P.x, n.z - P.z).toFixed(1), anim: g.chars && n.charId >= 0 ? (g.chars.get?.(n.charId)?.anim ?? '') : '' }));
  // Atrium deck 5 at noon
  g.minutes = 1440 + 12 * 60; P.teleport(4, 10, 0, 1.57); __pt.step(240);
  R.wellCheck = (()=>{P.teleport(5,10,3,1.57); __pt.step(30); const s=__pt.state(); P.teleport(4,10,0,1.57); __pt.step(30); return s;})();
  R.atriumCrowd = { n: g.npcs.query(4, P.x, P.z, 25).length, list: near().slice(0, 25) };
  // gunshot reaction: give pistol, shoot in air
  try {
    g.combat.give('pistol'); g.combat.select('pistol'); __pt.step(10);
    const before = near();
    g.combat.shoot(); __pt.step(5); g.combat.cd = 0; g.combat.shoot();
    __pt.step(120);
    const after = near();
    R.gunshot = { heat: g.security.heat, status: g.security.status, states: after.reduce((m, n) => (m[n.st] = (m[n.st] || 0) + 1, m), {}), guards: after.filter(n => n.r === 'security').length };
    __pt.step(600);
    const guards = g.security.ai.guards.map(n => ({ mode: n.sec?.mode, d: +Math.hypot(n.x - P.x, n.z - P.z).toFixed(1), deck: n.deck }));
    R.gunshot10s = { heat: g.security.heat, guards: guards.filter(x => x.deck === 4), engaged: g.security.ai.engaged.size, aiStats: g.security.ai.stats, playerHealth: P.health, pstate: P.state };
    // surrender: wait for arrest
    let arrested = false; let steps = 0;
    for (; steps < 3600 && !arrested; steps++) { g.step(1 / 60); if (P.state === 'arrested' || g.security.jailed) arrested = true; }
    R.arrest = { arrested, steps, pstate: P.state, deck: P.deck, room: P.room?.name, health: P.health, heat: g.security.heat, record: g.security.record, cash: g.economy.cash, weapon: g.combat.weaponId, owned: [...(g.combat._owned || [])], aiStats: g.security.ai.stats };
    __pt.step(1200);
    R.afterArrest = { pstate: P.state, deck: P.deck, room: P.room?.name, jailed: g.security.jailed, heat: g.security.heat };
  } catch (e) { R.gunErr = String(e.stack).slice(0, 400); }
  R.guardAttacks = { n: shotsLos.length, los: shotsLos.filter(x=>x[1]).length, sample: shotsLos.slice(0,20) };
  R.events = Object.fromEntries(Object.entries(evts).map(([k, v]) => [k, { n: v.length, s: v.slice(0, 6) }]));
  return JSON.stringify(R, null, 1);
})()
