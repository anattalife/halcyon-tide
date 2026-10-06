// HALCYON TIDE — MISSIONS & NARRATIVE (game.missions).
//
//   installMissions(game) → game.missions
//
// Installs the "Undertow" campaign (10 main missions over the 7-night crossing), 10 emergent "Ship
// Stories" side encounters, and Cutter's repeatable contracts — all built on the ship's systems
// (decks, crowds, crew areas, elevators/stairs, schedule, weather, security, disguises, economy).
//
// Every main mission allows at least two genuinely different approaches (stealth / disguise / social /
// bribe vs. force). Objectives complete from REAL game state, never scripted timers.
//
// Public API (game.missions):
//   start(id) · complete(id, how?) · fail(id, reason?) · skipTo(id)   flow control (debug-friendly)
//   list() → [{id,title,kind,act,status,approaches}]                  all registered missions
//   state(id) → {id,title,kind,status,beat,how,requires,canStart}     one mission's state
//   journal() → {active, completed, failed}                           for the journal panel
//   messages → [{from,text,minutes,read}]                             phone texts from contacts
//   stats() → {completed, mainDone, shipStories, contracts, evidenceGathered}
//   flags, vars                                                       story state (read/write)
//   offerContract()                                                   force a Cutter contract (debug)
//   startStory(id)                                                    force a Ship Story (debug)
//   _setAutoAnswer(mapOrFn|null)                                      TEST HOOK: auto-resolve dialogue
//        (map {choiceId|missionId: optionId} or fn(cfg,missionId)->optionId); clears with null
//
// Bus out: 'mission:start' {id,title}, 'mission:complete' {id,title,how}, 'mission:failed' {id,title,reason}
import { MissionEngine } from './missions/engine.js';
import { CastManager } from './missions/cast.js';
import { installProviders } from './missions/providers.js';
import { registerCampaign } from './missions/campaign.js';
import { StoryManager } from './missions/stories.js';
import { Contracts } from './missions/contracts.js';
import { installApproaches } from './missions/approaches.js';

export async function installMissions(game) {
  if (!game.interact) { console.warn('[missions] no interaction system; skipping'); return null; }
  const engine = new MissionEngine(game);

  // cast must exist before the campaign wires talk handlers
  const cast = new CastManager(game, engine);
  const contracts = new Contracts(game, engine);
  const stories = new StoryManager(game, engine);

  // register the campaign and interaction providers
  registerCampaign(engine);
  installProviders(game, engine);
  installApproaches(game, engine);

  // ── reactivity: heat / schedule / weather colour the world and cast ─────────
  installReactivity(game, engine);

  // ── public API ──────────────────────────────────────────────────────────
  const api = game.missions = {
    engine, cast, contracts, stories,
    start: (id) => engine.start(id),
    complete: (id, how) => engine.complete(id, how),
    fail: (id, reason) => engine.fail(id, reason),
    skipTo: (id) => engine.skipTo(id),
    list: () => engine.list(),
    state: (id) => engine.stateOf(id),
    journal: () => engine.journal(),
    get messages() { return engine.messages; },
    stats: () => engine.stats(),
    get flags() { return engine.flags; },
    get vars() { return engine.vars; },
    offerContract: () => contracts.offer(),
    startStory: (id) => stories.start(id),
    _setAutoAnswer: (v) => { engine._auto = v ?? null; },
  };

  // ── drive ───────────────────────────────────────────────────────────────
  game.addSystem({
    name: 'missions', order: 75,
    update(dt) { engine.update(dt); contracts.update(); },
  });

  // ── save / load ───────────────────────────────────────────────────────────
  game.save?.register?.('missions', { save: () => engine.save(), load: (d) => engine.load(d) });

  console.info('[missions] installed: Undertow campaign (10), Ship Stories (10), Cutter contracts');
  return api;
}

// Heat/schedule/weather reactivity that doesn't belong to any one mission.
function installReactivity(game, engine) {
  const bus = game.bus;
  // Okafor's temperament tracks heat: when the player is wanted, she stops being merely "fair".
  bus.on('heat:change', (e) => {
    const lvl = e?.level ?? 0;
    const ok = engine._cast?.get?.('okafor');
    if (ok) ok._hostile = lvl >= 2;
    if (lvl >= 3 && engine.active.has('undertow_6') && !engine.flags.bonded_found) {
      // a ship-wide scare during the smuggling run makes escape harder but still possible
    }
    if (lvl >= 4) engine.message('Teodor', 'The whole ship\'s looking for you. Lie low — change your clothes and give it a few minutes.', 0);
  });
  // Teodor nudges when a storm begins (sets up Storm Front flavour)
  bus.on('weather:change', (e) => {
    if (e?.storm > 0.6 && !engine.flags._stormNudge && engine.state.get('undertow_6')?.status === 'completed') {
      engine.flags._stormNudge = true;
      engine.message('Jonah Pike', 'Weather\'s turning. If we\'re going to meet, it has to be tonight.', 0);
    }
  });
  // schedule flavour: a gala announcement reminds the player where Varga will be
  bus.on('schedule:start', (e) => {
    if (e?.event?.kind === 'reception' && engine.active.has('undertow_8')) {
      engine.message('Teodor', 'The reception\'s starting — Varga will be working the room. That card\'s in his jacket.', 0);
    }
  });
}
