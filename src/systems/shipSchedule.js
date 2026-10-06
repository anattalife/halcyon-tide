// HALCYON TIDE — the ship's daily programme ("Tides Today") and public-address voice.
//
//   installSchedule(game) → game.schedule
//
// Voyage: "Atlantic Crossing" — 7 nights, New York (Ambrose) → Southampton, eastbound at 19.5 kn.
// Voyage day = (game.day % 7) + 1. Day 1 is embarkation/sail-away (game starts 16:30), day 1 of the next
// cycle doubles as the turnaround day (disembarkation in the morning, new guests in the afternoon).
//
// API (game.schedule):
//   events                 today's events [{id, slug, name, start, end (minutes of day; end may exceed 1440),
//                          venue (room name), deck, x, z, kind, desc, dress?, restricted?, theme?, altVenue?, moved?}]
//   voyageDay              1..7 for the current game day          day(gameDay) → events for any game day
//   current()              events running now (incl. ones that started yesterday and run past midnight)
//   next(n=1)              upcoming event (or list when n > 1)
//   isOn(idOrSlugOrKind)   true if a matching event is running now
//   today()                {voyageDay, dayName, title, theme, dress, sunrise, sunset, events}
//   eventsAt(roomName)     today's events at that venue (prefix match: 'Aurora Theatre' matches all levels)
//   attendance(roomName)   0..1 crowd pull of running events at that venue (for NPC density)
//   position()             {lat, lon, distanceNm, remainingNm, course, nearest} — voyage track from the clock
//   musterStations         [{id, deck:5, x, z, side}] lifeboat stations on the deck-5 promenade
//   say(text, {prio, urgent, chime, expires})  queue a PA announcement (rate limited, see below)
//   paLog                  [{minutes, clock, text, prio}] everything that was announced
//
// Bus out: 'schedule:start' / 'schedule:end' {event}, 'announce' {text, chime}, 'alarm' {kind:'muster', on, deck:5},
//          'sfx' {name:'ship_horn', dur}, 'schedule:day' {voyageDay, theme}, 'schedule:moved' {event, from, to}
//
// PA etiquette: at most one ship-wide announcement per ~20 game minutes. prio 3 (urgent/safety) bypasses the gap,
// prio 2 (bridge noon report, Captain) needs 8 minutes of quiet, everything else 20. Stale messages expire silently.
// Venue "last call" messages are local: only voiced if the player/camera is inside that venue.
import { deckOfY } from '../core/config.js';
import { fmtClock as fmt } from '../core/util.js';

const MIN = (h, m = 0) => h * 60 + m;
const PA_GAP = 20, PA_GAP_FIXED = 8;
const DEPART_MIN = MIN(14, 0);     // sailed from New York at 14:00 on voyage day 1
const SPEED_KN = 19.5;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Names shared with the missions cast (missions/cast.js): the Captain is Rhiannon Holt, security is run by Chief Ines Okafor.
export const CREW = {
  captain: 'Captain Rhiannon Holt',
  captainShort: 'Captain Holt',
  securityChief: 'Security Chief Ines Okafor',
  securityShort: 'Chief Okafor',
  director: 'Jonah Merritt',
  officers: ['Second Officer Priya Nair', 'Chief Officer Ana Ribeiro', 'Third Officer Callum Reid', 'Staff Captain Marco Vitale'],
};

// ── voyage track ───────────────────────────────────────────────────────────
const WAYPOINTS = [
  ['Ambrose Light', 40.458, -73.830], [null, 40.40, -69.40], [null, 41.70, -50.00], ['Bishop Rock', 49.85, -6.55], [null, 50.13, -5.10], ['the Needles', 50.66, -1.65], ['Southampton', 50.895, -1.395],
];
const LANDMARKS = [
  ['Montauk Point', 41.07, -71.86], ['Nantucket', 41.28, -70.10], ['Sable Island', 43.93, -59.91], ['Cape Race, Newfoundland', 46.66, -53.07],
  ['Flores in the Azores', 39.45, -31.20], ['the Azores', 38.7, -27.2], ['Fastnet Rock', 51.39, -9.60], ["Land's End", 50.07, -5.71], ['the Isles of Scilly', 49.93, -6.30], ['Start Point', 50.22, -3.64],
];
const R_NM = 3440.065, D2R = Math.PI / 180;
function hav(a, b) { // nm between [lat,lon]
  const dLat = (b[0] - a[0]) * D2R, dLon = (b[1] - a[1]) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(s)));
}
function bearing(a, b) {
  const p1 = a[0] * D2R, p2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}
function slerp(a, b, t) {
  const p1 = a[0] * D2R, l1 = a[1] * D2R, p2 = b[0] * D2R, l2 = b[1] * D2R;
  const d = hav(a, b) / R_NM; if (d < 1e-9) return [a[0], a[1]];
  const A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return [Math.atan2(z, Math.hypot(x, y)) / D2R, Math.atan2(y, x) / D2R];
}
const LEGS = []; let ROUTE_NM = 0;
for (let i = 0; i < WAYPOINTS.length - 1; i++) { const a = WAYPOINTS[i].slice(1), b = WAYPOINTS[i + 1].slice(1); const nm = hav(a, b); LEGS.push({ a, b, nm, s0: ROUTE_NM }); ROUTE_NM += nm; }
export function trackAt(nm) {
  nm = Math.max(0, Math.min(ROUTE_NM, nm));
  const L = LEGS.find(l => nm <= l.s0 + l.nm) || LEGS[LEGS.length - 1];
  const t = (nm - L.s0) / L.nm;
  const p = slerp(L.a, L.b, t);
  const course = bearing(p, slerp(L.a, L.b, Math.min(1, t + 0.002)));
  return { lat: p[0], lon: p[1], course };
}
function fmtLat(v) { const a = Math.round(Math.abs(v) * 60) / 60, d = Math.floor(a + 1e-9), m = Math.round((a - d) * 60) % 60; return `${d} degrees ${m} minutes ${v >= 0 ? 'north' : 'south'}`; }
function fmtLon(v) { const a = Math.round(Math.abs(v) * 60) / 60, d = Math.floor(a + 1e-9), m = Math.round((a - d) * 60) % 60; return `${d} degrees ${m} minutes ${v >= 0 ? 'east' : 'west'}`; }
const P16 = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
const comp = (deg) => P16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const r10 = (v) => Math.round(v / 10) * 10;
const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const three = (deg) => String(Math.round(deg) % 360).padStart(3, '0').split('').map(c => DIG[+c]).join(' ');

// ── programme data ─────────────────────────────────────────────────────────
const THEMES = {
  1: { name: "Captain's Welcome Gala", dress: 'Formal', short: 'gala night' },
  2: { name: 'White Night', dress: 'All white', short: 'White Night' },
  3: { name: 'Celtic Night', dress: 'Smart casual', short: 'Celtic Night' },
  4: { name: 'Masquerade Ball', dress: 'Formal, masks optional', short: 'the Masquerade Ball' },
  5: { name: 'Seventies Disco', dress: 'Flares encouraged', short: 'Seventies night' },
  6: { name: 'Brit Pop Pub Night', dress: 'Smart casual', short: 'Brit Pop night' },
  7: { name: "Captain's Farewell", dress: 'Formal', short: "the Captain's Farewell" },
};
const SHOWS = {
  1: ['First Light', 'a song-and-dance welcome revue'],
  2: ['Tidelines', 'an acrobatic dance spectacle'],
  3: ["The Lighthouse Keeper's Daughter", 'our original musical'],
  4: ['Velvet & Brass', 'the great big-band songbook'],
  5: ['Saltwater Soul', 'a Motown and soul revue'],
  6: ['Northern Lights', 'aerialists and grand illusion'],
  7: ['Homeward', 'our farewell finale'],
};
const COMICS = { 1: 'Danny Ashcombe', 2: 'Priya Lal', 3: 'Marcus Bellweather', 4: 'Priya Lal', 5: 'Hattie Crane', 6: 'Marcus Bellweather', 7: 'Danny Ashcombe & friends' };
const LECTURES = { 2: 'The Gulf Stream: a river in the sea', 3: 'Fog, ice and the Grand Banks', 4: 'Reading the sky: weather at sea', 5: 'Great liners of the North Atlantic', 6: 'Navigating by the stars', 7: 'Arriving in Southampton: a port talk' };
const MOVIES = { 2: null, 3: 'Paper Boats', 4: 'The Navigator\'s Wife', 5: 'Starfall', 6: 'Two Tickets to Tangier', 7: 'A Long Way to Morning' };
const TOURN = { 2: ['Blackjack Tournament', MIN(14), MIN(16)], 3: ["Texas Hold'em Tournament", MIN(15), MIN(18)], 4: ['Slot Tournament', MIN(14), MIN(16)], 5: ['Roulette Shoot-out', MIN(15), MIN(17)], 6: ['Craps Challenge', MIN(15), MIN(17)], 7: ['Tournament of Champions Final', MIN(21), MIN(23)] };
const KIDS_THEME = { 1: 'Welcome Aboard Games', 2: 'Pirate Treasure Hunt', 3: 'Ocean Science Lab', 4: 'Stormy Night Pyjama Party', 5: 'Seventies Mini Disco', 6: 'Talent Show Rehearsal', 7: 'Kids Talent Show' };
const FITNESS_AM = { 2: 'Spin Class', 3: 'Core & Stretch', 4: 'Spin Class', 5: 'HIIT Bootcamp', 6: 'Spin Class', 7: 'Total Body Pump' };
const FITNESS_PM = { 2: 'Sunset Yoga', 3: 'Pilates', 4: 'Gentle Stretch', 5: 'Yoga Flow', 6: 'Pilates', 7: 'Sunset Yoga' };
const SPORTS = { 2: 'Pickleball Tournament', 3: '3-on-3 Basketball', 4: null, 5: 'Volleyball Challenge', 6: 'Pickleball Finals', 7: 'Crew vs Guests Basketball' };

// fallback venues for open-deck events in bad weather
const ALT = { 'Sunward Pool Deck': 'Solarium Pool', 'Forward Sun Deck': 'Tidal Fitness', 'Sports Court': 'Wavelength Arcade', 'Jogging Track': 'Tidal Fitness', 'Zenith Terrace': 'Zenith Lounge' };
const ALT_MOVIE = 'Chart Room Conference Centre';

// pull (0..1) an event of this kind exerts on its venue's crowd
const PULL = { meal: 0.85, show: 0.97, comedy: 0.9, party: 0.95, theme: 0.95, trivia: 0.6, bingo: 0.85, auction: 0.55, lecture: 0.6, music: 0.6, club: 0.9, casino: 0.7, kids: 0.8, fitness: 0.5, sports: 0.6, movie: 0.75, tour: 0.3, muster: 1, reception: 0.9, info: 0.5, games: 0.5 };

function programme(v, gameDay) {
  const E = [];
  const add = (slug, name, start, end, venue, kind, extra = {}) => E.push({ slug, name, start, end, venue, kind, ...extra });
  const th = THEMES[v];
  const show = SHOWS[v];
  const turnaround = v === 1 && gameDay >= 7;

  if (v === 1) {
    if (turnaround) {
      add('disembark', 'Disembarkation', MIN(6, 30), MIN(9, 30), 'Meridian Atrium', 'info', { desc: 'Guests leave by colour-coded luggage tag. Please vacate staterooms by 08:00.' });
      add('breakfast-buffet', 'Early Breakfast', MIN(6), MIN(9), 'Horizon Market', 'meal');
    }
    add('embark-lunch', 'Embarkation Lunch', MIN(11, 30), MIN(15), 'Horizon Market', 'meal');
    add('kids-open', "Seahorse Kids' Club Open House", MIN(14), MIN(16), "Seahorse Kids' Club", 'kids');
    add('muster-drill', 'Guest Safety Drill', MIN(16, 45), MIN(17, 10), 'Promenade Deck (Starboard)', 'muster', { desc: 'Mandatory for all guests. Seven short blasts and one long blast: go to your lifeboat station on the deck 5 promenade.' });
    add('bon-voyage', 'Bon Voyage Deck Party with DJ Coralie', MIN(17, 30), MIN(18, 45), 'Sunward Pool Deck', 'party', { open: true });
    add('dinner-main', 'Dinner — Main Seating', MIN(17, 45), MIN(19, 30), 'Coral & Compass Dining Room', 'meal', { dress: th.dress });
    add('dinner-late', 'Dinner — Late Seating', MIN(20), MIN(21, 45), 'Coral & Compass Dining Room', 'meal', { dress: th.dress });
    add('welcome-reception', "Captain's Welcome Gala Reception", MIN(19), MIN(20), 'Meridian Atrium', 'reception', { theme: true, dress: th.dress, desc: `Meet ${CREW.captain} and the senior officers; champagne toast at 19:15.` });
    add('gala-ball', 'Gala Ball with the Halcyon Orchestra', MIN(21, 30), MIN(23, 30), 'Smoke & Mirrors Lounge', 'theme', { theme: true, dress: th.dress });
  } else {
    add('sunrise-stretch', 'Sunrise Stretch', MIN(7), MIN(7, 30), 'Forward Sun Deck', 'fitness', { open: true });
    add('breakfast-buffet', 'Breakfast', MIN(6, 30), MIN(10, 30), 'Horizon Market', 'meal');
    add('breakfast-dining', 'Breakfast — Open Seating', MIN(7, 30), MIN(9, 30), 'Coral & Compass Dining Room', 'meal');
    add('fitness-am', FITNESS_AM[v], MIN(8), MIN(8, 45), 'Tidal Fitness', 'fitness');
    add('kids-am', `Seahorse Morning Session: ${KIDS_THEME[v]}`, MIN(9), MIN(12), "Seahorse Kids' Club", 'kids');
    add('walk-mile', 'Walk a Mile', MIN(9, 30), MIN(10, 15), 'Jogging Track', 'fitness', { open: true });
    add('card-bridge', 'Bridge Players Meet', MIN(10), MIN(12), 'Card Room', 'games', { desc: 'Duplicate bridge with our hosts. All levels.' });
    add('lecture', `Talk: ${LECTURES[v]}`, MIN(10), MIN(10, 45), 'Chart Room Conference Centre', 'lecture');
    add('trivia-am', 'Morning Trivia', MIN(10, 30), MIN(11, 15), 'Longitude Library', 'trivia');
    if (v === 2 || v === 5) add('bridge-tour', 'Behind the Scenes: Navigation Bridge Tour', MIN(10, 30), MIN(11, 15), 'Navigation Bridge', 'tour', { restricted: true, desc: 'Ticketed, 12 guests. Meet at Guest Services in the Meridian Atrium, deck 4. Photo ID required.' });
    if (v === 6) add('galley-tour', 'Behind the Scenes: Galley & Bridge Tour', MIN(9, 30), MIN(11), 'Navigation Bridge', 'tour', { restricted: true, desc: 'Ticketed. Meet at the Meridian Atrium, deck 4.' });
    add('lunch-buffet', 'Lunch', MIN(11, 30), MIN(14, 30), 'Horizon Market', 'meal');
    add('lunch-dining', 'Lunch — Open Seating', MIN(12), MIN(14), 'Coral & Compass Dining Room', 'meal');
    if (v === 2 || v === 5 || v === 7) add('pool-party', v === 7 ? 'Last Splash Pool Party with DJ Coralie' : 'Deck Party with DJ Coralie', MIN(13), MIN(16), 'Sunward Pool Deck', 'party', { open: true });
    if (v === 2 || v === 4 || v === 6) {
      add('art-preview', 'Art Auction Preview & Champagne', MIN(13, 15), MIN(14), 'Saltlight Gallery', 'auction');
      add('art-auction', 'Fine Art Auction', MIN(14), MIN(15, 30), 'Saltlight Gallery', 'auction');
    }
    add('kids-pm', `Seahorse Afternoon: ${KIDS_THEME[v]}`, MIN(14), MIN(17), "Seahorse Kids' Club", 'kids');
    const T = TOURN[v]; if (T) add('casino-tournament', T[0], T[1], T[2], 'The Gilded Reef Casino', 'casino');
    add('bingo', v === 7 ? 'Snowball Jackpot Bingo Final' : 'Jackpot Bingo', MIN(15), MIN(16), 'Smoke & Mirrors Lounge', 'bingo');
    add('afternoon-tea', 'Afternoon Tea with the Aurelia String Trio', MIN(15, 30), MIN(16, 30), 'The Lantern · Atrium Gallery', 'music');
    if (SPORTS[v]) add('sports', SPORTS[v], MIN(16), MIN(17), 'Sports Court', 'sports', { open: true });
    add('fitness-pm', FITNESS_PM[v], MIN(16, 30), MIN(17, 15), v === 2 || v === 7 ? 'Forward Sun Deck' : 'Tidal Fitness', 'fitness', { open: v === 2 || v === 7 });
    add('trivia-pm', v % 2 ? 'Name That Tune' : 'Pub Quiz', MIN(17), MIN(17, 45), v % 2 ? 'Longitude Library' : 'The Driftwood Arms', 'trivia');
    if (v === 3) add('captains-club', "Captain's Club Reception", MIN(17, 30), MIN(18, 30), "Captain's Club Lounge", 'reception', { restricted: true, desc: 'By invitation for returning guests.' });
    add('dinner-main', 'Dinner — Main Seating', MIN(17, 45), MIN(19, 30), 'Coral & Compass Dining Room', 'meal', { dress: th.dress });
    add('dinner-late', 'Dinner — Late Seating', MIN(20), MIN(21, 45), 'Coral & Compass Dining Room', 'meal', { dress: th.dress });
    add('sunset-jazz', 'Sunset Jazz', MIN(18, 30), MIN(20), 'Zenith Lounge', 'music');
    add('kids-eve', `Seahorse Evening: ${KIDS_THEME[v]}`, MIN(19), MIN(22), "Seahorse Kids' Club", 'kids');
    add('karaoke', 'Karaoke Night', MIN(21), MIN(23, 30), 'Karaoke Studio', 'music');
    add('pub-band', v === 3 ? 'Celtic Night with the Haar Brothers' : v === 6 ? 'Brit Pop Night with Second Hand Northern' : 'Live Music: The Bilge Rats', MIN(21), MIN(24), 'The Driftwood Arms', v === 3 || v === 6 ? 'theme' : 'music', { theme: v === 3 || v === 6, dress: th.dress });
    if (MOVIES[v]) add('movie', `Movies Under the Stars: ${MOVIES[v]}`, MIN(21, 15), MIN(23), 'Sunward Pool Deck', 'movie', { open: true, alt: ALT_MOVIE });
    if (v === 2) add('white-night', 'White Night Deck Party', MIN(22), MIN(24, 30), 'Sunward Pool Deck', 'theme', { theme: true, open: true, alt: 'The Lantern · Atrium Gallery', dress: th.dress });
    if (v === 4) {
      add('masks', 'Masquerade Masks & Photos', MIN(19), MIN(21), 'Meridian Atrium', 'info', { theme: true });
      add('masquerade', 'The Masquerade Ball', MIN(21, 30), MIN(24), 'The Lantern · Atrium Gallery', 'theme', { theme: true, dress: th.dress });
    }
    if (v === 5) add('disco', 'Seventies Disco Inferno', MIN(21, 30), MIN(23, 30), 'The Lantern · Atrium Gallery', 'theme', { theme: true, dress: th.dress });
    if (v === 7) {
      add('farewell-reception', "Captain's Farewell Reception", MIN(19), MIN(20), 'Meridian Atrium', 'reception', { theme: true, dress: th.dress, desc: `${CREW.captain} says farewell; champagne toast at 19:15.` });
      add('crew-parade', 'Farewell Crew Parade', MIN(22, 50), MIN(23, 10), 'Aurora Theatre · Orchestra', 'show');
    }
  }
  // every night
  add('steakhouse', 'Ember & Brine Steakhouse (reservations)', MIN(18), MIN(22), 'Ember & Brine Steakhouse', 'meal');
  add('grill', 'Saltgrass Grill', MIN(18), MIN(22), 'Saltgrass Grill', 'meal');
  add('show-1', `Showtime: ${show[0]}`, MIN(19, 30), MIN(20, 30), 'Aurora Theatre · Orchestra', 'show', { desc: show[1] });
  add('show-2', `Showtime: ${show[0]}`, MIN(21, 45), MIN(22, 45), 'Aurora Theatre · Orchestra', 'show', { desc: show[1] });
  add('comedy-1', `Comedy: ${COMICS[v]}`, MIN(20, 30), MIN(21, 30), 'The Laughing Gull', 'comedy');
  add('comedy-2', `Late Laughs (adults only): ${COMICS[v]}`, MIN(22, 30), MIN(23, 30), 'The Laughing Gull', 'comedy');
  add('piano-bar', 'Piano Bar with Leo Marchetti', MIN(20), MIN(24, 30), 'Ivory Keys Lounge', 'music');
  add('lantern', 'The Lantern: cocktails & live strings', MIN(18), MIN(25), 'The Lantern · Atrium Gallery', 'music');
  add('late-jazz', 'Late Night Jazz', MIN(22, 30), MIN(25), 'Zenith Lounge', 'music');
  add('club', 'Undertow Club', MIN(22, 30), MIN(27), 'Undertow Club', 'club', { desc: v === 5 ? 'Seventies after-party' : 'DJ until late. 18+.' });
  add('casino-tables', 'Casino tables open', v === 1 ? MIN(18) : MIN(10), MIN(27), 'The Gilded Reef Casino', 'casino', { minor: true });
  E.sort((a, b) => a.start - b.start);
  return E;
}

// ── install ───────────────────────────────────────────────────────────────
export function installSchedule(game) {
  const S = new ShipSchedule(game);
  game.schedule = S;
  game.addSystem({ name: 'schedule', order: 12, update: (dt) => S.update(dt) });
  return S;
}

class ShipSchedule {
  constructor(game) {
    this.game = game;
    this.paLog = [];
    this.queue = [];
    this.lastPA = -1e9;
    this.cache = new Map();          // gameDay → events
    this.state = new Map();          // event id → 0 pending, 1 running, 2 done
    this.paDone = new Set();
    this.lastMinutes = null;
    this.curDay = -1;
    this._venues = this._indexVenues();
    this.musterStations = this._musterStations();
    this.ROUTE_NM = ROUTE_NM;
    this.CREW = CREW;
    this.THEMES = THEMES;
  }

  // ── venues ──────────────────────────────────────────────────────────────
  _indexVenues() {
    const map = new Map();
    const plans = this.game.world?.plans || this.game.layout?.plans || [];
    for (let d = 1; d < plans.length; d++) {
      const p = plans[d]; if (!p) continue;
      for (const r of p.rooms) {
        if (!r || !r.name || r.isVoid) continue;
        const prev = map.get(r.name);
        if (!prev || (r.cells || 0) > (prev.cells || 0)) map.set(r.name, { deck: d, x: r.cx, z: r.cz, cells: r.cells || 0, exterior: !!r.exterior, room: r });
      }
    }
    return map;
  }
  venue(name) { return this._venues.get(name) || null; }
  _musterStations() {
    const xs = []; for (let x = -118; x <= 82; x += 12.5) { if (Math.abs(x - -10) < 9) continue; xs.push(x); }
    const out = []; let k = 0;
    for (const x of xs) for (const s of [1, -1]) { out.push({ id: String.fromCharCode(65 + Math.floor(k / 2)) + (s > 0 ? 'S' : 'P'), deck: 5, x, z: s * 19.3, side: s > 0 ? 'starboard' : 'port', boat: k }); k++; }
    return out;
  }

  // ── programme ───────────────────────────────────────────────────────────
  voyageDayOf(gameDay) { return ((gameDay % 7) + 7) % 7 + 1; }
  get voyageDay() { return this.voyageDayOf(this.game.day); }
  day(gameDay) {
    let ev = this.cache.get(gameDay);
    if (ev) return ev;
    const v = this.voyageDayOf(gameDay);
    ev = programme(v, gameDay).map(e => {
      const vn = this.venue(e.venue);
      return { id: `d${gameDay}-${e.slug}`, day: gameDay, voyageDay: v, ...e, plannedVenue: e.venue, deck: vn ? vn.deck : null, x: vn ? vn.x : null, z: vn ? vn.z : null, altVenue: e.alt || (e.open ? ALT[e.venue] : null), moved: false };
    });
    if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(gameDay, ev);
    return ev;
  }
  get events() { return this.day(this.game.day); }
  abs(e) { return e.day * 1440; }
  _running(e, now) { const b = e.day * 1440; return now >= b + e.start && now < b + e.end; }
  current() {
    const now = this.game.minutes, d = this.game.day, out = [];
    for (const dd of [d - 1, d]) if (dd >= 0) for (const e of this.day(dd)) if (this._running(e, now)) out.push(e);
    return out;
  }
  next(n = 1) {
    const now = this.game.minutes, d = this.game.day, out = [];
    for (const dd of [d, d + 1]) for (const e of this.day(dd)) if (!e.minor && dd * 1440 + e.start > now) out.push(e);
    return n === 1 ? out[0] || null : out.slice(0, n);
  }
  isOn(key) { return this.current().some(e => e.id === key || e.slug === key || e.kind === key); }
  eventsAt(roomName) {
    if (!roomName) return [];
    const base = String(roomName).split(' · ')[0];
    return this.events.filter(e => e.venue === roomName || e.venue.startsWith(base));
  }
  attendance(roomName) {
    if (!roomName) return 0;
    const base = String(roomName).split(' · ')[0];
    let v = 0;
    for (const e of this.current()) if (e.venue === roomName || e.venue.startsWith(base)) v = Math.max(v, PULL[e.kind] ?? 0.5);
    return v;
  }
  today() {
    const g = this.game, v = this.voyageDay, th = THEMES[v];
    return {
      voyageDay: v, gameDay: g.day, dayName: DAY_NAMES[g.day % 7], title: v === 1 ? (g.day >= 7 ? 'Southampton · New York turnaround' : 'New York · Sail-away') : `Day ${v} · At sea · Atlantic Crossing`,
      theme: th.name, dress: th.dress, sunrise: '06:36', sunset: '19:36', events: this.events,
    };
  }

  // ── voyage position ─────────────────────────────────────────────────────
  position(minutes = this.game.minutes) {
    const gd = Math.floor(minutes / 1440);
    const v = this.voyageDayOf(gd);
    const voyStart = (gd - (v - 1)) * 1440 + DEPART_MIN;
    let el = (minutes - voyStart) / 60;
    let alongside = false;
    if (el < 0) { el = ROUTE_NM / SPEED_KN + 1; alongside = true; }           // turnaround morning: still alongside in Southampton
    const nm = Math.min(ROUTE_NM, el * SPEED_KN);
    if (nm >= ROUTE_NM) alongside = true;
    const p = trackAt(nm);
    let best = null, bd = 1e9;
    for (const L of LANDMARKS) { const d = hav([p.lat, p.lon], [L[1], L[2]]); if (d < bd) { bd = d; best = L; } }
    return { lat: p.lat, lon: p.lon, course: p.course, distanceNm: nm, remainingNm: ROUTE_NM - nm, alongside, nearest: best ? { name: best[0], nm: bd, bearingFrom: bearing([best[1], best[2]], [p.lat, p.lon]) } : null };
  }

  // ── PA ──────────────────────────────────────────────────────────────────
  say(text, opts = {}) {
    const prio = opts.urgent ? 3 : (opts.prio ?? 1);
    this.queue.push({ at: this.game.minutes, text, prio, chime: opts.chime !== false, expires: opts.expires ?? (prio >= 3 ? 30 : 40), key: opts.key });
  }
  _emitPA(item, now) {
    const text = typeof item.text === 'function' ? item.text() : item.text;
    if (!text) return;
    this.lastPA = now;
    this.paLog.push({ minutes: now, clock: fmt(now), text, prio: item.prio });
    if (this.paLog.length > 400) this.paLog.shift();
    this.game.bus.emit('announce', { text, chime: item.chime !== false, source: 'schedule', prio: item.prio });
  }
  _sayLocal(venueName, text) {
    // in-venue message (bar last call etc.): only if the player (or debug camera) is in that venue
    const g = this.game, p = g.player;
    let room = null;
    if (p && !g.debugCam && p.room) room = p.room;
    else if (g.world) { const c = g.camera.position; room = g.world.roomAt(deckOfY(c.y - 1), c.x, c.z); }
    if (!room || !room.name || !room.name.startsWith(venueName.split(' · ')[0])) return;
    this.paLog.push({ minutes: g.minutes, clock: fmt(g.minutes), text: `[${venueName}] ${text}`, prio: 0, local: true });
    g.bus.emit('announce', { text, chime: false, local: true, venue: venueName, source: 'schedule' });
  }

  // fixed daily PA plan: [minuteOfDay, key, prio, textFn, expires]
  _paPlan(gd) {
    const v = this.voyageDayOf(gd), th = THEMES[v], show = SHOWS[v], ev = this.day(gd);
    const find = (slug) => ev.find(e => e.slug === slug);
    const P = [];
    const at = (m, key, prio, fn, exp = 25) => P.push({ m, key: `d${gd}-${key}`, prio, fn, exp });
    if (v === 1) {
      if (gd >= 7) at(MIN(7, 0), 'disembark', 2, () => `Good morning and welcome to Southampton. Disembarkation is now under way by luggage tag colour. Please listen for your colour and have your cruise card ready. Thank you for sailing with us.`, 30);
      at(MIN(16, 32), 'muster-warn', 3, () => `Ladies and gentlemen, in fifteen minutes we will hold the mandatory guest safety drill. When you hear seven short blasts and one long blast, please make your way to your lifeboat station on the deck five promenade.`, 10);
      at(MIN(16, 44), 'muster-pre', 3, () => `This is ${CREW.captain}. In a moment you will hear the general emergency signal. This is a drill, and only a drill.`, 3);
      at(MIN(17, 8), 'muster-end', 3, () => `Thank you, everyone. That concludes our safety drill. The bars are open and the Bon Voyage party starts on the Sunward Pool Deck at half past five.`, 10);
      at(MIN(18, 20), 'captain-welcome', 2, () => this._captainUpdate(gd), 40);
      at(MIN(19, 5), 'gala-call', 1, () => `Good evening. The Captain's Welcome Gala reception is beginning in the Meridian Atrium on deck four. Black tie, sparkling wine and the senior officers await.`, 15);
    } else {
      at(MIN(8, 45), 'good-morning', 1, () => this._goodMorning(gd), 40);
      at(MIN(12, 0), 'noon', 2, () => this._noonReport(), 15);
      at(MIN(17, 40), 'captain', 2, () => this._captainUpdate(gd), 45);
      const art = find('art-auction'); if (art) at(art.start - 15, 'art', 1, () => `The fine art auction begins in fifteen minutes in the Saltlight Gallery on deck four. Champagne is being poured at the preview now.`, 12);
      const bingo = find('bingo'); if (bingo) at(bingo.start - 15, 'bingo', 1, () => v === 7 ? `Last chance for the snowball jackpot! Bingo cards are on sale now in the Smoke and Mirrors Lounge, deck six. Eyes down at three.` : `Bingo cards are on sale now in the Smoke and Mirrors Lounge on deck six. Eyes down at three o'clock.`, 12);
      const pool = find('pool-party'); if (pool) at(pool.start + 2, 'pool', 1, () => pool.moved ? `With the weather as it is, our deck party has moved indoors to the Solarium Pool on deck fifteen. DJ Coralie is warming up.` : `DJ Coralie is on the decks! The party has started at the Sunward Pool on deck fifteen.`, 20);
      const tour = find('casino-tournament'); if (tour && v === 7) at(tour.start - 15, 'casino', 1, () => `The ${tour.name} begins at nine in the Gilded Reef Casino, deck five. Good luck to all our finalists.`, 12);
      const movie = find('movie'); if (movie) at(movie.start - 10, 'movie', 1, () => movie.moved ? `Tonight's film, ${MOVIES[v]}, will now be shown in the Chart Room Conference Centre on deck four because of the weather.` : `Tonight's Movie Under the Stars, ${MOVIES[v]}, starts shortly on the Sunward Pool Deck. Blankets and popcorn are by the screen.`, 12);
      if (v === 2) at(MIN(21, 50), 'white', 1, () => (find('white-night')?.moved ? `The White Night party has moved to The Lantern on deck six. Dress in your finest white.` : `The White Night deck party is about to begin on the Sunward Pool Deck. Dress in your finest white and join us under the stars.`), 15);
      if (v === 4) at(MIN(21, 20), 'masq', 1, () => `The Masquerade Ball begins at half past nine at The Lantern, deck six. Masks are still available in the Meridian Atrium.`, 15);
      if (v === 5) at(MIN(21, 20), 'disco', 1, () => `Dig out those flares! Seventies Disco Inferno starts at half past nine at The Lantern, deck six.`, 15);
      if (v === 7) at(MIN(19, 5), 'farewell', 1, () => `The Captain's Farewell reception is under way in the Meridian Atrium on deck four. Please join us.`, 15);
    }
    at(MIN(19, 12), 'show', 1, () => `Tonight in the Aurora Theatre: ${show[0]}, ${show[1]}. Doors are open for the half past seven performance.`, 12);
    return P;
  }

  _weatherState() { return this.game.weather?.state || null; }
  _goodMorning(gd) {
    const v = this.voyageDayOf(gd), th = THEMES[v];
    const ev = this.day(gd);
    const pick = [];
    const want = ['trivia-am', 'bridge-tour', 'pool-party', 'art-auction', 'casino-tournament', 'bingo'];
    for (const s of want) { const e = ev.find(x => x.slug === s); if (e && pick.length < 2) pick.push(e); }
    const t = (e) => { const h = Math.floor(e.start / 60), m = e.start % 60; const hh = ((h + 11) % 12) + 1; return m ? `${hh}:${String(m).padStart(2, '0')}` : `${hh} o'clock`; };
    const what = pick.map(e => `${e.name.replace(/^Behind the Scenes: /, 'the ').replace(/ with DJ Coralie/, '')} at ${t(e)}`).join(', and ');
    const ws = this._weatherState();
    const wx = !ws ? '' : ws.rain > 0.5 || ws.storm > 0.4 ? ' It is a lively one outside, so hold on to the handrails.' : ws.fog > 0.3 ? ' A little fog this morning, so you may hear our whistle.' : ws.cloud < 0.4 ? ' The sun is out, so do slap on the sunscreen.' : '';
    const greet = ['Good morning, Halcyon Tide!', 'Good morning, everyone!', 'Good morning, good morning!'][gd % 3];
    return `${greet} ${CREW.director} here, your cruise director. It's day ${v} of our crossing.${wx} Today we have ${what}. Tonight is ${th.short}, dress code ${th.dress.toLowerCase()}.`;
  }
  _noonReport() {
    const g = this.game, p = this.position(), w = this._weatherState();
    const off = CREW.officers[g.day % CREW.officers.length];
    if (p.alongside) return `Good afternoon from the bridge. We are alongside in Southampton. Thank you.`;
    const near = p.nearest;
    const where = near && near.nm < 900 ? `, some ${r10(near.nm)} nautical miles ${comp(near.bearingFrom)} of ${near.name}` : ', in the middle of the North Atlantic';
    let wx = '';
    if (w) {
      wx = ` The wind is ${comp(w.windDir)}, force ${w.beaufort}, with a ${w.seaState} sea and a ${w.swellM.toFixed(1)} metre swell. Air temperature ${Math.round(w.airTempC)} degrees, sea ${Math.round(w.seaTempC)}.`;
      const f = g.weather.forecast?.();
      if (f && f.summary) wx += ` ${f.summary}`;
    }
    return `Good afternoon, this is ${off} on the bridge with the noon report. Our position is ${fmtLat(p.lat)}, ${fmtLon(p.lon)}${where}. Since New York we have sailed ${Math.round(p.distanceNm).toLocaleString('en-US')} nautical miles, with ${Math.round(p.remainingNm).toLocaleString('en-US')} to go. Course ${three(p.course)}, speed ${SPEED_KN} knots.${wx} In a moment, our daily test of the ship's whistle.`;
  }
  _captainUpdate(gd) {
    const v = this.voyageDayOf(gd), th = THEMES[v];
    const f = this.game.weather?.forecast?.();
    const tonight = f?.tonight || 'a quiet night at sea';
    const clocks = '';
    if (v === 1) return `Good evening, this is ${CREW.captain} from the bridge. Welcome aboard Halcyon Tide. We cleared the Ambrose Channel this afternoon and are now heading east for Southampton, ${Math.round(ROUTE_NM).toLocaleString('en-US')} nautical miles away. Tonight we expect ${tonight}.${clocks} I look forward to meeting you at the Welcome Gala.`;
    if (v === 7) return `Good evening, ${CREW.captain} here. We will pass the Needles at first light and be alongside in Southampton by seven. Tonight, ${tonight}. Thank you for sailing with us. It has been a pleasure.`;
    const extra = v === 3 ? ' We are passing south of the Grand Banks, so expect fog at times.' : v === 4 ? ' The worst of the weather is behind us now.' : v === 6 ? ' Tomorrow morning we will be in the Western Approaches.' : '';
    return `Good evening, this is ${CREW.captainShort} with a short update from the bridge. For tonight, ${tonight}.${extra}${clocks} Enjoy ${th.short}.`;
  }
  _lastCalls(gd) {
    // [minute, venue, text]
    return [
      [MIN(24, 45), 'The Lantern · Atrium Gallery', 'Ladies and gentlemen, last call at The Lantern. The bar closes in fifteen minutes.'],
      [MIN(24, 45), 'Zenith Lounge', 'Last orders at the Zenith Lounge, please. Thank you for a lovely evening.'],
      [MIN(24, 15), 'Ivory Keys Lounge', "Last call at the piano bar. Leo's taking his final requests."],
      [MIN(23, 45), 'The Driftwood Arms', 'Time, ladies and gentlemen! Last orders at the bar, please.'],
      [MIN(26, 45), 'Undertow Club', 'Last call at the Undertow. Fifteen minutes to closing.'],
    ];
  }

  // ── tick ────────────────────────────────────────────────────────────────
  update() {
    const g = this.game, now = g.minutes, gd = g.day;
    const jumped = this.lastMinutes == null || Math.abs(now - this.lastMinutes) > 30;
    if (gd !== this.curDay) { this.curDay = gd; g.bus.emit('schedule:day', { voyageDay: this.voyageDay, theme: THEMES[this.voyageDay].name }); }
    // events start/end
    for (const dd of [gd - 1, gd]) {
      if (dd < 0) continue;
      for (const e of this.day(dd)) {
        const st = this.state.get(e.id) || 0;
        const b = dd * 1440, run = now >= b + e.start && now < b + e.end, done = now >= b + e.end;
        if (st === 0 && run) {
          this.state.set(e.id, 1);
          this._startEvent(e, jumped);
        } else if (st === 1 && !run) {
          this.state.set(e.id, 2);
          this._endEvent(e, jumped);
        } else if (st === 0 && done) this.state.set(e.id, 2);
      }
    }
    // planned PAs
    for (const dd of [gd - 1, gd]) {
      if (dd < 0) continue;
      for (const p of this._paPlan(dd)) {
        if (this.paDone.has(p.key)) continue;
        const t = dd * 1440 + p.m;
        if (now < t) continue;
        this.paDone.add(p.key);
        if (jumped || now - t > p.exp) continue;            // stale (time skip): drop
        this.queue.push({ at: t, text: p.fn, prio: p.prio, chime: true, expires: p.exp, key: p.key });
        if (p.key.endsWith('-noon')) this.queue.push({ at: t + 2.2, horn: true, prio: 2, expires: 6, key: p.key + '-horn' });
      }
      for (const [m, venue, text] of this._lastCalls(dd)) {
        const key = `d${dd}-lc-${venue}`;
        if (this.paDone.has(key)) continue;
        const t = dd * 1440 + m;
        if (now < t) continue;
        this.paDone.add(key);
        if (!jumped && now - t < 5) this._sayLocal(venue, text);
      }
    }
    if (this.paDone.size > 600) this.paDone = new Set([...this.paDone].slice(-300));
    // queue processing
    if (this.queue.length) {
      let best = -1;
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const q = this.queue[i];
        if (now - q.at > q.expires) { this.queue.splice(i, 1); continue; }
        if (q.at > now) continue;
        if (best < 0 || q.prio > this.queue[best].prio || (q.prio === this.queue[best].prio && q.at < this.queue[best].at)) best = i;
      }
      if (best >= 0) {
        const q = this.queue[best];
        if (q.horn) { this.queue.splice(best, 1); if (!this.isOn('muster')) g.bus.emit('sfx', { name: 'ship_horn', dur: 2.6, x: -111, y: 58, z: 0, vol: 0.9 }); }
        else {
          const gap = q.prio >= 3 ? 0 : q.prio === 2 ? PA_GAP_FIXED : PA_GAP;
          if (now - this.lastPA >= gap) { this.queue.splice(best, 1); this._emitPA(q, now); }
        }
      }
    }
    this.lastMinutes = now;
  }

  _startEvent(e, silent) {
    const g = this.game;
    // open-deck events move indoors in bad weather
    if (e.altVenue && !e.moved) {
      const w = this._weatherState();
      if (w && (w.rain > 0.35 || w.storm > 0.3 || w.windKnots > 32)) {
        const from = e.venue; e.venue = e.altVenue; e.moved = true;
        const vn = this.venue(e.venue); if (vn) { e.deck = vn.deck; e.x = vn.x; e.z = vn.z; }
        g.bus.emit('schedule:moved', { event: e, from, to: e.venue });
      }
    }
    if (e.kind === 'muster' && !silent) g.bus.emit('alarm', { kind: 'muster', on: true, deck: 5, drill: true });
    g.bus.emit('schedule:start', { event: e });
  }
  _endEvent(e, silent) {
    const g = this.game;
    if (e.kind === 'muster') g.bus.emit('alarm', { kind: 'muster', on: false, deck: 5, drill: true });
    g.bus.emit('schedule:end', { event: e });
  }

  // debug: full text programme for a game day
  printDay(gd = this.game.day) {
    return this.day(gd).filter(e => !e.minor).map(e => `${fmt(e.start)}–${fmt(e.end)}  ${e.name}  ·  ${e.venue} (deck ${e.deck ?? '?'})${e.restricted ? ' [restricted]' : ''}`).join('\n');
  }
}
