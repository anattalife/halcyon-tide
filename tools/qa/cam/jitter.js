// walk through cabin 9147 + corridor + lift lobby; measure per-frame camera jumps (jitter) and min boom
(() => { const g = __game, R = g.cameraRig, P = g.player, C = g.camera.position;
  const runs = {};
  const track = (name, fn) => { let prev = C.clone(), maxJ = 0, minD = 9, hidden = 0, n = 0; const orig = g.step.bind(g);
    g.step = (dt) => { orig(dt); const j = C.distanceTo(prev); prev.copy(C); if (n > 5) maxJ = Math.max(maxJ, j); minD = Math.min(minD, Math.hypot(C.x - P.x, C.z - P.z)); if (R.charHidden) hidden++; n++; };
    try { fn(); } finally { g.step = orig; }
    runs[name] = { frames: n, maxJumpPerFrame: +maxJ.toFixed(3), minHorizDist: +minD.toFixed(2), hiddenFrames: hidden }; };
  track('cabin9147_walk', () => { P.teleport(9, 31.4, 7.6, 3.14); __pt.camYaw(3.14, 0.12); __pt.path([[31.2, 6.2], [30.2, 4.2], [31.6, 4.6], [31.4, 7.4]]); });
  track('cabin9147_spin', () => { P.teleport(9, 30.6, 6.6, 0); for (let i = 0; i < 180; i++) { __pt.camYaw(R.yaw + 0.035); g.step(1/60); } });
  track('corridor_sprint', () => { P.teleport(9, 0, 9.5, 1.57); __pt.path([[30, 9.5]], { keys: ['ShiftLeft'] }); });
  track('promenade_row', () => { P.teleport(5, 31, 0, 1.57); __pt.path([[50, 0]]); });
  return JSON.stringify(runs); })()
