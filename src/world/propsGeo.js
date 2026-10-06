// Procedural prop geometry builder: merges primitives (rounded boxes, cylinders, lathes,
// tori, extrusions, ribbons, spheres) into ONE indexed BufferGeometry per prop type with
// per-vertex attributes:
//   color (linear RGB, with a gentle baked top-light / height AO term)
//   aEmi  (0 = none, 0..1.9 static emissive strength, 2.x animated screen, 3.x pulsing, 4.x night lamp)
//   aTint (1 = multiplied by the per-instance upholstery colour iTint)
//   aRM   (roughness, metalness)
// Parts flagged {glass:true} go to a secondary builder rendered with a transparent material.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const _c = new THREE.Color();

export const SCR = { radar: 2.05, chart: 2.15, ui: 2.25, uiLight: 2.35, cctv: 2.45, reels: 2.52, topper: 2.57, arcade: 2.65, eq: 2.75, water: 2.85, show: 2.95 };

export const RM = {
  fabric: [0.95, 0], velvet: [1.0, 0], leather: [0.55, 0], wood: [0.55, 0], lacquer: [0.18, 0], gloss: [0.12, 0],
  matte: [0.85, 0], plastic: [0.45, 0], rubber: [0.9, 0], stone: [0.3, 0], marble: [0.18, 0], ceramic: [0.25, 0],
  brass: [0.28, 1], gold: [0.25, 1], chrome: [0.12, 1], steel: [0.35, 0.9], brushed: [0.45, 0.85], iron: [0.6, 0.7],
  paint: [0.6, 0.15], screen: [0.08, 0.2], glass: [0.05, 0], water: [0.04, 0.1], linen: [0.9, 0], felt: [1.0, 0],
  leaf: [0.6, 0], soil: [1.0, 0], bronze: [0.32, 1],
};

export function lin(col) {
  if (Array.isArray(col)) return col;
  _c.set(col);
  return [_c.r, _c.g, _c.b];
}

export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
  _e.set(rx, ry, rz, order); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// Rounded box centred at origin; steps=1 gives a chamfer, 2+ a smooth radius.
const rbCache = new Map();
export function roundedBoxGeo(w, h, d, r, steps = 2) {
  r = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const key = [w, h, d, r, steps].map(v => +v.toFixed(4)).join(',');
  let g = rbCache.get(key);
  if (g) return g;
  const n = steps * 2 + 1;
  g = new THREE.BoxGeometry(2, 2, 2, n, n, n);
  const P = g.attributes.position, N = g.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  const map = (c, ax, out) => {
    const i = Math.round((c + 1) / 2 * n);
    if (i <= steps) { out.inner = -(half[ax] - r); out.s = -(1 - i / steps); }
    else { out.inner = half[ax] - r; out.s = (i - steps - 1) / steps; }
  };
  const o = [{}, {}, {}];
  for (let k = 0; k < P.count; k++) {
    map(P.getX(k), 0, o[0]); map(P.getY(k), 1, o[1]); map(P.getZ(k), 2, o[2]);
    _v.set(o[0].s, o[1].s, o[2].s);
    if (_v.lengthSq() < 1e-9) _v.set(N.getX(k), N.getY(k), N.getZ(k));
    _v.normalize();
    P.setXYZ(k, o[0].inner + _v.x * r, o[1].inner + _v.y * r, o[2].inner + _v.z * r);
    N.setXYZ(k, _v.x, _v.y, _v.z);
  }
  rbCache.set(key, g);
  return g;
}

const boxCache = new Map();
function unitBox() { let g = boxCache.get('b'); if (!g) { g = new THREE.BoxGeometry(1, 1, 1); boxCache.set('b', g); } return g; }

export class GB {
  constructor() { this.P = []; this.N = []; this.C = []; this.E = []; this.T = []; this.R = []; this.I = []; this.vc = 0; this.glass = null; this.aoH = 0; }

  // core: append a geometry transformed by matrix m
  add(geo, m, col, o = {}) {
    const tgt = o.glass ? (this.glass || (this.glass = new GB())) : this;
    const P = geo.attributes.position, N = geo.attributes.normal;
    _nm.getNormalMatrix(m);
    const c = lin(col);
    const emi = o.emi || 0, tint = o.tint ? 1 : 0;
    const rm = typeof o.m === 'string' ? (RM[o.m] || RM.matte) : (o.rm || o.m || RM.matte);
    const flip = o.flip || false;
    const base = tgt.vc;
    const shade = !emi && !o.noShade;
    const vcol = o.vcol;   // optional per-vertex colour fn (x,y,z) → [r,g,b] linear
    for (let k = 0; k < P.count; k++) {
      _v.set(P.getX(k), P.getY(k), P.getZ(k)).applyMatrix4(m);
      _n.set(N.getX(k), N.getY(k), N.getZ(k)).applyMatrix3(_nm).normalize();
      if (flip) _n.negate();
      tgt.P.push(_v.x, _v.y, _v.z); tgt.N.push(_n.x, _n.y, _n.z);
      let cc = vcol ? vcol(_v.x, _v.y, _v.z) : c;
      let k2 = 1;
      if (shade) {
        k2 = 0.86 + 0.14 * _n.y;                                // soft top light
        if (this.aoH > 0) k2 *= 0.72 + 0.28 * Math.min(1, Math.max(0, _v.y / this.aoH));  // floor contact AO
      }
      tgt.C.push(cc[0] * k2, cc[1] * k2, cc[2] * k2);
      tgt.E.push(emi); tgt.T.push(tint); tgt.R.push(rm[0], rm[1]);
    }
    if (geo.index) {
      const A = geo.index.array;
      if (flip) for (let k = 0; k < A.length; k += 3) tgt.I.push(base + A[k], base + A[k + 2], base + A[k + 1]);
      else for (let k = 0; k < A.length; k++) tgt.I.push(base + A[k]);
    } else {
      if (flip) for (let k = 0; k < P.count; k += 3) tgt.I.push(base + k, base + k + 2, base + k + 1);
      else for (let k = 0; k < P.count; k++) tgt.I.push(base + k);
    }
    tgt.vc += P.count;
    return this;
  }

  // ── primitives (all centre-based unless stated) ──────────────────────────
  // Box centred at (x,y,z); o.r rounding radius, o.steps, o.rot [rx,ry,rz]
  box(x, y, z, w, h, d, col, o = {}) {
    if (w <= 0 || h <= 0 || d <= 0) return this;
    const rot = o.rot || [0, 0, 0];
    if (o.r) return this.add(roundedBoxGeo(w, h, d, o.r, o.steps ?? 2), mat4(x, y, z, rot[0], rot[1], rot[2]), col, o);
    return this.add(unitBox(), mat4(x, y, z, rot[0], rot[1], rot[2], w, h, d), col, o);
  }
  // Axis-aligned box from bounds
  bx(x0, y0, z0, x1, y1, z1, col, o = {}) { return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), col, o); }
  // Vertical cylinder centred at (x,y,z) (y = centre), o.r2 top radius, o.seg, o.rot, o.open
  cyl(x, y, z, r, h, col, o = {}) {
    const seg = o.seg ?? 12;
    const g = cylGeo(o.r2 ?? r, r, h, seg, !!o.open, o.thetaStart ?? 0, o.theta ?? Math.PI * 2);
    const rot = o.rot || [0, 0, 0];
    return this.add(g, mat4(x, y, z, rot[0], rot[1], rot[2], o.sx ?? 1, 1, o.sz ?? 1, o.order), col, o);
  }
  // Cylinder between two points
  pipe(a, b, r, col, o = {}) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B); if (len < 1e-4) return this;
    const g = cylGeo(o.r2 ?? r, r, len, o.seg ?? 8, !!o.open);
    const dir = B.clone().sub(A).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(g, m, col, o);
  }
  // Polyline pipe through points with joint spheres
  tube(pts, r, col, o = {}) {
    for (let k = 0; k < pts.length - 1; k++) this.pipe(pts[k], pts[k + 1], r, col, o);
    if (o.joints !== false) for (let k = 1; k < pts.length - 1; k++) this.sph(pts[k][0], pts[k][1], pts[k][2], r, col, { ...o, seg: o.seg ?? 8 });
    return this;
  }
  sph(x, y, z, r, col, o = {}) {
    const seg = o.seg ?? 10;
    const g = sphGeo(seg, Math.max(3, Math.round(seg * 0.6)), o.phiLen, o.thetaLen);
    const s = o.s || [1, 1, 1], rot = o.rot || [0, 0, 0];
    return this.add(g, mat4(x, y, z, rot[0], rot[1], rot[2], r * s[0], r * s[1], r * s[2]), col, o);
  }
  // Lathe: pts [[r,y],...] revolved around Y at (x,y,z)
  lathe(pts, x, y, z, col, o = {}) {
    const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), o.seg ?? 16, o.phiStart ?? 0, o.phi ?? Math.PI * 2);
    const rot = o.rot || [0, 0, 0], s = o.s || [1, 1, 1];
    return this.add(g, mat4(x, y, z, rot[0], rot[1], rot[2], s[0], s[1], s[2]), col, o);
  }
  // Torus in the XY plane (axis along Z) unless rotated
  torus(x, y, z, R, r, col, o = {}) {
    const g = new THREE.TorusGeometry(R, r, o.rs ?? 6, o.ts ?? 16, o.arc ?? Math.PI * 2);
    const rot = o.rot || [0, 0, 0], s = o.s || [1, 1, 1];
    return this.add(g, mat4(x, y, z, rot[0], rot[1], rot[2], s[0], s[1], s[2]), col, o);
  }
  // Extrude a 2D outline (XY) along +Z by depth; placed by matrix m (or o.pos/o.rot)
  ext(pts, depth, col, o = {}) {
    const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
    if (o.holes) for (const h of o.holes) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: !!o.bevel, bevelSize: o.bevel || 0, bevelThickness: o.bevel || 0, bevelSegments: o.bevelSeg ?? 1, curveSegments: o.curveSeg ?? 8 });
    const m = o.mat || mat4(...(o.pos || [0, 0, 0]), ...(o.rot || [0, 0, 0]), ...(o.s || [1, 1, 1]));
    return this.add(g, m, col, o);
  }
  // Double-sided ribbon through centre points with width vectors: pts [[x,y,z]], side [[x,y,z]] (half-width vectors)
  ribbon(pts, side, col, o = {}) {
    const n = pts.length;
    const pos = [], idx = [];
    const fold = o.fold || 0;     // V-fold depth along the normal (palm fronds)
    for (let k = 0; k < n; k++) {
      const p = pts[k], s = side[k];
      // approximate normal = side × tangent
      const t = k < n - 1 ? [pts[k + 1][0] - p[0], pts[k + 1][1] - p[1], pts[k + 1][2] - p[2]] : [p[0] - pts[k - 1][0], p[1] - pts[k - 1][1], p[2] - pts[k - 1][2]];
      const nn = new THREE.Vector3(...s).cross(new THREE.Vector3(...t)).normalize().multiplyScalar(fold * Math.hypot(...s));
      pos.push(p[0] - s[0], p[1] - s[1], p[2] - s[2]);
      pos.push(p[0] + nn.x, p[1] + nn.y, p[2] + nn.z);
      pos.push(p[0] + s[0], p[1] + s[1], p[2] + s[2]);
    }
    for (let k = 0; k < n - 1; k++) {
      const a = k * 3, b = (k + 1) * 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = o.mat || new THREE.Matrix4();
    this.add(g, m, col, o);
    if (!o.single) this.add(g, m, o.back ?? col, { ...o, flip: true });
    return this;
  }
  // Arbitrary BufferGeometry
  geo(g, m, col, o = {}) { if (!g.attributes.normal) g.computeVertexNormals(); return this.add(g, m, col, o); }

  // ── output ───────────────────────────────────────────────────────────────
  get tris() { return this.I.length / 3 + (this.glass ? this.glass.I.length / 3 : 0); }
  build() {
    if (!this.vc) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aEmi', new THREE.Float32BufferAttribute(this.E, 1));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.T, 1));
    g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.R, 2));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

const cylCache = new Map();
function cylGeo(rt, rb, h, seg, open, ts = 0, tl = Math.PI * 2) {
  const key = `${rt.toFixed(4)},${rb.toFixed(4)},${h.toFixed(4)},${seg},${open},${ts.toFixed(3)},${tl.toFixed(3)}`;
  let g = cylCache.get(key);
  if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, ts, tl); cylCache.set(key, g); }
  return g;
}
const sphCache = new Map();
function sphGeo(ws, hs, phiLen = Math.PI * 2, thetaLen = Math.PI) {
  const key = `${ws},${hs},${phiLen},${thetaLen}`;
  let g = sphCache.get(key);
  if (!g) { g = new THREE.SphereGeometry(1, ws, hs, 0, phiLen, 0, thetaLen); sphCache.set(key, g); }
  return g;
}

// deterministic tiny RNG for model details
export function prng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
