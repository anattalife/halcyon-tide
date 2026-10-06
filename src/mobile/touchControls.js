// HALCYON TIDE (mobile) — PUBG-Mobile-style touch controls → game.input virtual actions/axes.
//
//  Left   floating joystick (appears where the thumb lands in the left ~42 % below the minimap); analog walk→jog by
//         deflection; push up past the outer ring = sprint; slide further up onto the lock icon and release =
//         auto-sprint (tap the stick area to cancel). Left fire button above it.
//  Right  drag anywhere free to look (no acceleration; separate aim sensitivity; invert Y). Fire (also drags the
//         camera, like PUBG), Aim toggle, Jump, Crouch, Reload (pistol), contextual Interact pill (current E/G
//         interaction; hold interactions fill a ring), Alt pill (F: pickpocket / pocket it), View (1st/3rd person),
//         Hands up (hold).
// Multi-touch: every touch is tracked by identifier and owned by one control, so move + look + fire work together.
// Nothing here fakes DOM key events: input.setVirtualAxis / setVirtualLook / virtualHold / virtualPress.
import { CONTROLS } from './layout.js';
import { IC, interactIcon } from './icons.js';
import { letterCode } from '../core/input.js';

const LOOK_RAD_PER_PX = 0.0058;
const UI_SEL = 'button,input,select,textarea,a,[data-k],.pnl,.dlg,.lift-ui,.act-scrim,.title,.mm,.obj,#htm-close,#htm-mapx,#htm-cctv,#htm-edit,.sh-dlg,.htm-top,.htm-slots,.scrim,.conf,#htm-rotate,.loader';      // at look sensitivity 1.0: ~300 px of drag ≈ 100° of turn

export class TouchControls {
  constructor(game, hud) {
    this.game = game; this.hud = hud; this.input = game.input;
    this.touches = new Map();        // id → {kind, ...}
    this.btn = {};                   // control id → element
    this.stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, sprint: false, lockHot: false, locked: false };
    this.aimOn = false;
    this.fireHeld = 0;
    this.enabled = true;
    this._build();
    this._bind();
  }

  // ── DOM ─────────────────────────────────────────────────────────────
  _build() {
    const root = this.hud.root;
    for (const id of Object.keys(CONTROLS)) {
      const c = CONTROLS[id];
      if (id === 'stick') continue;
      const b = document.createElement('div');
      b.className = 'mb' + (c.fire ? ' fire' : '') + (c.pill ? ' pill hide' : '') + (c.d <= 46 ? ' small' : '');
      b.dataset.mb = id;
      if (c.pill) b.innerHTML = `<div class="ic">${c.icon}<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" stroke-dasharray="0 200"/></svg></div><div class="tx"><b></b><small></small></div>`;
      else b.innerHTML = c.icon + (id === 'surrender' ? '<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" stroke-dasharray="0 200"/></svg>' : '') + (c.fire ? '' : `<span class="lb">${c.label}</span>`);
      root.appendChild(b);
      this.btn[id] = b;
    }
    // joystick visual
    const st = this.stickEl = document.createElement('div');
    st.className = 'htm-stick';
    st.innerHTML = `<div class="base"></div><div class="knob"></div>`;
    root.appendChild(st);
    this.baseEl = st.querySelector('.base'); this.knobEl = st.querySelector('.knob');
    const lk = this.lockEl = document.createElement('div');
    lk.className = 'htm-lock';
    lk.innerHTML = `<span class="lt">SPRINT LOCK</span>${IC.lock}`;
    root.appendChild(lk);
    this.layoutButtons();
  }

  // place every control from the layout (+ global button scale)
  layoutButtons() {
    const L = this.hud.layout, ins = this.hud.ins, bs = this.hud.btnScale;
    for (const id in this.btn) {
      const b = this.btn[id], c = CONTROLS[id], p = L.pos(id, ins);
      const d = Math.round(c.d * p.s * bs);
      b.style.left = p.x + 'px'; b.style.top = p.y + 'px'; b.style.height = d + 'px';
      if (c.pill) { b.style.minWidth = Math.round(d * 2.2) + 'px'; const ic = b.querySelector('.ic'); ic.style.width = ic.style.height = Math.round(d - 10) + 'px'; }
      else b.style.width = d + 'px';
      b._cx = p.x; b._cy = p.y;
    }
    const sp = L.pos('stick', ins);
    this.stickR = Math.round(CONTROLS.stick.d * sp.s * bs / 2);
    this.stickRest = { x: sp.x, y: sp.y };
    const R = this.stickR;
    this.baseEl.style.width = this.baseEl.style.height = (2 * R) + 'px';
    this.knobEl.style.width = this.knobEl.style.height = Math.round(R * 0.82) + 'px';
    if (!this.stick.active && !this.stick.locked) this._drawStick(sp.x, sp.y, sp.x, sp.y);
  }

  _drawStick(ox, oy, kx, ky) {
    this.baseEl.style.left = ox + 'px'; this.baseEl.style.top = oy + 'px';
    this.knobEl.style.left = kx + 'px'; this.knobEl.style.top = ky + 'px';
    const R = this.stickR;
    this.lockEl.style.left = ox + 'px'; this.lockEl.style.top = (oy - R - 58) + 'px';
  }

  // ── touch routing ────────────────────────────────────────────────────
  _bind() {
    const opt = { passive: false, capture: true };
    window.addEventListener('touchstart', (e) => this._start(e), opt);
    window.addEventListener('touchmove', (e) => this._move(e), opt);
    window.addEventListener('touchend', (e) => this._end(e), opt);
    window.addEventListener('touchcancel', (e) => this._end(e), opt);
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('orientationchange', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    this.game.bus.on('input:context', (ctx) => { if (ctx !== 'play') this.releaseAll(true); });
  }

  get playing() {
    const g = this.game, ui = g.ui;
    return this.enabled && g.input?.context === 'play' && !g.paused && !ui?.titleActive && !ui?.panel && !ui?.dlg?.active && !this.hud.editing;
  }

  _start(e) {
    if (this.hud.editing) return;
    const canvas = this.game.renderer.domElement;
    for (const t of e.changedTouches) {
      const tgt = t.target;
      const mb = tgt && tgt.closest ? tgt.closest('[data-mb]') : null;
      if (mb) {
        e.preventDefault();
        if (this.playing) this._press(mb.dataset.mb, t);
        continue;
      }
      // UI elements (panels, lift buttons, map, minimap…) keep their normal behaviour; anything else over the
      // canvas (invisible HUD overlays that still catch hits) counts as the game surface
      if (tgt !== canvas && (!tgt || !tgt.closest || tgt.closest(UI_SEL))) continue;
      e.preventDefault();                       // no emulated mouse events, no scroll/zoom
      if (!this.playing) continue;
      const W = innerWidth, H = innerHeight, x = t.clientX, y = t.clientY;
      const inStickZone = x < W * 0.42 && y > H * 0.36;
      if (inStickZone && !this.stick.active) {
        this.stick.locked = false;              // tapping the stick cancels sprint lock
        this._stickStart(t);
      } else {
        this.touches.set(t.identifier, { kind: 'look', x, y });
      }
    }
  }

  _move(e) {
    if (!this.touches.size && !this.stick.active) return;
    for (const t of e.changedTouches) {
      const T = this.touches.get(t.identifier);
      if (this.stick.active && t.identifier === this.stick.id) { this._stickMove(t); e.preventDefault(); continue; }
      if (!T) continue;
      e.preventDefault();
      if (T.kind === 'look' || T.kind === 'fire') {
        const dx = t.clientX - T.x, dy = t.clientY - T.y;
        T.x = t.clientX; T.y = t.clientY;
        if (this.playing) this._look(dx, dy);
      }
    }
  }

  _end(e) {
    for (const t of e.changedTouches) {
      if (this.stick.active && t.identifier === this.stick.id) { this._stickEnd(); continue; }
      const T = this.touches.get(t.identifier);
      if (!T) continue;
      this.touches.delete(t.identifier);
      if (T.kind === 'fire') { this.fireHeld = Math.max(0, this.fireHeld - 1); if (!this.fireHeld) this.input.virtualHold('Fire', false); this._btnState(T.id, false); }
      else if (T.kind === 'hold') { this.input.virtualHold(T.code, false); this._btnState(T.id, false); }
      else if (T.kind === 'btn') this._btnState(T.id, false);
    }
  }

  releaseAll(keepLock = false) {
    for (const [, T] of this.touches) if (T.id) this._btnState(T.id, false);
    this.touches.clear();
    this.fireHeld = 0;
    this.stick.active = false; this.stick.sprint = false; this.stick.lockHot = false;
    if (!keepLock) this.stick.locked = false;
    this.input?.clearVirtual?.();
    if (this.aimOn) { this.aimOn = false; }
    this.stickEl.classList.remove('act', 'spr');
    if (this.stickRest) this._drawStick(this.stickRest.x, this.stickRest.y, this.stickRest.x, this.stickRest.y);
  }

  _btnState(id, dn) { const b = this.btn[id]; if (b) b.classList.toggle('dn', dn); }

  _press(id, t) {
    const I = this.input, g = this.game;
    this.hud.haptic(6);
    const track = (kind, extra = {}) => this.touches.set(t.identifier, { kind, id, x: t.clientX, y: t.clientY, ...extra });
    this._btnState(id, true);
    switch (id) {
      case 'fire': case 'lfire':
        this.fireHeld++; I.virtualHold('Fire', true); track('fire'); return;
      case 'aim':
        this.aimOn = !this.aimOn; I.virtualHold('Aim', this.aimOn); track('btn'); return;
      case 'jump': I.virtualPress('Jump'); track('btn'); return;
      case 'crouch': I.virtualPress('Crouch'); track('btn'); return;
      case 'reload': I.virtualPress('KeyR'); track('btn'); return;
      case 'fpv': I.virtualPress('CameraSwap'); track('btn'); return;
      case 'surrender': I.virtualHold('KeyH', true); track('hold', { code: 'KeyH' }); return;
      case 'interact': {
        const it = g.player?.interaction?.best;
        if (!it) { track('btn'); return; }
        const key = it.key || 'E';
        const code = key === 'E' ? 'Interact' : key === 'F' ? 'AltInteract' : letterCode(key);
        I.virtualHold(code, true); track('hold', { code });
        return;
      }
      case 'alt': {
        const best = g.player?.interaction?.best, alt = this._altIt;
        if (alt && best && alt.id === best.id) { I.virtualHold('AltInteract', true); track('hold', { code: 'AltInteract' }); return; }
        if (alt && alt.enabled !== false && !(alt.hold > 0)) this._runDirect(alt);
        else if (alt && alt.enabled === false) g.bus.emit('ui:toast', { text: alt.reason || 'Unavailable', kind: 'warn' });
        track('btn');
        return;
      }
    }
    track('btn');
  }

  // run a secondary (non-best) interaction exactly like player.js runInteraction does
  _runDirect(it) {
    const g = this.game, p = g.player;
    try {
      it.run(p, g);
      g.bus.emit('player:interact', { id: it.id, label: it.label });
      if (it.crime) g.bus.emit('crime', { ...it.crime, x: p.x, y: p.y, z: p.z, deck: p.deck, actor: p, victim: it.victim ?? null });
    } catch (e) { console.error('[touch] alt interaction failed', it.id, e); }
  }

  _look(dx, dy) {
    const g = this.game, S = this.hud.settings, rig = g.cameraRig;
    if (!rig) return;
    const aiming = rig.aimK > 0.5;
    const k = LOOK_RAD_PER_PX * (aiming ? S.aimSens : S.lookSens);
    // cameraRig applies T.sens × input.sensitivity × (0.6 when aiming): divide those out so k is exact rad/px
    const unit = rig.T.sens * (g.input.sensitivity || 1) * (aiming ? 0.6 : 1);
    this.input.setVirtualLook(dx * k / unit, dy * k * 0.85 / unit);
  }

  // ── joystick ─────────────────────────────────────────────────────────
  _stickStart(t) {
    const R = this.stickR, W = innerWidth, H = innerHeight, ins = this.hud.ins;
    const ox = Math.max(ins.l + R + 6, Math.min(W * 0.45, t.clientX));
    const oy = Math.max(H * 0.36 + R * 0.4, Math.min(H - ins.b - R - 6, t.clientY));
    Object.assign(this.stick, { active: true, id: t.identifier, ox, oy, x: t.clientX, y: t.clientY, sprint: false, lockHot: false });
    this.stickEl.classList.add('act');
    this._stickMove(t);
  }
  _stickMove(t) {
    const s = this.stick, R = this.stickR;
    s.x = t.clientX; s.y = t.clientY;
    let dx = (s.x - s.ox) / R, dy = (s.y - s.oy) / R;
    const m = Math.hypot(dx, dy);
    // sprint: pushed up beyond the outer ring, mostly vertical
    const up = -dy;
    s.sprint = up > 1.18 && Math.abs(dx) < up * 0.75;
    // sprint lock target above the base
    const lx = s.ox, ly = s.oy - R - 58;
    s.lockHot = s.sprint && Math.hypot(s.x - lx, s.y - ly) < 34;
    const km = Math.min(1, m), kx = m > 0 ? dx / m * km : 0, ky = m > 0 ? dy / m * km : 0;
    this._drawStick(s.ox, s.oy, s.ox + kx * R, s.oy + ky * R);
  }
  _stickEnd() {
    const s = this.stick;
    s.active = false;
    if (s.lockHot) { s.locked = true; this.hud.haptic(15); }
    s.sprint = false; s.lockHot = false;
    this.stickEl.classList.remove('act');
    if (!s.locked) this._drawStick(this.stickRest.x, this.stickRest.y, this.stickRest.x, this.stickRest.y);
  }

  // ── per frame: input from the stick, contextual buttons ─────────────
  update() {
    const g = this.game, I = this.input, p = g.player;
    if (!I || !p) return;
    const play = this.playing;
    const s = this.stick;
    if (play) {
      I.lastDevice = 'touch';
      let mx = 0, my = 0, sprint = false;
      if (s.locked) { my = 1; sprint = true; }
      else if (s.active) {
        const R = this.stickR;
        let dx = (s.x - s.ox) / R, dy = -(s.y - s.oy) / R;
        const m = Math.hypot(dx, dy);
        if (m > 0.12) {
          const mm = Math.min(1, (m - 0.12) / 0.88);
          mx = dx / m * mm; my = dy / m * mm;
          if (s.sprint) { mx = dx / m; my = dy / m; sprint = true; }
        }
      }
      I.setVirtualAxis('move', mx, my);
      const wantSpr = sprint;
      if (wantSpr !== I.isVirtualDown('Sprint')) I.virtualHold('Sprint', wantSpr);
      this.stickEl.classList.toggle('spr', sprint);
      // lock icon: visible while pushing up / sprinting; highlighted when the thumb is over it or locked
      const showLock = (s.active && (s.y - s.oy) < -this.stickR * 0.9) || s.locked;
      this.lockEl.classList.toggle('show', showLock);
      this.lockEl.classList.toggle('hot', s.lockHot);
      this.lockEl.classList.toggle('locked', s.locked);
      if (s.locked && !s.active) { const R = this.stickR; this._drawStick(s.ox || this.stickRest.x, s.oy || this.stickRest.y, s.ox || this.stickRest.x, (s.oy || this.stickRest.y) - R); this.stickEl.classList.add('act'); }
      // aim toggle survives only while it makes sense
      if (this.aimOn && (p.state !== 'free' || p.inWater)) { this.aimOn = false; I.virtualHold('Aim', false); }
      else if (this.aimOn && !I.isVirtualDown('Aim')) I.virtualHold('Aim', true);   // context switches clear virtual keys
      if (!this.aimOn && I.isVirtualDown('Aim')) I.virtualHold('Aim', false);
      if (this.fireHeld && !I.isVirtualDown('Fire')) I.virtualHold('Fire', true);
    } else {
      if (I.vMove.x || I.vMove.y) I.setVirtualAxis('move', 0, 0);
      this.lockEl.classList.remove('show');
    }
    this._context(play);
  }

  _context(play) {
    const g = this.game, p = g.player, c = g.combat, B = this.btn;
    const st = p.state;
    const free = play && st === 'free';
    const liftOpen = !!document.querySelector('.lift-ui.on');
    const vis = (id, v) => { const b = B[id]; if (b && b._v !== v) { b._v = v; b.classList.toggle('hide', !v); } };
    const armed = c && c.weaponId !== 'fists';
    vis('fire', free); vis('lfire', free && this.hud.settings.leftFire);
    vis('aim', free); vis('crouch', free); vis('fpv', play && st !== 'elevator');
    vis('jump', play && (st === 'free' || st === 'seated'));
    vis('surrender', free && !!c && (g.security?.heat ?? 0) > 0 || !!c?.surrendering);
    vis('reload', free && c?.weaponId === 'pistol');
    // icons that follow the state
    if (B.crouch) { B.crouch.classList.toggle('on', !!p.crouch); }
    if (B.aim) {
      B.aim.classList.toggle('on', this.aimOn);
      const blk = c && c.weaponId === 'fists';
      if (B.aim._blk !== blk) { B.aim._blk = blk; B.aim.innerHTML = (blk ? IC.block : IC.aim) + `<span class="lb">${blk ? 'Block' : 'Aim'}</span>`; }
    }
    if (B.fire) {
      const ico = armed ? (c.weaponId === 'pistol' ? 'fire' : c.weaponId) : 'fist';
      if (B.fire._ico !== ico) { B.fire._ico = ico; const svg = ico === 'fire' ? IC.fire : ico === 'fist' ? IC.fist : (IC['w_' + ico] || IC.fire); B.fire.innerHTML = svg; if (B.lfire) B.lfire.innerHTML = svg; }
    }
    if (B.reload && c) {
      const a = c.ammo?.pistol; const can = a && a.reserve > 0 && a.mag < 15 && !c.reloading;
      B.reload.classList.toggle('dim', !can);
    }
    if (B.surrender && c) {
      const fr = c.surrendering ? 1 : Math.min(1, (c.surrT || 0) / 0.8);
      const ring = B.surrender.querySelector('circle'); if (ring) ring.setAttribute('stroke-dasharray', `${(fr * 100.5).toFixed(1)} 200`);
      B.surrender.classList.toggle('on', !!c.surrendering);
    }
    // contextual interaction pills
    const ist = p.interaction;
    let best = play && !liftOpen ? ist?.best : null;
    const list = play && !liftOpen ? (g.interact?.current || []) : [];
    if (best && best.deck != null && best.deck !== p.deck) best = null;
    let alt = null;
    if (best && best.key === 'F') { alt = null; }
    else for (const it of list) { if (it.key === 'F' && it !== best && it.enabled !== false && !(it.hold > 0)) { alt = it; break; } }
    this._altIt = alt;
    this._pill(B.interact, best, ist?.holdT || 0, best?.key === 'F');
    this._pill(B.alt, alt, 0, true);
  }

  _pill(b, it, holdT, altStyle) {
    if (!b) return;
    if (!it) { if (b._v !== false) { b._v = false; b.classList.add('hide'); b._id = null; } return; }
    if (b._v !== true) { b._v = true; b.classList.remove('hide'); }
    const sub = it.enabled === false ? (it.reason || 'Unavailable') : it.hold > 0 ? 'Hold' : (it.crimePrompt ? 'Crime' : '');
    const key = it.id + '|' + it.label + '|' + sub;
    if (b._id !== key) {
      b._id = key;
      b.querySelector('b').textContent = it.label;
      b.querySelector('small').textContent = sub;
      b.querySelector('small').style.display = sub ? '' : 'none';
      const ic = b.querySelector('.ic'); const ring = ic.querySelector('.ring');
      ic.innerHTML = interactIcon(it); ic.appendChild(ring);
      b.classList.toggle('off', it.enabled === false);
      b.classList.toggle('alt', !!altStyle || !!it.crimePrompt);
    }
    const fr = it.hold > 0 ? Math.min(1, holdT / it.hold) : 0;
    const c = b.querySelector('.ring circle'); if (c && c._f !== fr) { c._f = fr; c.setAttribute('stroke-dasharray', `${(fr * 100.5).toFixed(1)} 200`); }
  }
}
