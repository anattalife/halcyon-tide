// HALCYON TIDE — in-game HUD: objective + checklist, waypoint chip, clock/day, cash/credit, location,
// minimap (pre-rendered deck bitmaps blitted & rotated at ~20 Hz), subtitles, toasts, phone notifications,
// in-world objective/waypoint markers (projected, clamped to screen edges), FPS.
import * as THREE from 'three';
import { deckY } from '../core/config.js';
import { el, esc, ICON, fmtMoney, fmtClock, cleanName, deckName, distanceHint, targetDeck } from './theme.js';
import { deckBitmap, BMP } from './deckArt.js';

const TAU = Math.PI * 2;
const MM_RADIUS = 30;       // metres shown from centre to rim
const MM_PPM = 8;           // bitmap pixels per metre

export class Hud {
  constructor(ui) {
    this.ui = ui; const g = this.game = ui.game;
    const root = this.root = el('div', 'hud', null, ui.root);
    // top-left: objective + waypoint chip
    const tl = this.tl = el('div', 'tl', null, root);
    this.obj = el('div', 'obj off sh', `<div class="k">Current objective</div><div class="t"></div><div class="x"></div><ul></ul><div class="d">${ICON.arrow}<span></span></div>`, tl);
    this.oT = this.obj.querySelector('.t'); this.oX = this.obj.querySelector('.x'); this.oUl = this.obj.querySelector('ul'); this.oD = this.obj.querySelector('.d');
    this.oDs = this.oD.querySelector('span'); this.oDa = this.oD.querySelector('svg');
    this.wp = el('div', 'wpchip off', `${ICON.pin}<span>Waypoint</span><b></b>`, tl);
    this.wpL = this.wp.querySelector('span'); this.wpB = this.wp.querySelector('b');
    // top-right
    const tr = el('div', 'tr sh', null, root);
    this.clock = el('div', 'clock num', '', tr);
    this.day = el('div', 'day', '', tr);
    this.cash = el('div', 'cash num', '', tr);
    this.credit = el('div', 'credit num', '', tr);
    // heat is shown by src/ui/securityHud.js (wheels + status); the HUD only reacts to it (toast placement)
    // minimap
    this.mm = el('div', 'mm', `<canvas></canvas><div class="deckb">DECK 9</div>`, root);
    this.mmC = this.mm.querySelector('canvas'); this.mmX = this.mmC.getContext('2d');
    this.mmDeck = this.mm.querySelector('.deckb');
    this.mmC.style.inset = '0'; this.mmC.style.width = '14em'; this.mmC.style.height = '14em';
    this.loc = el('div', 'loc sh', `<div class="r"></div><div class="dn"></div><div class="dis"></div>`, root);
    this.locR = this.loc.querySelector('.r'); this.locD = this.loc.querySelector('.dn'); this.locDis = this.loc.querySelector('.dis');
    this.fps = el('div', 'fps', '', root); this.fps.style.display = 'none';
    // lift ride progress (attached to the left of the elevators.js car panel while riding)
    this.lift = el('div', 'liftp', `<div class="lh"><span class="ld"></span><i class="la"></i><span class="lt"></span></div><div class="lb"><i></i></div><div class="le"></div>`, root);
    this.liftD = this.lift.querySelector('.ld'); this.liftA = this.lift.querySelector('.la'); this.liftT = this.lift.querySelector('.lt');
    this.liftB = this.lift.querySelector('.lb i'); this.liftE = this.lift.querySelector('.le');
    this._ride = null;
    // world markers
    this.wmLayer = el('div', 'wml', null, root);
    this.wmObj = el('div', 'wm off', `<div class="g">${ICON.star}</div><div class="l"></div>`, this.wmLayer);
    this.wmWp = el('div', 'wm wp off', `<div class="g">${ICON.pin}</div><div class="l"></div>`, this.wmLayer);
    // always-visible layers (outside .hud so they survive HUD hide where appropriate)
    this.subs = el('div', 'subs', null, ui.root);
    this.toasts = el('div', 'toasts', null, ui.root);
    this.notes = el('div', 'notes', null, ui.root);
    this.saving = el('div', 'saving', `${ICON.save}<span>Saving</span>`, ui.root);

    this._last = {};
    this._mmT = 0; this._fpsT = 0; this._fpsN = 0;
    this._v = new THREE.Vector3();
    this._cash = null; this._cashT = 0;
    this._heat = 0; this._heatT = 0;
    this.visible = true;
  }

  set(key, elx, val, prop = 'textContent') { if (this._last[key] !== val) { this._last[key] = val; elx[prop] = val; } }

  setVisible(v) { if (this.visible !== v) { this.visible = v; this.root.classList.toggle('hide', !v); } }

  // ── objective rendering ─────────────────────────────────────────────
  renderObjective(o) {
    this.obj.classList.toggle('off', !o);
    if (!o) return;
    this.oT.textContent = o.title || '';
    this.oX.textContent = o.text || '';
    this.oX.style.display = o.text ? '' : 'none';
    this.oUl.innerHTML = (o.steps || []).map(s => `<li class="${s.done ? 'done' : ''}"><i>${s.done ? ICON.check : ''}</i><span>${esc(s.text)}</span></li>`).join('');
    this._last.oD = null;
  }

  // ── toasts / notifications / subtitles ──────────────────────────────
  toast(text, opts = {}) {
    const kind = opts.kind || 'info';
    // de-duplicate identical consecutive toasts
    const lastT = this.toasts.lastElementChild;
    if (lastT && lastT._text === text && !lastT.classList.contains('out')) { clearTimeout(lastT._tm); lastT._tm = setTimeout(() => this._out(lastT), opts.ms || 3200); return lastT; }
    const t = el('div', 'toast ' + kind, `<i></i><span>${esc(text)}</span>`, this.toasts);
    t._text = text;
    while (this.toasts.children.length > 4) this.toasts.firstElementChild.remove();
    t._tm = setTimeout(() => this._out(t), opts.ms || (kind === 'mission' ? 4500 : 3200));
    return t;
  }
  _out(n) { n.classList.add('out'); setTimeout(() => n.remove(), 420); }
  notify(title, body, opts = {}) {
    const g = this.game;
    const icon = opts.icon ? (ICON[opts.icon] || esc(opts.icon)) : ICON.msg;
    const n = el('div', 'note', `<div class="ic">${icon}</div><div class="bd"><div class="tt">${esc(title)}<span>${fmtClock(g.hour)}</span></div><div class="tx">${esc(body || '')}</div></div>`, this.notes);
    while (this.notes.children.length > 3) this.notes.firstElementChild.remove();
    setTimeout(() => this._out(n), opts.ms || 6500);
    return n;
  }
  subtitle(text, speaker, ms, opts = {}) {
    if (!text) return null;
    if (!this.ui.settings.subtitles && !opts.force) return null;
    let n;
    if (opts.pa) n = el('div', 'sub pa', `<div class="h">${ICON.pa}<span>${esc(speaker || 'Bridge announcement')}</span></div><div class="tx">${esc(text)}</div>`, this.subs);
    else n = el('div', 'sub', `${speaker ? `<b>${esc(speaker)}</b>` : ''}${esc(text)}`, this.subs);
    while (this.subs.children.length > 3) this.subs.firstElementChild.remove();
    const dur = ms || Math.min(11000, 2200 + text.length * 55);
    setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 420); }, dur);
    return n;
  }
  showSaving() { this.saving.classList.add('on'); clearTimeout(this._svT); this._svT = setTimeout(() => this.saving.classList.remove('on'), 1800); }

  // ── per frame ───────────────────────────────────────────────────────
  update(dt, realDt) {
    const g = this.game, ui = this.ui, p = g.player;
    // FPS
    if (ui.settings.showFps) {
      this._fpsN++; this._fpsT += realDt;
      if (this._fpsT > 0.5) { this.fps.textContent = Math.round(this._fpsN / this._fpsT) + ' fps'; this._fpsN = 0; this._fpsT = 0; }
      this.fps.style.display = '';
    } else this.fps.style.display = 'none';
    if (!this.visible || !p) { this.wmObj.classList.add('off'); this.wmWp.classList.add('off'); return; }

    // clock / day
    this.set('clock', this.clock, fmtClock(g.hour));
    this.set('day', this.day, `Day ${g.day + 1} at sea`);
    // cash
    const cash = g.economy?.cash ?? p.money ?? 0;
    if (this._cash != null && cash !== this._cash) {
      this.cash.classList.remove('up', 'down'); void this.cash.offsetWidth;
      this.cash.classList.add(cash > this._cash ? 'up' : 'down'); this._cashT = 1.6;
    }
    this._cash = cash;
    if (this._cashT > 0) { this._cashT -= realDt; if (this._cashT <= 0) this.cash.classList.remove('up', 'down'); }
    this.set('cash', this.cash, fmtMoney(cash));
    const cr = g.economy?.credit;
    this.set('credit', this.credit, cr != null ? `Onboard account ${fmtMoney(cr)}` : '');
    // heat (displayed by securityHud.js): keep toasts clear of its panel
    const heat = Math.max(0, Math.min(5, Math.round(g.security?.heat ?? 0)));
    this._heat = heat;
    this.toasts.classList.toggle('low', heat > 0 && !!g.security?.hud);
    // location
    const room = p.room;
    let rn = room ? cleanName(room.name || room.type) : (p.inWater ? 'Overboard' : 'Open deck');
    if (p.state === 'elevator') rn = 'Elevator';
    if (/^Stairs/.test(rn)) rn = 'Stairwell';
    this.set('locR', this.locR, rn);
    this.set('locD', this.locD, `Deck ${p.deck} · ${deckName(p.deck)}`);
    const dis = p.disguise ? 'Disguised · ' + p.disguise.replace(/^crew_/, '').replace(/_/g, ' ') : '';
    this.set('locDis', this.locDis, dis);
    this.set('mmDeck', this.mmDeck, 'DECK ' + p.deck);

    // objective distance & waypoint chip
    const o = ui.objective;
    const t = o?.target;
    this.oD.style.display = t ? '' : 'none';
    if (t) { this.set('oDs', this.oDs, (t.label ? t.label + ' · ' : '') + distanceHint(p, t)); this.oDa.style.transform = `rotate(${this._relAngle(t).toFixed(2)}rad)`; }
    const wp = ui.waypoint;
    if (wp) {
      if (targetDeck(wp, p) === p.deck && Math.hypot(wp.x - p.x, wp.z - p.z) < 4) { ui.setWaypoint(null); this.toast('Waypoint reached', { kind: 'good' }); }
      else { this.set('wpL', this.wpL, wp.label || 'Waypoint'); this.set('wpB', this.wpB, distanceHint(p, wp)); }
    }
    this.wp.classList.toggle('off', !ui.waypoint);

    // world markers
    this._marker(this.wmObj, t, t ? (t.label || o.title) : '');
    this._marker(this.wmWp, ui.waypoint, ui.waypoint ? (ui.waypoint.label || 'Waypoint') : '');

    this._liftUpdate();

    // minimap @ ~20 Hz
    this._mmT -= realDt;
    if (this._mmT <= 0) { this._mmT = 0.05; this.drawMinimap(); }
  }

  // ── lift progress: "DECK 11 ▲ 15", fill bar from boarding deck to destination, ETA ──
  _liftUpdate() {
    const g = this.game, p = g.player;
    const car = p.state === 'elevator' && p.elevator ? g.elevators?.car?.(p.elevator) : null;
    const moving = !!(car && car.moving && Number.isFinite(car.target));
    if (!moving) {
      if (this._ride) { this._ride = null; this.lift.classList.remove('on'); }
      return;
    }
    const ty = deckY(car.target);
    if (!this._ride || this._ride.car !== car.id || this._ride.to !== car.target) this._ride = { car: car.id, to: car.target, y0: this._ride?.car === car.id ? this._ride.y0 : car.y };
    const R = this._ride;
    const span = Math.abs(ty - R.y0) || 1;
    const k = Math.max(0, Math.min(1, 1 - Math.abs(ty - car.y) / span));
    const cur = Math.max(1, Math.min(17, Math.round((car.y + 6) / 3) + 1));
    this.set('liftD', this.liftD, String(cur));
    this.set('liftA', this.liftA, car.v > 0.02 ? '▲' : car.v < -0.02 ? '▼' : '');
    this.set('liftT', this.liftT, String(car.target));
    this.liftB.style.transform = `scaleX(${k.toFixed(3)})`;
    // remaining time (trapezoidal profile, same constants as elevators.js: 2.5 m/s, 0.8 m/s²)
    const dist = Math.abs(ty - car.y), v = Math.abs(car.v || 0);
    const secs = dist < 0.05 ? 0 : (v * v / 1.6 >= dist ? (2 * dist) / Math.max(0.3, v) : dist / 2.5 + (2.5 - v) ** 2 / 3.2 + 1.56);
    this.set('liftE', this.liftE, secs > 0.6 ? `Deck ${car.target} · ${deckName(car.target)} · ${Math.ceil(secs)} s` : `Arriving · Deck ${car.target}`);
    const panel = document.querySelector('.lift-ui.on');
    if (panel) {
      const r = panel.getBoundingClientRect();
      this.lift.style.left = ''; this.lift.style.right = `${Math.round(innerWidth - r.left + 12)}px`; this.lift.style.top = `${Math.round(r.top)}px`;
    } else { this.lift.style.right = '2.2em'; this.lift.style.top = '40%'; }
    this.lift.classList.add('on');
  }

  _camYaw() { return this.game.cameraRig?.yaw ?? this.game.player.yaw; }
  // relative screen angle (radians, 0 = straight ahead/up) from camera heading to the target
  _relAngle(t) {
    const p = this.game.player; const yaw = this._camYaw();
    const dx = t.x - p.x, dz = t.z - p.z;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // right vector (screen right) for forward (sin, cos): camera right = (-cos, sin)?  forward × up → derive from rig: right = (-fz, fx)
    const rx = -fz, rz = fx;
    return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
  }

  _marker(node, t, label) {
    const g = this.game, p = g.player;
    if (!t || !g.camera) { node.classList.add('off'); return; }
    const y = deckY(targetDeck(t, p)) + 1.4;
    const v = this._v.set(t.x, y, t.z).project(g.camera);
    const W = innerWidth, H = innerHeight;
    let sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
    const behind = v.z > 1;
    const m = 48 * (this.ui.scale || 1);
    let edge = false;
    if (behind || sx < m || sx > W - m || sy < m || sy > H - m) {
      edge = true;
      // direction from screen centre
      let dx = sx - W / 2, dy = sy - H / 2;
      if (behind) { dx = -dx; dy = -dy; if (Math.abs(dy) < 1 && Math.abs(dx) < 1) dy = 1; }
      const a = Math.atan2(dy, dx);
      const kx = (W / 2 - m) / Math.max(1e-3, Math.abs(Math.cos(a))), ky = (H / 2 - m) / Math.max(1e-3, Math.abs(Math.sin(a)));
      const k = Math.min(kx, ky);
      sx = W / 2 + Math.cos(a) * k; sy = H / 2 + Math.sin(a) * k;
    }
    node.classList.remove('off');
    node.classList.toggle('edge', edge);
    const d = distanceHint(p, t);
    const key = label + '|' + d;
    if (node._k !== key) { node._k = key; node.querySelector('.l').textContent = (label ? label + ' · ' : '') + d; }
    node.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-100%)`;
  }

  // ── minimap ─────────────────────────────────────────────────────────
  drawMinimap() {
    const g = this.game, p = g.player, ui = this.ui;
    const c = this.mmC, ctx = this.mmX;
    const css = c.clientWidth || 180;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const Wp = Math.round(css * dpr);
    if (c.width !== Wp) { c.width = Wp; c.height = Wp; }
    const mmK = Math.max(1, css / 180);    // glyph scale with the minimap size (≥ 1 so text never shrinks below legible)
    const W = Wp, R = W / 2, ring = W * 0.062, rIn = R - ring;     // inner radius for map content
    const scale = rIn / MM_RADIUS;    // px per metre
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    const plan = g.world?.plans?.[p.deck] || g.layout?.plans?.[p.deck];
    const rot = ui.settings.mmRotate ? this._camYaw() - Math.PI : -Math.PI / 2;
    // disc background (sea)
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, rIn, 0, TAU); ctx.closePath();
    const grd = ctx.createRadialGradient(R, R, rIn * 0.2, R, R, rIn);
    grd.addColorStop(0, '#0f2236'); grd.addColorStop(1, '#081420');
    ctx.fillStyle = grd; ctx.fill();
    ctx.clip();
    // map content
    ctx.translate(R, R); ctx.rotate(rot); ctx.scale(scale, scale); ctx.translate(-p.x, -p.z);
    if (plan) {
      const bmp = deckBitmap(plan, MM_PPM);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.96;
      ctx.drawImage(bmp, BMP.x0, BMP.z0, BMP.w, BMP.h);
      ctx.globalAlpha = 1;
    }
    // NPC dots
    const npcs = g.npcs?.query?.(p.deck, p.x, p.z, MM_RADIUS * 1.45);
    if (npcs) {
      const s = 1 / scale;
      for (const n of npcs) {
        const sec = n.role === 'security' || n.job === 'guard' || n.job === 'patrol';
        const alerted = (n.alert ?? 0) > 0.55 || n.state === 'respond' || n.state === 'chase' || n.state === 'flee';
        const mission = n.kind === 'mission';
        if (!sec && !alerted && !mission && n.state === 'dead') continue;
        ctx.beginPath();
        const r = (sec || alerted || mission ? 3.6 : 2.2) * dpr * s;
        ctx.arc(n.x, n.z, r, 0, TAU);
        ctx.fillStyle = alerted ? '#ff5a45' : sec ? '#5aa9ff' : mission ? '#e6c784' : 'rgba(241,236,226,.42)';
        ctx.fill();
        if (sec && !alerted && n.perception) {
          // little facing tick for guards
          ctx.strokeStyle = 'rgba(90,169,255,.6)'; ctx.lineWidth = 1.2 * dpr * s;
          ctx.beginPath(); ctx.moveTo(n.x, n.z); ctx.lineTo(n.x + Math.sin(n.yaw) * r * 2.6, n.z + Math.cos(n.yaw) * r * 2.6); ctx.stroke();
        }
      }
    }
    ctx.restore();

    // markers: map markers, waypoint, objective (in screen space; clamp to rim)
    const toScreen = (x, z) => {
      const dx = (x - p.x) * scale, dz = (z - p.z) * scale;
      const c0 = Math.cos(rot), s0 = Math.sin(rot);
      return [R + dx * c0 - dz * s0, R + dx * s0 + dz * c0];
    };
    const drawMark = (t, kind) => {
      if (!t) return;
      let [sx, sy] = toScreen(t.x, t.z);
      const dd = targetDeck(t, p) - p.deck;
      const dist = Math.hypot(sx - R, sy - R);
      const lim = rIn - 9 * dpr;
      const out = dist > lim;
      if (out) { sx = R + (sx - R) / dist * lim; sy = R + (sy - R) / dist * lim; }
      ctx.save(); ctx.translate(sx, sy);
      const col = kind === 'obj' ? '#e6c784' : kind === 'wp' ? '#8fd0ff' : (t.color || '#f1ece2');
      ctx.fillStyle = col; ctx.strokeStyle = '#08121c'; ctx.lineWidth = 1.5 * dpr;
      if (out) {
        const a = Math.atan2(sy - R, sx - R);
        ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(7 * dpr, 0); ctx.lineTo(-4 * dpr, -5.5 * dpr); ctx.lineTo(-1.5 * dpr, 0); ctx.lineTo(-4 * dpr, 5.5 * dpr); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.rotate(-a);
      } else if (kind === 'obj') {
        ctx.rotate(Math.PI / 4); const s = 5 * dpr; ctx.fillRect(-s, -s, 2 * s, 2 * s); ctx.strokeRect(-s, -s, 2 * s, 2 * s); ctx.rotate(-Math.PI / 4);
      } else {
        ctx.beginPath(); ctx.arc(0, 0, (kind === 'wp' ? 5 : 3.5) * dpr, 0, TAU); ctx.fill(); ctx.stroke();
      }
      if (dd) {
        // deck-difference chevron
        ctx.fillStyle = col; ctx.font = `800 ${11 * dpr * mmK}px Inter,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,.92)'; ctx.lineWidth = 3.6 * dpr * mmK; ctx.lineJoin = 'round';
        const txt = (dd > 0 ? '▲' : '▼') + Math.abs(dd);
        const ox = out ? -(sx - R) / dist * 21 * dpr * mmK : 0, oy = out ? -(sy - R) / dist * 21 * dpr * mmK : -15 * dpr * mmK;
        ctx.strokeText(txt, ox, oy); ctx.fillText(txt, ox, oy);
      }
      ctx.restore();
    };
    for (const m of ui.markers.values()) {
      if (m.deck !== p.deck || Math.hypot(m.x - p.x, m.z - p.z) > MM_RADIUS * 1.1) continue;
      drawMark({ ...m, color: markerColor(m.kind) }, 'm');
    }
    drawMark(ui.waypoint, 'wp');
    drawMark(ui.objective?.target, 'obj');

    // camera view cone + player arrow
    const camYaw = this._camYaw();
    const ang = (yaw) => rot + Math.atan2(Math.cos(yaw), Math.sin(yaw));    // screen angle of a world heading
    ctx.save(); ctx.translate(R, R);
    const ca = ang(camYaw), fov = 0.62;
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, rIn * 0.55);
    cg.addColorStop(0, 'rgba(143,208,255,.32)'); cg.addColorStop(1, 'rgba(143,208,255,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, rIn * 0.55, ca - fov, ca + fov); ctx.closePath(); ctx.fill();
    ctx.rotate(ang(p.yaw) + Math.PI / 2);
    const s = 7.5 * dpr;
    ctx.beginPath(); ctx.moveTo(0, -s * 1.15); ctx.lineTo(s * 0.8, s * 0.85); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.8, s * 0.85); ctx.closePath();
    ctx.fillStyle = '#fbf6ea'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 4 * dpr; ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#0b1520'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
    ctx.restore();

    // bezel ring + bow indicator
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - ring / 2, 0, TAU);
    ctx.strokeStyle = 'rgba(8,13,20,.82)'; ctx.lineWidth = ring; ctx.stroke();
    ctx.beginPath(); ctx.arc(R, R, rIn, 0, TAU); ctx.strokeStyle = 'rgba(201,164,91,.85)'; ctx.lineWidth = 1.3 * dpr; ctx.stroke();
    ctx.beginPath(); ctx.arc(R, R, R - 1 * dpr, 0, TAU); ctx.strokeStyle = 'rgba(201,164,91,.35)'; ctx.lineWidth = 1 * dpr; ctx.stroke();
    // ticks every 30°
    ctx.translate(R, R);
    for (let k = 0; k < 12; k++) {
      const a = rot + k * Math.PI / 6;
      ctx.strokeStyle = k % 3 === 0 ? 'rgba(230,199,132,.8)' : 'rgba(241,236,226,.25)'; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * (rIn + 2 * dpr), Math.sin(a) * (rIn + 2 * dpr)); ctx.lineTo(Math.cos(a) * (rIn + (k % 3 === 0 ? 6 : 4) * dpr), Math.sin(a) * (rIn + (k % 3 === 0 ? 6 : 4) * dpr)); ctx.stroke();
    }
    // FWD label at the bow direction (world +x)
    const ba = rot;   // world +x direction → screen angle rot
    const br = R - ring / 2;
    ctx.font = `800 ${9 * dpr * mmK}px Inter,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.translate(Math.cos(ba) * br, Math.sin(ba) * br);
    ctx.lineWidth = 3 * dpr * mmK; ctx.strokeStyle = 'rgba(4,8,13,.95)'; ctx.lineJoin = 'round'; ctx.strokeText('FWD', 0, 0.5 * dpr);
    ctx.fillStyle = '#f3d79b'; ctx.fillText('FWD', 0, 0.5 * dpr);
    ctx.restore();
    ctx.restore();
  }
}

export function markerColor(kind) {
  return { mission: '#e6c784', shop: '#63c7b2', info: '#f1ece2', danger: '#ff6b57', npc: '#e6c784', poi: '#b9a0d8', cabin: '#8fb6e0' }[kind] || '#f1ece2';
}
