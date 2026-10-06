// Screenshot set for ship systems. PORT=8772 python3 tools/sysTest.py tools/sysShots.js 'skip=installFurniture,installNPCs'
const P = game.player;
const settle = `for (let k = 0; k < 90; k++) for (const s of game.systems) { if (s.update && s.name !== "chars") try { s.update(1/30, 1/30); } catch (e) {} }`;
return { shots: [
  { name: 'v_corr9', cam: [20, 19.65, 9.5, 40, 19.4, 9.5], hour: 14, deck: 9,
    js: `const W = game.world; const p = W.plans[9]; const ds = p.doors.filter(d => d.type === 'cabin' && d.x > 23 && d.x < 33 && d.z > 5); for (const d of ds.slice(0, 2)) game.doors.open(9, d.id, { hold: true }); if (game.player) { game.player.x = 0; game.player.deck = 9; } ${settle}` },
  { name: 'v_cabinOpen', cam: [26.2, 19.62, 9.1, 29.5, 19.0, 11.5], hour: 14, deck: 9,
    js: `const W = game.world; const p = W.plans[9]; for (const d of p.doors.filter(d => d.type === 'cabin' && d.x > 27 && d.x < 32 && d.z > 5)) game.doors.open(9, d.id, { hold: true }); ${settle}` },
  { name: 'v_lobby9', cam: [-15, 19.6, 4, -10, 19.4, 7.5], hour: 14, deck: 9,
    js: `const E = game.elevators; const c = E.car('mid-S2'); c.y = 18; c.atDeck = 9; c.deck = 9; c.state = 'idle'; E.call('mid-S2', 9); ${settle}` },
  { name: 'v_carInside', cam: [-11.25, 19.62, 7.9, -11.25, 19.3, 5.0], hour: 14, deck: 9,
    js: `const E = game.elevators; const c = E.car('mid-S2'); c.y = 18; c.atDeck = 9; c.state = 'idle'; E.call('mid-S2', 9); ${settle}` },
  { name: 'v_casino5', cam: [45, 7.6, 0, 55, 7.6, 0], hour: 21, deck: 5, js: `` },
  { name: 'v_casino5open', cam: [47.5, 7.6, -1.2, 55, 7.4, 0.6], hour: 21, deck: 5,
    js: `game.doors.open(5, game.world.plans[5].doors.find(d => d.type === 'glass' && d.x === 52).id, { hold: true }); ${settle}` },
  { name: 'v_wt1', cam: [-95, -4.4, -1, -100, -4.5, 4], hour: 14, deck: 1, js: `` },
  { name: 'v_wt1b', cam: [-93.2, -4.5, -0.3, -95.6, -4.7, 1.5], hour: 14, deck: 1, js: `` },
  { name: 'v_extnight', cam: [-40, 40, 40, 0, 36, 0], hour: 22, deck: 15, js: `` },
  { name: 'v_extnight2', cam: [10, 39.6, 13, 30, 37, 4], hour: 22, deck: 15, js: `` },
  { name: 'v_carRide',
    js: `const E = game.elevators, p = game.player; const c = E.car('mid-S2'); c.y = 18; c.atDeck = 9; c.state = 'idle'; c.stops.clear(); p.deck = 9; p.x = -11.25; p.z = 7.6; p.state = 'free'; ${settle}; E.ride(p, 'mid-S2', 14); for (let k = 0; k < 30 * 9; k++) for (const s of game.systems) { if (s.update && s.name !== 'chars') try { s.update(1/30, 1/30); } catch (e) {} } const y = c.y; window.__shot([-11.0, y + 1.62, 6.55, -11.45, y + 1.35, 8.4], 14, c.deck); return [p.state, p.elevator, p.deck, c.y.toFixed(2), c.state, c.door.toFixed(2)];` },
]};
