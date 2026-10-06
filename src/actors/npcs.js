// HALCYON TIDE — NPC simulation: ambient passengers, staff at their posts, roaming crew, mission NPCs.
//
//   NPCSystem  (game.npcs = sys.api)
//     ├─ NavSystem   (nav.js)        grid A*, path cache, per-frame search budget, stair lanes
//     ├─ Population  (population.js) who should exist where (schedule.js densities, staff rosters)
//     └─ NPC objects                 state machine + steering + reactions, rendered through game.chars
//
// Simulation LOD: <25 m from focus → full update every frame; 25–50 m → every 3rd frame; beyond / other decks →
// every 8th frame with straight-line extrapolation in between. Seated / working NPCs cost ~nothing.
// No allocations in the per-frame loops (paths are allocated when computed, not per frame).
import * as THREE from 'three';
import { GRID, deckY, deckOfY, toI, toJ } from '../core/config.js';
import { Rng, hash32 } from '../core/util.js';
import { makeAppearance } from './characters.js';
import { patchSurface } from '../world/materials.js';
import { NavSystem, ACC, maskFromAccess } from './nav.js';
import { Population } from './population.js';
import { makeIdentity, BARKS } from './names.js';
import * as S from './schedule.js';

const NX = GRID.nx;
const TAU = Math.PI * 2;
const NEAR = 25, MID = 50;
const RAD = 0.27;
const FLOOR_SURF = ['carpet', 'carpet', 'carpet', 'carpet', 'teak', 'marble', 'tile', 'rubber', 'steel', 'tile', 'rubber', 'wood', 'carpet', 'tile', 'steel', 'wood'];
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let NEXT_ID = 1;

// ───────────────────────────────────────────────────────────────────────────
class NPC {
  constructor(sys) {
    this.sys = sys;
    this.id = NEXT_ID++;
    this.charId = -1;
    this.kind = 'pax';            // pax | staff | roamer | mission
    this.role = 'passenger'; this.job = null; this.name = ''; this.identity = null; this.persona = {};
    this.deck = 1; this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vz = 0; this.speed = 0;
    this.state = 'idle'; this.activity = 'idle'; this.goal = null;
    this.appearance = null; this.access = new Set(); this.mask = 0; this.own = 0;
    this.alert = 0; this.health = 100; this.persistent = false;
    this.anim = 'idle'; this.held = 'none'; this.animSpeed = 0;
    this.path = null; this.pi = 1; this.pathReq = null; this.pathFails = 0;
    this.walkSpeed = 1.35; this.rad = RAD; this.swim = false;
    this.poi = null; this.useT = 0; this.useKind = 'pass'; this.homeRoom = null; this.passer = false;
    this.group = null; this.leader = false; this.follower = false; this.pendingUse = null;
    this.room = null; this.roomId = 0; this.interior = 0;
    this.acc = 0; this.t = 0; this.r = Math.random();
    this.stuckT = 0; this.cpx = 0; this.cpz = 0; this.cpT = 0; this.stuck = false;
    this.waitT = 0; this.doorReqT = 0; this.barkCD = 8 + Math.random() * 20; this.bumpCD = 0; this.stepT = 0;
    this.lane = null; this.timer = 0; this.prev = null; this.exit = null; this.vanishOnArrive = false;
    this.faceYaw = null; this.lod = 0; this.gone = false; this.seenT = 0;
    this.perception = { canSee: (x, y, z, deck) => this.canSee(x, y, z, deck), hears: (x, z, deck, r) => this.hears(x, z, deck, r) };
  }
  get lodName() { return this.lod === 0 ? 'near' : this.lod === 1 ? 'mid' : 'far'; }
  canSee(x, y, z, deck) {
    if (deck !== this.deck) return false;
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz);
    if (d < 1.5) return true;
    if (d > 25) return false;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if ((dx * fx + dz * fz) / d < 0.5736) return false;      // 110° cone
    return this.sys.world.lineClear(deck, this.x, this.z, x, z);
  }
  hears(x, z, deck, radius) {
    const dd = Math.abs(deck - this.deck);
    if (dd > 1) return false;
    let r = radius * (dd ? 0.4 : 1);
    if (!dd && !this.sys.world.lineClear(deck, this.x, this.z, x, z, { doorsBlock: true })) r *= 0.55;
    return Math.hypot(x - this.x, z - this.z) <= r;
  }
  onEvent(evt) { this.sys.react(this, evt); }
}

// ───────────────────────────────────────────────────────────────────────────
class NPCSystem {
  constructor(game) {
    this.game = game; this.world = game.world; this.bus = game.bus;
    this.nav = new NavSystem(game);
    this.pop = new Population(this);
    this.list = []; this.byId = new Map(); this.byChar = new Map();
    this.roamers = new Map();
    this.time = 0; this.frame = 0;
    this.density = parseFloat(game.params?.get?.('npcdens') || '1') || 1;
    this.rng = new Rng(hash32('npcs', Date.now() & 0xffff));
    this.rnd = () => this.rng.next();
    this.focus = { x: 0, y: 0, z: 0, deck: 9, cam: null };
    this.frustum = new THREE.Frustum(); this._m4 = new THREE.Matrix4(); this._v3 = new THREE.Vector3();
    this.camDeck = 9;
    this.fallbackDoors = new Set();
    this.fleeTargets = new Map(); this.fleeT = 0;
    this.shelter = false;          // weather:change {shelter} → passengers leave the open decks, none spawn there
    this.muster = null;            // alarm {kind:'muster', on} → passengers near the camera go to their lifeboat stations
    this._musterLoad = new Map();
    this.barkT = 0; this.stepBudget = 0;
    this.msHist = new Float32Array(120); this.msI = 0; this.msMax = 0;
    // spatial hash: 2 m cells across 3 decks
    this.HX = 166; this.HZ = 26; this.head = new Int32Array(this.HX * this.HZ * 3); this.next = new Int32Array(1024); this.arr = [];
    this.paxCabins = (game.layout?.cabins || []).filter(c => !c.crew);
    this.crewCabins = (game.layout?.cabins || []).filter(c => c.crew);
    this.carts = this._makeCarts();
    this.api = this._makeApi();
    this._listen();
  }

  cap() {
    const q = this.game.quality?.npcCap ?? 110;
    const ch = this.game.chars;
    if (!ch) return q;
    const others = ch.count - this.list.filter(n => n.charId >= 0).length;
    return Math.max(0, Math.min(q, ch.max - others - 6));
  }

  // ── focus / visibility ────────────────────────────────────────────────
  _updateFocus() {
    const g = this.game, f = this.focus, cam = g.camera;
    const p = g.player;
    if (p && !g.debugCam && Number.isFinite(p.x)) { f.x = p.x; f.z = p.z; f.deck = p.deck || deckOfY(p.y + 0.5); f.y = p.y; }
    else { const c = g.focus || cam.position; f.x = c.x; f.z = c.z; f.y = c.y; f.deck = this.world.activeDeck || deckOfY(c.y - 1); }
    f.x = clamp(f.x, -165, 165); f.z = clamp(f.z, -25, 25);
    f.room = this.world.roomId(f.deck, f.x, f.z);
    cam.updateMatrixWorld();
    this._m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m4);
    this.camDeck = clamp(deckOfY(cam.position.y - 1.0), 1, 17);
    const room = this.world.roomAt(this.camDeck, cam.position.x, cam.position.z);
    this.camExterior = !room || !!room.exterior || room.isVoid;
  }
  inFrustum(deck, x, z) { this._v3.set(x, deckY(deck) + 1, z); return this.frustum.containsPoint(this._v3); }
  // can the camera see a point (deck floor + height)?
  seen(deck, x, y, z) {
    const c = this.game.camera.position;
    const dx = x - c.x, dz = z - c.z, dy = y - c.y;
    const d2 = dx * dx + dz * dz + dy * dy;
    if (d2 < 30) return true;
    if (d2 > 110 * 110) return false;
    const v = this._v3;
    let vis = false;
    for (const hy of [0.2, 1.6]) { v.set(x, deckY(deck) + hy, z); if (this.frustum.containsPoint(v)) { vis = true; break; } }
    if (!vis) return false;
    if (deck === this.camDeck) return this.world.lineClear(deck, c.x, c.z, x, z);
    // other deck: only through open air (both exterior) or an atrium well
    const r = this.world.roomAt(deck, x, z);
    if (this.camExterior && (!r || r.exterior)) return true;
    if (Math.abs(deck - this.camDeck) === 1) {
      const rc = this.world.roomAt(this.camDeck, x, z);
      if (rc && rc.isVoid) return true;
    }
    return false;
  }

  // ── creation ───────────────────────────────────────────────────────────
  _create(opts) {
    const n = new NPC(this);
    n.kind = opts.kind || 'pax';
    n.role = opts.role || 'passenger';
    n.job = opts.job || null;
    n.identity = opts.identity;
    n.name = opts.identity?.name || opts.name || 'Guest';
    n.persona = opts.identity?.persona || {};
    n.access = opts.access || new Set();
    if (n.identity?.cabin && n.kind === 'pax') { n.own = parseInt(String(n.identity.cabin), 10) || 0; n.access.add('cabin:' + n.identity.cabin); }
    n.mask = maskFromAccess(n.access);
    n.r = ((opts.seed ?? n.id * 7919) % 10007) / 10007;
    n.appearance = opts.appearance;
    n.deck = opts.deck || 1;
    const age = n.appearance?.age;
    n.walkSpeed = age === 'elderly' ? 0.82 + n.r * 0.2 : age === 'child' ? 1.25 : 1.22 + n.r * 0.28;
    if (n.kind !== 'pax') n.walkSpeed = 1.35 + n.r * 0.2;
    if (n.persona.drunk) n.walkSpeed *= 0.85;
    if (age === 'child') n.rad = 0.2;
    if (this.game.chars && n.appearance) {
      n.charId = this.game.chars.add(n.appearance);
      if (n.charId >= 0) this.byChar.set(n.charId, n);
    }
    this.list.push(n); this.byId.set(n.id, n);
    return n;
  }

  // ambient passenger (or off-duty crew) — called by Population
  makeAmbient({ seed, crew, deck, kind, idx, room, h, dest }) {
    if (this.list.length >= this.cap()) return null;
    const rng = new Rng(seed);
    let age = 'adult', sex;
    if (!crew) {
      if (kind === 'family' && idx >= 2) age = 'child';
      else if (rng.chance(kind === 'couple' ? 0.16 : 0.1)) age = 'elderly';
      if (kind === 'couple' && idx === 1) sex = undefined;
    }
    const id = makeIdentity(seed, { crew, age, cabins: this.paxCabins, crewCabins: this.crewCabins });
    let role = crew ? 'crew_steward' : age === 'child' ? 'child' : age === 'elderly' ? 'elderly' : 'passenger';
    let dress = crew ? undefined : S.dressFor(dest, h, rng.next());
    if (crew) role = deck <= 3 ? rng.pick(['crew_steward', 'crew_housekeeping', 'crew_deckhand', 'crew_engineer', 'crew_waiter', 'crew_chef', 'crew_officer'])
      : rng.pick(['crew_steward', 'crew_housekeeping', 'crew_housekeeping', 'crew_engineer', 'crew_officer']);
    if (age === 'child' && dress === 'evening') dress = 'casual';
    const ap = makeAppearance(rng, { role, sex: id.sex, age, dress, seed });
    const access = crew ? S.accessFor('crew') : new Set();
    const n = this._create({ kind: 'pax', role, identity: id, appearance: ap, access, deck, seed });
    n.offDuty = crew;
    // embarkation day afternoon: luggage
    if (!crew && this.game.day === 0 && h >= 13 && h < 19 && age !== 'child' && dest && (dest.dens === 'transit' || dest.isLobby || dest.type === 'services') && rng.chance(0.4)) n.luggage = true;
    return n;
  }

  spawnStaff(p, R, seedK, focus) {
    const rng = new Rng(seedK);
    const look = S.ROLE_LOOK[p.role] || 'crew_steward';
    const id = makeIdentity(seedK, { crew: true, crewCabins: this.crewCabins });
    const ap = makeAppearance(rng, { role: look, sex: id.sex, seed: seedK });
    const D = this.pop.decks[p.deck];
    const fy = deckY(p.deck) + 1;
    const inPlace = this.pop.warm || p.role === 'performer' || !this.seen(p.deck, p.x, fy, p.z);
    let spawn = null;
    if (!inPlace) { spawn = this.pop.hiddenAnchor(D, focus, true); if (!spawn) return null; }
    const n = this._create({ kind: 'staff', role: look, job: p.role, identity: id, appearance: ap, access: S.accessFor(p.role), deck: p.deck, seed: seedK });
    n.homeRoom = R; n.post = p; p.taken = n.id;
    if (inPlace) { this.placeAt(n, p.deck, p.x, p.z); this.beginUse(n, p, true); }
    else { this.placeAt(n, p.deck, spawn.x, spawn.z, spawn); this.goUse(n, p); }
    return n;
  }

  spawnRoamer(type, D, key, focus, extra) {
    const seedK = hash32('roam', key);
    const rng = new Rng(seedK);
    const look = S.ROLE_LOOK[type] || 'crew_steward';
    const id = makeIdentity(seedK, { crew: true, crewCabins: this.crewCabins });
    const ap = makeAppearance(rng, { role: look, sex: id.sex, seed: seedK });
    const crewDeck = D.d <= 3;
    let spawn = null;
    if (this.pop.warm) {
      // in place somewhere sensible & unseen
      let pts = type === 'patrol' ? (crewDeck ? D.crewPatrol : D.patrol) : null;
      if (type === 'waiter' && extra) pts = [{ x: extra.door.x, z: extra.door.z }];
      if (pts?.length) for (let t = 0; t < 8 && !spawn; t++) { const q = pts[Math.floor(rng.next() * pts.length)]; if (Math.hypot(q.x - focus.x, q.z - focus.z) < 70 && !this.seen(D.d, q.x, deckY(D.d) + 1, q.z)) spawn = q; }
    }
    if (!spawn && type === 'waiter' && extra) {
      const dr = extra.door, gal = D.plan.rooms[extra.galley];
      const s = dr.normal === 'x' ? Math.sign(gal.cx - dr.x) : Math.sign(gal.cz - dr.z);
      const q = { x: dr.x + (dr.normal === 'x' ? s * 1.5 : 0), z: dr.z + (dr.normal === 'z' ? s * 1.5 : 0) };
      if (!this.seen(D.d, q.x, deckY(D.d) + 1, q.z)) spawn = q;
    }
    if (!spawn) spawn = this.pop.hiddenAnchor(D, focus, true);
    if (!spawn) return null;
    const n = this._create({ kind: 'roamer', role: look, job: type, identity: id, appearance: ap, access: S.accessFor(type), deck: D.d, seed: seedK });
    n.roamKey = key; this.roamers.set(key, n);
    if (type === 'waiter') n.shuttle = extra;
    const sx = spawn.x, sz = spawn.z;
    const np = this.nav.nearestPoint(D.d, sx, sz, n.mask, 3) || { x: sx, z: sz };
    this.placeAt(n, D.d, np.x, np.z, spawn.kind ? spawn : null);
    if (type === 'steward') n.cart = this._cartAlloc(n);
    this.roamNext(n);
    return n;
  }

  // public: persistent mission NPC
  spawnAt(role, deck, x, z, opts = {}) {
    const seed = opts.seed ?? hash32('mission', role, deck, x.toFixed(2), z.toFixed(2), NEXT_ID);
    const rng = new Rng(seed);
    const crew = role !== 'passenger' && role !== 'child' && role !== 'elderly';
    const id = Object.assign(makeIdentity(seed, { crew, age: role === 'child' ? 'child' : role === 'elderly' ? 'elderly' : 'adult', sex: opts.sex, cabins: this.paxCabins, crewCabins: this.crewCabins }), opts.identity || {});
    if (opts.name) { id.name = opts.name; [id.first, id.last] = [opts.name.split(' ')[0], opts.name.split(' ').slice(1).join(' ')]; }
    const ap = opts.appearance || makeAppearance(rng, { role, sex: id.sex, dress: opts.dress, seed, ...(opts.look || {}) });
    const access = opts.access ? new Set(opts.access) : crew ? S.accessFor(opts.job || role) : new Set();
    const n = this._create({ kind: 'mission', role, job: opts.job || null, identity: id, appearance: ap, access, deck, seed });
    n.persistent = true; n.tag = opts.tag || null;
    this.placeAt(n, deck, x, z);
    n.yaw = opts.yaw ?? 0;
    if (opts.goal) this.setGoal(n, opts.goal);
    else { n.state = 'idle'; n.timer = Infinity; this.setAnim(n, opts.anim || 'idle'); }
    this.bus.emit('npc:spawn', { npc: n });
    return n;
  }

  placeAt(n, deck, x, z, anchor = null, slot = 0) {
    n.spawnKind = anchor?.kind || 'place';
    n.deck = deck; n.x = x; n.z = z; n.vx = n.vz = 0; n.speed = 0;
    n.cpx = x; n.cpz = z; n.cpT = 0; n.stuckT = 0;
    this._updateRoom(n);
    n.y = this.world.floorY(deck, x, z);
    if (anchor) {
      if (anchor.yaw !== undefined) n.yaw = anchor.yaw;
      if (anchor.kind === 'cabinIn' && anchor.cabin && n.kind === 'pax' && !n.offDuty) {
        // they live here: walking out of their own stateroom
        n.own = anchor.cabin; n.access.add('cabin:' + anchor.cabin);
        if (n.identity) { n.identity.cabin = anchor.cabin; n.identity.keycard = 'cabin:' + anchor.cabin; }
        if (n.group) for (const m of n.group.members) if (m !== n) { m.own = anchor.cabin; if (m.identity) m.identity.cabin = anchor.cabin; }
      }
      if (anchor.kind === 'stair' && anchor.lane) {
        // arrive by the stairs: start part-way down/up the opposite lane on this deck and walk out
        const L = anchor.lane;
        if (L) {
          n.x = L.xb + (L.xt - L.xb) * Math.min(0.85, 0.42 + slot * 0.16); n.z = L.zc + (slot % 2 ? 0.3 : slot ? -0.3 : 0);
          n.lane = { L, toX: L.xb - L.dir * 0.8, z: L.zc, thenGoal: true, dir: -L.dir };
          n.yaw = Math.atan2(-L.dir, 0);
          n.y = this.world.floorY(deck, n.x, n.z);
        }
      }
    }
    if (n.lane) n.state = 'stairs';
    this._syncChar(n, true);
  }

  // ── goals ─────────────────────────────────────────────────────────────
  goUse(n, poi) {
    if (poi.taken === -1 || poi.taken == null) poi.taken = n.id;
    n.goal = { type: 'use', poi, deck: poi.deck, x: poi.x, z: poi.z };
    n.useKind = poi.pose === 'stand' && poi.act !== 'eat' ? 'stand' : 'seat';
    this._startWalk(n);
  }
  goExit(n, exit) {
    n.goal = { type: 'exit', exit, deck: n.deck, x: exit.x, z: exit.z };
    this._startWalk(n);
  }
  setPasser(n, D, focus) {
    const ex = this.pop.exitFor(n, D, focus);
    if (!ex) { this.leave(n); return; }
    n.activity = 'walking';
    this.goExit(n, ex);
  }
  followLeader(n) {
    if (n.lane) { n.lane.follow = true; n.state = 'stairs'; n.activity = 'walking'; return; }
    n.state = 'follow'; n.path = null; n.activity = 'walking';
  }
  leave(n) {
    if (n.persistent) return;
    this._releasePoi(n);
    n.y = this.world.floorY(n.deck, n.x, n.z);
    if (n.leader && n.group) for (const m of n.group.members) if (m !== n && !m.gone) { this._releasePoi(m); if (m.pendingUse) { m.pendingUse.taken = null; m.pendingUse = null; } this.followLeader(m); }
    const D = this.pop.decks[n.deck] || this.pop.deck(n.deck);
    const ex = D && this.pop.exitFor(n, D, this.focus);
    if (!ex) { if (!this.seen(n.deck, n.x, n.y + 1, n.z)) this.remove(n); else { n.state = 'idle'; n.timer = 4; } return; }
    n.leaving = true; n.activity = 'leaving';
    this.goExit(n, ex);
  }

  // public: mission/scripted goal
  setGoal(n, goal) {
    if (typeof n === 'number') n = this.byId.get(n);
    if (!n || n.gone) return false;
    n.badCores = null; n.laneTo = null; n.elevTo = null;
    this._releasePoi(n);
    n.goal = goal ? { ...goal } : null;
    n.lane = null;
    if (!goal) { n.state = 'idle'; n.timer = Infinity; return true; }
    switch (goal.type) {
      case 'move': n.goal.deck = goal.deck ?? n.deck; n.run = !!goal.run; this._startWalk(n); break;
      case 'use': this.goUse(n, goal.poi); break;
      case 'idle': n.state = 'idle'; n.timer = goal.duration ?? Infinity; this.setAnim(n, goal.anim || 'idle', goal.held); if (goal.yaw !== undefined) n.yaw = goal.yaw; break;
      case 'follow': n.state = 'follow'; n.path = null; break;
      case 'wander': n.state = 'idle'; n.timer = 0; break;
      case 'patrol': n.goal.i = 0; this._patrolStep(n); break;
      case 'flee': this._flee(n, goal.from || { x: n.x, z: n.z }, goal.cower || false); break;
      default: n.state = 'idle'; n.timer = Infinity;
    }
    return true;
  }

  _startWalk(n) {
    const g = n.goal; if (!g) return;
    if (!n.lane && !this.nav.passable(n.deck, n.x, n.z, n.mask, n.swim)) {
      const q = this.nav.nearestPoint(n.deck, n.x, n.z, n.mask, 4);
      if (q) { n.state = 'standup'; n.apT = 0; n.apx = n.x; n.apz = n.z; n.upx = q.x; n.upz = q.z; n.y = this.world.floorY(n.deck, n.x, n.z); return; }
    }
    n.state = 'walk'; n.path = null; n.pi = 1; n.stuckT = 0; n.cpT = 0;
    if (g.type !== 'roam' || !n.activity) n.activity = n.leaving ? 'leaving' : g.type === 'use' ? 'heading to ' + (g.poi.act || 'seat') : 'walking';
    if (n.lane) { n.state = 'stairs'; return; }
    const gd = g.deck ?? n.deck;
    if (gd !== n.deck) { this._routeDeck(n, gd); return; }
    this._requestPath(n, g.x, g.z);
  }

  _requestPath(n, gx, gz, hi = false) {
    if (n.pathReq) n.pathReq.cancelled = true;
    // short & clear: no search
    if (Math.hypot(gx - n.x, gz - n.z) < 14 && this.nav.clear(n.deck, n.x, n.z, gx, gz, n.mask, n.own) && this.nav.passable(n.deck, gx, gz, n.mask, n.swim)) {
      n.path = new Float32Array([n.x, n.z, gx, gz]); n.pi = 1; n.pathReq = null; return;
    }
    n.path = null;
    const req = { npc: n, deck: n.deck, sx: n.x, sz: n.z, gx, gz, mask: n.mask, own: n.own, swim: n.swim, hi: hi || n.kind === 'mission' || n.state === 'flee', goalR: 6,
      cb: (path) => {
        if (n.gone || req.cancelled) return;
        n.pathReq = null;
        if (!path) { this._pathFailed(n); return; }
        n.path = path; n.pi = 1; n.pathFails = 0;
      } };
    n.pathReq = this.nav.request(req);
  }
  _pathFailed(n, final = false) {
    if (!final && (n.laneTo || n.elevTo) && n.tryCore && n.goal) {
      // that core is unreachable from here: try another one
      n.badCores?.add(n.tryCore); n.laneTo = null; n.elevTo = null; n.tryCore = null;
      if ((n.badCores?.size || 0) < 8) { this._routeDeck(n, n.goal.deck); return; }
    }
    n.pathFails++;
    if (n.state === 'flee') { n.state = 'cower'; n.timer = 6 + this.rnd() * 6; this.setAnim(n, 'cower'); return; }
    if (n.persistent) { n.state = 'idle'; n.timer = 3; this.bus.emit('npc:goalFailed', { npc: n, goal: n.goal }); return; }
    if (n.pathFails > 2 || n.leaving) { if (!this.seen(n.deck, n.x, n.y + 1, n.z)) { this.remove(n); return; } }
    this._releasePoi(n);
    if (n.kind === 'staff') { n.state = 'idle'; n.timer = 5; return; }
    if (n.kind === 'roamer') { n.state = 'idle'; n.timer = 3; return; }
    this.leave(n);
  }

  // cross-deck: stairs (adjacent / few decks) or abstract elevator
  // cross-deck: stairs for 1–2 decks (walk the ramps), abstract elevator ride for longer trips.
  // Failed cores are remembered per trip (n.badCores) so the next attempt picks another one.
  _routeDeck(n, toDeck) {
    const dd = Math.abs(toDeck - n.deck);
    n.badCores = n.badCores || new Set();
    const L = this.nav.laneToward(n.deck, toDeck, n.x, n.z, n.mask, n.badCores);
    if (dd >= 3 || !L) {
      const lob = this.nav.lobbyNear(n.deck, n.x, n.mask, n.badCores);
      const p = lob && (this.nav.randomPointInRoom(n.deck, lob.room, this.rnd, n.mask) || this.nav.nearestPoint(n.deck, lob.x, 0, n.mask, 6));
      if (p) { n.elevTo = { deck: toDeck, core: lob.core }; n.tryCore = 'L' + n.deck + ':' + lob.core; this._requestPath(n, p.x, p.z); return; }
    }
    if (!L) { n.badCores = null; this._pathFailed(n, true); return; }
    n.laneTo = L; n.tryCore = n.deck + ':' + L.core;
    this._requestPath(n, L.xb - L.dir * 0.8, L.zc);
  }

  // ── POI use ───────────────────────────────────────────────────────────
  beginUse(n, poi, instant = false) {
    if (n.poi && n.poi !== poi) this._releasePoi(n);
    poi.taken = n.id; n.poi = poi;
    n.state = 'use'; n.goal = null; n.path = null; n.vx = n.vz = 0; n.speed = 0;
    const keepFace = n.leader && n.group && poi.pose === 'stand' ? n.faceYaw : null;
    n.x = poi.x; n.z = poi.z; n.yaw = poi.rot ?? n.yaw; n.faceYaw = keepFace;
    this._updateRoom(n);
    const fy = this.world.floorY(n.deck, n.x, n.z);
    n.swim = false;
    if (n.kind === 'staff' || n.kind === 'roamer') {
      n.useT = Infinity; n.activity = 'working';
      n.y = fy + (poi.pose === 'sit' ? (poi.h || 0.48) : poi.role === 'performer' ? (poi.h || 0) : 0);
      this._workAnim(n);
      return;
    }
    const h = this.game.hour;
    const a = S.poiAnim(poi, this.rnd(), h);
    n.useT = S.useDuration(poi, this.rnd()) * (n.persona.drunk && poi.act === 'drink' ? 1.6 : 1);
    if (poi.act === 'swim' || this.nav.isPool(n.deck, n.x, n.z)) {
      n.swim = true; n.y = deckY(n.deck) - 0.15; n.activity = 'swimming';
      this.setAnim(n, this.rnd() < 0.5 ? 'swim' : 'tread_water'); n.swimT = 0;
      return;
    }
    if (poi.act === 'soak') { n.y = fy + 0.06; this.setAnim(n, 'sit'); n.activity = 'soaking'; return; }
    if (poi.pose === 'sit') n.y = fy + (poi.h || 0.45);
    else if (poi.pose === 'lie') n.y = fy + (poi.h || 0.4);
    else if (poi.pose === 'run') n.y = fy + 0.17;
    else n.y = fy;
    n.activity = ({ eat: 'eating', drink: 'drinking', gamble: 'gambling', watch: 'watching the show', sunbathe: 'sunbathing', view: 'enjoying the view', shop: 'browsing', exercise: 'exercising', dance: 'dancing', relax: 'relaxing', mingle: 'chatting', play: 'playing' })[poi.act] || 'relaxing';
    let anim = a.anim, held = a.held;
    if (poi.act === 'dance') anim = 'dance';
    if (poi.act === 'mingle') {
      const r = this.rnd();
      anim = n.group ? 'talk' : r < 0.35 ? 'phone' : r < 0.5 ? 'drink' : 'idle'; held = !n.group && r >= 0.35 && r < 0.5 ? 'drink' : 'none';
      if (!n.group) n.useT = Math.min(n.useT, 10 + this.rnd() * 25);
    }
    if (poi.act === 'watch' && poi.pose !== 'sit') anim = 'idle';
    if (n.persona.drunk && poi.pose === 'stand' && poi.act !== 'dance') held = 'drink';
    this.setAnim(n, anim, held, a.speed || 0);
    if (poi.pose === 'stand' && n.faceYaw != null) n.yaw = n.faceYaw;
    // group: send the others to their spots now
    if (n.leader && n.group) for (const m of n.group.members) if (m !== n && m.pendingUse && !m.gone) { const u = m.pendingUse; m.pendingUse = null; this.goUse(m, u); }
    if (instant) this._syncChar(n, true);
  }

  _workAnim(n) {
    const p = n.post || n.poi;
    const role = n.job || p?.role;
    let anim = S.workAnim(role, n.t, n.r);
    if (role === 'performer') anim = n.homeRoom?.room?.type === 'theater' ? 'dance' : (n.homeRoom?.room?.venue === 'comedy' ? 'talk' : 'dance');
    if (role === 'pianist') anim = p?.pose === 'sit' ? 'type' : 'idle';
    if (role === 'helmsman') anim = 'idle';
    if (role === 'lifeguard') anim = 'guard';
    this.setAnim(n, anim, 'none');
  }

  _releasePoi(n) {
    if (n.poi) { if (n.poi.taken === n.id) n.poi.taken = null; n.poi = null; }
    if (n.goal?.type === 'use' && n.goal.poi.taken === n.id) n.goal.poi.taken = null;
    n.swim = false;
  }

  _endUse(n) {
    const R = n.homeRoom, poi = n.poi;
    if (n.follower && n.group && !n.group.leader.gone) {
      // wait for the leader (they leave together)
      n.useT = 6 + this.rnd() * 8; return;
    }
    const again = poi && R && !n.leaving && !n.closingT && S.activityFits(poi, R.room, this.game.hour, this._wx()) && R.target > R.count - 0.5 && this.rnd() < ({ gamble: 0.55, view: 0.5, shop: 0.65, mingle: 0.45, dance: 0.5, swim: 0.6, drink: 0.25, relax: 0.2, play: 0.5 }[poi.act] || 0);
    if (again) {
      const pool = poi.act === 'swim' ? R.swim : poi.pose === 'stand' ? R.stands : R.seats;
      let best = null, bd = 1e9;
      for (let t = 0; t < 12; t++) { const p = pool[Math.floor(this.rnd() * pool.length)]; if (!p || p.taken || p.act !== poi.act) continue; const d = Math.hypot(p.x - n.x, p.z - n.z); if (d > 2 && d < bd) { bd = d; best = p; } }
      if (best) {
        this._releasePoi(n); best.taken = n.id;
        // stand up first
        n.y = this.world.floorY(n.deck, n.x, n.z);
        this.goUse(n, best);
        if (n.leader && n.group) this.pop.groupJoin(n.group, best, false);
        return;
      }
    }
    this.leave(n);
  }

  // ── roaming crew logic ────────────────────────────────────────────────
  roamNext(n) {
    const D = this.pop.decks[n.deck] || this.pop.deck(n.deck);
    const rnd = this.rnd;
    // shift over (night cleaners at dawn, stewards / lifeguards / day deckhands in the evening): go off duty
    const h = this.game.hour;
    const onShift = n.job === 'patrol' || n.job === 'waiter' ? true
      : n.job === 'cleaner' ? (h >= 23.3 || h < 6.7)
      : n.job === 'steward' ? (h >= 7.8 && h < 17.3)
      : n.job === 'lifeguard' ? (h >= 7.8 && h < 19.8)
      : n.job === 'deckhand' ? (n.roamKey && /:1\d$/.test(n.roamKey) ? (h >= 19.8 || h < 6.2) : (h >= 5.8 && h < 20.2)) : true;
    if (!onShift && !n.inCabin) { this._staffLeave(n); return; }
    n.state = 'walk'; n.goal = null;
    switch (n.job) {
      case 'patrol': {
        const pts = n.deck <= 3 ? D.crewPatrol : (D.patrol.length ? D.patrol : D.crewPatrol);
        if (!pts.length) { this.remove(n); return; }
        let i = n.wp ?? pts.reduce((b, p, k) => Math.abs(p.x - n.x) < Math.abs(pts[b].x - n.x) ? k : b, 0);
        n.wdir = n.wdir || (rnd() < 0.5 ? 1 : -1);
        if (rnd() < 0.15) n.wdir = -n.wdir;
        i += n.wdir * (1 + Math.floor(rnd() * 3));
        if (i < 0 || i >= pts.length) { n.wdir = -n.wdir; i = clamp(i, 0, pts.length - 1); }
        n.wp = i;
        n.goal = { type: 'roam', x: pts[i].x, z: pts[i].z, deck: n.deck, pause: 2 + rnd() * 6, anim: rnd() < 0.3 ? 'radio' : 'guard' };
        n.activity = 'patrolling';
        this.setAnim(n, 'walk', 'none');
        break;
      }
      case 'steward': {
        if (n.inCabin) {   // come back out to the cart
          n.goal = { type: 'roam', x: n.cartPark.x, z: n.cartPark.z, deck: n.deck, pause: 0.5, after: 'cart' };
          n.inCabin = false; n.activity = 'housekeeping'; break;
        }
        const cands = this.pop.anchorsNear(D, n.x, 0, 30, this._tmpA || (this._tmpA = [])).filter(a => a.kind === 'cabinOut' && Math.hypot(a.x - n.x, a.z - n.z) > 4);
        if (!cands.length) { this.remove(n); return; }
        const a = cands[Math.floor(rnd() * cands.length)];
        n.goal = { type: 'roam', x: a.x, z: a.z, deck: n.deck, pause: 1.5, after: 'cabin', anchor: a };
        n.activity = 'housekeeping'; n.pushing = true;
        break;
      }
      case 'waiter': {
        const g = n.shuttle;
        if (!g) { this.remove(n); return; }
        const pl = this.world.plans[n.deck];
        if (n.atGalley === false || n.atGalley === undefined) {
          // go to an occupied table: stand beside a seated diner
          const diners = this.list.filter(m => m.poi && m.poi.room === g.dining && m.state === 'use' && m.deck === n.deck);
          let target = null;
          if (diners.length) { const m = diners[Math.floor(rnd() * diners.length)]; const p = this.nav.nearestPoint(n.deck, m.x + Math.sin(m.yaw + 1.6) * 0.75, m.z + Math.cos(m.yaw + 1.6) * 0.75, n.mask, 3); if (p) target = { x: p.x, z: p.z, face: m }; }
          if (!diners.length && S.occupancy(pl.rooms[g.dining], this.game.hour).seat < 0.05) { this._staffLeave(n); return; }   // service over
          if (!target) target = this.nav.randomPointInRoom(n.deck, g.dining, rnd, n.mask, true);
          if (!target) { this.remove(n); return; }
          n.goal = { type: 'roam', x: target.x, z: target.z, deck: n.deck, pause: 2.5 + rnd() * 3, anim: 'carry_tray', held: 'tray', face: target.face, after: 'served' };
          n.held = 'tray';
          n.activity = 'serving';
        } else {
          // back to the galley side of the swing door
          const dr = g.door, gal = pl.rooms[g.galley];
          const nx = dr.normal === 'x' ? 1 : 0, nz = dr.normal === 'z' ? 1 : 0;
          const s = dr.normal === 'x' ? Math.sign(gal.cx - dr.x) : Math.sign(gal.cz - dr.z);
          const p = this.nav.nearestPoint(n.deck, dr.x + nx * s * 1.4, dr.z + nz * s * 1.4, n.mask, 3) || { x: dr.x, z: dr.z };
          n.goal = { type: 'roam', x: p.x, z: p.z, deck: n.deck, pause: 4 + rnd() * 5, anim: 'idle', after: 'galley' };
          n.held = 'tray'; n.goal.held = 'tray'; n.goal.anim = 'idle'; n.activity = 'returning to the galley';
        }
        break;
      }
      case 'deckhand': {
        const ext = D.plan.rooms.filter(r => r && r.exterior && r.zone !== 'private' && !r.pool && r.cells > 60 && Math.abs(r.cx - n.x) < 60);
        const r = ext[Math.floor(rnd() * ext.length)];
        const p = r && this.nav.randomPointInRoom(n.deck, r.id, rnd, n.mask);
        if (!p) { this.remove(n); return; }
        const night = S.isNight(this.game.hour);
        if (night && rnd() < 0.55) { n.goal = { type: 'roam', x: p.x, z: p.z, deck: n.deck, pause: 8 + rnd() * 10, anim: 'push_cart', held: 'none' }; n.held = 'none'; n.activity = 'stacking loungers'; }
        else { n.goal = { type: 'roam', x: p.x, z: p.z, deck: n.deck, pause: 6 + rnd() * 10, anim: 'sweep', held: 'mop' }; n.held = 'mop'; n.activity = 'cleaning the deck'; }
        break;
      }
      case 'cleaner': {
        // night cleaning crew: vacuum / mop public corridors and lounges, moving on every half minute
        const pub = D.plan.rooms.filter(r => r && r.zone === 'public' && !r.isVoid && r.type !== 'stair' && !r.exterior && r.cells > 30 && Math.abs(r.cx - n.x) < 50);
        const r = pub[Math.floor(rnd() * pub.length)];
        const p = r && this.nav.randomPointInRoom(n.deck, r.id, rnd, n.mask);
        if (!p) { this.remove(n); return; }
        n.goal = { type: 'roam', x: p.x, z: p.z, deck: n.deck, pause: 15 + rnd() * 25, anim: 'sweep', held: 'mop' };
        n.held = 'mop'; n.activity = 'cleaning';
        break;
      }
      case 'lifeguard': {
        const pools = D.plan.rooms.filter(r => r && r.pool && r.exterior !== false && Math.abs(r.cx - n.x) < 80);
        const r = pools[Math.floor(rnd() * pools.length)];
        if (!r) { this.remove(n); return; }
        const side = rnd() < 0.5 ? -1 : 1;
        const p = this.nav.nearestPoint(n.deck, r.cx + (rnd() - 0.5) * (r.x1 - r.x0), side > 0 ? r.z1 + 0.9 : r.z0 - 0.9, n.mask, 3);
        if (!p) { this.remove(n); return; }
        n.goal = { type: 'roam', x: p.x, z: p.z, deck: n.deck, pause: 20 + rnd() * 30, anim: 'guard', faceTo: { x: r.cx, z: p.z + (side > 0 ? -3 : 3) } };
        n.activity = 'lifeguarding';
        break;
      }
      default: this.remove(n); return;
    }
    this._startWalk(n);
  }

  _roamArrive(n) {
    const g = n.goal;
    n.state = 'pause'; n.timer = g.pause ?? 3; n.vx = n.vz = 0;
    if (g.face) n.yaw = Math.atan2(g.face.x - n.x, g.face.z - n.z);
    if (g.faceTo) n.yaw = Math.atan2(g.faceTo.x - n.x, g.faceTo.z - n.z);
    this.setAnim(n, g.anim || 'idle', g.held ?? n.held);
    if (n.job === 'steward' && g.after === 'cabin') {
      this._bark(n, 'housekeeping', true);
      n.cartPark = { x: n.cart ? n.cart.x : n.x, z: n.cart ? n.cart.z : n.z };
      n.pushing = false;
      // step into the cabin
      const a = g.anchor, D = this.pop.decks[n.deck];
      const dr = D.plan.doors[a.door];
      if (dr) {
        if (this.game.doors) this.game.doors.request(n.deck, dr.id, n); else this._fallbackOpen(n.deck, dr.id);
        const cab = D.plan.rooms[dr.rooms[0]]?.type === 'cabin' || D.plan.rooms[dr.rooms[0]]?.type === 'suite' ? dr.rooms[0] : dr.rooms[1];
        const p = this.nav.randomPointInRoom(n.deck, cab, this.rnd, n.mask | ACC.cabins, true);
        if (p) { n.goal = { type: 'roam', x: p.x, z: p.z, deck: n.deck, pause: 10 + this.rnd() * 14, anim: 'sweep', held: 'none', after: 'inside' }; n.timer = 1.6; n.next = 'walkgoal'; }
      }
    } else if (g.after === 'inside') { n.inCabin = true; }
    else if (g.after === 'cart') { n.pushing = true; n.timer = 0.3; }
    else if (g.after === 'served') {
      n.atGalley = true; n.trayFull = false; if (this.rnd() < 0.3) this._bark(n, 'waiter', false);
      // second table on the way back now and then (keeps waiters moving through the room)
      n.servedN = (n.servedN || 0) + 1;
      if (n.servedN % 2 === 1 && this.rnd() < 0.6) { n.atGalley = false; }
      n.timer = g.pause; n.next = null;
    }
    else if (g.after === 'galley') { n.atGalley = false; n.trayFull = true; }
  }

  // ── reactions ─────────────────────────────────────────────────────────
  react(n, evt) {
    if (n.gone || n.state === 'dead' || n.state === 'ko') return;
    const type = evt.type;
    const prevAlert = n.alert;
    switch (type) {
      case 'gunshot': case 'fight': case 'scream': case 'explosion': case 'alarm': {
        const sev = type === 'gunshot' || type === 'explosion' ? 1 : type === 'fight' ? 0.6 : type === 'alarm' ? 0.5 : 0.7;
        n.alert = Math.min(1, n.alert + sev);
        if (n.kind === 'mission' && !evt.force) { this.bus.emit('npc:alerted', { npc: n, evt }); if (n.noFlee) return; }
        if (n.job === 'guard' || n.job === 'patrol') {
          n.respond = { ...evt, t: this.time };
          this.bus.emit('npc:respond', { npc: n, evt });
          if (!n.persistent && evt.x !== undefined && type !== 'alarm') {
            this._releasePoi(n); n.goal = { type: 'move', deck: evt.deck ?? n.deck, x: evt.x, z: evt.z, respond: true }; n.run = true; this._startWalk(n);
            this.setAnim(n, 'run', 'none');
          }
          return;
        }
        if (type === 'alarm' && n.kind !== 'pax') return;
        if (n.state === 'flee' || n.state === 'cower') { n.timer = Math.max(n.timer, 4); return; }
        const d = evt.x !== undefined ? Math.hypot(evt.x - n.x, evt.z - n.z) : 20;
        const cower = type === 'gunshot' ? (d < 12 ? 0.45 : 0.2) : type === 'fight' ? 0.05 : 0.15;
        this._flee(n, evt, this.rnd() < cower + (n.persona.nervous ? 0.15 : 0));
        if (prevAlert < 0.5 && this.rnd() < 0.35) {
          this._bark(n, 'scream', true);
          if (type !== 'scream') this._chainScream = { x: n.x, y: n.y, z: n.z, deck: n.deck };
        }
        break;
      }
      case 'body': {
        if (n.reported) return;
        n.reported = true; n.alert = Math.min(1, n.alert + 0.8);
        this._bark(n, this.rnd() < 0.5 ? 'body' : 'scream', true);
        this.bus.emit('npc:report', { npc: n, evt, kind: 'body' });
        if (n.job === 'guard' || n.job === 'patrol') { n.respond = { ...evt, t: this.time }; this.bus.emit('npc:respond', { npc: n, evt }); return; }
        if (n.kind !== 'mission' || !n.noFlee) this._flee(n, evt, this.rnd() < 0.2);
        this._chainScream = { x: n.x, y: n.y, z: n.z, deck: n.deck };
        break;
      }
      case 'bump': {
        if (n.bumpCD > 0) return;
        n.bumpCD = 2.5;
        n.alert = Math.min(1, n.alert + 0.1);
        this.bus.emit('npc:bumped', { npc: n, by: evt.source || null });
        if (n.state === 'use' && (n.poi?.pose === 'sit' || n.poi?.pose === 'lie')) { this._bark(n, n.persona.rude ? 'bump' : 'bumpPolite', true); return; }
        if (n.state === 'flee' || n.state === 'stagger') return;
        n.prev = { state: n.state, anim: n.anim, held: n.held, speed: n.animSpeed, timer: n.timer };
        n.state = 'stagger'; n.timer = 0.7;
        const sx = evt.x ?? n.x - Math.sin(n.yaw), sz = evt.z ?? n.z - Math.cos(n.yaw);
        const dx = n.x - sx, dz = n.z - sz, l = Math.hypot(dx, dz) || 1;
        n.vx = dx / l * 1.1; n.vz = dz / l * 1.1;
        this.setAnim(n, 'stagger', n.held, 0.6);
        this._bark(n, n.persona.friendly && !n.persona.rude ? 'bumpPolite' : 'bump', true);
        break;
      }
      case 'shove': case 'hit': {
        n.alert = Math.min(1, n.alert + 0.5);
        n.health -= evt.damage || 0;
        if (n.health <= 0) { this.kill(n, evt); return; }
        n.prev = null; n.state = 'stagger'; n.timer = 0.6; this.setAnim(n, 'hit_react', 'none');
        n.after = 'flee'; n.fleeFrom = evt;
        break;
      }
      case 'calm': {
        n.alert = 0;
        if (n.state === 'flee' || n.state === 'cower') { if (n.persistent) { n.state = 'idle'; n.timer = 2; this.setAnim(n, 'idle'); } else this.leave(n); }
        break;
      }
      case 'handsUp': {   // aimed at
        n.alert = 1; n.prev = null; n.state = 'cower'; n.timer = evt.duration ?? 8; this.setAnim(n, 'hands_up', 'none');
        break;
      }
      default: break;
    }
  }

  _flee(n, from, cower) {
    this._releasePoi(n);
    if (n.group && n.leader) for (const m of n.group.members) if (m !== n && !m.gone && m.state !== 'flee') { m.follower = false; }
    n.group = null; n.follower = false; n.leader = false;
    if (n.pendingUse) { n.pendingUse.taken = null; n.pendingUse = null; }
    n.y = this.world.floorY(n.deck, n.x, n.z);
    n.fleeFrom = { x: from.x ?? n.x, z: from.z ?? n.z };
    n.activity = 'fleeing';
    if (cower) { n.state = 'cower'; n.timer = 4 + this.rnd() * 8; n.after = 'flee'; this.setAnim(n, 'cower', 'none'); return; }
    // pick an exit away from the source
    const D = this.pop.decks[n.deck] || this.pop.deck(n.deck);
    const cands = this.pop.anchorsNear(D, n.x, 0, 60, this._tmpF || (this._tmpF = []));
    let best = null, bs = -1e9;
    const sx = n.fleeFrom.x, sz = n.fleeFrom.z;
    for (let t = 0; t < 30 && cands.length; t++) {
      const a = cands[Math.floor(this.rnd() * cands.length)];
      const room = D.plan.rooms[a.room]; if (!room) continue;
      if (!(n.mask & ACC.crew) && (room.zone === 'crew' || room.zone === 'restricted')) continue;
      if (a.kind === 'cabinIn') continue;
      const dn = Math.hypot(a.x - n.x, a.z - n.z); if (dn < 6) continue;
      const away = ((a.x - n.x) * (n.x - sx) + (a.z - n.z) * (n.z - sz)) / (dn * (Math.hypot(n.x - sx, n.z - sz) || 1));
      const crowd = this.fleeTargets.get(a) || 0;
      const s = away * 30 + Math.min(dn, 40) * 0.5 + (a.kind === 'stair' || a.kind === 'elevator' ? 6 : 0) + (a.kind === 'cabinOut' ? 4 : 0) + (a.cabin && a.cabin === n.own ? 25 : 0) + this.rnd() * 10 - crowd * 4;
      if (s > bs) { bs = s; best = a; }
    }
    n.state = 'flee'; n.run = true;
    const spd = n.appearance?.age === 'elderly' ? 2.2 : n.appearance?.age === 'child' ? 3.6 : 4.2 + n.r * 1.2;
    n.fleeSpeed = spd;
    this.setAnim(n, n.appearance?.age === 'elderly' ? 'run' : 'flee', 'none');
    if (best) {
      this.fleeTargets.set(best, (this.fleeTargets.get(best) || 0) + 1); this.fleeT = this.time;
      n.goal = { type: 'exit', exit: best, deck: n.deck, x: best.x, z: best.z, flee: true }; n.path = null; this._requestPath(n, best.x, best.z, true);
    }
    else { n.state = 'cower'; n.timer = 8; this.setAnim(n, 'cower', 'none'); }
    n.timer = 25;
  }

  kill(n, evt = {}) {
    this._releasePoi(n);
    n.health = 0; n.state = 'dead'; n.activity = 'dead'; n.vx = n.vz = 0;
    n.y = this.world.floorY(n.deck, n.x, n.z);
    this.setAnim(n, 'dead', 'none');
    n.persistent = true;   // bodies stay until removed by other systems
    this.bus.emit('npc:dead', { npc: n, by: evt.source || null, x: n.x, y: n.y, z: n.z, deck: n.deck });
  }
  knockOut(n, seconds = 30, evt = {}) {
    this._releasePoi(n);
    n.state = 'ko'; n.timer = seconds; n.activity = 'unconscious'; n.vx = n.vz = 0;
    n.y = this.world.floorY(n.deck, n.x, n.z);
    this.setAnim(n, 'knocked_out', 'none');
    n.persistent = true;
    this.bus.emit('npc:ko', { npc: n, by: evt.source || null, x: n.x, y: n.y, z: n.z, deck: n.deck });
  }

  broadcast(type, x, y, z, deck, radius = 20, extra = {}) {
    const evt = { type, x, y, z, deck, radius, ...extra };
    let hit = 0;
    const sight = type === 'body' || type === 'crime_seen';
    for (let i = 0; i < this.list.length; i++) {
      const n = this.list[i]; if (n.gone || n === extra.source) continue;
      if (Math.abs(n.deck - deck) > 1) continue;
      const dx = n.x - x, dz = n.z - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      if (sight) { if (!n.canSee(x, y, z, deck)) continue; }
      else if (!n.hears(x, z, deck, radius)) continue;
      n.onEvent(evt); hit++;
    }
    return hit;
  }

  // ── removal ───────────────────────────────────────────────────────────
  remove(n) {
    if (typeof n === 'number') n = this.byId.get(n);
    if (!n || n.gone) return;
    n.gone = true;
    this._releasePoi(n);
    if (n.pendingUse) { n.pendingUse.taken = null; n.pendingUse = null; }
    if (n.post && n.post.taken === n.id) n.post.taken = null;
    if (n.pathReq) n.pathReq.cancelled = true;
    if (n.roamKey) this.roamers.delete(n.roamKey);
    if (n.cart) this._cartFree(n.cart);
    if (n.group) {
      const g = n.group; g.members = g.members.filter(m => m !== n);
      if (g.leader === n && g.members.length) {
        // an adult of the group takes over and the rest (children above all) follow them out
        const nl = g.members.find(m => !m.gone && m.appearance?.age !== 'child');
        if (nl) {
          g.leader = nl; nl.leader = true; nl.follower = false; nl.groupSize = g.members.length;
          for (const m of g.members) if (m !== nl && !m.gone) { m.follower = true; if (m.state !== 'use') this.followLeader(m); }
          if (n.exitAnchor) { nl.leaving = true; this.goExit(nl, n.exitAnchor); } else if (nl.state === 'follow' || nl.state === 'idle') this.leave(nl);
        } else {
          // only children left: they leave together towards the same exit, out of sight they vanish
          for (const m of g.members) { m.group = null; m.follower = false; if (!this.seen(m.deck, m.x, m.y + 1, m.z)) this.remove(m); else if (n.exitAnchor) { m.leaving = true; this.goExit(m, n.exitAnchor); } else this.leave(m); }
        }
      }
    }
    if (n.charId >= 0 && this.game.chars) { this.game.chars.remove(n.charId); this.byChar.delete(n.charId); }
    n.charId = -1;
    this.byId.delete(n.id);
    this.bus.emit('npc:despawn', { npc: n });
  }

  // ── per-frame update ──────────────────────────────────────────────────
  update(dt) {
    const t0 = performance.now();
    if (!(dt > 0)) { return; }
    dt = Math.min(dt, 0.1);
    this.time += dt; this.nav.time = this.time; this.frame++;
    this._updateFocus();
    this.nav.process(this.pop.warm ? 10 : 4, this.pop.warm ? 3 : 1.1);
    this.pop.update(dt, this.focus);
    // weather shelter / muster drill: a few re-routes per tick catch people who spawned or wandered in since
    if (this.shelter && this.frame % 10 === 0) this.shelterSweep(6);
    if (this.frame % 6 === 3) this._fitSweep(6);
    if (!this.pop.warm && this.frame % 3 === 1) this.pop.prebuild();
    if (this.muster && this.frame % 10 === 5) this.musterSweep(4);
    this._buildHash();
    const f = this.focus, list = this.list;
    const pl = this.game.player;
    this._plx = pl && Number.isFinite(pl.x) && !this.game.debugCam ? pl : null;
    for (let i = 0; i < list.length; i++) {
      const n = list[i]; if (n.gone) continue;
      const dx = n.x - f.x, dz = n.z - f.z, d2 = dx * dx + dz * dz;
      const dd = Math.abs(n.deck - f.deck);
      n.lod = dd === 0 ? (d2 < NEAR * NEAR ? 0 : d2 < MID * MID ? 1 : 2) : (dd === 1 && d2 < 30 * 30 ? 1 : 2);
      n.acc += dt;
      const think = n.lod === 0 || (n.lod === 1 && (this.frame + i) % 3 === 0) || ((this.frame + i) % 8 === 0) || n.state === 'flee' && n.lod < 2;
      if (think) { const a = Math.min(n.acc, 0.35); n.acc = 0; n.t += a; this._think(n, a); }
      else if (n.speed > 0.05 && n.state !== 'use' && n.state !== 'stairs') {
        const rs = dd <= 1 ? this._resolve(n, n.x + n.vx * dt, n.z + n.vz * dt) : null;
        if (rs) { n.x = rs.x; n.z = rs.z; }
        else if (dd > 1) { const ex = n.x + n.vx * dt, ez = n.z + n.vz * dt; if (this.nav.stepOk(n.deck, n.x, n.z, ex, ez, n.mask, n.swim, n.own)) { n.x = ex; n.z = ez; } else { n.vx = n.vz = 0; } }
        else { n.vx = n.vz = 0; }
      }
      if (n.gone) continue;
      // culling: far & unseen ambient
      if (!n.persistent && ((this.frame + i) & 15) === 0) this._cullCheck(n, d2, dd);
      if (!n.gone) this._syncChar(n, false);
    }
    // compact
    if (this.frame % 4 === 0) this._compact();
    this._tickDoors();
    if (this.fleeTargets.size && this.time - this.fleeT > 30) this.fleeTargets.clear();
    this._ambientBarks(dt);
    if (this._chainScream) { const c = this._chainScream; this._chainScream = null; this.broadcast('scream', c.x, c.y, c.z, c.deck, 14); }
    this._updateCarts();
    const ms = performance.now() - t0;
    this.msHist[this.msI++ % this.msHist.length] = ms; this.msMax = Math.max(this.msMax * 0.995, ms);
  }

  purgeFar() {
    const f = this.focus;
    for (const n of this.list) {
      if (n.gone || n.persistent) continue;
      const dd = Math.abs(n.deck - f.deck), d = Math.hypot(n.x - f.x, n.z - f.z);
      if ((dd > 1 || d > 40 || (dd === 1 && d > 25)) && !this.seen(n.deck, n.x, n.y + 1, n.z)) this.remove(n);
    }
    this._compact();
  }
  _compact() { const list = this.list; let w = 0; for (let r = 0; r < list.length; r++) if (!list[r].gone) list[w++] = list[r]; list.length = w; }

  _cullCheck(n, d2, dd) {
    const far = n.kind === 'staff' ? 80 : n.kind === 'roamer' ? 95 : 88;
    if (dd > 1 || d2 > far * far || (dd === 1 && d2 > 50 * 50)) {
      if (!this.seen(n.deck, n.x, n.y + 1, n.z)) this.remove(n);
    }
  }

  _think(n, dt) {
    if (n.bumpCD > 0) n.bumpCD -= dt;
    if (n.barkCD > 0) n.barkCD -= dt;
    n.alert = Math.max(0, n.alert - dt * 0.01);
    switch (n.state) {
      case 'walk': case 'flee': this._walk(n, dt); break;
      case 'approach': this._approach(n, dt); break;
      case 'standup': {
        n.apT += dt * 2.2; const t = Math.min(1, n.apT);
        n.x = n.apx + (n.upx - n.apx) * t; n.z = n.apz + (n.upz - n.apz) * t; n.y = this.world.floorY(n.deck, n.x, n.z);
        n.speed = 0.5; this.setAnim(n, 'walk', n.held, 0.5);
        if (t >= 1) { this._updateRoom(n); if (n.goal) this._startWalk(n); else { n.state = 'idle'; n.timer = 1; } }
        break;
      }
      case 'use': this._use(n, dt); break;
      case 'follow': this._follow(n, dt); break;
      case 'stairs': this._stairs(n, dt); break;
      case 'wait': this._waitDoor(n, dt); break;
      case 'pause':
        n.timer -= dt; n.speed = 0;
        if (n.timer <= 0) { if (n.next === 'walkgoal') { n.next = null; this._startWalk(n); } else this.roamNext(n); }
        break;
      case 'stagger': {
        n.timer -= dt;
        const rs = this._resolve(n, n.x + n.vx * dt, n.z + n.vz * dt);
        if (rs) { n.x = rs.x; n.z = rs.z; }
        n.vx *= 0.9; n.vz *= 0.9; n.speed = Math.hypot(n.vx, n.vz);
        if (n.timer <= 0) {
          n.speed = 0; n.vx = n.vz = 0;
          if (n.after === 'flee') { n.after = null; this._flee(n, n.fleeFrom || n, false); break; }
          const p = n.prev; n.prev = null;
          if (p) { n.state = p.state; n.timer = p.timer; this.setAnim(n, p.anim === 'stagger' ? 'idle' : p.anim, p.held, p.speed); if (n.state === 'walk' && n.goal) this._startWalk(n); }
          else { n.state = 'idle'; n.timer = 1; this.setAnim(n, 'idle'); }
        }
        break;
      }
      case 'cower':
        n.timer -= dt; n.speed = 0;
        if (n.timer <= 0) { if (n.after === 'flee' && n.alert > 0.3) { n.after = null; this._flee(n, n.fleeFrom || n, false); } else if (n.persistent) { n.state = 'idle'; n.timer = 2; this.setAnim(n, 'idle'); } else this.leave(n); }
        break;
      case 'hidden':
        n.timer -= dt;
        if (n.timer <= 0) this._elevatorArrive(n);
        break;
      case 'ko':
        n.timer -= dt;
        if (n.timer <= 0) { n.state = 'idle'; n.timer = 3; n.health = Math.max(n.health, 30); this.setAnim(n, 'idle'); n.alert = 1; this.bus.emit('npc:wake', { npc: n }); }
        break;
      case 'dead': break;
      case 'idle': default: {
        n.speed = 0;
        if (((this.frame + n.id) & 7) === 0) this._settle(n);
        if (n.timer !== Infinity) n.timer -= dt;
        if (n.timer <= 0) {
          if (n.kind === 'mission') { if (n.goal?.type === 'wander') this._wander(n); else n.timer = Infinity; }
          else if (n.kind === 'roamer') this.roamNext(n);
          else if (n.kind === 'staff') { if (n.post && !n.post.taken) this.goUse(n, n.post); else this._staffLeave(n); }
          else this.leave(n);
        }
        if (n.goal?.type === 'follow' && n.state === 'idle') { n.state = 'follow'; }
        break;
      }
    }
  }

  _wander(n) {
    const room = n.goal.room ?? n.roomId;
    const p = this.nav.randomPointInRoom(n.deck, room, this.rnd, n.mask);
    if (!p) { n.timer = 4; return; }
    n.goal = { type: 'wander', room, deck: n.deck, x: p.x, z: p.z, sub: true };
    this._startWalk(n);
  }

  _staffLeave(n) {
    this._releasePoi(n);
    if (n.post?.taken === n.id) n.post.taken = null;
    const D = this.pop.decks[n.deck];
    let ex = null;
    if (D) { const c = this.pop.anchorsNear(D, n.x, 0, 40, this._tmpS || (this._tmpS = [])); let bd = 1e9; for (const a of c) { if (!a.crew) continue; const d = Math.hypot(a.x - n.x, a.z - n.z); if (d > 2 && d < bd) { bd = d; ex = a; } } }
    if (!ex) { if (!this.seen(n.deck, n.x, n.y + 1, n.z)) this.remove(n); else { n.state = 'idle'; n.timer = 10; } return; }
    n.leaving = true; n.activity = 'going off shift'; this.goExit(n, ex);
  }

  // ── movement ──────────────────────────────────────────────────────────
  _walk(n, dt) {
    if (n.state === 'flee') {
      n.timer -= dt;
      if (n.timer <= 0 && !n.persistent) {
        if (!this.seen(n.deck, n.x, n.y + 1, n.z)) { this.remove(n); return; }
        n.timer = 3;
      }
    }
    const path = n.path;
    if (!path) {
      // waiting for a path: idle in place (but don't freeze a fleeing NPC visually)
      n.vx *= 0.7; n.vz *= 0.7; n.speed = Math.hypot(n.vx, n.vz);
      if (n.state !== 'flee') this.setAnim(n, n.carry || 'idle', n.held, 0);
      if (!n.pathReq && n.goal) this._startWalk(n);
      return;
    }
    const last = path.length - 2;
    let tx = path[n.pi * 2], tz = path[n.pi * 2 + 1];
    let dx = tx - n.x, dz = tz - n.z, dist = Math.hypot(dx, dz);
    while (n.pi * 2 < last && dist < 0.55) { n.pi++; tx = path[n.pi * 2]; tz = path[n.pi * 2 + 1]; dx = tx - n.x; dz = tz - n.z; dist = Math.hypot(dx, dz); }
    const final = n.pi * 2 >= last;
    const arriveR = n.goal?.type === 'use' ? 0.45 : n.goal?.type === 'exit' ? 0.7 : 0.35;
    if (final && dist < arriveR) { this._arrive(n); return; }
    // corner smoothing: blend toward the next waypoint when close
    let dirx = dx / (dist || 1), dirz = dz / (dist || 1);
    if (!final && dist < 1.0) {
      const nx2 = path[n.pi * 2 + 2] - n.x, nz2 = path[n.pi * 2 + 3] - n.z, l2 = Math.hypot(nx2, nz2) || 1;
      const w = 1 - dist; dirx = dirx * (1 - w * 0.5) + nx2 / l2 * w * 0.5; dirz = dirz * (1 - w * 0.5) + nz2 / l2 * w * 0.5;
      const l = Math.hypot(dirx, dirz) || 1; dirx /= l; dirz /= l;
    }
    let spd = n.state === 'flee' ? n.fleeSpeed : n.run ? 3.6 : n.jogger ? 2.7 + n.r * 0.6 : n.walkSpeed;
    if (n.leader && n.group) spd = Math.min(spd, n.walkSpeed * 0.92);
    if (final && dist < 1.2 && n.state !== 'flee') spd *= Math.max(0.45, dist / 1.2);
    // steering & avoidance
    const slow = this._avoid(n, dirx, dirz, spd);
    const ax = this._ax, az = this._az;
    spd *= n.state === 'flee' ? Math.max(0.7, slow) : slow;
    if (n.persona.drunk && n.state !== 'flee') { const w = Math.sin(n.t * 1.7 + n.r * 9) * 0.35; const ox = ax, oz = az; this._ax = ox + (-oz) * w; this._az = oz + ox * w; }
    const tvx = this._ax * spd, tvz = this._az * spd;
    const k = Math.min(1, dt * (n.state === 'flee' ? 8 : 5));
    n.vx += (tvx - n.vx) * k; n.vz += (tvz - n.vz) * k;
    // doors on the way
    if (this._doorAhead(n, dirx, dirz)) { n.vx = n.vz = 0; n.speed = 0; n.state = n.state === 'flee' ? 'flee' : 'wait'; n.waitT = 0; this.setAnim(n, 'idle', n.held, 0); return; }
    this._move(n, dt);
    // facing
    if (n.speed > 0.15) { const ty = Math.atan2(n.vx, n.vz); n.yaw += angDiff(n.yaw, ty) * Math.min(1, dt * 9); }
    // anim
    const anim = n.state === 'flee' ? n.anim : n.run || n.jogger ? 'run' : n.pushing ? 'push_cart' : n.held === 'tray' ? 'carry_tray' : n.talkWalk ? 'talk' : n.luggage ? 'walk' : 'walk';
    this.setAnim(n, anim, n.luggage ? 'luggage' : n.held, n.speed);
    this._progress(n, dt, tx, tz);
    this._footstep(n, dt);
  }

  // steering: returns speed factor, writes desired direction into this._ax/_az
  _avoid(n, dirx, dirz, spd) {
    let sx = 0, sz = 0, side = 0, slow = 1;
    const rx = -dirz, rz = dirx;      // right-hand vector
    const hx = Math.floor((n.x + 165) / 2), hz = Math.floor((n.z + 25) / 2), hd = n.deck - this.focus.deck + 1;
    if (hd >= 0 && hd <= 2 && n.lod < 2) {
      const base = hd * this.HX * this.HZ;
      for (let a = hx - 1; a <= hx + 1; a++) {
        if (a < 0 || a >= this.HX) continue;
        for (let b = hz - 1; b <= hz + 1; b++) {
          if (b < 0 || b >= this.HZ) continue;
          for (let j = this.head[base + b * this.HX + a]; j >= 0; j = this.next[j]) {
            const o = this.arr[j]; if (o === n || o.gone) continue;
            const ox = o.x - n.x, oz = o.z - n.z, d2 = ox * ox + oz * oz;
            if (d2 > 6.25 || d2 < 1e-6) continue;
            const d = Math.sqrt(d2), rr = n.rad + o.rad;
            const sameGroup = n.group && o.group === n.group;
            if (d < rr + 0.12) { const w = (rr + 0.12 - d) / rr * (o.state === 'use' ? 3 : n.state === 'flee' ? 1 : 2); sx -= ox / d * w; sz -= oz / d * w; }
            const ahead = ox * dirx + oz * dirz;
            if (ahead <= 0 || ahead > 2.4 || sameGroup) continue;
            const lat = ox * rx + oz * rz;
            if (Math.abs(lat) > rr + 0.3) continue;
            const ov = o.vx * dirx + o.vz * dirz;
            const wgt = 1 - ahead / 2.4;
            if (ov < -0.25) side += wgt * 1.4;                                          // oncoming: keep right
            else if (ov < spd * 0.7) {                                                    // slower / standing: overtake on the free side
              side += (lat > 0 ? -1 : 1) * wgt * 1.6;
              if (ahead < rr + 0.6) slow = Math.min(slow, clamp((ahead - rr) / 0.7, 0.25, 1));
            }
          }
        }
      }
    }
    // the player: everybody gives way
    const p = this._plx;
    if (p && p.deck === n.deck) {
      const ox = p.x - n.x, oz = p.z - n.z, d2 = ox * ox + oz * oz;
      if (d2 < 9) {
        const d = Math.sqrt(d2) || 0.01, rr = n.rad + 0.34;
        if (d < rr + 0.2) { const w = (rr + 0.2 - d) / rr * 2.5; sx -= ox / d * w; sz -= oz / d * w; }
        const ahead = ox * dirx + oz * dirz, lat = ox * rx + oz * rz;
        if (ahead > 0 && ahead < 2.8 && Math.abs(lat) < rr + 0.45) { side += (lat > 0 ? -1 : 1) * (1 - ahead / 2.8) * 2.2; if (ahead < 1.2) slow = Math.min(slow, 0.5); }
        const ps = Math.hypot(p.vx || 0, p.vz || 0);
        if (d < rr + 0.05 && ps > 1.6 && n.bumpCD <= 0) this.react(n, { type: 'bump', source: p, x: p.x, z: p.z });
      }
    }
    // gentle keep-right bias in corridors
    if (n.room && (n.room.dens === 'transit' || n.room.dens === 'crewtransit')) side += 0.18;
    // lateral room check: don't side-step into walls / furniture
    if (side !== 0) {
      const sg = side > 0 ? 1 : -1;
      if (!this.nav.stepOk(n.deck, n.x, n.z, n.x + rx * sg * 0.45 + dirx * 0.25, n.z + rz * sg * 0.45 + dirz * 0.25, n.mask, n.swim, n.own)) side *= 0.1;
    }
    let ax = dirx + rx * side * 0.55 + sx, az = dirz + rz * side * 0.55 + sz;
    let l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
    if (!this.nav.stepOk(n.deck, n.x, n.z, n.x + ax * 0.4, n.z + az * 0.4, n.mask, n.swim, n.own)) { ax = dirx; az = dirz; }
    // never steer backwards into the wall we're facing
    if (ax * dirx + az * dirz < -0.2) { ax = dirx * 0.3 + ax * 0.7; az = dirz * 0.3 + az * 0.7; const l2 = Math.hypot(ax, az) || 1; ax /= l2; az /= l2; }
    this._ax = ax; this._az = az;
    return slow;
  }

  // wall-safe position update: the steering result never crosses a wall edge, and the body circle is pushed
  // out of walls / closed doors (world.collide) after steering — avoidance can't shove people into wall cells
  _resolve(n, nx, nz) {
    const nav = this.nav, d = n.deck, m = n.mask, sw = n.swim;
    {
      const c = this.world.collide(d, nx, nz, n.rad * 0.85, { ignoreItems: true });
      if (c.hit && nav.stepOk(d, n.x, n.z, c.x, c.z, m, sw, n.own)) { nx = c.x; nz = c.z; }
    }
    if (nav.stepOk(d, n.x, n.z, nx, nz, m, sw, n.own)) return this._res(nx, nz);
    // axis slides
    if (nav.stepOk(d, n.x, n.z, nx, n.z, m, sw, n.own)) return this._res(nx, n.z);
    if (nav.stepOk(d, n.x, n.z, n.x, nz, m, sw, n.own)) return this._res(n.x, nz);
    return null;
  }
  _res(x, z) { const r = this._rr || (this._rr = { x: 0, z: 0 }); r.x = x; r.z = z; return r; }
  _move(n, dt) {
    let nx = n.x + n.vx * dt, nz = n.z + n.vz * dt;
    let r = this._resolve(n, nx, nz);
    if (!r && n.path) {
      // fall back to the pure path direction
      const tx = n.path[n.pi * 2] - n.x, tz = n.path[n.pi * 2 + 1] - n.z, tl = Math.hypot(tx, tz) || 1, sp = Math.max(0.4, Math.hypot(n.vx, n.vz)) * dt;
      r = this._resolve(n, n.x + tx / tl * sp, n.z + tz / tl * sp);
      if (r) { n.vx = (r.x - n.x) / dt; n.vz = (r.z - n.z) / dt; }
    }
    if (r) { nx = r.x; nz = r.z; } else { nx = n.x; nz = n.z; n.vx *= 0.5; n.vz *= 0.5; }
    // final body push-out (a second pass catches jamb corners the slide put us against)
    { const c = this.world.collide(n.deck, nx, nz, n.rad * 0.8, { ignoreItems: true }); if (c.hit && this.nav.stepOk(n.deck, nx, nz, c.x, c.z, n.mask, n.swim, n.own)) { nx = c.x; nz = c.z; } }
    if (!this.nav.passable(n.deck, nx, nz, n.mask, n.swim)) {
      const q = this.nav.nearestPoint(n.deck, nx, nz, n.mask, 2);
      if (q) { if (!n._snapLog) { n._snapLog = 1; this.snapCount = (this.snapCount || 0) + 1; this.lastSnap = [n.name, n.state, n.spawnKind, nx.toFixed(1), nz.toFixed(1)]; } nx = q.x; nz = q.z; }
    }
    const mvx = nx - n.x, mvz = nz - n.z;
    n.speed = Math.hypot(mvx, mvz) / dt;
    n.x = nx; n.z = nz;
    const rid = this.world.roomId(n.deck, nx, nz);
    if (rid !== n.roomId) this._updateRoom(n);
    n.y = this.world.floorY(n.deck, nx, nz);
  }
  // keep a standing NPC's body out of walls / door leaves (waiting at a door, idling next to a wall)
  _settle(n) {
    if (n.state === 'use') return;
    const c = this.world.collide(n.deck, n.x, n.z, n.rad * 0.85, { ignoreItems: true });
    if (c.hit && this.nav.stepOk(n.deck, n.x, n.z, c.x, c.z, n.mask, n.swim, n.own)) { n.x = c.x; n.z = c.z; }
  }

  _progress(n, dt, tx, tz) {
    n.cpT += dt;
    if (n.cpT >= 1.25) {
      const moved = Math.hypot(n.x - n.cpx, n.z - n.cpz);
      n.cpx = n.x; n.cpz = n.z; n.cpT = 0;
      if (moved < 0.3) n.stuckT += 1.25; else { n.stuckT = 0; n.stuck = false; }
      if (n.stuckT >= 5) {
        n.stuck = true;
        if (n.stuckT >= 5 && n.stuckT < 6.3 && n.goal) { this._startWalk(n); n.stuckT = 5.01; }
        if (n.stuckT >= 12) {
          n.stuckT = 0; n.stuck = false;
          if (!n.persistent && !this.seen(n.deck, n.x, n.y + 1, n.z)) { this.remove(n); return; }
          if (n.goal?.type === 'use' && n.kind === 'pax') { this._releasePoi(n); this.leave(n); }
          else if (n.goal) { const p = this.nav.nearestPoint(n.deck, n.x + (this.rnd() - 0.5), n.z + (this.rnd() - 0.5), n.mask, 3); if (p) { n.x = p.x; n.z = p.z; } this._startWalk(n); }
        }
      }
    }
  }

  // detect a closed door between our cell and the cell ahead; ask it to open
  _doorAhead(n, dirx, dirz) {
    const plan = this.world.plans[n.deck];
    const ci = toI(n.x), cj = toJ(n.z), li = toI(n.x + dirx * 0.6), lj = toJ(n.z + dirz * 0.6);
    let door = -1;
    if (li !== ci) { const k = cj * NX + Math.min(ci, li); if (plan.ex[k] === 2) door = plan.dx[k]; }
    if (door < 0 && lj !== cj) { const k = Math.min(cj, lj) * NX + ci; if (plan.ez[k] === 2) door = plan.dz[k]; }
    if (door < 0) return false;
    n.doorId = door;
    const s = this.world.doorState.get(this.world.doorKey(n.deck, door));
    if (s && s._npcFallback) s.lastUse = this.time;
    if (!this.world.doorBlocks(n.deck, door)) return false;
    if (this.game.doors) {
      if (this.time - n.doorReqT > 0.6) {
        n.doorReqT = this.time;
        let ok = true;
        try { ok = this.game.doors.request(n.deck, door, n); } catch { ok = false; }
        if (ok === false) { this.nav.blockDoor(n.deck, door, 25); if (n.goal) this._startWalk(n); return true; }
      }
      return true;
    }
    this._fallbackOpen(n.deck, door);
    return false;
  }
  _fallbackOpen(deck, id) {
    const s = this.world.door(deck, id);
    if (s.lockedState && s.type !== 'cabin' && s.type !== 'crew') return;
    s.open = 1; s.target = 1; s.lastUse = this.time; s._npcFallback = true;
    this.fallbackDoors.add(s);
  }
  _tickDoors() {
    if (this.game.doors || !this.fallbackDoors.size) return;
    for (const s of this.fallbackDoors) if (this.time - s.lastUse > 3) { s.open = 0; s.target = 0; this.fallbackDoors.delete(s); }
  }
  _waitDoor(n, dt) {
    n.waitT += dt;
    this._settle(n);
    if (n.doorId >= 0 && !this.world.doorBlocks(n.deck, n.doorId)) { n.state = 'walk'; return; }
    if (n.waitT > 3.5) { this.nav.blockDoor(n.deck, n.doorId, 20); n.state = 'walk'; if (n.goal) this._startWalk(n); }
  }

  _arrive(n) {
    const g = n.goal;
    n.vx *= 0.3; n.vz *= 0.3;
    if (n.laneTo) { const L = n.laneTo; n.laneTo = null; n.lane = { L, toX: L.xt + L.dir * 0.8, z: L.zc, thenGoal: true, dir: L.dir }; n.state = 'stairs'; return; }
    if (n.elevTo) { this._elevatorDepart(n); return; }
    if (!g) { n.state = 'idle'; n.timer = 2; return; }
    switch (g.type) {
      case 'use': n.state = 'approach'; n.apT = 0; n.apx = n.x; n.apz = n.z; break;
      case 'exit': this._exitReached(n); break;
      case 'roam': this._roamArrive(n); break;
      case 'wander': n.state = 'idle'; n.timer = 3 + this.rnd() * 8; n.goal = { type: 'wander', room: g.room }; this.setAnim(n, this.rnd() < 0.3 ? 'phone' : 'idle'); break;
      case 'patrol': n.state = 'idle'; n.timer = g.points[g.i].pause ?? 2; this.setAnim(n, 'idle'); n._patrolNext = true; break;
      case 'move':
        n.state = 'idle'; n.timer = g.respond ? 8 : Infinity; n.run = false; this.setAnim(n, g.respond ? 'radio' : (g.anim || 'idle'));
        if (g.yaw !== undefined) n.yaw = g.yaw;
        this.bus.emit('npc:arrived', { npc: n, goal: g });
        if (g.respond) { n.goal = null; }
        break;
      default: n.state = 'idle'; n.timer = 2;
    }
  }

  _approach(n, dt) {
    const poi = n.goal?.poi; if (!poi) { n.state = 'idle'; n.timer = 1; return; }
    n.apT += dt * 2.4;
    const t = Math.min(1, n.apT);
    n.x = n.apx + (poi.x - n.apx) * t; n.z = n.apz + (poi.z - n.apz) * t;
    n.y = this.world.floorY(n.deck, n.x, n.z);
    n.yaw += angDiff(n.yaw, poi.rot ?? n.yaw) * Math.min(1, dt * 8);
    n.speed = 0.6; this.setAnim(n, 'walk', n.held, 0.6);
    if (t >= 1) { n.speed = 0; this.beginUse(n, poi); }
  }

  _use(n, dt) {
    n.speed = 0;
    if (n.kind === 'staff' || (n.kind === 'roamer' && n.poi)) {
      n.useT = Infinity;
      if (((n.t * 2) | 0) !== n._wk) { n._wk = (n.t * 2) | 0; this._workAnim(n); }
      if ((n._wk % 20) === 0 && n.post && n.homeRoom && !S.staffOn(n.homeRoom.room, n.post.role, this.game.hour)) this._staffLeave(n);
      return;
    }
    n.useT -= dt;
    const poi = n.poi;
    if (n.swim) {
      // slow drifting laps in the pool
      n.swimT -= dt;
      if (n.swimT <= 0) {
        n.swimT = 4 + this.rnd() * 6;
        const a = this.rnd() * TAU, r = 1 + this.rnd() * 2.5;
        const tx = n.x + Math.sin(a) * r, tz = n.z + Math.cos(a) * r;
        if (this.nav.isPool(n.deck, tx, tz) && this.nav.isPool(n.deck, (tx + n.x) / 2, (tz + n.z) / 2)) { n.swimTo = { x: tx, z: tz }; this.setAnim(n, 'swim'); }
        else { n.swimTo = null; this.setAnim(n, 'tread_water'); }
      }
      if (n.swimTo) {
        const dx = n.swimTo.x - n.x, dz = n.swimTo.z - n.z, d = Math.hypot(dx, dz);
        if (d < 0.2) { n.swimTo = null; this.setAnim(n, 'tread_water'); }
        else { const s = Math.min(d, 0.55 * dt); n.x += dx / d * s; n.z += dz / d * s; n.yaw += angDiff(n.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 3); n.speed = 0.55; }
      }
    } else if (poi && poi.act === 'mingle' && n.group) {
      // take turns talking
      const g = n.group, k = g.members.indexOf(n), turn = Math.floor(n.t / 4.5 + (g.id % 7)) % Math.max(1, g.members.length);
      this.setAnim(n, turn === k ? 'talk' : (n.r > 0.7 ? 'drink' : 'idle'), n.held);
      if (n.faceYaw != null) n.yaw += angDiff(n.yaw, n.faceYaw) * Math.min(1, dt * 4);
    } else if (poi && poi.act === 'view' && n.anim === 'idle' && this.rnd() < dt * 0.04) {
      this.setAnim(n, 'point', 'none'); n.pointT = 2.5;
    } else if (poi && poi.act === 'watch' && poi.pose === 'sit') {
      // applause near the end of a show
      const h = this.game.hour;
      const end = (Math.abs(h - 20.5) < 0.06 || Math.abs(h - 22.75) < 0.06);
      this.setAnim(n, end ? (n.r > 0.85 ? 'cheer' : 'clap') : 'sit', 'none');
    }
    if (n.pointT !== undefined) { n.pointT -= dt; if (n.pointT <= 0) { n.pointT = undefined; this.setAnim(n, 'idle', n.held); } }
    // theatre: stay until the show ends
    if (poi && poi.act === 'watch' && n.useT <= 0) {
      const h = this.game.hour;
      if (S.SHOWS.some(([a, b]) => h > a - 0.6 && h < b)) n.useT = 5 + this.rnd() * 10;
    }
    if (n.useT <= 0) this._endUse(n);
  }

  _follow(n, dt) {
    const g = n.group;
    let L = g && !g.leader.gone ? g.leader : null;
    if (n.goal?.type === 'follow') L = n.goal.target === 'player' ? this.game.player : (typeof n.goal.target === 'number' ? this.byId.get(n.goal.target) : n.goal.target);
    if (!L || L.gone) {
      const ad = g && g.members.find(m => m !== n && !m.gone && m.appearance?.age !== 'child');
      if (ad && n.appearance?.age === 'child') { g.leader = ad; ad.leader = true; ad.follower = false; return; }
      n.state = 'idle'; n.timer = 1; n.group = null; n.follower = false; return;
    }
    if (L.state === 'stairs' && L.lane && Math.hypot(L.x - n.x, L.z - n.z) < 4) {
      const ln = L.lane; n.lane = { L: ln.L, toX: ln.toX, z: ln.z + (n.r > 0.5 ? 0.3 : -0.3), dir: ln.dir, follow: true };
      n.state = 'stairs'; return;
    }
    if (L.deck !== n.deck) {
      if (!n.persistent && !this.seen(n.deck, n.x, n.y + 1, n.z)) { this.remove(n); return; }
      n.goal = { type: 'move', deck: L.deck, x: L.x, z: L.z }; this._startWalk(n); return;
    }
    // slot beside / behind the leader
    const k = g ? g.members.indexOf(n) : 1;
    const ly = L.yaw ?? 0, fx = Math.sin(ly), fz = Math.cos(ly);
    const childish = n.appearance?.age === 'child';
    const sideOff = (k % 2 ? 0.72 : -0.72) * (k > 2 ? 1.6 : 1), back = childish ? 0.55 : k > 1 ? 0.9 : 0.15;
    const dist0 = n.goal?.dist ?? 0;
    let tx = L.x - fx * (back + dist0) + (-fz) * sideOff * -1, tz = L.z - fz * (back + dist0) + fx * sideOff * -1;
    if (!this.nav.passable(n.deck, tx, tz, n.mask, false) || !this.nav.stepOk(n.deck, L.x, L.z, tx, tz, n.mask, false, n.own)) { tx = L.x - fx * (0.9 + dist0); tz = L.z - fz * (0.9 + dist0); }
    { const c = this.world.collide(n.deck, tx, tz, n.rad + 0.05, { ignoreItems: true }); if (c.hit) { tx = c.x; tz = c.z; } }
    let dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz);
    const dL = Math.hypot(L.x - n.x, L.z - n.z);
    // far or blocked → path to the leader
    if (dL > 5 || (d > 1.5 && !this.nav.clear(n.deck, n.x, n.z, tx, tz, n.mask, n.own))) {
      if (!n.path || (this.time - (n.followRepath || 0) > 1.5)) { n.followRepath = this.time; this._requestPath(n, L.x, L.z); }
      if (n.path) {
        const path = n.path, last = path.length - 2;
        let px = path[n.pi * 2], pz = path[n.pi * 2 + 1];
        while (n.pi * 2 < last && Math.hypot(px - n.x, pz - n.z) < 0.55) { n.pi++; px = path[n.pi * 2]; pz = path[n.pi * 2 + 1]; }
        dx = px - n.x; dz = pz - n.z; d = Math.hypot(dx, dz);
      }
    } else n.path = null;
    const Ls = L.speed ?? Math.hypot(L.vx || 0, L.vz || 0);
    let spd = d < 0.25 ? 0 : clamp(Ls + (d - 0.4) * 1.6, 0, (L.state === 'flee' ? 5 : 2.2));
    const dirx = dx / (d || 1), dirz = dz / (d || 1);
    if (spd > 0.05) { const slow = this._avoid(n, dirx, dirz, spd); spd *= slow; }
    else { this._ax = dirx; this._az = dirz; }
    const kk = Math.min(1, dt * 5);
    n.vx += (this._ax * spd - n.vx) * kk; n.vz += (this._az * spd - n.vz) * kk;
    if (spd > 0.05 && this._doorAhead(n, dirx, dirz)) { n.vx = n.vz = 0; }
    this._move(n, dt);
    if (n.speed > 0.15) n.yaw += angDiff(n.yaw, Math.atan2(n.vx, n.vz)) * Math.min(1, dt * 8);
    else n.yaw += angDiff(n.yaw, L.yaw ?? n.yaw) * Math.min(1, dt * 2);
    const talk = g && g.members.length > 1 && Math.floor(n.t / 5 + n.r * 3) % 3 === 0;
    this.setAnim(n, talk && n.appearance?.age !== 'child' ? 'talk' : 'walk', n.luggage ? 'luggage' : n.held, n.speed);
    this._footstep(n, dt);
  }

  _stairs(n, dt) {
    const ln = n.lane; if (!ln) { n.state = 'idle'; n.timer = 0.5; return; }
    const spd = (n.state === 'flee' ? n.fleeSpeed * 0.6 : n.walkSpeed * 0.75);
    const dir = Math.sign(ln.toX - n.x) || ln.dir;
    n.x += dir * spd * dt;
    n.z += (ln.z - n.z) * Math.min(1, dt * 4);
    n.vx = dir * spd; n.vz = 0; n.speed = spd;
    n.yaw += angDiff(n.yaw, Math.atan2(dir, 0)) * Math.min(1, dt * 8);
    let y = this.world.floorY(n.deck, n.x, n.z);
    const rel = y - deckY(n.deck);
    if (rel > 1.5 && this.world.plans[n.deck + 1]) { n.deck++; n.badCores = null; this.bus.emit('npc:deck', { npc: n, deck: n.deck }); }
    else if (rel < -1.5 && this.world.plans[n.deck - 1]) { n.deck--; n.badCores = null; this.bus.emit('npc:deck', { npc: n, deck: n.deck }); }
    y = this.world.floorY(n.deck, n.x, n.z); n.y = y;
    const rid = this.world.roomId(n.deck, n.x, n.z); if (rid !== n.roomId) this._updateRoom(n);
    this.setAnim(n, n.state === 'flee' ? n.anim : 'walk', n.luggage ? 'luggage' : n.held, spd);
    this._footstep(n, dt);
    // leaving ambient: vanish as soon as nobody can see
    if (!n.persistent && n.leaving && n.deck !== this.focus.deck && !this.seen(n.deck, n.x, n.y + 1, n.z)) { this.remove(n); return; }
    if ((ln.toX - n.x) * dir <= 0.02) {
      const fol = ln.follow;
      n.lane = null;
      if (fol) { n.state = 'follow'; n.path = null; return; }
      if (n.leaving && !n.persistent) { if (!this.seen(n.deck, n.x, n.y + 1, n.z)) { this.remove(n); return; } }
      n.state = 'walk';
      if (n.goal) this._startWalk(n); else { n.state = 'idle'; n.timer = 1; }
    }
  }

  _exitReached(n) {
    const ex = n.goal.exit;
    n.exitAnchor = ex;
    const seen = this.seen(n.deck, n.x, n.y + 1, n.z);
    if (n.persistent) { n.state = 'idle'; n.timer = Infinity; return; }
    if (ex.kind === 'stair' && ex.lane) { n.lane = { L: ex.lane, toX: ex.lane.xt + ex.lane.dir * 0.8, z: ex.lane.zc, dir: ex.lane.dir }; n.leaving = true; n.state = 'stairs'; n.goal = null; return; }
    if (ex.kind === 'elevator') {
      if (this.game.elevators?.call) { try { const lob = this.nav.lobbyNear(n.deck, n.x, n.mask); if (lob) this.game.elevators.call(lob.core, n.deck); } catch {} }
      if (!seen || n.state === 'flee' || this.rnd() < 0.5) { this.remove(n); return; }
      n.state = 'idle'; n.timer = 3 + this.rnd() * 4; n.goal = null; n.leaving = true; this.setAnim(n, this.rnd() < 0.4 ? 'phone' : 'idle'); return;
    }
    if (ex.kind === 'cabinOut' || ex.door !== undefined) {
      if (this.game.doors && ex.door !== undefined) { try { this.game.doors.request(n.deck, ex.door, n); } catch {} }
      else if (ex.door !== undefined) this._fallbackOpen(n.deck, ex.door);
      if (!seen || ex.kind === 'cabinOut' || ex.crew || n.state === 'flee') { this.remove(n); return; }
    }
    if (!seen) { this.remove(n); return; }
    // still in view: find another exit (passers keep walking), give up after a few
    n.exitTries = (n.exitTries || 0) + 1;
    if (n.exitTries > 3) { this.remove(n); return; }
    const D = this.pop.decks[n.deck];
    const ex2 = D && this.pop.exitFor(n, D, this.focus);
    if (ex2) this.goExit(n, ex2); else this.remove(n);
  }

  _elevatorDepart(n) {
    const e = n.elevTo; n.elevTo = null;
    const els = this.game.elevators;
    let t = 4 + Math.abs(e.deck - n.deck) * 2.2;
    if (els?.useAbstract) { try { const r = els.useAbstract(n, n.deck, e.deck, e.core); if (Number.isFinite(r)) t = r; } catch {} }
    if (!n.persistent && !n.goal?.deck) { this.remove(n); return; }
    if (!n.persistent && !els) { this.remove(n); return; }
    n.state = 'hidden'; n.timer = t; n.elevTarget = e; n.visibleSave = true;
    const st = this._st(n); if (st) st.visible = false;
  }
  _elevatorArrive(n) {
    const e = n.elevTarget; n.elevTarget = null;
    const lob = this.nav.deck(e.deck)?.lobbies.find(l => l.core === e.core) || this.nav.lobbyNear(e.deck, n.x, n.mask);
    const p = lob && this.nav.randomPointInRoom(e.deck, lob.room, this.rnd, n.mask);
    n.deck = e.deck;
    if (p) { n.x = p.x; n.z = p.z; }
    this._updateRoom(n); n.y = this.world.floorY(n.deck, n.x, n.z);
    const st = this._st(n); if (st) st.visible = true;
    if (n.goal) this._startWalk(n); else { n.state = 'idle'; n.timer = Infinity; }
  }

  _patrolStep(n) {
    const g = n.goal; const pt = g.points[g.i % g.points.length];
    n.goal = { ...g, x: pt.x, z: pt.z, deck: pt.deck ?? n.deck };
    this._startWalk(n);
  }

  // ── misc helpers ──────────────────────────────────────────────────────
  _updateRoom(n) {
    n.roomId = this.world.roomId(n.deck, n.x, n.z);
    n.room = this.world.plans[n.deck]?.rooms[n.roomId] || null;
    n.interior = n.room && !n.room.exterior && !n.room.isVoid ? Math.min(1, n.room.light ?? 0.9) : 0;
    if (n.room && n.room.pool && !n.swim && n.state !== 'use') n.interior = 0;
  }
  setAnim(n, anim, held, speed) {
    n.anim = anim;
    if (held !== undefined) n.held = held || 'none';
    if (speed !== undefined) n.animSpeed = speed;
  }
  _st(n) { return n.charId >= 0 && this.game.chars ? this.game.chars.get(n.charId) : null; }
  _syncChar(n, force) {
    const st = this._st(n); if (!st) return;
    // seated / working people don't move: only push changes (anim swap) unless forced
    if (!force && n.state === 'use' && !n.swim && st.anim === n.anim && st.held === n.held && st.x === n.x && st.z === n.z && st.yaw === n.yaw) return;
    st.x = n.x; st.y = n.y; st.z = n.z; st.yaw = n.yaw;
    st.anim = n.anim; st.held = n.held;
    st.speed = (n.state === 'use' || n.state === 'pause' || n.state === 'idle' || n.state === 'cower') ? (n.anim === 'run' ? n.animSpeed : n.swim ? n.speed : 0) : n.speed;
    st.interior = n.interior;
    if (n.state !== 'hidden') st.visible = true;
  }

  _buildHash() {
    const head = this.head, HX = this.HX, HZ = this.HZ, fd = this.focus.deck;
    head.fill(-1);
    const list = this.list;
    if (this.next.length < list.length) this.next = new Int32Array(list.length * 2);
    this.arr = list;
    for (let i = 0; i < list.length; i++) {
      const n = list[i]; if (n.gone) continue;
      const hd = n.deck - fd + 1; if (hd < 0 || hd > 2) continue;
      const a = Math.floor((n.x + 165) / 2), b = Math.floor((n.z + 25) / 2);
      if (a < 0 || b < 0 || a >= HX || b >= HZ) continue;
      const c = hd * HX * HZ + b * HX + a;
      this.next[i] = head[c]; head[c] = i;
    }
  }

  _footstep(n, dt) {
    if (n.lod !== 0 || n.speed < 0.4) return;
    n.stepT -= dt * n.speed;
    if (n.stepT > 0) return;
    n.stepT = 0.72 * (n.appearance?.age === 'child' ? 0.7 : 1);
    const f = this.focus; const d2 = (n.x - f.x) ** 2 + (n.z - f.z) ** 2;
    if (d2 > 100 || n.deck !== f.deck) return;
    if (this.stepBudget-- <= 0) return;
    const surf = n.swim ? 'water' : FLOOR_SURF[n.room?.floor ?? 0] || 'carpet';
    this.bus.emit('footstep', { x: n.x, y: n.y, z: n.z, deck: n.deck, surface: surf, run: n.speed > 2.5, actor: n, npc: true });
  }

  _ambientBarks(dt) {
    this.stepBudget = Math.min(8, this.stepBudget + dt * 14);
    this.barkT -= dt;
    if (this.barkT > 0 || !this.list.length) return;
    this.barkT = 1.2 + this.rnd() * 2.5;
    const f = this.focus;
    // pick a random near NPC
    for (let t = 0; t < 6; t++) {
      const n = this.list[Math.floor(this.rnd() * this.list.length)];
      if (!n || n.gone || n.deck !== f.deck || n.barkCD > 0 || n.state === 'dead' || n.state === 'ko' || n.state === 'hidden') continue;
      const d = Math.hypot(n.x - f.x, n.z - f.z);
      if (d > 16) continue;
      if (n.state === 'use' && n.poi?.act === 'watch' && S.SHOWS.some(([a, b]) => this.game.hour > a && this.game.hour < b)) continue;
      let ctx = S.contextBark(n.room, n);
      if (n.kind === 'pax' && n.state === 'walk' && this.rnd() < 0.3) ctx = 'transit';
      if (n.kind === 'staff' && n.job === 'guard') ctx = 'security';
      this._bark(n, ctx, false);
      break;
    }
  }
  _bark(n, ctx, force) {
    if (!force && n.barkCD > 0) return;
    const lines = BARKS[ctx] || BARKS.transit;
    let text = lines[Math.floor(this.rnd() * lines.length)];
    if (n.appearance?.age === 'child' && ctx === 'transit') text = this.rnd() < 0.5 ? 'Are we there yet?' : 'Can we get ice cream?';
    n.barkCD = 18 + this.rnd() * 30;
    this.bus.emit('bark', { text, x: n.x, y: n.y, z: n.z, deck: n.deck, voice: n.identity?.voice || { sex: n.appearance?.sex || 'f', pitch: 1, rate: 1 }, npc: n, ctx });
  }

  // ── linen carts (simple instanced boxes owned by this module) ─────────
  _makeCarts() {
    const cap = 24;
    const mk = (w, h, d, y, color) => {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y, 0);
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: color === 0x8a9097 ? 0.5 : 0 });
      patchSurface(m, { key: 'npcCart' + color });
      const im = new THREE.InstancedMesh(g, m, cap); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      const ia = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); g.setAttribute('aInt', ia);
      this.game.scene.add(im);
      return { im, ia };
    };
    return { cap, frame: mk(1.0, 0.95, 0.55, 0.55, 0x8a9097), linen: mk(0.92, 0.32, 0.5, 0.85, 0xf2f0ea), bag: mk(0.08, 0.6, 0.45, 0.55, 0x3d5a8a), slots: [], m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), s: new THREE.Vector3(1, 1, 1), p: new THREE.Vector3() };
  }
  _cartAlloc(n) { const c = { n, x: n.x, z: n.z, yaw: n.yaw }; this.carts.slots.push(c); return c; }
  _cartFree(c) { const s = this.carts.slots; const i = s.indexOf(c); if (i >= 0) s.splice(i, 1); }
  _updateCarts() {
    const C = this.carts; let k = 0;
    for (const c of C.slots) {
      if (k >= C.cap) break;
      const n = c.n;
      if (n.pushing && !n.gone) { c.x = n.x + Math.sin(n.yaw) * 0.85; c.z = n.z + Math.cos(n.yaw) * 0.85; c.yaw = n.yaw; c.deck = n.deck; }
      const st = this._st(n); if (n.deck !== this.focus.deck && Math.abs(n.deck - this.focus.deck) > 1) continue;
      const y = deckY(n.deck);
      C.e.set(0, c.yaw, 0); C.q.setFromEuler(C.e); C.p.set(c.x, y, c.z); C.m.compose(C.p, C.q, C.s);
      for (const part of [C.frame, C.linen]) { part.im.setMatrixAt(k, C.m); part.ia.array[k] = n.interior; }
      C.p.set(c.x + Math.sin(c.yaw) * 0.52, y, c.z + Math.cos(c.yaw) * 0.52); C.m.compose(C.p, C.q, C.s); C.bag.im.setMatrixAt(k, C.m); C.bag.ia.array[k] = n.interior;
      k++;
    }
    for (const part of [C.frame, C.linen, C.bag]) { part.im.count = k; part.im.instanceMatrix.needsUpdate = true; part.ia.needsUpdate = true; }
  }

  // ── bus ───────────────────────────────────────────────────────────────
  _listen() {
    const b = this.bus; if (!b) return;
    b.on('combat:shot', (e) => { if (e && Number.isFinite(e.x)) this.broadcast('gunshot', e.x, e.y ?? 0, e.z, e.deck ?? deckOfY((e.y ?? 0) - 0.5), e.silenced ? 8 : 45, { source: e.actor }); });
    b.on('crime', (e) => {
      if (!e || !Number.isFinite(e.x)) return;
      const t = e.type === 'assault' || e.type === 'fight' ? 'fight' : e.type === 'murder' || e.type === 'shooting' ? 'gunshot' : null;
      if (t) this.broadcast(t, e.x, e.y ?? 0, e.z, e.deck, 10 + 6 * (e.severity || 1), { source: e.actor, crime: e });
    });
    b.on('alarm', (e) => {
      if (e?.kind === 'muster') { if (e.on) this._musterStart(e); else this._musterEnd(); return; }   // orderly, nobody flees
      if (e?.on) for (const n of this.list) if (!n.gone && (e.deck == null || n.deck === e.deck)) n.onEvent({ type: 'alarm', kind: e.kind, deck: e.deck });
    });
    b.on('weather:change', (e) => {
      const on = !!e?.shelter;
      if (on === this.shelter) return;
      this.shelter = on;
      if (on) this.shelterSweep(1e9);
      else for (const n of this.list) n.sheltering = false;
    });
  }

  // ── time-of-day / weather re-evaluation ───────────────────────────────
  // Embodied passengers re-check (round-robin, a few per tick) whether what they are doing still makes sense:
  // venue closed → finish up and leave (staggered), sunbathing / swimming after dark or in rain → get up and go,
  // show over → the audience drains out over a minute, walking to a venue that has closed → turn around.
  _wx() {
    const w = this.game.weather?.state, e = this.game.env?.weather;
    return { rain: w?.rain ?? e?.rain ?? 0, shelter: this.shelter || !!w?.shelter };
  }
  _attendance(room) {
    const sc = this.game.schedule; if (!sc?.attendance || !room?.name) return 0;
    try { return +sc.attendance(room.name) || 0; } catch { return 0; }
  }
  _fitSweep(budget) {
    const L = this.list; if (!L.length) return;
    const h = this.game.hour, wx = this._wx();
    let i = this._fitI || 0, seen = 0;
    while (budget > 0 && seen < L.length) {
      if (i >= L.length) i = 0;
      const n = L[i++]; seen++;
      if (n.gone || n.kind !== 'pax' || n.persistent || n.leaving || n.mustering || n.offDuty) continue;
      if (n.state === 'flee' || n.state === 'cower' || n.state === 'hidden' || n.state === 'stairs' || n.state === 'dead' || n.state === 'ko') continue;
      if (n.follower && n.group && !n.group.leader.gone) continue;     // the leader decides for the group
      const poi = n.state === 'use' ? n.poi : (n.goal?.type === 'use' ? n.goal.poi : null);
      const R = n.homeRoom, room = poi ? this.world.plans[n.deck]?.rooms[poi.room] : R?.room;
      if (!room) continue;
      budget--;
      const fits = S.activityFits(poi, room, h, wx);
      if (!fits) {
        if (room.exterior && (wx.shelter || wx.rain > 0.12)) { this._goIndoors(n, true); continue; }
        if (n.state === 'use') { this._endUseNow(n); continue; }
        this.leave(n); continue;
      }
      if (S.venueClosed(room, h, this._attendance(room))) {
        if (n.state === 'use') { if (!n.closingT) { n.closingT = 1; n.useT = Math.min(n.useT, 3 + this.rnd() * 30); } }
        else if (n.goal?.type === 'use') this.leave(n);
        continue;
      }
      // theatre: once the show is over the audience drains out
      if (n.state === 'use' && poi?.act === 'watch' && poi.pose === 'sit' && room.dens === 'theater' && !S.SHOWS.some(([a, b]) => h > a - 0.6 && h < b + 0.05)) {
        if (!n.closingT) { n.closingT = 1; n.useT = Math.min(n.useT, 2 + this.rnd() * 45); }
      }
    }
    this._fitI = i;
  }
  // stand up from a seat / lounger and leave right away (group comes along)
  _endUseNow(n) {
    this._releasePoi(n);
    n.y = this.world.floorY(n.deck, n.x, n.z);
    if (n.group && n.leader) for (const m of n.group.members) if (m !== n && !m.gone && m.state === 'use') { this._releasePoi(m); m.y = this.world.floorY(m.deck, m.x, m.z); }
    this.leave(n);
  }

  // ── weather shelter ───────────────────────────────────────────────────
  // ambient passengers (not crew, not scripted) on open decks walk to the nearest interior public room
  _shelterable(n) {
    return !n.gone && n.kind === 'pax' && !n.offDuty && !n.persistent && !n.leaving && !n.sheltering && !n.mustering && n.room && n.room.exterior && !n.room.isVoid
      && n.state !== 'flee' && n.state !== 'cower' && n.state !== 'hidden' && n.state !== 'stairs' && n.state !== 'dead' && n.state !== 'ko'
      && !(n.follower && n.group && !n.group.leader.gone && n.group.leader.room?.exterior);   // the leader brings the group
  }
  shelterSweep(budget = 4) {
    for (let i = 0; i < this.list.length && budget > 0; i++) { const n = this.list[i]; if (this._shelterable(n)) { this._goIndoors(n); budget--; } }
  }
  _goIndoors(n, force = false) {
    if (n.sheltering && !force) return;
    n.sheltering = true;
    // seated / lying / soaking / swimming: stand up (or climb out) first
    if (n.state === 'use' || n.state === 'approach') {
      this._releasePoi(n);
      if (n.swim) { const q = this.nav.nearestPoint(n.deck, n.x, n.z, n.mask, 8); if (q) { n.x = q.x; n.z = q.z; } n.swim = false; }
      n.y = this.world.floorY(n.deck, n.x, n.z); n.state = 'idle'; n.timer = 0.5;
    }
    // members of a group come along (they get spots next to the leader via groupJoin)
    if (n.group && n.leader) for (const m of n.group.members) if (m !== n && !m.gone) {
      m.sheltering = true;
      if (m.state === 'use' || m.state === 'approach') { this._releasePoi(m); if (m.swim) { const q = this.nav.nearestPoint(m.deck, m.x, m.z, m.mask, 8); if (q) { m.x = q.x; m.z = q.z; } m.swim = false; } m.y = this.world.floorY(m.deck, m.x, m.z); }
      if (m.state !== 'follow' && m.state !== 'stairs') this.followLeader(m);
    }
    const D = this.pop.decks[n.deck] || this.pop.deck(n.deck);
    let best = null, bd = 1e9;
    if (D) for (const R of D.rooms) {
      const r = R.room;
      if (r.exterior || r.isVoid || r.pool || R.crew || r.zone !== 'public' || (!R.stands.length && !R.seats.length)) continue;
      const dx = Math.max(r.x0 - n.x, 0, n.x - r.x1), dz = Math.max(r.z0 - n.z, 0, n.z - r.z1), d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = R; }
    }
    const at = { x: n.x, z: n.z, deck: n.deck };
    const use = best && (this.pop.freeOf(best.stands, at, this.rnd) || this.pop.freeOf(best.seats, at, this.rnd));
    if (!use) { n.leaving = false; this.leave(n); if (!n.gone) n.activity = 'heading inside'; return; }
    this._releasePoi(n);
    n.y = this.world.floorY(n.deck, n.x, n.z);
    n.homeRoom = best; n.passer = false;
    this.goUse(n, use);
    if (n.leader && n.group) this.pop.groupJoin(n.group, use, false);
  }

  // ── muster drill ──────────────────────────────────────────────────────
  _musterStart(e) {
    this.muster = { on: true, drill: !!e.drill, t: this.time };
    this._musterLoad.clear();
    this.musterSweep(1e9);
  }
  _musterEnd() {
    if (!this.muster) return;
    this.muster = null;
    for (const n of this.list) if (n.mustering && !n.gone) { n.mustering = false; n.goal = null; this.leave(n); }
  }
  musterSweep(budget = 6) {
    const fd = this.focus.deck;
    for (let i = 0; i < this.list.length && budget > 0; i++) {
      const n = this.list[i];
      if (n.gone || n.mustering || n.kind !== 'pax' || n.offDuty || n.persistent || Math.abs(n.deck - fd) > 1) continue;
      if (n.state === 'flee' || n.state === 'cower' || n.state === 'hidden' || n.state === 'stairs' || n.state === 'dead' || n.state === 'ko') continue;
      if (this._musterOne(n)) budget--;
    }
  }
  _musterOne(n) {
    const st = this.game.schedule?.musterStations;
    if (!st || !st.length) return false;
    // nearest few stations along the ship (same side when already on deck 5), least crowded first
    const side = n.deck === 5 && Math.abs(n.z) > 3 ? Math.sign(n.z) : (n.r < 0.5 ? -1 : 1);
    let best = null, bs = 1e9;
    for (const s of st) {
      const load = this._musterLoad.get(s.id) || 0;
      const sc = Math.abs(s.x - n.x) + (Math.sign(s.z) === side ? 0 : 30) + load * 3 + this.rnd() * 4;
      if (sc < bs) { bs = sc; best = s; }
    }
    if (!best) return false;
    const inb = -Math.sign(best.z);
    const p = this.nav.nearestPoint(best.deck || 5, best.x + (this.rnd() - 0.5) * 9, best.z + inb * (1 + this.rnd() * 3.5), 0, 4);
    if (!p) return false;
    this._musterLoad.set(best.id, (this._musterLoad.get(best.id) || 0) + 1);
    if (n.group) { const g = n.group; g.members = g.members.filter(m => m !== n); if (g.leader === n && g.members.length) { g.leader = g.members[0]; } }
    n.group = null; n.follower = false; n.leader = false;
    if (n.pendingUse) { n.pendingUse.taken = null; n.pendingUse = null; }
    n.homeRoom = null; n.passer = false; n.mustering = true; n.sheltering = false;
    n.y = this.world.floorY(n.deck, n.x, n.z);
    this.setGoal(n, { type: 'move', deck: best.deck || 5, x: p.x, z: p.z, anim: 'idle', yaw: Math.atan2(0, -inb), muster: best.id });
    n.activity = 'going to muster station ' + best.id;
    return true;
  }

  // ── stats ─────────────────────────────────────────────────────────────
  stats() {
    const byKind = {}, byState = {}, byRoom = {};
    let stuck = 0, moving = 0, sheltering = 0, mustering = 0, paxOutside = 0;
    for (const n of this.list) {
      if (n.gone) continue;
      byKind[n.kind] = (byKind[n.kind] || 0) + 1;
      byState[n.state] = (byState[n.state] || 0) + 1;
      const rn = n.room?.name || n.room?.type || '?';
      byRoom[rn] = (byRoom[rn] || 0) + 1;
      if (n.state === 'walk' || n.state === 'follow' || n.state === 'flee') { moving++; if (n.stuckT >= 5) stuck++; }
      if (n.sheltering) sheltering++;
      if (n.mustering) mustering++;
      if (n.kind === 'pax' && !n.offDuty && n.room?.exterior) paxOutside++;
    }
    let s = 0, c = 0; for (const v of this.msHist) if (v > 0) { s += v; c++; }
    const ns = this.nav.stats;
    const live = this.list.filter(n => !n.gone);
    return {
      embodied: live.length, cap: this.cap(), byKind, byState,
      venues: Object.fromEntries(Object.entries(byRoom).sort((a, b) => b[1] - a[1]).slice(0, 16)),
      stuck, moving, stuckPct: live.length ? +(100 * stuck / live.length).toFixed(1) : 0,
      avgPathLen: ns.pathCount ? +(ns.pathLenSum / ns.pathCount).toFixed(1) : 0,
      updateMs: c ? +(s / c).toFixed(3) : 0, maxMs: +this.msMax.toFixed(2),
      nav: { searches: ns.searches, fails: ns.fails, cacheHits: ns.cacheHits, avgNodes: ns.searches ? Math.round(ns.nodes / ns.searches) : 0, avgSearchMs: ns.searches ? +(ns.ms / ns.searches).toFixed(3) : 0, pending: this.nav.pending },
      target: this.pop.ambWant, rawTarget: Math.round(this.pop.sumTarget || 0), focus: { ...this.focus }, hour: +this.game.hour.toFixed(2),
      shelter: this.shelter, muster: !!this.muster, sheltering, mustering, paxOutside,
      snaps: this.snapCount || 0, lastSnap: this.lastSnap || null,
      lod: { near: live.filter(n => n.lod === 0).length, mid: live.filter(n => n.lod === 1).length, far: live.filter(n => n.lod === 2).length },
    };
  }

  // ── public API ────────────────────────────────────────────────────────
  _makeApi() {
    const sys = this;
    return {
      system: sys,
      get list() { return sys.list.filter(n => !n.gone); },
      get count() { return sys.list.length; },
      countNear(x, y, z, r) {
        const d = deckOfY((y ?? 0) + 0.5); let c = 0; const r2 = r * r;
        for (const n of sys.list) { if (n.gone || n.state === 'hidden' || Math.abs(n.deck - d) > 0) continue; const dx = n.x - x, dz = n.z - z; if (dx * dx + dz * dz <= r2) c++; }
        return c;
      },
      query(deck, x, z, r, filter) {
        const out = [], r2 = r * r;
        for (const n of sys.list) { if (n.gone || n.deck !== deck || n.state === 'hidden') continue; const dx = n.x - x, dz = n.z - z; if (dx * dx + dz * dz <= r2 && (!filter || filter(n))) out.push(n); }
        return out;
      },
      nearest(deck, x, z, r = 3, filter) { let best = null, bd = r * r; for (const n of sys.list) { if (n.gone || n.deck !== deck || n.state === 'hidden') continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd && (!filter || filter(n))) { bd = d; best = n; } } return best; },
      get: (id) => sys.byId.get(id) || null,
      fromChar: (charId) => sys.byChar.get(charId) || null,
      spawnAt: (role, deck, x, z, opts) => sys.spawnAt(role, deck, x, z, opts),
      setGoal: (npc, goal) => sys.setGoal(npc, goal),
      remove: (npc) => sys.remove(npc),
      broadcast: (evt, x, y, z, deck, radius, extra) => sys.broadcast(typeof evt === 'string' ? evt : evt.type, x, y, z, deck, radius, typeof evt === 'object' ? { ...evt, ...extra } : extra),
      kill: (npc, evt) => sys.kill(typeof npc === 'number' ? sys.byId.get(npc) : npc, evt),
      knockOut: (npc, s, evt) => sys.knockOut(typeof npc === 'number' ? sys.byId.get(npc) : npc, s, evt),
      damage: (npc, amount, source) => { npc = typeof npc === 'number' ? sys.byId.get(npc) : npc; if (npc) sys.react(npc, { type: 'hit', damage: amount, source, x: source?.x, z: source?.z }); },
      makePersistent: (npc) => { npc = typeof npc === 'number' ? sys.byId.get(npc) : npc; if (npc) npc.persistent = true; return npc; },
      setDensity: (k) => { sys.density = Math.max(0, k); },
      stats: () => sys.stats(),
      nav: sys.nav,
      // headless simulation for tests/tools: advance the clock and NPCs without rendering
      simulate(seconds, dt = 1 / 30) {
        const g = sys.game; const n = Math.ceil(seconds / dt);
        for (let i = 0; i < n; i++) { g.minutes += dt / 1.25; sys.update(dt); }
        return sys.stats();
      },
    };
  }
}

export async function installNPCs(game) {
  const sys = new NPCSystem(game);
  game.npcs = sys.api;
  game.addSystem({ name: 'npcs', order: 60, update: (dt) => sys.update(dt) });
  return sys;
}
export { NPCSystem, NPC };
