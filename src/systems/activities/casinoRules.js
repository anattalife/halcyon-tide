// Pure, deterministic casino rules engines — no DOM, no game refs. Unit-testable.
// Exposed on game.activities.rules for tools/tests.

import { Rng } from '../../core/util.js';

// ── Slots ─────────────────────────────────────────────────────────────────────
// 3 reels, 6 symbols. Weighted strips tuned to RTP ≈ 0.92.
export const SLOT_SYMBOLS = ['🍒', '🍋', '🔔', '⚓', '🅱', '7️⃣'];
export const SLOT_NAMES = ['Cherry', 'Lemon', 'Bell', 'Anchor', 'Bar', 'Seven'];
// reel strips: index→count (probability weight) per reel
export const SLOT_STRIPS = [
  [5, 10, 6, 5, 4, 2],
  [5, 10, 6, 5, 4, 2],
  [6, 10, 6, 5, 4, 1],
];
// three-of-a-kind multipliers (×bet) by symbol index
export const SLOT_TRIPLE = [10, 10, 18, 30, 60, 250];

// payout for a result [a,b,c] (symbol indices), given bet; returns {win, kind, near}
export function slotPayout(r, bet) {
  const [a, b, c] = r;
  if (a === b && b === c) return { win: bet * SLOT_TRIPLE[a], kind: 'triple', line: SLOT_NAMES[a] };
  if (a === 0 && b === 0) return { win: bet * 3, kind: 'two_cherry' };     // two leading cherries
  if (a === 0) return { win: bet * 1, kind: 'one_cherry' };                // one leading cherry → push-ish
  // near miss: two matching sevens/bars for suspense flag
  const near = (a === b && a >= 4) || (b === c && b >= 4);
  return { win: 0, kind: near ? 'near' : 'none', near };
}

export function slotRTP(strips = SLOT_STRIPS) {
  const N = strips.map(s => s.reduce((x, y) => x + y, 0));
  let tot = 0;
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
    const p = strips[0][a] / N[0] * strips[1][b] / N[1] * strips[2][c] / N[2];
    tot += p * slotPayout([a, b, c], 1).win;
  }
  return tot;
}

export function spinReel(rng, reel) {
  const strip = SLOT_STRIPS[reel];
  const N = strip.reduce((x, y) => x + y, 0);
  let x = rng.next() * N;
  for (let i = 0; i < strip.length; i++) { x -= strip[i]; if (x <= 0) return i; }
  return strip.length - 1;
}
export function spinSlots(rng) { return [spinReel(rng, 0), spinReel(rng, 1), spinReel(rng, 2)]; }

// ── Blackjack ───────────────────────────────────────────────────────────────
// Multi-deck shoe, dealer hits soft 16 / stands 17, 3:2 blackjack, double, split.
export function makeShoe(rng, decks = 6) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) shoe.push(r);
  // Fisher-Yates
  for (let i = shoe.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [shoe[i], shoe[j]] = [shoe[j], shoe[i]]; }
  return shoe;
}
export function cardValue(r) { return r === 1 ? 11 : r > 10 ? 10 : r; }
export function handValue(cards) {
  let total = 0, aces = 0;
  for (const r of cards) { total += cardValue(r); if (r === 1) aces++; }
  let soft = aces > 0;
  while (total > 21 && aces > 0) { total -= 10; aces--; soft = aces > 0; }
  return { total, soft: soft && total <= 21, bust: total > 21 };
}
export function isBlackjack(cards) { return cards.length === 2 && handValue(cards).total === 21; }

// play out the dealer from an up-hand following H17 rules; mutates shoe via draw()
export function dealerPlay(cards, draw) {
  while (true) {
    const { total, soft } = handValue(cards);
    if (total < 17 || (total === 17 && soft)) cards.push(draw());   // hits soft 17
    else break;
  }
  return cards;
}

// settle a single player hand vs dealer. returns net multiplier of the hand's bet
// (e.g. +1.5 blackjack, +1 win, 0 push, -1 loss). doubled hands pass bet*2 as stake upstream.
export function settle(playerCards, dealerCards, { blackjack3to2 = true, playerBlackjack = false, dealerBlackjack = false } = {}) {
  const pv = handValue(playerCards), dv = handValue(dealerCards);
  if (playerBlackjack && dealerBlackjack) return 0;
  if (playerBlackjack) return blackjack3to2 ? 1.5 : 1;
  if (dealerBlackjack) return -1;
  if (pv.bust) return -1;
  if (dv.bust) return 1;
  if (pv.total > dv.total) return 1;
  if (pv.total < dv.total) return -1;
  return 0;
}

// ── Roulette (European, single zero) ──────────────────────────────────────────
export const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export function rouletteColor(n) { return n === 0 ? 'green' : ROULETTE_RED.has(n) ? 'red' : 'black'; }
export function spinRoulette(rng) { return Math.floor(rng.next() * 37); }   // 0..36

// A bet: { type, value?, amount }. Returns total returned INCLUDING stake on win, 0 on loss.
// payouts quoted as "to one"; returned = amount*(payout+1).
export function roulettePayout(bet, n) {
  const { type, value, amount } = bet;
  const win = (mult) => amount * (mult + 1);
  const color = rouletteColor(n);
  switch (type) {
    case 'straight': return n === value ? win(35) : 0;
    case 'red': return color === 'red' ? win(1) : 0;
    case 'black': return color === 'black' ? win(1) : 0;
    case 'odd': return n !== 0 && n % 2 === 1 ? win(1) : 0;
    case 'even': return n !== 0 && n % 2 === 0 ? win(1) : 0;
    case 'low': return n >= 1 && n <= 18 ? win(1) : 0;      // 1-18
    case 'high': return n >= 19 && n <= 36 ? win(1) : 0;    // 19-36
    case 'dozen1': return n >= 1 && n <= 12 ? win(2) : 0;
    case 'dozen2': return n >= 13 && n <= 24 ? win(2) : 0;
    case 'dozen3': return n >= 25 && n <= 36 ? win(2) : 0;
    case 'column1': return n !== 0 && n % 3 === 1 ? win(2) : 0;
    case 'column2': return n !== 0 && n % 3 === 2 ? win(2) : 0;
    case 'column3': return n !== 0 && n % 3 === 0 ? win(2) : 0;
    default: return 0;
  }
}

export { Rng };
