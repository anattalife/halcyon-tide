// HALCYON TIDE — security & combat HUD (self-contained; the UI workstream may absorb it).
//   top-centre: heat — five ship's-wheel icons + status + "Wanted: <description>" (+ "description no longer matches")
//   below it:   suspicion eye (fills while someone is getting suspicious of you)
//   bottom-right: weapon card (icon, name, ammo / taser charge / extinguisher charge, reload bar)
//   world-space: "?" / "!" over guards, phone / radio progress over reporting witnesses, eye over the suspicious watcher
//   centre: hit markers; radio feed (bottom-left above whatever is there), PA banner, toasts, fade, busted card,
//   CCTV monitor overlay (scanlines, timestamp, camera id, controls), fallback dialogue box when game.ui is missing.
import * as THREE from 'three';
import { WEAPONS } from '../systems/weapons.js';

const CSS = `
.sh-root{position:fixed;inset:0;pointer-events:none;z-index:21;font:500 13px/1.25 Inter,system-ui,sans-serif;color:#f1ece2}
.sh-heat{position:absolute;left:50%;top:14px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;opacity:0;transition:opacity .35s}
.sh-heat.on{opacity:1}
.sh-wheels{display:flex;gap:6px;padding:5px 10px;border-radius:16px;background:rgba(10,14,20,.55);border:1px solid rgba(255,255,255,.08)}
.sh-wheel{width:22px;height:22px;opacity:.38;transition:opacity .25s,transform .25s}
.sh-wheel svg *{stroke:#9aa3ad}
.sh-wheel svg{width:100%;height:100%}
.sh-wheel.on{opacity:1}
.sh-wheel.on svg *{stroke:#e8b04a}
.sh-heat.flash .sh-wheel.on{animation:shpulse .6s ease-in-out infinite alternate}
.sh-heat.lost .sh-wheel.on svg *{stroke:#9aa3ad}
@keyframes shpulse{from{transform:scale(1)}to{transform:scale(1.15)}}
.sh-status{font:700 11px/1 Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#e8b04a;text-shadow:0 1px 3px #000}
.sh-heat.lost .sh-status{color:#c3c9cf}
.sh-wanted{max-width:520px;text-align:center;font-size:12px;color:#e9dccb;text-shadow:0 1px 3px #000;padding:2px 10px;border-radius:10px;background:rgba(10,14,20,.42)}
.sh-wanted b{color:#ffcf7a;font-weight:600}
.sh-wanted i{color:#9fd39b;font-style:normal}
.sh-eye{position:absolute;left:50%;top:16px;transform:translateX(-50%);width:44px;height:26px;opacity:0;transition:opacity .25s,left .3s}
.sh-eye.on{opacity:1}
.sh-eye svg{width:100%;height:100%;overflow:visible}
.sh-weapon{position:absolute;right:24px;bottom:26px;min-width:150px;padding:9px 13px;border-radius:12px;background:rgba(10,14,20,.6);border:1px solid rgba(255,255,255,.1);
  display:flex;align-items:center;gap:11px;opacity:0;transition:opacity .3s}
.sh-weapon.on{opacity:1}
.sh-wicon{width:34px;height:34px;flex:none}
.sh-wicon svg{width:100%;height:100%}
.sh-wname{font:600 12px/1.1 Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#d9d3c7}
.sh-wammo{font:700 20px/1.1 Inter,system-ui,sans-serif;color:#fff;font-variant-numeric:tabular-nums}
.sh-wammo small{font-size:12px;color:#9aa3ad;font-weight:500}
.sh-wbar{height:3px;margin-top:4px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden}
.sh-wbar i{display:block;height:100%;background:#e8b04a;transform-origin:left}
.sh-wslots{display:flex;gap:4px;margin-top:5px}
.sh-wslots span{font:600 10px/1 Inter,system-ui,sans-serif;padding:2px 4px;border-radius:3px;background:rgba(255,255,255,.08);color:#7d858e}
.sh-wslots span.have{color:#d9d3c7}.sh-wslots span.cur{background:#e8b04a;color:#111}
.sh-ind{position:absolute;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;display:flex;align-items:center;justify-content:center;font:800 20px/1 Inter,system-ui,sans-serif;text-shadow:0 0 4px #000,0 1px 2px #000}
.sh-ind svg{position:absolute;inset:0;width:30px;height:30px;transform:rotate(-90deg)}
.sh-ind svg circle{fill:rgba(10,14,20,.55);stroke-width:3}
.sh-ind span{position:relative}
.sh-hit{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;opacity:0}
.sh-hit i{position:absolute;width:9px;height:2px;background:#fff;box-shadow:0 0 2px #000}
.sh-hit i:nth-child(1){left:0;top:4px;transform:rotate(45deg)}.sh-hit i:nth-child(2){right:0;top:4px;transform:rotate(-45deg)}
.sh-hit i:nth-child(3){left:0;bottom:4px;transform:rotate(-45deg)}.sh-hit i:nth-child(4){right:0;bottom:4px;transform:rotate(45deg)}
.sh-hit.head i{background:#ffcf7a}.sh-hit.ko i{background:#8fd0ff}.sh-hit.kill i{background:#ff5a4a}
.sh-radio{position:absolute;left:24px;bottom:300px;width:330px;display:flex;flex-direction:column;gap:4px}
.sh-radio div{padding:4px 9px 4px 24px;border-radius:8px;background:rgba(14,22,30,.6);border-left:3px solid #6fa8d8;color:#dfe8ef;font-size:11.5px;position:relative;transition:opacity .6s}
.sh-radio div:before{content:'';position:absolute;left:9px;top:50%;width:8px;height:8px;margin-top:-4px;border-radius:50%;background:#6fa8d8;box-shadow:0 0 6px #6fa8d8}
.sh-pa{position:absolute;left:50%;top:150px;transform:translateX(-50%);max-width:640px;padding:8px 16px;border-radius:10px;background:rgba(60,14,10,.7);border:1px solid rgba(255,120,90,.4);
  color:#ffe3d6;font-size:13px;text-align:center;opacity:0;transition:opacity .4s}
.sh-pa.on{opacity:1}
.sh-pa b{display:block;font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:.2em;color:#ff9a7a;margin-bottom:4px}
.sh-toast{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center}
.sh-toast div{padding:8px 14px;border-radius:10px;background:rgba(10,14,20,.72);border:1px solid rgba(255,255,255,.12);max-width:560px;text-align:center;transition:opacity .5s}
.sh-toast div.bad{border-color:rgba(232,96,74,.55)}.sh-toast div.good{border-color:rgba(143,208,140,.55)}
.sh-fade{position:fixed;inset:0;background:#000;opacity:0;transition:opacity 1s;pointer-events:none;z-index:40}
.sh-busted{position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);font:600 64px/1 'Cormorant Garamond',Georgia,serif;letter-spacing:.12em;color:#f1ece2;opacity:0;transition:opacity .6s;z-index:41;text-shadow:0 2px 20px #000}
.sh-busted.on{opacity:1}
.sh-outcome{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:85;opacity:0;transition:opacity .5s;pointer-events:none;font-family:Inter,system-ui,sans-serif;color:#f1ece2;text-shadow:0 2px 14px #000}
.sh-outcome.on{opacity:1}
.sh-outcome h1{font:600 72px/1 'Cormorant Garamond',Georgia,serif;letter-spacing:.14em;margin:0 0 8px}
.sh-outcome.busted h1{color:#f1ece2}.sh-outcome.medical h1{color:#ff8f7a}
.sh-outcome .sub{font:600 12px/1 Inter,system-ui,sans-serif;letter-spacing:.34em;text-transform:uppercase;color:#c9a45b;margin-bottom:22px}
.sh-outcome ul{list-style:none;margin:0;padding:14px 22px;max-width:620px;border-top:1px solid rgba(201,164,91,.5);border-bottom:1px solid rgba(201,164,91,.5)}
.sh-outcome li{font-size:15px;line-height:1.55;margin:4px 0;text-align:center}
.sh-busted small{display:block;font:500 14px/1.4 Inter,system-ui,sans-serif;letter-spacing:.3em;text-align:center;margin-top:10px;color:#c9a45b}
.sh-title{position:fixed;left:50%;top:30%;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity .8s;z-index:41;max-width:640px}
.sh-title.on{opacity:1}
.sh-title h2{margin:0;font:600 46px/1.1 'Cormorant Garamond',Georgia,serif;color:#ff9a7a;letter-spacing:.08em;text-shadow:0 2px 18px #000}
.sh-title p{font-size:14px;color:#f1ece2;text-shadow:0 1px 6px #000}
.sh-cctv{position:fixed;inset:0;pointer-events:none;z-index:30;opacity:0;transition:opacity .2s}
.sh-cctv.on{opacity:1}
.sh-cctv .shc-scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px);mix-blend-mode:multiply}
.sh-cctv .shc-tint{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(40,90,60,.05) 40%,rgba(0,0,0,.75) 100%);box-shadow:inset 0 0 120px rgba(0,0,0,.8)}
.sh-cctv .shc-tint.off{background:#0b0d0e}
.sh-cctv .shc-noise{position:absolute;inset:0;opacity:.07;background-size:256px 256px}
.sh-cctv .shc-hdr{position:absolute;left:28px;top:22px;font:600 15px/1.35 'Courier New',monospace;color:#d8f5dc;text-shadow:0 0 4px #000;letter-spacing:.06em}
.sh-cctv .shc-rec{color:#ff4a3a}
.sh-cctv .shc-ts{position:absolute;right:28px;top:22px;font:600 15px/1.35 'Courier New',monospace;color:#d8f5dc;text-align:right}
.sh-cctv .sh-ctl{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);font:500 12px/1.4 Inter,system-ui,sans-serif;color:#cfe6d2;background:rgba(0,0,0,.55);padding:8px 14px;border-radius:8px;white-space:nowrap}
.sh-cctv .sh-ctl b{color:#fff;background:rgba(255,255,255,.15);padding:1px 5px;border-radius:3px;margin:0 2px}
.sh-cctv .shc-msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:700 26px/1 'Courier New',monospace;color:#d8f5dc;letter-spacing:.2em}
.sh-dlg{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);width:560px;padding:16px 18px;border-radius:14px;background:rgba(10,14,20,.86);border:1px solid rgba(201,164,91,.35);
  pointer-events:auto;z-index:35;display:none}
.sh-dlg.on{display:block}
.sh-dlg h4{margin:0 0 6px;font:700 11px/1 Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#c9a45b}
.sh-dlg p{margin:0 0 10px;font-size:14px;color:#f1ece2}
.sh-dlg button{display:block;width:100%;text-align:left;margin:4px 0;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#f1ece2;font:500 13px Inter,system-ui,sans-serif;cursor:pointer}
.sh-dlg button:hover{background:rgba(201,164,91,.18)}
.sh-dlg button:disabled{opacity:.4;cursor:default}
.sh-dlg button small{color:#9aa3ad;margin-left:8px}
.sh-surr{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);font-size:12px;color:#d9d3c7;background:rgba(10,14,20,.55);padding:5px 12px;border-radius:12px;opacity:0;transition:opacity .3s}
.sh-surr.on{opacity:1}
`;
const WHEEL = `<svg viewBox="-12 -12 24 24"><circle r="6.2" fill="none" stroke="#fff" stroke-width="1.8"/><circle r="1.8" fill="none" stroke="#fff" stroke-width="1.6"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(k => { const a = k * Math.PI / 4, c = Math.cos(a), s = Math.sin(a); return `<line x1="${(c * 1.8).toFixed(2)}" y1="${(s * 1.8).toFixed(2)}" x2="${(c * 10.5).toFixed(2)}" y2="${(s * 10.5).toFixed(2)}" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>`; }).join('')}</svg>`;
const EYE = `<svg viewBox="0 0 44 26"><defs><clipPath id="sheye"><path d="M2 13 Q22 -6 42 13 Q22 32 2 13Z"/></clipPath></defs>
<path d="M2 13 Q22 -6 42 13 Q22 32 2 13Z" fill="rgba(10,14,20,.6)" stroke="#f1ece2" stroke-width="1.6"/>
<g clip-path="url(#sheye)"><rect class="fill" x="0" y="26" width="44" height="26" fill="#e8b04a"/></g>
<circle cx="22" cy="13" r="4.6" fill="none" stroke="#f1ece2" stroke-width="1.6"/><circle cx="22" cy="13" r="1.8" fill="#f1ece2"/></svg>`;
const WICON = {
  fists: `<svg viewBox="0 0 34 34"><path d="M9 17v-5a2 2 0 0 1 4 0v4-6a2 2 0 0 1 4 0v6-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v8c0 5-3 8-8 8h-1c-4 0-7-3-7-7z" fill="none" stroke="#f1ece2" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  baton: `<svg viewBox="0 0 34 34"><line x1="7" y1="28" x2="27" y2="6" stroke="#f1ece2" stroke-width="3.4" stroke-linecap="round"/><line x1="10" y1="19" x2="15" y2="24" stroke="#f1ece2" stroke-width="2"/></svg>`,
  taser: `<svg viewBox="0 0 34 34"><path d="M5 11h20l3 3v3H15l-2 9H8l2-9H5z" fill="none" stroke="#f1ece2" stroke-width="1.8" stroke-linejoin="round"/><path d="M27 5l-3 4h3l-3 4" fill="none" stroke="#ffd36a" stroke-width="1.6"/></svg>`,
  pistol: `<svg viewBox="0 0 34 34"><path d="M4 10h25v5H17l-1 2h-3l-2 10H6l2-12H4z" fill="none" stroke="#f1ece2" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  extinguisher: `<svg viewBox="0 0 34 34"><rect x="11" y="10" width="11" height="19" rx="4" fill="none" stroke="#ff7a62" stroke-width="1.8"/><path d="M14 10V6h5v4M19 7h6l3 3" fill="none" stroke="#f1ece2" stroke-width="1.6"/></svg>`,
};
const IND = { '?': ['?', '#ffd36a'], '!': ['!', '#ff5a4a'], phone: ['☎', '#8fd0ff'], radio: ['⌁', '#8fd0ff'], eye: ['◉', '#e8b04a'], blind: ['✶', '#cfe6ff'] };

export class SecurityHud {
  constructor(game, sec) {
    this.game = game; this.sec = sec;
    if (!document.getElementById('sh-style')) { const s = document.createElement('style'); s.id = 'sh-style'; s.textContent = CSS; document.head.appendChild(s); }
    const ui = document.getElementById('ui') || document.body;
    const root = this.root = document.createElement('div'); root.className = 'sh-root'; ui.appendChild(root);
    const el = (cls, html = '', parent = root) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; parent.appendChild(d); return d; };
    this.heatEl = el('sh-heat', `<div class="sh-wheels">${'<div class="sh-wheel">' + WHEEL + '</div>'.repeat(1)}</div><div class="sh-status"></div><div class="sh-wanted"></div>`);
    const wh = this.heatEl.querySelector('.sh-wheels'); wh.innerHTML = Array.from({ length: 5 }, () => `<div class="sh-wheel">${WHEEL}</div>`).join('');
    this.wheels = [...wh.children]; this.statusEl = this.heatEl.querySelector('.sh-status'); this.wantedEl = this.heatEl.querySelector('.sh-wanted');
    this.eye = el('sh-eye', EYE); this.eyeFill = this.eye.querySelector('.fill');
    this.wcard = el('sh-weapon', `<div class="sh-wicon"></div><div style="flex:1"><div class="sh-wname"></div><div class="sh-wammo"></div><div class="sh-wbar"><i></i></div><div class="sh-wslots"></div></div>`);
    this.wIcon = this.wcard.querySelector('.sh-wicon'); this.wName = this.wcard.querySelector('.sh-wname'); this.wAmmo = this.wcard.querySelector('.sh-wammo');
    this.wBar = this.wcard.querySelector('.sh-wbar'); this.wBarI = this.wBar.querySelector('i'); this.wSlots = this.wcard.querySelector('.sh-wslots');
    this.indLayer = el('sh-ind-layer'); this.inds = [];
    this.hit = el('sh-hit', '<i></i><i></i><i></i><i></i>'); this.hitT = 0;
    this.radioEl = el('sh-radio'); this.radioLines = [];
    this.paEl = el('sh-pa'); this.paT = 0;
    this.toastEl = el('sh-toast');
    this.surrEl = el('sh-surr', 'Hands up — guards will cuff you. Move or press <b>H</b> to stop.');
    this.fadeEl = document.createElement('div'); this.fadeEl.className = 'sh-fade'; document.body.appendChild(this.fadeEl);
    this.bustedEl = document.createElement('div'); this.bustedEl.className = 'sh-busted'; this.bustedEl.innerHTML = 'DETAINED<small>SHIP\'S SECURITY</small>'; document.body.appendChild(this.bustedEl);
    this.outcomeEl = document.createElement('div'); this.outcomeEl.className = 'sh-outcome'; document.body.appendChild(this.outcomeEl);
    this.titleEl = document.createElement('div'); this.titleEl.className = 'sh-title'; document.body.appendChild(this.titleEl);
    this.cctvEl = el('sh-cctv', `<div class="shc-tint"></div><div class="shc-noise"></div><div class="shc-scan"></div><div class="shc-hdr"></div><div class="shc-ts"></div><div class="shc-msg"></div>
      <div class="sh-ctl"><b>A</b>/<b>D</b> camera · <b>W</b>/<b>S</b> deck · <b>L</b> loop this deck's feed · <b>X</b> wipe recordings · <b>E</b> exit</div>`, document.body);
    this.cctvEl.querySelector('.shc-noise').style.backgroundImage = `url(${this._noise()})`;
    this.dlg = el('sh-dlg', '', document.body);
    this._v = new THREE.Vector3(); this._ind = [];
    this.lastLevel = 0; this.flashT = 0; this.visible = true;
  }
  _noise() { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const d = g.createImageData(128, 128); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); return c.toDataURL(); }
  setVisible(v) { this.visible = v; this.root.style.display = v ? '' : 'none'; }

  update(dt) {
    const g = this.game, sec = this.sec, p = g.player; if (!p) return;
    dt = Math.min(0.1, dt || 0.016);
    const play = (!g.debugCam || sec.cctv.active) && !sec.cctv.active;
    this.root.style.display = this.visible && !sec.cctv.active ? '' : 'none';
    // heat
    const lvl = sec.heat;
    if (lvl !== this.lastLevel) { if (lvl > this.lastLevel) this.flashT = 2.5; this.lastLevel = lvl; }
    this.flashT = Math.max(0, this.flashT - dt);
    const on = lvl > 0 && play && !sec._arresting && !sec._reviving && p.state !== 'arrested';
    this.heatEl.classList.toggle('on', on);
    this.heatEl.classList.toggle('flash', this.flashT > 0 || (sec.seen && lvl >= 2));
    this.heatEl.classList.toggle('lost', on && !sec.seen && sec.lostT > 3);
    for (let i = 0; i < 5; i++) this.wheels[i].classList.toggle('on', i < lvl);
    if (on) {
      const st = sec.status + (sec.seen ? '' : sec.lostT > 3 ? ' · searching' : '');
      if (this.statusEl.textContent !== st) this.statusEl.textContent = st;
      const desc = sec.description;
      let html = desc ? `Wanted: <b>${desc.text}</b>` : 'Security is investigating';
      if (desc && !sec.known) html += ' · <i>you no longer match</i>';
      if (sec._camLock && sec.seen) html += ' · <b style="color:#ff7a62">● ON CAMERA</b>';
      if (this.wantedEl.innerHTML !== html) this.wantedEl.innerHTML = html;
    }
    // suspicion eye
    const s = sec.suspicion;
    this.eye.classList.toggle('on', play && s > 0.02);
    this.eye.style.left = on ? 'calc(50% + 112px)' : '50%';
    this.eyeFill.setAttribute('y', (26 - 26 * s).toFixed(1));
    this.eyeFill.setAttribute('fill', s > 0.75 ? '#ff5a4a' : '#e8b04a');
    // weapon card
    const c = g.combat;
    if (c) {
      const w = c.weapon, id = c.weaponId;
      const showW = play && (id !== 'fists' || p.aiming || c.blocking || this._wT > 0);
      if (this._wid !== id) { this._wid = id; this._wT = 2.5; this.wIcon.innerHTML = WICON[id] || ''; this.wName.textContent = w.name; }
      this._wT = Math.max(0, (this._wT || 0) - dt);
      this.wcard.classList.toggle('on', showW);
      let ammo = '', bar = null;
      if (id === 'pistol') { const a = c.ammo.pistol; const inv = (c.inv?.count?.('pistol_ammo') || 0) * WEAPONS.pistol.mag; ammo = `${a.mag}<small> / ${a.reserve + inv}</small>`; if (c.reloading) bar = 1 - c.reloadT / WEAPONS.pistol.reload; }
      else if (id === 'taser') { ammo = c.taserReadyIn > 0 ? `<small>charging</small>` : 'READY'; bar = 1 - c.taserReadyIn / WEAPONS.taser.reload; }
      else if (id === 'extinguisher') { ammo = `${Math.round(c.extCharge)}<small>%</small>`; bar = c.extCharge / 100; }
      else if (c.blocking) ammo = '<small>blocking</small>';
      else ammo = `<small>stamina ${Math.round(p.stamina)}</small>`;
      if (this._ammo !== ammo) { this._ammo = ammo; this.wAmmo.innerHTML = ammo; }
      this.wBar.style.display = bar == null ? 'none' : '';
      if (bar != null) this.wBarI.style.transform = `scaleX(${Math.max(0, Math.min(1, bar)).toFixed(3)})`;
      const slots = ['fists', 'baton', 'taser', 'pistol', 'extinguisher'].map((k, i) => `<span class="${k === id ? 'cur' : c.owned(k) ? 'have' : ''}">${i + 1}</span>`).join('');
      if (this._slots !== slots) { this._slots = slots; this.wSlots.innerHTML = slots; }
      this.surrEl.classList.toggle('on', !!c.surrendering);
    }
    // indicators
    this._indicators(play);
    // hit marker
    if (this.hitT > 0) { this.hitT -= dt; this.hit.style.opacity = Math.max(0, this.hitT / 0.35).toFixed(2); this.hit.style.transform = `scale(${1 + (0.35 - this.hitT)})`; }
    // radio fade
    const now = performance.now();
    for (const r of this.radioLines) { const age = (now - r.t) / 1000; r.el.style.opacity = age > 7 ? Math.max(0, 1 - (age - 7) / 1.5).toFixed(2) : '1'; }
    while (this.radioLines.length && (now - this.radioLines[0].t) / 1000 > 9) { this.radioLines.shift().el.remove(); }
    if (this.paT > 0) { this.paT -= dt; if (this.paT <= 0) this.paEl.classList.remove('on'); }
    // CCTV overlay
    if (sec.cctv.active) this._cctvFrame();
  }

  _indicators(play) {
    const g = this.game, ai = this.sec.ai;
    const list = play && ai ? ai.indicators(this._ind) : [];
    while (this.inds.length < list.length) {
      const d = document.createElement('div'); d.className = 'sh-ind';
      d.innerHTML = '<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="12" stroke-dasharray="0 100"/></svg><span></span>';
      this.indLayer.appendChild(d); this.inds.push({ el: d, ring: d.querySelector('circle'), span: d.querySelector('span'), icon: null });
    }
    const W = innerWidth, H = innerHeight;
    for (let i = 0; i < this.inds.length; i++) {
      const I = this.inds[i], o = list[i];
      if (!o) { if (I.el.style.display !== 'none') I.el.style.display = 'none'; continue; }
      this._v.set(o.x, o.y, o.z).project(g.camera);
      if (this._v.z > 1 || Math.abs(this._v.x) > 1.1 || Math.abs(this._v.y) > 1.1) { I.el.style.display = 'none'; continue; }
      I.el.style.display = '';
      const [ch, col] = IND[o.icon] || ['?', '#fff'];
      if (I.icon !== o.icon) { I.icon = o.icon; I.span.textContent = ch; I.span.style.color = col; I.ring.style.stroke = col; }
      I.ring.setAttribute('stroke-dasharray', `${(o.k * 75.4).toFixed(1)} 100`);
      I.el.style.transform = `translate(${((this._v.x * 0.5 + 0.5) * W).toFixed(1)}px,${((-this._v.y * 0.5 + 0.5) * H).toFixed(1)}px)`;
      I.el.style.opacity = o.icon === '?' ? (0.45 + 0.55 * o.k).toFixed(2) : '1';
    }
  }

  hitMarker(kind = 'hit') { this.hit.className = 'sh-hit ' + kind; this.hitT = 0.35; }
  radio(text) {
    const d = document.createElement('div'); d.textContent = text; this.radioEl.appendChild(d);
    this.radioLines.push({ el: d, t: performance.now() });
    while (this.radioLines.length > 3) this.radioLines.shift().el.remove();
  }
  pa(text) { this.paEl.innerHTML = `<b>SHIP'S ANNOUNCEMENT</b>${text}`; this.paEl.classList.add('on'); this.paT = 7; }
  toast(text, kind = 'info', ms = 4000) {
    if (this.game.ui?.toast) return;
    const d = document.createElement('div'); d.className = kind; d.textContent = text; this.toastEl.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 600); }, ms);
    while (this.toastEl.children.length > 3) this.toastEl.firstChild.remove();
  }
  fade(on, ms = 1000) {
    this.fadeEl.style.transition = `opacity ${ms}ms`;
    this.fadeEl.style.opacity = on ? '1' : '0';
    return new Promise(r => setTimeout(r, ms + 30));
  }
  busted(on) { this.bustedEl.classList.toggle('on', !!on); }
  // full-screen outcome card over the fade: outcome('BUSTED'|'MEDICAL EMERGENCY', sub, [lines], 'busted'|'medical'); outcome(null) hides
  outcome(title, sub = '', lines = [], kind = '') {
    const el = this.outcomeEl; if (!el) return;
    if (!title) { el.classList.remove('on'); return; }
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    el.className = 'sh-outcome ' + kind;
    el.innerHTML = `<h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div><ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
    void el.offsetWidth; el.classList.add('on');
  }
  clearRadio() { for (const r of this.radioLines) r.el.remove(); this.radioLines.length = 0; this.paEl.classList.remove('on'); this.paT = 0; }
  title(h, p) { this.titleEl.innerHTML = `<h2>${h}</h2><p>${p}</p>`; this.titleEl.classList.add('on'); clearTimeout(this._titleT); this._titleT = setTimeout(() => this.titleEl.classList.remove('on'), 7000); }

  // fallback dialogue (when game.ui.dialogue is not available)
  dialogue(o) {
    return new Promise((resolve) => {
      const g = this.game;
      this._dlgResolve = resolve;
      this.dlg.innerHTML = `<h4>${o.speaker || ''}</h4>${(o.lines || []).map(l => `<p>${l}</p>`).join('')}`;
      (o.options || []).forEach((op, i) => {
        const b = document.createElement('button'); b.disabled = op.enabled === false;
        b.innerHTML = `${i + 1}. ${op.text}${op.hint ? `<small>${op.hint}</small>` : ''}`;
        b.onclick = () => this.closeDialogue(op.id);
        this.dlg.appendChild(b);
      });
      this.dlg.classList.add('on');
      this._dlgOpts = o.options || [];
      try { g.input?.setContext?.('ui'); } catch {}
      this._dlgKey = (e) => { const k = parseInt(e.key, 10); const op = this._dlgOpts[k - 1]; if (op && op.enabled !== false) this.closeDialogue(op.id); if (e.key === 'Escape') this.closeDialogue('flee'); };
      window.addEventListener('keydown', this._dlgKey);
      clearTimeout(this._dlgTO); this._dlgTO = setTimeout(() => this.closeDialogue('flee'), 25000);
    });
  }
  closeDialogue(id = null) {
    if (!this._dlgResolve) return;
    const r = this._dlgResolve; this._dlgResolve = null;
    this.dlg.classList.remove('on'); window.removeEventListener('keydown', this._dlgKey); clearTimeout(this._dlgTO);
    try { this.game.input?.setContext?.('play'); } catch {}
    r(id);
  }

  // ── CCTV ──────────────────────────────────────────────────────────────
  cctv(on) { this.cctvEl.classList.toggle('on', !!on); }
  cctvInfo(api) { this._cctvDirty = true; }
  _cctvFrame() {
    const sec = this.sec, c = sec.cctv.camera, g = this.game; if (!c) return;
    const hdr = this.cctvEl.querySelector('.shc-hdr'), ts = this.cctvEl.querySelector('.shc-ts'), msg = this.cctvEl.querySelector('.shc-msg'), tint = this.cctvEl.querySelector('.shc-tint');
    const live = sec.cameraLive(c);
    const looped = sec.feedLooped(c.deck);
    const idx = sec.cameras.filter(k => k.deck === c.deck).indexOf(c) + 1;
    const h = `<span class="shc-rec">${live ? (looped ? '◼ LOOP' : '● REC') : '✕ NO SIGNAL'}</span> CAM ${String(c.deck).padStart(2, '0')}-${String(idx).padStart(2, '0')}<br>DECK ${c.deck} · ${(c.roomName || '').toUpperCase()}<br>${sec.feedLooped(c.deck) ? 'FEED LOOPED' : ''}`;
    if (hdr.innerHTML !== h) hdr.innerHTML = h;
    const m = g.minutes; const hh = Math.floor((m / 60) % 24), mm = Math.floor(m % 60), sss = Math.floor((m * 60) % 60);
    ts.innerHTML = `DAY ${String((g.day ?? 0) + 1).padStart(2, '0')}<br>${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(sss).padStart(2, '0')}`;
    const m2 = live ? '' : 'NO SIGNAL'; if (msg.textContent !== m2) msg.textContent = m2;
    tint.classList.toggle('off', !live);
    this.cctvEl.querySelector('.shc-noise').style.backgroundPosition = `${(Math.random() * 256) | 0}px ${(Math.random() * 256) | 0}px`;
  }
}
