// Procedural furniture models — one merged, vertex-coloured geometry per (type, variant, size).
// Every builder works in item-local space: origin at the floor centre of the FDEF footprint,
// +Z = front, Y up, and keeps the visual inside the footprint (W × D × H) unless noted.
// Parts flagged tint:true are multiplied per instance by an upholstery colour (iTint).
import * as THREE from 'three';
import { GB, lin, mat4, prng, SCR } from './propsGeo.js';
import { TECH } from './propsTech.js';

const PI = Math.PI, TAU = PI * 2;
// shared palette (sRGB hex; converted to linear by lin())
export const K = {
  white: '#f3f1ec', linen: '#efe9dc', ivory: '#e8dfca', cream: '#ddd0b4', black: '#151517', ink: '#202024',
  walnut: '#563826', walnutD: '#3b2619', oak: '#a27d55', oakL: '#c4a27a', teak: '#94653c', teakD: '#6e4728', mahog: '#5b2a1c', ebony: '#221a16',
  brass: '#c8a050', gold: '#d6ae55', bronze: '#8a5a32', chrome: '#d4d9de', steel: '#a2a8ad', steelD: '#5f656b', alu: '#c3c7cb',
  marble: '#e9e6e0', marbleD: '#3c3a39', granite: '#2b2a2c', felt: '#1f6b46', red: '#b3241f', orange: '#e8641e', grey: '#8a8d90',
  greyD: '#4a4c50', greyL: '#c8cacc', glass: '#cfe3ea', leaf: '#3f6b33', leafD: '#2b4f26', leafL: '#6c9442', soil: '#2c2018',
  fabricD: '#3a3836', mirror: '#8d9aa3', screenOff: '#0b0d10', water: '#5fc3d6', rubber: '#1d1d1f', cardboard: '#a27a4f',
};
const UP = { tint: true, m: 'fabric' };

// ── reusable bits ─────────────────────────────────────────────────────────
function legs4(g, x0, x1, z0, z1, h, r, col, m = 'wood', r2 = null, seg = 6) {
  for (const x of [x0, x1]) for (const z of [z0, z1]) g.cyl(x, h / 2, z, r, h, col, { r2: r2 ?? r * 0.7, seg, m });
}
function sqLegs(g, x0, x1, z0, z1, h, s, col, m = 'wood') {
  for (const x of [x0, x1]) for (const z of [z0, z1]) g.box(x, h / 2, z, s, h, s, col, { m });
}
function cushion(g, x, y, z, w, h, d, col = K.white, o = {}) {
  return g.box(x, y, z, w, h, d, col, { r: o.r ?? Math.min(h * 0.45, 0.06), steps: o.steps ?? 1, tint: o.tint ?? true, m: o.m || 'fabric', rot: o.rot });
}
// place setting: plate, napkin, cutlery, two glasses (glass parts)
function setting(g, x, z, a, top) {
  const s = Math.sin(a), c = Math.cos(a);
  const P = (u, v) => [x + u * c + v * s, z - u * s + v * c];
  let [px, pz] = P(0, 0);
  g.cyl(px, top + 0.008, pz, 0.135, 0.012, K.white, { seg: 14, m: 'ceramic', r2: 0.14 });
  g.cyl(px, top + 0.02, pz, 0.1, 0.012, K.white, { seg: 12, m: 'ceramic' });
  [px, pz] = P(0, 0.02); g.box(px, top + 0.035, pz, 0.09, 0.03, 0.05, K.linen, { rot: [0, a, 0], m: 'linen' });  // folded napkin
  for (const u of [-0.17, -0.19, 0.17, 0.19]) { [px, pz] = P(u, 0); g.box(px, top + 0.004, pz, 0.012, 0.004, 0.18, K.chrome, { rot: [0, a, 0], m: 'chrome' }); }
  for (const [u, v, hh] of [[0.14, -0.15, 0.16], [0.21, -0.1, 0.12]]) {
    [px, pz] = P(u, v);
    g.lathe([[0.001, 0], [0.03, 0], [0.004, 0.006], [0.004, hh * 0.45], [0.032, hh * 0.55], [0.036, hh]], px, top, pz, K.glass, { seg: 8, glass: true, m: 'glass' });
  }
}
function centrepiece(g, x, z, top, rnd) {
  g.cyl(x, top + 0.06, z, 0.035, 0.12, K.glass, { seg: 8, glass: true });
  for (let k = 0; k < 5; k++) { const a = k * 1.3; g.sph(x + Math.sin(a) * 0.03, top + 0.14 + rnd() * 0.04, z + Math.cos(a) * 0.03, 0.028, ['#f4f1ea', '#e8b9b0', '#d8687a'][k % 3], { seg: 6 }); }
  g.cyl(x + 0.12, top + 0.04, z + 0.05, 0.02, 0.07, K.white, { seg: 8 });
  g.cyl(x + 0.12, top + 0.085, z + 0.05, 0.006, 0.02, '#ffd9a0', { seg: 4, emi: 1.6 });
}
function tableCloth(g, R, top, drop, round = true, W = 0, D = 0) {
  if (round) {
    const pts = [[0, top + 0.012], [R - 0.02, top + 0.012], [R, top], [R + 0.01, top - 0.04], [R + 0.03, top - drop * 0.5], [R + 0.05, top - drop]];
    g.lathe(pts, 0, 0, 0, K.white, { seg: 24, m: 'linen' });
    g.lathe([[R + 0.05, top - drop], [R + 0.035, top - drop + 0.002], [0.05, top - drop + 0.01]], 0, 0, 0, K.white, { seg: 24, m: 'linen' });
  } else {
    g.box(0, top + 0.006, 0, W, 0.012, D, K.white, { m: 'linen' });
    g.box(0, top - drop / 2, 0, W + 0.02, drop, D + 0.02, K.white, { m: 'linen', r: 0.008, steps: 1 });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
export const MODELS = {
  // ── BEDS ──────────────────────────────────────────────────────────────────
  bed_q: {
    tints: 'bedding',
    build(g, W, D, H, v) {
      const z0 = -D / 2;
      g.aoH = 0.25;
      g.box(0, 0.035, 0.02, W - 0.12, 0.07, D - 0.16, K.ink, { m: 'matte' });                          // recessed plinth
      g.box(0, 0.19, 0.02, W - 0.03, 0.24, D - 0.06, '#5d5a57', { r: 0.03, steps: 1, m: 'fabric' });  // upholstered base
      g.box(0, 0.4, 0.03, W - 0.06, 0.2, D - 0.12, K.white, { r: 0.07, steps: 1, m: 'linen' });       // mattress
      // duvet with folded top
      g.box(0, 0.425, z0 + 0.62 + (D - 0.62) / 2, W, 0.3, D - 0.62, K.white, { r: 0.08, steps: 1, m: 'linen' });
      g.cyl(0, 0.575, z0 + 0.64, 0.045, W - 0.02, K.white, { rot: [0, 0, PI / 2], seg: 8, m: 'linen' });
      // bed runner (tinted) draping over the sides
      g.box(0, 0.45, D / 2 - 0.55, W + 0.02, 0.27, 0.46, K.white, { r: 0.075, steps: 1, tint: true, m: 'fabric' });
      // pillows: sleeping + accent
      const nP = W > 1.3 ? 2 : 1;
      for (let k = 0; k < nP; k++) {
        const x = nP === 1 ? 0 : (k - 0.5) * (W / 2);
        cushion(g, x, 0.58, z0 + 0.3, Math.min(0.68, W / nP - 0.08), 0.16, 0.4, K.white, { tint: false, steps: 1, m: 'linen', rot: [-0.32, 0, 0] });
        cushion(g, x * 0.95, 0.6, z0 + 0.48, Math.min(0.5, W / nP - 0.2), 0.34, 0.12, K.white, { steps: 1, rot: [-0.3, 0, 0] });
      }
      if (W > 1.3) cushion(g, 0, 0.6, z0 + 0.6, 0.42, 0.24, 0.1, '#e0d8c8', { tint: false, rot: [-0.25, 0, 0] });
      // headboard: walnut frame with tufted channels
      g.box(0, 0.68, z0 + 0.02, W, 1.12, 0.04, K.walnut, { m: 'wood' });
      const nC = Math.round(W / 0.4);
      for (let k = 0; k < nC; k++) {
        const x = -W / 2 + 0.05 + (k + 0.5) * ((W - 0.1) / nC);
        g.box(x, 0.74, z0 + 0.065, (W - 0.1) / nC - 0.01, 0.92, 0.07, '#b9b1a8', { r: 0.03, steps: 1, m: 'fabric' });
      }
      g.box(0, 1.25, z0 + 0.05, W, 0.04, 0.1, K.walnut, { m: 'wood' });
    },
  },
  bed_s: {
    tints: 'crew',
    build(g, W, D, H, v) {
      g.aoH = 0.2;
      // steel cot (brig / detention): welded frame, thin mattress, grey blanket
      sqLegs(g, -W / 2 + 0.03, W / 2 - 0.03, -D / 2 + 0.03, D / 2 - 0.03, 0.36, 0.05, K.steelD, 'steel');
      g.bx(-W / 2, 0.3, -D / 2, W / 2, 0.36, D / 2, K.steel, { m: 'steel' });
      g.box(0, 0.42, 0, W - 0.06, 0.12, D - 0.06, '#d8d6d0', { r: 0.04, steps: 1, m: 'linen' });
      g.box(0, 0.44, 0.25, W - 0.04, 0.12, D - 0.6, '#55606a', { r: 0.04, steps: 1, m: 'fabric', tint: true });
      cushion(g, 0, 0.53, -D / 2 + 0.28, W - 0.3, 0.1, 0.32, K.white, { tint: false, m: 'linen' });
    },
  },
  bunk: {
    tints: 'crew',
    build(g, W, D, H) {
      g.aoH = 0.25;
      const fr = '#b8bcc0';
      for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) for (const z of [-D / 2 + 0.03, D / 2 - 0.03]) g.box(x, H / 2, z, 0.05, H, 0.05, fr, { m: 'steel' });
      for (const y of [0.3, 1.2]) {
        g.bx(-W / 2, y, -D / 2, W / 2, y + 0.05, D / 2, '#9aa0a6', { m: 'steel' });
        g.box(0, y + 0.12, 0, W - 0.08, 0.14, D - 0.08, K.white, { r: 0.04, steps: 1, m: 'linen' });
        g.box(0, y + 0.15, 0.2, W - 0.06, 0.12, D - 0.5, K.white, { r: 0.04, steps: 1, m: 'fabric', tint: true });
        cushion(g, 0, y + 0.25, -D / 2 + 0.25, W - 0.3, 0.1, 0.3, K.white, { tint: false, m: 'linen' });
      }
      // upper guard rail & ladder at the foot
      g.bx(-W / 2 + 0.02, 1.38, -D / 2 + 0.3, -W / 2 + 0.05, 1.5, D / 2 - 0.5, fr, { m: 'steel' });
      for (const x of [W / 2 - 0.06, W / 2 - 0.36]) g.box(x, 0.8, D / 2 - 0.08, 0.03, 1.6, 0.03, fr, { m: 'steel' });
      for (let y = 0.5; y < 1.5; y += 0.28) g.box(W / 2 - 0.21, y, D / 2 - 0.08, 0.3, 0.025, 0.025, fr, { m: 'steel' });
      // reading lamps (warm)
      for (const y of [0.95, 1.7]) g.box(-W / 2 + 0.1, y, -D / 2 + 0.07, 0.08, 0.04, 0.04, '#ffd59a', { emi: 1.2 });
      // privacy curtain bunched at the foot (tinted)
      g.box(-W / 2 + 0.06, 0.95, D / 2 - 0.15, 0.06, 1.5, 0.22, '#7c8a96', { r: 0.02, steps: 1, m: 'fabric' });
    },
  },

  // ── SEATING ───────────────────────────────────────────────────────────────
  sofa: { tints: 'upholstery', build: (g, W, D, H) => sofaModel(g, W, D, H, 2) },
  sofa_long: { tints: 'upholstery', build: (g, W, D, H) => sofaModel(g, W, D, H, 3) },
  armchair: {
    tints: 'upholstery',
    build(g, W, D, H) {
      g.aoH = 0.2;
      // club chair: plinth, seat box, rolled arms, raked back, loose cushions, walnut feet
      legs4(g, -W / 2 + 0.07, W / 2 - 0.07, -D / 2 + 0.07, D / 2 - 0.07, 0.1, 0.022, K.walnutD, 'wood', 0.016);
      g.box(0, 0.25, 0.0, W - 0.02, 0.22, D - 0.02, K.white, { r: 0.04, steps: 1, ...UP });
      const arm = 0.15;
      for (const s of [-1, 1]) {
        g.box(s * (W / 2 - arm / 2), 0.44, 0.01, arm, 0.3, D - 0.06, K.white, { r: 0.05, steps: 1, ...UP });
        g.cyl(s * (W / 2 - arm / 2), 0.6, 0.01, arm / 2 + 0.01, D - 0.07, K.white, { rot: [PI / 2, 0, 0], seg: 10, ...UP });
      }
      g.box(0, (0.36 + H) / 2 + 0.02, -D / 2 + 0.09, W - 0.04, H - 0.36, 0.16, K.white, { r: 0.05, steps: 1, ...UP, rot: [-0.12, 0, 0] });
      cushion(g, 0, 0.42, 0.06, W - 2 * arm - 0.02, 0.13, D - 0.24, K.white, { steps: 1 });
      cushion(g, 0, 0.64, -D / 2 + 0.22, W - 2 * arm - 0.04, 0.36, 0.12, K.white, { rot: [-0.2, 0, 0], steps: 1 });
      g.box(0, 0.15, D / 2 - 0.012, W - 0.12, 0.012, 0.006, K.brass, { m: 'brass' });   // brass kick strip
    },
  },
  chair: {
    tints: 'chair',
    variant(it, room) {
      if (!room) return 'dining';
      if (room.exterior || room.type === 'pooldeck' || room.type === 'buffet') return 'outdoor';
      const t = room.type;
      if (t === 'dining' || t === 'suite' || t === 'cabin' || t === 'officer') return 'dining';
      if (['crew_mess', 'crew_cabin', 'office', 'medical', 'security', 'galley', 'crew_bar', 'services', 'brig', 'store'].includes(t)) return 'stack';
      if (t === 'lounge' && /Conference|Boardroom|Seminar/.test(room.name || '')) return 'conf';
      return 'bistro';
    },
    build(g, W, D, H, v) {
      g.aoH = 0.15;
      const sy = 0.46;
      if (v === 'dining') {
        legs4(g, -W / 2 + 0.04, W / 2 - 0.04, -D / 2 + 0.05, D / 2 - 0.04, sy - 0.04, 0.018, K.walnutD, 'wood', 0.014);
        g.box(0, sy - 0.05, 0.01, W - 0.04, 0.05, D - 0.06, K.walnutD, { m: 'wood' });
        cushion(g, 0, sy - 0.0, 0.02, W - 0.02, 0.07, D - 0.04, K.white, { steps: 1 });
        // back: two rear posts + upholstered back panel with slight rake
        for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) g.box(x, sy + 0.22, -D / 2 + 0.04, 0.035, 0.5, 0.035, K.walnutD, { m: 'wood', rot: [-0.08, 0, 0] });
        cushion(g, 0, sy + 0.27, -D / 2 + 0.05, W - 0.06, 0.38, 0.05, K.white, { rot: [-0.1, 0, 0], steps: 1 });
      } else if (v === 'bistro') {
        legs4(g, -W / 2 + 0.05, W / 2 - 0.05, -D / 2 + 0.06, D / 2 - 0.05, sy - 0.03, 0.016, K.black, 'steel', 0.013);
        cushion(g, 0, sy - 0.01, 0.02, W - 0.04, 0.07, D - 0.06, K.white, { m: 'leather' });
        // curved back rail
        g.torus(0, sy + 0.27, -D / 2 + 0.2, W / 2 - 0.04, 0.022, K.walnut, { rot: [PI / 2, 0, 0], arc: PI, ts: 10, rs: 5, s: [1, 0.5, 1], m: 'wood' });
        for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) g.box(x, sy + 0.14, -D / 2 + 0.2, 0.025, 0.26, 0.025, K.black, { m: 'steel' });
        cushion(g, 0, sy + 0.26, -D / 2 + 0.07, W - 0.12, 0.14, 0.04, K.white, { m: 'leather' });
      } else if (v === 'stack') {
        for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) {
          g.pipe([x, 0, D / 2 - 0.05], [x, sy - 0.03, D / 2 - 0.08], 0.011, K.chrome, { m: 'chrome', seg: 6 });
          g.pipe([x, 0, -D / 2 + 0.05], [x, sy + 0.35, -D / 2 + 0.06], 0.011, K.chrome, { m: 'chrome', seg: 6 });
        }
        g.box(0, sy - 0.02, 0.02, W - 0.04, 0.04, D - 0.08, K.white, { r: 0.015, steps: 1, tint: true, m: 'plastic' });
        g.box(0, sy + 0.25, -D / 2 + 0.07, W - 0.06, 0.24, 0.03, K.white, { r: 0.012, steps: 1, tint: true, m: 'plastic', rot: [-0.12, 0, 0] });
      } else if (v === 'conf') {
        g.cyl(0, 0.02, 0, 0.22, 0.02, K.black, { seg: 10, m: 'steel' });
        g.cyl(0, 0.22, 0, 0.022, 0.4, K.chrome, { seg: 8, m: 'chrome' });
        cushion(g, 0, sy, 0.02, W - 0.02, 0.07, D - 0.06, '#2a2b2e', { tint: false, m: 'leather' });
        cushion(g, 0, sy + 0.3, -D / 2 + 0.06, W - 0.06, 0.42, 0.05, '#2a2b2e', { tint: false, m: 'leather', rot: [-0.1, 0, 0] });
        g.pipe([0, sy - 0.02, -0.1], [0, sy + 0.12, -D / 2 + 0.06], 0.015, K.chrome, { m: 'chrome' });
      } else { // outdoor: powder-coated aluminium with woven seat
        const fr = '#d9d6cf';
        legs4(g, -W / 2 + 0.04, W / 2 - 0.04, -D / 2 + 0.05, D / 2 - 0.04, sy - 0.02, 0.014, fr, 'paint', 0.014);
        g.box(0, sy - 0.02, 0.01, W - 0.04, 0.035, D - 0.06, '#8a7a62', { m: 'fabric', tint: true });
        for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) g.box(x, sy + 0.2, -D / 2 + 0.05, 0.025, 0.44, 0.025, fr, { m: 'paint', rot: [-0.12, 0, 0] });
        for (let k = 0; k < 4; k++) g.box(0, sy + 0.12 + k * 0.08, -D / 2 + 0.035 - k * 0.008, W - 0.08, 0.04, 0.012, '#8a7a62', { tint: true, m: 'fabric', rot: [-0.12, 0, 0] });
        // arms
        for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) g.box(x, sy + 0.18, -0.02, 0.025, 0.02, D - 0.12, fr, { m: 'paint' });
      }
    },
  },
  office_chair: {
    tints: 'office',
    variant: (it, room) => (room && (room.type === 'cabin' || room.type === 'suite') ? 'cabin' : 'office'),
    build(g, W, D, H, v) {
      g.aoH = 0.12;
      if (v === 'cabin') {
        // upholstered desk chair with tapered walnut legs
        legs4(g, -0.2, 0.2, -0.19, 0.2, 0.43, 0.018, K.walnut, 'wood', 0.013);
        cushion(g, 0, 0.47, 0.02, 0.5, 0.09, 0.46, K.white, { steps: 1 });
        cushion(g, 0, 0.76, -0.22, 0.48, 0.42, 0.08, K.white, { rot: [-0.12, 0, 0], steps: 1 });
        for (const x of [-0.24, 0.24]) g.box(x, 0.62, -0.05, 0.04, 0.03, 0.34, K.walnut, { m: 'wood' });
        return;
      }
      for (let k = 0; k < 5; k++) {
        const a = k * TAU / 5;
        g.box(Math.sin(a) * 0.14, 0.07, Math.cos(a) * 0.14, 0.04, 0.03, 0.28, K.black, { rot: [0, a, 0], m: 'plastic' });
        g.sph(Math.sin(a) * 0.27, 0.03, Math.cos(a) * 0.27, 0.03, K.black, { seg: 6 });
      }
      g.cyl(0, 0.27, 0, 0.025, 0.38, K.chrome, { seg: 8, m: 'chrome' });
      cushion(g, 0, 0.48, 0.02, 0.5, 0.08, 0.48, '#26272b', { tint: true, m: 'fabric' });
      g.box(0, 0.62, -0.25, 0.05, 0.25, 0.03, K.black, { m: 'plastic' });
      cushion(g, 0, 0.8, -0.26, 0.46, 0.46, 0.07, '#26272b', { tint: true, m: 'fabric', rot: [-0.1, 0, 0] });
      for (const x of [-0.26, 0.26]) { g.box(x, 0.6, 0.0, 0.03, 0.18, 0.03, K.black, { m: 'plastic' }); g.box(x, 0.69, 0.0, 0.06, 0.025, 0.24, K.black, { m: 'plastic', r: 0.01, steps: 1 }); }
    },
  },
  stool: {
    tints: 'bar',
    build(g, W, D, H) {
      g.aoH = 0.1;
      g.cyl(0, 0.012, 0, 0.19, 0.024, K.brass, { seg: 16, m: 'brass', r2: 0.18 });
      g.cyl(0, 0.38, 0, 0.022, 0.72, K.brass, { seg: 8, m: 'brass' });
      g.torus(0, 0.3, 0, 0.16, 0.012, K.brass, { rot: [PI / 2, 0, 0], ts: 16, rs: 4, m: 'brass' });
      g.lathe([[0.001, 0.72], [0.19, 0.72], [0.205, 0.75], [0.2, 0.79], [0.001, 0.8]], 0, 0, 0, K.white, { seg: 16, tint: true, m: 'leather' });
      // low back
      g.box(0, 0.92, -0.17, 0.3, 0.12, 0.04, K.white, { r: 0.02, steps: 1, tint: true, m: 'leather', rot: [-0.15, 0, 0] });
      g.box(0, 0.83, -0.17, 0.03, 0.12, 0.02, K.brass, { m: 'brass' });
    },
  },
  theater_seat: {
    tints: 'theatre',
    build(g, W, D, H) {
      g.aoH = 0.12;
      const sw = W - 0.08;
      // shared standard / armrests (half-width at each edge)
      for (const x of [-W / 2 + 0.025, W / 2 - 0.025]) {
        g.box(x, 0.33, -0.05, 0.05, 0.66, 0.42, '#1b1416', { m: 'matte' });
        g.box(x, 0.67, 0.0, 0.055, 0.035, 0.46, K.walnut, { r: 0.012, steps: 1, m: 'wood' });
      }
      cushion(g, 0, 0.44, 0.06, sw, 0.12, 0.44, K.white, { rot: [0.06, 0, 0], m: 'velvet' });   // seat
      g.box(0, 0.36, 0.08, sw - 0.04, 0.06, 0.38, '#5a4a4a', { tint: true, m: 'velvet' });
      // tall back, curved shell + velvet face
      g.box(0, 0.66, -D / 2 + 0.1, sw, 0.62, 0.07, '#7a6a6a', { r: 0.03, steps: 1, tint: true, m: 'velvet', rot: [-0.16, 0, 0] });
      cushion(g, 0, 0.67, -D / 2 + 0.145, sw - 0.04, 0.56, 0.06, K.white, { rot: [-0.16, 0, 0], m: 'velvet' });
      g.box(0, 0.98, -D / 2 + 0.06, sw, 0.04, 0.08, K.walnut, { m: 'wood', rot: [-0.16, 0, 0] });
      g.box(0, 0.2, -D / 2 + 0.04, 0.06, 0.03, 0.01, K.brass, { m: 'brass' });   // seat number plate
      g.box(0, 0.08, 0.2, 0.025, 0.012, 0.012, '#ffb070', { emi: 0.8 });          // aisle step light
    },
  },
  lounger: {
    tints: 'lounger',
    build(g, W, D, H) {
      g.aoH = 0.12;
      const fr = '#e6e2da', z0 = -D / 2, z1 = D / 2;
      // frame rails and legs (aluminium, white powder coat)
      for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) {
        g.box(x, 0.27, -0.15, 0.04, 0.05, D - 0.6, fr, { m: 'paint' });
        g.box(x, 0.13, z0 + 0.1, 0.04, 0.26, 0.04, fr, { m: 'paint' });
        g.box(x, 0.13, 0.3, 0.04, 0.26, 0.04, fr, { m: 'paint' });
        g.cyl(x, 0.07, z1 - 0.12, 0.07, 0.04, '#3a3a3c', { rot: [0, 0, PI / 2], seg: 8, m: 'rubber' });   // wheels at head end
      }
      g.box(0, 0.25, z0 + 0.1, W - 0.06, 0.03, 0.03, fr, { m: 'paint' });
      // teak slats on the flat section
      for (let z = z0 + 0.06; z < 0.48; z += 0.18) g.box(0, 0.3, z, W - 0.1, 0.02, 0.12, K.teak, { m: 'wood' });
      // striped cushion: flat part
      const stripes = (zz0, zz1, y, rx, cz) => {
        const n = 7, w = W - 0.08;
        for (let k = 0; k < n; k++) {
          const x = -w / 2 + (k + 0.5) * (w / n);
          g.box(x, y, cz, w / n + 0.001, 0.07, zz1 - zz0, K.white, { tint: k % 2 === 0, m: 'fabric', rot: [rx, 0, 0] });
        }
      };
      stripes(z0 + 0.03, 0.5, 0.35, 0, (z0 + 0.03 + 0.5) / 2);
      // raised backrest at the head end (+Z), ~40°
      const a = -0.72, L = D / 2 - 0.42, cy = 0.33 + Math.sin(-a) * L / 2, cz = 0.52 + Math.cos(a) * L / 2;
      g.box(0, cy - 0.04, cz, W - 0.1, 0.03, L, K.teak, { rot: [a, 0, 0], m: 'wood' });
      stripes(0, L, cy + 0.02, a, cz);
      g.box(0, cy + 0.2, cz + 0.12, W - 0.24, 0.1, 0.2, K.white, { r: 0.04, steps: 1, m: 'fabric', rot: [a, 0, 0] });  // head pillow
      // folded towel at the foot
      g.box(0, 0.4, z0 + 0.22, W - 0.22, 0.05, 0.26, '#f6f6f2', { r: 0.02, steps: 1, m: 'linen' });
    },
  },
  deck_chair: {
    tints: 'lounger',
    build(g, W, D, H) {
      g.aoH = 0.12;
      // teak armchair with slatted seat and reclined back, loose cushion
      const t = K.teak;
      sqLegs(g, -W / 2 + 0.04, W / 2 - 0.04, -D / 2 + 0.06, D / 2 - 0.05, 0.4, 0.045, t);
      for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) {
        g.box(x, 0.6, 0.02, 0.06, 0.035, D - 0.05, t, { m: 'wood' });                      // armrest
        g.box(x, 0.5, D / 2 - 0.05, 0.045, 0.2, 0.045, t, { m: 'wood' });
      }
      g.box(0, 0.38, 0.0, W - 0.12, 0.025, D - 0.2, t, { m: 'wood' });
      for (let k = 0; k < 5; k++) g.box(0, 0.48 + k * 0.08, -D / 2 + 0.08 - k * 0.025, W - 0.12, 0.06, 0.02, t, { m: 'wood', rot: [-0.3, 0, 0] });
      cushion(g, 0, 0.43, 0.05, W - 0.14, 0.07, D - 0.22);
      cushion(g, 0, 0.66, -D / 2 + 0.12, W - 0.16, 0.36, 0.07, K.white, { rot: [-0.3, 0, 0] });
    },
  },
  bench: {
    tints: 'upholstery',
    variant: (it, room) => (room && room.exterior ? 'teak' : 'gallery'),
    build(g, W, D, H, v) {
      g.aoH = 0.12;
      if (v === 'teak') {
        for (const x of [-W / 2 + 0.12, W / 2 - 0.12]) { g.box(x, 0.2, 0, 0.06, 0.4, D - 0.04, '#3c3d3f', { m: 'iron' }); }
        for (let k = 0; k < 5; k++) g.box(0, 0.43, -D / 2 + 0.06 + k * (D - 0.12) / 4, W, 0.035, 0.08, K.teak, { m: 'wood' });
        return;
      }
      g.box(0, 0.16, 0, W - 0.2, 0.32, D - 0.14, K.walnut, { m: 'wood' });
      g.box(0, 0.05, 0, W - 0.26, 0.1, D - 0.2, K.ink, { m: 'matte' });
      cushion(g, 0, 0.38, 0, W, 0.13, D, K.white, { m: 'leather', steps: 2 });
      for (let k = 1; k < 4; k++) g.box(-W / 2 + k * W / 4, 0.445, 0, 0.01, 0.004, D - 0.1, '#000000', { tint: true, m: 'leather' });
    },
  },

  // ── TABLES ────────────────────────────────────────────────────────────────
  table_r: {
    variant(it, room, W) {
      if (room && room.exterior) return 'teak';
      if (room && room.type === 'dining' && W > 0.8) return 'cloth';
      return 'bistro';
    },
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.15;
      const R = W / 2, top = 0.75;
      if (v === 'cloth') {
        g.cyl(0, top - 0.02, 0, R, 0.03, K.walnut, { seg: 20 });
        tableCloth(g, R - 0.03, top, 0.32);
        g.cyl(0, 0.22, 0, 0.05, 0.44, K.walnutD, { seg: 8 });
        g.cyl(0, 0.02, 0, 0.26, 0.04, K.walnutD, { seg: 10 });
        for (let k = 0; k < 4; k++) setting(g, Math.sin(k * PI / 2 + PI / 4) * (R - 0.17), Math.cos(k * PI / 2 + PI / 4) * (R - 0.17), k * PI / 2 + PI / 4 + PI, top + 0.012);
        centrepiece(g, 0, 0, top + 0.012, rnd);
      } else if (v === 'teak') {
        g.cyl(0, top - 0.02, 0, R, 0.04, K.teak, { seg: 20, m: 'wood' });
        for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; g.pipe([Math.sin(a) * (R - 0.1), top - 0.04, Math.cos(a) * (R - 0.1)], [Math.sin(a) * (R - 0.04), 0, Math.cos(a) * (R - 0.04)], 0.02, K.teakD, { m: 'wood', seg: 5 }); }
      } else {
        const marble = R < 0.4 ? K.marbleD : K.marble;
        g.cyl(0, top - 0.015, 0, R, 0.03, marble, { seg: 22, m: 'marble' });
        g.cyl(0, top - 0.04, 0, R - 0.02, 0.02, K.brass, { seg: 22, m: 'brass' });
        g.cyl(0, 0.38, 0, 0.035, 0.72, K.black, { seg: 8, m: 'iron' });
        g.lathe([[0.001, 0.0], [0.24, 0.0], [0.24, 0.02], [0.05, 0.06], [0.001, 0.07]], 0, 0, 0, K.black, { seg: 12, m: 'iron' });
        // candle lantern
        g.cyl(0, top + 0.05, 0, 0.035, 0.09, '#d9b48a', { seg: 8, glass: true });
        g.cyl(0, top + 0.04, 0, 0.012, 0.03, '#ffcc80', { seg: 6, emi: 1.8 });
      }
    },
  },
  table_r_big: {
    variant: (it, room) => (room && room.type === 'dining' ? 'cloth6' : 'wood'),
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.15;
      const R = W / 2, top = 0.75;
      g.cyl(0, top - 0.02, 0, R, 0.03, K.walnut, { seg: 28 });
      g.cyl(0, 0.22, 0, 0.08, 0.44, K.walnutD, { seg: 10 });
      g.lathe([[0.001, 0], [0.42, 0], [0.42, 0.03], [0.09, 0.08], [0.001, 0.09]], 0, 0, 0, K.walnutD, { seg: 14 });
      if (v === 'cloth6') {
        tableCloth(g, R - 0.02, top, 0.34);
        for (let k = 0; k < 6; k++) { const a = k * PI / 3; setting(g, Math.sin(a) * (R - 0.2), Math.cos(a) * (R - 0.2), a + PI, top + 0.012); }
        centrepiece(g, 0, 0, top + 0.012, rnd);
      } else {
        g.cyl(0, top + 0.004, 0, R - 0.01, 0.01, '#6b4430', { seg: 28, m: 'lacquer' });
        centrepiece(g, 0, 0, top + 0.01, rnd);
      }
    },
  },
  table_sq: {
    variant(it, room) {
      if (room && room.exterior) return 'teak';
      if (room && room.type === 'dining') return 'cloth2';
      return 'bistro';
    },
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.15;
      const top = 0.75;
      if (v === 'teak') {
        sqLegs(g, -W / 2 + 0.05, W / 2 - 0.05, -D / 2 + 0.05, D / 2 - 0.05, top - 0.03, 0.045, K.teak);
        for (let k = 0; k < 6; k++) g.box(-W / 2 + (k + 0.5) * W / 6, top - 0.015, 0, W / 6 - 0.012, 0.03, D, K.teak, { m: 'wood' });
        g.cyl(0, top + 0.05, 0, 0.03, 0.1, '#e4e0d8', { seg: 8, m: 'ceramic' });
        return;
      }
      sqLegs(g, -W / 2 + 0.06, W / 2 - 0.06, -D / 2 + 0.06, D / 2 - 0.06, top - 0.03, 0.045, K.walnutD);
      g.box(0, top - 0.02, 0, W, 0.035, D, v === 'cloth2' ? K.walnut : K.walnut, { m: 'wood', r: 0.01, steps: 1 });
      if (v === 'cloth2') {
        tableCloth(g, 0, top, 0.25, false, W - 0.02, D - 0.02);
        setting(g, 0, D / 2 - 0.2, PI, top + 0.012); setting(g, 0, -D / 2 + 0.2, 0, top + 0.012);
        centrepiece(g, 0.15, 0, top + 0.012, rnd);
      } else {
        g.cyl(0, top + 0.05, 0, 0.035, 0.09, '#d9b48a', { seg: 8, glass: true });
        g.cyl(0, top + 0.04, 0, 0.012, 0.03, '#ffcc80', { seg: 6, emi: 1.8 });
      }
    },
  },
  table_rect: {
    variant: (it, room) => (room && room.type === 'buffet' ? 'cafe' : room && room.exterior ? 'cafe' : room && (room.type === 'dining' || room.type === 'atrium' || room.type === 'lounge' || room.type === 'bar') ? 'cloth' : 'mess'),
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.15;
      const top = 0.75;
      if (v === 'cloth') {
        // banquet table: walnut top, white cloth with drop, place settings down both sides, candles
        sqLegs(g, -W / 2 + 0.08, W / 2 - 0.08, -D / 2 + 0.08, D / 2 - 0.08, top - 0.03, 0.05, K.walnutD);
        g.box(0, top - 0.02, 0, W, 0.035, D, K.walnut, { m: 'wood' });
        tableCloth(g, 0, top, 0.3, false, W - 0.02, D - 0.02);
        const n = Math.max(1, Math.round(W / 0.75));
        for (let k = 0; k < n; k++) { const x = -W / 2 + (k + 0.5) * W / n; setting(g, x, D / 2 - 0.2, PI, top + 0.012); if (D > 0.7) setting(g, x, -D / 2 + 0.2, 0, top + 0.012); }
        centrepiece(g, 0, 0, top + 0.012, rnd);
        return;
      }
      if (v === 'cafe') {
        g.box(0, top - 0.02, 0, W, 0.035, D, K.oakL, { m: 'wood', r: 0.01, steps: 1 });
        for (const x of [-W / 2 + 0.25, W / 2 - 0.25]) {
          g.box(x, (top - 0.04) / 2, 0, 0.05, top - 0.04, 0.05, K.black, { m: 'iron' });
          g.box(x, 0.015, 0, 0.06, 0.03, D - 0.15, K.black, { m: 'iron' });
        }
        g.box(0, top + 0.05, 0, 0.16, 0.09, 0.08, K.chrome, { m: 'chrome' });   // condiment caddy
        g.box(0, top + 0.06, 0, 0.12, 0.1, 0.02, K.white, {});
      } else {
        g.box(0, top - 0.015, 0, W, 0.03, D, '#e9ebec', { m: 'plastic', r: 0.01, steps: 1 });
        g.box(0, top - 0.04, 0, W - 0.05, 0.03, D - 0.05, K.steelD, { m: 'steel' });
        legs4(g, -W / 2 + 0.06, W / 2 - 0.06, -D / 2 + 0.06, D / 2 - 0.06, top - 0.04, 0.02, K.chrome, 'chrome', 0.02);
        g.box(W / 2 - 0.25, top + 0.04, 0, 0.1, 0.08, 0.06, '#c23b2c', { m: 'plastic' });   // sauce bottles
      }
    },
  },
  table_low: {
    build(g, W, D, H) {
      g.aoH = 0.12;
      g.box(0, H - 0.02, 0, W, 0.04, D, K.marble, { m: 'marble', r: 0.008, steps: 1 });
      g.box(0, H - 0.05, 0, W - 0.04, 0.03, D - 0.04, K.walnutD, { m: 'wood' });
      sqLegs(g, -W / 2 + 0.05, W / 2 - 0.05, -D / 2 + 0.05, D / 2 - 0.05, H - 0.05, 0.035, K.brass, 'brass');
      g.box(0, 0.12, 0, W - 0.1, 0.02, D - 0.1, K.walnutD, { m: 'wood' });   // undershelf
      // tray with books & bowl
      g.box(-W * 0.18, H + 0.025, 0, Math.min(0.24, W * 0.3), 0.03, 0.18, '#7a3b2e', { m: 'matte' });
      g.box(-W * 0.18, H + 0.05, 0, Math.min(0.22, W * 0.28), 0.02, 0.16, '#1f3550', { m: 'matte' });
      g.lathe([[0.001, 0], [0.04, 0], [0.09, 0.05], [0.085, 0.055], [0.035, 0.008]], W * 0.2, H, 0, '#d8d2c6', { seg: 12, m: 'ceramic' });
    },
  },
  desk: {
    tints: 'none',
    variant(it, room) {
      if (!room) return 'cabin';
      if (room.type === 'cabin' || room.type === 'suite') return 'cabin';
      if (room.type === 'crew_cabin') return 'crew';
      return 'office';
    },
    build(g, W, D, H, v) {
      g.aoH = 0.15;
      const top = 0.75;
      if (v === 'cabin') {
        g.box(0, top - 0.02, 0, W, 0.04, D, K.walnut, { m: 'wood', r: 0.008, steps: 1 });
        g.box(W / 2 - 0.22, (top - 0.04) / 2 + 0.02, 0, 0.42, top - 0.06, D - 0.04, K.walnut, { m: 'wood' });   // drawer pedestal
        for (const y of [0.2, 0.42, 0.62]) { g.box(W / 2 - 0.22, y, D / 2 - 0.01, 0.4, 0.004, 0.004, K.walnutD, {}); g.box(W / 2 - 0.22, y + 0.08, D / 2 - 0.005, 0.12, 0.012, 0.012, K.brass, { m: 'brass' }); }
        g.box(-W / 2 + 0.03, (top - 0.04) / 2, 0, 0.04, top - 0.04, D - 0.04, K.walnut, { m: 'wood' });
        g.box(0, top - 0.25, -D / 2 + 0.02, W - 0.08, 0.36, 0.02, K.walnutD, { m: 'wood' });
        // lamp, leather blotter, phone
        g.cyl(-W / 2 + 0.2, top + 0.012, -0.08, 0.07, 0.024, K.brass, { seg: 10, m: 'brass' });
        g.cyl(-W / 2 + 0.2, top + 0.2, -0.08, 0.008, 0.36, K.brass, { seg: 5, m: 'brass' });
        g.lathe([[0.06, 0], [0.11, -0.13], [0.105, -0.135], [0.055, -0.005]], -W / 2 + 0.2, top + 0.5, -0.08, '#f2e8d2', { seg: 12, m: 'fabric' });
        g.cyl(-W / 2 + 0.2, top + 0.42, -0.08, 0.05, 0.04, '#ffe0a8', { seg: 8, emi: 1.3 });
        g.box(0.05, top + 0.004, 0.02, 0.45, 0.006, 0.32, '#3d2a1e', { m: 'leather' });
        g.box(0.22, top + 0.03, -0.12, 0.16, 0.05, 0.12, K.ink, { m: 'plastic' });
      } else if (v === 'crew') {
        g.box(0, top - 0.015, 0, W, 0.03, D, K.oakL, { m: 'wood' });
        g.box(W / 2 - 0.02, top / 2, 0, 0.03, top, D - 0.02, K.greyL, {});
        g.box(-W / 2 + 0.02, top / 2, 0, 0.03, top, D - 0.02, K.greyL, {});
        g.box(-0.2, top + 0.13, -0.1, 0.36, 0.24, 0.02, K.ink, {});   // laptop lid
        g.box(-0.2, top + 0.13, -0.088, 0.33, 0.21, 0.004, '#2a4a6a', { emi: SCR.ui });
        g.box(-0.2, top + 0.008, 0.04, 0.36, 0.012, 0.24, K.greyD, {});
      } else {
        g.box(0, top - 0.015, 0, W, 0.03, D, '#d9d4cb', { m: 'plastic' });
        g.box(W / 2 - 0.22, (top - 0.03) / 2, 0, 0.42, top - 0.03, D - 0.04, K.greyL, { m: 'paint' });
        g.box(-W / 2 + 0.03, (top - 0.03) / 2, 0, 0.04, top - 0.03, D - 0.04, K.greyL, { m: 'paint' });
        // monitor + keyboard
        g.box(0, top + 0.01, -0.12, 0.2, 0.02, 0.14, K.black, {});
        g.box(0, top + 0.12, -0.14, 0.04, 0.2, 0.03, K.black, {});
        g.box(0, top + 0.31, -0.14, 0.56, 0.34, 0.03, K.black, { r: 0.008, steps: 1 });
        g.box(0, top + 0.31, -0.124, 0.53, 0.31, 0.004, '#3b6a8a', { emi: SCR.uiLight });
        g.box(0, top + 0.012, 0.08, 0.44, 0.02, 0.14, '#2a2b2e', {});
        g.box(0.3, top + 0.012, 0.08, 0.06, 0.02, 0.1, '#2a2b2e', {});
        g.box(-W / 2 + 0.25, top + 0.06, 0.0, 0.22, 0.1, 0.3, '#ece8de', {});   // paper tray / files
      }
    },
  },
  vanity: {
    build(g, W, D, H) {
      g.aoH = 0.15;
      const top = 0.75;
      g.box(0, top - 0.02, 0, W, 0.04, D, K.walnut, { m: 'wood', r: 0.008, steps: 1 });
      g.box(-W / 2 + 0.2, (top - 0.04) / 2, 0, 0.38, top - 0.04, D - 0.04, K.walnut, { m: 'wood' });
      g.box(W / 2 - 0.2, (top - 0.04) / 2, 0, 0.38, top - 0.04, D - 0.04, K.walnut, { m: 'wood' });
      for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) for (const y of [0.25, 0.5]) g.box(x, y, D / 2 - 0.005, 0.1, 0.012, 0.012, K.brass, { m: 'brass' });
      // mirror with frame and light halo
      g.box(0, top + 0.5, -D / 2 + 0.02, W * 0.7, 0.8, 0.03, K.brass, { r: 0.01, steps: 1, m: 'brass' });
      g.box(0, top + 0.5, -D / 2 + 0.037, W * 0.7 - 0.05, 0.75, 0.004, K.mirror, { m: 'chrome' });
      g.box(0, top + 0.93, -D / 2 + 0.04, W * 0.6, 0.02, 0.02, '#fff0d4', { emi: 1.4 });
      for (let k = 0; k < 3; k++) g.cyl(W * 0.2 + k * 0.06, top + 0.06, 0.02, 0.018, 0.1 + k * 0.03, ['#c9a0b2', '#e8e2d0', '#9a6e4a'][k], { seg: 8, m: 'gloss' });
    },
  },
  tv: {
    variant: (it) => ((Math.abs(Math.round(it.x * 7 + it.z * 13)) % 9) < 2 ? 'on' : 'off'),
    build(g, W, D, H, v) {
      g.box(0, H / 2, 0, W, H, D * 0.6, K.black, { r: 0.008, steps: 1, m: 'plastic' });
      g.box(0, H / 2, D * 0.31, W - 0.03, H - 0.03, 0.003, v === 'on' ? '#4a6a8a' : K.screenOff, v === 'on' ? { emi: SCR.show } : { m: 'screen' });
      g.box(0, H / 2, -D * 0.4, W * 0.3, H * 0.3, D * 0.2, K.greyD, {});
      g.box(0, 0.012, D * 0.31, 0.02, 0.006, 0.003, v === 'on' ? '#ffffff' : '#ff3020', { emi: 1.0 });
    },
  },
  wardrobe: {
    build(g, W, D, H) {
      g.aoH = 0.2;
      g.box(0, 0.04, 0, W - 0.04, 0.08, D - 0.04, K.walnutD, { m: 'wood' });
      g.bx(-W / 2, 0.08, -D / 2, W / 2, H, D / 2 - 0.03, K.walnut, { m: 'wood' });
      for (const s of [-1, 1]) {
        g.box(s * W / 4, (H + 0.08) / 2, D / 2 - 0.015, W / 2 - 0.012, H - 0.1, 0.03, K.walnut, { m: 'wood', r: 0.004, steps: 1 });
        g.box(s * 0.04, 1.05, D / 2 + 0.005, 0.016, 0.42, 0.02, K.brass, { m: 'brass' });
      }
      g.box(0, H - 0.04, 0, W, 0.06, D, K.walnutD, { m: 'wood' });
    },
  },
  bath_pod: {
    build(g, W, D, H) {
      // factory bathroom pod seen from the cabin: wall panels + door on +Z face
      const wall = '#e7e0d3';
      g.bx(-W / 2, 0, -D / 2, W / 2, H, D / 2 - 0.02, wall, { m: 'paint', noShade: true });
      g.box(0, 0.05, D / 2 - 0.01, W, 0.1, 0.02, K.walnutD, { m: 'wood' });                     // skirting
      const dx = W / 2 - 0.55;
      g.box(dx, 1.06, D / 2 - 0.005, 0.9, 2.08, 0.05, '#6e4c34', { m: 'wood' });                 // frame
      g.box(dx, 1.04, D / 2 + 0.012, 0.8, 2.0, 0.03, K.walnut, { m: 'wood' });                   // door leaf
      g.box(dx - 0.3, 1.0, D / 2 + 0.04, 0.14, 0.02, 0.03, K.chrome, { m: 'chrome' });
      g.box(dx - 0.33, 1.0, D / 2 + 0.03, 0.03, 0.03, 0.02, K.chrome, { m: 'chrome' });
      g.box(0, H - 0.04, 0, W, 0.08, D, '#f2efe8', { m: 'paint' });                             // cornice
      // full-height mirror panel beside the door
      if (W > 1.6) g.box(-W / 2 + 0.35, 1.25, D / 2 + 0.0, 0.5, 1.5, 0.02, K.mirror, { m: 'chrome' });
    },
  },

  // ── BARS & DINING SERVICE ─────────────────────────────────────────────────
  bar_counter: {
    tints: 'barFront',
    variant: (it, room) => (room && room.exterior ? 'pool' : 'lounge'),
    build(g, W, D, H, v) {
      g.aoH = 0.25;
      const top = H;
      const front = v === 'pool' ? '#eeeae2' : '#ffffff';
      // customer front (+Z): fluted panel, tinted (wood/leather tone)
      g.box(0, 0.06, D / 2 - 0.12, W - 0.04, 0.12, 0.08, K.ink, { m: 'matte' });                 // recessed kick
      const nF = Math.max(4, Math.round(W / 0.12));
      g.bx(-W / 2, 0.12, -D / 2 + 0.08, W / 2, top - 0.08, D / 2 - 0.08, front, { tint: v !== 'pool', m: 'wood' });
      for (let k = 0; k < nF; k++) {
        const x = -W / 2 + (k + 0.5) * (W / nF);
        g.cyl(x, (top + 0.04) / 2, D / 2 - 0.08, (W / nF) * 0.45, top - 0.2, front, { seg: 6, thetaStart: -PI / 2, theta: PI, tint: v !== 'pool', m: 'wood' });
      }
      // LED strip under the top overhang (warm, blooms at night)
      g.box(0, top - 0.1, D / 2 - 0.04, W - 0.1, 0.012, 0.012, '#ffc27a', { emi: 4.9 });
      // counter top with overhang & bull-nose
      g.box(0, top - 0.03, 0.02, W, 0.06, D - 0.04 + 0.02, v === 'pool' ? K.teak : K.marbleD, { m: v === 'pool' ? 'wood' : 'marble', r: 0.02, steps: 1 });
      g.box(0, top + 0.004, D / 2 - 0.06, W - 0.02, 0.006, 0.1, v === 'pool' ? K.teakD : K.brass, { m: v === 'pool' ? 'wood' : 'brass' });
      // brass foot rail with brackets
      if (D > 0.5) {
        g.pipe([-W / 2 + 0.1, 0.2, D / 2 - 0.02], [W / 2 - 0.1, 0.2, D / 2 - 0.02], 0.022, K.brass, { m: 'brass', seg: 8 });
        for (let x = -W / 2 + 0.3; x < W / 2 - 0.2; x += 1.2) g.box(x, 0.2, D / 2 - 0.06, 0.03, 0.03, 0.08, K.brass, { m: 'brass' });
      }
      // bartender side: lower work shelf, sinks, taps, glass rack
      g.box(0, top - 0.3, -D / 2 + 0.12, W - 0.06, 0.04, 0.22, K.steel, { m: 'steel' });
      for (let x = -W / 2 + 0.6; x < W / 2 - 0.4; x += 1.8) {
        g.box(x, top - 0.27, -D / 2 + 0.12, 0.35, 0.02, 0.18, '#7f878e', { m: 'steel' });
        g.box(x + 0.6, top + 0.15, 0.0, 0.3, 0.06, 0.05, K.chrome, { m: 'chrome' });      // tap tower
        for (let t = 0; t < 3; t++) g.cyl(x + 0.5 + t * 0.1, top + 0.24, 0.0, 0.012, 0.14, ['#c9a050', '#222', '#a0281e'][t], { seg: 6, m: 'gloss' });
        for (let t = 0; t < 3; t++) g.cyl(x + 0.5 + t * 0.1, top + 0.08, 0.0, 0.008, 0.14, K.chrome, { seg: 5, m: 'chrome' });
      }
      // cocktail glasses & a lamp on the top
      for (let x = -W / 2 + 0.5; x < W / 2 - 0.3; x += 1.5) {
        g.lathe([[0.001, 0], [0.035, 0], [0.004, 0.005], [0.004, 0.08], [0.05, 0.13]], x, top, 0.12, K.glass, { seg: 8, glass: true });
        g.cyl(x + 0.45, top + 0.05, 0.05, 0.035, 0.1, '#e9c58a', { seg: 8, emi: 1.4 });
      }
    },
  },
  back_bar: {
    tints: 'barFront',
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.2;
      const cab = 0.95;
      g.bx(-W / 2, 0, -D / 2, W / 2, cab, D / 2, K.walnutD, { m: 'wood' });
      const nd = Math.max(2, Math.round(W / 0.6));
      for (let k = 0; k < nd; k++) {
        const x = -W / 2 + (k + 0.5) * W / nd;
        g.box(x, cab / 2 + 0.04, D / 2 + 0.008, W / nd - 0.02, cab - 0.12, 0.016, K.walnut, { m: 'wood' });
        g.box(x, cab - 0.12, D / 2 + 0.02, 0.1, 0.01, 0.01, K.brass, { m: 'brass' });
      }
      g.box(0, cab + 0.015, 0.0, W, 0.03, D, K.marbleD, { m: 'marble' });
      if (H <= 1.2) { // low back counter (pool bar): just stock on top
        for (let x = -W / 2 + 0.1; x < W / 2 - 0.1; x += 0.14) bottle(g, x, cab + 0.03, -D / 2 + 0.12, rnd);
        return;
      }
      // mirrored, back-lit rear wall with glowing shelves of bottles
      g.box(0, (cab + H) / 2, -D / 2 + 0.015, W, H - cab, 0.03, '#2d2620', { m: 'wood' });
      g.box(0, (cab + H - 0.15) / 2 + 0.02, -D / 2 + 0.035, W - 0.1, H - cab - 0.2, 0.005, '#9a7f62', { emi: 0.55 });
      const shelves = [cab + 0.32, cab + 0.66, cab + 1.0];
      for (const sy of shelves) {
        if (sy > H - 0.1) continue;
        g.box(0, sy - 0.01, -D / 2 + 0.16, W - 0.08, 0.02, 0.26, K.glass, { glass: true });
        g.box(0, sy - 0.025, -D / 2 + 0.28, W - 0.08, 0.01, 0.012, '#ffcf8a', { emi: 4.6 });
        for (let x = -W / 2 + 0.1; x < W / 2 - 0.1; x += 0.13 + rnd() * 0.06) bottle(g, x, sy, -D / 2 + 0.1 + rnd() * 0.12, rnd, true);
      }
      for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) g.box(x, (cab + H) / 2, 0, 0.06, H - cab, D, K.walnutD, { m: 'wood' });
      g.box(0, H - 0.05, 0.0, W, 0.1, D, K.walnutD, { m: 'wood' });
      g.box(0, H - 0.11, D / 2 - 0.05, W - 0.1, 0.012, 0.012, '#ffcf8a', { emi: 1.6 });
    },
  },

  // ── CASINO ────────────────────────────────────────────────────────────────
  slot: {
    tints: 'slot',
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.15;
      const body = '#141418', trim = '#2a2a30';
      // base cabinet with lit belly glass
      g.box(0, 0.36, -0.05, W - 0.04, 0.72, D - 0.16, body, { r: 0.02, steps: 1, m: 'gloss' });
      g.box(0, 0.44, D / 2 - 0.129, W - 0.16, 0.34, 0.006, '#b0b0b0', { emi: 0.35, tint: true });
      g.box(0, 0.08, D / 2 - 0.12, W - 0.08, 0.04, 0.02, K.chrome, { m: 'chrome' });
      // button deck
      g.box(0, 0.78, D / 2 - 0.17, W - 0.04, 0.07, 0.26, trim, { r: 0.015, steps: 1, m: 'gloss', rot: [0.25, 0, 0] });
      for (let k = 0; k < 5; k++) g.box(-0.22 + k * 0.11, 0.825, D / 2 - 0.11, 0.07, 0.016, 0.045, ['#ff3b3b', '#ffd23b', '#3bff6e', '#3bb4ff', '#ffffff'][k], { emi: 1.2, rot: [0.25, 0, 0] });
      g.box(0.22, 0.83, D / 2 - 0.2, 0.08, 0.01, 0.04, '#1a1a1a', { rot: [0.25, 0, 0] });   // bill acceptor
      // curved main screen housing + reels screen
      g.box(0, 1.1, -0.06, W - 0.04, 0.56, D - 0.26, body, { r: 0.02, steps: 1, m: 'gloss' });
      g.box(0, 1.12, D / 2 - 0.19, W - 0.1, 0.48, 0.02, '#050506', { rot: [-0.12, 0, 0] });
      g.box(0, 1.12, D / 2 - 0.178, W - 0.14, 0.44, 0.004, '#ffffff', { emi: SCR.reels, rot: [-0.12, 0, 0] });
      // upper bonus screen
      g.box(0, 1.53, -0.1, W - 0.06, 0.3, D - 0.36, body, { r: 0.02, steps: 1, m: 'gloss' });
      g.box(0, 1.53, D / 2 - 0.278, W - 0.14, 0.24, 0.004, '#ffffff', { emi: SCR.topper });
      // rounded topper with a thin tinted light ring
      g.cyl(0, 1.72, -0.1, (W - 0.06) / 2, 0.14, body, { rot: [PI / 2, 0, 0], sz: 0.5, seg: 16, thetaStart: -PI / 2, theta: PI, m: 'gloss' });
      g.box(0, 1.69, 0.02, W - 0.1, 0.012, 0.01, '#c0c0c0', { emi: 0.5, tint: true });
      // side light pipes (thin, tinted)
      for (const x of [-W / 2 + 0.018, W / 2 - 0.018]) g.box(x, 1.05, D / 2 - 0.16, 0.008, 1.0, 0.008, '#a0a0a0', { emi: 0.4, tint: true });
      // stool in front (the NPC seat anchor sits 0.75 m in front of the cabinet)
      g.cyl(0, 0.36, 0.78, 0.03, 0.66, K.chrome, { seg: 8, m: 'chrome' });
      g.cyl(0, 0.02, 0.78, 0.17, 0.03, K.chrome, { seg: 12, m: 'chrome' });
      g.lathe([[0.001, 0.68], [0.18, 0.68], [0.19, 0.71], [0.17, 0.74], [0.001, 0.745]], 0, 0, 0.78, '#6a1824', { seg: 14, m: 'leather' });
      g.box(0, 0.86, 0.62, 0.3, 0.16, 0.04, '#6a1824', { r: 0.02, steps: 1, m: 'leather', rot: [-0.15, 0, 0] });
    },
  },
  card_table: {
    tints: 'felt',
    build(g, W, D, H) {
      g.aoH = 0.15;
      const top = 0.8;
      // kidney / half-ellipse outline: flat dealer edge at -Z, arc toward players (+Z)
      const pts = [];
      const rx = W / 2, rz = D - 0.05;
      for (let k = 0; k <= 20; k++) { const a = PI * k / 20; pts.push([Math.cos(a) * rx, -D / 2 + Math.sin(a) * rz]); }
      const shape = pts.map(([x, z]) => [x, -z]);   // XY shape (y = -z) then rotate -90° about X
      const rot = mat4(0, 0, 0, -PI / 2, 0, 0);
      const ext = (scale, y0, depth, col, o) => {
        const s = shape.map(([x, y]) => [x * scale, (y + D / 2) * scale - D / 2]);
        g.ext(s, depth, col, { ...o, mat: mat4(0, y0, 0, -PI / 2, 0, 0) });
      };
      ext(1.0, top - 0.06, 0.06, '#3a2015', { m: 'leather' });                 // padded rail (lower)
      ext(0.94, top - 0.02, 0.02, K.white, { tint: true, m: 'felt' });         // felt
      g.torus(0, top - 0.035, -D / 2, rx - 0.03, 0.04, '#3a2015', { rot: [PI / 2, 0, 0], arc: PI, ts: 22, rs: 6, s: [1, rz / rx, 1], m: 'leather' });
      // betting circles
      for (let k = 0; k < 5; k++) { const a = PI * (0.2 + 0.15 * k); g.torus(Math.cos(a) * rx * 0.62, top + 0.002, -D / 2 + Math.sin(a) * rz * 0.62, 0.07, 0.006, '#e8e2d0', { rot: [PI / 2, 0, 0], ts: 12, rs: 3 }); }
      // apron, pedestals
      g.box(0, top - 0.12, -D / 2 + 0.3, W - 0.4, 0.12, 0.5, K.walnutD, { m: 'wood' });
      for (const x of [-W / 2 + 0.45, W / 2 - 0.45]) g.box(x, (top - 0.1) / 2, -D / 2 + 0.35, 0.18, top - 0.1, 0.18, K.walnutD, { m: 'wood' });
      // dealer chip tray, shoe and cards
      g.box(0, top + 0.01, -D / 2 + 0.12, 0.6, 0.03, 0.14, '#1d1d1f', { m: 'gloss' });
      for (let k = 0; k < 8; k++) g.cyl(-0.26 + k * 0.075, top + 0.03, -D / 2 + 0.12, 0.018, 0.04, ['#c23b2c', '#2a6fc2', '#2c9a4a', '#111', '#e8e2d0'][k % 5], { rot: [PI / 2, 0, 0], seg: 8 });
      g.box(W / 2 - 0.35, top + 0.05, -D / 2 + 0.2, 0.14, 0.09, 0.22, '#7a1f1f', { m: 'gloss', rot: [0, 0.4, 0] });
      for (let k = 0; k < 5; k++) g.box(-0.4 + k * 0.2, top + 0.003, 0.05 + Math.sin(k) * 0.05, 0.06, 0.003, 0.085, K.white, { rot: [0, 0.2 * k, 0] });
      // table limit sign
      g.box(-W / 2 + 0.35, top + 0.07, -D / 2 + 0.12, 0.14, 0.1, 0.02, '#ffd27a', { emi: 1.6 });
    },
  },
  roulette: {
    tints: 'felt',
    build(g, W, D, H) {
      g.aoH = 0.15;
      const top = 0.85;
      g.box(0, top - 0.06, 0, W, 0.08, D, '#3a2015', { r: 0.035, steps: 1, m: 'leather' });
      g.box(-0.3, top - 0.015, 0, W - 0.75, 0.01, D - 0.2, K.white, { tint: true, m: 'felt' });
      // betting layout: 3 × 12 number grid, red/black + green zero
      const gx0 = -W / 2 + 0.25, gw = W - 1.35, cw = gw / 12, ch = (D - 0.55) / 3;
      for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) {
        const n = i * 3 + j + 1;
        const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n);
        g.box(gx0 + (i + 0.5) * cw, top - 0.007, -D / 2 + 0.2 + (j + 0.5) * ch, cw - 0.012, 0.004, ch - 0.012, red ? '#9e1b1b' : '#141414', { m: 'felt' });
      }
      g.box(gx0 - 0.06, top - 0.007, -D / 2 + 0.2 + 1.5 * ch, 0.1, 0.004, ch * 3 - 0.01, '#1c6b3a', { m: 'felt' });
      for (let k = 0; k < 3; k++) g.box(gx0 + (k * 4 + 2) * cw, top - 0.007, D / 2 - 0.22, cw * 4 - 0.02, 0.004, 0.14, '#1c4f34', { m: 'felt' });
      // wheel bowl (+X end)
      const wx = W / 2 - 0.5;
      g.lathe([[0.45, top - 0.1], [0.46, top + 0.03], [0.42, top + 0.04], [0.36, top + 0.0], [0.3, top - 0.02]], wx, 0, 0, K.walnut, { seg: 28, m: 'lacquer' });
      for (let k = 0; k < 37; k++) {
        const a = k * TAU / 37;
        g.box(wx + Math.sin(a) * 0.24, top - 0.018, Math.cos(a) * 0.24, 0.035, 0.012, 0.09, k === 0 ? '#1c8a3a' : k % 2 ? '#a51c1c' : '#141414', { rot: [0, a, 0] });
      }
      g.cyl(wx, top - 0.01, 0, 0.17, 0.03, '#7a4a28', { seg: 16, m: 'lacquer' });
      g.lathe([[0.04, top + 0.01], [0.02, top + 0.06], [0.008, top + 0.12], [0.001, top + 0.13]], wx, 0, 0, K.gold, { seg: 10, m: 'gold' });
      for (let k = 0; k < 4; k++) { const a = k * PI / 2; g.pipe([wx, top + 0.07, 0], [wx + Math.sin(a) * 0.09, top + 0.06, Math.cos(a) * 0.09], 0.006, K.gold, { m: 'gold', seg: 4 }); }
      // base
      for (const x of [-W / 2 + 0.4, W / 2 - 0.5]) g.box(x, (top - 0.1) / 2, 0, 0.3, top - 0.1, D - 0.5, K.walnutD, { m: 'wood' });
      g.box(-W / 2 + 0.6, top + 0.05, D / 2 - 0.15, 0.14, 0.1, 0.02, '#ffd27a', { emi: 1.6 });
      for (let k = 0; k < 6; k++) g.cyl(-0.2 + k * 0.05, top + 0.0 + k * 0.004, -0.1, 0.018, 0.004, ['#c23b2c', '#2a6fc2', '#e8e2d0'][k % 3], { seg: 8 });
    },
  },

  // ── DECOR & PLANTS ────────────────────────────────────────────────────────
  plant: {
    jitter: true,
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      const r = W / 2 - 0.04;
      g.lathe([[0.001, 0], [r * 0.75, 0], [r * 0.95, 0.38], [r, 0.48], [r - 0.02, 0.5], [r * 0.9, 0.46]], 0, 0, 0, '#2c2d30', { seg: 16, m: 'ceramic' });
      g.cyl(0, 0.45, 0, r * 0.88, 0.02, K.soil, { seg: 12, m: 'soil' });
      // fiddle-leaf style: three stems with broad leaves
      for (let s = 0; s < 3; s++) {
        const a0 = s * TAU / 3 + rnd() * 0.5, lean = 0.05 + rnd() * 0.08;
        const sx = Math.sin(a0) * lean, sz = Math.cos(a0) * lean;
        const top = H - 0.15 - rnd() * 0.25;
        g.pipe([sx * 0.4, 0.45, sz * 0.4], [sx * 2, top, sz * 2], 0.012, '#5a4632', { seg: 5 });
        const n = 7;
        for (let k = 0; k < n; k++) {
          const t = 0.35 + 0.65 * k / (n - 1);
          const px = sx * 0.4 + (sx * 2 - sx * 0.4) * t, py = 0.45 + (top - 0.45) * t, pz = sz * 0.4 + (sz * 2 - sz * 0.4) * t;
          const a = a0 + k * 2.4 + rnd();
          const L = 0.18 + rnd() * 0.06, Wd = 0.09;
          const dx = Math.sin(a), dz = Math.cos(a);
          const pts = [], side = [];
          for (let q = 0; q <= 3; q++) { const u = q / 3; pts.push([px + dx * L * u, py + 0.06 * u - 0.05 * u * u, pz + dz * L * u]); const wv = Wd * Math.sin(PI * Math.min(0.95, u * 0.9 + 0.08)); side.push([dz * wv, 0, -dx * wv]); }
          g.ribbon(pts, side, k % 2 ? K.leaf : K.leafD, { m: 'leaf', fold: 0.15, back: K.leafD });
        }
      }
    },
  },
  palm: {
    jitter: true,
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      // square teak planter box with stone top
      g.box(0, 0.3, 0, W - 0.02, 0.6, D - 0.02, K.teak, { m: 'wood', r: 0.02, steps: 1 });
      for (let k = -2; k <= 2; k++) g.box(k * W / 5, 0.3, D / 2 - 0.005, 0.01, 0.56, 0.006, K.teakD, {});
      g.box(0, 0.6, 0, W, 0.04, D, '#cfc8bb', { m: 'stone' });
      g.box(0, 0.6, 0, W - 0.16, 0.05, D - 0.16, K.soil, { m: 'soil' });
      // segmented, slightly curved trunk
      const segs = 9, tH = H - 0.6;
      let px = 0, pz = 0, lean = 0.12 + rnd() * 0.1, la = rnd() * TAU;
      const trunk = [];
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        trunk.push([Math.sin(la) * lean * t * t, 0.62 + tH * 0.82 * t, Math.cos(la) * lean * t * t]);
      }
      for (let k = 0; k < segs; k++) {
        const a = trunk[k], b = trunk[k + 1], r0 = 0.13 - 0.05 * k / segs;
        g.pipe(a, b, r0 * 0.9, k % 2 ? '#7d6a52' : '#6e5c46', { r2: r0, seg: 8, m: 'wood' });
        g.cyl(a[0], a[1] + 0.02, a[2], r0 * 1.08, 0.05, '#5b4a38', { seg: 8, r2: r0 * 0.95 });
      }
      const crown = trunk[segs];
      // coconuts
      for (let k = 0; k < 4; k++) g.sph(crown[0] + Math.sin(k * 1.7) * 0.1, crown[1] - 0.08, crown[2] + Math.cos(k * 1.7) * 0.1, 0.07, '#5a4a26', { seg: 6 });
      // fronds: drooping folded ribbons with leaflet zig-zag width
      const nF = 11;
      for (let f = 0; f < nF; f++) {
        const a = f * TAU / nF + rnd() * 0.3, elev = 0.5 - (f % 3) * 0.35 + rnd() * 0.2;
        const L = 1.5 + rnd() * 0.4;
        const dx = Math.sin(a), dz = Math.cos(a);
        const pts = [], side = [];
        const n = 8;
        for (let q = 0; q <= n; q++) {
          const u = q / n;
          const horiz = L * u, droop = horiz * Math.sin(elev) - 1.1 * u * u * L * 0.5;
          pts.push([crown[0] + dx * horiz * Math.cos(elev * 0.5), crown[1] + droop, crown[2] + dz * horiz * Math.cos(elev * 0.5)]);
          const wv = 0.26 * Math.sin(PI * Math.min(1, u * 1.05)) * (q % 2 ? 1 : 0.75) + 0.02;
          side.push([dz * wv, 0, -dx * wv]);
        }
        g.ribbon(pts, side, f % 2 ? '#4f7d34' : '#3f6b2c', { m: 'leaf', fold: 0.35, back: '#365c26' });
      }
    },
  },
  planter: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      g.box(0, 0.32, 0, W, 0.64, D, '#d8d2c6', { r: 0.02, steps: 1, m: 'stone' });
      g.box(0, 0.655, 0, W + 0.0, 0.03, D, K.walnut, { m: 'wood' });
      g.box(0, 0.66, 0, W - 0.1, 0.03, D - 0.1, K.soil, { m: 'soil' });
      const n = Math.round(W / 0.22);
      for (let k = 0; k < n; k++) {
        const x = -W / 2 + 0.12 + k * (W - 0.24) / (n - 1);
        if (k % 3 === 1) {
          // ornamental grass tuft
          for (let b = 0; b < 6; b++) {
            const a = b * 1.05 + rnd(), L = 0.3 + rnd() * 0.15;
            const pts = [[x, 0.68, 0], [x + Math.sin(a) * L * 0.25, 0.68 + L * 0.7, Math.cos(a) * L * 0.25], [x + Math.sin(a) * L * 0.55, 0.68 + L * 0.85, Math.cos(a) * L * 0.55]];
            g.ribbon(pts, [[0.015, 0, 0], [0.01, 0, 0], [0.002, 0, 0]], '#8a9a52', { m: 'leaf' });
          }
        } else {
          for (let b = 0; b < 3; b++) g.sph(x + (rnd() - 0.5) * 0.1, 0.74 + rnd() * 0.08, (rnd() - 0.5) * (D - 0.25), 0.1 + rnd() * 0.04, b % 2 ? K.leaf : K.leafD, { seg: 7, m: 'leaf' });
        }
      }
    },
  },
  sculpture: {
    build(g, W, D, H) {
      g.aoH = 0.0;
      const s = H / 5;
      // polished black stone plinth with brass inlay ring
      g.lathe([[0.001, 0], [W / 2 - 0.05, 0], [W / 2, 0.04], [W / 2, 0.38 * s], [W / 2 - 0.04, 0.42 * s], [0.001, 0.42 * s]], 0, 0, 0, '#1d1b1c', { seg: 32, m: 'marble' });
      g.torus(0, 0.3 * s, 0, W / 2 + 0.002, 0.012, K.brass, { rot: [PI / 2, 0, 0], ts: 32, rs: 4, m: 'brass' });
      // "Tidal Sail": three bronze ribbons twisting upward like a wave curling into a sail
      const base = 0.42 * s;
      for (let r = 0; r < 3; r++) {
        const pts = [], side = [];
        const n = 28, ph = r * TAU / 3;
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const rad = (W / 2 - 0.25) * (0.35 + 0.65 * Math.sin(PI * (0.15 + 0.7 * t))) * (1 - 0.3 * t);
          const a = ph + t * PI * 1.6;
          const y = base + (H - base - 0.1) * t;
          pts.push([Math.cos(a) * rad, y, Math.sin(a) * rad]);
          const wv = 0.06 + 0.32 * Math.sin(PI * t) * (r === 0 ? 1.2 : 0.85);
          const tw = a + PI / 2 + t * 1.2;
          side.push([Math.cos(tw) * wv * 0.35, wv, Math.sin(tw) * wv * 0.35]);
        }
        g.ribbon(pts, side, r === 0 ? '#b07a3e' : '#8e5d2e', { m: 'bronze', back: '#6e4622' });
      }
      // polished brass sphere ("the sun") caught in the curl
      g.sph(0.08, H * 0.7, -0.05, 0.16 * s, K.gold, { seg: 16, m: 'gold' });
      // uplights in the plinth top
      for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; g.cyl(Math.cos(a) * (W / 2 - 0.15), 0.42 * s + 0.003, Math.sin(a) * (W / 2 - 0.15), 0.03, 0.006, '#fff2d0', { seg: 8, emi: 1.8 }); }
    },
  },
  piano: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      // grand piano case outline (XY → laid flat), keyboard at -Z
      const pts = [];
      const hw = W / 2, z0 = -D / 2 + 0.12;
      pts.push([-hw, z0], [hw, z0], [hw, z0 + 0.55]);
      for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push([hw - (hw * 0.9) * Math.sin(t * PI / 2) * 0.6, z0 + 0.55 + t * 0.6]); }
      for (let k = 0; k <= 12; k++) { const t = k / 12; const a = PI * t; pts.push([hw * 0.45 * Math.cos(a) - hw * 0.15, D / 2 - 0.25 + Math.sin(a) * 0.25]); }
      pts.push([-hw, z0 + 0.9]);
      const shape = pts.map(([x, z]) => [x, -z]);
      g.ext(shape, 0.32, K.black, { mat: mat4(0, 0.6, 0, -PI / 2, 0, 0), m: 'lacquer' });
      g.ext(shape, 0.012, K.black, { mat: mat4(0, 0.92, 0, -PI / 2, 0, 0), m: 'lacquer' });
      // lid propped open on a stick
      const lid = shape.map(([x, y]) => [x, y]);
      g.ext(lid, 0.015, K.black, { mat: mat4(hw - 0.02, 0.935, 0, -PI / 2, 0, -0.75, 1, 1, 1, 'ZXY').multiply(mat4(-hw, 0, 0)), m: 'lacquer' });
      g.pipe([hw - 0.12, 0.93, 0.15], [hw - 0.1, 1.55, 0.15], 0.008, K.black, { seg: 4 });
      // keyboard
      g.box(0, 0.7, -D / 2 + 0.1, W - 0.06, 0.08, 0.22, K.black, { m: 'lacquer' });
      g.box(0, 0.745, -D / 2 + 0.07, W - 0.16, 0.02, 0.15, K.white, { m: 'gloss' });
      for (let k = 0; k < 36; k++) if (k % 7 !== 2 && k % 7 !== 6) g.box(-W / 2 + 0.1 + k * (W - 0.2) / 36, 0.762, -D / 2 + 0.1, 0.014, 0.015, 0.08, K.black, {});
      g.box(0, 0.86, -D / 2 + 0.18, W - 0.2, 0.18, 0.02, K.black, { rot: [-0.25, 0, 0], m: 'lacquer' });   // music desk
      // legs & lyre
      for (const [x, z] of [[-hw + 0.1, z0 + 0.1], [hw - 0.1, z0 + 0.1], [-hw * 0.1, D / 2 - 0.35]]) g.cyl(x, 0.3, z, 0.05, 0.6, K.black, { seg: 8, r2: 0.06, m: 'lacquer' });
      g.box(0, 0.3, z0 + 0.12, 0.12, 0.5, 0.03, K.black, {});
      for (let k = -1; k <= 1; k++) g.box(k * 0.05, 0.06, z0 + 0.06, 0.03, 0.01, 0.08, K.brass, { m: 'brass' });
      // bench for the pianist (sits just outside the case, see report)
      g.box(0, 0.48, -D / 2 - 0.2, 0.75, 0.06, 0.32, K.black, { m: 'leather', r: 0.02, steps: 1 });
      sqLegs(g, -0.32, 0.32, -D / 2 - 0.33, -D / 2 - 0.07, 0.45, 0.04, K.black, 'lacquer');
    },
  },
  bookshelf: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.15;
      const wood = K.walnut;
      g.bx(-W / 2, 0, -D / 2, W / 2, H, -D / 2 + 0.02, K.walnutD, { m: 'wood' });
      for (const x of [-W / 2 + 0.02, 0, W / 2 - 0.02]) g.box(x, H / 2, 0, 0.04, H, D, wood, { m: 'wood' });
      g.box(0, 0.06, 0, W, 0.12, D, K.walnutD, { m: 'wood' });
      g.box(0, H - 0.03, 0, W + 0.0, 0.06, D, wood, { m: 'wood' });
      const nS = 6, sh = (H - 0.2) / nS;
      const spines = ['#7b1e1e', '#1e3a5f', '#2e5a3a', '#c9a96e', '#3b2a4a', '#8a4b2a', '#1c1c1c', '#d8cfb8', '#5a6e7a', '#a33b2b', '#2b4b6e', '#6e5a2b'];
      for (let s = 0; s < nS; s++) {
        const y0 = 0.12 + s * sh;
        g.box(0, y0, 0, W - 0.04, 0.025, D - 0.02, wood, { m: 'wood' });
        for (const half of [-1, 1]) {
          let x = half < 0 ? -W / 2 + 0.05 : 0.03;
          const xe = half < 0 ? -0.03 : W / 2 - 0.05;
          while (x < xe - 0.03) {
            const bw = 0.025 + rnd() * 0.035, bh = sh * (0.6 + rnd() * 0.3), bd = D * (0.6 + rnd() * 0.25);
            if (rnd() < 0.08) { x += 0.08; continue; }   // gap
            const lean = rnd() < 0.06 ? 0.25 : 0;
            g.box(x + bw / 2, y0 + 0.0125 + bh / 2, -D / 2 + 0.03 + bd / 2, bw - 0.002, bh, bd, spines[Math.floor(rnd() * spines.length)], { m: 'matte', rot: [0, 0, lean] });
            x += bw + (lean ? 0.04 : 0);
          }
        }
      }
    },
  },
  luggage: {
    tints: 'luggage',
    jitter: true,
    build(g, W, D, H) {
      g.aoH = 0.05;
      g.box(0, 0.38, 0, W - 0.02, 0.66, D - 0.04, K.white, { r: 0.04, steps: 2, tint: true, m: 'plastic' });
      for (let k = -2; k <= 2; k++) g.box(k * 0.08, 0.38, D / 2 - 0.018, 0.02, 0.6, 0.01, K.white, { tint: true, m: 'plastic' });
      g.box(0, 0.38, 0, W, 0.02, D - 0.02, '#2a2a2c', { m: 'rubber' });
      for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) g.cyl(x, 0.025, z, 0.025, 0.02, K.black, { rot: [0, 0, PI / 2], seg: 8 });
      for (const x of [-0.12, 0.12]) g.box(x, 0.78, -D / 2 + 0.04, 0.02, 0.12, 0.02, K.alu, { m: 'chrome' });
      g.box(0, 0.84, -D / 2 + 0.04, 0.28, 0.025, 0.03, K.black, { m: 'plastic' });
      g.box(0, 0.73, 0, 0.14, 0.02, 0.03, K.black, {});
      g.box(0.12, 0.5, D / 2 - 0.01, 0.07, 0.1, 0.01, '#f2e6c0', {});   // luggage tag
    },
  },
  display: {
    variant(it, room) {
      if (!room) return 'case';
      if (room.type === 'gallery') return room.venue === 'photo' ? 'photo' : 'plinth';
      if (room.type === 'shop') return room.shop === 'jewellery' ? 'case' : 'table';
      if (room.type === 'services') return 'info';
      return 'case';
    },
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.12;
      if (v === 'case') {
        g.box(0, 0.42, 0, W, 0.84, D, '#f0ece4', { r: 0.01, steps: 1, m: 'lacquer' });
        g.box(0, 0.05, 0, W - 0.06, 0.1, D - 0.06, K.walnutD, {});
        g.box(0, 0.845, 0, W - 0.06, 0.01, D - 0.06, '#2a1f3a', { m: 'velvet' });
        for (let k = 0; k < 10; k++) {
          const x = -W / 2 + 0.15 + (k % 5) * (W - 0.3) / 4, z = (k < 5 ? -1 : 1) * D * 0.2;
          g.box(x, 0.87, z, 0.08, 0.04, 0.08, '#e8e2d6', { m: 'leather' });
          g.torus(x, 0.9, z, 0.025, 0.004, k % 2 ? K.gold : K.chrome, { ts: 10, rs: 3, m: k % 2 ? 'gold' : 'chrome', rot: [0.3, 0, 0] });
          g.sph(x, 0.92, z, 0.008, '#ffffff', { seg: 4, emi: 1.9 });
        }
        g.box(0, 0.98, 0, W - 0.04, 0.26, D - 0.04, K.glass, { glass: true });
        g.box(0, 1.105, 0, W - 0.04, 0.01, D - 0.04, '#fff4e0', { emi: 0.6 });
      } else if (v === 'table') {
        g.box(0, 0.78, 0, W, 0.05, D, K.oakL, { m: 'wood' });
        sqLegs(g, -W / 2 + 0.06, W / 2 - 0.06, -D / 2 + 0.06, D / 2 - 0.06, 0.76, 0.05, K.walnutD);
        g.box(0, 0.18, 0, W - 0.1, 0.02, D - 0.1, K.oakL, { m: 'wood' });
        const cols = ['#1f3a5f', '#f0ede6', '#8a2b2b', '#5a7a8a', '#c9b28a', '#2b2b2b'];
        for (let k = 0; k < 8; k++) {
          const x = -W / 2 + 0.2 + (k % 4) * (W - 0.4) / 3, z = (k < 4 ? -1 : 1) * D * 0.22;
          const c = cols[Math.floor(rnd() * cols.length)];
          for (let s = 0; s < 3 + (k % 3); s++) g.box(x, 0.815 + s * 0.035, z, 0.28, 0.032, 0.22, c, { m: 'fabric', rot: [0, (rnd() - 0.5) * 0.1, 0] });
        }
      } else if (v === 'plinth') {
        g.box(0, 0.45, 0, W * 0.55, 0.9, D * 0.75, '#f4f2ee', { m: 'paint' });
        // abstract sculpture: stacked bronze/marble forms
        const c = rnd() < 0.5 ? K.bronze : '#d9d4ca';
        g.sph(0, 1.05, 0, 0.16, c, { seg: 12, s: [1, 0.7, 1], m: c === K.bronze ? 'bronze' : 'marble' });
        g.torus(0, 1.28, 0, 0.12, 0.035, c, { ts: 16, rs: 6, rot: [0.4, 0.3, 0], m: c === K.bronze ? 'bronze' : 'marble' });
        g.box(0, 0.905, D * 0.33, 0.12, 0.02, 0.04, K.brass, { m: 'brass', rot: [0.5, 0, 0] });
      } else if (v === 'photo') {
        // freestanding double-sided photo board
        g.box(0, 0.03, 0, W, 0.06, 0.4, K.black, { m: 'iron' });
        g.box(0, 0.95, 0, W, 1.3, 0.05, '#efede8', { m: 'paint' });
        const cols = ['#3a6a8a', '#d0a060', '#8aa0b0', '#c06a4a', '#4a7a5a', '#e0c0a0'];
        for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
          const x = -W / 2 + 0.25 + (k % 3) * (W - 0.5) / 2, y = 0.65 + Math.floor(k / 3) * 0.55;
          g.box(x, y, s * 0.03, 0.34, 0.44, 0.01, K.white, {});
          g.box(x, y + 0.02, s * 0.036, 0.3, 0.36, 0.004, cols[(k + (s > 0 ? 0 : 3)) % 6], { emi: 0.25 });
        }
      } else { // info kiosk
        g.box(0, 0.45, 0, W * 0.6, 0.9, D * 0.5, '#e8e2d6', { r: 0.02, steps: 1, m: 'lacquer' });
        g.box(0, 1.15, -0.05, W * 0.55, 0.6, 0.06, K.black, { rot: [-0.2, 0, 0] });
        g.box(0, 1.15, -0.015, W * 0.5, 0.54, 0.005, '#ffffff', { emi: SCR.show, rot: [-0.2, 0, 0] });
      }
    },
  },
  shelf: {
    variant: (it, room) => (room && room.shop) || (room && room.type === 'store' ? 'crew' : 'sundries'),
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.12;
      // white gondola with oak shelves and lit header
      g.box(0, H / 2, -D / 2 + 0.03, W, H, 0.06, '#f1eee8', { m: 'paint' });
      for (const x of [-W / 2 + 0.02, W / 2 - 0.02]) g.box(x, H / 2, 0, 0.04, H, D, '#f1eee8', { m: 'paint' });
      g.box(0, 0.06, 0, W, 0.12, D, '#3a3a3c', {});
      g.box(0, H - 0.06, -D / 2 + 0.12, W, 0.12, 0.2, '#f1eee8', {});
      g.box(0, H - 0.12, -D / 2 + 0.2, W - 0.1, 0.01, 0.02, '#fff6e0', { emi: 4.5 });
      const ys = [0.14, 0.52, 0.9, 1.28];
      for (const y of ys) {
        g.box(0, y, 0.02, W - 0.06, 0.03, D - 0.04, K.oakL, { m: 'wood' });
        let x = -W / 2 + 0.08;
        while (x < W / 2 - 0.4) {
          const sp = product(g, v, x, y + 0.015, -D / 2 + 0.1 + (D - 0.2) / 2, D - 0.15, rnd);
          x += sp;
        }
      }
    },
  },
  counter: {
    variant(it, room) {
      if (it.cageWindow) return 'cage';
      if (room && room.type === 'medical') return 'med';
      return 'shop';
    },
    build(g, W, D, H, v) {
      g.aoH = 0.15;
      const front = v === 'med' ? '#eef2f3' : v === 'cage' ? K.walnutD : '#f0ece4';
      g.box(0, 0.05, 0, W - 0.06, 0.1, D - 0.1, K.ink, {});
      g.bx(-W / 2, 0.1, -D / 2 + 0.05, W / 2, H - 0.04, D / 2 - 0.02, front, { m: v === 'med' ? 'plastic' : 'lacquer' });
      g.box(0, H - 0.02, 0.0, W, 0.04, D, v === 'med' ? '#cfd8dc' : K.marble, { m: 'marble', r: 0.01, steps: 1 });
      g.box(0, 0.12, D / 2 - 0.0, W - 0.04, 0.012, 0.012, v === 'med' ? '#a8e0ff' : '#ffd8a0', { emi: 4.4 });
      g.box(0, H - 0.12, D / 2 - 0.01, W - 0.1, 0.06, 0.012, v === 'med' ? '#2f7fa8' : K.brass, { m: v === 'med' ? 'plastic' : 'brass' });
      // till / monitor on staff side
      g.box(W / 4, H + 0.15, -D / 4, 0.32, 0.22, 0.03, K.black, { rot: [-0.25, 0, 0] });
      g.box(W / 4, H + 0.15, -D / 4 + 0.017, 0.29, 0.19, 0.004, '#5a8aaa', { emi: SCR.uiLight, rot: [-0.25, 0, 0] });
      g.box(W / 4, H + 0.02, -D / 4, 0.1, 0.04, 0.1, K.black, {});
      if (v === 'cage') {
        // brass grille & glass to the ceiling of the cashier window
        g.box(0, H + 0.6, D / 2 - 0.08, W, 1.2, 0.01, K.glass, { glass: true });
        for (let x = -W / 2 + 0.05; x <= W / 2 - 0.04; x += 0.12) g.box(x, H + 0.6, D / 2 - 0.06, 0.012, 1.2, 0.012, K.brass, { m: 'brass' });
        g.box(0, H + 1.21, D / 2 - 0.06, W, 0.03, 0.05, K.brass, { m: 'brass' });
        g.box(0, H + 0.04, D / 2 - 0.15, 0.4, 0.06, 0.3, K.brass, { m: 'brass' });   // money tray
      } else if (v === 'shop') {
        g.box(-W / 4, H + 0.03, 0.05, 0.25, 0.05, 0.2, '#c9a96e', {});   // gift bags
        g.box(-W / 4 - 0.3, H + 0.12, -0.05, 0.18, 0.22, 0.08, '#1f3a5f', {});
      }
    },
  },
  desk_svc: {
    build(g, W, D, H) {
      g.aoH = 0.2;
      // guest services desk: fluted walnut front, back-lit onyx band, marble top, monitors behind
      g.box(0, 0.05, 0.05, W - 0.08, 0.1, D - 0.1, K.ink, {});
      g.bx(-W / 2, 0.1, -D / 2 + 0.06, W / 2, H - 0.04, D / 2 - 0.04, K.walnut, { m: 'wood' });
      const n = Math.round(W / 0.1);
      for (let k = 0; k < n; k++) g.cyl(-W / 2 + (k + 0.5) * W / n, 0.45, D / 2 - 0.04, W / n * 0.45, 0.7, K.walnut, { seg: 5, thetaStart: -PI / 2, theta: PI, m: 'wood' });
      g.box(0, 0.9, D / 2 - 0.02, W - 0.04, 0.14, 0.03, '#f0d9b0', { emi: 1.3 });       // onyx band
      g.box(0, H - 0.02, 0.02, W, 0.04, D + 0.02, K.marble, { m: 'marble', r: 0.01, steps: 1 });
      g.box(0, H - 0.28, -D / 2 + 0.22, W - 0.1, 0.03, 0.4, K.marble, { m: 'marble' });  // staff work surface
      for (let x = -W / 2 + 0.7; x < W / 2 - 0.4; x += 1.3) {
        g.box(x, H - 0.1, -D / 2 + 0.2, 0.15, 0.02, 0.12, K.black, {});
        g.box(x, H + 0.04, -D / 2 + 0.2, 0.42, 0.28, 0.025, K.black, { rot: [-0.1, 0, 0] });
        g.box(x, H + 0.04, -D / 2 + 0.214, 0.39, 0.25, 0.004, '#4a7aa0', { emi: SCR.ui, rot: [-0.1, 0, 0] });
      }
      g.box(W / 2 - 0.4, H + 0.12, 0.1, 0.03, 0.2, 0.03, K.brass, { m: 'brass' });   // bell & orchid
      g.cyl(-W / 2 + 0.4, H + 0.06, 0.1, 0.06, 0.12, K.white, { seg: 10, m: 'ceramic' });
      for (let k = 0; k < 4; k++) g.sph(-W / 2 + 0.4 + Math.sin(k) * 0.05, H + 0.32 + k * 0.04, 0.1 + Math.cos(k) * 0.04, 0.03, '#f2e2ee', { seg: 6 });
    },
  },
  podium: {
    build(g, W, D, H) {
      g.aoH = 0.15;
      g.box(0, 0.03, 0, W, 0.06, D, K.ink, {});
      g.box(0, (H - 0.1) / 2 + 0.03, 0, W - 0.08, H - 0.16, D - 0.1, K.walnut, { m: 'wood', r: 0.02, steps: 1 });
      g.box(0, H - 0.04, -0.02, W, 0.04, D, K.walnutD, { m: 'wood', rot: [-0.2, 0, 0] });
      g.box(0, H - 0.0, -0.05, 0.36, 0.008, 0.26, '#203040', { emi: 1.6, rot: [-0.2, 0, 0] });
      g.box(0, 0.6, D / 2 - 0.04, W - 0.2, 0.08, 0.01, K.brass, { m: 'brass' });
      g.cyl(W / 2 - 0.15, H + 0.12, -0.1, 0.006, 0.2, K.brass, { seg: 4, m: 'brass' });
      g.cyl(W / 2 - 0.15, H + 0.22, -0.1, 0.04, 0.03, '#ffe2b0', { seg: 8, emi: 1.6 });
    },
  },
  stage: {
    build(g, W, D, H) {
      g.aoH = 0.0;
      g.bx(-W / 2, 0, -D / 2, W / 2, H - 0.04, D / 2 - 0.04, '#141416', { m: 'velvet' });
      g.bx(-W / 2, H - 0.04, -D / 2, W / 2, H, D / 2, '#4a3426', { m: 'lacquer' });
      for (let k = 1; k < W / 0.45; k++) g.box(-W / 2 + k * 0.45, H + 0.0005, 0, 0.004, 0.001, D - 0.02, '#2e2018', {});
      g.box(0, H - 0.02, D / 2 + 0.0, W, 0.05, 0.02, K.brass, { m: 'brass' });
      for (let x = -W / 2 + 0.4; x < W / 2 - 0.2; x += 0.8) g.box(x, H * 0.5, D / 2 - 0.035, 0.08, 0.03, 0.012, '#ffd8a0', { emi: 1.9 });
      // floor monitors on big stages
      if (W > 5) for (const x of [-W * 0.3, 0, W * 0.3]) g.box(x, H + 0.12, D / 2 - 0.35, 0.5, 0.24, 0.3, '#18181a', { rot: [0.5, 0, 0] });
    },
  },
  dj_booth: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      g.box(0, H / 2 - 0.05, 0.05, W, H - 0.1, D - 0.1, '#0f0f12', { r: 0.02, steps: 1, m: 'gloss' });
      g.box(0, H / 2 - 0.05, D / 2 - 0.0, W - 0.08, H - 0.2, 0.012, '#ffffff', { emi: SCR.eq });     // animated LED front
      g.box(0, H - 0.04, 0, W, 0.06, D, '#18181c', { m: 'gloss' });
      for (const x of [-0.75, 0.75]) {
        g.box(x, H + 0.02, -0.15, 0.42, 0.06, 0.38, '#222', {});
        g.cyl(x, H + 0.06, -0.15, 0.15, 0.02, '#111', { seg: 18, m: 'rubber' });
        g.cyl(x, H + 0.075, -0.15, 0.03, 0.01, '#e8e2d0', { seg: 8 });
      }
      g.box(0, H + 0.04, -0.15, 0.4, 0.06, 0.34, '#2a2a2e', {});
      for (let k = 0; k < 12; k++) g.box(-0.15 + (k % 6) * 0.06, H + 0.075, -0.25 + Math.floor(k / 6) * 0.16, 0.02, 0.01, 0.04, ['#ff3b6e', '#3bc4ff', '#7cff3b'][k % 3], { emi: 1.8 });
      g.box(0.25, H + 0.15, 0.15, 0.32, 0.22, 0.01, '#9a9ea4', { m: 'chrome', rot: [-0.3, 0, 0] });   // laptop
    },
  },
  linen_cart: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) g.cyl(x, 0.04, z, 0.04, 0.03, K.black, { rot: [0, 0, PI / 2], seg: 8 });
      for (const y of [0.12, 0.55, 1.0]) g.box(0, y, 0, W - 0.04, 0.03, D - 0.04, '#e8e8e4', { m: 'plastic' });
      for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) g.box(x, 0.57, 0, 0.03, 1.0, D - 0.04, '#6a7880', { m: 'plastic' });
      for (const y of [0.15, 0.58]) for (let k = 0; k < 3; k++) for (let s = 0; s < 4; s++) g.box(-0.3 + k * 0.3, y + 0.03 + s * 0.06, 0, 0.26, 0.055, D - 0.14, s % 2 ? K.white : K.linen, { m: 'linen' });
      g.box(W / 2 - 0.15, 0.6, D / 2 - 0.02, 0.25, 0.75, 0.05, '#355a7a', { m: 'fabric' });   // laundry bag
      g.pipe([-W / 2 + 0.03, 1.15, -D / 2 + 0.05], [-W / 2 + 0.03, 1.15, D / 2 - 0.05], 0.015, K.chrome, { m: 'chrome' });
    },
  },
  safe: {
    build(g, W, D, H) {
      g.aoH = 0.05;
      g.box(0, H / 2, 0, W, H, D, '#3d4044', { r: 0.02, steps: 1, m: 'steel' });
      g.box(0, H / 2, D / 2 - 0.0, W - 0.08, H - 0.08, 0.02, '#4a4e52', { m: 'steel' });
      g.cyl(-0.05, H / 2 + 0.05, D / 2 + 0.02, 0.06, 0.03, K.chrome, { rot: [PI / 2, 0, 0], seg: 16, m: 'chrome' });
      g.box(0.15, H / 2 + 0.05, D / 2 + 0.015, 0.1, 0.14, 0.02, K.black, {});
      g.box(0.15, H / 2 + 0.1, D / 2 + 0.027, 0.07, 0.025, 0.002, '#4cff7a', { emi: 1.8 });
      g.pipe([-0.05, H / 2 - 0.12, D / 2 + 0.04], [0.1, H / 2 - 0.12, D / 2 + 0.04], 0.012, K.chrome, { m: 'chrome' });
    },
  },
  chart_table: {
    build(g, W, D, H) {
      g.aoH = 0.15;
      g.box(0, (H - 0.05) / 2, 0, W - 0.04, H - 0.05, D - 0.04, K.mahog, { m: 'lacquer' });
      for (let k = 0; k < 4; k++) { g.box(0, 0.15 + k * 0.18, D / 2 - 0.015, W - 0.12, 0.14, 0.012, '#6a3220', { m: 'lacquer' }); g.box(0, 0.15 + k * 0.18, D / 2 - 0.005, 0.2, 0.015, 0.015, K.brass, { m: 'brass' }); }
      g.box(0, H - 0.02, 0, W, 0.04, D, K.mahog, { m: 'lacquer', rot: [0.06, 0, 0] });
      g.box(0, H + 0.005, 0, W - 0.2, 0.004, D - 0.2, '#d8e2e0', { rot: [0.06, 0, 0] });
      g.box(-0.2, H + 0.009, 0.05, 0.6, 0.003, 0.3, '#9ec2d0', { rot: [0.06, 0, 0] });
      g.box(0.3, H + 0.02, -0.1, 0.25, 0.01, 0.03, K.brass, { m: 'brass', rot: [0, 0.4, 0] });   // parallel ruler
      g.cyl(-W / 2 + 0.15, H + 0.2, -D / 2 + 0.15, 0.008, 0.4, K.black, { seg: 4 });
      g.lathe([[0.02, 0], [0.09, -0.08], [0.085, -0.085], [0.015, -0.005]], -W / 2 + 0.25, H + 0.42, -D / 2 + 0.15, '#c82a2a', { seg: 10 });
      g.cyl(-W / 2 + 0.25, H + 0.36, -D / 2 + 0.15, 0.04, 0.01, '#ff6040', { seg: 8, emi: 1.4 });   // red night lamp
    },
  },
  hot_tub: {
    build(g, W, D, H) {
      g.aoH = 0.0;
      const R = W / 2;
      g.lathe([[R - 0.02, 0], [R, 0.02], [R, H - 0.06], [R - 0.02, H], [R - 0.22, H], [R - 0.24, H - 0.03]], 0, 0, 0, '#d9d3c7', { seg: 32, m: 'stone' });
      g.lathe([[R - 0.24, H - 0.03], [R - 0.26, 0.2], [R - 0.5, 0.08], [0.001, 0.06]], 0, 0, 0, '#5ab4c8', { seg: 32, m: 'ceramic' });
      g.torus(0, H - 0.005, 0, R - 0.11, 0.1, K.teak, { rot: [PI / 2, 0, 0], ts: 32, rs: 4, s: [1, 1, 0.12], m: 'wood' });
      // inner bench ring
      g.lathe([[R - 0.26, 0.34], [R - 0.62, 0.34], [R - 0.64, 0.08]], 0, 0, 0, '#62bccf', { seg: 32, m: 'ceramic' });
      // water: shimmering surface (animated emissive program)
      g.cyl(0, H - 0.1, 0, R - 0.25, 0.01, '#3aa6c0', { seg: 32, emi: SCR.water });
      // underwater lights
      for (let k = 0; k < 4; k++) { const a = k * PI / 2; g.cyl(Math.sin(a) * (R - 0.26), 0.25, Math.cos(a) * (R - 0.26), 0.05, 0.01, '#bff4ff', { rot: [PI / 2, a, 0], seg: 8, emi: 1.9 }); }
      // grab rail & steps
      g.tube([[R - 0.15, H, -0.3], [R + 0.0, H + 0.6, -0.3], [R + 0.0, H + 0.6, 0.3], [R - 0.15, H, 0.3]], 0.02, K.chrome, { m: 'chrome' });
    },
  },
  parasol: {
    tints: 'parasol',
    build(g, W, D, H) {
      g.aoH = 0.0;
      g.cyl(0, 0.04, 0, 0.19, 0.08, '#3a3b3d', { seg: 14, m: 'iron' });
      g.cyl(0, H / 2, 0, 0.022, H, '#e8e4dc', { seg: 8, m: 'paint' });
      // octagonal canopy with alternating tinted/white panels and scalloped valance
      const R = 1.45, n = 8, top = H - 0.05, rim = H - 0.55;
      for (let k = 0; k < n; k++) {
        const a0 = k * TAU / n, a1 = (k + 1) * TAU / n;
        const pts = [[0, top, 0], [Math.sin(a0) * R, rim, Math.cos(a0) * R], [Math.sin(a1) * R, rim, Math.cos(a1) * R]];
        const geo = triGeo(pts);
        g.geo(geo, mat4(), K.white, { tint: k % 2 === 0, m: 'fabric' });
        g.geo(geo, mat4(), K.white, { tint: k % 2 === 0, m: 'fabric', flip: true });
        g.box(Math.sin((a0 + a1) / 2) * R * 0.95, rim - 0.06, Math.cos((a0 + a1) / 2) * R * 0.95, R * 0.74, 0.12, 0.01, K.white, { rot: [0, (a0 + a1) / 2 + PI / 2, 0], tint: k % 2 === 1, m: 'fabric' });
        g.pipe([0, top - 0.04, 0], [Math.sin(a0) * R * 0.98, rim - 0.01, Math.cos(a0) * R * 0.98], 0.008, '#d8d2c6', { seg: 4 });
      }
      g.sph(0, top + 0.05, 0, 0.05, '#d8d2c6', { seg: 8 });
    },
  },
  // ═══════════════════════════════════════════════════════════════════════
  //  ENVIRONMENT-ART PASS: corridor dressing, dining, atrium, theatre
  // ═══════════════════════════════════════════════════════════════════════
  sconce: {
    variant: (it, room) => (room && (room.type === 'theater' || room.venue === 'dining') ? 'gilt' : 'std'),
    build(g, W, D, H, v) {
      const met = v === 'gilt' ? K.gold : K.brass;
      g.box(0, H * 0.45, -D / 2 + 0.01, 0.1, 0.2, 0.02, met, { m: 'brass' });
      g.pipe([0, H * 0.4, -D / 2 + 0.02], [0, H * 0.4, 0.02], 0.012, met, { seg: 5, m: 'brass' });
      // fabric drum shade glowing warm (night-boosted lamp program)
      g.cyl(0, H * 0.62, 0.02, 0.09, 0.2, v === 'gilt' ? '#ffd9a8' : '#ffe8c8', { seg: 12, open: true, emi: 4.9, r2: 0.075 });
      g.cyl(0, H * 0.62, 0.02, 0.07, 0.19, '#fff0d8', { seg: 8, emi: 5.5 });
      g.cyl(0, H * 0.28, 0.02, 0.025, 0.08, met, { seg: 6, m: 'brass' });
    },
  },
  art_frame: {
    variant: (it) => String(Math.abs(Math.round(it.x * 3.1 + it.z * 1.7)) % 6),
    build(g, W, D, H, v, rnd) {
      const k = +v;
      const frame = [K.gold, K.walnutD, K.black, K.gold, '#d8d2c6', K.walnut][k];
      g.box(0, H / 2, 0, W, H, D * 0.6, frame, { m: frame === K.gold ? 'gold' : 'wood', r: 0.008, steps: 1 });
      g.box(0, H / 2, D * 0.3 + 0.001, W - 0.12, H - 0.12, 0.004, '#f2efe6', { m: 'matte' });   // mount
      // painted seascape / abstract: banded colour fields (deterministic per variant)
      const pal = [['#2f5a7a', '#5f8fa8', '#d8c8a0', '#e8dcc0'], ['#1f3a4a', '#c86a3a', '#e8b06a', '#f2dcb0'], ['#3a4a3a', '#6a8a5a', '#b8c89a', '#e8e8d8'],
        ['#2a2a3a', '#6a3a5a', '#c87a6a', '#f2c8a0'], ['#1a4a6a', '#2f7a9a', '#f2f2ea', '#c8a050'], ['#5a3a2a', '#8a6a4a', '#c8b08a', '#efe6d0']][k];
      const iw = W - 0.2, ih = H - 0.2;
      let y = H / 2 - ih / 2;
      for (let b = 0; b < 4; b++) { const bh = ih * [0.38, 0.12, 0.2, 0.3][b]; g.box(0, y + bh / 2, D * 0.3 + 0.004, iw, bh, 0.003, pal[b], {}); y += bh; }
      if (k % 2 === 0) g.sph(iw * 0.22, H * 0.66, D * 0.3 + 0.004, 0.06, '#f6e0a8', { seg: 8, s: [1, 1, 0.05] });   // sun / moon
      else g.box(-iw * 0.15, H * 0.45, D * 0.3 + 0.006, 0.12, 0.05, 0.003, '#2a2a2a', {});   // sail boat hull
      // picture light
      g.box(0, H + 0.04, D * 0.4, W * 0.45, 0.025, 0.05, K.brass, { m: 'brass' });
      g.box(0, H + 0.025, D * 0.4 + 0.01, W * 0.4, 0.006, 0.02, '#fff2d8', { emi: 1.6 });
    },
  },
  console_table: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.15;
      g.box(0, H - 0.02, 0, W, 0.04, D, K.marble, { m: 'marble', r: 0.008, steps: 1 });
      g.box(0, H - 0.09, 0, W - 0.06, 0.1, D - 0.04, K.walnut, { m: 'wood' });
      for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) g.cyl(x, (H - 0.14) / 2, z, 0.018, H - 0.14, K.brass, { seg: 6, m: 'brass', r2: 0.012 });
      g.box(0, 0.12, 0, W - 0.12, 0.02, D - 0.08, K.walnut, { m: 'wood' });
      // vase with stems + table lamp
      g.lathe([[0.001, 0], [0.06, 0], [0.085, 0.12], [0.05, 0.26], [0.045, 0.3], [0.001, 0.3]], W * 0.22, H, 0, '#2f5a6a', { seg: 10, m: 'ceramic' });
      for (let k = 0; k < 4; k++) g.sph(W * 0.22 + (rnd() - 0.5) * 0.12, H + 0.38 + rnd() * 0.08, (rnd() - 0.5) * 0.1, 0.05, ['#f4f1ea', '#e8b9b0', '#c84a5a', '#f2d080'][k], { seg: 6 });
      g.cyl(-W * 0.25, H + 0.13, 0, 0.05, 0.26, K.brass, { seg: 8, m: 'brass', r2: 0.02 });
      g.cyl(-W * 0.25, H + 0.36, 0, 0.12, 0.18, '#ffe8c8', { seg: 12, open: true, emi: 4.9, r2: 0.09 });
      g.box(W * 0.0, H + 0.02, 0.02, 0.2, 0.03, 0.14, '#7a2e2a', { m: 'matte' });   // book
    },
  },
  banquette: {
    tints: 'upholstery',
    build(g, W, D, H) {
      g.aoH = 0.2;
      const zb = -D / 2;
      g.box(0, 0.06, 0.05, W, 0.12, D - 0.1, K.walnutD, { m: 'wood' });
      g.box(0, 0.26, zb + D * 0.45, W, 0.28, D * 0.62, K.walnutD, { m: 'wood', r: 0.02, steps: 1 });
      cushion(g, 0, 0.44, zb + D * 0.46, W - 0.04, 0.12, D * 0.58, K.white, { steps: 1 });
      // tall channel-tufted back with walnut cap and brass rail
      g.box(0, 0.75, zb + 0.12, W, 0.7, 0.2, K.white, { tint: true, m: 'velvet', r: 0.04, steps: 1 });
      for (let k = 1; k < Math.round(W / 0.3); k++) g.box(-W / 2 + k * W / Math.round(W / 0.3), 0.75, zb + 0.225, 0.012, 0.6, 0.01, '#000000', { tint: true });
      g.box(0, H - 0.04, zb + 0.1, W + 0.02, 0.08, 0.24, K.walnut, { m: 'wood' });
      g.box(0, H - 0.0, zb + 0.1, W, 0.012, 0.03, K.brass, { m: 'brass' });
      // little lamps on the cap
      for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) { g.cyl(x, H + 0.08, zb + 0.1, 0.012, 0.16, K.brass, { seg: 5 }); g.cyl(x, H + 0.2, zb + 0.1, 0.07, 0.1, '#ffe2b8', { seg: 10, open: true, emi: 4.9, r2: 0.05 }); }
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.03), 0.55, zb + D * 0.4, 0.06, 0.5, D * 0.7, K.walnutD, { m: 'wood' });
    },
  },
  waiter_station: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.15;
      g.box(0, 0.05, 0, W - 0.04, 0.1, D - 0.04, K.ink, {});
      g.bx(-W / 2, 0.1, -D / 2, W / 2, H - 0.04, D / 2, K.walnut, { m: 'wood' });
      for (const s of [-1, 1]) for (let r = 0; r < 3; r++) g.box(s * W / 4, 0.3 + r * 0.28, D / 2 + 0.005, W / 2 - 0.05, 0.24, 0.01, K.walnutD, { m: 'wood' });
      for (const s of [-1, 1]) for (let r = 0; r < 3; r++) g.box(s * W / 4, 0.3 + r * 0.28, D / 2 + 0.014, 0.12, 0.012, 0.01, K.brass, { m: 'brass' });
      g.box(0, H - 0.02, 0, W + 0.02, 0.04, D + 0.02, K.marble, { m: 'marble' });
      // stacks of plates, folded napkins, water jugs, cutlery tray
      for (let k = 0; k < 2; k++) g.cyl(-W / 2 + 0.25 + k * 0.28, H + 0.06, -0.05, 0.13, 0.1, K.white, { seg: 14, m: 'ceramic' });
      for (let k = 0; k < 4; k++) g.box(0.1 + (k % 2) * 0.12, H + 0.03 + Math.floor(k / 2) * 0.04, 0.05, 0.1, 0.035, 0.1, K.linen, { m: 'linen' });
      for (const x of [W / 2 - 0.3, W / 2 - 0.15]) g.lathe([[0.001, 0], [0.06, 0], [0.065, 0.18], [0.045, 0.24], [0.05, 0.26], [0.001, 0.26]], x, H, -0.1, K.glass, { seg: 8, glass: true });
      g.box(0, H + 0.025, 0.18, 0.35, 0.03, 0.14, K.walnutD, { m: 'wood' });
    },
  },
  divider: {
    variant: (it) => it.style || 'screen',
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      if (v === 'planter') {
        // long planter box with clipped hedge and frosted glass screen above
        g.box(0, 0.35, 0, W, 0.7, D, K.walnutD, { m: 'wood' });
        g.box(0, 0.68, 0, W - 0.06, 0.02, D - 0.06, K.soil, { m: 'soil' });
        for (let x = -W / 2 + 0.18; x < W / 2 - 0.1; x += 0.24) g.sph(x, 0.82 + rnd() * 0.06, 0, 0.17, rnd() < 0.5 ? K.leaf : K.leafD, { seg: 6, m: 'leaf' });
        g.box(0, H - 0.3, 0, W - 0.1, 0.55, 0.02, '#e8f0f2', { glass: true });
        g.box(0, H - 0.02, 0, W, 0.03, 0.05, K.brass, { m: 'brass' });
        for (const s of [-1, 1]) g.box(s * (W / 2 - 0.02), H * 0.55, 0, 0.03, H * 0.9, 0.05, K.brass, { m: 'brass' });
        return;
      }
      // slatted walnut screen with brass base
      g.box(0, 0.04, 0, W, 0.08, D, K.brass, { m: 'brass' });
      const n = Math.round(W / 0.09);
      for (let k = 0; k < n; k++) g.box(-W / 2 + (k + 0.5) * W / n, H / 2 + 0.04, 0, 0.04, H - 0.08, D * 0.5, K.walnut, { m: 'wood' });
      g.box(0, H - 0.02, 0, W, 0.04, D * 0.6, K.walnutD, { m: 'wood' });
    },
  },
  column: {
    build(g, W, D, H) {
      const r = W / 2;
      g.box(0, 0.12, 0, W + 0.08, 0.24, D + 0.08, K.marbleD, { m: 'marble' });
      g.cyl(0, H / 2, 0, r * 0.82, H - 0.4, '#d9cfbf', { seg: 16, m: 'marble' });
      for (let k = 0; k < 12; k++) { const a = k * TAU / 12; g.box(Math.sin(a) * r * 0.8, H / 2, Math.cos(a) * r * 0.8, 0.03, H - 0.5, 0.03, '#c8bca8', { rot: [0, a, 0], m: 'marble' }); }   // fluting
      g.cyl(0, H - 0.25, 0, r * 0.95, 0.12, K.gold, { seg: 16, m: 'gold' });
      g.box(0, H - 0.09, 0, W + 0.04, 0.18, D + 0.04, '#e8e0d0', { m: 'marble' });
      g.cyl(0, 0.3, 0, r * 0.92, 0.1, K.gold, { seg: 16, m: 'gold' });
      // uplight ring
      g.torus(0, H - 0.31, 0, r * 0.83, 0.012, '#fff2d0', { rot: [PI / 2, 0, 0], ts: 16, rs: 3, emi: 1.6 });
    },
  },
  floral_display: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      const R = W / 2;
      g.lathe([[0.001, 0], [R * 0.55, 0], [R * 0.6, 0.06], [R * 0.25, 0.25], [R * 0.2, 0.62], [R * 0.95, 0.72], [R, 0.78], [0.001, 0.78]], 0, 0, 0, K.walnutD, { seg: 20, m: 'lacquer' });
      g.cyl(0, 0.785, 0, R - 0.02, 0.012, K.marble, { seg: 20, m: 'marble' });
      // tall glass urn with a dome of blooms
      g.lathe([[0.001, 0], [0.16, 0], [0.22, 0.25], [0.18, 0.5], [0.2, 0.52], [0.001, 0.52]], 0, 0.79, 0, '#cfe3ea', { seg: 12, glass: true });
      const cols = ['#f4f1ea', '#e8b9b0', '#c84a5a', '#f2d080', '#e8e0f0', '#d86a7a'];
      for (let k = 0; k < 26; k++) { const a = rnd() * TAU, r = Math.sqrt(rnd()) * 0.45, y = 1.35 + (1 - r / 0.45) * 0.28 + rnd() * 0.06; g.sph(Math.cos(a) * r, y, Math.sin(a) * r, 0.07 + rnd() * 0.03, cols[k % cols.length], { seg: 6, m: 'fabric' }); }
      for (let k = 0; k < 14; k++) { const a = k * TAU / 14; g.sph(Math.cos(a) * 0.5, 1.28, Math.sin(a) * 0.5, 0.09, k % 2 ? K.leaf : K.leafD, { seg: 6, s: [1.4, 0.5, 1], rot: [0, -a, 0], m: 'leaf' }); }
      // candle ring on the table top
      for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + 0.3; g.cyl(Math.cos(a) * (R - 0.2), 0.84, Math.sin(a) * (R - 0.2), 0.03, 0.1, K.white, { seg: 6 }); g.cyl(Math.cos(a) * (R - 0.2), 0.9, Math.sin(a) * (R - 0.2), 0.008, 0.025, '#ffd9a0', { seg: 4, emi: 1.8 }); }
    },
  },
  cafe_bar: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.15;
      // customer side = +Z; marble top, fluted oak front, glass pastry case, espresso machine at the back
      g.box(0, 0.05, 0, W - 0.06, 0.1, D - 0.1, K.ink, {});
      g.bx(-W / 2, 0.1, -D / 2 + 0.05, W / 2, H - 0.05, D / 2 - 0.03, K.oak, { m: 'wood' });
      for (let x = -W / 2 + 0.06; x < W / 2; x += 0.08) g.box(x, (H - 0.05) / 2 + 0.05, D / 2 - 0.025, 0.04, H - 0.2, 0.02, K.oakL, { m: 'wood' });
      g.box(0, 0.13, D / 2 - 0.0, W - 0.04, 0.012, 0.012, '#ffd8a0', { emi: 4.4 });
      g.box(0, H - 0.025, 0.02, W + 0.04, 0.05, D + 0.04, K.marble, { m: 'marble', r: 0.01, steps: 1 });
      // pastry case
      g.box(W * 0.2, H + 0.02, 0.1, W * 0.45, 0.02, D * 0.6, K.chrome, { m: 'chrome' });
      g.box(W * 0.2, H + 0.2, 0.1, W * 0.45, 0.36, D * 0.6, K.glass, { glass: true });
      for (let k = 0; k < 10; k++) g.sph(W * 0.2 - W * 0.2 + (k % 5) * W * 0.1, H + 0.07 + Math.floor(k / 5) * 0.16, 0.1 + (rnd() - 0.5) * 0.15, 0.05, ['#c8904a', '#e8c890', '#7a3a2a', '#f2d8a8', '#d86a5a'][k % 5], { seg: 6, s: [1.3, 0.6, 1] });
      g.box(W * 0.2, H + 0.37, 0.1, W * 0.45, 0.012, D * 0.6, '#fff2d8', { emi: 1.4 });
      // espresso machine + grinder + cups
      g.box(-W * 0.25, H + 0.22, -0.12, 0.7, 0.42, 0.45, '#b3241f', { m: 'gloss', r: 0.04, steps: 1 });
      g.box(-W * 0.25, H + 0.45, -0.12, 0.66, 0.05, 0.42, K.chrome, { m: 'chrome' });
      for (const dx of [-0.18, 0.18]) g.cyl(-W * 0.25 + dx, H + 0.1, 0.12, 0.03, 0.05, K.chrome, { seg: 6, m: 'chrome' });
      g.cyl(-W * 0.25 - 0.55, H + 0.2, -0.15, 0.08, 0.4, K.black, { seg: 8, m: 'gloss' });
      for (let k = 0; k < 6; k++) g.cyl(-W * 0.25 + (k % 3) * 0.07 - 0.07, H + 0.5 + Math.floor(k / 3) * 0.06, -0.15, 0.03, 0.06, K.white, { seg: 6, m: 'ceramic' });
      // menu board on a stand behind
      g.box(-W * 0.05, H + 0.75, -D / 2 + 0.05, 1.2, 0.6, 0.03, '#202024', { m: 'matte' });
      for (let k = 0; k < 6; k++) g.box(-W * 0.05 - 0.3 + (k % 2) * 0.55, H + 0.92 - Math.floor(k / 2) * 0.13, -D / 2 + 0.067, 0.42, 0.03, 0.002, '#f2efe6', {});
      g.box(-W * 0.05, H + 0.32, -D / 2 + 0.05, 0.04, 0.3, 0.03, K.black, {});
    },
  },
  atrium_settee: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.18;
      const R = W / 2;
      // round "borne" settee: four upholstered quadrants around a central planter column with a palm
      g.cyl(0, 0.05, 0, R - 0.02, 0.1, K.walnutD, { seg: 24, m: 'wood' });
      g.cyl(0, 0.27, 0, R - 0.05, 0.34, K.white, { seg: 24, tint: true, m: 'velvet' });
      g.cyl(0, 0.47, 0, R, 0.1, K.white, { seg: 24, tint: true, m: 'velvet' });
      g.cyl(0, 0.75, 0, R * 0.5, 0.5, K.white, { seg: 20, tint: true, m: 'velvet', r2: R * 0.42 });   // back roll
      for (let k = 0; k < 4; k++) g.box(Math.sin(k * PI / 2 + PI / 4) * R * 0.75, 0.48, Math.cos(k * PI / 2 + PI / 4) * R * 0.75, 0.04, 0.14, R * 0.5, '#000000', { rot: [0, k * PI / 2 + PI / 4, 0], tint: true });
      g.cyl(0, 1.12, 0, R * 0.36, 0.25, K.walnut, { seg: 16, m: 'lacquer' });
      g.torus(0, 1.24, 0, R * 0.36, 0.015, K.brass, { rot: [PI / 2, 0, 0], ts: 16, rs: 3, m: 'brass' });
      g.cyl(0, 1.245, 0, R * 0.34, 0.01, K.soil, { seg: 14, m: 'soil' });
      // palm in the centre
      g.cyl(0, 1.25 + (H - 1.25) * 0.4, 0, 0.05, (H - 1.25) * 0.8, '#7a6248', { seg: 6, r2: 0.04, m: 'wood' });
      for (let k = 0; k < 9; k++) {
        const a = k * TAU / 9 + rnd() * 0.3, top = H - 0.2;
        const pts = [], side = [];
        for (let q = 0; q <= 5; q++) { const t = q / 5; pts.push([Math.cos(a) * t * 0.9, top + Math.sin(t * PI * 0.8) * 0.25 - t * t * 0.5, Math.sin(a) * t * 0.9]); const wv = 0.12 * Math.sin(PI * Math.min(1, t * 1.1 + 0.05)); side.push([-Math.sin(a) * wv, 0, Math.cos(a) * wv]); }
        g.ribbon(pts, side, k % 2 ? K.leaf : K.leafL, { m: 'leaf', fold: 0.3 });
      }
    },
  },
  // Crystal tiered chandelier: origin at its lowest point; drop rod rises to H.
  chandelier: {
    variant: (it) => it.style || 'tiered',
    build(g, W, D, H, v, rnd) {
      const R = W / 2;
      if (v === 'theatre') {
        // flat "starburst" theatre chandelier: concentric gilt rings with lamp beads
        const y0 = 0.3;
        for (let r = 0; r < 4; r++) {
          const rr = R * (0.35 + r * 0.21), yy = y0 + r * 0.14;
          g.torus(0, yy, 0, rr, 0.03, K.gold, { rot: [PI / 2, 0, 0], ts: 28, rs: 4, m: 'gold' });
          const n = 10 + r * 5;
          for (let k = 0; k < n; k++) { const a = k * TAU / n; g.sph(Math.cos(a) * rr, yy - 0.08, Math.sin(a) * rr, 0.09, '#fff2d0', { seg: 5, emi: 1.9 }); }
          g.torus(0, yy - 0.02, 0, rr, 0.012, '#ffe8c0', { rot: [PI / 2, 0, 0], ts: 28, rs: 3, emi: 1.6 });
        }
        g.lathe([[0.001, 0], [0.25, 0.05], [0.12, 0.35], [0.06, 0.6], [0.001, 0.62]], 0, 0.0, 0, K.gold, { seg: 12, m: 'gold' });
        for (let k = 0; k < 8; k++) { const a = k * TAU / 8; g.pipe([0, 0.6, 0], [Math.cos(a) * R * 0.98, y0 + 0.42, Math.sin(a) * R * 0.98], 0.012, K.gold, { seg: 4, m: 'gold' }); }
        g.pipe([0, 0.6, 0], [0, H, 0], 0.025, K.gold, { seg: 6, m: 'gold' });
        return;
      }
      // tiered crystal: 3 rings of drops tapering upward + crown + canopy rod
      const tiers = [[R, 0.35], [R * 0.72, 0.85], [R * 0.45, 1.3]];
      for (const [rr, y] of tiers) {
        g.torus(0, y, 0, rr, 0.025, K.gold, { rot: [PI / 2, 0, 0], ts: 24, rs: 4, m: 'gold' });
        const n = Math.round(rr * 16);
        for (let k = 0; k < n; k++) {
          const a = k * TAU / n, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
          const len = 0.35 + (k % 3) * 0.12;
          g.cyl(x, y - len / 2, z, 0.012, len, '#f2f6ff', { seg: 3, emi: 0.9, m: 'glass' });
          g.sph(x, y - len - 0.03, z, 0.035, '#fff8e8', { seg: 4, emi: 1.4, m: 'glass' });
        }
        for (let k = 0; k < 8; k++) { const a = k * TAU / 8 + 0.2; g.cyl(Math.cos(a) * rr, y + 0.08, Math.sin(a) * rr, 0.03, 0.12, '#fff2d0', { seg: 6, emi: 1.9 }); }
      }
      g.sph(0, 0.15, 0, 0.18, '#f6f8ff', { seg: 10, emi: 1.2, m: 'glass' });
      g.lathe([[0.001, 0.2], [0.16, 0.3], [0.08, 1.2], [0.14, 1.5], [0.05, 1.75], [0.001, 1.8]], 0, 0, 0, K.gold, { seg: 12, m: 'gold' });
      g.pipe([0, 1.8, 0], [0, H - 0.08, 0], 0.03, K.gold, { seg: 6, m: 'gold' });
      g.cyl(0, H - 0.04, 0, 0.35, 0.08, K.gold, { seg: 16, m: 'gold' });
    },
  },
  // Cascading light sculpture for the atrium well: hundreds of glowing drops on cables, spiralling down.
  cascade: {
    build(g, W, D, H, v, rnd) {
      const R = W / 2;
      // gilt canopy ring under the atrium ceiling
      g.cyl(0, H - 0.08, 0, R + 0.15, 0.16, K.gold, { seg: 28, m: 'gold' });
      g.torus(0, H - 0.18, 0, R + 0.05, 0.05, K.gold, { rot: [PI / 2, 0, 0], ts: 28, rs: 4, m: 'gold' });
      g.cyl(0, H - 0.17, 0, R, 0.01, '#fff2d8', { seg: 28, emi: 1.5 });
      // three glowing helical light ribbons spiralling down through the well
      for (let hlx = 0; hlx < 3; hlx++) {
        const pts = [], n = 44;
        for (let k = 0; k <= n; k++) {
          const t = k / n, a = hlx * TAU / 3 + t * TAU * 1.6;
          const rr = R * (0.95 - 0.55 * t);
          pts.push([Math.cos(a) * rr, H - 0.3 - t * (H - 0.6), Math.sin(a) * rr]);
        }
        g.tube(pts, 0.035, '#ffe6b8', { seg: 5, emi: 1.9, joints: false });
      }
      // hanging crystal strands: long at the rim, shorter inside (an inverted bell)
      const n = 48;
      for (let k = 0; k < n; k++) {
        const a = k * 2.399963, r = R * (0.3 + 0.7 * Math.sqrt((k + 0.5) / n));
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const t = r / R;
        const len = (H - 0.4) * (0.25 + 0.75 * Math.pow(t, 1.4)) * (0.85 + rnd() * 0.15);
        const y1 = H - 0.2, y0 = y1 - len;
        g.cyl(x, (y0 + y1) / 2, z, 0.006, len, '#d8d0c0', { seg: 3, m: 'chrome' });
        const beads = Math.max(2, Math.round(len / 0.7));
        for (let b = 0; b < beads; b++) {
          const y = y0 + b * (len / beads);
          // elongated faceted crystal (octahedron-ish)
          g.sph(x, y, z, b === 0 ? 0.11 : 0.075, b === 0 ? '#ffe2b0' : '#f4f6ff', { seg: 4, s: [1, 1.9, 1], emi: b === 0 ? 1.9 : 1.2, m: 'glass' });
        }
      }
    },
  },
  // Stage lighting truss: box truss with par cans & movers; origin = truss underside (lamps hang below 0).
  light_truss: {
    build(g, W, D, H) {
      const t = 0.42, y0 = H - t, col = '#2a2b2e';
      for (const yy of [y0, H - 0.02]) for (const s of [-1, 1]) g.pipe([-W / 2, yy, s * t / 2], [W / 2, yy, s * t / 2], 0.022, col, { seg: 5, m: 'steel' });
      for (let x = -W / 2; x <= W / 2 + 0.01; x += 0.5) {
        for (const s of [-1, 1]) g.pipe([x, y0, s * t / 2], [x + 0.25, H - 0.02, s * t / 2], 0.01, col, { seg: 3 });
        g.pipe([x, y0, -t / 2], [x, y0, t / 2], 0.01, col, { seg: 3 });
      }
      // lamps: par cans (warm), profile spots, moving heads (cool) hanging under the truss
      for (let x = -W / 2 + 0.6, k = 0; x < W / 2 - 0.3; x += 1.1, k++) {
        const kind = k % 3;
        g.box(x, y0 - 0.06, 0, 0.04, 0.12, 0.3, col, {});
        if (kind === 2) {
          g.box(x, y0 - 0.16, 0, 0.32, 0.12, 0.28, '#151517', { m: 'paint' });
          g.sph(x, y0 - 0.36, 0.05, 0.13, '#151517', { seg: 8 });
          g.cyl(x, y0 - 0.38, 0.13, 0.08, 0.02, '#c8e0ff', { rot: [PI / 2 + 0.6, 0, 0], seg: 10, emi: 1.9 });
        } else {
          g.cyl(x, y0 - 0.28, 0.08, 0.1, 0.32, '#151517', { rot: [-0.9, 0, 0], seg: 10, m: 'paint' });
          g.cyl(x, y0 - 0.38, 0.2, 0.085, 0.01, kind ? '#ffd9a0' : '#ff9a6a', { rot: [-0.9 + PI / 2, 0, 0], seg: 10, emi: 1.9 });
        }
      }
      g.pipe([-W * 0.3, H, 0], [-W * 0.3, H + 3, 0], 0.01, '#8a8d90', { seg: 3 });
      g.pipe([W * 0.3, H, 0], [W * 0.3, H + 3, 0], 0.01, '#8a8d90', { seg: 3 });
    },
  },
  // Fly batten with a hanging border curtain (masking) or painted scenery cloth.
  fly_batten: {
    variant: (it) => it.style || 'border',
    build(g, W, D, H, v, rnd) {
      g.pipe([-W / 2, H - 0.03, 0], [W / 2, H - 0.03, 0], 0.03, '#2a2b2e', { seg: 6 });
      if (v === 'cloth') {
        // painted backdrop: night harbour
        g.box(0, H / 2, 0, W - 0.2, H - 0.06, 0.02, '#1a2a4a', { m: 'fabric' });
        g.box(0, H * 0.25, 0.012, W - 0.2, H * 0.3, 0.004, '#0e1a2e', {});
        for (let k = 0; k < 30; k++) g.box(-W / 2 + rnd() * W, H * (0.42 + rnd() * 0.08), 0.015, 0.1 + rnd() * 0.3, 0.02, 0.002, '#ffd9a0', { emi: 1.4 });
        return;
      }
      // pleated black masking border
      const n = Math.round(W / 0.25);
      for (let k = 0; k < n; k++) g.box(-W / 2 + (k + 0.5) * W / n, H / 2, (k % 2) * 0.06 - 0.03, W / n + 0.02, H - 0.06, 0.03, '#141416', { m: 'velvet' });
    },
  },
  // Proscenium arch: gilt pilasters + segmental header + swagged red house curtain + valance.
  // Lower wing returns (|z| > inner) stay below 2.85 m so they tuck under the circle floor.
  proscenium: {
    build(g, W, D, H, v, rnd) {
      const red = '#8e1a24', redD = '#5e0f16', gold = K.gold;
      const inner = Math.min(W / 2 - 1.5, 13) ;   // opening half-width at the pilasters
      // wing returns under the circle floor
      for (const s of [-1, 1]) {
        g.box(s * (inner + (W / 2 - inner) / 2 + 0.3), 1.42, 0, W / 2 - inner - 0.6, 2.84, D * 0.6, '#3a1418', { m: 'velvet' });
        g.box(s * (inner + 0.5), H / 2, 0, 0.9, H, D, '#e6d8b8', { m: 'marble' });                    // pilaster
        g.box(s * (inner + 0.5), H / 2, D / 2 + 0.01, 0.6, H - 0.6, 0.04, gold, { m: 'gold' });
        for (let k = 0; k < 5; k++) g.box(s * (inner + 0.5) - 0.2 + k * 0.1, H / 2, D / 2 + 0.035, 0.04, H - 0.9, 0.02, '#b8913e', { m: 'gold' });
        g.box(s * (inner + 0.5), 0.3, 0, 1.0, 0.6, D + 0.08, '#c8b898', { m: 'marble' });
        g.box(s * (inner + 0.5), H - 0.35, 0, 1.05, 0.5, D + 0.1, gold, { m: 'gold' });               // capital
        // gathered house curtain swag at each side
        for (let k = 0; k < 7; k++) {
          const z = s * (inner - 0.15 - k * 0.22), sw = 0.24;
          g.box(z, (H - 1.4) / 2, -0.05 - (k % 2) * 0.05, sw, H - 1.4, 0.12, k % 2 ? red : redD, { m: 'velvet' });
        }
        g.torus(s * (inner - 0.9), 2.2, 0.08, 0.7, 0.04, gold, { arc: PI, rot: [0, 0, s > 0 ? PI / 2 : -PI / 2], ts: 10, rs: 4, m: 'gold' });   // tie-back
      }
      // header: deep gilt frieze + segmental arch soffit (stepped)
      g.box(0, H - 0.5, 0, inner * 2 + 1.0, 1.0, D, '#e6d8b8', { m: 'marble' });
      g.box(0, H - 0.5, D / 2 + 0.02, inner * 2 + 0.6, 0.7, 0.04, gold, { m: 'gold' });
      for (let k = -8; k <= 8; k++) g.sph(k * inner / 8.5, H - 0.5, D / 2 + 0.05, 0.12, '#b8913e', { seg: 6, s: [1, 1, 0.4], m: 'gold' });
      g.box(0, H - 0.08, 0, 2.4, 0.5, 0.2, gold, { m: 'gold' });   // cartouche
      const segs = 14;
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs, t1 = (k + 1) / segs;
        const z0 = -inner + t0 * inner * 2, z1 = -inner + t1 * inner * 2;
        const yA = H - 1.0 - 0.9 * (1 - Math.pow(2 * t0 - 1, 2)) * 0 - 0.7 * (Math.pow(2 * ((t0 + t1) / 2) - 1, 2));
        g.box((z0 + z1) / 2, yA - 0.2, 0.2, z1 - z0 + 0.02, 0.4, D * 0.5, '#dccdab', { m: 'marble' });
      }
      // valance (red pelmet with gold fringe) just behind the arch
      g.box(0, H - 1.85, -0.15, inner * 2, 0.9, 0.12, red, { m: 'velvet' });
      for (let k = 0; k < 26; k++) g.box(-inner + (k + 0.5) * inner * 2 / 26, H - 2.33, -0.08, inner * 2 / 26 - 0.04, 0.08, 0.02, gold, { m: 'gold' });
      // marquee bulbs along the arch frieze and up both pilasters
      for (let k = -24; k <= 24; k++) g.sph(k * (inner + 0.4) / 24, H - 0.88, D / 2 + 0.06, 0.06, '#fff2d0', { seg: 4, emi: 1.9 });
      for (const s of [-1, 1]) for (let y = 0.9; y < H - 1.1; y += 0.42) g.sph(s * (inner + 0.5) - s * 0.36, y, D / 2 + 0.07, 0.05, '#fff2d0', { seg: 4, emi: 1.9 });
      // footlight strip & house lamps on pilaster faces
      for (const s of [-1, 1]) for (const y of [2.2, 3.6]) { g.box(s * (inner + 0.5), y, D / 2 + 0.08, 0.18, 0.28, 0.1, gold, { m: 'gold' }); g.sph(s * (inner + 0.5), y + 0.12, D / 2 + 0.16, 0.09, '#fff2d0', { seg: 8, emi: 1.9 }); }
    },
  },
  // Orchestra pit: dark sunken well with music stands, a conductor's podium and a brass-topped rail (+Z = audience).
  pit_rail: {
    build(g, W, D, H, v, rnd) {
      g.box(0, 0.006, 0, W, 0.012, D - 0.1, '#0c0c0e', { m: 'matte' });   // pit "void"
      for (let k = 0; k < Math.round(W / 1.1); k++) {
        const x = -W / 2 + 0.6 + k * 1.1, z = -D / 2 + 0.6 + (k % 2) * 0.55;
        g.cyl(x, 0.45, z, 0.01, 0.9, '#2a2b2e', { seg: 4 });
        g.box(x, 0.95, z + 0.05, 0.4, 0.28, 0.02, '#1d1d1f', { rot: [-0.4, 0, 0] });
        g.box(x, 0.97, z + 0.065, 0.12, 0.08, 0.004, '#fff2d0', { emi: 1.5, rot: [-0.4, 0, 0] });
      }
      g.box(0, 0.1, -D / 2 + 0.3, 0.6, 0.2, 0.6, '#1d1d1f', {});
      // rail wall towards the audience
      g.box(0, H / 2, D / 2 - 0.08, W, H, 0.16, '#3a1418', { m: 'velvet' });
      g.box(0, H + 0.02, D / 2 - 0.08, W + 0.04, 0.05, 0.22, K.walnutD, { m: 'wood' });
      g.box(0, H + 0.05, D / 2 - 0.08, W, 0.02, 0.06, K.brass, { m: 'brass' });
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.08), H / 2, 0, 0.16, H, D, '#3a1418', { m: 'velvet' });
      for (let x = -W / 2 + 1; x < W / 2; x += 2) g.box(x, H * 0.5, D / 2 + 0.003, 0.08, 0.05, 0.004, '#ffcf8a', { emi: 1.6 });
    },
  },
  // Side theatre box: low dais, gilt balustrade front, swagged drapes and a canopy; two chairs (+Z = stage).
  theatre_box: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      const red = '#8e1a24';
      g.box(0, 0.075, 0, W, 0.15, D, '#3a1418', { m: 'velvet' });
      g.box(0, 0.152, 0, W - 0.1, 0.004, D - 0.1, '#6a1a20', { m: 'velvet' });
      // balustrade front & sides
      g.box(0, 0.55, D / 2 - 0.06, W, 0.8, 0.12, '#e6d8b8', { m: 'marble' });
      g.box(0, 0.55, D / 2 + 0.005, W - 0.2, 0.55, 0.02, K.gold, { m: 'gold' });
      g.box(0, 0.98, D / 2 - 0.06, W + 0.04, 0.06, 0.2, red, { m: 'velvet' });
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.06), 0.55, 0, 0.12, 0.8, D, '#e6d8b8', { m: 'marble' });
      // posts + canopy + drapes
      for (const s of [-1, 1]) {
        g.box(s * (W / 2 - 0.1), H / 2, D / 2 - 0.1, 0.16, H, 0.16, K.gold, { m: 'gold' });
        for (let k = 0; k < 4; k++) g.box(s * (W / 2 - 0.3 - k * 0.12), (H - 0.4) / 2 + 0.4, D / 2 - 0.2 - (k % 2) * 0.05, 0.14, H - 0.8, 0.08, k % 2 ? red : '#6a1018', { m: 'velvet' });
      }
      g.box(0, H - 0.15, 0.0, W, 0.3, D, red, { m: 'velvet' });
      g.box(0, H - 0.31, D / 2, W, 0.06, 0.04, K.gold, { m: 'gold' });
      for (let k = 0; k < 12; k++) g.box(-W / 2 + (k + 0.5) * W / 12, H - 0.36, D / 2 + 0.01, W / 12 - 0.04, 0.06, 0.02, K.gold, { m: 'gold' });
      // two gilt chairs
      for (const x of [-0.75, 0.75]) {
        g.box(x, 0.62, 0.1, 0.5, 0.08, 0.5, red, { m: 'velvet', r: 0.03, steps: 1 });
        g.box(x, 0.95, -0.15, 0.48, 0.6, 0.08, red, { m: 'velvet', r: 0.03, steps: 1 });
        for (const dx of [-0.22, 0.22]) for (const dz of [-0.12, 0.3]) g.box(x + dx, 0.38, dz, 0.04, 0.46, 0.04, K.gold, { m: 'gold' });
      }
      g.sph(0, 1.9, -D / 2 + 0.15, 0.1, '#fff2d0', { seg: 8, emi: 1.9 });   // box lamp
      g.box(0, 1.9, -D / 2 + 0.05, 0.1, 0.2, 0.06, K.gold, { m: 'gold' });
    },
  },
  // Dress-circle / balcony front: curved-look gilt-and-cream parapet with lamp brackets (+Z = stage side).
  circle_front: {
    build(g, W, D, H, v, rnd) {
      g.box(0, H / 2, 0, W, H, D * 0.5, '#e6d8b8', { m: 'marble' });
      g.box(0, H * 0.55, D * 0.25 + 0.01, W, H * 0.5, 0.03, '#b8913e', { m: 'gold' });
      for (let x = -W / 2 + 0.6; x < W / 2; x += 1.2) g.box(x, H * 0.55, D * 0.25 + 0.03, 0.5, H * 0.32, 0.02, '#8e1a24', { m: 'velvet' });
      g.box(0, H + 0.02, 0, W + 0.04, 0.06, D * 0.7, '#6a1a20', { m: 'velvet' });
      g.box(0, H - 0.05, D * 0.25 + 0.04, W, 0.04, 0.03, K.gold, { m: 'gold' });
      for (let x = -W / 2 + 1.8; x < W / 2 - 1; x += 3.6) { g.box(x, H * 0.4, D * 0.25 + 0.06, 0.1, 0.2, 0.08, K.gold, { m: 'gold' }); g.sph(x, H * 0.4 + 0.15, D * 0.25 + 0.14, 0.07, '#fff2d0', { seg: 6, emi: 1.9 }); }
    },
  },
  ...TECH,
};

// ── helpers that need K ───────────────────────────────────────────────────
function sofaModel(g, W, D, H, nSeat) {
  g.aoH = 0.2;
  const arm = 0.18, legH = 0.1;
  legs4(g, -W / 2 + 0.08, W / 2 - 0.08, -D / 2 + 0.08, D / 2 - 0.08, legH, 0.02, K.walnutD, 'wood', 0.015);
  g.bx(-W / 2 + 0.02, legH, -D / 2 + 0.02, W / 2 - 0.02, 0.3, D / 2 - 0.02, K.white, { tint: true, m: 'fabric', r: 0.03, steps: 1 });
  // back frame & arms
  g.box(0, (0.3 + H) / 2, -D / 2 + 0.1, W - 0.02, H - 0.3, 0.18, K.white, { r: 0.05, steps: 1, tint: true, m: 'fabric' });
  for (const s of [-1, 1]) g.box(s * (W / 2 - arm / 2), 0.47, 0.01, arm, 0.34, D - 0.04, K.white, { r: 0.06, steps: 1, tint: true, m: 'fabric' });
  const sw = (W - 2 * arm - 0.02) / nSeat;
  for (let k = 0; k < nSeat; k++) {
    const x = -W / 2 + arm + 0.01 + (k + 0.5) * sw;
    cushion(g, x, 0.37, 0.07, sw - 0.012, 0.14, D - 0.26, '#ffffff', { steps: 1 });
    cushion(g, x, 0.6, -D / 2 + 0.24, sw - 0.03, 0.38, 0.16, '#f6f2ea', { rot: [-0.18, 0, 0], steps: 1 });
  }
  // contrasting throw pillows
  cushion(g, -W / 2 + arm + 0.22, 0.58, -D / 2 + 0.38, 0.38, 0.36, 0.11, '#e6dccb', { tint: false, rot: [-0.3, 0.3, 0.12] });
  cushion(g, W / 2 - arm - 0.22, 0.58, -D / 2 + 0.38, 0.38, 0.36, 0.11, '#f0eadf', { tint: false, rot: [-0.3, -0.3, -0.12] });
}

function bottle(g, x, y, z, rnd, lit = false) {
  const cols = ['#2f5a2a', '#6a3a1a', '#c9b67a', '#e8e6de', '#3a2a4a', '#8a1f1f', '#d9a03a', '#1f3a5a', '#4a6a2a'];
  const c = cols[Math.floor(rnd() * cols.length)];
  const h = 0.22 + rnd() * 0.12, r = 0.032 + rnd() * 0.012;
  g.lathe([[0.001, 0], [r, 0], [r, h * 0.62], [r * 0.4, h * 0.8], [r * 0.32, h], [0.001, h]], x, y, z, c, { seg: 5, m: 'glass', emi: lit ? 0.35 : 0 });
}

function product(g, v, x, y, z, depth, rnd) {
  switch (v) {
    case 'spirits': { const c = ['#6a3a1a', '#c9b67a', '#2f5a2a', '#e8e6de', '#8a1f1f', '#d9a03a'][Math.floor(rnd() * 6)]; for (const dz of [-0.1, 0.05]) { const h = 0.26 + rnd() * 0.06; g.lathe([[0.001, 0], [0.04, 0], [0.04, h * 0.65], [0.015, h * 0.82], [0.014, h], [0.001, h]], x, y, z + dz, c, { seg: 6, m: 'glass' }); } g.box(x, y + 0.004, z + 0.15, 0.08, 0.004, 0.03, '#ffffff', {}); return 0.11; }
    case 'clothes': { const c = ['#1f3a5f', '#f0ede6', '#8a2b2b', '#5a7a8a', '#c9b28a', '#2b2b2b', '#e0a0a8'][Math.floor(rnd() * 7)]; const n = 3 + Math.floor(rnd() * 4); for (let s = 0; s < n; s++) g.box(x + 0.15, y + 0.02 + s * 0.04, z, 0.28, 0.038, Math.min(0.3, depth), c, { m: 'fabric' }); return 0.33; }
    case 'jewellery': { g.box(x + 0.06, y + 0.04, z, 0.1, 0.08, 0.1, ['#1c1c1c', '#7a1f2a', '#f0ece4'][Math.floor(rnd() * 3)], { m: 'leather' }); g.sph(x + 0.06, y + 0.1, z, 0.012, K.gold, { seg: 4, m: 'gold' }); return 0.18; }
    case 'food': { const c = ['#e83b2b', '#f2c230', '#2b8ae8', '#3bbf5a', '#f07a2b', '#8a2be8'][Math.floor(rnd() * 6)]; g.box(x + 0.07, y + 0.13, z, 0.13, 0.25, 0.06, c, { m: 'plastic', r: 0.02, steps: 1 }); g.box(x + 0.07, y + 0.13, z + 0.1, 0.13, 0.25, 0.06, c, { m: 'plastic', r: 0.02, steps: 1 }); return 0.15; }
    case 'logo': { if (rnd() < 0.5) { const c = rnd() < 0.5 ? '#1d2c4a' : '#f2f0ea'; for (let s = 0; s < 4; s++) g.box(x + 0.15, y + 0.02 + s * 0.04, z, 0.28, 0.038, 0.26, c, { m: 'fabric' }); g.box(x + 0.15, y + 0.12 + 0.02, z + 0.131, 0.08, 0.06, 0.002, '#c8a050', {}); return 0.33; } for (let k = 0; k < 3; k++) g.cyl(x + 0.05 + k * 0.09, y + 0.05, z, 0.04, 0.1, '#f2f0ea', { seg: 10, m: 'ceramic' }); return 0.3; }
    case 'crew': { const s = 0.3 + rnd() * 0.15; g.box(x + s / 2, y + s * 0.4, z, s - 0.02, s * 0.8, Math.min(0.4, depth), K.cardboard, { m: 'matte' }); return s + 0.02; }
    default: { // sundries: colourful boxes and bottles
      const c = ['#e8e2d6', '#3a7ab0', '#e85a5a', '#5ab070', '#f2c230', '#ffffff', '#8a5ab0'][Math.floor(rnd() * 7)];
      if (rnd() < 0.5) { const h = 0.12 + rnd() * 0.12; g.box(x + 0.05, y + h / 2, z - 0.05, 0.08, h, 0.08, c, { m: 'plastic' }); g.box(x + 0.05, y + h / 2, z + 0.06, 0.08, h, 0.08, c, { m: 'plastic' }); return 0.1; }
      const h = 0.15 + rnd() * 0.08; g.cyl(x + 0.04, y + h / 2, z, 0.035, h, c, { seg: 8, m: 'plastic' }); g.cyl(x + 0.04, y + h + 0.015, z, 0.015, 0.03, '#ffffff', { seg: 6 }); return 0.09;
    }
  }
}

function triGeo(pts) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  g.computeVertexNormals();
  return g;
}
