// Node unit tests for the pure casino rules engines.
import * as R from '../src/systems/activities/casinoRules.js';
import { Rng } from '../src/core/util.js';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') { if (cond) { pass++; } else { fail++; console.log('FAIL:', name, extra); } }
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// ── Slots: RTP band ──────────────────────────────────────────────────────────
const rtp = R.slotRTP();
ok('slot analytic RTP in [0.90,0.94]', rtp >= 0.90 && rtp <= 0.94, 'rtp=' + rtp.toFixed(4));

// Monte Carlo 200k spins
{
  const rng = new Rng(12345);
  let bet = 0, ret = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) { const r = R.spinSlots(rng); bet += 1; ret += R.slotPayout(r, 1).win; }
  const sim = ret / bet;
  ok('slot sim RTP in [0.88,0.96]', sim >= 0.88 && sim <= 0.96, 'sim=' + sim.toFixed(4));
}

// ── Blackjack ──────────────────────────────────────────────────────────────
ok('hard 17 value', R.handValue([10, 7]).total === 17 && !R.handValue([10, 7]).soft);
ok('soft 17 (A6)', R.handValue([1, 6]).total === 17 && R.handValue([1, 6]).soft);
ok('A A 9 = 21', R.handValue([1, 1, 9]).total === 21);
ok('bust detection', R.handValue([10, 10, 5]).bust === true);
ok('blackjack detect', R.isBlackjack([1, 13]) && !R.isBlackjack([1, 9, 1]));
ok('settle: player 20 beats dealer 19', R.settle([10, 10], [10, 9]) === 1);
ok('settle: push 20 vs 20', R.settle([10, 10], [10, 10]) === 0);
ok('settle: player bust loses even if dealer bust', R.settle([10, 10, 5], [10, 10, 5]) === -1);
ok('settle: dealer bust player stands', R.settle([10, 7], [10, 10, 5]) === 1);
ok('settle: player blackjack 3:2', R.settle([1, 13], [10, 9], { playerBlackjack: true }) === 1.5);
ok('settle: both blackjack push', R.settle([1, 13], [1, 13], { playerBlackjack: true, dealerBlackjack: true }) === 0);
// dealer stands on 17, hits soft 16
{
  const rng = new Rng(7);
  // dealer with soft 16 (A5) must hit; with hard 17 must stand
  let feed = [5]; const draw = () => feed.length ? feed.shift() : 2;
  const d = R.dealerPlay([1, 5], draw);   // A5 soft16 → hit → A5+5 = 21
  ok('dealer hits soft 16', R.handValue(d).total >= 17);
  const d2 = R.dealerPlay([10, 7], () => 5);   // hard 17 → stand
  ok('dealer stands hard 17', d2.length === 2);
  const d3 = R.dealerPlay([1, 6], () => 10);   // soft 17 (A6) → H17 → hit → A6+10 = 17 hard
  ok('dealer hits soft 17 (H17)', d3.length === 3);
}
// house edge over many hands (basic: player mimics dealer, no BJ bonus for simplicity) should be small & negative-ish
{
  const rng = new Rng(999);
  let shoe = R.makeShoe(rng, 6);
  const draw = () => { if (shoe.length < 20) shoe = R.makeShoe(rng, 6); return shoe.pop(); };
  let net = 0; const N = 50000;
  for (let i = 0; i < N; i++) {
    const p = [draw(), draw()], d = [draw(), draw()];
    const pbj = R.isBlackjack(p), dbj = R.isBlackjack(d);
    if (!pbj && !dbj) { // player mimics dealer rules
      while (true) { const v = R.handValue(p); if (v.total < 17 || (v.total === 17 && v.soft)) p.push(draw()); else break; }
      if (!R.handValue(p).bust) R.dealerPlay(d, draw);
    }
    net += R.settle(p, d, { playerBlackjack: pbj, dealerBlackjack: dbj });
  }
  const edge = net / N;
  ok('blackjack house edge small (-0.12..0.02)', edge >= -0.12 && edge <= 0.02, 'edge=' + edge.toFixed(4));
}

// ── Roulette ──────────────────────────────────────────────────────────────
ok('color 0 green', R.rouletteColor(0) === 'green');
ok('color 1 red', R.rouletteColor(1) === 'red');
ok('color 2 black', R.rouletteColor(2) === 'black');
ok('straight pays 35:1 → returns 36', R.roulettePayout({ type: 'straight', value: 17, amount: 1 }, 17) === 36);
ok('straight miss returns 0', R.roulettePayout({ type: 'straight', value: 17, amount: 1 }, 18) === 0);
ok('red win returns 2', R.roulettePayout({ type: 'red', amount: 1 }, 1) === 2);
ok('even: 0 is not even', R.roulettePayout({ type: 'even', amount: 1 }, 0) === 0);
ok('dozen1 pays 2:1', R.roulettePayout({ type: 'dozen1', amount: 1 }, 5) === 3);
ok('column3 covers 3,6,...,36', R.roulettePayout({ type: 'column3', amount: 1 }, 36) === 3 && R.roulettePayout({ type: 'column3', amount: 1 }, 35) === 0);
// roulette RTP (even money): 18/37 ≈ 0.4865 → EV returned per 1 staked
{
  const rng = new Rng(42);
  let stake = 0, ret = 0; const N = 300000;
  for (let i = 0; i < N; i++) { const n = R.spinRoulette(rng); stake += 1; ret += R.roulettePayout({ type: 'red', amount: 1 }, n); }
  const rt = ret / stake;
  ok('roulette red RTP ~0.973', approx(rt, 0.973, 0.01), 'rtp=' + rt.toFixed(4));
}
{
  const rng = new Rng(43);
  let stake = 0, ret = 0; const N = 300000;
  for (let i = 0; i < N; i++) { const n = R.spinRoulette(rng); stake += 1; ret += R.roulettePayout({ type: 'straight', value: 7, amount: 1 }, n); }
  const rt = ret / stake;
  ok('roulette straight RTP ~0.973', approx(rt, 0.973, 0.02), 'rtp=' + rt.toFixed(4));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
