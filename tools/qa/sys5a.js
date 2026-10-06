(() => { const g = __game, P = g.player; window.__ev = []; for (const n of ['security:arrest', 'security:released', 'ui:toast']) g.bus.on(n, e => __ev.push(n + ' ' + JSON.stringify(e, (k, v) => (['npc','actor','victim','source','by'].includes(k) ? undefined : v)).slice(0, 200)));
  g.minutes = 1440 + 13 * 60; P.teleport(4, 10, 0, 0); __pt.step(120);
  g.combat.give('baton'); g.security.report({ type: 'assault', witnessed: true }); __pt.step(60);
  g.input._debugSet('KeyH', true); __pt.step(60); g.input._debugSet('KeyH', false);
  let s = 0; for (; s < 3600 && !g.security._arresting; s++) g.step(1 / 60);
  return JSON.stringify({ s, arresting: !!g.security._arresting, owned: [...g.combat._owned] }); })()
