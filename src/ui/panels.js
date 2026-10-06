// HALCYON TIDE — modal panels: pause menu (+ settings / save / load / controls), inventory, journal/phone, shop.
// Each builder returns { root, update?(dt), handleKey?(code) → bool, close?() }.
import { SHIP } from '../core/config.js';
import { el, esc, fmtMoney, fmtClock, fmtMinOfDay, deckName, cleanName, ICON } from './theme.js';

// ── shared chrome ────────────────────────────────────────────────────────
function topBar(ui, { brand, title, tabs, tab, money = true }) {
  const g = ui.game;
  const cash = g.economy?.cash ?? g.player?.money ?? 0;
  const credit = g.economy?.credit;
  return `<div class="ptop"><div><div class="brand">${esc(brand)}</div><h1>${esc(title)}</h1></div>
    ${tabs ? `<div class="ptabs">${tabs.map(([k, l]) => `<button class="ptab ${k === tab ? 'on' : ''}" data-tab="${k}">${esc(l)}</button>`).join('')}</div>` : ''}
    <div class="sp"></div>
    ${money ? `<div class="money">Wallet<b class="num">${fmtMoney(cash)}</b>${credit != null ? `<span class="num">Onboard account ${fmtMoney(credit)}</span>` : ''}</div>` : ''}</div>`;
}
const foot = (items) => `<div class="pfoot">${items.map(([k, l]) => `<span>${k.split(' ').map(x => `<span class="kc">${esc(x)}</span>`).join('')}${esc(l)}</span>`).join('')}</div>`;
function hoverSfx(ui, root, sel) {
  let last = null;
  root.addEventListener('mouseover', (e) => { const b = e.target.closest(sel); if (b && b !== last && !b.disabled && !b.classList.contains('dim')) { last = b; ui.sfx('ui_hover'); } });
}

// ── PAUSE ────────────────────────────────────────────────────────────────
export function buildPause(ui, opts = {}) {
  const g = ui.game;
  const root = el('div', 'pnl pause');
  const items = [
    ['resume', 'Resume'], ['map', 'Ship map'], ['journal', 'Journal'], ['settings', 'Settings'],
    ['save', 'Save game'], ['load', 'Load game'], ['controls', 'Controls'], ['quit', 'Quit to title'],
  ];
  const where = g.player ? `${cleanName(g.player.room?.name || '') || 'At sea'} · Deck ${g.player.deck}` : '';
  root.innerHTML = `<div class="side"><div class="brand">LARKSPUR OCEANIC</div><div class="logo">Halcyon Tide</div>
    <div class="when">Day ${g.day + 1} at sea · ${fmtClock(g.hour)}${where ? ' · ' + esc(where) : ''}</div>
    <div class="menu">${items.map(([k, l]) => `<button class="mi" data-k="${k}">${l}</button>`).join('')}</div></div>
    <div class="psub"></div>`;
  const sub = root.querySelector('.psub');
  const btns = [...root.querySelectorAll('.mi')];
  let sel = 0, page = null, pageObj = null;
  const highlight = () => btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
  const show = (k) => {
    page = k; pageObj = null;
    btns.forEach(b => b.classList.toggle('sel', b.dataset.k === k));
    if (k === 'settings') pageObj = settingsPage(ui, sub);
    else if (k === 'save') pageObj = slotsPage(ui, sub, 'save');
    else if (k === 'load') pageObj = slotsPage(ui, sub, 'load');
    else if (k === 'controls') pageObj = controlsPage(ui, sub);
    else sub.innerHTML = summaryPage(ui);
  };
  const act = (k) => {
    ui.sfx('ui_click');
    if (k === 'resume') ui.closePanel();
    else if (k === 'map') ui.openPanel('map');
    else if (k === 'journal') ui.openPanel('journal');
    else if (k === 'quit') {
      ui.confirm('Return to the title screen?', 'Unsaved progress since your last save will be lost.').then(ok => { if (ok) ui.quitToTitle(); });
    } else show(k);
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('.mi'); if (b) act(b.dataset.k); });
  root.addEventListener('mouseover', (e) => { const b = e.target.closest('.mi'); if (b) { const i = btns.indexOf(b); if (i !== sel) { sel = i; highlight(); ui.sfx('ui_hover'); } } });
  show(opts.page || null);
  if (!opts.page) highlight();
  return {
    root,
    get page() { return page; },
    back() { show(null); highlight(); },
    handleKey(code) {
      if (pageObj?.handleKey?.(code)) return true;
      if (code === 'ArrowDown' || code === 'KeyS') { sel = (sel + 1) % btns.length; highlight(); ui.sfx('ui_hover'); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { sel = (sel - 1 + btns.length) % btns.length; highlight(); ui.sfx('ui_hover'); return true; }
      if (code === 'Enter' || code === 'Space') { act(btns[sel].dataset.k); return true; }
      if (code === 'Backspace' && page) { show(null); highlight(); return true; }
      return false;
    },
  };
}

function summaryPage(ui) {
  const g = ui.game, o = ui.objective;
  const heat = g.security?.heat ?? 0;
  const ev = g.schedule?.next?.();
  return `<h2>Voyage log</h2><div class="hint">${esc(g.schedule?.today?.()?.title || 'Atlantic crossing aboard MS Halcyon Tide')}</div>
    <div class="stats" style="max-width:52em">
      <div class="stat"><div class="k">Objective</div><div class="v" style="font-size:1.25em;line-height:1.2">${esc(o?.title || 'Explore the ship')}</div></div>
      <div class="stat"><div class="k">Ship time</div><div class="v num">${fmtClock(g.hour)}</div></div>
      <div class="stat"><div class="k">Security attention</div><div class="v">${heat ? esc(g.security?.status || heat + ' / 5') : 'None'}</div></div>
      <div class="stat"><div class="k">Wallet</div><div class="v num">${fmtMoney(g.economy?.cash ?? g.player?.money ?? 0)}</div></div>
      ${ev ? `<div class="stat"><div class="k">Next on the programme</div><div class="v" style="font-size:1.2em;line-height:1.2">${esc(ev.name)}<div style="font:500 .6em Inter;color:var(--mute);margin-top:.4em">${fmtMinOfDay(ev.start)} · ${esc(cleanName(ev.venue || ''))}</div></div></div>` : ''}
    </div>`;
}

// settings
export const SETTINGS_DEF = [
  { sec: 'Graphics' },
  { k: 'quality', l: 'Graphics quality', type: 'seg', opts: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
  { k: 'fov', l: 'Field of view', type: 'range', min: 50, max: 90, step: 1, fmt: (v) => v + '°' },
  { k: 'showFps', l: 'Show FPS', type: 'seg', opts: [[false, 'Off'], [true, 'On']] },
  { sec: 'Controls' },
  { k: 'sensitivity', l: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: (v) => (+v).toFixed(2) },
  { k: 'invertY', l: 'Invert look Y', type: 'seg', opts: [[false, 'Off'], [true, 'On']] },
  { sec: 'Interface' },
  { k: 'subtitles', l: 'Subtitles', type: 'seg', opts: [[true, 'On'], [false, 'Off']] },
  { k: 'mmRotate', l: 'Minimap', type: 'seg', opts: [[true, 'Rotating'], [false, 'Bow up']] },
  { k: 'hudScale', l: 'Interface scale', type: 'range', min: 0.8, max: 1.3, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
  { sec: 'Audio' },
  { k: 'vol.master', l: 'Master volume', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
  { k: 'vol.music', l: 'Music', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
  { k: 'vol.sfx', l: 'Effects', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
  { k: 'vol.ambience', l: 'Ambience', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
  { k: 'vol.voice', l: 'Voices & announcements', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) },
];

export function settingsPage(ui, host) {
  host.innerHTML = `<h2>Settings</h2><div class="hint">Changes apply immediately and are remembered on this device.</div><div class="scroll" style="flex:1;min-height:0;padding-right:1em"></div>`;
  const box = host.querySelector('.scroll');
  const render = () => {
    box.innerHTML = SETTINGS_DEF.map(d => {
      if (d.sec) return `<div class="sec">${d.sec}</div>`;
      const v = ui.getSetting(d.k);
      if (d.type === 'button') return `<div class="srow"><label>${d.l}</label><div class="seg"><button data-act="${d.k}">${d.label || d.l}</button></div><span></span></div>`;
      if (d.type === 'seg') return `<div class="srow"><label>${d.l}</label><div class="seg" data-k="${d.k}">${d.opts.map(([ov, ol]) => `<button data-v="${ov}" class="${String(ov) === String(v) ? 'on' : ''}">${ol}</button>`).join('')}</div><span></span></div>`;
      const pct = ((v - d.min) / (d.max - d.min) * 100).toFixed(1);
      return `<div class="srow"><label>${d.l}</label><input class="rng" type="range" data-k="${d.k}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" style="--p:${pct}%"><span class="v">${d.fmt(v)}</span></div>`;
    }).join('');
  };
  render();
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button'); if (!b) return;
    if (b.dataset.act) { const d = SETTINGS_DEF.find(x => x.k === b.dataset.act); ui.sfx('ui_click'); d?.run?.(ui); return; }   // type:'button' rows (mobile)
    const k = b.parentElement.dataset.k, d = SETTINGS_DEF.find(x => x.k === k);
    const opt = d.opts.find(([ov]) => String(ov) === b.dataset.v);
    ui.setSetting(k, opt[0]); ui.sfx('ui_click');
    for (const x of b.parentElement.children) x.classList.toggle('on', x === b);
  });
  box.addEventListener('input', (e) => {
    const r = e.target.closest('input.rng'); if (!r) return;
    const k = r.dataset.k, d = SETTINGS_DEF.find(x => x.k === k);
    const v = +r.value;
    ui.setSetting(k, v);
    r.style.setProperty('--p', ((v - d.min) / (d.max - d.min) * 100).toFixed(1) + '%');
    r.parentElement.querySelector('.v').textContent = d.fmt(v);
  });
  box.addEventListener('change', () => ui.sfx('ui_click'));
  hoverSfx(ui, box, '.seg button');
  return {};
}

function slotsPage(ui, host, mode) {
  const g = ui.game, S = g.save;
  const render = () => {
    const slots = mode === 'load' ? [0, 1, 2, 3] : [1, 2, 3];
    host.innerHTML = `<h2>${mode === 'save' ? 'Save game' : 'Load game'}</h2><div class="hint">${mode === 'save' ? 'Choose a slot. Autosaves happen every five ship-hours and after each completed job.' : 'Resume from a previous save.'}</div>
      <div class="slots">${slots.map(n => {
        const inf = S?.info?.(n);
        const name = n === 0 ? 'Autosave' : 'Slot ' + n;
        if (!inf) return `<button class="slot emp ${mode === 'load' ? 'dis' : ''}" data-n="${n}"><div class="n">${name}</div><div class="w">Empty</div><div class="m">&nbsp;</div></button>`;
        const d = new Date(inf.t);
        return `<button class="slot" data-n="${n}"><div class="n">${name}</div><div class="w">${esc(cleanName(inf.room) || 'At sea')}</div>
          <div class="m">Deck ${inf.deck ?? '?'} · Day ${(inf.day ?? 0) + 1}, ${fmtClock(((inf.minutes ?? 0) / 60) % 24)}${inf.objective ? '<br>' + esc(inf.objective) : ''}<br>Saved ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></button>`;
      }).join('')}</div>`;
  };
  render();
  host.addEventListener('click', async function onClick(e) {
    const b = e.target.closest('.slot'); if (!b || !host.contains(b)) return;
    const n = +b.dataset.n;
    if (!S) { ui.toast('Saving is unavailable', { kind: 'bad' }); return; }
    if (mode === 'save') {
      if (S.hasSave(n) && !(await ui.confirm(`Overwrite slot ${n}?`, 'The existing save in this slot will be replaced.'))) return;
      ui.sfx('ui_click');
      if (S.saveSlot(n)) ui.toast('Game saved', { kind: 'good' }); else ui.toast('Could not save — storage unavailable', { kind: 'bad' });
      render();
    } else {
      if (!S.hasSave(n)) return;
      ui.sfx('ui_click');
      ui.loadSlot(n);
    }
  });
  hoverSfx(ui, host, '.slot');
  return {};
}

function controlsPage(ui, host) {
  const I = ui.game.input;
  const k = (a, fb) => I?.keyLabel ? I.keyLabel(a) : fb;
  const rows = [
    ['Move', 'W A S D'], ['Look', 'Mouse'], ['Sprint', k('Sprint', 'Shift')], ['Crouch', k('Crouch', 'C')], ['Jump', k('Jump', 'Space')],
    ['Interact', k('Interact', 'E')], ['Alternate interact', k('AltInteract', 'F')], ['Aim', 'RMB'], ['Fire / use', 'LMB'],
    ['Walk toggle', k('WalkToggle', 'Caps')], ['Camera view', k('CameraSwap', 'V')], ['Swap shoulder', k('ShoulderSwap', 'Q')],
    ['Ship map', 'M'], ['Inventory', 'Tab I'], ['Journal / phone', 'J'], ['Pause', 'Esc P'],
    ['Dialogue choice', '1 2 3 4'], ['Skip line', 'Space Enter'],
  ];
  host.innerHTML = `<h2>Controls</h2><div class="hint">Keyboard & mouse. A standard gamepad is also supported.</div>
    <div class="ctl">${rows.map(([l, ks]) => `<div><span>${l}</span><span>${ks.split(' ').map(x => `<span class="kc">${esc(x)}</span>`).join('')}</span></div>`).join('')}</div>`;
  return {};
}

// ── INVENTORY ────────────────────────────────────────────────────────────
const KIND_LABEL = { key: 'Keys & passes', tool: 'Tools', weapon: 'Weapons', outfit: 'Outfits', valuable: 'Valuables', consumable: 'Food & drink', evidence: 'Evidence', collectible: 'Collectibles', misc: 'Misc' };
function invItems(g) {
  let list = [];
  try {
    if (g.inventory?.list) list = g.inventory.list().map(e => ({ ...e, _ref: e }));
    else {
      const m = g.player?.inventory?.items;
      if (m) for (const [id, v] of m) list.push(typeof v === 'object' ? { id, ...v, _ref: v } : { id, name: id.replace(/_/g, ' '), qty: v, kind: 'misc', icon: '•' });
    }
  } catch (e) { console.warn('[ui] inventory', e); }
  return list;
}
function isEquipped(g, it) {
  const p = g.player;
  if (it.kind === 'outfit') return it.role && ((p?.disguise && p.disguise === it.role) || (!p?.disguise && it.role === 'casual'));
  if (it.kind === 'weapon') return !!(it.weapon && (g.combat?.weaponId === it.weapon || p?.held === it.weapon));
  return false;
}
function itemActions(g, it) {
  const out = [];
  const p = g.player;
  if (typeof it._ref?.use === 'function' || typeof it.use === 'function') out.push(['use', it.useLabel || (it.kind === 'outfit' ? 'Wear' : it.kind === 'weapon' ? 'Equip' : 'Use')]);
  else if (it.kind === 'outfit' && it.role && p) out.push(['wear', isEquipped(g, it) ? 'Wearing' : 'Wear']);
  else if (it.kind === 'weapon' && it.weapon && it.weapon !== 'ammo' && g.combat?.select) out.push(['equip', isEquipped(g, it) ? 'Holster' : 'Equip']);
  else if (it.kind === 'consumable' && (g.activities?.consume || it.effect)) out.push(['consume', 'Consume']);
  return out;
}
function runAction(ui, it, a) {
  const g = ui.game, p = g.player;
  try {
    if (a === 'use') { const r = (it._ref?.use || it.use).call(it._ref || it, g); if (r !== false) ui.sfx('ui_click'); return; }
    if (a === 'wear') {
      if (isEquipped(g, it)) return;
      if (it.role === 'casual' || it.passenger && !it.dress) p.removeDisguise?.();
      else if (it.passenger && it.dress) p.wearDisguise?.('passenger', { dress: it.dress }) ?? p.removeDisguise?.();
      else p.wearDisguise?.(it.role);
      ui.toast(`Changed into ${it.name}`, { kind: 'good' }); ui.sfx('ui_click'); return;
    }
    if (a === 'equip') { const C = g.combat; if (isEquipped(g, it)) (C.holster ? C.holster() : C.select('fists')); else C.select(it.weapon); ui.sfx('ui_click'); return; }
    if (a === 'consume') {
      if (g.activities?.consume) g.activities.consume(it.id);
      else { if (it.effect?.heal) p?.heal?.(it.effect.heal); g.inventory?.remove?.(it.id, 1); }
      ui.toast(`${it.name} consumed`, { kind: 'good' }); ui.sfx('ui_click');
    }
  } catch (e) { console.warn('[ui] item action', e); ui.toast('Cannot use that right now', { kind: 'bad' }); }
}

export function buildInventory(ui) {
  const g = ui.game;
  const root = el('div', 'pnl inv');
  let filter = 'all', selId = null;
  const render = () => {
    const items = invItems(g);
    const kinds = [...new Set(items.map(i => i.kind || 'misc'))];
    const order = ['weapon', 'outfit', 'key', 'tool', 'consumable', 'valuable', 'evidence', 'collectible', 'misc'];
    kinds.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (filter !== 'all' && !kinds.includes(filter)) filter = 'all';
    const shown = items.filter(i => filter === 'all' || (i.kind || 'misc') === filter).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || String(a.name).localeCompare(b.name));
    if (!shown.find(i => i.id === selId)) selId = shown[0]?.id ?? null;
    const sel = shown.find(i => i.id === selId);
    const keycards = g.player?.keycards ? [...g.player.keycards] : [];
    const value = items.reduce((s, i) => s + (i.value || 0) * (i.qty || 1), 0);
    root.innerHTML = topBar(ui, { brand: 'Personal effects', title: 'Inventory' }) + `
      <div class="pbody">
        <div class="icol">
          <div class="ifilt"><button class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">All · ${items.length}</button>${kinds.map(k => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${KIND_LABEL[k] || k}</button>`).join('')}</div>
          ${shown.length ? `<div class="igrid scroll">${shown.map(i => `<button class="it ${i.id === selId ? 'sel' : ''}" data-id="${esc(i.id)}">${isEquipped(g, i) ? '<span class="eq">ON</span>' : ''}${(i.qty || 1) > 1 ? `<span class="q">×${i.qty}</span>` : ''}<span class="em">${esc(i.icon || '•')}</span><span class="nm">${esc(i.name)}</span></button>`).join('')}</div>`
            : `<div class="empty">Your pockets are empty.</div>`}
        </div>
        <div class="idet">${sel ? `<div class="em">${esc(sel.icon || '•')}</div><div class="kd">${esc(KIND_LABEL[sel.kind] || sel.kind || 'Item')}</div><h3>${esc(sel.name)}</h3><p>${esc(sel.desc || '')}</p>
          <div class="meta"><div>Quantity<b class="num">${sel.qty || 1}</b></div>${sel.value ? `<div>Value<b class="num">${fmtMoney(sel.value)}</b></div>` : ''}${sel.access ? `<div>Access<b>${esc(sel.access)}</b></div>` : ''}</div>
          <div class="acts">${itemActions(g, sel).map(([a, l]) => `<button class="btn ${l === 'Wearing' ? 'dis' : ''}" data-a="${a}">${l}</button>`).join('')}</div>`
          : `<div class="kd">Summary</div><h3>Nothing selected</h3><p>Items you find, buy or lift will appear here.</p>`}
          <div class="sec" style="margin-top:1.8em">Access & funds</div>
          <p style="font-size:.8em">${keycards.length ? keycards.map(k => esc(k.replace('cabin:', 'Cabin '))).join(' · ') : 'No keycards'}</p>
          <p style="font-size:.8em;margin-top:.5em">Carried value ${fmtMoney(value)}</p>
        </div>
      </div>` + foot([['Tab', 'Close'], ['Esc', 'Back'], ['LMB', 'Select'], ['Enter', 'Use']]);
  };
  render();
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],.chip,.it,[data-a]'); if (!t) return;
    if (t.dataset.f) { filter = t.dataset.f; ui.sfx('ui_click'); render(); return; }
    if (t.dataset.id) { selId = t.dataset.id; ui.sfx('ui_click'); render(); return; }
    if (t.dataset.a) { const it = invItems(g).find(i => i.id === selId); if (it && !t.classList.contains('dis')) { runAction(ui, it, t.dataset.a); setTimeout(render, 30); } }
  });
  hoverSfx(ui, root, '.it,.chip,.btn');
  const off = g.bus.on?.('inventory:change', () => setTimeout(render, 0));
  return {
    root, close: () => off?.(),
    handleKey(code) {
      if (code === 'Enter') { const it = invItems(g).find(i => i.id === selId); const a = it && itemActions(g, it)[0]; if (a) { runAction(ui, it, a[0]); setTimeout(render, 30); } return true; }
      if (code.startsWith('Arrow')) {
        const items = [...root.querySelectorAll('.it')]; if (!items.length) return true;
        let i = items.findIndex(b => b.dataset.id === selId);
        const cols = Math.max(1, Math.round(root.querySelector('.igrid').clientWidth / items[0].offsetWidth) - 0);
        i += code === 'ArrowRight' ? 1 : code === 'ArrowLeft' ? -1 : code === 'ArrowDown' ? cols : -cols;
        i = Math.max(0, Math.min(items.length - 1, i));
        selId = items[i].dataset.id; render(); ui.sfx('ui_hover'); return true;
      }
      return false;
    },
  };
}

// ── JOURNAL / PHONE ──────────────────────────────────────────────────────
export function buildJournal(ui, opts = {}) {
  const g = ui.game;
  const root = el('div', 'pnl jr');
  const tabs = [['obj', 'Objectives'], ['prog', 'Tides Today'], ['msg', 'Messages'], ['stats', 'Stats']];
  let tab = opts.tab || 'obj';
  const render = () => {
    let body = '';
    if (tab === 'obj') body = objectivesTab(ui);
    else if (tab === 'prog') body = programmeTab(ui);
    else if (tab === 'msg') body = messagesTab(ui);
    else body = statsTab(ui);
    root.innerHTML = topBar(ui, { brand: 'Mara Quill · Phone', title: 'Journal', tabs, tab }) + `<div class="pbody"><div class="jlist scroll">${body}</div></div>` + foot([['Q E', 'Switch tab'], ['J', 'Close'], ['Esc', 'Back']]);
  };
  render();
  root.addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; ui.sfx('ui_click'); render(); } });
  hoverSfx(ui, root, '.ptab');
  return {
    root,
    handleKey(code) {
      const i = tabs.findIndex(t => t[0] === tab);
      if (code === 'KeyQ' || code === 'ArrowLeft') { tab = tabs[(i - 1 + tabs.length) % tabs.length][0]; ui.sfx('ui_click'); render(); return true; }
      if (code === 'KeyE' || code === 'ArrowRight') { tab = tabs[(i + 1) % tabs.length][0]; ui.sfx('ui_click'); render(); return true; }
      return false;
    },
  };
}
function stepsHtml(steps) { return steps?.length ? `<ul>${steps.map(s => `<li class="${s.done ? 'done' : ''}">${esc(s.text)}</li>`).join('')}</ul>` : ''; }
function objectivesTab(ui) {
  const g = ui.game;
  let j = null;
  try { j = g.missions?.journal?.(); } catch (e) { console.warn(e); }
  const cur = ui.objective;
  let html = '<div class="sec">Current</div>';
  const active = j?.active || (cur ? [cur] : []);
  if (!active.length) html += '<div class="empty">No active objectives. Explore the ship — opportunities have a way of finding you.</div>';
  for (const o of active) html += `<div class="jcard ${o.id === cur?.id ? 'cur' : ''}">${o.id === cur?.id ? '<span class="tag">Tracked</span>' : ''}<div class="t">${esc(o.title)}</div>${o.text ? `<div class="x">${esc(o.text)}</div>` : ''}${stepsHtml(o.steps)}</div>`;
  const done = j?.completed || ui.completed;
  if (done?.length) {
    html += '<div class="sec">Completed</div>';
    for (const o of done.slice().reverse()) html += `<div class="jcard fin"><span class="tag">Done</span><div class="t">${esc(o.title)}</div>${o.text ? `<div class="x">${esc(o.text)}</div>` : ''}</div>`;
  }
  const failed = j?.failed;
  if (failed?.length) { html += '<div class="sec">Failed</div>'; for (const o of failed) html += `<div class="jcard fin"><div class="t">${esc(o.title)}</div></div>`; }
  return html;
}
function programmeTab(ui) {
  // "Tides Today" — the ship's printed daily programme (game.schedule.today()) plus the bridge forecast (game.weather)
  const g = ui.game, S = g.schedule;
  let td = null;
  try { td = S?.today?.() || null; } catch (e) { console.warn(e); }
  const events = (td?.events || S?.events || []).filter(e => !e.minor);
  if (!events.length) return '<div class="empty">The daily programme has not been printed yet.</div>';
  const now = g.minutes - g.day * 1440;
  let html = '';
  if (td) {
    html += `<div class="sec">Tides Today · ${esc(td.dayName || '')}${td.title ? ' · ' + esc(td.title) : ''}</div>`;
    html += `<div class="jcard"><div class="t">${esc(td.theme || '')}</div><div class="x">Dress code: ${esc(td.dress || 'Smart casual')} · Sunrise ${esc(td.sunrise || '')} · Sunset ${esc(td.sunset || '')}</div></div>`;
  } else html += '<div class="sec">Today</div>';
  let fc = null;
  try { fc = g.weather?.forecast?.() || null; } catch (e) { console.warn(e); }
  if (fc) {
    const st = g.weather.state || {};
    const cap = (t) => String(t || '').replace(/^./, c => c.toUpperCase());
    const now1 = `${cap(fc.now?.label)}${Number.isFinite(st.airTempC) ? ` · ${Math.round(st.airTempC)}°C` : ''}${Number.isFinite(st.beaufort) ? ` · wind force ${st.beaufort}` : ''}${st.seaState ? ` · ${st.seaState} sea` : ''}`;
    const later = (fc.next || []).slice(0, 3).map(n => `${esc(n.clock)} ${esc(n.label)}`).join(' · ');
    html += '<div class="sec">From the bridge · Forecast</div>';
    html += `<div class="jcard"><div class="t">${esc(now1)}</div><div class="x">${esc(fc.summary || '')}${later ? '<br>Later: ' + later : ''}<br>Tonight: ${esc(fc.tonight || '')}. Tomorrow: ${esc(fc.tomorrow || '')}.</div></div>`;
  }
  html += '<div class="sec">Programme</div><div class="prog">';
  for (const e of events.slice().sort((a, b) => a.start - b.start)) {
    const live = now >= e.start && now < e.end, past = now >= e.end;
    const cls = past ? 'past' : '';
    const venue = cleanName(e.venue || '') + (e.moved ? ' (moved indoors)' : '');
    html += `<div class="tm ${cls}">${fmtMinOfDay(e.start)}</div><div class="nm ${cls}">${esc(e.name)}<small>${esc(venue)}${e.deck ? ' · Deck ' + e.deck : ''}${e.dress ? ' · ' + esc(e.dress) : ''}</small></div><div class="st ${live ? 'live' : ''} ${cls}">${live ? 'Now' : past ? 'Ended' : 'Later'}</div>`;
  }
  return html + '</div>';
}
function messagesTab(ui) {
  const g = ui.game;
  let msgs = g.missions?.messages;
  if (typeof msgs === 'function') try { msgs = msgs.call(g.missions); } catch { msgs = null; }
  const all = [...(Array.isArray(msgs) ? msgs : []), ...ui.inbox];
  if (!all.length) return '<div class="empty">No messages.</div>';
  all.sort((a, b) => (b.t ?? b.minutes ?? 0) - (a.t ?? a.minutes ?? 0));
  return all.slice(0, 60).map(m => {
    const from = m.from || m.title || 'Unknown';
    const t = m.minutes ?? m.t;
    return `<div class="msg"><div class="av">${esc(String(from).trim()[0] || '?')}</div><div><div class="w">${esc(from)}<span>${Number.isFinite(t) ? 'Day ' + (Math.floor(t / 1440) + 1) + ', ' + fmtMinOfDay(t) : ''}</span></div><div class="tx">${esc(m.text || m.body || '')}</div></div></div>`;
  }).join('');
}
function statsTab(ui) {
  const g = ui.game, st = ui.stats;
  let ext = {};
  try { ext = g.missions?.stats?.() || {}; } catch {}
  const mins = g.minutes - (ui.startMinutes ?? g.minutes);
  const list = [
    ['Days at sea', g.day + 1], ['Time aboard', `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`], ['Distance walked', `${(st.dist / 1000).toFixed(2)} km`],
    ['Decks visited', `${st.decks.size} / ${SHIP.deckCount}`], ['Rooms discovered', st.rooms.size], ['Wallet', fmtMoney(g.economy?.cash ?? g.player?.money ?? 0)],
    ['Jobs completed', ext.completed ?? ui.completed.length], ['Highest heat', st.maxHeat], ['Times saved', st.saves],
  ];
  for (const [k, v] of Object.entries(ext)) if (k !== 'completed') list.push([k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()), v]);
  return `<div class="stats">${list.map(([k, v]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v num">${esc(v)}</div></div>`).join('')}</div>`;
}

// ── SHOP ─────────────────────────────────────────────────────────────────
export function buildShop(ui, cfg = {}) {
  const g = ui.game;
  const root = el('div', 'pnl shop');
  const render = () => {
    const cash = g.economy?.cash ?? g.player?.money ?? 0;
    const credit = g.economy?.credit;
    const canCredit = !!g.economy && cfg.credit !== false;
    root.innerHTML = topBar(ui, { brand: cfg.sub || 'Larkspur Oceanic · Onboard retail', title: cfg.title || 'Shop' }) + `
      <div class="pbody scroll">${canCredit ? '<div class="note2">Pay cash, or charge to your onboard account when your wallet runs short.</div>' : ''}
      ${(cfg.items || []).map((it, i) => {
        const price = it.price || 0;
        const affordCash = cash >= price;
        const afford = affordCash || (canCredit && g.economy.canAfford?.(price, { account: 'credit' }));
        const dis = it.enabled === false || !afford;
        return `<div class="srowi"><span class="em">${esc(it.icon || '•')}</span><div class="nm"><b>${esc(it.name)}</b><span>${esc(it.desc || '')}</span></div>
          <span class="pr num ${affordCash || price === 0 ? '' : 'no'}">${price ? fmtMoney(price) : 'Free'}</span><button class="btn ${dis ? 'dis' : ''}" data-i="${i}" ${dis ? 'disabled' : ''}>${it.enabled === false ? esc(it.reason || 'Unavailable') : !affordCash && afford ? 'Charge' : 'Buy'}</button></div>`;
      }).join('') || '<div class="empty">Sold out.</div>'}</div>` + foot([['Esc', 'Leave'], ['LMB', 'Buy']]);
    void credit;
  };
  render();
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.btn[data-i]'); if (!b || b.disabled) return;
    const it = cfg.items[+b.dataset.i];
    let ok = false;
    try { ok = cfg.onBuy ? cfg.onBuy(it) : (g.economy?.spend?.(it.price, 'Bought ' + it.name) ?? false); } catch (err) { console.warn('[ui] shop buy', err); }
    ui.sfx(ok ? 'ui_click' : 'ui_close');
    if (ok === false && !cfg.onBuy) ui.toast('Not enough money', { kind: 'bad' });
    render();
  });
  hoverSfx(ui, root, '.btn');
  const off = g.bus.on?.('economy:change', () => render());
  return { root, close: () => { off?.(); cfg.onClose?.(); } };
}

// ── CONFIRM dialog ───────────────────────────────────────────────────────
export function buildConfirm(ui, title, text, resolve) {
  const root = el('div', 'pnl conf');
  root.style.alignItems = 'center'; root.style.justifyContent = 'center';
  root.innerHTML = `<div style="width:min(30em,86vw);padding:2em 2.2em;border-radius:.6em;background:linear-gradient(180deg,#132131,#0b1520);border:1px solid rgba(201,164,91,.4);box-shadow:0 2em 5em rgba(0,0,0,.6)">
    <div style="font-family:var(--serif);font-size:1.7em;font-weight:600;color:#f6efdf">${esc(title)}</div>
    <div style="font-size:.86em;color:var(--ivory2);margin:.6em 0 1.6em;line-height:1.5">${esc(text || '')}</div>
    <div style="display:flex;gap:.7em;justify-content:flex-end"><button class="btn ghost" data-v="0">Cancel</button><button class="btn" data-v="1">Confirm</button></div></div>`;
  root.addEventListener('click', (e) => { const b = e.target.closest('.btn'); if (b) { ui.sfx('ui_click'); resolve(b.dataset.v === '1'); } });
  return { root, handleKey(code) { if (code === 'Enter') { resolve(true); return true; } return false; } };
}
