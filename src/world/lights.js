// HALCYON TIDE — dynamic lighting.
//  • Interior light pool: N (default 14; 'lights' in the quality preset) warm downlights (SpotLights, wide 69° soft cone pointing down — omni
//    PointLights burn an unrealistic hotspot into the ceiling; no shadows, distance ~7.5 m, decay 2) that hop between the
//    ceiling fixtures (world.decks[d].fixtures) nearest the camera with smooth fade-out → move → fade-in (no popping).
//    Fixtures hidden behind walls are rejected with world.lineClear so light doesn't bleed into the next room.
//    The light count never changes at runtime (unused slots sit at intensity 0) so shaders never recompile.
//  • Exterior night lighting: instanced emissive geometry built from the deck plans — LED strips along the foot of
//    exterior railings, wall sconces on exterior facades (one per balcony, every ~6 m on open decks/promenades),
//    bollards around pool decks, pool underwater lights. Glows only at night via a shared uniform (uDeckGlow, driven
//    from shared.uNight). At night the same PointLight pool also serves the sconces/bollards nearest the camera on
//    open decks so teak and furniture get real pools of light.
//  • Emergency + blackout modes (see API).
//
// game.lights API:
//   setEmergency(bool)        red, dim interior lighting ship-wide (scales shared.uIntLight, tints the light pool red,
//                             fixture emissive goes dim red, slow 0.5 Hz pulse on the pool lights)
//   blackout(deck, bool)      power cut on a deck: the baked interior term fades to ~8 % and the light pool switches
//                             off while the CAMERA is on that deck (see LIMITATIONS)
//   isBlackout(deck), emergency (bool), setBase(color)  (base interior colour; default = materials' initial value)
//   pool                      the PointLight slots [{light, fix, k}], count, setCount(n) (rebuilds; causes one recompile)
//   glow                      { value } — current exterior night glow 0..1 (uniform shared by the deck light meshes)
//
// LIMITATIONS: deck materials are shared across all decks and the interior term is one global uniform
// (shared.uIntLight), so a blackout is applied only while the camera's deck is blacked out — other (streamed)
// decks visible through stairwells / atrium voids momentarily share the camera deck's lighting state, and the
// opaque "shell" window glow of decks that aren't streamed in is unaffected from outside. Proper per-deck lighting
// would need an extra per-vertex deck id or per-deck material clones in deckBuilder/materials (integrator decision).
import * as THREE from 'three';
import { GRID, deckY, deckOfY, idx, cellX, cellZ, SHIP } from '../core/config.js';
import { shared } from './materials.js';

const POOL = 14;
const RANGE = 7.5;            // PointLight.distance
const SEARCH = 18;            // fixtures considered within this radius of the camera
const SPREAD = 2.6;           // two selected fixtures closer than this (same deck) waste a slot — keep them apart
const BASE_I = 7.0;           // candela (physically based lights, decay 2)

export function installLights(game) {
  const world = game.world, plans = world.plans, scene = game.scene, bus = game.bus;
  const baseInt = shared.uIntLight.value.clone();
  const fixtureMat = game.mats?.fixture;
  const fixtureBase = fixtureMat ? fixtureMat.color.clone() : null;

  // ── light pool ────────────────────────────────────────────────────────
  const group = new THREE.Group(); group.name = 'lightPool'; scene.add(group);
  let pool = [];
  function buildPool(n) {
    for (const s of pool) group.remove(s.light);
    pool = [];
    for (let k = 0; k < n; k++) {
      // Downlight: a wide, soft cone pointing straight down (an omni PointLight just under a ceiling burns a
      // hotspot into the ceiling that real recessed downlights never produce). Same per-pixel cost class.
      const l = new THREE.SpotLight(0xffd9b0, 0, RANGE, 1.2, 0.85, 2);
      l.castShadow = false; l.position.set(0, -1000, 0);
      l.target.position.set(0, -1001, 0);
      group.add(l); group.add(l.target);
      pool.push({ light: l, fix: null, k: 0 });
    }
  }
  buildPool(game.quality?.lights ?? POOL);

  // ── exterior deck lighting geometry ──────────────────────────────────
  const glow = { value: 0 };
  const extLamps = [];        // candidate positions for exterior point lights {x,y,z,deck,warm,ext:true,i}
  buildExterior();

  function emissiveMat(color, k = 1, dayK = 0) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uDeckGlow = glow;
      sh.fragmentShader = 'uniform float uDeckGlow;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(${dayK.toFixed(3)}, 1.0, uDeckGlow);`);
    };
    m.customProgramCacheKey = () => 'deckglow' + dayK;
    return m;
  }
  function buildExterior() {
    const housing = new THREE.MeshStandardMaterial({ color: 0xc4c9cc, roughness: 0.35, metalness: 0.75 });
    const strip = emissiveMat(0xffc27a, 2.6, 0.0);
    // soffit downlight lens: a light diffuser by day (was ~black at 3 % → the "row of dark dots" under every tier)
    const downM = emissiveMat(0xffe2b8, 1.6, 0.5);
    const downG = new THREE.CircleGeometry(0.085, 14).rotateX(Math.PI / 2);   // faces down
    const lens = emissiveMat(0xffd8a8, 3.2, 0.7);
    const poolM = emissiveMat(0x7fe6ff, 2.4, 0.0);
    const stripG = new THREE.BoxGeometry(1, 0.022, 0.035);              // scaled along x per segment
    const sconceG = new THREE.BoxGeometry(0.11, 0.2, 0.07).translate(0, 0, 0.035);
    const sconceLensG = new THREE.BoxGeometry(0.07, 0.03, 0.05).translate(0, -0.1, 0.035);
    const bollardG = new THREE.CylinderGeometry(0.07, 0.08, 0.7, 10).translate(0, 0.35, 0);
    const bollardLensG = new THREE.CylinderGeometry(0.075, 0.075, 0.1, 10).translate(0, 0.62, 0);
    const poolLampG = new THREE.CircleGeometry(0.16, 16);
    // light "wash" decals: additive soft gradients on the facade under each sconce and on the floor beneath —
    // the cheap way to make hundreds of exterior lamps read from a distance without real lights
    const washTex = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 6, 1, 32, 20, 110);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const splashTex = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 1, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const washMat = (map, k) => {
      const m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: true });
      m.onBeforeCompile = (sh) => { sh.uniforms.uDeckGlow = glow; sh.fragmentShader = 'uniform float uDeckGlow;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= uDeckGlow;'); };
      m.customProgramCacheKey = () => 'wash' + k;
      return m;
    };
    const washG = new THREE.PlaneGeometry(1.5, 2.2).translate(0, -1.1, 0.004);
    const splashG = new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2);
    const washM = washMat(washTex, 0.32), splashM = washMat(splashTex, 0.3);

    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
    // ship-wide lists (one draw call per kind for the whole ship)
    const strips = [], sconces = [], bollards = [], poolLamps = [], downs = [];
    for (let d = 1; d < plans.length; d++) {
      const P = plans[d]; if (!P) continue;
      const y = deckY(d), R = P.rooms, D = world.decks[d]; if (!D) continue;
      const ext = (r) => r && r.exterior && !r.isVoid;
      const roomAt = (i, j) => (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) ? null : R[P.room[idx(i, j)]];
      // runs along constant-x and constant-z lines
      const scan = (normal) => {
        const A = normal === 'x' ? P.ex : P.ez;
        const outer = normal === 'x' ? GRID.nx - 1 : GRID.nz - 1, inner = normal === 'x' ? GRID.nz : GRID.nx;
        for (let a = 0; a < outer; a++) {
          let cur = null;
          for (let b = 0; b <= inner; b++) {
            let sig = null, info = null;
            if (b < inner) {
              const i = normal === 'x' ? a : b, j = normal === 'x' ? b : a;
              const k = idx(i, j), t = A[k];
              const ra = roomAt(i, j), rb = normal === 'x' ? roomAt(i + 1, j) : roomAt(i, j + 1);
              if (t === 3 || t === 6) {
                // railing: light on the walkable exterior side
                const side = ext(ra) && !ra.pool ? -1 : ext(rb) && !rb.pool ? 1 : 0;
                if (side && !((ra && ra.type === 'balcony') || (rb && rb.type === 'balcony'))) { sig = 'r' + side; info = { kind: 'rail', side, room: side < 0 ? ra : rb }; }
              } else if (t === 4) {
                const side = ext(ra) ? -1 : ext(rb) ? 1 : 0;
                const er = side < 0 ? ra : side > 0 ? rb : null, ir = side < 0 ? rb : ra;
                if (er && ir && !ir.isVoid) { sig = 'f' + side + ':' + er.id; info = { kind: 'facade', side, room: er }; }
              }
            }
            if (cur && sig !== cur.sig) { cur.s1 = (normal === 'x' ? GRID.z0 : GRID.x0) + b * GRID.cell; emitRun(normal, a, cur); cur = null; }
            if (sig && !cur) cur = { sig, ...info, s0: (normal === 'x' ? GRID.z0 : GRID.x0) + b * GRID.cell };
          }
        }
      };
      const emitRun = (normal, a, run) => {
        const line = (normal === 'x' ? GRID.x0 : GRID.z0) + (a + 1) * GRID.cell;
        const len = run.s1 - run.s0; if (len < 0.4) return;
        if (run.kind === 'rail') {
          // LED strip at the foot of the balustrade, 6 cm inboard
          const off = run.side * 0.1, c = (run.s0 + run.s1) / 2;
          strips.push(normal === 'x' ? [line + off, y + 0.03, c, Math.PI / 2, len] : [c, y + 0.03, line + off, 0, len]);
          // deck-level light pools along the rail for the dynamic pool (every ~7 m)
          const nn = Math.max(1, Math.round(len / 7));
          for (let k = 0; k < nn; k++) { const s = run.s0 + len * (k + 0.5) / nn; extLamps.push({ x: normal === 'x' ? line + run.side * 0.8 : s, y: y + 0.9, z: normal === 'x' ? s : line + run.side * 0.8, deck: d, ext: true, room: run.room?.id ?? 0, warm: true, low: true }); }
        } else {
          const r = run.room;
          const isBal = r.type === 'balcony';
          if (isBal) return;     // balconies: one downlight per balcony door (below)
          const sp = r.type === 'mooring' ? 8 : 6;
          const n = Math.max(1, Math.floor(len / sp));
          for (let k = 0; k < n; k++) {
            const s = run.s0 + len * (k + 0.5) / n;
            const off = run.side * 0.155;   // facade face
            const rot = normal === 'x' ? (run.side > 0 ? Math.PI / 2 : -Math.PI / 2) : (run.side > 0 ? 0 : Math.PI);
            const px = normal === 'x' ? line + off : s, pz = normal === 'x' ? s : line + off;
            // skip if a door is right here (sconce over a door looks wrong) — check edge type 2 nearby
            sconces.push([px, y + 2.25, pz, rot]);
            extLamps.push({ x: px + (normal === 'x' ? run.side * 0.6 : 0), y: y + 2.1, z: pz + (normal === 'z' ? run.side * 0.6 : 0), deck: d, ext: true, room: r.id, warm: true, bal: isBal });
          }
        }
      };
      scan('x'); scan('z');
      // balcony wall lights: beside each balcony door (latch side), on the exterior face
      for (const dr of P.doors) {
        if (dr.type !== 'balcony') continue;
        const ra = R[dr.rooms[0]], rb = R[dr.rooms[1]];
        const bal = ra?.type === 'balcony' ? ra : rb; if (!bal) continue;
        const side = dr.normal === 'x' ? Math.sign(bal.cx - dr.x) : Math.sign(bal.cz - dr.z);
        const off = side * 0.155, along = dr.w / 2 + 0.3;
        for (const sgn of [1]) {
          const px = dr.normal === 'x' ? dr.line + off : dr.x + sgn * along, pz = dr.normal === 'x' ? dr.z + sgn * along : dr.line + off;
          const rot = dr.normal === 'x' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
          sconces.push([px, y + 2.2, pz, rot]);
          extLamps.push({ x: px + (dr.normal === 'x' ? side * 0.7 : 0), y: y + 2.0, z: pz + (dr.normal === 'z' ? side * 0.7 : 0), deck: d, ext: true, room: bal.id, warm: true, bal: true });
        }
      }
      // bollards around pool decks and along sun-deck edges near pools; underwater pool lights
      for (const r of R) {
        if (!r || !r.pool) continue;
        const x0 = r.x0, x1 = r.x1, z0 = r.z0, z1 = r.z1;
        const per = [];
        for (let x = x0 + 1.2; x < x1 - 0.6; x += 3) per.push([x, z0 - 1.1], [x, z1 + 1.1]);
        for (let z = z0 + 1.2; z < z1 - 0.6; z += 3) per.push([x0 - 1.1, z], [x1 + 1.1, z]);
        for (const [x, z] of per) { const q = P.roomAt(x, z); if (q && q.exterior && !q.pool && !q.isVoid && !P.block[idx(Math.floor((x - GRID.x0) / GRID.cell), Math.floor((z - GRID.z0) / GRID.cell))]) { bollards.push([x, y, z]); extLamps.push({ x, y: y + 1.0, z, deck: d, ext: true, room: r.id, warm: true, low: true }); } }
        // underwater lights on the long walls
        const yy = y - r.pool * 0.55;
        for (let x = x0 + 1.5; x < x1 - 1; x += 2.5) { poolLamps.push([x, yy, z0 + 0.005, 0], [x, yy, z1 - 0.005, Math.PI]); }
        for (let z = z0 + 1.5; z < z1 - 1; z += 2.5) { poolLamps.push([x0 + 0.005, yy, z, Math.PI / 2], [x1 - 0.005, yy, z, -Math.PI / 2]); }
      }
      // soffit downlights: recessed discs in the slab above covered exterior walkways & balconies
      const above = plans[d + 1];
      if (above) for (const r of R) {
        if (!r || !r.exterior || r.isVoid || r.pool || !r.cells) continue;
        const bal = r.type === 'balcony';
        const pts = [];
        if (bal) pts.push([r.cx, r.cz]);
        else { const sp = 3.5; for (let x = r.x0 + sp / 2; x < r.x1; x += sp) for (let z = r.z0 + sp / 2; z < r.z1; z += sp) pts.push([x, z]); }
        for (const [x, z] of pts) {
          if (P.roomAt(x, z) !== r) continue;
          const a = above.roomAt(x, z);
          if (!a || a.isVoid) continue;              // open sky above
          downs.push([x, y, z]);
          if (!bal) extLamps.push({ x, y: y + 2.55, z, deck: d, ext: true, room: r.id, warm: true, down: true });
        }
      }
    }
    {
      const add = (geo, mat, list, setter, name) => {
        if (!list.length) return null;
        const m = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((it, k) => { setter(it); m.setMatrixAt(k, _m); });
        m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.name = name;
        m.castShadow = false; m.receiveShadow = false;
        (world.extRoot || world.root).add(m); return m;
      };
      add(stripG, strip, strips, ([x, yy, z, rot, len]) => { _p.set(x, yy, z); _q.setFromAxisAngle(_up, rot); _s.set(len - 0.1, 1, 1); _m.compose(_p, _q, _s); }, 'lt-strip');
      add(washG, washM, sconces, ([x, yy, z, rot]) => { _p.set(x, yy + 0.02, z); _q.setFromAxisAngle(_up, rot); _s.set(1, 1, 1); _m.compose(_p, _q, _s); }, 'lt-wash');
      add(splashG, splashM, sconces, ([x, yy, z, rot]) => { _p.set(x + Math.sin(rot) * 0.9, yy - 2.2 + 0.012, z + Math.cos(rot) * 0.9); _q.identity(); _s.set(1, 1, 1); _m.compose(_p, _q, _s); }, 'lt-splash');
      add(splashG, splashM, downs, ([x, y, z]) => { _p.set(x, y + 0.014, z); _q.identity(); _s.set(0.9, 1, 0.9); _m.compose(_p, _q, _s); }, 'lt-downSplash');
      add(sconceG, housing, sconces, ([x, yy, z, rot]) => { _p.set(x, yy, z); _q.setFromAxisAngle(_up, rot); _s.set(1, 1, 1); _m.compose(_p, _q, _s); }, 'lt-sconce');
      add(sconceLensG, lens, sconces, ([x, yy, z, rot]) => { _p.set(x, yy, z); _q.setFromAxisAngle(_up, rot); _s.set(1, 1, 1); _m.compose(_p, _q, _s); }, 'lt-sconceLens');
      add(bollardG, housing, bollards, ([x, y, z]) => { _p.set(x, y, z); _q.identity(); _s.set(1, 1, 1); _m.compose(_p, _q, _s); }, 'lt-bollard');
      add(bollardLensG, lens, bollards, ([x, y, z]) => { _p.set(x, y, z); _q.identity(); _s.set(1, 1, 1); _m.compose(_p, _q, _s); }, 'lt-bollardLens');
      add(downG, downM, downs, ([x, y, z]) => { _p.set(x, y + 3 - 0.322, z); _q.identity(); _s.set(1, 1, 1); _m.compose(_p, _q, _s); }, 'lt-soffit');
      add(poolLampG, poolM, poolLamps, ([x, yy, z, rot]) => { _p.set(x, yy, z); _q.setFromAxisAngle(_up, rot); _s.set(1, 1, 1); _m.compose(_p, _q, _s); }, 'lt-pool');
    }
  }
  // spatial buckets for exterior lamps per deck
  const extByDeck = [];
  for (const l of extLamps) (extByDeck[l.deck] || (extByDeck[l.deck] = [])).push(l);

  // ── modes ─────────────────────────────────────────────────────────────
  const blackoutDecks = new Set();
  const mode = { emergency: false, k: 1, kT: 1, red: 0, redT: 0, pulse: 0 };
  const tmpC = new THREE.Color(), redC = new THREE.Color(1.0, 0.16, 0.1), warmC = new THREE.Color(0xffd9b0), extC = new THREE.Color(0xffc890);

  // ── selection ─────────────────────────────────────────────────────────
  let selT = 0;
  const desired = [];
  const camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
  function viewDeck() {
    const p = game.player;
    if (p && !game.debugCam) return p.deck;
    return world.activeDeck || deckOfY(camPos.y + 0.5);
  }
  function select() {
    desired.length = 0;
    const d = viewDeck();
    if (!d) return;
    const night = glow.value > 0.05;
    const cand = [];
    const consider = (f, isExt, deck) => {
      const dx = f.x - camPos.x, dy = f.y - camPos.y, dz = f.z - camPos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > SEARCH) return;
      // in-front bias (lights behind the camera matter less, but still light the floor around us)
      const front = (dx * camDir.x + dy * camDir.y + dz * camDir.z) / (dist || 1);
      cand.push({ f, deck, ext: isExt, score: dist - front * 3.5 + (Math.abs(f.y - camPos.y) > 2.5 ? 6 : 0) });
    };
    for (let dd = d - 1; dd <= d + 1; dd++) {
      if (dd < 1 || dd > SHIP.deckCount) continue;
      if (blackoutDecks.has(dd) || mode.emergency) {} else {
        const fx = world.decks[dd]?.fixtures; if (fx) for (const f of fx) consider(f, false, dd);
      }
      if (night) { const el = extByDeck[dd]; if (el) for (const f of el) consider(f, true, dd); }
    }
    cand.sort((a, b) => a.score - b.score);
    // reject fixtures whose room isn't visible from the camera (walls block); keep a few nearest regardless if same room
    const camDeck = deckOfY(camPos.y + 0.3);
    let tests = 0;
    for (const c of cand) {
      if (desired.length >= pool.length) break;
      const f = c.f;
      // spread: skip a fixture right next to one already chosen (ceiling grids are 2.8–3.6 m; neighbours overlap)
      if (!c.ext && desired.some(o => o.deck === c.deck && Math.abs(o.f.x - f.x) < SPREAD && Math.abs(o.f.z - f.z) < SPREAD)) continue;
      if (c.deck === camDeck && tests < 60) {
        tests++;
        if (!world.lineClear(camDeck, camPos.x, camPos.z, f.x, f.z, { doorsBlock: true })) continue;
      } else if (c.deck !== camDeck && !c.ext) {
        // other deck: only through a void/atrium or stair; require the fixture's room to be open (no ceiling) —
        // approximate: accept only very near ones
        if (Math.hypot(f.x - camPos.x, f.z - camPos.z) > 6) continue;
      }
      desired.push(c);
    }
  }

  // ── update ────────────────────────────────────────────────────────────
  const FADE = 3.0;
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  let lastMin = -1e9, snapFrames = 0;
  game.addSystem({
    name: 'lights', order: 88,
    update(dt, realDt) {
      const rdt = realDt ?? dt;
      game.camera.getWorldPosition(camPos); game.camera.getWorldDirection(camDir);
      // camera cut / teleport: snap everything instead of fading (no visible pop-in after a cut)
      const cut = camPos.distanceTo(lastCam) > 4 || Math.abs(game.minutes - lastMin) > 10;
      lastCam.copy(camPos); lastMin = game.minutes;
      if (cut) snapFrames = 3;          // uNight is refreshed by the environment after systems → snap for a few frames
      const snap = snapFrames-- > 0;
      // exterior glow follows night
      const n = shared.uNight.value;   // (updated by env after systems; one frame of lag is invisible)
      const gT = Math.min(1, Math.max(0, (n - 0.25) / 0.35));
      glow.value = snap ? gT : glow.value + (gT - glow.value) * Math.min(1, rdt * 1.5);

      // interior factor & tint
      const d = viewDeck();
      mode.kT = blackoutDecks.has(d) ? 0.08 : mode.emergency ? 0.32 : 1;
      mode.redT = mode.emergency ? 1 : 0;
      mode.k = snap ? mode.kT : mode.k + (mode.kT - mode.k) * Math.min(1, rdt * (mode.kT < mode.k ? 6 : 1.6));
      mode.red += (mode.redT - mode.red) * Math.min(1, rdt * 3);
      mode.pulse += rdt;
      tmpC.copy(baseInt).lerp(tmpC.clone().setRGB(baseInt.r * 0.9, baseInt.g * 0.12, baseInt.b * 0.08), mode.red);
      shared.uIntLight.value.copy(tmpC).multiplyScalar(mode.k);
      if (fixtureMat && fixtureBase) {
        const fk = blackoutDecks.has(d) ? 0.04 : 1;
        fixtureMat.color.copy(fixtureBase).lerp(new THREE.Color(1.8, 0.12, 0.08), mode.red).multiplyScalar(Math.max(fk, mode.k));
      }

      // pick targets at 6 Hz
      selT -= rdt;
      if (selT <= 0 || cut) { selT = 0.16; select(); }
      if (cut) for (const s of pool) { s.fix = null; s.light.intensity = 0; }
      // slots: fade out those no longer desired, assign free slots
      const want = new Set(desired.map(c => c.f));
      for (const s of pool) if (s.fix && !want.has(s.fix)) s.leaving = true; else if (s.fix) s.leaving = false;
      for (const c of desired) {
        if (pool.some(s => s.fix === c.f)) continue;
        const free = pool.find(s => !s.fix);
        if (!free) break;
        free.fix = c.f; free.ext = c.ext; free.k = cut ? 1 : 0; free.leaving = false;
        free.light.position.set(c.f.x, c.f.y + 0.2, c.f.z);
        free.light.target.position.set(c.f.x, c.f.y - 3, c.f.z);
        free.light.angle = c.ext ? 1.25 : 1.2;
      }
      const em = mode.emergency;
      const pulse = em ? 0.75 + 0.25 * Math.sin(mode.pulse * Math.PI) : 1;
      for (const s of pool) {
        if (!s.fix) { if (s.light.intensity !== 0) s.light.intensity = 0; continue; }
        s.k += (s.leaving ? -1 : 1) * rdt * FADE;
        if (s.k <= 0) { s.k = 0; s.fix = null; s.light.intensity = 0; continue; }
        if (s.k > 1) s.k = 1;
        const e = s.k * s.k * (3 - 2 * s.k);
        if (s.ext) {
          s.light.color.copy(extC);
          s.light.intensity = BASE_I * (s.fix.low ? 0.5 : 1.1) * e * glow.value;
          s.light.distance = s.fix.low ? 5 : 9;
        } else {
          const blk = blackoutDecks.has(d) ? 0 : 1;
          s.light.color.copy(s.fix.warm === false ? tmpC.set(0xe8efff) : warmC).lerp(redC, mode.red);
          s.light.intensity = BASE_I * (s.fix.big ? 1.15 : 1) * e * blk * (em ? 0.45 * pulse : 1) * (0.6 + 0.4 * mode.k);
          s.light.distance = s.fix.big ? RANGE + 1 : RANGE;
        }
      }
    },
  });

  const api = game.lights = {
    pool, glow, extLamps,
    get emergency() { return mode.emergency; },
    get count() { return pool.length; },
    setEmergency(b) { mode.emergency = !!b; bus?.emit('lights:emergency', { on: mode.emergency }); },
    blackout(deck, b = true) { if (b) blackoutDecks.add(deck); else blackoutDecks.delete(deck); bus?.emit('lights:blackout', { deck, on: !!b }); },
    isBlackout: (deck) => blackoutDecks.has(deck),
    setBase(c) { baseInt.copy(c); },
    setCount(n) { buildPool(Math.max(0, n | 0)); api.pool = pool; },
  };
  return api;
}
