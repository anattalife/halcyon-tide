// HALCYON TIDE — deck plan art. Builds Path2D geometry (in metres; screen x = ship x, screen y = ship z)
// from a DeckPlan grid once per deck, then draws it at any scale/rotation: crisp vector for the full map,
// pre-rendered bitmaps for the minimap. Also produces labels (venues, cabin ranges) and core icons.
import { GRID, SHIP, deckY } from '../core/config.js';
import { CAT, CAT_KEYS, catOf, cleanName } from './theme.js';

const cache = new Map();
const C = GRID.cell;

const GENERIC = /^(Stairs|Elevator|Service Lift|Stair Store|Balcony|Stateroom|Suite \d|Crew Cabin|Aft Terrace \d|Cross Alley|Service Passage)|Passage$|Crossover$|Stair Lobby|Crew Stairs|Vestibule$|Pantry$|Linen Store|Fan Room|Electrical Locker|Trash & Recycling|Bar Store|Club Store/;

export function deckArt(plan) {
  let a = cache.get(plan);
  if (!a) { a = build(plan); cache.set(plan, a); }
  return a;
}

function build(plan) {
  const { nx, nz, x0, z0 } = GRID;
  const roomCat = plan.rooms.map(r => (r ? catOf(r) : null));
  const catIdx = new Map(CAT_KEYS.map((k, i) => [k, i]));
  const cats = {}; for (const k of CAT_KEYS) cats[k] = new Path2D();
  const eps = 0.03;
  // row runs, merged vertically
  let open = new Map();
  const emit = (r, j1) => cats[CAT_KEYS[r.c]].rect(x0 + r.i0 * C - eps, z0 + r.j0 * C - eps, (r.i1 - r.i0) * C + 2 * eps, (j1 - r.j0) * C + 2 * eps);
  let minX = 1e9, maxX = -1e9;
  for (let j = 0; j < nz; j++) {
    const next = new Map();
    let i = 0;
    while (i < nx) {
      const c0 = roomCat[plan.room[j * nx + i]];
      if (c0 == null) { i++; continue; }
      let e = i + 1;
      while (e < nx && roomCat[plan.room[j * nx + e]] === c0) e++;
      const c = catIdx.get(c0);
      const key = i + ',' + e + ',' + c;
      const prev = open.get(key);
      if (prev) { open.delete(key); next.set(key, prev); }
      else next.set(key, { i0: i, i1: e, c, j0: j });
      if (i < minX) minX = i; if (e > maxX) maxX = e;
      i = e;
    }
    for (const r of open.values()) emit(r, j);
    open = next;
  }
  for (const r of open.values()) emit(r, nz);

  // edges
  const walls = new Path2D(), facade = new Path2D(), rails = new Path2D(), doors = new Path2D(), glass = new Path2D();
  const pathFor = (t) => (t === 1 ? walls : t === 4 ? facade : t === 3 ? rails : t === 6 ? glass : t === 2 ? doors : null);
  // constant-x edges (ex): between i and i+1, segment along z
  for (let i = 0; i < nx - 1; i++) {
    let j = 0;
    while (j < nz) {
      const t = plan.ex[j * nx + i];
      if (!t) { j++; continue; }
      let e = j + 1; while (e < nz && plan.ex[e * nx + i] === t) e++;
      const p = pathFor(t); if (p) { const x = x0 + (i + 1) * C; p.moveTo(x, z0 + j * C); p.lineTo(x, z0 + e * C); }
      j = e;
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    let i = 0;
    while (i < nx) {
      const t = plan.ez[j * nx + i];
      if (!t) { i++; continue; }
      let e = i + 1; while (e < nx && plan.ez[j * nx + e] === t) e++;
      const p = pathFor(t); if (p) { const z = z0 + (j + 1) * C; p.moveTo(x0 + i * C, z); p.lineTo(x0 + e * C, z); }
      i = e;
    }
  }
  // outer boundary of painted cells against "nothing" (room 0) is not an edge in ex/ez when both sides are 0 → hull outline from halfW
  const hull = new Path2D();
  let started = false;
  const pts = [];
  for (let i = 0; i < nx; i++) { const h = plan.halfW[i]; if (h > 0.05) pts.push([x0 + (i + 0.5) * C, h]); }
  if (pts.length) {
    hull.moveTo(pts[0][0] - C / 2, -pts[0][1]);
    for (const [x, h] of pts) hull.lineTo(x, -h);
    const last = pts[pts.length - 1]; hull.lineTo(last[0] + C / 2, -last[1] * 0.4); hull.lineTo(last[0] + C / 2, last[1] * 0.4);
    for (let k = pts.length - 1; k >= 0; k--) hull.lineTo(pts[k][0], pts[k][1]);
    hull.lineTo(pts[0][0] - C / 2, pts[0][1]);
    hull.closePath(); started = true;
  }

  // labels
  const labels = [];
  const seen = new Map();
  for (const r of plan.rooms) {
    if (!r || !r.name || r.cells < 8 || r.isVoid) continue;
    const cat = roomCat[r.id];
    if (cat === 'lift' || cat === 'stair' || cat === 'stateroom' || cat === 'balcony') {
      if (!(cat === 'stateroom' && (r.cabinKind === 'owner' || r.cabinKind === 'vista' || r.cabinKind === 'aftsuite'))) continue;
    }
    if (GENERIC.test(r.name) && !(r.type === 'suite')) continue;
    const name = cleanName(r.name);
    const crewish = cat === 'crew' || cat === 'restricted';
    if (crewish && r.area < 30) continue;
    if ((r.type === 'corridor' || r.type === 'crew_corridor') && !/Spine|Alley|Gallery|Promenade|Row/i.test(name)) continue;
    const key = name.replace(/\s*\(.*\)$/, '').replace(/\s*·.*$/, '');
    const prev = seen.get(key);
    const tier = r.venue ? 0 : crewish ? 2 : 1;
    const L = { text: name, x: r.cx, z: r.cz, w: r.x1 - r.x0, h: r.z1 - r.z0, tier, cat, room: r.id, area: r.area || 0 };
    // keep only the largest instance of repeated names (e.g. jogging track, promenades)
    if (prev) { if (prev.area >= L.area) continue; labels.splice(labels.indexOf(prev), 1); }
    seen.set(key, L); labels.push(L);
  }
  // sub-pixel fix: point label inside the room if the centre lands outside it
  for (const L of labels) {
    const rr = plan.roomAt(L.x, L.z);
    if (!rr || rr.id !== L.room) { const r = plan.rooms[L.room]; const p = innerPoint(plan, r); if (p) { L.x = p[0]; L.z = p[1]; } }
  }

  // cabin number ranges
  const cabinLabels = [];
  const pax = plan.cabins.filter(c => !c.crew && typeof c.no === 'number' && c.kind !== 'owner');
  const groups = new Map();
  for (const c of pax) {
    const k = (c.side > 0 ? 'S' : 'P') + (Math.abs(c.z) > 10.6 ? 'o' : 'i');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.x - b.x);
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const nos = run.map(c => c.no).sort((a, b) => a - b);
        const xs = run.map(c => c.x);
        cabinLabels.push({ text: `${nos[0]}–${nos[nos.length - 1]}`, x: (Math.min(...xs) + Math.max(...xs)) / 2, z: run.reduce((s, c) => s + c.z, 0) / run.length, x0: Math.min(...xs) - 1.75, x1: Math.max(...xs) + 1.75 });
      }
      run = [];
    };
    for (const c of list) { if (run.length && c.x - run[run.length - 1].x > 6) flush(); run.push(c); }
    flush();
  }

  // cores (elevators + stairs)
  const icons = [];
  for (const c of plan.cores) {
    const lob = plan.rooms[c.lobby];
    if (c.kind === 'passenger') {
      icons.push({ kind: 'lift', x: c.x - 0.5, z: 7.25, crew: false });
      icons.push({ kind: 'lift', x: c.x - 0.5, z: -7.25, crew: false });
      icons.push({ kind: 'stairs', x: c.x + 0.25, z: 0, crew: false });
    } else {
      icons.push({ kind: 'stairs', x: c.x + 0.25, z: 0, crew: true });
      icons.push({ kind: 'lift', x: c.x + 6.5, z: 2.5, crew: true });
    }
  }

  return { cats, walls, facade, rails, glass, doors, hull: started ? hull : null, labels, cabinLabels, icons, minX: x0 + minX * C, maxX: x0 + maxX * C, deck: plan.deck };
}

function innerPoint(plan, r) {
  if (!r) return null;
  const { nx, x0, z0 } = GRID;
  // scan the room's bounding box for the cell closest to its centre that belongs to it
  let best = null, bd = 1e9;
  const i0 = Math.max(0, r.bi0 | 0), i1 = Math.min(nx - 1, r.bi1 | 0), j0 = Math.max(0, r.bj0 | 0), j1 = Math.min(GRID.nz - 1, r.bj1 | 0);
  const step = Math.max(1, Math.floor((i1 - i0) / 60));
  for (let i = i0; i <= i1; i += step) for (let j = j0; j <= j1; j++) {
    if (plan.room[j * nx + i] !== r.id) continue;
    const x = x0 + (i + 0.5) * C, z = z0 + (j + 0.5) * C;
    const d = (x - r.cx) ** 2 + (z - r.cz) ** 2;
    if (d < bd) { bd = d; best = [x, z]; }
  }
  return best;
}

// Draw the plan with the current ctx transform in metres. `px` = screen pixels per metre (for line widths).
export function drawDeck(ctx, art, px, opts = {}) {
  const lw = (n) => n / px;
  ctx.save();
  if (art.hull) {
    ctx.fillStyle = opts.hullFill || '#0f1e2d';
    ctx.fill(art.hull);
  }
  const alpha = opts.alpha ?? 1;
  ctx.globalAlpha = alpha;
  for (const k of CAT_KEYS) { ctx.fillStyle = CAT[k].fill; ctx.fill(art.cats[k]); }
  ctx.globalAlpha = 1;
  // hatching for crew & restricted
  if (opts.hatch !== false) {
    const tr = ctx.getTransform();
    for (const k of ['crew', 'restricted']) {
      ctx.save();
      ctx.clip(art.cats[k]);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = CAT[k].hatch; ctx.lineWidth = opts.hatchW || 1.2;
      const W = ctx.canvas.width, H = ctx.canvas.height, s = opts.hatchGap || 7;
      ctx.beginPath();
      for (let x = -H; x < W; x += s) { ctx.moveTo(x, H); ctx.lineTo(x + H, 0); }
      ctx.stroke();
      ctx.restore();
      ctx.setTransform(tr);
    }
  }
  ctx.lineCap = 'butt';
  ctx.strokeStyle = opts.railColor || 'rgba(225,215,190,.35)'; ctx.lineWidth = lw(opts.railW ?? 0.8); ctx.stroke(art.rails); ctx.stroke(art.glass);
  ctx.strokeStyle = opts.wallColor || 'rgba(8,14,22,.92)'; ctx.lineWidth = lw(opts.wallW ?? 1.1); ctx.stroke(art.walls);
  ctx.strokeStyle = opts.facadeColor || '#e9dfc6'; ctx.lineWidth = lw(opts.facadeW ?? 1.6); ctx.stroke(art.facade);
  if (opts.doors !== false) { ctx.strokeStyle = opts.doorColor || 'rgba(201,164,91,.85)'; ctx.lineWidth = lw(opts.doorW ?? 1.0); ctx.stroke(art.doors); }
  if (art.hull && opts.outline !== false) { ctx.strokeStyle = opts.outlineColor || 'rgba(233,223,198,.55)'; ctx.lineWidth = lw(opts.outlineW ?? 1.2); ctx.stroke(art.hull); }
  ctx.restore();
}

// Bitmap of a deck at `ppm` pixels per metre (for the minimap). Covers x ∈ [-170,170], z ∈ [-26,26].
const bmpCache = new Map();
export const BMP = { x0: -170, z0: -26, w: 340, h: 52 };
export function deckBitmap(plan, ppm = 6) {
  const key = plan.deck + ':' + ppm;
  let c = bmpCache.get(key);
  if (c) { bmpCache.delete(key); bmpCache.set(key, c); return c; }
  c = document.createElement('canvas');
  c.width = Math.ceil(BMP.w * ppm); c.height = Math.ceil(BMP.h * ppm);
  const ctx = c.getContext('2d');
  ctx.setTransform(ppm, 0, 0, ppm, -BMP.x0 * ppm, -BMP.z0 * ppm);
  drawDeck(ctx, deckArt(plan), ppm, { hatchGap: 5, hatchW: 1, wallW: 1.0, facadeW: 1.5, doorW: 1.2, railW: 0.8, hullFill: '#13263a' });
  bmpCache.set(key, c);
  while (bmpCache.size > 5) bmpCache.delete(bmpCache.keys().next().value);
  return c;
}

// Side elevation geometry: per deck x-extent of painted cells
export function deckExtents(layout) {
  const out = [];
  for (let d = 1; d <= SHIP.deckCount; d++) {
    const p = layout.plans[d]; if (!p) continue;
    const a = deckArt(p);
    out[d] = { x0: a.minX, x1: a.maxX, y: deckY(d) };
  }
  return out;
}
