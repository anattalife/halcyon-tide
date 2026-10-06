(() => { const g = __game, R = g.cameraRig, P = g.player; P.teleport(9, 30.2, 3.8, 0); __pt.camYaw(0, 0.12); for (let i = 0; i < 60; i++) g.step(1/60);
  const d = 9, hx = R.pivot.x, hz = R.pivot.z, rx = -Math.cos(R.yaw), rz = Math.sin(R.yaw);
  const out = [];
  for (const off of [0, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.45, -1.45]) { const ya = R.yaw + off, bx = -Math.sin(ya), bz = -Math.cos(ya);
    const H = R._reach(d, hx, hz, bx, bz, 1.8, () => P.y + 1.9); out.push(off + ':' + H.toFixed(2)); }
  return 'yaw ' + R.yaw.toFixed(2) + ' piv ' + hx.toFixed(2) + ',' + hz.toFixed(2) + ' comp ' + R.compS.toFixed(2) + ' reach ' + out.join(' ') + ' room z ' + P.room.z0 + '..' + P.room.z1; })()
