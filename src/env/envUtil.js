// Shared helpers for the living-world modules (weather, sea life, particles).
// - viewInfo(game): where is the camera? (exterior / behind a window / deep interior), cached per frame
// - waveHeight(env, x, z): CPU replica of the Gerstner swell in environment.js (vertical part only)
// - apparent wind / compass helpers
import { deckOfY, SHIP } from '../core/config.js';

const VIEW = { frame: -1, exterior: true, window: false, room: null, deck: 0, outside: 1 };

// outside: 1 = open air, 0.6 = can see out through glass, 0 = no view of the sea/sky
export function viewInfo(game) {
  if (VIEW.frame === game.frame) return VIEW;
  VIEW.frame = game.frame;
  const c = game.camera.position;
  const w = game.world;
  const d = deckOfY(c.y - 1.0);
  VIEW.deck = d;
  const room = w ? w.roomAt(d, c.x, c.z) : null;
  VIEW.room = room;
  if (!room || room.exterior || room.isVoid && !insideHullCover(game, d, c)) { VIEW.exterior = true; VIEW.window = false; VIEW.outside = 1; return VIEW; }
  VIEW.exterior = false;
  const f = room.facade;
  // rooms with windows / glass facades see out; interior rooms near the hull side with glass also count
  VIEW.window = f === 'window' || f === 'glass' || room.type === 'balcony';
  VIEW.outside = VIEW.window ? 0.6 : 0;
  return VIEW;
}
function insideHullCover(game, d, c) {
  // atrium wells (isVoid) are indoor spaces; open wells on exterior decks have exterior neighbours
  const r = game.world.roomAt(Math.max(1, d - 1), c.x, c.z);
  return !!(r && !r.exterior);
}

// ── Gerstner replica ──────────────────────────────────────────────────────
// Matches OCEAN_VS: f = k*(dot(D, (x+shipX, z)) - c*t); y += A*sin(f). Returns height above the
// mean water plane (add SHIP.waterY for ship-space y). Horizontal displacement is ignored.
export function waveHeight(env, x, z) {
  if (!env || !env.oceanU) return 0;
  const U = env.oceanU, W = U.uWaves.value, amp = U.uAmp.value, t = U.uTime.value, sx = U.uShipX.value;
  // the Gerstner surface point above (x,z) comes from an undisplaced point q with q + D(q) = (x,z):
  // two fixed-point iterations are enough for the steepness used here
  let qx = x, qz = z, y = 0;
  for (let it = 0; it < 3; it++) {
    let dx = 0, dz = 0; y = 0;
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      const len = Math.hypot(w.x, w.y) || 1;
      const ux = w.x / len, uz = w.y / len;
      const k = 6.28318 / w.z, c = Math.sqrt(9.81 / k), A = w.w * amp / k;
      const f = k * (ux * (qx + sx) + uz * qz - c * t);
      const cf = Math.cos(f);
      dx += ux * A * cf; dz += uz * A * cf; y += A * Math.sin(f);
    }
    if (it < 2) { qx = x - dx; qz = z - dz; }
  }
  return y;
}
export const WATER_Y = SHIP.waterY;

// ship speed in m/s (scenery drifts toward -X at this speed)
export function shipSpeed(game) { return SHIP.speedKnots * 0.5144 * (game.shipSpeedK ?? 1); }

const POINTS16 = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
const POINTS8S = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compassName(deg) { return POINTS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]; }
export function compassShort(deg) { return POINTS8S[Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }

// cheap deterministic hash noise (no allocations)
export function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise(t) { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; }
