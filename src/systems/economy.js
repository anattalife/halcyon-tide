// HALCYON TIDE — economy (game.economy) + bootstraps inventory.
//
// game.economy contract (docs/ARCHITECTURE.md "Economy & inventory"):
//   cash    — § in the player's wallet (mirrored to game.player.money)
//   credit  — onboard account balance (charge to cabin at bars/shops/spa)
//   add(amount, reason)            → new cash          (cash income)
//   spend(amount, reason) → bool   (from cash; false if short)
//   history  — [{t, amount, reason, kind}] recent ledger
//   Currency symbol §. Starting cash §180 + onboard credit §250.
//
// Charging: spend(amount, reason, { account:'credit' }) draws the onboard account.
//   charging to SOMEONE ELSE's cabin (a stolen keycard) is fraud — pass { cabin: <no> }
//   and, when it is not the player's own cabin, a 'crime' {type:'fraud'} is reported.
//
// Installs inventory from here (gameplay.js calls installEconomy only).

import { installInventory, ITEMS, keycardFor } from './inventory.js';

export const CURRENCY = '§';
export const fmt = (n) => CURRENCY + Math.round(n).toLocaleString('en-US');

class Economy {
  constructor(game) {
    this.game = game;
    this.cash = 180;
    this.credit = 250;          // onboard account tied to the player's own cabin
    this.creditLimit = 2000;    // account may go this far into arrears (billed at voyage end)
    this.history = [];
    this._syncMoney();
  }
  _syncMoney() { const p = this.game.player; if (p) p.money = this.cash; }
  _log(amount, reason, kind) {
    this.history.push({ t: this.game.minutes, amount, reason: reason || '', kind });
    if (this.history.length > 200) this.history.shift();
  }

  add(amount, reason = '') {
    amount = Math.max(0, Math.round(amount));
    this.cash += amount; this._syncMoney();
    this._log(amount, reason, 'income');
    this.game.bus?.emit('economy:change', { cash: this.cash, credit: this.credit, delta: amount, reason });
    if (amount > 0) this.game.bus?.emit('sfx', { name: 'cash', vol: 0.5 });
    return this.cash;
  }

  // spend from cash (default) or the onboard account ('credit').
  // opts: { account:'cash'|'credit', cabin: <no>, silent }
  spend(amount, reason = '', opts = {}) {
    amount = Math.max(0, Math.round(amount));
    const account = opts.account || 'cash';
    if (account === 'credit' || opts.cabin != null) {
      return this._charge(amount, reason, opts);
    }
    if (amount > this.cash) { if (!opts.silent) this.game.bus?.emit('ui:toast', { text: 'Not enough cash', kind: 'bad' }); return false; }
    this.cash -= amount; this._syncMoney();
    this._log(-amount, reason, 'spend');
    this.game.bus?.emit('economy:change', { cash: this.cash, credit: this.credit, delta: -amount, reason });
    return true;
  }

  // charge to an onboard account. Own cabin → the player's credit. Another cabin → fraud.
  _charge(amount, reason, opts = {}) {
    const p = this.game.player;
    const ownCabin = p?.cabin;
    const cabin = opts.cabin != null ? opts.cabin : ownCabin;
    const fraud = cabin != null && ownCabin != null && cabin !== ownCabin;
    if (!fraud) {
      if (this.credit - amount < -this.creditLimit) { if (!opts.silent) this.game.bus?.emit('ui:toast', { text: 'Onboard account declined', kind: 'bad' }); return false; }
      this.credit -= amount;
      this._log(-amount, (reason || 'Charged') + ' · charged to cabin', 'credit');
      this.game.bus?.emit('economy:change', { cash: this.cash, credit: this.credit, delta: 0, reason });
      return true;
    }
    // fraud: charge a stranger's account, report the crime
    this._log(-amount, (reason || 'Charged') + ` · cabin ${cabin} (fraud)`, 'fraud');
    this.game.bus?.emit('economy:change', { cash: this.cash, credit: this.credit, delta: 0, reason });
    this.game.security?.report?.({ type: 'fraud', severity: 1, x: p?.x, y: p?.y, z: p?.z, deck: p?.deck, actor: p, note: `charged ${fmt(amount)} to cabin ${cabin}` });
    this.game.bus?.emit('crime', { type: 'fraud', severity: 1, x: p?.x, y: p?.y, z: p?.z, deck: p?.deck, actor: p, victim: null });
    if (!opts.silent) this.game.bus?.emit('ui:toast', { text: `Charged ${fmt(amount)} to cabin ${cabin}`, kind: 'warn' });
    return true;
  }

  canAfford(amount, opts = {}) {
    if ((opts.account || 'cash') === 'credit') return (this.credit - amount) >= -this.creditLimit;
    return this.cash >= amount;
  }

  save() { return { cash: this.cash, credit: this.credit, history: this.history.slice(-40) }; }
  load(d) { if (!d) return; this.cash = d.cash ?? this.cash; this.credit = d.credit ?? this.credit; if (d.history) this.history = d.history; this._syncMoney(); this.game.bus?.emit('economy:change', { cash: this.cash, credit: this.credit }); }
}

export async function installEconomy(game) {
  // inventory first (economy may reference it; player.money mirror set below)
  installInventory(game);
  const eco = game.economy = new Economy(game);
  // seed the player's starting kit once the player exists
  const seed = (p) => {
    if (!p) return;
    p.money = eco.cash;
    // starting consumables / tools (light — the player buys the rest)
    game.inventory.add('phone_camera', 1);
    game.inventory.add('outfit_casual', 1);
    game.inventory.add('seasick_pills', 2);
  };
  if (game.player) seed(game.player);
  else game.bus?.on('player:ready', seed);
  game.save?.register?.('economy', { save: () => eco.save(), load: (d) => eco.load(d) });
  return eco;
}

export { ITEMS, keycardFor };
