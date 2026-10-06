// HALCYON TIDE — the living ocean around the ship.
//
//   installSeaLife(game) → game.seaLife
//
//   • seabirds: herring gulls circling the stern/wake and riding the funnel updraft by day, a few terns over the bow;
//     instanced, flap/glide/bank animation in the vertex shader, occasionally landing on deck rails near the camera
//   • flying fish skipping away from the bow, with take-off/entry splashes
//   • dolphins riding the bow wave in occasional pod "bursts" (porpoising leaps)
//   • a rare distant whale: spouts, back roll, breach or fluke-up dive
//   • horizon traffic: container ship, tanker, sailing yacht, trawler, another cruise ship (lit at night),
//     moving on plausible courses with COLREGS navigation lights; horn salute when a ship passes close
//   • sargassum weed / foam patches drifting past
//   • funnel exhaust plume drifting aft with the apparent wind
//
// Ship-relative frame: the ship is static; water-borne things drift toward -X at ship speed; air-borne things
// (smoke, birds) are in the ship's apparent-wind frame. Water objects live in env.envGroup (so they roll with the sea).
//
// API: game.seaLife = { birds, vessels, stats(), spawnDolphins(), spawnWhale(dist?, bearingDeg?, mode?), spawnFlyingFish(),
//                       placeVessel(type, x, z, headingDeg), setEnabled(bool), group, waterGroup }
// Bus out: 'sfx' {name:'ship_horn'} on passing, 'sealife:sighting' {kind:'whale'|'dolphins'|'ship', text, x, z}
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { deckY, GRID, SHIP } from '../core/config.js';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { viewInfo, waveHeight, shipSpeed, vnoise } from './envUtil.js';
import { SoftParticles } from './particles.js';
import { VESSEL_BUILDERS } from './vessels.js';

const WY = SHIP.waterY;
const TAU = Math.PI * 2;

export function installSeaLife(game) {
  const S = new SeaLife(game);
  game.seaLife = S;
  game.addSystem({ name: 'seaLife', order: 15, update: (dt) => S.update(dt) });
  game.addSystem({ name: 'seaLifeLate', order: 97, lateUpdate: (dt) => S.lateUpdate(dt) });
  return S;
}

// scratch objects (no per-frame allocations)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

// ── geometry ──────────────────────────────────────────────────────────────
function colGeo(g, col) {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const cc = typeof col === 'function' ? col(g, i) : col; c[i * 3] = cc[0]; c[i * 3 + 1] = cc[1]; c[i * 3 + 2] = cc[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function triGeo(tris, cols, seg = null) {
  // tris: [[ax,ay,az,bx,by,bz,cx,cy,cz], ...]
  const p = [], c = [], s = [];
  tris.forEach((t, i) => { p.push(...t); const cc = cols[i] || cols[0]; for (let k = 0; k < 3; k++) { c.push(...cc); s.push(seg ? seg[i] : 0); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.setAttribute('aSeg', new THREE.Float32BufferAttribute(s, 1));
  g.computeVertexNormals();
  return g;
}
function birdGeometry(span, tern) {
  // local: +X forward, +Y up, +Z right wing. herring gull: white body, pale grey mantle, black tips; tern: paler, black cap
  const k = span / 1.3;
  const W = [0.97, 0.97, 0.96], G = tern ? [0.78, 0.8, 0.83] : [0.6, 0.64, 0.69], B = [0.08, 0.08, 0.09], Y = tern ? [0.85, 0.15, 0.1] : [0.95, 0.78, 0.2], U = [0.9, 0.91, 0.92];
  const T = [], C = [], S = [];
  const add = (tri, col, seg) => { T.push(tri.map(v => v * k)); C.push(col); S.push(seg); };
  // body (double cone): nose .22, tail -.24
  const n = [0.22, 0.02, 0], t = [-0.2, 0.0, 0], up = [0.02, 0.06, 0], dn = [0.0, -0.045, 0], l = [0.0, 0.005, -0.05], r = [0.0, 0.005, 0.05];
  const face = (a, b, c, col) => add([...a, ...b, ...c], col, 0);
  face(n, up, r, W); face(n, r, dn, W); face(n, dn, l, W); face(n, l, up, W);
  face(t, r, up, G); face(t, dn, r, W); face(t, l, dn, W); face(t, up, l, G);
  if (tern) { face(n, [0.12, 0.06, 0], [0.12, 0.03, 0.035], B); face(n, [0.12, 0.03, -0.035], [0.12, 0.06, 0], B); }
  // bill
  face([0.3, 0.015, 0], [0.21, 0.03, 0.012], [0.21, 0.0, 0], Y); face([0.3, 0.015, 0], [0.21, 0.0, 0], [0.21, 0.03, -0.012], Y);
  // tail fan (tern: forked)
  const tf = tern ? [[-0.2, 0, 0.03], [-0.36, 0, 0.09], [-0.28, 0, 0]] : [[-0.18, 0, 0.04], [-0.29, 0, 0.065], [-0.29, 0, 0]];
  for (const s of [1, -1]) {
    const a = [tf[0][0], 0.005, tf[0][2] * s], b = [tf[1][0], 0.005, tf[1][2] * s], c = [tf[2][0], 0.005, 0];
    if (s > 0) { face(a, c, b, W); face(a, b, c, U); } else { face(a, b, c, W); face(a, c, b, U); }
  }
  // wings: inner (seg 1) z .04→.33, outer (seg 2) z .33→.65 (swept, tapering). top grey, underside white.
  for (const s of [1, -1]) {
    const q = (x, z) => [x, 0.01, z * s];
    const inner = [q(0.06, 0.04), q(-0.1, 0.04), q(-0.11, 0.33), q(0.07, 0.33)];
    const outer = [q(0.07, 0.33), q(-0.11, 0.33), q(-0.14, 0.56), q(-0.02, 0.65)];
    const tipA = [q(-0.02, 0.65), q(-0.14, 0.56), q(-0.06, 0.52)];
    const panel = (P, col, seg) => {
      const [a, b, c, d] = P;
      const down = (v) => [v[0], v[1] - 0.004, v[2]];
      if (s > 0) { add([...a, ...d, ...c], col, seg); add([...a, ...c, ...b], col, seg); add([...down(a), ...down(c), ...down(d)], U, seg); add([...down(a), ...down(b), ...down(c)], U, seg); }
      else { add([...a, ...c, ...d], col, seg); add([...a, ...b, ...c], col, seg); add([...down(a), ...down(d), ...down(c)], U, seg); add([...down(a), ...down(c), ...down(b)], U, seg); }
    };
    panel(inner, G, 1);
    panel(outer, G, 2);
    // black tip overlay (slightly above)
    const [a, b, c] = tipA.map(v => [v[0], v[1] + 0.002, v[2]]);
    if (s > 0) add([...a, ...c, ...b], tern ? G : B, 2); else add([...a, ...b, ...c], tern ? G : B, 2);
    if (!tern) { const a2 = [-0.02, 0.0062, 0.65 * s], b2 = [-0.14, 0.0062, 0.56 * s], c2 = [-0.12, 0.0062, 0.5 * s]; if (s > 0) add([...a2, ...c2, ...b2].map((v, i) => v), [0.12, 0.12, 0.13], 2); else add([...a2, ...b2, ...c2], [0.12, 0.12, 0.13], 2); }
  }
  return triGeo(T, C, S);
}
const BIRD_WING = `
  float bSide = sign(position.z + 1e-5);
  float bAz = abs(position.z) / uBirdScale;
  vec3 bp = position / uBirdScale;
  if (aSeg > 0.5) {
    float a1 = aWing.w + aWing.y * sin(aWing.x);
    float a2 = aWing.y * 0.75 * sin(aWing.x - 0.9) - aWing.w * 0.4;
    float c1 = cos(a1), s1 = sin(a1);
    if (aSeg < 1.5) { float r = bAz - 0.04; bp.z = bSide * (0.04 + r * c1); bp.y += r * s1; }
    else { float rh = 0.29; float ro = bAz - 0.33; float c2 = cos(a1 + a2), s2 = sin(a1 + a2);
      bp.z = bSide * (0.04 + rh * c1 + ro * c2); bp.y += rh * s1 + ro * s2; }
    float f = aWing.z;
    bp.x = mix(bp.x, bp.x - (bAz - 0.04) * 0.55, f);
    bp.z = mix(bp.z, bSide * (0.045 + (bAz - 0.04) * 0.08), f);
    bp.y = mix(bp.y, position.y / uBirdScale + 0.035 - (bAz - 0.04) * 0.02, f);
  }
  vec3 transformed = bp * uBirdScale;
`;

function lathe(len, prof, segs, colFn) {
  // prof: [[t (0 tail .. 1 nose), r, yOff, zScale], ...] — axis along +X
  const pts = prof.map(([t, r]) => new THREE.Vector2(Math.max(r, 0.0005), (t - 0.5) * len));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateZ(-Math.PI / 2);      // lathe axis Y → X (nose at +X)
  // vertical offsets / flattening per station
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const t = x / len + 0.5;
    let yo = 0, zs = 1;
    for (let k = 0; k < prof.length - 1; k++) if (t >= prof[k][0] && t <= prof[k + 1][0]) { const u = (t - prof[k][0]) / Math.max(1e-6, prof[k + 1][0] - prof[k][0]); yo = lerp(prof[k][2] || 0, prof[k + 1][2] || 0, u); zs = lerp(prof[k][3] ?? 1, prof[k + 1][3] ?? 1, u); break; }
    p.setY(i, p.getY(i) + yo); p.setZ(i, p.getZ(i) * zs);
  }
  g.computeVertexNormals();
  return colGeo(g, (gg, i) => colFn(gg.attributes.normal.getY(i), gg.attributes.position.getX(i) / len + 0.5, gg.attributes.position.getZ(i)));
}
function finGeo(pts, col) {
  const p = [], c = [];
  for (let i = 1; i < pts.length - 1; i++) { p.push(...pts[0], ...pts[i], ...pts[i + 1]); p.push(...pts[0], ...pts[i + 1], ...pts[i]); }
  for (let i = 0; i < p.length / 3; i++) c.push(...col);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.computeVertexNormals();
  return g;
}
function dolphinGeometry() {
  const L = 2.5, top = [0.11, 0.125, 0.145], belly = [0.62, 0.64, 0.66], mid = [0.3, 0.32, 0.36];
  const body = lathe(L, [[0, 0.03, 0.03, 0.6], [0.08, 0.08, 0.02, 0.7], [0.3, 0.17, 0, 1], [0.6, 0.22, 0.01, 1.05], [0.8, 0.19, 0.02, 1], [0.9, 0.12, 0.0, 1], [0.93, 0.06, -0.03, 1], [1, 0.03, -0.04, 1]], 12,
    (ny, t) => { const k = smoothstep(-0.35, 0.25, ny + (t > 0.85 ? 0.2 : 0)); const c = k < 0.5 ? [lerp(belly[0], mid[0], k * 2), lerp(belly[1], mid[1], k * 2), lerp(belly[2], mid[2], k * 2)] : [lerp(mid[0], top[0], k * 2 - 1), lerp(mid[1], top[1], k * 2 - 1), lerp(mid[2], top[2], k * 2 - 1)]; return c; });
  const dorsal = finGeo([[0.05, 0.18, 0], [-0.28, 0.2, 0], [-0.32, 0.5, 0], [-0.18, 0.4, 0]], top);
  const fl = []; for (const s of [1, -1]) fl.push(finGeo([[0.5, -0.06, s * 0.15], [0.35, -0.08, s * 0.16], [0.18, -0.2, s * 0.44]], mid));
  const fluke = finGeo([[-1.15, 0.03, 0], [-1.36, 0.03, 0.34], [-1.27, 0.03, 0.05], [-1.27, 0.03, -0.05], [-1.36, 0.03, -0.34]], top);
  return mergeGeometries([body, dorsal, ...fl, fluke]);
}
function whaleGeometry() {
  // humpback, 13.5 m: knobbly flattened head, small dorsal hump, 4.2 m white pectorals, 4 m flukes
  const L = 13.5, top = [0.09, 0.1, 0.12], belly = [0.62, 0.63, 0.64];
  const body = lathe(L, [[0, 0.15, 0.1, 0.4], [0.1, 0.45, 0.08, 0.7], [0.35, 1.25, 0, 1], [0.6, 1.6, 0, 1.05], [0.8, 1.35, -0.1, 1.1], [0.93, 0.85, -0.25, 1.15], [1, 0.25, -0.35, 1.2]], 16,
    (ny, t) => { const k = smoothstep(-0.55, -0.1, ny); return [lerp(belly[0], top[0], k), lerp(belly[1], top[1], k), lerp(belly[2], top[2], k)]; });
  const dorsal = finGeo([[-1.6, 1.15, 0], [-2.6, 1.0, 0], [-2.4, 1.55, 0]], top);
  const pecs = []; for (const s of [1, -1]) pecs.push(finGeo([[3.2, -0.7, s * 1.4], [2.4, -0.8, s * 1.45], [0.5, -1.6, s * 5.2], [0.9, -1.45, s * 5.4]], [0.82, 0.83, 0.84]));
  const fluke = finGeo([[-6.3, 0.05, 0], [-7.6, 0.05, 2.1], [-7.2, 0.05, 0.4], [-7.0, 0.05, 0], [-7.2, 0.05, -0.4], [-7.6, 0.05, -2.1]], top);
  return mergeGeometries([body, dorsal, ...pecs, fluke]);
}
function flyingFishGeometry() {
  const L = 0.3, top = [0.12, 0.22, 0.42], belly = [0.82, 0.85, 0.88];
  const body = lathe(L, [[0, 0.004], [0.2, 0.016], [0.6, 0.024], [0.9, 0.016], [1, 0.003]], 8, (ny) => { const k = smoothstep(-0.3, 0.3, ny); return [lerp(belly[0], top[0], k), lerp(belly[1], top[1], k), lerp(belly[2], top[2], k)]; });
  const fin = [0.55, 0.62, 0.72];
  const wings = []; for (const s of [1, -1]) wings.push(finGeo([[0.08, 0.01, s * 0.02], [0.02, 0.012, s * 0.03], [-0.07, 0.018, s * 0.18], [-0.02, 0.016, s * 0.2]], fin));
  const tail = finGeo([[-0.14, 0, 0], [-0.2, 0.05, 0], [-0.17, 0, 0], [-0.21, -0.06, 0]], top);
  return mergeGeometries([body, ...wings, tail]);
}

// ── sargassum / foam texture ─────────────────────────────────────────────
function patchTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  // weed clumps (golden brown) in the left half, foam lace in the right half (atlas 2×1)
  let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 260; i++) {
    const a = r() * TAU, d = Math.pow(r(), 0.6) * 52, px = 64 + Math.cos(a) * d * 1.1, py = 128 + Math.sin(a) * d * 1.6;
    const s = 2 + r() * 6;
    x.fillStyle = `rgba(${150 + r() * 60 | 0},${105 + r() * 40 | 0},${30 + r() * 25 | 0},${0.55 + r() * 0.4})`;
    x.beginPath(); x.ellipse(px, py, s, s * (0.5 + r() * 0.6), r() * 3, 0, TAU); x.fill();
  }
  for (let i = 0; i < 420; i++) {
    const a = r() * TAU, d = Math.pow(r(), 0.8) * 58, px = 192 + Math.cos(a) * d, py = 128 + Math.sin(a) * d * 1.8;
    const s = 1 + r() * 4;
    x.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.5})`; x.lineWidth = 1 + r() * 1.5;
    x.beginPath(); x.arc(px, py, s, 0, TAU * (0.4 + r() * 0.6)); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ── main ──────────────────────────────────────────────────────────────────
class SeaLife {
  constructor(game) {
    this.game = game; this.env = game.env;
    this.enabled = true;
    this.group = new THREE.Group(); this.group.name = 'seaLife';              // ship / air frame
    this.waterGroup = new THREE.Group(); this.waterGroup.name = 'seaLifeWater'; // follows the sea's roll
    game.scene.add(this.group); this.env.envGroup.add(this.waterGroup);
    this.time = 0;
    this._buildParticles();
    this._buildBirds();
    this._buildFish();
    this._buildDolphins();
    this._buildWhale();
    this._buildPatches();
    this._buildVessels();
    this._buildSmoke();
    this.sightings = [];
  }
  setEnabled(on) { this.enabled = !!on; this.group.visible = this.waterGroup.visible = this.enabled; }
  stats() {
    return { birds: this.birds.filter(b => b.state !== 'off').length, perched: this.birds.filter(b => b.state === 'perch').length, fish: this.fish.filter(f => f.on).length,
      dolphins: this.pod.on ? this.pod.n : 0, whale: this.whale.on ? this.whale.mode : null, vessels: this.vessels.filter(v => v.on).map(v => `${v.type}@${Math.round(Math.hypot(v.x, v.z))}m`), patches: this.patches.length };
  }

  _buildParticles() {
    this.splash = new SoftParticles({ max: 360, color: 0xf2f6f8, drag: 0.3, gravity: -9.8, soft: 0.75, noise: 0.8, name: 'seaSplash', renderOrder: 5, lightK: 0.95 });
    this.mist = new SoftParticles({ max: 240, color: 0xf0f3f5, drag: 1.4, gravity: -1.0, soft: 0.9, noise: 1, name: 'whaleSpout', renderOrder: 5, lightK: 0.9 });
    this.waterGroup.add(this.splash.mesh, this.mist.mesh);
  }
  _splash(x, y, z, n, power, size = 0.6) {
    const sp = shipSpeed(this.game);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, h = Math.random();
      this.splash.emit(x + Math.cos(a) * size * 0.3, y, z + Math.sin(a) * size * 0.3, -sp + Math.cos(a) * power * (0.3 + h), power * (0.6 + Math.random() * 0.8), Math.sin(a) * power * (0.3 + h),
        0.5 + Math.random() * 0.7 * Math.sqrt(power / 3), size * 0.4, size * (1.2 + Math.random()), 0.65);
    }
  }

  // ── birds ───────────────────────────────────────────────────────────────
  _buildBirds() {
    const NG = 26, NT = 8, N = NG + NT;
    const mk = (span, tern, n) => {
      const geo = birdGeometry(span, tern);
      const wing = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); wing.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aWing', wing);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
      const sc = span / 1.3;
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = `attribute vec4 aWing; attribute float aSeg; const float uBirdScale = ${sc.toFixed(4)};\n` + sh.vertexShader.replace('#include <begin_vertex>', BIRD_WING);
      };
      mat.customProgramCacheKey = () => 'htbird' + sc.toFixed(3);
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.name = tern ? 'terns' : 'gulls';
      for (let i = 0; i < n; i++) m.setMatrixAt(i, _zero);
      this.group.add(m);
      return { mesh: m, wing };
    };
    this.gullMesh = mk(1.3, false, NG); this.ternMesh = mk(0.85, true, NT);
    this.birds = [];
    for (let i = 0; i < N; i++) {
      const tern = i >= NG;
      const b = {
        i: tern ? i - NG : i, tern, state: 'off', on: false,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0, bank: 0, pitch: 0,
        cx: 0, cy: 0, cz: 0, R: 20, w: 0.2, th: Math.random() * TAU, seed: Math.random() * 100,
        phase: Math.random() * TAU, flapAmp: 0, flapT: 0, fold: 0, glide: 0.12,
        t: 0, dur: 1, p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), p3: new THREE.Vector3(), perch: null, perchT: 0, offT: 0,
      };
      this._assignCircle(b, true);
      this.birds.push(b);
    }
    this.perches = this._findPerches();
    this._perchTimer = 20;
  }
  _assignCircle(b, init) {
    const r = Math.random;
    if (b.tern) { b.cx = 175 + r() * 60; b.cz = (r() - 0.5) * 70; b.cy = 6 + r() * 12; b.R = 10 + r() * 22; b.w = (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.25); }
    else if (r() < 0.22) { b.cx = -125 + r() * 40; b.cz = (r() - 0.5) * 50; b.cy = 50 + r() * 16; b.R = 12 + r() * 20; b.w = (r() < 0.5 ? -1 : 1) * (0.2 + r() * 0.12); }   // funnel updraft
    else if (r() < 0.3) { const s = r() < 0.5 ? -1 : 1; b.cx = -130 + r() * 110; b.cz = s * (30 + r() * 18); b.cy = 14 + r() * 26; b.R = 8 + r() * 14; b.w = (r() < 0.5 ? -1 : 1) * (0.2 + r() * 0.15); }   // soaring alongside in the hull updraft
    else { b.cx = -205 + r() * 55; b.cz = (r() - 0.5) * 60; b.cy = 10 + r() * 26; b.R = 10 + r() * 24; b.w = (r() < 0.5 ? -1 : 1) * (0.16 + r() * 0.18); }   // stern & wake
    if (init) { b.th = r() * TAU; b.pos.set(b.cx + Math.cos(b.th) * b.R, b.cy, b.cz + Math.sin(b.th) * b.R); b.prev.copy(b.pos); }
  }
  _findPerches() {
    const out = [], plans = this.game.world?.plans || this.game.layout?.plans || [];
    const nx = GRID.nx, nz = GRID.nz, c = GRID.cell;
    for (let d = 5; d < plans.length; d++) {
      const p = plans[d]; if (!p || !p.ex) continue;
      const pub = (id) => { const r = p.rooms[id]; return r && r.exterior && !r.pool && r.type !== 'balcony'; };
      let skip = 0;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i, a = p.room[k], bb = p.room[k + 1];
        const e = p.ex[k];
        if ((e === 3 || e === 6) && ((pub(a) && !bb) || (pub(bb) && !a)) && (++skip % 5 === 0)) out.push({ x: GRID.x0 + (i + 1) * c, y: deckY(d) + 1.1, z: GRID.z0 + (j + 0.5) * c, deck: d, taken: false });
        const ez = j < nz - 1 ? p.ez[k] : 0;
        if (j < nz - 1 && (ez === 3 || ez === 6)) { const a2 = p.room[k], b2 = p.room[k + nx]; if (((pub(a2) && !b2) || (pub(b2) && !a2)) && (++skip % 9 === 0)) out.push({ x: GRID.x0 + (i + 0.5) * c, y: deckY(d) + 1.1, z: GRID.z0 + (j + 1) * c, deck: d, taken: false }); }
      }
    }
    return out;
  }
  _updateBirds(dt, act, camOut) {
    const g = this.game, cam = g.camera.position, A = g.weather?.state?.apparent;
    const target = Math.round(this.birds.length * act);
    let active = 0; for (const b of this.birds) if (b.state !== 'off' && b.state !== 'leave') active++;
    // activate / retire
    if (active < target) { const b = this.birds.find(b => b.state === 'off'); if (b) { b.state = 'circle'; this._assignCircle(b, true); b.pos.x -= 150; b.pos.y += 30; b.prev.copy(b.pos); } }
    else if (active > target) { const b = this.birds.find(b => b.state === 'circle'); if (b) { b.state = 'leave'; b.offT = 25; } }
    // occasional perch near the camera
    this._perchTimer -= dt;
    if (this._perchTimer <= 0 && camOut && act > 0.3) {
      this._perchTimer = 25 + Math.random() * 50;
      let best = null, bd = 1e9;
      for (let k = 0; k < 24; k++) {
        const p = this.perches[(Math.random() * this.perches.length) | 0]; if (!p || p.taken) continue;
        const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
        if (d > 12 && d < 90 && d < bd) { bd = d; best = p; }
      }
      const b = best && this.birds.find(b => !b.tern && b.state === 'circle');
      if (b) this._startPath(b, 'land', best);
    }
    const gm = this.gullMesh, tm = this.ternMesh;
    for (const b of this.birds) {
      const M = b.tern ? tm : gm;
      if (b.state === 'off') { M.mesh.setMatrixAt(b.i, _zero); continue; }
      b.prev.copy(b.pos);
      let wantFlap = 0;
      if (b.state === 'circle' || b.state === 'leave') {
        b.th += b.w * dt;
        const n1 = vnoise(this.time * 0.07 + b.seed), n2 = vnoise(this.time * 0.05 + b.seed * 3.1);
        let cx = b.cx + (n1 - 0.5) * 30, cy = b.cy + (n2 - 0.5) * 10 + Math.sin(b.th * 2 + b.seed) * 2.5, cz = b.cz + (n2 - 0.5) * 30;
        if (b.state === 'leave') { b.offT -= dt; cx -= (25 - b.offT) * 14; cy += (25 - b.offT) * 2; if (b.offT <= 0) { b.state = 'off'; continue; } }
        const R = b.R * (0.85 + 0.3 * n1);
        const tx = cx + Math.cos(b.th) * R, ty = cy, tz = cz + Math.sin(b.th) * R;
        // smooth pursuit of the moving target point (keeps velocity continuous)
        const k = 1 - Math.exp(-dt * 1.2);
        b.pos.x += (tx - b.pos.x) * k; b.pos.y += (ty - b.pos.y) * k; b.pos.z += (tz - b.pos.z) * k;
        // terns hover-dive now and then
        if (b.tern && Math.sin(this.time * 0.4 + b.seed * 5) > 0.93) { b.pos.y = lerp(b.pos.y, 2.0 + waveHeight(this.env, b.pos.x, b.pos.z), k * 2); wantFlap = 1; }
        if (b.pos.y < 3) b.pos.y = 3;
      } else if (b.state === 'land' || b.state === 'takeoff') {
        b.t += dt / b.dur;
        const u = Math.min(1, b.t);
        bezier(b.pos, b.p0, b.p1, b.p2, b.p3, b.state === 'land' ? 1 - (1 - u) * (1 - u) : u * u * (3 - 2 * u));
        if (b.state === 'land') { wantFlap = u > 0.7 ? 1.6 : 0.3; b.fold = u > 0.97 ? Math.min(1, b.fold + dt * 3) : 0; }
        else { wantFlap = 1.2; b.fold = Math.max(0, b.fold - dt * 6); }
        if (u >= 1) {
          if (b.state === 'land') { b.state = 'perch'; b.perchT = 20 + Math.random() * 40; b.pos.copy(b.p3); }
          else { b.state = 'circle'; this._assignCircle(b, false); }
        }
      } else if (b.state === 'perch') {
        b.perchT -= dt;
        b.fold = Math.min(1, b.fold + dt * 3);
        b.pos.copy(b.p3);
        // spooked by a nearby player
        const pl = g.player;
        const near = pl && !g.debugCam && Math.hypot(pl.x - b.pos.x, (pl.y ?? 0) + 1 - b.pos.y, pl.z - b.pos.z) < 3.5;
        if (b.perchT <= 0 || near || act < 0.15) this._startPath(b, 'takeoff', null);
      }
      // velocity → orientation
      if (dt > 0) { b.vel.subVectors(b.pos, b.prev).multiplyScalar(1 / dt); }
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (b.state === 'perch') { b.yaw = dampAng(b.yaw, A ? Math.atan2(-A.z, -A.x) : 0, dt * 2); b.bank = 0; b.pitch = 0.05; }   // face into the apparent wind
      else if (sp > 0.3) {
        const ny = Math.atan2(b.vel.z, b.vel.x);
        const dyaw = angDiff(b.yaw, ny);
        b.yaw = dampAng(b.yaw, ny, dt * 4);
        const turn = dt > 0 ? dyaw / Math.max(dt, 1e-3) : 0;
        b.bank = lerp(b.bank, clamp(-turn * sp * 0.08, -0.7, 0.7), 1 - Math.exp(-dt * 3));
        b.pitch = lerp(b.pitch, clamp(Math.atan2(b.vel.y, sp) * 0.7, -0.5, 0.5), 1 - Math.exp(-dt * 3));
      }
      // flap: when climbing, slow, or commanded; otherwise glide (gulls ride the ship's updraft)
      const climb = b.vel.y > 0.8 ? 1 : 0;
      const flap = Math.max(wantFlap, climb, b.flapT > 0 ? 1 : 0);
      b.flapT -= dt;
      if (b.flapT < -6 - (b.seed % 5) && Math.random() < dt * 0.15) b.flapT = 1.2 + Math.random() * 2;
      const amp = b.fold > 0.5 ? 0 : flap * (b.tern ? 0.75 : 0.62);
      b.flapAmp = lerp(b.flapAmp, amp, 1 - Math.exp(-dt * 5));
      const freq = b.tern ? 3.6 : 2.7;
      b.phase = (b.phase + dt * TAU * freq * (b.flapAmp > 0.05 ? 1 : 0.2)) % (TAU * 100);
      const glide = 0.1 + 0.08 * Math.sin(this.time * 0.6 + b.seed);
      const wi = b.i * 4;
      M.wing.array[wi] = b.phase; M.wing.array[wi + 1] = b.flapAmp; M.wing.array[wi + 2] = b.fold; M.wing.array[wi + 3] = b.fold > 0.5 ? 0 : glide * (1 - b.flapAmp);
      _e.set(b.bank, -b.yaw, b.pitch, 'YZX');
      // Euler YZX: yaw about Y, then pitch about Z, then bank about X
      _q.setFromEuler(_e);
      _m.compose(b.pos, _q, _s);
      M.mesh.setMatrixAt(b.i, _m);
    }
    for (const M of [gm, tm]) { M.mesh.instanceMatrix.needsUpdate = true; M.wing.needsUpdate = true; }
  }
  _startPath(b, kind, perch) {
    b.state = kind; b.t = 0;
    b.p0.copy(b.pos);
    if (kind === 'land') {
      perch.taken = true; b.perch = perch;
      b.p3.set(perch.x, perch.y, perch.z);
      b.dur = 4 + Math.random() * 2;
      b.p1.copy(b.pos).addScaledVector(b.vel, b.dur * 0.3);
      b.p2.set(perch.x - 8, perch.y + 2.5, perch.z + (perch.z > 0 ? 6 : -6));
    } else {
      if (b.perch) b.perch.taken = false; b.perch = null;
      b.dur = 4;
      const s = b.pos.z >= 0 ? 1 : -1;
      b.p1.set(b.pos.x - 1, b.pos.y + 0.6, b.pos.z + s * 2);
      b.p2.set(b.pos.x - 12, b.pos.y + 3, b.pos.z + s * 12);
      b.p3.set(b.pos.x - 30, b.pos.y + 8, b.pos.z + s * 26);
    }
  }

  // ── flying fish ─────────────────────────────────────────────────────────
  _buildFish() {
    const N = 28;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.35, side: THREE.DoubleSide });
    this.fishMesh = new THREE.InstancedMesh(flyingFishGeometry(), mat, N);
    this.fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.fishMesh.frustumCulled = false; this.fishMesh.name = 'flyingFish';
    for (let i = 0; i < N; i++) this.fishMesh.setMatrixAt(i, _zero);
    this.waterGroup.add(this.fishMesh);
    this.fish = []; for (let i = 0; i < N; i++) this.fish.push({ on: false, x: 0, z: 0, h: 0, vx: 0, vz: 0, t: 0, life: 0, hop: 0, yaw: 0 });
    this._fishT = 6;
  }
  spawnFlyingFish(n = 3 + Math.floor(Math.random() * 6)) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const bx = 168 + Math.random() * 70, bz = side * (14 + Math.random() * 30);
    for (const f of this.fish) {
      if (f.on) continue; if (n-- <= 0) break;
      const ang = side * (0.5 + Math.random() * 0.9);
      const v = 13 + Math.random() * 6;
      f.on = true; f.x = bx + (Math.random() - 0.5) * 10; f.z = bz + (Math.random() - 0.5) * 8; f.vx = Math.cos(ang) * v; f.vz = Math.sin(ang) * v;
      f.t = -Math.random() * 1.2; f.life = 2 + Math.random() * 3.5; f.hop = Math.random() < 0.35 ? f.life * (0.4 + Math.random() * 0.3) : -1; f.yaw = Math.atan2(f.vz, f.vx); f.started = false;
    }
  }
  _updateFish(dt, act) {
    const sp = shipSpeed(this.game);
    this._fishT -= dt;
    if (this._fishT <= 0) { this._fishT = 5 + Math.random() * 18; if (act > 0.2) this.spawnFlyingFish(); }
    const M = this.fishMesh;
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      if (!f.on) { M.setMatrixAt(i, _zero); continue; }
      f.t += dt;
      if (f.t < 0) { M.setMatrixAt(i, _zero); continue; }
      // ship-relative drift: world velocity minus ship velocity
      f.x += (f.vx * (1 - f.t * 0.05) - sp) * dt; f.z += f.vz * (1 - f.t * 0.05) * dt;
      const w = waveHeight(this.env, f.x, f.z);
      if (!f.started) { f.started = true; this._splash(f.x, WY + w, f.z, 4, 1.5, 0.25); }
      // height profile: quick launch, long glide, optional tail-taxi touch-down
      const u = f.t / f.life;
      let h = smoothstep(0, 0.12, u) * (1 - smoothstep(0.85, 1, u)) * (0.9 + 0.3 * Math.sin(u * 3.1));
      if (f.hop > 0) { const d = Math.abs(f.t - f.hop); if (d < 0.25) h *= d / 0.25; if (d < 0.02 && !f.hopped) { f.hopped = true; this._splash(f.x, WY + w, f.z, 3, 1.2, 0.2); } }
      f.h = h;
      const pitch = (f.t / f.life < 0.12 ? 0.25 : f.t / f.life > 0.85 ? -0.3 : 0);
      if (f.t >= f.life) { f.on = false; f.hopped = false; this._splash(f.x, WY + w, f.z, 5, 1.6, 0.3); M.setMatrixAt(i, _zero); continue; }
      _e.set(0, -f.yaw, pitch, 'YZX'); _q.setFromEuler(_e);
      _p.set(f.x, WY + w + h + 0.05, f.z);
      _m.compose(_p, _q, _s); M.setMatrixAt(i, _m);
    }
    M.instanceMatrix.needsUpdate = true;
  }

  // ── dolphins ────────────────────────────────────────────────────────────
  _buildDolphins() {
    const N = 8;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.0 });
    this.dolMesh = new THREE.InstancedMesh(dolphinGeometry(), mat, N);
    this.dolMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.dolMesh.frustumCulled = false; this.dolMesh.name = 'dolphins';
    for (let i = 0; i < N; i++) this.dolMesh.setMatrixAt(i, _zero);
    this.waterGroup.add(this.dolMesh);
    this.dol = []; for (let i = 0; i < N; i++) this.dol.push({ ax: 0, az: 0, x: 0, z: 0, next: 0, t: -1, T: 1.2, H: 1, seed: Math.random() * 50 });
    this.pod = { on: false, t: 0, dur: 0, n: 0, next: 60 + Math.random() * 120 };
  }
  spawnDolphins(n = 4 + Math.floor(Math.random() * 5)) {
    const P = this.pod;
    P.on = true; P.t = 0; P.dur = 70 + Math.random() * 90; P.n = Math.min(n, this.dol.length);
    for (let i = 0; i < P.n; i++) {
      const d = this.dol[i];
      const ahead = i < 3;
      d.ax = ahead ? 168 + Math.random() * 22 : 125 + Math.random() * 40;
      const side = i % 2 ? 1 : -1;
      d.az = ahead ? side * (1 + Math.random() * 6) : side * (bowHalf(d.ax) + 2 + Math.random() * 6);
      d.x = d.ax - 60 - Math.random() * 30; d.z = d.az + side * 20;   // swim in from aft-outboard
      d.next = 0.3 + Math.random() * 2.5; d.t = -1;
    }
    this.game.bus.emit('sealife:sighting', { kind: 'dolphins', text: 'Dolphins riding the bow wave!', x: 165, z: 0 });
  }
  _updateDolphins(dt, act) {
    const P = this.pod, M = this.dolMesh;
    P.next -= dt;
    if (!P.on && P.next <= 0) { P.next = 180 + Math.random() * 300; if (act > 0.3) this.spawnDolphins(); }
    if (!P.on) { if (this._dolShown) { for (let i = 0; i < this.dol.length; i++) M.setMatrixAt(i, _zero); M.instanceMatrix.needsUpdate = true; this._dolShown = false; } return; }
    P.t += dt;
    const leaving = P.t > P.dur;
    let any = false;
    for (let i = 0; i < this.dol.length; i++) {
      const d = this.dol[i];
      if (i >= P.n) { M.setMatrixAt(i, _zero); continue; }
      // ship-relative position: converge on the slot, wander a little; when leaving, peel off outward and fall astern
      const tx = leaving ? d.ax - (P.t - P.dur) * 6 : d.ax + Math.sin(this.time * 0.13 + d.seed) * 5;
      const tz = leaving ? d.az + Math.sign(d.az || 1) * (P.t - P.dur) * 3 : d.az + Math.sin(this.time * 0.21 + d.seed * 2) * 1.8;
      const k = 1 - Math.exp(-dt * 0.35);
      const px = d.x, pz = d.z;
      d.x += (tx - d.x) * k; d.z += (tz - d.z) * k;
      if (d.x < 162) { const hb = bowHalf(d.x) + 1.6, sgn = d.z >= 0 ? 1 : -1; if (Math.abs(d.z) < hb) d.z = sgn * hb; }   // never inside the hull
      const dirx = (d.x - px) / Math.max(dt, 1e-3) + shipSpeed(this.game), dirz = (d.z - pz) / Math.max(dt, 1e-3);   // through-water velocity
      const yaw = Math.atan2(dirz, dirx);
      d.next -= dt;
      if (d.t < 0 && d.next <= 0 && !(leaving && P.t - P.dur > 25)) { const big = Math.random() < 0.3; d.t = 0; d.T = big ? 1.1 + Math.random() * 0.5 : 0.7 + Math.random() * 0.3; d.H = big ? 0.8 + Math.random() * 1.0 : 0.05 + Math.random() * 0.3; }
      const w = waveHeight(this.env, d.x, d.z);
      if (d.t >= 0) {
        d.t += dt;
        const u = d.t / d.T;
        if (u >= 1) { d.t = -1; d.next = 0.6 + Math.random() * 2.2; if (d.H > 0.5) this._splash(d.x + 0.8, WY + w, d.z, 7, 2.2, 0.5); M.setMatrixAt(i, _zero); continue; }
        if (d.t - dt <= 0) this._splash(d.x + 1.2, WY + w, d.z, d.H > 0.5 ? 6 : 2, d.H > 0.5 ? 2.0 : 1.0, 0.45);
        const depth = d.H > 0.5 ? 0.9 : 0.5;
        const y = WY + w - depth + (d.H + depth) * 4 * u * (1 - u);
        const vy = (d.H + depth) * 4 * (1 - 2 * u) / d.T;
        const pitch = Math.atan2(vy, 10);
        _e.set(Math.sin(d.seed + this.time) * 0.08, -yaw, pitch, 'YZX'); _q.setFromEuler(_e);
        _p.set(d.x, y, d.z); _m.compose(_p, _q, _s); M.setMatrixAt(i, _m); any = true;
      } else {
        // just under the surface: dorsal fin may cut the water
        _e.set(0, -yaw, 0, 'YZX'); _q.setFromEuler(_e);
        _p.set(d.x, WY + w - 0.32 + Math.sin(this.time * 1.7 + d.seed) * 0.08, d.z); _m.compose(_p, _q, _s); M.setMatrixAt(i, _m); any = true;
      }
    }
    M.instanceMatrix.needsUpdate = true; this._dolShown = true;
    if (leaving && P.t - P.dur > 40) { P.on = false; }
  }

  // ── whale ───────────────────────────────────────────────────────────────
  _buildWhale() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide });
    this.whaleMesh = new THREE.Mesh(whaleGeometry(), mat); this.whaleMesh.visible = false; this.whaleMesh.name = 'whale';
    this.whaleMesh.matrixAutoUpdate = false;
    this.waterGroup.add(this.whaleMesh);
    this.whale = { on: false, t: 0, x: 0, z: 0, yaw: 0, mode: null, next: 400 + Math.random() * 600, blows: [], phaseT: 0 };
  }
  spawnWhale(dist = 350 + Math.random() * 900, bearingDeg = (Math.random() - 0.5) * 300, mode = Math.random() < 0.45 ? 'breach' : 'fluke') {
    const W = this.whale, a = bearingDeg * Math.PI / 180;
    W.on = true; W.t = 0; W.mode = mode; W.x = Math.cos(a) * dist; W.z = Math.sin(a) * dist;
    W.yaw = Math.random() * TAU;
    W.blows = [2, 18, 34]; W.seq = mode === 'breach' ? [[0, 'surf'], [40, 'breach'], [50, 'gone']] : [[0, 'surf'], [42, 'fluke'], [52, 'gone']];
    this.game.bus.emit('sealife:sighting', { kind: 'whale', text: 'There she blows! A whale off the ' + (W.z > 0 ? 'starboard' : 'port') + (W.x > 0 ? ' bow' : W.x < -150 ? ' quarter' : ' beam') + '.', x: W.x, z: W.z });
  }
  _updateWhale(dt, act) {
    const W = this.whale, sp = shipSpeed(this.game);
    W.next -= dt;
    if (!W.on && W.next <= 0) { W.next = 900 + Math.random() * 900; if (act > 0.4) this.spawnWhale(); }
    if (!W.on) { this.whaleMesh.visible = false; return; }
    W.t += dt;
    // the whale cruises slowly; the ship leaves it astern
    const ws = 2.0;
    W.x += (Math.cos(W.yaw) * ws - sp) * dt; W.z += Math.sin(W.yaw) * ws * dt;
    const w = waveHeight(this.env, W.x, W.z);
    // blows
    for (let k = 0; k < W.blows.length; k++) if (W.blows[k] >= 0 && W.t >= W.blows[k]) { W.blows[k] = -1; this._blow(W.x + Math.cos(W.yaw) * 4.5, WY + w + 0.8, W.z + Math.sin(W.yaw) * 4.5); }
    let phase = 'surf', pt = W.t; for (const [t0, ph] of W.seq) if (W.t >= t0) { phase = ph; pt = W.t - t0; }
    let y = WY + w - 3, pitch = 0, roll = 0, vis = false;
    if (phase === 'surf') {
      // roll the back through the surface after each blow
      let k = 0; for (const b of [2, 18, 34]) { const u = (W.t - b) / 6; if (u > 0 && u < 1) k = Math.max(k, Math.sin(u * Math.PI)); }
      y = WY + w - 1.55 + k * 0.6; pitch = -0.05 + (k > 0 ? 0.06 * Math.cos(k * Math.PI) : 0); vis = k > 0.05;
    } else if (phase === 'breach') {
      const T = 4.6, u = pt / T;
      if (u < 1) {
        vis = true;
        const h = 4 * u * (1 - u);
        y = WY + w - 9 + 13.5 * h; pitch = lerp(1.25, -0.2, smoothstep(0.15, 0.95, u)); roll = u * 1.5;
        if (pt - dt <= 0.35 && pt > 0.35) this._splash(W.x, WY + w, W.z, 30, 6, 2.5);
        if (u > 0.8 && !W.splashed) { W.splashed = true; this._splash(W.x, WY + w, W.z, 80, 9, 4); this._splash(W.x + 5, WY + w, W.z, 40, 6, 3); }
      }
    } else if (phase === 'fluke') {
      const T = 7, u = pt / T;
      if (u < 1) { vis = true; pitch = -lerp(0.2, 1.35, smoothstep(0, 0.6, u)); y = WY + w - 1.6 - u * 7; if (u > 0.55 && !W.splashed) { W.splashed = true; this._splash(W.x - Math.cos(W.yaw) * 7, WY + w, W.z - Math.sin(W.yaw) * 7, 14, 2.5, 1.2); } }
    } else if (phase === 'gone') { W.on = false; W.splashed = false; }
    this.whaleMesh.visible = vis && W.on;
    if (this.whaleMesh.visible) {
      _e.set(roll, -W.yaw, pitch, 'YZX'); _q.setFromEuler(_e);
      _p.set(W.x, y, W.z); this.whaleMesh.matrix.compose(_p, _q, _s);
    }
  }
  _blow(x, y, z) {
    const sp = shipSpeed(this.game);
    // humpback blow: bushy 3–4 m column; particles move with the air (apparent wind drift set per frame)
    for (let i = 0; i < 36; i++) this.mist.emit(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.5, 7 + Math.random() * 5, (Math.random() - 0.5) * 1.5, 2.5 + Math.random() * 2.5, 0.6, 3 + Math.random() * 3, 0.55);
    this.game.bus.emit('sealife:sighting', { kind: 'whale', text: 'Whale spout', x, z, minor: true });
  }

  // ── sargassum & foam patches ────────────────────────────────────────────
  _buildPatches() {
    const N = 56;
    const tex = patchTexture();
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const uvOff = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    geo.setAttribute('aAtlas', uvOff);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aAtlas;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vec2(vMapUv.x * 0.5 + aAtlas * 0.5, vMapUv.y);\n#endif');
    };
    mat.customProgramCacheKey = () => 'htpatch';
    this.patchMesh = new THREE.InstancedMesh(geo, mat, N);
    this.patchMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.patchMesh.frustumCulled = false; this.patchMesh.renderOrder = 1; this.patchMesh.name = 'seaPatches';
    this.waterGroup.add(this.patchMesh);
    this.patches = [];
    for (let i = 0; i < N; i++) { const p = { x: 0, z: 0, s: 1, rot: 0, kind: 0 }; this._placePatch(p, true); this.patches.push(p); uvOff.array[i] = p.kind; }
    this.patchAtlas = uvOff;
  }
  _placePatch(p, init) {
    const cam = this.game.camera.position;
    const R = 600;
    if (init) { p.x = cam.x + (Math.random() - 0.5) * 2 * R; }
    else p.x = cam.x + R * (0.8 + Math.random() * 0.2);
    p.z = cam.z + (Math.random() - 0.5) * 2 * R;
    // never inside the hull footprint or the wake centre
    if (Math.abs(p.z) < 26 && p.x > -175 && p.x < 170) p.z = (p.z < 0 ? -1 : 1) * (26 + Math.random() * 40);
    p.kind = Math.random() < 0.65 ? 0 : 1;
    p.s = p.kind ? 2 + Math.random() * 5 : 1.2 + Math.random() * 4.5;
    p.rot = Math.random() * TAU;
    p.sx = 0.6 + Math.random() * 0.9;
  }
  _updatePatches(dt, show) {
    const M = this.patchMesh;
    M.visible = show;
    if (!show) return;
    const cam = this.game.camera.position, sp = shipSpeed(this.game);
    let atlasDirty = false;
    for (let i = 0; i < this.patches.length; i++) {
      const p = this.patches[i];
      p.x -= sp * dt;
      if (p.x < cam.x - 620 || Math.abs(p.z - cam.z) > 650 || p.x > cam.x + 700) { this._placePatch(p, false); this.patchAtlas.array[i] = p.kind; atlasDirty = true; }
      const w = waveHeight(this.env, p.x, p.z);
      _e.set(0, p.rot, 0, 'YZX'); _q.setFromEuler(_e);
      _p.set(p.x, WY + w + 0.03, p.z); _v.set(p.s, 1, p.s * p.sx);
      _m.compose(_p, _q, _v); M.setMatrixAt(i, _m);
    }
    M.instanceMatrix.needsUpdate = true;
    if (atlasDirty) this.patchAtlas.needsUpdate = true;
  }

  // ── horizon traffic ─────────────────────────────────────────────────────
  _buildVessels() {
    this.vessels = [];
    let seed = 11;
    for (const type of ['container', 'tanker', 'yacht', 'trawler', 'cruise', 'container']) {
      const v = VESSEL_BUILDERS[type](seed++ * 7919);
      v.group.visible = false;
      this.waterGroup.add(v.group);
      Object.assign(v, { on: false, x: 0, z: 0, hd: 0, rvx: 0, rvz: 0, speed: v.speedKn * 0.5144, hailed: false, bob: Math.random() * 10, invLocal: new THREE.Matrix4() });
      this.vessels.push(v);
    }
    this._vesselT = 5;
    // start with two ships already on the horizon
    this._spawnVessel(true); this._spawnVessel(true);
  }
  _vesselWeights() {
    const night = this.env.nightK ?? 0, W = this.env.weather;
    return { container: 1.3, tanker: 0.9, yacht: (1 - night) * (W.wind < 0.75 && W.storm < 0.3 ? 0.8 : 0), trawler: 0.5 * (W.storm < 0.6 ? 1 : 0), cruise: 0.25 + night * 1.6 };
  }
  _spawnVessel(midway = false, forceType = null) {
    const wts = this._vesselWeights();
    const free = this.vessels.filter(v => !v.on && (!forceType || v.type === forceType));
    if (!free.length) return null;
    let tot = 0; for (const v of free) tot += wts[v.type] ?? 0.5;
    let r = Math.random() * tot, v = free[0];
    for (const f of free) { r -= wts[f.type] ?? 0.5; if (r <= 0) { v = f; break; } }
    if (!forceType && (wts[v.type] ?? 0) <= 0) return null;
    // course: mostly reciprocal (westbound), some same-direction slower traffic, some crossing
    const sp = shipSpeed(this.game);
    let hd;
    for (let tries = 0; tries < 6; tries++) {
      const r2 = Math.random();
      hd = r2 < 0.6 ? Math.PI + (Math.random() - 0.5) * 0.5 : r2 < 0.8 ? (Math.random() - 0.5) * 0.4 : (Math.random() < 0.5 ? 1 : -1) * (1.1 + Math.random() * 0.9);
      const rvx = Math.cos(hd) * v.speed - sp, rvz = Math.sin(hd) * v.speed;
      if (Math.hypot(rvx, rvz) > 3) break;
    }
    this._launch(v, hd, 1600 + Math.random() * 5500, Math.random() < 0.5 ? 1 : -1, midway ? 0.15 + Math.random() * 0.6 : 0);
    return v;
  }
  _launch(v, hd, cpa, side, frac) {
    const sp = shipSpeed(this.game);
    v.hd = hd; v.rvx = Math.cos(hd) * v.speed - sp; v.rvz = Math.sin(hd) * v.speed;
    const rl = Math.hypot(v.rvx, v.rvz) || 1, ux = v.rvx / rl, uz = v.rvz / rl;
    const nx = -uz * side, nz = ux * side;
    const L0 = Math.sqrt(Math.max(0, 9000 * 9000 - cpa * cpa));
    const s = -L0 + frac * 2 * L0;
    v.x = nx * cpa + ux * s; v.z = nz * cpa + uz * s;
    v.on = true; v.hailed = false; v.cpa = cpa;
    v.group.visible = true;
  }
  placeVessel(type, x, z, headingDeg = 180) {
    const v = this.vessels.find(v => v.type === type && !v.on) || this.vessels.find(v => v.type === type);
    if (!v) return null;
    const sp = shipSpeed(this.game);
    v.hd = headingDeg * Math.PI / 180; v.rvx = Math.cos(v.hd) * v.speed - sp; v.rvz = Math.sin(v.hd) * v.speed;
    v.x = x; v.z = z; v.on = true; v.hailed = false; v.group.visible = true;
    return v;
  }
  _updateVessels(dt, show) {
    const g = this.game, cam = g.camera, env = this.env;
    let n = 0; for (const v of this.vessels) if (v.on) n++;
    this._vesselT -= dt;
    if (this._vesselT <= 0) { this._vesselT = 40 + Math.random() * 90; if (n < 3) this._spawnVessel(false); }
    const night = env.nightK ?? 0, W = env.weather;
    const nav = clamp(smoothstep(0.25, 0.6, night) + smoothstep(0.35, 0.6, W.fog) + smoothstep(0.5, 0.9, W.rain), 0, 1);
    const pxPerM = g.renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
    // camera in waterGroup-local coordinates
    _v2.copy(cam.position); this.waterGroup.worldToLocal(_v2);
    for (const v of this.vessels) {
      if (!v.on) continue;
      const px0 = v.x * v.rvx + v.z * v.rvz;
      v.x += v.rvx * dt; v.z += v.rvz * dt;
      const d = Math.hypot(v.x, v.z);
      // passing: closest point of approach crossed
      const px1 = v.x * v.rvx + v.z * v.rvz;
      if (px0 < 0 && px1 >= 0 && !v.hailed) {
        v.hailed = true;
        if (d < 3800 && (v.type === 'cruise' || Math.random() < 0.35) && !g.schedule?.isOn?.('muster')) {
          g.bus.emit('sfx', { name: 'ship_horn', dur: 3.2, x: -111, y: 58, z: 0, vol: 0.85, salute: true });
          const delay = 3.8 + d / 343;
          this._pendingHorn = { t: delay, x: v.x, z: v.z };
          g.bus.emit('sealife:sighting', { kind: 'ship', text: `${shipName(v.type)} passing ${v.z > 0 ? 'to starboard' : 'to port'}`, x: v.x, z: v.z });
        }
      }
      if (d > 9600 && px1 > 0) { v.on = false; v.group.visible = false; continue; }
      if (!show) { v.group.visible = false; continue; }
      // distance compression around the camera so the vessel stays inside the far plane and the ocean disc
      const dx = v.x - _v2.x, dz = v.z - _v2.z, dc = Math.hypot(dx, dz);
      const k = Math.min(1, 3400 / Math.max(1, dc));
      v.bob += dt;
      const small = v.length < 50;
      const roll = small ? Math.sin(v.bob * 0.9) * (0.04 + W.wind * 0.08) + (v.heel || 0) * (0.5 + W.wind) : Math.sin(v.bob * 0.21) * 0.01 * (1 + W.storm * 3);
      const pitch = small ? Math.sin(v.bob * 1.3 + 1) * (0.02 + W.wind * 0.05) : Math.sin(v.bob * 0.17) * 0.004 * (1 + W.storm * 3);
      v.group.visible = true;
      v.group.position.set(_v2.x + dx * k, WY + (small ? waveHeight(env, v.x, v.z) * 0.6 * k : 0), _v2.z + dz * k);
      v.group.rotation.set(roll, -v.hd, pitch, 'YZX');
      v.group.scale.setScalar(k);
      // fog / light uniforms
      for (const m of v.mats) if (m.userData.fogScale) m.userData.fogScale.value = 1 / k;
      if (v.windows) v.windows.emissiveIntensity = smoothstep(0.2, 0.7, night) * 1.5;
      const U = v.lights.material.uniforms;
      v.group.updateMatrixWorld();
      v.invLocal.copy(v.hullMesh.matrixWorld).invert();
      U.uCamLocal.value.copy(cam.position).applyMatrix4(v.invLocal);
      U.uNav.value = nav; U.uNight.value = smoothstep(0.25, 0.7, night); U.uPx.value = pxPerM * k;
      U.uFogD.value = env.fog.density; U.uFogScale.value = 1 / k;
      v.foam.material.opacity = (0.55 - night * 0.35) * (small ? 0.6 : 1);
      v.foam.visible = d < 6000;
    }
    if (this._pendingHorn) { this._pendingHorn.t -= dt; if (this._pendingHorn.t <= 0) { const h = this._pendingHorn; this._pendingHorn = null; g.bus.emit('sfx', { name: 'ship_horn', dur: 3, x: h.x, y: 30, z: h.z, vol: 0.35, reply: true }); } }
  }

  // ── funnel plume ────────────────────────────────────────────────────────
  _buildSmoke() {
    this.smoke = new SoftParticles({ max: 360, color: 0x6f6d6a, drag: 0.5, gravity: 0, rise: 0.8, soft: 1.0, noise: 1.0, fadeIn: 0.01, thin: 0.8, name: 'funnelSmoke', renderOrder: 4, lightK: 0.7 });
    this.group.add(this.smoke.mesh);
    this._smokeAcc = 0;
    this.exhaust = [[-111, 58.6, -2.5], [-111, 58.6, 0], [-111, 58.6, 2.5]];
  }
  _updateSmoke(dt) {
    const A = this.game.weather?.state?.apparent;
    const ax = A ? A.x : -shipSpeed(this.game), az = A ? A.z : 0;
    this.smoke.drift.set(ax * 0.9, 0, az * 0.9);
    const W = this.env.weather;
    let prewarm = 0;
    if (!this._smokeWarm) { this._smokeWarm = true; prewarm = 22; this._smokeAcc += 16 * 20; }
    this._smokeAcc += dt * 20;
    while (this._smokeAcc > 1) {
      this._smokeAcc -= 1;
      const age = prewarm > 0 ? (this._smokeAcc / 20) : 0;
      const e = this.exhaust[(Math.random() * 3) | 0];
      // exit velocity ~6 m/s up; the plume bends over quickly in the 20+ kn apparent wind
      // turbulent eddies: random lateral/vertical kicks so the plume breaks up into puffs instead of a tube
      const tk = 1.2 + Math.random() * 2.2;
      this.smoke.emit(e[0] + (Math.random() - 0.5) * 0.8, e[1], e[2] + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * tk, 4.5 + Math.random() * 3, (Math.random() - 0.5) * tk * 1.4,
        10 + Math.random() * 8, 2.2 + Math.random() * 0.8, 12 + Math.random() * 14, (0.18 + Math.random() * 0.12) * (1 - W.rain * 0.5), age);
    }
  }

  // ── tick ────────────────────────────────────────────────────────────────
  update(dt) {
    if (!this.enabled) return;
    this.time += dt;
  }
  lateUpdate(dt) {
    if (!this.enabled) return;
    const g = this.game, env = this.env, W = env.weather;
    const V = viewInfo(g);
    const camOut = V.outside > 0;
    const day = 1 - smoothstep(0.35, 0.8, env.nightK ?? 0);
    const calm = 1 - smoothstep(0.45, 0.9, Math.max(W.storm, W.rain * 0.8));
    const seaOk = 1 - smoothstep(0.6, 0.95, W.wind + W.storm * 0.5);
    const cam = g.camera.position;
    const nearBow = cam.x > 40 || V.exterior;
    // birds by day in moderate weather (always simulated so they're in place when the camera steps outside)
    this.gullMesh.mesh.visible = this.ternMesh.mesh.visible = camOut;
    this._updateBirds(dt, day * calm * (0.4 + 0.6 * seaOk), camOut);
    this.fishMesh.visible = camOut && nearBow;
    this._updateFish(dt, day * seaOk * (camOut ? 1 : 0));
    this.dolMesh.visible = camOut;
    this._updateDolphins(dt, day * seaOk);
    this._updateWhale(dt, day * seaOk);
    this._updatePatches(dt, camOut && W.storm < 0.7);
    this._updateVessels(dt, camOut);
    this._updateSmoke(dt);
    const A = g.weather?.state?.apparent;
    this.mist.drift.set(A ? A.x : -shipSpeed(g), 0, A ? A.z : 0);
    this.splash.update(dt, env); this.mist.update(dt, env); this.smoke.update(dt, env);
    this.splash.mesh.visible = this.splash.mesh.visible && camOut;
  }
}

function shipName(t) { return { container: 'A container ship', tanker: 'A tanker', yacht: 'A sailing yacht', trawler: 'A fishing trawler', cruise: 'Another cruise ship' }[t] || 'A ship'; }
function bowHalf(x) { const bs = 82, sx = 158; if (x > sx) return 0.5; let h = 20.5; if (x > bs) { const t = (x - bs) / (sx - bs); h *= Math.pow(Math.max(0, 1 - Math.pow(t, 1.9)), 0.62); } return h; }
function bezier(out, a, b, c, d, t) {
  const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  out.set(a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3, a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3, a.z * w0 + b.z * w1 + c.z * w2 + d.z * w3);
}
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function dampAng(a, b, k) { return a + angDiff(a, b) * (1 - Math.exp(-k)); }
