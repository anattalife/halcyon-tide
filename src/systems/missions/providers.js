// HALCYON TIDE — mission interaction providers. Context actions that drive the campaign through the
// REAL game state (interact.query → run): photographing the ledger, copying the route log, cracking the
// owner's/captain's/payroll safes, watching & rigging the casino cage, searching the bonded store,
// pulling a fire alarm as a distraction, and talking to the Undertow cast.
//
// Everything is gated on the engine's flags / active missions, so these only light up when relevant.
import { deckY } from '../../core/config.js';
import { item, room, inCrewDisguise } from './util.js';

const dist = (a, x, z) => Math.hypot(a.x - x, a.z - z);

export function installProviders(game, E) {
  const P = () => game.player;

  // ── talk to cast ──────────────────────────────────────────────────────────
  // A mission sets npc._talk = { label, run(player,game), key? }. We offer it when near.
  game.interact.addProvider((ctx) => {
    const p = ctx.player; if (!p || p.state !== 'free') return null;
    const out = [];
    const list = game.npcs?.query?.(ctx.deck, ctx.x, ctx.z, 3.4, (n) => (n.castKey || n._talk) && n._talk) || [];
    for (const n of list) {
      if (n.state === 'ko' || n.state === 'dead') continue;
      const d = dist(ctx, n.x, n.z);
      out.push({ id: 'mtalk:' + (n.castKey || n.tag || n.id), label: n._talk.label || ('Speak with ' + (n.name || 'them')), key: n._talk.key || 'E', x: n.x, y: ctx.y + 1.4, z: n.z, dist: d, range: 3.4, priority: 7, enabled: n._talk.enabled !== false, reason: n._talk.reason, run: () => { try { n._talk.run(p, game); } catch (e) { console.error('[missions] talk', e); } } });
    }
    return out;
  }, 'mission-talk');

  // ── generic "evidence container" actions ────────────────────────────────────
  // Each entry: { find() -> {deck,x,z} | null, show() -> bool (gate), label, hold, crime?, run() }
  const actions = [];
  const reg = (a) => actions.push(a);

  // Photograph the payroll ledger (deck 2, Payroll & HR Office desk) — needs phone camera.
  reg({
    key: 'payroll_ledger',
    find: () => item(game, 2, i => i.payrollDesk),
    show: () => E.active.has('undertow_3') && !E.flags.ledger_photo,
    label: () => game.inventory?.has('phone_camera') ? 'Photograph the payroll ledger' : 'Read the payroll ledger',
    hold: 2.2, crime: () => ({ type: 'trespass', severity: 1 }),
    run: () => {
      E.flags.ledger_photo = true; E.counters.evidence++;
      if (game.inventory?.has('phone_camera')) { game.bus.emit('sfx', { name: 'camera_shutter', vol: 0.6 }); game.inventory?.add?.('keycard_photo', 1); }
      game.player.playAnim?.('phone', 1.2);
      E.message('Teodor', 'That ledger is the off-book casino payments. Keep it safe.', 1.5);
      game.ui?.toast?.('Payroll ledger documented', { kind: 'good' });
    },
  });
  // Copy the real route log (deck 13 Chart Room chart_table) — officer look or trespass.
  reg({
    key: 'route_log',
    find: () => item(game, 13, i => i.routeLog),
    show: () => E.active.has('undertow_5') && !E.flags.route_log,
    label: () => 'Copy the ship\'s route log',
    hold: 2.6, crime: () => (p => p.disguise === 'crew_officer' || p.disguise === 'captain' ? null : { type: 'trespass', severity: 1 })(game.player),
    run: () => {
      E.flags.route_log = true; E.counters.evidence++;
      game.inventory?.add?.('documents', 1);
      game.player.playAnim?.('phone', 1.0);
      game.ui?.toast?.('Route log copied — the ship ran dark off the Grand Banks', { kind: 'good' });
      E.message('Teodor', 'That detour is where the transfer happened. We can prove the "navigational error" was a lie.', 2);
    },
  });
  // Bonded store: search the smuggled crates (deck 1) — needs to be inside.
  reg({
    key: 'bonded_crate',
    find: () => { const r = room(game, 1, 'Bonded Store'); return r ? { deck: 1, x: r.cx, z: r.cz } : null; },
    show: () => E.active.has('undertow_6') && !E.flags.bonded_found && game.player.deck === 1 && /Bonded Store/.test(game.player.room?.name || ''),
    label: () => 'Pry open a sealed crate',
    hold: 2.4, range: 20, crime: () => ({ type: 'trespass', severity: 1 }),
    run: () => {
      E.flags.bonded_found = true; E.counters.evidence++;
      game.inventory?.add?.('usb_drive', 1);
      game.player.playAnim?.('crouch_idle', 1.4);
      game.ui?.toast?.('The crates aren\'t duty-free liquor — they\'re unmanifested cash and a drive', { kind: 'good' });
      E.message('Teodor', 'Cash in, clean chips out through the cage. That\'s the laundromat. Get out before they seal the deck.', 2);
    },
  });
  // Casino cage: swap the chip fill / lift the cage ledger (deck 5 cage) — casino staff look or trespass.
  reg({
    key: 'cage_swap',
    find: () => item(game, 5, i => i.casinoSafe) || (room(game, 5, 'Casino Cage') ? { deck: 5, x: 80, z: 17 } : null),
    show: () => E.active.has('undertow_4') && E.flags.cage_watched && !E.flags.cage_evidence,
    label: () => 'Photograph the cage fill records',
    hold: 2.2, crime: () => (game.player.disguise === 'croupier' ? null : { type: 'trespass', severity: 1 }),
    run: () => {
      E.flags.cage_evidence = true; E.counters.evidence++;
      if (game.inventory?.has('phone_camera')) game.bus.emit('sfx', { name: 'camera_shutter', vol: 0.6 });
      game.inventory?.add?.('keycard_photo', 1);
      game.ui?.toast?.('Cage fill records photographed — the chip buy-ins don\'t match the drop', { kind: 'good' });
    },
  });
  // The three story safes (deck 2 payroll, deck 13 captain, deck 14 owner).
  const safe = (key, deck, pred, flag, mission, reward, note) => reg({
    key,
    find: () => item(game, deck, pred),
    show: () => E.active.has(mission) && !E.flags[flag],
    label: () => game.inventory?.has('safe_note') ? 'Open the safe (code)' : game.inventory?.has('drill') ? 'Drill the safe' : 'Crack the safe',
    hold: () => game.inventory?.has('safe_note') ? 1.0 : game.inventory?.has('drill') ? 4 : game.inventory?.has('stethoscope') ? 6 : 10,
    crime: () => ({ type: 'burglary', severity: 1 }),
    run: () => {
      E.flags[flag] = true; E.counters.evidence++;
      for (const r of reward) game.inventory?.add?.(r, 1);
      game.bus.emit('sfx', { name: 'pickup', vol: 0.5 });
      game.player.playAnim?.('crouch_idle', 1.2);
      game.ui?.toast?.(note, { kind: 'good' });
    },
  });
  safe('payroll_safe', 2, i => i.payrollSafe, 'payroll_safe', 'undertow_3', ['documents'], 'Payroll safe open — severance papers naming your dismissal as a cover story');
  safe('captain_safe', 13, i => i.captainSafe, 'captain_safe', 'undertow_5', ['usb_drive'], "Captain's safe open — the sealed incident report she was never shown");
  safe('owner_safe', 14, i => i.ownerSafe, 'owner_safe', 'undertow_9', ['ledger'], "Owner's safe open — the master ledger. Everything Varga did is in here");

  // Fire-alarm pull points (any deck): an improvised distraction that empties a space / pulls guards.
  reg({
    key: 'fire_alarm',
    find: () => { const p = game.player; return { deck: p.deck, x: p.x, z: p.z }; },
    show: () => (E.active.has('undertow_5') || E.active.has('undertow_6') || E.active.has('undertow_9')) && !E.flags.alarm_cd && game.player.disguise && inCrewDisguise(game),
    label: () => 'Trigger the fire alarm',
    range: 0.6, hold: 1.0,
    run: () => {
      E.flags.alarm_cd = true; setTimeout(() => { delete E.flags.alarm_cd; }, 30000);
      const d = game.player.deck;
      game.bus.emit('alarm', { kind: 'fire', on: true, deck: d });
      game.schedule?.say?.('Attention: the fire alarm has been activated. Crew to investigate. Guests, please stand by.', { prio: 3, urgent: true });
      E.flags.distraction = game.minutes;
      game.ui?.toast?.('Fire alarm pulled — eyes will turn away for a minute', { kind: 'good' });
      setTimeout(() => game.bus.emit('alarm', { kind: 'fire', on: false, deck: d }), 12000);
    },
  });

  // One provider serving all container actions.
  game.interact.addProvider((ctx) => {
    const p = ctx.player; if (!p || p.state !== 'free') return null;
    const out = [];
    for (const a of actions) {
      let show = false; try { show = a.show(); } catch {}
      if (!show) continue;
      let loc = null; try { loc = a.find(); } catch {}
      if (!loc || loc.deck !== ctx.deck) continue;
      const range = a.range ?? 2.0;
      const d = dist(ctx, loc.x, loc.z);
      if (d > range) continue;
      const crime = typeof a.crime === 'function' ? a.crime() : a.crime;
      out.push({
        id: 'mact:' + a.key, label: typeof a.label === 'function' ? a.label() : a.label, key: 'E',
        x: loc.x, y: deckY(ctx.deck) + 1.0, z: loc.z, dist: d, priority: 4, enabled: true,
        hold: typeof a.hold === 'function' ? a.hold() : (a.hold || 0), range,
        crime: crime || undefined, run: () => a.run(),
      });
    }
    return out;
  }, 'mission-actions');
}
