// HALCYON TIDE — alternate-approach hooks for the Undertow campaign. Each block adds a genuinely different
// route through a main mission using real systems (interactions, casino results, schedule, pickpocketing).
//   M2  crew keycard: buy from Cutter · lift from a crew jacket in The Bilge · pickpocket a steward
//   M4  house edge:   win big at high-limit tables (the pit boss "invites" you to the cage) · croupier fill swap
//   M5  dead reckoning: the bridge tour as cover (skip the break-in beat legitimately) · Reyes ally
//   M10 finale escape: slip away on the tender (deck 3) or a deck-5 lifeboat when heat is high
import { deckY } from '../../core/config.js';
import { room, inRoom } from './util.js';

const dist = (a, x, z) => Math.hypot(a.x - x, a.z - z);

export function installApproaches(game, E) {
  const P = () => game.player;
  const act = (id) => E.active.has(id);
  const cash = () => game.economy?.cash ?? game.player?.money ?? 0;

  // ── M2: pickpocketing a steward yields their crew keycard ────────────────
  game.bus?.on('activity:pickpocket', (e) => {
    if (!e?.success || !act('undertow_2')) return;
    const v = e.victim; if (!v) return;
    const crew = v.job === 'steward' || /crew_steward|crew_housekeeping/.test(v.role || '') || v.access?.has?.('crew');
    if (crew && !game.inventory?.has('crew_keycard')) {
      game.inventory?.add('crew_keycard', 1, { stolen: true });
      E.flags.m2_how = 'pickpocketed a steward';
      game.ui?.toast?.('Lifted a crew keycard', { kind: 'good' });
    }
  });

  // ── M4: a big win at the tables gets you noticed (the cage watch comes to you) ──
  const winBig = (net) => {
    if (!act('undertow_4') || E.flags.cage_watched) return;
    E.vars.casinoNet = (E.vars.casinoNet || 0) + (net || 0);
    if (E.vars.casinoNet >= 400) {
      E.flags.cage_watched = true; E.flags.m4_how = 'won big';
      E.counters.evidence++;
      game.ui?.toast?.('The pit boss walks you to the cage to "verify" your win. You see the overflow buy-ins being processed.', { kind: 'good', ms: 6000 });
    }
  };
  game.bus?.on('activity:blackjack', (e) => winBig(e?.net));
  game.bus?.on('activity:roulette', (e) => winBig(e?.net));
  game.bus?.on('activity:slot', (e) => winBig((e?.win || 0) - (e?.bet || 0)));

  const providers = [];
  const reg = (a) => providers.push(a);

  // M2 · The Bilge: a crew jacket hangs over a stool — lift the card from it (only crew-bar regulars notice)
  reg({
    key: 'bilge_jacket',
    show: () => act('undertow_2') && !game.inventory?.has('crew_keycard'),
    find: () => ({ deck: 2, x: 37.9, z: 4.4 }),
    label: () => 'Lift a keycard from a crew jacket',
    hold: 1.6, crime: () => ({ type: 'theft', severity: 1 }),
    run: () => { game.inventory?.add('crew_keycard', 1, { stolen: true }); E.flags.m2_how = 'lifted it in the crew bar'; game.ui?.toast?.('You palm a crew keycard from the jacket', { kind: 'good' }); },
  });
  // M2 · Cutter sells a card outright
  reg({
    key: 'cutter_card',
    show: () => act('undertow_2') && !game.inventory?.has('crew_keycard'),
    find: () => { const f = game.npcs?.nearest?.(2, 44, 5.5, 12, (n) => n.tag === 'fence'); return f ? { deck: 2, x: f.x, z: f.z } : { deck: 2, x: 44, z: 5.5 }; },
    label: () => 'Buy a crew keycard from Cutter (§150)',
    enabled: () => cash() >= 150, reason: 'You need §150 cash', btn: 'G', range: 2.6,
    run: () => { if (!game.economy?.spend?.(150, 'Crew keycard (Cutter)')) return; game.inventory?.add('crew_keycard', 1); E.flags.m2_how = 'bought from Cutter'; E.message('Cutter', 'Card\'s good till someone reports it. Don\'t make me regret it.', 0); },
  });
  // M4 · croupier route: swap the chip fill slip at the cage counter (no trespass in a croupier waistcoat)
  reg({
    key: 'cage_fill_swap',
    show: () => act('undertow_4') && !E.flags.cage_evidence && P().disguise === 'croupier',
    find: () => ({ deck: 5, x: 80, z: 16.5 }),
    label: () => 'Swap the chip fill slip (keep the original)',
    hold: 1.8, range: 3.2,
    run: () => { E.flags.cage_watched = true; E.flags.cage_evidence = true; E.flags.m4_how = 'swapped the fill'; E.counters.evidence++; game.inventory?.add('documents', 1); game.ui?.toast?.('Original fill slip pocketed — the numbers are impossible', { kind: 'good' }); },
  });
  // M5 · join the bridge tour at Guest Services when it is running (legit access to the bridge)
  reg({
    key: 'bridge_tour',
    show: () => act('undertow_5') && !E.flags.on_tour && (game.schedule?.isOn?.('bridge-tour') || game.schedule?.isOn?.('galley-tour')),
    find: () => ({ deck: 4, x: 4, z: 11 }),
    label: () => 'Join the bridge tour group', range: 3,
    run: async () => {
      E.flags.on_tour = true; E.flags.m5_how = 'bridge tour';
      await game.ui?.fade?.(true, 400);
      const c = game.world.plans[13].items.find(i => i.routeLog);
      game.player.teleport(13, (c?.x ?? 115) + 1.2, (c?.z ?? 0) + 1.5, -Math.PI / 2);
      // the tour officer's back is turned — the chart table is right there
      game.security && (game.security.suspicion = 0);
      await game.ui?.fade?.(false, 500);
      game.ui?.toast?.('"…and this is where the magic happens." The group drifts to the windows. The chart table is unattended.', { kind: 'info', ms: 6000 });
    },
  });
  // M10 · escape routes when the ship turns on you
  const escape = (key, deck, find, label, how) => reg({
    key, show: () => act('undertow_10') && !E.flags.finale_done && (game.security?.heat ?? 0) >= 2,
    find, label: () => label, hold: 2.5, range: 3,
    run: () => E._finale?.(how),
  });
  escape('tender_escape', 3, () => { const r = room(game, 3, 'Tender Embarkation'); return r ? { deck: 3, x: r.cx, z: r.cz } : null; }, 'Launch the tender and slip away', 'tender');
  escape('lifeboat_escape', 5, () => { const s = game.schedule?.musterStations?.[0]; return s ? { deck: 5, x: s.x, z: s.z } : { deck: 5, x: -23, z: 19 }; }, 'Release a lifeboat davit', 'lifeboat');

  game.interact.addProvider((ctx) => {
    const p = ctx.player; if (!p || p.state !== 'free') return null;
    const out = [];
    for (const a of providers) {
      let ok = false; try { ok = a.show(); } catch {}
      if (!ok) continue;
      let loc = null; try { loc = a.find(); } catch {}
      if (!loc || loc.deck !== ctx.deck) continue;
      const range = a.range ?? 2.0, d = dist(ctx, loc.x, loc.z);
      if (d > range) continue;
      const en = a.enabled ? !!a.enabled() : true;
      out.push({ id: 'mapp:' + a.key, label: a.label(), key: a.btn || 'E', x: loc.x, y: deckY(ctx.deck) + 1.1, z: loc.z, dist: d, range, priority: 5,
        enabled: en, reason: en ? undefined : a.reason, hold: a.hold || 0, crime: a.crime?.() || undefined, run: () => a.run() });
    }
    return out;
  }, 'mission-approaches');
}
