// HALCYON TIDE — third-person over-the-shoulder camera with grid-based collision.
//
// game.cameraRig: { yaw, pitch, distance, mode ('third'|'first'), shoulder (+1 right / -1 left), sensitivity,
//   snap(yaw?), shake(amount), kick(amount), setMode(m), fovBase, enabled }
// Yaw convention matches the player: forward = (sin yaw, cos yaw). Pitch > 0 looks down.
// Collision / tight spaces (QA #14): for each frame a set of candidate booms is evaluated — the straight boom over
// the user's shoulder, then yaw swings of ±0.3…±0.9 rad, then the same on the other shoulder. Each boom is
// ray-marched over the deck grid edges (walls, facades, closed doors; 3 parallel rays) and sampled against
// furniture volumes (world item grid + FDEF heights, so a wardrobe/bath pod blocks but a bed below the camera
// doesn't). Swings are normally capped at ±0.9 rad so the view stays close to where the player looks; ±1.2/±1.45 are tried only when no narrow swing reaches half the boom (back to a wall). The candidate with the best reach-vs-swing score wins (with hysteresis); swing angle and shoulder
// side are smoothed and the smoothed boom is re-validated, so the camera swings round obstructions before it
// pulls in. In small rooms (< ~30 m², lift cars, balconies; partially in corridors) an "interior" framing blends
// in: shorter boom, raised ~0.4 m above the head (capped by room.ceilH / lift-car roof) looking slightly down,
// wider FOV. In low interiors (ceiling < 4.2 m) the camera never drops below 1.3 m above the floor. NPCs whose
// body is within ~0.55 m of the camera are culled via game.chars.set(id,{alpha:0}) and restored afterwards.
// When game.debugCam is true the rig never touches the camera.
import * as THREE from 'three';
import { GRID, deckY, idx, toI, toJ } from '../core/config.js';
import { FDEF } from '../world/furnitureDefs.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (k, dt) => 1 - Math.exp(-k * dt);
// boom swing offsets (radians) tried in order when the straight boom is blocked
const SWING = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9];
const SWING_WIDE = [1.2, -1.2, 1.45, -1.45];
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

export const CAM_TUNING = {
  dist: 3.2, height: 1.55, shoulder: 0.45, fov: 62,
  aimDist: 1.6, aimFov: 50, aimShoulder: 0.55, aimHeight: 1.5,
  sprintFovKick: 6, crouchHeight: 1.05, swimHeight: 0.55, seatedHeight: 1.15, lieHeight: 0.85,
  pitchMin: -1.15, pitchMax: 1.2,       // up / down (radians)
  sens: 0.0022, padYaw: 3.2, padPitch: 2.2,
  wallMargin: 0.24, ceilMargin: 0.16, floorMargin: 0.18,
  hideDist: 0.55,
  intDist: 1.85, intRaise: 0.42, indoorMinH: 1.5,   // interior framing: boom length, raise above the head, min camera height
};

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.T = CAM_TUNING;
    this.yaw = 0; this.pitch = 0.12;
    this.mode = 'third';
    this.shoulder = 1;
    this.shoulderS = 1;
    this.distance = this.T.dist;     // current (smoothed, collision-limited) boom length
    this.distWant = this.T.dist;
    this.zoom = 1;                   // user wheel zoom multiplier
    this.aimK = 0;                   // 0..1 aim blend
    this.fov = this.T.fov;
    this.pivot = new THREE.Vector3();
    this.pivotV = new THREE.Vector3();
    this.heightS = this.T.height;
    this.shakeA = 0; this.kickA = 0; this.kickV = 0;
    this.enabled = true;
    this.charHidden = false;
    this._snap = true;
    this._idle = 0;
    this.lastHit = 0;
    this.camPos = new THREE.Vector3();
    this.lookDir = new THREE.Vector3(0, 0, 1);
    this.intK = 0; this.frameK = 0; this.swingS = 0; this.sideS = 1; this.compS = 0; this.fovComp = 0;
    this._cand = null; this._vf = new THREE.Vector3(); this.camS = new THREE.Vector3(NaN, NaN, NaN); this._faded = new Set();
  }

  get sensitivity() { return this.game.input?.sensitivity ?? 1; }
  snap(yaw) { if (yaw != null) this.yaw = yaw; this._snap = true; }
  shake(a) { this.shakeA = Math.min(1, this.shakeA + a); }
  kick(a) { this.kickV -= a * 6; }
  setMode(m) { this.mode = m; this._snap = true; }

  // ── grid ray march: fraction t∈[0,1] of the first blocking edge from (x0,z0) to (x1,z1) on deck d ──
  rayGrid(d, x0, z0, x1, z1) {
    const w = this.game.world, p = w.plans[d];
    if (!p) return 1;
    let i = toI(x0), j = toJ(z0); const ie = toI(x1), je = toJ(z1);
    const dx = x1 - x0, dz = z1 - z0;
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 1;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = dx !== 0 ? Math.abs(GRID.cell / dx) : Infinity, tDZ = dz !== 0 ? Math.abs(GRID.cell / dz) : Infinity;
    let tMX = dx !== 0 ? ((dx > 0 ? GRID.x0 + (i + 1) * GRID.cell : GRID.x0 + i * GRID.cell) - x0) / dx : Infinity;
    let tMZ = dz !== 0 ? ((dz > 0 ? GRID.z0 + (j + 1) * GRID.cell : GRID.z0 + j * GRID.cell) - z0) / dz : Infinity;
    let guard = 0;
    while ((i !== ie || j !== je) && guard++ < 200) {
      if (tMX < tMZ) {
        if (tMX > 1) break;
        const ei = stepX > 0 ? i : i - 1;
        if (ei < 0 || ei >= GRID.nx - 1 || j < 0 || j >= GRID.nz) return tMX;
        const k = idx(ei, j);
        if (this._edgeBlocks(w, p, d, p.ex[k], p.dx[k])) return tMX;
        i += stepX; tMX += tDX;
      } else {
        if (tMZ > 1) break;
        const ej = stepZ > 0 ? j : j - 1;
        if (ej < 0 || ej >= GRID.nz - 1 || i < 0 || i >= GRID.nx) return tMZ;
        const k = idx(i, ej);
        if (this._edgeBlocks(w, p, d, p.ez[k], p.dz[k])) return tMZ;
        j += stepZ; tMZ += tDZ;
      }
    }
    return 1;
  }
  _edgeBlocks(w, p, d, t, doorId) {
    if (t === 1 || t === 4) return true;
    if (t === 2) { const s = w.doorState.get(w.doorKey(d, doorId)); return !s || s.open < 0.85; }
    return false;
  }

  // ceiling (absolute y) above (x,z) for an actor on deck d; Infinity if open sky
  ceilingAt(d, x, z) {
    const w = this.game.world;
    const r = w.roomAt(d, x, z);
    let c = Infinity;
    if (r && r.car) {
      // lift car: its own ceiling (2.32 m) moves with the car
      const car = this.game.elevators?.car?.(r.car);
      if (car && Number.isFinite(car.y)) return car.y + 2.3;
    }
    if (r && !r.isVoid) {
      if (r.ramp) {
        // stair lanes repeat every two decks in the same direction: the soffit of the flight above in this lane
        // is ~5.85 m over the treads; cap by the deck two above when there is no flight (top of the core)
        c = w.floorY(d, x, z) + 5.6;
        const r2 = w.roomAt(d + 2, x, z);
        if (!r2 || !r2.ramp) c = Math.min(c, deckY(d + 2) - 0.15);
        return c;
      }
      if (!r.exterior && r.ceilH) c = deckY(d) + r.ceilH;
    }
    // slab of the deck above (covers exterior promenades/balconies under overhangs)
    if (d < 17) {
      const ra = w.roomAt(d + 1, x, z);
      if (ra && !ra.isVoid && !(ra.ramp)) c = Math.min(c, deckY(d + 1) - 0.12);
    }
    return c;
  }
  floorAt(d, x, z) {
    const w = this.game.world;
    const r = w.roomAt(d, x, z);
    if (!r) return -Infinity;
    if (r.isVoid) return deckY(d) - 30;
    if (r.car) { const car = this.game.elevators?.car?.(r.car); if (car && Number.isFinite(car.y)) return car.y; }
    return w.floorY(d, x, z) + (r.pool ? r.pool : 0);
  }

  update(dt, realDt) {
    const g = this.game;
    const p = g.player; if (!p) return;
    const input = g.input;
    const T = this.T;
    const dtr = Math.min(realDt || dt, 0.1);
    // ── look input ──────────────────────────────────────────────────────
    let looked = false;
    if (input && input.context === 'play' && !g.paused) {
      const s = T.sens * this.sensitivity * (this.aimK > 0.5 ? 0.6 : 1);
      if (input.mouse.dx || input.mouse.dy) { looked = true; }
      this.yaw -= input.mouse.dx * s;
      this.pitch += input.mouse.dy * s * (input.invertY ? -1 : 1);
      const lx = input.axis('lookX'), ly = input.axis('lookY');
      if (lx || ly) {
        looked = true;
        const ps = input.padSensitivity * (this.aimK > 0.5 ? 0.55 : 1);
        // slight response curve for fine aim
        this.yaw -= Math.sign(lx) * lx * lx * T.padYaw * ps * dtr;
        this.pitch += Math.sign(ly) * ly * ly * T.padPitch * ps * dtr;
      }
      if (input.actionPressed('CameraSwap')) this.setMode(this.mode === 'third' ? 'first' : 'third');
      if (input.actionPressed('ShoulderSwap')) this.shoulder = -this.shoulder;
      if (input.mouse.wheel && this.mode === 'third') this.zoom = clamp(this.zoom + input.mouse.wheel * 0.12, 0.55, 1.45);
    }
    // gentle auto-follow behind the player for gamepad when moving and not looking
    this._idle = looked ? 0 : this._idle + dtr;
    if (input && input.lastDevice === 'pad' && this._idle > 1.2 && p.speed > 1.5 && this.mode === 'third' && p.state === 'free') {
      const diff = wrapPi(p.yaw - this.yaw);
      if (Math.abs(diff) < 2.2) this.yaw += diff * damp(0.9, dtr);
    }
    this.yaw = wrapPi(this.yaw);
    this.pitch = clamp(this.pitch, T.pitchMin, T.pitchMax);
    p.camYaw = this.yaw;
    p.aimPitch = -this.pitch;

    if (g.debugCam || !this.enabled) { this._snap = true; this._setCharVisible(true); if (this._faded.size) this._fadeNear(p.deck, null); return; }

    // ── targets ─────────────────────────────────────────────────────────
    const aiming = p.aiming;
    this.aimK += ((aiming ? 1 : 0) - this.aimK) * damp(aiming ? 12 : 8, dtr);
    const seat = p.seat;
    let hTarget = p.inWater ? T.swimHeight : p.crouch ? T.crouchHeight : seat ? (seat.pose === 'lie' ? T.lieHeight : T.seatedHeight) - (seat.h || 0.45) + 0.0 : T.height;
    if (seat) hTarget += 0.0;
    hTarget += (T.aimHeight - T.height) * this.aimK;
    this.heightS += (hTarget - this.heightS) * damp(7, dtr);
    this.shoulderS += (this.shoulder - this.shoulderS) * damp(10, dtr);

    // pivot follow: tight in xz (no lag sway), critically damped in y (smooths stairs/jumps)
    const tx = p.x, tz = p.z, ty = p.y + this.heightS;
    if (this._snap) {
      this.pivot.set(tx, ty, tz); this.pivotV.set(0, 0, 0);
      this.distance = T.dist * this.zoom;
    } else {
      const wxz = 30;  // critically damped spring stiffness (ω)
      const wy = p.state === 'elevator' ? 30 : 12;
      for (const [axis, om] of [['x', wxz], ['z', wxz], ['y', wy]]) {
        const x = this.pivot[axis], v = this.pivotV[axis], target = axis === 'x' ? tx : axis === 'z' ? tz : ty;
        // exact critically damped step
        const e = x - target, k = Math.exp(-om * dtr);
        const nx = target + (e + (v + om * e) * dtr) * k;
        const nv = (v - om * (v + om * e) * dtr) * k;
        this.pivot[axis] = nx; this.pivotV[axis] = nv;
      }
      // never let the pivot lag more than a little (teleports, elevators)
      const lag = Math.hypot(this.pivot.x - tx, this.pivot.z - tz);
      if (lag > 0.6) { const f = 0.6 / lag; this.pivot.x = tx + (this.pivot.x - tx) * f; this.pivot.z = tz + (this.pivot.z - tz) * f; }
      if (Math.abs(this.pivot.y - ty) > 1.2) this.pivot.y = ty + Math.sign(this.pivot.y - ty) * 1.2;
    }

    const cam = g.camera;
    // head bob (subtle; first person a little stronger)
    let bob = 0;
    if (p.onGround && p.speed > 0.4 && !p.inWater && !seat) {
      const amp = (this.mode === 'first' ? 0.035 : 0.012) * clamp(p.speed / 3.3, 0, 1.6);
      bob = Math.abs(Math.sin(p.stepPhase * TAU)) * amp - amp * 0.5;
    }
    // landing kick spring
    this.kickV += (-this.kickA * 120 - this.kickV * 18) * dtr; this.kickA += this.kickV * dtr;
    const shake = this.shakeA * this.shakeA; this.shakeA = Math.max(0, this.shakeA - dtr * 1.8);
    const t = performance.now() * 0.001;
    const shX = shake * 0.05 * Math.sin(t * 37.1), shY = shake * 0.05 * Math.sin(t * 41.7 + 1);

    const yaw = this.yaw, pitch = this.pitch;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    let fx = Math.sin(yaw) * cp, fy = -sp, fz = Math.cos(yaw) * cp;     // look direction (input)
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);                        // right
    const d = p.deck;

    // FOV
    let fov = T.fov + (T.aimFov - T.fov) * this.aimK;
    if (p.sprint && p.speed > 4.5) fov += T.sprintFovKick * clamp((p.speed - 4.5) / 1.5, 0, 1);
    fov += 9 * (this.fovComp || 0) * (1 - this.aimK);       // widen in cramped spaces (see more of the room)
    this.fov += (fov - this.fov) * damp(6, dtr);

    if (this.mode === 'first' && !seat) {
      // first person: eye at the head, slightly forward
      const ey = p.y + (p.inWater ? 0.35 : p.crouch ? 1.1 : 1.62) + bob + this.kickA;
      const ex = p.x + Math.sin(p.yaw) * 0.12, ez = p.z + Math.cos(p.yaw) * 0.12;
      cam.position.set(ex + shX, ey + shY, ez);
      this._look(cam, fx, fy, fz);
      this._setCharVisible(false);
      if (this._faded.size) this._fadeNear(d, null);
    } else {
      this._boom(dtr, cam, p, d, yaw, pitch, fx, fy, fz, rx, rz, bob, shX, shY, seat);
      fx = this._vf.x; fy = this._vf.y; fz = this._vf.z;
    }
    this._snap = false;
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.camPos.copy(cam.position);
    this.lookDir.set(fx, fy, fz);
    // shadow focus & streaming
    if (!this._focus) this._focus = new THREE.Vector3();
    g.focus = this._focus.set(p.x, p.y, p.z);
    if (g.world.activeDeck !== p.deck) g.world.setActiveDeck(p.deck);
  }

  // ── furniture: does an item's solid volume contain (x, y, z)? (tall pieces only matter above their top) ──
  _itemAt(d, x, z, y, pad) {
    const map = this.game.world.itemGrid?.[d]; if (!map) return false;
    const a = Math.floor((x - GRID.x0) / 4), b = Math.floor((z - GRID.z0) / 4);
    const list = map.get(a * 1000 + b); if (!list) return false;
    const base = deckY(d);
    for (const it of list) {
      if (it.hidden || !it.hx) continue;
      const top = base + (it.y || 0) + (FDEF[it.t]?.h ?? 1.0);
      if (y > top + 0.12) continue;
      if (Math.abs(x - it.x) < it.hx + pad && Math.abs(z - it.z) < it.hz + pad) return true;
    }
    return false;
  }

  // Free horizontal boom length from shoulder point (sx,sz) along horizontal unit dir (bx,bz), up to wantH.
  // yAt(h) gives the camera height at horizontal distance h (furniture tops are tested against it).
  _reach(d, sx, sz, bx, bz, wantH, yAt) {
    const T = this.T;
    let tw = this.rayGrid(d, sx, sz, sx + bx * wantH, sz + bz * wantH);
    // thick boom: two parallel rays so the camera doesn't thread narrow doorways / door jambs
    const px = -bz * 0.2, pz = bx * 0.2;
    for (const sg of [1, -1]) {
      const ox = sx + px * sg, oz = sz + pz * sg;
      if (this.rayGrid(d, sx, sz, ox, oz) < 1) continue;
      tw = Math.min(tw, this.rayGrid(d, ox, oz, ox + bx * wantH, oz + bz * wantH));
    }
    let H = tw < 1 ? Math.max(0, tw * wantH - T.wallMargin) : wantH;
    // furniture (wardrobes, bath pods, bunks, shelving, slot machines…) sampled along the boom
    for (let h = 0.3; h < H; h += 0.15) {
      if (this._itemAt(d, sx + bx * h, sz + bz * h, yAt(h), 0.14)) { H = Math.max(0, h - 0.18); break; }
    }
    return H;
  }

  // 0..1 how boxed-in a camera point is: fraction of 8 probe points (0.45 m out) blocked by walls or furniture
  _crowd(d, x, z, y) {
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, px = x + Math.cos(a) * 0.45, pz = z + Math.sin(a) * 0.45;
      if (this.rayGrid(d, x, z, px, pz) < 1 || this._itemAt(d, px, pz, y, 0)) n++;
    }
    return n / 8;
  }

  // Smallness of the space around the player: 0 open … 1 cabin / lift car / balcony.
  _tightness(p) {
    const r = p.room;
    if (p.state === 'elevator') return 1;
    if (!r || r.isVoid) return 0;
    if (r.car) return 1;
    if (r.ramp) return 0.35;
    const area = r.area ?? ((r.x1 - r.x0) * (r.z1 - r.z0));
    let k = area < 30 ? 1 : area < 55 ? 1 - (area - 30) / 25 : 0;
    // narrow corridors get a little of the interior framing too (shorter, higher boom)
    if (!r.exterior && Math.min(r.x1 - r.x0, r.z1 - r.z0) <= 3.2 && area >= 30) k = Math.max(k, 0.3);
    return k;
  }

  _boom(dtr, cam, p, d, yaw, pitch, fx, fy, fz, rx, rz, bob, shX, shY, seat) {
    const T = this.T, g = this.game;
    const piv = this.pivot;
    const hx = piv.x, hy = piv.y + bob + this.kickA, hz = piv.z;
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    const aimK = this.aimK;
    // interior framing blend (smoothed; aiming keeps the standard over-shoulder framing)
    const tight = this._tightness(p) * (1 - aimK * 0.6);
    this.intK += (tight - this.intK) * damp(this._snap ? 1e3 : 2.5, dtr);
    const intK = this.intK;
    // vertical limits around the player
    const flo = this.floorAt(d, hx, hz), ceil0 = this.ceilingAt(d, hx, hz);
    const roomH = ceil0 - flo;
    const indoorLow = Number.isFinite(roomH) && roomH < 4.2;
    // shoulder offset (lateral) and boom length targets
    let shBase = (T.shoulder + (T.aimShoulder - T.shoulder) * aimK) * (1 - 0.35 * Math.abs(sp));
    shBase *= 1 - 0.18 * intK;
    const zoom = aimK > 0.5 ? 1 : this.zoom;
    const wantOut = (T.dist + (T.aimDist - T.dist) * aimK) * zoom * (pitch < 0 ? 1 - 0.35 * clamp(-pitch / 1.1, 0, 1) : 1);
    const wantIn = T.intDist * Math.min(1.15, zoom);
    const want = wantOut + (wantIn - wantOut) * intK;
    const cpS = Math.max(cp, 0.3);
    const wantH = want * (cp + (1 - cp) * intK * 0.7);
    // camera height model: orbit (exterior) blended with a fixed raise above the head (interiors look slightly down)
    const ceilM = (Number.isFinite(ceil0) ? ceil0 : 1e9) - T.ceilMargin;
    const raiseIn = clamp(ceilM - 0.06 - hy, 0, T.intRaise + 0.3 * this.compS);
    const minY = indoorLow ? Math.min(flo + T.indoorMinH + 0.15 * intK, hy - 0.05) : flo + T.floorMargin;
    // compressed boom (back to a wall): the camera rises over the head toward the ceiling instead of sitting in it
    const raiseC = clamp(ceilM - 0.04 - hy, 0, 0.55) * this.compS * this.compS;
    const yAt = (h) => clamp(Math.max(hy + (sp / cpS) * h * (1 - intK) + raiseIn * intK, minY) + raiseC, flo + T.floorMargin, ceilM);

    // ── candidate search: swing around obstructions before pulling in ──
    const userSide = this.shoulder;
    const evalCand = (off, side) => {
      // keep ~0.7 m between the camera and the wall on the shoulder side (narrow corridors: camera near centre line)
      const sgn = side >= 0 ? 1 : -1;
      let tl = this.rayGrid(d, hx, hz, hx + rx * sgn * 1.6, hz + rz * sgn * 1.6) * 1.6;
      for (let h = 0.2; h < tl; h += 0.1) if (this._itemAt(d, hx + rx * sgn * h, hz + rz * sgn * h, hy, 0.02)) { tl = h; break; }
      const sh = Math.max(Math.min(Math.abs(shBase * side), tl - 0.62), Math.min(0.1, Math.abs(shBase * side))) * sgn;
      let sx = hx + rx * sh, sz = hz + rz * sh;
      const ts = this.rayGrid(d, hx, hz, sx, sz);
      let shK = 1;
      if (ts < 1) { shK = Math.max(0, ts * Math.abs(sh) - T.wallMargin) / Math.max(1e-4, Math.abs(sh)); sx = hx + rx * sh * shK; sz = hz + rz * sh * shK; }
      const ya = yaw + off;
      const bx = -Math.sin(ya), bz = -Math.cos(ya);
      const H = this._reach(d, sx, sz, bx, bz, wantH, yAt);
      return { off, side, sx, sz, bx, bz, H, shK, ex: sx + bx * H, ez: sz + bz * H };
    };
    const maxOff = aimK > 0.5 ? 0.3 : 0.9;
    let best = null, bestS = -1e9;
    const prev = this._cand;
    const consider = (off, side, extra) => {
      const c = evalCand(off, side);
      const reach = Math.min(1, c.H / Math.max(0.01, wantH));
      // prefer: full reach, small swing, user's shoulder, previous choice (hysteresis)
      let sc = reach * 1.0 - Math.abs(off) * (0.34 + 0.25 * aimK) - extra - (side !== userSide ? 0.1 : 0) - (1 - c.shK) * 0.08;
      if (prev && prev.side === side && Math.abs(prev.off - off) < 1e-3) sc += 0.07;
      if (prev && prev.side === side) sc += 0.05;   // shoulder swaps need a clear win (they sweep across the head)
      if (off * side < 0) sc -= 0.015;  // swing behind the shoulder we're over
      // cramped: prefer the camera spot with more open space around it (a wardrobe beside the lens fills half the frame)
      if (reach < 0.999) sc -= this._crowd(d, c.ex, c.ez, yAt(c.H)) * 0.22;
      if (sc > bestS) { bestS = sc; best = c; best.reach = reach; }
      return reach;
    };
    outer: for (const side of [userSide, -userSide]) {
      for (const off of SWING) {
        if (Math.abs(off) > maxOff) continue;
        const reach = consider(off, side, 0);
        if (reach >= 0.999 && off === 0 && side === userSide) break outer;   // common case: unobstructed
      }
    }
    // second tier (back to a wall / corner): wide swings, only when the narrow ones can't reach half the boom
    if (best.reach < 0.5 && aimK < 0.5) for (const side of [userSide, -userSide]) for (const off of SWING_WIDE) consider(off, side, 0.05);
    // a wide swing only pays off if it gets a usable boom (≥ 0.9 m); otherwise stay straight and rise over the head
    if (Math.abs(best.off) > 0.95 && best.H < 0.9) { best = evalCand(0, userSide); best.reach = best.H / Math.max(0.01, wantH); }
    this._cand = { off: best.off, side: best.side };
    // smooth swing angle & shoulder side (exact candidate is re-validated below, so smoothing can't clip walls)
    const kSw = this._snap ? 1 : damp(3.2, dtr);
    this.swingS += wrapPi(best.off - this.swingS) * kSw;
    this.sideS += (best.side - this.sideS) * (this._snap ? 1 : damp(5, dtr));
    const cur = evalCand(this.swingS, this.sideS);
    let L = cur.H;
    // distance smoothing: pull in quickly (critically), ease out slowly; never beyond the free length
    if (this._snap) this.distance = L;
    else if (L < this.distance) this.distance += (L - this.distance) * damp(22, dtr);
    else this.distance += (L - this.distance) * damp(2.6, dtr);
    this.distance = Math.min(this.distance, L);
    this.lastHit = L < wantH - 0.05 ? 1 : 0;
    const H = this.distance;
    // compressed boom (still cramped after the swing): rise to look over the head instead of into the hair
    const comp = clamp(1 - H / Math.max(0.01, Math.min(wantH, 1.25)), 0, 1) * (1 - aimK * 0.7);
    this.compS += (comp - this.compS) * damp(this._snap ? 1e3 : 5, dtr);
    let cx = cur.sx + cur.bx * H, cz = cur.sz + cur.bz * H, cy = yAt(H);
    this.fovComp = Math.max(this.compS, intK * 0.85);
    // near-plane safety: push the camera sphere out of walls (only if that doesn't cross a wall from the shoulder)
    const pr = g.world.collide(d, cx, cz, 0.16, { ignoreItems: true });
    if (pr.hit) {
      if (this.rayGrid(d, cur.sx, cur.sz, pr.x, pr.z) >= 1) { cx = pr.x; cz = pr.z; }
      else { cx = cur.sx; cz = cur.sz; }
    }
    // final vertical clamp at the camera position
    let ceilF = Math.min(ceilM, this.ceilingAt(d, cx, cz) - T.ceilMargin);
    if (cy > ceilF) cy = ceilF;
    let flF = this.floorAt(d, cx, cz) + T.floorMargin;
    if (cy < flF) cy = Math.min(flF, ceilF);
    // position smoothing (no jitter): the camera eases toward the solved point; the raw point is used directly
    // only when the eased point would be behind a wall / inside furniture (pull-in must never lag into geometry)
    const S = this.camS;
    if (this._snap || !Number.isFinite(S.x) || Math.hypot(S.x - cx, S.z - cz) > 2.5 || Math.abs(S.y - cy) > 1.5) S.set(cx, cy, cz);
    else {
      // open spaces: rigid orbit (no lag on mouse look); tight/compressed booms: eased (collision changes are smooth)
      const wt = clamp(Math.max(intK, this.compS * 1.5, this.lastHit * 0.6), 0, 1) * (1 - aimK * 0.8);
      const kp = 1 - (1 - damp(9, dtr)) * wt;
      const nx = S.x + (cx - S.x) * kp, ny = S.y + (cy - S.y) * kp, nz = S.z + (cz - S.z) * kp;
      const ok = this.rayGrid(d, hx, hz, nx, nz) >= 1 && !this._itemAt(d, nx, nz, ny, 0.1)
        && g.world.collide(d, nx, nz, 0.12, { ignoreItems: true }).hit === false;
      if (ok) S.set(nx, ny, nz); else S.set(cx, cy, cz);
    }
    cx = S.x; cy = S.y; cz = S.z;
    ceilF = Math.min(ceilM, this.ceilingAt(d, cx, cz) - T.ceilMargin); if (cy > ceilF) cy = ceilF;
    cam.position.set(cx + rx * shX, cy + shY, cz + rz * shX);
    // hide the player character when the camera is inside/too close to the body
    const dh = Math.hypot(cx - p.x, cz - p.z);
    const tooClose = dh < 0.42 && cy > p.y - 0.1 && cy < p.y + 1.9;
    const lim = this.charHidden ? T.hideDist + 0.08 : T.hideDist;
    // 3D distance to the head: a camera raised over the head (looking down past it) keeps the character visible
    this._setCharVisible(!tooClose && Math.hypot(cx - hx, cy - (p.y + 1.62), cz - hz) > lim);
    // look at an aim point ahead of the head: keeps the crosshair target centred whatever the swing/raise
    // when the boom is swung round an obstruction or compressed, aim closer in front of the player so the
    // character stays in frame instead of drifting to the screen edge
    const swK = clamp(Math.abs(this.swingS) / 1.2, 0, 1);
    const aimD = aimK > 0.5 ? 30 : (12 - 6.5 * intK) * (1 - 0.45 * swK);
    const ax = hx + fx * aimD, ay = hy - 0.28 * intK * (1 - aimK) + fy * aimD, az = hz + fz * aimD;
    let lx = ax - cam.position.x, ly = ay - cam.position.y, lz = az - cam.position.z;
    const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
    // keep the character in frame: if the upper body (chest→head) falls outside a safe cone around the view
    // axis (swung/raised/compressed booms), rotate the view toward it by the excess angle
    // (the correction fraction is smoothed, never the look itself, so mouse look stays 1:1 with no lag)
    let kWant = 0, ux = 0, uy = 0, uz = 0;
    if (aimK < 0.5 && !this.charHidden) {
      const tx = p.x - cam.position.x, ty = p.y + 1.35 - cam.position.y, tz = p.z - cam.position.z;
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 0.25) {
        ux = tx / tl; uy = ty / tl; uz = tz / tl;
        const A = Math.acos(clamp(lx * ux + ly * uy + lz * uz, -1, 1));
        const vHalf = THREE.MathUtils.degToRad(this.fov) * 0.5, asp = cam.aspect || 16 / 9;
        const safe = Math.min(vHalf, Math.atan(Math.tan(vHalf) * asp)) * 0.72;
        // limited to ~20° and faded out when the boom is compressed (then the camera rises over the head and
        // keeps looking where the player looks — never a top-down shot of the character)
        if (A > safe) kWant = Math.min((A - safe) / A, 0.22 / A) * (1 - this.compS);
      }
    }
    this.frameK += (kWant - this.frameK) * (this._snap ? 1 : damp(6, dtr));
    if (this.frameK > 1e-3 && (ux || uy || uz)) {
      lx += (ux - lx) * this.frameK; ly += (uy - ly) * this.frameK; lz += (uz - lz) * this.frameK;
      const n = Math.hypot(lx, ly, lz) || 1; lx /= n; ly /= n; lz /= n;
    }
    this._vf.set(lx, ly, lz);
    this._look(cam, lx, ly, lz);
    this._fadeNear(d, cam.position);
  }

  // Fade out (cull) NPC characters whose body intersects the near plane / is within ~0.5 m of the camera.
  _fadeNear(d, c) {
    const g = this.game, chars = g.chars, npcs = g.npcs;
    const faded = this._faded;
    const now = new Set();
    if (c && chars && npcs?.query) {
      let list = null;
      try { list = npcs.query(d, c.x, c.z, 1.4); } catch { list = null; }
      if (list) for (const n of list) {
        if (n.charId == null || n.charId < 0) continue;
        const ny = n.y ?? deckY(d);
        if (c.y < ny - 0.2 || c.y > ny + 2.0) continue;
        if (Math.hypot(n.x - c.x, n.z - c.z) < 0.58) now.add(n.charId);
      }
    }
    for (const id of faded) if (!now.has(id)) { try { chars.set(id, { alpha: 1 }); } catch {} }
    for (const id of now) if (!faded.has(id)) { try { chars.set(id, { alpha: 0 }); } catch {} }
    this._faded = now;
  }

  _look(cam, fx, fy, fz) {
    cam.up.set(0, 1, 0);
    cam.lookAt(cam.position.x + fx, cam.position.y + fy, cam.position.z + fz);
  }
  _setCharVisible(v) {
    this.charHidden = !v;
    const p = this.game.player;
    if (p) p._camVisible = v;
  }
}

export function installCameraRig(game) {
  const rig = game.cameraRig = new CameraRig(game);
  // player render sync happens after the camera so visibility is current; chars renders at order 70 (update),
  // so we sync the player character in update (order 69) with last frame's visibility and again position-only here.
  game.addSystem({ name: 'playerRender', order: 69, update(dt) { game.player?.render(dt, game.player._camVisible !== false); } });
  game.addSystem({ name: 'cameraRig', order: 95, runWhilePaused: true, lateUpdate(dt, realDt) { rig.update(dt, realDt); } });
  return rig;
}
