// 40 hidden brass "Larkspur medallions" across every deck. Small glinting meshes with a
// subtle shine, placed deterministically on walkable, reachable cells. Collecting gives cash
// and increments a counter. Persistent via game.save if present.
import * as THREE from 'three';
import { GRID, deckY, cellX, cellZ, idx, toI, toJ } from '../../core/config.js';
import { Rng, hash32 } from '../../core/util.js';
import { patchSurface } from '../../world/materials.js';
import { toast } from './ui.js';

const COUNT = 40;
const REWARD = 50;

// Choose deterministic placements: spread across decks (incl. crew, exterior, bridge, funnel).
// Each placement must be a walkable cell (plan.block === 0, room not void/shaft) reachable.
export function placeMedallions(game) {
  const L = game.layout; if (!L) return [];
  const plans = game.world.plans;
  const spots = [];
  // deck weights: ensure coverage of interesting areas
  const deckList = [];
  for (let d = 1; d <= 17; d++) deckList.push(d);
  const rng = new Rng(0xBEEF);
  // gather candidate walkable cells per deck once
  function candidates(d) {
    const plan = plans[d]; if (!plan) return [];
    const cand = [];
    const { nx, nz } = GRID;
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = idx(i, j);
      if (plan.block[k]) continue;
      const r = plan.rooms[plan.room[k]];
      if (!r || r.isVoid || r.type === 'shaft' || r.pool) continue;
      // avoid door cells and spots too close to walls on all sides (want a standable 0.3 m)
      cand.push({ i, j, x: cellX(i), z: cellZ(j), room: r });
    }
    return cand;
  }
  // distribute 40 across decks: a couple per deck, extra into landmark decks
  const perDeck = {};
  for (let d = 1; d <= 17; d++) perDeck[d] = 2;      // 34
  // remaining 6 → scenic/landmark decks
  for (const d of [5, 15, 16, 13, 17, 16]) perDeck[d]++;
  let placed = 0;
  for (let d = 1; d <= 17 && placed < COUNT; d++) {
    const cand = candidates(d);
    if (!cand.length) continue;
    const want = Math.min(perDeck[d], COUNT - placed);
    // pick well-separated cells deterministically
    const chosen = [];
    let tries = 0;
    while (chosen.length < want && tries < 400) {
      tries++;
      const c = cand[Math.floor(rng.next() * cand.length)];
      if (chosen.some(o => Math.hypot(o.x - c.x, o.z - c.z) < 12)) continue;
      // require a little clearance so the player can stand on it
      const col = game.world.collide(d, c.x, c.z, 0.3, { ignoreItems: false });
      if (col.hit) continue;
      chosen.push(c);
    }
    for (const c of chosen) {
      spots.push({ id: placed, deck: d, x: c.x, z: c.z, y: game.world.floorY(d, c.x, c.z), room: c.room.name });
      placed++;
      if (placed >= COUNT) break;
    }
  }
  return spots;
}

export function registerCollectibles(game, A) {
  const spots = placeMedallions(game);
  const collected = new Set();
  A.medallions = { spots, collected, total: COUNT, count: () => collected.size };

  // ── meshes: one small brass disc per deck, shown only for the active deck ±1 ──
  const geo = new THREE.CylinderGeometry(0.11, 0.11, 0.03, 16);
  geo.rotateX(Math.PI / 2);                   // face up-ish; we'll tilt
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9a45b, metalness: 1.0, roughness: 0.25, emissive: 0x3a2d10, emissiveIntensity: 0.5 });
  patchSurface(mat, { key: 'medallion', intDefault: 0.4 });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false;
  const ia = new THREE.InstancedBufferAttribute(new Float32Array(COUNT), 1); geo.setAttribute('aInt', ia);
  game.scene.add(mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();

  let t = 0;
  game.addSystem({
    name: 'medallions', order: 71,
    update(dt) {
      t += dt;
      const fd = game.player?.deck ?? game.world.activeDeck;
      let k = 0;
      for (const sp of spots) {
        if (collected.has(sp.id)) continue;
        if (Math.abs(sp.deck - fd) > 1) continue;
        if (k >= COUNT) break;
        const spin = t * 1.6 + sp.id;
        const bob = Math.sin(t * 2 + sp.id * 1.3) * 0.04;
        e.set(Math.PI / 2 * 0.15, spin, 0); q.setFromEuler(e);
        pos.set(sp.x, sp.y + 0.6 + bob, sp.z); m.compose(pos, q, s);
        mesh.setMatrixAt(k, m); ia.array[k] = Math.abs(sp.deck - fd) === 0 ? 0.6 : 0.2;
        sp._slot = k; k++;
      }
      mesh.count = k; mesh.instanceMatrix.needsUpdate = true; ia.needsUpdate = true;
    },
  });

  function collect(sp) {
    if (collected.has(sp.id)) return;
    collected.add(sp.id);
    game.economy?.add(REWARD, 'Larkspur medallion');
    game.inventory?.add('medallion', 1);
    game.bus?.emit('sfx', { name: 'levelup', vol: 0.5 });
    toast(game, `Larkspur medallion ${collected.size}/${COUNT}  (+${REWARD}§)`, 'good');
    game.bus?.emit('activity:medallion', { id: sp.id, count: collected.size });
  }
  A.collectMedallion = collect;

  // interaction: pick up a medallion you're standing near
  game.interact.addProvider((ctx) => {
    const fd = ctx.deck;
    const out = [];
    for (const sp of spots) {
      if (collected.has(sp.id) || sp.deck !== fd) continue;
      const d = Math.hypot(sp.x - ctx.x, sp.z - ctx.z);
      if (d > 1.6) continue;
      out.push({ id: 'medal:' + sp.id, label: 'Collect medallion', key: 'E', x: sp.x, y: sp.y + 0.6, z: sp.z, dist: d, priority: 3, enabled: true, run: () => collect(sp) });
    }
    return out;
  }, 'medallions');

  // save
  game.save?.register?.('medallions', {
    save: () => ({ collected: [...collected] }),
    load: (dta) => { if (dta?.collected) for (const id of dta.collected) collected.add(id); },
  });
}
