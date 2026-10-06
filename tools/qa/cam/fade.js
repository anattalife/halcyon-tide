(() => { const g = __game, R = g.cameraRig, P = g.player; P.teleport(5, 35, 0, 1.57); __pt.camYaw(1.57, 0.1); for (let i = 0; i < 30; i++) g.step(1/60);
  const c = g.camera.position; const n = g.npcs.spawnAt('passenger', 5, c.x, c.z, { name: 'Fade Test' });
  for (let i = 0; i < 3; i++) g.step(1/60);
  const npc = n && (n.charId != null ? n : g.npcs.get(n));
  const st = npc ? g.chars.get(npc.charId) : null;
  const d1 = npc ? Math.hypot(npc.x - g.camera.position.x, npc.z - g.camera.position.z).toFixed(2) : '?';
  const a1 = st ? st.alpha : 'n/a';
  if (npc) { npc.x = P.x + 6; npc.z = P.z; g.npcs.setGoal?.(npc, { type: 'idle' }); }
  for (let i = 0; i < 3; i++) g.step(1/60);
  return 'npc near cam d=' + d1 + ' alpha=' + a1 + ' | moved away alpha=' + (st ? st.alpha : 'n/a') + ' faded set ' + R._faded.size; })()
