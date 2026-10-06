// HALCYON TIDE (mobile) — HUD layout: default positions of the touch controls, persistence and the
// PUBG-style "Customize" editor (drag to move, pinch or slider to resize, reset, done).
//
// A control's place is {a: anchor 'bl'|'br'|'tl'|'tr', x, y (px from that corner to the control centre, inside the
// safe area), s (size multiplier)}. Anchoring to the nearest corner keeps layouts sensible across phone sizes.
// Stored in localStorage 'ht.m.layout' as {id: {a,x,y,s}} — only controls that differ from the defaults.
import { IC } from './icons.js';

export const CONTROLS = {
  stick:     { label: 'Move', icon: IC.sprint, d: 124, def: { a: 'bl', x: 142, y: 112 } },
  lfire:     { label: 'Left fire', icon: IC.fire, d: 62, def: { a: 'bl', x: 70, y: 205 }, fire: true },
  fire:      { label: 'Fire', icon: IC.fire, d: 86, def: { a: 'br', x: 120, y: 134 }, fire: true },
  aim:       { label: 'Aim', icon: IC.aim, d: 56, def: { a: 'br', x: 50, y: 206 } },
  jump:      { label: 'Jump', icon: IC.jump, d: 60, def: { a: 'br', x: 50, y: 64 } },
  crouch:    { label: 'Crouch', icon: IC.crouch, d: 54, def: { a: 'br', x: 128, y: 50 } },
  reload:    { label: 'Reload', icon: IC.reload, d: 50, def: { a: 'br', x: 204, y: 62 } },
  interact:  { label: 'Interact', icon: IC.hand, d: 54, def: { a: 'br', x: 268, y: 194 }, pill: true },
  alt:       { label: 'Alt action', icon: IC.pick, d: 50, def: { a: 'br', x: 268, y: 256 }, pill: true },
  fpv:       { label: 'View', icon: IC.eye, d: 44, def: { a: 'br', x: 50, y: 270 } },
  surrender: { label: 'Hands up', icon: IC.hands, d: 44, def: { a: 'br', x: 112, y: 300 } },
};

const KEY = 'ht.m.layout';

export class Layout {
  constructor() {
    this.over = {};
    try { this.over = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { this.over = {}; }
    this.listeners = new Set();
  }
  get(id) { const c = CONTROLS[id]; return { ...c.def, s: 1, ...(this.over[id] || {}) }; }
  set(id, v) { this.over[id] = { ...this.get(id), ...v }; }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.over)); } catch {} this.changed(); }
  reset() { this.over = {}; try { localStorage.removeItem(KEY); } catch {} this.changed(); }
  changed() { for (const f of this.listeners) try { f(); } catch (e) { console.error(e); } }
  onChange(f) { this.listeners.add(f); }
  // screen position of a control centre (px), given safe-area insets {l,r,t,b}
  pos(id, ins, W = innerWidth, H = innerHeight) {
    const p = this.get(id);
    const x = p.a[1] === 'l' ? ins.l + p.x : W - ins.r - p.x;
    const y = p.a[0] === 't' ? ins.t + p.y : H - ins.b - p.y;
    return { x, y, s: p.s };
  }
  // inverse: store a screen position anchored to its nearest corner
  place(id, x, y, ins, W = innerWidth, H = innerHeight) {
    const L = x < W / 2, T = y < H / 2;
    const a = (T ? 't' : 'b') + (L ? 'l' : 'r');
    this.set(id, { a, x: Math.round(L ? x - ins.l : W - ins.r - x), y: Math.round(T ? y - ins.t : H - ins.b - y) });
  }
}

// ── Customize editor ──────────────────────────────────────────────────────
export class LayoutEditor {
  constructor(hud) {
    this.hud = hud; this.layout = hud.layout;
    const root = this.root = document.createElement('div');
    root.id = 'htm-edit';
    root.innerHTML = `<div class="grid"></div><div class="items"></div>
      <div class="bar"><span class="nm">Tap a button</span><input type="range" min="0.6" max="1.6" step="0.05" value="1"><button data-e="reset">Reset</button><button data-e="cancel">Cancel</button><button class="pri" data-e="done">Save</button></div>
      <div class="hint">Drag buttons to move them · pinch or use the slider to resize</div>`;
    document.body.appendChild(root);
    this.items = root.querySelector('.items');
    this.nm = root.querySelector('.nm');
    this.rng = root.querySelector('input');
    this.sel = null; this.touches = new Map(); this.pinch = null;
    this.rng.addEventListener('input', () => { if (this.sel) { this.layout.set(this.sel, { s: +this.rng.value }); this.render(); } });
    root.querySelector('.bar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-e]'); if (!b) return;
      const k = b.dataset.e;
      if (k === 'reset') { this.layout.over = {}; this.render(); }
      else if (k === 'cancel') { this.layout.over = this._backup; this.close(); }
      else if (k === 'done') { this.layout.save(); this.close(); this.hud.game.ui?.toast?.('HUD layout saved', { kind: 'good' }); }
    });
    // touch: drag selected control, pinch to resize (two fingers anywhere)
    root.addEventListener('touchstart', (e) => this._start(e), { passive: false });
    root.addEventListener('touchmove', (e) => this._move(e), { passive: false });
    root.addEventListener('touchend', (e) => this._end(e), { passive: false });
    root.addEventListener('touchcancel', (e) => this._end(e), { passive: false });
    // mouse fallback (desktop testing of mobile.html)
    root.addEventListener('mousedown', (e) => { const it = e.target.closest('.eb'); if (!it) return; this._select(it.dataset.id); this._drag = { id: it.dataset.id, ox: e.clientX, oy: e.clientY, p: this.layout.pos(it.dataset.id, this.hud.ins) }; });
    window.addEventListener('mousemove', (e) => { if (!this._drag || !this.active) return; const d = this._drag; this.layout.place(d.id, d.p.x + e.clientX - d.ox, d.p.y + e.clientY - d.oy, this.hud.ins); this.render(); });
    window.addEventListener('mouseup', () => { this._drag = null; });
  }
  get active() { return this.root.classList.contains('on'); }
  open() {
    this._backup = JSON.parse(JSON.stringify(this.layout.over));
    this.root.classList.add('on');
    this.items.innerHTML = '';
    this.sel = null; this.nm.textContent = 'Tap a button'; this.rng.disabled = true;
    this.render();
    this.hud.onEditor(true);
  }
  close() { this.root.classList.remove('on'); this.touches.clear(); this.pinch = null; this.hud.onEditor(false); this.layout.changed(); }
  // nodes are built once per open and then only re-positioned (a node replaced mid-drag would orphan its touch)
  render() {
    const ins = this.hud.ins, bs = this.hud.btnScale;
    if (!this.items.children.length) {
      this.items.innerHTML = Object.keys(CONTROLS).map(id => `<div class="eb ${CONTROLS[id].pill ? 'pillish' : ''}" data-id="${id}">${CONTROLS[id].icon}<span class="el">${CONTROLS[id].label}</span></div>`).join('');
    }
    for (const n of this.items.children) {
      const id = n.dataset.id, c = CONTROLS[id], p = this.layout.pos(id, ins);
      const d = Math.round(c.d * p.s * bs), w = c.pill ? Math.round(d * 2.6) : d;
      n.style.cssText = `left:${p.x}px;top:${p.y}px;width:${w}px;height:${d}px`;
      n.classList.toggle('sel', this.sel === id);
    }
  }
  _select(id) {
    this.sel = id;
    this.nm.textContent = CONTROLS[id].label;
    this.rng.disabled = false; this.rng.value = this.layout.get(id).s;
    for (const n of this.items.children) n.classList.toggle('sel', n.dataset.id === id);
  }
  _start(e) {
    if (e.target.closest('.bar')) return;   // let the toolbar's buttons/slider work normally
    e.preventDefault();
    for (const t of e.changedTouches) {
      const it = (t.target.closest && t.target.closest('.eb')) || null;
      const id = it ? it.dataset.id : null;
      if (id && this.touches.size === 0) this._select(id);
      this.touches.set(t.identifier, { id, x0: t.clientX, y0: t.clientY, p: id ? this.layout.pos(id, this.hud.ins) : null });
    }
    if (this.touches.size === 2 && this.sel) {
      const [a, b] = [...e.touches];
      this.pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s0: this.layout.get(this.sel).s };
    }
  }
  _move(e) {
    if (!this.touches.size) return;
    e.preventDefault();
    if (this.pinch && e.touches.length >= 2 && this.sel) {
      const [a, b] = [...e.touches];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const s = Math.max(0.6, Math.min(1.6, this.pinch.s0 * d / Math.max(20, this.pinch.d0)));
      this.layout.set(this.sel, { s: +s.toFixed(2) }); this.rng.value = s; this.render();
      return;
    }
    for (const t of e.changedTouches) {
      const T = this.touches.get(t.identifier); if (!T || !T.id) continue;
      const W = innerWidth, H = innerHeight;
      const x = Math.max(24, Math.min(W - 24, T.p.x + t.clientX - T.x0)), y = Math.max(24, Math.min(H - 24, T.p.y + t.clientY - T.y0));
      this.layout.place(T.id, x, y, this.hud.ins);
      this.render();
    }
  }
  _end(e) {
    for (const t of e.changedTouches) this.touches.delete(t.identifier);
    if (this.touches.size < 2) this.pinch = null;
  }
}
