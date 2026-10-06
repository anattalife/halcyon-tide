(() => { const g = __game, P = g.player; for (let k = 0; k < 60 * 80 && g.security.jailed; k++) g.step(1 / 60);
  const r1 = { jailed: g.security.jailed, room: P.room?.name };
  const r = __pt.goto(-48, 0, { max: 2000 }); return JSON.stringify({ r1, exit: { ok: r.ok, reason: r.reason, end: r.end?.room, x: r.end?.x, z: r.end?.z }, ev: __ev.slice(-4) }); })()
