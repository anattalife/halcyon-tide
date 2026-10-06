// HALCYON TIDE — weather over the voyage.
//
//   installWeather(game) → game.weather
//
// Drives game.env.weather.target {cloud, storm, rain, fog, wind} from a scripted-but-varied voyage timeline
// (environment.js eases the live values toward the target and derives sky, fog, sea state and ship motion).
// Adds the visual weather layer the environment doesn't have:
//   • rain: GPU instanced, wind-slanted streaks in a camera-centred wrap box, occluded by the ship's decks via a
//     cover heightmap (no rain under overhangs/indoors), splash rings on exposed decks. Only drawn when the camera
//     is outside or behind glass.
//   • lightning: bolt + cloud glow at 2–9 km, sky/hemisphere/sun flash, thunder sfx delayed by distance (343 m/s)
//   • squall curtains: distant rain shafts under storm cells
//   • bow spray in heavy weather, flags (mast yard + stern ensign) streaming in the apparent wind
//   • fog signal: one prolonged blast every two (real) minutes in fog (COLREGS rule 35)
//
// API (game.weather):
//   set(preset, transitionMinutes = 10, holdMinutes = Infinity)   override the timeline; auto() returns to it
//   auto(transitionMinutes = 20)
//   forecast()      {now, next:[{at, clock, preset, label}], summary, tonight, tomorrow}
//   state           {preset, label, cloud, storm, rain, fog, wind, windKnots, windDir (from, true °), beaufort, seaState,
//                    swellM, airTempC, seaTempC, visibilityNm, wetness, lightning, shelter, apparent:{x,z,speed} (m/s, ship frame)}
//   wetness         0..1 exterior deck wetness (rises in rain, dries with wind/sun)
//   lightning       0..1 current flash intensity
//   presets         {name: {cloud, storm, rain, fog, wind, label}}   PRESET_NAMES list
//   timeline        [{min (absolute game minutes within the 7-day cycle), preset}]
//   strike(dist?)   force a lightning strike (debug)
// Bus out: 'weather:change' {preset, label, rain, storm, wind, fog, shelter}, 'weather:lightning' {x, y, z, dist},
//          'sfx' {name:'thunder'|'wind_gust'|'ship_horn', ...}
import * as THREE from 'three';
import { deckY, GRID, SHIP } from '../core/config.js';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { viewInfo, shipSpeed, vnoise, hash1, compassName } from './envUtil.js';
import { SoftParticles } from './particles.js';

export const PRESETS = {
  clear:    { cloud: 0.06, storm: 0,    rain: 0,    fog: 0,    wind: 0.18, label: 'clear skies' },
  fair:     { cloud: 0.28, storm: 0,    rain: 0,    fog: 0,    wind: 0.3,  label: 'fair, a few clouds' },
  breezy:   { cloud: 0.42, storm: 0,    rain: 0,    fog: 0,    wind: 0.62, label: 'breezy, sunny spells' },
  haze:     { cloud: 0.45, storm: 0,    rain: 0,    fog: 0.28, wind: 0.25, label: 'hazy' },
  overcast: { cloud: 0.82, storm: 0.12, rain: 0,    fog: 0.06, wind: 0.45, label: 'overcast' },
  fog:      { cloud: 0.6,  storm: 0.05, rain: 0,    fog: 0.85, wind: 0.12, label: 'fog' },
  drizzle:  { cloud: 0.9,  storm: 0.18, rain: 0.22, fog: 0.3,  wind: 0.4,  label: 'drizzle' },
  showers:  { cloud: 0.72, storm: 0.3,  rain: 0.6,  fog: 0.08, wind: 0.7,  label: 'squally showers' },
  rain:     { cloud: 0.95, storm: 0.4,  rain: 0.78, fog: 0.18, wind: 0.62, label: 'rain' },
  gale:     { cloud: 0.97, storm: 0.65, rain: 0.6,  fog: 0.12, wind: 0.92, label: 'gale, heavy showers' },
  storm:    { cloud: 1.0,  storm: 1.0,  rain: 1.0,  fog: 0.2,  wind: 1.0,  label: 'storm' },
};
export const PRESET_NAMES = Object.keys(PRESETS);
const KEYS5 = ['cloud', 'storm', 'rain', 'fog', 'wind'];

// voyage-day timeline: [hour, preset]; hours are when that preset is fully established
const TIMELINE = {
  1: [[0, 'overcast'], [6, 'drizzle'], [10, 'overcast'], [14, 'fair'], [18, 'fair'], [21.5, 'breezy']],
  2: [[2, 'fair'], [4, 'haze'], [5.5, 'fog'], [8.5, 'haze'], [10, 'fair'], [13, 'clear'], [16, 'breezy'], [20, 'fair']],
  3: [[2, 'haze'], [4.5, 'fog'], [9.5, 'fog'], [11, 'overcast'], [14.5, 'overcast'], [16.5, 'showers'], [18.5, 'overcast'], [20.5, 'rain'], [22, 'gale'], [23.25, 'storm']],
  4: [[4.5, 'storm'], [6.5, 'gale'], [9, 'rain'], [11, 'showers'], [13.5, 'overcast'], [16, 'breezy'], [19, 'fair']],
  5: [[3, 'fair'], [9, 'breezy'], [12.5, 'showers'], [14.5, 'breezy'], [16.5, 'showers'], [17.75, 'fair'], [21, 'clear']],
  6: [[2, 'fair'], [4, 'haze'], [5.5, 'fog'], [8.5, 'overcast'], [12, 'drizzle'], [15, 'overcast'], [19, 'breezy'], [23, 'fair']],
  7: [[3, 'fair'], [5, 'haze'], [8, 'fair'], [12, 'clear'], [18, 'fair'], [22, 'haze']],
};
const WIND_FROM = { 1: 200, 2: 235, 3: 215, 4: 285, 5: 275, 6: 250, 7: 240 };
const SEA_T = { 1: 17, 2: 22, 3: 9, 4: 12, 5: 14, 6: 15, 7: 15 };
const AIR_T = { 1: 19, 2: 22, 3: 11, 4: 12, 5: 15, 6: 15, 7: 17 };
const MAX_BLEND = 110;   // minutes for a transition between keys (shorter if keys are closer)

function buildTimeline() {
  const out = [];
  for (let v = 1; v <= 7; v++) for (const [h, p] of TIMELINE[v]) out.push({ min: (v - 1) * 1440 + h * 60, preset: p });
  return out;
}

export function installWeather(game) {
  const W = new WeatherSystem(game);
  game.weather = W;
  // save / load: the manual override (set()/auto()) relative to the clock, plus deck wetness; the timeline itself
  // is deterministic from game.minutes
  const saveReg = () => game.save?.register?.('weatherSys', {
    save: () => { const O = W.override, now = game.minutes; return { wetness: W.wetness, override: O ? { from: { ...O.from }, to: O.to, t0: O.t0 - now, dur: O.dur, until: Number.isFinite(O.until) ? O.until - now : null, release: !!O.release } : null }; },
    load: (d) => {
      if (!d) return; const now = game.minutes;
      W.wetness = Number.isFinite(d.wetness) ? d.wetness : W.wetness;
      const O = d.override;
      W.override = O ? { from: O.from, to: O.to, t0: now + O.t0, dur: O.dur, until: O.until == null ? Infinity : now + O.until, release: !!O.release } : null;
    },
  });
  if (game.save) saveReg(); else game.bus.on('save:ready', saveReg);
  game.addSystem({ name: 'weather', order: 14, update: (dt, rdt) => W.update(dt, rdt), lateUpdate: (dt, rdt) => W.lateUpdate(dt, rdt) });
  return W;
}

// ── rain shaders ──────────────────────────────────────────────────────────
const RAIN_VS = `
attribute vec4 aSeed;
uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uOff; uniform vec3 uVel; uniform float uLen; uniform float uWidth; uniform float uRain;
uniform sampler2D uCover; uniform vec4 uCoverXf;   // x0, z0, 1/cell, unused
uniform float uFogD; uniform float uPxSize;
varying vec2 vUv; varying float vA; varying float vFog;
float coverAt(vec2 xz){
  vec2 c = (xz - uCoverXf.xy) * uCoverXf.z;
  if (c.x < 0.0 || c.y < 0.0 || c.x >= 332.0 || c.y >= 50.0) return -1.6;
  return texture2D(uCover, (floor(c) + 0.5) / vec2(332.0, 50.0)).r;
}
void main(){
  vUv = uv; vA = 0.0;
  if (aSeed.w > uRain) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  vec3 jit = vec3(fract(aSeed.w * 91.7) - 0.5, 0.0, fract(aSeed.w * 37.3) - 0.5) * 1.5;
  vec3 p = uCam + mod(aSeed.xyz * uBox - uOff - uCam + jit, uBox) - uBox * 0.5;
  float cy = coverAt(p.xz);
  if (p.y < cy + 0.02) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  vec3 tail = p - uVel * uLen * (0.75 + 0.5 * fract(aSeed.w * 13.1));
  vec3 a = mix(p, tail, uv.y);
  vec3 axis = normalize(p - tail);
  vec3 toCam = normalize(cameraPosition - a);
  vec3 side = normalize(cross(axis, toCam));
  float dist = length(cameraPosition - a);
  float w = max(uWidth, dist * uPxSize * 1.6);
  a += side * (uv.x - 0.5) * w;
  vec4 mv = viewMatrix * vec4(a, 1.0);
  gl_Position = projectionMatrix * mv;
  float near = smoothstep(0.35, 1.6, dist);
  float far = 1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, length(p.xz - uCam.xz));
  vA = near * far * mix(1.0, 0.6, smoothstep(4.0, 26.0, dist)) * clamp(uWidth * 2.0 / w, 0.35, 1.0);
  vFog = 1.0 - exp(-uFogD * uFogD * dist * dist);
}`;
const RAIN_FS = `
uniform vec3 uColor; uniform float uAlpha; uniform vec3 uFogCol;
varying vec2 vUv; varying float vA; varying float vFog;
void main(){
  float x = abs(vUv.x - 0.5) * 2.0;
  float a = (1.0 - x * x) * (1.0 - vUv.y * 0.65) * vA * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uFogCol, vFog * 0.7), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const SPLASH_VS = `
attribute vec4 aSeed;
uniform vec3 uCam; uniform float uTime; uniform float uRain; uniform float uR;
uniform sampler2D uCover; uniform vec4 uCoverXf;
varying vec2 vUv; varying float vK; varying float vA;
float h1(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float coverAt(vec2 xz){
  vec2 c = (xz - uCoverXf.xy) * uCoverXf.z;
  if (c.x < 0.0 || c.y < 0.0 || c.x >= 332.0 || c.y >= 50.0) return -99.0;
  return texture2D(uCover, (floor(c) + 0.5) / vec2(332.0, 50.0)).r;
}
void main(){
  vUv = uv; vA = 0.0; vK = 0.0;
  if (aSeed.w > uRain) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  float period = 0.32 + aSeed.z * 0.25;
  float t = uTime / period + aSeed.x * 7.0;
  float cyc = floor(t); float k = fract(t);
  float ang = h1(cyc + aSeed.y * 113.0) * 6.2831; float rr = sqrt(h1(cyc * 1.7 + aSeed.x * 71.0)) * uR;
  vec2 xz = uCam.xz + vec2(cos(ang), sin(ang)) * rr;
  float cy = coverAt(xz);
  // only on exposed deck surfaces at or below eye level (the sea is too busy to show rings)
  if (cy < 0.0 || cy > uCam.y + 0.5) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  float s = (0.03 + 0.09 * k) * (0.7 + aSeed.y * 0.6);
  vec3 p = vec3(xz.x + (uv.x - 0.5) * s * 2.0, cy + 0.025, xz.y + (uv.y - 0.5) * s * 2.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vK = k; vA = 1.0 - smoothstep(uR * 0.6, uR, rr);
}`;
const SPLASH_FS = `
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv; varying float vK; varying float vA;
void main(){
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.7, 0.85, r) * (1.0 - smoothstep(0.88, 1.0, r));
  float dot0 = (1.0 - smoothstep(0.0, 0.35, r)) * (1.0 - smoothstep(0.0, 0.25, vK)) * 1.5;
  float a = (ring + dot0) * (1.0 - vK) * vA * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// distant rain shafts
const SHAFT_VS = `
varying vec2 vUv; varying float vFog; uniform float uFogD;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = length(mv.xyz); vFog = 1.0 - exp(-uFogD*uFogD*d*d*0.25); }`;
const SHAFT_FS = `
uniform vec3 uColor; uniform float uAlpha; uniform float uTime; uniform float uSeed; uniform vec3 uFogCol;
varying vec2 vUv; varying float vFog;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  float x = vUv.x, y = vUv.y;
  float slant = (1.0 - y) * 0.12;
  float n = noise(vec2((x + slant) * 5.0 + uSeed * 13.0, y * 0.8 + uTime * 0.03)) * 0.75 + noise(vec2((x + slant) * 14.0 + uSeed, y * 1.5 - uTime * 0.02)) * 0.25;
  float edge = smoothstep(0.0, 0.35, x) * smoothstep(1.0, 0.65, x);
  float lower = pow(1.0 - y, 1.6) * smoothstep(-0.01, 0.04, y) * smoothstep(1.0, 0.7, y);
  float a = uAlpha * edge * lower * smoothstep(0.15, 0.85, n);
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uColor, uFogCol, vFog * 0.5), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// flags: cloth wave in the vertex shader, streams along +X of the flag's local frame (rotated to the apparent wind)
const FLAG_VS_INJECT = `
  float fu = uv.x; float fv = uv.y;
  float ft = uFlagTime * uFlagFreq + uFlagSeed;
  float droop = (1.0 - uFlagWind) * fu * 0.9;
  float wv = sin(fu * 7.0 - ft * 1.0) * 0.6 + sin(fu * 13.0 - ft * 1.7 + fv * 2.0) * 0.3;
  transformed.z += wv * fu * (0.05 + 0.13 * uFlagWind) * uFlagLen;
  transformed.y -= droop * uFlagLen * 0.9 * (0.4 + 0.6 * fu);
  transformed.x *= mix(0.35, 1.0, uFlagWind) + 0.03 * sin(ft + fv * 3.0);
`;

class WeatherSystem {
  constructor(game) {
    this.game = game;
    this.env = game.env;
    this.presets = PRESETS;
    this.PRESET_NAMES = PRESET_NAMES;
    this.timeline = buildTimeline();
    this.target = { cloud: 0.25, storm: 0, rain: 0, fog: 0, wind: 0.3 };
    this.env.weather.target = this.target;
    this.override = null;          // {from:{...}, to:preset, t0, dur, until}
    this.wetness = 0; this.lightning = 0;
    this.state = { preset: 'fair', label: PRESETS.fair.label, cloud: 0, storm: 0, rain: 0, fog: 0, wind: 0, windKnots: 0, windDir: 230, beaufort: 3, seaState: 'slight', swellM: 1, airTempC: 18, seaTempC: 16, visibilityNm: 10, wetness: 0, lightning: 0, shelter: false, apparent: { x: -10, z: 0, speed: 10 } };
    this._lastEmit = { preset: null, rainB: -1, stormB: -1 };
    this._time = 0;
    this._strikes = [];          // pending thunder {t, near}
    this._nextStrike = 8;
    this._flash = { t: 1, dur: 0.6, k: 0, pulses: [] };
    this._gradeFlash = 0;
    this._hornT = 30;
    this._gustT = 10;
    this._tmpC = new THREE.Color();
    this._v = new THREE.Vector3();
    this.group = new THREE.Group(); this.group.name = 'weatherFx';
    game.scene.add(this.group);
    this._buildCover();
    this._buildRain();
    this._buildLightning();
    this._buildShafts();
    this._buildSpray();
    this._buildFlags();
    // start in the timeline state (no slow fade-in at load)
    this._sample(game.minutes, this.target);
    for (const k of KEYS5) this.env.weather[k] = this.target[k];
  }

  // ── timeline sampling ───────────────────────────────────────────────────
  _sample(minutes, out) {
    const T = this.timeline, cyc = 7 * 1440;
    const m = ((minutes % cyc) + cyc) % cyc;
    // find surrounding keys (wrap)
    let i = T.length - 1;
    for (let k = 0; k < T.length; k++) { if (T[k].min <= m) i = k; else break; }
    const A = T[i], B = T[(i + 1) % T.length];
    let tA = A.min, tB = B.min; let mm = m;
    if (tB <= tA) { tB += cyc; if (mm < tA) mm += cyc; }
    if (mm < tA) mm += cyc;
    const blend = Math.min(MAX_BLEND, (tB - tA) * 0.8);
    const k = smoothstep(tB - blend, tB, mm);
    const pa = PRESETS[A.preset], pb = PRESETS[B.preset];
    for (const key of KEYS5) out[key] = lerp(pa[key], pb[key], k);
    this._cur = k < 0.5 ? A.preset : B.preset;
    this._next = B; this._nextIn = tB - blend - mm;
    // squall cells pass through: rain/storm gate on a slow noise
    const sq = (A.preset === 'showers' ? 1 - k : 0) + (B.preset === 'showers' ? k : 0) + ((A.preset === 'gale' ? 1 - k : 0) + (B.preset === 'gale' ? k : 0)) * 0.5;
    if (sq > 0) {
      const g = smoothstep(0.38, 0.62, vnoise(minutes / 16 + 3.7));
      const gate = lerp(1, 0.12 + g * 1.15, sq);
      out.rain *= gate; out.storm *= lerp(1, 0.55 + g * 0.6, sq);
      out.cloud = Math.min(1, out.cloud + g * 0.15 * sq);
    }
    // gusts
    out.wind = clamp(out.wind + (vnoise(minutes / 3.1) - 0.5) * 0.12, 0, 1);
    return out;
  }
  presetAt(minutes) { const o = {}; this._sample(minutes, o); return this._cur; }

  set(preset, transitionMinutes = 10, holdMinutes = Infinity) {
    const p = PRESETS[preset]; if (!p) { console.warn('[weather] unknown preset', preset); return false; }
    const from = {}; for (const k of KEYS5) from[k] = this.target[k];
    const now = this.game.minutes;
    this.override = { from, to: preset, t0: now, dur: Math.max(0, transitionMinutes), until: now + holdMinutes };
    if (transitionMinutes <= 0) { for (const k of KEYS5) { this.target[k] = p[k]; this.env.weather[k] = p[k]; } if (preset === 'storm' || p.rain > 0.5) this.wetness = Math.max(this.wetness, p.rain); }
    return true;
  }
  auto(transitionMinutes = 20) {
    if (!this.override) return;
    const from = {}; for (const k of KEYS5) from[k] = this.target[k];
    this.override = { from, to: null, t0: this.game.minutes, dur: transitionMinutes, until: this.game.minutes + transitionMinutes, release: true };
  }

  // ── forecast ────────────────────────────────────────────────────────────
  forecast() {
    const now = this.game.minutes;
    const cur = this.state.preset;
    const next = [];
    let last = cur;
    for (let m = now + 30; m < now + 30 * 60; m += 30) {
      const p = this.presetAt(m);
      if (p !== last) { next.push({ at: m, clock: clockOf(m), preset: p, label: PRESETS[p].label }); last = p; }
      if (next.length >= 4) break;
    }
    const worst = (a, b) => { let w = null, s = -1; for (let m = a; m < b; m += 30) { const p = this.presetAt(m); const sv = severity(p); if (sv > s) { s = sv; w = p; } } return w; };
    const dayStart = Math.floor(now / 1440) * 1440;
    const tonightP = worst(Math.max(now, dayStart + 20 * 60), dayStart + 28 * 60);
    const tomorrowP = worst(dayStart + 1440 + 8 * 60, dayStart + 1440 + 18 * 60);
    const phrase = {
      clear: 'clear skies and gentle seas', fair: 'fair weather with light winds', breezy: 'a fresh breeze but mostly dry', haze: 'some haze and calm conditions',
      overcast: 'cloudy skies and a moderate sea', fog: 'patches of fog, so you may hear the ship\'s whistle', drizzle: 'some drizzle and low cloud', showers: 'a few squally showers',
      rain: 'a spell of rain', gale: 'strong winds, so please take care on the open decks', storm: 'a period of rough weather with strong winds and heavy rain; the outer decks will be closed for your safety, and you will feel some motion',
    };
    let summary = '';
    const n0 = next[0];
    if (n0 && severity(n0.preset) >= 4) summary = `We expect ${PRESETS[n0.preset].label} from around ${spokenTime(n0.at)}.`;
    else if (n0) summary = `Later today, ${PRESETS[n0.preset].label}.`;
    else summary = `Conditions should stay much the same for the rest of the day.`;
    return { now: { preset: cur, label: PRESETS[cur].label }, next, summary, tonight: phrase[tonightP] || 'a quiet night', tomorrow: phrase[tomorrowP] || 'fair weather', tonightPreset: tonightP, tomorrowPreset: tomorrowP };
  }

  // ── per frame ───────────────────────────────────────────────────────────
  update(dt, rdt) {
    const g = this.game, env = this.env, now = g.minutes;
    this._time += dt;
    // target
    const T = this.target;
    const base = this._baseTmp || (this._baseTmp = {});
    this._sample(now, base);
    let preset = this._cur;
    const O = this.override;
    if (O) {
      const k = O.dur > 0 ? smoothstep(0, 1, (now - O.t0) / O.dur) : 1;
      const to = O.to ? PRESETS[O.to] : base;
      for (const key of KEYS5) T[key] = lerp(O.from[key], to[key], k);
      if (O.to) { preset = O.to; if (O.to === 'showers' || O.to === 'gale') T.rain *= 0.4 + smoothstep(0.35, 0.65, vnoise(now / 16 + 3.7)) * 0.9; }
      if (now >= O.until && !O.release) this.auto(20);
      else if (O.release && now >= O.until) this.override = null;
    } else for (const key of KEYS5) T[key] = base[key];
    env.weather.target = T;

    // derived state
    const Wl = env.weather, S = this.state;
    const v = g.schedule ? g.schedule.voyageDay : ((g.day % 7) + 1);
    S.preset = preset; S.label = PRESETS[preset].label;
    for (const k of KEYS5) S[k] = Wl[k];
    S.windKnots = 4 + Wl.wind * 26 + Wl.storm * 26;
    const veer = this.override ? 0 : (v === 4 ? -40 * (1 - smoothstep(4, 14, g.hour)) : 0);
    S.windDir = (WIND_FROM[v] + veer + (vnoise(now / 90 + 11) - 0.5) * 40 + 360) % 360;
    S.beaufort = beaufort(S.windKnots);
    S.swellM = 0.6 + Wl.wind * 2.2 + Wl.storm * 4.5;
    S.seaState = S.swellM < 1.25 ? 'slight' : S.swellM < 2.5 ? 'moderate' : S.swellM < 4 ? 'rough' : S.swellM < 6 ? 'very rough' : 'high';
    if (S.swellM < 0.5) S.seaState = 'calm';
    const diurnal = Math.sin((g.hour - 9) / 24 * Math.PI * 2) * 2.2;
    S.airTempC = AIR_T[v] + diurnal * (1 - Wl.cloud * 0.6) - Wl.rain * 2 - Wl.storm * 1.5;
    S.seaTempC = SEA_T[v];
    S.visibilityNm = clamp(12 * (1 - Wl.fog * 0.97) * (1 - Wl.rain * 0.6) * (1 - Wl.storm * 0.4), 0.1, 12);
    // apparent wind in the ship frame (+X forward, +Z starboard). course ≈ east (090) unless the voyage says otherwise
    const course = g.schedule?.position ? (this._course ?? 80) : 80;
    if (!this._courseT || this._time - this._courseT > 10) { this._courseT = this._time; if (g.schedule?.position) this._course = g.schedule.position().course; }
    const rel = (S.windDir - course) * Math.PI / 180;             // relative bearing the wind comes FROM, clockwise from the bow
    const ws = S.windKnots * 0.5144;
    const ax = -Math.cos(rel) * ws - shipSpeed(g), az = -Math.sin(rel) * ws;
    S.apparent.x = ax; S.apparent.z = az; S.apparent.speed = Math.hypot(ax, az);
    // wetness: wets in a few game minutes of rain, dries over ~1–2 hours
    const r = Wl.rain;
    if (r > 0.05) this.wetness = Math.min(1, this.wetness + dt / 75 * (0.3 + r * 1.5));
    else this.wetness = Math.max(0, this.wetness - dt / 75 * (0.012 + Wl.wind * 0.02 + (env.nightK != null ? (1 - env.nightK) * 0.02 : 0)));
    S.wetness = this.wetness;
    S.shelter = Wl.rain > 0.3 || Wl.storm > 0.45 || S.windKnots > 38;
    // bus: changes
    const pr = this._lastEmit.rainB, ps = this._lastEmit.stormB, hy = (v, b, t1, t2) => { const h = 0.06; const up1 = b >= 1 ? t1 - h : t1 + h, up2 = b >= 2 ? t2 - h : t2 + h; return v > up2 ? 2 : v > up1 ? 1 : 0; };
    const rainB = hy(Wl.rain, pr, 0.15, 0.5), stormB = hy(Wl.storm, ps, 0.3, 0.6);
    // hysteresis: a band change must persist (>= 4 game minutes since the last emit) unless the preset itself changed
    const bandChanged = rainB !== this._lastEmit.rainB || stormB !== this._lastEmit.stormB;
    if (preset !== this._lastEmit.preset || (bandChanged && now - (this._lastEmit.at ?? -1e9) > 4)) {
      this._lastEmit.preset = preset; this._lastEmit.rainB = rainB; this._lastEmit.stormB = stormB; this._lastEmit.at = now;
      g.bus.emit('weather:change', { preset, label: S.label, rain: Wl.rain, storm: Wl.storm, wind: Wl.wind, fog: Wl.fog, shelter: S.shelter, windKnots: S.windKnots });
    }
    // lightning
    this._updateLightning(dt);
    // gust sfx in strong wind (audio also has its own bed; these are punctuations when outside)
    this._gustT -= dt;
    if (this._gustT <= 0) { this._gustT = 12 + Math.random() * 30; if (Wl.wind > 0.75 && viewInfo(g).exterior) g.bus.emit('sfx', { name: 'wind_gust', vol: 0.5 + Wl.storm * 0.5 }); }
    // fog signal: one prolonged blast at intervals of not more than 2 minutes (real time)
    this._hornT -= rdt ?? dt;
    if (Wl.fog > 0.55 && this._hornT <= 0) { this._hornT = 110 + Math.random() * 10; if (!g.schedule?.isOn('muster')) g.bus.emit('sfx', { name: 'ship_horn', dur: 4.5, x: -111, y: 58, z: 0, vol: 0.75, fog: true }); }
    else if (Wl.fog <= 0.55 && this._hornT < 20) this._hornT = 20;
  }

  lateUpdate(dt) {
    const g = this.game, env = this.env, Wl = env.weather, cam = g.camera;
    const V = viewInfo(g);
    // ── lightning flash applied after the environment computed its lighting ──
    const f = this.lightning;
    if (f > 0.001) {
      const night = env.nightK ?? 0;
      const k = f * (0.35 + night * 0.9);
      // cloud illumination through the sky shader's uFlash; a smaller flat lift of the sky colours keeps the
      // ocean's sky reflection (which shares uZenith/uHorizon) flashing too
      if (env.setFlash) env.setFlash(k * 0.9);
      const add = this._tmpC.setRGB(0.5, 0.55, 0.7).multiplyScalar(k * (env.setFlash ? 0.25 : 0.55));
      env.skyU.uZenith.value.add(add); env.skyU.uHorizon.value.add(add);
      env.hemi.intensity += k * 0.9;
      env.sun.intensity += k * 0.7; env.sun.color.lerp(this._tmpC.setRGB(0.8, 0.85, 1), Math.min(1, k));
      env.fog.color.add(this._tmpC.setRGB(0.25, 0.27, 0.33).multiplyScalar(k));
      this._skyFlash = true;
    } else if (this._skyFlash) { this._skyFlash = false; env.setFlash?.(0); }
    const grade = g.grade?.uniforms?.uFlash;
    if (grade) {
      const want = f * (V.exterior ? 0.12 : V.window ? 0.05 : 0) * (0.4 + (env.nightK ?? 0) * 0.6);
      if (want > 0.001 || this._gradeFlash > 0) {
        if (Math.abs(grade.value - this._gradeFlash) < 1e-4 || grade.value < want) grade.value = want;
        this._gradeFlash = want;
      }
    }
    this.bolt.visible = f > 0.05 && this._flash.bolt; this.boltMat.opacity = Math.min(1, f * 1.3);
    this.glow.visible = f > 0.02; this.glow.material.opacity = Math.min(1, f) * 0.8;

    // ── rain ──
    const rain = Wl.rain;
    const showRain = rain > 0.01 && V.outside > 0;
    this.rain.visible = showRain; this.splash.visible = showRain && V.exterior;
    if (showRain) {
      const RU = this.rainU, A = this.state.apparent;
      // velocity: terminal fall speed + apparent wind (scaled: drops don't fully reach wind speed near the hull)
      const fall = 7.5 + Wl.storm * 1.5;
      RU.uVel.value.set(A.x * 0.55, -fall, A.z * 0.55);
      const off = RU.uOff.value, box = RU.uBox.value, vel = RU.uVel.value;
      off.x = (off.x + vel.x * dt) % box.x; off.y = (off.y + vel.y * dt) % box.y; off.z = (off.z + vel.z * dt) % box.z;
      RU.uCam.value.copy(cam.position);
      RU.uPxSize.value = 2 * Math.tan(cam.fov * Math.PI / 360) / Math.max(1, g.renderer.domElement.height);
      RU.uRain.value = Math.min(1, rain * 1.05);
      RU.uFogD.value = env.fog.density; RU.uFogCol.value.copy(env.fog.color);
      const light = 0.42 + env.hemi.intensity * 0.3;
      RU.uColor.value.copy(env.fog.color).lerp(this._tmpC.setRGB(0.85, 0.88, 0.92), 0.55).multiplyScalar(light);
      RU.uAlpha.value = 0.45 + Wl.storm * 0.2 + f * 0.5;
      const SU = this.splashU;
      SU.uCam.value.copy(cam.position); SU.uTime.value += dt; SU.uRain.value = rain;
      SU.uColor.value.copy(RU.uColor.value).multiplyScalar(1.3);
    }
    // ── rain shafts on the horizon (squalls / storm) ──
    const shaftK = clamp(Math.max(rain - 0.25, Wl.storm - 0.2) * 1.4, 0, 1) * (V.outside > 0 ? 1 : 0);
    this.shafts.visible = shaftK > 0.02;
    if (this.shafts.visible) {
      const sp = shipSpeed(g);
      for (const s of this.shaftList) {
        s.x -= sp * dt * 0.5; s.ang += 0; // drift aft relative to the ship (half rate: cells move with the wind too)
        let dx = s.x - cam.position.x, dz = s.z - cam.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 7500 || dx < -6000) { const a = (Math.random() - 0.5) * 2.4; const r = 3500 + Math.random() * 3000; s.x = cam.position.x + Math.cos(a) * r + 2000; s.z = cam.position.z + Math.sin(a) * r * 1.4; dx = s.x - cam.position.x; dz = s.z - cam.position.z; }
        // keep them at ≤ 3600 m (inside the far plane/sky) by compressing distance, preserving angle
        const dd = Math.hypot(dx, dz), k = Math.min(1, 3600 / dd);
        s.mesh.position.set(cam.position.x + dx * k, -2.5, cam.position.z + dz * k);
        s.mesh.scale.set(s.w * k, s.h * k, 1);
        s.mesh.rotation.y = Math.atan2(-dx, -dz);
        s.mesh.material.uniforms.uAlpha.value = shaftK * s.a;
        s.mesh.material.uniforms.uTime.value += dt;
        s.mesh.material.uniforms.uColor.value.copy(env.fog.color).multiplyScalar(0.62 + f * 0.6);
        s.mesh.material.uniforms.uFogCol.value.copy(env.fog.color);
        s.mesh.material.uniforms.uFogD.value = env.fog.density;
      }
    }
    // ── bow spray ──
    this._updateSpray(dt);
    // ── flags ──
    this._updateFlags(dt);
  }

  // ── cover heightmap: highest surface rain lands on, per 1 m cell ─────────
  _buildCover() {
    const W = 332, H = 50, x0 = -166, z0 = -25;
    const data = new Float32Array(W * H);
    const plans = this.game.world?.plans || this.game.layout?.plans || [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = x0 + i + 0.5, z = z0 + j + 0.5;
      let y = -1.6;
      for (let d = plans.length - 1; d >= 1; d--) {
        const p = plans[d]; if (!p) continue;
        const r = p.roomAt(x, z);
        if (!r || r.isVoid) continue;
        y = r.exterior ? deckY(d) : deckY(d) + SHIP.deckHeight;
        if (r.pool) y = deckY(d) - 0.2;
        break;
      }
      data[j * W + i] = y;
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
    this.coverTex = tex; this.coverData = data;
    this.coverXf = new THREE.Vector4(x0, z0, 1, 0);
  }
  coverAt(x, z) { const i = Math.floor(x + 166), j = Math.floor(z + 25); if (i < 0 || j < 0 || i >= 332 || j >= 50) return -1.6; return this.coverData[j * 332 + i]; }

  _buildRain() {
    const q = this.game.quality || {};
    const N = q.pixelRatio >= 1.2 ? 9000 : q.pixelRatio >= 1 ? 6500 : 4000;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1); base.translate(0.5, 0.5, 0);
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) { seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = (i + Math.random()) / N; }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = N;
    this.rainU = {
      uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(56, 30, 56) }, uOff: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -8, 0) },
      uLen: { value: 0.07 }, uWidth: { value: 0.012 }, uPxSize: { value: 0.0017 }, uRain: { value: 0 }, uCover: { value: this.coverTex }, uCoverXf: { value: this.coverXf },
      uColor: { value: new THREE.Color(0.7, 0.72, 0.75) }, uAlpha: { value: 0.3 }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0 },
    };
    this.rain = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: RAIN_VS, fragmentShader: RAIN_FS, uniforms: this.rainU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.rain.frustumCulled = false; this.rain.renderOrder = 8; this.rain.visible = false; this.rain.name = 'rain';
    this.group.add(this.rain);
    // splashes
    const NS = 700;
    const g2 = new THREE.InstancedBufferGeometry();
    const b2 = new THREE.PlaneGeometry(1, 1);
    g2.index = b2.index; g2.setAttribute('position', b2.attributes.position); g2.setAttribute('uv', b2.attributes.uv);
    const s2 = new Float32Array(NS * 4);
    for (let i = 0; i < NS; i++) { s2[i * 4] = Math.random(); s2[i * 4 + 1] = Math.random(); s2[i * 4 + 2] = Math.random(); s2[i * 4 + 3] = (i + Math.random()) / NS; }
    g2.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s2, 4)); g2.instanceCount = NS;
    this.splashU = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uRain: { value: 0 }, uR: { value: 16 }, uCover: { value: this.coverTex }, uCoverXf: { value: this.coverXf }, uColor: { value: new THREE.Color(0.8, 0.82, 0.85) }, uAlpha: { value: 0.28 } };
    this.splash = new THREE.Mesh(g2, new THREE.ShaderMaterial({ vertexShader: SPLASH_VS, fragmentShader: SPLASH_FS, uniforms: this.splashU, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.splash.frustumCulled = false; this.splash.renderOrder = 7; this.splash.visible = false; this.splash.name = 'rainSplash';
    this.group.add(this.splash);
  }

  // ── lightning ───────────────────────────────────────────────────────────
  _buildLightning() {
    // three pre-generated bolts as ribbon strips (unit height, branches)
    const pos = [], idx = [];
    const seg = (ax, ay, bx, by, w) => {
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w, ny = dx / l * w;
      const o = pos.length / 3;
      pos.push(ax - nx, ay - ny, 0, ax + nx, ay + ny, 0, bx + nx, by + ny, 0, bx - nx, by - ny, 0);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    const rnd = mulberry(77);
    const walk = (x, y, ty, w, depth) => {
      let cx = x, cy = y;
      while (cy > ty) {
        const ny = cy - (0.02 + rnd() * 0.05), nx = cx + (rnd() - 0.5) * 0.06;
        seg(cx, cy, nx, ny, w);
        if (depth < 2 && rnd() < 0.09) walk(nx, ny, ny - 0.12 - rnd() * 0.25, w * 0.55, depth + 1);
        cx = nx; cy = ny;
      }
    };
    walk(0, 1, 0, 0.006, 0);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.5, 3.2), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
    this.bolt = new THREE.Mesh(g, this.boltMat); this.bolt.frustumCulled = false; this.bolt.visible = false; this.bolt.renderOrder = -5; this.bolt.name = 'lightningBolt';
    this.env.envGroup.add(this.bolt);
    // cloud glow: soft radial sprite
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(200,210,255,0.45)'); gr.addColorStop(1, 'rgba(160,170,220,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xdfe6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    this.glow.visible = false; this.glow.renderOrder = -6; this.glow.name = 'lightningGlow';
    this.env.envGroup.add(this.glow);
  }
  strike(dist, angle) {
    const g = this.game, cam = g.camera.position;
    const d = dist ?? (1800 + Math.random() * 7000);
    const a = angle ?? Math.random() * Math.PI * 2;
    const rx = Math.cos(a) * d, rz = Math.sin(a) * d;
    const hasBolt = Math.random() < 0.6 || dist != null;
    // distance compression to stay inside the sky sphere
    const k = Math.min(1, 3200 / d);
    const px = cam.x + rx * k, pz = cam.z + rz * k;
    const cloudBase = 1100 * k;
    this.bolt.position.set(px, -2, pz);
    this.bolt.scale.set(cloudBase * (0.8 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1), cloudBase, 1);
    this.bolt.rotation.y = Math.atan2(-(px - cam.x), -(pz - cam.z));
    this.glow.position.set(px, cloudBase * 1.02, pz);
    this.glow.scale.setScalar(cloudBase * 1.6);
    const near = clamp(1 - (d - 800) / 8000, 0, 1);
    const pulses = [];
    let t = 0; const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { pulses.push([t, 0.05 + Math.random() * 0.07, (i === 0 ? 1 : 0.5 + Math.random() * 0.5)]); t += 0.06 + Math.random() * 0.14; }
    this._flash = { t: 0, dur: t + 0.15, pulses, bolt: hasBolt, k: (0.45 + near * 0.75) * (hasBolt ? 1 : 0.6) };
    // thunder: sound travels 343 m/s
    this._strikes.push({ t: d / 343, near, dist: d });
    g.bus.emit('weather:lightning', { x: cam.x + rx, y: 800, z: cam.z + rz, dist: d });
  }
  _updateLightning(dt) {
    const Wl = this.env.weather;
    const F = this._flash;
    if (F.t < F.dur) {
      F.t += dt;
      let v = 0;
      for (const [t0, len, a] of F.pulses) { const u = (F.t - t0) / len; if (u >= 0 && u < 1.6) v = Math.max(v, a * (u < 0.15 ? u / 0.15 : Math.exp(-(u - 0.15) * 3))); }
      this.lightning = v * F.k;
    } else this.lightning = 0;
    this.state.lightning = this.lightning;
    // thunder queue
    for (let i = this._strikes.length - 1; i >= 0; i--) {
      const s = this._strikes[i]; s.t -= dt;
      if (s.t <= 0) { this._strikes.splice(i, 1); this.game.bus.emit('sfx', { name: 'thunder', near: s.near, vol: 0.35 + s.near * 0.65, dist: s.dist }); }
    }
    // strike scheduling: frequent in a storm, occasional in a gale
    const act = smoothstep(0.5, 0.95, Wl.storm);
    if (act > 0) {
      this._nextStrike -= dt * act;
      if (this._nextStrike <= 0) { this._nextStrike = 6 + Math.random() * 26; this.strike(); }
    }
  }

  // ── distant rain shafts ─────────────────────────────────────────────────
  _buildShafts() {
    this.shafts = new THREE.Group(); this.shafts.name = 'rainShafts'; this.shafts.visible = false;
    this.shaftList = [];
    const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.ShaderMaterial({ vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: Math.random() * 100 }, uSeed: { value: Math.random() * 10 }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0 } } });
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = -4;
      const a = (Math.random() - 0.5) * Math.PI * 2, r = 3500 + Math.random() * 3500;
      this.shaftList.push({ mesh: m, x: Math.cos(a) * r, z: Math.sin(a) * r, w: 260 + Math.random() * 520, h: 380 + Math.random() * 260, a: 0.25 + Math.random() * 0.3, ang: 0 });
      this.shafts.add(m);
    }
    this.env.envGroup.add(this.shafts);
  }

  // ── bow spray ───────────────────────────────────────────────────────────
  _buildSpray() {
    this.spray = new SoftParticles({ max: 420, color: 0xeef2f5, drag: 0.6, gravity: -7.5, soft: 0.8, noise: 1, name: 'bowSpray', renderOrder: 6, lightK: 0.9 });
    this.group.add(this.spray.mesh);
    this._sprayAcc = 0; this._sprayBurst = 0; this._sprayNext = 3;
  }
  _updateSpray(dt) {
    const g = this.game, env = this.env, Wl = env.weather;
    const sea = clamp((Wl.wind - 0.55) * 1.4 + Wl.storm * 0.9, 0, 1.4);
    const A = this.state.apparent;
    this.spray.drift.set(A.x * 0.8, 0, A.z * 0.8);
    if (sea > 0.05 && viewInfo(g).outside > 0) {
      // bursts when the bow digs into a swell (pitch rate proxy: env.motion.pitch going negative = bow down)
      const pitch = env.motion?.pitch || 0;
      const dp = (pitch - (this._lastPitch ?? pitch)) / Math.max(1e-3, dt); this._lastPitch = pitch;
      this._sprayNext -= dt;
      if (this._sprayNext <= 0 || dp < -0.004 * (1 + Math.random())) {
        if (this._sprayNext <= 0 || this._sprayBurst <= 0) this._sprayBurst = 0.5 + sea * 0.7;
        this._sprayNext = 2.5 + Math.random() * 6 / (0.4 + sea);
      }
      if (this._sprayBurst > 0) {
        this._sprayBurst -= dt;
        this._sprayAcc += dt * (40 + sea * 160);
        while (this._sprayAcc > 1) {
          this._sprayAcc -= 1;
          const s = Math.random() < 0.5 ? -1 : 1;
          const x = 132 + Math.random() * 24;
          const half = bowHalf(x) + 0.3;
          const up = 4 + Math.random() * (6 + sea * 9);
          this.spray.emit(x, -1.5 + Math.random() * 1.5, s * half, -2 + Math.random() * 3, up, s * (2 + Math.random() * 5),
            1.8 + Math.random() * 1.6, 1.2 + Math.random() * 1.5, 5 + Math.random() * 7 * sea, 0.22 + sea * 0.18);
        }
      }
    }
    this.spray.update(dt, env);
  }

  // ── flags ───────────────────────────────────────────────────────────────
  _buildFlags() {
    this.flags = [];
    const mk = (draw, w, h, x, y, z, poleH) => {
      const tex = canvasTex(256, Math.round(256 * h / w), draw);
      const geo = new THREE.PlaneGeometry(w, h, 18, 8); geo.translate(w / 2, -h / 2, 0);
      const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85 });
      const U = { uFlagTime: { value: Math.random() * 10 }, uFlagFreq: { value: 6 }, uFlagWind: { value: 1 }, uFlagLen: { value: w }, uFlagSeed: { value: Math.random() * 6 } };
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = 'uniform float uFlagTime; uniform float uFlagFreq; uniform float uFlagWind; uniform float uFlagLen; uniform float uFlagSeed;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FLAG_VS_INJECT);
      };
      mat.customProgramCacheKey = () => 'htflag';
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = false; m.name = 'flag';
      this.group.add(m);
      this.flags.push({ mesh: m, U });
      if (poleH) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, poleH, 8), new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.4, metalness: 0.3 }));
        pole.position.set(x, y - poleH / 2 + 0.1, z); this.group.add(pole);
        const truck = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc9a54a, roughness: 0.3, metalness: 0.8 }));
        truck.position.set(x, y + 0.15, z); this.group.add(truck);
      }
    };
    const top = deckY(17) + 3;
    // Bahamas ensign at the stern flagstaff (port of registry: Nassau)
    mk((c, w, h) => {
      c.fillStyle = '#00778b'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffc72c'; c.fillRect(0, h / 3, w, h / 3);
      c.fillStyle = '#000'; c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.42, h / 2); c.lineTo(0, h); c.fill();
    }, 3.6, 1.8, -164.2, deckY(6) + 6.2, 0, 6.2);
    // house flag at the starboard yardarm, courtesy (UK red ensign) port yardarm — hoisted on halyards
    mk((c, w, h) => {
      c.fillStyle = '#0e3a52'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8d9b0'; c.fillRect(0, h * 0.14, w, h * 0.05); c.fillRect(0, h * 0.81, w, h * 0.05);
      c.translate(w / 2, h / 2); c.strokeStyle = '#e8d9b0'; c.lineWidth = 5; c.beginPath(); c.moveTo(0, h * 0.28); c.quadraticCurveTo(4, 0, 0, -h * 0.3); c.stroke();
      for (let k = 0; k < 5; k++) for (const s of [-1, 1]) { c.fillStyle = k % 2 ? '#7fb8d6' : '#a9d3e8'; c.beginPath(); c.ellipse(s * 9, h * 0.18 - k * h * 0.11, 10, 6, s * 0.5, 0, Math.PI * 2); c.fill(); }
    }, 2.4, 1.6, 96.2, top + 7.0, 6.4, 0);
    mk((c, w, h) => {
      c.fillStyle = '#c8102e'; c.fillRect(0, 0, w, h);
      const cw = w / 2, ch = h / 2;
      c.fillStyle = '#012169'; c.fillRect(0, 0, cw, ch);
      c.save(); c.beginPath(); c.rect(0, 0, cw, ch); c.clip();
      c.strokeStyle = '#fff'; c.lineWidth = ch * 0.2; c.beginPath(); c.moveTo(0, 0); c.lineTo(cw, ch); c.moveTo(cw, 0); c.lineTo(0, ch); c.stroke();
      c.strokeStyle = '#c8102e'; c.lineWidth = ch * 0.07; c.beginPath(); c.moveTo(0, 0); c.lineTo(cw, ch); c.moveTo(cw, 0); c.lineTo(0, ch); c.stroke();
      c.fillStyle = '#fff'; c.fillRect(cw * 0.42, 0, cw * 0.16, ch); c.fillRect(0, ch * 0.36, cw, ch * 0.28);
      c.fillStyle = '#c8102e'; c.fillRect(cw * 0.46, 0, cw * 0.08, ch); c.fillRect(0, ch * 0.43, cw, ch * 0.14);
      c.restore();
    }, 2.4, 1.2, 96.2, top + 7.0, -6.4, 0);
  }
  _updateFlags(dt) {
    const A = this.state.apparent;
    const spd = A.speed;
    const yaw = Math.atan2(A.z, A.x);       // direction the wind blows TOWARD, in the XZ plane
    for (const f of this.flags) {
      f.mesh.rotation.y = -yaw;
      const wk = clamp(spd / 14, 0.15, 1);
      f.U.uFlagWind.value = wk;
      f.U.uFlagFreq.value = 2.5 + spd * 0.45;
      f.U.uFlagTime.value += dt;
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────
function beaufort(kn) { const t = [1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63]; let b = 0; while (b < t.length && kn >= t[b]) b++; return b; }
function severity(p) { return { clear: 0, fair: 0, haze: 1, breezy: 1, overcast: 2, fog: 3, drizzle: 3, showers: 4, rain: 4, gale: 5, storm: 6 }[p] ?? 0; }
function clockOf(m) { const mm = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(Math.floor(mm % 60)).padStart(2, '0')}`; }
function spokenTime(m) {
  const mm = ((m % 1440) + 1440) % 1440, h = Math.floor(mm / 60);
  if (h < 5) return 'the early hours'; if (h < 12) return `${h} this morning`; if (h === 12) return 'midday'; if (h < 18) return `${h - 12} this afternoon`; return `${h - 12} this evening`;
}
function bowHalf(x) { const bs = 82, sx = 158; if (x > sx) return 0.5; let h = 20.5; if (x > bs) { const t = (x - bs) / (sx - bs); h *= Math.pow(Math.max(0, 1 - Math.pow(t, 1.9)), 0.62); } return h; }
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
