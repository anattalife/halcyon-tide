// HALCYON TIDE — mission helpers shared by the campaign, side stories and contracts.
// Everything here is layout-driven (look rooms/items up by name) so coordinates stay robust.

export const MIN = (h, m = 0) => h * 60 + m;

// ── layout lookups ───────────────────────────────────────────────────────────
// Find a room on a deck whose name includes `needle` (case-insensitive). Returns the room record.
export function room(game, deck, needle) {
  const plan = game.world.plans[deck]; if (!plan) return null;
  const n = String(needle).toLowerCase();
  return plan.rooms.find(r => r && r.name && r.name.toLowerCase().includes(n)) || null;
}
// Centre of a named room as {deck,x,z}.
export function roomCentre(game, deck, needle, label) {
  const r = room(game, deck, needle); if (!r) return null;
  return { deck, x: r.cx ?? (r.x0 + r.x1) / 2, z: r.cz ?? (r.z0 + r.z1) / 2, label: label || r.name, room: r };
}
// Find a furniture item on a deck matching a predicate (e.g. i => i.ownerSafe). Returns {x,z,item,deck}.
export function item(game, deck, pred) {
  const plan = game.world.plans[deck]; if (!plan) return null;
  const it = plan.items.find(pred); if (!it) return null;
  return { deck, x: it.x, z: it.z, item: it };
}
// Door id joining two named rooms on a deck (or the first door of a named room).
export function doorOf(game, deck, needle, otherNeedle) {
  const plan = game.world.plans[deck]; if (!plan) return null;
  const r = room(game, deck, needle); if (!r) return null;
  let best = null;
  for (const d of plan.doors) {
    if (!d.rooms || (d.rooms[0] !== r.id && d.rooms[1] !== r.id)) continue;
    if (otherNeedle) {
      const o = plan.rooms[d.rooms[0] === r.id ? d.rooms[1] : d.rooms[0]];
      if (!o || !o.name || !o.name.toLowerCase().includes(String(otherNeedle).toLowerCase())) continue;
    }
    best = d; break;
  }
  return best ? { deck, id: best.id, x: best.x, z: best.z, door: best } : null;
}

// ── geometry ───────────────────────────────────────────────────────────────
export function near(player, deck, x, z, r = 3) {
  if (!player) return false;
  if (deck != null && player.deck !== deck) return false;
  return Math.hypot(player.x - x, player.z - z) <= r;
}
export function inRoom(player, needle) {
  const n = player?.room?.name; return !!n && n.toLowerCase().includes(String(needle).toLowerCase());
}
export function playerHas(game, id, qty = 1) {
  return !!(game.inventory?.has?.(id, qty) || game.player?.keycards?.has?.(id));
}
// crew/credential look that passes a crew zone
export function inCrewDisguise(game) {
  const d = game.player?.disguise;
  return !!d && d !== 'evening' && d !== 'swimwear' && d !== 'casual' && d !== 'passenger';
}

// ── beat factory primitives ──────────────────────────────────────────────────
// A beat = { id, text, target(g,M)?, skip(g,M)?, onActive(g,M)?, check(g,M)->bool, onDone(g,M)? }
export const B = {
  reach(id, text, targetFn, radius = 3.2) {
    return { id, text, target: targetFn, check: (g) => { const t = targetFn(g); return t && near(g.player, t.deck, t.x, t.z, radius); } };
  },
  enter(id, text, deck, needle, targetFn) {
    return { id, text, target: targetFn, check: (g) => g.player.deck === deck && inRoom(g.player, needle) };
  },
  have(id, text, itemId, targetFn) {
    return { id, text, target: targetFn, check: (g) => playerHas(g, itemId) };
  },
  flag(id, text, flagName, targetFn, opts = {}) {
    return { id, text, target: targetFn, onActive: opts.onActive, check: (g, M) => !!M.flags[flagName], skip: opts.skip };
  },
  custom(id, text, checkFn, opts = {}) {
    return { id, text, target: opts.target, onActive: opts.onActive, onDone: opts.onDone, check: checkFn, skip: opts.skip };
  },
};

// Spawn a persistent cast NPC once; returns the npc. Safe if NPCs unavailable.
export function spawnCast(game, key, role, deck, x, z, opts = {}) {
  if (!game.npcs?.spawnAt) return null;
  try {
    const n = game.npcs.spawnAt(role, deck, x, z, { tag: 'cast:' + key, seed: opts.seed ?? hashKey(key), ...opts });
    if (n) { n.cast = key; n.noFlee = opts.noFlee ?? false; }
    return n;
  } catch (e) { console.warn('[missions] spawn', key, e); return null; }
}
function hashKey(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 1e9; }

// Reposition a persistent NPC to a new spot (used by schedules); only when safe/off-screen if `whenUnseen`.
export function placeNpc(game, npc, deck, x, z, yaw = 0, whenUnseen = true) {
  if (!npc || npc.gone) return false;
  const sys = game.npcs?.system; if (!sys) return false;
  if (npc.deck === deck && Math.hypot(npc.x - x, npc.z - z) < 1.5) { npc.yaw = yaw; return true; }
  if (whenUnseen && sys.seen?.(npc.deck, npc.x, npc.y + 1, npc.z)) return false;
  try { sys.placeAt(npc, deck, x, z); npc.yaw = yaw; npc.state = 'idle'; npc.timer = Infinity; sys.setAnim(npc, npc.workAnimName || 'idle'); return true; }
  catch { return false; }
}
