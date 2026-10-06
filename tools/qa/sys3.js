(() => {
  const g = __game, P = g.player, W = g.world, R = {};
  // crew stair deck 2 trace
  P.teleport(2, -41.0, -1.0, -Math.PI / 2);
  const t = __pt.goto(-48.0, -1.0, { max: 600, trace: true }); R.crewStairTrace = { ok: t.ok, reason: t.reason, end: t.end, trace: t.trace.slice(0, 30) };
  const blk = []; const p2 = W.plans[2]; for (let x = -49; x <= -41; x += 0.5) { const c = W.collide(2, x, -1.0, 0.29); blk.push([x, c.hit ? 1 : 0, (W.roomAt(2, x, -1.0) || {}).name]); } R.crewStairCollide = blk;
  // passenger deck 16 forward stair up
  P.teleport(16, 88, -1.0, Math.PI / 2); const t2 = __pt.goto(95.5, -1.0, { max: 600 }); R.d16stair = { ok: t2.ok, reason: t2.reason, end: t2.end };
  // save / load roundtrip with changed state
  try {
    P.teleport(5, 60, 0, 0); __pt.step(5);
    g.economy.add(777, 'qa'); g.inventory.add('casino_chips', 50); g.security.setHeat(2.2, 'qa');
    const before = { cash: g.economy.cash, chips: g.inventory.count('casino_chips'), heat: g.security.heat, deck: P.deck, x: P.x, z: P.z, min: g.minutes, missions: JSON.stringify(g.missions?.engine?.save?.() || g.missions?.save?.() || null).slice(0, 200), keys: g.save.keys() };
    const ok = g.save.saveSlot(1);
    g.economy.add(-500, 'qa'); g.inventory.remove('casino_chips', 50); P.teleport(9, 0, 9.5, 0); g.security.setHeat(0); g.minutes += 300;
    const lok = g.save.loadSlot(1); __pt.step(5);
    const after = { cash: g.economy.cash, chips: g.inventory.count('casino_chips'), heat: g.security.heat, deck: P.deck, x: +P.x.toFixed(2), z: +P.z.toFixed(2), min: g.minutes };
    R.save = { ok, lok, before, after, bytes: (localStorage.getItem('ht.save.v1.1') || '').length };
    g.security.clear();
  } catch (e) { R.saveErr = String(e.stack).slice(0, 300); }
  // pickpocket attempt x10 at crowd
  try {
    g.minutes = 1440 + 13 * 60; P.teleport(4, 10, 0, 0); __pt.step(120);
    const res = []; const sec0 = g.security.heat;
    const prov = g.interact.providers.find(p => p.name === 'pickpocket');
    for (let k = 0; k < 10; k++) {
      const n = g.npcs.query(4, P.x, P.z, 20).find(n => n.kind === 'pax' && n.state !== 'flee');
      if (!n) break; P.teleport(4, n.x - Math.sin(n.yaw) * 0.9, n.z - Math.cos(n.yaw) * 0.9, n.yaw); __pt.step(1);
      const ctx = { player: P, deck: P.deck, x: P.x, y: P.y, z: P.z, yaw: P.yaw, room: P.room };
      const its = prov ? prov.fn(ctx) || [] : []; const it = its[0];
      if (it) { const c0 = g.economy.cash; it.run(P, g); __pt.step(30); res.push({ reason: it.reason, gained: g.economy.cash - c0, heat: g.security.heat }); }
    }
    R.pickpocket = { res, heatEnd: g.security.heat, cash: g.economy.cash, inv: g.inventory.list ? g.inventory.list().map(i => i.id + 'x' + i.qty).slice(0, 15) : null };
    __pt.step(900); R.pickpocket.heatAfter15s = g.security.heat; R.pickpocket.status = g.security.status;
    g.security.clear();
  } catch (e) { R.ppErr = String(e.stack).slice(0, 300); }
  // NPC census by hour (focus deck 9 corridor and deck 15 pool)
  R.census = [];
  for (const h of [3, 7, 12, 18, 23]) {
    g.minutes = 1440 * 2 + h * 60; P.teleport(15, 10, 12, 0); __pt.step(300);
    const l = g.npcs.query(15, P.x, P.z, 60); const roles = {}; for (const n of l) roles[n.role] = (roles[n.role] || 0) + 1;
    const acts = {}; for (const n of l) acts[n.activity] = (acts[n.activity] || 0) + 1;
    R.census.push({ h, n: l.length, total: g.npcs.list.length, roles, acts, outfits: [...new Set(l.slice(0, 40).map(n => n.appearance?.outfit?.top + '/' + n.appearance?.outfit?.bottom))].slice(0, 10), stuck: g.npcs.stats().stuck });
  }
  return JSON.stringify(R, null, 1);
})()
