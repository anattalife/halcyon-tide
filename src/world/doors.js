// HALCYON TIDE — doors: visual leaves for every plan door, animation, access control, player interaction.
//
// game.doors API (see docs/ARCHITECTURE.md "Doors"):
//   canPass(actor, door)            → bool. actor = game.player | npc ({access:Set, keycards?:Set, x, z, deck}) | null
//   reasonFor(actor, door)          → '' | human reason why the actor cannot pass ("Crew keycard required")
//   request(deck, id, actor, opts)  → true if the door opens (or is open) for that actor; swing doors open away from them
//   open(deck, id, opts) / close(deck, id)   unconditional (scripted) open / close
//   lock(deck, id, state=true)      lockedState: true (credential needed) | false (anyone) | 'sealed' (nobody, lockdown)
//   unlock(deck, id)                lockedState = false
//   forceOpen(deck, id)             jammed open (forcedOpen = true, never closes, lockedState = false)
//   unlockWith(deck, id, 'pick'|'card'|'force', actor?)  → bool
//   isLocked(deck, id)              → true when a credential (or more) is needed
//   setPhase(deck, id, p)           (elevators) drive an elevator landing door's open phase 0..1 directly
//   hasCredential(actor, access)    raw credential test (keycards / NPC access set / disguise role)
//   state(deck, id)                 → world.door(deck, id)
//
// Runtime door state (world.door(d,id)) fields used/maintained here:
//   open (0..1 linear phase; collision treats < 0.7 as closed), target (0|1), lockedState, forcedOpen, lastUse (game seconds),
//   ctrl ('elevator' for landing doors — driven by game.elevators), swing (+1/-1 current swing side for two-way doors),
//   holdOpen (bool, scripted), inside (room id of the secured side → free egress from there).
//
// Permissions (canPass):
//   forcedOpen → yes. lockedState 'sealed' → no. Actor standing in the secured ("inside") room → yes (free egress).
//   lockedState false → yes. Otherwise hasCredential(actor, access):
//     'none' (but locked by script) → keycard/role 'master'|'security'|'officer'
//     'crew' → NPC access has 'crew' | player keycard 'crew' | player disguise is crew-ish (crew_*, security, medic, captain, croupier…)
//     'officer'|'security'|'engineer'|'casino'|'vip' → matching keycard or matching role (NPC access set or disguise role)
//     'cabin:NNNN' → keycard 'cabin:NNNN' or 'master' (NPC access sets work the same way)
//   Doors with access ≠ 'none' start locked (lockedState = true); picking/forcing sets it false.
//
// Bus: 'door:move' {deck, door, opening} on every start of motion; 'sfx' keycard_ok / keycard_deny / lockpick.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID, deckY, idx, toI, toJ } from '../core/config.js';
import { patchSurface } from './materials.js';

// ── tunables ───────────────────────────────────────────────────────────────
const OPEN_T = { cabin: 0.95, crew: 0.9, swing: 0.75, glass: 0.7, balcony: 1.25, watertight: 4.5, elevator: 1.7 };
const CLOSE_T = { cabin: 1.1, crew: 1.0, swing: 0.9, glass: 0.9, balcony: 1.4, watertight: 6.0, elevator: 1.7 };
const AUTO_CLOSE = { cabin: 3.5, crew: 3.5, swing: 3.2, glass: 1.6, balcony: 6.0, watertight: 6.0 };
const LEAF_H = { cabin: 2.09, crew: 2.09, swing: 2.09, glass: 2.27, balcony: 2.27, watertight: 2.08, elevator: 2.09 };
const OPEN_H = { watertight: 1.95, glass: 2.3, balcony: 2.3 };
const T_IN = 0.14, T_EXT = 0.3;
const ZONE_RANK = { public: 0, private: 1, crew: 2, restricted: 3 };

// player disguise role → granted access tags (uniforms grant role access, never cabin keys)
const ROLE_ACCESS = {
  captain: ['crew', 'officer', 'security', 'engineer'],
  crew_officer: ['crew', 'officer'],
  security: ['crew', 'security'],
  crew_engineer: ['crew', 'engineer'],
  crew_deckhand: ['crew', 'engineer'],
  croupier: ['crew', 'casino'],
  medic: ['crew'], lifeguard: ['crew'], entertainer: ['crew'],
};
const REASON = {
  crew: 'Crew keycard required', officer: 'Officer keycard required', security: 'Security clearance required',
  engineer: 'Engineering keycard required', casino: 'Casino staff only', vip: 'VIP keycard required', none: 'Locked',
};

const ease = (t) => t * t * (3 - 2 * t);
const easeSlow = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// ── canvas textures ─────────────────────────────────────────────────────────
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function veneerTexture() {
  const W = 256, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rnd(7);
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, '#4f3020'); grd.addColorStop(0.5, '#5e3a26'); grd.addColorStop(1, '#4b2d1d');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // quarter-cut grain: wavy vertical lines
  for (let k = 0; k < 140; k++) {
    const x0 = r() * W, amp = 1 + r() * 4, f = 0.004 + r() * 0.01, ph = r() * 6;
    g.strokeStyle = r() < 0.5 ? `rgba(40,20,8,${0.05 + r() * 0.12})` : `rgba(150,100,62,${0.04 + r() * 0.08})`;
    g.lineWidth = 0.6 + r() * 1.6; g.beginPath();
    for (let y = 0; y <= H; y += 8) { const x = x0 + Math.sin(y * f + ph) * amp + Math.sin(y * 0.05 + ph * 2) * 0.6; y ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // routed decorative grooves (two horizontal reveal lines) + edge darkening
  g.fillStyle = 'rgba(25,12,4,0.55)';
  g.fillRect(0, H * 0.335, W, 2); g.fillRect(0, H * 0.67, W, 2);
  g.fillStyle = 'rgba(255,220,170,0.12)';
  g.fillRect(0, H * 0.335 + 2, W, 1); g.fillRect(0, H * 0.67 + 2, W, 1);
  const eg = g.createLinearGradient(0, 0, W, 0);
  eg.addColorStop(0, 'rgba(0,0,0,0.25)'); eg.addColorStop(0.04, 'rgba(0,0,0,0)'); eg.addColorStop(0.96, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = eg; g.fillRect(0, 0, W, H);
  // brass kick plate at the foot
  const kg = g.createLinearGradient(0, H - 26, 0, H);
  kg.addColorStop(0, '#b38a45'); kg.addColorStop(0.5, '#e0c07a'); kg.addColorStop(1, '#8c6a33');
  g.fillStyle = kg; g.fillRect(0, H - 24, W, 24);
  return tex(c);
}
function steelTexture(base = '#8f979c', seed = 3) {
  const W = 256, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rnd(seed);
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 2500; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.04})`; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); }
  // pressed panel outline
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 3; g.strokeRect(22, 30, W - 44, H - 60);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; g.strokeRect(25, 33, W - 44, H - 60);
  // scuffs near the foot
  for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(30,30,30,${0.05 + r() * 0.1})`; g.lineWidth = 1; g.beginPath(); const x = r() * W, y = H - 60 + r() * 55; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 6); g.stroke(); }
  const kg = g.createLinearGradient(0, H - 30, 0, H); kg.addColorStop(0, '#6f777c'); kg.addColorStop(1, '#4f565b');
  g.fillStyle = kg; g.fillRect(0, H - 28, W, 28);
  return tex(c);
}
function brushedTexture() {
  const W = 256, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rnd(11);
  g.fillStyle = '#b7bcc1'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,45,50'},${0.02 + r() * 0.07})`; g.fillRect(0, y, W, 1); }
  for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(255,255,255,${r() * 0.08})`; g.fillRect(r() * W, r() * H, 20 + r() * 120, 1); }
  // edge shadow lines so adjacent leaves read as separate panels
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, 2, H); g.fillRect(W - 2, 0, 2, H);
  return tex(c);
}
function watertightTexture() {
  const W = 256, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = rnd(5);
  g.fillStyle = '#6b757b'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 3000; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.05})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
  // stiffener ribs
  for (const y of [0.25, 0.5, 0.75]) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(30, H * y, W - 60, 6); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(30, H * y - 2, W - 60, 2); }
  // hazard stripes on both vertical edges
  const sw = 26;
  for (const x0 of [0, W - sw]) {
    g.save(); g.beginPath(); g.rect(x0, 0, sw, H); g.clip();
    g.fillStyle = '#f2c21b'; g.fillRect(x0, 0, sw, H);
    g.fillStyle = '#111';
    for (let y = -40; y < H + 40; y += 36) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + sw, y - 18); g.lineTo(x0 + sw, y); g.lineTo(x0, y + 18); g.closePath(); g.fill(); }
    g.restore();
  }
  // rust streaks under the ribs
  for (let k = 0; k < 18; k++) { const x = 40 + r() * (W - 80), y = H * (0.25 + 0.25 * Math.floor(r() * 3)) + 6; const gr = g.createLinearGradient(0, y, 0, y + 40 + r() * 60); gr.addColorStop(0, 'rgba(110,60,30,0.28)'); gr.addColorStop(1, 'rgba(110,60,30,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 3, 100); }
  return tex(c);
}
function signAtlas() {
  const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d');
  const rows = [
    { bg: '#eef1f0', fg: '#1f4766', border: '#1f4766', text: 'CREW ONLY', size: 74 },
    { bg: '#f4f4f2', fg: '#b3261e', border: '#b3261e', text: 'AUTHORISED PERSONNEL ONLY', size: 34 },
    { bg: '#1d2833', fg: '#f0e6d0', border: '#c9a45b', text: 'SECURITY · NO ENTRY', size: 44 },
    { bg: '#f2c230', fg: '#111111', border: '#111111', text: 'WATERTIGHT DOOR · KEEP CLEAR', size: 32 },
  ];
  rows.forEach((s, k) => {
    const y = k * 128;
    g.fillStyle = s.bg; g.fillRect(0, y, W, 128);
    g.strokeStyle = s.border; g.lineWidth = 8; g.strokeRect(10, y + 10, W - 20, 108);
    g.fillStyle = s.fg; g.font = `800 ${s.size}px Arial, Helvetica, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.text, W / 2, y + 66);
  });
  return tex(c);
}
// glyph strip for digit shaders: 10 cells, white glyphs on black
const _digitTex = {};
export function digitTexture(style = 'serif') {
  if (_digitTex[style]) return _digitTex[style];
  const CW = 96, H = 160, c = canvas(CW * 10, H), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, CW * 10, H);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = style === 'led' ? '700 150px "Courier New", monospace' : style === 'sans' ? '700 140px Arial, Helvetica, sans-serif' : '600 140px Georgia, "Times New Roman", serif';
  for (let k = 0; k < 10; k++) g.fillText(String(k), CW * k + CW / 2, H / 2 + 6);
  const t = tex(c, false);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return (_digitTex[style] = t);
}

// Digit display material. Per-instance (or per-vertex) float attribute `aNum` holds the number.
//   mode 'plate': engraved number centred on a plate (cabin numbers, deck plaques) — uPlate / uInk colours
//   mode 'lift':  lift position indicator: aNum = deck + 100*dir (dir 0 idle, 1 up, 2 down); glowing digits + arrow
export function makeDigitMaterial({ mode = 'plate', plate = 0xc9a24f, ink = 0x2a1a08, glow = 0xffa53a, style = 'serif', metal = 0.9, rough = 0.35, intDefault = 0 } = {}) {
  const lift = mode === 'lift';
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: lift ? 0.2 : metal, roughness: lift ? 0.3 : rough });
  patchSurface(mat, { key: 'dig' + mode, intDefault });
  const base = mat.onBeforeCompile;
  const U = { uDig: { value: digitTexture(lift ? 'led' : style) }, uPlate: { value: new THREE.Color(plate) }, uInk: { value: new THREE.Color(ink) }, uGlow: { value: new THREE.Color(glow) }, uGlowK: { value: 1 } };
  mat.userData.digitUniforms = U;
  mat.onBeforeCompile = (sh) => {
    base(sh);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'attribute float aNum;\nvarying float vNum;\nvarying vec2 vDUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvNum = aNum; vDUv = uv;');
    const glyph = `
      float dGlyph(float dg, vec2 q) { return texture2D(uDig, vec2((dg + clamp(q.x, 0.02, 0.98)) / 10.0, clamp(q.y, 0.0, 1.0))).r; }
      float dAt(float n, float slot, float nd) { return mod(floor(n / pow(10.0, nd - 1.0 - slot) + 0.001), 10.0); }`;
    let f = 'uniform sampler2D uDig; uniform vec3 uPlate; uniform vec3 uInk; uniform vec3 uGlow; uniform float uGlowK;\nvarying float vNum;\nvarying vec2 vDUv;\n' + glyph + '\n' + sh.fragmentShader;
    if (!lift) {
      f = f.replace('#include <color_fragment>', `#include <color_fragment>
        {
          float n = floor(vNum + 0.5);
          float nd = n >= 9999.5 ? 5.0 : n >= 999.5 ? 4.0 : n >= 99.5 ? 3.0 : n >= 9.5 ? 2.0 : 1.0;
          vec2 q = (vDUv - vec2(0.14, 0.16)) / vec2(0.72, 0.68);
          float ink = 0.0;
          if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) { float cw = 1.0 / nd; float slot = floor(q.x / cw); ink = dGlyph(dAt(n, slot, nd), vec2(fract(q.x / cw), q.y)); }
          // bevelled border
          vec2 e = min(vDUv, 1.0 - vDUv); float bord = 1.0 - smoothstep(0.03, 0.06, min(e.x, e.y * 2.4));
          diffuseColor.rgb = mix(uPlate * (1.0 - 0.25 * bord), uInk, ink * 0.92);
        }`);
      f = f.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, step(0.5, (diffuseColor.r + diffuseColor.g) < (uPlate.r + uPlate.g) * 0.6 ? 1.0 : 0.0));');
    } else {
      f = f.replace('#include <color_fragment>', `#include <color_fragment>
        float liftInk = 0.0;
        {
          float n = floor(vNum + 0.5);
          float deck = mod(n, 100.0), dir = floor(n / 100.0);
          vec2 uv = vDUv;
          // arrow cell on the left third
          if (uv.x < 0.34) {
            vec2 a = vec2((uv.x - 0.04) / 0.26, (uv.y - 0.16) / 0.68);
            if (dir > 0.5 && a.x > 0.0 && a.x < 1.0 && a.y > 0.0 && a.y < 1.0) {
              float yy = dir < 1.5 ? a.y : 1.0 - a.y;               // up: tip at top
              float tri = step(abs(a.x - 0.5) * 2.0, (yy - 0.08) * 1.25) * step(yy, 0.92) * step(0.08, yy);
              liftInk = tri;
            }
          } else {
            vec2 q = vec2((uv.x - 0.36) / 0.6, (uv.y - 0.12) / 0.76);
            if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
              float slot = floor(q.x * 2.0);
              float dg = dAt(deck, slot, 2.0);
              if (!(slot < 0.5 && deck < 9.5)) liftInk = dGlyph(dg, vec2(fract(q.x * 2.0), q.y));
            }
          }
          diffuseColor.rgb = vec3(0.015, 0.016, 0.02);
        }`);
      f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * liftInk * 2.4 * uGlowK + uGlow * 0.02 * uGlowK;');
    }
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'digit-' + mode;
  return mat;
}

// ── geometry helpers ────────────────────────────────────────────────────────
function boxG(w, h, d, cx = 0, cy = 0, cz = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(cx, cy, cz); return g; }
function merge(list) { const g = mergeGeometries(list.map(x => x.index ? x.toNonIndexed() : x), false); for (const x of list) x.dispose(); return g; }
// unit-width leaf (x ∈ [0,1]) of height h and thickness t, bottom at y0
const leafG = (h, t, y0 = 0.008) => boxG(1, h, t, 0.5, y0 + h / 2, 0);
function swingFrameG(h) {
  // stiles, rails and glazing beads of a glazed double-door leaf (unit width)
  const t = 0.05, s = 0.13;
  return merge([boxG(s, h, t, s / 2, h / 2 + 0.008, 0), boxG(s, h, t, 1 - s / 2, h / 2 + 0.008, 0),
    boxG(1 - 2 * s, 0.16, t, 0.5, h - 0.08 + 0.008, 0), boxG(1 - 2 * s, 0.34, t, 0.5, 0.17 + 0.008, 0), boxG(1 - 2 * s, 0.07, t, 0.5, 1.02, 0)]);
}
function glassDoorFrameG(h) {
  const t = 0.045, s = 0.05;
  return merge([boxG(s, h, t, s / 2, h / 2 + 0.008, 0), boxG(s, h, t, 1 - s / 2, h / 2 + 0.008, 0),
    boxG(1, 0.07, t, 0.5, h - 0.035 + 0.008, 0), boxG(1, 0.12, t, 0.5, 0.06 + 0.008, 0)]);
}

// ── module ─────────────────────────────────────────────────────────────────
export function installDoors(game) {
  const world = game.world, plans = world.plans, bus = game.bus;
  const T = { now: 0 };

  // materials (all indoor-capable surfaces are patched for the baked interior light term)
  const M = {
    wood: patchSurface(new THREE.MeshStandardMaterial({ map: veneerTexture(), roughness: 0.48, metalness: 0.0 }), { key: 'door' }),
    woodFrame: patchSurface(new THREE.MeshStandardMaterial({ color: 0x6b4529, roughness: 0.42, metalness: 0.0 }), { key: 'door' }),
    steel: patchSurface(new THREE.MeshStandardMaterial({ map: steelTexture(), roughness: 0.42, metalness: 0.45 }), { key: 'door' }),
    brushed: patchSurface(new THREE.MeshStandardMaterial({ map: brushedTexture(), color: 0x9aa0a6, roughness: 0.38, metalness: 0.75, envMapIntensity: 0.45 }), { key: 'door' }),
    brass: patchSurface(new THREE.MeshStandardMaterial({ color: 0xcfa14e, roughness: 0.28, metalness: 1.0 }), { key: 'door' }),
    chrome: patchSurface(new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.18, metalness: 1.0 }), { key: 'door' }),
    dark: patchSurface(new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.45, metalness: 0.3 }), { key: 'door' }),
    alu: patchSurface(new THREE.MeshStandardMaterial({ color: 0x8e979d, roughness: 0.35, metalness: 0.85 }), { key: 'door' }),
    wt: patchSurface(new THREE.MeshStandardMaterial({ map: watertightTexture(), roughness: 0.55, metalness: 0.5 }), { key: 'door' }),
    wtFrame: patchSurface(new THREE.MeshStandardMaterial({ color: 0x59636a, roughness: 0.5, metalness: 0.55 }), { key: 'door' }),
    sign: patchSurface(new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.5, metalness: 0.0 }), { key: 'door' }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xa7c2ca, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.8 }),
    // safety manifestation band (frosted dotted strip) — makes automatic glass doors read as doors
    frost: (() => { const c = canvas(256, 64), g = c.getContext('2d'); g.clearRect(0, 0, 256, 64); g.fillStyle = 'rgba(240,244,246,0.9)'; for (let x = 8; x < 256; x += 16) for (const yy of [16, 32, 48]) { g.beginPath(); g.arc(x + (yy === 32 ? 8 : 0), yy, yy === 32 ? 5.5 : 3.5, 0, Math.PI * 2); g.fill(); } const t = tex(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return patchSurface(new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, alphaTest: 0.05 }), { key: 'frost' }); })(),
    led: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    plate: makeDigitMaterial({ mode: 'plate', plate: 0xc9a24f, ink: 0x24160a }),
  };
  const signGeo = (row) => { const g = new THREE.PlaneGeometry(1, 1); const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (row + (1 - uv.getY(k))) / 4); return g; };

  // part kinds: geometry + material (geometries are cloned per deck/layer so each mesh can own its aInt attribute)
  const H = LEAF_H;
  const K = {
    cabinLeaf: [leafG(H.cabin, 0.045), M.wood],
    crewLeaf: [leafG(H.crew, 0.05), M.steel],
    elevLeaf: [leafG(H.elevator, 0.035), M.brushed],
    wtLeaf: [leafG(H.watertight, 0.075, 0.0), M.wt],
    swingFrame: [swingFrameG(H.swing), M.woodFrame],
    swingGlass: [boxG(1 - 0.26, H.swing - 0.16 - 0.34 - 0.02, 0.012, 0.5, 0.34 + (H.swing - 0.5) / 2 + 0.01, 0), M.glass],
    glassFrame: [glassDoorFrameG(H.glass), M.alu],
    glassPane: [boxG(1 - 0.1, H.glass - 0.19, 0.012, 0.5, 0.12 + (H.glass - 0.19) / 2 + 0.008, 0), M.glass],
    glassFrost: [merge([(() => { const g = new THREE.PlaneGeometry(1 - 0.1, 0.16); g.translate(0.5, 1.05, 0.0065); return g; })(), (() => { const g = new THREE.PlaneGeometry(1 - 0.1, 0.16); g.rotateY(Math.PI); g.translate(0.5, 1.05, -0.0065); return g; })()]), M.frost],
    balcFrame: [glassDoorFrameG(H.balcony), M.alu],
    balcPane: [boxG(1 - 0.1, H.balcony - 0.19, 0.012, 0.5, 0.12 + (H.balcony - 0.19) / 2 + 0.008, 0), M.glass],
    // hardware (not scaled with the leaf)
    // lever handles: rose + lever pointing toward -x (the hinge); F = on the +z face, B = on the -z face (mirrored, not rotated)
    leverF: [merge([boxG(0.055, 0.055, 0.012, 0, 0, 0.006), boxG(0.024, 0.024, 0.05, 0, 0, 0.03), boxG(0.13, 0.024, 0.024, -0.055, 0, 0.058)]), M.brass],
    leverB: [merge([boxG(0.055, 0.055, 0.012, 0, 0, -0.006), boxG(0.024, 0.024, 0.05, 0, 0, -0.03), boxG(0.13, 0.024, 0.024, -0.055, 0, -0.058)]), M.brass],
    lockBox: [boxG(0.075, 0.16, 0.022, 0, 0, 0.011), M.dark],
    led: [boxG(0.012, 0.012, 0.006, 0, 0, 0.003), M.led],
    plate: [(() => { const g = new THREE.PlaneGeometry(0.2, 0.075); return g; })(), M.plate],
    pushBar: [merge([boxG(0.62, 0.045, 0.035, 0, 0, 0.06), boxG(0.05, 0.08, 0.06, -0.3, 0, 0.03), boxG(0.05, 0.08, 0.06, 0.3, 0, 0.03)]), M.chrome],
    pullBar: [merge([boxG(0.025, 0.36, 0.025, 0, 0, 0.055), boxG(0.025, 0.025, 0.05, 0, 0.17, 0.025), boxG(0.025, 0.025, 0.05, 0, -0.17, 0.025)]), M.chrome],
    pushPlate: [boxG(0.1, 0.32, 0.004, 0, 0, 0.002), M.brass],
    pullBrass: [merge([boxG(0.03, 0.6, 0.03, 0, 0, 0.06), boxG(0.03, 0.03, 0.06, 0, 0.28, 0.03), boxG(0.03, 0.03, 0.06, 0, -0.28, 0.03)]), M.brass],
    glassPull: [merge([boxG(0.03, 0.9, 0.03, 0, 0, 0.05), boxG(0.03, 0.03, 0.05, 0, 0.42, 0.025), boxG(0.03, 0.03, 0.05, 0, -0.42, 0.025)]), M.chrome],
    wtHandle: [merge([boxG(0.05, 0.42, 0.05, 0, 0, 0.07), boxG(0.06, 0.06, 0.07, 0, 0.19, 0.035), boxG(0.06, 0.06, 0.07, 0, -0.19, 0.035)]), M.wtFrame],
    sign0: [signGeo(0), M.sign], sign1: [signGeo(1), M.sign], sign2: [signGeo(2), M.sign], sign3: [signGeo(3), M.sign],
    // static frames (unit boxes scaled per instance)
    box: [boxG(1, 1, 1, 0, 0.5, 0), M.wtFrame],
    boxAlu: [boxG(1, 1, 1, 0, 0.5, 0), M.alu],
    boxSteel: [boxG(1, 1, 1, 0, 0.5, 0), M.brushed],
    boxDark: [boxG(1, 1, 1, 0, 0.5, 0), M.dark],
    stopWood: [boxG(1, 1, 1, 0, 0.5, 0), M.woodFrame],
    stopSteel: [boxG(1, 1, 1, 0, 0.5, 0), M.steel],
  };

  // ── per-door records ──────────────────────────────────────────────────
  // buckets[deck][layer][kind] = { list: [ {m:Matrix4|null, int} ], mesh }
  const buckets = [];
  const records = [];         // all door records
  const byKey = new Map();    // world.doorKey → record
  // interior parts are bucketed per deck (streamed with the deck's detail group); exterior parts go into one
  // ship-wide bucket (deck 0) so they cost a single draw call per kind instead of one per deck
  const bucket = (d, layer, kind) => {
    if (layer === 'e') d = 0;
    const B = buckets[d] || (buckets[d] = { d: {}, e: {} });
    return B[layer][kind] || (B[layer][kind] = { list: [], mesh: null, dirty: false, kind, layer, d });
  };
  const addPart = (rec, kind, local, opts = {}) => {
    const b = bucket(rec.deck, rec.layer, kind);
    const p = { b, i: b.list.length, local, leaf: opts.leaf ?? -1, scale: !!opts.scale, int: opts.int ?? rec.int, num: opts.num ?? 0, color: opts.color ?? null };
    b.list.push(p);
    rec.parts.push(p);
    return p;
  };
  const mtx = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

  // plan helpers
  const roomIdAt = (P, x, z) => { const i = toI(x), j = toJ(z); if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) return 0; return P.room[idx(i, j)]; };
  const toW = (dr, lx, lz) => dr.normal === 'z' ? [dr.x + lx, dr.z + lz] : [dr.x - lz, dr.z + lx];
  const toL = (dr, x, z) => dr.normal === 'z' ? [x - dr.x, z - dr.z] : [z - dr.z, -(x - dr.x)];
  // edge type on the door's own wall line at run-local coordinate s (relative to door centre)
  const lineEdge = (P, dr, s) => {
    if (dr.normal === 'z') { const j = Math.round((dr.line - GRID.z0) / GRID.cell) - 1, i = toI(dr.x + s); if (i < 0 || i >= GRID.nx || j < 0 || j >= GRID.nz) return 0; return P.ez[idx(i, j)]; }
    const i = Math.round((dr.line - GRID.x0) / GRID.cell) - 1, j = toJ(dr.z + s); if (i < 0 || i >= GRID.nx || j < 0 || j >= GRID.nz) return 0; return P.ex[idx(i, j)];
  };
  const wallRun = (P, dr, dir, len) => { let n = 0; for (let s = dr.w / 2 + 0.25; s < dr.w / 2 + len; s += 0.5) { const t = lineEdge(P, dr, dir * s); if (t === 1 || t === 4) n++; else break; } return n * 0.5; };
  const cellBad = (P, x, z, roomId) => { const i = toI(x), j = toJ(z); if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) return 1; const k = idx(i, j); return P.room[k] !== roomId ? 1 : (P.block[k] ? 1 : 0); };

  function insideRoom(P, dr, rA, rB) {
    const A = P.rooms[rA], B = P.rooms[rB];
    if (!A) return rB; if (!B) return rA;
    if (dr.type === 'balcony') return A.type === 'balcony' ? rB : rA;
    if (dr.type === 'cabin') return (A.type === 'cabin' || A.type === 'suite') ? rA : rB;
    const za = ZONE_RANK[A.zone] ?? 0, zb = ZONE_RANK[B.zone] ?? 0;
    if (za !== zb) return za > zb ? rA : rB;
    const ca = /corridor|lobby|stair/.test(A.type), cb = /corridor|lobby|stair/.test(B.type);
    if (ca !== cb) return ca ? rB : rA;
    return (A.area || 0) <= (B.area || 0) ? rA : rB;
  }

  // choose hinge end (-1 = a0 end, +1 = a1 end) for a single leaf swinging toward local side sz
  function chooseHinge(P, dr, sz, swingRoom) {
    let best = -1, bestS = Infinity;
    for (const he of [-1, 1]) {
      const hx = he * dr.w / 2;
      let s = 0;
      for (let k = 1; k <= 4; k++) { const [x, z] = toW(dr, hx - he * 0.06, sz * k * 0.24); s += cellBad(P, x, z, swingRoom) * 2; }
      for (let a = 0.25; a < 1.5; a += 0.3) { const [x, z] = toW(dr, hx - he * Math.cos(a) * dr.w * 0.85, sz * Math.sin(a) * dr.w * 0.85); s += cellBad(P, x, z, swingRoom); }
      // bonus: a wall continues right past the hinge (leaf parks against it)
      if (wallRun(P, dr, he, 0.8) > 0.4) s -= 0.5;
      if (s < bestS) { bestS = s; best = he; }
    }
    return best;
  }

  // ── build records for every plan door ─────────────────────────────────
  for (let d = 1; d < plans.length; d++) {
    const P = plans[d]; if (!P) continue;
    const y = deckY(d);
    for (const dr of P.doors) {
      const st = world.door(d, dr.id);
      const rPlus = roomIdAt(P, ...toW(dr, 0, 0.25)), rMinus = roomIdAt(P, ...toW(dr, 0, -0.25));
      const RP = P.rooms[rPlus], RM = P.rooms[rMinus];
      const exterior = dr.type === 'balcony' || !!(RP && RP.exterior) || !!(RM && RM.exterior) || !RP || !RM;
      const intOf = (r) => (r && !r.exterior && !r.isVoid ? (r.light ?? 0.9) : 0);
      const int = Math.max(intOf(RP), intOf(RM)) * (exterior ? 0.55 : 1);
      const inside = insideRoom(P, dr, rPlus, rMinus);
      const inSide = inside === rPlus ? 1 : -1;          // local z sign of the secured room
      const rec = {
        deck: d, id: dr.id, dr, st, type: dr.type, layer: exterior ? 'e' : 'd', int, parts: [], leaves: [],
        base: new THREE.Matrix4().compose(new THREE.Vector3(dr.x, y, dr.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dr.normal === 'z' ? 0 : -Math.PI / 2), new THREE.Vector3(1, 1, 1)),
        rPlus, rMinus, inSide, led: null, ledState: '', y,
      };
      st.inside = inside;
      st.ctrl = dr.type === 'elevator' ? 'elevator' : null;
      st.swing = inSide;
      if (st.lockedState === false && dr.access && dr.access !== 'none') st.lockedState = true;
      if (dr.type === 'elevator' || dr.type === 'glass') st.lockedState = st.lockedState && dr.access !== 'none' ? st.lockedState : false;
      buildDoor(rec, P);
      records.push(rec);
      byKey.set(world.doorKey(d, dr.id), rec);
      st._rec = rec;
    }
  }

  function buildDoor(rec, P) {
    const dr = rec.dr, w = dr.w, t = dr.type === 'balcony' ? T_EXT : T_IN;
    const out = -rec.inSide;   // local z sign of the "outer" (corridor / public) side
    switch (dr.type) {
      case 'cabin': case 'crew': {
        const sz = rec.inSide;                   // swings into the secured room
        const he = chooseHinge(P, dr, sz, rec.inSide > 0 ? rec.rPlus : rec.rMinus);
        // pivot sits on the room-side face of the partition and 7 cm in from the hinge jamb so the open leaf parks
        // clear of a perpendicular wall; a fixed stop strip covers the hinge-side gap when closed
        const HIN = 0.07, pz = sz * (T_IN / 2 + 0.025);
        const L = { hx: he * (w / 2 - HIN), hz: pz, th0: he < 0 ? 0 : Math.PI, swing: 'fixed', sz, w: w - HIN - 0.015, kind: 'swing' };
        rec.leaves.push(L);
        addPart(rec, dr.type === 'cabin' ? 'stopWood' : 'stopSteel', mtx(he * (w / 2 - HIN / 2), 0, pz, 0, HIN + 0.004, H[dr.type] + 0.01, 0.05), {});
        const li = 0, lw = L.w, flip = he < 0 ? 1 : -1;   // leaf-space z of door-local +z
        const oz = out * flip;                    // leaf-space z sign of the outer face
        if (dr.type === 'cabin') {
          addPart(rec, 'cabinLeaf', new THREE.Matrix4(), { leaf: li, scale: true });
          addPart(rec, 'leverF', mtx(lw - 0.075, 1.02, 0.0225), { leaf: li });
          addPart(rec, 'leverB', mtx(lw - 0.075, 1.02, -0.0225), { leaf: li });
          addPart(rec, 'lockBox', mtx(lw - 0.075, 1.2, oz * 0.0225, oz > 0 ? 0 : Math.PI), { leaf: li });
          rec.led = addPart(rec, 'led', mtx(lw - 0.075, 1.255, oz * 0.0445, oz > 0 ? 0 : Math.PI), { leaf: li, color: 0xff2a1a });
          // number plate on the corridor-side wall beside the latch, eye height
          const num = parseInt(dr.label || (dr.access || '').replace('cabin:', ''), 10) || 0;
          if (num) {
            const lx = -he * (w / 2 + 0.17);
            const room = P.rooms[out > 0 ? rec.rPlus : rec.rMinus];
            if (room && !room.exterior) addPart(rec, 'plate', mtx(lx, 1.56, out * (t / 2 + 0.004), out > 0 ? 0 : Math.PI), { num });
          }
        } else {
          addPart(rec, 'crewLeaf', new THREE.Matrix4(), { leaf: li, scale: true });
          // push bar on the push side (outer), pull handle on the swing side
          addPart(rec, 'pushBar', mtx(lw * 0.5, 1.0, oz * 0.025, oz > 0 ? 0 : Math.PI), { leaf: li });
          addPart(rec, 'pullBar', mtx(lw - 0.1, 1.05, -oz * 0.025, oz > 0 ? Math.PI : 0), { leaf: li });
          // signage on the outer face
          const A = P.rooms[rec.rPlus], B = P.rooms[rec.rMinus];
          const publicSide = (A && (A.zone === 'public' || A.zone === 'private')) || (B && (B.zone === 'public' || B.zone === 'private'));
          const acc = dr.access || 'none';
          let row = -1;
          if (acc === 'security') row = 2;
          else if (acc === 'officer' || acc === 'engineer' || acc === 'casino') row = 1;
          else if (publicSide) row = 0;
          if (row >= 0) addPart(rec, 'sign' + row, mtx(lw * 0.5, 1.58, oz * 0.0262, oz > 0 ? 0 : Math.PI, 0.36, 0.09, 1), { leaf: li });
          if (acc !== 'none') {
            // card reader on the wall beside the latch (outer side)
            const lx = -he * (w / 2 + 0.13);
            addPart(rec, 'lockBox', mtx(lx, 1.2, out * (t / 2), out > 0 ? 0 : Math.PI), {});
            rec.led = addPart(rec, 'led', mtx(lx, 1.255, out * (t / 2 + 0.022), out > 0 ? 0 : Math.PI), { color: 0xff2a1a });
          }
        }
        break;
      }
      case 'swing': {
        const lw = w / 2 - 0.015;
        for (const he of [-1, 1]) {
          const L = { hx: he * w / 2, hz: 0, th0: he < 0 ? 0 : Math.PI, swing: 'two-way', sz: 1, w: lw, kind: 'swing' };
          const li = rec.leaves.push(L) - 1;
          addPart(rec, 'swingFrame', new THREE.Matrix4(), { leaf: li, scale: true });
          addPart(rec, 'swingGlass', new THREE.Matrix4(), { leaf: li, scale: true });
          for (const s of [1, -1]) addPart(rec, 'pullBrass', mtx(lw - 0.09, 1.05, s * 0.025, s > 0 ? 0 : Math.PI), { leaf: li });
        }
        break;
      }
      case 'glass': {
        const lw = w / 2 + 0.03;
        const wallL = wallRun(P, dr, -1, 3), wallR = wallRun(P, dr, 1, 3);
        // surface-mounted sliders on the public side when the wall can't hide them; pocket when it can
        const pocket = wallL >= w / 2 - 0.1 && wallR >= w / 2 - 0.1;
        const zf = pocket ? 0 : out * (t / 2 + 0.03);
        for (const he of [-1, 1]) {
          const L = { hx: he < 0 ? -w / 2 - 0.03 : w / 2 + 0.03, hz: zf, th0: he < 0 ? 0 : Math.PI, kind: 'slide', dir: he, dist: lw - 0.06, w: lw };
          const li = rec.leaves.push(L) - 1;
          addPart(rec, 'glassFrame', new THREE.Matrix4(), { leaf: li, scale: true });
          addPart(rec, 'glassPane', new THREE.Matrix4(), { leaf: li, scale: true });
          addPart(rec, 'glassFrost', new THREE.Matrix4(), { leaf: li, scale: true });
        }
        const hh = OPEN_H.glass;
        if (!pocket) {
          // operator housing (transom box) across the opening + travel
          addPart(rec, 'boxAlu', mtx(0, hh, out * (t / 2 + 0.06), 0, w * 2 + 0.1, 0.2, 0.1), {});
        } else {
          // slim aluminium head + floor guide track + motion sensor
          addPart(rec, 'boxAlu', mtx(0, hh - 0.05, 0, 0, w + 0.06, 0.05, t + 0.02), {});
          addPart(rec, 'boxDark', mtx(0, 0, 0, 0, w, 0.006, 0.06), {});
          for (const s of [1, -1]) addPart(rec, 'boxDark', mtx(0, hh + 0.02, s * (t / 2 + 0.02), 0, 0.16, 0.04, 0.04), {});
        }
        break;
      }
      case 'balcony': {
        const lw = w / 2 + 0.03;
        // fixed outer panel on +x half, sliding inner panel on -x half that parks behind it
        const inZ = rec.inSide * 0.045, outZ = -rec.inSide * 0.045;
        const Lf = { hx: 0 - 0.03, hz: outZ, th0: 0, kind: 'fixed', w: lw };
        const Ls = { hx: -w / 2, hz: inZ, th0: 0, kind: 'slide', dir: 1, dist: w / 2 - 0.06, w: lw };
        for (const L of [Lf, Ls]) {
          const li = rec.leaves.push(L) - 1;
          addPart(rec, 'balcFrame', new THREE.Matrix4(), { leaf: li, scale: true });
          addPart(rec, 'balcPane', new THREE.Matrix4(), { leaf: li, scale: true });
        }
        addPart(rec, 'glassPull', mtx(0.06, 1.05, rec.inSide * 0.02 * (1), 0), { leaf: 1 });
        // outer frame (head + sill track)
        const hh = OPEN_H.balcony;
        addPart(rec, 'boxAlu', mtx(0, hh - 0.06, 0, 0, w, 0.06, 0.16), {});
        addPart(rec, 'boxAlu', mtx(0, 0, 0, 0, w, 0.025, 0.16), {});
        break;
      }
      case 'watertight': {
        // surface-mounted sliding steel door on the outer face; slides toward the longer solid wall
        const wl = wallRun(P, dr, -1, 2.5), wr = wallRun(P, dr, 1, 2.5);
        const dir = wr >= wl ? 1 : -1;
        const lw = w + 0.26, zf = out * (t / 2 + 0.07);
        const L = { hx: dir > 0 ? w / 2 + 0.13 : -w / 2 - 0.13, hz: zf, th0: dir > 0 ? Math.PI : 0, kind: 'slide', dir, dist: w + 0.14, w: lw };
        // leaf space: origin at the trailing edge, +x toward the leading edge
        rec.leaves.push(L);
        addPart(rec, 'wtLeaf', new THREE.Matrix4(), { leaf: 0, scale: true });
        addPart(rec, 'wtHandle', mtx(lw - 0.16, 1.05, 0.0375, 0), { leaf: 0 });
        addPart(rec, 'wtHandle', mtx(lw - 0.16, 1.05, -0.0375, Math.PI), { leaf: 0 });
        // heavy frame around the opening (jambs, head with hydraulic housing, track)
        const hh = OPEN_H.watertight, fz = out * (t / 2 + 0.02);
        addPart(rec, 'box', mtx(-w / 2 - 0.07, 0, fz, 0, 0.14, hh + 0.14, 0.05), {});
        addPart(rec, 'box', mtx(w / 2 + 0.07, 0, fz, 0, 0.14, hh + 0.14, 0.05), {});
        addPart(rec, 'box', mtx(dir * (w / 2 + 0.07), hh + 0.12, out * (t / 2 + 0.11), 0, w * 2 + 0.6, 0.2, 0.16), {});
        addPart(rec, 'boxDark', mtx(dir * (w / 2), hh + 0.15, out * (t / 2 + 0.195), 0, 0.5, 0.12, 0.03), {});
        addPart(rec, 'sign3', mtx(0, hh + 0.42, out * (t / 2 + 0.005), out > 0 ? 0 : Math.PI, 0.6, 0.15, 1), {});
        break;
      }
      case 'elevator': {
        // landing doors: centre-opening brushed steel pair on the lobby face, pocketing into the wall
        const lobbySide = (P.rooms[rec.rPlus]?.type === 'shaft') ? -1 : 1;
        rec.lobbySide = lobbySide;
        const zf = lobbySide * (t / 2 - 0.03);
        const lw = w / 2 + 0.015;
        for (const he of [-1, 1]) {
          const L = { hx: he * (w / 2 + 0.015), hz: zf, th0: he < 0 ? 0 : Math.PI, kind: 'slide', dir: he, dist: lw - 0.03, w: lw };
          const li = rec.leaves.push(L) - 1;
          addPart(rec, 'elevLeaf', new THREE.Matrix4(), { leaf: li, scale: true });
        }
        // brushed-steel architrave on the lobby face
        const hh = 2.12, fz = lobbySide * (t / 2 + 0.012);
        addPart(rec, 'boxSteel', mtx(-w / 2 - 0.05, 0, fz, 0, 0.1, hh + 0.1, 0.025), {});
        addPart(rec, 'boxSteel', mtx(w / 2 + 0.05, 0, fz, 0, 0.1, hh + 0.1, 0.025), {});
        addPart(rec, 'boxSteel', mtx(0, hh, fz, 0, w + 0.2, 0.1, 0.025), {});
        addPart(rec, 'boxDark', mtx(0, 0.0, lobbySide * (t / 2 - 0.01), 0, w, 0.008, 0.06), {});
        break;
      }
    }
  }

  // ── instanced meshes ─────────────────────────────────────────────────
  const meshes = [];
  for (let d = 0; d < buckets.length; d++) {
    const B = buckets[d]; if (!B) continue;
    const D = world.decks[d];
    for (const layer of ['d', 'e']) {
      for (const kind in B[layer]) {
        const b = B[layer][kind];
        const [g0, mat] = K[kind];
        const g = g0.clone();
        const n = b.list.length;
        const aInt = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        for (let k = 0; k < n; k++) aInt.array[k] = b.list[k].int;
        g.setAttribute('aInt', aInt);
        if (mat === M.plate) {
          const an = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
          for (let k = 0; k < n; k++) an.array[k] = b.list[k].num;
          g.setAttribute('aNum', an);
        }
        const mesh = new THREE.InstancedMesh(g, mat, n);
        mesh.name = `doors-${kind}-${layer}${d}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = false; mesh.receiveShadow = layer === 'e';
        if (mat === M.glass) mesh.renderOrder = 6;
        if (kind === 'led') for (let k = 0; k < n; k++) mesh.setColorAt(k, new THREE.Color(b.list[k].color ?? 0xff2a1a));
        b.mesh = mesh;
        const parent = layer === 'e' || !D ? world.root : D.detail;
        parent.add(mesh);
        meshes.push(b);
      }
    }
  }

  // ── matrices ─────────────────────────────────────────────────────────
  const _L = new THREE.Matrix4(), _M = new THREE.Matrix4(), _S = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function leafMatrix(rec, L, out) {
    const st = rec.st;
    let p = st.open;
    if (st.forcedOpen && !st.ctrl) p = Math.max(p, 0.86);
    const e = rec.type === 'watertight' ? easeSlow(p) : ease(p);
    let ang = L.th0, lx = L.hx, lz = L.hz;
    if (L.kind === 'swing') {
      const sz = L.swing === 'two-way' ? (st.swing || 1) : L.sz;
      // latch must move toward local z = sz
      const delta = sz * (L.th0 === 0 ? -1 : 1) * (Math.PI / 2) * e * (rec.type === 'swing' ? 0.98 : 0.93);
      ang = L.th0 + delta;
      if (L.swing === 'two-way') lz = sz * 0.03;
    } else if (L.kind === 'slide') {
      // sliding leaves move along ±x by dist; for leaves whose leaf-space is flipped (th0 = π) dir is in door-local terms
      const dx = (L.dir < 0 ? -1 : 1) * L.dist * e;
      lx = L.hx + (rec.type === 'balcony' || rec.type === 'watertight' ? dx : dx);
    }
    _q.setFromAxisAngle(_up, ang); _v.set(lx, 0, lz); _s.set(1, 1, 1);
    out.compose(_v, _q, _s);
    return out;
  }
  function writeRec(rec) {
    const leafMs = rec._lm || (rec._lm = rec.leaves.map(() => new THREE.Matrix4()));
    for (let k = 0; k < rec.leaves.length; k++) leafMatrix(rec, rec.leaves[k], leafMs[k]);
    for (const p of rec.parts) {
      if (p.leaf >= 0) {
        _M.multiplyMatrices(rec.base, leafMs[p.leaf]);
        if (p.scale) { _S.makeScale(rec.leaves[p.leaf].w, 1, 1); _M.multiply(_S); }
        else _M.multiply(p.local);
      } else _M.multiplyMatrices(rec.base, p.local);
      p.b.mesh.setMatrixAt(p.i, _M);
      p.b.dirty = true;
    }
  }
  for (const rec of records) writeRec(rec);
  for (const b of meshes) { b.mesh.instanceMatrix.needsUpdate = true; b.mesh.computeBoundingSphere(); b.mesh.computeBoundingBox?.(); b.dirty = false; }

  // ── LEDs ─────────────────────────────────────────────────────────────
  const _c = new THREE.Color();
  function setLed(rec, state, flashT = 0) {
    if (!rec.led) return;
    rec.ledFlash = flashT > 0 ? T.now + flashT : 0;
    rec.ledFlashState = state;
    applyLed(rec);
  }
  function applyLed(rec) {
    if (!rec.led) return;
    const st = rec.st;
    let s;
    if (rec.ledFlash && T.now < rec.ledFlash) s = rec.ledFlashState;
    else { rec.ledFlash = 0; s = st.forcedOpen || st.lockedState === false ? 'green' : st.lockedState === 'sealed' ? 'amber' : 'red'; }
    if (s === rec.ledState) return;
    rec.ledState = s;
    _c.set(s === 'green' ? 0x22ff55 : s === 'amber' ? 0xffaa10 : s === 'flash' ? 0x55ff88 : s === 'deny' ? 0xff1a10 : 0xc81e14);
    if (s === 'green' || s === 'flash') _c.multiplyScalar(s === 'flash' ? 2.6 : 1.4); else if (s === 'deny') _c.multiplyScalar(3); else _c.multiplyScalar(1.3);
    rec.led.b.mesh.setColorAt(rec.led.i, _c);
    rec.led.b.mesh.instanceColor.needsUpdate = true;
  }
  for (const rec of records) applyLed(rec);
  const ledTimers = new Set();

  // ── state & permissions ───────────────────────────────────────────────
  const active = new Set();      // records currently animating
  const openSet = new Set();     // records with target 1 (auto-close candidates)

  function roleTags(actor) {
    const r = actor && actor.disguise;
    if (!r) return null;
    if (ROLE_ACCESS[r]) return ROLE_ACCESS[r];
    if (typeof r === 'string' && r.startsWith('crew_')) return ['crew'];
    return null;
  }
  function hasCredential(actor, access) {
    if (!access || access === 'none') return true;
    if (!actor) return false;
    const A = actor.access, Kc = actor.keycards;
    const has = (t) => (A && A.has && A.has(t)) || (Kc && Kc.has && Kc.has(t));
    if (has(access)) return true;
    if (access.startsWith('cabin:')) return has('master');
    const tags = roleTags(actor);
    if (tags && tags.includes(access)) return true;
    if (actor.hasAccess && actor !== game.player && actor.hasAccess(access)) return true;
    return false;
  }
  function actorRoom(actor, deck) {
    if (!actor || !Number.isFinite(actor.x)) return -1;
    if (actor.deck != null && actor.deck !== deck) return -1;
    return world.roomId(deck, actor.x, actor.z);
  }
  function canPass(actor, door) {
    const st = door && door.open !== undefined && door.lockedState !== undefined ? door : (door ? world.door(door.deck, door.id) : null);
    if (!st) return false;
    if (st.forcedOpen) return true;
    if (st.ctrl === 'elevator') return st.open >= 0.7;
    if (st.lockedState === 'sealed') return false;
    if (actor && st.inside && actorRoom(actor, st.deck) === st.inside) return true;   // free egress
    if (!st.lockedState) return true;
    const acc = st.access || 'none';
    if (acc === 'none') return hasCredential(actor, 'master') || hasCredential(actor, 'security') || hasCredential(actor, 'officer');
    return hasCredential(actor, acc);
  }
  function reasonFor(actor, door) {
    const st = door.lockedState !== undefined ? door : world.door(door.deck, door.id);
    if (canPass(actor, st)) return '';
    if (st.lockedState === 'sealed') return 'Sealed — lockdown in effect';
    const acc = st.access || 'none';
    if (acc.startsWith('cabin:')) return `Locked — Stateroom ${acc.slice(6)}`;
    if (st.type === 'crew' && plans[st.deck]?.rooms[st.inside]?.type === 'crew_cabin') return 'Locked — crew cabin';
    return REASON[acc] || 'Locked';
  }

  function emitMove(rec, opening) { bus.emit('door:move', { deck: rec.deck, door: rec.id, opening }); }
  function startOpen(rec, actor) {
    const st = rec.st;
    st.lastUse = T.now;
    if (rec.type === 'swing' && actor && Number.isFinite(actor.x) && st.open < 0.05) {
      const [, lz] = toL(rec.dr, actor.x, actor.z);
      st.swing = lz > 0 ? -1 : 1;     // away from the actor
    }
    if (st.target !== 1) { st.target = 1; emitMove(rec, true); }
    active.add(rec); openSet.add(rec);
  }
  function startClose(rec) {
    const st = rec.st;
    if (st.target !== 0) { st.target = 0; emitMove(rec, false); }
    active.add(rec);
  }
  const recOf = (deck, id) => byKey.get(world.doorKey(deck, id));

  function sfx(name, rec, vol = 1) { bus.emit('sfx', { name, x: rec.dr.x, y: rec.y + 1.2, z: rec.dr.z, deck: rec.deck, vol }); }

  function request(deck, id, actor, opts = {}) {
    const rec = recOf(deck, id); if (!rec) return false;
    const st = rec.st;
    if (st.ctrl === 'elevator') return st.open >= 0.7;
    if (!canPass(actor, st)) {
      if (rec.led) { setLed(rec, 'deny', 0.9); ledTimers.add(rec); }
      if (actor === game.player && (rec.led || rec.type === 'cabin')) sfx('keycard_deny', rec, 0.9);
      return false;
    }
    // keycard readers chirp when a credential (not egress / unlocked) was used
    const usedCard = st.lockedState === true && !st.forcedOpen && !(st.inside && actorRoom(actor, deck) === st.inside);
    if (usedCard && rec.led && st.open < 0.05) {
      setLed(rec, 'flash', 2.0); ledTimers.add(rec);
      if (actor === game.player || opts.sfx) sfx('keycard_ok', rec, 0.8);
    }
    startOpen(rec, actor);
    return true;
  }
  function open(deck, id, opts = {}) { const rec = recOf(deck, id); if (!rec || rec.st.ctrl) return false; startOpen(rec, opts.actor || null); if (opts.hold) rec.st.holdOpen = true; return true; }
  function close(deck, id) { const rec = recOf(deck, id); if (!rec || rec.st.ctrl || rec.st.forcedOpen) return false; rec.st.holdOpen = false; startClose(rec); return true; }
  function lock(deck, id, state = true) { const rec = recOf(deck, id); if (!rec) return; rec.st.lockedState = state; if (state && rec.st.forcedOpen) rec.st.forcedOpen = false; applyLed(rec); if (state === 'sealed' && rec.st.target === 1 && !rec.st.ctrl) startClose(rec); }
  function unlock(deck, id) { lock(deck, id, false); }
  function forceOpen(deck, id) {
    const rec = recOf(deck, id); if (!rec || rec.st.ctrl) return false;
    rec.st.forcedOpen = true; rec.st.lockedState = false; startOpen(rec, null); applyLed(rec);
    sfx(rec.type === 'watertight' ? 'metal_hit' : 'thud', rec, 1);
    return true;
  }
  function unlockWith(deck, id, method, actor = game.player) {
    const rec = recOf(deck, id); if (!rec || rec.st.ctrl) return false;
    const st = rec.st;
    if (method === 'card') return request(deck, id, actor, { sfx: true });
    if (method === 'pick') {
      if (st.lockedState === 'sealed') return false;
      st.lockedState = false; applyLed(rec); sfx('lockpick', rec, 0.7); setLed(rec, 'flash', 1.2); ledTimers.add(rec);
      startOpen(rec, actor); return true;
    }
    if (method === 'force') return forceOpen(deck, id);
    return false;
  }
  function isLocked(deck, id) { const st = world.door(deck, id); return !st.forcedOpen && !!st.lockedState; }
  function setPhase(deck, id, p) {
    const rec = recOf(deck, id); if (!rec) return;
    const st = rec.st, np = Math.max(0, Math.min(1, p));
    if (Math.abs(np - st.open) < 1e-4) return;
    st.open = np; st.target = np > 0.5 ? 1 : 0;
    writeRec(rec);
  }

  // ── doorway occupancy ────────────────────────────────────────────────
  function occupied(rec, pad = 0) {
    const dr = rec.dr, st = rec.st;
    const swingDepth = rec.leaves[0]?.kind === 'swing' ? dr.w * 0.95 : 0.55;
    const test = (x, z) => {
      const [lx, lz] = toL(dr, x, z);
      if (Math.abs(lx) > dr.w / 2 + 0.25 + pad) return false;
      const sz = rec.type === 'swing' ? (st.swing || 1) : rec.leaves[0]?.sz ?? 1;
      const depth = (rec.leaves[0]?.kind === 'swing' && Math.sign(lz) === Math.sign(sz)) ? swingDepth : 0.5;
      return Math.abs(lz) < depth + pad;
    };
    const p = game.player;
    if (p && p.deck === rec.deck && p.state !== 'dead' && Number.isFinite(p.x) && test(p.x, p.z)) return true;
    const npcs = game.npcs;
    if (npcs && npcs.query) {
      try { const list = npcs.query(rec.deck, dr.x, dr.z, dr.w / 2 + 1.6); for (const n of list) if (test(n.x, n.z)) return true; } catch {}
    }
    return false;
  }

  // ── glass doors: automatic presence detection ────────────────────────
  const glassByDeck = [];
  for (const rec of records) if (rec.type === 'glass') (glassByDeck[rec.deck] || (glassByDeck[rec.deck] = [])).push(rec);
  function glassSense(rec) {
    const dr = rec.dr, R = 1.8, r2 = (R + dr.w / 2) ** 2;
    const p = game.player;
    if (p && p.deck === rec.deck && Number.isFinite(p.x)) { const dx = p.x - dr.x, dz = p.z - dr.z; if (dx * dx + dz * dz < r2 && distToDoor(rec, p.x, p.z) < R && canPass(p, rec.st)) return p; }
    const npcs = game.npcs;
    if (npcs && npcs.query) {
      try { for (const n of npcs.query(rec.deck, dr.x, dr.z, R + dr.w / 2)) if (distToDoor(rec, n.x, n.z) < R && canPass(n, rec.st)) return n; } catch {}
    }
    return null;
  }
  function distToDoor(rec, x, z) {
    const [lx, lz] = toL(rec.dr, x, z);
    const ax = Math.max(0, Math.abs(lx) - rec.dr.w / 2);
    return Math.hypot(ax, lz);
  }

  // ── player interaction ───────────────────────────────────────────────
  const pickId = (rec) => `door:${rec.deck}:${rec.id}:pick`;
  game.interact?.addProvider((ctx) => {
    const p = ctx.player || game.player; if (!p) return null;
    if (p.state !== 'free') return null;
    const near = world.doorsNear(ctx.deck, ctx.x, ctx.z, 2.4);
    const out = [];
    const fx = Math.sin(ctx.yaw), fz = Math.cos(ctx.yaw);
    for (const { door } of near) {
      const rec = recOf(ctx.deck, door.id); if (!rec || rec.type === 'elevator') continue;
      const dist = distToDoor(rec, ctx.x, ctx.z);
      if (dist > 1.6) continue;
      // in front of the player (not behind)
      const [lx] = toL(rec.dr, ctx.x, ctx.z);
      const cl = Math.max(-rec.dr.w / 2, Math.min(rec.dr.w / 2, lx));
      const [tx, tz] = toW(rec.dr, cl, 0);
      const dx = tx - ctx.x, dz = tz - ctx.z, l = Math.hypot(dx, dz);
      if (l > 0.3 && (dx * fx + dz * fz) / l < -0.15) continue;
      const st = rec.st;
      const base = { x: tx, y: rec.y + 1.2, z: tz, dist, priority: 1 };
      const name = rec.type === 'watertight' ? 'watertight door' : rec.type === 'balcony' ? 'balcony door' : 'door';
      if (rec.type === 'glass') {
        if (canPass(p, st)) continue;   // automatic
        out.push({ ...base, id: `door:${rec.deck}:${rec.id}`, label: 'Automatic door', enabled: false, reason: reasonFor(p, st), run() {} });
        continue;
      }
      if (st.target === 1 || st.open > 0.5) {
        if (st.forcedOpen) continue;
        out.push({ ...base, id: `door:${rec.deck}:${rec.id}`, label: `Close ${name}`, enabled: true, run: () => { st.holdOpen = false; if (!occupied(rec, -0.15)) startClose(rec); else game.bus.emit('ui:toast', { text: 'Something is in the way', kind: 'warn' }); } });
        continue;
      }
      if (canPass(p, st)) {
        out.push({ ...base, id: `door:${rec.deck}:${rec.id}`, label: `Open ${name}`, enabled: true, run: () => request(rec.deck, rec.id, p) });
      } else {
        const reason = reasonFor(p, st);
        const canPick = st.lockedState === true && p.inventory?.has?.('lockpick');
        if (canPick) out.push({ ...base, id: pickId(rec), label: 'Pick lock', enabled: true, hold: 3, crime: { type: 'trespass', severity: 1 }, reason, run: () => unlockWith(rec.deck, rec.id, 'pick', p) });
        else out.push({ ...base, id: `door:${rec.deck}:${rec.id}`, label: `Open ${name}`, enabled: false, reason, run() {} });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, 2);
  }, 'doors');

  // ── system ───────────────────────────────────────────────────────────
  let senseT = 0, closeT = 0, pickSfxT = 0;
  game.addSystem({
    name: 'doors', order: 30,
    update(dt) {
      if (dt <= 0) return;
      T.now += dt;
      const p = game.player, input = game.input;

      // denied attempts (player pressed E on a disabled door prompt) → reader beep + red flash
      const ist = p?.interaction;
      if (ist && ist.best && typeof ist.best.id === 'string' && ist.best.id.startsWith('door:') && input) {
        const parts = ist.best.id.split(':'); const rec = recOf(+parts[1], +parts[2]);
        if (rec && ist.best.enabled === false && input.actionPressed?.('Interact')) request(rec.deck, rec.id, p);
        // lock picking in progress: rhythmic picking clicks
        if (rec && parts[3] === 'pick' && ist.holdT > 0) { pickSfxT -= dt; if (pickSfxT <= 0) { pickSfxT = 0.85; sfx('lockpick', rec, 0.5); } } else if (!ist.holdT) pickSfxT = 0;
      }

      // glass doors: presence sensing (decks near the player / camera)
      senseT -= dt;
      if (senseT <= 0) {
        senseT = 0.1;
        const focusDeck = p?.deck || world.activeDeck || 0;
        for (let d = Math.max(1, focusDeck - 1); d <= focusDeck + 1; d++) {
          const list = glassByDeck[d]; if (!list) continue;
          for (const rec of list) {
            const st = rec.st;
            if (st.lockedState === 'sealed') { if (st.target === 1 && !st.forcedOpen) startClose(rec); continue; }
            const who = glassSense(rec);
            if (who) { if (st.target !== 1) startOpen(rec, who); else st.lastUse = T.now; }
          }
        }
      }

      // animate
      for (const rec of active) {
        const st = rec.st;
        if (st.ctrl) { active.delete(rec); continue; }
        const tgt = st.forcedOpen || st.holdOpen ? 1 : st.target;
        if (tgt === 0 && st.open > 0) {
          // never close onto an actor
          if (occupied(rec)) { st.target = 1; st.lastUse = T.now - (AUTO_CLOSE[rec.type] ?? 3.5) + 1.2; emitMove(rec, true); openSet.add(rec); continue; }
        }
        const rate = 1 / ((tgt > st.open ? OPEN_T[rec.type] : CLOSE_T[rec.type]) || 1);
        const prev = st.open;
        st.open = tgt > st.open ? Math.min(tgt, st.open + rate * dt) : Math.max(tgt, st.open - rate * dt);
        if (st.open !== prev) writeRec(rec);
        if (st.open === tgt) active.delete(rec);
      }

      // auto close
      closeT -= dt;
      if (closeT <= 0) {
        closeT = 0.2;
        for (const rec of openSet) {
          const st = rec.st;
          if (st.target !== 1) { openSet.delete(rec); continue; }
          if (st.forcedOpen || st.holdOpen || st.ctrl) continue;
          const delay = AUTO_CLOSE[rec.type] ?? 3.5;
          if (T.now - st.lastUse < delay) continue;
          if (rec.type === 'glass' && glassSense(rec)) { st.lastUse = T.now; continue; }
          if (occupied(rec)) { st.lastUse = T.now - delay + 0.8; continue; }
          startClose(rec); openSet.delete(rec);
        }
      }

      // LED flash expiry
      if (ledTimers.size) for (const rec of ledTimers) { if (!rec.ledFlash || T.now >= rec.ledFlash) { rec.ledFlash = 0; applyLed(rec); ledTimers.delete(rec); } }

      // upload dirty instance buffers
      for (const b of meshes) if (b.dirty) { b.mesh.instanceMatrix.needsUpdate = true; b.dirty = false; }
    },
  });

  // ── save / load: only doors whose lock state differs from their default (lockdown seals are left to security) ──
  const saveReg = () => game.save?.register?.('doors', {
    save: () => {
      const out = [];
      // doors locked by a security lockdown are saved with their pre-lockdown state (security re-applies the lockdown)
      const pre = new Map(); for (const [d, id, prev] of game.security?.locked?.doors || []) pre.set(world.doorKey(d, id), prev);
      for (const rec of records) {
        const st = rec.st, dr = rec.dr;
        if (st.ctrl) continue;
        const def = dr.type === 'glass' ? (dr.access && dr.access !== 'none' ? true : false) : (dr.access && dr.access !== 'none') ? true : (dr.locked || false);
        const cur = pre.has(world.doorKey(rec.deck, rec.id)) ? pre.get(world.doorKey(rec.deck, rec.id)) : st.lockedState;
        const lk = cur === 'sealed' ? def : cur;
        if (lk !== def || st.forcedOpen) out.push([rec.deck, rec.id, lk, st.forcedOpen ? 1 : 0]);
      }
      return { v: 1, changed: out };
    },
    load: (d) => {
      if (!d || !Array.isArray(d.changed)) return;
      // back to defaults, then apply the differences
      for (const rec of records) {
        const st = rec.st, dr = rec.dr; if (st.ctrl) continue;
        const def = dr.type === 'glass' ? (dr.access && dr.access !== 'none' ? true : false) : (dr.access && dr.access !== 'none') ? true : (dr.locked || false);
        if (st.forcedOpen || (st.lockedState !== def && st.lockedState !== 'sealed')) { st.forcedOpen = false; st.lockedState = def; applyLed(rec); }
      }
      for (const [deck, id, lk, forced] of d.changed) {
        const rec = recOf(deck, id); if (!rec) continue;
        if (forced) forceOpen(deck, id); else { rec.st.lockedState = lk; applyLed(rec); }
      }
    },
  });
  if (game.save) saveReg(); else bus.on('save:ready', saveReg);

  const api = game.doors = {
    canPass, reasonFor, request, open, close, lock, unlock, forceOpen, unlockWith, isLocked, setPhase, hasCredential,
    state: (deck, id) => world.door(deck, id),
    record: recOf, records, materials: M, distToDoor: (deck, id, x, z) => { const r = recOf(deck, id); return r ? distToDoor(r, x, z) : Infinity; },
    occupied: (deck, id) => { const r = recOf(deck, id); return r ? occupied(r) : false; },
    get time() { return T.now; },
  };
  return api;
}
