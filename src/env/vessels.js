// Procedural ships for the horizon: container ship, tanker, sailing yacht, fishing trawler, cruise ship.
// Each builder returns { group, lights (THREE.Points with nav/deck light shader), length, speedKn, type, mats[] }.
// Geometry is merged per vessel (vertex colours, one draw call for the hull/superstructure, one for lights,
// one for sails/emissive windows where needed). Local frame: +X = vessel's bow, +Y up, +Z = starboard, y=0 waterline.
//
// Navigation lights follow COLREGS: masthead white 225° forward, second masthead aft & higher (>50 m),
// sidelights red (port) / green (starboard) 112.5° from dead ahead, sternlight white 135° aft,
// trawler: all-round green over white; sailing vessel: tricolour at the masthead.
import * as THREE from 'three';

class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; }
  quad(a, b, c, d, col, nrm) {
    // a,b,c,d counter-clockwise when seen from the front
    const n = nrm || faceNormal(a, b, c);
    for (const v of [a, b, c, a, c, d]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.c.push(col[0], col[1], col[2]); }
  }
  tri(a, b, c, col) { const n = faceNormal(a, b, c); for (const v of [a, b, c]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.c.push(col[0], col[1], col[2]); } }
  box(x0, y0, z0, x1, y1, z1, col, opts = {}) {
    const top = opts.top || col, side = opts.side || col;
    const A = [x0, y0, z0], B = [x1, y0, z0], C = [x1, y0, z1], D = [x0, y0, z1], E = [x0, y1, z0], F = [x1, y1, z0], G = [x1, y1, z1], H = [x0, y1, z1];
    this.quad(E, H, G, F, top, [0, 1, 0]);
    if (!opts.noBottom) this.quad(A, B, C, D, col, [0, -1, 0]);
    this.quad(D, C, G, H, side, [0, 0, 1]);
    this.quad(B, A, E, F, side, [0, 0, -1]);
    this.quad(C, B, F, G, col, [1, 0, 0]);
    this.quad(A, D, H, E, col, [-1, 0, 0]);
  }
  // ship hull: stations along x with half-beam function, from y0 (below water) to y1 (deck)
  hull(L, halfB, y0, y1, colTop, colBottom, bootY, opts = {}) {
    const N = 28, stations = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N; const x = -L / 2 + t * L;
      let h = halfB;
      const bowT = opts.bowT ?? 0.82, sternT = opts.sternT ?? 0.06;
      if (t > bowT) h *= Math.pow(Math.max(0, 1 - Math.pow((t - bowT) / (1 - bowT), 1.8)), 0.6);
      if (t < sternT) h *= 0.82 + 0.18 * (t / sternT);
      stations.push([x, Math.max(h, 0.05)]);
    }
    const flare = opts.flare ?? 0.06;
    for (let i = 0; i < N; i++) {
      const [xa, ha] = stations[i], [xb, hb] = stations[i + 1];
      for (const s of [1, -1]) {
        // boot-top split: bottom colour below bootY
        const lo = [[xa, y0, s * ha * 0.92], [xb, y0, s * hb * 0.92]], mid = [[xa, bootY, s * ha], [xb, bootY, s * hb]], hi = [[xa, y1, s * ha * (1 + flare)], [xb, y1, s * hb * (1 + flare)]];
        if (s > 0) { this.quad(lo[0], lo[1], mid[1], mid[0], colBottom); this.quad(mid[0], mid[1], hi[1], hi[0], colTop); }
        else { this.quad(lo[1], lo[0], mid[0], mid[1], colBottom); this.quad(mid[1], mid[0], hi[0], hi[1], colTop); }
      }
      // deck
      const dc = opts.deckCol || colTop;
      this.quad([xa, y1, ha * (1 + flare)], [xb, y1, hb * (1 + flare)], [xb, y1, -hb * (1 + flare)], [xa, y1, -ha * (1 + flare)], dc, [0, 1, 0]);
    }
    // transom
    const [xs, hs] = stations[0];
    this.quad([xs, y0, -hs * 0.92], [xs, y0, hs * 0.92], [xs, y1, hs * (1 + flare)], [xs, y1, -hs * (1 + flare)], colTop, [-1, 0, 0]);
    // bulwark lip (gives the deck edge a visible thickness)
    if (opts.bulwark) {
      for (let i = 0; i < N; i++) {
        const [xa, ha] = stations[i], [xb, hb] = stations[i + 1];
        for (const s of [1, -1]) {
          const a = [xa, y1, s * ha * (1 + flare)], b = [xb, y1, s * hb * (1 + flare)], c = [xb, y1 + opts.bulwark, s * hb * (1 + flare)], d = [xa, y1 + opts.bulwark, s * ha * (1 + flare)];
          if (s > 0) this.quad(a, b, c, d, colTop); else this.quad(b, a, d, c, colTop);
        }
      }
    }
    return stations;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}
function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const shade = (col, k) => [col[0] * k, col[1] * k, col[2] * k];

// ── lights (Points) ─────────────────────────────────────────────────────────
const LIGHT_VS = `
attribute vec3 color; attribute vec4 aLight;   // size (m), arc centre (rad, 0 = bow, +pi/2 = starboard), arc half-width (rad, >=3.2 all-round), kind (0 nav, 1 deck/window, 2 work)
uniform vec3 uCamLocal; uniform float uScale; uniform float uNight; uniform float uNav; uniform float uPx; uniform float uFogD; uniform float uFogScale;
varying vec3 vCol; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = length(mv.xyz);
  vec2 rel = uCamLocal.xz - position.xz;
  float ang = atan(rel.y, rel.x);
  float d = abs(mod(ang - aLight.y + 3.14159265, 6.2831853) - 3.14159265);
  float vis = aLight.z >= 3.2 ? 1.0 : 1.0 - smoothstep(aLight.z - 0.03, aLight.z + 0.03, d);
  float on = aLight.w < 0.5 ? uNav : (aLight.w < 1.5 ? uNight : uNav);
  float fog = exp(-uFogD * uFogD * dist * dist * uFogScale * uFogScale * 0.35);
  vA = vis * on * fog;
  // physically: tiny lights stay ~1-3 px; brighter = slightly bigger
  float px = aLight.x * uPx / max(dist, 1.0);
  gl_PointSize = clamp(px, 3.0, 12.0) * (vA > 0.001 ? 1.0 : 0.0);
  vCol = color;
}`;
const LIGHT_FS = `
varying vec3 vCol; varying float vA;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, r)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * (1.5 + (1.0 - r) * 5.0), a);
}`;
class LightSet {
  constructor() { this.p = []; this.c = []; this.l = []; }
  add(x, y, z, col, size, arcC = 0, arcW = 4, kind = 0) { this.p.push(x, y, z); this.c.push(col[0], col[1], col[2]); this.l.push(size, arcC, arcW, kind); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aLight', new THREE.Float32BufferAttribute(this.l, 4));
    g.computeBoundingSphere();
    const U = { uCamLocal: { value: new THREE.Vector3() }, uScale: { value: 1 }, uNight: { value: 0 }, uNav: { value: 0 }, uPx: { value: 500 }, uFogD: { value: 0 }, uFogScale: { value: 1 } };
    const m = new THREE.ShaderMaterial({ vertexShader: LIGHT_VS, fragmentShader: LIGHT_FS, uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 3;
    return pts;
  }
}
const D2R = Math.PI / 180;
const NAV = { white: hex('#fff6e0'), red: [1, 0.08, 0.05], green: [0.1, 1, 0.35], yellow: [1, 0.75, 0.2], warm: [1, 0.78, 0.45], cool: [0.85, 0.9, 1] };
function powerNav(L, set, mastF, mastA, sideX, sideY, sideZ, sternY) {
  set.add(mastF[0], mastF[1], 0, NAV.white, 3.2, 0, 112.5 * D2R);
  if (mastA) set.add(mastA[0], mastA[1], 0, NAV.white, 3.2, 0, 112.5 * D2R);
  set.add(sideX, sideY, sideZ, NAV.green, 3.0, Math.PI / 4 * 1.25, 56.25 * D2R);   // starboard: 0..112.5° (centre 56.25°)
  set.add(sideX, sideY, -sideZ, NAV.red, 3.0, -Math.PI / 4 * 1.25, 56.25 * D2R);
  set.add(-L / 2 + 0.5, sternY, 0, NAV.white, 2.6, Math.PI, 67.5 * D2R);
}

function stdMat(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.roughness ?? 0.7, metalness: opts.metalness ?? 0.1, side: opts.side ?? THREE.FrontSide, ...opts.extra });
  const U = { uFogScale: { value: 1 } };
  m.userData.fogScale = U.uFogScale;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFogScale = U.uFogScale;
    sh.fragmentShader = 'uniform float uFogScale;\n' + sh.fragmentShader.replace('#include <fog_fragment>', `
#ifdef USE_FOG
  float fd = vFogDepth * uFogScale;
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fd * fd );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fd );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`);
  };
  m.customProgramCacheKey = () => 'htvessel';
  return m;
}

// ── container ship ───────────────────────────────────────────────────────────
export function buildContainerShip(seed = 1) {
  const r = rng(seed), b = new GeoBuilder(), L = 300, B = 24;
  const hullCol = r() < 0.5 ? hex('#1f2f4a') : hex('#3a3f44'), red = hex('#7a2420');
  b.hull(L, B, -6, 11, hullCol, red, -0.5, { bowT: 0.8, flare: 0.05, deckCol: hex('#5b5f63'), bulwark: 1.5 });
  const palette = ['#b3261e', '#1e5aa8', '#2a7a3b', '#d9d5cc', '#c46a1b', '#7b2d7a', '#8a8f94', '#1c6f74', '#b88a2a', '#5a3825', '#e0e0dc', '#204060'].map(hex);
  const bridgeX = -L / 2 + 40;
  for (let bx = -L / 2 + 52; bx < L / 2 - 36; bx += 13.2) {
    if (Math.abs(bx - (bridgeX)) < 8) continue;
    const tiersBase = 3 + Math.floor(r() * 4);
    for (let rz = -B + 2; rz < B - 2; rz += 2.5) {
      let tiers = tiersBase + (r() < 0.25 ? -1 - Math.floor(r() * 2) : 0);
      if (Math.abs(rz) > B - 6) tiers = Math.min(tiers, 4);
      let y = 12.2;
      for (let t = 0; t < tiers; t++) {
        const col = shade(palette[Math.floor(r() * palette.length)], 0.8 + r() * 0.3);
        b.box(bx, y, rz, bx + 12.2, y + 2.6, rz + 2.4, col, { noBottom: true, top: shade(col, 1.1) });
        y += 2.6;
      }
    }
    // lashing bridge
    b.box(bx - 0.6, 11, -B, bx - 0.1, 14, B, hex('#c9c9c2'), { noBottom: true });
  }
  // superstructure aft
  const white = hex('#e9e7e1'), win = hex('#2b3640');
  for (let d = 0; d < 8; d++) {
    const y = 12.5 + d * 3; const w = d === 7 ? B + 2 : B - 6;
    b.box(bridgeX - 7, y, -w, bridgeX + 7, y + 3, w, white, { noBottom: true });
    b.box(bridgeX + 7.01, y + 1.1, -w + 1, bridgeX + 7.05, y + 2.2, w - 1, win, { noBottom: true });
  }
  b.box(-L / 2 + 6, 11, -5, -L / 2 + 16, 33, 5, hex('#1b1b1b'), { noBottom: true, side: hullCol });   // funnel
  b.box(bridgeX - 2, 36.5, -0.6, bridgeX - 0.8, 44, 0.6, white); // mast
  b.box(L / 2 - 26, 11, -0.5, L / 2 - 25, 24, 0.5, hex('#d0d0cc')); // fore mast
  const set = new LightSet();
  powerNav(L, set, [L / 2 - 25.5, 24.5], [bridgeX - 1.4, 44.5], bridgeX + 6, 37, B + 2.2, 13);
  // deck/accommodation lights (a few portholes)
  for (let d = 0; d < 7; d++) for (let z = -B + 8; z <= B - 8; z += 3.2) if (r() < 0.35) set.add(bridgeX + 7.2, 13.5 + d * 3 + 1.2, z, NAV.warm, 1.2, 0, 1.6, 1);
  for (let x = -L / 2 + 50; x < L / 2 - 40; x += 26) set.add(x, 13, B * (r() < 0.5 ? 1 : -1), NAV.cool, 1.4, 0, 4, 1);
  return finish('container', b, set, L, 18 + r() * 5, {});
}

// ── tanker ───────────────────────────────────────────────────────────────────
export function buildTanker(seed = 2) {
  const r = rng(seed), b = new GeoBuilder(), L = 250, B = 22;
  const hullCol = r() < 0.5 ? hex('#2a2a2c') : hex('#54221d');
  b.hull(L, B, -8, 7.5, hullCol, hex('#6d201b'), 0.2, { bowT: 0.86, sternT: 0.04, flare: 0.02, deckCol: hex('#6e2a22'), bulwark: 0.8 });
  // pipe manifold, catwalk
  const pipe = hex('#b9b28f'), white = hex('#ece9e2'), win = hex('#2a333c');
  b.box(-L / 2 + 40, 7.5, -0.8, L / 2 - 20, 9.2, 0.8, pipe, { noBottom: true });
  b.box(-10, 7.5, -B + 4, 6, 10, B - 4, pipe, { noBottom: true });
  for (let x = -L / 2 + 50; x < L / 2 - 30; x += 22) b.box(x, 7.5, -1.5, x + 1.2, 11.5, 1.5, pipe);
  const sx = -L / 2 + 18;
  for (let d = 0; d < 6; d++) {
    const y = 8 + d * 2.9, w = d === 5 ? B + 1 : B - 4;
    b.box(sx - 9, y, -w, sx + 9, y + 2.9, w, white, { noBottom: true });
    b.box(sx + 9.01, y + 1.1, -w + 1, sx + 9.05, y + 2.1, w - 1, win, { noBottom: true });
  }
  b.box(sx - 16, 8, -4, sx - 8, 31, 4, white, { noBottom: true });
  b.box(sx - 16.05, 27, -4.05, sx - 7.95, 31, 4.05, hex('#c22a1d'), { noBottom: true });
  b.box(sx + 2, 25.5, -0.5, sx + 3, 34, 0.5, white);
  b.box(L / 2 - 14, 7.5, -0.5, L / 2 - 13, 19, 0.5, white);
  const set = new LightSet();
  powerNav(L, set, [L / 2 - 13.5, 19.5], [sx + 2.5, 34.5], sx + 8, 25, B + 1.2, 10);
  for (let d = 0; d < 5; d++) for (let z = -B + 6; z <= B - 6; z += 3) if (r() < 0.4) set.add(sx + 9.2, 9 + d * 2.9 + 1.1, z, NAV.warm, 1.2, 0, 1.6, 1);
  set.add(sx + 9.5, 26, 0, NAV.cool, 1.6, 0, 1.4, 1);
  return finish('tanker', b, set, L, 13 + r() * 2, {});
}

// ── trawler ──────────────────────────────────────────────────────────────────
export function buildTrawler(seed = 3) {
  const r = rng(seed), b = new GeoBuilder(), L = 34, B = 4.6;
  const hullCol = r() < 0.5 ? hex('#1c4e8a') : hex('#8a2a22');
  b.hull(L, B, -3, 2.6, hullCol, hex('#5b1a16'), 0, { bowT: 0.7, sternT: 0.05, flare: 0.12, deckCol: hex('#7d7a70'), bulwark: 1.0 });
  const white = hex('#eeeeea'), win = hex('#1f262c');
  b.box(L / 2 - 14, 2.6, -3, L / 2 - 6, 6, 3, white, { noBottom: true });
  b.box(L / 2 - 13, 6, -2.6, L / 2 - 7, 8.2, 2.6, white, { noBottom: true });
  b.box(L / 2 - 6.98, 6.6, -2.4, L / 2 - 6.94, 7.8, 2.4, win);
  b.box(L / 2 - 11, 8.2, -0.15, L / 2 - 10.7, 15, 0.15, white);   // mast
  // aft gantry
  const g = hex('#e0a020');
  b.box(-L / 2 + 2, 2.6, -B, -L / 2 + 2.6, 9, -B + 0.6, g); b.box(-L / 2 + 2, 2.6, B - 0.6, -L / 2 + 2.6, 9, B, g); b.box(-L / 2 + 2, 8.4, -B, -L / 2 + 2.6, 9, B, g);
  b.box(-L / 2 + 6, 2.6, -2, -L / 2 + 9, 4.2, 2, hex('#555a5e'));  // net drum
  const set = new LightSet();
  set.add(L / 2 - 10.85, 14.6, 0, NAV.green, 2.6, 0, 4);       // trawling: green over white all-round
  set.add(L / 2 - 10.85, 13.4, 0, NAV.white, 2.6, 0, 4);
  set.add(L / 2 - 10.85, 11.5, 0, NAV.white, 2.4, 0, 112.5 * D2R);
  set.add(L / 2 - 8, 7, 3.1, NAV.green, 2.2, Math.PI / 4 * 1.25, 56.25 * D2R);
  set.add(L / 2 - 8, 7, -3.1, NAV.red, 2.2, -Math.PI / 4 * 1.25, 56.25 * D2R);
  set.add(-L / 2 + 0.3, 3.5, 0, NAV.white, 2.0, Math.PI, 67.5 * D2R);
  for (const x of [-L / 2 + 2.3, L / 2 - 12]) set.add(x, 9.2, 0, [1, 0.95, 0.85], 3.5, 0, 4, 2);   // deck working floods
  return finish('trawler', b, set, L, 4 + r() * 3, {});
}

// ── sailing yacht ────────────────────────────────────────────────────────────
export function buildYacht(seed = 4) {
  const r = rng(seed), b = new GeoBuilder(), L = 22, B = 2.6;
  b.hull(L, B, -1.2, 1.4, hex('#f3f2ee'), hex('#14233a'), 0.05, { bowT: 0.6, sternT: 0.08, flare: 0.1, deckCol: hex('#b88a5a') });
  b.box(-2, 1.4, -1.6, 4, 2.2, 1.6, hex('#efeee9'), { noBottom: true });
  b.box(1.5, 1.4, -0.1, 1.75, 29, 0.1, hex('#cfcfcf'));
  const sail = new GeoBuilder(), sc = hex('#f6f4ee');
  // main (luff on mast, foot along boom) & genoa (forestay)
  sail.tri([1.5, 2.6, 0], [1.5, 28.5, 0], [-8.5, 2.6, 0], sc);
  sail.tri([1.5, 2.6, 0], [-8.5, 2.6, 0], [1.5, 28.5, 0], sc);
  sail.tri([10.5, 1.8, 0], [1.9, 27, 0], [-1.5, 2.2, 0], sc);
  sail.tri([10.5, 1.8, 0], [-1.5, 2.2, 0], [1.9, 27, 0], sc);
  const set = new LightSet();
  set.add(1.62, 29.3, 0.05, NAV.green, 2.2, Math.PI / 4 * 1.25, 56.25 * D2R);   // tricolour at masthead
  set.add(1.62, 29.3, -0.05, NAV.red, 2.2, -Math.PI / 4 * 1.25, 56.25 * D2R);
  set.add(1.5, 29.3, 0, NAV.white, 2.0, Math.PI, 67.5 * D2R);
  set.add(1.62, 29.6, 0, NAV.white, 1.2, 0, 4, 1);                         // anchor/steaming light off; masthead strobe-ish deck light
  const v = finish('yacht', b, set, L, 6 + r() * 3, {});
  const sm = stdMat({ side: THREE.DoubleSide, roughness: 0.9 });
  const sails = new THREE.Mesh(sail.geometry(), sm); sails.name = 'sails';
  v.hullMesh.add(sails); v.mats.push(sm);
  v.heel = 0.18;
  return v;
}

// ── cruise ship (lit up at night) ────────────────────────────────────────────
export function buildCruiseShip(seed = 5) {
  const r = rng(seed), b = new GeoBuilder(), L = 290, B = 18.5;
  b.hull(L, B, -8, 9, hex('#f1f0ec'), hex('#1d2a44'), 1.0, { bowT: 0.78, flare: 0.02, deckCol: hex('#dcdcd6') });
  const white = hex('#f3f2ee'), glass = hex('#24303c');
  const decks = 11, x0 = -L / 2 + 14, x1 = L / 2 - 46;
  for (let d = 0; d < decks; d++) {
    const y = 9 + d * 3; const inset = d < 8 ? 0.3 : 2 + (d - 8) * 1.5; const xa = x0 + (d > 8 ? (d - 8) * 8 : 0), xb = x1 - (d > 7 ? (d - 7) * 10 : 0);
    b.box(xa, y, -B + inset, xb, y + 3, B - inset, white, { noBottom: true });
  }
  // funnel
  b.box(-L / 2 + 50, 42, -4, -L / 2 + 68, 54, 4, hex('#1d2a44'), { noBottom: true });
  // window band (emissive texture on two side planes)
  const tex = windowTexture(r);
  const em = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.3, metalness: 0.1, emissive: 0xffd9a0, emissiveMap: tex, emissiveIntensity: 0, map: tex });
  em.userData.isWindows = true;
  const wg = new THREE.PlaneGeometry(x1 - x0 - 4, 8 * 3 - 1);
  const wins = new THREE.Group();
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(wg, em); p.position.set((x0 + x1) / 2, 9 + 4 * 3, s * (B - 0.3 + 0.06)); p.rotation.y = s > 0 ? 0 : Math.PI; wins.add(p);
  }
  // hull portholes row
  const set = new LightSet();
  powerNav(L, set, [L / 2 - 50, 46], [-L / 2 + 80, 52], L / 2 - 50, 38, B + 0.6, 12);
  for (let x = -L / 2 + 10; x < L / 2 - 30; x += 3.2) for (const s of [1, -1]) if (r() < 0.6) set.add(x, 5.5, s * (B + 0.05), NAV.warm, 0.9, s * Math.PI / 2, 1.7, 1);
  for (let x = x0; x < x1; x += 6) for (const s of [1, -1]) set.add(x, 9 + 11 * 3 + 0.5, s * (B - 2), NAV.cool, 1.4, 0, 4, 1);    // top deck festoon
  for (let x = -L / 2 + 20; x < L / 2 - 20; x += 5) set.add(x, 10 + Math.sin((x / L) * Math.PI) * 0, 0, NAV.yellow, 0.01, 0, 4, 1);
  const v = finish('cruise', b, set, L, 18 + r() * 3, {});
  v.hullMesh.add(wins); v.mats.push(em); v.windows = em;
  return v;
}
function windowTexture(r) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 256);
  const rows = 8, rh = 256 / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < 256; i++) {
    const on = r() < (j === 3 || j === 0 ? 0.85 : 0.55);
    if (!on) continue;
    const k = 0.6 + r() * 0.4;
    x.fillStyle = r() < 0.15 ? `rgba(200,220,255,${k})` : `rgba(255,${190 + Math.floor(r() * 50)},${120 + Math.floor(r() * 60)},${k})`;
    x.fillRect(i * 4, j * rh + rh * 0.3, 3, rh * 0.45);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function finish(type, b, set, L, speedKn, extra) {
  const mat = stdMat({ roughness: 0.65 });
  const hullMesh = new THREE.Mesh(b.geometry(), mat); hullMesh.name = type + 'Hull';
  const group = new THREE.Group(); group.name = 'vessel:' + type;
  group.add(hullMesh);
  const lights = set.build(); hullMesh.add(lights);
  // foam: bow wave + wake as a flat strip
  const foam = new THREE.Mesh(wakeGeometry(L), wakeMat());
  foam.position.y = 0.05; hullMesh.add(foam);
  return { type, group, hullMesh, lights, length: L, speedKn, mats: [mat], foam, heel: 0, ...extra };
}
let _wakeTex = null;
function wakeMat() {
  if (!_wakeTex) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(255,255,255,0.35)'); g.addColorStop(0.92, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 64);
    const vg = x.createLinearGradient(0, 0, 0, 64); vg.addColorStop(0, 'rgba(0,0,0,1)'); vg.addColorStop(0.5, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = vg; x.fillRect(0, 0, 256, 64);
    _wakeTex = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ map: _wakeTex, transparent: true, depthWrite: false, color: 0xdfe6ea, opacity: 0.7, fog: true });
}
function wakeGeometry(L) {
  // a wedge from the bow aft, widening behind the stern (Kelvin-ish)
  const len = L * 2.2, g = new THREE.PlaneGeometry(len, 1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = (p.getX(i) / len) + 0.5;       // 0 = far aft, 1 = bow
    const half = L * 0.09 + (1 - u) * len * 0.18;
    p.setX(i, L / 2 - (1 - u) * len); p.setY(i, p.getY(i) * 2 * half);
  }
  g.rotateX(-Math.PI / 2);
  return g;
}
function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const VESSEL_BUILDERS = { container: buildContainerShip, tanker: buildTanker, trawler: buildTrawler, yacht: buildYacht, cruise: buildCruiseShip };
