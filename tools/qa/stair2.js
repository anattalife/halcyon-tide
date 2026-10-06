(() => { const g = __game, P = g.player, R = {};
  P.teleport(2, -49, -1.0, Math.PI / 2); let r = __pt.goto(-41.5, -1.0, { max: 900 }); R.crewUp = { ok: r.ok, reason: r.reason, deck: P.deck, y: +P.y.toFixed(2), room: P.room?.name };
  // then go down again on deck 3 down lane z -2..0 xb=-42 -> xt=-47.5
  r = __pt.goto(-48.5, -1.0, { max: 900 }); R.crewDown = { ok: r.ok, reason: r.reason, deck: P.deck, y: +P.y.toFixed(2), room: P.room?.name };
  // Crew stair 2->3->4..? deck 3 up lane z0..2 from -42 to -47.5
  P.teleport(3, -41.5, 1.0, -Math.PI / 2); r = __pt.goto(-48.5, 1.0, { max: 900 }); R.crew3up = { ok: r.ok, reason: r.reason, deck: P.deck, y: +P.y.toFixed(2), room: P.room?.name };
  return JSON.stringify(R); })()
