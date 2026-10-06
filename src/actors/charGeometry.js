// Procedural geometry for the instanced character system. Every geometry is indexed and carries
// `position`, `normal`, `aV` (colour-zone coordinate 0..1; for hair: shading 0..1), `aAO` (baked cavity
// darkening 0..1) and `uv` (face projection on the head, strand coordinates on hair, 2 elsewhere).
// Reference body: 1.75 m adult male, build 1.0; parts are scaled per instance.
// buildPartGeometries(lod) — lod 0: close-up set (~3–5k tris per character), lod 1: far set (~1k).
import * as THREE from 'three';

const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lin = (y, y0, y1, v0, v1) => v0 + (v1 - v0) * clamp((y - y0) / (y1 - y0), 0, 1);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));

// ---------- low-level builders ----------
class GB { // geometry builder
  constructor() { this.p = []; this.n = []; this.v = []; this.uv = []; this.ao = []; this.i = []; }
  get count() { return this.p.length / 3; }
  add(geo, vfn = null, xf = null, keepUV = false) {
    const g = geo; const base = this.count;
    if (xf) g.applyMatrix4(xf);
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal, UV = keepUV ? g.attributes.uv : null, AV = g.attributes.aV, AO = g.attributes.aAO;
    for (let k = 0; k < P.count; k++) {
      const x = P.getX(k), y = P.getY(k), z = P.getZ(k);
      this.p.push(x, y, z); this.n.push(N.getX(k), N.getY(k), N.getZ(k));
      this.uv.push(UV ? UV.getX(k) : 2, UV ? UV.getY(k) : 2);
      this.v.push(vfn !== null && vfn !== undefined ? (typeof vfn === 'number' ? vfn : vfn(x, y, z)) : AV ? AV.getX(k) : 0);
      this.ao.push(AO ? AO.getX(k) : 1);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) this.i.push(base + g.index.getX(k));
    else for (let k = 0; k < P.count; k++) this.i.push(base + k);
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aV', new THREE.Float32BufferAttribute(this.v, 1));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// Loft of closed rings along Y. ring: [y, rx, rzF, rzB?, cz?, cx?, nF?, nB?] (n = superellipse exponents).
// opts: vfn(x,y,z) → aV, aofn(x,y,z,a) → aAO, uvfn(x,y,z,a,j) → [u,v], shape(x,y,z,a,ring,j) → [x,y,z],
// theta(k,n) → angle (0 = +Z front, +π/2 = +X).
function loft(rings, n = 12, { vfn = null, aofn = null, uvfn = null, shape = null, theta = null, flatBottom = null } = {}) {
  const pos = [], idx = [], uvs = [], aos = [];
  for (let j = 0; j < rings.length; j++) {
    const r = rings[j];
    const [y, rx, rzF, rzB = rzF, cz = 0, cx = 0, nF = 2, nB = nF] = r;
    for (let k = 0; k < n; k++) {
      const a = theta ? theta(k, n) : (k / n) * TAU;
      const s = Math.sin(a), c = Math.cos(a);
      const ne = c > 0 ? nF : nB;
      const ss = ne === 2 ? s : Math.sign(s) * Math.pow(Math.abs(s), 2 / ne), cc = ne === 2 ? c : Math.sign(c) * Math.pow(Math.abs(c), 2 / ne);
      let x = cx + rx * ss, z = cz + (c > 0 ? rzF : rzB) * cc, yy = y;
      if (shape) { const o = shape(x, yy, z, a, r, j); x = o[0]; yy = o[1]; z = o[2]; }
      if (flatBottom !== null && yy < flatBottom) yy = flatBottom;
      pos.push(x, yy, z);
      if (uvfn) { const t = uvfn(x, yy, z, a, j); uvs.push(t[0], t[1]); } else uvs.push(2, 2);
      aos.push(aofn ? aofn(x, yy, z, a) : 1);
    }
  }
  const asc = rings[rings.length - 1][0] > rings[0][0];
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < n; k++) {
    const a = j * n + k, b = j * n + (k + 1) % n, c = (j + 1) * n + k, d = (j + 1) * n + (k + 1) % n;
    if (asc) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(aos, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const v = new Float32Array(pos.length / 3);
  if (vfn) for (let k = 0; k < v.length; k++) v[k] = vfn(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  g.setAttribute('aV', new THREE.BufferAttribute(v, 1));
  return g;
}
// subdivide a ring list (linear interpolation of all numeric fields) for smoother silhouettes
function subdiv(rings, times = 1) {
  let r = rings;
  for (let t = 0; t < times; t++) {
    const o = [];
    for (let i = 0; i < r.length - 1; i++) {
      o.push(r[i]);
      const a = r[i], b = r[i + 1], m = [];
      for (let k = 0; k < Math.max(a.length, b.length); k++) m.push(((a[k] ?? b[k]) + (b[k] ?? a[k])) / 2);
      // Catmull-Rom-ish radius smoothing using neighbours
      if (i > 0 && i < r.length - 2) for (let k = 1; k < 4; k++) if (a[k] !== undefined && b[k] !== undefined) {
        const p0 = r[i - 1][k] ?? a[k], p3 = r[i + 2][k] ?? b[k];
        m[k] = (-p0 + 9 * a[k] + 9 * b[k] - p3) / 16;
        if (m[k] < 0) m[k] = 0;
      }
      o.push(m);
    }
    o.push(r[r.length - 1]);
    r = o;
  }
  return r;
}
function ell(cx, cy, cz, rx, ry, rz, w = 10, h = 7) {
  const g = new THREE.SphereGeometry(1, w, h); g.scale(rx, ry, rz); g.translate(cx, cy, cz); return g;
}
function box(cx, cy, cz, sx, sy, sz) { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(cx, cy, cz); return g; }
function cyl(cx, cy, cz, rt, rb, h, n = 10, open = false) { const g = new THREE.CylinderGeometry(rt, rb, h, n, 1, open); g.translate(cx, cy, cz); return g; }
const M = () => new THREE.Matrix4();
const rotX = a => M().makeRotationX(a);

// ---------- limbs: lathe profiles with muscle shapes and rounded joint caps ----------
// profile entries [t (0 proximal … 1 distal), rx, rzF, rzB, cz]. Unit length along -Y.
const PROFILES = {
  upperArm: [[0, 0.050, 0.052, 0.052, 0], [0.12, 0.055, 0.055, 0.053, 0.001], [0.42, 0.045, 0.050, 0.047, 0.002],
    [0.72, 0.040, 0.043, 0.042, 0], [1, 0.036, 0.034, 0.038, -0.002]],
  forearm: [[0, 0.037, 0.036, 0.040, -0.002], [0.2, 0.043, 0.040, 0.040, 0], [0.5, 0.037, 0.033, 0.032, 0],
    [0.8, 0.030, 0.024, 0.024, 0], [1, 0.027, 0.020, 0.020, 0]],
  thigh: [[0, 0.084, 0.082, 0.088, -0.004], [0.14, 0.087, 0.086, 0.087, 0.001], [0.42, 0.075, 0.080, 0.070, 0.004],
    [0.75, 0.059, 0.063, 0.055, 0.003], [1, 0.050, 0.052, 0.049, 0.004]],
  shin: [[0, 0.050, 0.050, 0.050, 0.002], [0.28, 0.051, 0.040, 0.066, -0.004], [0.5, 0.043, 0.035, 0.052, -0.004],
    [0.78, 0.033, 0.029, 0.034, -0.001], [1, 0.030, 0.029, 0.030, 0]],
};
// radius at fraction t (for cuffs): returns [rx, rz]
export function limbRadius(kind, t) {
  const P = PROFILES[kind]; if (!P) return [0.05, 0.05];
  for (let i = 0; i < P.length - 1; i++) if (t <= P[i + 1][0]) {
    const a = P[i], b = P[i + 1], f = (t - a[0]) / (b[0] - a[0] || 1);
    return [a[1] + (b[1] - a[1]) * f, ((a[2] + a[3]) + ((b[2] + b[3]) - (a[2] + a[3])) * f) / 2, a[4] + (b[4] - a[4]) * f];
  }
  const l = P[P.length - 1]; return [l[1], (l[2] + l[3]) / 2, l[4]];
}
function limb(kind, n, capRings = 3, sub = 1, elong0 = 0.9, elong1 = 0.9) {
  let prof = PROFILES[kind].map(p => [-p[0], p[1], p[2], p[3], p[4]]);
  if (sub && n > 8) prof = subdiv(prof, sub);
  const first = prof[0], last = prof[prof.length - 1];
  const rings = [];
  const r0 = (first[1] + (first[2] + first[3]) / 2) / 2, r1 = (last[1] + (last[2] + last[3]) / 2) / 2;
  // proximal cap (hemisphere, slightly squashed)
  for (let k = capRings; k >= 1; k--) {
    const ph = (k / capRings) * PI / 2 * 0.96, c = Math.cos(ph);
    rings.push([first[0] + Math.sin(ph) * r0 * elong0, first[1] * c, first[2] * c, first[3] * c, first[4]]);
  }
  for (const p of prof) rings.push(p);
  for (let k = 1; k <= capRings; k++) {
    const ph = (k / capRings) * PI / 2 * 0.96, c = Math.cos(ph);
    rings.push([last[0] - Math.sin(ph) * r1 * elong1, last[1] * c, last[2] * c, last[3] * c, last[4]]);
  }
  return loft(rings, n, { vfn: (x, y) => clamp(-y, 0, 1) });
}

// ---------- torso ----------
// Chest frame: origin = chest joint; colour coordinate 0 at the neck … ~0.62 at the bottom of the chest.
function chest(female, lod) {
  const R = female ? [
    [-0.1, 0.098, 0.072, 0.066], [-0.075, 0.122, 0.086, 0.078], [-0.04, 0.139, 0.096, 0.086], [-0.005, 0.143, 0.100, 0.088], [0.035, 0.147, 0.104, 0.090], [0.075, 0.153, 0.104, 0.091],
    [0.115, 0.160, 0.100, 0.091], [0.155, 0.168, 0.094, 0.088], [0.19, 0.172, 0.083, 0.081], [0.215, 0.166, 0.071, 0.073], [0.236, 0.138, 0.062, 0.064],
    [0.252, 0.098, 0.055, 0.057], [0.264, 0.062, 0.049, 0.051], [0.272, 0.036, 0.044, 0.046], [0.276, 0.008, 0.01, 0.01]]
    : [
    [-0.1, 0.105, 0.076, 0.07], [-0.075, 0.132, 0.092, 0.084], [-0.04, 0.152, 0.104, 0.094], [0.0, 0.158, 0.110, 0.097], [0.045, 0.168, 0.116, 0.100], [0.095, 0.180, 0.118, 0.102],
    [0.14, 0.190, 0.112, 0.101], [0.18, 0.196, 0.100, 0.094], [0.21, 0.190, 0.086, 0.084], [0.232, 0.168, 0.074, 0.074], [0.248, 0.128, 0.064, 0.066],
    [0.26, 0.088, 0.057, 0.059], [0.27, 0.058, 0.051, 0.053], [0.276, 0.03, 0.04, 0.042], [0.279, 0.008, 0.01, 0.01]];
  const rings = (lod ? R.filter((_, i) => i % 2 === 0 || i === R.length - 1) : R).map(r => [r[0], r[1], r[2], r[3], 0, 0, 2.4, 2.3]);
  const n = lod ? 8 : 14;
  return loft(rings, n, {
    // neckline zones are radial: skin only near the neck for collared/open tops; shoulders read as cloth (v ≥ 0.19)
    vfn: (x, y, z) => Math.max(lin(y, 0.27, -0.075, 0.0, 0.62), 0.19 * sstep(0.058, 0.085, Math.hypot(x, z * 1.1)) * sstep(0.17, 0.235, y)),
    aofn: (x, y, z) => 1 - 0.18 * sstep(0.12, 0.17, Math.abs(x)) * sstep(0.17, 0.08, y) * (1 - sstep(0.0, 0.05, Math.abs(z))),
    shape: (x, y, z) => {
      if (female) { // breasts: soft forward bulge on each side, slight lift
        for (const sx of [-1, 1]) { const b = gauss(x - sx * 0.062, 0.05) * gauss(y - 0.085, 0.055); if (z > 0) z += 0.03 * b; }
        if (z > 0) z -= 0.008 * gauss(x, 0.02) * gauss(y - 0.08, 0.05);   // cleavage
      } else if (z > 0) { // pectoral plane with a soft lower edge
        z += 0.008 * gauss(Math.abs(x) - 0.07, 0.05) * gauss(y - 0.13, 0.05);
      }
      if (z < 0) { // shoulder blades + spine groove
        for (const sx of [-1, 1]) z -= 0.008 * gauss(x - sx * 0.075, 0.04) * gauss(y - 0.14, 0.06);
        z += 0.004 * gauss(x, 0.012) * sstep(0.25, 0.1, y);
      }
      return [x, y, z];
    },
  });
}
function belly(lod) {
  const R = [[-0.1, 0.004, 0.004, 0.004], [-0.095, 0.1, 0.07, 0.066], [-0.06, 0.128, 0.088, 0.082], [-0.02, 0.140, 0.099, 0.086], [0.03, 0.138, 0.101, 0.085],
    [0.08, 0.136, 0.101, 0.085], [0.12, 0.13, 0.095, 0.082], [0.16, 0.114, 0.083, 0.074], [0.19, 0.092, 0.067, 0.06], [0.215, 0.06, 0.044, 0.04], [0.226, 0.004, 0.004, 0.004]];
  const rings = (lod ? R.filter((_, i) => i % 2 === 0 || i === R.length - 1) : R).map(r => [r[0], r[1], r[2], r[3], 0, 0, 2.4, 2.3]);
  return loft(rings, lod ? 8 : 12, { vfn: (x, y) => lin(y, 0.22, -0.05, 0.56, 1.0),
    shape: (x, y, z) => { if (z > 0) z += 0.006 * gauss(y - 0.0, 0.06) * gauss(x, 0.08); return [x, y, z]; } });
}
// Pelvis: 0 at waist (belt) … 1 at crotch.
function pelvis(lod) {
  const R = [[0.135, 0.004, 0.004, 0.004], [0.125, 0.12, 0.085, 0.080], [0.1, 0.146, 0.097, 0.090], [0.06, 0.160, 0.101, 0.104], [0.02, 0.170, 0.100, 0.116],
    [-0.02, 0.172, 0.097, 0.121], [-0.06, 0.166, 0.092, 0.118], [-0.095, 0.145, 0.082, 0.102], [-0.125, 0.10, 0.068, 0.076], [-0.145, 0.05, 0.05, 0.05], [-0.152, 0.004, 0.004, 0.004]];
  const rings = (lod ? R.filter((_, i) => i % 2 === 0 || i === R.length - 1) : R).map(r => [r[0], r[1], r[2], r[3], 0, 0, 2.4, 2.3]);
  return loft(rings, lod ? 8 : 14, { vfn: (x, y) => lin(y, 0.11, -0.13, 0.0, 1.0),
    aofn: (x, y) => 1 - 0.15 * sstep(-0.09, -0.14, y),
    shape: (x, y, z) => { if (z < 0) for (const sx of [-1, 1]) z -= 0.012 * gauss(x - sx * 0.07, 0.06) * gauss(y + 0.04, 0.06); return [x, y, z]; } });
}
function neck(lod) {
  const R = [[0.15, 0.03, 0.03, 0.03, -0.004], [0.14, 0.046, 0.044, 0.05, -0.004], [0.11, 0.05, 0.047, 0.055, -0.006], [0.06, 0.052, 0.049, 0.057, -0.007],
    [0.01, 0.056, 0.052, 0.062, -0.009], [-0.03, 0.064, 0.058, 0.07, -0.012], [-0.055, 0.07, 0.06, 0.075, -0.014], [-0.065, 0.03, 0.03, 0.03, -0.01]];
  return loft(lod ? R.filter((_, i) => i % 2 === 0 || i === R.length - 1) : R, lod ? 6 : 10, {
    vfn: (x, y) => lin(y, 0.13, -0.02, 0, 1), aofn: (x, y) => 0.82 + 0.18 * sstep(0.0, 0.08, y),
    shape: (x, y, z) => { if (z > 0) z += 0.006 * gauss(x, 0.012) * gauss(y - 0.05, 0.02); return [x, y, z]; },
  });
}

// ---------- head ----------
// Head bone origin = top of neck. Skull centre at (0, 0.1, 0.006). UV: planar front projection
// u = 0.5 + x/0.17, v = (y + 0.02)/0.17 for front-facing vertices (2 elsewhere → no face texture).
export const HEAD_C = [0, 0.1, 0.012];
export const FACE_UV = { w: 0.17, y0: -0.02, h: 0.17 };
const CR = { cx: 0, cy: 0.1, cz: 0.006, rx: 0.0765, ry: 0.118, rzF: 0.088, rzB: 0.106 };
// cranium surface point for a unit direction (relative to the skull centre) + offset along the normal
function skull(ux, uy, uz, off = 0) {
  const rz = uz > 0 ? CR.rzF : CR.rzB;
  let x = ux * CR.rx, y = uy * CR.ry, z = uz * rz;
  let nx = x / (CR.rx * CR.rx), ny = y / (CR.ry * CR.ry), nz = z / (rz * rz);
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  return [CR.cx + x + nx * off, CR.cy + y + ny * off, CR.cz + z + nz * off];
}
function faceUV(x, y, z) {
  if (z < -0.004) return [2, 2];
  return [0.5 + x / FACE_UV.w, (y - FACE_UV.y0) / FACE_UV.h];
}
function head(female, lod) {
  const fw = female ? 0.94 : 1, fj = female ? 0.9 : 1;
  // lower face rings [y, halfWidth, zFront, zBack, zCentre]
  const face = [
    [-0.0175, 0.003, 0.050, 0.046, 0.048], [-0.0155, 0.013, 0.066, 0.030, 0.046], [-0.009, 0.029 * fj, 0.075, 0.003, 0.038], [0.0, 0.044 * fj, 0.080, -0.02, 0.03],
    [0.012, 0.054 * fj, 0.083, -0.036, 0.022], [0.028, 0.062 * fw, 0.087, -0.056, 0.016], [0.045, 0.067 * fw, 0.088, -0.076, 0.012], [0.065, 0.0725, 0.090, -0.091, 0.008],
    [0.085, 0.0757, 0.093, -0.098, 0.006],
  ];
  const rings = face.map(f => [f[0], f[1], f[2] - f[4], f[4] - f[3], f[4], 0, 2.5, 2.1]);
  const phis = lod ? [0.0, 0.4, 0.9, 1.3, 1.54] : [0.0, 0.14, 0.3, 0.5, 0.72, 0.96, 1.2, 1.4, 1.54];
  for (const ph of phis) {
    const uy = Math.sin(ph), h = Math.cos(ph);
    rings.push([CR.cy + CR.ry * uy, Math.max(0.002, CR.rx * h), Math.max(0.002, CR.rzF * h), Math.max(0.002, CR.rzB * h), CR.cz, 0, lin(ph, 0, 0.6, 2.3, 2), 2]);
  }
  const ringsF = lod ? rings.filter((r, i) => i % 2 === 0 || i >= face.length) : rings;
  const n = lod ? 10 : 15;
  const theta = (k, nn) => { const t = (k / nn) * 2 - 1; return PI * Math.sign(t) * Math.pow(Math.abs(t), 1.32); };
  const g = loft(ringsF, n, {
    theta,
    uvfn: (x, y, z) => faceUV(x, y, z),
    aofn: (x, y, z) => 1 - 0.22 * sstep(0.01, -0.016, y) * sstep(0.0, 0.05, z) - 0.1 * sstep(0.03, -0.01, z) * sstep(0.04, 0.0, y),
    shape: (x, y, z, a) => {
      const fr = Math.cos(a) > 0 ? Math.cos(a) : 0;
      // brow ridge
      z += (female ? 0.0022 : 0.0045) * gauss(y - 0.121, 0.009) * sstep(0.4, 0.9, fr);
      // eye sockets
      for (const sx of [-1, 1]) z -= 0.0045 * gauss(x - sx * 0.032, 0.014) * gauss(y - 0.101, 0.011) * (z > 0 ? 1 : 0);
      // cheekbones
      const cb = gauss(y - 0.07, 0.016) * gauss(Math.abs(a) - 0.95, 0.35);
      x += Math.sign(x) * 0.0028 * cb; z += 0.002 * cb;
      // lips & chin
      z += (female ? 0.0055 : 0.0042) * gauss(x, 0.019) * gauss(y - 0.031, 0.009) * (z > 0 ? 1 : 0);
      z -= 0.0025 * gauss(x, 0.02) * gauss(y - 0.016, 0.005) * (z > 0 ? 1 : 0);   // mentolabial sulcus
      z += 0.003 * gauss(x, 0.017) * gauss(y - 0.0, 0.008) * (z > 0 ? 1 : 0);
      // temples slightly flatter
      x -= Math.sign(x) * 0.002 * gauss(y - 0.13, 0.02) * gauss(Math.abs(a) - 1.1, 0.3);
      return [x, y, z];
    },
  });
  const b = new GB(); b.add(g, null, null, true);
  if (!lod) {
    // nose: loft down the face; back half sinks into the head
    const nw = female ? 0.78 : 0.88, nf = female ? 0.72 : 0.8;
    const NR = [[0.118, 0.0055, 0.001], [0.106, 0.007, 0.0055], [0.093, 0.008, 0.011], [0.08, 0.009, 0.0175], [0.069, 0.0115, 0.0235], [0.061, 0.014, 0.0255],
      [0.054, 0.0175, 0.0185], [0.0485, 0.0145, 0.008], [0.0465, 0.005, 0.001]];
    const zb = 0.0855;
    const nose = loft(NR.map(r => [r[0], r[1] * nw, r[2] * nf, 0.008, 0]), 9, {
      shape: (x, y, z, a, r) => { const c = Math.cos(a); const zz = c > 0 ? zb + r[2] * Math.pow(c, 0.85) : zb + 0.01 * c; return [x, y, zz]; },
      uvfn: (x, y, z) => faceUV(x, y, z),
    });
    b.add(nose, 0, null, true);
    // ears: cupped ellipsoids, tilted back
    for (const sx of [-1, 1]) {
      const e = new THREE.SphereGeometry(1, 8, 6); e.scale(0.0105, 0.031, 0.02);
      const P = e.attributes.position;
      for (let k = 0; k < P.count; k++) {
        const x = P.getX(k), y = P.getY(k), z = P.getZ(k);
        const r2 = (y / 0.031) ** 2 + (z / 0.02) ** 2;
        let nx = x; if (x > 0) nx = x - 0.008 * Math.max(0, 1 - r2 * 1.3);   // cup (concha) on the outer face
        const lobe = y < -0.018 ? 0.003 : 0;
        P.setXYZ(k, nx + lobe * 0, y, z - (y < 0 ? 0.004 * (-y / 0.031) : 0));
      }
      e.computeVertexNormals();
      const m = M().makeRotationY(sx * 0.32).premultiply(M().makeRotationX(-0.12)).premultiply(M().makeScale(sx, 1, 1)).premultiply(M().makeTranslation(sx * 0.0738, 0.083, -0.008));
      if (sx < 0) { const ix = e.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k]; ix[k] = ix[k + 1]; ix[k + 1] = t; } }
      e.applyMatrix4(m); e.computeVertexNormals();
      const ao = new Float32Array(e.attributes.position.count).fill(0.88); e.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
      b.add(e, 0);
    }
  } else {
    for (const sx of [-1, 1]) b.add(ell(sx * 0.074, 0.083, -0.008, 0.011, 0.028, 0.018, 5, 4), 0);
    b.add(ell(0, 0.065, 0.088, 0.011, 0.025, 0.014, 5, 4), 0);
  }
  return b.build();
}

// ---------- face atlas: 8 categories × 4 variants (cell = face*4 + variant) ----------
// Two maps: colour (RGBA: eyes, lashes, lipstick — mixed over skin) and multiply (RGB: shading, brows,
// lips, stubble — multiplied with skin so it works for every skin tone).
// Categories: 0 man, 1 stubble/beard, 2 moustache, 3 woman, 4 woman makeup, 5 child, 6 old man, 7 old woman.
export const FACE_COLS = 8, FACE_ROWS = 4, FACE_CELL = 256;
const IRIS = [[58, 36, 22], [96, 62, 34], [92, 104, 58], [72, 112, 150]];
export function makeFaceAtlas() {
  const C = FACE_CELL;
  const mk = () => { const cv = document.createElement('canvas'); cv.width = C * FACE_COLS; cv.height = C * FACE_ROWS; return cv; };
  const cvC = mk(), cvM = mk();
  const xc = cvC.getContext('2d'), xm = cvM.getContext('2d');
  xm.fillStyle = '#fff'; xm.fillRect(0, 0, cvM.width, cvM.height);
  // face-space (metres) → cell pixels
  const PX = (x) => (0.5 + x / FACE_UV.w) * C, PY = (y) => (1 - (y - FACE_UV.y0) / FACE_UV.h) * C, S = C / FACE_UV.w;   // S: px per metre
  let seed = 1234567;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let cell = 0; cell < FACE_COLS * FACE_ROWS; cell++) {
    const cat = Math.floor(cell / 4), varI = cell % 4;
    const ox = (cell % FACE_COLS) * C, oy = Math.floor(cell / FACE_COLS) * C;
    const female = cat === 3 || cat === 4 || cat === 7, child = cat === 5, old = cat >= 6, makeup = cat === 4;
    const male = !female && !child;
    for (const x of [xc, xm]) { x.save(); x.beginPath(); x.rect(ox, oy, C, C); x.clip(); x.translate(ox, oy); x.lineCap = 'round'; x.lineJoin = 'round'; }
    const mul = (r, g, b, a = 1) => `rgba(${r},${g},${b},${a})`;
    const radial = (x, cx, cy, r, col0, col1) => { const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, col0); gr.addColorStop(1, col1); x.fillStyle = gr; x.fillRect(cx - r, cy - r, 2 * r, 2 * r); };
    // ---- multiply map: soft modelling ----
    // skin micro-variation
    for (let k = 0; k < 900; k++) { const v = 238 + Math.floor(rnd() * 17); xm.fillStyle = mul(v, v - 2, v - 3, 0.35); xm.fillRect(rnd() * C, rnd() * C, 2, 2); }
    // under-jaw / chin shading and temples
    radial(xm, PX(0), PY(-0.022), 0.06 * S, mul(214, 196, 190, 0.9), mul(255, 255, 255, 0));
    for (const s of [-1, 1]) radial(xm, PX(s * 0.07), PY(0.13), 0.03 * S, mul(226, 214, 210, 0.7), mul(255, 255, 255, 0));
    // eye sockets / upper lid crease shadow
    const ex = child ? 0.03 : 0.032, ey = child ? 0.097 : 0.1;
    for (const s of [-1, 1]) {
      radial(xm, PX(s * ex), PY(ey + 0.002), 0.021 * S, makeup ? mul(190, 150, 160, 0.95) : mul(206, 178, 168, 0.85), mul(255, 255, 255, 0));
      radial(xm, PX(s * (ex + 0.002)), PY(ey - 0.011), 0.017 * S, mul(232, 214, 210, old ? 0.6 : 0.35), mul(255, 255, 255, 0)); // under-eye
    }
    // cheeks (warm)
    for (const s of [-1, 1]) radial(xm, PX(s * 0.042), PY(0.06), 0.026 * S, female || child ? mul(255, 205, 200, 0.9) : mul(250, 222, 214, 0.7), mul(255, 255, 255, 0));
    // nose: side shading, tip highlight-ish warmth, nostrils
    for (const s of [-1, 1]) radial(xm, PX(s * 0.012), PY(0.085), 0.011 * S, mul(220, 196, 186, 0.8), mul(255, 255, 255, 0));
    radial(xm, PX(0), PY(0.062), 0.012 * S, mul(250, 214, 204, 0.8), mul(255, 255, 255, 0));
    for (const s of [-1, 1]) radial(xm, PX(s * 0.0072), PY(0.0495), 0.0042 * S, mul(150, 105, 96, 0.7), mul(220, 190, 182, 0));
    // nasolabial folds
    if (!child) {
      xm.strokeStyle = mul(214, 188, 178, old ? 0.85 : 0.35); xm.lineWidth = old ? 2.6 : 1.8;
      for (const s of [-1, 1]) { xm.beginPath(); xm.moveTo(PX(s * 0.0175), PY(0.053)); xm.quadraticCurveTo(PX(s * 0.025), PY(0.044), PX(s * (old ? 0.027 : 0.0255)), PY(old ? 0.025 : 0.036)); xm.stroke(); }
    }
    // philtrum
    radial(xm, PX(0), PY(0.042), 0.006 * S, mul(228, 208, 200, 0.7), mul(255, 255, 255, 0));
    // lips (multiply – darker, warmer). mouth width/fullness by category & variant
    const mw = (child ? 0.017 : female ? 0.0205 : 0.0225) * (1 + (varI - 1.5) * 0.04), my = child ? 0.033 : 0.031;
    const up = (female ? 0.0055 : 0.0042) * (1 + (varI % 2) * 0.15), lo = (female ? 0.0075 : 0.0058) * (1 + (varI % 2) * 0.12);
    const mouthPath = (x, upper) => {
      x.beginPath();
      x.moveTo(PX(-mw), PY(my));
      if (upper) {
        x.bezierCurveTo(PX(-mw * 0.6), PY(my + up * 0.6), PX(-mw * 0.25), PY(my + up * 1.25), PX(0), PY(my + up * 0.8));
        x.bezierCurveTo(PX(mw * 0.25), PY(my + up * 1.25), PX(mw * 0.6), PY(my + up * 0.6), PX(mw), PY(my));
        x.quadraticCurveTo(PX(0), PY(my - 0.0008), PX(-mw), PY(my));
      } else {
        x.quadraticCurveTo(PX(0), PY(my - 0.0008), PX(mw), PY(my));
        x.bezierCurveTo(PX(mw * 0.6), PY(my - lo * 0.9), PX(-mw * 0.6), PY(my - lo * 0.9), PX(-mw), PY(my));
      }
      x.closePath();
    };
    xm.fillStyle = female || child ? mul(214, 150, 146) : mul(222, 170, 164); mouthPath(xm, true); xm.fill();
    xm.fillStyle = female || child ? mul(226, 168, 162) : mul(232, 186, 178); mouthPath(xm, false); xm.fill();
    xm.strokeStyle = mul(150, 96, 92, 0.75); xm.lineWidth = 1.2; xm.beginPath(); xm.moveTo(PX(-mw * 1.04), PY(my + 0.0003)); xm.quadraticCurveTo(PX(0), PY(my - 0.0012), PX(mw * 1.04), PY(my + 0.0003)); xm.stroke();
    radial(xm, PX(0), PY(my - lo * 1.3), 0.008 * S, mul(232, 212, 206, 0.7), mul(255, 255, 255, 0)); // shadow under lower lip
    // brows (hair-like strokes in the multiply map)
    const bTh = (male ? 1.25 : child ? 0.8 : 0.85) * (1 + (varI === 2 ? 0.25 : varI === 1 ? -0.12 : 0)), bDark = old ? 0.62 : male ? 0.32 : 0.4;
    for (const s of [-1, 1]) {
      const bx0 = s * (ex - 0.017), bx1 = s * (ex + 0.02), by = ey + (child ? 0.017 : female ? 0.021 : 0.018);
      const arch = female ? 0.006 : 0.0035;
      // soft base mass (reads at distance) under the individual hairs
      { const v = Math.floor(255 * (bDark + 0.12)); xm.strokeStyle = mul(v, Math.floor(v * 0.92), Math.floor(v * 0.88), old ? 0.35 : 0.55);
        xm.lineWidth = 0.0032 * S * bTh; xm.beginPath();
        for (let k = 0; k <= 12; k++) { const t = k / 12; const bx = bx0 + (bx1 - bx0) * t, byy = by + arch * Math.sin(Math.min(1, t * 1.25) * PI * 0.9) - (t > 0.8 ? (t - 0.8) * 0.01 : 0); if (k) xm.lineTo(PX(bx), PY(byy)); else xm.moveTo(PX(bx), PY(byy)); }
        xm.stroke(); }
      for (let k = 0; k < 46; k++) {
        const t = k / 45, t2 = t + (rnd() - 0.5) * 0.04;
        const bx = bx0 + (bx1 - bx0) * t2, byy = by + arch * Math.sin(Math.min(1, t2 * 1.25) * PI * 0.9) - (t2 > 0.8 ? (t2 - 0.8) * 0.01 : 0);
        const th = (0.0042 * (1 - t * 0.55)) * bTh;
        const v = Math.floor(255 * (bDark + rnd() * 0.12));
        xm.strokeStyle = mul(v, Math.floor(v * 0.92), Math.floor(v * 0.88), 0.55); xm.lineWidth = 1.3;
        xm.beginPath(); xm.moveTo(PX(bx), PY(byy - th * 0.5 + (rnd() - 0.5) * th * 0.6)); xm.lineTo(PX(bx + s * 0.0035), PY(byy + th * 0.5 + (rnd() - 0.5) * th * 0.5)); xm.stroke();
      }
    }
    // stubble / beard / moustache
    if (cat === 1 || cat === 0 || cat === 2 || cat === 6) {
      const beard = cat === 1 && varI === 3, dens = cat === 1 ? (beard ? 1 : 0.7) : cat === 0 ? [0.03, 0.06, 0.14, 0.22][varI] : 0.2;
      const N = Math.floor(5200 * dens);
      for (let k = 0; k < N; k++) {
        const x = (rnd() - 0.5) * 0.12, y = -0.02 + rnd() * 0.075;
        // jaw/cheek mask
        const onJaw = y < 0.02 + 0.03 * (1 - Math.min(1, Math.abs(x) / 0.06)) && Math.abs(x) < 0.062 - Math.max(0, y - 0.01) * 0.4;
        const upperLip = y > 0.032 && y < 0.043 && Math.abs(x) < 0.02;
        const sideburn = Math.abs(x) > 0.05 && y > 0.03 && y < 0.08;
        if (!(onJaw || upperLip || sideburn)) continue;
        if (Math.abs(y - my) < 0.007 && Math.abs(x) < mw) continue;
        const v = beard ? 70 + rnd() * 40 : 165 + rnd() * 45;
        xm.fillStyle = mul(v, v * 0.95, v * 0.97, beard ? 0.6 : 0.3); xm.fillRect(PX(x), PY(y), 1.4, 1.4);
      }
    }
    if (cat === 1 && varI === 3) { xm.save(); xm.globalAlpha = 0.55; radial(xm, PX(0), PY(0.0), 0.06 * S, mul(120, 100, 92, 1), mul(200, 180, 170, 0)); xm.restore(); }
    if (cat === 1 && varI < 3) { xm.save(); xm.globalAlpha = 0.5; radial(xm, PX(0), PY(0.005), 0.055 * S, mul(205, 192, 188, 1), mul(255, 255, 255, 0)); xm.restore(); }
    if (cat === 2 || (cat === 6 && varI >= 2)) {
      xm.fillStyle = mul(70, 58, 52, 0.92); xm.beginPath();
      xm.moveTo(PX(-0.024), PY(my + 0.001)); xm.quadraticCurveTo(PX(-0.012), PY(my + 0.013), PX(0), PY(my + 0.011)); xm.quadraticCurveTo(PX(0.012), PY(my + 0.013), PX(0.024), PY(my + 0.001));
      xm.quadraticCurveTo(PX(0), PY(my + 0.006), PX(-0.024), PY(my + 0.001)); xm.fill();
    }
    // wrinkles
    if (old) {
      xm.strokeStyle = mul(196, 170, 160, 0.8); xm.lineWidth = 1.5;
      for (let k = 0; k < 3; k++) { xm.beginPath(); xm.moveTo(PX(-0.035), PY(0.138 + k * 0.009)); xm.quadraticCurveTo(PX(0), PY(0.141 + k * 0.009), PX(0.035), PY(0.138 + k * 0.009)); xm.stroke(); }
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { xm.beginPath(); xm.moveTo(PX(s * (ex + 0.017)), PY(ey + 0.002 - k * 0.004)); xm.lineTo(PX(s * (ex + 0.027)), PY(ey + 0.004 - k * 0.007)); xm.stroke(); }
      for (const s of [-1, 1]) { xm.beginPath(); xm.moveTo(PX(s * 0.026), PY(0.018)); xm.lineTo(PX(s * 0.03), PY(0.004)); xm.stroke(); }
    }
    // freckles on some light-skinned variants
    if (varI === 3 && (female || child)) for (let k = 0; k < 70; k++) { const x = (rnd() - 0.5) * 0.08, y = 0.055 + rnd() * 0.03; xm.fillStyle = mul(200, 150, 120, 0.5); xm.beginPath(); xm.arc(PX(x), PY(y), 1 + rnd() * 1.2, 0, TAU); xm.fill(); }

    // ---- colour map: eyes ----
    const ew = (child ? 0.0158 : female ? 0.0156 : 0.015), eh = (child ? 0.0076 : female ? 0.0066 : 0.006);
    const iris = IRIS[varI], tilt = female ? 0.08 : 0.03;
    for (const s of [-1, 1]) {
      const cx = PX(s * ex), cy = PY(ey);
      const almond = (x, grow = 0) => {
        x.beginPath();
        const w = ew * S + grow, h = eh * S + grow;
        const inner = cx - s * w, outer = cx + s * w;
        x.moveTo(inner, cy + 0.6);
        x.bezierCurveTo(cx - s * w * 0.55, cy - h * 1.35, cx + s * w * 0.4, cy - h * 1.45, outer, cy - h * tilt * 6);
        x.bezierCurveTo(cx + s * w * 0.45, cy + h * 1.05, cx - s * w * 0.5, cy + h * 1.0, inner, cy + 0.6);
        x.closePath();
      };
      // sclera
      xc.save(); almond(xc); xc.clip();
      xc.fillStyle = 'rgba(232,226,218,1)'; xc.fillRect(cx - 40, cy - 30, 80, 60);
      // corner shading of the eyeball
      radial(xc, cx, cy - eh * S * 0.3, ew * S * 1.3, 'rgba(240,236,230,0)', 'rgba(150,120,115,0.55)');
      // iris + limbal ring + pupil
      const ir = eh * S * 1.22, ix = cx + s * 0.5, iy = cy - eh * S * 0.08;
      const gr = xc.createRadialGradient(ix, iy, ir * 0.2, ix, iy, ir);
      gr.addColorStop(0, `rgba(${iris[0] * 0.7},${iris[1] * 0.7},${iris[2] * 0.7},1)`); gr.addColorStop(0.55, `rgba(${iris[0]},${iris[1]},${iris[2]},1)`); gr.addColorStop(0.92, `rgba(${iris[0] * 0.55},${iris[1] * 0.55},${iris[2] * 0.55},1)`); gr.addColorStop(1, 'rgba(30,22,18,1)');
      xc.fillStyle = gr; xc.beginPath(); xc.arc(ix, iy, ir, 0, TAU); xc.fill();
      xc.fillStyle = 'rgba(8,6,6,1)'; xc.beginPath(); xc.arc(ix, iy, ir * 0.42, 0, TAU); xc.fill();
      // upper lid shadow on the eyeball
      const sh = xc.createLinearGradient(0, cy - eh * S * 1.4, 0, cy); sh.addColorStop(0, 'rgba(40,24,20,0.75)'); sh.addColorStop(1, 'rgba(40,24,20,0)');
      xc.fillStyle = sh; xc.fillRect(cx - 40, cy - 30, 80, 30);
      // catchlight
      xc.fillStyle = 'rgba(255,255,255,0.95)'; xc.beginPath(); xc.arc(ix + 1.6, iy - ir * 0.38, Math.max(1.2, ir * 0.18), 0, TAU); xc.fill();
      xc.restore();
      // upper lid line / lashes, lower lid
      xc.strokeStyle = female ? 'rgba(14,9,8,0.95)' : 'rgba(34,20,16,0.85)'; xc.lineWidth = female ? 2.8 : child ? 2.0 : 1.9;
      xc.beginPath();
      const w = ew * S, h = eh * S;
      xc.moveTo(cx - s * w, cy + 0.6);
      xc.bezierCurveTo(cx - s * w * 0.55, cy - h * 1.35, cx + s * w * 0.4, cy - h * 1.45, cx + s * w, cy - h * tilt * 6);
      if (female) xc.lineTo(cx + s * (w + 3.5), cy - h * tilt * 6 - 2.6);
      xc.stroke();
      xc.strokeStyle = 'rgba(70,40,34,0.35)'; xc.lineWidth = 1.1;
      xc.beginPath(); xc.moveTo(cx + s * w, cy - h * tilt * 6); xc.bezierCurveTo(cx + s * w * 0.45, cy + h * 1.05, cx - s * w * 0.5, cy + h * 1.0, cx - s * w, cy + 0.6); xc.stroke();
      // lid crease (soft, in multiply)
      xm.strokeStyle = mul(170, 138, 128, female ? 0.55 : 0.45); xm.lineWidth = 1.5;
      xm.beginPath(); xm.moveTo(cx - s * w * 0.8, cy - h * 1.15); xm.quadraticCurveTo(cx, cy - h * 2.35, cx + s * w * 1.05, cy - h * 0.9); xm.stroke();
      // tear duct
      xc.fillStyle = 'rgba(200,120,118,0.8)'; xc.beginPath(); xc.arc(cx - s * w * 0.93, cy + 0.4, 1.3, 0, TAU); xc.fill();
      if (makeup) { // eyeshadow + liner wing
        const es = xc.createRadialGradient(cx, cy - h * 1.5, 1, cx, cy - h * 1.5, w * 1.2); es.addColorStop(0, varI < 2 ? 'rgba(120,70,90,0.45)' : 'rgba(90,70,60,0.4)'); es.addColorStop(1, 'rgba(120,70,90,0)');
        xc.save(); xc.beginPath(); xc.rect(cx - w * 1.6, cy - h * 3.2, w * 3.2, h * 2.2); xc.clip(); xc.fillStyle = es; xc.fillRect(cx - w * 2, cy - h * 4, w * 4, h * 4); xc.restore();
      }
    }
    if (makeup) { // lipstick in the colour map
      const lc = ['rgba(150,30,48,0.82)', 'rgba(176,64,74,0.7)', 'rgba(120,40,52,0.8)', 'rgba(190,90,92,0.6)'][varI];
      xc.fillStyle = lc; mouthPath(xc, true); xc.fill(); mouthPath(xc, false); xc.fill();
      xc.fillStyle = 'rgba(255,255,255,0.25)'; xc.beginPath(); xc.ellipse(PX(0.003), PY(my - lo * 0.45), mw * S * 0.35, lo * S * 0.18, 0, 0, TAU); xc.fill();
    }
    if (old) { // grey hairs mixed into the brows
      for (const s of [-1, 1]) for (let k = 0; k < 18; k++) { const t = rnd(); xc.strokeStyle = 'rgba(205,200,195,0.55)'; xc.lineWidth = 1; const bx = s * (ex - 0.015 + t * 0.035), by = ey + 0.019 + 0.004 * Math.sin(t * PI); xc.beginPath(); xc.moveTo(PX(bx), PY(by - 0.002)); xc.lineTo(PX(bx + s * 0.003), PY(by + 0.002)); xc.stroke(); }
    }
    for (const x of [xc, xm]) x.restore();
  }
  const tex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; return t; };
  const tc = tex(cvC), tm = tex(cvM);
  tc.userData.mul = tm;     // the multiply map travels with the colour map
  return tc;
}

// ---------- hair (head-bone frame) ----------
// Shells over the cranium in spherical angles (phi from the crown, th azimuth, 0 = front). Strand ridges,
// part lines and drape (hair falling vertically below a height) give volume; aV carries shading 0..1 and
// uv strand coordinates for the strand shader.
function hairShell({ W = 30, H = 16, phiMax = 2.2, region, off, strands = 0.004, strandK = 11, part = null, drape = null, hemAO = 0.65 }) {
  const pos = [], idx = [], uvs = [], vv = [], aos = [], map = new Map();
  const ridge = (x) => { const s = Math.abs(Math.sin(x)); return Math.pow(s, 0.7); };
  const inR = (th, ph) => { const ux = Math.sin(ph) * Math.sin(th), uy = Math.cos(ph), uz = Math.sin(ph) * Math.cos(th); return region(ux, uy, uz, th, ph) ? 1 : 0; };
  // smooth coverage at a grid vertex: supersample the boolean region over the vertex's neighbourhood so the
  // hair edge (where the shell dips under the scalp) is a smooth line instead of quad stair-steps
  const dT = TAU / W, dP = phiMax / H;
  const cov = (th, ph) => { let c = 0, n = 0; for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) { c += inR(th + a * dT * 0.6, Math.max(0, ph + b * dP * 0.6)); n++; } return c / n; };
  const covA = new Map();
  const covAt = (i, j) => { const key = (i % W) * 1000 + j; let c = covA.get(key); if (c === undefined) { c = cov((i % W) / W * TAU - PI, phiMax * j / H); covA.set(key, c); } return c; };
  const vid = (i, j) => {
    const key = (i % W) * 1000 + j; if (map.has(key)) return map.get(key);
    const ph = phiMax * j / H, th = (i % W) / W * TAU - PI;
    const ux = Math.sin(ph) * Math.sin(th), uy = Math.cos(ph), uz = Math.sin(ph) * Math.cos(th);
    let o = typeof off === 'number' ? off : off(ux, uy, uz, th, ph);
    let rg = 0;
    if (strands) { rg = ridge(th * strandK + 0.8 * Math.sin(ph * 2.3 + th)) * sstep(0.15, 0.6, ph); o += strands * rg; }
    if (part) { const d = th - part.th; const pk = gauss(d, part.w) * sstep(1.5, 0.8, ph) * (uz > -0.2 ? 1 : 0); o *= 1 - 0.55 * pk; o -= 0.002 * pk; }
    const c = covAt(i, j), m = sstep(0.2, 0.75, c);
    o = -0.006 + (o + 0.006) * m;      // outside the region the shell sinks under the scalp
    let p = skull(ux, uy, uz, o);
    if (drape && p[1] < drape.y && m > 0.5) {
      const uyd = clamp((drape.y - CR.cy) / CR.ry, -0.99, 0.99), hf = Math.sqrt(1 - uyd * uyd);
      const sx = Math.sin(th), sz = Math.cos(th);
      const rx = CR.rx * hf, rz = (sz > 0 ? CR.rzF : CR.rzB) * hf;
      const hd0 = 1 / Math.sqrt((sx / rx) ** 2 + (sz / rz) ** 2) + o;
      const dy = drape.y - p[1];
      const hd = hd0 * (1 + (drape.flare || 0) * dy) - (drape.curl || 0) * sstep(drape.y - (drape.len || 0.1) + 0.03, drape.y - (drape.len || 0.1), p[1]);
      const cur = Math.hypot(p[0] - CR.cx, p[2] - CR.cz);
      const h2 = Math.max(cur, hd);
      p = [CR.cx + sx * h2, p[1], CR.cz + sz * h2];
    }
    pos.push(p[0] + HEAD_C[0], p[1], p[2]);
    uvs.push(th * 0.55, ph);
    vv.push(clamp(0.55 + 0.45 * rg - 0.18 * sstep(0.3, 0.0, ph), 0, 1) * (0.75 + 0.25 * m));
    aos.push(0.72 + 0.28 * sstep(0.5, 1, c));
    const id = pos.length / 3 - 1; map.set(key, id); return id;
  };
  const lastRow = new Int32Array(W).fill(-1);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (covAt(i, j) + covAt(i + 1, j) + covAt(i, j + 1) + covAt(i + 1, j + 1) < 0.15) continue;
    const a = vid(i, j), b = vid(i + 1, j), c = vid(i, j + 1), d = vid(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
    lastRow[i] = j;
  }
  for (let i = 0; i < W; i++) { const j = lastRow[i]; if (j < 0) continue; for (const ii of [i, i + 1]) { const id = map.get((ii % W) * 1000 + j + 1); if (id !== undefined) { aos[id] = Math.min(aos[id], hemAO); vv[id] *= 0.85; } } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(vv, 1));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(aos, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// long hair curtain hanging down the back: closed thin shell, zig-zag layered hem
function curtain(lod, len = 1) {
  const rows = [
    [0.17, 0.069, 0.095, 0.006, 1.75], [0.13, 0.084, 0.113, 0.006, 1.75], [0.09, 0.089, 0.117, 0.004, 1.7], [0.05, 0.091, 0.115, 0.0, 1.6],
    [0.0, 0.095, 0.097, -0.02, 1.45], [-0.06, 0.1, 0.072, -0.05, 1.3], [-0.12, 0.104, 0.044, -0.088, 1.15], [-0.19, 0.1, 0.034, -0.103, 1.1], [-0.245, 0.095, 0.03, -0.11, 1.08]];
  const R = rows.map(r => r.slice()); if (len < 1) { R.length = 7; R[6][0] = -0.12 * len; }
  const cols = lod ? 5 : 9, rr = lod ? R.filter((_, i) => i % 2 === 0 || i === R.length - 1) : R;
  const pos = [], uvs = [], vv = [], aos = [], idx = [];
  const loopN = cols * 2;
  for (let j = 0; j < rr.length; j++) {
    const [y, ax, az, zc, pm] = rr[j];
    const last = j === rr.length - 1;
    for (let k = 0; k < loopN; k++) {
      const outer = k < cols;
      const s = outer ? (k / (cols - 1)) * 2 - 1 : 1 - ((k - cols) / (cols - 1)) * 2;
      const ps = s * pm;
      const rgd = outer && !lod ? 0.0035 * Math.abs(Math.sin(ps * 7 + j * 0.3)) : 0;
      const th = outer ? 0 : 0.011;
      let x = (ax + rgd - th) * Math.sin(ps), z = zc - (az + rgd - th) * Math.cos(ps);
      let yy = y;
      if (last) yy += 0.028 * Math.abs(((s * 3.5 + 10) % 1) - 0.5) * 2 - 0.01;   // zig-zag hem
      pos.push(x, yy, z); uvs.push(ps * 0.6, 1 + (0.17 - y) * 6);
      vv.push(outer ? 0.6 + 0.4 * (rgd / 0.0035) : 0.25); aos.push(last ? 0.7 : outer ? 1 : 0.55);
    }
  }
  for (let j = 0; j < rr.length - 1; j++) for (let k = 0; k < loopN; k++) {
    const a = j * loopN + k, b = j * loopN + (k + 1) % loopN, c = (j + 1) * loopN + k, d = (j + 1) * loopN + (k + 1) % loopN;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(vv, 1));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(aos, 1));
  g.setIndex(idx); g.computeVertexNormals();
  // make normals of the outer face point away from the head (flip if the loop winding came out inward)
  const P = g.attributes.position, N = g.attributes.normal;
  let dot = 0; for (let k = 0; k < cols; k++) dot += N.getZ(loopN * 2 + k) * -1;
  if (dot < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k]; ix[k] = ix[k + 1]; ix[k + 1] = t; } g.computeVertexNormals(); }
  void P;
  return g;
}
// ponytail (separate swinging part): origin at the hair tie, hangs along -Y
export const PONY_TIE = [0, 0.142, -0.098];
function ponytail(lod) {
  const R = [[0.012, 0.012, 0.012, 0.012, 0], [0.0, 0.021, 0.02, 0.02, 0], [-0.012, 0.024, 0.023, 0.023, -0.004], [-0.05, 0.03, 0.027, 0.027, -0.012], [-0.1, 0.029, 0.025, 0.025, -0.016],
    [-0.15, 0.025, 0.021, 0.021, -0.014], [-0.2, 0.018, 0.015, 0.015, -0.008], [-0.235, 0.008, 0.007, 0.007, -0.002], [-0.248, 0.002, 0.002, 0.002, 0]];
  const b = new GB();
  b.add(loft(lod ? R.filter((_, i) => i % 2 === 0) : R, lod ? 5 : 10, {
    shape: (x, y, z, a) => { const r = 1 + (lod ? 0 : 0.12 * Math.abs(Math.sin(a * 4 + y * 30))); return [x * r, y, z * r]; },
    uvfn: (x, y, z, a) => [a * 0.55, 1 - y * 5], vfn: () => 0.7,
    aofn: (x, y) => y > -0.01 ? 0.7 : 1,
  }), null, null, true);
  // elastic tie
  const tie = new THREE.TorusGeometry(0.019, 0.006, 5, 10); tie.rotateX(PI / 2); tie.translate(0, -0.004, 0);
  b.add(tie, 0.15);
  return b.build();
}
const faceHole = (ux, uy, uz, top = 0.42, side = 0.62) => uz > 0 && uy < top && Math.abs(Math.atan2(ux, uz)) < side;
const earZone = (ux, uy, uz) => Math.abs(ux) > 0.8 && uy < 0.2 && uy > -0.62 && uz > -0.38 && uz < 0.3;
// hairline: slightly receding temples (M-shape); returns true if inside the scalp area for short styles
const scalp = (ux, uy, uz, low = -0.38) => {
  const az = Math.atan2(ux, uz);           // 0 front
  if (uz > 0) { const hl = 0.6 + 0.07 * gauss(Math.abs(az) - 0.55, 0.2) - 0.03 * gauss(az, 0.25); if (uy < hl && Math.abs(az) < 0.95) return false; }
  if (earZone(ux, uy, uz)) return false;
  if (Math.abs(az) > 0.95 && Math.abs(az) < 1.7 && uy < 0.15) { if (uy < -0.05 || Math.abs(az) < 1.15) return Math.abs(az) > 1.25 && Math.abs(az) < 1.45 && uy > -0.1 && uy < 0.2; } // sideburn strip
  return uy > (uz < 0 ? low : -0.05);
};
function hairGeo(style, lod) {
  const b = new GB();
  const W = lod ? 10 : 24, H = lod ? 6 : 14;
  const S = lod ? 0 : 1;
  switch (style) {
    case 'short': b.add(hairShell({ W, H, phiMax: 2.15, region: (ux, uy, uz) => scalp(ux, uy, uz, -0.42), strands: 0.003 * S, strandK: 12, part: { th: -0.55, w: 0.07 },
      off: (ux, uy, uz) => 0.006 + 0.012 * Math.max(0, uy) + 0.007 * Math.max(0, uz) * Math.max(0, uy) - 0.003 * sstep(-0.1, -0.4, uy) })); break;
    case 'crew': b.add(hairShell({ W, H, phiMax: 2.1, region: (ux, uy, uz) => scalp(ux, uy, uz, -0.35) && uy > (uz > 0 ? 0.0 : -0.35), strands: 0.0008 * S, strandK: 16,
      off: (ux, uy) => 0.0035 + 0.003 * Math.max(0, uy) })); break;
    case 'side_part': b.add(hairShell({ W, H, phiMax: 2.15, region: (ux, uy, uz) => scalp(ux, uy, uz, -0.45), strands: 0.0045 * S, strandK: 10, part: { th: 0.62, w: 0.08 },
      off: (ux, uy, uz, th) => 0.007 + 0.02 * Math.max(0, uy - 0.1) + 0.008 * Math.max(0, uz) * Math.max(0, uy) * (th < 0.6 ? 1.3 : 0.6) - 0.003 * sstep(-0.1, -0.45, uy) })); break;
    case 'balding': b.add(hairShell({ W, H, phiMax: 2.1, region: (ux, uy, uz) => scalp(ux, uy, uz, -0.4) && uy < 0.42 - 0.5 * Math.max(0, uz), strands: 0.0015 * S, strandK: 14,
      off: 0.0055 })); break;
    case 'curly': b.add(hairShell({ W: lod ? 14 : 28, H: lod ? 8 : 16, phiMax: 2.15, region: (ux, uy, uz) => !faceHole(ux, uy, uz, 0.6, 0.72) && uy > -0.45 && !earZone(ux, uy, uz), strands: 0,
      off: (ux, uy, uz, th, ph) => 0.017 + 0.012 * Math.max(0, uy) + (lod ? 0.006 : 0.007 * (Math.sin(th * 13 + Math.sin(ph * 9) * 2) * Math.sin(ph * 11 + th * 3) + 1)) })); break;
    case 'afro': b.add(hairShell({ W: lod ? 14 : 28, H: lod ? 8 : 16, phiMax: 2.2, region: (ux, uy, uz) => !faceHole(ux, uy, uz, 0.58, 0.78) && uy > -0.45, strands: 0, hemAO: 0.5,
      off: (ux, uy, uz, th, ph) => 0.032 + 0.05 * Math.max(0, uy + 0.3) + (lod ? 0.004 : 0.005 * (Math.sin(th * 17 + ph * 5) * Math.sin(ph * 15 - th * 4) + 1)) })); break;
    case 'pixie': b.add(hairShell({ W, H, phiMax: 2.15, region: (ux, uy, uz) => { const az = Math.atan2(ux, uz); if (uz > 0 && Math.abs(az) < 0.9) return uy > 0.3 + 0.12 * (az + 0.9) / 1.8 - (az < 0 ? 0.0 : 0); return scalp(ux, uy, uz, -0.45); },
      strands: 0.004 * S, strandK: 9, part: { th: -0.7, w: 0.08 }, off: (ux, uy, uz, th) => 0.008 + 0.014 * Math.max(0, uy) + (uz > 0.5 && uy < 0.55 ? 0.008 : 0) })); break;
    case 'bob': {
      const fringe = true;
      b.add(hairShell({ W, H: lod ? 9 : 15, phiMax: 2.62, part: { th: 0.45, w: 0.08 },
        region: (ux, uy, uz) => { const az = Math.atan2(ux, uz); if (uz > 0 && Math.abs(az) < 0.68) return fringe && uy > 0.34 + 0.09 * (az + 0.68) + 0.025 * Math.abs(Math.sin(az * 11)); return uy > -0.84 - 0.04 * Math.sin(az * 6); },
        strands: 0.005 * S, strandK: 9, off: (ux, uy, uz, th) => 0.014 + 0.01 * Math.max(0, uy) + 0.01 * clamp(0.3 - uy, 0, 1) + 0.004 * Math.sin(th * 5 + 1) * sstep(0.2, -0.5, uy),
        drape: { y: 0.09, flare: 0.55, curl: 0.012, len: 0.085 } }));
      break;
    }
    case 'long': case 'bangs': case 'ponytail': case 'bun': {
      const long = style === 'long' || style === 'bangs', bangs = style === 'bangs';
      b.add(hairShell({ W, H: lod ? 9 : 14, phiMax: long ? 2.55 : 2.15, part: bangs ? null : { th: style === 'long' ? 0 : 0.0, w: 0.06 },
        region: (ux, uy, uz) => {
          const az = Math.atan2(ux, uz);
          if (bangs && uz > 0 && Math.abs(az) < 0.62) return uy > 0.26 + 0.015 * Math.abs(Math.sin(az * 14));
          if (faceHole(ux, uy, uz, 0.6, 0.64)) return false;
          if (!long && earZone(ux, uy, uz)) return false;
          return long ? uy > -0.82 : uy > (uz > 0 ? -0.05 : -0.45);
        },
        strands: (long ? 0.004 : 0.0022) * S, strandK: long ? 10 : 14,
        off: long ? (ux, uy) => 0.011 + 0.012 * clamp(0.3 - uy, 0, 1) + (Math.abs(ux) > 0.8 && uy < 0.25 ? 0.014 : 0) : (ux, uy) => 0.0065 + 0.003 * Math.max(0, uy),
        drape: long ? { y: 0.08, flare: 0.35 } : null }));
      if (long) b.add(curtain(lod, 1));
      else if (style === 'bun') {
        const bun = loft(subdiv([[0.045, 0.004, 0.004, 0.004], [0.04, 0.025, 0.025, 0.025], [0.025, 0.04, 0.038, 0.038], [0.0, 0.046, 0.043, 0.043], [-0.025, 0.04, 0.038, 0.038], [-0.04, 0.022, 0.022, 0.022], [-0.045, 0.004, 0.004, 0.004]], lod ? 0 : 1), lod ? 7 : 14, {
          shape: (x, y, z, a) => { const r = 1 + (lod ? 0 : 0.1 * Math.abs(Math.sin(a * 3 + y * 60))); return [x * r, y, z * r]; },
          uvfn: (x, y, z, a) => [a * 0.6 + y * 8, y * 6 + 0.3], vfn: () => 0.7 });
        bun.applyMatrix4(rotX(-1.0)); bun.translate(0, 0.19, -0.075);
        b.add(bun, null, null, true);
      } else {
        // gathered base of the ponytail (tail itself is a separate swinging part)
        b.add(ell(PONY_TIE[0], PONY_TIE[1], PONY_TIE[2] + 0.006, 0.022, 0.02, 0.016, lod ? 6 : 9, lod ? 4 : 6), 0.6);
      }
      break;
    }
  }
  return b.build();
}

// ---------- hats (head-bone frame). aV zones: 0.1 crown, 0.5 band, 0.9 peak/brim ----------
function hatGeo(kind) {
  const b = new GB(); const cy = HEAD_C[1] + 0.022, cz = HEAD_C[2] - 0.004;
  const dome = (r, h, y0, sz = 1.12) => { const g = new THREE.SphereGeometry(r, 18, 8, 0, TAU, 0, PI / 2); g.scale(1, h / r, sz); g.translate(0, y0, cz); return g; };
  switch (kind) {
    case 'officer_cap': case 'captain_cap': {
      b.add(cyl(0, cy + 0.06, cz, 0.088, 0.086, 0.045, 18), 0.5);
      b.add(cyl(0, cy + 0.095, cz + 0.01, 0.112, 0.09, 0.03, 18), 0.1);
      b.add(cyl(0, cy + 0.111, cz + 0.01, 0.112, 0.112, 0.004, 18), 0.1);
      const peak = new THREE.CylinderGeometry(0.075, 0.08, 0.008, 12, 1, false, -PI / 2, PI);
      peak.scale(1, 1, 0.75); peak.rotateX(0.35); peak.translate(0, cy + 0.04, cz + 0.07); b.add(peak, 0.5);
      if (kind === 'captain_cap') b.add(box(0, cy + 0.075, cz + 0.088, 0.03, 0.022, 0.01), 0.9);
      else b.add(box(0, cy + 0.075, cz + 0.088, 0.022, 0.018, 0.008), 0.9);
      break;
    }
    case 'security_cap': case 'ball_cap': {
      b.add(dome(0.093, 0.085, cy + 0.035), 0.1);
      b.add(cyl(0, cy + 0.035, cz, 0.093, 0.094, 0.012, 18), 0.5);
      const bill = new THREE.CylinderGeometry(0.08, 0.08, 0.008, 12, 1, false, -PI / 2, PI);
      bill.scale(1, 1, 1.1); bill.rotateX(0.1); bill.translate(0, cy + 0.04, cz + 0.075); b.add(bill, 0.9);
      b.add(ell(0, cy + 0.12, cz, 0.008, 0.004, 0.008, 6, 3), 0.5);
      if (kind === 'security_cap') b.add(box(0, cy + 0.08, cz + 0.098, 0.04, 0.02, 0.004), 0.5);
      break;
    }
    case 'visor': {
      b.add(cyl(0, cy + 0.055, cz, 0.091, 0.091, 0.03, 18, true), 0.5);
      const bill = new THREE.CylinderGeometry(0.085, 0.085, 0.008, 12, 1, false, -PI / 2, PI);
      bill.rotateX(0.15); bill.translate(0, cy + 0.045, cz + 0.07); b.add(bill, 0.9);
      break;
    }
    case 'sun_hat': {
      b.add(dome(0.095, 0.1, cy + 0.04, 1.08), 0.1);
      b.add(cyl(0, cy + 0.045, cz, 0.097, 0.098, 0.022, 18), 0.5);
      const brim = new THREE.CylinderGeometry(0.17, 0.205, 0.012, 24, 1, false); brim.translate(0, cy + 0.035, cz);
      const P = brim.attributes.position; for (let k = 0; k < P.count; k++) { const x = P.getX(k), z = P.getZ(k) - cz; const r = Math.hypot(x, z); P.setY(k, P.getY(k) - Math.max(0, r - 0.12) * 0.25); }
      brim.computeVertexNormals(); b.add(brim, 0.9);
      break;
    }
    case 'chef_hat': {
      b.add(cyl(0, cy + 0.07, cz, 0.095, 0.092, 0.05, 18), 0.5);
      b.add(cyl(0, cy + 0.15, cz, 0.11, 0.095, 0.12, 18), 0.1);
      b.add(ell(0, cy + 0.21, cz, 0.115, 0.04, 0.115, 16, 6), 0.1);
      break;
    }
    case 'beanie': {
      b.add(dome(0.094, 0.11, cy + 0.03, 1.1), 0.1);
      b.add(cyl(0, cy + 0.03, cz, 0.097, 0.096, 0.035, 18), 0.5);
      break;
    }
  }
  return b.build();
}

// ---------- accessories ----------
function accGeo(kind) {
  const b = new GB();
  switch (kind) {
    case 'collar': { // chest-bone frame: shirt collar band + turned-down points at the front
      b.add(loft([[0.258, 0.058, 0.056, 0.062], [0.29, 0.06, 0.058, 0.064], [0.3, 0.058, 0.056, 0.062], [0.292, 0.066, 0.064, 0.07], [0.262, 0.07, 0.068, 0.074]], 16,
        { shape: (x, y, z, a) => [x, y - (Math.cos(a) > 0.9 ? 0.012 : 0), z] }), 0.5);
      for (const s of [-1, 1]) { // collar points
        const g = new THREE.BufferGeometry();
        const v = [s * 0.006, 0.288, 0.066, s * 0.04, 0.285, 0.052, s * 0.022, 0.245, 0.083];
        g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(s > 0 ? [0, 2, 1] : [0, 1, 2]); g.computeVertexNormals();
        b.add(g, 0.5);
        const g2 = g.clone(); g2.setIndex(s > 0 ? [0, 1, 2] : [0, 2, 1]); g2.translate(0, 0, -0.002); g2.computeVertexNormals(); b.add(g2, 0.5);
      }
      break;
    }
    case 'collar_high':
      b.add(loft([[0.25, 0.064, 0.06, 0.066], [0.33, 0.058, 0.056, 0.062], [0.335, 0.054, 0.052, 0.058], [0.25, 0.06, 0.056, 0.062]], 16), 0.5);
      break;
    case 'placket': { // V shirt-front visible on suits/waistcoats; chest frame, lapel edges
      const shape = new THREE.Shape(); shape.moveTo(-0.058, 0.255); shape.lineTo(0.058, 0.255); shape.lineTo(0.0, 0.02); shape.lineTo(-0.058, 0.255);
      const g = new THREE.ShapeGeometry(shape);
      const P = g.attributes.position; for (let k = 0; k < P.count; k++) { const y = P.getY(k); P.setZ(k, 0.108 + 0.016 * Math.sin(clamp(y / 0.25, 0, 1) * 2.4) - Math.max(0, y - 0.2) * 0.5); }
      g.computeVertexNormals(); b.add(g, 0.1);
      break;
    }
    case 'buttons': { // shirt/jacket button column, chest frame (front surface ≈ z 0.104..0.118)
      for (let k = 0; k < 4; k++) { const y = 0.215 - k * 0.062; const z = 0.103 + 0.014 * Math.sin(clamp(y / 0.25, 0, 1) * 2.6); b.add(ell(0, y, z + 0.004, 0.0055, 0.0055, 0.0025, 6, 3), 0.5); }
      break;
    }
    case 'buckle': b.add(box(0, 0.113, 0.093, 0.04, 0.03, 0.008), 0.5); break;   // pelvis frame
    case 'necklace': { // chest frame, around the base of the neck, dipping on the chest
      const t = new THREE.TorusGeometry(0.068, 0.0028, 4, 22); t.rotateX(PI / 2);
      const P = t.attributes.position; for (let k = 0; k < P.count; k++) { const z = P.getZ(k); P.setZ(k, z * 1.25 + 0.006); P.setY(k, P.getY(k) + 0.262 - Math.max(0, z) * 0.55); }
      t.computeVertexNormals(); b.add(t, 0.5);
      break;
    }
    case 'cuff': { // unit sleeve/trouser hem band (radius 1, height 1 along -Y) — scaled per instance
      const g = new THREE.CylinderGeometry(1, 1.03, 1, 10, 1, true); g.translate(0, -0.5, 0); b.add(g, 0.5);
      const rim = new THREE.RingGeometry(0.9, 1.03, 10, 1); rim.rotateX(PI / 2); rim.translate(0, -1, 0); b.add(rim, 0.5);
      break;
    }
    case 'tie': {
      const g = loft([[0.0, 0.0, 0, 0], [0.005, 0.03, 0.006, 0.006], [0.15, 0.022, 0.006, 0.006], [0.22, 0.01, 0.006, 0.006], [0.235, 0.0, 0.0, 0.0]], 6);
      g.applyMatrix4(M().makeTranslation(0, 0.005, 0)); b.add(g, 0.5, M().makeRotationX(0.12).premultiply(M().makeTranslation(0, 0.015, 0.113)));
      b.add(ell(0, 0.262, 0.07, 0.011, 0.011, 0.008, 6, 4), 0.5);
      break;
    }
    case 'bowtie':
      b.add(ell(-0.022, 0.25, 0.1, 0.022, 0.014, 0.008, 7, 5), 0.5); b.add(ell(0.022, 0.25, 0.1, 0.022, 0.014, 0.008, 7, 5), 0.5); b.add(ell(0, 0.25, 0.104, 0.008, 0.009, 0.008, 5, 4), 0.5);
      break;
    case 'epaulette':
      for (const sx of [-1, 1]) {
        b.add(box(sx * 0.13, 0.228, -0.004, 0.105, 0.012, 0.052), 0.1);
        b.add(box(sx * 0.165, 0.236, -0.004, 0.012, 0.006, 0.054), 0.5);
        b.add(box(sx * 0.145, 0.236, -0.004, 0.008, 0.006, 0.054), 0.5);
      }
      break;
    case 'apron': {
      const g = new THREE.PlaneGeometry(0.3, 1, 4, 6); g.translate(0, -0.5, 0);
      const P = g.attributes.position; for (let k = 0; k < P.count; k++) { const x = P.getX(k); P.setZ(k, 0.115 - x * x * 1.6); }
      g.computeVertexNormals(); b.add(g, 0.5);
      const g2 = g.clone(); g2.applyMatrix4(M().makeTranslation(0, 0, -0.003)); const idx = g2.index.array; for (let k = 0; k < idx.length; k += 3) { const t = idx[k]; idx[k] = idx[k + 1]; idx[k + 1] = t; } g2.computeVertexNormals(); b.add(g2, 0.5);
      break;
    }
    case 'radio_chest':
      b.add(box(0.11, 0.17, 0.098, 0.035, 0.06, 0.022), 0.5); b.add(cyl(0.12, 0.21, 0.098, 0.004, 0.004, 0.04, 5), 0.5);
      break;
    case 'badge': b.add(box(0.075, 0.14, 0.118, 0.04, 0.012, 0.006), 0.5); break;
    case 'glasses': {
      const cy = HEAD_C[1] - 0.001, z = 0.104;
      for (const s of [-1, 1]) {
        const rim = new THREE.TorusGeometry(0.0175, 0.0022, 4, 12); rim.scale(1.15, 0.8, 1); rim.translate(s * 0.032, cy, z); b.add(rim, 0.5);
        b.add(box(s * 0.079, cy + 0.004, z - 0.048, 0.003, 0.004, 0.095), 0.5);
      }
      b.add(box(0, cy + 0.004, z + 0.002, 0.03, 0.003, 0.003), 0.5);
      break;
    }
    case 'sunglasses': {
      const cy = HEAD_C[1] - 0.001, z = 0.105;
      for (const s of [-1, 1]) { const l = new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, PI / 2); l.rotateX(PI / 2); l.scale(0.021, 0.016, 0.006); l.translate(s * 0.032, cy, z); b.add(l, 0.5); b.add(box(s * 0.079, cy + 0.004, z - 0.048, 0.003, 0.004, 0.095), 0.5); }
      b.add(box(0, cy + 0.006, z + 0.002, 0.026, 0.003, 0.003), 0.5);
      break;
    }
    case 'belt_kit':
      b.add(loft([[0.13, 0.152, 0.104, 0.097], [0.09, 0.168, 0.108, 0.106]], 16), 0.5);
      b.add(box(-0.17, 0.05, 0.0, 0.03, 0.11, 0.06), 0.5); b.add(box(0.15, 0.08, 0.06, 0.035, 0.05, 0.04), 0.5); b.add(box(0.12, 0.08, -0.09, 0.035, 0.05, 0.04), 0.5);
      break;
  }
  return b.build();
}

// ---------- hands (right-hand frame; mirrored for the left): fingers along -Y, palm faces +X, thumb +Z ----------
function hand(fist, lod) {
  const b = new GB();
  const n = lod ? 5 : 8;
  if (!fist) {
    // palm + mitten fingers, fingers gently curled toward the palm (+X); tips stepped (middle longest)
    const R = [[0.012, 0.012, 0.018, 0.018, 0], [0.0, 0.017, 0.026, 0.026, 0], [-0.02, 0.016, 0.036, 0.036, 0.002], [-0.05, 0.0145, 0.042, 0.042, 0.003], [-0.085, 0.013, 0.043, 0.043, 0.003],
      [-0.105, 0.0115, 0.041, 0.041, 0.002], [-0.13, 0.0098, 0.038, 0.038, 0.001], [-0.155, 0.0088, 0.035, 0.035, 0], [-0.172, 0.0075, 0.03, 0.03, -0.001], [-0.18, 0.004, 0.02, 0.02, -0.001]];
    b.add(loft(lod ? R.filter((_, i) => i % 2 === 0 || i === R.length - 1) : R, n, {
      shape: (x, y, z) => {
        const t = clamp((-y - 0.09) / 0.09, 0, 1);
        x += 0.026 * t * t;                                // curl
        if (y < -0.15) y += 0.012 * Math.max(0, -z / 0.04) * ((-y - 0.15) / 0.03) + 0.004 * Math.max(0, z / 0.04);   // pinky shorter, index slightly
        if (y < -0.1 && !lod) x -= 0.0015 * Math.abs(Math.sin(z / 0.04 * PI * 2)) * (x < 0 ? 1 : 0); // knuckle grooves on the back
        return [x, y, z];
      },
    }));
    // thumb
    const th = loft([[0.006, 0.006, 0.006, 0.006], [0.0, 0.012, 0.012, 0.012], [-0.025, 0.011, 0.0105, 0.0105], [-0.05, 0.0092, 0.009, 0.009], [-0.062, 0.006, 0.006, 0.006], [-0.066, 0.002, 0.002, 0.002]], lod ? 5 : 7);
    b.add(th, 0, M().makeRotationX(0.7).premultiply(M().makeRotationZ(0.35)).premultiply(M().makeTranslation(0.006, -0.03, 0.03)));
  } else {
    const R = [[0.012, 0.012, 0.018, 0.018, 0], [0.0, 0.018, 0.026, 0.026, 0], [-0.03, 0.022, 0.039, 0.039, 0.003], [-0.065, 0.028, 0.043, 0.043, 0.008], [-0.092, 0.027, 0.041, 0.041, 0.01], [-0.108, 0.016, 0.034, 0.034, 0.012], [-0.113, 0.004, 0.01, 0.01, 0.012]];
    b.add(loft(R, n, { shape: (x, y, z) => [x + (y < -0.05 ? 0.008 : 0), y, z] }));
    b.add(ell(0.02, -0.062, 0.03, 0.012, 0.024, 0.011, lod ? 5 : 7, lod ? 4 : 5));
  }
  return b.build();
}
// Shoe at ankle origin; sole at y=-0.075. aV 0 at top of shoe … 1 at sole (sole zone ≥ 0.82).
function shoe(kind, lod) {
  const heel = -0.065;
  const rings = kind === 'boot' ? [
    [heel - 0.004, 0.006, 0.006, 0.006, -0.01], [heel, 0.034, 0.05, 0.05, -0.01], [heel + 0.03, 0.042, 0.07, 0.035, 0.0], [0.03, 0.045, 0.062, 0.04, -0.02], [0.08, 0.048, 0.044, 0.04, -0.04],
    [0.13, 0.047, 0.037, 0.036, -0.045], [0.165, 0.042, 0.032, 0.031, -0.048], [0.188, 0.032, 0.026, 0.026, -0.05], [0.198, 0.008, 0.01, 0.01, -0.052]]
    : [
    [heel - 0.004, 0.006, 0.006, 0.006, -0.035], [heel, 0.031, 0.034, 0.034, -0.035], [heel + 0.03, 0.039, 0.046, 0.034, -0.03], [0.03, 0.042, 0.041, 0.034, -0.04], [0.08, 0.046, 0.031, 0.031, -0.05],
    [0.13, 0.044, 0.026, 0.026, -0.052], [0.165, 0.039, 0.022, 0.021, -0.054], [0.188, 0.03, 0.018, 0.017, -0.056], [0.198, 0.008, 0.008, 0.008, -0.057]];
  const rr = lod ? rings.filter((_, i) => i % 2 === 0 || i === rings.length - 1) : rings;
  const g = loft(rr.map(r => [r[0], r[1], r[2], r[3], -(r[4] || 0)]), lod ? 6 : 9, { theta: (k, n) => (k / n) * TAU, aofn: () => 1 });
  g.applyMatrix4(rotX(PI / 2));
  const P = g.attributes.position;
  const v = new Float32Array(P.count);
  for (let k = 0; k < P.count; k++) {
    let y = P.getY(k); if (y < -0.075) y = -0.075; P.setY(k, y);
    v[k] = lin(y, kind === 'boot' ? 0.05 : -0.02, -0.075, 0, 1);
  }
  g.computeVertexNormals();
  g.setAttribute('aV', new THREE.BufferAttribute(v, 1));
  return g;
}
// Flared skirt / jacket tail in reference-body metres (pelvis frame, top at the waist). Height 1 (scaled to
// the garment length per instance); the first ~12% conforms over the hips, then flares. DoubleSide material.
function skirt(flare = 0.6, lod = 0, folds = 1) {
  const n = lod ? 10 : 22, rows = lod ? 3 : 7, pos = [], idx = [], vv = [], aos = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const hip = Math.min(1, t / 0.14), hs = Math.sin(hip * PI / 2);
    const fl = 1 + flare * Math.max(0, (t - 0.14) / 0.86);
    const rx = (0.152 + 0.032 * hs) * fl, rf = (0.106 + 0.014 * hs) * fl, rb = (0.098 + 0.04 * hs) * fl;
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU, c = Math.cos(a);
      const fold = lod ? 0 : 0.045 * folds * Math.sin(a * 9 + Math.sin(a * 2) * 1.2) * Math.max(0, t - 0.18) * (0.4 + flare);
      const hem = j === rows ? 1.015 : 1;
      pos.push(Math.sin(a) * rx * (1 + fold) * hem, -t, c * (c > 0 ? rf : rb) * (1 + fold) * hem);
      vv.push(t); aos.push(j === 0 ? 0.85 : 1);
    }
  }
  for (let j = 0; j < rows; j++) for (let k = 0; k < n; k++) {
    const a = j * n + k, b = j * n + (k + 1) % n, c = (j + 1) * n + k, d = (j + 1) * n + (k + 1) % n;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(vv, 1));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(aos, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------- props (right-hand frame: fingers -Y, palm +X, thumb +Z; grip point ≈ (0.01,-0.075,0)) ----------
function propGeo(kind) {
  const b = new GB(); const gx = 0.012, gy = -0.075;
  switch (kind) {
    case 'pistol':
      b.add(box(gx, gy, 0.0, 0.03, 0.035, 0.11), 0.5);
      b.add(box(gx, gy - 0.07, 0.07, 0.028, 0.19, 0.035), 0.1);
      b.add(box(gx, gy - 0.02, 0.035, 0.012, 0.03, 0.02), 0.5);
      break;
    case 'taser':
      b.add(box(gx, gy, 0.0, 0.03, 0.035, 0.1), 0.1);
      b.add(box(gx, gy - 0.06, 0.065, 0.034, 0.15, 0.045), 0.5);
      b.add(box(gx, gy - 0.14, 0.065, 0.03, 0.01, 0.035), 0.9);
      break;
    case 'baton':
      b.add(cyl(0, 0, 0, 0.016, 0.014, 0.55, 8), 0.1, M().makeRotationX(PI / 2).premultiply(M().makeTranslation(gx, gy, 0.2)));
      b.add(cyl(0, 0, 0, 0.02, 0.02, 0.14, 8), 0.5, M().makeRotationX(PI / 2).premultiply(M().makeTranslation(gx, gy, -0.02)));
      break;
    case 'phone': b.add(box(0.03, gy - 0.02, 0.01, 0.009, 0.15, 0.072), 0.5); break;
    case 'radio':
      b.add(box(gx, gy - 0.01, 0.0, 0.035, 0.11, 0.06), 0.1);
      b.add(cyl(gx, gy + 0.08, 0.015, 0.005, 0.005, 0.08, 5), 0.1);
      break;
    case 'camera':
      b.add(box(gx + 0.02, gy - 0.03, 0.03, 0.07, 0.13, 0.09), 0.1);
      b.add(cyl(0, 0, 0, 0.03, 0.032, 0.07, 10), 0.5, M().makeRotationZ(PI / 2).premultiply(M().makeTranslation(gx + 0.08, gy - 0.03, 0.03)));
      break;
    case 'drink':
      b.add(cyl(0.0, 0.03, 0.0, 0.036, 0.03, 0.11, 10), 0.1);
      b.add(cyl(0.0, 0.015, 0.0, 0.031, 0.027, 0.07, 10), 0.5);
      break;
    case 'tray':
      b.add(cyl(0, 0.02, 0.0, 0.2, 0.19, 0.016, 18), 0.5);
      for (const [x, z] of [[0.07, 0.05], [-0.06, -0.04], [0.02, -0.09]]) { b.add(cyl(x, 0.08, z, 0.03, 0.022, 0.1, 8), 0.1); b.add(cyl(x, 0.06, z, 0.026, 0.02, 0.05, 8), 0.9); }
      break;
    case 'luggage':
      b.add(box(0, 0.34, 0.0, 0.38, 0.62, 0.23), 0.1);
      b.add(box(0, 0.34, 0.118, 0.3, 0.5, 0.01), 0.5);
      for (const sx of [-1, 1]) { b.add(cyl(sx * 0.04, 0.8, -0.08, 0.008, 0.008, 0.32, 5), 0.5); b.add(cyl(0, 0, 0, 0.025, 0.025, 0.02, 8), 0.9, M().makeRotationZ(PI / 2).premultiply(M().makeTranslation(sx * 0.15, 0.0, -0.06))); }
      b.add(box(0, 0.955, -0.08, 0.11, 0.025, 0.025), 0.5);
      break;
    case 'mop': {
      const ang = 0.62;
      const dir = new THREE.Vector3(0, -Math.cos(ang), Math.sin(ang));
      const len = 1.35, top = 0.3;
      const mid = dir.clone().multiplyScalar((len / 2) - top);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      b.add(cyl(0, 0, 0, 0.013, 0.013, len, 7), 0.1, M().compose(mid, q, new THREE.Vector3(1, 1, 1)));
      const end = dir.clone().multiplyScalar(len - top);
      b.add(box(0, 0, 0, 0.32, 0.05, 0.1), 0.5, M().makeTranslation(end.x, end.y - 0.02, end.z + 0.02));
      b.add(box(0, 0, 0, 0.3, 0.05, 0.12), 0.5, M().makeTranslation(end.x, end.y - 0.06, end.z + 0.04));
      break;
    }
    case 'extinguisher':
      b.add(cyl(0, -0.3, 0.0, 0.07, 0.07, 0.42, 12), 0.1);
      b.add(ell(0, -0.09, 0.0, 0.07, 0.04, 0.07, 10, 5), 0.1);
      b.add(box(0, -0.03, 0.0, 0.02, 0.08, 0.08), 0.5);
      b.add(cyl(0.0, -0.2, 0.08, 0.01, 0.01, 0.25, 5), 0.5);
      break;
  }
  return b.build();
}

export const HAIR_LIST = ['short', 'crew', 'side_part', 'balding', 'curly', 'afro', 'pixie', 'bob', 'long', 'bangs', 'ponytail', 'bun'];
export const HAT_LIST = ['officer_cap', 'captain_cap', 'security_cap', 'ball_cap', 'visor', 'sun_hat', 'chef_hat', 'beanie'];
export const ACC_LIST = ['collar', 'collar_high', 'placket', 'buttons', 'buckle', 'necklace', 'tie', 'bowtie', 'epaulette', 'apron', 'radio_chest', 'badge', 'glasses', 'sunglasses', 'belt_kit', 'cuff'];
export const PROP_LIST = ['pistol', 'taser', 'baton', 'tray', 'drink', 'phone', 'radio', 'camera', 'luggage', 'mop', 'extinguisher'];
export const LEVEL_PROPS = new Set(['drink', 'tray', 'luggage', 'extinguisher', 'mop']);
// parts that have a far-LOD variant (key + '_L')
export const LOD_PARTS = ['head_m', 'head_f', 'neck', 'chest_m', 'chest_f', 'belly', 'pelvis', 'upperArm', 'forearm', 'hand', 'fist', 'handL', 'fistL', 'thigh', 'shin', 'shoe', 'boot', 'skirt', 'ptail', ...HAIR_LIST.map(h => 'hair_' + h)];

function mirrorX(g) {
  const m = g.clone(); m.applyMatrix4(M().makeScale(-1, 1, 1));
  const ix = m.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k]; ix[k] = ix[k + 1]; ix[k + 1] = t; }
  m.computeVertexNormals(); return m;
}

function buildSet(lod) {
  const G = {
    head_m: head(false, lod), head_f: head(true, lod), neck: neck(lod), chest_m: chest(false, lod), chest_f: chest(true, lod), belly: belly(lod), pelvis: pelvis(lod),
    upperArm: limb('upperArm', lod ? 6 : 10, lod ? 1 : 2, 0, 0.9, 1.25), forearm: limb('forearm', lod ? 6 : 9, lod ? 1 : 2, 0, 1.1, 0.9),
    hand: hand(false, lod), fist: hand(true, lod), thigh: limb('thigh', lod ? 7 : 12, lod ? 1 : 2, 0, 0.9, 1.3), shin: limb('shin', lod ? 6 : 10, lod ? 1 : 2, 0, 1.15, 0.9),
    shoe: shoe('shoe', lod), boot: shoe('boot', lod), skirt: skirt(0.55, lod), ptail: ponytail(lod),
  };
  G.handL = mirrorX(G.hand); G.fistL = mirrorX(G.fist);
  for (const h of HAIR_LIST) G['hair_' + h] = hairGeo(h, lod);
  return G;
}

export function buildPartGeometries() {
  const G = buildSet(0);
  G.tail = skirt(0.06, 0, 0.3);
  for (const h of HAT_LIST) G['hat_' + h] = hatGeo(h);
  for (const a of ACC_LIST) G['acc_' + a] = accGeo(a);
  for (const p of PROP_LIST) G['prop_' + p] = propGeo(p);
  const L = buildSet(1);
  for (const k of LOD_PARTS) if (L[k]) G[k + '_L'] = L[k];
  // make sure every geometry carries aV, aAO and uv
  for (const k in G) {
    const g = G[k]; const n = g.attributes.position.count;
    if (!g.attributes.aV) g.setAttribute('aV', new THREE.BufferAttribute(new Float32Array(n), 1));
    if (!g.attributes.aAO) g.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
  }
  return G;
}
// triangle counts per geometry (for budgets / tests)
export function triCount(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
