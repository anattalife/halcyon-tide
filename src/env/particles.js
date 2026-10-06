// GPU soft particles: one InstancedMesh of camera-facing quads per system, motion evaluated in the
// vertex shader from per-instance launch data (position, velocity, birth time, life, size).
// The CPU only writes a slot when a particle is emitted (ring buffer, partial buffer uploads), so a
// system costs one draw call and no per-frame allocations.
//
//   const ps = new SoftParticles({ max: 256, color: 0xd8d8d4, drag: 0.4, gravity: -0.2, soft: 0.6, noise: 1, additive: false })
//   parent.add(ps.mesh);  ps.emit(x,y,z, vx,vy,vz, life, size0, size1, alpha, spin)
//   ps.update(dt, env)    — advances the clock, updates lighting & fog uniforms
//   ps.drift.set(x,y,z)   — constant velocity added to every particle (apparent wind)
import * as THREE from 'three';

const VS = `
attribute vec3 aP0; attribute vec3 aVel; attribute vec4 aT;   // birth, life, size0, size1
attribute vec2 aM;                                             // alpha, seed
uniform float uTime; uniform float uDrag; uniform vec3 uDrift; uniform float uGrav; uniform float uRise; uniform float uFadeIn; uniform float uThin;
varying vec2 vUv; varying float vA; varying float vSeed; varying float vFog; varying float vAge;
uniform float uFogD;
void main(){
  float age = uTime - aT.x;
  float life = aT.y;
  vUv = uv; vSeed = aM.y;
  if (age < 0.0 || age > life || life <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  float k = age / life; vAge = k;
  float dr = uDrag > 0.0 ? (1.0 - exp(-uDrag * age)) / uDrag : age;
  vec3 p = aP0 + aVel * dr + uDrift * age + vec3(0.0, 0.5 * uGrav * age * age + uRise * age, 0.0);
  float size = mix(aT.z, aT.w, 1.0 - (1.0 - k) * (1.0 - k));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float ang = aM.y * 6.2831 + age * (aM.y - 0.5) * 0.6;
  float c = cos(ang), s = sin(ang);
  vec2 q = (uv - 0.5) * size;
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  gl_Position = projectionMatrix * mv;
  float fin = smoothstep(0.0, uFadeIn, k), fout = 1.0 - smoothstep(0.55, 1.0, k);
  vA = aM.x * fin * fout * mix(1.0, 1.0 - uThin, sqrt(k));
  float dist = length(mv.xyz);
  vFog = 1.0 - exp(-uFogD * uFogD * dist * dist);
}`;
const FS = `
uniform vec3 uColor; uniform vec3 uLight; uniform vec3 uFogCol; uniform float uSoft; uniform float uNoise; uniform float uTime;
varying vec2 vUv; varying float vA; varying float vSeed; varying float vFog; varying float vAge;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  if (vA <= 0.002) discard;
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float a = 1.0 - smoothstep(1.0 - uSoft, 1.0, r);
  if (uNoise > 0.0) {
    vec2 q = vUv * 4.5 + vSeed * 17.0 + vAge * 1.5;
    float n = noise(q) * 0.6 + noise(q * 2.3 + 5.0) * 0.4;
    a *= mix(1.0, smoothstep(0.2, 0.8, n + (1.0 - r) * 0.35), uNoise);
  }
  a *= vA;
  if (a < 0.003) discard;
  vec3 col = uColor * uLight;
  col = mix(col, uFogCol, vFog);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SoftParticles {
  constructor(o = {}) {
    const max = this.max = o.max ?? 256;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    this.aP0 = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aT = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aM = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    for (const a of [this.aP0, this.aVel, this.aT, this.aM]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP0', this.aP0); g.setAttribute('aVel', this.aVel); g.setAttribute('aT', this.aT); g.setAttribute('aM', this.aM);
    g.instanceCount = max;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.drift = new THREE.Vector3();
    this.uniforms = {
      uTime: { value: 0 }, uDrag: { value: o.drag ?? 0.5 }, uDrift: { value: this.drift }, uGrav: { value: o.gravity ?? 0 }, uRise: { value: o.rise ?? 0 },
      uColor: { value: new THREE.Color(o.color ?? 0xffffff) }, uLight: { value: new THREE.Color(1, 1, 1) }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0 },
      uSoft: { value: o.soft ?? 0.7 }, uNoise: { value: o.noise ?? 1 }, uFadeIn: { value: o.fadeIn ?? 0.08 }, uThin: { value: o.thin ?? 0 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder ?? 2;
    this.mesh.name = o.name || 'particles';
    this.head = 0; this.dirty0 = max; this.dirty1 = -1; this.wrapped = false;
    this.alive = 0; this.lastEmit = -1e9;
    this.lightK = o.lightK ?? 1;
    this.emissive = o.emissive ?? 0;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, alpha = 1, age = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    if (this.head === 0) this.wrapped = true;
    const t = this.uniforms.uTime.value;
    this.aP0.array[i * 3] = x; this.aP0.array[i * 3 + 1] = y; this.aP0.array[i * 3 + 2] = z;
    this.aVel.array[i * 3] = vx; this.aVel.array[i * 3 + 1] = vy; this.aVel.array[i * 3 + 2] = vz;
    this.aT.array[i * 4] = t - age; this.aT.array[i * 4 + 1] = life; this.aT.array[i * 4 + 2] = s0; this.aT.array[i * 4 + 3] = s1;
    this.aM.array[i * 2] = alpha; this.aM.array[i * 2 + 1] = Math.random();
    if (i < this.dirty0) this.dirty0 = i; if (i > this.dirty1) this.dirty1 = i;
    this.lastEmit = t; this.maxLife = Math.max(this.maxLife || 0, life);
  }
  // env lighting: approximates a lit diffuse white surface + ambient
  update(dt, env) {
    const U = this.uniforms;
    U.uTime.value += dt;
    if (U.uTime.value > 20000) { U.uTime.value = 0; this.aT.array.fill(0); this.dirty0 = 0; this.dirty1 = this.max - 1; }
    if (this.dirty1 >= this.dirty0) {
      for (const a of [this.aP0, this.aVel, this.aT, this.aM]) {
        const n = a.itemSize;
        a.clearUpdateRanges(); a.addUpdateRange(this.dirty0 * n, (this.dirty1 - this.dirty0 + 1) * n); a.needsUpdate = true;
      }
      this.dirty0 = this.max; this.dirty1 = -1;
    }
    this.mesh.visible = U.uTime.value - this.lastEmit < (this.maxLife || 30) + 0.5;
    if (env) {
      const L = U.uLight.value;
      const s = env.sun, h = env.hemi;
      const sunK = Math.max(0, env.sunDir ? env.sunDir.y + 0.15 : 1);
      L.setRGB(0, 0, 0);
      L.r = (s.color.r * s.intensity * 0.55 * Math.min(1, sunK * 2) + h.color.r * h.intensity * 0.75) * this.lightK + this.emissive;
      L.g = (s.color.g * s.intensity * 0.55 * Math.min(1, sunK * 2) + h.color.g * h.intensity * 0.75) * this.lightK + this.emissive;
      L.b = (s.color.b * s.intensity * 0.55 * Math.min(1, sunK * 2) + h.color.b * h.intensity * 0.75) * this.lightK + this.emissive;
      U.uFogCol.value.copy(env.fog.color); U.uFogD.value = env.fog.density;
    }
  }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
