// HALCYON TIDE — weapon definitions + combat FX (muzzle flash, tracers, sparks, bullet holes, glass, taser wires,
// extinguisher spray, tasteful hit puffs). One pooled FX system shared by the player and the guards.
//
//   WEAPONS[id] = {id, name, slot, kind:'melee'|'gun'|'taser'|'spray', held (character prop), range, damage, ...}
//   new CombatFX(game) → fx.muzzle(pos, dir), fx.tracer(a, b), fx.sparks(p, n, color), fx.decal(p, normal),
//     fx.glass(p), fx.puff(p, color), fx.wires(a, b), fx.spray(origin, dir, dt), fx.update(dt)
import * as THREE from 'three';

export const WEAPONS = {
  fists:        { id: 'fists', name: 'Fists', slot: 1, kind: 'melee', held: 'none', range: 1.45, damage: 17, heavy: 34, cooldown: 0.36, stamina: 7, heavyStamina: 22, sfx: 'punch', icon: '✊' },
  baton:        { id: 'baton', name: 'Baton', slot: 2, kind: 'melee', held: 'baton', range: 1.85, damage: 34, heavy: 55, cooldown: 0.62, stamina: 10, heavyStamina: 26, sfx: 'baton_hit', icon: '▮' },
  taser:        { id: 'taser', name: 'Taser', slot: 3, kind: 'taser', held: 'taser', range: 7, reload: 2.5, stun: [30, 60], sfx: 'taser', icon: '⚡' },
  pistol:       { id: 'pistol', name: 'Pistol', slot: 4, kind: 'gun', held: 'pistol', range: 60, damage: 34, mag: 15, rof: 0.16, reload: 1.7, spread: 0.004, hipSpread: 0.03, moveSpread: 0.03, bloom: 0.007, bloomMax: 0.028, recoil: 0.045, sfx: 'gunshot', icon: '⌐', ammoItem: 'pistol_ammo' },
  extinguisher: { id: 'extinguisher', name: 'Fire extinguisher', slot: 5, kind: 'spray', held: 'extinguisher', range: 5.5, cone: 0.42, charge: 100, drain: 11, sfx: 'spray', icon: '◍' },
};
export const SLOTS = ['fists', 'baton', 'taser', 'pistol', 'extinguisher'];
export const PART_MULT = { head: 2.5, body: 1, legs: 0.65 };

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1), _z = new THREE.Vector3(0, 0, 1);

function radialTex(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,140,40,0)', size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.7)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function holeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(8,8,8,1)'); gr.addColorStop(0.22, 'rgba(20,18,16,0.95)'); gr.addColorStop(0.4, 'rgba(60,55,50,0.55)'); gr.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(30,28,26,0.6)'; g.lineWidth = 1.5;
  for (let k = 0; k < 6; k++) { const a = k * 1.05 + 0.3; g.beginPath(); g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6); g.lineTo(32 + Math.cos(a) * (13 + (k % 3) * 4), 32 + Math.sin(a) * (13 + (k % 3) * 4)); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class CombatFX {
  constructor(game) {
    this.game = game; const scene = this.scene = game.scene;
    this.group = new THREE.Group(); this.group.name = 'combatFX'; scene.add(this.group);
    // muzzle flash: sprite + one point light
    this.flashMat = new THREE.SpriteMaterial({ map: radialTex(), color: 0xb0a080, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.flashes = [];
    for (let i = 0; i < 4; i++) { const s = new THREE.Sprite(this.flashMat.clone()); s.visible = false; s.renderOrder = 10; this.group.add(s); this.flashes.push({ s, t: 0 }); }
    this.light = new THREE.PointLight(0xffb060, 0, 9, 2); this.light.castShadow = false; this.group.add(this.light); this.lightT = 0;
    // tracers & wires: line segments pool
    const lg = new THREE.BufferGeometry(); this.lineN = 24;
    this.linePos = new Float32Array(this.lineN * 6); this.lineCol = new Float32Array(this.lineN * 6);
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3)); lg.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 9; this.group.add(this.lines);
    this.lineSlots = []; for (let i = 0; i < this.lineN; i++) this.lineSlots.push({ t: 0, life: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Color(), wobble: false });
    // particles (sparks, glass, puffs, spray)
    this.pN = 900;
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(this.pN * 3); this.pCol = new Float32Array(this.pN * 3); this.pSize = new Float32Array(this.pN);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3)); pg.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const pm = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 32) }, uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = clamp(size*8.0, 0.0, 1.0); vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = size * 600.0 / max(0.2, -mv.z); }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); if (t.a < 0.02) discard; gl_FragColor = vec4(vC, t.a * vA); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(pg, pm); this.points.frustumCulled = false; this.points.renderOrder = 8; this.group.add(this.points);
    this.parts = []; for (let i = 0; i < this.pN; i++) this.parts.push({ life: 0, t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, s: 0.02, grow: 0, drag: 1, grav: 0, additive: false });
    this.pI = 0;
    // decals (bullet holes): instanced quads
    this.dN = 120;
    const dg = new THREE.PlaneGeometry(0.11, 0.11);
    this.decals = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ map: holeTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true }), this.dN);
    this.decals.count = 0; this.decals.frustumCulled = false; this.decals.renderOrder = 3; this.group.add(this.decals);
    this.dI = 0; this.decalDeck = new Int8Array(this.dN);
  }

  muzzle(pos, dir, big = 1) {
    const f = this.flashes.find(f => f.t <= 0) || this.flashes[0];
    f.s.position.copy(pos).addScaledVector(dir, 0.08); f.s.visible = true; f.t = 0.05; f.s.scale.setScalar(0.22 * big); f.s.material.rotation = Math.random() * 6.28;
    this.light.position.copy(pos).addScaledVector(dir, 0.1); this.light.intensity = 7 * big; this.lightT = 0.06;
    for (let k = 0; k < 5; k++) this._spawn(pos.x, pos.y, pos.z, dir.x * 3 + (Math.random() - 0.5) * 1.5, dir.y * 3 + Math.random(), dir.z * 3 + (Math.random() - 0.5) * 1.5, 1, 0.75, 0.35, 0.012, 0.09, { grav: 4 });
  }
  _line(a, b, color, life, wobble = false) {
    const s = this.lineSlots.find(s => s.t <= 0) || this.lineSlots[0];
    s.a.copy(a); s.b.copy(b); s.c.set(color); s.t = life; s.life = life; s.wobble = wobble;
  }
  tracer(a, b) { this._line(a, b, 0xffd890, 0.07); }
  wires(a, b) { this._line(a, b, 0x9fd8ff, 0.45, true); const m = new THREE.Vector3().lerpVectors(a, b, 0.5); this._line(a, m.add(new THREE.Vector3(0, -0.15, 0)), 0x6fb8ff, 0.45, true); this.sparks(b, 10, 0x9fd8ff); }
  sparks(p, n = 8, color = 0xffc070) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) this._spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, c.r, c.g, c.b, 0.012 + Math.random() * 0.01, 0.25 + Math.random() * 0.25, { grav: 9, drag: 0.96 });
  }
  dust(p, normal) {
    for (let k = 0; k < 7; k++) this._spawn(p.x, p.y, p.z, normal.x * 0.8 + (Math.random() - 0.5) * 0.5, normal.y * 0.8 + Math.random() * 0.4, normal.z * 0.8 + (Math.random() - 0.5) * 0.5, 0.62, 0.6, 0.56, 0.03, 0.6, { grow: 0.05, drag: 0.9 });
  }
  puff(p, color = 0x5a0f0f) {   // tasteful hit puff: tiny, dark, brief
    const c = new THREE.Color(color);
    for (let k = 0; k < 6; k++) this._spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.9, Math.random() * 0.6, (Math.random() - 0.5) * 0.9, c.r, c.g, c.b, 0.025, 0.35, { grav: 3, drag: 0.92 });
  }
  glass(p) {
    for (let k = 0; k < 26; k++) this._spawn(p.x + (Math.random() - 0.5) * 0.6, p.y + (Math.random() - 0.5) * 0.6, p.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.8, 0.92, 0.95, 0.018, 0.9, { grav: 9.8, drag: 0.98 });
  }
  spray(o, dir, n = 6) {
    for (let k = 0; k < n; k++) {
      const sp = 0.22;
      const dx = dir.x + (Math.random() - 0.5) * sp * 2, dy = dir.y + (Math.random() - 0.5) * sp, dz = dir.z + (Math.random() - 0.5) * sp * 2;
      const v = 6 + Math.random() * 3;
      this._spawn(o.x, o.y, o.z, dx * v, dy * v, dz * v, 0.95, 0.96, 0.98, 0.05, 0.9 + Math.random() * 0.5, { grow: 0.55, drag: 0.9, grav: -0.3 });
    }
  }
  decal(p, n, deck) {
    const i = this.dI % this.dN; this.dI++;
    _v.copy(p).addScaledVector(n, 0.012);
    _q.setFromUnitVectors(_z, n);
    const s = 0.8 + Math.random() * 0.5; _s.set(s, s, s);
    _m.compose(_v, _q, _s);
    this.decals.setMatrixAt(i, _m); this.decals.instanceMatrix.needsUpdate = true;
    this.decals.count = Math.min(this.dN, this.dI);
    this.decalDeck[i] = deck || 0;
  }
  _spawn(x, y, z, vx, vy, vz, r, g, b, s, life, o = {}) {
    const p = this.parts[this.pI]; this.pI = (this.pI + 1) % this.pN;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.r = r; p.g = g; p.b = b; p.s = s; p.life = life; p.t = life;
    p.grow = o.grow || 0; p.drag = o.drag ?? 1; p.grav = o.grav || 0;
  }
  update(dt) {
    if (!(dt > 0)) dt = 0.016;
    for (const f of this.flashes) if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.s.visible = false; else f.s.material.opacity = f.t / 0.05; }
    if (this.lightT > 0) { this.lightT -= dt; this.light.intensity = Math.max(0, this.lightT / 0.06) * 7; } else this.light.intensity = 0;
    // lines
    const P = this.linePos, C = this.lineCol;
    for (let i = 0; i < this.lineN; i++) {
      const s = this.lineSlots[i];
      if (s.t > 0) s.t -= dt;
      const k = Math.max(0, s.t / (s.life || 1));
      const a = s.a, b = s.b;
      const w = s.wobble ? 0.03 * Math.sin(performance.now() * 0.05 + i) : 0;
      P[i * 6] = a.x; P[i * 6 + 1] = a.y; P[i * 6 + 2] = a.z; P[i * 6 + 3] = b.x + w; P[i * 6 + 4] = b.y + w; P[i * 6 + 5] = b.z;
      const cr = s.c.r * k, cg = s.c.g * k, cb = s.c.b * k;
      C[i * 6] = cr * 0.4; C[i * 6 + 1] = cg * 0.4; C[i * 6 + 2] = cb * 0.4; C[i * 6 + 3] = cr; C[i * 6 + 4] = cg; C[i * 6 + 5] = cb;
      if (s.t <= 0) { P[i * 6 + 3] = a.x; P[i * 6 + 4] = a.y; P[i * 6 + 5] = a.z; }
    }
    this.lines.geometry.attributes.position.needsUpdate = true; this.lines.geometry.attributes.color.needsUpdate = true;
    // particles
    const pp = this.pPos, pc = this.pCol, ps = this.pSize;
    for (let i = 0; i < this.pN; i++) {
      const p = this.parts[i];
      if (p.t > 0) {
        p.t -= dt;
        p.vy -= p.grav * dt; p.vx *= p.drag; p.vy *= p.drag; p.vz *= p.drag;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.s += p.grow * dt;
        const k = Math.max(0, p.t / p.life);
        pp[i * 3] = p.x; pp[i * 3 + 1] = p.y; pp[i * 3 + 2] = p.z;
        pc[i * 3] = p.r; pc[i * 3 + 1] = p.g; pc[i * 3 + 2] = p.b;
        ps[i] = p.s * (0.35 + 0.65 * k) * (k < 0.15 ? k / 0.15 : 1);
      } else if (ps[i] !== 0) ps[i] = 0;
    }
    const ga = this.points.geometry.attributes; ga.position.needsUpdate = true; ga.color.needsUpdate = true; ga.size.needsUpdate = true;
  }
}
