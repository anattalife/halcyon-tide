// HALCYON TIDE — procedural instanced human characters (NPCs + player).
// One InstancedMesh per body-part geometry, shared by every character. A JS skeleton is solved per
// visible character per frame (pelvis→spine→chest→neck→head, shoulder→upper arm→forearm→hand,
// hip→thigh→shin→foot) from procedural poses (charAnim.js), and part matrices are written straight into
// compacted instance buffers. Per-instance colour zones (4 packed sRGB colours + 3 thresholds against
// a per-vertex zone coordinate) give clothing/skin/hair variety without textures; faces come from a
// small canvas atlas. Materials go through patchSurface so `aInt` interior lighting works.
//
// API: makeAppearance(rng, opts) and class CharacterRenderer — see docs in the task / bottom of file.
import * as THREE from 'three';
import { patchSurface } from '../world/materials.js';
import { makeAppearance as _makeAppearance, ROLES } from './charAppearance.js';
import { buildPartGeometries, makeFaceAtlas, HAIR_LIST, HAT_LIST, PROP_LIST, LEVEL_PROPS, HEAD_C, LOD_PARTS, PONY_TIE, limbRadius, FACE_COLS, FACE_ROWS } from './charGeometry.js';
import {
  ANIMS, DEFAULT_SPEED, LOCO_ANIMS, UPPER_ANIMS, HOLD_OK, POSE_N, stepLength, locomotion, poseFor, holdOverlay, copyLower,
  PX, PY, PZ, RP, RY, RR, SPX, SPY, SPZ, CHX, CHY, CHZ, NKX, NKY, NKZ, HDX, HDY, HDZ, AL, AR, LL, LR, FISTL, FISTR, SKSIT,
} from './charAnim.js';

export { ROLES, ANIMS };
export function makeAppearance(rng, opts = {}) { return _makeAppearance(rng, opts); }

const FADE = 0.2;              // crossfade seconds
const CULL_DIST = 90;
const LOD_DIST = 24;          // beyond this the simplified part set is drawn (hysteresis ±2 m)
const TAU = Math.PI * 2;
const sin = Math.sin, cos = Math.cos;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- material
const VERT_DECL = `
attribute float aV;
attribute float aAO;
attribute vec4 aCol;
attribute vec4 aT;
varying float vV;
varying vec3 vC0; varying vec3 vC1; varying vec3 vC2; varying vec3 vC3;
varying vec4 vT;
varying vec2 vFUV;
varying float vAO;
vec3 htUnpack(float f) {
  float r = floor(f / 65536.0); float g = floor((f - r * 65536.0) / 256.0); float b = f - r * 65536.0 - g * 256.0;
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
`;
const FRAG_DECL = `
varying float vV;
varying float vAO;
varying vec3 vC0; varying vec3 vC1; varying vec3 vC2; varying vec3 vC3;
varying vec4 vT;
varying vec2 vFUV;
#ifdef HT_FACE
uniform sampler2D uFace;
uniform sampler2D uFaceM;
#endif
`;
function makeCharMaterial(opts, key, face = null) {
  const m = new THREE.MeshStandardMaterial({ roughness: opts.roughness ?? 0.78, metalness: opts.metalness ?? 0.0, side: opts.side ?? THREE.FrontSide });
  patchSurface(m, { key: 'ch' + key });
  const prev = m.onBeforeCompile;
  if (face) m.defines = { ...(m.defines || {}), HT_FACE: '' };
  if (opts.hair) m.defines = { ...(m.defines || {}), HT_HAIR: '' };
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    if (face) { sh.uniforms.uFace = { value: face }; sh.uniforms.uFaceM = { value: face.userData.mul }; }
    sh.vertexShader = VERT_DECL + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vV = aV; vT = aT; vFUV = uv; vAO = aAO;
      vC0 = htUnpack(aCol.x); vC1 = htUnpack(aCol.y); vC2 = htUnpack(aCol.z); vC3 = htUnpack(aCol.w);`);
    sh.fragmentShader = FRAG_DECL + sh.fragmentShader.replace('#include <color_fragment>', `
      #ifdef HT_HAIR
      vec3 htc = vC0;
      float hs = 0.86 + 0.14 * sin(vFUV.x * 70.0 + sin(vFUV.y * 7.0 + vFUV.x * 3.0) * 2.5) * sin(vFUV.x * 23.0 - vFUV.y * 5.0);
      htc *= mix(0.62, 1.12, vV) * hs;
      #else
      vec3 htc = vV < vT.x ? vC0 : (vV < vT.y ? vC1 : (vV < vT.z ? vC2 : vC3));
      #endif
      #ifdef HT_FACE
      if (vFUV.x > 0.0 && vFUV.x < 1.0 && vFUV.y > 0.0 && vFUV.y < 1.0) {
        float cell = vT.w; float col = mod(cell, ${FACE_COLS}.0); float row = floor(cell / ${FACE_COLS}.0 + 0.01);
        vec2 fuv = vec2((col + vFUV.x) / ${FACE_COLS}.0, (${FACE_ROWS - 1}.0 - row + vFUV.y) / ${FACE_ROWS}.0);
        htc *= texture2D(uFaceM, fuv).rgb;
        vec4 fc = texture2D(uFace, fuv);
        htc = mix(htc, fc.rgb, fc.a);
      }
      #endif
      diffuseColor.rgb *= htc * vAO;`);
  };
  m.customProgramCacheKey = () => 'htchar2' + key + (face ? 'F' : '') + (opts.hair ? 'H' : '');
  return m;
}

// ---------------------------------------------------------------- part table
// Each part: geometry key, material key, cap (instances per character max).
function packColor(hex) { return (hex >>> 0) & 0xffffff; }
const BIG = 9;

class PartMesh {
  constructor(geo, mat, cap, scene, shadow = true) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow; this.mesh.receiveShadow = true;
    this.mat = this.mesh.instanceMatrix.array;
    this.colA = new Float32Array(cap * 4); this.tA = new Float32Array(cap * 4); this.iA = new Float32Array(cap);
    this.col = new THREE.InstancedBufferAttribute(this.colA, 4); this.col.setUsage(THREE.DynamicDrawUsage);
    this.thr = new THREE.InstancedBufferAttribute(this.tA, 4); this.thr.setUsage(THREE.DynamicDrawUsage);
    this.int = new THREE.InstancedBufferAttribute(this.iA, 1); this.int.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCol', this.col); geo.setAttribute('aT', this.thr); geo.setAttribute('aInt', this.int);
    this.n = 0;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  // push an instance: rotation columns (r: 9 numbers via R array), scale sx,sy,sz, position, colour block
  push(R, sx, sy, sz, x, y, z, cs, inten) {
    if (this.n >= this.cap) return;
    const i = this.n++, m = this.mat, o = i * 16;
    m[o] = R[0] * sx; m[o + 1] = R[1] * sx; m[o + 2] = R[2] * sx; m[o + 3] = 0;
    m[o + 4] = R[3] * sy; m[o + 5] = R[4] * sy; m[o + 6] = R[5] * sy; m[o + 7] = 0;
    m[o + 8] = R[6] * sz; m[o + 9] = R[7] * sz; m[o + 10] = R[8] * sz; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    const c = this.colA, t = this.tA, q = i * 4;
    c[q] = cs[0]; c[q + 1] = cs[1]; c[q + 2] = cs[2]; c[q + 3] = cs[3];
    t[q] = cs[4]; t[q + 1] = cs[5]; t[q + 2] = cs[6]; t[q + 3] = cs[7];
    this.iA[i] = inten;
  }
  end() {
    const n = this.n, mesh = this.mesh;
    mesh.count = n; mesh.visible = n > 0;
    if (n > 0) {
      const im = mesh.instanceMatrix; im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
      this.col.clearUpdateRanges(); this.col.addUpdateRange(0, n * 4); this.col.needsUpdate = true;
      this.thr.clearUpdateRanges(); this.thr.addUpdateRange(0, n * 4); this.thr.needsUpdate = true;
      this.int.clearUpdateRanges(); this.int.addUpdateRange(0, n); this.int.needsUpdate = true;
    }
  }
}

// colour-set helper: [c0,c1,c2,c3,t1,t2,t3,extra]
function cset(c0, t1 = BIG, c1 = 0, t2 = BIG, c2 = 0, t3 = BIG, c3 = 0, extra = 0) {
  return [packColor(c0), packColor(c1), packColor(c2), packColor(c3), t1, t2, t3, extra];
}

// ---------------------------------------------------------------- per-character derived data
function deriveBody(ap) {
  const H = ap.height, child = ap.age === 'child', fem = ap.sex === 'f';
  const g = ap.build;
  const k = H / 1.75;
  const headS = child ? Math.pow(H / 1.75, 0.38) : Math.pow(k, 0.45) * (fem ? 0.96 : 1);
  const legFrac = child ? lerp(0.45, 0.5, clamp((H - 1.0) / 0.4, 0, 1)) : (fem ? 0.515 : 0.517);
  const ankleH = 0.075 * Math.pow(k, 0.7);
  const hip = legFrac * H;
  const legL = hip - ankleH;
  const thighL = legL * 0.505, shinL = legL * 0.495;
  const headTop = 0.218 * headS;
  const ts = (H - hip - headTop) / 0.63;
  const wk = child ? Math.pow(k, 1.15) : Math.pow(k, 0.75);
  const shW = 0.178 * wk * (fem ? 0.9 : 1) * (0.92 + 0.08 * g);
  const hipW = 0.088 * wk * (fem ? 1.06 : 1) * (0.94 + 0.06 * g);
  return {
    k, headS, ts, thighL, shinL, ankleH, hipW, shW, hipStand: hip,
    chestSX: wk * (fem ? 0.9 : 1) * g, chestSZ: wk * g * (fem ? 0.95 : 1),
    bellySX: wk * (fem ? 0.92 : 1) * g * g, bellySZ: wk * Math.pow(g, 2.3) * (fem ? 0.92 : 1),
    pelSX: wk * (fem ? 1.08 : 1) * g, pelSZ: wk * g * (fem ? 1.05 : 1),
    neckS: wk * (fem ? 0.85 : 1) * Math.sqrt(g),
    armG: wk * Math.pow(g, 0.8) * (fem ? 0.86 : 1), legG: wk * Math.pow(g, 0.8) * (fem ? 1.0 : 1),
    L1: 0.30 * k * (child ? 0.95 : 1), L2: 0.255 * k * (child ? 0.95 : 1), handS: (child ? 0.8 : fem ? 0.9 : 1.0) * Math.pow(k, 0.6),
    footS: (child ? 0.75 : fem ? 0.9 : 1.0) * Math.pow(k, 0.7),
    gait: ap.gait ?? 0.5, elderly: ap.age === 'elderly', female: fem, child, build: g,
  };
}

function hashR(seed) {
  const r = []; let s = (seed >>> 0) || 1;
  for (let i = 0; i < 10; i++) { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; r.push((s >>> 8) / 16777216); }
  return r;
}

// Builds colour sets per body zone for an appearance
function deriveLook(ap, body) {
  const o = ap.outfit, a = ap.acc || {}, skin = ap.skin;
  const L = {};
  const rr = hashR(((ap.seed ?? 1) ^ 0x2545f491) >>> 0);
  const top = o.topColor, top2 = o.top2 ?? top, bot = o.bottomColor;
  const sleeveC = o.sleeveColor ?? top;
  // torso zone v: 0 neck … ~0.62 bottom of chest … 1 waist
  const neckV = o.neck === 'bare' ? 0.205 : o.neck === 'open' ? 0.07 : o.neck === 'high' ? -1 : 0.035;
  let chest;
  if (o.bareTorso && o.bikiniTop != null) chest = cset(skin, 0.22, o.bikiniTop, 0.42, skin);
  else if (o.bareTorso) chest = cset(skin);
  else if (o.top === 'swimsuit') chest = cset(skin, 0.15, top);
  else if (o.chestBand != null) chest = cset(skin, neckV, top, 0.31, o.chestBand, 0.36, top);
  else if (o.top === 'waistcoat') chest = cset(skin, neckV, top2, 0.24, top);  // shirt V shown by placket acc; collar of shirt
  else if (o.top === 'suit' || o.top === 'officer_jacket' || o.top === 'stage_jacket' || o.top === 'jacket' || o.top === 'medic_coat') chest = cset(skin, neckV, top);
  else chest = cset(skin, neckV, top);
  L.chest = chest;
  L.belly = chest;
  // pelvis v: 0 waist … 1 crotch
  const tucked = /suit|officer|security|white_jacket|waistcoat|chef|coverall|tunic|medic|stage|jacket|gown|sequin/.test(o.top) || o.legs === 'dress';
  const bottomC = o.legs === 'dress' ? bot : bot;
  if (o.legs === 'bikini') L.pelvis = cset(skin, 0.42, bot);
  else if (o.top === 'swimsuit') L.pelvis = cset(top);
  else if (o.legs === 'swim') L.pelvis = cset(bot);
  else if (o.legs === 'dress') L.pelvis = cset(bot);
  else if (o.top === 'coverall') L.pelvis = cset(top);
  else if (!tucked && !o.bareTorso) L.pelvis = cset(top, 0.3, bottomC);
  else if (o.belt == null && a.belt == null && o.legs === 'trousers' && !/suit|gown|chef|medic|coverall/.test(o.top) && rr[5] < 0.7) L.pelvis = cset(0x2a1c14, 0.1, bottomC);
  else if (o.belt != null || a.belt != null) L.pelvis = cset(o.belt ?? a.belt, 0.1, bottomC);
  else if (o.bareTorso) L.pelvis = cset(bottomC);
  else L.pelvis = cset(0x1d1a18, 0.08, bottomC);
  if (o.bareTorso && o.legs === 'shorts') L.pelvis = cset(bottomC);
  // arms: upper arm covers sleeve 0..0.45, forearm 0.45..1
  const sl = o.bareTorso || o.top === 'swimsuit' || o.top === 'bikini' ? -1 : o.sleeve;
  const gl = a.gloves ?? null;
  L.uarm = sl <= 0 ? cset(skin) : cset(sleeveC, sl >= 0.45 ? BIG : sl / 0.45, skin);
  if (o.top === 'tank' || o.top === 'gown' || o.top === 'sequin_dress' || (o.legs === 'dress' && sl <= 0.01)) L.uarm = cset(skin);
  L.farm = sl <= 0.45 ? cset(skin) : cset(sleeveC, (sl - 0.45) / 0.55 + (sl > 0.95 ? 0.2 : 0), skin);
  L.hand = gl != null ? cset(gl) : cset(skin);
  // sleeve hem band where cloth meets skin (upper arm 0..0.45 of the sleeve, forearm 0.45..1)
  L.cuffA = null;
  if (sl > 0.05 && sl < 0.97) {
    const onUpper = sl < 0.45, t = onUpper ? Math.max(0.15, sl / 0.45) : (sl - 0.45) / 0.55;
    const lr = limbRadius(onUpper ? 'upperArm' : 'forearm', Math.min(0.98, t));
    L.cuffA = { lim: onUpper ? 0 : 1, t, rx: lr[0], rz: lr[1], cx: 0, cz: lr[2], c: cset(sleeveC), w: onUpper ? 0.035 : 0.025 };
    if (o.top === 'tank' || o.top === 'gown' || o.top === 'sequin_dress' || (o.legs === 'dress' && sl <= 0.01)) L.cuffA = null;
  }
  // legs (thigh/shin v 0 proximal → 1 distal)
  const legs = o.legs;
  let shortLen = o.shortsLen ?? 0.45;
  if (legs === 'trousers') { L.thigh = cset(bot); L.shin = cset(bot); }
  else if (legs === 'capri') { L.thigh = cset(bot); L.shin = cset(bot, 0.55, skin); }
  else if (legs === 'shorts') { L.thigh = cset(bot, shortLen + 0.1, skin); L.shin = o.socks != null ? cset(skin, 0.78, o.socks) : cset(skin); }
  else if (legs === 'swim') { L.thigh = cset(bot, 0.28, skin); L.shin = cset(skin); }
  else if (legs === 'bikini' || legs === 'swimsuit') { L.thigh = cset(skin); L.shin = cset(skin); }
  else { // skirt / dress — legs bare (or tights for uniform skirts)
    const tights = /crew|officer|captain|security|croupier/.test(ap.role) ? 0x2a2420 : null;
    L.thigh = tights != null ? cset(mixHex(skin, tights, 0.6)) : cset(skin);
    L.shin = L.thigh;
  }
  L.cuffL = null;
  if (legs === 'shorts' || legs === 'swim') { const t = Math.min(0.95, legs === 'swim' ? 0.28 : shortLen + 0.1); const lr = limbRadius('thigh', t); L.cuffL = { lim: 2, t, rx: lr[0], rz: lr[1], cx: 0, cz: lr[2], c: cset(bot), w: 0.03 }; }
  else if (legs === 'capri') { const lr = limbRadius('shin', 0.55); L.cuffL = { lim: 3, t: 0.55, rx: lr[0], rz: lr[1], cx: 0, cz: lr[2], c: cset(bot), w: 0.03 }; }
  else if (legs === 'trousers') { const lr = limbRadius('shin', 0.97); L.cuffL = { lim: 3, t: 0.96, rx: lr[0] * 1.1, rz: lr[1] * 1.12, cx: 0, cz: lr[2], c: cset(bot), w: 0.03 }; }
  // shoes v 0 top … 1 sole
  const shoe = o.shoeColor, sole = o.sole ?? 0x2a2a2a;
  if (o.shoes === 'sandals') L.shoe = cset(skin, 0.6, shoe, 0.85, sole);
  else if (legs === 'bikini' || legs === 'swim' || legs === 'swimsuit') L.shoe = cset(skin, 0.6, shoe, 0.85, sole);
  else L.shoe = cset(o.socks ?? (legs === 'trousers' ? bot : skin), 0.02, shoe, 0.84, sole);
  L.boot = o.shoes === 'boots';
  // head + face
  const faceVar = ap.faceVar ?? Math.floor(rr[0] * 4);
  L.head = cset(skin, BIG, 0, BIG, 0, BIG, 0, (ap.face ?? 0) * 4 + faceVar);
  L.femHead = ap.sex === 'f' || ap.age === 'child';
  L.headW = 0.97 + rr[1] * 0.07;
  L.neck = cset(skin);
  L.hair = cset(liftHair(ap.hair.color));
  let hs = ap.hair.style;
  if (hs === 'short' && ap.sex === 'm' && ap.age !== 'child' && rr[2] < 0.4) hs = 'side_part';
  if (hs === 'long' && rr[3] < 0.3) hs = 'bangs';
  if (hs === 'short' && ap.sex === 'f') hs = 'pixie';
  L.hairStyle = HAIR_LIST.includes(hs) ? hs : null;
  L.pony = hs === 'ponytail';
  L.hairS = 1 + rr[4] * 0.04;
  if (o.hat && o.hat !== 'none' && HAT_LIST.includes(o.hat)) {
    L.hat = o.hat;
    L.hatC = cset(o.hatColor ?? 0xffffff, 0.3, o.hatColor2 ?? 0x111111, 0.7, o.hatColor2 ?? 0x111111, BIG, o.hat === 'security_cap' ? 0xd0d4da : 0xc9a23a);
    if (o.hat === 'ball_cap' || o.hat === 'visor' || o.hat === 'sun_hat' || o.hat === 'beanie') L.hatC = cset(o.hatColor, 0.3, mixHex(o.hatColor, 0xffffff, 0.15), 0.7, o.hatColor2 ?? o.hatColor);
    if (o.hat === 'chef_hat') L.hatC = cset(0xffffff);
    // caps hide hair crown: keep short hair under hats (bun/ponytail ok)
    if (L.hairStyle === 'afro' || L.hairStyle === 'curly' || L.hairStyle === 'side_part') L.hairStyle = 'short';
    if (L.hairStyle === 'bangs') L.hairStyle = 'long';
    if (o.hat === 'chef_hat' && L.hairStyle !== 'bun') { L.hairStyle = L.hairStyle ? 'crew' : null; L.pony = false; }
  }
  // skirt / dress / hem
  L.skirt = null;
  if (legs === 'skirt' || legs === 'dress') {
    L.skirt = { len: o.skirtLen || 0.5, flare: o.skirtFlare || 1, c: cset(bot) };
    if (ap.acc?.sparkle) L.skirt.c = cset(bot);
  }
  L.tail = o.hem ? { len: o.hem.len, c: cset(o.hem.color ?? top) } : null;
  // accessories
  const acc = [];
  if (o.neck === 'collar' && !o.bareTorso) acc.push(['collar', 'chest', cset(o.top === 'waistcoat' || o.top === 'suit' || o.top === 'officer_jacket' || o.top === 'stage_jacket' ? top2 : top)]);
  if (o.neck === 'high') acc.push(['collar_high', 'chest', cset(top)]);
  if ((o.top === 'suit' || o.top === 'waistcoat' || o.top === 'officer_jacket' || o.top === 'stage_jacket' || o.top === 'jacket') && !o.bareTorso)
    acc.push(['placket', 'chest', cset(top2 === top ? 0xf3f2ee : top2)]);
  if (a.tie != null) acc.push(['tie', 'chest', cset(a.tie)]);
  if (a.bowtie != null) acc.push(['bowtie', 'chest', cset(a.bowtie)]);
  if (a.epaulettes) acc.push(['epaulette', 'chest', cset(a.epaulettes.color, 0.3, a.epaulettes.gold)]);
  if (a.radio) acc.push(['radio_chest', 'chest', cset(a.radio)]);
  if (a.badge != null) acc.push(['badge', 'chest', cset(a.badge)]);
  if (a.glasses != null) acc.push([o.top === 'bare' || o.legs === 'swim' || o.legs === 'bikini' || o.top === 'swimsuit' || o.top === 'coverup' || ap.role === 'lifeguard' ? 'sunglasses' : 'glasses', 'head', cset(a.glasses)]);
  if (a.necklace != null && (o.neck === 'bare' || o.neck === 'open')) acc.push(['necklace', 'chest', cset(a.necklace)]);
  const btn = /shirt|polo|officer_shirt|security_shirt|white_jacket|medic_coat|chef_jacket|tunic|cardigan|blouse/.test(o.top) && !o.bareTorso;
  if (btn || a.buttons != null) acc.push(['buttons', 'chest', cset(a.buttons ?? (o.top === 'chef_jacket' ? 0x222222 : mixHex(top, 0xffffff, 0.35)))]);
  const beltC = o.belt ?? a.belt ?? (o.legs === 'trousers' && !/coverall|suit|gown|chef|medic/.test(o.top) && !o.bareTorso && rr[5] < 0.7 ? 0x2a1c14 : null);
  if (beltC != null && o.legs !== 'dress' && o.top !== 'coverall' && !(o.hem && o.hem.len > 0.25)) acc.push(['buckle', 'pelvis', cset(0xb8a070)]);
  if (ap.role === 'security' || a.belt != null && ap.role === 'security') acc.push(['belt_kit', 'pelvis', cset(0x0c0c0c)]);
  L.apron = a.apron ? { len: a.apron.len, c: cset(a.apron.color) } : null;
  L.acc = acc;
  return L;
}
// very dark hair reads as a black hole in-game: lift its floor so strands and sheen stay visible
function liftHair(c) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, l = 0.3 * r + 0.59 * g + 0.11 * b;
  if (l >= 44) return c;
  const k = (44 - l) / 44;
  return (Math.round(r + (58 - r) * k * 0.75) << 16) | (Math.round(g + (46 - g) * k * 0.75) << 8) | Math.round(b + (38 - b) * k * 0.75);
}
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}

const PROP_COLORS = {
  pistol: cset(0x1b1c1f, 0.3, 0x2a2b2f, 0.7, 0x111111), taser: cset(0x1b1c1f, 0.3, 0xf2c21b, 0.7, 0x222222), baton: cset(0x111214, 0.3, 0x2b2b2b),
  tray: cset(0xdfe6ee, 0.3, 0xc0c4c8, 0.7, 0xd88a30), drink: cset(0xdde8ee, 0.3, 0xd8902a), phone: cset(0x16181c), radio: cset(0x1d1f22),
  camera: cset(0x1a1a1c, 0.3, 0x2e2f33), luggage: cset(0x2e3e5c, 0.3, 0x9aa0a6), mop: cset(0x2f6fb0, 0.3, 0xe8e2d0), extinguisher: cset(0xc81e1e, 0.3, 0x1b1b1b),
};
// rough colour variety for luggage
const LUGGAGE_C = [0x2e3e5c, 0x8a1c24, 0x1d1d22, 0x3c6a4c, 0xb07a2a, 0x6b6f78];

// ---------------------------------------------------------------- math scratch
const R0 = new Float64Array(9), RP_ = new Float64Array(9), RS = new Float64Array(9), RC = new Float64Array(9), RN = new Float64Array(9), RH = new Float64Array(9);
const RA = new Float64Array(9), RB = new Float64Array(9), RW = new Float64Array(9), RT = new Float64Array(9), RK = new Float64Array(9), RF = new Float64Array(9), RX = new Float64Array(9);
function rotY(o, a) { const c = cos(a), s = sin(a); o[0] = c; o[1] = 0; o[2] = -s; o[3] = 0; o[4] = 1; o[5] = 0; o[6] = s; o[7] = 0; o[8] = c; }
function copy9(o, a) { for (let i = 0; i < 9; i++) o[i] = a[i]; }
// post-multiply by axis rotations (R = R·Rx(a) etc.)
function mx(R, a) { if (a === 0) return; const c = cos(a), s = sin(a); for (let i = 0; i < 3; i++) { const y = R[3 + i], z = R[6 + i]; R[3 + i] = y * c + z * s; R[6 + i] = -y * s + z * c; } }
function my(R, a) { if (a === 0) return; const c = cos(a), s = sin(a); for (let i = 0; i < 3; i++) { const x = R[i], z = R[6 + i]; R[i] = x * c - z * s; R[6 + i] = x * s + z * c; } }
function mz(R, a) { if (a === 0) return; const c = cos(a), s = sin(a); for (let i = 0; i < 3; i++) { const x = R[i], y = R[3 + i]; R[i] = x * c + y * s; R[3 + i] = -x * s + y * c; } }
// p_out = p + R·(x,y,z)
function tp(out, p, R, x, y, z) { out[0] = p[0] + R[0] * x + R[3] * y + R[6] * z; out[1] = p[1] + R[1] * x + R[4] * y + R[7] * z; out[2] = p[2] + R[2] * x + R[5] * y + R[8] * z; }

const vP = [0, 0, 0], vS = [0, 0, 0], vC = [0, 0, 0], vN = [0, 0, 0], vH = [0, 0, 0], vSh = [0, 0, 0], vE = [0, 0, 0], vW = [0, 0, 0];
const vHip = [0, 0, 0], vK = [0, 0, 0], vA = [0, 0, 0], vT = [0, 0, 0], vRoot = [0, 0, 0];

// ---------------------------------------------------------------- renderer
export class CharacterRenderer {
  constructor(scene, { max = 220, materials = null, camera = null } = {}) {
    this.scene = scene; this.max = max; this.camera = camera;
    this.group = new THREE.Group(); this.group.name = 'characters'; scene.add(this.group);
    const G = this.geos = buildPartGeometries();
    this.face = makeFaceAtlas();
    const mats = this.mats = {
      body: materials?.body || makeCharMaterial({ roughness: 0.8 }, 'b'),
      skin: makeCharMaterial({ roughness: 0.62 }, 's', this.face),
      hair: makeCharMaterial({ roughness: 0.5, metalness: 0.0, hair: true }, 'h'),
      cloth2: makeCharMaterial({ roughness: 0.85, side: THREE.DoubleSide }, 'c2'),
      prop: makeCharMaterial({ roughness: 0.35, metalness: 0.45 }, 'p'),
    };
    const P = this.parts = {};
    const add = (name, geoKey, mat, perChar, shadow = true) => {
      P[name] = new PartMesh(G[geoKey], mat, max * perChar, this.group, shadow);
      // far-LOD twin (no shadow casting: at > 24 m the shadow detail is invisible)
      if (G[geoKey + '_L']) P[name + '_L'] = new PartMesh(G[geoKey + '_L'], mat, max * perChar, this.group, false);
    };
    add('head_m', 'head_m', mats.skin, 1); add('head_f', 'head_f', mats.skin, 1); add('neck', 'neck', mats.body, 1);
    add('chest_m', 'chest_m', mats.body, 1); add('chest_f', 'chest_f', mats.body, 1); add('belly', 'belly', mats.body, 1); add('pelvis', 'pelvis', mats.body, 1);
    add('upperArm', 'upperArm', mats.body, 2); add('forearm', 'forearm', mats.body, 2);
    add('hand', 'hand', mats.body, 1); add('fist', 'fist', mats.body, 1); add('handL', 'handL', mats.body, 1); add('fistL', 'fistL', mats.body, 1);
    add('thigh', 'thigh', mats.body, 2); add('shin', 'shin', mats.body, 2); add('shoe', 'shoe', mats.body, 2); add('boot', 'boot', mats.body, 2);
    add('skirt', 'skirt', mats.cloth2, 1); add('tail', 'tail', mats.cloth2, 1); add('apron', 'acc_apron', mats.cloth2, 1, false);
    for (const h of HAIR_LIST) add('hair_' + h, 'hair_' + h, mats.hair, 1);
    add('ptail', 'ptail', mats.hair, 1);
    for (const h of HAT_LIST) add('hat_' + h, 'hat_' + h, mats.body, 1);
    for (const a of ['collar', 'collar_high', 'placket', 'buttons', 'buckle', 'necklace', 'tie', 'bowtie', 'epaulette', 'radio_chest', 'badge', 'glasses', 'sunglasses', 'belt_kit'])
      add('acc_' + a, 'acc_' + a, a === 'placket' ? mats.cloth2 : a === 'necklace' || a === 'buckle' || a === 'sunglasses' ? mats.prop : mats.body, 1, a !== 'placket' && a !== 'badge' && a !== 'glasses' && a !== 'buttons' && a !== 'necklace' && a !== 'buckle');
    add('cuff', 'acc_cuff', mats.body, 4, false);
    for (const p of PROP_LIST) add('prop_' + p, 'prop_' + p, mats.prop, 1, true);
    // per-LOD lookup: far set falls back to the near mesh where no simplified twin exists
    this.P0 = {}; this.P1 = {};
    for (const k in P) { if (k.endsWith('_L')) continue; this.P0[k] = P[k]; this.P1[k] = P[k + '_L'] || P[k]; }
    this.partList = Object.values(P);
    this.chars = new Array(max).fill(null);
    this.free = []; for (let i = max - 1; i >= 0; i--) this.free.push(i);
    this._n = 0;
    this.time = 0;
    this.stats = { visible: 0, ms: 0 };
  }

  get count() { return this._n; }

  add(appearance) {
    if (!this.free.length) { console.warn('[characters] capacity reached'); return -1; }
    const id = this.free.pop();
    const c = {
      id, ap: null, body: null, look: null, r: null,
      st: { x: 0, y: 0, z: 0, yaw: 0, anim: 'idle', speed: 0, interior: 0, visible: true, held: 'none', aim: 0, look: 0, alpha: 1 },
      anim: 'idle', animT: 0, clock: 0, phase: 0, fadeT: 1, from: new Float32Array(POSE_N), pose: new Float32Array(POSE_N), tmp: new Float32Array(POSE_N),
      holdW: 0, lookS: 0, culled: false, lod: 0, swing: 0, swingV: 0, swingS: 0, swingSV: 0,
      head: [0, 1.6, 0], hand: [0, 1, 0], chest: [0, 1.3, 0], pelvis: [0, 0.9, 0], ankL: [0, 0, 0], ankR: [0, 0, 0],
      lugC: 0,
    };
    this.chars[id] = c; this._n++;
    this.setAppearance(id, appearance || makeAppearance({ next: Math.random, range: (a, b) => a + Math.random() * (b - a), int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)), pick: a => a[Math.floor(Math.random() * a.length)], chance: p => Math.random() < p, weighted: e => e[0][0] }));
    c.clock = c.r[9] * 50;
    c.phase = c.r[8];
    return id;
  }

  remove(id) { if (this.chars[id]) { this.chars[id] = null; this.free.push(id); this._n--; } }

  setAppearance(id, ap) {
    const c = this.chars[id]; if (!c) return;
    c.ap = ap; c.body = deriveBody(ap); c.look = deriveLook(ap, c.body);
    c.r = hashR((ap.seed ?? id * 7919) ^ 0x5bd1e995);
    c.body.r = c.r; c.body.idleStyle = ap.role === 'security' || ap.role === 'crew_officer' || ap.role === 'captain' ? (c.r[4] < 0.5 ? 1 : 0)
      : c.r[4] < 0.5 ? 0 : c.r[4] < 0.6 ? 1 : c.r[4] < 0.7 ? 2 : c.r[4] < 0.8 ? 3 : c.r[4] < 0.9 ? 4 : (ap.outfit?.legs === 'dress' || ap.outfit?.legs === 'skirt' || ap.outfit?.legs === 'bikini' || ap.outfit?.legs === 'swim' ? 4 : 5);
    if (ap.age === 'child') c.body.idleStyle = 0;
    c.lugC = packColor(LUGGAGE_C[Math.floor(c.r[6] * LUGGAGE_C.length)]);
  }

  set(id, s) {
    const c = this.chars[id]; if (!c) return;
    const st = c.st;
    for (const k in s) st[k] = s[k];
    if (s.anim !== undefined && !ANIMS.includes(st.anim)) st.anim = 'idle';
  }

  get(id) { return this.chars[id]?.st; }
  setCamera(cam) { this.camera = cam; }

  // ------------------------------------------------------------ update
  update(dt) {
    const t0 = performance.now();
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const cam = this.camera || (typeof window !== 'undefined' && window.__game?.camera) || null;
    let cx = 0, cy = 0, cz = 0, hasCam = false;
    if (cam) { cam.updateMatrixWorld?.(); const e = cam.matrixWorld.elements; cx = e[12]; cy = e[13]; cz = e[14]; hasCam = true; }
    for (const p of this.partList) p.begin();
    let vis = 0;
    for (let i = 0; i < this.max; i++) {
      const c = this.chars[i]; if (!c) continue;
      const st = c.st;
      this._animate(c, dt);
      const dx = st.x - cx, dy = st.y - cy, dz = st.z - cz;
      c.culled = !st.visible || (st.alpha !== undefined && st.alpha < 0.05) || (hasCam && dx * dx + dy * dy + dz * dz > CULL_DIST * CULL_DIST);
      if (c.culled) { this._approx(c); continue; }
      const d2 = dx * dx + dy * dy + dz * dz; c.d2 = hasCam ? d2 : 0;
      c.lod = c.lod ? (d2 > (LOD_DIST - 2) * (LOD_DIST - 2) ? 1 : 0) : (d2 > (LOD_DIST + 2) * (LOD_DIST + 2) ? 1 : 0);
      if (!hasCam) c.lod = 0;
      this._pose(c);
      this._emit(c);
      vis++;
    }
    for (const p of this.partList) p.end();
    this.stats.visible = vis;
    this.stats.ms = performance.now() - t0;
  }

  _animate(c, dt) {
    const st = c.st;
    let want = st.anim || 'idle';
    let spd = st.speed ?? DEFAULT_SPEED[want] ?? 0;
    if (st.speed === undefined || st.speed === null) spd = DEFAULT_SPEED[want] ?? 0;
    if (LOCO_ANIMS.has(want) && spd < 0.08) want = want === 'crouch_walk' ? 'crouch_idle' : 'idle';
    if (want !== c.anim) {
      c.from.set(c.pose);
      c.fadeT = 0; c.anim = want; c.animT = 0;
    }
    c.animT += dt; c.clock += dt; c.fadeT = Math.min(1, c.fadeT + dt / FADE);
    c.spd = spd;
    // gait phase: froude-scaled stride
    if (spd > 0.05) {
      const k = c.body.hipStand / 0.905;
      const vr = spd / Math.sqrt(k);
      let step = stepLength(vr) * k;
      if (want === 'crouch_walk') step *= 0.75;
      if (c.look.skirt && c.look.skirt.len > 0.8 && spd < 2.5) step *= 0.85; // long gowns: shorter steps
      if (want === 'drag' || want === 'stagger') step = 0.32 * k;
      c.step = step;
      c.phase = (c.phase + dt * spd / (2 * step)) % 1;
    }
    const held = st.held && st.held !== 'none' ? st.held : null;
    const hw = held && HOLD_OK.has(c.anim) ? 1 : 0;
    c.holdW += (hw - c.holdW) * Math.min(1, dt * 8);
    c.lookS += ((st.look || 0) - c.lookS) * Math.min(1, dt * 6);
    if (c.look.pony && dt > 0) {
      const sp = c.spd || 0, ph = c.phase;
      const tgtB = Math.min(0.5, sp * 0.09) + (sp > 0.1 ? 0.07 * Math.abs(Math.sin(TAU * ph)) : 0.02 * Math.sin(c.clock * 1.3));
      const tgtS = sp > 0.1 ? 0.16 * Math.min(1, sp / 2) * Math.sin(TAU * ph) : 0.04 * Math.sin(c.clock * 0.9 + c.r[2] * 5);
      const yawV = (st.yaw - (c._py ?? st.yaw)); c._py = st.yaw;
      c.swingV += ((tgtB - c.swing) * 60 - c.swingV * 7) * dt; c.swing += c.swingV * dt;
      c.swingSV += ((tgtS - c.swingS) * 50 - c.swingSV * 6) * dt - clamp(yawV, -0.3, 0.3) * 6; c.swingS += c.swingSV * dt;
      c.swingS = clamp(c.swingS, -0.7, 0.7); c.swing = clamp(c.swing, -0.3, 0.9);
    }
  }

  _computePose(c, P) {
    const b = c.body, st = c.st, a = c.anim, t = c.clock;
    const moving = c.spd > 0.1;
    if (LOCO_ANIMS.has(a)) {
      const kind = a === 'run' ? 'run' : a === 'sprint' || a === 'flee' ? 'sprint' : a === 'crouch_walk' ? 'crouch_walk' : 'walk';
      locomotion(P, b, kind, c.phase, c.step || 0.7, t, a === 'drag' ? -1 : 1);
      if (a === 'flee') { // arms flailing up near the head
        const s = sin(TAU * c.phase);
        P[AL + 2] = 1.9 + 0.3 * s; P[AL + 3] = 0.5; P[AL + 5] = 1.9; P[AR + 2] = 1.9 - 0.3 * s; P[AR + 3] = 0.5; P[AR + 5] = 1.9;
        P[HDX] = 0.15; P[SPX] += 0.1;
      } else if (a === 'drag') {
        P[RP] = -0.05; P[SPX] = 0.35; P[CHX] = 0.2; P[HDX] = -0.2; P[PY] -= 0.08;
        P[AL + 2] = 0.9; P[AL + 3] = 0.1; P[AL + 5] = 0.3; P[AR + 2] = 0.9; P[AR + 3] = 0.1; P[AR + 5] = 0.3; P[FISTL] = P[FISTR] = 1;
      } else if (a === 'stagger') {
        const w = sin(t * 2.3) * 0.12 + sin(t * 3.7) * 0.06;
        P[RR] += w; P[SPZ] += w * 1.5; P[HDX] += 0.25; P[SPX] += 0.25; P[HDZ] -= w;
        P[AL + 3] += 0.35 + w; P[AR + 3] += 0.35 - w; P[AL + 5] = 0.6; P[AR + 5] = 0.6;
      }
      return;
    }
    poseFor(P, a, b, t, st, c.animT);
    if (moving && UPPER_ANIMS.has(a) && a !== 'idle') {
      const T = c.tmp;
      locomotion(T, b, c.spd > 2.6 ? 'run' : 'walk', c.phase, c.step || 0.7, t, 1);
      copyLower(P, T, 1);
    }
  }

  _pose(c) {
    const P = c.pose;
    this._computePose(c, P);
    if (c.holdW > 0.001) holdOverlay(P, c.st.held, c.holdW, c.clock, c.spd > 0.1);
    if (c.fadeT < 1) {
      const w = c.fadeT * c.fadeT * (3 - 2 * c.fadeT), F = c.from;
      for (let i = 0; i < POSE_N; i++) P[i] = F[i] + (P[i] - F[i]) * w;
    }
  }

  // approximate anchor points for culled characters (no skeleton solve)
  _approx(c) {
    const st = c.st, b = c.body, H = c.ap.height;
    const lying = c.anim === 'lie' || c.anim === 'sleep' || c.anim === 'dead' || c.anim === 'knocked_out';
    const sitting = c.anim === 'sit' || c.anim === 'sit_bar' || c.anim === 'eat' || c.anim === 'type' || c.anim === 'slots';
    const fx = sin(st.yaw), fz = cos(st.yaw);
    const hy = lying ? 0.15 : sitting ? H - b.hipStand + 0.05 : H - 0.11 * b.headS;
    const off = lying ? (H * 0.4) * (c.anim === 'lie' || c.anim === 'sleep' ? -1 : 1) : 0;
    c.head[0] = st.x + fx * off; c.head[1] = st.y + hy; c.head[2] = st.z + fz * off;
    c.hand[0] = st.x + fx * 0.2 - fz * 0.2; c.hand[1] = st.y + (sitting ? 0.2 : b.hipStand * 0.95); c.hand[2] = st.z + fz * 0.2 + fx * 0.2;
    c.chest[0] = st.x; c.chest[1] = st.y + (lying ? 0.15 : hy - 0.3); c.chest[2] = st.z;
    c.pelvis[0] = st.x; c.pelvis[1] = st.y + (lying ? 0.12 : sitting ? 0.1 : b.hipStand); c.pelvis[2] = st.z;
    c.ankL[0] = c.ankR[0] = st.x; c.ankL[1] = c.ankR[1] = st.y + 0.08; c.ankL[2] = c.ankR[2] = st.z;
  }

  // ------------------------------------------------------------ skeleton + instance emission
  _emit(c) {
    const P = c.pose, b = c.body, L = c.look, st = c.st, parts = c.lod ? this.P1 : this.P0, far = c.lod === 1;
    const inten = clamp(st.interior || 0, 0, 1);
    const ts = b.ts;
    // root
    rotY(R0, st.yaw);
    vRoot[0] = st.x; vRoot[1] = st.y; vRoot[2] = st.z;
    // pelvis
    tp(vP, vRoot, R0, P[PX], P[PY], P[PZ]);
    copy9(RP_, R0); my(RP_, P[RY]); mx(RP_, P[RP]); mz(RP_, P[RR]);
    // spine / chest / neck / head
    tp(vS, vP, RP_, 0, 0.1 * ts, 0);
    copy9(RS, RP_); mx(RS, P[SPX]); my(RS, P[SPY]); mz(RS, P[SPZ]);
    tp(vC, vS, RS, 0, 0.22 * ts, 0);
    copy9(RC, RS); mx(RC, P[CHX]); my(RC, P[CHY]); mz(RC, P[CHZ]);
    tp(vN, vC, RC, 0, 0.235 * ts, -0.005);
    copy9(RN, RC); mx(RN, P[NKX]); my(RN, P[NKY] + c.lookS * 0.4); mz(RN, P[NKZ]);
    tp(vH, vN, RN, 0, 0.075 * ts, 0.004);
    copy9(RH, RN); mx(RH, P[HDX]); my(RH, P[HDY] + c.lookS * 0.6); mz(RH, P[HDZ]);
    const hs = b.headS;
    parts.pelvis.push(RP_, b.pelSX, ts, b.pelSZ, vP[0], vP[1], vP[2], L.pelvis, inten);
    parts.belly.push(RS, b.bellySX, ts, b.bellySZ, vS[0], vS[1], vS[2], L.belly, inten);
    const chestPart = b.female ? parts.chest_f : parts.chest_m;
    chestPart.push(RC, b.chestSX, ts, b.chestSZ, vC[0], vC[1], vC[2], L.chest, inten);
    parts.neck.push(RN, b.neckS, ts, b.neckS, vN[0], vN[1], vN[2], L.neck, inten);
    (L.femHead ? parts.head_f : parts.head_m).push(RH, hs * L.headW, hs, hs, vH[0], vH[1], vH[2], L.head, inten);
    if (L.hairStyle) parts['hair_' + L.hairStyle].push(RH, hs * L.hairS, hs * L.hairS, hs * L.hairS, vH[0], vH[1], vH[2], L.hair, inten);
    if (L.pony) this._emitPony(c, parts, hs * L.hairS, inten);
    if (L.hat) parts['hat_' + L.hat].push(RH, hs, hs, hs, vH[0], vH[1], vH[2], L.hatC, inten);
    // head centre (for API)
    tp(c.head, vH, RH, 0, HEAD_C[1] * hs, HEAD_C[2] * hs);
    c.chest[0] = vC[0]; c.chest[1] = vC[1]; c.chest[2] = vC[2];
    c.pelvis[0] = vP[0]; c.pelvis[1] = vP[1]; c.pelvis[2] = vP[2];
    // accessories
    const close = c.d2 < 144;
    for (let i = 0; i < L.acc.length; i++) {
      const a = L.acc[i], part = parts['acc_' + a[0]];
      if (!close && (a[0] === 'buttons' || a[0] === 'necklace' || a[0] === 'buckle' || a[0] === 'badge')) continue;
      if (a[1] === 'chest') part.push(RC, b.chestSX, ts, b.chestSZ, vC[0], vC[1], vC[2], a[2], inten);
      else if (a[1] === 'head') { if (!far) part.push(RH, hs, hs, hs, vH[0], vH[1], vH[2], a[2], inten); }
      else part.push(RP_, b.pelSX, ts, b.pelSZ, vP[0], vP[1], vP[2], a[2], inten);
    }
    // arms
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? 1 : -1, B = side === 0 ? AL : AR;
      tp(vSh, vC, RC, s * b.shW, 0.195 * ts + P[B] * 0.05, -0.012);
      copy9(RA, RC); my(RA, -s * P[B + 1]); mx(RA, -P[B + 2]); mz(RA, s * P[B + 3]); my(RA, -s * P[B + 4]);
      tp(vE, vSh, RA, 0, -b.L1, 0);
      copy9(RB, RA); mx(RB, -P[B + 5]);
      tp(vW, vE, RB, 0, -b.L2, 0);
      copy9(RW, RB); my(RW, -s * P[B + 7]); mx(RW, -P[B + 6]);
      parts.upperArm.push(RA, b.armG, b.L1, b.armG, vSh[0], vSh[1], vSh[2], L.uarm, inten);
      parts.forearm.push(RB, b.armG, b.L2, b.armG, vE[0], vE[1], vE[2], L.farm, inten);
      if (L.cuffA && !far && close) { const q = L.cuffA; if (q.lim === 0) this._cuff(RA, vSh, b.L1, b.armG, q, inten); else this._cuff(RB, vE, b.L2, b.armG, q, inten); }
      const fist = P[side === 0 ? FISTL : FISTR] > 0.5;
      const hp = side === 0 ? (fist ? parts.fistL : parts.handL) : (fist ? parts.fist : parts.hand);
      const hsz = b.handS;
      hp.push(RW, hsz, hsz, hsz, vW[0], vW[1], vW[2], L.hand, inten);
      if (side === 1) {
        tp(c.hand, vW, RW, 0.012 * hsz, -0.075 * hsz, 0);
        this._emitProp(c, RW, hsz, inten);
      }
    }
    // legs
    let thx = 0, thy = 0, thz = 0;
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? 1 : -1, B = side === 0 ? LL : LR;
      tp(vHip, vP, RP_, s * b.hipW, 0, 0);
      copy9(RT, RP_); mz(RT, s * P[B + 1]); mx(RT, -P[B]);
      tp(vK, vHip, RT, 0, -b.thighL, 0);
      copy9(RK, RT); mx(RK, P[B + 3]);
      tp(vA, vK, RK, 0, -b.shinL, 0);
      copy9(RF, RK); mx(RF, P[B + 4]); my(RF, -s * P[B + 2]);
      parts.thigh.push(RT, b.legG, b.thighL, b.legG, vHip[0], vHip[1], vHip[2], L.thigh, inten);
      parts.shin.push(RK, b.legG, b.shinL, b.legG, vK[0], vK[1], vK[2], L.shin, inten);
      if (L.cuffL && !far && close) { const q = L.cuffL; if (q.lim === 2) this._cuff(RT, vHip, b.thighL, b.legG, q, inten); else this._cuff(RK, vK, b.shinL, b.legG, q, inten); }
      const fs = b.footS;
      (L.boot ? parts.boot : parts.shoe).push(RF, fs, fs, fs, vA[0], vA[1], vA[2], L.shoe, inten);
      thx += -RT[3]; thy += -RT[4]; thz += -RT[5];
      const ak = side === 0 ? c.ankL : c.ankR; ak[0] = vA[0]; ak[1] = vA[1]; ak[2] = vA[2];
    }
    // skirt / dress — axis follows the average thigh direction
    if (L.skirt || L.tail) {
      const tl = Math.hypot(thx, thy, thz) || 1; thx /= tl; thy /= tl; thz /= tl;
      const sitting = P[SKSIT] > 0.5;
      const legLen = b.thighL + b.shinL;
      if (L.skirt) {
        const sk = L.skirt;
        const len = 0.13 * ts + sk.len * legLen;
        const kfol = sitting ? 0.9 : clamp(0.35 + 0.35 * (1 - sk.len), 0.3, 0.75);
        this._skirtFrame(RP_, thx, thy, thz, kfol);
        tp(vT, vP, RP_, 0, 0.11 * ts, 0.0);
        const flare = 0.7 + 0.6 * (sk.flare - 1) + (sitting ? 0.25 : 0);
        const split = Math.min(0.75, Math.abs(P[LL] - P[LR]));
        const sx = b.pelSX * flare * (sitting ? 1.15 : 1.02 + 0.1 * split);
        const sz = b.pelSZ * (sitting ? 1.25 : Math.min(1.5, 1.02 + (0.9 + 2.2 * sk.len * sk.len) * split * split + 0.25 * split * sk.len));
        parts.skirt.push(RX, sx, sitting ? len * 0.62 : len, sz, vT[0], vT[1], vT[2], sk.c, inten);
      }
      if (L.tail) {
        this._skirtFrame(RP_, thx, thy, thz, sitting ? 0.6 : 0.25);
        tp(vT, vP, RP_, 0, 0.115 * ts, -0.004);
        parts.tail.push(RX, b.pelSX * 1.03, (sitting ? 0.5 : 1) * L.tail.len * b.k, b.pelSZ * (sitting ? 1.2 : 1.04), vT[0], vT[1], vT[2], L.tail.c, inten);
      }
    }
    if (L.apron) {
      copy9(RX, RP_);
      if (P[SKSIT] > 0.5) mx(RX, -1.2);
      tp(vT, vP, RP_, 0, 0.11 * ts, 0.0);
      parts.apron.push(RX, b.pelSX, L.apron.len * b.k * (P[SKSIT] > 0.5 ? 0.5 : 0.7), b.pelSZ * 1.12, vT[0], vT[1], vT[2], L.apron.c, inten);
    }
  }

  // sleeve / trouser hem band on a limb segment at fraction q.t
  _cuff(Rl, origin, len, g, q, inten) {
    const t = q.t, w = q.w ?? 0.022;
    tp(vT, origin, Rl, q.cx * g, -t * len + w * 0.35, q.cz * g);
    this.parts.cuff.push(Rl, q.rx * g * 1.1, w, q.rz * g * 1.1, vT[0], vT[1], vT[2], q.c, inten);
  }
  // ponytail: hangs from the tie point, swings with gait and turning (damped spring on two axes)
  _emitPony(c, parts, hs, inten) {
    const st = c.st, a = c.anim;
    tp(vT, vH, RH, PONY_TIE[0] * hs, PONY_TIE[1] * hs, PONY_TIE[2] * hs);
    const lying = a === 'lie' || a === 'sleep' || a === 'dead' || a === 'knocked_out' || a === 'swim';
    if (lying) { copy9(RX, RH); mx(RX, -1.3); parts.ptail.push(RX, hs, hs, hs, vT[0], vT[1], vT[2], c.look.hair, inten); return; }
    rotY(RX, st.yaw + c.pose[RY] + c.pose[SPY] + c.pose[CHY] + c.pose[NKY] + c.pose[HDY] + c.lookS);
    mx(RX, -(0.28 + c.swing)); mz(RX, c.swingS);
    parts.ptail.push(RX, hs, hs, hs, vT[0], vT[1], vT[2], c.look.hair, inten);
  }

  // build RX: local -Y along a blend of pelvis-down and the mean thigh direction; local Z ~ pelvis forward
  _skirtFrame(Rp, thx, thy, thz, k) {
    let dx = lerp(-Rp[3], thx, k), dy = lerp(-Rp[4], thy, k), dz = lerp(-Rp[5], thz, k);
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    // Y axis = -d
    const yx = -dx, yy = -dy, yz = -dz;
    // X = normalize(Zp × Y)... use pelvis X projected orthogonal to Y
    let xx = Rp[0], xy = Rp[1], xz = Rp[2];
    const dp = xx * yx + xy * yy + xz * yz; xx -= dp * yx; xy -= dp * yy; xz -= dp * yz;
    const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    // Z = X × Y
    const zx = xy * yz - xz * yy, zy = xz * yx - xx * yz, zz = xx * yy - xy * yx;
    RX[0] = xx; RX[1] = xy; RX[2] = xz; RX[3] = yx; RX[4] = yy; RX[5] = yz; RX[6] = zx; RX[7] = zy; RX[8] = zz;
  }

  _emitProp(c, RW, hsz, inten) {
    const held = c.st.held;
    if (!held || held === 'none') return;
    const part = this.parts['prop_' + held]; if (!part) return;
    let col = PROP_COLORS[held];
    if (held === 'luggage') { col = this._lugSet || (this._lugSet = PROP_COLORS.luggage.slice()); col[0] = c.lugC; }
    if (held === 'luggage') {
      const h = c.hand, st = c.st, fx = sin(st.yaw), fz = cos(st.yaw);
      const Lh = 0.95, hh = Math.max(0.2, h[1] - st.y - 0.035);
      const back = Math.sqrt(Math.max(0.01, Lh * Lh - hh * hh));
      const wx = h[0] - fx * back, wy = st.y + 0.035, wz = h[2] - fz * back;
      let yx = h[0] - wx, yy = h[1] - wy, yz = h[2] - wz; const yl = Math.hypot(yx, yy, yz) || 1; yx /= yl; yy /= yl; yz /= yl;
      // X = character left axis (cos yaw, 0, -sin yaw)
      const xx = fz, xz = -fx;
      RX[0] = xx; RX[1] = 0; RX[2] = xz; RX[3] = yx; RX[4] = yy; RX[5] = yz;
      RX[6] = 0 * yz - xz * yy; RX[7] = xz * yx - xx * yz; RX[8] = xx * yy - 0 * yx;
      part.push(RX, 1, 1, 1, wx, wy, wz, col, inten);
      return;
    }
    if (LEVEL_PROPS.has(held)) {
      const h = c.hand;
      rotY(RX, c.st.yaw);
      let x = h[0], y = h[1], z = h[2];
      if (held === 'tray') y += 0.03;
      part.push(RX, 1, 1, 1, x, y, z, col, inten);
    } else {
      part.push(RW, hsz, hsz, hsz, c.hand[0] - (RW[3] * -0.075 + RW[0] * 0.012) * hsz, c.hand[1] - (RW[4] * -0.075 + RW[1] * 0.012) * hsz, c.hand[2] - (RW[5] * -0.075 + RW[2] * 0.012) * hsz, col, inten);
    }
  }

  // ------------------------------------------------------------ queries
  headPos(id, out = new THREE.Vector3()) {
    const c = this.chars[id]; if (!c) return out.set(0, 0, 0);
    if (c.culled && !c._posed) this._approx(c);
    return out.set(c.head[0], c.head[1], c.head[2]);
  }
  handPos(id, out = new THREE.Vector3()) {
    const c = this.chars[id]; if (!c) return out.set(0, 0, 0);
    return out.set(c.hand[0], c.hand[1], c.hand[2]);
  }
  // ray vs per-character capsules. origin/dir: Vector3 (dir normalised)
  hitTest(origin, dir, maxDist = 100) {
    let best = null, bestD = maxDist;
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    for (let i = 0; i < this.max; i++) {
      const c = this.chars[i]; if (!c || !c.st.visible) continue;
      // cheap reject: distance from ray to character position
      const px = c.pelvis[0] - ox, py = c.pelvis[1] - oy, pz = c.pelvis[2] - oz;
      const tc = px * dx + py * dy + pz * dz;
      if (tc < -1.5 || tc > bestD + 1.5) continue;
      const qx = px - dx * tc, qy = py - dy * tc, qz = pz - dz * tc;
      if (qx * qx + qy * qy + qz * qz > 2.0 * 2.0) continue;
      const k = c.body.k;
      const hr = 0.11 * c.body.headS;
      let d = raySphere(ox, oy, oz, dx, dy, dz, c.head[0], c.head[1], c.head[2], hr);
      if (d >= 0 && d < bestD) { bestD = d; best = { id: i, dist: d, part: 'head' }; }
      d = rayCapsule(ox, oy, oz, dx, dy, dz, c.chest[0], c.chest[1] + 0.12 * k, c.chest[2], c.pelvis[0], c.pelvis[1], c.pelvis[2], 0.19 * k * c.ap.build);
      if (d >= 0 && d < bestD) { bestD = d; best = { id: i, dist: d, part: 'body' }; }
      const ax = (c.ankL[0] + c.ankR[0]) * 0.5, ay = (c.ankL[1] + c.ankR[1]) * 0.5, az = (c.ankL[2] + c.ankR[2]) * 0.5;
      d = rayCapsule(ox, oy, oz, dx, dy, dz, c.pelvis[0], c.pelvis[1] - 0.05, c.pelvis[2], ax, ay, az, 0.16 * k);
      if (d >= 0 && d < bestD) { bestD = d; best = { id: i, dist: d, part: 'legs' }; }
    }
    return best;
  }

  dispose() {
    for (const p of this.partList) { this.group.remove(p.mesh); p.mesh.dispose(); }
    for (const k in this.geos) this.geos[k].dispose();
    for (const k in this.mats) this.mats[k].dispose();
    this.face.dispose();
    this.scene.remove(this.group);
  }
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const mx_ = ox - cx, my_ = oy - cy, mz_ = oz - cz;
  const b = mx_ * dx + my_ * dy + mz_ * dz, c = mx_ * mx_ + my_ * my_ + mz_ * mz_ - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c; if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}
function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  // closest point on segment AB to the ray, then a sphere test there
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const wx = ax - ox, wy = ay - oy, wz = az - oz;
  const a = ux * ux + uy * uy + uz * uz, b = ux * dx + uy * dy + uz * dz;
  const d = ux * wx + uy * wy + uz * wz, e = dx * wx + dy * wy + dz * wz;
  const den = a - b * b;
  const s = den > 1e-9 ? clamp((b * e - d) / den, 0, 1) : 0;
  return raySphere(ox, oy, oz, dx, dy, dz, ax + ux * s, ay + uy * s, az + uz * s, r);
}
