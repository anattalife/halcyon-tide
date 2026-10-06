// HALCYON TIDE — UI theme: palette, deck names, room categories, small DOM helpers.
import { deckY } from '../core/config.js';

export const DECK_NAMES = {
  1: 'Engineering', 2: 'Crew Quarters', 3: 'Gangway & Medical', 4: 'Atrium', 5: 'Promenade', 6: 'Nightlife',
  7: 'Staterooms', 8: 'Staterooms', 9: 'Staterooms', 10: 'Staterooms', 11: 'Staterooms', 12: 'Staterooms',
  13: 'Bridge', 14: 'Suites', 15: 'Lido', 16: 'Sun & Sports', 17: 'Zenith',
};
export const deckName = (d) => DECK_NAMES[d] || '';

// Map categories. fill = plan colour, hatch = diagonal stripe colour (crew/restricted).
export const CAT = {
  public:     { label: 'Public spaces',     fill: '#c8bea6' },
  stair:      { label: 'Stairs',            fill: '#e3d7bb' },
  stateroom:  { label: 'Staterooms',        fill: '#3d5673' },
  balcony:    { label: 'Balconies',         fill: '#516e8a' },
  dining:     { label: 'Dining & bars',     fill: '#b9844e' },
  ent:        { label: 'Entertainment',     fill: '#93587a' },
  shop:       { label: 'Shops',             fill: '#3e8c7c' },
  well:       { label: 'Spa & fitness',     fill: '#4c9db2' },
  open:       { label: 'Open deck',         fill: '#8b7458' },
  water:      { label: 'Pools',             fill: '#42c3dc' },
  crew:       { label: 'Crew only',         fill: '#273342', hatch: '#3a4a5c' },
  restricted: { label: 'Restricted',        fill: '#33252b', hatch: '#7a3b3b' },
  lift:       { label: 'Elevators',         fill: '#18212d' },
  void:       { label: 'Open to below',     fill: '#0c1826' },
};
export const LEGEND = ['public', 'stateroom', 'dining', 'ent', 'shop', 'well', 'open', 'water', 'crew', 'restricted'];

const TYPE_CAT = {
  corridor: 'public', lobby: 'public', atrium: 'public', services: 'public', medical: 'public',
  stair: 'stair', shaft: 'lift', void: 'void',
  cabin: 'stateroom', suite: 'stateroom', balcony: 'balcony',
  dining: 'dining', buffet: 'dining', bar: 'dining', pub: 'dining',
  nightclub: 'ent', casino: 'ent', theater: 'ent', gallery: 'ent', library: 'ent', lounge: 'ent', kids: 'ent',
  shop: 'shop', spa: 'well', gym: 'well',
  deck: 'open', promenade: 'open', pooldeck: 'open', sportdeck: 'open', pool: 'water',
  crew_corridor: 'crew', crew_cabin: 'crew', crew_mess: 'crew', crew_bar: 'crew', office: 'crew', service: 'crew',
  galley: 'crew', store: 'crew', laundry: 'crew', mooring: 'crew',
  engine: 'restricted', security: 'restricted', brig: 'restricted', bridge: 'restricted', officer: 'restricted', bridgewing: 'restricted',
};
export function catOf(r) {
  if (!r) return null;
  if (r.isVoid) return 'void';
  let c = TYPE_CAT[r.type] || 'public';
  if (c === 'lift' || c === 'water') return c;
  if (r.zone === 'restricted' && c !== 'stair') return 'restricted';
  if (r.zone === 'crew' && c !== 'crew') return c === 'stair' ? 'crew' : 'crew';
  return c;
}
export const CAT_KEYS = Object.keys(CAT);

// friendly room/location names
export function cleanName(name) {
  if (!name) return '';
  return String(name).replace(/\s*·\s*Deck \d+$/, '').replace(/^Deck \d+ /, '');
}

export const fmtMoney = (n) => '§' + Math.round(n || 0).toLocaleString('en-US');
export function fmtClock(hour) {
  const h = Math.floor(hour) % 24, m = Math.floor((hour - Math.floor(hour)) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
export const fmtMinOfDay = (mins) => fmtClock(((mins % 1440) + 1440) % 1440 / 60);

export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function el(tag, cls, html, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

// path-agnostic distance & deck difference text, e.g. "2 decks up · 48 m"
// Deck of a waypoint/objective target. Missing, 0, NaN or out-of-range decks (an NPC target that was not
// resolved yet, a bad mission literal) fall back to the target's y (if any) and otherwise the player's deck,
// so a same-deck target can never read "9 decks down".
export function targetDeck(t, p) {
  const d = Number(t?.deck);
  if (Number.isInteger(d) && d >= 1 && d <= 17) return d;
  if (Number.isFinite(t?.y)) return Math.max(1, Math.min(17, Math.round((t.y + 6) / 3) + 1));
  return p?.deck ?? 9;
}
// "2 decks up · 48 m": deck difference measured from the player's actual height (so it's right mid-stair
// flight, where player.deck flips half-way), horizontal distance in metres.
export function distanceHint(p, t) {
  if (!p || !t) return '';
  const dist = Math.hypot((t.x ?? p.x) - p.x, (t.z ?? p.z) - p.z);
  const td = targetDeck(t, p);
  const py = Number.isFinite(p.y) ? p.y : deckY(p.deck);
  const dd = Math.round((deckY(td) - py) / 3);
  const m = dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km';
  if (!dd) return m;
  return `${Math.abs(dd)} deck${Math.abs(dd) > 1 ? 's' : ''} ${dd > 0 ? 'up' : 'down'} · ${m}`;
}
export const targetY = (t, p) => deckY(targetDeck(t, p)) + 1.3;

// icon glyphs (inline SVG, currentColor)
export const ICON = {
  lift: '<svg viewBox="0 0 16 16"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.2l2.2 2.6H5.8zM8 11.8l2.2-2.6H5.8z" fill="currentColor"/></svg>',
  stairs: '<svg viewBox="0 0 16 16"><path d="M2 13.5h3v-3h3v-3h3v-3h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 16 16"><path d="M8 15s5-5.1 5-8.6A5 5 0 0 0 3 6.4C3 9.9 8 15 8 15z" fill="currentColor"/><circle cx="8" cy="6.3" r="1.9" fill="#0b1520"/></svg>',
  search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.4 10.4L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 1.5l2.2 8.3 8.3 2.2-8.3 2.2-2.2 8.3-2.2-8.3-8.3-2.2 8.3-2.2z" fill="currentColor"/></svg>',
  bell: '<svg viewBox="0 0 16 16"><path d="M8 1.8a4 4 0 0 0-4 4v2.6L2.6 11h10.8L12 8.4V5.8a4 4 0 0 0-4-4zM6.4 12.6a1.6 1.6 0 0 0 3.2 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  msg: '<svg viewBox="0 0 16 16"><path d="M2 3.5h12v7.5H6.5L3.5 13.5V11H2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow: '<svg viewBox="0 0 16 16"><path d="M8 1.5l5 12-5-3-5 3z" fill="currentColor"/></svg>',
  pa: '<svg viewBox="0 0 16 16"><path d="M2 6h2.5L9 2.5v11L4.5 10H2z" fill="currentColor"/><path d="M11 5.2a3.6 3.6 0 0 1 0 5.6M12.8 3.4a6 6 0 0 1 0 9.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  save: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="22 13"/></svg>',
};
