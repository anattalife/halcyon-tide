// Technical, service, crew, leisure-equipment and exterior props.
// Same contract as furnitureModels.js: build(g, W, D, H, variant, rnd) in item-local space.
import { mat4, SCR } from './propsGeo.js';

const PI = Math.PI, TAU = PI * 2;
const C = {
  steel: '#a9afb4', steelD: '#5c6268', steelL: '#cdd2d6', black: '#151517', white: '#f1efea', ink: '#202024',
  machine: '#3f6f8f', machineG: '#4f7a5a', pipeR: '#a8352b', pipeY: '#d9a52a', pipeB: '#2f6aa8', pipeG: '#3b7a4a',
  cream: '#e7e2d6', grey: '#8a8d90', greyD: '#4a4c50', greyL: '#c8cacc', red: '#c0281e', orange: '#ea6a1f',
  walnut: '#563826', wood: '#a27d55', chrome: '#d4d9de', brass: '#c8a050', yellow: '#f2c230', panel: '#d8dcd6',
};
function sqLegs(g, x0, x1, z0, z1, h, s, col, m = 'wood') { for (const x of [x0, x1]) for (const z of [z0, z1]) g.box(x, h / 2, z, s, h, s, col, { m }); }
const LED = (g, x, y, z, col, s = 0.02) => g.box(x, y, z, s, s, 0.008, col, { emi: 1.9 });

export const TECH = {
  // ── GALLEY ───────────────────────────────────────────────────────────────
  range: {
    build(g, W, D, H) {
      g.aoH = 0.12;
      g.box(0, 0.06, 0, W - 0.06, 0.12, D - 0.08, C.ink, {});
      g.bx(-W / 2, 0.12, -D / 2, W / 2, H - 0.04, D / 2, '#7d848a', { m: 'brushed' });
      g.box(0, H - 0.02, 0, W, 0.04, D, '#9aa1a6', { m: 'steel' });
      g.box(0, H - 0.06, D / 2 + 0.01, W, 0.06, 0.03, '#5c6268', { m: 'steel' });
      // oven doors + knobs on the cook side (+Z)
      const n = Math.max(2, Math.round(W / 0.8));
      for (let k = 0; k < n; k++) {
        const x = -W / 2 + (k + 0.5) * W / n;
        g.box(x, 0.45, D / 2 + 0.008, W / n - 0.06, 0.5, 0.016, '#a9afb4', { m: 'brushed' });
        g.box(x, 0.66, D / 2 + 0.03, W / n - 0.2, 0.025, 0.025, C.chrome, { m: 'chrome' });
        g.box(x, 0.46, D / 2 + 0.018, W / n - 0.24, 0.16, 0.004, '#1a1a1c', { m: 'screen' });
        for (let q = 0; q < 2; q++) g.cyl(x - 0.1 + q * 0.2, H - 0.1, D / 2 + 0.02, 0.022, 0.03, C.black, { rot: [PI / 2, 0, 0], seg: 8 });
        // burners / griddle on top
        if (k % 3 === 2) g.box(x, H + 0.005, 0, W / n - 0.1, 0.012, D - 0.2, '#2a2a2c', { m: 'iron' });
        else for (const dz of [-0.2, 0.2]) for (const dx of [-0.18, 0.18]) {
          g.torus(x + dx, H + 0.012, dz, 0.085, 0.012, '#2a2a2c', { rot: [PI / 2, 0, 0], ts: 10, rs: 3, m: 'iron' });
          g.cyl(x + dx, H + 0.01, dz, 0.03, 0.01, '#3a1f12', { seg: 8 });
        }
      }
      // pots & pans
      g.lathe([[0.001, 0], [0.15, 0], [0.16, 0.22], [0.165, 0.23], [0.15, 0.22], [0.14, 0.02]], -W / 2 + 0.4, H + 0.02, -0.15, C.steelL, { seg: 14, m: 'steel' });
      g.cyl(W / 2 - 0.5, H + 0.03, 0.12, 0.13, 0.04, '#2a2a2c', { seg: 14, m: 'iron' });
      g.box(W / 2 - 0.5 + 0.25, H + 0.04, 0.12, 0.22, 0.02, 0.03, '#2a2a2c', {});
      // back splash with control strip
      g.box(0, H + 0.2, -D / 2 + 0.03, W, 0.4, 0.04, '#8a9096', { m: 'brushed' });
      // extraction canopy hood above (hangs from the deckhead, inside the footprint)
      g.lathe([[0.001, 0], [0.5, 0], [0.5, 0.06], [0.3, 0.38], [0.001, 0.38]], 0, H + 0.82, 0, '#b8bec2', { seg: 4, phiStart: Math.PI / 4, s: [W * 0.7, 1, D * 0.68], m: 'brushed' });
      g.box(0, H + 0.81, 0, W - 0.08, 0.02, D - 0.08, '#2a2c2e', { m: 'steel' });
      for (let k = 0; k < n; k++) g.box(-W / 2 + (k + 0.5) * W / n, H + 0.795, 0.1, 0.3, 0.01, 0.12, '#fff2d8', { emi: 1.6 });
      g.box(0, H + 1.4, 0, 0.5, 0.25, 0.4, '#a9afb4', { m: 'brushed' });
      for (let k = 0; k < n; k++) LED(g, -W / 2 + (k + 0.5) * W / n, H + 0.3, -D / 2 + 0.055, k % 2 ? '#ff5a2a' : '#5aff7a');
    },
  },
  prep_table: {
    variant(it, room) {
      if (!room) return 'galley';
      if (room.type === 'laundry') return 'laundry';
      if (room.type === 'engine' || it.role === 'engineer') return 'workbench';
      return 'galley';
    },
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.12;
      if (v === 'workbench') {
        g.box(0, H - 0.03, 0, W, 0.06, D, '#7a5a3a', { m: 'wood' });
        for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) g.box(x, (H - 0.06) / 2, z, 0.06, H - 0.06, 0.06, '#3f4a55', { m: 'paint' });
        g.box(0, 0.2, 0, W - 0.1, 0.03, D - 0.1, '#3f4a55', { m: 'paint' });
        g.box(-W / 2 + 0.25, H + 0.08, 0, 0.18, 0.14, 0.24, '#2c4a7a', { m: 'paint' });   // vice
        g.box(0, H + 0.6, -D / 2 + 0.03, W, 1.1, 0.03, '#c8c4b8', { m: 'paint' });          // pegboard
        for (let k = 0; k < 9; k++) g.box(-W / 2 + 0.2 + k * (W - 0.4) / 8, H + 0.55 + (k % 3) * 0.2, -D / 2 + 0.06, 0.03, 0.2 + rnd() * 0.1, 0.02, ['#c0281e', '#222', '#d9a52a'][k % 3], {});
        g.box(W / 4, H + 0.12, 0.05, 0.4, 0.2, 0.22, '#c0281e', { m: 'paint' });             // toolbox
        return;
      }
      // stainless prep table / folding table
      g.box(0, H - 0.02, 0, W, 0.04, D, C.steelL, { m: 'brushed' });
      g.box(0, H + 0.05, -D / 2 + 0.01, W, 0.1, 0.02, C.steelL, { m: 'brushed' });
      for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) g.cyl(x, (H - 0.04) / 2, z, 0.02, H - 0.04, C.steel, { seg: 6, m: 'steel' });
      g.box(0, 0.18, 0, W - 0.08, 0.02, D - 0.08, C.steel, { m: 'brushed' });
      if (v === 'laundry') {
        for (let k = 0; k < 5; k++) g.box(-W / 2 + 0.25 + k * 0.35, H + 0.04 + (k % 2) * 0.02, 0, 0.3, 0.05 + (k % 3) * 0.03, 0.4, '#ffffff', { m: 'linen', r: 0.012, steps: 1 });
        for (let k = 0; k < 3; k++) g.box(-0.5 + k * 0.5, 0.25, 0, 0.4, 0.12, 0.5, ['#dfe8ee', '#f2f2ee', '#e8e2d6'][k], { m: 'linen' });
      } else {
        g.box(-W / 4, H + 0.01, 0.05, 0.5, 0.02, 0.32, '#e8e2d0', { m: 'plastic' });          // cutting board
        g.box(-W / 4 + 0.05, H + 0.03, 0.05, 0.25, 0.006, 0.03, C.chrome, { m: 'chrome' });   // knife
        for (let k = 0; k < 3; k++) g.lathe([[0.001, 0], [0.08, 0], [0.12, 0.08], [0.13, 0.09]], W / 4 + k * 0.25 - 0.25, H, -0.1, C.steelL, { seg: 12, m: 'steel' });
        for (let k = 0; k < 4; k++) g.sph(W / 4 - 0.25 + (k % 3) * 0.25, H + 0.05, -0.1, 0.035, ['#c0281e', '#e8a02a', '#5a9a3a'][k % 3], { seg: 6 });
        g.box(0, 0.25, 0, W - 0.2, 0.12, D - 0.2, C.steelL, { m: 'steel' });                  // stacked hotel pans
      }
    },
  },
  buffet: {
    variant: (it, room) => (room && room.type === 'crew_mess' ? 'crew' : 'guest'),
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.2;
      const top = 0.9;
      // service-side cabinet & guest-side counter with wood front
      g.box(0, 0.05, 0, W - 0.06, 0.1, D - 0.1, C.ink, {});
      g.bx(-W / 2, 0.1, -D / 2, W / 2, top - 0.05, D / 2 - 0.02, v === 'crew' ? C.steel : '#7a5a3e', { m: v === 'crew' ? 'brushed' : 'wood' });
      if (v !== 'crew') {
        const n = Math.round(W / 0.3);
        for (let k = 0; k < n; k++) g.box(-W / 2 + (k + 0.5) * W / n, 0.48, D / 2 - 0.01, W / n - 0.02, 0.7, 0.02, '#8a6a4a', { m: 'wood' });
        g.box(0, 0.14, D / 2 - 0.0, W - 0.04, 0.012, 0.012, '#ffd8a0', { emi: 4.5 });
      }
      g.box(0, top - 0.025, 0, W, 0.05, D, v === 'crew' ? C.steelL : '#e8e4dc', { m: v === 'crew' ? 'steel' : 'marble' });
      // tray slide rail on the guest side (+Z)
      g.box(0, top - 0.05, D / 2 + 0.0, W, 0.025, 0.12, C.steel, { m: 'brushed' });
      // hot wells with food in gastronorm pans
      const foods = ['#d9a440', '#a8452a', '#e8dcc0', '#5a8a3a', '#c86a2a', '#f2e6b0', '#8a3a2a', '#e8b0a0', '#3a6a2a', '#f0c070'];
      const n = Math.max(2, Math.floor((W - 0.2) / 0.36));
      for (let k = 0; k < n; k++) {
        const x = -W / 2 + 0.1 + (k + 0.5) * (W - 0.2) / n;
        g.box(x, top + 0.005, 0.05, 0.32, 0.02, 0.5, C.steelL, { m: 'steel' });
        g.box(x, top + 0.018, 0.05, 0.28, 0.01, 0.45, foods[Math.floor(rnd() * foods.length)], { m: 'gloss' });
        for (let q = 0; q < 3; q++) g.sph(x - 0.08 + q * 0.08, top + 0.025, 0.05 + (rnd() - 0.5) * 0.25, 0.03, foods[Math.floor(rnd() * foods.length)], { seg: 5, s: [1, 0.5, 1] });
        g.box(x + 0.1, top + 0.05, 0.15, 0.02, 0.01, 0.2, C.chrome, { m: 'chrome', rot: [0.4, 0, 0] });  // serving spoon
      }
      // sneeze guard: posts, angled glass, lit canopy
      for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) g.box(x, top + 0.25, -0.1, 0.03, 0.5, 0.03, C.chrome, { m: 'chrome' });
      g.box(0, top + 0.45, 0.12, W - 0.08, 0.012, 0.55, '#cfe3ea', { glass: true, rot: [-0.35, 0, 0] });
      g.box(0, top + 0.5, -0.1, W - 0.06, 0.04, 0.12, C.chrome, { m: 'chrome' });
      g.box(0, top + 0.475, -0.07, W - 0.2, 0.01, 0.05, '#ffe6b8', { emi: 4.5 });
      // plate stack at one end
      for (let s = 0; s < 8; s++) g.cyl(W / 2 - 0.2, top + 0.01 + s * 0.012, D / 2 - 0.3, 0.13, 0.01, '#fbfaf7', { seg: 12, m: 'ceramic' });
    },
  },
  fridge_walk: {
    build(g, W, D, H) {
      g.box(0, H / 2, 0, W, H, D, C.steelL, { m: 'brushed' });
      g.box(0.3, 1.05, D / 2 + 0.03, 1.0, 2.0, 0.06, C.steel, { m: 'brushed' });
      g.box(-0.15, 1.05, D / 2 + 0.08, 0.06, 0.3, 0.05, C.chrome, { m: 'chrome' });
      g.box(-W / 2 + 0.4, 1.6, D / 2 + 0.01, 0.2, 0.1, 0.02, C.black, {});
      g.box(-W / 2 + 0.4, 1.6, D / 2 + 0.022, 0.15, 0.05, 0.002, '#3aff6a', { emi: 1.8 });
    },
  },
  washer: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      // industrial washer-extractor
      g.box(0, 0.08, 0, W - 0.06, 0.16, D - 0.06, C.steelD, { m: 'steel' });
      g.box(0, (H + 0.16) / 2, -0.02, W, H - 0.16, D - 0.06, '#8d969d', { r: 0.03, steps: 1, m: 'brushed' });
      g.box(0, H - 0.05, -0.02, W + 0.01, 0.1, D - 0.05, '#2f6aa8', { m: 'paint' });
      g.box(0, 0.85, D / 2 - 0.035, W - 0.12, 1.0, 0.02, '#b9c0c5', { m: 'brushed' });
      g.cyl(0, 0.85, D / 2 - 0.03, 0.42, 0.06, C.steel, { rot: [PI / 2, 0, 0], seg: 24, m: 'steel' });
      g.cyl(0, 0.85, D / 2 + 0.0, 0.34, 0.02, '#3a4a55', { rot: [PI / 2, 0, 0], seg: 24, glass: true });
      g.cyl(0, 0.85, D / 2 - 0.06, 0.33, 0.02, '#c8d0d8', { rot: [PI / 2, 0, 0], seg: 20, m: 'linen' });   // laundry in drum
      g.box(0.5, 0.85, D / 2 + 0.02, 0.06, 0.18, 0.04, C.chrome, { m: 'chrome' });
      g.box(0, H - 0.18, D / 2 - 0.02, W - 0.2, 0.22, 0.04, C.greyD, { rot: [-0.3, 0, 0] });
      g.box(-0.2, H - 0.18, D / 2 + 0.005, 0.3, 0.12, 0.004, '#2a6aa8', { emi: SCR.ui, rot: [-0.3, 0, 0] });
      LED(g, 0.2, H - 0.16, D / 2 + 0.01, '#3aff6a'); LED(g, 0.3, H - 0.16, D / 2 + 0.01, '#ffb02a');
      g.cyl(0.4, H - 0.2, D / 2 + 0.01, 0.03, 0.02, C.red, { rot: [PI / 2, 0, 0], seg: 10 });
    },
  },

  // ── CREW & OFFICE ────────────────────────────────────────────────────────
  locker: {
    tints: 'locker',
    build(g, W, D, H, v) {
      g.aoH = 0.1;
      g.box(0, 0.05, 0, W - 0.02, 0.1, D - 0.04, C.greyD, {});
      g.bx(-W / 2, 0.1, -D / 2, W / 2, H, D / 2 - 0.02, '#c9cfd3', { m: 'paint' });
      g.box(0, (H + 0.1) / 2, D / 2 - 0.01, W - 0.03, H - 0.14, 0.02, '#ffffff', { tint: true, m: 'paint' });
      for (let k = 0; k < 4; k++) g.box(0, H - 0.25 - k * 0.04, D / 2 + 0.002, W - 0.16, 0.012, 0.004, C.greyD, {});   // vents
      g.box(W / 2 - 0.08, 1.05, D / 2 + 0.01, 0.03, 0.12, 0.02, C.chrome, { m: 'chrome' });
      g.box(-W / 2 + 0.12, 1.5, D / 2 + 0.002, 0.1, 0.05, 0.003, C.white, {});   // name card
    },
  },
  cabinet: {
    variant(it, room) {
      if (it.act === 'weapons' || (room && room.armory)) return 'gun';
      if (it.act === 'uniform' || (room && room.type === 'laundry')) return 'uniform';
      if (room && (room.type === 'medical')) return 'med';
      if (room && room.server) return 'server';
      return 'office';
    },
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      if (v === 'server') {
        g.box(0, H / 2, 0, W - 0.02, H, D, '#1a1c1f', { m: 'paint' });
        g.box(0, H / 2, D / 2, W - 0.08, H - 0.08, 0.01, '#2a2d32', { m: 'steel' });
        for (let k = 0; k < 24; k++) { const y = 0.15 + k * 0.07; g.box(0, y, D / 2 + 0.008, W - 0.16, 0.05, 0.006, '#26292d', {}); for (let q = 0; q < 6; q++) if (rnd() < 0.6) LED(g, -W / 2 + 0.15 + q * 0.04, y, D / 2 + 0.013, rnd() < 0.8 ? '#3aff6a' : rnd() < 0.5 ? '#ffb02a' : '#3ab4ff', 0.008); }
        return;
      }
      if (v === 'gun') {
        g.box(0, H / 2, -0.03, W - 0.02, H, D - 0.06, '#3a4248', { m: 'steel' });
        g.box(0, H / 2, D / 2 - 0.04, W - 0.06, H - 0.06, 0.01, '#cfe3ea', { glass: true });
        for (let k = 0; k < 5; k++) { const x = -W / 2 + 0.12 + k * (W - 0.24) / 4; g.box(x, 1.05, 0.0, 0.04, 0.85, 0.08, '#1a1a1c', { m: 'iron' }); g.box(x, 0.72, 0.03, 0.06, 0.15, 0.12, '#2a2a2c', {}); }
        g.box(0, 1.65, 0, W - 0.1, 0.02, D - 0.12, C.steel, {});
        for (let k = 0; k < 4; k++) g.box(-0.3 + k * 0.2, 1.72, 0, 0.14, 0.1, 0.18, '#2a3a2a', {});
        g.box(W / 2 - 0.1, 1.1, D / 2 - 0.02, 0.06, 0.1, 0.03, '#b02020', {}); LED(g, W / 2 - 0.1, 1.17, D / 2 - 0.005, '#ff3020');
        return;
      }
      if (v === 'uniform') {
        // open garment rail with uniforms
        g.box(0, 0.05, 0, W, 0.1, D, C.greyD, {});
        for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) g.box(x, H / 2, 0, 0.04, H, D, '#c9cfd3', { m: 'paint' });
        g.box(0, H - 0.03, 0, W, 0.04, D, '#c9cfd3', { m: 'paint' });
        g.pipe([-W / 2 + 0.05, H - 0.2, 0], [W / 2 - 0.05, H - 0.2, 0], 0.012, C.chrome, { m: 'chrome' });
        for (let k = 0; k < 7; k++) {
          const x = -W / 2 + 0.12 + k * (W - 0.24) / 6;
          const col = k % 3 === 0 ? '#f4f3ef' : k % 3 === 1 ? '#1d2c4a' : '#2a2a2c';
          g.box(x, H - 0.62, 0, 0.04, 0.78, 0.4, col, { m: 'fabric' });
          g.box(x, H - 0.24, 0, 0.012, 0.06, 0.32, C.chrome, {});
        }
        return;
      }
      const col = v === 'med' ? '#f2f4f4' : '#d8d6d0';
      g.box(0, H / 2, 0, W - 0.02, H, D - 0.02, col, { m: 'paint' });
      for (const s of [-1, 1]) {
        g.box(s * W / 4, H / 2 + 0.02, D / 2, W / 2 - 0.02, H - 0.1, 0.012, v === 'med' ? '#e8eef0' : '#cfcdc6', { m: 'paint' });
        g.box(s * 0.04, H / 2, D / 2 + 0.012, 0.015, 0.2, 0.015, C.chrome, { m: 'chrome' });
      }
      if (v === 'med') { g.box(0, H - 0.3, D / 2 + 0.008, 0.12, 0.04, 0.002, '#2a9a4a', {}); g.box(0, H - 0.3, D / 2 + 0.008, 0.04, 0.12, 0.002, '#2a9a4a', {}); }
    },
  },
  file_cab: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      g.box(0, H / 2, 0, W, H, D, '#8a9096', { m: 'paint', r: 0.01, steps: 1 });
      for (let k = 0; k < 4; k++) {
        const y = 0.17 + k * (H - 0.1) / 4;
        g.box(0, y, D / 2, W - 0.04, (H - 0.1) / 4 - 0.02, 0.012, '#9aa0a6', { m: 'paint' });
        g.box(0, y + 0.06, D / 2 + 0.012, 0.14, 0.02, 0.02, C.chrome, { m: 'chrome' });
        g.box(0, y + 0.11, D / 2 + 0.008, 0.08, 0.03, 0.002, C.white, {});
      }
    },
  },
  crate: {
    jitter: true,
    variant: (it) => (Math.abs(Math.round(it.x * 3 + it.z * 7)) % 3),
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      if (+v === 0) {
        // plywood crate with stencil & battens
        g.box(0, H / 2, 0, W, H, D, '#b08a5a', { m: 'wood' });
        for (const s of [-1, 1]) {
          for (const y of [0.05, H - 0.05]) g.box(0, y, s * (D / 2 + 0.01), W, 0.08, 0.02, '#8a6a42', { m: 'wood' });
          for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) g.box(x, H / 2, s * (D / 2 + 0.01), 0.08, H, 0.02, '#8a6a42', { m: 'wood' });
        }
        g.box(0, H / 2, D / 2 + 0.022, 0.5, 0.2, 0.002, '#2a2a2a', {});
      } else if (+v === 1) {
        // stacked cardboard boxes on a pallet
        palletBase(g, W, D);
        let y = 0.15;
        for (let l = 0; l < 3; l++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          const bw = W / 2 - 0.02, bd = D / 2 - 0.02, bh = 0.38;
          g.box(-W / 4 + a * W / 2, y + l * 0.4 + bh / 2, -D / 4 + b * D / 2, bw, bh, bd, l % 2 ? '#b8915e' : '#a7804f', { m: 'matte', r: 0.008, steps: 1 });
          g.box(-W / 4 + a * W / 2, y + l * 0.4 + bh, -D / 4 + b * D / 2, bw, 0.004, 0.05, '#c8b896', {});
        }
      } else {
        // shrink-wrapped beverage pallet
        palletBase(g, W, D);
        for (let l = 0; l < 4; l++) for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) g.cyl(-W / 2 + 0.15 + a * (W - 0.3) / 3, 0.15 + l * 0.31 + 0.14, -D / 2 + 0.17 + b * (D - 0.34) / 2, 0.12, 0.28, ['#2a6a3a', '#c8a050', '#8a2a2a'][l % 3], { seg: 6, m: 'gloss', open: true });
        g.box(0, 0.15 + (H - 0.15) / 2, 0, W, H - 0.15, D, '#e8f0f2', { glass: true });
      }
    },
  },
  pallet: {
    jitter: true,
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      palletBase(g, W, D);
      // sacks (provisions) stacked
      for (let l = 0; l < 4; l++) for (let a = 0; a < 2; a++) g.box(l % 2 ? 0 : -W / 4 + a * W / 2, 0.15 + l * 0.2 + 0.09, l % 2 ? -D / 4 + a * D / 2 : 0, l % 2 ? W - 0.06 : W / 2 - 0.04, 0.18, l % 2 ? D / 2 - 0.04 : D - 0.06, l % 2 ? '#d8cca8' : '#cbbd94', { r: 0.06, steps: 1, m: 'fabric' });
    },
  },
  engine: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.0;
      const L = W, col = C.machine;
      // bedplate & sump
      g.box(0, 0.25, 0, L, 0.5, D * 0.75, C.steelD, { m: 'iron' });
      g.box(0, 0.06, 0, L + 0.2, 0.12, D, '#4a4d50', { m: 'iron' });
      // crankcase with access doors
      g.box(-L * 0.08, 1.15, 0, L * 0.8, 1.3, D * 0.62, col, { m: 'paint', r: 0.05, steps: 1 });
      const nC = 8, cl = L * 0.8 / nC;
      for (let k = 0; k < nC; k++) {
        const x = -L * 0.48 + (k + 0.5) * cl;
        for (const s of [-1, 1]) g.cyl(x, 1.1, s * (D * 0.31 + 0.01), 0.22, 0.04, '#5a8aaa', { rot: [PI / 2, 0, 0], seg: 12, m: 'paint' });
        // V-bank cylinder blocks + heads + rocker covers
        for (const s of [-1, 1]) {
          g.box(x, 2.15, s * 0.55, cl - 0.06, 0.75, 0.75, col, { rot: [s * 0.5, 0, 0], m: 'paint' });
          g.box(x, 2.68, s * 0.85, cl - 0.1, 0.32, 0.6, '#6a6e72', { rot: [s * 0.5, 0, 0], m: 'iron' });
          g.box(x, 2.9, s * 0.98, cl - 0.18, 0.12, 0.45, C.red, { rot: [s * 0.5, 0, 0], m: 'paint', r: 0.03, steps: 1 });
          // exhaust risers to the centre manifold
          g.pipe([x, 2.6, s * 0.45], [x, 3.25, s * 0.18], 0.07, '#8a8580', { m: 'iron', seg: 6 });
          g.pipe([x + 0.15, 2.4, s * 1.15], [x + 0.15, 2.0, s * 1.35], 0.03, C.pipeY, { m: 'paint', seg: 5 });
        }
      }
      // insulated exhaust manifold (silver lagging)
      g.pipe([-L * 0.48, 3.35, 0], [L * 0.33, 3.35, 0], 0.26, '#d8d8d4', { m: 'matte', seg: 12 });
      for (let k = 0; k < 10; k++) g.cyl(-L * 0.45 + k * L * 0.08, 3.35, 0, 0.275, 0.04, '#b8b8b4', { rot: [0, 0, PI / 2], seg: 12 });
      // turbochargers at the free end (+X)
      for (const s of [-1, 1]) {
        g.sph(L * 0.38, 3.0, s * 0.6, 0.45, '#9a9690', { seg: 12, m: 'iron' });
        g.cyl(L * 0.38, 3.0, s * 0.6, 0.33, 0.6, '#7a7672', { rot: [0, 0, PI / 2], seg: 12, m: 'iron' });
        g.pipe([L * 0.38, 3.4, s * 0.6], [L * 0.38, H, s * 0.6], 0.24, '#d8d8d4', { seg: 10, m: 'matte' });
        g.pipe([L * 0.3, 2.3, s * 1.2], [L * 0.45, 2.3, s * 1.2], 0.15, C.pipeB, { m: 'paint', seg: 8 });
      }
      // flywheel & coupling at the -X end
      g.cyl(-L * 0.47, 1.25, 0, 1.0, 0.25, C.steelD, { rot: [0, 0, PI / 2], seg: 24, m: 'iron' });
      g.cyl(-L * 0.455, 1.25, 0, 1.03, 0.06, C.yellow, { rot: [0, 0, PI / 2], seg: 24, m: 'paint' });
      // walkway grating + handrails along one side
      for (const s of [-1, 1]) {
        g.box(0, 1.85, s * (D / 2 - 0.12), L * 0.85, 0.04, 0.24, '#6a6d70', { m: 'steel' });
        g.pipe([-L * 0.42, 2.45, s * (D / 2 - 0.02)], [L * 0.42, 2.45, s * (D / 2 - 0.02)], 0.025, C.yellow, { m: 'paint', seg: 6 });
        for (let x = -L * 0.42; x <= L * 0.43; x += 1.6) g.pipe([x, 1.85, s * (D / 2 - 0.02)], [x, 2.45, s * (D / 2 - 0.02)], 0.02, C.yellow, { m: 'paint', seg: 5 });
        // fuel & cooling pipes along the block
        g.pipe([-L * 0.45, 0.8, s * (D * 0.33)], [L * 0.45, 0.8, s * (D * 0.33)], 0.06, s > 0 ? C.pipeG : C.pipeR, { m: 'paint', seg: 8 });
        g.pipe([-L * 0.45, 0.62, s * (D * 0.35)], [L * 0.45, 0.62, s * (D * 0.35)], 0.04, C.pipeY, { m: 'paint', seg: 6 });
      }
      // local control panel with gauges
      g.box(L * 0.45, 1.3, D / 2 - 0.25, 0.6, 1.0, 0.3, C.panel, { m: 'paint' });
      for (let k = 0; k < 6; k++) g.cyl(L * 0.45 - 0.18 + (k % 3) * 0.18, 1.5 - Math.floor(k / 3) * 0.25, D / 2 - 0.09, 0.06, 0.02, C.white, { rot: [PI / 2, 0, 0], seg: 10 });
      LED(g, L * 0.45 - 0.2, 1.0, D / 2 - 0.09, '#3aff6a', 0.04); LED(g, L * 0.45, 1.0, D / 2 - 0.09, '#ffb02a', 0.04);
    },
  },
  generator: {
    build(g, W, D, H) {
      g.aoH = 0.0;
      g.box(0, 0.12, 0, W, 0.24, D, C.steelD, { m: 'iron' });
      // alternator (big cylinder) + prime mover block
      g.cyl(W * 0.2, 1.25, 0, D * 0.4, W * 0.45, C.machineG, { rot: [0, 0, PI / 2], seg: 20, m: 'paint' });
      for (let k = 0; k < 8; k++) g.cyl(W * 0.0 + k * W * 0.06, 1.25, 0, D * 0.41, 0.03, '#3a5a44', { rot: [0, 0, PI / 2], seg: 20 });
      g.box(-W * 0.25, 1.1, 0, W * 0.45, 1.5, D * 0.65, C.machine, { m: 'paint', r: 0.04, steps: 1 });
      g.box(-W * 0.25, 1.95, 0, W * 0.4, 0.2, D * 0.5, C.red, { m: 'paint' });
      g.pipe([-W * 0.4, 2.0, 0], [-W * 0.4, H, 0], 0.15, '#d8d8d4', { seg: 10 });
      g.box(W * 0.47, 1.3, 0, 0.1, 1.2, D * 0.6, '#5a5d60', {});   // terminal box
      g.box(-W * 0.48, 1.0, D / 2 - 0.3, 0.06, 0.6, 0.5, C.panel, {});
      LED(g, -W * 0.5, 1.15, D / 2 - 0.2, '#3aff6a', 0.04); LED(g, -W * 0.5, 1.15, D / 2 - 0.35, '#ff3a2a', 0.04);
      g.pipe([-W * 0.5, 0.5, -D * 0.3], [W * 0.5, 0.5, -D * 0.3], 0.05, C.pipeY, { seg: 6 });
    },
  },
  pump: {
    build(g, W, D, H) {
      g.aoH = 0.05;
      g.box(0, 0.08, 0, W, 0.16, D, C.steelD, { m: 'iron' });
      g.cyl(-W * 0.18, 0.6, 0, D * 0.32, W * 0.5, C.machine, { rot: [0, 0, PI / 2], seg: 16, m: 'paint' });   // motor
      for (let k = 0; k < 6; k++) g.box(-W * 0.18, 0.6, 0, W * 0.48, D * 0.7, 0.02, '#355a72', { rot: [k * PI / 6, 0, 0] });   // fins
      g.sph(W * 0.25, 0.55, 0, D * 0.3, C.machine, { seg: 12, s: [0.7, 1, 1], m: 'paint' });  // volute
      g.pipe([W * 0.25, 0.85, 0], [W * 0.25, H, 0], 0.09, C.pipeB, { seg: 8 });
      g.pipe([W * 0.45, 0.55, 0], [W / 2, 0.55, 0], 0.09, C.pipeB, { seg: 8 });
      g.cyl(W * 0.25, H - 0.25, 0, 0.13, 0.04, C.steel, { seg: 10 });
      g.cyl(W * 0.25, H - 0.08, 0.0, 0.1, 0.03, C.red, { seg: 10, rot: [0, 0, 0] });   // valve wheel
    },
  },
  switchboard: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.05;
      g.box(0, 0.05, 0, W, 0.1, D, C.greyD, {});
      g.bx(-W / 2, 0.1, -D / 2, W / 2, H, D / 2 - 0.02, '#c8ccc6', { m: 'paint' });
      const n = Math.round(W / 0.8);
      for (let k = 0; k < n; k++) {
        const x = -W / 2 + (k + 0.5) * W / n;
        g.box(x, (H + 0.1) / 2, D / 2 - 0.01, W / n - 0.03, H - 0.16, 0.02, '#d4d8d2', { m: 'paint' });
        // meters, mimic bus bar, indicator lamps, breakers
        for (let q = 0; q < 2; q++) { g.box(x - 0.15 + q * 0.3, 1.75, D / 2 + 0.005, 0.2, 0.2, 0.02, C.white, {}); g.box(x - 0.15 + q * 0.3, 1.75, D / 2 + 0.016, 0.16, 0.12, 0.002, '#1a1a1a', {}); }
        g.box(x, 1.5, D / 2 + 0.003, W / n - 0.06, 0.03, 0.004, '#2a6aa8', {});
        for (let q = 0; q < 4; q++) LED(g, x - 0.24 + q * 0.16, 1.35, D / 2 + 0.008, [q === 0 ? '#3aff6a' : q === 1 ? '#ff3a2a' : q === 2 ? '#ffffff' : '#ffb02a'][0], 0.035);
        for (let q = 0; q < 3; q++) { g.box(x - 0.2 + q * 0.2, 1.0, D / 2 + 0.02, 0.12, 0.2, 0.04, C.greyD, {}); g.box(x - 0.2 + q * 0.2, 1.03, D / 2 + 0.05, 0.03, 0.08, 0.03, C.black, {}); }
        g.cyl(x, 0.7, D / 2 + 0.02, 0.05, 0.04, C.black, { rot: [PI / 2, 0, 0], seg: 8 });
        g.box(x, 0.4, D / 2 + 0.003, 0.25, 0.12, 0.004, C.yellow, {});
      }
    },
  },
  console: {
    variant(it, room) {
      if (it.cctvConsole) return 'cctv';
      if (room && room.type === 'bridge') return 'bridge';
      if (room && room.type === 'bridgewing') return 'wing';
      if (room && room.type === 'engine') return 'ecr';
      return 'office';
    },
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      const dark = v === 'bridge' || v === 'wing';
      const body = dark ? '#26292e' : '#c8ccc6';
      // operator stands on +Z side (anchor z +0.75); screens face +Z
      g.box(0, 0.05, 0, W - 0.04, 0.1, D - 0.04, C.ink, {});
      g.bx(-W / 2, 0.1, -D / 2, W / 2, 0.72, D / 2 - 0.08, body, { m: 'paint' });
      g.box(0, 0.76, 0.12, W, 0.06, D - 0.24, dark ? '#1c1e22' : '#b8bcb6', { m: 'plastic', rot: [0.2, 0, 0] });
      g.box(0, 0.78, D / 2 - 0.12, W, 0.04, 0.22, dark ? '#3a2a20' : '#9a9e98', { m: dark ? 'leather' : 'plastic' });   // palm rest
      // controls on the desk
      for (let x = -W / 2 + 0.25; x < W / 2 - 0.2; x += 0.35) {
        for (let q = 0; q < 6; q++) g.box(x - 0.1 + (q % 3) * 0.1, 0.81 + Math.floor(q / 3) * 0.02, 0.1 - Math.floor(q / 3) * 0.1, 0.05, 0.015, 0.04, ['#3aff6a', '#ffb02a', '#ff3a2a', '#3ab4ff', '#ffffff'][Math.floor(rnd() * 5)], { emi: dark ? 1.0 : 0.9, rot: [0.2, 0, 0] });
        g.cyl(x + 0.12, 0.82, 0.05, 0.025, 0.04, C.black, { seg: 8 });
      }
      if (v === 'bridge' || v === 'wing') {
        // trackball, throttle levers on the centre console
        g.sph(0, 0.81, 0.18, 0.04, '#222', { seg: 8 });
        if (W > 3.5) for (const x of [-0.25, 0.25]) { g.box(x, 0.86, 0.0, 0.06, 0.12, 0.2, '#2a2d32', {}); g.box(x, 0.95, 0.02, 0.04, 0.14, 0.04, C.red, { rot: [0.4, 0, 0] }); }
      }
      // screen bank (raised, angled)
      const nS = Math.max(1, Math.round(W / (v === 'cctv' ? 0.62 : 0.7)));
      const sw = W / nS;
      const rows = v === 'cctv' ? 2 : 1;
      for (let r = 0; r < rows; r++) for (let k = 0; k < nS; k++) {
        const x = -W / 2 + (k + 0.5) * sw;
        const sh = v === 'cctv' ? 0.36 : 0.32;
        const y = v === 'cctv' ? 1.02 + r * 0.38 : H - 0.1, z = -D / 2 + 0.2 - r * 0.04;
        g.box(x, y, z, sw - 0.05, sh, 0.05, '#111214', { rot: [-0.18, 0, 0] });
        g.box(x, y - sh / 2 - 0.06, z - 0.02, 0.08, 0.14, 0.05, '#2a2d32', {});
        const scr = v === 'cctv' ? SCR.cctv : v === 'bridge' || v === 'wing' ? [SCR.radar, SCR.chart, SCR.ui][k % 3] : v === 'ecr' ? [SCR.ui, SCR.uiLight][k % 2] : SCR.uiLight;
        g.box(x, y, z + 0.028, sw - 0.09, sh - 0.04, 0.004, '#ffffff', { emi: scr, rot: [-0.18, 0, 0] });
      }
      if (v === 'cctv') g.box(0, 0.86, -D / 2 + 0.2, W, 0.03, 0.25, '#2a2d32', {});
      for (let x = -W / 2 + 0.4; x < W / 2 - 0.3; x += 0.8) {
        g.box(x, 0.42, -D / 2 - 0.004, 0.6, 0.5, 0.01, dark ? '#30343a' : '#b4b8b2', { m: 'paint' });
        for (let k = 0; k < 4; k++) g.box(x, 0.58 - k * 0.05, -D / 2 - 0.01, 0.4, 0.015, 0.004, '#15171a', {});
      }
    },
  },
  helm: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      // modern helm station: pedestal with small wheel, joystick & autopilot screen
      g.box(0, 0.45, 0.05, W * 0.7, 0.9, D * 0.6, '#26292e', { r: 0.04, steps: 1, m: 'paint' });
      g.box(0, 0.95, 0.05, W * 0.8, 0.1, D * 0.7, '#1c1e22', { rot: [-0.2, 0, 0] });
      g.box(0, 1.05, 0.1, 0.4, 0.26, 0.04, '#111214', { rot: [-0.6, 0, 0] });
      g.box(0, 1.05, 0.125, 0.36, 0.22, 0.004, '#ffffff', { emi: SCR.chart, rot: [-0.6, 0, 0] });
      // helm wheel (small, facing the helmsman at -Z)
      g.torus(0, 1.05, -D * 0.28, 0.18, 0.018, '#2a2a2c', { ts: 20, rs: 5, rot: [0.5, 0, 0], m: 'rubber' });
      for (let k = 0; k < 3; k++) g.box(0, 1.05, -D * 0.28, 0.34, 0.02, 0.02, '#3a3a3c', { rot: [0.5, 0, k * PI / 3] });
      g.cyl(0, 1.05, -D * 0.25, 0.04, 0.06, C.chrome, { seg: 10, rot: [PI / 2 - 0.5, 0, 0], m: 'chrome' });
      for (const x of [-0.38, 0.38]) { g.cyl(x, 1.04, -0.1, 0.02, 0.1, C.black, { seg: 6 }); g.sph(x, 1.1, -0.1, 0.035, C.black, { seg: 6 }); }
      LED(g, -0.25, 0.99, -D * 0.25, '#3aff6a', 0.03); LED(g, 0.25, 0.99, -D * 0.25, '#ffb02a', 0.03);
    },
  },
  med_bed: {
    variant: (it, room) => (room && room.type === 'spa' ? 'massage' : 'hospital'),
    build(g, W, D, H, v) {
      g.aoH = 0.1;
      if (v === 'massage') {
        sqLegs(g, -W / 2 + 0.12, W / 2 - 0.12, -D / 2 + 0.12, D / 2 - 0.12, 0.6, 0.06, '#c4a27a');
        g.box(0, 0.66, 0, W - 0.2, 0.12, D - 0.1, '#e8e0d4', { r: 0.05, steps: 1, m: 'leather' });
        g.box(0, 0.735, -D / 2 + 0.25, 0.3, 0.02, 0.14, '#f2ede4', {});                     // face cradle
        g.box(0, 0.74, 0.25, W - 0.24, 0.04, 0.8, '#f8f6f0', { r: 0.015, steps: 1, m: 'linen' });   // towel
        g.box(0, 0.78, 0.1, 0.25, 0.06, 0.12, '#f8f6f0', { r: 0.02, steps: 1, m: 'linen' });
        g.cyl(W / 2 - 0.05, 0.05, D / 2 - 0.2, 0.05, 0.08, '#e8e0d0', { seg: 8 });
        return;
      }
      // hospital bed: wheeled base, mattress, raised back, side rails, IV pole
      for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) g.cyl(x, 0.06, z, 0.06, 0.04, C.black, { rot: [0, 0, PI / 2], seg: 8 });
      g.box(0, 0.32, 0, W - 0.12, 0.08, D - 0.2, '#6c747a', { m: 'steel' });
      g.box(0, 0.2, 0, 0.2, 0.25, 0.4, C.greyL, {});
      g.box(0, 0.45, 0.25, W - 0.1, 0.14, D - 0.65, '#5f8fa8', { r: 0.04, steps: 1, m: 'plastic' });
      g.box(0, 0.6, -D / 2 + 0.42, W - 0.1, 0.12, 0.75, '#5f8fa8', { r: 0.04, steps: 1, m: 'plastic', rot: [-0.45, 0, 0] });
      g.box(0, 0.53, 0.3, W - 0.06, 0.03, D - 0.8, '#bcd2e2', { r: 0.01, steps: 1, m: 'linen' });
      g.box(0, 0.73, -D / 2 + 0.25, 0.45, 0.1, 0.3, '#ffffff', { r: 0.04, steps: 1, m: 'linen', rot: [-0.45, 0, 0] });
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.02), 0.62, 0.0, 0.03, 0.18, 0.8, '#9aa4aa', { m: 'plastic' });
      g.box(0, 0.62, D / 2 - 0.05, W - 0.1, 0.4, 0.04, '#7a5a42', { m: 'wood' });
      g.box(0, 0.72, -D / 2 + 0.03, W - 0.1, 0.5, 0.04, '#7a5a42', { m: 'wood' });
      g.box(0.25, 1.05, -D / 2 + 0.05, 0.3, 0.2, 0.05, '#1a1c1f', {});
      g.box(0.25, 1.05, -D / 2 + 0.077, 0.26, 0.16, 0.004, '#ffffff', { emi: SCR.radar });
      g.cyl(W / 2 - 0.08, 0.95, -D / 2 + 0.15, 0.012, 1.3, C.chrome, { seg: 6, m: 'chrome' });
      g.box(W / 2 - 0.08, 1.55, -D / 2 + 0.15, 0.1, 0.16, 0.04, '#e8f4ff', { glass: true });
    },
  },
  treadmill: {
    build(g, W, D, H) {
      g.aoH = 0.05;
      // runner faces +Z (console at +Z)
      g.box(0, 0.12, -0.1, W - 0.06, 0.18, D - 0.3, '#2a2b2e', { r: 0.03, steps: 1, m: 'plastic' });
      g.box(0, 0.215, -0.1, W - 0.22, 0.012, D - 0.4, '#151517', { m: 'rubber' });
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.08), 0.22, -0.1, 0.1, 0.02, D - 0.35, C.alu ?? '#c3c7cb', { m: 'brushed' });
      for (const s of [-1, 1]) g.pipe([s * (W / 2 - 0.06), 0.2, D / 2 - 0.3], [s * (W / 2 - 0.08), 1.25, D / 2 - 0.12], 0.03, '#c3c7cb', { m: 'brushed', seg: 8 });
      for (const s of [-1, 1]) g.pipe([s * (W / 2 - 0.08), 1.05, D / 2 - 0.15], [s * (W / 2 - 0.08), 1.05, D / 2 - 0.55], 0.02, '#2a2b2e', { seg: 6 });
      g.box(0, 1.28, D / 2 - 0.12, W - 0.12, 0.26, 0.12, '#2a2b2e', { r: 0.03, steps: 1, rot: [-0.5, 0, 0] });
      g.box(0, 1.3, D / 2 - 0.17, W - 0.3, 0.17, 0.006, '#ffffff', { emi: SCR.uiLight, rot: [-0.5, 0, 0] });
      g.box(0, 0.08, D / 2 - 0.2, W - 0.08, 0.14, 0.25, '#2a2b2e', { m: 'plastic' });
    },
  },
  weights: {
    build(g, W, D, H) {
      g.aoH = 0.05;
      // A-frame dumbbell rack (two tiers)
      for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) { g.box(x, H * 0.4, 0, 0.06, H * 0.8, 0.06, '#2a2b2e', { rot: [0.25, 0, 0] }); g.box(x, H * 0.4, 0, 0.06, H * 0.8, 0.06, '#2a2b2e', { rot: [-0.25, 0, 0] }); }
      for (const [y, z] of [[0.45, 0.12], [0.75, -0.08]]) {
        g.box(0, y, z, W, 0.04, 0.22, '#2a2b2e', { rot: [0.3, 0, 0] });
        const n = 8;
        for (let k = 0; k < n; k++) {
          const x = -W / 2 + 0.15 + k * (W - 0.3) / (n - 1), r = 0.05 + k * 0.007;
          for (const s of [-1, 1]) g.cyl(x, y + r + 0.02, z + s * 0.09, r, 0.05, '#18181a', { rot: [PI / 2, 0, 0], seg: 6 });
          g.pipe([x, y + r + 0.02, z - 0.07], [x, y + r + 0.02, z + 0.07], 0.016, C.chrome, { seg: 5 });
        }
      }
      // weight bench beside? (keep within footprint) — mirror strip behind
      g.box(0, H - 0.08, -D / 2 + 0.03, W, 0.12, 0.03, C.chrome, { m: 'chrome' });
    },
  },
  arcade: {
    tints: 'arcade',
    build(g, W, D, H) {
      g.aoH = 0.1;
      const side = [[-D / 2, 0], [D / 2 - 0.1, 0], [D / 2 - 0.1, 0.9], [D / 2 - 0.25, 1.05], [D / 2 - 0.32, 1.5], [D / 2 - 0.15, 1.62], [D / 2 - 0.2, H], [-D / 2, H]];
      for (const s of [-1, 1]) g.ext(side.map(([z, y]) => [z, y]), 0.04, '#ffffff', { mat: mat4(s * (W / 2 - 0.02) - 0.02 * (s > 0 ? 1 : 0) + (s > 0 ? -0.02 : 0), 0, 0, 0, -PI / 2, 0), tint: true, m: 'gloss' });
      g.box(0, 0.45, -0.03, W - 0.08, 0.9, D - 0.14, '#18181c', { m: 'gloss' });
      g.box(0, 0.98, D / 2 - 0.18, W - 0.08, 0.06, 0.24, '#202024', { rot: [0.25, 0, 0] });   // control panel
      g.box(-0.15, 1.03, D / 2 - 0.14, 0.03, 0.08, 0.03, C.black, {}); g.sph(-0.15, 1.08, D / 2 - 0.14, 0.03, '#e8302a', { seg: 6 });
      for (let k = 0; k < 4; k++) g.cyl(0.05 + (k % 2) * 0.09, 1.02, D / 2 - 0.17 + Math.floor(k / 2) * 0.07, 0.022, 0.02, ['#ffd23b', '#3bb4ff', '#3bff6e', '#ff3b8a'][k], { seg: 8, emi: 1.5 });
      g.box(0, 1.3, D / 2 - 0.3, W - 0.1, 0.46, 0.04, '#111214', { rot: [-0.25, 0, 0] });
      g.box(0, 1.3, D / 2 - 0.275, W - 0.16, 0.4, 0.004, '#ffffff', { emi: SCR.arcade, rot: [-0.25, 0, 0] });
      g.box(0, 1.69, D / 2 - 0.18, W - 0.08, 0.18, 0.02, '#ffffff', { emi: 1.6, tint: true });   // marquee
      g.box(0, 0.4, D / 2 - 0.1, 0.12, 0.08, 0.01, '#ffd23b', { emi: 1.4 });                      // coin slot glow
    },
  },
  junction: {
    build(g, W, D, H) {
      g.box(0, H / 2, 0, W, H, D, '#c8ccc6', { m: 'paint', r: 0.01, steps: 1 });
      g.box(0, H / 2, D / 2, W - 0.04, H - 0.04, 0.01, '#d4d8d2', { m: 'paint' });
      g.box(0, H - 0.2, D / 2 + 0.006, 0.18, 0.12, 0.002, C.yellow, {});
      g.box(0, H - 0.2, D / 2 + 0.008, 0.06, 0.06, 0.002, C.black, { rot: [0, 0, PI / 4] });
      g.box(W / 2 - 0.08, H / 2, D / 2 + 0.02, 0.03, 0.12, 0.03, C.black, {});
      LED(g, -W / 2 + 0.1, H - 0.12, D / 2 + 0.006, '#3aff6a', 0.03); LED(g, -W / 2 + 0.18, H - 0.12, D / 2 + 0.006, '#ff3a2a', 0.03);
      g.pipe([0, H, 0], [0, H + 0.6, 0], 0.04, C.greyD, { seg: 6 });
    },
  },
  hose_box: {
    build(g, W, D, H) {
      g.box(0, H / 2, 0, W, H, D, C.red, { m: 'paint', r: 0.01, steps: 1 });
      g.box(0, H / 2 + 0.05, D / 2, W - 0.06, H - 0.2, 0.01, '#cfe3ea', { glass: true });
      g.torus(0, H / 2 + 0.05, 0.0, 0.2, 0.05, '#d8302a', { ts: 16, rs: 6, m: 'rubber' });
      g.cyl(0, H / 2 + 0.05, 0.0, 0.1, 0.12, '#8a8d90', { rot: [PI / 2, 0, 0], seg: 10 });
      g.box(0, 0.08, D / 2 + 0.006, W - 0.1, 0.08, 0.004, C.white, {});
      g.box(0, H - 0.06, D / 2 + 0.006, W * 0.6, 0.05, 0.004, C.white, {});
    },
  },
  life_ring: {
    build(g, W, D, H) {
      const R = W / 2 - 0.08, r = 0.075, cy = H / 2;
      // bracket
      g.box(0, cy + R + 0.02, -D / 2 + 0.02, 0.1, 0.12, 0.04, '#c8ccc6', {});
      // ring in 8 alternating orange/white segments + reflective tape + grab line
      for (let k = 0; k < 8; k++) g.torus(0, cy, 0, R, r, k % 2 ? C.white : C.orange, { arc: TAU / 8 + 0.01, rot: [0, 0, k * TAU / 8 + PI / 8], ts: 5, rs: 8, m: 'plastic' });
      g.torus(0, cy, 0, R + r + 0.01, 0.008, '#e8e2d0', { ts: 24, rs: 3, m: 'fabric' });
      for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; g.box(Math.sin(a) * (R + r * 0.5), cy + Math.cos(a) * (R + r * 0.5), 0.06, 0.05, 0.03, 0.02, '#e8e2d0', { rot: [0, 0, -a] }); }
    },
  },
  camera: {
    variant: (it, room) => ((Math.abs(Math.round(it.x * 5 + it.z * 3)) % 3 === 0 || (room && (room.exterior || room.type === 'crew_corridor' || room.type === 'engine'))) ? 'bullet' : 'dome'),
    build(g, W, D, H, v) {
      // origin = mount point at the ceiling; geometry hangs below (y ≤ 0) — positioned by the renderer
      if (v === 'dome') {
        g.cyl(0, -0.015, 0, 0.09, 0.03, '#efefec', { seg: 16, m: 'plastic' });
        g.sph(0, -0.03, 0, 0.075, '#1a1c20', { seg: 14, thetaLen: PI / 2, rot: [PI, 0, 0], m: 'gloss' });
        g.torus(0, -0.03, 0, 0.078, 0.008, '#efefec', { rot: [PI / 2, 0, 0], ts: 16, rs: 4, m: 'plastic' });
        g.sph(0.0, -0.06, 0.05, 0.006, '#ff2010', { seg: 4, emi: 3.2 });
      } else {
        g.box(0, -0.06, -0.06, 0.04, 0.12, 0.04, '#d8d8d4', { m: 'plastic' });
        g.box(0, -0.12, -0.03, 0.05, 0.03, 0.08, '#d8d8d4', {});
        g.box(0, -0.15, 0.04, 0.09, 0.08, 0.18, '#ececea', { r: 0.02, steps: 1, m: 'plastic', rot: [0.35, 0, 0] });
        g.box(0, -0.11, 0.06, 0.11, 0.012, 0.22, '#ececea', { rot: [0.35, 0, 0] });   // sun hood
        g.cyl(0, -0.18, 0.13, 0.03, 0.01, '#101214', { rot: [PI / 2 + 0.35, 0, 0], seg: 10, m: 'gloss' });
        g.sph(0.035, -0.17, 0.125, 0.006, '#ff2010', { seg: 4, emi: 3.2 });
      }
    },
  },
  screen: {
    build(g, W, D, H) {
      // big LED wall: frame + emissive panel (animated content program 2.x), on low feet
      const PW = W - 1.0;
      g.box(0, H / 2 + 0.25, -0.02, PW + 0.16, H + 0.16, D * 0.6, '#151517', { m: 'paint' });
      g.box(0, H / 2 + 0.25, D * 0.3 + 0.0, PW, H - 0.04, 0.01, '#ffffff', { emi: SCR.show });
      for (const x of [-PW / 2 + 0.3, PW / 2 - 0.3]) g.box(x, 0.13, -0.02, 0.3, 0.26, D, '#2a2a2c', {});
      // speaker columns
      for (const s of [-1, 1]) { g.box(s * (W / 2 - 0.2), H / 2 + 0.3, 0, 0.35, H * 0.8, D * 0.8, '#18181a', { r: 0.02, steps: 1 }); for (let k = 0; k < 4; k++) g.cyl(s * (W / 2 - 0.2), 0.6 + k * H * 0.2, D * 0.41, 0.11, 0.01, '#2a2a2e', { rot: [PI / 2, 0, 0], seg: 12 }); }
    },
  },
  slide: {
    build(g, W, D, H) {
      g.aoH = 0.0;
      // waterslide tower: 4 steel columns, stair landings, platform, helical tube slide, splash run-out
      const R = W / 2;
      for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) g.cyl(x, H / 2, z, 0.12, H, '#e8e4dc', { seg: 10, m: 'paint' });
      g.box(0, H - 0.6, 0, 2.8, 0.15, 2.8, '#2f8fbf', { m: 'paint' });
      g.box(0, H + 0.4, 0, 3.0, 0.08, 3.0, '#f2c230', { m: 'paint' });   // canopy
      for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) g.cyl(x, H - 0.1, z, 0.03, 1.0, '#e8e4dc', { seg: 6 });
      // spiral stair around the core
      for (let k = 0; k < 28; k++) { const a = k * 0.42, y = 0.2 + k * (H - 0.9) / 28; g.box(Math.cos(a) * 0.7, y, Math.sin(a) * 0.7, 0.9, 0.05, 0.3, '#c8ccc6', { rot: [0, -a, 0], m: 'steel' }); }
      // helical open slide channel (lathe-like tube sweep)
      const turns = 2.6, n = 90;
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p = (t) => { const a = t * turns * TAU; const rr = R - 0.65; return [Math.cos(a) * rr, H - 0.7 - t * (H - 1.0), Math.sin(a) * rr]; };
        g.pipe(p(t0), p(t1), 0.42, k % 6 < 3 ? '#e8402a' : '#f2a03a', { seg: 10, open: true, m: 'gloss' });
      }
      for (let k = 0; k < n; k += 10) {
        const a = (k / n) * turns * TAU, rr = R - 0.65, y = H - 0.7 - (k / n) * (H - 1.0);
        g.pipe([Math.cos(a) * rr, y - 0.4, Math.sin(a) * rr], [Math.cos(a) * rr * 0.4, y - 0.4, Math.sin(a) * rr * 0.4], 0.05, '#e8e4dc', { seg: 5 });
      }
      g.box(R - 0.8, 0.15, 0.0, 1.2, 0.3, 2.2, '#3aa6c8', { m: 'gloss' });   // splash basin
    },
  },
  sports_net: {
    build(g, W, D, H) {
      // basketball / volley net divider: posts + translucent net + hoops at the ends
      for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) g.cyl(0, H / 2, z, 0.06, H, '#2a2b2e', { seg: 8, m: 'paint' });
      g.box(0, H - 0.6, 0, 0.02, 1.0, D - 0.2, '#e8e8e4', { glass: true });
      g.pipe([0, H - 0.1, -D / 2 + 0.1], [0, H - 0.1, D / 2 - 0.1], 0.01, '#f2f2ee', {});
      g.pipe([0, H - 1.1, -D / 2 + 0.1], [0, H - 1.1, D / 2 - 0.1], 0.006, '#f2f2ee', {});
      for (let z = -D / 2 + 0.6; z < D / 2 - 0.4; z += 0.5) g.box(0, H - 0.6, z, 0.004, 1.0, 0.004, '#d8d8d4', {});
    },
  },
  // ═══════════════════════════════════════════════════════════════════════
  //  ENVIRONMENT-ART PASS: crew / technical dressing (all instanced, lean)
  // ═══════════════════════════════════════════════════════════════════════
  // Ceiling cable ladder tray: origin at the tray underside, hanger rods rise to H (the deckhead).
  cable_tray: {
    variant: (it) => it.v || 'std',
    build(g, W, D, H, v) {
      const y = 0.03, col = '#9aa1a6';
      for (const s of [-1, 1]) g.box(0, y + 0.03, s * (D / 2 - 0.01), W, 0.07, 0.015, col, { m: 'steel' });
      for (let x = -W / 2 + 0.15; x < W / 2; x += 0.3) g.box(x, y, 0, 0.03, 0.012, D - 0.02, col, { m: 'steel' });
      // cable bundle (black/grey/orange/green looms)
      const cab = ['#1d1d1f', '#3a3c40', '#2a2b2e', v === 'hv' ? '#e8641e' : '#2f6a4a', '#1d1d1f'];
      for (let k = 0; k < cab.length; k++) g.cyl(0, y + 0.035 + (k % 2) * 0.03, -D / 2 + 0.07 + k * (D - 0.14) / (cab.length - 1), 0.025 + (k % 3) * 0.005, W - 0.02, cab[k], { rot: [0, 0, PI / 2], seg: 5, m: 'rubber' });
      // hangers + cross channels every 1.5 m
      for (let x = -W / 2 + 0.75; x < W / 2; x += 1.5) {
        g.box(x, y - 0.03, 0, 0.04, 0.04, D + 0.1, '#7d848a', { m: 'steel' });
        for (const s of [-1, 1]) g.box(x, (y + H) / 2, s * (D / 2 + 0.03), 0.012, H - y, 0.012, '#7d848a', { m: 'steel' });
      }
    },
  },
  // Ceiling pipe bundle: colour-coded service pipes on hangers, flanges & band labels.
  pipe_run: {
    variant: (it) => it.v || 'mix',
    build(g, W, D, H, v) {
      const sets = v === 'water' ? [[C.pipeG, 0.06], [C.pipeG, 0.045], [C.pipeB, 0.05], [C.steelL, 0.035]]
        : v === 'fire' ? [[C.pipeR, 0.07], [C.pipeR, 0.05], [C.steelL, 0.04]]
        : [[C.pipeG, 0.065], [C.pipeR, 0.05], [C.pipeB, 0.045], [C.pipeY, 0.035], ['#d8d8d4', 0.08]];
      let z = -D / 2 + 0.03;
      const yc = 0.12;
      for (const [col, r] of sets) {
        z += r;
        if (z > D / 2 - r) break;
        const lag = col === '#d8d8d4';
        g.cyl(0, yc, z, r, W, col, { rot: [0, 0, PI / 2], seg: lag ? 8 : 6, m: lag ? 'matte' : 'paint' });
        for (let x = -W / 2 + 1.0; x < W / 2; x += 2.0) g.cyl(x, yc, z, r + 0.012, 0.04, lag ? '#b8b8b4' : C.steelD, { rot: [0, 0, PI / 2], seg: 6, m: 'steel' });   // flange / band
        // white flow-direction band with arrow block
        if (!lag) g.box(-W / 4, yc, z, 0.12, r * 2.05, r * 2.05, C.white, {});
        z += r + 0.025;
      }
      for (let x = -W / 2 + 0.5; x < W / 2; x += 2.0) {
        g.box(x, yc - 0.09, 0, 0.05, 0.03, D, C.steelD, { m: 'steel' });
        for (const s of [-1, 1]) g.box(x, (yc + H) / 2, s * (D / 2 - 0.01), 0.014, H - yc + 0.1, 0.014, C.steelD, { m: 'steel' });
      }
    },
  },
  // Galvanised rectangular duct with joint flanges, grille and hangers.
  duct: {
    build(g, W, D, H) {
      const h = H - 0.06, yc = h / 2;
      g.box(0, yc, 0, W, h, D - 0.02, '#b9bec2', { m: 'brushed' });
      for (let x = -W / 2 + 0.6; x < W / 2; x += 1.2) g.box(x, yc, 0, 0.05, h + 0.03, D + 0.01, '#9aa1a6', { m: 'steel' });
      g.box(W / 4, 0.0, 0, 0.6, 0.012, D * 0.6, '#d8dcd6', { m: 'paint' });
      for (let k = 0; k < 6; k++) g.box(W / 4, -0.008, -D * 0.25 + k * D * 0.1, 0.56, 0.006, 0.02, '#4a4c50', {});
      for (let x = -W / 2 + 1.2; x < W / 2; x += 2.4) for (const s of [-1, 1]) g.box(x, (h + H) / 2 + 0.01, s * (D / 2 + 0.02), 0.012, H - h + 0.02, 0.012, C.steelD, {});
    },
  },
  // Stainless extraction canopy over a cooking line (hangs; origin = underside).
  galley_hood: {
    build(g, W, D, H) {
      g.bx(-W / 2, 0.0, -D / 2, W / 2, H * 0.55, D / 2, '#b8bec2', { m: 'brushed' });
      g.bx(-W / 2 + 0.06, -0.005, -D / 2 + 0.06, W / 2 - 0.06, 0.0, D / 2 - 0.06, '#2a2c2e', { m: 'steel' });
      // baffle filters (angled)
      for (let x = -W / 2 + 0.3; x < W / 2 - 0.2; x += 0.5) g.box(x, 0.12, -D / 2 + 0.3, 0.46, 0.3, 0.02, '#8a9096', { rot: [0.6, 0, 0], m: 'brushed' });
      // lamp strip
      for (let x = -W / 2 + 0.45; x < W / 2 - 0.3; x += 0.9) g.box(x, -0.006, D / 4, 0.4, 0.008, 0.1, '#fff2d8', { emi: 1.6 });
      g.box(0, H * 0.55 + (H * 0.45) / 2, -D / 4, W * 0.35, H * 0.45, D * 0.35, '#a9afb4', { m: 'brushed' });   // plenum to duct
      g.box(0, H * 0.55 - 0.02, D / 2 + 0.005, W, 0.04, 0.01, '#d8dcde', { m: 'chrome' });
    },
  },
  // Painted deck markings (decals): yellow safety lines, coloured route lines.
  floor_stripe: {
    variant: (it) => it.col || 'yellow',
    build(g, W, D, H, v) {
      const col = { yellow: '#d9ae2a', green: '#4a6e52', blue: '#2f5a8a', red: '#a8352b', white: '#d8d8d4', hatch: '#d9ae2a' }[v] || '#d9ae2a';
      if (v === 'hatch') {
        g.box(0, 0.003, 0, W, 0.006, D, '#1d1d1f', { m: 'paint' });
        for (let x = -W / 2 + 0.15; x < W / 2; x += 0.3) g.box(x, 0.007, 0, 0.12, 0.006, D, col, { m: 'paint', rot: [0, 0.6, 0] });
        return;
      }
      g.box(0, 0.003, 0, W, 0.006, D, col, { m: 'paint' });
    },
  },
  floor_mark: {
    variant: (it) => it.mark || 'arrow',
    build(g, W, D, H, v) {
      const col = v === 'exit' ? '#2f9a4a' : v === 'fwd' ? '#2f6aa8' : '#e8b81e';
      if (v === 'stop') { g.box(0, 0.003, 0, W, 0.006, 0.12, '#e8e8e4', { m: 'paint' }); return; }
      // chevron arrow pointing to local +Z
      g.box(0, 0.003, -D * 0.15, W * 0.28, 0.006, D * 0.6, col, { m: 'paint' });
      for (const s of [-1, 1]) g.box(s * W * 0.2, 0.004, D * 0.22, W * 0.2, 0.006, D * 0.42, col, { m: 'paint', rot: [0, -s * 0.75, 0] });
    },
  },
  aisle_light: {
    build(g, W, D, H) {
      g.box(0, H / 2, 0, W, H, D, '#2a2622', { m: 'paint' });
      g.box(0, H * 0.45, D / 2 + 0.001, W * 0.7, H * 0.3, 0.004, '#ffcf8a', { emi: 1.9 });
    },
  },
  // Cork notice board with pinned notices; local +Z faces the room.
  notice_board: {
    build(g, W, D, H, v, rnd) {
      g.box(0, H / 2, 0, W, H, D * 0.6, '#c3c7cb', { m: 'brushed' });
      g.box(0, H / 2, D * 0.3, W - 0.06, H - 0.06, 0.006, '#a8794a', { m: 'matte' });
      const pap = ['#f4f3ef', '#f4f3ef', '#f2e27a', '#9fd0f0', '#f6b8b0', '#f4f3ef'];
      for (let k = 0; k < 9; k++) {
        const pw = 0.16 + rnd() * 0.08, ph = 0.2 + rnd() * 0.08;
        const x = -W / 2 + 0.14 + (k % 5) * (W - 0.28) / 4 + (rnd() - 0.5) * 0.04, y = H * (k < 5 ? 0.66 : 0.3) + (rnd() - 0.5) * 0.06;
        g.box(x, y, D * 0.3 + 0.004, pw, ph, 0.003, pap[k % pap.length], { rot: [0, 0, (rnd() - 0.5) * 0.12] });
        g.box(x, y + ph * 0.25, D * 0.3 + 0.006, pw * 0.7, 0.012, 0.002, '#3a3c40', {});
        g.box(x, y + ph * 0.42, D * 0.3 + 0.008, 0.015, 0.015, 0.006, ['#c0281e', '#2f6aa8', '#2f9a4a'][k % 3], {});
      }
    },
  },
  // Framed safety poster: life-jacket / fire / muster / hygiene pictogram blocks.
  poster: {
    variant: (it) => it.kind || ['life', 'fire', 'muster', 'hands', 'ppe'][Math.abs(Math.round(it.x * 7 + it.z * 3)) % 5],
    build(g, W, D, H, v) {
      const theme = { life: '#ea6a1f', fire: '#c0281e', muster: '#2f9a4a', hands: '#2f6aa8', ppe: '#2f6aa8' }[v];
      g.box(0, H / 2, 0, W, H, D, '#d4d9de', { m: 'brushed' });
      g.box(0, H / 2, D / 2 + 0.001, W - 0.04, H - 0.04, 0.002, '#f6f5f1', {});
      g.box(0, H - 0.1, D / 2 + 0.003, W - 0.06, 0.12, 0.002, theme, {});
      g.box(0, H - 0.1, D / 2 + 0.005, W * 0.6, 0.03, 0.002, '#ffffff', {});
      // pictogram
      if (v === 'life') { g.box(0, H * 0.5, D / 2 + 0.004, W * 0.42, H * 0.34, 0.002, '#ea6a1f', {}); g.box(0, H * 0.5, D / 2 + 0.006, W * 0.08, H * 0.34, 0.002, '#202024', {}); }
      else if (v === 'fire') { g.box(0, H * 0.48, D / 2 + 0.004, W * 0.2, H * 0.36, 0.002, '#c0281e', {}); g.box(W * 0.12, H * 0.62, D / 2 + 0.004, W * 0.16, 0.03, 0.002, '#202024', {}); }
      else if (v === 'muster') { g.box(0, H * 0.5, D / 2 + 0.004, W * 0.5, H * 0.3, 0.002, '#2f9a4a', {}); g.box(-W * 0.06, H * 0.5, D / 2 + 0.006, W * 0.14, H * 0.18, 0.002, '#ffffff', {}); g.box(W * 0.1, H * 0.5, D / 2 + 0.006, W * 0.12, 0.03, 0.002, '#ffffff', {}); }
      else { g.cyl(0, H * 0.5, D / 2 + 0.003, W * 0.24, 0.004, theme, { rot: [PI / 2, 0, 0], seg: 16 }); g.box(0, H * 0.5, D / 2 + 0.007, W * 0.18, H * 0.12, 0.002, '#ffffff', {}); }
      for (let k = 0; k < 4; k++) g.box(0, H * 0.22 - k * 0.035, D / 2 + 0.004, W * (0.7 - k * 0.08), 0.012, 0.002, '#5a5d60', {});
    },
  },
  // Wall-bracketed extinguisher with ID sign above.
  fire_ext: {
    build(g, W, D, H) {
      g.box(0, 0.32, -D / 2 + 0.01, 0.12, 0.08, 0.02, C.steelD, {});
      g.cyl(0, 0.3, 0.0, 0.08, 0.55, C.red, { seg: 10, m: 'gloss' });
      g.sph(0, 0.575, 0.0, 0.08, C.red, { seg: 10, s: [1, 0.5, 1], m: 'gloss' });
      g.box(0, 0.64, 0, 0.04, 0.06, 0.04, '#202024', {});
      g.box(0.05, 0.66, 0.02, 0.1, 0.018, 0.03, '#202024', {});
      g.pipe([0.03, 0.64, 0.02], [0.09, 0.3, 0.08], 0.012, '#202024', { seg: 4 });
      g.box(0, 0.3, 0.081, 0.1, 0.14, 0.002, C.white, {});
      g.box(0, H - 0.12, -D / 2 + 0.006, 0.22, 0.22, 0.006, C.red, {});
      g.box(0, H - 0.12, -D / 2 + 0.01, 0.12, 0.05, 0.002, C.white, {});
    },
  },
  gauge_panel: {
    build(g, W, D, H, v, rnd) {
      g.box(0, H / 2, 0, W, H, D * 0.7, '#d8dcd6', { m: 'paint', r: 0.01, steps: 1 });
      for (let k = 0; k < 6; k++) {
        const x = -W / 2 + 0.2 + (k % 3) * (W - 0.4) / 2, y = H * (k < 3 ? 0.72 : 0.42);
        g.cyl(x, y, D * 0.35, 0.075, 0.03, C.steelL, { rot: [PI / 2, 0, 0], seg: 12, m: 'chrome' });
        g.cyl(x, y, D * 0.35 + 0.016, 0.062, 0.004, C.white, { rot: [PI / 2, 0, 0], seg: 12 });
        g.box(x, y + 0.02, D * 0.35 + 0.02, 0.006, 0.05, 0.002, C.red, { rot: [0, 0, (rnd() - 0.5) * 2] });
      }
      for (let k = 0; k < 4; k++) LED(g, -W / 2 + 0.2 + k * 0.12, H * 0.15, D * 0.35 + 0.005, ['#3aff6a', '#3aff6a', '#ffb02a', '#ff3a2a'][k], 0.03);
      g.pipe([-W / 2 + 0.2, 0, D * 0.2], [-W / 2 + 0.2, -0.5, D * 0.2], 0.015, C.steelD, { seg: 5 });
      g.pipe([W / 2 - 0.2, 0, D * 0.2], [W / 2 - 0.2, -0.5, D * 0.2], 0.015, C.steelD, { seg: 5 });
    },
  },
  house_phone: {
    build(g, W, D, H) {
      g.box(0, H / 2, 0, W, H, D * 0.5, '#e8e2d4', { m: 'plastic', r: 0.015, steps: 1 });
      g.box(-0.05, H / 2, D * 0.32, 0.06, H * 0.8, 0.05, '#e8e2d4', { m: 'plastic', r: 0.015, steps: 1 });
      for (let k = 0; k < 9; k++) g.box(0.03 + (k % 3) * 0.03, H * 0.62 - Math.floor(k / 3) * 0.04, D * 0.26, 0.02, 0.02, 0.006, '#5a5d60', {});
      g.box(0.06, H * 0.82, D * 0.26, 0.08, 0.025, 0.004, '#2f6aa8', {});
    },
  },
  dartboard: {
    build(g, W, D, H) {
      g.box(0, H / 2, -D / 4, W, H, D / 2, '#2a1f18', { m: 'wood' });
      const R = W * 0.36;
      g.cyl(0, H / 2, 0.012, R, 0.03, '#1d1d1f', { rot: [PI / 2, 0, 0], seg: 20, m: 'fabric' });
      for (let k = 0; k < 10; k++) g.box(0, H / 2, 0.028, 0.03, R * 1.9, 0.002, k % 2 ? '#d8cca8' : '#1d1d1f', { rot: [0, 0, k * PI / 10] });
      g.torus(0, H / 2, 0.03, R * 0.62, 0.012, '#b3241f', { ts: 20, rs: 3 });
      g.torus(0, H / 2, 0.03, R * 0.95, 0.012, '#2f7a3a', { ts: 20, rs: 3 });
      g.cyl(0, H / 2, 0.03, 0.025, 0.006, '#b3241f', { rot: [PI / 2, 0, 0], seg: 8 });
    },
  },
  neon_sign: {
    variant: (it) => it.neon || 'beer',
    build(g, W, D, H, v) {
      g.box(0, H / 2, -D / 2 + 0.01, W, H, 0.012, '#151517', { m: 'gloss' });
      const c1 = v === 'beer' ? '#ffb02a' : '#ff3a8a', c2 = v === 'beer' ? '#3ad8ff' : '#3aff9a';
      const z = 0.0;
      // glass outline (mug) + script squiggle + border
      g.tube([[-W * 0.38, H * 0.2, z], [-W * 0.38, H * 0.8, z], [-W * 0.18, H * 0.8, z], [-W * 0.18, H * 0.2, z], [-W * 0.38, H * 0.2, z]], 0.012, c1, { emi: 1.9, seg: 4, joints: false });
      g.tube([[-W * 0.18, H * 0.65, z], [-W * 0.1, H * 0.65, z], [-W * 0.1, H * 0.35, z], [-W * 0.18, H * 0.35, z]], 0.012, c1, { emi: 1.9, seg: 4, joints: false });
      const pts = []; for (let k = 0; k <= 14; k++) { const t = k / 14; pts.push([-W * 0.02 + t * W * 0.4, H * 0.5 + Math.sin(t * 12) * H * 0.15, z]); }
      g.tube(pts, 0.012, c2, { emi: 1.9, seg: 4, joints: false });
      for (let k = 0; k < 4; k++) g.box(-W / 2 + 0.1 + k * (W - 0.2) / 3, H - 0.04, -D / 2 + 0.03, 0.02, 0.02, 0.04, '#5a5d60', {});
    },
  },
  // ── floor-standing crew & industrial ──────────────────────────────────
  locker_bank: {
    tints: 'locker',
    build(g, W, D, H) {
      g.aoH = 0.1;
      g.box(0, 0.05, 0, W - 0.02, 0.1, D - 0.04, C.greyD, {});
      g.bx(-W / 2, 0.1, -D / 2, W / 2, H, D / 2 - 0.02, '#c9cfd3', { m: 'paint' });
      const n = Math.max(2, Math.round(W / 0.45)), cw = W / n;
      for (let k = 0; k < n; k++) {
        const x = -W / 2 + (k + 0.5) * cw;
        for (const [y0, y1] of [[0.12, H * 0.5 - 0.01], [H * 0.5 + 0.01, H - 0.04]]) {
          g.box(x, (y0 + y1) / 2, D / 2 - 0.01, cw - 0.025, y1 - y0, 0.02, '#ffffff', { tint: true, m: 'paint' });
          for (let q = 0; q < 3; q++) g.box(x, y1 - 0.1 - q * 0.035, D / 2 + 0.002, cw - 0.12, 0.01, 0.004, C.greyD, {});
          g.box(x + cw / 2 - 0.07, (y0 + y1) / 2, D / 2 + 0.01, 0.025, 0.08, 0.02, C.chrome, { m: 'chrome' });
          g.box(x - 0.05, y1 - 0.24, D / 2 + 0.002, 0.08, 0.04, 0.003, C.white, {});
        }
      }
      g.box(0, H + 0.12, 0.0, W * 0.5, 0.24, D * 0.6, '#3a5a7a', { m: 'fabric', r: 0.04, steps: 1 });   // kit bag on top
    },
  },
  pallet_jack: {
    build(g, W, D, H) {
      g.aoH = 0.05;
      for (const s of [-1, 1]) {
        g.box(s * 0.19, 0.06, 0.15, 0.16, 0.06, D - 0.35, C.red, { m: 'paint' });
        g.cyl(s * 0.19, 0.04, D / 2 - 0.06, 0.04, 0.08, '#2a2a2c', { rot: [0, 0, PI / 2], seg: 8 });
      }
      g.box(0, 0.18, -D / 2 + 0.17, 0.55, 0.3, 0.2, C.red, { m: 'paint' });
      g.cyl(0, 0.08, -D / 2 + 0.17, 0.08, 0.14, '#2a2a2c', { rot: [0, 0, PI / 2], seg: 10, m: 'rubber' });
      g.cyl(0, 0.45, -D / 2 + 0.17, 0.035, 0.4, C.chrome, { seg: 8, m: 'chrome' });
      g.pipe([0, 0.5, -D / 2 + 0.17], [0, H - 0.08, -D / 2 - 0.0], 0.02, '#2a2a2c', { seg: 6 });
      g.torus(0, H - 0.05, -D / 2 + 0.0, 0.1, 0.018, '#2a2a2c', { ts: 10, rs: 4, rot: [0, PI / 2, 0], s: [1, 0.55, 1] });
      // a loaded pallet on the forks
      g.box(0, 0.2, 0.2, 0.75, 0.12, 1.05, '#c8a46a', { m: 'wood' });
      for (let k = 0; k < 4; k++) g.box(-0.18 + (k % 2) * 0.36, 0.43 + Math.floor(k / 2) * 0.33, 0.2, 0.34, 0.32, 1.0, k % 2 ? '#b8915e' : '#a7804f', { m: 'matte' });
    },
  },
  roll_cage: {
    variant: (it, room) => it.load || (room && (room.type === 'laundry' || /Linen|Housekeeping/.test(room.name || '')) ? 'linen' : 'boxes'),
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.06;
      g.box(0, 0.14, 0, W, 0.04, D, '#8a9096', { m: 'steel' });
      for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) for (const z of [-D / 2 + 0.08, D / 2 - 0.08]) g.cyl(x, 0.05, z, 0.05, 0.06, '#2a2a2c', { rot: [0, 0, PI / 2], seg: 6 });
      for (const sx of [-1, 1]) {
        for (let k = 0; k <= 4; k++) g.box(sx * (W / 2 - 0.01), 0.16 + (H - 0.16) / 2, -D / 2 + k * D / 4, 0.012, H - 0.16, 0.012, '#9aa1a6', { m: 'steel' });
        for (let k = 1; k <= 5; k++) g.box(sx * (W / 2 - 0.01), 0.16 + k * (H - 0.16) / 5, 0, 0.012, 0.012, D, '#9aa1a6', { m: 'steel' });
      }
      for (let k = 0; k <= 4; k++) g.box(-W / 2 + k * W / 4, 0.16 + (H - 0.16) / 2, -D / 2 + 0.01, 0.012, H - 0.16, 0.012, '#9aa1a6', { m: 'steel' });
      if (v === 'linen') {
        for (let k = 0; k < 5; k++) g.box((rnd() - 0.5) * 0.06, 0.25 + k * 0.22, 0, W - 0.1, 0.2, D - 0.1, ['#f4f3ef', '#e8eef2', '#f4f3ef', '#dfe6ea', '#f6f2ea'][k], { m: 'linen', r: 0.05, steps: 1 });
      } else {
        for (let l = 0; l < 3; l++) for (let a = 0; a < 2; a++) if (rnd() < 0.85) g.box(-W / 4 + a * W / 2, 0.36 + l * 0.42, 0, W / 2 - 0.04, 0.38, D - 0.08, l % 2 ? '#b8915e' : '#a7804f', { m: 'matte' });
      }
    },
  },
  forklift: {
    build(g, W, D, H) {
      g.aoH = 0.0;
      const yel = '#e8b81e', z0 = -D / 2;
      // chassis & counterweight (rear = -Z), forks at +Z
      g.box(0, 0.42, z0 + 0.95, W - 0.08, 0.5, 1.5, yel, { m: 'paint', r: 0.06, steps: 1 });
      g.box(0, 0.55, z0 + 0.22, W - 0.04, 0.75, 0.45, '#2a2a2c', { m: 'iron', r: 0.08, steps: 1 });
      for (const s of [-1, 1]) for (const z of [z0 + 0.4, z0 + 1.45]) g.cyl(s * (W / 2 - 0.12), 0.25, z, 0.25, 0.22, '#1d1d1f', { rot: [0, 0, PI / 2], seg: 12, m: 'rubber' });
      // seat, steering
      g.box(0, 0.82, z0 + 0.75, 0.48, 0.12, 0.45, '#1d1d1f', { m: 'leather', r: 0.04, steps: 1 });
      g.box(0, 1.08, z0 + 0.55, 0.48, 0.45, 0.1, '#1d1d1f', { m: 'leather', r: 0.04, steps: 1, rot: [-0.15, 0, 0] });
      g.pipe([0, 0.75, z0 + 1.35], [0, 1.1, z0 + 1.15], 0.03, '#2a2a2c', { seg: 6 });
      g.torus(0, 1.12, z0 + 1.12, 0.16, 0.02, '#1d1d1f', { rot: [PI / 2 - 0.5, 0, 0], ts: 12, rs: 4 });
      // overhead guard
      for (const s of [-1, 1]) {
        g.pipe([s * (W / 2 - 0.08), 0.65, z0 + 0.35], [s * (W / 2 - 0.08), H - 0.05, z0 + 0.45], 0.03, '#2a2a2c', { seg: 6 });
        g.pipe([s * (W / 2 - 0.08), 0.65, z0 + 1.6], [s * (W / 2 - 0.08), H - 0.05, z0 + 1.45], 0.03, '#2a2a2c', { seg: 6 });
      }
      g.box(0, H - 0.04, z0 + 0.95, W - 0.1, 0.05, 1.15, '#2a2a2c', { m: 'iron' });
      for (let k = 0; k < 4; k++) g.box(0, H - 0.07, z0 + 0.5 + k * 0.3, W - 0.16, 0.02, 0.05, '#3a3c40', {});
      g.box(0, H, z0 + 0.95, 0.12, 0.05, 0.12, '#ff8a1a', { emi: 1.5 });   // beacon
      // mast + forks
      for (const s of [-1, 1]) g.box(s * 0.3, 1.1, z0 + 1.82, 0.09, 2.0, 0.12, '#2a2a2c', { m: 'iron' });
      g.box(0, 0.45, z0 + 1.92, 0.82, 0.5, 0.05, '#2a2a2c', { m: 'iron' });
      for (const s of [-1, 1]) { g.box(s * 0.25, 0.06, z0 + 2.3, 0.1, 0.04, 0.8, '#3a3c40', { m: 'iron' }); g.box(s * 0.25, 0.3, z0 + 1.95, 0.1, 0.5, 0.04, '#3a3c40', {}); }
      g.box(0, 0.6, z0 + 1.0, W - 0.07, 0.06, 0.5, '#202024', {});
      g.box(-W / 2 + 0.05, 0.55, z0 + 0.95, 0.002, 0.12, 0.6, '#1d1d1f', {});
    },
  },
  // Industrial pallet racking (blue uprights, orange beams), three levels of stock.
  racking: {
    variant(it, room) {
      if (it.stock) return it.stock;
      const n = room ? room.name || '' : '';
      if (/Cold/.test(n)) return 'cold';
      if (/Beverage|Bonded|Bar Store/.test(n)) return 'bev';
      if (/Spare|Workshop|Electrical|Rope|Forward|Ballast/.test(n)) return /Rope|Paint/.test(n) ? 'paint' : 'parts';
      if (/Linen|Housekeeping|Uniform/.test(n)) return 'linen';
      return 'dry';
    },
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.1;
      const bays = Math.max(1, Math.round(W / 2.7)), bw = W / bays;
      const lv = [0.08, H * 0.38, H * 0.72];
      for (let b = 0; b <= bays; b++) {
        const x = -W / 2 + b * bw;
        for (const z of [-D / 2 + 0.04, D / 2 - 0.04]) g.box(x, H / 2, z, 0.07, H, 0.07, '#2f5a8a', { m: 'paint' });
        for (let k = 0; k < 4; k++) g.box(x, 0.3 + k * 0.6, 0, 0.03, 0.03, D - 0.08, '#2f5a8a', { m: 'paint', rot: [k % 2 ? 0.5 : -0.5, 0, 0] });
      }
      for (const y of lv) for (const z of [-D / 2 + 0.04, D / 2 - 0.04]) g.box(0, y + 0.05, z, W, 0.1, 0.05, '#e8641e', { m: 'paint' });
      for (let b = 0; b < bays; b++) for (let l = 0; l < 3; l++) {
        const cx = -W / 2 + (b + 0.5) * bw, y = lv[l] + 0.1;
        if (rnd() < 0.12) continue;
        if (v === 'cold') {
          for (let q = 0; q < 6; q++) g.box(cx - bw / 2 + 0.25 + (q % 3) * (bw - 0.5) / 2, y + 0.13 + Math.floor(q / 3) * 0.27, 0, 0.5, 0.25, D - 0.2, q % 2 ? '#e8eef2' : '#d8e2e8', { m: 'plastic' });
        } else if (v === 'bev') {
          for (let q = 0; q < 3; q++) g.cyl(cx - bw / 2 + 0.45 + q * (bw - 0.9) / 2, y + 0.3, 0, 0.24, 0.6, q % 2 ? '#c3c7cb' : '#a2a8ad', { seg: 10, m: 'steel' });
        } else if (v === 'paint') {
          for (let q = 0; q < 8; q++) g.cyl(cx - bw / 2 + 0.2 + (q % 4) * (bw - 0.4) / 3, y + 0.14, -D / 4 + Math.floor(q / 4) * D / 2, 0.13, 0.28, ['#c0281e', '#f1efea', '#2f6aa8', '#3b7a4a'][q % 4], { seg: 8, m: 'paint' });
          if (l === 0) g.torus(cx, y + 0.12, 0, 0.32, 0.1, '#c8b07a', { rot: [PI / 2, 0, 0], ts: 12, rs: 5, m: 'fabric' });
        } else if (v === 'parts') {
          for (let q = 0; q < 6; q++) g.box(cx - bw / 2 + 0.25 + q * (bw - 0.5) / 5, y + 0.12, 0, 0.36, 0.22, D - 0.15, ['#2f6aa8', '#e8b81e', '#c0281e', '#5c6268'][q % 4], { m: 'plastic' });
        } else if (v === 'linen') {
          for (let q = 0; q < 4; q++) g.box(cx - bw / 2 + 0.35 + q * (bw - 0.7) / 3, y + 0.2, 0, 0.55, 0.36, D - 0.2, ['#f4f3ef', '#e8eef2', '#f6f2ea', '#c8d8e8'][q], { m: 'linen', r: 0.04, steps: 1 });
        } else {
          // dry goods: pallet of cartons (+ shrink-wrap look on top level)
          g.box(cx, y + 0.07, 0, bw - 0.3, 0.12, D - 0.1, '#c8a46a', { m: 'wood' });
          const hh = l === 2 ? 0.5 : H * 0.3 - 0.25;
          for (let q = 0; q < 2; q++) g.box(cx - (bw - 0.3) / 4 + q * (bw - 0.3) / 2, y + 0.14 + hh / 2, 0, (bw - 0.3) / 2 - 0.03, hh, D - 0.14, q % 2 ? '#b8915e' : '#a7804f', { m: 'matte' });
        }
      }
      g.box(-W / 2 + 0.2, H * 0.38 - 0.05, D / 2 - 0.01, 0.2, 0.08, 0.004, C.white, {});   // location label
    },
  },
  // Raised maintenance platform: grating deck, toe board, yellow handrails, ladder at -X end.
  catwalk: {
    build(g, W, D, H) {
      const dk = 1.3;
      g.box(0, dk - 0.03, 0, W, 0.05, D, '#6a6d70', { m: 'steel' });
      for (let x = -W / 2 + 0.1; x < W / 2; x += 0.1) g.box(x, dk + 0.002, 0, 0.012, 0.003, D - 0.04, '#4a4d50', {});
      for (const s of [-1, 1]) {
        g.box(0, dk + 0.06, s * (D / 2 - 0.01), W, 0.1, 0.012, C.yellow, { m: 'paint' });
        g.pipe([-W / 2 + 0.6, H - 0.1, s * (D / 2 - 0.02)], [W / 2, H - 0.1, s * (D / 2 - 0.02)], 0.025, C.yellow, { seg: 6, m: 'paint' });
        g.pipe([-W / 2 + 0.6, dk + 0.5, s * (D / 2 - 0.02)], [W / 2, dk + 0.5, s * (D / 2 - 0.02)], 0.02, C.yellow, { seg: 6, m: 'paint' });
        for (let x = -W / 2 + 0.6; x <= W / 2 + 0.01; x += 1.5) {
          g.box(Math.min(x, W / 2 - 0.03), (dk + H) / 2, s * (D / 2 - 0.02), 0.04, H - dk, 0.04, C.yellow, { m: 'paint' });
          g.box(Math.min(x, W / 2 - 0.03), dk / 2, s * (D / 2 - 0.05), 0.08, dk, 0.08, C.steelD, { m: 'iron' });
        }
      }
      // ladder at the -X end
      for (const s of [-1, 1]) g.pipe([-W / 2 + 0.05, 0, s * 0.22], [-W / 2 + 0.05, H - 0.1, s * 0.22], 0.025, C.yellow, { seg: 6 });
      for (let y = 0.25; y < dk + 0.1; y += 0.3) g.box(-W / 2 + 0.05, y, 0, 0.03, 0.03, 0.44, C.steelL, { m: 'steel' });
      g.box(W / 4, dk + 0.25, 0, 0.6, 0.4, 0.4, C.machine, { m: 'paint' });   // tool chest on deck
    },
  },
  pipe_riser: {
    build(g, W, D, H) {
      const cols = [C.pipeG, C.pipeR, C.pipeB, '#d8d8d4'];
      for (let k = 0; k < 4; k++) {
        const x = -W / 2 + 0.12 + k * (W - 0.24) / 3, r = k === 3 ? 0.11 : 0.06;
        g.cyl(x, H / 2, 0, r, H, cols[k], { seg: 8, m: k === 3 ? 'matte' : 'paint' });
        for (const y of [0.4, 1.4, 2.4]) g.cyl(x, y, 0, r + 0.015, 0.05, C.steelD, { seg: 8, m: 'steel' });
        if (k < 3) { g.cyl(x, 1.05, D / 2 - 0.12, 0.09, 0.025, C.red, { rot: [PI / 2, 0, 0], seg: 10 }); g.pipe([x, 1.05, 0], [x, 1.05, D / 2 - 0.12], 0.015, C.steelD, { seg: 4 }); }
      }
      g.box(0, 1.7, -D / 2 + 0.03, W, 0.06, 0.04, C.steelD, {});
      g.box(0, 0.6, -D / 2 + 0.03, W, 0.06, 0.04, C.steelD, {});
    },
  },
  exhaust_trunk: {
    build(g, W, D, H) {
      const R = Math.min(W, D) / 2 - 0.05;
      g.cyl(0, H / 2, 0, R, H, '#d8d8d4', { seg: 16, m: 'matte' });
      for (let y = 0.3; y < H; y += 0.45) g.cyl(0, y, 0, R + 0.012, 0.035, '#a8a8a4', { seg: 16, m: 'steel' });
      g.cyl(0, 0.9, 0, R + 0.06, 0.25, '#8a8580', { seg: 16, m: 'iron' });   // expansion bellows
      for (let k = 0; k < 4; k++) g.cyl(0, 0.82 + k * 0.05, 0, R + 0.08, 0.02, '#6a6560', { seg: 16, m: 'iron' });
      g.box(0, 1.6, R + 0.01, 0.3, 0.22, 0.02, C.yellow, {});
      g.box(0, 1.6, R + 0.022, 0.2, 0.05, 0.004, C.black, {});
    },
  },
  valve_manifold: {
    build(g, W, D, H) {
      g.aoH = 0.05;
      g.box(0, 0.1, 0, W, 0.2, D, C.steelD, { m: 'iron' });
      g.cyl(0, 0.75, -0.05, 0.12, W, C.pipeG, { rot: [0, 0, PI / 2], seg: 10, m: 'paint' });
      const n = Math.max(3, Math.round(W / 0.45));
      for (let k = 0; k < n; k++) {
        const x = -W / 2 + (k + 0.5) * W / n;
        g.pipe([x, 0.2, -0.05], [x, 0.63, -0.05], 0.045, C.pipeG, { seg: 6 });
        g.box(x, 0.98, -0.05, 0.16, 0.22, 0.14, '#3a3c40', { m: 'iron' });
        g.cyl(x, 1.12, -0.05, 0.025, 0.12, C.steel, { seg: 6 });
        g.torus(x, H - 0.08, -0.05, 0.12, 0.015, k % 3 === 0 ? C.red : C.yellow, { rot: [PI / 2, 0, 0], ts: 12, rs: 4, m: 'paint' });
        g.box(x, 0.98, 0.03, 0.08, 0.04, 0.004, C.white, {});
      }
      g.cyl(W / 2 - 0.2, 1.05, 0.15, 0.08, 0.03, C.white, { rot: [PI / 2, 0, 0], seg: 12 });
    },
  },
  control_panel: {
    build(g, W, D, H, v, rnd) {
      g.aoH = 0.08;
      g.box(0, 0.05, 0, W, 0.1, D, C.greyD, {});
      g.bx(-W / 2, 0.1, -D / 2, W / 2, H, D / 2 - 0.25, '#d0d4ce', { m: 'paint' });
      g.box(0, 0.95, D / 2 - 0.15, W, 0.06, 0.3, '#d0d4ce', { m: 'paint', rot: [0.35, 0, 0] });   // sloped desk
      g.bx(-W / 2, 0.1, D / 2 - 0.3, W / 2, 0.9, D / 2 - 0.02, '#c4c8c2', { m: 'paint' });
      // screens & mimic
      g.box(-W / 4, 1.45, D / 2 - 0.24, W / 2 - 0.15, 0.4, 0.02, '#151517', {});
      g.box(-W / 4, 1.45, D / 2 - 0.228, W / 2 - 0.2, 0.34, 0.004, '#ffffff', { emi: SCR.ui });
      g.box(W / 4, 1.45, D / 2 - 0.24, W / 2 - 0.15, 0.4, 0.02, '#151517', {});
      g.box(W / 4, 1.45, D / 2 - 0.228, W / 2 - 0.2, 0.34, 0.004, '#ffffff', { emi: SCR.uiLight });
      g.box(0, 1.78, D / 2 - 0.245, W - 0.1, 0.14, 0.004, '#2f6aa8', {});
      for (let k = 0; k < 10; k++) LED(g, -W / 2 + 0.12 + k * (W - 0.24) / 9, 0.99, D / 2 - 0.06, ['#3aff6a', '#ffb02a', '#ff3a2a', '#3aff6a'][Math.floor(rnd() * 4)], 0.03);
      for (let k = 0; k < 4; k++) g.cyl(-W / 2 + 0.25 + k * 0.35, 0.94, D / 2 - 0.2, 0.03, 0.03, C.black, { seg: 8 });
      g.cyl(W / 2 - 0.2, 0.96, D / 2 - 0.12, 0.04, 0.03, C.red, { seg: 10, emi: 0.6 });   // e-stop
    },
  },
  dryer: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      g.box(0, 0.06, 0, W - 0.04, 0.12, D - 0.04, C.steelD, {});
      g.box(0, (H + 0.12) / 2, -0.02, W, H - 0.12, D - 0.06, '#7d868d', { m: 'brushed', r: 0.02, steps: 1 });
      g.box(0, H - 0.06, -0.02, W + 0.01, 0.12, D - 0.05, '#c0602a', { m: 'paint' });
      g.box(0, 0.95, D / 2 - 0.035, W - 0.12, 1.1, 0.02, '#a9b0b5', { m: 'brushed' });
      g.cyl(0, 0.95, D / 2 - 0.03, 0.46, 0.05, C.steel, { rot: [PI / 2, 0, 0], seg: 24, m: 'steel' });
      g.cyl(0, 0.95, D / 2 - 0.01, 0.38, 0.02, '#2a3036', { rot: [PI / 2, 0, 0], seg: 24, glass: true });
      g.cyl(0, 0.95, D / 2 - 0.07, 0.37, 0.02, '#c8d0d8', { rot: [PI / 2, 0, 0], seg: 16, m: 'linen' });
      g.box(0, H - 0.2, D / 2 - 0.02, W - 0.1, 0.24, 0.03, '#3a3c40', {});
      g.box(-0.25, H - 0.2, D / 2, 0.36, 0.13, 0.004, '#ffffff', { emi: SCR.ui });
      LED(g, 0.2, H - 0.18, D / 2, '#3aff6a'); LED(g, 0.3, H - 0.18, D / 2, '#ff3a2a');
      g.box(0, 0.3, D / 2 - 0.02, W - 0.3, 0.2, 0.01, '#8a9096', {});   // lint drawer
      g.cyl(-W / 2 + 0.3, H + 0.15, -D / 4, 0.12, 0.3, '#b9bec2', { seg: 10, m: 'brushed' });   // exhaust stub
    },
  },
  ironer: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      g.box(0, 0.45, 0, W, 0.9, D - 0.3, '#d8dcde', { m: 'paint', r: 0.03, steps: 1 });
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.08), 0.62, 0, 0.16, 1.24, D - 0.2, '#3f6f8f', { m: 'paint' });
      for (const z of [-0.25, 0.2]) g.cyl(0, 1.0, z, 0.24, W - 0.3, '#b9bec2', { rot: [0, 0, PI / 2], seg: 16, m: 'chrome' });
      // feed table (+Z) with sheet
      g.box(0, 0.98, D / 2 - 0.15, W - 0.35, 0.04, 0.4, '#e8e6e0', { m: 'paint', rot: [-0.2, 0, 0] });
      g.box(0, 1.01, D / 2 - 0.2, W - 0.6, 0.01, 0.45, '#ffffff', { m: 'linen', rot: [-0.2, 0, 0] });
      // folded output (-Z)
      g.box(0, 0.94, -D / 2 + 0.2, W - 0.5, 0.06, 0.3, '#3a3c40', {});
      for (let k = 0; k < 4; k++) g.box(-W / 3 + k * W / 4.5, 1.0 + (k % 2) * 0.03, -D / 2 + 0.2, 0.35, 0.06 + (k % 2) * 0.03, 0.26, '#f6f5f1', { m: 'linen' });
      g.box(W / 2 - 0.08, 1.3, 0.2, 0.18, 0.12, 0.3, '#3a3c40', {});
      g.box(W / 2 - 0.08, 1.3, 0.36, 0.14, 0.08, 0.004, '#ffffff', { emi: SCR.ui });
    },
  },
  dish_machine: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      g.box(0, 0.45, 0, W, 0.9, D, C.steelL, { m: 'brushed' });
      g.box(0, 1.3, 0, W * 0.55, 0.8, D - 0.05, C.steelL, { m: 'brushed', r: 0.02, steps: 1 });
      g.box(0, 1.3, D / 2 - 0.02, W * 0.5, 0.6, 0.01, '#9aa1a6', { m: 'brushed' });
      for (const s of [-1, 1]) {
        g.box(s * W * 0.38, 0.92, 0, W * 0.22, 0.04, D - 0.1, C.steel, { m: 'steel' });
        for (let k = 0; k < 4; k++) g.box(s * W * 0.38, 0.95, -D / 2 + 0.15 + k * 0.17, W * 0.2, 0.012, 0.012, '#6a6d70', {});
        g.box(s * W * 0.38, 1.06, 0, 0.45, 0.2, 0.45, '#cfe3ea', { glass: true });   // rack of glasses
      }
      g.box(0, 1.6, D / 2, 0.3, 0.1, 0.004, '#ffffff', { emi: SCR.ui });
      g.pipe([0, H - 0.02, 0], [0, H, 0], 0.15, C.steel, {});
    },
  },
  pass_counter: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      g.box(0, 0.45, 0, W, 0.9, D, C.steelL, { m: 'brushed' });
      g.box(0, 0.92, 0, W + 0.04, 0.04, D + 0.04, C.steelL, { m: 'steel' });
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.03), 1.32, 0, 0.04, 0.8, 0.04, C.steel, {});
      g.box(0, 1.7, 0, W, 0.08, 0.4, C.steelL, { m: 'brushed' });
      for (let x = -W / 2 + 0.3; x < W / 2 - 0.2; x += 0.45) g.box(x, 1.655, 0, 0.3, 0.012, 0.18, '#ffb070', { emi: 1.8 });   // heat lamps
      for (let k = 0; k < 4; k++) g.cyl(-W / 2 + 0.35 + k * (W - 0.7) / 3, 0.95, 0, 0.14, 0.02, '#f4f3ef', { seg: 14, m: 'ceramic' });
      g.box(0, 1.6, D / 2 - 0.02, W - 0.2, 0.06, 0.01, '#3a3c40', {});
      for (let k = 0; k < 5; k++) g.box(-W / 2 + 0.3 + k * 0.35, 1.52, D / 2 - 0.01, 0.08, 0.12, 0.002, '#f6f5f1', {});   // tickets
    },
  },
  pool_table: {
    build(g, W, D, H) {
      g.aoH = 0.1;
      const top = 0.8;
      g.box(0, top - 0.08, 0, W, 0.16, D, '#3a2418', { m: 'wood', r: 0.03, steps: 1 });
      g.box(0, top + 0.005, 0, W - 0.24, 0.02, D - 0.24, '#1f6b46', { m: 'felt' });
      for (const s of [-1, 1]) { g.box(0, top + 0.03, s * (D / 2 - 0.09), W - 0.3, 0.05, 0.06, '#185a3a', { m: 'felt' }); g.box(s * (W / 2 - 0.09), top + 0.03, 0, 0.06, 0.05, D - 0.3, '#185a3a', { m: 'felt' }); }
      for (const x of [-W / 2 + 0.12, 0, W / 2 - 0.12]) for (const s of [-1, 1]) g.cyl(x, top + 0.01, s * (D / 2 - 0.12), 0.05, 0.03, '#0a0a0a', { seg: 8 });
      sqLegs(g, -W / 2 + 0.2, W / 2 - 0.2, -D / 2 + 0.2, D / 2 - 0.2, top - 0.15, 0.12, '#2a1a12');
      const bc = ['#f2c230', '#2f6aa8', '#c0281e', '#6a2a8a', '#ea6a1f', '#2f9a4a', '#7a2a2a', '#151517', '#f4f3ef'];
      for (let k = 0; k < 9; k++) g.sph(0.4 + (k % 4) * 0.06 - Math.floor(k / 4) * 0.03, top + 0.045, -0.1 + Math.floor(k / 4) * 0.06 + (k % 4) * 0.02, 0.028, bc[k], { seg: 6, m: 'gloss' });
      g.pipe([-0.9, top + 0.04, 0.3], [0.1, top + 0.04, 0.42], 0.008, '#c8a46a', { seg: 4 });   // cue
      g.box(0, 2.0, 0, 1.4, 0.14, 0.3, '#1f4a2a', { m: 'paint' });   // shade lamp
      g.box(0, 1.93, 0, 1.3, 0.004, 0.24, '#fff2d0', { emi: 1.8 });
      for (const s of [-1, 1]) g.pipe([s * 0.5, 2.07, 0], [s * 0.5, 2.6, 0], 0.006, '#151517', { seg: 3 });
    },
  },
};

function palletBase(g, W, D) {
  for (let k = 0; k < 5; k++) g.box(-W / 2 + 0.06 + k * (W - 0.12) / 4, 0.135, 0, 0.1, 0.022, D, '#c8a46a', { m: 'wood' });
  for (const z of [-D / 2 + 0.05, 0, D / 2 - 0.05]) g.box(0, 0.07, z, W, 0.1, 0.1, '#a88a56', { m: 'wood' });
  for (let k = 0; k < 3; k++) g.box(-W / 2 + 0.06 + k * (W - 0.12) / 2, 0.01, 0, 0.1, 0.02, D, '#c8a46a', { m: 'wood' });
}
