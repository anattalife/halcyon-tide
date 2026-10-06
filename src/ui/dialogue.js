// HALCYON TIDE — conversation UI. dialogue({speaker, portrait?, role?, lines, options}) → Promise<optionId|null>.
// Lines: strings or {speaker?, text}. Typewriter reveal (Space/Enter/click completes, then advances).
// Options: keys 1–4 (or arrows + Enter), mouse; disabled options show their hint and cannot be chosen.
import { el, esc } from './theme.js';

export class Dialogue {
  constructor(ui) {
    this.ui = ui;
    this.shade = el('div', 'dlgshade', null, ui.root);
    this.box = el('div', 'dlg', null, ui.root);
    this.box.style.display = 'none';
    this.active = null;
    this.queue = Promise.resolve();
    this.box.addEventListener('click', (e) => {
      if (!this.active) return;
      const op = e.target.closest('.op');
      if (op) { this.choose(+op.dataset.i); return; }
      this.advance();
    });
    this.box.addEventListener('mouseover', (e) => {
      const op = e.target.closest('.op'); if (!op || !this.active) return;
      const i = +op.dataset.i; if (i !== this.active.sel) { this.active.sel = i; this._sel(); this.ui.sfx('ui_hover'); }
    });
  }

  open(cfg) {
    const run = () => new Promise((resolve) => {
      const lines = (cfg.lines && cfg.lines.length ? cfg.lines : (cfg.text ? [cfg.text] : [])).map(l => (typeof l === 'string' ? { text: l } : l));
      this.active = { cfg, lines, li: -1, shown: 0, resolve, sel: 0, phase: 'lines', t: 0 };
      this.ui._dialogueBegin();
      this.box.style.display = '';
      requestAnimationFrame(() => { this.box.classList.add('on'); this.shade.classList.add('on'); });
      this._nextLine();
    });
    const p = this.queue.then(() => this.ui.whenPlaying()).then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  _who(name, portrait, role) {
    const ini = String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const pt = portrait ? `<div class="pt" style="background-image:url('${esc(portrait)}')"></div>` : `<div class="pt">${esc(ini)}</div>`;
    return `<div class="who">${pt}<div class="np"><b>${esc(name || '')}</b>${role ? `<span>${esc(role)}</span>` : ''}</div></div>`;
  }

  _nextLine() {
    const A = this.active; if (!A) return;
    A.li++;
    if (A.li >= A.lines.length) {
      const opts = A.cfg.options || [];
      if (!opts.length) { this._finish(null); return; }
      A.phase = 'options';
      this._render();
      return;
    }
    A.shown = 0; A.t = 0; A.phase = 'lines';
    A.last = A.li === A.lines.length - 1 && (A.cfg.options || []).length > 0;
    this._render();
    const L = A.lines[A.li];
    if (this.ui.settings.subtitles === false) { /* still show — dialogue box is the subtitle */ }
    this.ui.game.bus.emit('dialogue:line', { speaker: L.speaker || A.cfg.speaker, text: L.text, voice: L.voice || A.cfg.voice });
  }

  _render() {
    const A = this.active, cfg = A.cfg;
    const L = A.lines[Math.min(A.li, A.lines.length - 1)] || { text: '' };
    const speaker = (A.phase === 'lines' ? L.speaker : null) || cfg.speaker;
    const role = (A.phase === 'lines' ? L.role : null) || cfg.role || cfg.title || '';
    const opts = cfg.options || [];
    let h = this._who(speaker, L.portrait || cfg.portrait, role);
    h += `<div class="ln"></div>`;
    if (A.phase === 'options') {
      h += `<div class="opts">${opts.map((o, i) => `<button class="op ${o.enabled === false ? 'dis' : ''}" data-i="${i}" style="animation-delay:${i * 0.05}s"><span class="kc">${i + 1}</span><span>${esc(o.text)}</span>${o.hint ? `<span class="hn">${esc(o.hint)}</span>` : ''}</button>`).join('')}</div>`;
    } else {
      h += `<div class="more"><span class="kc">Space</span>Continue</div>`;
    }
    this.box.innerHTML = h;
    this.lnEl = this.box.querySelector('.ln');
    if (A.phase === 'options') {
      // keep the last line on screen above the options
      this.lnEl.textContent = L.text || '';
      A.sel = opts.findIndex(o => o.enabled !== false); if (A.sel < 0) A.sel = 0;
      this._sel();
    } else this._type();
  }
  _type() {
    const A = this.active; const L = A.lines[A.li];
    const n = Math.floor(A.shown);
    const full = L.text || '';
    if (n >= full.length) this.lnEl.textContent = full;
    else this.lnEl.innerHTML = esc(full.slice(0, n)) + '<span class="cur"></span>';
  }
  _sel() { const ops = this.box.querySelectorAll('.op'); ops.forEach((b, i) => b.classList.toggle('sel', i === this.active.sel)); }

  advance() {
    const A = this.active; if (!A || A.phase !== 'lines') return;
    const full = A.lines[A.li].text || '';
    if (A.shown < full.length) { A.shown = full.length; this._type(); if (A.last) this._nextLine(); return; }
    this.ui.sfx('ui_click');
    this._nextLine();
  }
  choose(i) {
    const A = this.active; if (!A || A.phase !== 'options') return;
    const o = (A.cfg.options || [])[i]; if (!o) return;
    if (o.enabled === false) { this.ui.sfx('ui_close'); if (o.hint) this.ui.toast(o.hint, { kind: 'warn' }); return; }
    this.ui.sfx('ui_click');
    this._finish(o.id ?? i);
  }
  cancel() { if (this.active) this._finish(null); }

  _finish(val) {
    const A = this.active; if (!A) return;
    this.active = null;
    this.box.classList.remove('on'); this.shade.classList.remove('on');
    setTimeout(() => { if (!this.active) this.box.style.display = 'none'; }, 300);
    this.ui._dialogueEnd();
    this.ui.game.bus.emit('dialogue:end', { speaker: A.cfg.speaker, choice: val });
    A.resolve(val);
  }

  update(dt) {
    const A = this.active; if (!A || A.phase !== 'lines' || !this.lnEl) return;
    const full = A.lines[A.li].text || '';
    if (A.shown < full.length) {
      A.shown = Math.min(full.length, A.shown + dt * 55);
      this._type();
      if (A.shown >= full.length && A.last) this._nextLine();
    } else if (A.last) {
      this._nextLine();
    } else if (A.cfg.auto) {
      A.t += dt;
      if (A.t > 1.2 + full.length * 0.04) this._nextLine();
    }
  }

  handleKey(code) {
    const A = this.active; if (!A) return false;
    if (A.phase === 'options') {
      const opts = A.cfg.options || [];
      const m = code.match(/^(?:Digit|Numpad)([1-9])$/);
      if (m) { this.choose(+m[1] - 1); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { A.sel = (A.sel + 1) % opts.length; this._sel(); this.ui.sfx('ui_hover'); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { A.sel = (A.sel - 1 + opts.length) % opts.length; this._sel(); this.ui.sfx('ui_hover'); return true; }
      if (code === 'Enter' || code === 'Space' || code === 'KeyE') { this.choose(A.sel); return true; }
      if (code === 'Escape' && A.cfg.cancelable !== false) { this.cancel(); return true; }
      return true;
    }
    if (code === 'Space' || code === 'Enter' || code === 'KeyE' || code === 'Mouse0') { this.advance(); return true; }
    if (code === 'Escape' && A.cfg.cancelable !== false && !(A.cfg.options || []).length) { this.cancel(); return true; }
    return true;
  }
}
