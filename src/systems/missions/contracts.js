// HALCYON TIDE — Cutter's contracts: repeatable "retrieve item X from cabin Y before the deadline" jobs,
// offered by the fence Cutter in The Bilge (deck 2). Built on burglary/inventory systems. A contract item
// is planted in the target cabin's safe/desk; the player searches it (real burglary interaction) to obtain
// the contract item, then returns to Cutter before the clock runs out for the reward.
import { fmtClock } from '../../core/util.js';

const CONTRACT_ITEMS = [
  { id: 'watch_luxury', label: 'a Swiss watch', reward: 600 },
  { id: 'necklace', label: 'a diamond necklace', reward: 900 },
  { id: 'passport', label: 'a certain passport', reward: 350 },
  { id: 'documents', label: 'a sealed envelope', reward: 450 },
  { id: 'ring', label: 'a signet ring', reward: 400 },
];

export class Contracts {
  constructor(game, engine) {
    this.game = game; this.engine = engine;
    this.current = null;          // { itemId, label, cabinNo, deck, deadline, reward, planted }
    this.planted = {};            // cabinNo -> itemId (so the burglary provider can hand it over)
    engine._contracts = this;
    this._hookBurglary();
    this._hookCutter();
  }

  // Offer menu, shown from Cutter's fence panel (we add a button) or via the mission talk.
  offer() {
    const g = this.game;
    if (this.current) { g.ui?.toast?.('Finish your current job for Cutter first', 'info'); return; }
    const cabins = (g.layout.cabins || []).filter(c => !c.crew && c.deck !== g.player.deck);
    if (!cabins.length) { g.ui?.toast?.('Nothing on the books right now', 'info'); return; }
    const cab = cabins[Math.floor(Math.random() * cabins.length)];
    const spec = CONTRACT_ITEMS[Math.floor(Math.random() * CONTRACT_ITEMS.length)];
    this.current = { itemId: spec.id, label: spec.label, cabinNo: cab.no, deck: cab.deck, deadline: g.minutes + 25, reward: spec.reward, taken: false };
    this.planted[cab.no] = spec.id;
    g.ui?.setObjective?.({ id: 'contract', title: "Cutter's Contract", text: `Lift ${spec.label} from stateroom ${cab.no} (deck ${cab.deck}) and bring it back before ${fmtClock(this.current.deadline)}`, steps: [{ text: `Get ${spec.label} from cabin ${cab.no}, deck ${cab.deck}` }, { text: 'Return to Cutter (The Bilge, deck 2)' }], target: { deck: cab.deck, x: cab.inX ?? cab.x, z: cab.inZ ?? cab.z, label: 'Stateroom ' + cab.no } });
    g.ui?.toast?.(`Contract: lift ${spec.label} from cabin ${cab.no} — §${spec.reward}, 25 minutes`, 'mission');
    this.engine.message('Cutter', `Cabin ${cab.no}, deck ${cab.deck}. Bring me ${spec.label}. You've got twenty-five minutes before the owner's back.`, 0);
  }

  _hookBurglary() {
    // when a cabin is burgled, if it's our contract cabin, hand over the contract item
    this.game.bus?.on('activity:burgle', (e) => {
      const c = this.current; if (!c || c.taken) return;
      if (e?.cabinNo === c.cabinNo && (e.kind === 'safe' || e.kind === 'desk' || e.kind === 'wardrobe' || e.kind === 'luggage')) {
        c.taken = true;
        try { this.game.inventory?.add?.(c.itemId, 1, { stolen: true, contract: true }); } catch {}
        this.game.ui?.toast?.(`Lifted ${c.label} — now get it to Cutter`, 'good');
        this.game.ui?.setObjective?.({ id: 'contract', title: "Cutter's Contract", text: `Return ${c.label} to Cutter before ${fmtClock(c.deadline)}`, steps: [{ text: 'Got the item', done: true }, { text: 'Return to Cutter (The Bilge, deck 2)' }], target: { deck: 2, x: 44, z: 5.5, label: 'Cutter · The Bilge' } });
      }
    });
  }

  _hookCutter() {
    // add a "contracts" interaction when near Cutter (the fence NPC, tag 'fence')
    this.game.interact?.addProvider((ctx) => {
      const p = ctx.player; if (!p || p.state !== 'free') return null;
      const fence = this.game.npcs?.nearest?.(ctx.deck, ctx.x, ctx.z, 2.6, (n) => n.tag === 'fence');
      if (!fence) return null;
      const out = [];
      const d = Math.hypot(fence.x - ctx.x, fence.z - ctx.z);
      if (this.current && this.current.taken && this.game.inventory?.has?.(this.current.itemId)) {
        out.push({ id: 'contract:deliver', label: `Deliver ${this.current.label} to Cutter`, key: 'F', x: fence.x, y: ctx.y + 1.4, z: fence.z, dist: d, priority: 6, enabled: true, run: () => this._deliver() });
      } else if (!this.current) {
        out.push({ id: 'contract:offer', label: 'Ask Cutter for work', key: 'F', x: fence.x, y: ctx.y + 1.4, z: fence.z, dist: d, priority: 2, enabled: true, run: () => this.offer() });
      }
      return out;
    }, 'contracts');
  }

  _deliver() {
    const c = this.current; if (!c) return;
    const onTime = this.game.minutes <= c.deadline;
    const pay = onTime ? c.reward : Math.round(c.reward * 0.4);
    this.game.inventory?.remove?.(c.itemId, 1);
    this.game.economy?.add?.(pay, 'Cutter contract');
    this.game.ui?.clearObjective?.('contract');
    this.game.ui?.toast?.(onTime ? `Cutter pays §${pay}. "Pleasure doing business."` : `Late. Cutter pays §${pay}. "Slow, but I'll take it."`, onTime ? 'good' : 'warn');
    this.engine.counters.contracts++;
    this.game.bus?.emit('mission:complete', { id: 'contract', title: "Cutter's Contract", how: onTime ? 'on time' : 'late' });
    delete this.planted[c.cabinNo];
    this.current = null;
  }

  update() {
    const c = this.current; if (!c) return;
    if (!c.taken && this.game.minutes > c.deadline + 3) {
      this.game.ui?.clearObjective?.('contract');
      this.game.ui?.toast?.('Contract expired — Cutter won\'t be pleased', 'bad');
      delete this.planted[c.cabinNo];
      this.current = null;
    }
  }

  save() { return { current: this.current, planted: this.planted }; }
  load(d) { if (d) { this.current = d.current || null; this.planted = d.planted || {}; } }
}
