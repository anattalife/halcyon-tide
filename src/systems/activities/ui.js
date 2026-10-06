// Shared activity UI: self-contained DOM panels in #ui, used when game.ui is missing
// or when an activity needs a bespoke panel (casino tables, slots, shop). Everything here
// guards game.ui and provides a minimal fallback so activities work standalone.
import { fmt } from '../economy.js';

let injected = false;
const CSS = `
.act-scrim{position:fixed;inset:0;background:rgba(4,7,12,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);z-index:140;pointer-events:auto;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif}
.act-panel{width:min(760px,92vw);max-height:88vh;overflow:auto;background:linear-gradient(180deg,#141a24,#0d1118);border:1px solid #c9a45b55;border-radius:16px;box-shadow:0 30px 80px #000a;color:#ede6d6}
.act-panel.sm{width:min(460px,92vw)}
.act-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #ffffff14}
.act-head h2{font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:26px;margin:0;color:#f3ead7;letter-spacing:.01em}
.act-head .act-sub{font-size:12px;color:#9fb0c0;letter-spacing:.14em;text-transform:uppercase}
.act-bank{font-size:13px;color:#c9a45b;font-weight:600}
.act-x{pointer-events:auto;cursor:pointer;background:#ffffff12;border:none;color:#eee;width:30px;height:30px;border-radius:50%;font-size:16px;line-height:1}
.act-body{padding:16px 20px}
.act-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid #ffffff10;border-radius:10px;margin-bottom:8px;background:#ffffff06}
.act-row .nm{font-weight:600;color:#f1ece2}
.act-row .ds{font-size:12px;color:#9fb0c0;margin-top:2px}
.act-row .pr{color:#c9a45b;font-weight:700;white-space:nowrap}
.act-btn{pointer-events:auto;cursor:pointer;background:#c9a45b;color:#1a140a;border:none;border-radius:8px;padding:8px 16px;font:600 13px Inter,system-ui;letter-spacing:.02em}
.act-btn.ghost{background:#ffffff12;color:#eee}
.act-btn.red{background:#d65b4a;color:#fff}
.act-btn:disabled{opacity:.4;cursor:not-allowed}
.act-chips{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px}
.act-chip{pointer-events:auto;cursor:pointer;min-width:52px;text-align:center;padding:8px 10px;border-radius:8px;border:1px solid #ffffff22;background:#ffffff08;color:#eee;font-weight:600}
.act-chip.on{background:#c9a45b;color:#1a140a;border-color:#c9a45b}
.act-note{font-size:12px;color:#9fb0c0;margin:6px 0}
.act-flash{text-align:center;font-family:'Cormorant Garamond',serif;font-size:22px;color:#f3ead7;min-height:30px;margin:6px 0}
.act-flash.win{color:#7fd08a}.act-flash.lose{color:#d68a7a}
.act-grid{display:grid;gap:8px}
`;
function inject() { if (injected) return; injected = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

export function toast(game, text, kind = 'info') {
  if (game.ui?.toast) { game.ui.toast(text, { kind }); return; }
  game.bus?.emit('ui:toast', { text, kind });
  // own minimal fallback toast
  inject();
  const ui = document.getElementById('ui'); if (!ui) return;
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = `position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:150;padding:9px 18px;border-radius:18px;font:500 13px Inter,system-ui;letter-spacing:.03em;background:rgba(12,16,22,.85);color:${kind === 'bad' ? '#e89a88' : kind === 'good' ? '#9fe0ab' : kind === 'warn' ? '#e8c37a' : '#e6ddcc'};border:1px solid #ffffff20;pointer-events:none`;
  ui.appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .5s'; d.style.opacity = '0'; }, 1800);
  setTimeout(() => d.remove(), 2400);
}

// A controllable bespoke panel. Returns { el, body, setBank, close, onClose }.
export class Panel {
  constructor(game, { title, sub = '', small = false, bank = true } = {}) {
    inject();
    this.game = game;
    const ui = document.getElementById('ui') || document.body;
    const scrim = this.scrim = document.createElement('div');
    scrim.className = 'act-scrim';
    const panel = document.createElement('div');
    panel.className = 'act-panel' + (small ? ' sm' : '');
    panel.innerHTML = `<div class="act-head">
        <div><h2>${title}</h2>${sub ? `<div class="act-sub">${sub}</div>` : ''}</div>
        <div style="display:flex;align-items:center;gap:14px">${bank ? '<div class="act-bank"></div>' : ''}<button class="act-x" title="Close">✕</button></div>
      </div><div class="act-body"></div>`;
    scrim.appendChild(panel);
    ui.appendChild(scrim);
    this.el = panel;
    this.body = panel.querySelector('.act-body');
    this.bankEl = panel.querySelector('.act-bank');
    this._onClose = [];
    panel.querySelector('.act-x').onclick = () => this.close();
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) this.close(); });
    this._key = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    window.addEventListener('keydown', this._key, true);
    // take UI focus from the player controller
    this._prevCtx = game.input?.context;
    game.input?.setContext?.('ui');
    game.player?.lockControls?.(true);
    this.updateBank();
    game.bus?.emit('sfx', { name: 'ui_open', vol: 0.5 });
  }
  updateBank() {
    if (!this.bankEl) return;
    const e = this.game.economy;
    if (e) this.bankEl.textContent = `Cash ${fmt(e.cash)}  ·  Onboard ${fmt(e.credit)}`;
  }
  onClose(fn) { this._onClose.push(fn); return this; }
  close() {
    if (this._closed) return; this._closed = true;
    window.removeEventListener('keydown', this._key, true);
    this.scrim.remove();
    this.game.input?.setContext?.(this._prevCtx || 'play');
    this.game.player?.lockControls?.(false);
    this.game.bus?.emit('sfx', { name: 'ui_close', vol: 0.5 });
    for (const fn of this._onClose) { try { fn(); } catch (e) { console.error(e); } }
  }
}

// chip selector helper: returns element; calls onPick(value)
export function chipRow(values, initial, onPick) {
  const wrap = document.createElement('div'); wrap.className = 'act-chips';
  let cur = initial;
  const btns = [];
  for (const v of values) {
    const b = document.createElement('button'); b.className = 'act-chip' + (v === cur ? ' on' : ''); b.textContent = fmt(v);
    b.onclick = () => { cur = v; for (const x of btns) x.classList.toggle('on', x === b); onPick(v); };
    btns.push(b); wrap.appendChild(b);
  }
  wrap.value = () => cur;
  return wrap;
}
