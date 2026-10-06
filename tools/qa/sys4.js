(() => {
  const g = __game, P = g.player, W = g.world, R = {};
  const ev = []; for (const n of ['security:arrest', 'security:released', 'player:surrender', 'ui:toast', 'heat:change']) g.bus.on(n, e => ev.push(n + ' ' + JSON.stringify(e, (k, v) => (['npc','actor','victim','source','by','items'].includes(k) ? undefined : v)).slice(0, 140)));
  // surrender flow at heat 2 near guards
  g.minutes = 1440 + 13 * 60; P.teleport(4, 10, 0, 0); __pt.step(120);
  g.security.report({ type: 'assault', witnessed: true });
  __pt.step(60);
  R.heatStart = g.security.heat;
  g.input._debugSet('KeyH', true); __pt.step(60); g.input._debugSet('KeyH', false);
  R.surrendering = g.combat.surrendering;
  let s = 0; for (; s < 60 * 60 && !g.security.jailed; s++) g.step(1 / 60);
  R.jailedAfterSteps = s; R.jailed = g.security.jailed; R.pstate = P.state; R.room = P.room?.name; R.deck = P.deck; R.cuffs = g.security.ai.stats.cuffs;
  // wait for arrest promise fades (real-time setTimeouts?) 
  R.engaged = [...g.security.ai.engaged].map(n => n.sec?.mode);
  // jail interactions
  const ctx = { player: P, deck: P.deck, x: P.x, y: P.y, z: P.z, yaw: P.yaw, room: P.room };
  R.jailPrompts = g.interact.query(ctx, 4).map(i => i.label + (i.enabled === false ? ' [' + i.reason + ']' : ''));
  for (let k = 0; k < 60 * 90 && g.security.jailed; k++) g.step(1 / 60);
  R.afterServe = { jailed: g.security.jailed, room: P.room?.name, deck: P.deck, x: +P.x.toFixed(1), z: +P.z.toFixed(1), record: g.security.record, locker: g.security.evidenceLocker.length };
  // walk out of cell to Spine
  const r = __pt.goto(-48, 0, { max: 1500 }); R.exitCell = { ok: r.ok, reason: r.reason, end: r.end?.room };
  // NPC floor sanity: any NPC whose y deviates from floor
  const bad = []; for (const n of g.npcs.list) { if (n.state === 'hidden' || n.gone) continue; const fy = W.floorY(n.deck, n.x, n.z); if (Math.abs(n.y - fy) > 0.5 && !(W.roomAt(n.deck, n.x, n.z) || {}).pool) bad.push([n.role, n.deck, +n.x.toFixed(1), +n.z.toFixed(1), +(n.y - fy).toFixed(2), n.state, (W.roomAt(n.deck, n.x, n.z) || {}).name]); }
  R.npcFloorBad = { n: bad.length, of: g.npcs.list.length, s: bad.slice(0, 10) };
  // NPCs inside walls
  const inw = []; for (const n of g.npcs.list) { if (n.state === 'hidden' || n.gone || n.state === 'use') continue; if (W.collide(n.deck, n.x, n.z, 0.2, { ignoreItems: true }).hit) inw.push([n.role, n.deck, +n.x.toFixed(1), +n.z.toFixed(1), n.state, (W.roomAt(n.deck, n.x, n.z) || {}).name]); }
  R.npcInWalls = { n: inw.length, s: inw.slice(0, 10) };
  // NPC-NPC overlap in a dense room
  P.teleport(4, -120, 0, 0); g.minutes = 1440 + 19.5 * 60; __pt.step(300);
  const L = g.npcs.query(4, P.x, P.z, 30); let ov = 0; for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (Math.hypot(L[i].x - L[j].x, L[i].z - L[j].z) < 0.25) ov++;
  R.diningOverlap = { n: L.length, overlapsLt25cm: ov, seated: L.filter(n => n.state === 'use').length };
  R.events = ev.slice(0, 30);
  return JSON.stringify(R, null, 1);
})()
