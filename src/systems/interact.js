// Interaction registry. Any system can offer context actions to the player.
// Providers are functions (ctx) => Interaction[] called each frame with
//   ctx = { player, deck, x, y, z, yaw, room }
// Interaction = {
//   id: string (stable per target), label: 'Open door', key: 'E' (default) | 'F' | 'G' | 'Q' | 'R',
//   x, y, z (world position of the target), dist (metres from player), priority (higher wins ties),
//   enabled: bool, reason?: string shown when disabled (e.g. 'Requires crew keycard'),
//   hold?: seconds to hold the key (e.g. lockpicking 2.5), crime?: {type, severity} (if performing it is a crime),
//   run(player, game): perform the action
// }
export class Interactions {
  constructor(game) {
    this.game = game;
    this.providers = [];
    this.current = [];
  }
  addProvider(fn, name = '') { this.providers.push({ fn, name }); return () => { this.providers = this.providers.filter(p => p.fn !== fn); }; }
  query(ctx, maxDist = 2.2) {
    const out = [];
    for (const p of this.providers) {
      try {
        const list = p.fn(ctx);
        if (list) for (const it of list) if (it && (it.dist ?? 0) <= (it.range ?? maxDist)) out.push(it);
      } catch (e) { console.error('[interact]', p.name, e); }
    }
    // prefer: in front of the player, closer, higher priority
    const fx = Math.sin(ctx.yaw), fz = Math.cos(ctx.yaw);
    for (const it of out) {
      const dx = it.x - ctx.x, dz = it.z - ctx.z; const l = Math.hypot(dx, dz) || 1;
      const facing = (dx * fx + dz * fz) / l;   // -1..1
      it._score = (it.priority || 0) * 10 - (it.dist ?? l) + facing * 0.9 + (it.enabled === false ? -3 : 0);
    }
    out.sort((a, b) => b._score - a._score);
    this.current = out;
    return out;
  }
}
