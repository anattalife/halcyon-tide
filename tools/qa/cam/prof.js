(() => { const g = __game; const P = g.player; P.teleport(9, 31.4, 7.3, 3.14);
  const out = {};
  for (const s of g.systems) for (const k of ['update', 'lateUpdate']) { if (!s[k]) continue; const o = s[k].bind(s); s[k] = (a, b) => { const t = performance.now(); o(a, b); out[s.name + '.' + k] = (out[s.name + '.' + k] || 0) + performance.now() - t; }; }
  const t0 = performance.now(); for (let i = 0; i < 5; i++) g.step(1 / 60); const sim = performance.now() - t0;
  __pt.fast(false); const t1 = performance.now(); g.step(1 / 60); const ren = performance.now() - t1; __pt.fast(true);
  return '5 steps ' + sim.toFixed(0) + 'ms, 1 rendered step ' + ren.toFixed(0) + 'ms ' + JSON.stringify(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ':' + v.toFixed(0)));
})()
