(() => { const g = __game, P = g.player, W = g.world, R = {};
  // elevator ride as player: walk into mid-S1 car at deck 9, ride to 15
  try {
    const car = g.elevators.car('mid-S1'); g.elevators.call(car.id, 9);
    let s = 0; for (; s < 3600 && !(car.atDeck === 9 && car.doorOpen > 0.95); s++) g.step(1 / 60);
    const dr = (() => { const pl = W.plans[9]; for (const d of pl.doors) if (d.car === car.id) return d; })();
    const sh = W.plans[9].rooms.find(r => r && r.car === car.id);
    P.teleport(9, dr.x + (dr.normal === 'x' ? -1.2 * Math.sign(sh.cx - dr.x) : 0), dr.z + (dr.normal === 'z' ? -1.2 * Math.sign(sh.cz - dr.z) : 0), 0);
    const w = __pt.goto(sh.cx, sh.cz, { max: 600 });
    R.enterCar = { ok: w.ok, reason: w.reason, pstate: P.state, elevator: P.elevator };
    g.elevators.ride(P, car.id, 15);
    let t = 0; for (; t < 60 * 90 && !(P.deck === 15 && car.doorOpen > 0.95); t++) g.step(1 / 60);
    R.ride = { steps: t, secs: +(t / 60).toFixed(1), deck: P.deck, y: +P.y.toFixed(2), pstate: P.state, carDeck: car.atDeck };
    const out = __pt.goto(dr.x - (sh.cx - dr.x) * 1.5, dr.z - (sh.cz - dr.z) * 1.5, { max: 600 }); R.exitCar = { ok: out.ok, room: P.room?.name, deck: P.deck, state: P.state };
  } catch (e) { R.elevErr = String(e.stack).slice(0, 300); }
  // prompt dominance: in a crowd, how often is top prompt 'Takedown'/'Pickpocket'
  g.minutes = 1440 + 13 * 60; P.teleport(4, 10, 0, 0); __pt.step(120);
  const tops = {}; for (let k = 0; k < 120; k++) { __pt.camYaw(k * 0.37); __pt.keys(['KeyW']); __pt.step(10); const q = g.interact.query({ player: P, deck: P.deck, x: P.x, y: P.y, z: P.z, yaw: P.yaw, room: P.room }); const l = q[0]?.label || 'none'; tops[l] = (tops[l] || 0) + 1; } __pt.release();
  R.promptTop = tops;
  // CPU: 600 steps with 160 NPCs in atrium, per-system
  const t = {}; for (const s of g.systems) if (s.update) { const o = s.update; s.update = function (a, b) { const t0 = performance.now(); o.call(this, a, b); t[s.name] = (t[s.name] || 0) + performance.now() - t0; }; }
  g.env.envTimer = 1e9; const m0 = performance.memory.usedJSHeapSize; const T0 = performance.now();
  const fr = []; for (let i = 0; i < 1200; i++) { const a = performance.now(); g.step(1 / 60); fr.push(performance.now() - a); }
  fr.sort((a, b) => a - b);
  R.cpuCrowd = { npcs: g.npcs.list.length, avg: +((performance.now() - T0) / 1200).toFixed(2), p95: +fr[1140].toFixed(2), p99: +fr[1188].toFixed(2), max: +fr[1199].toFixed(1), heapDeltaMB: +((performance.memory.usedJSHeapSize - m0) / 1e6).toFixed(1), per: Object.fromEntries(Object.entries(t).filter(e => e[1] / 1200 > 0.05).map(e => [e[0], +(e[1] / 1200).toFixed(3)])) };
  // long soak memory: 6000 steps with walking around deck 9 corridor
  P.teleport(9, -140, 9.5, 1.57); const m1 = performance.memory.usedJSHeapSize; const geo0 = g.renderer.info.memory.geometries;
  for (let i = 0; i < 6; i++) { __pt.goto(i % 2 ? -140 : 100, 9.5, { max: 1000, keys: ['ShiftLeft'] }); }
  R.soak2 = { heapDeltaMB: +((performance.memory.usedJSHeapSize - m1) / 1e6).toFixed(1), geomDelta: g.renderer.info.memory.geometries - geo0, chars: g.chars._n, npcs: g.npcs.list.length };
  return JSON.stringify(R, null, 1); })()
