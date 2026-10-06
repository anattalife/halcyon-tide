// HALCYON TIDE — elevators: one car per shaft (8 per passenger core + 1 service lift per crew core),
// realistic motion (accel 0.8 m/s², 2.5 m/s, 4 s door dwell), collective dispatch per core, landing & car
// doors (plan doors of type 'elevator' are driven through game.doors.setPhase), call panels / position
// indicators, an in-car deck selector UI and abstract rides for NPCs.
//
// game.elevators API (docs/ARCHITECTURE.md "Elevators"):
//   cars                         [{id, core, kind:'passenger'|'service', y (car floor, absolute), deck (nearest),
//                                  atDeck (deck while stopped level, else null), doorOpen 0..1, moving, dir (-1|0|1),
//                                  queue (sorted array of pending stops), served [decks], state}]
//   car(id)                      → car record
//   call(coreOrCarId, deck)      hall call → best car of that core (or that exact car). Returns the car.
//   ride(actor, carId, deck)     cab call (destination) on a car; returns the car
//   useAbstract(npc, fromDeck, toDeck, coreId) → ETA seconds (number). The NPC system hides the NPC and re-spawns it
//                                at the target lobby after that time. Places a real hall call when near the player.
//   nearestCore(deck, x, z, {crew}) → {core, kind, x, lobby (room id), cars, dist} | null
//   eta(coreId, fromDeck, toDeck) → estimated seconds (wait + travel + door cycles)
//   openUI(carId) / closeUI()   (normally automatic)
//
// PLAYER CONTRACT (fields this module writes on game.player while the player is inside a car):
//   player.state    = 'elevator'   when the player stands in the car's shaft cells (world.roomAt(...).car === id) and
//                                  the car floor is there; reset to 'free' as soon as they step out. Only switched
//                                  when the state was 'free' (never overrides seated/cutscene/dead/arrested).
//   player.elevator = car id | null
//   player.y        = car floor height (absolute), every frame while state === 'elevator'
//   player.vy = 0, player.onGround = true
//   player.deck     = nearest deck to the car floor, updated continuously during the ride through player._setDeck(d)
//                     when available (emits 'player:deck' and streams detail), otherwise player.deck + world.setActiveDeck.
// The player controller already skips gravity/stairs while state === 'elevator' and keeps horizontal movement +
// collision (the shaft walls and closed landing doors keep the player inside the car).
//
// Bus: 'elevator:arrive' {car, deck, up}, 'elevator:move' {car, moving}, 'door:move' {deck, door, opening} (landing doors).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CORES, CREW_CORES, deckY, SHIP, GRID, idx, toI, toJ } from '../core/config.js';
import { patchSurface } from './materials.js';
import { makeDigitMaterial } from './doors.js';

const ACC = 0.8, VMAX = 2.5, DWELL = 4.0, DOOR_T = 1.7, DOOR_W_GAP = 0.02;
const deckOf = (y) => Math.max(1, Math.min(SHIP.deckCount, Math.round((y + 6) / 3) + 1));

// ── textures ───────────────────────────────────────────────────────────────
function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tx(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function carWoodTex() {
  const W = 512, H = 512, c = cnv(W, H), g = c.getContext('2d'), r = rng(21);
  g.fillStyle = '#5b3a22'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 220; k++) {
    const x0 = r() * W, amp = 2 + r() * 6, f = 0.004 + r() * 0.01, ph = r() * 6;
    g.strokeStyle = r() < 0.55 ? `rgba(30,14,5,${0.05 + r() * 0.12})` : `rgba(160,105,60,${0.04 + r() * 0.07})`;
    g.lineWidth = 0.6 + r() * 2; g.beginPath();
    for (let y = 0; y <= H; y += 8) { const x = x0 + Math.sin(y * f + ph) * amp; y ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // three vertical panels separated by steel reveal lines
  for (const x of [0, W / 3, 2 * W / 3, W - 1]) { g.fillStyle = 'rgba(15,8,3,0.7)'; g.fillRect(x - 3, 0, 6, H); g.fillStyle = 'rgba(210,215,220,0.55)'; g.fillRect(x - 1, 0, 2, H); }
  const vg = g.createLinearGradient(0, 0, 0, H); vg.addColorStop(0, 'rgba(0,0,0,0.15)'); vg.addColorStop(0.15, 'rgba(0,0,0,0)'); vg.addColorStop(0.9, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.2)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return tx(c);
}
function brushedTex() {
  const W = 256, H = 256, c = cnv(W, H), g = c.getContext('2d'), r = rng(31);
  g.fillStyle = '#b4b9be'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,45,50'},${0.02 + r() * 0.07})`; g.fillRect(0, y, W, 1); }
  return tx(c);
}
function floorTex() {
  const W = 256, H = 256, c = cnv(W, H), g = c.getContext('2d'), r = rng(41);
  g.fillStyle = '#26282b'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 2600; k++) { const v = 30 + r() * 70; g.fillStyle = `rgba(${v},${v},${v + 5},${0.3 + r() * 0.5})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
  for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(220,215,200,${0.2 + r() * 0.3})`; g.fillRect(r() * W, r() * H, 1, 1); }
  // brass inlay border
  g.strokeStyle = '#9a7a3e'; g.lineWidth = 5; g.strokeRect(14, 14, W - 28, H - 28);
  return tx(c);
}
function copTex(served, label) {
  const W = 192, H = 512, c = cnv(W, H), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#8d9399'); gr.addColorStop(0.5, '#c3c8cd'); gr.addColorStop(1, '#8d9399');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 3; g.strokeRect(2, 2, W - 4, H - 4);
  g.fillStyle = '#1d2024'; g.fillRect(24, 22, W - 48, 34);
  g.fillStyle = '#c9a45b'; g.font = '700 20px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, W / 2, 40);
  const list = [...served].sort((a, b) => b - a);
  const cols = 2, rows = Math.ceil(list.length / cols), top = 80, bh = Math.min(42, (H - top - 90) / rows);
  list.forEach((d, k) => {
    const col = k % cols, row = Math.floor(k / cols);
    const x = W / 2 + (col === 0 ? -36 : 36), y = top + row * bh + bh / 2;
    g.fillStyle = '#e9ecef'; g.beginPath(); g.arc(x, y, bh * 0.38, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#6b7177'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#23272b'; g.font = `700 ${Math.round(bh * 0.42)}px Arial, sans-serif`; g.fillText(String(d), x, y + 1);
  });
  // door open / close + alarm
  const yb = H - 50;
  for (const [x, t] of [[W / 2 - 50, '◀▶'], [W / 2, '▶◀'], [W / 2 + 50, '!']]) { g.fillStyle = '#e9ecef'; g.beginPath(); g.arc(x, yb, 17, 0, Math.PI * 2); g.fill(); g.fillStyle = '#23272b'; g.font = '700 13px Arial, sans-serif'; g.fillText(t, x, yb + 1); }
  return tx(c);
}

// ── geometry helpers ───────────────────────────────────────────────────────
function box(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed(); }
function plane(w, h, x, y, z, ry = 0) { const g = new THREE.PlaneGeometry(w, h); g.rotateY(ry); g.translate(x, y, z); return g.toNonIndexed(); }
function cyl(r, len, x, y, z, axis) { const g = new THREE.CylinderGeometry(r, r, len, 10, 1); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); g.translate(x, y, z); return g.toNonIndexed(); }
function mergeL(list, aInt = 1) {
  const g = mergeGeometries(list, false);
  const n = g.attributes.position.count;
  g.setAttribute('aInt', new THREE.Float32BufferAttribute(new Float32Array(n).fill(aInt), 1));
  return g;
}

// ── module ─────────────────────────────────────────────────────────────────
export function installElevators(game) {
  const world = game.world, plans = world.plans, bus = game.bus;
  const now = { t: 0 };

  // ── discover shafts / cars / landings from the plans ─────────────────
  const cars = [], byId = new Map(), groups = new Map();
  for (let d = 1; d < plans.length; d++) {
    const P = plans[d]; if (!P) continue;
    for (const dr of P.doors) {
      if (dr.type !== 'elevator' || !dr.car) continue;
      let car = byId.get(dr.car);
      const shaft = P.rooms[dr.rooms[0]]?.car === dr.car ? P.rooms[dr.rooms[0]] : P.rooms[dr.rooms[1]];
      const lobby = P.rooms[dr.rooms[0]] === shaft ? P.rooms[dr.rooms[1]] : P.rooms[dr.rooms[0]];
      if (!car) {
        const kind = dr.car.startsWith('svc-') ? 'service' : 'passenger';
        car = {
          id: dr.car, core: dr.core, kind, served: [], landings: new Map(),
          cx: (shaft.x0 + shaft.x1) / 2, cz: (shaft.z0 + shaft.z1) / 2, sw: shaft.x1 - shaft.x0, sd: shaft.z1 - shaft.z0,
          normal: dr.normal, doorW: dr.w,
          y: 0, v: 0, dir: 0, state: 'idle', door: 0, timer: 0, stops: new Set(), moving: false, atDeck: null, deck: 0,
          queue: [], doorOpen: 0, riders: 0, hold: 0, lastDir: 0,
        };
        // facing: local +z → toward the landing door
        if (dr.normal === 'x') car.rot = dr.x > car.cx ? Math.PI / 2 : -Math.PI / 2;
        else car.rot = dr.z > car.cz ? 0 : Math.PI;
        // door offset along the car's local x (non-centred doors are supported for the door opening placement)
        const along = dr.normal === 'x' ? dr.z - car.cz : dr.x - car.cx;
        car.doorOff = (car.rot === Math.PI || car.rot === -Math.PI / 2) ? -along : along;
        if (dr.normal === 'x') car.doorOff = car.rot > 0 ? -(dr.z - car.cz) : (dr.z - car.cz);
        car.W = dr.normal === 'x' ? shaft.z1 - shaft.z0 : shaft.x1 - shaft.x0;   // local x extent
        car.D = dr.normal === 'x' ? shaft.x1 - shaft.x0 : shaft.z1 - shaft.z0;   // local z extent
        cars.push(car); byId.set(car.id, car);
        if (!groups.has(car.core)) groups.set(car.core, { core: car.core, cars: [], hall: new Map(), kind });
        groups.get(car.core).cars.push(car);
      }
      car.served.push(d);
      car.landings.set(d, { deck: d, door: dr, lobby: lobby?.id ?? 0, lobbyRoom: lobby, indI: -1, btnI: -1 });
    }
  }
  for (const car of cars) {
    car.served.sort((a, b) => a - b);
    car.minD = car.served[0]; car.maxD = car.served[car.served.length - 1];
    // start parked at a deterministic served deck, doors closed
    const pref = [5, 9, 7, 12, 3, 6, 10, 14, 4, 8, 11, 15, 1, 2, 13, 16, 17];
    let h = 0; for (const ch of car.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const pd = pref[h % pref.length];
    const start = car.served.includes(pd) ? pd : car.served[Math.floor(car.served.length / 2)];
    car.y = deckY(start); car.deck = start; car.atDeck = start;
  }

  // ── door integration ─────────────────────────────────────────────────
  const doors = () => game.doors;
  function setLanding(car, deck, phase) {
    const L = car.landings.get(deck); if (!L) return;
    const D = doors();
    if (D?.setPhase) D.setPhase(deck, L.door.id, phase);
    else { const st = world.door(deck, L.door.id); st.open = phase; st.target = phase > 0.5 ? 1 : 0; }
  }
  for (const car of cars) for (const d of car.served) { const st = world.door(d, car.landings.get(d).door.id); st.ctrl = 'elevator'; st.lockedState = false; setLanding(car, d, 0); }
  function doorwayBlocked(car) {
    if (car.atDeck == null) return false;
    const L = car.landings.get(car.atDeck); if (!L) return false;
    const dr = L.door;
    const test = (x, z) => {
      const lx = dr.normal === 'z' ? x - dr.x : z - dr.z, lz = dr.normal === 'z' ? z - dr.z : -(x - dr.x);
      return Math.abs(lx) < dr.w / 2 + 0.1 && Math.abs(lz) < 0.42;
    };
    const p = game.player;
    if (p && p.deck === car.atDeck && test(p.x, p.z)) return true;
    try { const l = game.npcs?.query?.(car.atDeck, dr.x, dr.z, 2) || []; for (const n of l) if (test(n.x, n.z)) return true; } catch {}
    return false;
  }

  // ── dispatch (collective control per core group) ─────────────────────
  function travelTime(dist) {
    dist = Math.abs(dist);
    const dAcc = VMAX * VMAX / ACC;          // distance to reach vmax and stop again
    return dist < dAcc ? 2 * Math.sqrt(dist / ACC) : dist / VMAX + VMAX / ACC;
  }
  function carCost(car, deck) {
    const ty = deckY(deck);
    const dist = Math.abs(ty - car.y);
    let c = travelTime(dist);
    if (car.state === 'idle' && car.atDeck === deck) return -1;
    if (car.dir !== 0 && car.moving) {
      const ahead = (ty - car.y) * car.dir > (car.v * car.v) / (2 * ACC) - 0.01;
      if (!ahead) {
        // must finish the current sweep first
        let far = car.y; for (const s of car.stops) { const sy = deckY(s); if ((sy - car.y) * car.dir > 0 && Math.abs(sy - car.y) > Math.abs(far - car.y)) far = sy; }
        c = travelTime(far - car.y) + travelTime(far - ty) + 4;
      }
    }
    c += car.stops.size * (DWELL + 2 * DOOR_T) * 0.6;
    if (car.state === 'open' || car.state === 'opening' || car.state === 'closing') c += 2;
    if (car.disabled) c += 1e6;
    return c;
  }
  function call(coreOrCar, deck, opts = {}) {
    let list;
    if (byId.has(coreOrCar)) list = [byId.get(coreOrCar)];
    else if (groups.has(coreOrCar)) list = groups.get(coreOrCar).cars;
    else if (typeof coreOrCar === 'string' && coreOrCar.startsWith('svc') && byId.has('svc-' + coreOrCar.slice(3).replace(/^-/, ''))) list = [byId.get('svc-' + coreOrCar.slice(3).replace(/^-/, ''))];
    else return null;
    list = list.filter(c => c.served.includes(deck));
    if (!list.length) return null;
    const G = groups.get(list[0].core);
    const ex = G.hall.get(deck);
    if (ex && list.includes(ex.car) && !opts.force) { // already assigned — reopen if the car is right here
      if (ex.car.atDeck === deck && (ex.car.state === 'closing' || ex.car.state === 'idle')) reopen(ex.car);
      return ex.car;
    }
    let best = null, bc = Infinity;
    for (const c of list) { const k = carCost(c, deck); if (k < bc) { bc = k; best = c; } }
    if (!best) return null;
    if (best.atDeck === deck && best.state !== 'moving') { reopen(best); return best; }
    best.stops.add(deck);
    G.hall.set(deck, { car: best, t: now.t });
    refreshQueue(best);
    return best;
  }
  function ride(actor, carId, deck) {
    const car = byId.get(carId); if (!car || !car.served.includes(deck)) return null;
    if (car.atDeck === deck && car.state !== 'moving') { reopen(car); return car; }
    car.stops.add(deck); refreshQueue(car);
    if (car.state === 'open') car.timer = Math.min(car.timer, actor === game.player ? 1.6 : 2.5);
    return car;
  }
  function reopen(car) {
    if (car.state === 'idle' && car.atDeck != null) { bus.emit('elevator:arrive', { car: car.id, deck: car.atDeck, up: car.dir >= 0, core: car.core }); }
    if (car.state === 'closing' || car.state === 'idle') { car.state = 'opening'; emitDoors(car, true); }
    else if (car.state === 'open') car.timer = Math.max(car.timer, DWELL);
  }
  function refreshQueue(car) { car.queue = [...car.stops].sort((a, b) => a - b); }
  function emitDoors(car, opening) { const L = car.landings.get(car.atDeck); if (L) bus.emit('door:move', { deck: car.atDeck, door: L.door.id, opening }); }

  function nextTarget(car) {
    if (!car.stops.size) return null;
    const minBrake = (car.v * car.v) / (2 * ACC);
    const pick = (dir) => {
      let best = null, bd = Infinity;
      for (const s of car.stops) {
        const dy = (deckY(s) - car.y) * dir;
        if (dy < -0.002) continue;
        if (car.moving && Math.sign(car.v) === dir && dy < minBrake - 0.02) continue;   // too late to stop there
        if (dy < bd) { bd = dy; best = s; }
      }
      return best;
    };
    if (car.dir !== 0) { const t = pick(car.dir); if (t != null) return t; }
    // reverse / start: nearest stop overall (prefer the last direction on ties)
    let best = null, bd = Infinity;
    for (const s of car.stops) { const dd = Math.abs(deckY(s) - car.y) - (Math.sign(deckY(s) - car.y) === car.lastDir ? 0.01 : 0); if (dd < bd) { bd = dd; best = s; } }
    return best;
  }

  // ── car update ───────────────────────────────────────────────────────
  function arrive(car, deck) {
    car.y = deckY(deck); car.v = 0; car.atDeck = deck; car.deck = deck;
    car.stops.delete(deck); refreshQueue(car);
    const G = groups.get(car.core); const h = G.hall.get(deck); if (h && h.car === car) G.hall.delete(deck);
    if (car.moving) { car.moving = false; bus.emit('elevator:move', { car: car.id, moving: false }); }
    // direction it will continue in (for the lantern / chime)
    let up = car.dir >= 0;
    const more = [...car.stops].some(s => (s - deck) * car.dir > 0);
    if (!more) { const any = [...car.stops]; car.dir = any.length ? Math.sign(any[0] - deck) : 0; up = car.dir >= 0; }
    car.state = 'opening';
    bus.emit('elevator:arrive', { car: car.id, deck, up, core: car.core });
    emitDoors(car, true);
  }
  function stepCar(car, dt) {
    switch (car.state) {
      case 'idle': {
        if (car.disabled) return;
        if (car.atDeck != null && car.stops.has(car.atDeck)) { arrive(car, car.atDeck); return; }
        const t = nextTarget(car);
        if (t == null) { car.dir = 0; return; }
        car.target = t; car.dir = Math.sign(deckY(t) - car.y) || 0;
        if (!car.dir) { arrive(car, t); return; }
        car.state = 'moving'; car.atDeck = null; car.moving = true; car.lastDir = car.dir;
        bus.emit('elevator:move', { car: car.id, moving: true, dir: car.dir });
        return;
      }
      case 'moving': {
        const t = nextTarget(car) ?? car.target;
        car.target = t;
        const ty = deckY(t), dist = ty - car.y, ad = Math.abs(dist), sgn = Math.sign(dist) || car.dir;
        if (sgn !== car.dir && Math.abs(car.v) < 0.05) { car.dir = sgn; car.lastDir = sgn; }
        // speed profile: brake so that v²/2a == remaining distance, with a soft jerk limit near the end
        const vWant = sgn * Math.min(VMAX, Math.sqrt(2 * ACC * Math.max(0, ad - 0.004)) * 0.995 + (ad > 0.02 ? 0.03 : 0));
        const dv = vWant - car.v, maxDv = ACC * dt * (Math.abs(vWant) > Math.abs(car.v) ? 1 : 1.25);
        car.v += Math.max(-maxDv, Math.min(maxDv, dv));
        const step = car.v * dt;
        if ((ad <= Math.abs(step) + 0.002 && Math.abs(car.v) < 0.35) || ad < 0.003) { arrive(car, t); return; }
        car.y += step;
        car.deck = deckOf(car.y);
        return;
      }
      case 'opening': {
        car.door = Math.min(1, car.door + dt / DOOR_T);
        if (car.door >= 1) { car.state = 'open'; car.timer = DWELL; }
        return;
      }
      case 'open': {
        car.timer -= dt;
        if (car.hold > 0 || doorwayBlocked(car)) car.timer = Math.max(car.timer, 1.2);
        if (car.timer <= 0) { car.state = 'closing'; emitDoors(car, false); }
        return;
      }
      case 'closing': {
        if (doorwayBlocked(car)) { car.state = 'opening'; emitDoors(car, true); return; }   // light curtain
        car.door = Math.max(0, car.door - dt / DOOR_T);
        if (car.door <= 0) { car.state = 'idle'; }
        return;
      }
    }
  }

  // ── visuals: car interiors (instanced per car kind) ──────────────────
  const T = { wood: carWoodTex(), brushed: brushedTex(), floor: floorTex() };
  const MAT = {
    wood: patchSurface(new THREE.MeshStandardMaterial({ map: T.wood, roughness: 0.45, metalness: 0 }), { key: 'lift' }),
    steel: patchSurface(new THREE.MeshStandardMaterial({ map: T.brushed, color: 0xa0a6ac, roughness: 0.36, metalness: 0.75, envMapIntensity: 0.45 }), { key: 'lift' }),
    brass: patchSurface(new THREE.MeshStandardMaterial({ color: 0xc9a050, roughness: 0.25, metalness: 1 }), { key: 'lift' }),
    // smoked bronze mirror: dark, warm, glossy (a true mirror would need an extra scene render)
    mirror: patchSurface(new THREE.MeshStandardMaterial({ color: 0x8a7d70, roughness: 0.12, metalness: 1.0, envMapIntensity: 0.4 }), { key: 'lift' }),
    floor: patchSurface(new THREE.MeshStandardMaterial({ map: T.floor, roughness: 0.25, metalness: 0.05 }), { key: 'lift' }),
    dark: patchSurface(new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.7, metalness: 0.3 }), { key: 'lift' }),
    ceil: patchSurface(new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.6, metalness: 0.1 }), { key: 'lift' }),
    light: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.94, 0.84).multiplyScalar(2.3), toneMapped: false }),
    ind: makeDigitMaterial({ mode: 'lift', glow: 0xff9a2e, intDefault: 0.4 }),
    plaque: makeDigitMaterial({ mode: 'plate', plate: 0xb9bfc4, ink: 0x1a1d20, metal: 0.85, rough: 0.3 }),
  };

  function carParts(car) {
    const W = car.W, D = car.D, hx = W / 2 - 0.09, hz = D / 2 - 0.09, dw = car.doorW, off = car.doorOff, CH = 2.32;
    const P = { wood: [], steel: [], brass: [], mirror: [], floor: [], dark: [], ceil: [], light: [] };
    // floor & under-slab & roof
    P.floor.push(box(2 * hx, 0.03, 2 * hz, 0, -0.015, 0));
    P.dark.push(box(2 * hx + 0.14, 0.26, 2 * hz + 0.14, 0, -0.16, 0));
    P.dark.push(box(2 * hx + 0.14, 0.12, 2 * hz + 0.14, 0, CH + 0.16, 0));
    // ceiling with recessed light panel and a perimeter of steel
    P.ceil.push(box(2 * hx, 0.04, 2 * hz, 0, CH + 0.02, 0));
    { const g = new THREE.PlaneGeometry(2 * hx - 0.5, 2 * hz - 0.55); g.rotateX(Math.PI / 2); g.translate(0, CH - 0.003, -0.02); P.light.push(g.toNonIndexed()); }
    P.steel.push(box(2 * hx, 0.05, 0.05, 0, CH - 0.025, hz - 0.025), box(2 * hx, 0.05, 0.05, 0, CH - 0.025, -hz + 0.025));
    // back wall: wood wainscot + mirror + steel skirting
    P.wood.push(box(2 * hx, 0.88, 0.02, 0, 0.1 + 0.44, -hz - 0.01));
    P.mirror.push(box(2 * hx - 0.12, CH - 1.08 - 0.12, 0.012, 0, 1.0 + (CH - 1.08 - 0.12) / 2 + 0.04, -hz + 0.006));
    P.steel.push(box(2 * hx, 0.1, 0.03, 0, 0.05, -hz + 0.0));
    P.steel.push(box(2 * hx, 0.04, 0.03, 0, 1.0, -hz + 0.005));
    P.wood.push(box(2 * hx, CH - 0.98, 0.02, 0, 0.98 + (CH - 0.98) / 2, -hz - 0.012));
    // side walls: full height wood panels, steel skirting, brass handrail
    for (const s of [-1, 1]) {
      P.wood.push(box(0.02, CH - 0.1, 2 * hz, s * (hx + 0.01), 0.1 + (CH - 0.1) / 2, 0));
      P.steel.push(box(0.03, 0.1, 2 * hz, s * hx, 0.05, 0));
      P.brass.push(cyl(0.022, 2 * hz - 0.3, s * (hx - 0.07), 0.92, 0, 'z'));
      for (const z of [-hz + 0.2, hz - 0.2]) P.brass.push(box(0.07, 0.02, 0.02, s * (hx - 0.035), 0.92, z));
    }
    P.brass.push(cyl(0.022, 2 * hx - 0.3, 0, 0.92, -hz + 0.07, 'x'));
    for (const x of [-hx + 0.2, hx - 0.2]) P.brass.push(box(0.02, 0.02, 0.07, x, 0.92, -hz + 0.035));
    // front wall (car side): steel return panels either side of the door + transom
    const dl = off - dw / 2, drr = off + dw / 2;
    if (dl > -hx + 0.01) P.steel.push(box(dl + hx, CH, 0.03, (-hx + dl) / 2, CH / 2, hz - 0.01));
    if (drr < hx - 0.01) P.steel.push(box(hx - drr, CH, 0.03, (hx + drr) / 2, CH / 2, hz - 0.01));
    P.steel.push(box(dw, CH - 2.1, 0.03, off, 2.1 + (CH - 2.1) / 2, hz - 0.01));
    P.steel.push(box(dw + 0.04, 0.012, 0.12, off, 0.006, hz + 0.04));   // threshold
    return P;
  }
  const kinds = new Map();   // key → {cars, meshes{}, leaf, ind, cop}
  for (const car of cars) {
    const key = `${car.kind}:${car.W.toFixed(2)}:${car.D.toFixed(2)}:${car.doorW}:${car.doorOff.toFixed(2)}:${car.maxD}:${car.minD}`;
    if (!kinds.has(key)) kinds.set(key, { key, cars: [], proto: car });
    const K = kinds.get(key); car.kindRec = K; car.kindI = K.cars.length; K.cars.push(car);
  }
  const carMeshes = [];
  for (const K of kinds.values()) {
    const c0 = K.proto, n = K.cars.length;
    const parts = carParts(c0);
    K.meshes = [];
    for (const m in parts) {
      const list = parts[m].filter(Boolean); if (!list.length) continue;
      const g = mergeL(list, m === 'mirror' ? 0.35 : 1.05);
      const mesh = new THREE.InstancedMesh(g, MAT[m], n);
      mesh.name = 'lift-' + m; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      world.root.add(mesh); K.meshes.push(mesh); carMeshes.push(mesh);
    }
    // car door leaves (2 per car)
    const hz = c0.D / 2 - 0.09, dw = c0.doorW;
    const lg = box(dw / 2 + DOOR_W_GAP, 2.1, 0.03, 0, 1.05, 0); lg.setAttribute('aInt', new THREE.Float32BufferAttribute(new Float32Array(lg.attributes.position.count).fill(1), 1));
    K.leaf = new THREE.InstancedMesh(lg, MAT.steel, n * 2); K.leaf.name = 'lift-carDoor'; K.leaf.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    world.root.add(K.leaf); carMeshes.push(K.leaf);
    K.leafZ = hz + 0.05;
    // in-car position indicator above the door (faces the car interior, -z)
    const ig = plane(0.34, 0.12, c0.doorOff, 2.21, hz - 0.03, Math.PI);
    ig.setAttribute('aInt', new THREE.Float32BufferAttribute(new Float32Array(ig.attributes.position.count).fill(0.3), 1));
    const ignum = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); ignum.setUsage(THREE.DynamicDrawUsage);
    ig.setAttribute('aNum', ignum);
    K.ind = new THREE.InstancedMesh(ig, MAT.ind, n); K.ind.name = 'lift-ind';
    world.root.add(K.ind); carMeshes.push(K.ind);
    // car operating panel (COP) to the right of the door (from inside), facing -z
    const label = c0.kind === 'service' ? 'SERVICE' : 'LARKSPUR';
    // (local +x is on the occupant's left when facing the door, so the panel goes at -x to sit on their right)
    const cg = plane(0.2, 0.54, c0.doorOff - c0.doorW / 2 - 0.17, 1.22, hz - 0.03, Math.PI);
    cg.setAttribute('aInt', new THREE.Float32BufferAttribute(new Float32Array(cg.attributes.position.count).fill(1), 1));
    const copMat = patchSurface(new THREE.MeshStandardMaterial({ map: copTex(c0.served, label), roughness: 0.35, metalness: 0.5 }), { key: 'lift' });
    K.cop = new THREE.InstancedMesh(cg, copMat, n); K.cop.name = 'lift-cop';
    world.root.add(K.cop); carMeshes.push(K.cop);
  }

  // ── visuals: landing fixtures (global instanced; static except indicators/buttons) ──
  const landings = [];
  for (const car of cars) for (const L of car.landings.values()) landings.push({ car, L });
  const nL = landings.length;
  const mk = (geo, mat, n, name, intArr) => {
    geo.setAttribute('aInt', new THREE.InstancedBufferAttribute(intArr, 1));
    const m = new THREE.InstancedMesh(geo, mat, n); m.name = name; world.root.add(m); return m;
  };
  const intArr = () => new Float32Array(nL);
  const ints = landings.map(({ L }) => Math.max(0.55, (L.lobbyRoom?.light ?? 0.9)));
  const fill = (a) => { for (let k = 0; k < nL; k++) a[k] = ints[k]; return a; };
  const panelM = mk(new THREE.BoxGeometry(0.15, 0.36, 0.016).translate(0, 0, 0.008), MAT.steel, nL, 'lift-hallPanel', fill(intArr()));
  const btnGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.014, 20).rotateX(Math.PI / 2).translate(0, 0, 0.022);
  const btnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 1 });
  patchSurface(btnMat, { key: 'liftbtn' });
  {
    const b0 = btnMat.onBeforeCompile;
    btnMat.onBeforeCompile = (sh) => { b0(sh); sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance = vColor.rgb * step(0.9, vColor.r) * 1.6;\n#endif'); };
  }
  const btnUp = mk(btnGeo.clone().translate(0, 0.07, 0), btnMat, nL, 'lift-hallBtnUp', fill(intArr()));
  const btnDn = mk(btnGeo.clone().translate(0, -0.07, 0), btnMat, nL, 'lift-hallBtnDn', fill(intArr()));
  const indGeo = new THREE.PlaneGeometry(0.4, 0.15);
  const indNum = new THREE.InstancedBufferAttribute(new Float32Array(nL), 1); indNum.setUsage(THREE.DynamicDrawUsage);
  indGeo.setAttribute('aNum', indNum);
  const indM = mk(indGeo, MAT.ind, nL, 'lift-hallInd', fill(intArr()));
  const indFrame = mk(new THREE.BoxGeometry(0.48, 0.21, 0.02).translate(0, 0, -0.008), MAT.steel, nL, 'lift-hallIndFrame', fill(intArr()));
  const plqGeo = new THREE.PlaneGeometry(0.17, 0.11);
  const plqNum = new THREE.InstancedBufferAttribute(new Float32Array(nL), 1);
  plqGeo.setAttribute('aNum', plqNum);
  const plqM = mk(plqGeo, MAT.plaque, nL, 'lift-deckPlaque', fill(intArr()));

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
  const lineEdge = (P, dr, s) => {
    if (dr.normal === 'z') { const j = Math.round((dr.line - GRID.z0) / GRID.cell) - 1, i = toI(dr.x + s); if (i < 0 || i >= GRID.nx || j < 0) return 0; return P.ez[idx(i, j)]; }
    const i = Math.round((dr.line - GRID.x0) / GRID.cell) - 1, j = toJ(dr.z + s); if (i < 0 || j < 0 || j >= GRID.nz) return 0; return P.ex[idx(i, j)];
  };
  const colIdle = new THREE.Color(0x9aa0a6), colLit = new THREE.Color(1.0, 0.62, 0.18);
  landings.forEach(({ car, L }, k) => {
    const dr = L.door, P = plans[L.deck], y = deckY(L.deck);
    // lobby side sign (local z toward lobby)
    const shaftPlus = P.roomAt(dr.normal === 'z' ? dr.x : dr.x + 0.25, dr.normal === 'z' ? dr.z + 0.25 : dr.z)?.car === car.id;   // shaft on the +axis side
    const ls = shaftPlus ? -1 : 1;
    // faces the lobby: plane +z → lobby direction
    const rotY = dr.normal === 'z' ? (ls > 0 ? 0 : Math.PI) : (ls > 0 ? Math.PI / 2 : -Math.PI / 2);
    // choose the side with a solid wall for the call panel
    let side = 1;
    const sOK = (sd) => { const t = lineEdge(P, dr, sd * (dr.w / 2 + 0.3)); return t === 1; };
    if (!sOK(1) && sOK(-1)) side = -1;
    const lxp = side * (dr.w / 2 + 0.32);
    const face = 0.07 + 0.002;
    // lx: along the wall run (+x for 'z' doors, +z for 'x' doors); lz: distance out into the lobby
    const W2 = (lx, lz) => dr.normal === 'z' ? [dr.x + lx, dr.z + lz * ls] : [dr.x + lz * ls, dr.z + lx];
    const place2 = (mesh, lx, yy, lz) => { const [wx, wz] = W2(lx, lz); _p.set(wx, y + yy, wz); _q.setFromAxisAngle(_up, rotY); _m.compose(_p, _q, _s); mesh.setMatrixAt(k, _m); };
    place2(panelM, lxp, 1.12, face);
    place2(btnUp, lxp, 1.12, face);
    place2(btnDn, lxp, 1.12, face);
    place2(plqM, lxp, 1.52, face + 0.001);
    place2(indFrame, 0, 2.36, face + 0.012);
    place2(indM, 0, 2.36, face + 0.016);
    plqNum.array[k] = L.deck;
    L.k = k; L.ls = ls;
    btnUp.setColorAt(k, colIdle); btnDn.setColorAt(k, colIdle);
    // top / bottom landings have only one button: hide the other by scaling to 0
    if (L.deck === car.maxD) { btnUp.getMatrixAt(k, _m); _m.scale(new THREE.Vector3(0.001, 0.001, 0.001)); btnUp.setMatrixAt(k, _m); }
    if (L.deck === car.minD) { btnDn.getMatrixAt(k, _m); _m.scale(new THREE.Vector3(0.001, 0.001, 0.001)); btnDn.setMatrixAt(k, _m); }
  });
  for (const m of [panelM, btnUp, btnDn, indM, indFrame, plqM]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  btnUp.instanceColor.needsUpdate = true; btnDn.instanceColor.needsUpdate = true;

  // ── per-frame visual sync ─────────────────────────────────────────────
  const _v = new THREE.Vector3();
  function writeCar(car) {
    const K = car.kindRec, i = car.kindI;
    _p.set(car.cx, car.y, car.cz); _q.setFromAxisAngle(_up, car.rot); _m.compose(_p, _q, _s);
    for (const mesh of K.meshes) mesh.setMatrixAt(i, _m);
    K.ind.setMatrixAt(i, _m); K.cop.setMatrixAt(i, _m);
    // door leaves
    const e = car.door * car.door * (3 - 2 * car.door);
    const dw = car.doorW, slide = (dw / 2 - 0.03) * e;
    for (const s of [-1, 1]) {
      const lx = car.doorOff + s * (dw / 4 + DOOR_W_GAP / 2) + s * slide;
      _v.set(lx, 0, car.kindRec.leafZ).applyQuaternion(_q);
      const M2 = new THREE.Matrix4().compose(_v.add(_p), _q, _s);
      K.leaf.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), M2);
      _p.set(car.cx, car.y, car.cz);
    }
    K.dirty = true;
  }
  function numOf(car) { const dir = car.moving ? (car.v > 0 ? 1 : 2) : (car.state === 'opening' || car.state === 'open') && car.dir ? (car.dir > 0 ? 1 : 2) : 0; return car.deck + dir * 100; }
  for (const car of cars) writeCar(car);
  for (const K of kinds.values()) { for (const m of [...K.meshes, K.leaf, K.ind, K.cop]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); } }

  // ── player riding ─────────────────────────────────────────────────────
  const ui = buildUI(game);
  let uiCar = null;
  function playerCar(p) {
    const r = world.roomAt(p.deck, p.x, p.z);
    if (!r || !r.car) return null;
    const car = byId.get(r.car); if (!car) return null;
    if (p.elevator === car.id) return car;
    // entering: car floor must be at this deck
    if (Math.abs(car.y - deckY(p.deck)) < 0.35) return car;
    return null;
  }
  function setDeck(p, d) {
    if (d === p.deck) return;
    if (typeof p._setDeck === 'function') p._setDeck(d);
    else { p.deck = d; world.setActiveDeck(d); bus.emit('player:deck', { deck: d }); }
  }
  function updatePlayer(dt) {
    const p = game.player; if (!p) return;
    const car = (p.state === 'free' || p.state === 'elevator') ? playerCar(p) : null;
    if (car) {
      if (p.state !== 'elevator') { p.state = 'elevator'; p.elevator = car.id; bus.emit('elevator:enter', { car: car.id, deck: p.deck }); }
      p.elevator = car.id;
      p.y = car.y; p.vy = 0; p.onGround = true;
      setDeck(p, deckOf(car.y));
      if (uiCar !== car) { uiCar = car; ui.open(car); }
      ui.update(car, dt);
    } else {
      if (p.state === 'elevator') { p.state = 'free'; bus.emit('elevator:exit', { car: p.elevator, deck: p.deck }); }
      if (p.elevator) p.elevator = null;
      if (uiCar) { uiCar = null; ui.close(); }
    }
  }
  ui.onSelect = (deck) => { if (uiCar) ride(game.player, uiCar.id, deck); };
  ui.onOpen = () => { if (uiCar && uiCar.state !== 'moving') reopen(uiCar); };

  // ── interaction: call at a landing ────────────────────────────────────
  game.interact?.addProvider((ctx) => {
    const p = ctx.player || game.player; if (!p || p.state !== 'free') return null;
    const near = world.doorsNear(ctx.deck, ctx.x, ctx.z, 2.2);
    for (const { door } of near) {
      if (door.type !== 'elevator') continue;
      const car = byId.get(door.car); if (!car) continue;
      const L = car.landings.get(ctx.deck); if (!L) continue;
      // must be on the lobby side (not inside a shaft / car)
      const pr = world.roomAt(ctx.deck, ctx.x, ctx.z); if (pr && pr.car) continue;
      const lz = door.normal === 'z' ? ctx.z - door.z : ctx.x - door.x;
      const lx = door.normal === 'z' ? ctx.x - door.x : ctx.z - door.z;
      const dist = Math.hypot(Math.max(0, Math.abs(lx) - door.w / 2), lz);
      if (dist > 1.6) continue;
      const G = groups.get(car.core);
      const pending = G.hall.get(ctx.deck);
      const here = G.cars.find(c => c.atDeck === ctx.deck && (c.state === 'open' || c.state === 'opening'));
      if (here) return null;
      return [{
        id: `lift:${car.core}:${ctx.deck}`, label: pending ? 'Elevator on its way' : 'Call elevator', key: 'E',
        x: door.x, y: deckY(ctx.deck) + 1.2, z: door.z, dist, priority: 1, enabled: true,
        run: () => { call(car.core, ctx.deck); bus.emit('sfx', { name: 'button', x: door.x, y: deckY(ctx.deck) + 1.1, z: door.z, deck: ctx.deck, vol: 0.5 }); },
      }];
    }
    return null;
  }, 'elevators');

  // ── NPC abstraction ───────────────────────────────────────────────────
  function nearestCore(deck, x, z, opts = {}) {
    const P = plans[deck]; if (!P) return null;
    let best = null, bd = Infinity;
    for (const c of P.cores) {
      if (opts.crew === false && c.kind === 'crew') continue;
      if (opts.crew === true && c.kind !== 'crew') continue;
      const lob = P.rooms[c.lobby];
      const cz = lob ? lob.cz : 0;
      const d = Math.hypot(c.x - x, cz - (z ?? 0));
      if (d < bd) { bd = d; best = { core: c.core, kind: c.kind, x: c.x, z: cz, lobby: c.lobby, cars: c.cars, dist: d }; }
    }
    return best;
  }
  function eta(core, fromDeck, toDeck) {
    const G = groups.get(core); if (!G) return 6 + Math.abs(toDeck - fromDeck) * 2;
    let wait = Infinity;
    for (const c of G.cars) if (c.served.includes(fromDeck) && c.served.includes(toDeck)) wait = Math.min(wait, Math.max(0, carCost(c, fromDeck)));
    if (!Number.isFinite(wait)) wait = 20;
    return wait + DOOR_T * 2 + DWELL * 0.6 + travelTime((toDeck - fromDeck) * 3) + DOOR_T + 1.5;
  }
  function useAbstract(npc, fromDeck, toDeck, coreId) {
    const core = coreId || nearestCore(fromDeck, npc?.x ?? 0, npc?.z ?? 0)?.core;
    const t = eta(core, fromDeck, toDeck);
    // near the player: make it real — summon a car so the lobby feels alive
    const pd = game.player?.deck ?? world.activeDeck;
    if (Math.abs(fromDeck - pd) <= 1 && groups.has(core)) {
      const car = call(core, fromDeck);
      if (car && car.served.includes(toDeck)) { car.stops.add(toDeck); refreshQueue(car); }
    }
    return t;
  }

  // ── system ───────────────────────────────────────────────────────────
  const prevNum = new Map();
  game.addSystem({
    name: 'elevators', order: 31,
    update(dt) {
      if (dt <= 0) return;
      now.t += dt;
      for (const car of cars) {
        const st0 = car.state, y0 = car.y, door0 = car.door, at0 = car.atDeck;
        stepCar(car, dt);
        car.doorOpen = car.door;
        // landing door follows the car door at the stop
        if (car.atDeck != null && (car.door !== door0 || at0 !== car.atDeck)) setLanding(car, car.atDeck, car.door);
        if (at0 != null && at0 !== car.atDeck) setLanding(car, at0, 0);
        if (car.y !== y0 || car.door !== door0) writeCar(car);
        // indicators
        const num = numOf(car);
        if (prevNum.get(car) !== num) {
          prevNum.set(car, num);
          car.kindRec.ind.geometry.attributes.aNum.array[car.kindI] = num; car.kindRec.ind.geometry.attributes.aNum.needsUpdate = true;
          for (const L of car.landings.values()) indNum.array[L.k] = num;
          indNum.needsUpdate = true;
        }
      }
      // hall buttons: lit while a call is pending at that deck in that core
      let btnDirty = false;
      for (const { car, L } of landings) {
        const G = groups.get(car.core);
        const h = G.hall.get(L.deck);
        // calls are not directional here: a pending call lights the landing's button(s)
        const upLit = !!h && L.deck !== car.maxD, dnLit = !!h && L.deck !== car.minD;
        if (L._up !== upLit) { btnUp.setColorAt(L.k, upLit ? colLit : colIdle); L._up = upLit; btnDirty = true; }
        if (L._dn !== dnLit) { btnDn.setColorAt(L.k, dnLit ? colLit : colIdle); L._dn = dnLit; btnDirty = true; }
      }
      if (btnDirty) { btnUp.instanceColor.needsUpdate = true; btnDn.instanceColor.needsUpdate = true; }
      for (const K of kinds.values()) if (K.dirty) { for (const m of [...K.meshes, K.leaf, K.ind, K.cop]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); } K.dirty = false; }
      updatePlayer(dt);
    },
  });

  const api = game.elevators = {
    cars, groups, car: (id) => byId.get(id) || null,
    call, ride, useAbstract, nearestCore, eta, travelTime,
    openUI: (id) => { const c = byId.get(id); if (c) ui.open(c); }, closeUI: () => ui.close(),
    setDisabled(id, b = true) { const c = byId.get(id); if (c) c.disabled = !!b; },
    materials: MAT,
  };
  return api;
}

// ── in-car deck selector UI ──────────────────────────────────────────────
function buildUI(game) {
  const CSS = `
.lift-ui{position:fixed;right:28px;top:50%;transform:translate(16px,-50%);width:212px;padding:14px 14px 12px;background:rgba(10,14,20,.72);
  border:1px solid rgba(201,164,91,.35);border-radius:14px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#f1ece2;
  font:500 13px/1.2 Inter,system-ui,sans-serif;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;z-index:30;user-select:none}
.lift-ui.on{opacity:1;transform:translate(0,-50%);pointer-events:auto}
.lift-ui .lu-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.lift-ui .lu-name{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#c9a45b}
.lift-ui .lu-cur{display:flex;align-items:center;gap:6px;font:600 30px/1 'Courier New',monospace;color:#ffb052;text-shadow:0 0 10px rgba(255,150,40,.55);background:#07090c;
  padding:4px 10px;border-radius:6px;min-width:66px;justify-content:center}
.lift-ui .lu-cur i{font-style:normal;font-size:16px;width:12px;text-align:center}
.lift-ui .lu-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.lift-ui button{all:unset;cursor:pointer;height:34px;border-radius:17px;text-align:center;font:600 14px/34px Inter,system-ui,sans-serif;color:#e9e4da;
  background:linear-gradient(#3a4049,#262b32);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 1px 0 rgba(0,0,0,.4);transition:background .15s, box-shadow .15s, color .15s}
.lift-ui button:hover{box-shadow:inset 0 0 0 1px rgba(201,164,91,.7)}
.lift-ui button.hl{box-shadow:inset 0 0 0 2px #c9a45b}
.lift-ui button.q{color:#1a1206;background:radial-gradient(#ffd08a,#e09a3c);box-shadow:0 0 12px rgba(255,160,60,.55)}
.lift-ui button.here{color:#7d858f}
.lift-ui button.wide{grid-column:span 3;font-size:12px;letter-spacing:.06em}
.lift-ui .lu-hint{margin-top:9px;font-size:10.5px;color:#8f98a3;letter-spacing:.02em;line-height:1.45}
.lift-ui .lu-hint b{color:#d9cfbd;font-weight:600}`;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.className = 'lift-ui';
  root.innerHTML = `<div class="lu-top"><div class="lu-name"></div><div class="lu-cur"><i></i><span></span></div></div><div class="lu-grid"></div><div class="lu-hint"><b>0–9</b> type deck · <b>PgUp/PgDn</b> or wheel · <b>Enter</b> go</div>`;
  (document.getElementById('ui') || document.body).appendChild(root);
  const nameEl = root.querySelector('.lu-name'), curEl = root.querySelector('.lu-cur span'), arrEl = root.querySelector('.lu-cur i'), grid = root.querySelector('.lu-grid');
  const S = { car: null, hl: 0, buf: '', bufT: 0, buttons: new Map(), onSelect: null, onOpen: null };
  const api = {
    set onSelect(f) { S.onSelect = f; }, set onOpen(f) { S.onOpen = f; },
    open(car) {
      S.car = car; S.buttons.clear(); grid.innerHTML = '';
      const coreName = { aft: 'Aft', mid: 'Midship', fwd: 'Forward' }[car.core] || ('Service ' + car.core.replace(/^c/, '').toUpperCase());
      nameEl.textContent = car.kind === 'service' ? `${coreName} lift` : `${coreName} · ${car.id.split('-')[1]}`;
      for (const d of [...car.served].sort((a, b) => b - a)) {
        const b = document.createElement('button'); b.textContent = String(d);
        b.addEventListener('mousedown', (e) => { e.stopPropagation(); S.onSelect?.(d); });
        grid.appendChild(b); S.buttons.set(d, b);
      }
      const ob = document.createElement('button'); ob.className = 'wide'; ob.textContent = '◀ ▶  OPEN DOORS';
      ob.addEventListener('mousedown', (e) => { e.stopPropagation(); S.onOpen?.(); });
      grid.appendChild(ob);
      S.hl = car.deck; root.classList.add('on');
    },
    close() { S.car = null; root.classList.remove('on'); },
    update(car, dt) {
      const input = game.input;
      const served = car.served;
      if (input) {
        // typed deck number (two-digit buffer)
        for (let k = 0; k <= 9; k++) {
          if (input.pressed('Digit' + k) || input.pressed('Numpad' + k)) {
            S.buf = (S.bufT > 0 ? S.buf : '') + k; S.bufT = 0.9;
            const n = parseInt(S.buf, 10);
            if (served.includes(n)) S.hl = n;
            if (S.buf.length >= 2 || !served.some(d => String(d).startsWith(S.buf) && String(d) !== S.buf)) { if (served.includes(n)) S.onSelect?.(n); S.buf = ''; S.bufT = 0; }
          }
        }
        if (S.bufT > 0) { S.bufT -= dt; if (S.bufT <= 0) { const n = parseInt(S.buf, 10); if (served.includes(n)) S.onSelect?.(n); S.buf = ''; } }
        let step = 0;
        if (input.pressed('PageUp')) step = 1;
        if (input.pressed('PageDown')) step = -1;
        if (input.mouse && input.mouse.wheel) { step = -Math.sign(input.mouse.wheel); input.mouse.wheel = 0; }   // consumed (camera zoom would also react)
        if (step) { const i = served.indexOf(S.hl); const j = Math.max(0, Math.min(served.length - 1, (i < 0 ? served.indexOf(car.deck) : i) + step)); S.hl = served[j]; }
        if (input.pressed('Enter') || input.pressed('NumpadEnter')) S.onSelect?.(S.hl);
      }
      curEl.textContent = String(car.deck);
      arrEl.textContent = car.moving ? (car.v > 0 ? '▲' : '▼') : '';
      for (const [d, b] of S.buttons) {
        const q = car.stops.has(d), here = car.atDeck === d && !car.moving, hl = d === S.hl;
        const cls = (q ? 'q ' : '') + (here ? 'here ' : '') + (hl ? 'hl' : '');
        if (b._c !== cls) { b.className = cls; b._c = cls; }
      }
    },
  };
  return api;
}
