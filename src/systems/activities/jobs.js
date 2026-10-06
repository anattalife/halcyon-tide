// Odd jobs for money, wellness activities, and the uniform cabinet.
// - Room service runner: wear a waiter/steward outfit, grab a tray at a galley/pantry,
//   deliver to a random cabin on another deck within a time limit → pay + tip.
// - Deckhand chores: quick timed tidy jobs on exterior decks.
// - Photo gallery: snap photos of guests for cash.
// - Spa massage (costs credit, heals), gym treadmill (raises stamina cap), pool towel pickup.
import { deckY } from '../../core/config.js';
import { toast } from './ui.js';
import { fmt } from '../economy.js';

function sfx(game, name, vol = 0.6) { game.bus?.emit('sfx', { name, vol }); }
function isCrewLook(game) { const d = game.player?.disguise; return d === 'crew_waiter' || d === 'crew_steward' || d === 'crew_housekeeping'; }

// ── Room service job ──────────────────────────────────────────────────────────
function startRoomService(game, A) {
  if (A.job) { toast(game, 'Finish your current job first', 'info'); return; }
  const L = game.layout;
  // pick a target cabin on a different deck
  const cabins = (L.cabins || []).filter(c => !c.crew && c.deck !== game.player.deck);
  if (!cabins.length) { toast(game, 'No deliveries available', 'info'); return; }
  const target = cabins[Math.floor(Math.random() * cabins.length)];
  A.job = { type: 'roomservice', target, stage: 'deliver', deadline: game.minutes + 7, reward: 60 + Math.floor(Math.random() * 40) };
  game.player.held = 'tray'; game.player.playAnim?.('carry_tray', 0.6);
  game.ui?.setObjective?.({ id: 'job', title: 'Room service', text: `Deliver to stateroom ${target.no} on deck ${target.deck}`, target: { deck: target.deck, x: target.x, z: target.z, label: 'Stateroom ' + target.no } });
  toast(game, `Deliver to stateroom ${target.no}, deck ${target.deck} — before the food goes cold`, 'mission');
  game.bus?.emit('activity:job', { type: 'roomservice', stage: 'start', target: target.no });
}

function finishRoomService(game, A) {
  const job = A.job; if (!job || job.type !== 'roomservice') return;
  const tip = game.minutes <= job.deadline ? Math.round(job.reward * 0.4) : 0;
  const pay = job.reward + tip;
  game.economy?.add(pay, 'Room service' + (tip ? ' + tip' : ''));
  game.player.held = 'none';
  game.ui?.clearObjective?.('job');
  toast(game, tip ? `Delivered! ${fmt(job.reward)} + ${fmt(tip)} tip` : `Delivered (late) — ${fmt(job.reward)}`, 'good');
  sfx(game, 'cash', 0.5);
  A.job = null;
  game.bus?.emit('activity:job', { type: 'roomservice', stage: 'done', pay });
}

// ── Deckhand chore ──────────────────────────────────────────────────────────
function doDeckhandChore(game, A) {
  game.player.playAnim?.('sweep', 2.0);
  const pay = 25 + Math.floor(Math.random() * 20);
  setTimeout(() => {}, 0);
  game.economy?.add(pay, 'Deckhand chore');
  sfx(game, 'cash', 0.4);
  toast(game, `Tidied the deck — ${fmt(pay)}`, 'good');
  game.bus?.emit('activity:job', { type: 'deckhand', pay });
}

// ── Photo gallery ─────────────────────────────────────────────────────────────
function takeGuestPhoto(game, A) {
  if (!game.inventory?.has('phone_camera')) { toast(game, 'You need a camera', 'bad'); return; }
  const npcs = game.npcs?.query?.(game.player.deck, game.player.x, game.player.z, 6, (n) => n.kind === 'pax') || [];
  game.player.playAnim?.('phone', 1.0);
  sfx(game, 'camera_shutter', 0.5);
  if (!npcs.length) { toast(game, 'No one in frame', 'info'); return; }
  const pay = 10 + npcs.length * 4;
  game.economy?.add(pay, 'Photo gallery');
  toast(game, `Snapped ${npcs.length} guest${npcs.length > 1 ? 's' : ''} — ${fmt(pay)}`, 'good');
  game.bus?.emit('activity:photo', { guests: npcs.length, pay });
}

// ── Wellness ──────────────────────────────────────────────────────────────────
function bookMassage(game) {
  const price = 120;
  if (!game.economy?.spend(price, 'Spa massage', { account: 'credit' })) { toast(game, 'Declined', 'bad'); return; }
  game.player?.lockControls?.(true);
  game.player.playAnim?.('lie', 3);
  toast(game, 'Hot-stone massage — charged to cabin', 'good');
  setTimeout(() => { game.player?.heal?.(60); game.player.intox = Math.max(0, (game.player.intox || 0) - 0.5); game.bus?.emit('player:intox', { intox: game.player.intox }); game.player?.lockControls?.(false); toast(game, 'Fully relaxed', 'good'); }, 1500);
  game.bus?.emit('activity:spa', {});
}
function useTreadmill(game) {
  game.player.playAnim?.('run', 2.5);
  const T = game.player.T;
  if (T && T.staminaMax < 140) { T.staminaMax = Math.min(140, T.staminaMax + 5); game.player.stamina = T.staminaMax; toast(game, `Workout done — max stamina ${Math.round(T.staminaMax)}`, 'good'); }
  else toast(game, 'Good workout', 'good');
  game.bus?.emit('activity:gym', {});
}
function grabTowel(game) { game.player.held = 'towel'; game.player.playAnim?.('idle', 0.4); toast(game, 'Grabbed a towel', 'info'); }

// ── Uniform cabinet ───────────────────────────────────────────────────────────
// The Uniform Issue room (deck 1) cabinets with act:'uniform' let you take & wear a crew outfit.
const UNIFORM_CHOICES = ['outfit_steward', 'outfit_waiter', 'outfit_housekeeping', 'outfit_deckhand', 'outfit_engineer', 'outfit_chef'];
function openUniformCabinet(game, A) {
  const { Panel } = A._ui;
  const p = new Panel(game, { title: 'Uniform Issue', sub: 'Take a uniform', small: true });
  p.body.innerHTML = '<div class="act-note">Wear a crew uniform to pass as staff. Changing clothes changes how security recognises you.</div>';
  const { ITEMS } = A._items;
  for (const id of UNIFORM_CHOICES) {
    const def = ITEMS[id];
    const row = document.createElement('div'); row.className = 'act-row';
    row.innerHTML = `<div><div class="nm">${def.icon} ${def.name}</div><div class="ds">${def.desc}</div></div>`;
    const b = document.createElement('button'); b.className = 'act-btn'; b.textContent = 'Take & wear';
    b.onclick = () => { game.inventory?.add(id, 1); game.player?.wearDisguise?.(def.role); toast(game, 'Now wearing ' + def.name, 'good'); p.close(); };
    row.appendChild(b); p.body.appendChild(row);
  }
  const off = document.createElement('button'); off.className = 'act-btn ghost'; off.textContent = 'Back to own clothes'; off.style.cssText = 'display:block;margin:10px auto 0';
  off.onclick = () => { game.player?.removeDisguise?.(); toast(game, 'Back in your own clothes', 'info'); p.close(); };
  p.body.appendChild(off);
  return p;
}

export function registerJobs(game, A, deps) {
  A._ui = deps.ui; A._items = deps.items;
  A.startRoomService = () => startRoomService(game, A);
  A.takeGuestPhoto = () => takeGuestPhoto(game, A);

  // monitor room-service delivery arrival
  game.addSystem({
    name: 'jobs', order: 72,
    update() {
      const job = A.job;
      if (job && job.type === 'roomservice') {
        const t = job.target;
        if (game.player.deck === t.deck && Math.hypot(game.player.x - t.x, game.player.z - t.z) < 2.2) finishRoomService(game, A);
        else if (game.minutes > job.deadline + 5) { game.ui?.clearObjective?.('job'); game.player.held = 'none'; A.job = null; toast(game, 'Delivery failed — too slow', 'bad'); }
      }
    },
  });

  // providers
  game.interact.addProvider((ctx) => {
    const pl = ctx.player; if (!pl || pl.state === 'dead') return null;
    const plan = game.world.plans[ctx.deck]; if (!plan) return null;
    const room = pl.room;
    const out = [];
    const y = plan.y + 1.0;

    // uniform cabinets (deck 1 Uniform Issue)
    for (const it of plan.items) {
      const d = Math.hypot(it.x - ctx.x, it.z - ctx.z);
      if (d > 2.0) continue;
      if (it.t === 'cabinet' && it.act === 'uniform') { out.push({ id: 'uniform:' + mk(it), label: 'Uniform cabinet', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 2, enabled: true, run: () => openUniformCabinet(game, A) }); break; }
    }

    // room service pickup at a galley/pantry prep_table when wearing crew service look
    if (room && (room.type === 'galley') && !A.job) {
      for (const it of plan.items) {
        if (it.t !== 'prep_table' && it.t !== 'counter' && it.t !== 'range') continue;
        const d = Math.hypot(it.x - ctx.x, it.z - ctx.z); if (d > 2.0) continue;
        const enabled = isCrewLook(game);
        out.push({ id: 'rs:' + mk(it), label: 'Take a room-service tray', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 1, enabled, reason: enabled ? undefined : 'Wear a waiter or steward uniform', run: () => startRoomService(game, A) });
        break;
      }
    }

    // spa massage beds
    for (const it of plan.items) {
      if (it.t !== 'med_bed' || it.act !== 'massage') continue;
      const d = Math.hypot(it.x - ctx.x, it.z - ctx.z); if (d > 1.8) continue;
      out.push({ id: 'spa:' + mk(it), label: 'Book a massage (§120)', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 1, enabled: true, run: () => bookMassage(game) });
      break;
    }
    // gym treadmills
    if (room && room.type === 'gym') for (const it of plan.items) {
      if (it.t !== 'treadmill') continue;
      const d = Math.hypot(it.x - ctx.x, it.z - ctx.z); if (d > 1.6) continue;
      out.push({ id: 'tread:' + mk(it), label: 'Use the treadmill', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 1, enabled: true, run: () => useTreadmill(game) });
      break;
    }
    // deckhand chores on exterior decks: offer when wearing deckhand look near a rail
    if (room && room.exterior && game.player.disguise === 'crew_deckhand') {
      for (const it of plan.items) {
        if (it.t !== 'rail_spot') continue;
        const d = Math.hypot(it.x - ctx.x, it.z - ctx.z); if (d > 1.8) continue;
        out.push({ id: 'chore:' + mk(it), label: 'Deckhand chore', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 0, enabled: true, hold: 1.5, run: () => doDeckhandChore(game, A) });
        break;
      }
    }
    // photo gallery: snap photos in the gallery/photo venue
    if (room && (room.venue === 'photo' || room.type === 'gallery')) {
      out.push({ id: 'photo', label: 'Photograph guests', key: 'F', x: ctx.x, y: ctx.y + 1, z: ctx.z, dist: 0.5, priority: 0, enabled: true, run: () => takeGuestPhoto(game, A) });
    }
    return out;
  }, 'jobs');
}
function mk(it) { return (it.x * 10 | 0) + ':' + (it.z * 10 | 0); }
