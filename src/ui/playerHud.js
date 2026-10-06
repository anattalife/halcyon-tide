// HALCYON TIDE — player HUD: interaction prompt (key cap + label, hold radial), crosshair while aiming,
// stamina/health arcs (only shown when not full), pointer-lock hint. DOM in #ui, self-styled.
import * as THREE from 'three';

const CSS = `
.ph-prompt{position:fixed;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;gap:10px;padding:7px 14px 7px 7px;
  background:rgba(10,14,20,.62);border:1px solid rgba(255,255,255,.12);border-radius:22px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  font:500 14px/1 Inter,system-ui,sans-serif;color:#f1ece2;letter-spacing:.02em;white-space:nowrap;opacity:0;transition:opacity .18s;pointer-events:none;z-index:20}
.ph-prompt.on{opacity:1}
.ph-prompt.cut{transition:none}
.ph-prompt.off{color:#8d939b}
.ph-prompt .ph-key{position:relative;width:28px;height:28px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;
  background:#f1ece2;color:#11161d;font:700 12px/1 Inter,system-ui,sans-serif}
.ph-prompt.off .ph-key{background:#59606a;color:#1a1e24}
.ph-prompt .ph-key svg{position:absolute;inset:-4px;width:36px;height:36px;transform:rotate(-90deg)}
.ph-prompt .ph-key circle{fill:none;stroke:#c9a45b;stroke-width:3;stroke-linecap:round}
.ph-prompt .ph-reason{font-size:12px;color:#c98a72;margin-left:2px}
.ph-prompt .ph-hold{font-size:11px;color:#9aa3ad;margin-left:2px}
.ph-cross{position:fixed;left:50%;top:50%;width:22px;height:22px;transform:translate(-50%,-50%);opacity:0;transition:opacity .15s;pointer-events:none;z-index:19}
.ph-cross.on{opacity:.9}
.ph-cross i{position:absolute;background:#fff;box-shadow:0 0 2px #000a}
.ph-cross i:nth-child(1){left:10px;top:0;width:2px;height:7px}.ph-cross i:nth-child(2){left:10px;bottom:0;width:2px;height:7px}
.ph-cross i:nth-child(3){top:10px;left:0;height:2px;width:7px}.ph-cross i:nth-child(4){top:10px;right:0;height:2px;width:7px}
.ph-dot{position:fixed;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:#fff;opacity:0;pointer-events:none;z-index:19;box-shadow:0 0 2px #000}
.ph-dot.on{opacity:.55}
.ph-vitals{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);display:flex;gap:6px;flex-direction:column;align-items:center;pointer-events:none;z-index:18}
.ph-bar{width:150px;height:3px;background:rgba(255,255,255,.14);border-radius:2px;overflow:hidden;opacity:0;transition:opacity .4s}
.ph-bar.on{opacity:1}
.ph-bar i{display:block;height:100%;width:100%;background:#e9e2d3;transform-origin:left;transition:background .3s}
.ph-bar.hp i{background:#d65b4a}
.ph-bar.low i{background:#c9a45b}
.ph-hint{position:fixed;left:50%;bottom:30%;transform:translateX(-50%);padding:9px 16px;border-radius:18px;background:rgba(10,14,20,.55);
  font:500 13px/1 Inter,system-ui,sans-serif;color:#d9d3c7;letter-spacing:.04em;opacity:0;transition:opacity .4s;pointer-events:none;z-index:18}
.ph-hint.on{opacity:1}
.ph-dmg{position:fixed;inset:0;pointer-events:none;z-index:17;opacity:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(150,10,10,.55) 100%);transition:opacity .25s}
`;

export class PlayerHud {
  constructor(game) {
    this.game = game;
    const ui = document.getElementById('ui') || document.body;
    if (!document.getElementById('ph-style')) { const s = document.createElement('style'); s.id = 'ph-style'; s.textContent = CSS; document.head.appendChild(s); }
    const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; ui.appendChild(d); return d; };
    this.prompt = el('ph-prompt', `<div class="ph-key"><span>E</span><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" stroke-dasharray="0 200"/></svg></div><span class="ph-label"></span><span class="ph-reason"></span><span class="ph-hold"></span>`);
    this.pKey = this.prompt.querySelector('.ph-key span');
    this.pRing = this.prompt.querySelector('circle');
    this.pLabel = this.prompt.querySelector('.ph-label');
    this.pReason = this.prompt.querySelector('.ph-reason');
    this.pHold = this.prompt.querySelector('.ph-hold');
    this.cross = el('ph-cross', '<i></i><i></i><i></i><i></i>');
    this.dot = el('ph-dot');
    this.vitals = el('ph-vitals', '<div class="ph-bar hp"><i></i></div><div class="ph-bar st"><i></i></div>');
    this.hpBar = this.vitals.querySelector('.hp'); this.hpFill = this.hpBar.querySelector('i');
    this.stBar = this.vitals.querySelector('.st'); this.stFill = this.stBar.querySelector('i');
    this.hint = el('ph-hint', 'Click to look around');
    this.dmg = el('ph-dmg');
    this._v = new THREE.Vector3();
    this._last = { id: null, label: '', key: '', enabled: null, reason: '' };
    this._px = innerWidth / 2; this._py = innerHeight * 0.72;
    this._dmgA = 0;
    this._hintT = 0;
    this.visible = true;
    game.bus.on?.('player:damage', (e) => { this._dmgA = Math.min(1, this._dmgA + e.amount / 25); });
    // stale prompts (QA #23): a teleport / deck change / load invalidates whatever was targeted — clear at once
    this._suppress = 0;
    const cut = () => { this.clearPrompt(); this._suppress = 0.25; };
    for (const ev of ['player:teleport', 'player:deck', 'save:loaded', 'player:revive']) game.bus.on?.(ev, cut);
    // "Click to look around": once the pointer has been locked this session the player knows — never show it again
    this._everLocked = false;
    game.bus.on?.('input:lock', (on) => { if (on) { this._everLocked = true; this.hint.classList.remove('on'); } });
  }

  // hide the interaction prompt immediately (no fade) and forget the current target
  clearPrompt() {
    const ist = this.game.player?.interaction;
    if (ist) { ist.best = null; ist.holdT = 0; }
    this.prompt.classList.add('cut'); this.prompt.classList.remove('on');
    this._last.id = null;
  }
  // is the interaction still a valid target for the player right now?
  _valid(it, p) {
    if (!it) return false;
    if (it.deck != null && it.deck !== p.deck) return false;
    if (it.x != null && it.z != null) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d > (it.range ?? 2.2) + 1.2) return false;
      if (it.y != null && Math.abs(it.y - p.y) > 3.2) return false;
    }
    return true;
  }

  setVisible(v) { this.visible = v; for (const e of [this.prompt, this.cross, this.dot, this.vitals, this.hint]) e.style.display = v ? '' : 'none'; }

  update(dt, ist) {
    const g = this.game, p = g.player; if (!p) return;
    const input = g.input;
    const play = input && input.context === 'play' && !g.paused && !g.debugCam;
    // ── prompt ─────────────────────────────────────────────────────────
    if (this._suppress > 0) this._suppress -= dt;
    let it = play && this._suppress <= 0 ? ist.best : null;
    if (it && !this._valid(it, p)) { ist.best = null; it = null; }
    if (it) {
      this.prompt.classList.remove('cut');
      const L = this._last;
      const keyTxt = it.key === 'E' || !it.key ? (input?.keyLabel('Interact') || 'E') : it.key === 'F' ? (input?.keyLabel('AltInteract') || 'F') : it.key;
      if (L.id !== it.id || L.label !== it.label || L.enabled !== it.enabled || L.reason !== it.reason || L.key !== keyTxt) {
        this.pKey.textContent = keyTxt;
        this.pLabel.textContent = it.label;
        this.pReason.textContent = it.enabled === false && it.reason ? '· ' + it.reason : '';
        this.pHold.textContent = it.hold > 0 && it.enabled !== false ? 'hold' : '';
        this.prompt.classList.toggle('off', it.enabled === false);
        Object.assign(L, { id: it.id, label: it.label, enabled: it.enabled, reason: it.reason, key: keyTxt });
      }
      const frac = it.hold > 0 ? Math.min(1, ist.holdT / it.hold) : 0;
      this.pRing.setAttribute('stroke-dasharray', `${(frac * 100.5).toFixed(1)} 200`);
      // position: projected near the target, clamped to the lower-middle band; fallback bottom centre
      let tx = innerWidth / 2, ty = innerHeight * 0.74;
      if (it.x != null && g.camera) {
        this._v.set(it.x, it.y ?? p.y + 1.1, it.z).project(g.camera);
        if (this._v.z < 1 && Math.abs(this._v.x) < 1.2 && Math.abs(this._v.y) < 1.2) {
          tx = (this._v.x * 0.5 + 0.5) * innerWidth; ty = (-this._v.y * 0.5 + 0.5) * innerHeight;
          tx = Math.max(innerWidth * 0.3, Math.min(innerWidth * 0.7, tx));
          ty = Math.max(innerHeight * 0.38, Math.min(innerHeight * 0.8, ty + 34));
        }
      }
      const k = 1 - Math.exp(-14 * dt);
      if (!this.prompt.classList.contains('on')) { this._px = tx; this._py = ty; }
      this._px += (tx - this._px) * k; this._py += (ty - this._py) * k;
      this.prompt.style.transform = `translate(${this._px.toFixed(1)}px,${this._py.toFixed(1)}px) translate(-50%,-50%)`;
      this.prompt.classList.add('on');
    } else if (this.prompt.classList.contains('on')) {
      // no current interaction: hide now (a fading "Open door" after walking away / teleporting reads as stale)
      this.prompt.classList.add('cut'); this.prompt.classList.remove('on'); this._last.id = null;
    }

    // ── crosshair ──────────────────────────────────────────────────────
    const aimOn = play && p.aiming && g.cameraRig?.aimK > 0.6;
    this.cross.classList.toggle('on', !!aimOn);
    this.dot.classList.toggle('on', !!(play && !aimOn && g.cameraRig?.mode === 'first'));

    // ── vitals (fade in only when relevant) ────────────────────────────
    const hp = p.health / 100, st = p.stamina / (p.T?.staminaMax || 100);
    this.hpBar.classList.toggle('on', play && hp < 0.999);
    this.hpFill.style.transform = `scaleX(${hp.toFixed(3)})`;
    this.stBar.classList.toggle('on', play && st < 0.995);
    this.stBar.classList.toggle('low', p.exhausted);
    this.stFill.style.transform = `scaleX(${st.toFixed(3)})`;

    // ── damage vignette ────────────────────────────────────────────────
    this._dmgA = Math.max(hp < 0.35 ? (0.35 - hp) * 1.6 : 0, this._dmgA - dt * 0.9);
    this.dmg.style.opacity = this._dmgA.toFixed(3);

    // ── pointer lock hint ──────────────────────────────────────────────
    if (input?.pointerLocked || input?.everLocked) this._everLocked = true;
    const automated = typeof navigator !== 'undefined' && navigator.webdriver;
    const needLock = input && input.context === 'play' && !input.pointerLocked && !this._everLocked && !automated && !input._debug && !g.debugCam && input.lastDevice !== 'pad' && !g.paused;
    this._hintT = needLock ? this._hintT + dt : 0;
    this.hint.classList.toggle('on', this._hintT > 0.6);
  }
}
