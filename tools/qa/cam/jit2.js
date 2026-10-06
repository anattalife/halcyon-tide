(() => { const g = __game, R = g.cameraRig, P = g.player, C = g.camera.position; const log = [];
  let prev = null; const orig = g.step.bind(g);
  g.step = (dt) => { const s0 = { sw: R.swingS, side: R.sideS, d: R.distance, comp: R.compS, cand: R._cand && { ...R._cand } }; orig(dt); if (prev) { const j = C.distanceTo(prev); if (j > 0.15) log.push({ j: +j.toFixed(2), sw: +R.swingS.toFixed(2), sw0: +s0.sw.toFixed(2), side: +R.sideS.toFixed(2), side0: +s0.side.toFixed(2), d: +R.distance.toFixed(2), d0: +s0.d.toFixed(2), comp: +R.compS.toFixed(2), cand: R._cand, cam: [C.x.toFixed(2), C.y.toFixed(2), C.z.toFixed(2)], p: [P.x.toFixed(2), P.z.toFixed(2)] }); } prev = C.clone(); };
  P.teleport(9, 30.6, 6.6, 0); g.step(1/60); g.step(1/60);
  for (let i = 0; i < 180; i++) { __pt.camYaw(R.yaw + 0.035); g.step(1/60); }
  P.teleport(9, 31.4, 7.6, 3.14); __pt.camYaw(3.14, 0.12); g.step(1/60); g.step(1/60); __pt.path([[31.2, 6.2], [30.2, 4.2], [31.6, 4.6], [31.4, 7.4]]);
  g.step = orig; return JSON.stringify(log.slice(0, 14)); })()
