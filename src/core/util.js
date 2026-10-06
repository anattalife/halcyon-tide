// Small shared utilities: deterministic RNG, event bus, math helpers.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash32(...vals) {
  let h = 2166136261 >>> 0;
  for (const v of vals) {
    const s = String(v);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0x9e3779b9; h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed = 1) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  chance(p) { return this.r() < p; }
  weighted(entries) { // [[item, w], ...]
    let t = 0; for (const e of entries) t += e[1];
    let x = this.r() * t;
    for (const e of entries) { x -= e[1]; if (x <= 0) return e[0]; }
    return entries[entries.length - 1][0];
  }
}

// Listener errors are throttled per (event, message): the first 3 are logged in full, then one summary line every
// 100 repeats or 10 s ("[bus] <ev>: <msg> ×N (repeated)"). bus.errorStats() → [{key, n}] for debugging.
export class EventBus {
  constructor() { this.map = new Map(); this._errs = new Map(); }
  on(ev, fn) { if (!this.map.has(ev)) this.map.set(ev, new Set()); this.map.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this.map.get(ev)?.delete(fn); }
  emit(ev, data) { const s = this.map.get(ev); if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { this._err(ev, e); } } }
  _err(ev, e) {
    const key = ev + ': ' + String(e && e.message || e).slice(0, 160);
    let r = this._errs.get(key);
    if (!r) { if (this._errs.size > 200) this._errs.clear(); r = { n: 0, shown: 0, lastT: 0 }; this._errs.set(key, r); }
    r.n++;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (r.n <= 3) { console.error('[bus]', ev, e); r.lastT = now; r.shown = r.n; return; }
    if (r.n - r.shown >= 100 || now - r.lastT > 10000) { console.error(`[bus] ${key} ×${r.n} (repeated; ${r.n - r.shown} suppressed)`); r.shown = r.n; r.lastT = now; }
  }
  errorStats() { return [...this._errs].map(([key, r]) => ({ key, n: r.n })); }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

export function fmtClock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
export function fmtMoney(v) { return '§' + Math.round(v).toLocaleString('en-US'); }
