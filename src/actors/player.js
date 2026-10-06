// HALCYON TIDE — the player: Mara Quill, former deck officer.
// Third-person character controller on the deck grid (collision via world.collide, floor via world.floorY),
// stairs (ramp rooms → deck switching), swimming, jumping, crouching, sitting/lying on furniture POIs,
// interactions (game.interact), footsteps, health/stamina, disguises.
//
// game.player contract (docs/ARCHITECTURE.md):
//   x,y,z,deck,yaw,vx,vz,speed, room, roomId, exterior, inWater, crouch, sprint, charId, appearance, disguise,
//   health, stamina, held, state ('free'|'elevator'|'seated'|'cutscene'|'dead'|'arrested'), elevator,
//   teleport(deck,x,z,yaw,{strict}) (snaps to the nearest walkable cell: never void/pool/shaft — strict: not in furniture either;
//   snapOnTeleport=false skips), snapWalkable(deck,x,z,strict) → {x,z,moved}, setAppearance(app), lockControls(bool), sitAt(poi), standUp(), damage(amount, source)
// extras: inventory, keycards (Set), money, cabin (no), homeCabin (cabin record), aiming, aimPitch, walkMode,
//   noise (0..1 loudness of movement for stealth), animOverride, playAnim(name, secs), wearDisguise(role),
//   removeDisguise(), hasAccess(access), seat (poi|null), stance, onGround, stepPhase.
import * as THREE from 'three';
import { deckY, SHIP, GRID } from '../core/config.js';
import { Rng } from '../core/util.js';
import { FLOOR } from '../world/plan.js';
import { letterCode } from '../core/input.js';
import { installCameraRig } from './cameraRig.js';
import { PlayerHud } from '../ui/playerHud.js';

export const PLAYER_TUNING = {
  walk: 1.45, jog: 3.3, sprint: 6.0, crouch: 1.1, swim: 1.3, swimFast: 2.1, aimMove: 2.0,
  accel: 11, decel: 13, sprintAccel: 6.5, airControl: 2.0,
  turnRate: 13, radius: 0.3, jumpH: 0.49, gravity: 20,
  staminaMax: 100, sprintDrain: 13, staminaRegen: 22,
  regenDelay: 8, regenRate: 5,
  stairSwitch: 1.5,
};

const FLOOR_SURFACE = (() => {
  const m = [];
  m[FLOOR.corridor] = 'carpet'; m[FLOOR.cabin] = 'carpet'; m[FLOOR.casino] = 'carpet'; m[FLOOR.theater] = 'carpet'; m[FLOOR.lounge] = 'carpet';
  m[FLOOR.teak] = 'teak'; m[FLOOR.marble] = 'marble'; m[FLOOR.tile] = 'tile'; m[FLOOR.bathtile] = 'tile'; m[FLOOR.pool] = 'tile';
  m[FLOOR.vinyl] = 'rubber'; m[FLOOR.steel] = 'steel'; m[FLOOR.deckpaint] = 'steel'; m[FLOOR.rubber] = 'rubber';
  m[FLOOR.parquet] = 'wood'; m[FLOOR.dance] = 'wood';
  return m;
})();
export function surfaceOf(room) {
  if (!room) return 'steel';
  if (room.ramp) return room.zone === 'crew' ? 'steel' : 'carpet';
  if (room.pool) return 'water';
  return FLOOR_SURFACE[room.floor] || (room.exterior ? 'teak' : 'carpet');
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// Mara Quill — original protagonist appearance
export function maraAppearance() {
  const rng = new Rng(91470);
  let ap;
  try { ap = makeAppearanceRef(rng, { role: 'player', sex: 'f' }); } catch { ap = null; }
  if (!ap) return null;
  ap.seed = 914700;
  ap.height = 1.72; ap.build = 0.97; ap.skin = 0xd6a47e; ap.face = 3; ap.gait = 0.35;
  ap.hair = { style: 'ponytail', color: 0x3a2417 };
  Object.assign(ap.outfit, {
    top: 'jacket', topColor: 0x262b31, top2: 0xe4dfd4, sleeve: 1, neck: 'collar', legs: 'trousers', bottom: 'trousers',
    bottomColor: 0x3b3f45, shoeColor: 0x2b1e16, sole: 0x161210, shoes: 'boots', hem: null, hat: 'none', belt: 0x1a1512,
  });
  ap.acc = { ...(ap.acc || {}) };
  return ap;
}
let makeAppearanceRef = null;

export class Player {
  constructor(game) {
    this.game = game;
    const T = this.T = PLAYER_TUNING;
    // contract fields
    this.x = 0; this.y = 0; this.z = 0; this.deck = 9; this.yaw = 0;
    this.vx = 0; this.vz = 0; this.vy = 0; this.speed = 0;
    this.room = null; this.roomId = 0; this.exterior = false; this.inWater = false;
    this.crouch = false; this.sprint = false; this.charId = -1; this.appearance = null; this.disguise = null;
    this.health = 100; this.stamina = T.staminaMax; this.held = 'none';
    this.state = 'free'; this.elevator = null; this.invisibleTo = null;
    // extras
    this.inventory = game.inventory || makeInventory();
    this.keycards = new Set();
    this.money = 250;
    this.cabin = null; this.homeCabin = null;
    this.aiming = false; this.aimPitch = 0; this.walkMode = false;
    this.noise = 0; this.animOverride = null; this._animT = 0;
    this.seat = null; this._standPos = null;
    this.stance = 'stand';
    this.onGround = true; this.jumpOff = 0;
    this.stepPhase = 0; this._stepDist = 0; this._stepFoot = 0;
    this.controlsLocked = false;
    this.exhausted = false;
    this.lastDamageT = -999; this.time = 0;
    this.headY = 1.6;
    this.camYaw = 0;           // camera yaw (written by the camera rig) — movement is camera-relative
    this.anim = 'idle';
    this._wantRaw = { x: 0, z: 0 };
  }

  // ── public API ────────────────────────────────────────────────────────
  // Nearest walkable spot on `deck` (not void / shaft / pool / outside the plan; strict: also not inside furniture).
  // Ramps (stairs) count as walkable. Returns {x, z, moved}.
  snapWalkable(deck, x, z, strict = true) {
    const w = this.game.world, plan = w.plans[deck];
    if (!plan) return { x, z, moved: false };
    const NX = GRID.nx, NZ = GRID.nz, cell = GRID.cell;
    const good = (i, j) => {
      if (i < 1 || j < 1 || i >= NX - 1 || j >= NZ - 1) return false;
      const k = j * NX + i, r = plan.rooms[plan.room[k]];
      if (!r || r.isVoid || r.type === 'shaft' || r.pool) return false;
      if (strict && plan.block && plan.block[k] && !r.ramp) return false;
      return true;
    };
    const ci = Math.floor((x - GRID.x0) / cell), cj = Math.floor((z - GRID.z0) / cell);
    if (good(ci, cj)) return { x, z, moved: false };
    // prefer the nav system (respects walls between rooms), then a wider ring search
    const nav = this.game.npcs?.nav;
    try { const q = nav?.nearestPoint(deck, x, z, 0xff, 8); if (q && good(Math.floor((q.x - GRID.x0) / cell), Math.floor((q.z - GRID.z0) / cell))) return { x: q.x, z: q.z, moved: true }; } catch {}
    for (let r = 1; r <= 60; r++) {
      let best = null, bd = 1e9;
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !good(ci + di, cj + dj)) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; best = [ci + di, cj + dj]; }
      }
      if (best) {
        const bx = GRID.x0 + (best[0] + 0.5) * cell, bz = GRID.z0 + (best[1] + 0.5) * cell;
        try { const q = nav?.nearestPoint(deck, bx, bz, 0xff, 3); if (q && good(Math.floor((q.x - GRID.x0) / cell), Math.floor((q.z - GRID.z0) / cell))) return { x: q.x, z: q.z, moved: true }; } catch {}
        return { x: bx, z: bz, moved: true };
      }
    }
    return { x, z, moved: false };
  }
  // opts.strict: also step out of furniture footprints (revive / arrest / load use it)
  teleport(deck, x, z, yaw = this.yaw, opts = {}) {
    const w = this.game.world;
    if (this.snapOnTeleport !== false) { const s = this.snapWalkable(deck, x, z, !!opts.strict); x = s.x; z = s.z; }
    this.deck = deck; this.x = x; this.z = z; this.yaw = yaw;
    this.vx = this.vz = this.vy = 0; this.speed = 0; this.jumpOff = 0; this.onGround = true;
    this._updateRoom(true);
    this.y = this._groundTarget();
    w.setActiveDeck(deck);
    this.game.cameraRig?.snap(yaw);
    this.game.bus.emit('player:teleport', { deck, x, z });
  }
  setAppearance(app) {
    this.appearance = app;
    if (this.charId >= 0) this.game.chars.setAppearance(this.charId, app);
    this.disguise = app && app.role && app.role !== 'player' ? app.role : null;
    this.game.bus.emit('player:appearance', { disguise: this.disguise });
  }
  wearDisguise(role, opts = {}) {
    if (!makeAppearanceRef) return;
    const base = this.baseAppearance;
    const ap = makeAppearanceRef(new Rng(4242 + role.length * 31), { role, sex: 'f', ...opts });
    ap.skin = base.skin; ap.face = base.face; ap.height = base.height; ap.build = base.build; ap.seed = base.seed;
    if (ap.hair.style !== 'bun') ap.hair = { ...base.hair, style: ap.hair.style === 'long' ? 'bun' : base.hair.style };
    ap.hair.color = base.hair.color;
    this.setAppearance(ap);
  }
  removeDisguise() { this.setAppearance(this.baseAppearance); }
  lockControls(b) { this.controlsLocked = !!b; if (b) { this.sprint = false; } }
  hasAccess(access) {
    if (!access || access === 'none') return true;
    if (this.keycards.has(access)) return true;
    if (access.startsWith('cabin:') && this.keycards.has('master')) return true;
    return false;
  }
  playAnim(name, secs = 1.5) { this.animOverride = name; this._animT = secs; }

  sitAt(poi) {
    if (!poi || (poi.taken && poi.taken !== 'player')) return false;
    this._standPos = { x: this.x, z: this.z, deck: this.deck };
    poi.taken = 'player';
    this.seat = poi; this.state = 'seated'; this._seatT = 0;
    this.vx = this.vz = 0; this.speed = 0; this.crouch = false; this.aiming = false;
    this.x = poi.x; this.z = poi.z; this.yaw = poi.rot;
    this.y = deckY(this.deck) + (poi.h || 0.45);
    this.game.bus.emit('player:sit', { poi, pose: poi.pose });
    return true;
  }
  standUp() {
    if (!this.seat) { if (this.state === 'seated') this.state = 'free'; return; }
    if (this.seat.taken === 'player') this.seat.taken = null;
    const sp = this._standPos;
    this.seat = null; this.state = 'free';
    if (sp) { this.x = sp.x; this.z = sp.z; }
    this.y = this._groundTarget();
    this.game.bus.emit('player:stand', {});
  }
  damage(amount, source = null) {
    if (this.state === 'dead' || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.lastDamageT = this.time;
    this.game.bus.emit('player:damage', { amount, source, health: this.health });
    this.game.cameraRig?.shake(Math.min(1, amount / 30));
    if (this.health <= 0) {
      if (this.seat) this.standUp();
      this.state = 'dead';
      this.game.bus.emit('player:dead', { source });
    } else if (amount >= 10 && this.state === 'free') this.playAnim('hit_react', 0.45);
  }
  heal(n) { this.health = Math.min(100, this.health + n); }
  revive(deck, x, z) { this.health = 100; this.state = 'free'; this.animOverride = null; this._animT = 0; this.controlsLocked = false; if (deck != null) this.teleport(deck, x, z, this.yaw, { strict: true }); }

  // ── internals ─────────────────────────────────────────────────────────
  _groundTarget() {
    const w = this.game.world, r = this.room;
    if (r && r.pool) return deckY(this.deck) + (r.waterY ?? -0.15) + (this.speed > 0.3 ? 0.05 : 0.02);
    return w.floorY(this.deck, this.x, this.z);
  }

  _updateRoom(silent = false) {
    const w = this.game.world;
    const rid = w.roomId(this.deck, this.x, this.z);
    const r = w.plans[this.deck]?.rooms[rid] || null;
    const changed = rid !== this.roomId || r !== this.room;
    this.room = r; this.roomId = rid;
    this.exterior = !!(r && r.exterior);
    this.inWater = !!(r && r.pool);
    if (changed && !silent) this.game.bus.emit('player:enterRoom', { room: r, deck: this.deck });
  }

  _setDeck(d) {
    if (d === this.deck || d < 1 || d > SHIP.deckCount) return;
    const prev = this.deck;
    this.deck = d;
    this.game.world.setActiveDeck(d);
    this._updateRoom();
    this.game.bus.emit('player:deck', { deck: d, prev });
  }

  update(dt) {
    if (dt <= 0) return;
    this.time += dt;
    const g = this.game, input = g.input, w = g.world, T = this.T;
    if (this._animT > 0) { this._animT -= dt; if (this._animT <= 0) this.animOverride = null; }

    // regen
    if (this.state !== 'dead' && this.health < 100 && this.time - this.lastDamageT > T.regenDelay) this.health = Math.min(100, this.health + T.regenRate * dt);

    const canControl = !this.controlsLocked && (this.state === 'free' || this.state === 'elevator') && input && input.context === 'play';
    const mv = canControl ? input.move() : { x: 0, y: 0, mag: 0 };

    // seated: locked in place, stand on interact/move (interaction handles E)
    if (this.state === 'seated') {
      this._seatT = (this._seatT || 0) + dt;
      if (!this.controlsLocked && input && input.context === 'play' && this._seatT > 0.6 && (input.actionPressed('Jump') || input.move().mag > 0.6)) this.standUp();
      this.speed = 0; this.vx = this.vz = 0;
      this.noise = 0;
      this._updateRoom();
      return;
    }
    if (this.state === 'dead' || this.state === 'arrested' || this.state === 'cutscene') {
      this.vx *= 1 - damp(8, dt); this.vz *= 1 - damp(8, dt); this.speed = Math.hypot(this.vx, this.vz);
      this._updateRoom();
      return;
    }

    // toggles
    if (canControl) {
      if (input.actionPressed('WalkToggle')) this.walkMode = !this.walkMode;
      if (input.actionPressed('Crouch') && !this.inWater) this.crouch = !this.crouch;
      if (input.actionPressed('Jump') && this.crouch) { this.crouch = false; input._pressed.delete('Space'); }
    }
    this.aiming = canControl && input.action('Aim') && !this.inWater;
    const wantSprint = canControl && input.action('Sprint') && mv.mag > 0.3 && !this.aiming;
    if (wantSprint && this.crouch) this.crouch = false;

    // stamina
    if (this.stamina < 5) this.exhausted = true;
    if (this.exhausted && this.stamina > 30) this.exhausted = false;
    this.sprint = wantSprint && !this.exhausted && this.state === 'free';
    if (this.sprint && this.speed > 1) this.stamina = Math.max(0, this.stamina - T.sprintDrain * dt);
    else this.stamina = Math.min(T.staminaMax, this.stamina + T.staminaRegen * dt * (this.speed < 0.5 ? 1.3 : 1));

    // target speed
    const analog = input && (input.lastDevice === 'pad' || input.lastDevice === 'touch');   // stick / touch joystick
    const padWalk = analog && mv.mag < 0.55;
    let vmax;
    if (this.inWater) vmax = this.sprint ? T.swimFast : T.swim;
    else if (this.crouch) vmax = T.crouch;
    else if (this.sprint) vmax = T.sprint;
    else if (this.aiming) vmax = T.aimMove;
    else if (this.walkMode || padWalk) vmax = T.walk;
    else vmax = T.jog;
    if (this.room && this.room.ramp && this.sprint) vmax = Math.min(vmax, 4.6);   // stairs: no full sprint

    // camera-relative direction
    const cy = this.camYaw;
    const fx = Math.sin(cy), fz = Math.cos(cy), rx = -Math.cos(cy), rz = Math.sin(cy);
    let dx = fx * mv.y + rx * mv.x, dz = fz * mv.y + rz * mv.x;
    const mag = mv.mag;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-4) { dx /= dl; dz /= dl; }
    const scale = analog ? clamp(mag / 0.55, 0, 1) : (mag > 0 ? 1 : 0);
    const tvx = dx * vmax * scale, tvz = dz * vmax * scale;

    // acceleration (exponential approach; slower when air-borne; sprint ramps up)
    const curSp = Math.hypot(this.vx, this.vz), tSp = vmax * scale;
    let k = tSp > curSp + 0.05 ? (this.sprint && curSp > T.jog * 0.9 ? T.sprintAccel : T.accel) : T.decel;
    if (!this.onGround) k = T.airControl;
    if (this.inWater) k *= 0.45;
    // sharp reversals: brake faster so turning feels responsive
    if (curSp > 0.5 && dl > 1e-4 && (this.vx * dx + this.vz * dz) / curSp < -0.3) k *= 1.6;
    const a = damp(k, dt);
    this.vx += (tvx - this.vx) * a; this.vz += (tvz - this.vz) * a;
    if (Math.abs(this.vx) < 1e-3 && Math.abs(this.vz) < 1e-3 && tSp === 0) this.vx = this.vz = 0;

    // facing
    let targetYaw = null;
    if (this.aiming) targetYaw = cy;
    else if (dl > 1e-4 && scale > 0.05) targetYaw = Math.atan2(dx, dz);
    if (targetYaw != null) {
      const diff = wrapPi(targetYaw - this.yaw);
      const rate = this.aiming ? 22 : this.sprint ? 9 : this.inWater ? 5 : T.turnRate;
      this.yaw = wrapPi(this.yaw + diff * damp(rate, dt));
    }

    // jump
    if (canControl && input.actionPressed('Jump') && this.onGround && !this.inWater && !this.crouch && this.state === 'free') {
      this.vy = Math.sqrt(2 * T.gravity * T.jumpH); this.onGround = false;
      g.bus.emit('player:jump', {});
    }

    // integrate with collision sub-steps
    const ox = this.x, oz = this.z;
    const mx = this.vx * dt, mz = this.vz * dt;
    const n = Math.max(1, Math.ceil(Math.hypot(mx, mz) / 0.1));
    let hit = false;
    for (let s = 0; s < n; s++) {
      const r = w.collide(this.deck, this.x + mx / n, this.z + mz / n, T.radius);
      if (this.state !== 'elevator' && !this._stepOk(r.x, r.z)) {
        // stair flight sides (handrails) / ledges: slide along whichever axis is allowed
        hit = true;
        const rx = w.collide(this.deck, this.x + mx / n, this.z, T.radius), rz = w.collide(this.deck, this.x, this.z + mz / n, T.radius);
        if (Math.abs(mx) > 1e-6 && this._stepOk(rx.x, rx.z)) { this.x = rx.x; this.z = rx.z; }
        else if (Math.abs(mz) > 1e-6 && this._stepOk(rz.x, rz.z)) { this.x = rz.x; this.z = rz.z; }
      } else { this.x = r.x; this.z = r.z; if (r.hit) hit = true; }
      if (this.state !== 'elevator') this._stairCheck();
    }
    if (hit) {
      // keep only the velocity that actually happened (no pushing into walls)
      const ax = (this.x - ox) / dt, az = (this.z - oz) / dt;
      const keep = 0.35;
      this.vx = this.vx * keep + ax * (1 - keep); this.vz = this.vz * keep + az * (1 - keep);
      const sp = Math.hypot(this.vx, this.vz), asp = Math.hypot(ax, az);
      if (sp > asp + 0.2) { const f = (asp + 0.2) / sp; this.vx *= f; this.vz *= f; }
    }
    const moved = Math.hypot(this.x - ox, this.z - oz);
    this.speed = moved / dt;
    this._updateRoom();

    // vertical
    if (this.state !== 'elevator') {
      const gy = this._groundTarget();
      const onRamp = !!(this.room && this.room.ramp);
      if (!this.onGround || this.vy > 0) {
        this.vy -= T.gravity * dt;
        this.y += this.vy * dt;
        if (this.y <= gy && this.vy <= 0) { this.y = gy; this.vy = 0; this.onGround = true; this._land(); }
      } else if (onRamp) {
        this.y = gy;
      } else {
        const d = gy - this.y;
        if (d < -0.35 && !this.inWater) { this.onGround = false; this.vy = 0; }            // walked off a ledge → fall
        else if (Math.abs(d) < 0.004) this.y = gy;
        else this.y += d * damp(d > 0 ? 14 : this.inWater ? 5 : 18, dt);                      // smooth small steps / pool exit
      }
      if (this.inWater && !this._wasWater) { g.bus.emit('sfx', { name: 'splash', x: this.x, y: this.y, z: this.z, deck: this.deck, vol: 0.8 }); this.crouch = false; }
      this._wasWater = this.inWater;
    } else this.onGround = true;

    this.stance = this.inWater ? 'swim' : this.crouch ? 'crouch' : 'stand';
    this.noise = this.inWater ? 0.25 * clamp(this.speed / 1.3, 0, 1) : this.crouch ? 0.06 * clamp(this.speed, 0, 1) : clamp(this.speed / T.sprint, 0, 1) * (this.sprint ? 1 : 0.6);
    this._footsteps(moved);
  }

  _land() {
    const g = this.game;
    g.bus.emit('footstep', { x: this.x, y: this.y, z: this.z, deck: this.deck, surface: surfaceOf(this.room), run: true, actor: this, land: true });
    g.cameraRig?.kick(0.06);
  }

  // a horizontal move is allowed unless it crosses a stair-flight side with a height step > 0.4 m (handrails)
  _stepOk(nx, nz) {
    const w = this.game.world, d = this.deck;
    const dx = nx - this.x, dz = nz - this.z, l = Math.hypot(dx, dz);
    if (l < 1e-6) return true;
    // probe at the rim of the collision circle in the direction of travel (the body must not overhang a drop)
    const R = this.T.radius * 0.85;
    const px = nx + dx / l * R, pz = nz + dz / l * R;
    const r0 = w.roomAt(d, this.x, this.z), r1 = w.roomAt(d, px, pz);
    if (r0 === r1) return true;
    if (!(r0 && r0.ramp) && !(r1 && r1.ramp)) return true;
    const g0 = w.floorY(d, this.x, this.z), g1 = w.floorY(d, px, pz);
    return Math.abs(g1 - g0) <= 0.4;
  }

  // stairs: relative height on a ramp beyond ±1.5 m switches deck (see ARCHITECTURE "Stairs")
  _stairCheck() {
    const w = this.game.world;
    const r = w.roomAt(this.deck, this.x, this.z);
    if (!r || !r.ramp) return;
    const rel = w.floorY(this.deck, this.x, this.z) - deckY(this.deck);
    if (rel > this.T.stairSwitch) this._setDeck(this.deck + 1);
    else if (rel < -this.T.stairSwitch) this._setDeck(this.deck - 1);
  }

  _footsteps(moved) {
    if (!this.onGround || moved <= 0) return;
    const sp = this.speed;
    if (sp < 0.25) { this._stepDist = Math.min(this._stepDist, 0.3); return; }
    const stride = this.inWater ? 1.6 : this.crouch ? 0.55 : sp < 2 ? 0.72 : sp < 4.5 ? 1.05 : 1.45;   // metres per foot plant
    this._stepDist += moved;
    this.stepPhase = (this.stepPhase + moved / (2 * stride)) % 1;
    if (this._stepDist >= stride) {
      this._stepDist -= stride;
      this._stepFoot ^= 1;
      this.game.bus.emit('footstep', { x: this.x, y: this.y, z: this.z, deck: this.deck, surface: this.inWater ? 'water' : surfaceOf(this.room), run: sp > 2.4, actor: this, foot: this._stepFoot, crouch: this.crouch, speed: sp });
    }
  }

  // animation / renderer sync
  render(dt, camVisible = true) {
    const g = this.game, c = g.chars;
    if (!c || this.charId < 0) return;
    let anim = 'idle', speed = this.speed, aim = 0;
    const seat = this.seat;
    if (this.state === 'dead') anim = 'dead';
    else if (this.state === 'arrested') anim = 'hands_up';
    else if (seat) anim = seat.pose === 'lie' ? 'lie' : (seat.h || 0) > 0.65 ? 'sit_bar' : 'sit';
    else if (this.inWater) anim = this.speed > 0.25 ? 'swim' : 'tread_water';
    else if (!this.onGround) anim = this.speed > 2.5 ? 'run' : 'walk';
    else if (this.crouch) anim = this.speed > 0.1 ? 'crouch_walk' : 'crouch_idle';
    else if (this.speed < 0.1) anim = 'idle';
    else if (this.speed < 2.1) anim = 'walk';
    else if (this.speed < 4.9) anim = 'run';
    else anim = 'sprint';
    if (this.aiming && !seat && !this.inWater && this.state === 'free') {
      if (this.held === 'pistol') anim = 'aim_pistol';
      else if (this.held === 'taser') anim = 'aim_taser';
      aim = clamp(this.aimPitch, -1.2, 1.2);
    }
    if (this.animOverride) anim = this.animOverride;
    if (!this.onGround) speed = Math.max(0.0, speed * 0.6);
    this.anim = anim;
    const r = this.room;
    const interior = r && !r.exterior ? clamp(r.light ?? 0.85, 0, 1.3) : 0;
    c.set(this.charId, { x: this.x, y: this.y, z: this.z, yaw: this.yaw, anim, speed, interior, visible: camVisible && this.state !== 'hidden', held: this.held || 'none', aim, look: 0 });
  }
}

function makeInventory() {
  const items = new Map();
  return {
    items,
    has(k, n = 1) { return (items.get(k) || 0) >= n; },
    count(k) { return items.get(k) || 0; },
    add(k, n = 1) { items.set(k, (items.get(k) || 0) + n); return items.get(k); },
    remove(k, n = 1) { const c = items.get(k) || 0; if (c < n) return false; if (c === n) items.delete(k); else items.set(k, c - n); return true; },
  };
}

// ── interaction providers owned by the player module ─────────────────────
function poiIndex(plan) {
  if (plan._poiIdx) return plan._poiIdx;
  const m = new Map();
  for (const p of plan.pois || []) {
    if (p.pose !== 'sit' && p.pose !== 'lie') continue;
    const k = Math.floor((p.x + 200) / 4) * 1000 + Math.floor((p.z + 50) / 4);
    if (!m.has(k)) m.set(k, []); m.get(k).push(p);
  }
  plan._poiIdx = m; return m;
}

function seatProvider(game) {
  return (ctx) => {
    const pl = ctx.player; if (!pl) return null;
    if (pl.state === 'seated' && pl.seat) {
      return [{ id: 'stand', label: 'Stand up', key: 'E', x: pl.x, y: pl.y + 0.8, z: pl.z, dist: 0, priority: 5, enabled: true, run: (p) => p.standUp() }];
    }
    if (pl.state !== 'free' || pl.inWater || pl.aiming) return null;
    const plan = game.world.plans[ctx.deck]; if (!plan) return null;
    const idx = poiIndex(plan), out = [];
    const bx = Math.floor((ctx.x + 200) / 4), bz = Math.floor((ctx.z + 50) / 4);
    for (let a = bx - 1; a <= bx + 1; a++) for (let b = bz - 1; b <= bz + 1; b++) {
      const l = idx.get(a * 1000 + b); if (!l) continue;
      for (const p of l) {
        const d = Math.hypot(p.x - ctx.x, p.z - ctx.z);
        if (d > 1.5) continue;
        if (p.room !== pl.roomId && p.item?.room !== pl.roomId) continue;
        if (p.item && p.item.hidden) continue;
        if (p.role) continue;     // staff stations (piano, bar staff…) are not seats for the player
        // must be reachable without crossing a wall
        if (!game.world.lineClear(ctx.deck, ctx.x, ctx.z, p.x, p.z)) continue;
        const taken = p.taken && p.taken !== 'player';
        out.push({
          id: 'seat:' + ctx.deck + ':' + Math.round(p.x * 10) + ':' + Math.round(p.z * 10), label: p.pose === 'lie' ? 'Lie down' : 'Sit',
          key: 'E', x: p.x, y: deckY(ctx.deck) + (p.h || 0.45), z: p.z, dist: d, priority: -1,
          enabled: !taken, reason: taken ? 'Occupied' : undefined,
          run: (pp) => pp.sitAt(p),
        });
      }
    }
    // only the nearest couple — avoid prompt flicker
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, 2);
  };
}

// Fallback door interaction when the doors workstream is not installed (keeps the player testable standalone).
function fallbackDoorProvider(game) {
  return (ctx) => {
    if (game.doors) return null;
    const w = game.world, pl = ctx.player;
    const out = [];
    for (const { door, dist } of w.doorsNear(ctx.deck, ctx.x, ctx.z, 1.7)) {
      if (door.type === 'elevator') continue;
      const s = w.door(ctx.deck, door.id);
      const ok = pl.hasAccess(door.access) || (s.access === 'none' && !s.lockedState);
      const open = s.open > 0.5;
      out.push({
        id: 'door:' + ctx.deck + ':' + door.id, label: open ? 'Close door' : 'Open door', key: 'E', x: door.x, y: deckY(ctx.deck) + 1.2, z: door.z, dist,
        priority: 0, enabled: open || ok, reason: ok ? undefined : 'Locked',
        run: () => { s.target = open ? 0 : 1; s.open = s.target; s.lastUse = game.minutes; game.bus.emit('door:move', { deck: ctx.deck, door: door.id, opening: !open }); },
      });
    }
    return out;
  };
}

// ── spawn ───────────────────────────────────────────────────────────────
function findCabin(game) {
  const L = game.layout;
  const all = L.cabins || [];
  let c = all.find(c => c.no === 9147);
  if (!c) c = all.find(c => c.deck === 9 && c.kind === 'balcony');
  if (!c) c = all.find(c => c.deck === 9 && !c.crew);
  return c || all[0] || null;
}
// Spawn INSIDE the stateroom, just past the door, facing into the room. Layout cabins carry inX/inZ
// (1.2 m inside the door, on the door axis); we search outward from there for a free 0.32 m spot.
function spawnPoint(game, cab) {
  const w = game.world, plan = w.plans[cab.deck];
  const room = plan.rooms[cab.room];
  const door = plan.doors[cab.door];
  if (!door) return { x: room.cx, z: room.cz, yaw: 0 };
  // inward normal: from the door line toward the cabin centre
  let nx = 0, nz = 0;
  if (door.normal === 'x') nx = Math.sign(room.cx - door.x) || 1; else nz = Math.sign(room.cz - door.z) || 1;
  const yaw = Math.atan2(nx, nz);            // facing into the room
  const bx = Number.isFinite(cab.inX) ? cab.inX - nx * 1.2 : door.x, bz = Number.isFinite(cab.inZ) ? cab.inZ - nz * 1.2 : door.z;
  const free = (x, z) => w.roomId(cab.deck, x, z) === cab.room && !w.collide(cab.deck, x, z, 0.32).hit;
  if (Number.isFinite(cab.inX) && free(cab.inX, cab.inZ)) return { x: cab.inX, z: cab.inZ, yaw };
  for (const inset of [1.2, 0.9, 1.5, 0.7, 1.8, 2.2, 2.6]) for (const lat of [0, -0.3, 0.3, -0.6, 0.6, -0.9, 0.9]) {
    const x = bx + nx * inset + (door.normal === 'x' ? 0 : lat), z = bz + nz * inset + (door.normal === 'x' ? lat : 0);
    if (free(x, z)) return { x, z, yaw };
  }
  // nothing free inside near the door (shouldn't happen with the fixed cabin furniture): corridor, facing the door
  console.warn(`[player] cabin ${cab.no}: no free spot inside the door — spawning in the corridor`);
  for (const out of [1.0, 0.8, 1.2]) {
    const x = door.x - nx * out, z = door.z - nz * out;
    if (!w.collide(cab.deck, x, z, 0.3).hit) return { x, z, yaw: Math.atan2(nx, nz), corridor: true };
  }
  return { x: room.cx, z: room.cz, yaw };
}

// ── install ─────────────────────────────────────────────────────────────
export async function installPlayer(game) {
  try { makeAppearanceRef = (await import('./characters.js')).makeAppearance; } catch (e) { console.warn('[player] characters unavailable', e); }
  const p = game.player = new Player(game);

  // appearance + character
  const ap = maraAppearance();
  p.appearance = p.baseAppearance = ap;
  if (game.chars && ap) p.charId = game.chars.add(ap);

  // home cabin & spawn
  const cab = findCabin(game);
  if (cab) {
    p.cabin = cab.no; p.homeCabin = cab;
    p.keycards.add('cabin:' + cab.no);
    const sp = spawnPoint(game, cab); p._spawn = sp; p._spawnPoint = (c) => spawnPoint(game, c);
    p.deck = cab.deck; p.x = sp.x; p.z = sp.z; p.yaw = sp.yaw; p.camYaw = sp.yaw;
  } else { p.deck = 9; p.x = 0; p.z = 9.5; }
  p._updateRoom(true);
  p.y = p._groundTarget();
  game.world.setActiveDeck(p.deck);

  // interactions
  game.interact?.addProvider(seatProvider(game), 'player-seats');
  game.interact?.addProvider(fallbackDoorProvider(game), 'player-fallback-doors');

  const hud = game.playerHud = new PlayerHud(game);
  const rig = installCameraRig(game);
  rig.snap(p.yaw);

  // interaction state
  const ist = { best: null, holdT: 0, holdId: null };
  p.interaction = ist;
  const ctx = { player: p, deck: 0, x: 0, y: 0, z: 0, yaw: 0, room: null };

  game.addSystem({
    name: 'player', order: 20,
    update(dt) {
      p.update(dt);
      // interactions
      const input = game.input;
      ctx.deck = p.deck; ctx.x = p.x; ctx.y = p.y; ctx.z = p.z; ctx.yaw = p.state === 'seated' ? rig.yaw : p.yaw; ctx.room = p.room;
      let best = null;
      const canInteract = game.interact && input && input.context === 'play' && !p.controlsLocked && (p.state === 'free' || p.state === 'seated' || p.state === 'elevator');
      if (canInteract) { const list = game.interact.query(ctx); best = list[0] || null; }
      if (best && ist.best && best.id !== ist.best.id) { ist.holdT = 0; }
      ist.best = best;
      if (best && input) {
        const key = best.key || 'E';
        const code = letterCode(key);
        const action = key === 'E' ? 'Interact' : key === 'F' ? 'AltInteract' : null;
        const isDown = action ? input.action(action) : input.down(code);
        const wasPressed = action ? input.actionPressed(action) : input.pressed(code);
        if (best.enabled === false) {
          if (wasPressed) game.bus.emit('ui:toast', { text: best.reason || 'Unavailable', kind: 'warn' });
          ist.holdT = 0;
        } else if (best.hold > 0) {
          if (isDown && (ist.holdT > 0 || wasPressed)) {
            ist.holdT += dt;
            if (ist.holdT >= best.hold) { ist.holdT = 0; runInteraction(game, p, best); consume(input, code, action); }
          } else ist.holdT = 0;
        } else if (wasPressed) { runInteraction(game, p, best); consume(input, code, action); }
      } else ist.holdT = 0;
    },
  });
  game.addSystem({
    name: 'playerHud', order: 96, runWhilePaused: true,
    lateUpdate(dt, realDt) { hud.update(realDt, ist); },
  });
  game.bus.emit('player:ready', p);
  return p;
}

function consume(input, code, action) {
  input._pressed.delete(code);
  if (action) for (const c of input.map[action] || []) input._pressed.delete(c);
}

function runInteraction(game, p, it) {
  try {
    it.run(p, game);
    game.bus.emit('player:interact', { id: it.id, label: it.label });
    if (it.crime) game.bus.emit('crime', { ...it.crime, x: p.x, y: p.y, z: p.z, deck: p.deck, actor: p, victim: it.victim ?? null });
  } catch (e) { console.error('[player] interaction failed', it.id, e); }
}
