// HALCYON TIDE — title screen with a slow cinematic camera around the ship at sea.
// While active: game.debugCam = true (the camera rig leaves the camera alone), input context 'ui', HUD hidden,
// player controls locked. New Game / Continue hands control back (debugCam = false) with a fade.
import * as THREE from 'three';
import { TIME } from '../core/config.js';
import { el, esc, ICON, fmtClock, cleanName } from './theme.js';

const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeSoft = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

// Shots in ship space (x bow, y up, z starboard). from/to: [px,py,pz, lx,ly,lz]
const SHOTS = [
  { dur: 17, from: [300, 9, 150, 70, 20, 0], to: [215, 13, 95, 40, 20, 0] },          // bow three-quarter, pushing in
  { dur: 19, from: [-260, 7, 250, -150, 22, 0], to: [20, 8, 250, 140, 22, 0] },       // low tracking along the starboard side
  { dur: 20, orbit: { a0: 2.55, a1: 1.65, r0: 360, r1: 320, h0: 135, h1: 95, look: [0, 14, 0] } },   // high aerial orbit
  { dur: 17, from: [-345, 26, -70, -130, 22, 0], to: [-270, 19, -96, -70, 22, 0] },   // astern, over the wake
  { dur: 18, from: [110, 72, -160, 60, 34, 0], to: [-20, 70, -165, -40, 32, 0] },        // along the upper decks past the bridge
];

export class TitleScreen {
  constructor(ui) {
    this.ui = ui; this.game = ui.game;
    this.active = false;
    this._p = new THREE.Vector3(); this._l = new THREE.Vector3(); this._focus = new THREE.Vector3();
  }

  show({ initial = false } = {}) {
    const ui = this.ui, g = this.game;
    this.active = true; ui.titleActive = true;
    this._prev = { debugCam: g.debugCam, minutes: g.minutes };
    g.debugCam = true;
    // golden hour on the title
    this._titleMinutes = Math.floor(g.minutes / 1440) * 1440 + 18.15 * 60;
    g.minutes = this._titleMinutes;
    this.t = 0; this.shot = 0; this.cutT = -1;
    const hasSave = !!g.save?.hasSave?.();
    const latest = hasSave ? g.save.latest() : -1;
    const inf = latest >= 0 ? g.save.info(latest) : null;
    const root = this.root = el('div', 'title' + (initial ? '' : ' go'), null, ui.root);
    root.innerHTML = `<div class="vig"></div>
      <div class="lft">
        <div class="brand">LARKSPUR OCEANIC PRESENTS</div>
        <div class="logo">Halcyon Tide</div>
        <div class="sublogo">AN ATLANTIC CROSSING</div>
        <div class="rule"></div>
        <div class="tag">Seventeen decks. Seven thousand souls. One way off.</div>
        <div class="menu">
          ${hasSave ? `<button class="mi" data-k="continue">Continue<small>${esc(inf ? (inf.label || '') + ' · Day ' + ((inf.day ?? 0) + 1) + ', ' + fmtClock(((inf.minutes ?? 0) / 60) % 24) : '')}</small></button>` : ''}
          <button class="mi" data-k="new">New voyage</button>
          <button class="mi" data-k="settings">Settings</button>
          <button class="mi" data-k="credits">Credits</button>
        </div>
      </div>
      <div class="credits"><h2>Credits</h2>
        <p><b>An original game</b>Halcyon Tide — open-world action aboard a life-size 330-metre cruise ship.</p>
        <p><b>The ship</b>MS Halcyon Tide of the Larkspur Oceanic line is entirely fictional. Any resemblance to real vessels or operators is coincidental.</p>
        <p><b>Built with</b>Three.js · Web Audio · plain ES modules</p>
        <p><b>Typefaces</b>Cormorant Garamond · Inter</p>
        <button class="btn ghost" data-k="back" style="margin-top:1.2em">Back</button>
      </div>
      <div class="card"><div class="k">Now sailing</div><div class="v">New York → Southampton</div><div class="s">330 m · 17 decks · 19.5 knots</div></div>
      <div class="foot"><span>© Larkspur Oceanic Interactive</span><span>Best experienced with headphones</span></div>`;
    this.btns = [...root.querySelectorAll('.menu .mi')];
    this.sel = 0; this._hl();
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) this.act(b.dataset.k); });
    root.addEventListener('mouseover', (e) => { const b = e.target.closest('.menu .mi'); if (b) { const i = this.btns.indexOf(b); if (i !== this.sel) { this.sel = i; this._hl(); ui.sfx('ui_hover'); } } });
    ui._refresh();
  }
  _hl() { this.btns.forEach((b, i) => b.classList.toggle('sel', i === this.sel)); }

  act(k) {
    const ui = this.ui, g = this.game;
    try { g.audio?.unlock?.(); } catch {}
    ui.sfx('ui_click');
    if (k === 'credits') { this.root.classList.add('cr'); return; }
    if (k === 'back') { this.root.classList.remove('cr'); return; }
    if (k === 'settings') { ui.openPanel('settings'); return; }
    if (k === 'new') {
      if (this._fresh === false) {   // after quit-to-title the world is dirty: restart cleanly
        try { sessionStorage.setItem('ht.skipTitle', '1'); } catch {}
        ui.fade(true, 700).then(() => location.reload());
        return;
      }
      this.start(() => { g.bus.emit('game:newGame', {}); }, true);
      return;
    }
    if (k === 'continue') {
      const n = g.save?.latest?.() ?? -1;
      this.start(() => { if (n >= 0) g.save.loadSlot(n); g.bus.emit('game:continue', { slot: n }); }, false);
    }
  }

  start(before, isNew) {
    const ui = this.ui, g = this.game;
    if (this._leaving) return; this._leaving = true;
    ui.fade(true, 900).then(() => {
      this.hide();
      g.minutes = this._prev.minutes;
      before?.();
      g.debugCam = false;
      g.cameraRig?.snap?.(g.player?.yaw);
      ui._refresh();
      for (let i = 0; i < 2; i++) try { g.step?.(1 / 60); } catch {}
      ui.fade(false, 1400);
      if (isNew) setTimeout(() => ui.showTitle('Embarkation Day', 'Day 1 · Atlantic crossing'), 900);
      else { const p = g.player; setTimeout(() => ui.toast(`Welcome back${p?.room ? ' · ' + cleanName(p.room.name) : ''}`, { kind: 'info' }), 600); }
      this._leaving = false;
    });
  }

  hide() {
    if (!this.active) return;
    this.active = false; this.ui.titleActive = false;
    this.root?.remove(); this.root = null;
    if (this.game.focus === this._focus) this.game.focus = null;
  }

  handleKey(code) {
    if (!this.active || this.ui.panel) return false;
    if (this.root.classList.contains('cr')) { if (code === 'Escape' || code === 'Enter' || code === 'Backspace') { this.root.classList.remove('cr'); return true; } return true; }
    if (code === 'ArrowDown' || code === 'KeyS') { this.sel = (this.sel + 1) % this.btns.length; this._hl(); this.ui.sfx('ui_hover'); return true; }
    if (code === 'ArrowUp' || code === 'KeyW') { this.sel = (this.sel - 1 + this.btns.length) % this.btns.length; this._hl(); this.ui.sfx('ui_hover'); return true; }
    if (code === 'Enter' || code === 'Space') { this.act(this.btns[this.sel].dataset.k); return true; }
    return true;
  }

  // camera — call every frame (realDt)
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    if (this.root && !this.root.classList.contains('go') && g.frame > 2 && !document.querySelector('.loader:not(.done)')) {
      this._goAt ??= performance.now() + 900;
      if (performance.now() >= this._goAt) {
        this.root.classList.add('go');
        // safety net: never leave the menu invisible if CSS animations are throttled
        const r = this.root;
        setTimeout(() => { if (r.isConnected) for (const a of r.getAnimations?.({ subtree: true }) || []) try { if (a.playState !== 'finished' && a.currentTime < 100) a.finish(); } catch {} }, 5000);
      }
    }
    g.debugCam = true;
    this.t += dt;
    let S = SHOTS[this.shot];
    if (this.t > S.dur) {
      this.t -= S.dur; this.shot = (this.shot + 1) % SHOTS.length; S = SHOTS[this.shot];
    }
    // dip to black around cuts
    const edge = Math.min(this.t, S.dur - this.t);
    const dip = edge < 0.9 ? 1 - edge / 0.9 : 0;
    this.ui.setDip(dip);
    const k = easeSoft(Math.min(1, this.t / S.dur));
    if (S.orbit) {
      const o = S.orbit, a = o.a0 + (o.a1 - o.a0) * k, r = o.r0 + (o.r1 - o.r0) * k, h = o.h0 + (o.h1 - o.h0) * k;
      this._p.set(Math.cos(a) * r, h, Math.sin(a) * r);
      this._l.set(o.look[0], o.look[1], o.look[2]);
    } else {
      const f = S.from, to = S.to;
      this._p.set(f[0] + (to[0] - f[0]) * k, f[1] + (to[1] - f[1]) * k, f[2] + (to[2] - f[2]) * k);
      this._l.set(f[3] + (to[3] - f[3]) * k, f[4] + (to[4] - f[4]) * k, f[5] + (to[5] - f[5]) * k);
    }
    // gentle handheld drift
    const tt = performance.now() / 1000;
    this._p.y += Math.sin(tt * 0.31) * 0.6; this._p.x += Math.sin(tt * 0.17) * 0.8;
    const cam = g.camera;
    cam.position.copy(this._p);
    cam.up.set(0, 1, 0);
    cam.lookAt(this._l);
    cam.rotateY(0.14 * Math.min(1, innerWidth / innerHeight / 1.5));   // subject sits right of the menu column
    cam.rotateZ(Math.sin(tt * 0.23) * 0.006);
    if (cam.fov !== 42) { cam.fov = 42; cam.updateProjectionMatrix(); }
    this._focus.copy(this._l);
    g.focus = this._focus;
    // keep the clock at golden hour
    g.minutes = this._titleMinutes + (this.t + this.shot * 18) * 0.02;
  }
}
