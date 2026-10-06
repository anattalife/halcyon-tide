// World: owns the ship layout, deck meshes (streamed by player deck), doors state
// and all spatial queries (collision, floor height, room lookup, line of sight).
import * as THREE from 'three';
import { GRID, SHIP, deckY, deckOfY, idx, toI, toJ, cellX, cellZ } from '../core/config.js';
import { buildDeck, buildExterior, makeExtAccumulators, chunkOf, chunkX0, CHUNK } from './deckBuilder.js';

const BLOCK_T = [0, 1, 0, 1, 1, 0, 1];   // edge types that block movement (2 = door handled separately)

// ── Visibility & streaming (rendering/perf) ─────────────────────────────────
// All per-deck interior geometry ("detail") is built up front and split into CHUNK-metre x-slices; interior furniture
// is grouped into room clusters (single venues, or blocks of small rooms ~12 m long per side). Each frame-ish,
// updateVisibility(camera) runs a tiny portal pass over a room graph (open adjacencies, glass, open doors, atrium voids,
// stairwells) starting at the camera's room, and shows only what that pass reaches:
//   • detail chunks overlapped by reached rooms (others hidden; their exterior "shell" window panes shown instead),
//   • furniture clusters of reached rooms within the quality's detail distance (simplified LOD geometry beyond lodDist),
//   • shared exterior slices only when something outside is visible (exterior room, window or glass reached), with
//     fine exterior detail (rail glass, posts) dropped beyond fineDist and exterior furniture beyond extFurnDist,
//   • shadow casting limited to geometry near the camera.
// game.world.vis exposes the last result ({indoor, seesOut, nodes, decks}).
const VIS_DEFAULT = { detailDist: 75, lodDist: 24, fineDist: 120, extFurnDist: 110, shadowDist: 55, detailRadius: 2 };
const SMALL_TYPES = new Set(['cabin', 'suite', 'crew_cabin', 'officer', 'office', 'store', 'service', 'laundry', 'medical', 'security', 'brig']);

export class World {
  constructor(scene, layout, mats, bus) {
    this.scene = scene; this.layout = layout; this.plans = layout.plans; this.mats = mats; this.bus = bus;
    this.root = new THREE.Group(); this.root.name = 'ship'; scene.add(this.root);
    this.extRoot = new THREE.Group(); this.extRoot.name = 'ship-ext'; this.root.add(this.extRoot);
    this.decks = [];
    this.activeDeck = 0; this.detailRadius = 1;
    this.fixtures = [];
    this.doorState = new Map();   // key deck:id → door object (plan door, runtime fields)
    this.itemGrid = [];            // per deck: Map cellKey → item list (blockers)
    this.extMeshes = [];           // [{mesh, c, kind}] shared exterior slices
    this.furn = [];                // [{mesh, glass, deck, cluster, ext, lod, cast}]
    this._furnSet = new WeakSet();
    this.visCfg = { ...VIS_DEFAULT };
    this.vis = { indoor: false, seesOut: true, nodes: 0, decks: [], mode: 'init' };
    this._visT = 0; this._visKey = '';
    this.hull = null;
    for (let d = 1; d <= SHIP.deckCount; d++) this._indexItems(d);
    for (let d = 1; d <= SHIP.deckCount; d++) this._buildGraph(d);
    this._linkDecks();
  }

  _addDeck(d, b) {
    const ext = new THREE.Group(); ext.name = `deck${d}-ext`;     // exterior furniture / signs (furniture.js adds here)
    this.root.add(ext);
    this.root.add(b.detail); b.detail.visible = false;
    if (b.shell) this.root.add(b.shell);
    this.decks[d] = { ...b, ext, detailOn: false, chunkMeshes: b.detail.children.filter(m => m.userData.chunk), shellMeshes: b.shell ? b.shell.children : [] };
  }
  _finishExterior(E) {
    for (const e of buildExterior(E, this.mats)) { this.extRoot.add(e.mesh); this.extMeshes.push(e); }
  }
  buildAll(onProgress) {
    const E = makeExtAccumulators();
    for (let d = 1; d <= SHIP.deckCount; d++) { this._addDeck(d, buildDeck(this.plans, d, this.mats, E)); onProgress && onProgress(d / SHIP.deckCount); }
    this._finishExterior(E);
  }
  async buildAllAsync(onProgress) {
    const E = makeExtAccumulators();
    for (let d = 1; d <= SHIP.deckCount; d++) {
      this._addDeck(d, buildDeck(this.plans, d, this.mats, E));
      onProgress && onProgress(d / SHIP.deckCount, d);
      await new Promise(r => setTimeout(r, 0));
    }
    this._finishExterior(E);
  }

  // Quality hook (main.js): detail radius in decks, distances in metres
  setQuality(q) {
    const k = q.detailScale ?? 1;
    this.visCfg = { ...VIS_DEFAULT, detailRadius: q.detailRadius ?? 2, detailDist: 75 * k, lodDist: 24 * k, fineDist: 120 * k, extFurnDist: 110 * k, shadowDist: (q.shadowDist ?? 55), drawDistance: q.drawDistance ?? 3000 };
    this.detailRadius = this.visCfg.detailRadius;
    this._visKey = ''; this._visT = 0;
  }

  // Furniture registration hook (furniture.js): cluster-tagged instanced meshes
  addFurniture(d, rec) {
    const D = this.decks[d];
    rec.deck = d; rec.cast = rec.mesh.castShadow;
    (rec.ext ? D.ext : D.detail).add(rec.mesh);
    if (rec.glass) (rec.ext ? D.ext : D.detail).add(rec.glass);
    rec.mesh.geometry.boundingSphere || rec.mesh.computeBoundingSphere();
    rec.sphere = rec.mesh.boundingSphere ? rec.mesh.boundingSphere.clone() : null;
    rec.base = rec.mesh.geometry; rec.lodOn = false;
    // shadow proxy: same instances (shared instanceMatrix), far-LOD geometry, rendered only by the sun's shadow camera
    // (layer 1); the visible mesh itself never casts. Cuts shadow-pass triangles ~3× for loungers, chairs etc.
    if (rec.cast) {
      rec.mesh.castShadow = false;
      const px = new THREE.InstancedMesh(rec.lod || rec.base, rec.mesh.material, rec.mesh.count);
      px.instanceMatrix = rec.mesh.instanceMatrix; px.count = rec.mesh.count;
      px.boundingSphere = rec.sphere; px.layers.set(1); px.castShadow = true; px.receiveShadow = false;
      px.matrixAutoUpdate = false; px.name = rec.mesh.name + '-shadow';
      rec.mesh.parent.add(px); this._furnSet.add(px); rec.proxy = px;
    }
    rec.chunk = rec.sphere ? chunkOf(rec.sphere.center.x) : 0;
    this._furnSet.add(rec.mesh); if (rec.glass) this._furnSet.add(rec.glass);
    this.furn.push(rec);
    return rec;
  }
  // room → furniture cluster id (shared with furniture.js)
  // (venues/corridors are additionally split per x-chunk, so a 300 m corridor only shows the furniture near you)
  clusterOf(d, room, x) {
    if (!room || room.exterior) return 'E';
    if (!room.isVoid && SMALL_TYPES.has(room.type) && (room.area ?? 0) < 90) return `B${room.cz > 0 ? 1 : 0}:${Math.floor((room.cx - SHIP.xMin) / 12)}`;
    return 'R' + room.id + ':' + (chunkOf(x) >> 1);
  }
  _addClusters(set, d, r, xa, xb) {
    if (!r.exterior && !r.isVoid && SMALL_TYPES.has(r.type) && (r.area ?? 0) < 90) { set.add(this.clusterOf(d, r, r.cx)); return; }
    for (let c = chunkOf(xa) >> 1; c <= chunkOf(Math.max(xa, xb - 1e-3)) >> 1; c++) set.add('R' + r.id + ':' + c);
  }

  // legacy API: the visible set now follows the camera; this just records the player's deck (and keeps the event)
  setActiveDeck(d, radius, force = false) {
    if (!force && d === this.activeDeck) return;
    this.activeDeck = d;
    this._visKey = ''; this._visT = 0;
    this.bus?.emit('world:activeDeck', d);
  }

  // ── room graph ───────────────────────────────────────────────────────────
  _buildGraph(d) {
    const p = this.plans[d]; const R = p.rooms; const nx = GRID.nx, nz = GRID.nz;
    const adj = R.map(() => new Map());
    const seesOut = new Uint8Array(R.length);
    const link = (a, b, kind, door) => {
      if (a === b) return;
      if (!a || !b) { const r = a || b; if (r && (kind === 'see' || kind === 'open')) seesOut[r] = 1; return; }
      for (const [x, y] of [[a, b], [b, a]]) {
        let e = adj[x].get(y);
        if (!e) { e = { open: false, see: false, doors: [] }; adj[x].set(y, e); }
        if (kind === 'open') e.open = true; else if (kind === 'see') e.see = true; else if (kind === 'door' && !e.doors.includes(door)) e.doors.push(door);
      }
    };
    const facadeSee = (a, b) => { const r = R[a] && !R[a].exterior && !R[a].isVoid ? R[a] : R[b]; return r && (r.facade === 'glass' || r.facade === 'window' || r.facade === 'porthole'); };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = idx(i, j), a = p.room[k];
      if (i < nx - 1) {
        const b = p.room[k + 1], t = p.ex[k];
        if (t === 0 && a !== b) link(a, b, 'open');
        else if (t === 2) link(a, b, 'door', p.dx[k]);
        else if (t === 3 || t === 6) link(a, b, 'see');
        else if (t === 4 && facadeSee(a, b)) link(a, b, 'see');
      }
      if (j < nz - 1) {
        const b = p.room[k + nx], t = p.ez[k];
        if (t === 0 && a !== b) link(a, b, 'open');
        else if (t === 2) link(a, b, 'door', p.dz[k]);
        else if (t === 3 || t === 6) link(a, b, 'see');
        else if (t === 4 && facadeSee(a, b)) link(a, b, 'see');
      }
    }
    for (let r = 1; r < R.length; r++) if (R[r] && R[r].exterior) seesOut[r] = 1;
    p._vis = { adj, seesOut, up: R.map(() => []), down: R.map(() => []) };
  }
  _linkDecks() {
    const pts = (r) => [[r.cx, r.cz], [(r.x0 * 3 + r.x1) / 4, r.cz], [(r.x0 + r.x1 * 3) / 4, r.cz], [r.cx, (r.z0 * 3 + r.z1) / 4], [r.cx, (r.z0 + r.z1 * 3) / 4]];
    for (let d = 1; d <= SHIP.deckCount; d++) {
      const p = this.plans[d], lo = this.plans[d - 1], hi = this.plans[d + 1];
      for (const r of p.rooms) {
        if (!r) continue;
        const V = p._vis;
        // a void on deck d looks down into deck d-1 (and up through stacked voids); stairs connect both ways
        if (r.isVoid && lo) for (const [x, z] of pts(r)) { const q = lo.roomAt(x, z); if (q && !V.down[r.id].includes(q.id)) { V.down[r.id].push(q.id); lo._vis.up[q.id].push(r.id); } }
        if (r.ramp && hi) for (const [x, z] of pts(r)) { const q = hi.roomAt(x, z); if (q && !V.up[r.id].includes(q.id)) { V.up[r.id].push(q.id); hi._vis.down[q.id].push(r.id); } }
      }
    }
  }

  // ── per-frame visibility ────────────────────────────────────────────────
  updateVisibility(camera, opts = {}) {
    const cfg = this.visCfg;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const P = opts.player;
    // camera deck & room (fall back to the player's room when the camera sits in a wall cell)
    let cd = opts.deck || deckOfY(cy + 0.4);
    let room = this.roomAt(cd, cx, cz);
    if ((!room || room.type === 'shaft') && P && P.deck) { const pr = this.roomAt(P.deck, P.x, P.z); if (pr && Math.abs(P.y - cy) < 4 && Math.hypot(P.x - cx, P.z - cz) < 6) { room = pr; cd = P.deck; } }
    // inside the hull footprint but between decks/walls with no room: treat as outside
    const key = cd + ':' + (room ? room.id : 0);
    this._visT -= opts.dt ?? 0.016;
    if (key !== this._visKey || this._visT <= 0 || opts.force) { this._visKey = key; this._visT = 0.2; this._portal(cd, room, cx, cz, P); }
    this._applyVis(cx, cy, cz);
  }

  _portal(cd, room, cx, cz, P) {
    const cfg = this.visCfg;
    const chunks = this._chunkSets || (this._chunkSets = []);
    const clusters = this._clusterSets || (this._clusterSets = []);
    for (let d = 1; d <= SHIP.deckCount; d++) { (chunks[d] || (chunks[d] = new Set())).clear(); (clusters[d] || (clusters[d] = new Set())).clear(); }
    let seesOut = !room, nodes = 0;
    const perDeck = this._perDeck || (this._perDeck = new Int16Array(SHIP.deckCount + 2)); perDeck.fill(0);
    // windows we look out of (indoors): per deck, a bitmask of x-chunks containing a reached room that sees outside
    const outMask = this._outMask || (this._outMask = new Uint32Array(SHIP.deckCount + 2)); outMask.fill(0);
    const maxDist = cfg.detailDist + 15;
    if (room) {
      const seen = new Set();
      // queue entries: [deck, room, depth, off] — off = hops taken since leaving the camera deck (-1 on it). Through a
      // stairwell or atrium void you only see the rooms right there (open/glass adjacency, ≤2 hops, no doors).
      const q = [[cd, room.id, 0, -1]];
      seen.add(cd * 4096 + room.id);
      while (q.length && nodes < 260) {
        const [d, rid, depth, off] = q.shift();
        const p = this.plans[d], r = p.rooms[rid]; if (!r) continue;
        nodes++; perDeck[d]++;
        // a window/glass room only counts as "seeing out" when it is near the camera (beyond ~45 m the outside
        // through it is a few pixels); rooms reached through another deck's stair/void are clipped to the opening
        const rdx = Math.max(r.x0 - cx, 0, cx - r.x1), rdz = Math.max(r.z0 - cz, 0, cz - r.z1), rd = Math.hypot(rdx, rdz);
        if (p._vis.seesOut[rid] && (rd < 45 || r.exterior) && (off < 0 || rd < 20)) {
          if (!seesOut) this._outVia = (r.name || r.type) + '@' + d; seesOut = true;
          const wa = Math.max(r.x0, cx - 45), wb = Math.min(r.x1, cx + 45);
          for (let c = chunkOf(wa); c <= chunkOf(Math.max(wa, wb - 1e-3)); c++) outMask[d] |= 1 << c;
        }
        const span = off >= 0 ? 30 : maxDist;
        const xa = Math.max(r.x0, cx - span), xb = Math.min(r.x1, cx + span);
        if (xb > xa) {
          for (let c = chunkOf(xa); c <= chunkOf(Math.max(xa, xb - 1e-3)); c++) chunks[d].add(c);
          this._addClusters(clusters[d], d, r, xa, xb);
        }
        if (depth >= 7) continue;
        const push = (dd, id) => {
          const kk = dd * 4096 + id; if (seen.has(kk)) return;
          const rr = this.plans[dd].rooms[id]; if (!rr) return;
          if (Math.abs(dd - cd) > cfg.detailRadius) return;
          const dx = Math.max(rr.x0 - cx, 0, cx - rr.x1), dz = Math.max(rr.z0 - cz, 0, cz - rr.z1);
          if (Math.hypot(dx, dz) > maxDist) return;
          const noff = dd !== d ? 0 : off < 0 ? -1 : off + 1;
          if (dd !== cd && noff > 2) return;
          seen.add(kk); q.push([dd, id, depth + 1, dd === cd && dd === d ? off : noff]);
        };
        for (const [to, e] of p._vis.adj[rid]) {
          if (e.open || e.see) { push(d, to); continue; }
          if (off >= 0) continue;          // other decks: no doors
          for (const di of e.doors) {
            const pd = p.doors[di]; if (!pd) continue;
            if (pd.type === 'glass' || pd.type === 'balcony') { push(d, to); break; }
            const st = this.doorState.get(this.doorKey(d, di));
            if (st && st.open > 0.02) { push(d, to); break; }
          }
        }
        // stairwells only reveal the adjacent deck; atrium/theatre voids up to detailRadius
        const stairOK = (dd, id) => !(r.ramp || this.plans[dd]?.rooms[id]?.ramp) || Math.abs(dd - cd) <= 1;
        for (const id of p._vis.down[rid]) if (stairOK(d - 1, id)) push(d - 1, id);
        for (const id of p._vis.up[rid]) if (stairOK(d + 1, id)) push(d + 1, id);
      }
      // the player's own room is always shown (third-person camera may peek over a wall)
      if (P && P.deck && this.plans[P.deck]) { const pr = this.roomAt(P.deck, P.x, P.z); if (pr) { const xa = Math.max(pr.x0, P.x - 40), xb = Math.min(pr.x1, P.x + 40); for (let c = chunkOf(xa); c <= chunkOf(xb - 1e-3); c++) chunks[P.deck].add(c); this._addClusters(clusters[P.deck], P.deck, pr, xa, xb); } }
    }
    const decks = [];
    for (let d = 1; d <= SHIP.deckCount; d++) if (chunks[d].size) decks.push(d);
    const camOut = !room || !!room.exterior || !!this.plans[cd]._vis.seesOut[room.id];
    // exterior chunks worth drawing from indoors: window chunks ±1 (any deck within ±2 of the window's deck)
    let near = 0; for (let d = 1; d <= SHIP.deckCount; d++) near |= outMask[d];
    near = near | (near << 1) | (near >>> 1);
    let outDecks = 0; for (let d = 1; d <= SHIP.deckCount; d++) if (outMask[d]) for (let k = -2; k <= 2; k++) outDecks |= 1 << Math.max(0, d + k);
    this.vis = { indoor: !!room && !room.exterior, seesOut, camOut, nodes, decks, room: room ? room.name || room.type : null, deck: cd, mode: room ? 'room' : 'outside', via: seesOut ? this._outVia : null, perDeck, outChunks: near, outDecks };
    this._outVia = null;
  }

  _applyVis(cx, cy, cz) {
    const cfg = this.visCfg, chunks = this._chunkSets, clusters = this._clusterSets, V = this.vis;
    const chunkDist = (c) => { const x0 = chunkX0(c), x1 = x0 + CHUNK; return Math.max(x0 - cx, 0, cx - x1); };
    // indoors, the outside is only seen through windows: keep the exterior to what a window can frame
    const inK = V.indoor ? (V.camOut ? 0.6 : 0.35) : 1;
    const extFurn = cfg.extFurnDist * inK, fineD = cfg.fineDist * inK;
    for (let d = 1; d <= SHIP.deckCount; d++) {
      const D = this.decks[d]; if (!D) continue;
      const set = chunks[d];
      const on = set.size > 0;
      if (D.detail.visible !== on) D.detail.visible = on;
      D.detailOn = on;
      if (on) for (const m of D.chunkMeshes) { const c = m.userData.chunk.c; const v = set.has(c) && chunkDist(c) < cfg.detailDist; if (m.visible !== v) m.visible = v; }
      const shellDeck = !V.indoor || (V.outDecks & (1 << d)) !== 0;
      for (const m of D.shellMeshes) { const c = m.userData.chunk.c; const v = V.seesOut && shellDeck && !(on && set.has(c)) && (!V.indoor || (V.outChunks & (1 << c)) !== 0); if (m.visible !== v) m.visible = v; }
      const ev = V.seesOut && (!V.indoor || (V.outDecks & (1 << d)) !== 0);
      if (D.ext.visible !== ev) D.ext.visible = ev;
      // door leaves / signs / misc deck props (not chunked): only on the camera deck or decks seen broadly (atrium)
      const misc = on && (d === V.deck || V.perDeck[d] >= 4);
      for (const m of D.detail.children) if (!m.userData.chunk && !this._furnSet.has(m)) { if (m.visible !== misc) m.visible = misc; }
    }
    if (this.extRoot.visible !== V.seesOut) this.extRoot.visible = V.seesOut;
    // exterior door hardware lives at root level (doors.js 'e' layer): only when looking out from close by
    const extDoors = V.seesOut && (!V.indoor || V.camOut);
    for (const m of this.root.children) if (m.name && m.name.startsWith('doors-') && /-e\d+$/.test(m.name)) { if (m.visible !== extDoors) m.visible = extDoors; }
    if (this.hull && this.hull.visible !== V.seesOut) this.hull.visible = V.seesOut;
    if (V.seesOut) for (const e of this.extMeshes) {
      const dist = chunkDist(e.c);
      const inView = !V.indoor || (V.outChunks & (1 << e.c)) !== 0;
      const v = inView && (e.kind === 'fine' ? dist < fineD : dist < (cfg.drawDistance ?? 3000));
      if (e.mesh.visible !== v) e.mesh.visible = v;
      const cast = e.kind === 'ext' && dist < cfg.shadowDist;
      if (e.mesh.castShadow !== cast) e.mesh.castShadow = cast;
    }
    // furniture clusters
    const lodD = cfg.lodDist;
    for (const f of this.furn) {
      let vis, dist = 0;
      if (f.sphere) dist = Math.max(0, Math.hypot(f.sphere.center.x - cx, (f.sphere.center.y - cy) * 1.5, f.sphere.center.z - cz) - f.sphere.radius);
      if (f.ext) vis = V.seesOut && dist < extFurn && (!V.indoor || (V.camOut && (V.outDecks & (1 << f.deck)) !== 0 && (V.outChunks & (1 << f.chunk)) !== 0));
      else vis = clusters[f.deck].has(f.cluster) && dist < cfg.detailDist;
      if (f.mesh.visible !== vis) f.mesh.visible = vis;
      if (!vis) { if (f.glass && f.glass.visible) f.glass.visible = false; if (f.proxy && f.proxy.visible) f.proxy.visible = false; continue; }
      const far = f.lod && dist > lodD;
      if (far !== f.lodOn) { f.lodOn = far; f.mesh.geometry = far ? f.lod : f.base; }
      if (f.glass) { const gv = !far; if (f.glass.visible !== gv) f.glass.visible = gv; }
      if (f.proxy) { const cast = dist < (f.ext ? 22 : 18) * (cfg.shadowDist / 55); if (f.proxy.visible !== cast) f.proxy.visible = cast; }
    }
  }

  // Make everything visible (shader precompile during loading); returns a restore function
  showAllForCompile() {
    const changed = [];
    this.root.traverse(o => { if (!o.visible) { changed.push(o); o.visible = true; } });
    const lods = this.furn.filter(f => f.lod).map(f => { const m = new THREE.InstancedMesh(f.lod, f.mesh.material, 1); m.frustumCulled = false; this.root.add(m); return m; });
    return () => { for (const o of changed) o.visible = false; for (const m of lods) m.removeFromParent(); this._visKey = ''; };
  }

  // ── queries ────────────────────────────────────────────────────────────
  plan(d) { return this.plans[d]; }
  roomAt(d, x, z) { const p = this.plans[d]; return p ? p.roomAt(x, z) : null; }
  roomId(d, x, z) { const p = this.plans[d]; const i = toI(x), j = toJ(z); if (!p || i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) return 0; return p.room[idx(i, j)]; }

  // floor height (absolute y) under (x,z) on deck d
  floorY(d, x, z) {
    const r = this.roomAt(d, x, z);
    const y = deckY(d);
    if (!r) return y;
    if (r.ramp) {
      const { xb, xt, dy } = r.ramp;
      const t = Math.max(0, Math.min(1, (x - xb) / (xt - xb)));
      return y + dy * t;
    }
    if (r.pool) return y - r.pool;
    return y;
  }

  doorKey(d, id) { return d * 100000 + id; }
  door(d, id) {
    const k = this.doorKey(d, id);
    let s = this.doorState.get(k);
    if (!s) { const pd = this.plans[d].doors[id]; s = { ...pd, deck: d, open: 0, target: 0, lockedState: pd.locked || false, forcedOpen: false, lastUse: 0 }; this.doorState.set(k, s); }
    return s;
  }
  doorBlocks(d, id) { const s = this.doorState.get(this.doorKey(d, id)); return !s || s.open < 0.7; }

  edgeBlocked(d, normal, i, j) {
    const p = this.plans[d];
    if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) return true;
    const k = idx(i, j);
    const t = normal === 'x' ? p.ex[k] : p.ez[k];
    if (t === 2) return this.doorBlocks(d, normal === 'x' ? p.dx[k] : p.dz[k]);
    return BLOCK_T[t] === 1;
  }

  _indexItems(d) {
    const p = this.plans[d];
    const map = new Map();
    for (const it of p.items) {
      if (!it.hx) continue;
      const i0 = Math.floor((it.x - it.hx - GRID.x0) / 4), i1 = Math.floor((it.x + it.hx - GRID.x0) / 4);
      const j0 = Math.floor((it.z - it.hz - GRID.z0) / 4), j1 = Math.floor((it.z + it.hz - GRID.z0) / 4);
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const key = a * 1000 + b; if (!map.has(key)) map.set(key, []); map.get(key).push(it); }
    }
    this.itemGrid[d] = map;
  }

  // Resolve a circle (radius r) moving to (x,z) on deck d. Returns corrected {x,z,hit}.
  collide(d, x, z, r = 0.3, opts = {}) {
    const p = this.plans[d];
    if (!p) return { x, z, hit: false };
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const i0 = toI(x - r) - 1, i1 = toI(x + r) + 1, j0 = toJ(z - r) - 1, j1 = toJ(z + r) + 1;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) continue;
        // edge between (i,j) and (i+1,j): x = line, z in [zj, zj+cell]
        if (i < GRID.nx - 1 && this.edgeBlocked(d, 'x', i, j)) {
          const lx = GRID.x0 + (i + 1) * GRID.cell, za = GRID.z0 + j * GRID.cell, zb = za + GRID.cell;
          const cz = Math.max(za, Math.min(zb, z)); const dx = x - lx, dz = z - cz; const dist = Math.hypot(dx, dz);
          if (dist < r) { const nx = dist > 1e-5 ? dx / dist : (x < lx ? -1 : 1), nz = dist > 1e-5 ? dz / dist : 0; x = lx + nx * r; z = cz + nz * r; moved = hit = true; }
        }
        if (j < GRID.nz - 1 && this.edgeBlocked(d, 'z', i, j)) {
          const lz = GRID.z0 + (j + 1) * GRID.cell, xa = GRID.x0 + i * GRID.cell, xb = xa + GRID.cell;
          const cx = Math.max(xa, Math.min(xb, x)); const dx = x - cx, dz = z - lz; const dist = Math.hypot(dx, dz);
          if (dist < r) { const nx = dist > 1e-5 ? dx / dist : 0, nz = dist > 1e-5 ? dz / dist : (z < lz ? -1 : 1); x = cx + nx * r; z = lz + nz * r; moved = hit = true; }
        }
      }
      // furniture boxes
      if (!opts.ignoreItems) {
        const a0 = Math.floor((x - r - GRID.x0) / 4), a1 = Math.floor((x + r - GRID.x0) / 4), b0 = Math.floor((z - r - GRID.z0) / 4), b1 = Math.floor((z + r - GRID.z0) / 4);
        const map = this.itemGrid[d];
        for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
          const list = map.get(a * 1000 + b); if (!list) continue;
          for (const it of list) {
            if (it.hidden) continue;
            const qx = Math.max(it.x - it.hx, Math.min(it.x + it.hx, x)), qz = Math.max(it.z - it.hz, Math.min(it.z + it.hz, z));
            const dx = x - qx, dz = z - qz, dist = Math.hypot(dx, dz);
            if (dist < r) {
              if (dist > 1e-5) { x = qx + dx / dist * r; z = qz + dz / dist * r; }
              else { // inside: push out along the shallowest axis
                const px = it.hx - Math.abs(x - it.x), pz = it.hz - Math.abs(z - it.z);
                if (px < pz) x = it.x + Math.sign(x - it.x || 1) * (it.hx + r); else z = it.z + Math.sign(z - it.z || 1) * (it.hz + r);
              }
              moved = hit = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return { x, z, hit };
  }

  // Is the straight segment between two points on deck d free of blocking edges? (vision & smoothing)
  lineClear(d, x0, z0, x1, z1, { doorsBlock = true, glassBlocks = false } = {}) {
    const p = this.plans[d];
    let i = toI(x0), j = toJ(z0); const ie = toI(x1), je = toJ(z1);
    const dx = x1 - x0, dz = z1 - z0;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = Math.abs(GRID.cell / (dx || 1e-9)), tDZ = Math.abs(GRID.cell / (dz || 1e-9));
    let tMX = dx > 0 ? (GRID.x0 + (i + 1) * GRID.cell - x0) / dx : (GRID.x0 + i * GRID.cell - x0) / (dx || -1e-9);
    let tMZ = dz > 0 ? (GRID.z0 + (j + 1) * GRID.cell - z0) / dz : (GRID.z0 + j * GRID.cell - z0) / (dz || -1e-9);
    if (!dx) tMX = Infinity; if (!dz) tMZ = Infinity;
    let guard = 0;
    while ((i !== ie || j !== je) && guard++ < 2000) {
      if (tMX < tMZ) {
        const ei = stepX > 0 ? i : i - 1; const k = idx(ei, j);
        if (ei < 0 || ei >= GRID.nx - 1) return false;
        const t = p.ex[k];
        if (t === 1 || t === 4 || (t === 2 && doorsBlock && this.doorBlocks(d, p.dx[k]) && !isGlassDoor(p, p.dx[k])) || (glassBlocks && (t === 3 || t === 6))) {
          if (t === 4 && !glassBlocks && facadeSeeThrough(p, k, 'x')) { /* window */ } else return false;
        }
        i += stepX; tMX += tDX;
      } else {
        const ej = stepZ > 0 ? j : j - 1; const k = idx(i, ej);
        if (ej < 0 || ej >= GRID.nz - 1) return false;
        const t = p.ez[k];
        if (t === 1 || t === 4 || (t === 2 && doorsBlock && this.doorBlocks(d, p.dz[k]) && !isGlassDoor(p, p.dz[k])) || (glassBlocks && (t === 3 || t === 6))) {
          if (t === 4 && !glassBlocks && facadeSeeThrough(p, k, 'z')) { } else return false;
        }
        j += stepZ; tMZ += tDZ;
      }
    }
    return true;
  }

  // nearest door to a point on a deck within radius (for interaction)
  doorsNear(d, x, z, radius = 1.6) {
    const p = this.plans[d]; const out = [];
    if (!p) return out;
    // doors are few per area; brute force through spatial filter on plan doors list (cached by cell bucket)
    if (!p._doorBuckets) {
      p._doorBuckets = new Map();
      for (const dr of p.doors) { const key = Math.floor((dr.x + 165) / 6) * 100 + Math.floor((dr.z + 25) / 6); if (!p._doorBuckets.has(key)) p._doorBuckets.set(key, []); p._doorBuckets.get(key).push(dr); }
    }
    const bx = Math.floor((x + 165) / 6), bz = Math.floor((z + 25) / 6);
    for (let a = bx - 1; a <= bx + 1; a++) for (let b = bz - 1; b <= bz + 1; b++) {
      const l = p._doorBuckets.get(a * 100 + b); if (!l) continue;
      for (const dr of l) { const dist = Math.hypot(dr.x - x, dr.z - z); if (dist < radius) out.push({ door: dr, dist }); }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }
}

function isGlassDoor(p, id) { const d = p.doors[id]; return d && (d.type === 'glass' || d.type === 'balcony'); }
function facadeSeeThrough(p, k, n) {
  // treat glass/window facades as transparent for vision
  const a = p.rooms[p.room[k]], b = p.rooms[p.room[n === 'x' ? k + 1 : k + GRID.nx]];
  const r = a && !a.exterior ? a : b;
  return r && (r.facade === 'glass');
}
