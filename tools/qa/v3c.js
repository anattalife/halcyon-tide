(() => { const g = __game; const pn = [...document.querySelectorAll('.pnl')].map(e => e.className + (getComputedStyle(e).opacity)); return JSON.stringify({ panels: pn, cur: g.ui.panel?.name }); })()
