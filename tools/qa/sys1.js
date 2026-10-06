(() => {
  const g = __game, P = g.player, R = {};
  const st = (n) => __pt.step(n);
  const evts = {}; const cnt = (n) => g.bus.on(n, (e) => { (evts[n] = evts[n] || []).push(typeof e === 'object' ? JSON.stringify(e).slice(0, 160) : String(e)); });
  ['announce', 'heat:change', 'security:arrest', 'security:released', 'ui:toast', 'alarm', 'save:done', 'save:error', 'bark', 'npc:dead', 'combat:hit'].forEach(cnt);
  // 1) schedule / announcements spam over 2 game hours (5760 steps @ 1/60 = 96 s = 77 game minutes). Use timeScale.
  try {
    g.minutes = 1440 + 8 * 60; const before = g.schedule.paLog.length;
    const t0 = performance.now(); const mem0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    let worst = 0; const frameMs = [];
    for (let i = 0; i < 3000; i++) { const a = performance.now(); g.step(1 / 60); const d = performance.now() - a; frameMs.push(d); if (d > worst) worst = d; }
    frameMs.sort((a, b) => a - b);
    R.soak = { steps: 3000, gameMin: +(3000 / 60 / 1.25).toFixed(1), avgMs: +((performance.now() - t0) / 3000).toFixed(2), p50: +frameMs[1500].toFixed(2), p99: +frameMs[2970].toFixed(2), worst: +worst.toFixed(1),
      heapMB0: +(mem0 / 1e6).toFixed(1), heapMB1: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null,
      pa: g.schedule.paLog.length - before, npcs: g.npcs.list.length, stats: (({ stuck, stuckPct, updateMs, maxMs, snaps }) => ({ stuck, stuckPct, updateMs, maxMs, snaps }))(g.npcs.stats()) };
  } catch (e) { R.soakErr = String(e); }
  // 2) full-day PA log via timeScale fast-forward
  try {
    g.timeScale = 20; const b0 = g.schedule.paLog.length; const ann0 = (evts.announce || []).length;
    for (let i = 0; i < 2250; i++) g.step(1 / 60);   // 2250*20/60/1.25 = 600 game minutes
    g.timeScale = 1;
    R.paDay = { paEntries: g.schedule.paLog.length - b0, announceEvts: (evts.announce || []).length - ann0, sample: g.schedule.paLog.slice(-12).map(e => e.clock + ' ' + e.text.slice(0, 90)), hour: g.hour.toFixed(2), npcs: g.npcs.list.length };
  } catch (e) { R.paErr = String(e); g.timeScale = 1; }
  return JSON.stringify(R, null, 1);
})()
