// Analytic hull form. Shared by the deck-plan outlines and the hull mesh so walls meet the shell exactly.
import { SHIP, deckY } from '../core/config.js';

const H = SHIP.halfBeam;

// Section breadth (half) at height y, before bow/stern shaping.
export function sectionHalf(y) {
  if (y >= -3) return H;
  const t = -3 - y;                 // metres below the turn of bilge
  return Math.max(2.5, H - 0.36 * t * t);
}
// Stem x at height y (raked bow).
export function stemX(y) {
  if (y <= SHIP.keelY) return 146;
  if (y >= 12) return 165;
  const t = (y - SHIP.keelY) / (12 - SHIP.keelY);
  return 146 + 19 * Math.pow(t, 0.8);
}
// Transom x at height y (cut-up stern underwater).
export function transomX(y) {
  if (y >= -1.5) return -165;
  return -165 + Math.min(24, (-1.5 - y) * 2.6);
}
// Where bow narrowing begins.
export function bowStart(y) { return 72 + Math.max(0, Math.min(1, (y + 10) / 22)) * 18; }

export function hullHalf(x, y) {
  const sx = stemX(y), tx = transomX(y);
  if (x > sx || x < tx) return 0;
  let h = sectionHalf(y);
  const bs = bowStart(y);
  if (x > bs) {
    const t = (x - bs) / (sx - bs);
    h *= Math.pow(Math.max(0, 1 - Math.pow(t, 1.9)), 0.62);
  }
  const sternRun = -145;
  if (x < sternRun) {
    const t = (sternRun - x) / (sternRun - tx);
    h *= 1 - 0.13 * t * t - (y < -1.5 ? 0.25 * t * t * Math.min(1, (-1.5 - y) / 6) : 0);
  }
  return Math.max(0, h);
}

// Superstructure outline for upper decks (7+): straight sides, rounded fore end, stepped aft.
const SUPER = {
  7:  { aft: -163.5, fwd: 130 }, 8:  { aft: -163.5, fwd: 129 }, 9:  { aft: -163.5, fwd: 128 }, 10: { aft: -161.5, fwd: 127.5 },
  11: { aft: -159.5, fwd: 127 }, 12: { aft: -157.5, fwd: 126.5 }, 13: { aft: -155.5, fwd: 131 }, 14: { aft: -152, fwd: 125.5 },
  15: { aft: -142, fwd: 124.5 }, 16: { aft: -138, fwd: 112 }, 17: { aft: 64, fwd: 106 },
};
export function superHalf(d, x) {
  const s = SUPER[d];
  if (!s || x < s.aft || x > s.fwd) return 0;
  let h = H;
  const r = d >= 15 ? 16 : 11;               // rounding radius of the front
  if (x > s.fwd - r) {
    const t = (x - (s.fwd - r)) / r;
    h = H * Math.sqrt(Math.max(0, 1 - t * t * 0.92)) ;
    if (d === 13) h = Math.max(h, 0);
  }
  if (x < s.aft + 6) h -= (s.aft + 6 - x) * 0.08;
  // keep inside hull plan at the stern
  h = Math.min(h, hullHalf(Math.max(x, -164.9), 4) || h);
  return Math.max(0, h);
}
export const superLimits = (d) => SUPER[d];

export function deckHalfFn(d) {
  if (d <= 6) {
    const y = deckY(d) + 1.4;
    return (x) => hullHalf(x, y);
  }
  return (x) => superHalf(d, x);
}
