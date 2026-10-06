// HALCYON TIDE — bootstrap & main loop.
// Systems register on `game` and are updated in a fixed order each frame.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SHIP, QUALITY_PRESETS, deckOfY, deckY, TIME } from './core/config.js';
import { EventBus } from './core/util.js';
import { buildShipLayout } from './world/shipLayout.js';
import { buildSurfaceArrays } from './world/textures.js';
import { getMaterials, shared } from './world/materials.js';
import { World } from './world/world.js';
import { buildHull } from './world/hull.js';
import { Environment } from './env/environment.js';

const params = new URLSearchParams(location.search);

const GradePass = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.28 }, uSat: { value: 1.06 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uFlash: { value: 0 }, uGrain: { value: 0.025 }, uTime: { value: 0 }, uBlur: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uSat; uniform vec3 uTint; uniform float uFlash; uniform float uGrain; uniform float uTime; uniform float uBlur;
  varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    if (uBlur > 0.0) { vec2 o = vec2(uBlur*0.003); c = (c + texture2D(tDiffuse, vUv+o) + texture2D(tDiffuse, vUv-o) + texture2D(tDiffuse, vUv+vec2(o.x,-o.y)) + texture2D(tDiffuse, vUv+vec2(-o.x,o.y)))/5.0; }
    float l = dot(c.rgb, vec3(0.299,0.587,0.114));
    c.rgb = mix(vec3(l), c.rgb, uSat) * uTint;
    vec2 d = vUv - 0.5; c.rgb *= 1.0 - uVig * dot(d,d) * 2.2;
    c.rgb += (h(vUv*913.0) - 0.5) * uGrain;
    c.rgb = mix(c.rgb, vec3(1.0,0.95,0.9), uFlash);
    gl_FragColor = c;
  }`,
};

export class Game {
  constructor() {
    this.bus = new EventBus();
    this.systems = [];
    this.params = params;
    try { this.qualityName = localStorage.getItem('ht.quality') || params.get('q') || 'high'; } catch { this.qualityName = 'high'; }
    this.quality = QUALITY_PRESETS[this.qualityName] || QUALITY_PRESETS.high;
    this.minutes = TIME.startHour * 60;   // game clock in minutes since day-0 midnight
    this.timeScale = 1;
    this.paused = false;
    this.shipSpeedK = 1;
    this.frame = 0;
    window.__game = this;
  }

  addSystem(sys) { this.systems.push(sys); this.systems.sort((a, b) => (a.order ?? 50) - (b.order ?? 50)); return sys; }
  getSystem(name) { return this.systems.find(s => s.name === name); }

  async init(progress = () => {}) {
    const app = document.getElementById('app');
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.quality.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;     // driven by updateShadows() (every 2nd frame, skipped indoors / at night)
    // The shadow pass tests layers against the MAIN camera: furniture shadow proxies live on layer 1, which the camera
    // sees only while the shadow map is being rendered (the visible pass never draws them).
    { const sm = renderer.shadowMap, orig = sm.render.bind(sm);
      sm.render = (lights, scene, camera) => { camera.layers.enable(1); try { orig(lights, scene, camera); } finally { camera.layers.disable(1); } }; }
    app.appendChild(renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.08, 6000);
    this.camera.position.set(-260, 40, 160);
    this.camera.lookAt(0, 10, 0);

    progress(0.04, 'Painting finishes');
    await tick();
    this.arrays = buildSurfaceArrays();
    this.mats = getMaterials(this.arrays);
    progress(0.12, 'Drawing up the general arrangement');
    await tick();
    this.layout = buildShipLayout(7);
    progress(0.2, 'Laying keel');
    await tick();
    this.world = new World(this.scene, this.layout, this.mats, this.bus);
    await this.world.buildAllAsync((f, d) => progress(0.2 + f * 0.55, `Fitting out deck ${d} of ${SHIP.deckCount}`));
    this.hull = buildHull();
    this.world.root.add(this.hull);
    this.world.hull = this.hull;
    this.world.setQuality(this.quality);
    progress(0.8, 'Filling the ocean');
    await tick();
    this.env = new Environment(this);
    this.env.setQuality(this.quality);

    // post-processing
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.quality.msaa ?? 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradePass);
    this.composer.addPass(this.grade);
    this.applyQuality();

    window.addEventListener('resize', () => this.onResize());
    this.clock = new THREE.Clock();
    progress(0.86, 'Boarding passengers');
    await tick();
    this.bus.emit('game:worldReady', this);
  }

  applyQuality() {
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * q.pixelRatio);
    const hadShadows = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = q.shadows;
    if (hadShadows !== q.shadows) this.scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    this.bloom.enabled = q.bloom;
    this.camera.far = Math.max(1200, q.drawDistance * 2); this.camera.updateProjectionMatrix();
    this.env?.setQuality(q);
    this.world?.setQuality(q);
    if (this.composer && this.composer.renderTarget1.samples !== (q.msaa ?? 4)) { this.composer.renderTarget1.samples = this.composer.renderTarget2.samples = q.msaa ?? 4; this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    this.onResize();
  }

  // Shadow map policy: sun shadows only when the sun is up and something outside is in view, cast only by geometry
  // near the camera (world.updateVisibility trims casters), refreshed every 2nd frame (every frame right after a cut).
  updateShadows() {
    const r = this.renderer, env = this.env, sun = env.sun, q = this.quality;
    const V = this.world.vis;
    // indoors: only when the camera's own room has windows/glass to the outside (sunlit floor patches)
    const want = q.shadows && env.sunUpK > 0.02 && V.seesOut && (!V.indoor || V.camOut);
    if (sun.castShadow !== want) { sun.castShadow = want; r.shadowMap.needsUpdate = true; this._shadowFrame = 0; }
    if (!want) return;
    this._shadowFrame = (this._shadowFrame || 0) + 1;
    const moved = this._lastShadowPos ? this._lastShadowPos.distanceToSquared(sun.target.position) > 0.01 : true;
    if (moved || this._shadowFrame % (q.shadowEvery ?? 2) === 0) r.shadowMap.needsUpdate = true;
    (this._lastShadowPos ||= new THREE.Vector3()).copy(sun.target.position);
  }

  // Compile every program the game can show (all decks' detail, LOD variants, characters, shadows on/off) during
  // loading so the first frames and deck changes never stall on shader compilation.
  async precompile() {
    const restore = this.world.showAllForCompile();
    const sun = this.env.sun, cast = sun.castShadow;
    const lp = this.scene.getObjectByName('lightPool');
    try {
      for (const shadows of this.quality.shadows ? [true, false] : [false]) {
        sun.castShadow = shadows;
        if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
        else this.renderer.compile(this.scene, this.camera);
      }
      // one real render of everything (uploads geometry/textures and finishes program linking) with the post chain
      this.composer.render();
    } catch (e) { console.warn('[precompile]', e); }
    sun.castShadow = cast;
    restore();
  }
  setQuality(name) {
    this.qualityName = name; this.quality = QUALITY_PRESETS[name];
    try { localStorage.setItem('ht.quality', name); } catch {}
    this.applyQuality();
    this.bus.emit('settings:quality', name);
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  }

  get hour() { return (this.minutes / 60) % 24; }
  get day() { return Math.floor(this.minutes / 1440); }

  start() {
    const loop = () => {
      if (window.__stop) { this.stopped = true; return; }
      requestAnimationFrame(loop);
      this.step();
    };
    loop();
  }

  step(dtOverride) {
    let dt = dtOverride ?? Math.min(0.05, this.clock.getDelta());
    this.frame++;
    const simDt = this.paused ? 0 : dt * this.timeScale;
    if (!this.paused) this.minutes += simDt / TIME.realSecondsPerGameMinute;
    shared.uTime.value += simDt;
    for (const s of this.systems) if (s.update && (!this.paused || s.runWhilePaused)) safe(s, 'update', simDt, dt);
    const focus = this.focus || this.camera.position;
    this.env.update(simDt, this.minutes, focus);
    this.grade.uniforms.uTime.value = (this.grade.uniforms.uTime.value + dt) % 100;
    for (const s of this.systems) if (s.lateUpdate && (!this.paused || s.runWhilePaused)) safe(s, 'lateUpdate', simDt, dt);
    try {
      this.world.updateVisibility(this.camera, { player: this.debugCam ? null : this.player, dt });
      this.updateShadows();
    } catch (e) { if (!this._visErr) { this._visErr = true; console.error('[visibility]', e); } }
    this.composer.render();
  }
}

// A failing system must never take the whole game down: log (throttled) and continue.
function safe(sys, fn, a, b) {
  try { sys[fn](a, b); }
  catch (e) {
    sys._errs = (sys._errs || 0) + 1;
    if (sys._errs < 5 || sys._errs % 600 === 0) console.error(`[system ${sys.name}.${fn}]`, e);
  }
}

function tick() { return new Promise(r => setTimeout(r, 0)); }

// ── boot ───────────────────────────────────────────────────────────────────
async function boot() {
  const game = new Game();
  const ui = document.getElementById('ui');
  const loader = document.createElement('div');
  loader.className = 'loader';
  loader.innerHTML = `<div class="loader-inner"><div class="brand">LARKSPUR OCEANIC</div><h1>Halcyon Tide</h1><div class="bar"><i></i></div><div class="msg">Preparing for embarkation…</div></div>`;
  ui.appendChild(loader);
  const setP = (f, msg) => { loader.querySelector('.bar i').style.width = (f * 100).toFixed(1) + '%'; if (msg) loader.querySelector('.msg').textContent = msg; };
  try {
    await game.init(setP);
    // gameplay modules are loaded dynamically so that each workstream stays independent
    const mods = await import('./gameplay.js');
    await mods.installGameplay(game, setP);
    setP(0.97, 'Warming up the galley');
    await game.precompile();
    setP(1, 'All aboard');
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 1200);
    game.start();
  } catch (e) {
    console.error(e);
    loader.querySelector('.msg').textContent = 'Failed to start: ' + e.message;
    throw e;
  }
}
boot();
