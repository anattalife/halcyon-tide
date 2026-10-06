// Character appearance generator: a plain, serialisable description of a person.
// Colours are sRGB hex numbers. Used by CharacterRenderer (characters.js).

export const ROLES = ['passenger', 'child', 'elderly', 'crew_steward', 'crew_waiter', 'crew_bartender', 'crew_chef',
  'crew_deckhand', 'crew_engineer', 'crew_housekeeping', 'crew_officer', 'captain', 'security', 'entertainer',
  'croupier', 'medic', 'lifeguard', 'player'];

export const HAIR_STYLES = ['short', 'crew', 'bob', 'long', 'ponytail', 'bun', 'curly', 'afro', 'balding', 'bald'];
export const HATS = ['none', 'officer_cap', 'captain_cap', 'security_cap', 'ball_cap', 'chef_hat', 'sun_hat', 'visor', 'beanie'];

const SKIN = [0xf5dccb, 0xeccab0, 0xe3b593, 0xd5a07a, 0xc08860, 0xa66f4a, 0x8a5636, 0x6e4128, 0x51301e, 0xf0d0b4];
const HAIR_C = {
  black: 0x18130f, dark: 0x2e2018, brown: 0x4e3424, chestnut: 0x6b4128, light: 0x8a6646, blonde: 0xc4a067,
  platinum: 0xe2d4ad, auburn: 0x6e2c18, ginger: 0xa04e24, grey: 0x8f8a85, white: 0xd6d2ca,
};
const NEUTRAL = [0xf2f0ea, 0x1d2230, 0x3a3f4a, 0x6b6f78, 0xc9c2b2, 0x2b3a55, 0x8a7a62];
const BRIGHT = [0xd9483b, 0xe57f2e, 0xf0c33c, 0x4f9d5b, 0x2f86c4, 0x5e5cc9, 0xb0458f, 0xe76f91, 0x36b3b0, 0x8cc65a, 0xffffff, 0x1f2d4f];
const PASTEL = [0xf4c7c3, 0xf7dfb0, 0xcfe8c6, 0xbfdcef, 0xd8cdef, 0xf6eee0, 0xa8d8d0, 0xf2b8a0];
const BOTTOMS = [0xc8b48c, 0x2a3348, 0x5b6370, 0xe9e4d6, 0x3e4f3a, 0x7a5b40, 0x1c1c1f, 0x8fa3b8];
const EVENING_M = [0x15171d, 0x1c2438, 0x2a2a2e, 0xf1efe8, 0x3b2430];
const EVENING_F = [0x101014, 0x7a1424, 0x1c2f6b, 0x0f5146, 0xc89a3c, 0x5a1a5e, 0xd8c6b0, 0xa8323c];
const SWIM = [0xd9483b, 0x2f86c4, 0x1d2230, 0xf0c33c, 0xe76f91, 0x36b3b0, 0xffffff, 0x4f9d5b, 0xe57f2e];
const SHOES_CASUAL = [0xf4f4f2, 0x2b2b2e, 0x6b4a32, 0xb8a58a, 0x34465e];
const GOLD = 0xc9a23a, WHITE = 0xf3f2ee, BLACK = 0x18181b, NAVY = 0x1b2440;

function defaultSex(rng) { return rng.chance(0.5) ? 'm' : 'f'; }

function pickHair(rng, sex, age) {
  let style;
  if (age === 'child') style = sex === 'm' ? rng.pick(['short', 'short', 'crew', 'curly']) : rng.pick(['ponytail', 'long', 'bob', 'bun', 'curly']);
  else if (age === 'elderly') style = sex === 'm' ? rng.pick(['balding', 'balding', 'short', 'bald', 'crew']) : rng.pick(['bob', 'short', 'bun', 'curly']);
  else style = sex === 'm' ? rng.weighted([['short', 5], ['crew', 3], ['curly', 1.2], ['bald', 1], ['afro', 0.6], ['ponytail', 0.3], ['long', 0.3], ['balding', 0.6]])
    : rng.weighted([['long', 4], ['bob', 3], ['ponytail', 3], ['bun', 2], ['curly', 1.5], ['afro', 0.5], ['short', 1]]);
  let color;
  if (age === 'elderly') color = rng.pick([HAIR_C.grey, HAIR_C.white, HAIR_C.grey, HAIR_C.light]);
  else color = rng.pick([HAIR_C.black, HAIR_C.dark, HAIR_C.dark, HAIR_C.brown, HAIR_C.brown, HAIR_C.chestnut, HAIR_C.light, HAIR_C.blonde, HAIR_C.platinum, HAIR_C.auburn, HAIR_C.ginger]);
  return { style, color };
}

function faceFor(rng, sex, age) {
  // atlas: 0 male, 1 male stubble, 2 male moustache, 3 female, 4 female makeup, 5 child, 6 elderly male, 7 elderly female
  if (age === 'child') return 5;
  if (age === 'elderly') return sex === 'm' ? (rng.chance(0.3) ? 2 : 6) : 7;
  if (sex === 'm') return rng.weighted([[0, 5], [1, 3], [2, 1]]);
  return rng.chance(0.5) ? 4 : 3;
}

// Outfit fields consumed by the renderer:
//  topColor, top2 (collar / inner shirt / trim), sleeve 0..1, neck 'open'|'collar'|'high'|'bare',
//  chestBand (colour or null, horizontal band mid-chest), bikiniTop (colour or null), bareTorso,
//  legs 'trousers'|'shorts'|'capri'|'skirt'|'dress'|'swim'|'bikini', bottomColor, skirtLen (0..1 of leg), skirtFlare,
//  hem {color,len} (jacket/tunic tail) or null, socks colour or null, shoeColor, sole, hat, hatColor, gloves
function baseOutfit() {
  return { top: 'tshirt', bottom: 'trousers', shoes: 'shoes', hat: 'none', accent: 0,
    topColor: WHITE, top2: WHITE, sleeve: 0.4, neck: 'open', chestBand: null, bikiniTop: null, bareTorso: false,
    legs: 'trousers', bottomColor: 0x2a3348, skirtLen: 0, skirtFlare: 1, hem: null, socks: null,
    shoeColor: BLACK, sole: 0x2a2a2a, hatColor: WHITE, hatColor2: BLACK, gloves: null, belt: null };
}

function passengerOutfit(rng, o, sex, age, dress) {
  const acc = {};
  if (dress === 'evening') {
    if (sex === 'm') {
      Object.assign(o, { top: 'suit', topColor: rng.pick(EVENING_M), top2: WHITE, sleeve: 1, neck: 'collar', legs: 'trousers',
        bottomColor: 0x15171d, shoeColor: 0x121214, hem: { len: 0.32 } });
      if (o.topColor === 0xf1efe8) o.bottomColor = 0x15171d;
      o.hem.color = o.topColor;
      o.bottomColor = o.topColor === 0xf1efe8 ? 0x15171d : o.topColor;
      if (rng.chance(0.6)) acc.tie = rng.pick([0x111111, 0x7a1424, 0x1c2f6b, 0x8a6a2a]); else acc.bowtie = 0x111111;
      o.accent = acc.tie || acc.bowtie;
    } else {
      const c = rng.pick(EVENING_F);
      const long = rng.chance(0.6);
      Object.assign(o, { top: 'gown', topColor: c, top2: c, sleeve: rng.pick([0, 0, 0.15, 1]), neck: 'bare', legs: 'dress', bottomColor: c,
        skirtLen: long ? 0.97 : rng.range(0.45, 0.6), skirtFlare: long ? 1.15 : 1.05, shoeColor: rng.pick([0x111111, GOLD, c, 0xd8c6b0]), bottom: long ? 'gown' : 'cocktail' });
      acc.necklace = rng.chance(0.5) ? GOLD : 0xe8e8f0;
    }
    return acc;
  }
  if (dress === 'swim') {
    const sc = rng.pick(SWIM);
    if (sex === 'm' || age === 'child' && rng.chance(0.4)) {
      Object.assign(o, { top: 'bare', bareTorso: true, sleeve: 0, legs: 'swim', bottom: 'trunks', bottomColor: sc, shoeColor: rng.pick([0x2b2b2e, 0x2f86c4, 0xf0c33c, 0xffffff]), shoes: 'sandals' });
      if (rng.chance(0.3)) Object.assign(o, { top: 'tank', bareTorso: false, topColor: rng.pick(BRIGHT), neck: 'open' });
    } else {
      const bikini = rng.chance(0.6);
      Object.assign(o, { top: bikini ? 'bikini' : 'swimsuit', bareTorso: bikini, bikiniTop: bikini ? sc : null, topColor: sc, sleeve: 0, neck: 'bare',
        legs: bikini ? 'bikini' : 'swimsuit', bottom: bikini ? 'bikini' : 'swimsuit', bottomColor: sc, shoes: 'sandals', shoeColor: rng.pick([0xf4f4f2, 0xe76f91, 0x2b2b2e, GOLD]) });
      if (rng.chance(0.35)) { // sheer cover-up / sarong
        const cc = rng.pick(PASTEL);
        Object.assign(o, { top: 'coverup', bareTorso: false, topColor: cc, top2: cc, sleeve: 0.3, neck: 'open', legs: 'skirt', skirtLen: rng.range(0.3, 0.55), skirtFlare: 1.1, bottomColor: cc });
      }
    }
    if (rng.chance(0.45)) { o.hat = rng.pick(['sun_hat', 'ball_cap', 'visor']); o.hatColor = rng.pick([0xe3cf9e, WHITE, rng.pick(BRIGHT)]); o.hatColor2 = o.hatColor; }
    if (rng.chance(0.5)) acc.glasses = 0x101010;
    return acc;
  }
  // casual holiday wear
  const kind = sex === 'm'
    ? rng.weighted([['polo', 4], ['tshirt', 4], ['shirt', 3], ['tank', 0.6]])
    : rng.weighted([['sundress', 3], ['tshirt', 2], ['blouse', 3], ['polo', 1], ['tank', 1.5]]);
  const topC = rng.chance(0.5) ? rng.pick(BRIGHT) : rng.chance(0.5) ? rng.pick(PASTEL) : rng.pick(NEUTRAL);
  o.top = kind; o.topColor = topC; o.top2 = topC;
  if (kind === 'polo') { o.sleeve = 0.4; o.neck = 'collar'; }
  else if (kind === 'tshirt') { o.sleeve = 0.4; o.neck = 'open'; }
  else if (kind === 'shirt') { o.sleeve = rng.chance(0.7) ? 0.45 : 0.95; o.neck = 'collar'; }
  else if (kind === 'blouse') { o.sleeve = rng.pick([0, 0.3, 0.45, 0.8]); o.neck = 'open'; }
  else if (kind === 'tank') { o.sleeve = 0; o.neck = 'open'; }
  if (kind === 'sundress') {
    const c = rng.chance(0.6) ? rng.pick(PASTEL) : rng.pick(BRIGHT);
    Object.assign(o, { topColor: c, top2: c, sleeve: rng.pick([0, 0, 0.2]), neck: 'open', legs: 'dress', bottom: 'dress', bottomColor: c, skirtLen: rng.range(0.45, 0.85), skirtFlare: rng.range(1.05, 1.3) });
  } else {
    const legKind = sex === 'm' ? rng.weighted([['shorts', 5], ['trousers', 3], ['capri', 0.5]]) : rng.weighted([['shorts', 3], ['trousers', 2], ['skirt', 3], ['capri', 2]]);
    o.legs = legKind; o.bottom = legKind;
    o.bottomColor = rng.chance(0.8) ? rng.pick(BOTTOMS) : rng.pick(PASTEL);
    if (legKind === 'skirt') { o.skirtLen = rng.range(0.35, 0.8); o.skirtFlare = rng.range(1.0, 1.25); }
    if (Math.abs(o.bottomColor - o.topColor) < 0x050505) o.bottomColor = 0x2a3348;
  }
  o.shoes = rng.pick(['sneakers', 'sandals', 'loafers']);
  o.shoeColor = rng.pick(SHOES_CASUAL);
  o.sole = o.shoes === 'sneakers' ? 0xf2f2f2 : 0x3a2c22;
  if (o.shoes === 'sneakers' && (o.legs === 'shorts') && rng.chance(0.5)) o.socks = 0xf2f2f2;
  if (age === 'elderly') {
    if (rng.chance(0.5)) { o.sleeve = 1; if (o.top === 'polo' || o.top === 'tshirt') o.top = 'cardigan'; o.topColor = rng.pick(PASTEL.concat([0x8a7a62, 0x6b6f78])); }
    if (o.legs === 'shorts' && rng.chance(0.5)) { o.legs = 'trousers'; o.bottom = 'trousers'; }
  }
  if (rng.chance(age === 'child' ? 0.3 : 0.15)) { o.hat = rng.pick(['ball_cap', 'sun_hat', 'visor']); o.hatColor = rng.pick(BRIGHT.concat([0xe3cf9e])); o.hatColor2 = o.hatColor; }
  if (rng.chance(0.25)) acc.glasses = 0x121212;
  return acc;
}

function uniformOutfit(role, rng, o, sex) {
  const acc = {};
  const skirtOK = sex === 'f' && rng.chance(0.35);
  switch (role) {
    case 'crew_officer':
    case 'captain': {
      const cap = role === 'captain';
      Object.assign(o, { top: cap ? 'officer_jacket' : 'officer_shirt', topColor: WHITE, top2: WHITE, sleeve: cap || rng.chance(0.4) ? 1 : 0.42,
        neck: 'collar', legs: skirtOK && !cap ? 'skirt' : 'trousers', bottom: 'trousers', bottomColor: WHITE, skirtLen: 0.5, skirtFlare: 1.0,
        shoeColor: cap ? WHITE : (rng.chance(0.5) ? WHITE : BLACK), sole: 0x333333, hat: cap ? 'captain_cap' : (rng.chance(0.8) ? 'officer_cap' : 'none'),
        hatColor: WHITE, hatColor2: BLACK });
      if (cap) o.hem = { color: WHITE, len: 0.3 };
      acc.epaulettes = { color: BLACK, stripes: cap ? 4 : rng.int(1, 3), gold: GOLD };
      if (o.sleeve > 0.9) acc.tie = BLACK;
      acc.badge = GOLD; o.accent = GOLD;
      break;
    }
    case 'security':
      Object.assign(o, { top: 'security_shirt', topColor: NAVY, top2: NAVY, sleeve: rng.chance(0.6) ? 1 : 0.42, neck: 'collar', legs: 'trousers', bottom: 'cargo',
        bottomColor: 0x161c30, shoeColor: 0x0e0e10, shoes: 'boots', hat: rng.chance(0.85) ? 'security_cap' : 'none', hatColor: NAVY, hatColor2: NAVY, belt: 0x0c0c0c });
      acc.radio = 0x1a1a1a; acc.badge = 0xd0d4da; acc.belt = 0x0c0c0c; acc.epaulettes = { color: NAVY, stripes: 1, gold: 0xb8bcc4 };
      o.accent = 0xd0d4da;
      break;
    case 'crew_steward':
      Object.assign(o, { top: 'white_jacket', topColor: WHITE, top2: WHITE, sleeve: 1, neck: 'collar', legs: skirtOK ? 'skirt' : 'trousers', bottom: 'trousers',
        skirtLen: 0.5, skirtFlare: 1.0, bottomColor: BLACK, shoeColor: BLACK, hem: { color: WHITE, len: 0.22 } });
      acc.bowtie = rng.chance(0.5) ? BLACK : 0x2a3a6a; acc.badge = GOLD; o.accent = GOLD;
      break;
    case 'crew_waiter':
      Object.assign(o, { top: 'waistcoat', topColor: rng.pick([BLACK, 0x5a1420, NAVY]), top2: WHITE, sleeve: 1, sleeveColor: WHITE, neck: 'collar', legs: 'trousers', bottom: 'trousers',
        bottomColor: BLACK, shoeColor: BLACK });
      acc.bowtie = BLACK; acc.apron = rng.chance(0.5) ? { color: BLACK, len: 0.75 } : null; o.accent = 0;
      break;
    case 'crew_bartender':
      Object.assign(o, { top: 'waistcoat', topColor: rng.pick([BLACK, 0x2a2a30, 0x4a1418]), top2: rng.chance(0.5) ? WHITE : BLACK, sleeve: 0.92, neck: 'collar', legs: 'trousers', bottom: 'trousers', bottomColor: BLACK, shoeColor: BLACK });
      o.sleeveColor = o.top2;
      acc.apron = { color: BLACK, len: 0.7 }; if (rng.chance(0.4)) acc.bowtie = BLACK;
      break;
    case 'crew_chef':
      Object.assign(o, { top: 'chef_jacket', topColor: WHITE, top2: WHITE, sleeve: rng.chance(0.6) ? 1 : 0.5, neck: 'high', legs: 'trousers', bottom: 'chef_trousers', bottomColor: 0x2e2e33,
        shoeColor: BLACK, hat: 'chef_hat', hatColor: WHITE, hatColor2: WHITE, hem: { color: WHITE, len: 0.2 } });
      acc.apron = { color: WHITE, len: 0.8 }; acc.buttons = BLACK;
      break;
    case 'crew_deckhand':
    case 'crew_engineer': {
      const c = role === 'crew_deckhand' ? (rng.chance(0.75) ? 0xe2621d : NAVY) : (rng.chance(0.7) ? NAVY : 0xe2621d);
      Object.assign(o, { top: 'coverall', topColor: c, top2: c, sleeve: rng.chance(0.8) ? 1 : 0.45, neck: 'collar', legs: 'trousers', bottom: 'coverall', bottomColor: c,
        chestBand: 0xd8dccc, shoeColor: 0x2b2420, shoes: 'boots', sole: 0x1a1a1a, belt: null });
      if (role === 'crew_engineer' && rng.chance(0.4)) { o.hat = 'beanie'; o.hatColor = 0x2a2a2e; o.hatColor2 = o.hatColor; }
      if (role === 'crew_deckhand' && rng.chance(0.4)) { o.hat = 'ball_cap'; o.hatColor = NAVY; o.hatColor2 = NAVY; }
      acc.gloves = role === 'crew_deckhand' && rng.chance(0.5) ? 0xd6c48a : null;
      acc.radio = rng.chance(0.4) ? 0x1a1a1a : null;
      break;
    }
    case 'crew_housekeeping':
      Object.assign(o, { top: 'tunic', topColor: 0x9cc7e6, top2: 0xffffff, sleeve: 0.4, neck: 'collar', legs: skirtOK || sex === 'f' && rng.chance(0.3) ? 'skirt' : 'trousers',
        bottom: 'trousers', skirtLen: 0.55, skirtFlare: 1.0, bottomColor: rng.chance(0.5) ? 0x22283a : 0x9cc7e6, shoeColor: rng.chance(0.5) ? WHITE : BLACK, hem: { color: 0x9cc7e6, len: 0.3 } });
      acc.apron = { color: WHITE, len: 0.55 };
      break;
    case 'croupier':
      Object.assign(o, { top: 'waistcoat', topColor: rng.pick([BLACK, 0x6a1520, 0x0f3d2e]), top2: WHITE, sleeve: 1, sleeveColor: WHITE, neck: 'collar', legs: 'trousers', bottom: 'trousers', bottomColor: BLACK, shoeColor: BLACK });
      acc.bowtie = rng.pick([BLACK, 0x8a1020]); acc.badge = GOLD;
      break;
    case 'medic':
      Object.assign(o, { top: 'medic_coat', topColor: WHITE, top2: 0x3f9a7a, sleeve: 1, neck: 'open', legs: 'trousers', bottom: 'scrubs', bottomColor: 0x3f9a7a,
        shoeColor: WHITE, sole: 0xdddddd, hem: { color: WHITE, len: 0.55 } });
      acc.badge = 0x3f9a7a; acc.stethoscope = 0x222222; o.chestBand = null;
      break;
    case 'lifeguard':
      Object.assign(o, { top: sex === 'm' && rng.chance(0.5) ? 'bare' : 'tank', topColor: rng.pick([0xf0c33c, WHITE, 0xd8282c]), sleeve: 0, neck: 'open', legs: 'shorts', bottom: 'shorts',
        bottomColor: 0xd8282c, shoeColor: 0x222222, shoes: 'sandals', hat: rng.chance(0.6) ? 'visor' : 'none', hatColor: 0xd8282c, hatColor2: 0xd8282c });
      if (o.top === 'bare') o.bareTorso = true;
      o.shortsLen = 0.32;
      acc.whistle = 0xd8282c; acc.glasses = rng.chance(0.6) ? 0x101010 : null;
      break;
    case 'entertainer': {
      const c = rng.pick([0xc0167a, 0xd4a02a, 0x2a39c8, 0x9a14c8, 0xe03030, 0x10a0a0]);
      if (sex === 'f' && rng.chance(0.7)) Object.assign(o, { top: 'sequin_dress', topColor: c, top2: c, sleeve: 0, neck: 'bare', legs: 'dress', bottom: 'dress', bottomColor: c, skirtLen: rng.range(0.3, 0.5), skirtFlare: 1.35, shoeColor: GOLD });
      else Object.assign(o, { top: 'stage_jacket', topColor: c, top2: BLACK, sleeve: 1, neck: 'collar', legs: 'trousers', bottom: 'trousers', bottomColor: BLACK, shoeColor: BLACK, hem: { color: c, len: 0.35 } });
      if (rng.chance(0.3)) { o.hat = 'beanie'; o.hatColor = c; }
      acc.sparkle = true; acc.bowtie = o.legs === 'trousers' ? BLACK : null;
      break;
    }
    case 'player':
      Object.assign(o, { top: 'jacket', topColor: 0x2c3138, top2: 0xe8e4dc, sleeve: 1, neck: 'open', legs: 'trousers', bottom: 'chinos', bottomColor: 0x3d4552,
        shoeColor: 0x3a2a20, shoes: 'boots', hem: { color: 0x2c3138, len: 0.25 } });
      break;
  }
  return acc;
}

export function makeAppearance(rng, opts = {}) {
  let role = opts.role || 'passenger';
  let age = opts.age || (role === 'child' ? 'child' : role === 'elderly' ? 'elderly' : 'adult');
  if (role === 'child' || role === 'elderly') { age = role; }
  const sex = opts.sex || defaultSex(rng);
  let height;
  if (age === 'child') height = rng.range(1.0, 1.4);
  else if (sex === 'm') height = clamp(1.76 + gauss(rng) * 0.07, 1.6, 1.95);
  else height = clamp(1.63 + gauss(rng) * 0.065, 1.52, 1.82);
  if (age === 'elderly') height *= 0.975;
  if (role === 'player') height = sex === 'm' ? 1.8 : 1.7;
  let build = clamp(1.0 + gauss(rng) * 0.09 + (age === 'elderly' ? 0.04 : 0), 0.85, 1.25);
  if (role === 'security') build = clamp(build + 0.08, 0.95, 1.25);
  if (role === 'lifeguard' || role === 'entertainer') build = clamp(build - 0.06, 0.85, 1.05);
  if (age === 'child') build = clamp(build - 0.04, 0.85, 1.1);
  const skin = opts.skin ?? rng.pick(SKIN);
  const hair = opts.hair || pickHair(rng, sex, age);
  const face = faceFor(rng, sex, age);
  const o = baseOutfit();
  let acc;
  let dress = opts.dress || 'casual';
  if (role === 'passenger' || role === 'child' || role === 'elderly') acc = passengerOutfit(rng, o, sex, age, dress);
  else acc = uniformOutfit(role, rng, o, sex);
  // uniforms keep hair tidy
  if (role !== 'passenger' && role !== 'child' && role !== 'elderly' && role !== 'entertainer') {
    if (hair.style === 'long' || hair.style === 'afro') hair.style = sex === 'f' ? 'bun' : 'short';
  }
  if (role === 'crew_chef' && hair.style !== 'bald') hair.style = sex === 'f' ? 'bun' : 'short';
  return {
    role, sex, age, dress, seed: opts.seed ?? Math.floor(rng.next() * 1e9),
    height: +height.toFixed(3), build: +build.toFixed(3), skin, face,
    hair, outfit: o, acc: acc || {},
    gait: +rng.range(0, 1).toFixed(3),     // idle/walk personality variation
  };
}

function gauss(rng) { return (rng.next() + rng.next() + rng.next() - 1.5) * 1.15; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
