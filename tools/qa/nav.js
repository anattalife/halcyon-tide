(() => {
  const g = __game, P = g.player, W = g.world, R = {};
  // 1) random walk clip test in many public rooms on several decks
  const rnd = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const decks = [2, 4, 5, 6, 9, 13, 15, 16, 17];
  let clip = [], tested = 0, stuckPts = [], fell = [];
  for (const d of decks) {
    const rooms = W.plans[d].rooms.filter(r => r && !r.isVoid && !r.pool && r.cells > 40 && (r.x1 - r.x0) < 400);
    for (let k = 0; k < 6; k++) {
      const r = rooms[Math.floor(rnd() * rooms.length)];
      P.teleport(d, r.cx, r.cz, 0); g.step(1 / 60);
      if (W.collide(d, P.x, P.z, 0.29, { ignoreItems: true }).hit) continue;
      tested++;
      let bad = 0; const sx = P.x, sz = P.z;
      for (let j = 0; j < 12; j++) { __pt.camYaw(rnd() * 6.283); __pt.keys(rnd() < 0.5 ? ['KeyW', 'ShiftLeft'] : ['KeyW']); for (let s = 0; s < 30; s++) { g.step(1 / 60); if (__pt.wallCheck()) bad++; } }
      __pt.release();
      if (bad) clip.push({ d, room: r.name, at: [+P.x.toFixed(2), +P.z.toFixed(2)], bad, now: P.room?.name });
      if (Math.abs(P.y - W.floorY(P.deck, P.x, P.z)) > 0.6 && !P.inWater) fell.push({ d, room: r.name, y: P.y, floor: W.floorY(P.deck, P.x, P.z), deck: P.deck });
      if (Math.hypot(P.x - sx, P.z - sz) < 0.5) stuckPts.push({ d, room: r.name, at: [sx, sz] });
    }
  }
  R.randomWalk = { tested, clipCount: clip.length, clip: clip.slice(0, 12), fell, stuckPts: stuckPts.slice(0, 8) };
  // 2) stairs: passenger aft core up multiple decks (deck 5 -> 6) using goto along up lane; and crew stairs deck 2 -> 3
  const stair = (d, x0, z, x1) => { P.teleport(d, x0, z, 0); const r = __pt.goto(x1, z, { max: 900 }); return { from: d, to: P.deck, ok: r.ok, reason: r.reason, y: +P.y.toFixed(2), room: P.room?.name }; };
  R.stairs = [stair(9, -4, 1.0, -13.2), stair(5, -4, 1.0, -13.2), stair(2, -41.5, -1.0, -48.2), stair(2, -41.5, 1.0, -48.2), stair(16, -4, 1.0, -13.2)];
  // 3) door: home cabin door, as player via interaction
  try {
    const c = P.homeCabin; const sp = P._spawnPoint ? P._spawnPoint(c) : null;
    const d = W.plans[c.deck].doors[c.door];
    P.teleport(c.deck, sp.x, sp.z, sp.yaw);
    const r = __pt.goto(d.x, d.z, { max: 600 });
    R.cabinDoorWalk = { ok: r.ok, reason: r.reason, door: W.door(c.deck, c.door).open, end: r.end };
    // try interacting
    const ctx = { player: P, deck: P.deck, x: P.x, y: P.y, z: P.z, yaw: P.yaw, room: P.room };
    R.prompts = g.interact.query(ctx).map(i => i.label + (i.enabled === false ? '(disabled:' + i.reason + ')' : ''));
  } catch (e) { R.doorErr = String(e); }
  // 4) elevator: stand in mid core car on deck 9 and ride to 15
  try {
    const cars = g.elevators.cars.map(c => ({ id: c.id, core: c.core, deck: c.deck }));
    R.cars = cars.length;
    const car = g.elevators.cars.find(c => /mid/.test(c.core || c.id)) || g.elevators.cars[0];
    g.elevators.call(car.id, 9); let s = 0; for (; s < 3600 && !(car.deck === 9 && car.doorOpen > 0.9); s++) g.step(1 / 60);
    R.elevCall = { car: car.id, steps: s, deck: car.deck, door: car.doorOpen };
  } catch (e) { R.elevErr = String(e).slice(0, 200); }
  // 5) extremes
  const ex = (d, x, z) => { P.teleport(d, x, z, 0); __pt.step(30); return { d, x, z, deck: P.deck, y: +P.y.toFixed(2), room: P.room?.name || null, wall: __pt.wallCheck() }; };
  R.extremes = [ex(1, 115, 5), ex(1, -148, 5), ex(17, 100, 0), ex(17, 70, 15), ex(6, 160, 0), ex(16, 105, 18)];
  // 6) jump off the ship? walk outward at promenade deck 5 starboard rail
  P.teleport(5, 0, 19.5, 0); __pt.camYaw(0); __pt.keys(['KeyW', 'ShiftLeft', 'Space']); __pt.step(180); __pt.release();
  R.railTest = __pt.state();
  // pool
  P.teleport(15, 3, 0, Math.PI / 2); const pr = __pt.path([[13, 0], [19.5, 3], [23, 3]], { max: 900 });
  R.pool = pr.map(x => ({ ok: x.ok, reason: x.reason, end: x.end && { room: x.end.room, inWater: x.end.inWater, y: x.end.y } }));
  P.teleport(5, 10, 3, 0); __pt.step(120); R.atriumWell = __pt.state(); R.atriumWellFloorY = W.floorY(5, 10, 3); R.wellRoom = (({isVoid, type, name}) => ({isVoid, type, name}))(W.roomAt(5, 10, 3) || {});
  P.teleport(5, 0, 8, 1.57); R.walkIntoWell = __pt.goto(10, 3, { max: 400 }); delete R.walkIntoWell.trace;
  return JSON.stringify(R, null, 1);
})()
