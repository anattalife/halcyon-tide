// HALCYON TIDE — the ship's daily rhythm.
// Pure functions of (room, hour): how full a venue is, whether staff are on duty, what people wear,
// which animation a worker plays. Used by population.js (targets) and npcs.js (behaviour).

const wrap = (h) => ((h % 24) + 24) % 24;
// smooth window membership: 1 inside [a,b], ramps over `r` hours at each end (supports b < a for overnight)
export function win(h, a, b, r = 0.35) {
  h = wrap(h);
  if (b < a) return Math.max(win(h, a, 24 + r, r), win(h + 24, a, b + 24, r), win(h, -r - 1, b, r));
  if (h < a - r || h > b + r) return 0;
  if (h < a) return (h - (a - r)) / r;
  if (h > b) return 1 - (h - b) / r;
  return 1;
}
const wins = (h, list, r) => { let v = 0; for (const [a, b, k = 1] of list) v = Math.max(v, win(h, a, b, r) * k); return v; };
// 24-entry curve lookup with linear interpolation
export function curve(arr, h) { h = wrap(h); const i = Math.floor(h), f = h - i; return arr[i] + (arr[(i + 1) % 24] - arr[i]) * f; }

//                    0    1    2    3    4    5    6    7    8    9    10   11   12   13   14   15   16   17   18   19   20   21   22   23
const DAY =         [.22, .12, .05, .03, .02, .03, .12, .45, .75, .9,  1,   1,   1,   .95, .9,  .9,  .9,  .95, 1,   .95, .9,  .8,  .6,  .38];
const CREWDAY =     [.5,  .35, .25, .2,  .2,  .35, .7,  1,   .8,  .65, .6,  .7,  .9,  .7,  .6,  .6,  .65, .8,  .95, .8,  .7,  .7,  .7,  .75];
const NIGHTLIFE =   [.95, .85, .62, .32, .1,  0,   0,   0,   0,   0,   0,   .02, .05, .05, .05, .05, .05, .08, .15, .3,  .5,  .75, 1,   .95];
const BARS =        [.7,  .55, .35, .16, .04,   0,   0,   0,   0,   .02, .05, .15, .3,  .3,  .25, .25, .3,  .45, .65, .75, .8,  .9,  1,   .85];
const CASINO =      [.9,  .75, .52, .28, .06,   0,   0,   0,   0,   0,   .1,  .2,  .25, .3,  .35, .35, .35, .4,  .5,  .6,  .75, .95, 1,   .95];
const POOL =        [0,   0,   0,   0,   0,   0,   0,   .05, .2,  .45, .7,  .9,  1,   1,   1,   .95, .8,  .55, .3,  .12, .05, .03, .02, 0];
const SWIM =        [0,   0,   0,   0,   0,   0,   0,   .05, .25, .5,  .7,  .85, 1,   1,   1,   1,   .85, .6,  .3,  .1,  0,   0,   0,   0];
const DECK =        [.08, .04, .02, .01, .01, .03, .15, .35, .5,  .6,  .7,  .8,  .85, .85, .85, .9,  .9,  1,   .95, .7,  .5,  .35, .25, .15];
const SHOPS =       [0,   0,   0,   0,   0,   0,   0,   0,   0,   .3,  .55, .7,  .6,  .6,  .7,  .85, .9,  .8,  .55, .6,  .85, 1,   .7,  0];
// people walking back to their cabins from the bars / club / casino (and early risers at 5–6)
const REVEL =       [1,   .95, .8,  .6,  .35, .2,  .25,  .1,  0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   .1,  .4,  .8];
// couples at the rails / night strollers on open decks
const NIGHTDECK =   [.7,  .5,  .3,  .2,  .1,  .05, 0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   .3,  .7,  1,   1,   .9];
const LOUNGE =      [.2,  .12, .06, .03,   0,   0,   .05, .2,  .35, .5,  .6,  .6,  .5,  .55, .65, .7,  .7,  .6,  .45, .55, .65, .6,  .45, .3];

export const MEALS = { breakfast: [7, 10], lunch: [12, 14], dinner: [18, 21] };
export const SHOWS = [[19.5, 20.5], [21.75, 22.75]];

// Seat occupancy (fraction of passenger POIs) and standing density (people / m²) for a room at hour h.
export function occupancy(room, h) {
  const v = room.venue, dens = room.dens;
  let seat = 0, stand = 0;
  switch (dens) {
    case 'transit': {
      // meal & show changeovers make the corridors surge
      const surge = Math.max(win(h, 7.2, 8.2, 0.3), win(h, 11.8, 12.5, 0.3), win(h, 17.6, 18.4, 0.3), win(h, 20.5, 21, 0.25), win(h, 22.75, 23.2, 0.25));
      stand = (room.deck >= 7 && room.deck <= 14 ? 0.085 : 0.06) * (curve(DAY, h) + 0.35 * surge) + (room.deck >= 7 && room.deck <= 14 ? 0.03 : 0.012) * curve(REVEL, h);
      break;
    }
    case 'shopstreet': stand = 0.12 * curve(SHOPS, h) + 0.03 * curve(DAY, h); break;
    case 'atrium': stand = 0.06 * curve(DAY, h) + 0.012 * curve(REVEL, h); seat = 0.5 * curve(LOUNGE, h) + 0.08 * curve(REVEL, h); break;
    case 'dining': {
      if (v === 'steak') seat = 0.8 * win(h, 18, 22.2, 0.4);
      else if (v === 'grill') seat = Math.max(0.55 * win(h, 12, 14), 0.8 * win(h, 18, 22, 0.4));
      else seat = Math.max(0.35 * win(h, ...MEALS.breakfast), 0.4 * win(h, ...MEALS.lunch), 0.82 * win(h, 17.8, 21.6, 0.4));
      stand = seat * 0.006; break;
    }
    case 'buffet': seat = Math.max(0.6 * win(h, 6.5, 10.5), 0.7 * win(h, 11.5, 14.5), 0.45 * win(h, 17.5, 21), 0.1 * win(h, 21, 24)); stand = 0.04 * seat + 0.005; break;
    case 'bar': {
      let k = curve(BARS, h);
      if (v === 'piano') k *= h >= 18 || h < 1 ? 1.15 : 0.6;
      if (v === 'comedy') k = win(h, 20, 24.5) * 0.9 + 0.05;
      if (v === 'lantern' || room.type === 'atrium') k = Math.max(k, 0.35 * curve(DAY, h));
      if (v === 'wakebar') k = Math.max(k, 0.6 * curve(POOL, h));
      seat = 0.75 * k; stand = 0.05 * k; break;
    }
    case 'club': { const k = curve(NIGHTLIFE, h); seat = 0.6 * k; stand = 0.22 * k; break; }
    case 'casino': { const k = curve(CASINO, h); seat = 0.7 * k; stand = 0.045 * k; break; }
    case 'theater': {
      const show = wins(h, SHOWS, 0.05);
      const pre = wins(h, [[19.0, 19.5], [21.25, 21.75]], 0.25) * 0.75;
      seat = Math.max(0.9 * show, pre, 0.015); stand = 0.004 + 0.02 * pre; break;
    }
    case 'shop': stand = 0.09 * curve(SHOPS, h); break;
    case 'lounge': { const k = curve(LOUNGE, h); seat = 0.35 * k; stand = 0.015 * k; if (v === 'cigar' || v === 'zenith') { seat = 0.55 * curve(BARS, h); stand = 0.03 * curve(BARS, h); } break; }
    case 'pool': { const k = curve(POOL, h); seat = 0.65 * k; stand = 0.025 * k + 0.004 * curve(DECK, h) + 0.0035 * curve(NIGHTDECK, h); break; }
    case 'swim': stand = 0.11 * curve(SWIM, h); break;
    case 'deck': { const k = v === 'wakebar' ? Math.max(curve(DECK, h), 0.8 * curve(BARS, h)) : curve(DECK, h); seat = 0.35 * k * (isNight(h) ? 0.25 : 1); stand = 0.022 * k + 0.003 * curve(NIGHTDECK, h); break; }
    case 'promenade': { const k = curve(DECK, h); seat = 0.3 * k * (isNight(h) ? 0.3 : 1); stand = 0.03 * k + 0.004 * curve(NIGHTDECK, h); break; }
    case 'sport': stand = 0.03 * win(h, 8, 20); seat = 0.25 * curve(DECK, h); break;
    case 'spa': seat = 0.4 * win(h, 8, 21); stand = 0.02 * win(h, 8, 21); if (v === 'solarium') { seat = 0.5 * curve(POOL, h) + 0.1; stand = 0.03 * win(h, 7, 22); } break;
    case 'gym': seat = 0.45 * Math.max(win(h, 6.5, 10), 0.6 * win(h, 10, 20)); stand = 0.02 * win(h, 6, 22); break;
    case 'kids': stand = 0.12 * win(h, 8.5, 21.5); break;
    case 'medical': stand = 0.01 * win(h, 8, 20); seat = 0.2 * win(h, 8, 20); break;
    // crew
    case 'crewtransit': { const shift = Math.max(win(h, 6.5, 8.3, 0.3), win(h, 11.6, 12.4, 0.3), win(h, 17.6, 18.6, 0.3), win(h, 23.6, 24.3, 0.3)); stand = 0.05 * curve(CREWDAY, h) + 0.06 * shift; break; }
    case 'crewmess': seat = Math.max(0.5 * win(h, 6, 9), 0.6 * win(h, 11, 14), 0.55 * win(h, 17, 20), 0.25 * win(h, 23, 1)); stand = 0.01; break;
    case 'crewbar': seat = 0.6 * Math.max(win(h, 19, 26), win(h, 0, 2.5)); stand = 0.06 * win(h, 20, 26); break;
    case 'galley': stand = 0.02 * win(h, 5.5, 22.5); break;
    case 'laundry': stand = 0.01 * win(h, 6, 22); break;
    case 'office': case 'security': seat = 0.3 * win(h, 8, 18); stand = 0.004; break;
    case 'engine': stand = 0.002; break;
    default: break;
  }
  return { seat: Math.min(1, seat), stand };
}

export const isNight = (h) => { h = wrap(h); return h >= 20 || h < 6.5; };
// Is the venue effectively closed / dead at hour h (nobody should stay)?
export function venueClosed(room, h, att = 0) {
  if (att > 0.05) return false;
  const o = occupancy(room, h);
  return o.seat < 0.03 && o.stand < 0.0015;
}
// Does an activity at this POI still fit the hour / weather?  (sunbathing at night or in the rain does not)
export function activityFits(poi, room, h, wx) {
  if (!poi) return true;
  const ext = room && room.exterior;
  const rain = wx ? (wx.rain || 0) : 0, shelter = wx ? !!wx.shelter : false;
  if (ext && shelter) return false;
  const act = poi.act;
  if (act === 'sunbathe' || (poi.pose === 'lie' && ext)) { if (isNight(h) || h >= 19 || rain > 0.12) return false; }
  if (act === 'swim' && ext) { if (h >= 20 || h < 7 || rain > 0.25) return false; }
  if (act === 'soak' && ext && rain > 0.35) return false;
  if (ext && poi.pose === 'sit' && rain > 0.2) return false;
  return true;
}

// Is the room's staff POI of `role` manned at hour h?
export function staffOn(room, role, h) {
  const v = room.venue, dens = room.dens;
  switch (role) {
    case 'guard': return true;
    case 'helmsman': case 'officer': return room.dens === 'bridge' || room.dens === 'security' || room.dens === 'engine' ? true : win(h, 7, 22) > 0;
    case 'engineer': return true;
    case 'nurse': return true;
    case 'pianist': return v === 'piano' ? win(h, 17.5, 24.5) > 0 : win(h, 11, 13) > 0 || win(h, 16, 23) > 0;
    case 'dj': return win(h, 21, 27) > 0 || win(h, 0, 2.8) > 0;
    case 'dealer': return curve(CASINO, h) > 0.08;
    case 'cashier': return curve(CASINO, h) > 0.05;
    case 'cook': return dens === 'crewmess' || room.type === 'crew_mess' ? win(h, 5, 24) > 0 : (dens === 'galley' ? win(h, 5.5, 22.8) > 0 : win(h, 7, 20) > 0);
    case 'laundry': return win(h, 6, 22) > 0;
    case 'crew_bartender': return win(h, 18, 26) > 0 || win(h, 0, 2.5) > 0;
    case 'bartender': {
      if (dens === 'club') return curve(NIGHTLIFE, h) > 0.08;
      if (dens === 'pool' || room.exterior) return win(h, 9, 21) > 0;
      if (v === 'lantern' || room.type === 'atrium') return win(h, 10, 25) > 0;
      return curve(BARS, h) > 0.08 || win(h, 11, 24.5) > 0;
    }
    case 'clerk': {
      if (dens === 'shop' || room.shop) return curve(SHOPS, h) > 0.05;
      if (dens === 'spa') return win(h, 8, 21) > 0;
      if (dens === 'atrium' || room.type === 'services') return win(h, 7, 23) > 0;
      if (dens === 'crewtransit' || room.zone === 'crew') return win(h, 7, 21) > 0;
      return win(h, 8, 20) > 0;
    }
    case 'host': return win(h, 7, 22) > 0;
    default: return win(h, 8, 20) > 0;
  }
}

// Appearance role for a staff POI role / crew job
export const ROLE_LOOK = {
  bartender: 'crew_bartender', crew_bartender: 'crew_bartender', clerk: 'crew_steward', dealer: 'croupier', cashier: 'croupier', cook: 'crew_chef',
  officer: 'crew_officer', helmsman: 'crew_officer', guard: 'security', nurse: 'medic', laundry: 'crew_housekeeping', engineer: 'crew_engineer',
  dj: 'entertainer', pianist: 'entertainer', host: 'crew_steward',
  patrol: 'security', steward: 'crew_housekeeping', waiter: 'crew_waiter', deckhand: 'crew_deckhand', lifeguard: 'lifeguard', cleaner: 'crew_housekeeping',
};
// Access set for a crew job
export function accessFor(job) {
  const a = new Set(['crew']);
  if (job === 'officer' || job === 'helmsman') { a.add('officer'); a.add('security'); }
  if (job === 'guard' || job === 'patrol') { a.add('security'); a.add('officer'); a.add('casino'); }
  if (job === 'engineer' || job === 'deckhand') a.add('engineer');
  if (job === 'cleaner') a.add('master');
  if (job === 'dealer' || job === 'cashier') a.add('casino');
  if (job === 'steward') a.add('master');
  return a;
}

// Work animation at a staff POI; `t` = per-NPC phase seconds, r = stable random 0..1
export function workAnim(role, t, r) {
  const cyc = (period, k) => ((t / period + r) % 1) < k;
  switch (role) {
    case 'bartender': case 'crew_bartender': return cyc(14, 0.45) ? 'wipe_bar' : cyc(9, 0.5) ? 'talk' : 'idle';
    case 'dealer': return 'deal_cards';
    case 'cashier': case 'clerk': case 'host': return cyc(11, 0.4) ? 'talk' : 'idle';
    case 'cook': return 'cook';
    case 'officer': return cyc(20, 0.3) ? 'radio' : cyc(13, 0.3) ? 'point' : 'idle';
    case 'helmsman': return 'idle';
    case 'guard': return cyc(25, 0.15) ? 'radio' : 'guard';
    case 'nurse': return cyc(12, 0.4) ? 'talk' : 'idle';
    case 'laundry': case 'engineer': return 'cook';
    case 'dj': return 'dance';
    case 'pianist': return 'type';
    default: return 'idle';
  }
}

// Passenger dress code for a destination room at hour h. Returns 'swim' | 'evening' | 'casual' with probability.
export function dressFor(room, h, rnd) {
  if (!room) return 'casual';
  const d = room.dens;
  if ((d === 'pool' || d === 'swim' || (d === 'spa' && room.venue === 'solarium')) && h >= 7.5 && h < 19.5) return rnd < 0.85 ? 'swim' : 'casual';
  if (d === 'deck' && room.deck >= 15 && h >= 9 && h < 18) return rnd < 0.35 ? 'swim' : 'casual';
  if (h >= 17.5 || h < 2) {
    if (d === 'dining' || d === 'theater' || d === 'casino' || room.venue === 'piano' || room.venue === 'cigar' || room.venue === 'zenith') return rnd < 0.8 ? 'evening' : 'casual';
    if (d === 'bar' || d === 'club' || d === 'atrium' || d === 'lounge' || d === 'transit' || d === 'shopstreet') return rnd < 0.5 ? 'evening' : 'casual';
  }
  return 'casual';
}

// Activity for a passenger at a POI (pose + act + item type) → {anim, held}
export function poiAnim(poi, rnd, h) {
  const t = poi.item?.t;
  switch (poi.pose) {
    case 'sit':
      if (poi.act === 'eat') return { anim: 'eat', held: 'none' };
      if (poi.act === 'gamble') return t === 'slot' ? { anim: 'slots', held: 'none' } : { anim: 'sit_bar', held: 'none' };
      if (t === 'stool') return { anim: 'sit_bar', held: rnd < 0.6 ? 'drink' : 'none' };
      if (poi.act === 'drink') return { anim: 'sit', held: rnd < 0.7 ? 'drink' : 'none' };
      if (poi.act === 'watch') return { anim: 'sit', held: 'none' };
      return { anim: 'sit', held: rnd < 0.2 ? 'phone' : rnd < 0.35 ? 'drink' : 'none' };
    case 'lie': return { anim: (h >= 23 || h < 7) && poi.act !== 'sunbathe' ? 'sleep' : 'lie', held: 'none' };
    case 'run': return { anim: 'run', held: 'none', speed: 2.6 };
    case 'stand':
      if (poi.act === 'eat') return { anim: 'idle', held: 'none' };
      if (poi.act === 'view') return rnd < 0.25 ? { anim: 'idle', held: 'camera' } : rnd < 0.4 ? { anim: 'phone', held: 'none' } : { anim: 'idle', held: 'none' };
      if (poi.act === 'play') return { anim: 'slots', held: 'none', standing: true };
      if (poi.act === 'swim') return { anim: rnd < 0.5 ? 'swim' : 'tread_water', held: 'none' };
      if (poi.act === 'soak') return { anim: 'sit', held: 'none' };
      if (poi.act === 'dance') return { anim: 'dance', held: 'none' };
      if (poi.act === 'shop' || poi.act === 'browse') return { anim: 'idle', held: 'none' };
      return { anim: 'idle', held: 'none' };
    default: return { anim: 'idle', held: 'none' };
  }
}

// How long (seconds of real time) someone uses a POI. 1 game minute = 1.25 s.
export function useDuration(poi, rnd) {
  const m = (a, b) => (a + (b - a) * rnd) * 1.25 * 60 / 6;   // compress: a stay of N game minutes lasts N/6 game-min… (keeps the world lively)
  switch (poi.act) {
    case 'eat': return poi.pose === 'stand' ? 10 + rnd * 12 : m(35, 80);
    case 'drink': return m(20, 60);
    case 'gamble': return m(25, 90);
    case 'watch': return m(40, 70);
    case 'sunbathe': return m(40, 120);
    case 'exercise': return m(15, 40);
    case 'view': return 12 + rnd * 40;
    case 'shop': case 'browse': return 8 + rnd * 20;
    case 'swim': return 25 + rnd * 60;
    case 'soak': return m(15, 40);
    case 'dance': return 40 + rnd * 120;
    case 'play': return 20 + rnd * 50;
    case 'relax': return m(20, 60);
    default: return 25 + rnd * 60;
  }
}

export function contextBark(room, npc) {
  if (npc.job) {
    switch (npc.job) {
      case 'steward': return 'housekeeping';
      case 'waiter': return 'waiter';
      case 'bartender': case 'crew_bartender': return 'bartender';
      case 'dealer': return 'dealer';
      case 'clerk': case 'cashier': case 'host': return 'clerk';
      case 'guard': case 'patrol': return 'security';
      case 'cook': return 'cook';
      case 'deckhand': case 'cleaner': return 'deckhand';
      default: return 'crew';
    }
  }
  if (!room) return 'transit';
  switch (room.dens) {
    case 'dining': return 'dining';
    case 'buffet': return 'buffet';
    case 'bar': return 'bar';
    case 'club': return 'club';
    case 'casino': return 'casino';
    case 'pool': case 'swim': return 'pool';
    case 'theater': return 'theater';
    case 'shop': case 'shopstreet': return 'shop';
    case 'promenade': case 'deck': return 'view';
    case 'lounge': return 'lounge';
    case 'gym': return 'gym';
    case 'spa': return 'spa';
    case 'kids': return 'kids';
    default: return 'transit';
  }
}
