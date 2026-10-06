// HALCYON TIDE — full-screen ship map: deck selector, pan/zoom vector deck plan (legend, venue names, cabin ranges,
// stair/elevator icons, crew/restricted hatching), player/objective/marker pins, click-to-set waypoint, search,
// and a side elevation of the ship with all 17 decks (clickable).
import { SHIP, deckY } from '../core/config.js';
import { el, esc, ICON, CAT, LEGEND, deckName, cleanName, distanceHint } from './theme.js';
import { deckArt, drawDeck } from './deckArt.js';
import { markerColor } from './hud.js';

const TAU = Math.PI * 2;

export class MapPanel {
  constructor(ui) {
    this.ui = ui; this.game = ui.game;
    this.deck = 9;
    this.view = { cx: 0, cz: 0, ppm: 4 };     // centre (metres) & pixels per metre (CSS px)
    this.hover = null;
    this.searchIndex = null;
  }

  // The panel DOM, canvases and listeners are built once and cached: open() re-shows it, close() hides it
  // (QA #22 — panel switches are instant, nothing is rebuilt or left fading underneath another panel).
  open(opts = {}) {
    const g = this.game, p = g.player;
    if (!this._root) this._build();
    const root = this.root = this._root;
    root.style.display = '';
    this.isOpen = true;
    this.input.value = ''; this.res.innerHTML = ''; this.tip.innerHTML = '';
    this.deck = opts.deck || p?.deck || 9;
    this.view.ppm = 0;    // fit on first layout
    this._profDirty = true;
    // the canvas keeps its last image; the actual redraw happens next frame (ui.openPanel schedules draw()),
    // so the panel switch itself stays instant
    this._noDraw = true;
    try { this.setDeck(this.deck, false); this.centreOn(0, 0); } finally { this._noDraw = false; }
    return root;
  }
  close() {
    this.isOpen = false;
    try { this.input?.blur(); } catch {}
    if (this._root) { this._root.classList.remove('on'); this._root.style.display = 'none'; }
    this.hover = null;
  }

  _build() {
    const ui = this.ui;
    const root = this._root = el('div', 'pnl map');
    root.innerHTML = `
      <canvas class="mcv"></canvas>
      <div class="ptop">
        <div><div class="brand">MS Halcyon Tide · General arrangement</div><h1 class="ttl"></h1></div>
        <div class="sp"></div>
        <div class="msearch">${ICON.search}<input type="text" placeholder="Find a venue, cabin or deck…" spellcheck="false"><div class="mres scroll"></div></div>
      </div>
      <div class="decks"></div>
      <div class="legend"></div>
      <div class="prof"><canvas></canvas><div class="pl">Profile · starboard elevation</div></div>
      <div class="mtip"></div>
      <div class="pfoot"><span><span class="kc">LMB</span>Set waypoint</span><span><span class="kc">RMB</span>Clear waypoint</span><span><span class="kc">Drag</span>Pan</span><span><span class="kc">Wheel</span>Zoom</span><span><span class="kc">Q</span><span class="kc">E</span>Deck down / up</span><span><span class="kc">C</span>Centre on me</span><span><span class="kc">M</span>Close</span></div>`;
    this.cv = root.querySelector('.mcv'); this.ctx = this.cv.getContext('2d');
    this.ttl = root.querySelector('.ttl');
    this.decksEl = root.querySelector('.decks');
    this.legendEl = root.querySelector('.legend');
    this.pcv = root.querySelector('.prof canvas'); this.pctx = this.pcv.getContext('2d');
    this.tip = root.querySelector('.mtip');
    this.input = root.querySelector('.msearch input'); this.res = root.querySelector('.mres');
    // deck list (17 at top)
    let h = '';
    for (let d = SHIP.deckCount; d >= 1; d--) h += `<button class="dk" data-d="${d}"><b>${d}</b><span>${deckName(d)}</span></button>`;
    this.decksEl.innerHTML = h;
    this.decksEl.addEventListener('click', (e) => { const b = e.target.closest('.dk'); if (b) { ui.sfx('ui_click'); this.setDeck(+b.dataset.d, true); } });
    this.decksEl.addEventListener('mouseover', (e) => { const b = e.target.closest('.dk'); if (b && b !== this._hovB) { this._hovB = b; ui.sfx('ui_hover'); } });
    // legend
    this.legendEl.innerHTML = LEGEND.map(k => `<div><i class="${CAT[k].hatch ? 'h' : ''}" style="background-color:${CAT[k].fill};--hc:${CAT[k].hatch || 'transparent'}"></i>${CAT[k].label}</div>`).join('')
      + `<hr><div><span class="pm">${ICON.lift}</span>Elevators</div><div><span class="pm">${ICON.stairs}</span>Stairs</div>`
      + `<div><span class="pm" style="color:#fbf6ea">${ICON.arrow}</span>You</div><div><span class="pm" style="color:#e6c784">◆</span>Objective</div><div><span class="pm" style="color:#8fd0ff">${ICON.pin}</span>Waypoint</div>`;

    this._bind();
  }

  setDeck(d, keepView) {
    d = Math.max(1, Math.min(SHIP.deckCount, d));
    this.deck = d;
    this.ttl.textContent = `Deck ${d} · ${deckName(d)}`;
    for (const b of this.decksEl.children) b.classList.toggle('on', +b.dataset.d === d);
    this._decorateDecks();
    this.hover = null;
    this.draw();
  }
  _decorateDecks() {
    const g = this.game, ui = this.ui, p = g.player;
    const ob = ui.objective?.target?.deck, wd = ui.waypoint?.deck;
    for (const b of this.decksEl.children) {
      const d = +b.dataset.d;
      b.querySelector('.me')?.remove(); b.querySelector('.ob')?.remove();
      if (p && p.deck === d) el('i', 'me', '', b);
      else if (ob === d || wd === d) el('i', 'ob', '', b);
    }
  }

  centreOn(x, z) { this.view.cx = x; this.view.cz = z; this._clampView(); this.draw(); }
  _fit() {
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    const s = this.ui.scale;
    const availW = W - 2 * (19 * 16 * s), availH = H - (8.4 + 20.5) * 16 * s;
    this.view.ppm = Math.max(1.2, Math.min(availW / 335, availH / 52));
    this._minPpm = this.view.ppm * 0.9;
  }
  _clampView() {
    const v = this.view;
    v.cx = Math.max(-170, Math.min(170, v.cx)); v.cz = Math.max(-30, Math.min(30, v.cz));
  }
  // screen offset of the map's visual centre (between deck list and legend, above profile)
  _origin() {
    const W = this.cv.clientWidth, H = this.cv.clientHeight, s = this.ui.scale;
    return [W / 2, (8.4 * 16 * s + (H - 19.5 * 16 * s)) / 2];
  }
  w2s(x, z) { const [ox, oy] = this._origin(), v = this.view; return [ox + (x - v.cx) * v.ppm, oy + (z - v.cz) * v.ppm]; }
  s2w(sx, sy) { const [ox, oy] = this._origin(), v = this.view; return [v.cx + (sx - ox) / v.ppm, v.cz + (sy - oy) / v.ppm]; }

  _bind() {
    const cv = this.cv, ui = this.ui;
    let drag = null;
    const onDown = (e) => {
      if (e.button === 2) { e.preventDefault(); if (ui.waypoint) { ui.setWaypoint(null); ui.sfx('ui_close'); this.draw(); } return; }
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false };
      cv.classList.add('drag');
    };
    const onMove = (e) => {
      if (!this.isOpen) { drag = null; return; }
      const r = cv.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        this.view.cx = drag.cx - dx / this.view.ppm; this.view.cz = drag.cz - dy / this.view.ppm; this._clampView();
        this.draw();
      } else if (e.target === cv) {
        const [x, z] = this.s2w(e.clientX - r.left, e.clientY - r.top);
        const room = this.game.layout.plans[this.deck]?.roomAt(x, z);
        const h = room && !room.isVoid ? room : null;
        if (h !== this.hover) { this.hover = h; this.draw(); }
        this._tip(h, e.clientX - r.left, e.clientY - r.top);
      }
    };
    const onUp = (e) => {
      if (!drag) return;
      if (!this.isOpen) { drag = null; cv.classList.remove('drag'); return; }
      cv.classList.remove('drag');
      if (!drag.moved && e.target === cv) {
        const r = cv.getBoundingClientRect();
        const [x, z] = this.s2w(e.clientX - r.left, e.clientY - r.top);
        const plan = this.game.layout.plans[this.deck];
        const room = plan?.roomAt(x, z);
        if (room && !room.isVoid) {
          const label = this._roomLabel(room);
          ui.setWaypoint({ deck: this.deck, x, z, label });
          ui.sfx('ui_click');
          this._decorateDecks();
          this.draw();
        }
      }
      drag = null;
    };
    const onWheel = (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [wx, wz] = this.s2w(sx, sy);
      const k = Math.exp(-Math.sign(e.deltaY) * 0.18);
      this.view.ppm = Math.max(this._minPpm || 1, Math.min(60, this.view.ppm * k));
      const [nx, nz] = this.s2w(sx, sy);
      this.view.cx += wx - nx; this.view.cz += wz - nz; this._clampView();
      this.draw();
    };
    const onCtx = (e) => e.preventDefault();
    const onResize = () => { if (this.isOpen) { this.draw(); this.drawProfile(); } };
    cv.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', onCtx);
    cv.addEventListener('mouseleave', () => { this.tip.innerHTML = ''; if (this.hover) { this.hover = null; this.draw(); } });
    window.addEventListener('resize', onResize);
    // profile clicks
    this.pcv.addEventListener('click', (e) => {
      const d = this._profileDeckAt(e.offsetX, e.offsetY);
      if (d) { ui.sfx('ui_click'); this.setDeck(d.deck, true); this.centreOn(d.x, 0); }
    });
    this.pcv.addEventListener('mousemove', (e) => { const d = this._profileDeckAt(e.offsetX, e.offsetY); const n = d ? d.deck : 0; if (n !== this._profHover) { this._profHover = n; this.drawProfile(); } });
    this.pcv.addEventListener('mouseleave', () => { this._profHover = 0; this.drawProfile(); });
    // search
    const inp = this.input;
    inp.addEventListener('input', () => this._search(inp.value));
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const items = [...this.res.children];
      let i = items.findIndex(b => b.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); items.forEach((b, k) => b.classList.toggle('sel', k === i)); items[i]?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { (items[Math.max(0, i)])?.click(); }
      else if (e.key === 'Escape') { inp.value = ''; this.res.innerHTML = ''; inp.blur(); }
    });
    this.res.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const r = this._results[+b.dataset.i]; if (!r) return;
      ui.sfx('ui_click');
      this.setDeck(r.deck, true);
      this.view.ppm = Math.max(this.view.ppm, 9);
      this.centreOn(r.x, r.z);
      ui.setWaypoint({ deck: r.deck, x: r.x, z: r.z, label: r.label });
      this._decorateDecks(); this.draw();
      this.res.innerHTML = ''; inp.value = r.label; inp.blur();
    });
    this._unbind = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.removeEventListener('resize', onResize);
    };
  }

  _roomLabel(room) {
    if (!room) return 'Waypoint';
    if (room.cabin && typeof room.cabin === 'number') return (room.type === 'balcony' ? 'Balcony ' : room.type === 'suite' ? 'Suite ' : 'Stateroom ') + room.cabin;
    return cleanName(room.name || room.type);
  }
  _tip(room, sx, sy) {
    if (!room) { this.tip.innerHTML = ''; return; }
    const g = this.game, p = g.player;
    const zone = room.zone === 'crew' ? 'Crew only' : room.zone === 'restricted' ? 'Restricted' : room.zone === 'private' ? 'Private' : '';
    const key = room.uid;
    if (this._tipKey !== key) {
      this._tipKey = key;
      const t = { deck: this.deck, x: room.cx, z: room.cz };
      this.tip.innerHTML = `${esc(this._roomLabel(room))}<span>${zone ? zone + ' · ' : ''}${p ? distanceHint(p, t) : ''}</span>`;
    }
    this.tip.style.left = sx + 'px'; this.tip.style.top = sy + 'px';
  }

  _buildIndex() {
    const out = [];
    const L = this.game.layout;
    for (let d = 1; d <= SHIP.deckCount; d++) {
      const plan = L.plans[d]; if (!plan) continue;
      const seen = new Set();
      for (const r of plan.rooms) {
        if (!r || !r.name || r.isVoid || r.cabin || r.type === 'shaft' || r.type === 'stair' || r.type === 'balcony') continue;
        const name = cleanName(r.name);
        if (seen.has(name)) continue; seen.add(name);
        if (/^(Service Passage|Cross Alley|Stair Store|Linen Store|Fan Room|Electrical Locker|Trash & Recycling|Housekeeping Pantry|Room Service Pantry)$/.test(name)) continue;
        out.push({ label: name, deck: d, x: r.cx, z: r.cz, kind: r.venue ? 'venue' : r.zone, sort: r.venue ? 0 : r.zone === 'public' ? 1 : 2, room: r });
      }
      for (const c of plan.cabins) {
        if (c.crew) continue;
        out.push({ label: (c.kind === 'suite' || c.kind === 'owner' || c.kind === 'aftsuite' || c.kind === 'vista' ? 'Suite ' : 'Stateroom ') + c.no, no: String(c.no), deck: d, x: c.x, z: c.z, kind: 'cabin', sort: 3 });
      }
    }
    return out;
  }
  _search(q) {
    q = q.trim().toLowerCase();
    if (!q) { this.res.innerHTML = ''; return; }
    if (!this.searchIndex) this.searchIndex = this._buildIndex();
    let list;
    const dm = q.match(/^deck\s*(\d+)$/);
    if (dm) { const d = +dm[1]; if (d >= 1 && d <= SHIP.deckCount) { this.setDeck(d, true); this.centreOn(0, 0); } this.res.innerHTML = ''; return; }
    if (/^\d+$/.test(q)) list = this.searchIndex.filter(r => r.no && r.no.startsWith(q)).slice(0, 12);
    else {
      const words = q.split(/\s+/);
      list = this.searchIndex.filter(r => r.kind !== 'cabin' && words.every(w => r.label.toLowerCase().includes(w)));
      list.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
      list = list.slice(0, 14);
    }
    this._results = list;
    this.res.innerHTML = list.length ? list.map((r, i) => `<button data-i="${i}" class="${i === 0 ? 'sel' : ''}">${esc(r.label)}<span>Deck ${r.deck} · ${deckName(r.deck)}</span></button>`).join('')
      : `<button disabled>No matches<span></span></button>`;
  }

  handleKey(code) {
    if (code === 'KeyQ' || code === 'PageDown') { this.setDeck(this.deck - 1, true); this.ui.sfx('ui_click'); return true; }
    if (code === 'KeyE' || code === 'PageUp') { this.setDeck(this.deck + 1, true); this.ui.sfx('ui_click'); return true; }
    if (code === 'KeyC') { const p = this.game.player; if (p) { this.setDeck(p.deck, true); this.centreOn(p.x, p.z); } return true; }
    if (code === 'KeyF') { this.input.focus(); return true; }
    if (code === 'Equal' || code === 'NumpadAdd') { this.view.ppm = Math.min(60, this.view.ppm * 1.25); this.draw(); return true; }
    if (code === 'Minus' || code === 'NumpadSubtract') { this.view.ppm = Math.max(this._minPpm || 1, this.view.ppm / 1.25); this.draw(); return true; }
    return false;
  }
  update() {
    // keep the player marker live (cheap redraw at ~10 Hz)
    this._t = (this._t || 0) + 1;
    if (this._t % 6 === 0) this.draw();
  }

  // ── drawing ──────────────────────────────────────────────────────────
  draw() {
    const cv = this.cv; if (!cv || this._noDraw) return;
    const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); this._profDirty = true; }
    if (!this.view.ppm) this._fit();
    const ctx = this.ctx, g = this.game, ui = this.ui, p = g.player, s = ui.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // background: deep sea with subtle grid
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#0d2134'); bg.addColorStop(1, '#050c14');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const v = this.view, [ox, oy] = this._origin();
    // metre grid (frames every 10 m)
    const step = v.ppm > 14 ? 5 : v.ppm > 5 ? 10 : 25;
    ctx.strokeStyle = 'rgba(120,160,200,.06)'; ctx.lineWidth = 1;
    ctx.beginPath();
    const [wx0, wz0] = this.s2w(0, 0), [wx1, wz1] = this.s2w(W, H);
    for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const sx = Math.round(ox + (x - v.cx) * v.ppm) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let z = Math.floor(wz0 / step) * step; z <= wz1; z += step) { const sy = Math.round(oy + (z - v.cz) * v.ppm) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();

    const plan = g.layout.plans[this.deck];
    if (plan) {
      const art = deckArt(plan);
      // deck below as a ghost silhouette for context
      ctx.save();
      ctx.setTransform(dpr * v.ppm, 0, 0, dpr * v.ppm, dpr * (ox - v.cx * v.ppm), dpr * (oy - v.cz * v.ppm));
      drawDeck(ctx, art, v.ppm * dpr, { hatchGap: Math.max(5, 6 * dpr), hatchW: 1 * dpr, wallW: Math.min(2.2, 0.5 + v.ppm * 0.09) * dpr, facadeW: 1.8 * dpr, doorW: Math.min(2.2, 0.4 + v.ppm * 0.1) * dpr, railW: 1 * dpr, hullFill: '#132a40', outlineW: 1.6 * dpr, doors: v.ppm > 5 });
      // hover highlight
      if (this.hover) {
        const r = this.hover;
        ctx.fillStyle = 'rgba(255,240,205,.16)';
        const C = 0.5;
        // highlight the room cells (bbox-limited scan)
        ctx.beginPath();
        for (let j = r.bj0; j <= r.bj1; j++) {
          let i = r.bi0;
          while (i <= r.bi1) {
            if (plan.room[j * 660 + i] !== r.id) { i++; continue; }
            let e = i; while (e <= r.bi1 && plan.room[j * 660 + e] === r.id) e++;
            ctx.rect(-165 + i * C, -25 + j * C, (e - i) * C, C + 0.02);
            i = e;
          }
        }
        ctx.fill();
      }
      ctx.restore();
      // labels
      this._drawLabels(ctx, art, plan);
      // core icons
      const iconS = Math.max(9, Math.min(16, v.ppm * 1.3));
      if (v.ppm > 2.4) for (const ic of art.icons) {
        if (ic.crew && v.ppm < 5) continue;
        const [sx, sy] = this.w2s(ic.x, ic.z);
        drawIcon(ctx, ic.kind, sx, sy, iconS, ic.crew);
      }
    }
    // markers
    for (const m of ui.markers.values()) if (m.deck === this.deck) this._pin(ctx, m.x, m.z, markerColor(m.kind), m.label, 'dot');
    const ot = ui.objective?.target;
    if (ot && ot.deck === this.deck) this._pin(ctx, ot.x, ot.z, '#e6c784', ot.label || ui.objective.title, 'obj');
    const wp = ui.waypoint;
    if (wp && wp.deck === this.deck) this._pin(ctx, wp.x, wp.z, '#8fd0ff', wp.label, 'wp');
    // player
    if (p && p.deck === this.deck) {
      const [sx, sy] = this.w2s(p.x, p.z);
      const t = performance.now() / 1000;
      ctx.save(); ctx.translate(sx, sy);
      const pr = (10 + 8 * ((t * 0.8) % 1)) * s * 1.2;
      ctx.beginPath(); ctx.arc(0, 0, pr, 0, TAU); ctx.strokeStyle = `rgba(143,208,255,${0.6 * (1 - (t * 0.8) % 1)})`; ctx.lineWidth = 2; ctx.stroke();
      ctx.rotate(Math.atan2(Math.cos(p.yaw), Math.sin(p.yaw)) + Math.PI / 2);
      const a = 9 * s * 1.15;
      ctx.beginPath(); ctx.moveTo(0, -a * 1.2); ctx.lineTo(a * 0.85, a * 0.9); ctx.lineTo(0, a * 0.42); ctx.lineTo(-a * 0.85, a * 0.9); ctx.closePath();
      ctx.fillStyle = '#fbf6ea'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 6; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#0b1520'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    } else if (p) {
      // player is elsewhere: note
      ctx.save();
      ctx.font = `600 ${12 * s}px Inter,sans-serif`; ctx.fillStyle = 'rgba(143,208,255,.85)'; ctx.textAlign = 'center';
      const dd = p.deck - this.deck;
      ctx.fillText(`You are on deck ${p.deck} — ${Math.abs(dd)} deck${Math.abs(dd) > 1 ? 's' : ''} ${dd > 0 ? 'above' : 'below'}`, ox, Math.min(oy + 27 * v.ppm + 22 * s, H - 20.6 * 16 * s));
      ctx.restore();
    }
    // orientation & scale bar
    this._drawScale(ctx, W, H, s);
    this.drawProfile();
  }

  _drawLabels(ctx, art, plan) {
    const v = this.view, s = this.ui.scale;
    const placed = [];
    const p = this.game.player;
    if (p && p.deck === this.deck) { const [px, py] = this.w2s(p.x, p.z); placed.push([px - 16 * s, py - 16 * s, 32 * s, 32 * s]); }
    const fits = (x, y, w, h) => { for (const b of placed) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; placed.push([x, y, w, h]); return true; };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const list = art.labels.slice().sort((a, b) => a.tier - b.tier || b.area - a.area);
    for (const L of list) {
      if (L.tier === 2 && v.ppm < 4.5) continue;
      if (L.tier === 1 && v.ppm < 2.6) continue;
      const wpx = L.w * v.ppm, hpx = L.h * v.ppm;
      let size = (L.tier === 0 ? 13 : 11) * s * Math.min(1.35, Math.max(0.85, v.ppm / 5));
      ctx.font = `${L.tier === 0 ? 600 : 500} ${size}px ${L.tier === 0 ? "'Cormorant Garamond','Lora',Georgia,serif" : 'Inter,sans-serif'}`;
      let text = L.text;
      let tw = ctx.measureText(text).width;
      const vertical = hpx > wpx * 1.6 && tw > wpx * 0.95;
      const room = vertical ? hpx : wpx;
      if (tw > room * 0.96) {
        // try a shorter form ("Aurora Theatre · Orchestra" → "Aurora Theatre")
        const short = text.replace(/\s*·.*$/, '').replace(/^The /, '');
        if (short !== text) { text = short; tw = ctx.measureText(text).width; }
      }
      if (tw > room * 1.1 && L.tier > 0) continue;
      if (tw > room * 1.6) continue;
      const [sx, sy] = this.w2s(L.x, L.z);
      const bw = vertical ? size * 1.3 : tw + 8, bh = vertical ? tw + 8 : size * 1.4;
      if (!fits(sx - bw / 2, sy - bh / 2, bw, bh)) continue;
      ctx.save(); ctx.translate(sx, sy); if (vertical) ctx.rotate(-Math.PI / 2);
      const dark = L.cat === 'crew' || L.cat === 'restricted' || L.cat === 'stateroom' || L.cat === 'void' || L.cat === 'lift';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = dark ? 'rgba(5,10,16,.85)' : 'rgba(250,244,230,.55)'; ctx.lineWidth = 3;
      ctx.fillStyle = dark ? (L.cat === 'restricted' ? '#f0b9ad' : '#e9e2d2') : '#0d1824';
      ctx.strokeText(text, 0, 0.5); ctx.fillText(text, 0, 0.5);
      ctx.restore();
    }
    // cabin ranges
    if (v.ppm > 3.2) {
      ctx.font = `600 ${10 * s * Math.min(1.25, v.ppm / 5)}px Inter,sans-serif`;
      for (const C of art.cabinLabels) {
        const [sx, sy] = this.w2s(C.x, C.z);
        const tw = ctx.measureText(C.text).width;
        if (tw > (C.x1 - C.x0) * v.ppm) continue;
        if (!fits(sx - tw / 2 - 3, sy - 7, tw + 6, 14)) continue;
        ctx.fillStyle = 'rgba(214,226,240,.78)'; ctx.fillText(C.text, sx, sy + 0.5);
      }
    }
  }

  _pin(ctx, x, z, col, label, kind) {
    const [sx, sy] = this.w2s(x, z), s = this.ui.scale;
    ctx.save(); ctx.translate(sx, sy);
    if (kind === 'wp') {
      const h = 22 * s;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-h * 0.1, -h * 0.35, -h * 0.42, -h * 0.5, -h * 0.42, -h * 0.75);
      ctx.arc(0, -h * 0.75, h * 0.42, Math.PI, 0); ctx.bezierCurveTo(h * 0.42, -h * 0.5, h * 0.1, -h * 0.35, 0, 0); ctx.closePath();
      ctx.fillStyle = col; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6; ctx.fill(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(0, -h * 0.75, h * 0.16, 0, TAU); ctx.fillStyle = '#0b1520'; ctx.fill();
    } else if (kind === 'obj') {
      const a = 8 * s;
      ctx.rotate(Math.PI / 4); ctx.fillStyle = col; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6; ctx.fillRect(-a, -a, 2 * a, 2 * a); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#0b1520'; ctx.lineWidth = 1.5; ctx.strokeRect(-a, -a, 2 * a, 2 * a); ctx.rotate(-Math.PI / 4);
    } else {
      ctx.beginPath(); ctx.arc(0, 0, 5 * s, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#0b1520'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (label) {
      ctx.font = `600 ${11.5 * s}px Inter,sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const tx = 13 * s, ty = kind === 'wp' ? -16 * s : 0;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(5,10,16,.86)'; roundRect(ctx, tx - 6 * s, ty - 10 * s, tw + 12 * s, 20 * s, 4 * s); ctx.fill();
      ctx.fillStyle = col; ctx.fillText(label, tx, ty + 0.5);
    }
    ctx.restore();
  }

  _drawScale(ctx, W, H, s) {
    const v = this.view;
    // scale bar bottom-right above the profile
    const target = 120 * s;
    const opts = [5, 10, 20, 25, 50, 100];
    let m = opts[opts.length - 1]; for (const o of opts) if (o * v.ppm >= target * 0.6) { m = o; break; }
    const len = m * v.ppm;
    const x1 = W - 17.5 * 16 * s, y = H - 20.6 * 16 * s;
    ctx.save();
    ctx.strokeStyle = 'rgba(241,236,226,.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x1 - len, y - 4); ctx.lineTo(x1 - len, y); ctx.lineTo(x1, y); ctx.lineTo(x1, y - 4); ctx.stroke();
    ctx.font = `600 ${10.5 * s}px Inter,sans-serif`; ctx.fillStyle = 'rgba(241,236,226,.8)'; ctx.textAlign = 'center';
    ctx.fillText(m + ' m', x1 - len / 2, y - 9 * s);
    // bow arrow
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(230,199,132,.85)';
    ctx.fillText('BOW  →', x1, y + 18 * s);
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(241,236,226,.45)';
    ctx.fillText('←  STERN', 19 * 16 * s, y + 18 * s);
    ctx.restore();
  }

  // ── profile (side elevation) ─────────────────────────────────────────
  drawProfile() {
    const cv = this.pcv; if (!cv) return;
    const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = this.pctx, g = this.game, s = this.ui.scale, p = g.player;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const padL = 48 * s, padR = 30 * s, padT = 26 * s, padB = 8 * s;
    // world → profile: x ∈ [-168,168] → [padL, W-padR]; y ∈ [-11, 50] → [H-padB, padT]
    const sx = (W - padL - padR) / 336, yTop = 55, yBot = -11.2;
    const sy = (H - padT - padB) / (yTop - yBot);
    const X = (x) => padL + (x + 168) * sx, Y = (y) => padT + (yTop - y) * sy;
    this._prof = { X, Y, sx, sy };
    // sea
    const wy = Y(SHIP.waterY);
    const sea = ctx.createLinearGradient(0, wy, 0, H);
    sea.addColorStop(0, 'rgba(40,90,130,.5)'); sea.addColorStop(1, 'rgba(10,30,50,.2)');
    ctx.fillStyle = sea; ctx.fillRect(0, wy, W, H - wy);
    ctx.strokeStyle = 'rgba(143,208,255,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, wy + 0.5); ctx.lineTo(W, wy + 0.5); ctx.stroke();
    // hull silhouette (decks 1–6 below hull top at deck 5 + 1.4) — use per-deck extents
    const L = g.layout;
    const ext = [];
    for (let d = 1; d <= SHIP.deckCount; d++) { const pl = L.plans[d]; if (pl) { const a = deckArt(pl); ext[d] = [a.minX, a.maxX]; } }
    // hull shape polygon
    ctx.beginPath();
    ctx.moveTo(X(-165), Y(deckY(6) + 3));
    ctx.lineTo(X(165), Y(deckY(6) + 3));
    ctx.lineTo(X(160), Y(2)); ctx.lineTo(X(150), Y(-6)); ctx.lineTo(X(146), Y(-10.8));
    ctx.lineTo(X(-140), Y(-10.8)); ctx.quadraticCurveTo(X(-160), Y(-6), X(-165), Y(-1.5));
    ctx.closePath();
    const hg = ctx.createLinearGradient(0, Y(deckY(6) + 3), 0, Y(-10.8));
    hg.addColorStop(0, '#1d3550'); hg.addColorStop(0.62, '#15283e'); hg.addColorStop(0.63, '#5a1f1f'); hg.addColorStop(1, '#3b1515');
    ctx.fillStyle = hg; ctx.fill();
    ctx.strokeStyle = 'rgba(233,223,198,.35)'; ctx.lineWidth = 1; ctx.stroke();
    // decks as bands
    this._bands = [];
    for (let d = 1; d <= SHIP.deckCount; d++) {
      const e = ext[d]; if (!e) continue;
      const y0 = Y(deckY(d) + 3), y1 = Y(deckY(d));
      const x0 = X(e[0]), x1 = X(e[1]);
      const sel = d === this.deck, hov = d === this._profHover, me = p && p.deck === d;
      ctx.fillStyle = sel ? 'rgba(201,164,91,.9)' : hov ? 'rgba(241,236,226,.42)' : d >= 7 ? (d % 2 ? 'rgba(222,228,236,.34)' : 'rgba(222,228,236,.26)') : (d % 2 ? 'rgba(160,185,210,.22)' : 'rgba(160,185,210,.15)');
      ctx.fillRect(x0, y0 + 0.6, x1 - x0, y1 - y0 - 1.2);
      // windows hint on superstructure
      if (!sel && d >= 4 && d <= 14) {
        ctx.fillStyle = 'rgba(160,200,235,.18)';
        for (let x = x0 + 3; x < x1 - 3; x += 4 * s) ctx.fillRect(x, y0 + (y1 - y0) * 0.35, 2 * s, Math.max(1, (y1 - y0) * 0.3));
      }
      this._bands.push({ deck: d, x0, x1, y0, y1, cx: (e[0] + e[1]) / 2 });
      // label
      const fs = Math.max(8, Math.min(12 * s, (y1 - y0) * 1.5));
      if (sel || me || d % 2 === 1 || (y1 - y0) > 11) {
        ctx.font = `${sel ? 700 : 600} ${fs}px Inter,sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = sel ? '#e6c784' : me ? '#8fd0ff' : 'rgba(241,236,226,.55)';
        ctx.fillText(String(d), padL - 8 * s, (y0 + y1) / 2 + 0.5);
      }
    }
    // funnel & mast
    ctx.fillStyle = '#1b2c3f'; ctx.strokeStyle = 'rgba(233,223,198,.35)';
    ctx.beginPath(); ctx.moveTo(X(-116), Y(deckY(17))); ctx.lineTo(X(-92), Y(deckY(17))); ctx.lineTo(X(-96), Y(deckY(17) + 9)); ctx.lineTo(X(-118), Y(deckY(17) + 9)); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c9a45b'; ctx.fillRect(X(-117.5), Y(deckY(17) + 7.5), X(-95.5) - X(-117.5), 2 * sy * 0.6);
    // markers on profile
    const mark = (x, d, col, shape) => {
      const yy = Y(deckY(d) + 1.5), xx = X(x);
      ctx.save(); ctx.translate(xx, yy); ctx.fillStyle = col; ctx.strokeStyle = '#06101a'; ctx.lineWidth = 1.5;
      if (shape === 'obj') { ctx.rotate(Math.PI / 4); ctx.fillRect(-4 * s, -4 * s, 8 * s, 8 * s); ctx.strokeRect(-4 * s, -4 * s, 8 * s, 8 * s); }
      else if (shape === 'me') { ctx.beginPath(); ctx.arc(0, 0, 4.5 * s, 0, TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 8 * s, 0, TAU); ctx.strokeStyle = 'rgba(143,208,255,.5)'; ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(0, 0, 4 * s, 0, TAU); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    };
    const ui = this.ui;
    if (ui.waypoint) mark(ui.waypoint.x, ui.waypoint.deck, '#8fd0ff', 'wp');
    if (ui.objective?.target) mark(ui.objective.target.x, ui.objective.target.deck, '#e6c784', 'obj');
    if (p) mark(p.x, p.deck, '#fbf6ea', 'me');
    // waterline label
    ctx.font = `600 ${8.5 * s}px Inter,sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(143,208,255,.6)';
    ctx.fillText('WL', W - padR + 6 * s, wy - 0.5);
    // scale caption
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(241,236,226,.42)';
    ctx.fillText('330 m · 17 decks · 5,180 guests · 1,940 crew', W - 14 * s, 13 * s);
  }
  _profileDeckAt(x, y) {
    if (!this._bands) return null;
    let best = null, bd = 1e9;
    for (const b of this._bands) {
      if (x < b.x0 - 6 || x > b.x1 + 6) continue;
      const cy = (b.y0 + b.y1) / 2, d = Math.abs(y - cy);
      if (d < bd && d < (b.y1 - b.y0) * 1.2) { bd = d; best = b; }
    }
    if (!best) return null;
    const P = this._prof;
    const wx = (x - P.X(-168)) / P.sx - 168;
    return { deck: best.deck, x: Math.max(-160, Math.min(160, wx)) };
  }
}

function drawIcon(ctx, kind, x, y, s, crew) {
  ctx.save(); ctx.translate(x, y);
  const r = s * 0.62;
  ctx.fillStyle = crew ? 'rgba(30,40,52,.92)' : 'rgba(8,16,26,.9)';
  ctx.strokeStyle = crew ? 'rgba(160,175,190,.6)' : 'rgba(230,199,132,.9)'; ctx.lineWidth = 1.2;
  roundRect(ctx, -r, -r, 2 * r, 2 * r, r * 0.3); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = crew ? '#c0cad4' : '#f1ece2'; ctx.fillStyle = crew ? '#c0cad4' : '#f1ece2'; ctx.lineWidth = Math.max(1, s * 0.09);
  const k = r * 0.62;
  if (kind === 'stairs') {
    ctx.beginPath(); ctx.moveTo(-k, k); ctx.lineTo(-k * 0.33, k); ctx.lineTo(-k * 0.33, k * 0.33); ctx.lineTo(k * 0.33, k * 0.33); ctx.lineTo(k * 0.33, -k * 0.33); ctx.lineTo(k, -k * 0.33); ctx.lineTo(k, -k); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(0, -k); ctx.lineTo(k * 0.7, -k * 0.15); ctx.lineTo(-k * 0.7, -k * 0.15); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(k * 0.7, k * 0.15); ctx.lineTo(-k * 0.7, k * 0.15); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
