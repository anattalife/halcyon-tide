// HALCYON TIDE (mobile) — phone HUD around the touch controls.
//
// game.mobileHud: { root, layout, ins (safe-area px), settings, btnScale, editing, controls (TouchControls),
//   editor (LayoutEditor), openEditor(), haptic(ms), setSetting(k, v) }
// Adds: top-right system buttons (bag, journal, pause), weapon slot bar (tap = equip, tap equipped = holster;
// ammo / taser / extinguisher meters), a close button over every panel, map touch pan / pinch-zoom / tap waypoint,
// CCTV console buttons, a Fullscreen entry on the title screen, a "Touch controls" section in Settings, haptics,
// minimap tap → map, objective card tap → collapse, a phone-sized HUD scale. Desktop-only hints are hidden by CSS.
import { HUD_CSS } from './mobileStyle.js';
import { Layout, LayoutEditor } from './layout.js';
import { TouchControls } from './touchControls.js';
import { IC } from './icons.js';
import { SETTINGS_DEF } from '../ui/panels.js';
import { SLOTS } from '../systems/weapons.js';

const SKEY = 'ht.m.settings';
const DEFAULTS = { lookSens: 1.0, aimSens: 0.55, leftFire: true, btnScale: 1.0, btnOpacity: 0.9, invertY: false, haptics: true };

export class MobileHud {
  constructor(game) {
    this.game = game;
    if (!document.getElementById('htm-style')) { const s = document.createElement('style'); s.id = 'htm-style'; s.textContent = HUD_CSS; document.head.appendChild(s); }
    this.settings = { ...DEFAULTS };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch {}
    this.layout = new Layout();
    this.ins = { l: 0, r: 0, t: 0, b: 0 };
    this._probe = document.createElement('div');
    this._probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(this._probe);
    this._readInsets();
    const root = this.root = document.createElement('div');
    root.id = 'htm-hud';
    document.body.appendChild(root);
    this.editing = false;
    this._applyLook();
    this.controls = new TouchControls(game, this);
    this.editor = new LayoutEditor(this);
    this._buildTop();
    this._buildSlots();
    this._buildClose();
    this._buildMapExtras();
    this._buildCCTV();
    this._hookUI();
    this._hookSettings();
    this._hookHaptics();
    this.layout.onChange(() => this.relayout());
    window.addEventListener('resize', () => setTimeout(() => this.relayout(), 60));
    window.addEventListener('orientationchange', () => setTimeout(() => this.relayout(), 300));
    // Chrome/Safari only unlock audio on a touchend/click: keep trying until the context runs
    const unlock = () => { try { game.audio?.unlock?.(); } catch {} if (game.audio?.ctx?.state === 'running') window.removeEventListener('touchend', unlock, true); };
    window.addEventListener('touchend', unlock, true);
  }

  get btnScale() { return this.settings.btnScale || 1; }

  _readInsets() {
    const cs = getComputedStyle(this._probe);
    const n = (v) => Math.round(parseFloat(v) || 0);
    this.ins = { l: n(cs.paddingLeft), r: n(cs.paddingRight), t: n(cs.paddingTop), b: n(cs.paddingBottom) };
    const R = document.documentElement.style;
    R.setProperty('--sl', this.ins.l + 'px'); R.setProperty('--sr', this.ins.r + 'px'); R.setProperty('--st', this.ins.t + 'px'); R.setProperty('--sb', this.ins.b + 'px');
  }
  relayout() { this._readInsets(); this.controls.layoutButtons(); if (this.editor.active) this.editor.render(); this.game.ui?._applyScale?.(); }
  _applyLook() {
    this.root.style.setProperty('--bo', String(this.settings.btnOpacity));
    const I = this.game.input;
    if (I) { I.sensitivity = 1; I.invertY = !!this.settings.invertY; }   // desktop mouse settings (ht.input) don't apply here
  }
  setSetting(k, v) {
    this.settings[k] = v;
    try { localStorage.setItem(SKEY, JSON.stringify(this.settings)); } catch {}
    this._applyLook();
    if (k === 'btnScale') this.controls.layoutButtons();
  }

  haptic(ms) {
    if (!this.settings.haptics) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
  }

  openEditor() {
    const ui = this.game.ui;
    if (ui?.panel) ui.closePanel();
    this.editor.open();
  }
  onEditor(on) {
    this.editing = on;
    this.controls.releaseAll();
    const g = this.game;
    if (on) { this._edPaused = g.paused; g.paused = true; }
    else { g.paused = !!this._edPaused && !!g.ui?.panel; this.relayout(); }
  }

  // ── top-right: bag, journal, pause ──────────────────────────────────
  _buildTop() {
    const top = this.top = document.createElement('div');
    top.className = 'htm-top';
    top.innerHTML = `<div class="tb" data-tb="inventory">${IC.bag}</div><div class="tb" data-tb="journal">${IC.phone}<i class="dot"></i></div><div class="tb" data-tb="pause">${IC.pause}</div>`;
    this.root.appendChild(top);
    top.addEventListener('touchstart', (e) => {
      const b = e.target.closest('[data-tb]'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      b.classList.add('dn'); setTimeout(() => b.classList.remove('dn'), 120);
      this._openPanel(b.dataset.tb);
    }, { passive: false });
    top.addEventListener('click', (e) => { const b = e.target.closest('[data-tb]'); if (b) this._openPanel(b.dataset.tb); });
  }
  _openPanel(name) {
    const ui = this.game.ui; if (!ui || ui.titleActive || ui.dlg?.active) return;
    this.haptic(6);
    if (ui.panel?.name === name) ui.closePanel(); else ui.openPanel(name);
  }

  // ── weapon slots ─────────────────────────────────────────────────────
  _buildSlots() {
    const bar = this.slots = document.createElement('div');
    bar.className = 'htm-slots';
    bar.innerHTML = SLOTS.map((id, i) => `<div class="htm-slot" data-slot="${i + 1}" data-w="${id}"><span class="n">${i + 1}</span>${IC['w_' + id] || ''}<span class="am"></span><span class="bar"><i></i></span></div>`).join('');
    this.root.appendChild(bar);
    this.slotEls = [...bar.children];
    const tap = (el) => {
      const c = this.game.combat; if (!c || !this.controls.playing) return;
      el.classList.add('dn'); setTimeout(() => el.classList.remove('dn'), 120);
      this.haptic(8);
      const id = el.dataset.w;
      // tap the equipped weapon to holster (= select fists, slot 1)
      this.game.input.virtualPress(id === c.weaponId && id !== 'fists' ? 'Digit1' : 'Digit' + el.dataset.slot);
    };
    bar.addEventListener('touchstart', (e) => { const el = e.target.closest('.htm-slot'); if (!el) return; e.preventDefault(); tap(el); }, { passive: false });
    bar.addEventListener('mousedown', (e) => { const el = e.target.closest('.htm-slot'); if (el) tap(el); });
  }
  _updateSlots(show) {
    const c = this.game.combat;
    this.slots.style.display = show && c ? '' : 'none';
    if (!show || !c) return;
    for (const el of this.slotEls) {
      const id = el.dataset.w, own = c.owned(id);
      if (el._own !== own) { el._own = own; el.style.display = own ? '' : 'none'; }
      el.classList.toggle('cur', c.weaponId === id);
      let am = '', bar = -1;
      if (id === 'pistol') { const a = c.ammo?.pistol; am = a ? `${a.mag}/${a.reserve}` : ''; if (c.reloading || c.reloadT > 0) am = '···'; }
      else if (id === 'taser') { const t = c.taserReadyIn ?? c.taserCD ?? 0; bar = t > 0 ? 1 - Math.min(1, t / 3.5) : 1; }
      else if (id === 'extinguisher') bar = Math.max(0, Math.min(1, (c.extCharge ?? 0) / 100));
      const amEl = el.querySelector('.am'); if (amEl._t !== am) { amEl._t = am; amEl.textContent = am; }
      const b = el.querySelector('.bar'); b.style.display = bar >= 0 ? '' : 'none'; if (bar >= 0) b.firstChild.style.transform = `scaleX(${bar.toFixed(2)})`;
    }
    // only fists → no bar at all (one useless slot is clutter)
    const owned = this.slotEls.filter(e => e._own).length;
    if (owned <= 1) this.slots.style.display = 'none';
  }

  // ── panel close button ───────────────────────────────────────────────
  _buildClose() {
    const b = this.closeBtn = document.createElement('div');
    b.id = 'htm-close'; b.innerHTML = IC.close;
    document.body.appendChild(b);
    const act = () => {
      const ui = this.game.ui; if (!ui) return;
      this.haptic(6);
      if (ui._confirm) { ui._confirm.handleKey('Escape'); return; }
      if (ui.panel) {
        if (ui.panel.name === 'pause' && ui.panel.obj.page && !ui.panel.obj.direct) { ui.panel.obj.back(); ui.sfx('ui_close'); }
        else ui.closePanel();
      }
    };
    b.addEventListener('touchstart', (e) => { e.preventDefault(); act(); }, { passive: false });
    b.addEventListener('click', act);
  }

  // ── map: touch pan / pinch zoom / tap waypoint, zoom + clear buttons ──
  _buildMapExtras() {
    const x = this.mapX = document.createElement('div');
    x.id = 'htm-mapx';
    x.innerHTML = `<button data-m="in">${IC.plus}</button><button data-m="out">${IC.minus}</button><button data-m="me">${IC.locate}</button><button data-m="clr" class="wpc">Clear<br>pin</button>`;
    document.body.appendChild(x);
    const map = () => this.game.ui?.map;
    const zoom = (k) => { const m = map(); if (!m?.isOpen) return; const r = m.cv.getBoundingClientRect(); this._mapZoomAt(m, r.width / 2, r.height / 2, k); };
    const act = (k) => {
      const m = map(); if (!m?.isOpen) return;
      if (k === 'in') zoom(1.35); else if (k === 'out') zoom(1 / 1.35);
      else if (k === 'me') { const p = this.game.player; if (p) { m.setDeck(p.deck, true); m.centreOn(p.x, p.z); } }
      else if (k === 'clr') { this.game.ui.setWaypoint(null); this.game.ui.sfx('ui_close'); m._decorateDecks?.(); m.draw(); }
    };
    x.addEventListener('touchstart', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; e.preventDefault(); act(b.dataset.m); }, { passive: false });
    x.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) act(b.dataset.m); });
  }
  _mapZoomAt(m, sx, sy, k) {
    const [wx, wz] = m.s2w(sx, sy);
    m.view.ppm = Math.max(m._minPpm || 1, Math.min(60, m.view.ppm * k));
    const [nx, nz] = m.s2w(sx, sy);
    m.view.cx += wx - nx; m.view.cz += wz - nz; m._clampView(); m.draw();
  }
  _bindMapTouch() {
    const m = this.game.ui?.map; if (!m?.cv || m._touchBound) return;
    m._touchBound = true;
    const cv = m.cv, T = new Map();
    let pan = null, pinch = null, tapOK = false;
    const rel = (t) => { const r = cv.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top]; };
    cv.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      for (const t of e.changedTouches) T.set(t.identifier, rel(t));
      if (T.size === 1) { const [x, y] = [...T.values()][0]; pan = { x, y, cx: m.view.cx, cz: m.view.cz }; tapOK = true; pinch = null; }
      else if (T.size >= 2) {
        const [a, b] = [...T.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), ppm: m.view.ppm, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
        pinch.w = m.s2w(pinch.mx, pinch.my); pan = null; tapOK = false;
      }
    }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (T.has(t.identifier)) T.set(t.identifier, rel(t));
      if (pinch && T.size >= 2) {
        const [a, b] = [...T.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        m.view.ppm = Math.max(m._minPpm || 1, Math.min(60, pinch.ppm * d / Math.max(10, pinch.d)));
        // keep the world point under the fingers' midpoint where it was, following the midpoint
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const [nx, nz] = m.s2w(mx, my);
        m.view.cx += pinch.w[0] - nx; m.view.cz += pinch.w[1] - nz; m._clampView(); m.draw();
      } else if (pan && T.size === 1) {
        const [x, y] = [...T.values()][0];
        const dx = x - pan.x, dy = y - pan.y;
        if (Math.abs(dx) + Math.abs(dy) > 8) tapOK = false;
        m.view.cx = pan.cx - dx / m.view.ppm; m.view.cz = pan.cz - dy / m.view.ppm; m._clampView(); m.draw();
      }
    }, { passive: false });
    const end = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const p = T.get(t.identifier); T.delete(t.identifier);
        if (tapOK && p && T.size === 0) {
          // tap: set a waypoint on the room under the finger (same as a desktop click)
          const [x, z] = m.s2w(p[0], p[1]);
          const room = this.game.layout.plans[m.deck]?.roomAt(x, z);
          if (room && !room.isVoid) { this.game.ui.setWaypoint({ deck: m.deck, x, z, label: m._roomLabel(room) }); this.game.ui.sfx('ui_click'); m._decorateDecks?.(); m.draw(); this.haptic(10); }
        }
      }
      if (T.size < 2) pinch = null;
      if (T.size === 1) { const [x, y] = [...T.values()][0]; pan = { x, y, cx: m.view.cx, cz: m.view.cz }; tapOK = false; }
      if (T.size === 0) pan = null;
    };
    cv.addEventListener('touchend', end, { passive: false });
    cv.addEventListener('touchcancel', end, { passive: false });
  }

  // ── CCTV console ─────────────────────────────────────────────────────
  _buildCCTV() {
    const c = this.cctv = document.createElement('div');
    c.id = 'htm-cctv';
    const B = (k, txt, css) => `<button data-c="${k}" style="${css}">${txt}</button>`;
    c.innerHTML = B('prev', '◀ CAM', 'left:calc(var(--sl) + 16px);top:50%') + B('next', 'CAM ▶', 'right:calc(var(--sr) + 16px);top:50%')
      + B('up', '▲ DECK', 'left:calc(var(--sl) + 16px);bottom:calc(var(--sb) + 16px)') + B('dn', '▼ DECK', 'left:calc(var(--sl) + 120px);bottom:calc(var(--sb) + 16px)')
      + B('loop', 'LOOP FEED', 'left:50%;transform:translateX(-110%);bottom:calc(var(--sb) + 16px)') + B('wipe', 'WIPE', 'left:50%;transform:translateX(10%);bottom:calc(var(--sb) + 16px)')
      + B('exit', 'EXIT ✕', 'right:calc(var(--sr) + 16px);bottom:calc(var(--sb) + 16px)');
    document.body.appendChild(c);
    const act = (k) => {
      const api = this.game.security?.cctv; if (!api?.active) return;
      this.haptic(8);
      if (k === 'prev') api.prev(); else if (k === 'next') api.next(); else if (k === 'up') api.nextDeck?.(1); else if (k === 'dn') api.nextDeck?.(-1);
      else if (k === 'loop') api.loop(); else if (k === 'wipe') api.wipe(); else if (k === 'exit') api.close();
    };
    c.addEventListener('touchstart', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; e.preventDefault(); act(b.dataset.c); }, { passive: false });
    c.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) act(b.dataset.c); });
  }

  // ── UI hooks: scale, title fullscreen, minimap/objective taps ────────
  _hookUI() {
    const g = this.game, ui = g.ui; if (!ui) return;
    // phone-sized HUD scale (desktop formula bottoms out at 0.7 on a 390 px tall screen)
    ui._applyScale = () => {
      const s = Math.min(innerWidth / 844, innerHeight / 390);
      ui.scale = Math.max(0.62, Math.min(1.05, 0.76 * Math.pow(s, 0.7))) * (ui.settings.hudScale || 1);
      ui.root.style.setProperty('--hs', ui.scale.toFixed(3));
      if (ui.panel?.name === 'map') ui.map.draw();
    };
    ui._applyScale();
    // title: Fullscreen entry
    const addFs = () => {
      const r = ui.titleScreen?.root; if (!r || r.querySelector('.mi.fs')) return;
      const menu = r.querySelector('.menu'); if (!menu) return;
      const b = document.createElement('button'); b.className = 'mi fs'; b.innerHTML = `${IC.fullscreen}<span>Fullscreen</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); window.HT_fullscreen?.(); setTimeout(() => this.relayout(), 400); });
      menu.appendChild(b);
    };
    if (ui.titleActive) addFs();
    g.bus.on('ui:title', (e) => { if (e?.active) setTimeout(addFs, 0); });
    // minimap → map; objective card → collapse/expand
    const mm = ui.hud?.mm;
    if (mm) { mm.addEventListener('click', () => this._openPanel('map')); }
    // objective card: expanded when it changes, folds to its title after 10 s (tap toggles) — keeps the corner clear
    const obj = ui.hud?.obj;
    if (obj) {
      let tm = 0;
      const fold = (ms) => { clearTimeout(tm); tm = setTimeout(() => obj.classList.add('mini'), ms); };
      obj.addEventListener('click', () => { obj.classList.toggle('mini'); if (!obj.classList.contains('mini')) fold(8000); });
      const orig = ui.hud.renderObjective.bind(ui.hud);
      ui.hud.renderObjective = (o) => { const key = o ? o.id + '|' + (o.steps || []).map(x => x.done ? 1 : 0).join('') : ''; orig(o); if (key !== this._objKey) { this._objKey = key; obj.classList.remove('mini'); fold(10000); } };
      fold(10000);
    }
    g.bus.on('ui:panel', (e) => { if (e?.name === 'map') this._bindMapTouch(); });
    // map framing: no profile strip / legend on phones — centre between the deck list and the zoom buttons
    const map = ui.map;
    if (map) {
      const box = () => {
        const W = map.cv.clientWidth, H = map.cv.clientHeight;
        const dl = map.decksEl?.getBoundingClientRect?.(); const left = dl && dl.width ? dl.right + 8 : 12;
        const top = (map.root?.querySelector('.ptop')?.getBoundingClientRect?.().bottom || 60) + 4;
        const right = W - this.ins.r - 70;
        return { W, H, left, top, right, bottom: H - this.ins.b - 8 };
      };
      map._origin = () => { const b = box(); return [(b.left + b.right) / 2, (b.top + b.bottom) / 2]; };
      map._fit = () => { const b = box(); map.view.ppm = Math.max(1, Math.min((b.right - b.left) / 335, (b.bottom - b.top) / 52)); map._minPpm = map.view.ppm * 0.9; };
    }
  }

  // ── settings: phone presets + a "Touch controls" section ────────────
  _hookSettings() {
    const ui = this.game.ui; if (!ui) return;
    const q = SETTINGS_DEF.find(d => d.k === 'quality');
    if (q) q.opts = [['mobile-low', 'Phone low'], ['mobile', 'Phone'], ['low', 'Low'], ['medium', 'Medium']];
    // replace the mouse rows with touch rows
    const iS = SETTINGS_DEF.findIndex(d => d.k === 'sensitivity'); if (iS >= 0) SETTINGS_DEF.splice(iS, 1);
    const iY = SETTINGS_DEF.findIndex(d => d.k === 'invertY'); if (iY >= 0) SETTINGS_DEF.splice(iY, 1);
    const iC = SETTINGS_DEF.findIndex(d => d.sec === 'Controls');
    const rows = [
      { sec: 'Touch controls' },
      { k: 'mob.lookSens', l: 'Look sensitivity', type: 'range', min: 0.3, max: 3, step: 0.05, fmt: (v) => (+v).toFixed(2) },
      { k: 'mob.aimSens', l: 'Aim sensitivity', type: 'range', min: 0.15, max: 2, step: 0.05, fmt: (v) => (+v).toFixed(2) },
      { k: 'mob.invertY', l: 'Invert look Y', type: 'seg', opts: [[false, 'Off'], [true, 'On']] },
      { k: 'mob.leftFire', l: 'Left fire button', type: 'seg', opts: [[true, 'On'], [false, 'Off']] },
      { k: 'mob.btnScale', l: 'Button size', type: 'range', min: 0.7, max: 1.4, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
      { k: 'mob.btnOpacity', l: 'Button opacity', type: 'range', min: 0.3, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
      { k: 'mob.layout', l: 'HUD layout', type: 'button', label: 'Customize…', run: () => this.openEditor() },
      { k: 'mob.layoutReset', l: 'Reset HUD layout', type: 'button', label: 'Reset', run: () => { this.layout.reset(); ui.toast('HUD layout reset', { kind: 'info' }); } },
      { k: 'mob.haptics', l: 'Vibration', type: 'seg', opts: [[true, 'On'], [false, 'Off']] },
      { k: 'mob.adaptive', l: 'Adaptive resolution', type: 'seg', opts: [[true, 'On'], [false, 'Off']] },
    ];
    if (iC >= 0) SETTINGS_DEF.splice(iC, 1, ...rows); else SETTINGS_DEF.push(...rows);
    const get = ui.getSetting.bind(ui), set = ui.setSetting.bind(ui);
    ui.getSetting = (k) => {
      if (k === 'mob.adaptive') return this.game.mobileRes ? this.game.mobileRes.enabled : true;
      if (k.startsWith('mob.')) return this.settings[k.slice(4)];
      return get(k);
    };
    ui.setSetting = (k, v) => {
      if (k === 'mob.adaptive') { this.game.mobileRes?.setEnabled(!!v); return; }
      if (k.startsWith('mob.')) { this.setSetting(k.slice(4), v); return; }
      return set(k, v);
    };
  }

  // ── haptics ──────────────────────────────────────────────────────────
  _hookHaptics() {
    const g = this.game, bus = g.bus;
    bus.on('combat:shot', (e) => { if (e?.actor === g.player) this.haptic(e.weapon === 'pistol' ? 18 : 10); });
    bus.on('combat:hit', (e) => { if (e?.by === 'player') this.haptic(e.lethal ? 40 : 22); });
    bus.on('player:damage', (e) => this.haptic(Math.min(80, 20 + (e?.amount || 0) * 2)));
  }

  // ── per frame ────────────────────────────────────────────────────────
  update() {
    const g = this.game, ui = g.ui, p = g.player;
    const cctv = !!g.security?.cctv?.active;
    const busy = !ui || ui.titleActive || !!ui.panel || !!ui.dlg?.active || this.editing;
    const playUI = !busy && !cctv && g.input?.context === 'play' && p && !['dead', 'arrested', 'cutscene'].includes(p.state) && !(ui && ui._hide && ui._hide.size);
    this.root.classList.toggle('off', !playUI);
    document.documentElement.classList.toggle('htm-busy', !!(ui && (ui.titleActive || ui.panel)) || this.editing);
    this._updateSlots(playUI && p?.state === 'free');
    this.closeBtn.classList.toggle('on', !!(ui && !ui.titleActive && (ui.panel || ui._confirm)) && !this.editing);
    this.mapX.classList.toggle('on', !!(ui?.panel?.name === 'map'));
    this.cctv.classList.toggle('on', cctv);
    // unread messages badge on the journal button
    const unread = (g.missions?.messages || []).some(m => !m.read);
    const jb = this.top.children[1]; if (jb._u !== unread) { jb._u = unread; jb.classList.toggle('badge', unread); }
  }
}
