// Sky, sun/moon, ocean, weather-driven lighting, ship motion.
// The ship is static in world space; the sea and sky move and tilt around it
// (the ship steams at ~19 kn along +X, rolls and pitches with the swell).
import * as THREE from 'three';
import { SHIP } from '../core/config.js';
import { shared } from '../world/materials.js';
import { clamp, lerp, smoothstep } from '../core/util.js';

const SKY_VS = `
varying vec3 vDir;
void main(){
  vDir = normalize((modelMatrix * vec4(position,0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  gl_Position = p.xyww;
}`;
const SKY_FS = `
uniform vec3 uSunDir; uniform vec3 uMoonDir;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
uniform float uTime; uniform float uCloud; uniform float uNightK; uniform float uStorm; uniform float uFlash;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int k=0;k<5;k++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h,0.0,1.0), 0.45));
  col = mix(col, uGround, smoothstep(0.0, -0.08, h));
  float sd = max(dot(d, uSunDir), 0.0);
  // sun glow & disc
  col += vec3(1.0,0.75,0.45) * pow(sd, 12.0) * 0.45 * (1.0 - uNightK) * (1.0 - uStorm*0.8);
  col += vec3(1.0,0.9,0.7) * smoothstep(0.9993, 0.9997, sd) * 18.0 * (1.0 - uStorm) * step(-0.02, uSunDir.y);
  // stars & moon
  if (uNightK > 0.01 && h > 0.0) {
    vec2 sp = d.xz / (d.y + 0.25) * 140.0;
    float st = step(0.996, hash(floor(sp))) * hash(floor(sp)+3.1);
    col += vec3(st) * uNightK * (1.0 - uCloud) * 1.6;
    float md = max(dot(d, uMoonDir), 0.0);
    col += vec3(0.9,0.92,1.0) * smoothstep(0.9994, 0.9996, md) * 6.0 * uNightK;
    col += vec3(0.25,0.3,0.45) * pow(md, 40.0) * 0.4 * uNightK;
  }
  // clouds on a dome
  if (h > 0.0) {
    vec2 cp = d.xz / (h + 0.12) * 1.2 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(cp * 1.6);
    float cov = mix(0.62, 0.32, uCloud);
    float cl = smoothstep(cov, cov + 0.25, c);
    vec3 cloudLit = mix(vec3(1.0,0.97,0.93), vec3(1.0,0.72,0.5), clamp(1.0 - uSunDir.y*3.0, 0.0, 1.0));
    cloudLit = mix(cloudLit, vec3(0.12,0.13,0.17), uNightK);
    cloudLit = mix(cloudLit, vec3(0.38,0.4,0.43), uStorm);
    float shade = 0.75 + 0.25 * fbm(cp * 3.0 + 4.0);
    col = mix(col, cloudLit * shade, cl * smoothstep(0.0, 0.15, h) * 0.92);
    // lightning: clouds lit from within (brightest where they are thick)
    if (uFlash > 0.0) col += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 0.95 * cl * shade) * (0.4 + 0.6 * smoothstep(0.0, 0.4, h));
  }
  if (uFlash > 0.0 && h <= 0.0) col += vec3(0.75, 0.8, 1.0) * uFlash * 0.12;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ── OCEAN ─────────────────────────────────────────────────────────────────
// Gerstner swell in the vertex shader + analytic detail normals; hull mask, bow wave and wake foam.
const WAVES = 6;
const OCEAN_VS = `
uniform float uTime; uniform float uShipX; uniform float uAmp;
uniform vec4 uWaves[${WAVES}];   // dir.x, dir.y, wavelength, steepness
varying vec3 vWP; varying vec3 vN; varying float vCrest;
void main(){
  vec3 p = (modelMatrix * vec4(position,1.0)).xyz;
  vec3 pos = p; vec3 n = vec3(0.0,1.0,0.0);
  vec3 T = vec3(1.0,0.0,0.0), B = vec3(0.0,0.0,1.0);
  float crest = 0.0;
  float fade = 1.0 - smoothstep(1400.0, 3200.0, length(p.xz - cameraPosition.xz));
  for (int i=0;i<${WAVES};i++){
    vec2 D = normalize(uWaves[i].xy); float L = uWaves[i].z; float S = uWaves[i].w * uAmp;
    float k = 6.28318 / L; float c = sqrt(9.81 / k); float A = S / k;
    float f = k * (dot(D, vec2(p.x + uShipX, p.z)) - c * uTime);
    float cf = cos(f), sf = sin(f);
    pos.x += D.x * A * cf * fade; pos.z += D.y * A * cf * fade; pos.y += A * sf * fade;
    T += vec3(-D.x*D.x*S*sf, D.x*S*cf, -D.x*D.y*S*sf) * fade;
    B += vec3(-D.x*D.y*S*sf, D.y*S*cf, -D.y*D.y*S*sf) * fade;
    crest += max(0.0, sf) * S;
  }
  n = normalize(cross(B, T));
  vWP = pos; vN = n; vCrest = crest;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos,1.0);
}`;
const OCEAN_FS = `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uDeep; uniform vec3 uShallow;
uniform float uTime; uniform float uShipX; uniform float uNightK; uniform vec3 uFogCol; uniform float uFogD; uniform float uStorm; uniform float uSpeed;
uniform mat4 uShipInv;
varying vec3 vWP; varying vec3 vN; varying float vCrest;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.5,s=0.0; for(int k=0;k<4;k++){ s+=a*noise(p); p=p*2.07+vec2(1.3,2.1); a*=0.5;} return s; }
float hullHalf(float x){
  float bs = 82.0, sx = 158.0;
  if (x > sx || x < -165.0) return 0.0;
  float h = 20.5;
  if (x > bs){ float t=(x-bs)/(sx-bs); h *= pow(max(0.0, 1.0 - pow(t,1.9)), 0.62); }
  if (x < -145.0){ float t=(-145.0-x)/20.0; h *= 1.0 - 0.13*t*t; }
  return h;
}
vec3 detailNormal(vec2 p, float t){
  float e = 0.12;
  vec2 q = p * 0.35;
  float h0 = fbm(q + vec2(t*0.32, t*0.21)) + 0.5*fbm(q*2.7 - vec2(t*0.5, -t*0.3));
  float hx = fbm(q + vec2(e,0.0) + vec2(t*0.32, t*0.21)) + 0.5*fbm((q+vec2(e,0.0))*2.7 - vec2(t*0.5, -t*0.3));
  float hz = fbm(q + vec2(0.0,e) + vec2(t*0.32, t*0.21)) + 0.5*fbm((q+vec2(0.0,e))*2.7 - vec2(t*0.5, -t*0.3));
  return normalize(vec3(-(hx-h0)/e*0.55, 1.0, -(hz-h0)/e*0.55));
}
void main(){
  vec3 lp = (uShipInv * vec4(vWP,1.0)).xyz;   // ship-local position
  float hh = hullHalf(lp.x);
  float inside = step(abs(lp.z), hh - 0.05);
  if (inside > 0.5 && lp.y < 4.0) discard;
  vec3 V = normalize(cameraPosition - vWP);
  float dist = length(cameraPosition - vWP);
  vec3 dn = detailNormal(vWP.xz + vec2(uShipX, 0.0), uTime);
  // detail normals fade out with distance (they alias into per-pixel sparkle noise far away)
  float dk = 1.0 - smoothstep(25.0, 420.0, dist);
  vec3 N = normalize(vN + vec3(dn.x, 0.0, dn.z) * (0.12 + 0.88*dk));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 skyR = mix(uHorizon, uZenith, pow(clamp(R.y,0.0,1.0),0.5));
  vec3 sss = mix(uDeep, uShallow, clamp(vCrest*0.9 + pow(max(dot(V, -uSunDir),0.0),4.0)*0.3, 0.0, 1.0));
  vec3 col = mix(sss * (0.35 + 0.65*max(uSunDir.y,0.05)), skyR, fres);
  // sun glitter: the very sharp lobe widens and dims with distance (a pixel covers many wavelets far away), so the
  // sea reads as a soft glitter path instead of salt-and-pepper sparkle
  float rs = max(dot(R, uSunDir), 0.0);
  float shp = mix(900.0, 140.0, smoothstep(30.0, 600.0, dist));
  float spec = pow(rs, shp) * mix(14.0, 3.0, smoothstep(30.0, 600.0, dist)) + pow(rs, 60.0) * 0.3;
  col += uSunCol * spec * (1.0 - uStorm*0.7) * step(0.0, uSunDir.y + 0.03);
  // foam: whitecaps, hull contact, bow wave, wake
  float foam = 0.0;
  float n1 = fbm(vWP.xz * 0.45 + vec2(uShipX*1.0 + uTime*0.6, uTime*0.2));
  float n2 = fbm(vWP.xz * 1.6 - vec2(uTime*0.4, 0.0));
  // whitecaps: the noise is averaged toward its mean with distance (it aliases into white speckle far away)
  float wcFar = smoothstep(80.0, 700.0, dist);
  float n1w = mix(n1, 0.47, wcFar);
  foam += smoothstep(0.55, 1.0, vCrest * 0.9 + n1w*0.5) * (0.25 + uStorm*0.6) * (1.0 - 0.6 * wcFar);
  float dHull = abs(lp.z) - hh;
  if (lp.x > -168.0 && lp.x < 162.0) {
    float hullFoam = (1.0 - smoothstep(0.0, 3.5 + 2.0*n1, dHull)) * (0.55 + 0.45*smoothstep(-100.0, 150.0, lp.x));
    foam += hullFoam * smoothstep(0.35, 0.75, n2 + 0.25) * uSpeed;
    // waterline contact: a tight bright churn hugging the plating (always present, breaks up along the length)
    float contact = 1.0 - smoothstep(0.0, 0.9 + 0.8*n2, dHull);
    float streak = smoothstep(0.25, 0.65, fbm(vec2(lp.x * 0.18 - uShipX * 0.18, dHull * 0.6 + uTime * 0.3)));
    foam += contact * (0.45 + 0.55*streak) * (0.4 + 0.6*uSpeed);
  }
  // bow wave spreading aft from the stem
  float bx = 158.0 - lp.x;
  if (bx > 0.0 && bx < 120.0) { float w = abs(abs(lp.z) - (hh + bx*0.06)); foam += (1.0-smoothstep(0.0, 2.5+bx*0.03, w)) * (1.0 - bx/120.0) * smoothstep(0.3,0.7,n2) * uSpeed; }
  // wake: turbulent centre + Kelvin arms
  float ax = -165.0 - lp.x;
  if (ax > 0.0) {
    float spread = 14.0 + ax * 0.09;
    float centre = (1.0 - smoothstep(spread*0.4, spread, abs(lp.z))) * exp(-ax/700.0);
    float arms = (1.0 - smoothstep(0.0, 3.0 + ax*0.02, abs(abs(lp.z) - ax*0.36))) * exp(-ax/500.0) * 0.8;
    foam += (centre * smoothstep(0.25, 0.7, n2*0.7 + n1*0.5) + arms * smoothstep(0.4, 0.8, n2)) * uSpeed;
    col = mix(col, uShallow*1.2, centre*0.35*uSpeed);
  }
  foam = clamp(foam, 0.0, 1.0);
  vec3 foamCol = vec3(0.92,0.95,0.97) * (0.25 + 0.75*max(uSunDir.y, 0.0)) + vec3(0.04,0.05,0.07);
  col = mix(col, foamCol, foam * (1.0 - uNightK*0.6));
  // fog
  float fogF = 1.0 - exp(-uFogD*uFogD*dist*dist);
  col = mix(col, uFogCol, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function oceanGeometry() {
  // radial grid: dense near the ship, coarse far away
  const rings = 120, segs = 220, rMax = 4000;
  const pos = [], ind = [];
  pos.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    const t = r / rings; const rad = 6 + Math.pow(t, 2.6) * rMax;
    for (let s = 0; s < segs; s++) { const a = s / segs * Math.PI * 2; pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad); }
  }
  for (let s = 0; s < segs; s++) ind.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + (s + 1) % segs, c = 1 + r * segs + s, d = 1 + r * segs + (s + 1) % segs;
    ind.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ind);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax * 1.2);
  return g;
}

// Time-of-day colour keys: [hour, zenith, horizon, sunColor, sunIntensity, ambient]
const KEYS = [
  [0, '#02040a', '#0b1426', '#9fb4ff', 0.0, 0.10],
  [5.2, '#06091a', '#1a2440', '#9fb4ff', 0.0, 0.12],
  [6.2, '#2a3f6e', '#f29d6b', '#ffb07a', 0.6, 0.28],
  [7.5, '#3f6fb2', '#c9d9ea', '#ffe2b8', 2.2, 0.5],
  [12, '#2f68b5', '#bcd6ef', '#fff6e8', 3.0, 0.62],
  [17, '#3b6bb0', '#d6dfe8', '#ffe8c8', 2.5, 0.55],
  [18.8, '#3c4f86', '#f0a26a', '#ff9c5a', 1.0, 0.36],
  [19.6, '#151c3a', '#6a4a5e', '#ff7b4a', 0.15, 0.2],
  [20.6, '#040713', '#111a30', '#9fb4ff', 0.0, 0.12],
  [24, '#02040a', '#0b1426', '#9fb4ff', 0.0, 0.10],
];

export class Environment {
  constructor(game) {
    this.game = game;
    const { scene, renderer } = game;
    this.scene = scene;
    // easeRate: 1/s rate at which live weather values approach weather.target (exponential)
    this.weather = { cloud: 0.25, storm: 0, rain: 0, fog: 0, wind: 0.3, target: null, easeRate: 0.05 };
    this.motion = { roll: 0, pitch: 0, heave: 0 };
    this.sunDir = new THREE.Vector3(0.3, 0.8, 0.2).normalize();
    this.moonDir = new THREE.Vector3(-0.4, 0.5, -0.3).normalize();
    this.envGroup = new THREE.Group(); this.envGroup.name = 'environment';
    scene.add(this.envGroup);

    // sky
    this.skyU = {
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color(0.05, 0.07, 0.1) }, uTime: { value: 0 }, uCloud: { value: 0.25 }, uNightK: { value: 0 }, uStorm: { value: 0 }, uFlash: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.envGroup.add(this.sky);

    // ocean
    const waves = [];
    const dirs = [[1, 0.25, 140, 0.11], [0.8, -0.55, 82, 0.1], [0.95, 0.6, 47, 0.12], [0.3, 1, 29, 0.1], [-0.6, 0.8, 17, 0.08], [1, -0.1, 11, 0.07]];
    for (const w of dirs) waves.push(new THREE.Vector4(...w));
    this.oceanU = {
      uTime: { value: 0 }, uShipX: { value: 0 }, uAmp: { value: 0.45 }, uWaves: { value: waves },
      uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uZenith: this.skyU.uZenith, uHorizon: this.skyU.uHorizon,
      uDeep: { value: new THREE.Color(0.004, 0.05, 0.09) }, uShallow: { value: new THREE.Color(0.02, 0.25, 0.3) }, uNightK: this.skyU.uNightK,
      uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.00012 }, uStorm: this.skyU.uStorm, uSpeed: { value: 1 }, uShipInv: { value: new THREE.Matrix4() },
    };
    this.ocean = new THREE.Mesh(oceanGeometry(), new THREE.ShaderMaterial({ vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS, uniforms: this.oceanU }));
    this.ocean.position.y = SHIP.waterY; this.ocean.frustumCulled = false; this.ocean.name = 'ocean';
    this.envGroup.add(this.ocean);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 400;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd6ef, 0x2a3540, 0.6); scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xbcd6ef, 0.00012); scene.fog = this.fog;

    // PMREM environment for reflections
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat);
    this.envScene.add(this.envSky);
    this.envRT = null; this.envTimer = 0; this.envSig = null; this.sunUpK = 1;
    this.shipX = 0;
    this.lastHour = -1;
  }

  refreshEnv() {
    const r = this.game.renderer;
    this.envSky.position.set(0, 0, 0);
    // sky → small cube target → PMREM into one persistent target (same size every time: no reallocation, no
    // program recompiles; the first call allocates it)
    if (!this.envCubeRT) {
      this.envCubeRT = new THREE.WebGLCubeRenderTarget(128, { type: this.game.halfFloatOK === false ? THREE.UnsignedByteType : THREE.HalfFloatType });
      this.envCubeCam = new THREE.CubeCamera(0.1, 200, this.envCubeRT);
    }
    const at = r.getRenderTarget();
    this.envCubeCam.update(r, this.envScene);
    r.setRenderTarget(at);
    this.envRT = this.pmrem.fromCubemap(this.envCubeRT.texture, this.envRT);
    this.scene.environment = this.envRT.texture;
  }

  // lightning / flash illumination of the sky dome (0..~1.5). Also used for the PMREM env (same material).
  setFlash(v) { this.skyU.uFlash.value = Math.max(0, +v || 0); }

  setQuality(q) {
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowSize) { this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    // shadow frustum: tighter on lower presets (keeps texel density with the smaller map)
    const ext = q.shadowSize >= 2048 ? 48 : 36;
    const sc = this.sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix();
    this.shadowExt = ext;
  }

  colorsAt(hour) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let k = 0; k < KEYS.length - 1; k++) if (hour >= KEYS[k][0] && hour <= KEYS[k + 1][0]) { a = KEYS[k]; b = KEYS[k + 1]; break; }
    const t = (hour - a[0]) / Math.max(1e-3, b[0] - a[0]);
    const c = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), t);
    return { zen: c(a[1], b[1]), hor: c(a[2], b[2]), sun: c(a[3], b[3]), sunI: lerp(a[4], b[4], t), amb: lerp(a[5], b[5], t) };
  }

  update(dt, gameMinutes, focus) {
    const hour = (gameMinutes / 60) % 24;
    const W = this.weather;
    // weather easing
    if (W.target) for (const k of ['cloud', 'storm', 'rain', 'fog', 'wind']) W[k] = lerp(W[k], W.target[k] ?? W[k], 1 - Math.exp(-dt * (W.easeRate ?? 0.05)));
    // sun path: rises east (+x bow heading east), sets west; elevation peaks ~62°
    const dayT = (hour - 6.6) / (19.6 - 6.6);
    const el = Math.sin(clamp(dayT, -0.25, 1.25) * Math.PI) * 1.08;
    const az = lerp(-0.6, Math.PI + 0.6, clamp(dayT, -0.2, 1.2));
    this.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el) * 0.6 + 0.25).normalize();
    const nt = ((hour + 12) % 24 - 6.6) / 13;
    const mel = Math.sin(clamp(nt, 0, 1) * Math.PI) * 0.9;
    this.moonDir.set(Math.cos(nt * Math.PI) * Math.cos(mel), Math.sin(mel), -0.3).normalize();
    const C = this.colorsAt(hour);
    const storm = W.storm, cloud = Math.max(W.cloud, storm);
    const grey = new THREE.Color(0.42, 0.45, 0.5);
    C.zen.lerp(grey.clone().multiplyScalar(C.amb * 1.4 + 0.05), storm * 0.85);
    C.hor.lerp(grey.clone().multiplyScalar(C.amb * 1.6 + 0.06), storm * 0.85 + W.fog * 0.5);
    this.skyU.uZenith.value.copy(C.zen); this.skyU.uHorizon.value.copy(C.hor);
    const nightK = clamp(1 - C.sunI / 0.8, 0, 1);
    this.skyU.uNightK.value = nightK; this.skyU.uCloud.value = cloud; this.skyU.uStorm.value = storm;
    this.skyU.uTime.value += dt;
    shared.uNight.value = smoothstep(0.2, 0.9, nightK);
    this.nightK = nightK;

    // lights
    const sunUp = this.sunDir.y > -0.02;
    const lightDir = sunUp ? this.sunDir : this.moonDir;
    const sunI = sunUp ? C.sunI * (1 - storm * 0.75) * (1 - cloud * 0.3) : 0.18 * nightK * (1 - cloud * 0.6);
    this.sun.color.copy(sunUp ? C.sun : new THREE.Color(0.55, 0.62, 0.85));
    this.sun.intensity = sunI;
    const fx = focus ? focus.x : 0, fy = focus ? focus.y : 0, fz = focus ? focus.z : 0;
    // snap shadow camera to texel grid to avoid shimmering
    const snap = (this.shadowExt ?? 60) * 2 / this.sun.shadow.mapSize.x;
    this.sunUpK = clamp((this.sunDir.y - 0.02) / 0.08, 0, 1) * (1 - storm * 0.8);
    const sx = Math.round(fx / snap) * snap, sz = Math.round(fz / snap) * snap;
    this.sun.target.position.set(sx, fy, sz);
    this.sun.position.set(sx + lightDir.x * 200, fy + lightDir.y * 200, sz + lightDir.z * 200);
    this.hemi.color.copy(C.hor).lerp(C.zen, 0.5); this.hemi.groundColor.set(0x1d2a33).multiplyScalar(0.4 + C.amb);
    this.hemi.intensity = 0.25 + C.amb * 1.1;
    this.fog.color.copy(C.hor);
    this.fog.density = 0.00011 + W.fog * 0.004 + storm * 0.0012 + W.rain * 0.0008;
    this.oceanU.uFogCol.value.copy(C.hor); this.oceanU.uFogD.value = this.fog.density;
    this.oceanU.uSunCol.value.copy(C.sun).multiplyScalar(Math.min(1.5, C.sunI + 0.2));

    // sea state & ship motion
    this.oceanU.uAmp.value = 0.35 + W.wind * 0.35 + storm * 0.9;
    this.oceanU.uTime.value += dt;
    this.shipX += dt * SHIP.speedKnots * 0.5144 * (this.game.shipSpeedK ?? 1);
    this.oceanU.uShipX.value = this.shipX % 100000;
    this.oceanU.uSpeed.value = this.game.shipSpeedK ?? 1;
    const t = this.oceanU.uTime.value;
    const amp = 0.25 + W.wind * 0.6 + storm * 2.4;   // degrees
    this.motion.roll = (Math.sin(t * 0.41) * 0.7 + Math.sin(t * 0.23 + 1.3) * 0.3) * amp * Math.PI / 180;
    this.motion.pitch = (Math.sin(t * 0.33 + 0.5) * 0.6 + Math.sin(t * 0.17) * 0.4) * amp * 0.35 * Math.PI / 180;
    this.motion.heave = Math.sin(t * 0.29) * amp * 0.08;
    // the environment moves opposite to the ship's motion
    this.envGroup.rotation.set(-this.motion.roll, 0, -this.motion.pitch);
    this.envGroup.position.y = -this.motion.heave;
    this.envGroup.updateMatrixWorld();
    this.oceanU.uShipInv.value.identity();
    // keep the ocean centred on the camera (snapped so the grid doesn't swim)
    const cam = this.game.camera;
    this.ocean.position.x = Math.round(cam.position.x / 40) * 40; this.ocean.position.z = Math.round(cam.position.z / 40) * 40;
    this.sky.position.copy(cam.position);

    // env map refresh: only when the sky changed noticeably (time-of-day bucket of 1/4 h, cloud/storm/flash buckets),
    // checked at most every 0.5 s; the cube is rendered into ONE persistent target (no allocation / disposal, no stall).
    this.envTimer -= dt;
    this.scene.environmentIntensity = 0.35 + C.amb * 0.9;
    if (this.envTimer <= 0) {
      this.envTimer = 0.5;
      const sig = Math.floor(hour * 4) + '|' + Math.round(cloud * 8) + '|' + Math.round(storm * 8) + '|' + Math.round(W.fog * 6) + '|' + (this.skyU.uFlash.value > 0.2 ? 1 : 0);
      if (sig !== this.envSig) { this.envSig = sig; this.refreshEnv(); }
    }
    this.hour = hour;
    return { hour, nightK, sunUp };
  }
}
