// Bars, dining, buffet, and shops. Buying food/drink; drinks raise intox, food heals.
// Shops sell items & outfits via game.ui?.shop with a self-contained fallback panel.
// Shoplifting: 'Pocket it' on displays/shelves when the clerk can't see you (crime 'theft').
import { Panel, toast } from './ui.js';
import { fmt } from '../economy.js';
import { ITEMS } from '../inventory.js';

function sfx(game, name, vol = 0.6) { game.bus?.emit('sfx', { name, vol }); }

// ── intoxication ──────────────────────────────────────────────────────────────
function addIntox(game, d) {
  const p = game.player; if (!p) return;
  p.intox = Math.max(0, Math.min(1, (p.intox || 0) + d));
  game.bus?.emit('player:intox', { intox: p.intox });
}

function consume(game, id) {
  const def = ITEMS[id]; if (!def) return;
  const eff = def.effect || {};
  if (eff.heal) game.player?.heal?.(eff.heal);
  if (eff.intox) addIntox(game, eff.intox);
  game.player?.playAnim?.(eff.intox ? 'drink' : 'eat', 1.2);
  sfx(game, eff.intox != null && eff.heal <= 2 ? 'drink' : 'eat', 0.6);
}

// menus per venue kind
const DRINK_MENU = [
  ['cocktail', 'cocktail'], ['wine', 'wine'], ['beer', 'beer'], ['champagne', 'champagne'], ['coffee', 'coffee'], ['water', 'water'],
];
const FOOD_MENU = [['snack', 'snack'], ['meal', 'meal'], ['coffee', 'coffee']];

function priceOf(id) { return ITEMS[id]?.value || 0; }

// a quick "charge to cabin or pay cash" buy
function buyConsumable(game, id, { venue } = {}) {
  const price = priceOf(id);
  const def = ITEMS[id];
  // prefer onboard credit for bars/shops/spa if cash short
  const payCash = game.economy?.canAfford(price);
  const ok = payCash ? game.economy.spend(price, def.name) : game.economy?.spend(price, def.name, { account: 'credit' });
  if (!ok) { toast(game, 'Declined', 'bad'); return false; }
  consume(game, id);
  toast(game, `${def.icon} ${def.name}` + (payCash ? '' : ' · charged to cabin'), 'good');
  return true;
}

function openBarMenu(game, item, food) {
  const venueName = game.player?.room?.name || 'The Bar';
  const menu = food ? FOOD_MENU : DRINK_MENU;
  if (game.ui?.shop) {
    game.ui.shop({
      title: venueName, items: menu.map(([id]) => ({ id, name: ITEMS[id].name, price: priceOf(id), desc: ITEMS[id].desc, kind: 'consumable' })),
      onBuy: (it) => buyConsumable(game, it.id, { venue: item }),
    });
    return;
  }
  const p = new Panel(game, { title: venueName, sub: food ? 'Menu' : 'Drinks', small: true });
  const render = () => {
    p.updateBank();
    p.body.innerHTML = `<div class="act-note">Pay cash, or it is charged to your cabin.</div>`;
    for (const [id] of menu) {
      const def = ITEMS[id];
      const row = document.createElement('div'); row.className = 'act-row';
      row.innerHTML = `<div><div class="nm">${def.icon} ${def.name}</div><div class="ds">${def.desc}</div></div>`;
      const b = document.createElement('button'); b.className = 'act-btn'; b.textContent = fmt(priceOf(id));
      b.onclick = () => { if (buyConsumable(game, id)) render(); };
      row.appendChild(b); p.body.appendChild(row);
    }
  };
  render();
  return p;
}

function openBuffet(game, item) {
  // buffet is free (included) — grab a plate
  game.player?.heal?.(ITEMS.buffet_plate.effect.heal);
  game.player?.playAnim?.('eat', 1.4);
  sfx(game, 'eat', 0.6);
  toast(game, '🍽️ Loaded a plate from the buffet', 'good');
}

// ── Shops ───────────────────────────────────────────────────────────────────
// Catalogue per shop tag → list of item ids.
const SHOP_STOCK = {
  jewellery: ['watch_luxury', 'watch', 'necklace', 'earrings', 'ring', 'cufflinks', 'sunglasses'],
  clothes: ['outfit_evening', 'outfit_swimwear', 'outfit_casual'],
  sundries: ['seasick_pills', 'painkillers', 'water', 'snack', 'sunglasses', 'perfume', 'phone_camera'],
  spirits: ['champagne', 'wine', 'cocktail'],
  logo: ['outfit_casual', 'snack', 'water'],
  food: ['snack', 'coffee', 'water', 'meal'],
  pharmacy: ['seasick_pills', 'painkillers', 'water'],   // Medical Centre counter (deck 3)
};
// shop markups vs base value
const SHOP_PRICE = { watch_luxury: 2400, watch: 240, necklace: 9000, earrings: 1200, ring: 800, cufflinks: 450, sunglasses: 180, perfume: 95, outfit_evening: 240, outfit_swimwear: 45, outfit_casual: 0, seasick_pills: 8, painkillers: 12, water: 3, snack: 6, phone_camera: 320, champagne: 22, wine: 14, cocktail: 16, coffee: 4, meal: 28 };

function buyShopItem(game, id, keep = false) {
  const def = ITEMS[id]; const price = SHOP_PRICE[id] ?? (def.value || 0);
  const payCash = game.economy?.canAfford(price);
  const ok = payCash ? game.economy.spend(price, 'Bought ' + def.name) : game.economy?.spend(price, 'Bought ' + def.name, { account: 'credit' });
  if (!ok) { toast(game, 'Not enough', 'bad'); return false; }
  if (def.kind === 'consumable' && !keep) consume(game, id);
  else game.inventory?.add(id, 1);
  sfx(game, 'cash', 0.5);
  toast(game, `Bought ${def.icon} ${def.name}` + (payCash ? '' : ' · charged to cabin'), 'good');
  return true;
}

function openShop(game, shopTag, title) {
  const stock = SHOP_STOCK[shopTag] || SHOP_STOCK.sundries;
  const items = stock.map(id => ({ id, name: ITEMS[id].name, price: SHOP_PRICE[id] ?? ITEMS[id].value, desc: ITEMS[id].desc, kind: ITEMS[id].kind, icon: ITEMS[id].icon }));
  const keep = shopTag === 'pharmacy';   // medicine goes in your pocket (use it later / give it away)
  if (game.ui?.shop) { game.ui.shop({ title, items, onBuy: (it) => buyShopItem(game, it.id, keep) }); return; }
  const p = new Panel(game, { title, sub: 'Shop' });
  const render = () => {
    p.updateBank();
    p.body.innerHTML = '';
    for (const it of items) {
      const row = document.createElement('div'); row.className = 'act-row';
      row.innerHTML = `<div><div class="nm">${it.icon} ${it.name}</div><div class="ds">${it.desc}</div></div>`;
      const b = document.createElement('button'); b.className = 'act-btn'; b.textContent = fmt(it.price);
      b.disabled = !(game.economy?.canAfford(it.price) || game.economy?.canAfford(it.price, { account: 'credit' }));
      b.onclick = () => { if (buyShopItem(game, it.id, keep)) render(); };
      row.appendChild(b); p.body.appendChild(row);
    }
  };
  render();
  return p;
}

// Sell a legit valuable at the jewellers (full-ish value)
function openJewellerSell(game) {
  const vals = game.inventory?.list('valuable').filter(e => e.id !== 'casino_chips' && e.id !== 'cash_bundle') || [];
  const p = new Panel(game, { title: 'Tidewell Jewellers', sub: 'We buy fine pieces', small: true });
  const render = () => {
    p.updateBank();
    if (!game.inventory?.list('valuable').length) { p.body.innerHTML = '<div class="act-note">You have nothing to sell.</div>'; return; }
    p.body.innerHTML = '<div class="act-note">The jewellers pay 70% of value — for goods with honest provenance.</div>';
    for (const e of game.inventory.list('valuable')) {
      if (e.id === 'casino_chips') continue;
      const offer = Math.round((e.value || 0) * 0.7);
      const row = document.createElement('div'); row.className = 'act-row';
      row.innerHTML = `<div><div class="nm">${e.icon} ${e.name}${e.qty > 1 ? ' ×' + e.qty : ''}</div><div class="ds">Value ${fmt(e.value)}${e.stolen ? ' · <span style="color:#d68a7a">may be flagged</span>' : ''}</div></div>`;
      const b = document.createElement('button'); b.className = 'act-btn'; b.textContent = 'Sell ' + fmt(offer);
      b.onclick = () => {
        game.inventory.remove(e.id, 1); game.economy?.add(offer, 'Sold ' + e.name); sfx(game, 'cash', 0.5);
        if (e.stolen && game.security) { game.security.report?.({ type: 'fencing', severity: 1, x: game.player.x, y: game.player.y, z: game.player.z, deck: game.player.deck, actor: game.player }); toast(game, 'They recognised the piece…', 'warn'); }
        render();
      };
      row.appendChild(b); p.body.appendChild(row);
    }
  };
  render();
  return p;
}

// ── Shoplifting ───────────────────────────────────────────────────────────────
function clerkCanSee(game, item) {
  const plan = game.world.plans[item.room != null ? game.player.deck : game.player.deck];
  // find a clerk NPC near this shop
  const npcs = game.npcs?.query?.(game.player.deck, item.x, item.z, 8, (n) => n.job === 'clerk' || n.role === 'clerk' || (n.poi && n.poi.role === 'clerk'));
  if (!npcs || !npcs.length) return false;
  for (const n of npcs) { if (n.perception?.canSee?.(game.player.x, game.player.y, game.player.z, game.player.deck)) return true; }
  return false;
}

function pocketItem(game, shopTag, item) {
  // pick a plausible small item from the shop
  const stock = (SHOP_STOCK[shopTag] || SHOP_STOCK.sundries).filter(id => ITEMS[id].kind !== 'outfit' || ITEMS[id].passenger);
  const id = stock[Math.floor(Math.random() * stock.length)];
  const def = ITEMS[id];
  const seen = clerkCanSee(game, item);
  game.player?.playAnim?.('crouch_idle', 0.6);
  if (def.kind === 'valuable' || def.kind === 'key') game.inventory?.add(id, 1, { stolen: true });
  else if (def.kind === 'consumable') game.inventory?.add(id, 1, { stolen: true });
  else game.inventory?.add(id, 1, { stolen: true });
  sfx(game, 'pickup', 0.4);
  if (seen) {
    toast(game, `Caught pocketing ${def.name}!`, 'bad');
    game.security?.report?.({ type: 'shoplifting', severity: 1, x: game.player.x, y: game.player.y, z: game.player.z, deck: game.player.deck, actor: game.player, note: 'shoplifting ' + def.name });
  } else {
    toast(game, `Pocketed ${def.icon} ${def.name}`, 'good');
  }
  game.bus?.emit('activity:shoplift', { id, seen });
}

// ── provider ──────────────────────────────────────────────────────────────────
export function registerVendors(game, A) {
  A.openShop = (tag, title) => openShop(game, tag, title);
  A.openBarMenu = (item, food) => openBarMenu(game, item, food);
  A.openJewellerSell = () => openJewellerSell(game);

  game.interact.addProvider((ctx) => {
    const pl = ctx.player; if (!pl || pl.state === 'dead') return null;
    const plan = game.world.plans[ctx.deck]; if (!plan) return null;
    const out = [];
    const room = pl.room;
    const y = plan.y + 1.0;
    for (const it of plan.items) {
      const d = Math.hypot(it.x - ctx.x, it.z - ctx.z);
      if (d > 2.0) continue;
      if (it.t === 'bar_counter' || (it.t === 'back_bar' && false)) {
        out.push({ id: 'bar:' + mk(it), label: 'Order a drink', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 1, enabled: true, run: () => openBarMenu(game, it, false) });
      } else if (it.t === 'buffet') {
        out.push({ id: 'buf:' + mk(it), label: 'Help yourself to the buffet', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 1, enabled: true, run: () => openBuffet(game, it) });
      } else if (it.t === 'counter' && !it.shop && room && room.type === 'medical' && (room.zone || 'public') === 'public' && it.room === room.id) {
        out.push({ id: 'pharm:' + mk(it), label: 'Buy medicine', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 2, enabled: true, run: () => openShop(game, 'pharmacy', 'Medical Centre · Pharmacy') });
      } else if (it.t === 'counter' && it.shop) {
        const title = room?.name || 'Shop';
        out.push({ id: 'shop:' + mk(it), label: 'Browse shop', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 2, enabled: true, run: () => openShop(game, it.shop, title) });
        if (it.shop === 'jewellery') out.push({ id: 'sell:' + mk(it), label: 'Sell valuables', key: 'F', x: it.x, y, z: it.z, dist: d, priority: 1, enabled: true, run: () => openJewellerSell(game) });
      } else if ((it.t === 'display' || it.t === 'shelf') && room && room.shop) {
        // shoplift
        out.push({ id: 'pocket:' + mk(it), label: 'Pocket it', key: 'F', x: it.x, y, z: it.z, dist: d, priority: (pl.crouch || pl.crimeMode || game.activities?.crimeMode) ? 4 : -6, crimePrompt: true, enabled: true, hold: 1.0, crime: { type: 'shoplifting', severity: 1 }, run: () => pocketItem(game, room.shop, it) });
      }
    }
    return out;
  }, 'vendors');
}
function mk(it) { return (it.x * 10 | 0) + ':' + (it.z * 10 | 0); }
