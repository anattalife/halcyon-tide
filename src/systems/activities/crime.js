// Pickpocketing, cabin burglary, and the fence/pawn contact.
import { Rng, hash32 } from '../../core/util.js';
import { Panel, toast } from './ui.js';
import { fmt } from '../economy.js';
import { ITEMS, keycardFor } from '../inventory.js';

function sfx(game, name, vol = 0.6) { game.bus?.emit('sfx', { name, vol }); }

// map an NPC valuable item name → inventory id
const VAL_MAP = {
  wristwatch: 'watch', smartphone: 'phone_camera', necklace: 'necklace', camera: 'phone_camera',
  earrings: 'earrings', tablet: 'phone_camera', 'casino chips': 'casino_chips', cufflinks: 'cufflinks', 'designer sunglasses': 'sunglasses',
};

// ── Pickpocketing ──────────────────────────────────────────────────────────────
// Success depends mostly on WHERE you stand: behind ~55 %, beside ~25 %, in front ~3 % (capped at 6 %).
// Crowd cover (+3 % per person within 3 m, max +15 %), crouching behind them (+8 %), being close (+5 %).
// Awareness: an alert victim ×0.3; nervous −10 %, curious −5 %, drunk +10 %; crew are sharper (×0.85).
// → ~70 % from behind in a crowd, ~5 % face to face. Crew targets carry keycards (stewards: master key).
const CREW_TARGET = new Set(['crew_steward', 'crew_housekeeping', 'crew_waiter', 'crew_bartender', 'crew_deckhand', 'crew_chef', 'crew_engineer', 'croupier', 'entertainer', 'medic', 'lifeguard']);
function pickpocketable(n) {
  if (!n || n.gone || n.state === 'ko' || n.state === 'dead' || n.state === 'flee' || n.state === 'cower' || n.state === 'hidden') return false;
  if (n.kind === 'pax' || n.kind === 'mission') return true;      // story NPCs (Varga, Purser Daan…) always
  if (n.role === 'security' || n.role === 'captain' || n.role === 'crew_officer') return false;
  return (n.kind === 'staff' || n.kind === 'roamer') && (CREW_TARGET.has(n.role) || n.job === 'steward');
}
function isCrewTarget(n) { return n.kind === 'staff' || n.kind === 'roamer' || CREW_TARGET.has(n.role); }
function behindOf(p, n) { const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz) || 1; const dot = (dx * Math.sin(n.yaw) + dz * Math.cos(n.yaw)) / d; return Math.max(0, Math.min(1, (0.3 - dot) / 0.8)); }
function pickpocketChance(game, npc) {
  const p = game.player;
  const dx = p.x - npc.x, dz = p.z - npc.z, d = Math.hypot(dx, dz) || 1;
  // their forward is (sin yaw, cos yaw); dot > 0 → we stand in front of them
  const fx = Math.sin(npc.yaw), fz = Math.cos(npc.yaw);
  const dot = (dx * fx + dz * fz) / d;
  const behindK = Math.max(0, Math.min(1, (0.3 - dot) / 0.8));     // 0 in front … 1 behind (dot ≤ -0.5)
  let c = 0.03 + 0.52 * behindK;
  const crowd = Math.max(0, (game.npcs?.countNear?.(npc.x, npc.y, npc.z, 3) || 0) - 1);
  c += Math.min(0.15, crowd * 0.03);
  if (p.crouch) c += 0.08 * behindK;
  if (d < 0.9) c += 0.05 * behindK;
  if (p.sprint || p.speed > 2.5) c -= 0.15;
  if (npc.alert > 0.3 || npc.reporting) c *= 0.3;
  const per = npc.persona || npc.identity?.persona || {};
  if (per.nervous) c -= 0.1;
  if (per.curious) c -= 0.05;
  if (per.drunk) c += 0.1;
  if (isCrewTarget(npc)) c *= 0.85;
  if (dot > 0.3) c = Math.min(c, 0.06);
  return Math.max(0.02, Math.min(0.9, c));
}

function doPickpocket(game, npc) {
  const p = game.player;
  const chance = pickpocketChance(game, npc);
  const success = Math.random() < chance;
  p.playAnim?.('crouch_idle', 0.8);
  const id = npc.identity;
  const crew = isCrewTarget(npc);
  if (success) {
    const loot = [];
    // crew carry a keycard on a lanyard: stewards/housekeeping a master key, everyone else a crew card
    if (crew && id && !id._cardTaken) {
      const master = npc.access?.has?.('master') || npc.job === 'steward' || npc.role === 'crew_housekeeping';
      const card = master ? 'master_key' : 'crew_keycard';
      id._cardTaken = true;
      if (!game.inventory?.has(card)) { game.inventory?.add(card, 1, { stolen: true }); loot.push(ITEMS[card].name); }
      else if (!game.inventory?.has('crew_keycard')) { game.inventory?.add('crew_keycard', 1, { stolen: true }); loot.push(ITEMS.crew_keycard.name); }
    }
    // lift cash
    if (id && id.cash > 0) { const take = Math.min(id.cash, Math.round(id.cash * (0.5 + Math.random() * 0.5))); id.cash -= take; if (take > 0) { game.economy?.add(take, 'Pickpocketed cash'); loot.push(fmt(take)); } }
    // lift one valuable
    if (!crew && id && id.valuables && id.valuables.length) {
      const v = id.valuables.shift();
      const invId = VAL_MAP[v.item] || 'ring';
      game.inventory?.add(invId, 1, { stolen: true, value: v.value });
      loot.push(ITEMS[invId].name);
    }
    // sometimes their keycard (opens their cabin)
    if (!crew && id && id.cabin && Math.random() < 0.4 && !game.inventory?.has(keycardFor(id.cabin))) {
      game.inventory?.add(keycardFor(id.cabin), 1, { stolen: true });
      loot.push('a cabin keycard (' + id.cabin + ')');
    }
    sfx(game, 'pickup', 0.4);
    toast(game, loot.length ? 'Lifted ' + loot.join(', ') : 'Nothing worth taking', loot.length ? 'good' : 'info');
    // the victim didn't notice; only a guard with eyes on you close by would have spotted the lift
    const guard = game.npcs?.nearest?.(p.deck, p.x, p.z, 9, (m) => m.role === 'security' && m.state !== 'ko' && m.state !== 'dead' && m.perception?.canSee?.(p.x, p.y + 1.2, p.z, p.deck));
    if (guard) game.security?.report?.({ type: 'pickpocket', x: p.x, y: p.y, z: p.z, deck: p.deck, actor: p, victim: npc, stealth: true });
    game.bus?.emit('activity:pickpocket', { success: true, victim: npc, chance });
  } else {
    // caught: victim spins round, shouts — reported within a couple of seconds
    toast(game, 'Caught in the act!', 'bad');
    npc.alert = 1;
    npc.yaw = Math.atan2(p.x - npc.x, p.z - npc.z);
    game.npcs?.system?.react?.(npc, { type: 'shove', damage: 0, source: p, x: p.x, z: p.z });
    npc.yaw = Math.atan2(p.x - npc.x, p.z - npc.z);
    game.bus?.emit('bark', { text: crew ? 'Hey! Hands off — security!' : 'Thief! Get off me! Security!', x: npc.x, y: npc.y, z: npc.z, deck: npc.deck, voice: npc.identity?.voice || { sex: npc.appearance?.sex || 'f' }, npc });
    const sec = game.security;
    const cr = sec?.report?.({ type: 'pickpocket', x: p.x, y: p.y, z: p.z, deck: p.deck, actor: p, victim: npc, loud: 8 });
    if (cr && sec.crime) {
      let mine = sec.crime.pending.find(r => r.crime === cr && r.npc === npc);
      if (!mine) mine = sec.crime.queue({ crime: cr, kind: crew ? 'crew' : 'pax', npc, sighted: true, delay: 2 });
      if (mine) mine.delay = Math.min(mine.delay, 1.6 + Math.random() * 0.9);
      // everyone who saw it shouts too
      for (const r of sec.crime.pending) if (r.crime === cr && r.kind !== 'camera' && r.kind !== 'guard') r.delay = Math.min(r.delay, 3.5 + Math.random());
    } else if (!sec) game.bus?.emit('crime', { type: 'theft', severity: 1, x: p.x, y: p.y, z: p.z, deck: p.deck, actor: p, victim: npc });
    game.bus?.emit('activity:pickpocket', { success: false, victim: npc, chance });
  }
}

// ── Cabin burglary ───────────────────────────────────────────────────────────
// Deterministic loot per (cabin no, container). Containers: safe, wardrobe, desk, luggage.
function burgleSeed(cabinNo, kind, idx) { return hash32('burgle', cabinNo, kind, idx); }

function containerLoot(game, cabinNo, kind, idx) {
  const rng = new Rng(burgleSeed(cabinNo, kind, idx));
  const loot = [];
  if (kind === 'safe') {
    // safes hold the good stuff
    const cash = rng.chance(0.8) ? rng.int(2, 12) * 100 : 0;
    if (cash) loot.push({ type: 'cash', amount: cash });
    const vtable = [['watch_luxury', 0.2], ['necklace', 0.12], ['earrings', 0.2], ['ring', 0.25], ['cufflinks', 0.2], ['passport', 0.6], ['cash_bundle', 0.3]];
    for (const [id, pr] of vtable) if (rng.chance(pr)) loot.push({ type: 'item', id });
  } else if (kind === 'wardrobe') {
    if (rng.chance(0.4)) loot.push({ type: 'item', id: rng.pick(['watch', 'sunglasses', 'perfume']) });
    if (rng.chance(0.3)) loot.push({ type: 'item', id: 'cash_bundle' });
    if (rng.chance(0.25)) loot.push({ type: 'item', id: rng.pick(['outfit_evening', 'outfit_casual']) });
  } else if (kind === 'desk') {
    const cash = rng.chance(0.6) ? rng.int(1, 6) * 50 : 0;
    if (cash) loot.push({ type: 'cash', amount: cash });
    if (rng.chance(0.2)) loot.push({ type: 'item', id: 'passport' });
    if (rng.chance(0.15)) loot.push({ type: 'item', id: 'safe_note' });   // a safe code note
  } else if (kind === 'luggage') {
    if (rng.chance(0.5)) loot.push({ type: 'item', id: rng.pick(['sunglasses', 'perfume', 'watch', 'snack']) });
    const cash = rng.chance(0.4) ? rng.int(1, 4) * 40 : 0;
    if (cash) loot.push({ type: 'cash', amount: cash });
  }
  return loot;
}

function searchContainer(game, cabinNo, kind, idx, item) {
  const p = game.player;
  const key = `burgle:${cabinNo}:${kind}:${idx}`;
  game.activities._searched = game.activities._searched || new Set();
  if (game.activities._searched.has(key)) { toast(game, 'Already searched', 'info'); return; }
  game.activities._searched.add(key);
  const loot = containerLoot(game, cabinNo, kind, idx);
  p.playAnim?.('crouch_idle', 1.2);
  sfx(game, kind === 'safe' ? 'pickup' : 'pickup', 0.4);
  if (!loot.length) { toast(game, 'Empty', 'info'); }
  else {
    const names = [];
    for (const l of loot) {
      if (l.type === 'cash') { game.economy?.add(l.amount, 'Burglary'); names.push(fmt(l.amount)); }
      else { game.inventory?.add(l.id, 1, { stolen: true }); names.push(ITEMS[l.id].name); }
    }
    toast(game, 'Found ' + names.join(', '), 'good');
  }
  // burglary of an occupied room is a crime; and may summon the resident
  game.bus?.emit('crime', { type: 'burglary', severity: 1, x: p.x, y: p.y, z: p.z, deck: p.deck, actor: p, victim: null });
  // chance the resident returns
  if (kind === 'safe' && Math.random() < 0.3 && game.npcs?.spawnAt) maybeSpawnResident(game, cabinNo);
  game.bus?.emit('activity:burgle', { cabinNo, kind, loot });
}

function maybeSpawnResident(game, cabinNo) {
  const cab = game.layout?.cabins?.find(c => c.no === cabinNo);
  if (!cab) return;
  try {
    const n = game.npcs.spawnAt('passenger', cab.deck, cab.doorX ?? cab.x, cab.doorZ ?? cab.z, { identity: { cabin: cabinNo }, goal: { type: 'move', deck: cab.deck, x: cab.inX ?? cab.x, z: cab.inZ ?? cab.z } });
    toast(game, 'Someone is coming back to the cabin!', 'warn');
  } catch (e) { /* npc spawn optional */ }
}

// safe-cracking: with a code (safe_note) it's instant; otherwise a long hold (stethoscope/drill speeds it)
function safeHoldTime(game) {
  if (game.inventory?.has('safe_note')) return 0.5;
  if (game.inventory?.has('drill')) return 4;
  if (game.inventory?.has('stethoscope')) return 6;
  return 10;
}

// ── Fence / pawn ───────────────────────────────────────────────────────────────
function openFence(game) {
  const p = new Panel(game, { title: 'The Fence', sub: 'Discreet buyer · The Bilge', small: true });
  const render = () => {
    p.updateBank();
    const vals = game.inventory?.list('valuable') || [];
    if (!vals.length) { p.body.innerHTML = '<div class="act-note">"Come back when you\'ve got something for me."</div>'; return; }
    p.body.innerHTML = '<div class="act-note">"No questions. I pay 45% — 55% for the hot stuff."</div>';
    for (const e of vals) {
      if (e.id === 'casino_chips') continue;
      const rate = e.stolen ? 0.55 : 0.45;
      const offer = Math.max(1, Math.round((e.value || 0) * rate));
      const row = document.createElement('div'); row.className = 'act-row';
      row.innerHTML = `<div><div class="nm">${e.icon} ${e.name}${e.qty > 1 ? ' ×' + e.qty : ''}</div><div class="ds">${e.stolen ? 'hot' : 'clean'} · value ${fmt(e.value)}</div></div>`;
      const b = document.createElement('button'); b.className = 'act-btn'; b.textContent = 'Fence ' + fmt(offer);
      b.onclick = () => { game.inventory.remove(e.id, 1); game.economy?.add(offer, 'Fenced ' + e.name); sfx(game, 'cash', 0.5); render(); };
      row.appendChild(b); p.body.appendChild(row);
    }
  };
  render();
  return p;
}

// ── provider & fence NPC ─────────────────────────────────────────────────────
// crouched (sneaking) or an explicit crime mode → crime prompts become first choice
export function crimeMode(game) { const p = game.player; return !!(p?.crouch || p?.crimeMode || game.activities?.crimeMode); }

export function registerCrime(game, A) {
  A.crimeMode = false;
  A.isCrimeMode = () => crimeMode(game);
  A.pickpocketable = pickpocketable;
  A.openFence = () => openFence(game);
  A.pickpocketChance = (npc) => pickpocketChance(game, npc);
  A.containerLoot = (cabinNo, kind, idx) => containerLoot(game, cabinNo, kind, idx);
  A._doPickpocket = (npc) => doPickpocket(game, npc);

  // Spawn the fence contact in The Bilge (deck 2 crew bar ~ x41, z5) if NPCs available.
  let fenceNpc = null;
  const trySpawnFence = () => {
    if (fenceNpc || !game.npcs?.spawnAt) return;
    try {
      fenceNpc = game.npcs.spawnAt('crew_bartender', 2, 44, 5.5, { name: 'Cutter', tag: 'fence', job: 'fence', goal: null });
    } catch (e) { fenceNpc = null; }
  };
  game.bus?.on('world:activeDeck', (d) => { if (d === 2) trySpawnFence(); });

  // pickpocket provider (targets nearby NPCs). A crime prompt: on the alt key (F), and only competitive with
  // social prompts when crouched / in crime mode — otherwise priority −6 so Talk/Sit/Buy/Open always win.
  game.interact.addProvider((ctx) => {
    const pl = ctx.player; if (!pl || pl.state !== 'free' || pl.aiming) return null;
    const out = [];
    const npcs = game.npcs?.query?.(ctx.deck, ctx.x, ctx.z, 1.6, pickpocketable) || [];
    let best = null, bd = 99;
    for (const n of npcs) { if (n.tag === 'fence') { best = n; bd = Math.hypot(n.x - ctx.x, n.z - ctx.z); break; } const d = Math.hypot(n.x - ctx.x, n.z - ctx.z); if (d < bd) { bd = d; best = n; } }
    if (best) {
      // fence contact → open fence instead of pickpocket
      if (best.tag === 'fence') {
        out.push({ id: 'fence', label: 'Talk to the fence', key: 'E', x: best.x, y: ctx.y + 1.4, z: best.z, dist: bd, priority: 3, enabled: true, run: () => openFence(game) });
      } else {
        const ch = pickpocketChance(game, best);
        const sneaky = crimeMode(game);
        // not sneaking: only offered when you're actually behind/beside them and moving slowly (no prompt spam in crowds)
        if (!sneaky && (behindOf(pl, best) < 0.35 || pl.speed > 1.0)) return out;
        out.push({ id: 'pick:' + best.id, label: 'Pickpocket', key: 'F', x: best.x, y: ctx.y + 1.0, z: best.z, dist: bd, priority: sneaky ? 5 : -6, enabled: true, hold: 1.2, crimePrompt: true, reason: `~${Math.round(ch * 100)}% chance`, chance: ch, victim: best, run: () => doPickpocket(game, best) });
      }
    }
    return out;
  }, 'pickpocket');

  // burglary provider: search containers inside a cabin you're standing in
  game.interact.addProvider((ctx) => {
    const pl = ctx.player; if (!pl || pl.state === 'dead') return null;
    const room = pl.room; if (!room) return null;
    const isCabin = room.type === 'cabin' || room.type === 'suite' || room.cabin != null;
    if (!isCabin) return null;
    const cabinNo = room.cabin;
    const plan = game.world.plans[ctx.deck]; if (!plan) return null;
    const out = [];
    let idx = 0;
    for (const it of plan.items) {
      if (it.room !== room.id) continue;
      let kind = null;
      if (it.t === 'safe') kind = 'safe';
      else if (it.t === 'wardrobe') kind = 'wardrobe';
      else if (it.t === 'desk' || it.t === 'vanity') kind = 'desk';
      else if (it.t === 'luggage') kind = 'luggage';
      if (!kind) continue;
      const ii = idx++;
      const d = Math.hypot(it.x - ctx.x, it.z - ctx.z);
      if (d > 1.8) continue;
      const own = pl.cabin === cabinNo;
      if (kind === 'safe') {
        const hold = safeHoldTime(game);
        const label = game.inventory?.has('safe_note') ? 'Open safe (code)' : 'Crack safe';
        out.push({ id: `safe:${cabinNo}:${ii}`, label, key: 'E', x: it.x, y: ctx.y + 0.6, z: it.z, dist: d, priority: 2, enabled: true, hold, crime: own ? undefined : { type: 'burglary', severity: 1 }, run: () => searchContainer(game, cabinNo, kind, ii, it) });
      } else {
        out.push({ id: `search:${cabinNo}:${kind}:${ii}`, label: 'Search ' + kind, key: 'E', x: it.x, y: ctx.y + 0.6, z: it.z, dist: d, priority: 1, enabled: true, hold: 1.2, crime: own ? undefined : { type: 'burglary', severity: 1 }, run: () => searchContainer(game, cabinNo, kind, ii, it) });
      }
    }
    return out;
  }, 'burglary');
}

export { containerLoot, pickpocketChance, pickpocketable };
