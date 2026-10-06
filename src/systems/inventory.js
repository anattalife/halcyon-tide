// HALCYON TIDE — inventory & item registry (game.inventory, ITEMS).
//
// game.inventory contract (docs/ARCHITECTURE.md "Economy & inventory"):
//   items  Map id → { id, name, kind, qty, value, desc, icon, ...meta }
//   add(id, qty=1, meta) → entry      remove(id, qty=1) → bool
//   has(id, qty=1) → bool             count(id) → number
//   list(kind?) → entry[]             (also legacy no-arg form returns everything)
//   kind: 'key'|'tool'|'weapon'|'outfit'|'valuable'|'consumable'|'evidence'|'collectible'
// Keycards mirror into player.keycards (Set of access strings: 'crew','officer','cabin:9147','master'…).
// Weapons carry kind:'weapon' + weapon:'baton'|'taser'|'pistol'|'extinguisher' (combat consumes them).
// Outfits carry kind:'outfit' + role (used with player.wearDisguise(role)).
//
// This module also exports installInventory(game); economy.js installs it.

// ── item registry ───────────────────────────────────────────────────────────
// Static definitions. Cabin keycards are dynamic (keycardFor(cabinNo)).
export const ITEMS = {
  // ── keys ──────────────────────────────────────────────────────────────
  crew_keycard:     { name: 'Crew Keycard', kind: 'key', access: 'crew', value: 0, icon: '🪪', desc: 'Opens crew-only doors and back-of-house passages.' },
  officer_keycard:  { name: 'Officer Keycard', kind: 'key', access: 'officer', value: 0, icon: '🪪', desc: 'Officer clearance — offices, the bridge approaches, admin.' },
  security_keycard: { name: 'Security Keycard', kind: 'key', access: 'security', value: 0, icon: '🪪', desc: 'Security clearance — CCTV, armoury, the brig.' },
  engineer_keycard: { name: 'Engineering Keycard', kind: 'key', access: 'engineer', value: 0, icon: '🪪', desc: 'Engineering clearance — engine rooms, machinery spaces.' },
  casino_keycard:   { name: 'Casino Staff Card', kind: 'key', access: 'casino', value: 0, icon: '🪪', desc: 'Casino floor staff access — the cage and back rooms.' },
  master_key:       { name: 'Master Key', kind: 'key', access: 'master', value: 0, icon: '🗝️', desc: 'A housekeeping master key. Opens any stateroom.' },

  // ── tools ─────────────────────────────────────────────────────────────
  lockpick:     { name: 'Lockpick Set', kind: 'tool', value: 0, icon: '🧰', desc: 'A slim set of picks. Lets you work a locked door.' },
  wire_cutters: { name: 'Wire Cutters', kind: 'tool', value: 0, icon: '✂️', desc: 'Cuts cable and fencing. Useful on cameras and panels.' },
  screwdriver:  { name: 'Screwdriver', kind: 'tool', value: 0, icon: '🪛', desc: 'A sturdy flat-head. Pops open panels, vents and desks.' },
  binoculars:   { name: 'Binoculars', kind: 'tool', value: 0, icon: '🔭', desc: 'Marine 7×50s. See who is who from across the deck.' },
  phone_camera: { name: 'Phone Camera', kind: 'tool', value: 0, icon: '📱', desc: 'Your phone. Snap photos of people and places.' },
  stethoscope:  { name: 'Stethoscope', kind: 'tool', value: 0, icon: '🩺', desc: 'Lets you feel a safe dial. Cracking a safe is faster.' },
  drill:        { name: 'Cordless Drill', kind: 'tool', value: 0, icon: '🔩', desc: 'Loud, but it gets through a safe hinge eventually.' },

  // ── weapons (combat workstream consumes these) ──────────────────────────
  baton:        { name: 'Collapsible Baton', kind: 'weapon', weapon: 'baton', value: 60, icon: '🏏', desc: 'A steel baton. Non-lethal, up close.' },
  taser:        { name: 'Taser', kind: 'weapon', weapon: 'taser', value: 220, icon: '⚡', desc: 'Drops a target for a few seconds. Two cartridges.' },
  pistol:       { name: 'Pistol', kind: 'weapon', weapon: 'pistol', value: 900, icon: '🔫', desc: 'A 9mm sidearm. Loud and very illegal aboard.' },
  pistol_ammo:  { name: '9mm Magazine', kind: 'weapon', weapon: 'ammo', value: 40, icon: '📦', desc: 'A loaded magazine for the pistol.' },
  extinguisher: { name: 'Fire Extinguisher', kind: 'weapon', weapon: 'extinguisher', value: 0, icon: '🧯', desc: 'Puts out fires — or swings as a heavy improvised club.' },

  // ── outfits (player.wearDisguise(role)) ─────────────────────────────────
  outfit_steward:      { name: 'Steward Uniform', kind: 'outfit', role: 'crew_steward', value: 0, icon: '👔', desc: 'Housekeeping steward whites. Lets you pass as crew.' },
  outfit_waiter:       { name: 'Waiter Uniform', kind: 'outfit', role: 'crew_waiter', value: 0, icon: '👔', desc: 'Dining waistcoat. Carry a tray and nobody looks twice.' },
  outfit_housekeeping: { name: 'Housekeeping Uniform', kind: 'outfit', role: 'crew_housekeeping', value: 0, icon: '🧺', desc: 'Cabin stewardess uniform, with a cart to match.' },
  outfit_deckhand:     { name: 'Deckhand Overalls', kind: 'outfit', role: 'crew_deckhand', value: 0, icon: '🦺', desc: 'Orange deck overalls. Belongs anywhere outdoors.' },
  outfit_engineer:     { name: 'Engineer Boilersuit', kind: 'outfit', role: 'crew_engineer', value: 0, icon: '🔧', desc: 'Boiler suit and ear defenders — passes in machinery spaces.' },
  outfit_chef:         { name: "Chef's Whites", kind: 'outfit', role: 'crew_chef', value: 0, icon: '👨‍🍳', desc: 'Galley whites and toque.' },
  outfit_security:     { name: 'Security Uniform', kind: 'outfit', role: 'security', value: 0, icon: '🛡️', desc: 'Ship security blacks. Authority — and scrutiny.' },
  outfit_officer:      { name: "Officer's Whites", kind: 'outfit', role: 'crew_officer', value: 0, icon: '🎖️', desc: 'Dress whites with epaulettes. Opens a lot of doors.' },
  outfit_entertainer:  { name: 'Entertainer Costume', kind: 'outfit', role: 'entertainer', value: 0, icon: '🎭', desc: 'Sequins and stage make-up. Backstage and front of house.' },
  outfit_croupier:     { name: 'Croupier Outfit', kind: 'outfit', role: 'croupier', value: 0, icon: '🃏', desc: 'Casino dealer waistcoat. Lets you work the tables.' },
  // passenger looks (change how security recognises you, not a crew role)
  outfit_evening:      { name: 'Evening Wear', kind: 'outfit', role: 'evening', dress: 'evening', passenger: true, value: 240, icon: '🤵', desc: 'Black tie / gown. For formal night and the high-limit salon.' },
  outfit_swimwear:     { name: 'Swimwear', kind: 'outfit', role: 'swimwear', dress: 'swim', passenger: true, value: 45, icon: '🩱', desc: 'For the pools, the spa and the lido.' },
  outfit_casual:       { name: 'Casual Clothes', kind: 'outfit', role: 'casual', dress: 'casual', passenger: true, value: 0, icon: '👕', desc: 'Your own everyday clothes.' },

  // ── valuables (fence / pawn) ────────────────────────────────────────────
  watch_luxury:   { name: 'Luxury Watch', kind: 'valuable', value: 2400, icon: '⌚', desc: 'A Swiss chronograph. The jewellers would know it anywhere.' },
  watch:          { name: 'Wristwatch', kind: 'valuable', value: 240, icon: '⌚', desc: 'A decent wristwatch.' },
  necklace:       { name: 'Diamond Necklace', kind: 'valuable', value: 9000, icon: '💎', desc: 'Set with real stones. Very hot.' },
  earrings:       { name: 'Earrings', kind: 'valuable', value: 1200, icon: '💠', desc: 'A pair of jewelled earrings.' },
  ring:           { name: 'Signet Ring', kind: 'valuable', value: 800, icon: '💍', desc: 'A heavy gold signet ring.' },
  cufflinks:      { name: 'Cufflinks', kind: 'valuable', value: 450, icon: '🔗', desc: 'Mother-of-pearl cufflinks.' },
  cash_bundle:    { name: 'Cash Bundle', kind: 'valuable', value: 500, icon: '💵', desc: 'A rubber-banded roll of notes. Spends like cash when fenced.' },
  casino_chips:   { name: 'Casino Chips', kind: 'valuable', value: 100, icon: '🎰', desc: 'Gilded Reef chips. Cash them at the cage.' },
  passport:       { name: 'Passport', kind: 'valuable', value: 300, icon: '📕', desc: "Someone's passport. Worth something to the wrong people." },
  perfume:        { name: 'Perfume', kind: 'valuable', value: 95, icon: '🧴', desc: 'Boxed designer perfume.' },
  sunglasses:     { name: 'Designer Sunglasses', kind: 'valuable', value: 180, icon: '🕶️', desc: 'Designer shades.' },

  // ── consumables (heal / effects) ────────────────────────────────────────
  cocktail:   { name: 'Cocktail', kind: 'consumable', value: 14, icon: '🍸', effect: { intox: 0.22, heal: 2 }, desc: 'The bar special. Goes down easy.' },
  beer:       { name: 'Beer', kind: 'consumable', value: 9, icon: '🍺', effect: { intox: 0.14, heal: 1 }, desc: 'A cold draught.' },
  wine:       { name: 'Glass of Wine', kind: 'consumable', value: 12, icon: '🍷', effect: { intox: 0.16, heal: 1 }, desc: 'House red or white.' },
  champagne:  { name: 'Champagne', kind: 'consumable', value: 22, icon: '🥂', effect: { intox: 0.18, heal: 2 }, desc: 'A flute of fizz.' },
  coffee:     { name: 'Coffee', kind: 'consumable', value: 4, icon: '☕', effect: { intox: -0.25, heal: 3 }, desc: 'Sobers you up a touch and settles the stomach.' },
  snack:      { name: 'Snack', kind: 'consumable', value: 6, icon: '🥐', effect: { heal: 10 }, desc: 'A pastry or sandwich.' },
  buffet_plate:{ name: 'Plate of Food', kind: 'consumable', value: 0, icon: '🍽️', effect: { heal: 25 }, desc: 'A loaded buffet plate.' },
  meal:       { name: 'Hot Meal', kind: 'consumable', value: 28, icon: '🍲', effect: { heal: 35 }, desc: 'A proper sit-down meal.' },
  seasick_pills:{ name: 'Seasickness Pills', kind: 'consumable', value: 8, icon: '💊', effect: { heal: 5, intox: -0.4 }, desc: 'Settles the stomach and the head.' },
  painkillers:{ name: 'Painkillers', kind: 'consumable', value: 10, icon: '💊', effect: { heal: 40 }, desc: 'Takes the edge off. Restores health.' },
  water:      { name: 'Bottled Water', kind: 'consumable', value: 3, icon: '💧', effect: { heal: 4, intox: -0.15 }, desc: 'Stay hydrated.' },

  // ── collectibles ────────────────────────────────────────────────────────
  medallion:  { name: 'Larkspur Medallion', kind: 'collectible', value: 0, icon: '🏅', desc: 'A small brass medallion hidden by the shipyard. 40 are aboard.' },

  // ── evidence (mission items) ────────────────────────────────────────────
  ledger:     { name: 'Accounts Ledger', kind: 'evidence', value: 0, icon: '📒', desc: 'A hand-kept ledger of off-book payments.' },
  usb_drive:  { name: 'USB Drive', kind: 'evidence', value: 0, icon: '💾', desc: 'An encrypted drive.' },
  documents:  { name: 'Sealed Documents', kind: 'evidence', value: 0, icon: '📄', desc: 'A sealed envelope of papers.' },
  safe_note:  { name: 'Safe Code Note', kind: 'evidence', value: 0, icon: '📝', desc: 'A scrap of paper with a safe combination scribbled on it.' },
  keycard_photo:{ name: 'Incriminating Photo', kind: 'evidence', value: 0, icon: '🖼️', desc: 'A photograph that someone would pay to keep quiet.' },
};

// Dynamic cabin keycard definition.
export function keycardFor(cabinNo) {
  const id = 'cabinkey_' + cabinNo;
  if (!ITEMS[id]) {
    ITEMS[id] = { name: `Keycard — ${cabinNo}`, kind: 'key', access: 'cabin:' + cabinNo, value: 0, icon: '🪪', dynamic: true, cabin: cabinNo, desc: `Opens stateroom ${cabinNo}.` };
  }
  return id;
}

// ── Inventory implementation ──────────────────────────────────────────────────
class Inventory {
  constructor(game) {
    this.game = game;
    this.items = new Map();
    this._mirrorPending = false;
  }
  _def(id) { return ITEMS[id] || null; }

  add(id, qty = 1, meta = null) {
    const def = this._def(id);
    if (!def) { console.warn('[inventory] unknown item', id); return null; }
    let e = this.items.get(id);
    if (!e) {
      e = { id, name: def.name, kind: def.kind, qty: 0, value: def.value || 0, desc: def.desc || '', icon: def.icon || '•',
        weapon: def.weapon, role: def.role, access: def.access, dress: def.dress, passenger: def.passenger, effect: def.effect, cabin: def.cabin };
      this.items.set(id, e);
    }
    e.qty += qty;
    if (meta) Object.assign(e, meta);
    this._afterChange(id, def);
    this.game.bus?.emit('inventory:add', { id, qty, entry: e });
    this.game.bus?.emit('inventory:change', { id });
    return e;
  }
  remove(id, qty = 1) {
    const e = this.items.get(id);
    if (!e || e.qty < qty) return false;
    e.qty -= qty;
    if (e.qty <= 0) this.items.delete(id);
    const def = this._def(id);
    if (def && def.kind === 'key') this._mirrorKeycards();
    this.game.bus?.emit('inventory:remove', { id, qty });
    this.game.bus?.emit('inventory:change', { id });
    return true;
  }
  has(id, qty = 1) { const e = this.items.get(id); return !!e && e.qty >= qty; }
  count(id) { const e = this.items.get(id); return e ? e.qty : 0; }

  list(kind) {
    const out = [];
    for (const e of this.items.values()) if (!kind || e.kind === kind) out.push(e);
    return out;
  }

  _afterChange(id, def) {
    if (def.kind === 'key') this._mirrorKeycards();
  }
  // keep player.keycards (Set) in sync with every 'key' item held
  _mirrorKeycards() {
    const p = this.game.player; if (!p || !p.keycards) return;
    // preserve non-item cabin grants (home cabin) by tracking which we added
    this._added = this._added || new Set();
    for (const acc of this._added) p.keycards.delete(acc);
    this._added.clear();
    for (const e of this.items.values()) {
      if (e.kind === 'key' && e.access) { p.keycards.add(e.access); this._added.add(e.access); }
    }
  }

  // value of a stack / of everything of a kind
  valueOf(id) { const e = this.items.get(id); return e ? (e.value || 0) * e.qty : 0; }

  save() {
    const out = [];
    for (const e of this.items.values()) out.push({ id: e.id, qty: e.qty, value: e.value, cabin: e.cabin });
    return { items: out };
  }
  load(data) {
    if (!data || !data.items) return;
    this.items.clear();
    for (const s of data.items) {
      if (s.id && s.id.startsWith('cabinkey_') && s.cabin) keycardFor(s.cabin);
      this.add(s.id, s.qty, s.value != null ? { value: s.value } : null);
    }
  }
}

export function installInventory(game) {
  const inv = game.inventory = new Inventory(game);
  // replace the player's placeholder inventory with ours (same has/add/remove/count API)
  if (game.player) { game.player.inventory = inv; inv._mirrorKeycards(); }
  game.bus?.on('player:ready', (p) => { p.inventory = inv; inv._mirrorKeycards(); });
  game.save?.register?.('inventory', { save: () => inv.save(), load: (d) => inv.load(d) });
  return inv;
}
