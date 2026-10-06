(() => { const g = __game; const t = {};
  for (const s of g.systems) { if (s.update && !s.__w) { const o = s.update; s.__w = 1; s.update = function (a, b) { const t0 = performance.now(); o.call(this, a, b); t[s.name] = (t[s.name] || 0) + performance.now() - t0; }; } }
  const oe = g.env.update.bind(g.env); g.env.update = (a, b, c) => { const t0 = performance.now(); const r = oe(a, b, c); t.env = (t.env || 0) + performance.now() - t0; return r; };
  const res = [];
  const one = (label, fn) => { for (const k in t) t[k] = 0; fn(); const t0 = performance.now(); g.step(1 / 60); const tot = performance.now() - t0; const top = Object.entries(t).filter(e => e[1] > 2).map(e => e[0] + ':' + e[1].toFixed(0)); res.push(label + ' total=' + tot.toFixed(0) + 'ms ' + top.join(' ')); for (let i = 0; i < 5; i++) { for (const k in t) t[k] = 0; const a = performance.now(); g.step(1 / 60); const d = performance.now() - a; if (d > 30) res.push('  +' + i + ' ' + d.toFixed(0) + 'ms ' + Object.entries(t).filter(e => e[1] > 2).map(e => e[0] + ':' + e[1].toFixed(0)).join(' ')); } };
  g.env.envTimer = 999;
  one('baseline', () => {});
  one('jump +3h', () => { g.minutes += 180; });
  one('jump +6h', () => { g.minutes += 360; });
  one('jump to next day 08:00', () => { g.minutes = (Math.floor(g.minutes / 1440) + 1) * 1440 + 480; });
  one('teleport deck 15', () => { g.player.teleport(15, 10, 12, 0); });
  one('teleport deck 2', () => { g.player.teleport(2, 0, 0, 0); });
  one('teleport deck 4 dining', () => { g.player.teleport(4, -120, 0, 0); });
  g.env.envTimer = 0; one('pmrem refresh', () => {});
  return res.join('\n'); })()
