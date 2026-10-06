// HALCYON TIDE — game.ui (docs/ARCHITECTURE.md "UI contract").
//
// Contract:
//   toast(text, {kind, ms})                    notify(title, body, {icon, ms})
//   setObjective({id,title,text,steps,target}) clearObjective(id)
//   dialogue({speaker, portrait?, role?, lines, options, auto?, cancelable?}) → Promise<optionId|null>
//   subtitle(text, speaker, ms)
//   openPanel('map'|'inventory'|'journal'|'phone'|'pause'|'settings'|'shop'|'save'|'load'|'controls', opts), closePanel(), isPanelOpen()
//   shop({title, sub?, items:[{id,name,price,desc,kind,icon?,enabled?,reason?}], onBuy(item)→bool, onClose?, credit?})
//   addMapMarker({id,deck,x,z,kind,label}), removeMapMarker(id)
//   fade(toBlack, ms) → Promise, cinematicBars(on), showTitle(text, sub, ms?)
// Extras:
//   setWaypoint({deck,x,z,label}|null), waypoint, objective, currentObjective(), completeObjective(id)
//   confirm(title, text) → Promise<bool>, isBusy(), titleActive, showTitleScreen(), quitToTitle(), loadSlot(n)
//   settings (object), getSetting(k), setSetting(k, v), setHudVisible(bool), hideHud(reason, on), sfx(name)
//   hud, map (MapPanel), scale
// Bus in : ui:toast {text,kind}, ui:objective {...|null}, ui:notify {title, body, icon}, bark, announce, mission:complete,
//          heat:change, save:done, player:enterRoom, player:deck, sealife:sighting (toast unless minor)
// Bus out: ui:panel {name|null}, ui:waypoint {...|null}, ui:title {active}, sfx {name:'ui_*'}, game:newGame, game:continue
// URL: ?notitle=1 skips the title; ?title=1 forces it. Title auto-skips for cam/shotmode params or navigator.webdriver.
import { CSS } from './uiStyle.js';
import { el } from './theme.js';
import { Hud } from './hud.js';
import { MapPanel } from './mapPanel.js';
import { buildPause, buildInventory, buildJournal, buildShop, buildConfirm, settingsPage } from './panels.js';
import { Dialogue } from './dialogue.js';
import { TitleScreen } from './title.js';
import { installSave } from '../systems/save.js';

const LS_KEY = 'ht.ui.settings';
const DEFAULTS = { subtitles: true, mmRotate: true, showFps: false, fov: 62, hudScale: 1 };

function loadSettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(LS_KEY) || '{}')) }; } catch { return { ...DEFAULTS }; }
}

class UI {
  constructor(game) {
    this.game = game;
    if (!document.getElementById('hx-style')) { const s = document.createElement('style'); s.id = 'hx-style'; s.textContent = CSS; document.head.appendChild(s); }
    const host = document.getElementById('ui') || document.body;
    this.root = el('div', 'hx', null, host);
    this.settings = loadSettings();
    this.markers = new Map();
    this.objective = null;
    this.objectives = new Map();
    this.completed = [];
    this.inbox = [];
    this.waypoint = null;
    this.panel = null;          // {name, obj, root}
    this.titleActive = false;
    this.stats = { dist: 0, decks: new Set(), rooms: new Set(), maxHeat: 0, saves: 0 };
    this._hide = new Set();
    this._lastPos = null;

    this.hud = new Hud(this);
    this.dlg = new Dialogue(this);
    this.map = new MapPanel(this);
    this.titleScreen = new TitleScreen(this);
    // overlays
    this.barsEl = el('div', 'bars', '<i></i><i></i>', this.root);
    this.chapEl = el('div', 'chap', '<div class="s"></div><div class="rule"></div><div class="t"></div><div class="rule"></div>', this.root);
    this.scrim = el('div', 'scrim', null, this.root);
    this.dipEl = el('div', 'fade', null, this.root); this.dipEl.style.transition = 'none'; this.dipEl.style.zIndex = '79';
    this.fadeEl = el('div', 'fade', null, this.root);
    this._applyScale();
    window.addEventListener('resize', () => this._applyScale());
    this._applySettings(true);
  }

  // ── scale ────────────────────────────────────────────────────────────
  _applyScale() {
    // 1.0 at 1080p; 0.72 at 720p; 2.0 at 4K. Clamped by the smaller of width/height ratios.
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    this.scale = Math.max(0.7, Math.min(2.2, s < 1 ? Math.pow(s, 0.6) : s)) * (this.settings.hudScale || 1);
    this.root.style.setProperty('--hs', this.scale.toFixed(3));
    if (this.panel?.name === 'map') this.map.draw();
  }

  // ── settings ─────────────────────────────────────────────────────────
  getSetting(k) {
    const g = this.game;
    if (k === 'quality') return g.qualityName || 'high';
    if (k === 'sensitivity') return g.input?.sensitivity ?? 1;
    if (k === 'invertY') return !!g.input?.invertY;
    if (k.startsWith('vol.')) { const ch = k.slice(4); const v = g.audio?.getVolume?.(ch); return v ?? this.settings[k] ?? 0.8; }
    return this.settings[k];
  }
  setSetting(k, v) {
    const g = this.game;
    if (k === 'quality') { try { g.setQuality?.(v); } catch (e) { console.warn(e); } return; }
    if (k === 'sensitivity') { if (g.input) { g.input.sensitivity = v; g.input.saveSettings?.(); } return; }
    if (k === 'invertY') { if (g.input) { g.input.invertY = !!v; g.input.saveSettings?.(); } return; }
    if (k.startsWith('vol.')) { this.settings[k] = v; g.audio?.setVolume?.(k.slice(4), v); this._save(); return; }
    this.settings[k] = v;
    this._save();
    this._applySettings();
  }
  _save() { try { localStorage.setItem(LS_KEY, JSON.stringify(this.settings)); } catch {} }
  _applySettings(initial) {
    const g = this.game, S = this.settings;
    if (g.cameraRig?.T) g.cameraRig.T.fov = S.fov;
    else if (g.camera && !initial) { g.camera.fov = S.fov; g.camera.updateProjectionMatrix(); }
    if (g.audio?.setVolume) for (const ch of ['master', 'music', 'sfx', 'ambience', 'voice']) if (S['vol.' + ch] != null && initial) g.audio.setVolume(ch, S['vol.' + ch]);
    this._applyScale();
  }

  sfx(name) { this.game.bus.emit('sfx', { name, vol: name === 'ui_hover' ? 0.6 : 1 }); }

  // ── toasts, notifications, subtitles ─────────────────────────────────
  toast(text, opts = {}) { return this.hud.toast(String(text ?? ''), typeof opts === 'string' ? { kind: opts } : opts); }
  notify(title, body, opts = {}) {
    this.inbox.push({ from: title, text: body, minutes: this.game.minutes });
    if (this.inbox.length > 80) this.inbox.shift();
    this.sfx('ui_open');
    return this.hud.notify(title, body, opts);
  }
  subtitle(text, speaker, ms, opts) { return this.hud.subtitle(text, speaker, ms, opts); }

  // ── objectives / waypoint / markers ──────────────────────────────────
  setObjective(o) {
    if (!o) { this.objective = null; this.hud.renderObjective(null); this._refresh(); return; }
    const prev = this.objective;
    const norm = { id: o.id ?? 'objective', title: o.title || '', text: o.text || '', steps: (o.steps || []).map(s => (typeof s === 'string' ? { text: s, done: false } : { text: s.text, done: !!s.done })), target: o.target && Number.isFinite(o.target.x) ? { deck: o.target.deck ?? this.game.player?.deck ?? 9, x: o.target.x, z: o.target.z, label: o.target.label || '' } : null };
    this.objectives.set(norm.id, norm);
    this.objective = norm;
    this.hud.renderObjective(norm);
    const isNew = !prev || prev.id !== norm.id;
    if (isNew) { this.toast(norm.title, { kind: 'mission' }); this.game.bus.emit('sfx', { name: 'objective' }); }
    else if (prev) {
      const before = prev.steps.filter(s => s.done).length, after = norm.steps.filter(s => s.done).length;
      if (after > before) this.game.bus.emit('sfx', { name: 'objective' });
    }
    this._refresh();
  }
  clearObjective(id) {
    if (id != null && this.objective && this.objective.id !== id) { this.objectives.delete(id); return; }
    if (this.objective) this.objectives.delete(this.objective.id);
    this.objective = null;
    this.hud.renderObjective(null);
  }
  completeObjective(id) {
    const o = id != null ? this.objectives.get(id) : this.objective;
    if (!o) return;
    this.completed.push({ id: o.id, title: o.title, text: o.text, minutes: this.game.minutes });
    this.clearObjective(o.id);
  }
  currentObjective() { return this.objective; }
  setWaypoint(w) {
    this.waypoint = w ? { deck: w.deck, x: w.x, z: w.z, label: w.label || 'Waypoint' } : null;
    this.game.bus.emit('ui:waypoint', this.waypoint);
  }
  addMapMarker(m) { if (m && m.id != null) this.markers.set(m.id, { kind: 'info', label: '', ...m }); }
  removeMapMarker(id) { this.markers.delete(id); }

  // ── overlays ─────────────────────────────────────────────────────────
  fade(toBlack, ms = 600) {
    return new Promise((res) => {
      const f = this.fadeEl;
      f.style.transition = `opacity ${ms}ms ease`;
      f.style.pointerEvents = toBlack ? 'auto' : 'none';
      void f.offsetWidth;
      f.style.opacity = toBlack ? '1' : '0';
      clearTimeout(this._fadeT);
      this._fadeT = setTimeout(res, ms + 20);
    });
  }
  setDip(a) { const v = a.toFixed(3); if (this._dip !== v) { this._dip = v; this.dipEl.style.opacity = v; } }
  cinematicBars(on) { this.barsEl.classList.toggle('on', !!on); this.hideHud('bars', !!on); }
  showTitle(text, sub = '', ms = 4200) {
    const c = this.chapEl;
    c.querySelector('.t').textContent = text || '';
    c.querySelector('.s').textContent = sub || '';
    c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
    this.game.bus.emit('sfx', { name: 'ui_open' });
    clearTimeout(this._chapT);
    return new Promise((res) => { this._chapT = setTimeout(() => { c.classList.remove('on'); setTimeout(res, 1200); }, ms); });
  }

  // ── dialogue ─────────────────────────────────────────────────────────
  dialogue(cfg) { return this.dlg.open(cfg || {}); }
  _dialogueBegin() {
    const g = this.game, p = g.player;
    this._dlgPrevLock = p?.controlsLocked;
    p?.lockControls?.(true);
    g.input?.setContext?.('ui'); g.input?.releaseLock?.();
    this.hideHud('dialogue', true);
  }
  _dialogueEnd() {
    const g = this.game, p = g.player;
    p?.lockControls?.(!!this._dlgPrevLock);
    this.hideHud('dialogue', false);
    if (!this.panel && !this.titleActive) g.input?.setContext?.('play');
  }

  // ── HUD visibility ───────────────────────────────────────────────────
  hideHud(reason, on) { if (on) this._hide.add(reason); else this._hide.delete(reason); this._refresh(); }
  setHudVisible(v) { this.hideHud('user', !v); }
  _refresh() {
    const vis = this._hide.size === 0 && !this.panel && !this.titleActive && !this.dlg.active;
    this.root.classList.toggle('titling', !!this.titleActive);
    this.hud.setVisible(vis);
    try { this.game.playerHud?.setVisible?.(vis); } catch {}
    // the security workstream's HUD (weapon card, heat wheels) must not sit on top of menus / title / dialogue
    try { const sh = this.game.security?.hud; if (sh?.setVisible && sh.visible !== vis) sh.setVisible(vis); } catch {}
  }
  isPanelOpen() { return !!this.panel; }
  // resolves once the title screen is gone (dialogues/cards requested during the title wait for gameplay)
  whenPlaying() { return this.titleActive ? new Promise((res) => (this._playWaiters ||= []).push(res)) : Promise.resolve(); }
  isBusy() { return !!(this.panel || this.dlg.active || this.titleActive || this._hide.has('bars')); }

  // ── panels ───────────────────────────────────────────────────────────
  openPanel(name, opts = {}) {
    if (name === 'phone') name = 'journal';
    if (this.panel?.name === name && name !== 'shop') return;
    const replacing = !!this.panel;
    if (replacing) this._teardownPanel();
    let obj;
    if (name === 'map') obj = { root: this.map.open(opts), update: () => this.map.update(), handleKey: (c) => this.map.handleKey(c), close: () => this.map.close() };
    else if (name === 'inventory') obj = buildInventory(this, opts);
    else if (name === 'journal') obj = buildJournal(this, opts);
    else if (name === 'pause') obj = buildPause(this, opts);
    else if (['settings', 'save', 'load', 'controls'].includes(name)) {
      if (this.titleActive && name === 'settings') { obj = this._titleSettings(); }
      else { obj = buildPause(this, { page: name }); obj.direct = true; }
      name = this.titleActive ? name : 'pause';
    }
    else if (name === 'shop') obj = buildShop(this, opts);
    else { console.warn('[ui] unknown panel', name); return; }
    const g = this.game;
    this.panel = { name, obj, root: obj.root };
    // exactly one panel is mounted: purge anything left over (e.g. a root still referenced by a stale teardown)
    for (const n of [...this.root.querySelectorAll(':scope > .pnl')]) if (n !== obj.root && !n.classList.contains('conf')) { if (n === this.map._root) { n.classList.remove('on'); n.style.display = 'none'; } else n.remove(); }
    if (obj.root.parentNode !== this.root) this.root.appendChild(obj.root);
    // the scrim sits under every panel (dims + blurs the game; the map is opaque on top of it anyway)
    this.scrim.classList.add('on');
    if (replacing) {
      // switching panels is instant: no cross-fade, so two panels' titles never overlap
      obj.root.classList.add('instant', 'on');
      requestAnimationFrame(() => requestAnimationFrame(() => obj.root.classList.remove('instant')));
    } else {
      obj.root.classList.remove('instant');
      requestAnimationFrame(() => obj.root.classList.add('on'));
    }
    if (!replacing) {
      this._wasPaused = g.paused;
      this.sfx('ui_open');
    }
    if (name === 'pause' || name === 'map' || name === 'inventory' || name === 'journal' || name === 'settings') g.paused = true;
    g.input?.setContext?.('ui'); g.input?.releaseLock?.();
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}
    if (name === 'map') requestAnimationFrame(() => { this.map.draw(); this.map.drawProfile(); });
    g.bus.emit('ui:panel', { name });
    this._refresh();
  }
  _titleSettings() {
    const root = el('div', 'pnl pause');
    root.innerHTML = `<div class="side"><div class="brand">LARKSPUR OCEANIC</div><div class="logo">Halcyon Tide</div><div class="when">Settings</div><div class="menu"><button class="mi" data-k="back">Back</button></div></div><div class="psub"></div>`;
    settingsPage(this, root.querySelector('.psub'));
    root.querySelector('[data-k=back]').onclick = () => { this.sfx('ui_click'); this.closePanel(); };
    return { root };
  }
  _teardownPanel(animate = false) {
    const P = this.panel; if (!P) return;
    try { P.obj.close?.(); } catch (e) { console.warn(e); }
    const r = P.root;
    this.panel = null;
    if (P.name === 'map') return;     // MapPanel caches its DOM and hides itself (close())
    if (!animate) { r.remove(); return; }
    // closing back to gameplay: short fade-out; the node is inert meanwhile and removed unless it was re-mounted
    r.classList.remove('on'); r.style.pointerEvents = 'none';
    setTimeout(() => { if (this.panel?.root !== r) r.remove(); else r.style.pointerEvents = ''; }, 200);
  }
  closePanel() {
    if (!this.panel) return;
    const g = this.game;
    this._teardownPanel(true);
    this.scrim.classList.remove('on');
    this.sfx('ui_close');
    g.paused = false;
    if (!this.dlg.active && !this.titleActive) {
      g.input?.setContext?.('play');
      // re-acquire pointer lock (we're inside a user gesture when closed via key/click)
      if (g.input && !g.input._debug && g.input.lastDevice !== 'pad') try { g.input.requestLock(); } catch {}
    }
    g.bus.emit('ui:panel', { name: null });
    this._refresh();
  }
  shop(cfg) { this.openPanel('shop', cfg); }
  confirm(title, text) {
    return new Promise((resolve) => {
      const prev = this.panel;
      const host = el('div', '', null, this.root);
      host.style.cssText = 'position:absolute;inset:0;z-index:70;pointer-events:auto;background:rgba(2,4,8,.55)';
      let done = false;
      const fin = (v) => { if (done) return; done = true; host.remove(); this._confirm = null; resolve(v); };
      const c = buildConfirm(this, title, text, fin);
      host.appendChild(c.root); requestAnimationFrame(() => c.root.classList.add('on'));
      this._confirm = { handleKey: (code) => { if (code === 'Escape') { fin(false); return true; } return c.handleKey(code); } };
      void prev;
    });
  }

  // ── save / load / title ──────────────────────────────────────────────
  loadSlot(n) {
    const g = this.game;
    this.fade(true, 500).then(() => {
      if (this.panel) this.closePanel();
      const ok = g.save?.loadSlot?.(n);
      g.paused = false;
      this.fade(false, 900);
      this.toast(ok ? 'Game loaded' : 'Could not load that save', { kind: ok ? 'good' : 'bad' });
    });
  }
  showTitleScreen(opts) {
    const g = this.game;
    if (this.panel) this.closePanel();
    g.player?.lockControls?.(true);
    g.input?.setContext?.('ui');
    this.titleScreen.show(opts);
    g.bus.emit('ui:title', { active: true });
    this._refresh();
  }
  quitToTitle() {
    this.fade(true, 700).then(() => {
      if (this.panel) this.closePanel();
      this.titleScreen._fresh = false;
      this.showTitleScreen();
      this.game.paused = false;
      this.fade(false, 1200);
    });
  }
  _titleDone() {
    const g = this.game;
    const w = this._playWaiters || []; this._playWaiters = [];
    setTimeout(() => w.forEach(f => f()), 1500);
    g.player?.lockControls?.(false);
    g.input?.setContext?.('play');
    g.bus.emit('ui:title', { active: false });
    this._refresh();
  }

  // ── per-frame input & update ─────────────────────────────────────────
  _keys() {
    // panel / dialogue keys (raw codes; UI context gates actions)
    const I = this.game.input; if (!I) return;
    const pressed = I._pressed ? [...I._pressed] : [];
    if (!pressed.length) return;
    const typing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if (typing) return;
    for (const code of pressed) {
      if (this._confirm) { this._confirm.handleKey(code); return; }
      if (this.titleActive && !this.panel) { if (code !== 'Escape') this.titleScreen.handleKey(code); continue; }
      if (this.dlg.active && !this.panel) { this.dlg.handleKey(code); continue; }
      if (this.panel) {
        if (this.panel.obj.handleKey?.(code)) continue;
      }
    }
  }
  update(dt, realDt) {
    const g = this.game, I = g.input;
    // title first-frame hookup
    if (this.titleScreen.active) this.titleScreen.update(realDt);
    else if (this._wasTitle) { this._wasTitle = false; this._titleDone(); }
    if (this.titleScreen.active) this._wasTitle = true;

    if (I) {
      this._keys();
      const busyDlg = this.dlg.active;
      const pause = I.actionPressed('Pause') && !this._confirm;
      const map = I.actionPressed('Map'), inv = I.actionPressed('Inventory'), jr = I.actionPressed('Phone');
      if (this.titleActive) {
        if (pause && this.panel) this.closePanel();
      } else if (busyDlg) {
        // dialogue owns input
      } else if (pause) {
        if (this.panel) {
          // Esc inside a pause sub-page goes back to the menu; elsewhere closes
          if (this.panel.name === 'pause' && this.panel.obj.page && !this.panel.obj.direct) { this.panel.obj.back(); this.sfx('ui_close'); }
          else this.closePanel();
        } else this.openPanel('pause');
      } else if (map) { this.panel?.name === 'map' ? this.closePanel() : this.openPanel('map'); }
      else if (inv) { this.panel?.name === 'inventory' ? this.closePanel() : this.openPanel('inventory'); }
      else if (jr) { this.panel?.name === 'journal' ? this.closePanel() : this.openPanel('journal'); }
    }
    this.panel?.obj.update?.(realDt);
    // other workstreams' HUDs installed after us: keep them in step with ours
    const sh = g.security?.hud; if (sh?.setVisible && sh.visible !== this.hud.visible) sh.setVisible(this.hud.visible);
    this.dlg.update(realDt);
    this.hud.update(dt, realDt);
    this._track(realDt);
  }
  openPanelFresh(name) { this._teardownPanel(); this.openPanel(name); }

  _track() {
    const p = this.game.player; if (!p || this.titleActive) return;
    if (this._lastPos && this._lastPos.deck === p.deck) {
      const d = Math.hypot(p.x - this._lastPos.x, p.z - this._lastPos.z);
      if (d < 5) this.stats.dist += d;
    }
    this._lastPos = { x: p.x, z: p.z, deck: p.deck };
    this.stats.decks.add(p.deck);
    if (p.room?.uid) this.stats.rooms.add(p.room.uid);
    const h = this.game.security?.heat ?? 0; if (h > this.stats.maxHeat) this.stats.maxHeat = h;
  }
}

function shouldShowTitle(game) {
  const p = game.params || new URLSearchParams(location.search);
  if (p.has('title')) return p.get('title') !== '0';
  if (p.has('notitle') || p.has('cam') || p.has('shotmode')) return false;
  try { if (sessionStorage.getItem('ht.skipTitle')) { sessionStorage.removeItem('ht.skipTitle'); return false; } } catch {}
  if (navigator.webdriver) return false;
  return true;
}

export function installUI(game) {
  installSave(game);
  const ui = game.ui = new UI(game);
  ui.startMinutes = game.minutes;
  const bus = game.bus;
  // bus wiring
  bus.on('ui:toast', (e) => e && ui.toast(e.text, { kind: e.kind, ms: e.ms }));
  bus.on('ui:notify', (e) => e && ui.notify(e.title, e.body ?? e.text, e));
  bus.on('ui:objective', (e) => (e ? ui.setObjective(e) : ui.clearObjective()));
  bus.on('bark', (e) => {
    if (!e || !e.text || !ui.settings.subtitles) return;
    const p = game.player; if (!p || ui.titleActive) return;
    if (e.deck != null && e.deck !== p.deck) return;
    if (Number.isFinite(e.x) && Math.hypot(e.x - p.x, e.z - p.z) > 14) return;
    const name = e.npc?.identity?.name || e.npc?.name || e.speaker || '';
    ui.subtitle(e.text, name, Math.min(5000, 1600 + e.text.length * 50));
  });
  bus.on('announce', (e) => { if (e?.text && !ui.titleActive) ui.subtitle(e.text, e.speaker || 'Bridge announcement', Math.min(14000, 3500 + e.text.length * 60), { pa: true }); });
  bus.on('mission:complete', (e) => {
    const title = e?.title || e?.name || 'Job complete';
    if (e?.id != null && ui.objectives.has(e.id)) ui.completeObjective(e.id);
    else ui.completed.push({ id: e?.id, title, minutes: game.minutes });
    ui.toast(title, { kind: 'mission' });
  });
  // sea life / passing ships (seaLife.js); 'minor' sightings (each whale spout) stay silent
  bus.on('sealife:sighting', (e) => {
    if (!e || e.minor || ui.titleActive) return;
    const fallback = { dolphins: 'Dolphins off the bow!', whale: 'Whale sighted!', ship: 'Ship passing' }[e.kind] || 'Sighting off the ship';
    ui.toast(e.text || fallback, { kind: 'info', ms: 4200 });
  });
  bus.on('save:done', (e) => { ui.hud.showSaving(); if (!e?.auto) ui.stats.saves++; });
  bus.on('settings:quality', () => ui._applyScale());
  bus.on('audio:ready', () => ui._applySettings(true));
  // late-installed camera rig / audio pick up settings next frame
  let applied = false;

  game.addSystem({
    name: 'ui', order: 95, runWhilePaused: true,
    update(dt, realDt) {
      if (!applied && game.cameraRig) { applied = true; ui._applySettings(true); }
      try { ui.update(dt, realDt); } catch (e) { throw e; }
    },
  });

  if (shouldShowTitle(game)) {
    // show immediately; the loader fades out on top of it
    ui.titleScreen._fresh = true;
    ui.showTitleScreen({ initial: true });
  }
  // debug helpers
  window.__ui = ui;
  return ui;
}
