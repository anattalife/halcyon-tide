(() => { const g = __game, P = g.player; const ok = g.save.saveSlot(2); P.teleport(9, 0, 9.5, 0); g.security.release?.('qa'); g.security.jailed = false; const l = g.save.loadSlot(2); __pt.step(30);
  const door = g.security._jail?.door; const cellRoom = P.room?.name;
  const plan = g.world.plans[2]; const doorsNear = g.world.doorsNear(2, P.x, P.z, 8).map(d => { const s = g.world.door(2, d.door.id); return { id: d.door.id, type: d.door.type, access: d.door.access, locked: s.lockedState, canPass: g.doors.canPass(P, s) }; });
  return JSON.stringify({ ok, l, jailed: g.security.jailed, room: cellRoom, x: +P.x.toFixed(1), z: +P.z.toFixed(1), heat: g.security.heat, record: g.security.record, doorsNear }); })()
