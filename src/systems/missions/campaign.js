// HALCYON TIDE — "Undertow": the main campaign. Ten missions over the 7-night crossing.
// Mara Quill, a dismissed deck officer, boards as a passenger to expose owner Hollis Varga's
// casino-cage money laundering and the smuggling the ship hides — the crime her sacking covered up.
//
// Every main mission is built on the ship's systems and allows at least two genuinely different
// approaches (stealth / disguise / social / bribe vs. force). Objectives are completed by REAL game
// state (entering rooms, items in inventory, interactions, dialogue choices), never by scripted timers.
import { keycardFor } from '../inventory.js';
import { MIN, roomCentre, room, item, doorOf, near, inRoom, playerHas, inCrewDisguise } from './util.js';

// convenience target makers
const RC = (g, deck, needle, label) => () => roomCentre(g, deck, needle, label);

export function registerCampaign(E) {
  const g = E.game;
  const reg = (d) => E.register(d);

  const clearTalk = (key) => { const n = E._cast.get(key); if (n) n._talk = null; };

  // ── finale helpers (shared by undertow_10) ──────────────────────────────────
  function resolveFinale(M, who) {
    if (E.flags.finale_done) return;
    E.flags.finale_done = true; E.flags.ending = who;
    const endings = {
      okafor: ['Okafor takes the file without a word, reads for a long minute, then keys her radio.', 'ENDING — THE LONG WAY', 'You did it by the book. Varga is detained in his own suite; the ship diverts to St. John\'s. Your record is reopened. Justice, slow and certain.'],
      holt: ['The Captain reads in silence, then stands.', 'ENDING — THE MASTER\'S WORD', 'Holt relieves the owner of the ship under maritime authority. Varga is confined to quarters; the crossing finishes under her command. You get your wings back.'],
      pike: ['Pike files the moment the ship raises signal off the Scillies.', 'ENDING — THE FRONT PAGE', 'By landfall, Larkspur Oceanic is the only story in the world. Varga lawyers up and loses. Messier, louder — and nobody can bury it ever again.'],
      tender: ['The tender drops into the swell with you aboard and the file in an oilskin.', 'ENDING — OVER THE SIDE', 'Picked up by a trawler off the Scillies, you mail the evidence to three newspapers and the flag state. The ship sails on without you; Varga does not sail far.'],
      lifeboat: ['The davit groans, the boat kisses the water, and the Halcyon Tide\'s lights slide away.', 'ENDING — ADRIFT', 'Coastguard find you at dawn with a ledger and a story. It takes a year in court, but the story holds.'],
      varga: ['Varga transfers the money without blinking. That frightens you more than anything.', 'ENDING — THE UNDERTOW', 'You walk off in Southampton rich and clean. Varga sails on. Some nights you still hear the cage paying out. You chose the water.'],
    };
    const e = endings[who] || endings.okafor;
    (async () => {
      await g.ui?.fade?.(true, 900);
      if (who === 'varga') g.economy?.add?.(2000000, 'Settlement');
      else if (who !== 'tender' && who !== 'lifeboat') { try { g.security?.clear?.(); } catch {} }
      g.ui?.toast?.(e[0], { kind: 'mission', ms: 6000 });
      await g.ui?.showTitle?.(e[1], e[2], 7000);
      await g.ui?.fade?.(false, 1200);
      M.complete(who);
      M.title('UNDERTOW', 'Thank you for sailing with Larkspur Oceanic.');
      for (const k of ['okafor', 'holt', 'pike', 'varga']) clearTalk(k);
    })();
  }
  E._finale = (how) => { const M = E.api('undertow_10'); resolveFinale(M, how); };
  function wireFinale(M) {
    const wire = (key, talk) => { const n = M.ensureCast(key); if (n) n._talk = talk; };
    wire('okafor', { label: 'Hand the evidence to Chief Okafor', run: async () => {
      const warm = (g.security?.heat ?? 0) === 0;
      const pick = await M.ask({ speaker: 'Ines Okafor', role: 'Security Chief', lines: [
        warm ? 'Ms. Quill. You\'ve been busy. Convince me this isn\'t another story.' : 'You\'re wanted on half my decks and you want me to trust you?',
        'Show me what you have.',
      ], options: [{ id: 'give', text: 'Everything. The ledger, the route, the cage, the hold.' }, { id: 'hold', text: 'Not yet.' }] });
      if (pick === 'give') resolveFinale(M, 'okafor');
    } });
    wire('holt', { label: 'Take the evidence to the Captain', run: async () => {
      const pick = await M.ask({ speaker: 'Captain Rhiannon Holt', role: 'Master, MS Halcyon Tide', lines: [
        'Officer Quill. I signed off on your dismissal. I was told it was clean.',
        'If you can show me it wasn\'t, I will turn this ship around myself.',
      ], options: [{ id: 'give', text: 'Here. All of it. The owner lied to you too.' }, { id: 'hold', text: 'Give me a moment.' }] });
      if (pick === 'give') resolveFinale(M, 'holt');
    } });
    wire('pike', { label: 'Give the story to Pike', run: async () => {
      const pick = await M.ask({ speaker: 'Jonah Pike', role: 'Journalist', lines: ['Say the word and it runs the moment we have signal. Varga won\'t be able to bury a thing.'], options: [{ id: 'give', text: 'Run it. All of it.' }, { id: 'hold', text: 'Wait.' }] });
      if (pick === 'give') resolveFinale(M, 'pike');
    } });
    wire('varga', { label: 'Confront Varga', run: async () => {
      const pick = await M.ask({ speaker: 'Hollis Varga', role: 'Owner, Larkspur Oceanic', lines: [
        'Ms. Quill. The woman who wouldn\'t stay quiet. I did wonder if you\'d come to me directly.',
        'So. The righteous path, or the profitable one? Everyone has a number.',
      ], options: [{ id: 'blackmail', text: 'Two million. And my record wiped.' }, { id: 'refuse', text: "You don't have enough money for this." }] });
      if (pick === 'blackmail') resolveFinale(M, 'varga');
      else if (pick === 'refuse') { M.toast('Varga calls for security — run', 'bad'); try { g.security?.addHeat?.(3, 'confronted the owner'); } catch {} }
    } });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 1 · ALL ABOARD  (day 1 — tutorial: stateroom, map, elevators, meet Teodor during/after muster)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_1', title: 'All Aboard', act: 1, kind: 'main',
    brief: 'Find your stateroom, learn your way around, and meet Teodor Brask at The Lantern.',
    approaches: ['Explore at your own pace'],
    unlock: () => true,
    begin(M) {
      M.msg('Teodor', 'Mara — you actually came. Find your cabin, then come up to The Lantern on deck 6. We need to talk. Quietly.', 1);
      M.set('intro_sent');
    },
    update(M) {
      const teo = M.ensureCast('teodor');
      const done = E.runBeats('undertow_1', [
        M.B.custom('cabin', 'Find your stateroom (deck 9)',
          (gg) => inRoom(gg.player, 'Stateroom') && gg.player.room?.cabin === gg.player.cabin,
          { target: () => ({ deck: g.player.homeCabin?.deck ?? 9, x: g.player.homeCabin?.inX ?? g.player.homeCabin?.x ?? 0, z: g.player.homeCabin?.inZ ?? g.player.homeCabin?.z ?? 9.5, label: 'Your stateroom' }),
            onActive: () => M.toast('Open your journal (J) and ship map (M) any time', 'info') }),
        M.B.custom('muster', 'Take in the muster drill, then head up the ship',
          (gg) => gg.minutes % 1440 >= MIN(17, 8) || gg.player.deck >= 11 || E.flags.seen_atrium,
          { target: () => roomCentre(g, 5, 'Promenade Deck (Starboard)', 'Lifeboat muster station'),
            onActive: () => M.msg('Daily Programme', 'Guest safety drill at 16:45 — lifeboat stations, deck 5 promenade. After that, the ship is yours.', 0) }),
        M.B.reach('lantern', 'Meet Teodor at The Lantern (deck 6)',
          () => ({ deck: 6, x: 13.5, z: 6, label: 'The Lantern' }), 5),
        M.B.flag('talk', 'Hear Teodor out', 'teo_briefed',
          () => ({ deck: teo?.deck ?? 6, x: teo?.x ?? 11.3, z: teo?.z ?? 11.4, label: 'Teodor Brask' }),
          { onActive: () => {
            const t = E._cast.ensure('teodor'); if (!t) return;
            t._talk = { label: 'Talk to Teodor', run: async () => {
              const pick = await M.ask({ speaker: 'Teodor Brask', role: 'Bartender · The Lantern', lines: [
                'Good to see a friendly face, Mara. Though "friendly" is a stretch for what I\'m about to drop on you.',
                'Varga didn\'t just hang you out to dry over that "navigational error". He hid something far worse behind it — and he\'s doing it again on this crossing.',
                'Casino cage, the bonded store, the owner\'s own safe. I\'ve got pieces. You can get the rest. You still know this ship better than anyone aboard.',
              ], options: [
                { id: 'in', text: "I'm in. Where do we start?" },
                { id: 'why', text: 'Why me, Teodor?' },
                { id: 'later', text: 'Not here. Let me settle in first.' },
              ] });
              if (pick === 'why') await M.ask({ speaker: 'Teodor Brask', lines: ['Because it was your name on the report. Clear this and you get your life back. Walk away and he wins twice.'] });
              if (pick !== 'later') { E.flags.teo_briefed = true; t._talk = null; M.msg('Teodor', 'First thing: you need crew access. Get yourself a crew keycard — pickpocket a steward, lift one in the crew bar, or buy one off Cutter down in The Bilge.', 2); }
              else M.toast('Come back to Teodor when you\'re ready', 'info');
            } };
          } }),
      ], { title: 'All Aboard' });
      if (E.flags.seen_atrium === undefined && (g.player.deck === 4 || g.player.deck === 6) && inRoom(g.player, 'Atrium')) E.flags.seen_atrium = true;
      if (done) M.complete('arrived');
    },
    end(M, how) { clearTalk('teodor'); },
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2 · SHIP'S BUSINESS  (obtain a crew keycard — pickpocket / crew bar / buy from Cutter)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_2', title: "Ship's Business", act: 1, kind: 'main', requires: ['undertow_1'],
    brief: 'Get yourself a crew keycard. A steward carries one; the crew bar is full of them; Cutter sells anything.',
    approaches: ['Pickpocket a steward', 'Lift one in the crew bar', "Buy from Cutter (The Bilge, deck 2)"],
    begin(M) { M.set('m2_started'); },
    update(M) {
      const hasCard = () => playerHas(g, 'crew_keycard') || playerHas(g, 'master_key') || g.player.keycards?.has?.('crew') || g.player.keycards?.has?.('master');
      const done = E.runBeats('undertow_2', [
        M.B.custom('getcard', 'Acquire a crew keycard (any method)', () => hasCard(), {
          target: () => roomCentre(g, 2, 'The Bilge', 'Cutter · The Bilge crew bar'),
          onActive: () => M.msg('Teodor', "A steward's card gets you through crew doors. Cutter in The Bilge sells them — or take one the hard way.", 0),
          onDone: () => { if (!E.flags.m2_how) E.flags.m2_how = playerHas(g, 'master_key') ? 'master key' : 'crew keycard'; },
        }),
        M.B.reach('toteo', 'Show Teodor you\'re in business (The Lantern, deck 6)', () => ({ deck: 6, x: 13.5, z: 6, label: 'The Lantern' }), 4),
      ], { title: "Ship's Business" });
      if (done) {
        M.msg('Teodor', 'Now you can move. Next you\'ll need to look the part — a steward\'s uniform from Uniform Issue down on deck 1, or the laundry.', 2);
        M.complete(E.flags.m2_how || 'crew keycard');
      }
    },
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3 · UNIFORM CODE  (steward outfit + photograph the payroll ledger, deck 2 — avoid suspicion)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_3', title: 'Uniform Code', act: 1, kind: 'main', requires: ['undertow_2'],
    brief: 'Dress as crew and document the payroll ledger in the Payroll & HR Office (deck 2) without raising the alarm.',
    approaches: ['Steward disguise from Uniform Issue (deck 1)', 'Loop the CCTV first (deck 2 junction)', 'Crack the payroll safe for the severance papers'],
    begin(M) { M.set('m3_started'); },
    update(M) {
      const disguised = () => inCrewDisguise(g);
      const done = E.runBeats('undertow_3', [
        M.B.custom('dress', 'Put on a crew uniform (Uniform Issue, deck 1 — or the laundry)', () => disguised(), {
          target: () => roomCentre(g, 1, 'Uniform Issue', 'Uniform Issue & Tailor'),
          onActive: () => M.toast('A cabinet in Uniform Issue (deck 1) lets you change', 'info'),
        }),
        M.B.custom('ledger', 'Document the payroll ledger (or crack the payroll safe)',
          () => E.flags.ledger_photo || E.flags.payroll_safe, {
          target: () => roomCentre(g, 2, 'Payroll', 'Payroll & HR Office'),
          onActive: () => M.toast('Avoid suspicion — looping the CCTV junction (deck 2) buys you time', 'info'),
        }),
      ], { title: 'Uniform Code' });
      if (done) {
        E.flags.have_ledger = true;
        M.msg('Teodor', 'Good. The payments all route through the casino cage. Time to see how the laundry actually runs.', 2);
        M.complete(E.flags.payroll_safe ? 'cracked the safe' : 'photographed the ledger');
      }
    },
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4 · HOUSE EDGE  (casino: learn the laundering pattern — win big / watch the cage / swap the fill)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_4', title: 'House Edge', act: 2, kind: 'main', requires: ['undertow_3'],
    unlock: (M) => M.day >= 2 || g.minutes >= MIN(10) + 1440,   // casino lively from day 2
    brief: 'Work out how Varga launders through the Gilded Reef. Watch the cage, then get inside it.',
    approaches: ['Watch the cage from the floor', 'Play the high-limit salon to get noticed', 'Croupier disguise into the cage'],
    begin(M) { M.set('m4_started'); },
    update(M) {
      // "watch the cage": stand in the casino near the cage window for a few seconds
      if (!E.flags.cage_watched && g.player.deck === 5 && inRoom(g.player, 'Casino') && Math.hypot(g.player.x - 80, g.player.z - 13) < 14) {
        E.vars.cageWatch = (E.vars.cageWatch || 0) + 1;
        if (E.vars.cageWatch > 180) { E.flags.cage_watched = true; M.toast('You see it: oversized "chip buy-ins" at the cage, never played, cashed straight back out', 'good'); M.counters && (E.counters.evidence++); }
      }
      const done = E.runBeats('undertow_4', [
        M.B.custom('floor', 'Get onto the casino floor (Gilded Reef, deck 5)',
          (gg) => gg.player.deck === 5 && (inRoom(gg.player, 'Gilded Reef') || inRoom(gg.player, 'Casino Cage')),
          { target: () => roomCentre(g, 5, 'Gilded Reef', 'The Gilded Reef Casino'), skip: () => !!E.flags.cage_watched }),
        M.B.flag('watch', 'Watch the cage and read the pattern', 'cage_watched',
          () => ({ deck: 5, x: 80, z: 13, label: 'Casino Cage window' })),
        M.B.flag('evidence', 'Get the cage fill records (inside the cage — casino staff look helps)', 'cage_evidence',
          () => ({ deck: 5, x: 80, z: 17, label: 'Casino Cage' })),
      ], { title: 'House Edge' });
      if (done) {
        E.flags.have_cage = true;
        M.msg('Teodor', 'Clean chips out, dirty cash in. But the cash has to come aboard somewhere — the bonded store, deck 1. That\'s the dangerous part.', 2);
        M.complete(E.flags.m4_how || 'watched the cage');
      }
    },
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5 · DEAD RECKONING  (the bridge at night — copy the real route log; disguise / tour / distraction)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_5', title: 'Dead Reckoning', act: 2, kind: 'main', requires: ['undertow_4'],
    brief: 'Copy the real route log from the chart table on deck 13. The bridge tour is cover; night and a distraction are safer.',
    approaches: ["Officer's whites onto the bridge", 'Use the bridge tour (day 2/5) as cover', 'Fire-alarm distraction at night', 'Crack the Captain\'s safe for the sealed report'],
    begin(M) {
      M.set('m5_started');
      const reyes = M.ensureCast('reyes');
      if (reyes) reyes._talk = { label: 'Talk to Lt. Reyes', run: async () => {
        const pick = await M.ask({ speaker: 'Lt. Petra Reyes', role: 'Junior officer', lines: [
          'You\'re... you used to be one of us. I remember the hearing. Nobody believed the report, not really.',
          'If you\'re looking at the chart room — the tour goes up at half ten. Or wait for the night watch; it\'s just me and the helm.',
        ], options: [
          { id: 'help', text: 'Will you look the other way?' },
          { id: 'tour', text: 'Tell me about the tour.' },
          { id: 'no', text: 'Forget I asked.' },
        ] });
        if (pick === 'help') { E.flags.reyes_ally = true; M.toast('Reyes will stall the watch for you', 'good'); }
        if (pick === 'tour') M.toast('Bridge tour: day 2 and day 5, 10:30, meet at the Meridian Atrium (deck 4)', 'info');
      } };
    },
    update(M) {
      const onTour = () => g.schedule?.isOn?.('bridge-tour') || g.schedule?.isOn?.('galley-tour');
      const done = E.runBeats('undertow_5', [
        M.B.custom('getin', 'Get into the chart room / bridge (deck 13)',
          (gg) => gg.player.deck === 13 && (inRoom(gg.player, 'Chart Room') || inRoom(gg.player, 'Navigation Bridge') || inRoom(gg.player, "Captain's Day")),
          { target: () => roomCentre(g, 13, 'Chart Room', 'Chart Room (deck 13)'),
            onActive: () => M.toast(onTour() ? 'The bridge tour is on — blend in' : 'Officer whites, the tour, or a night distraction get you up here', 'info') }),
        M.B.custom('log', 'Copy the real route log (or take the sealed report from the Captain\'s safe)',
          () => E.flags.route_log || E.flags.captain_safe,
          { target: () => item(g, 13, i => i.routeLog) || roomCentre(g, 13, 'Chart Room') }),
      ], { title: 'Dead Reckoning' });
      if (done) {
        E.flags.have_route = true;
        M.msg('Teodor', 'The detour proves the cover-up. Now the smuggling itself — below the waterline. Wait for a quiet hour.', 2);
        M.complete(E.flags.captain_safe ? "captain's safe" : (E.flags.m5_how || 'route log'));
      }
    },
    end() { clearTalk('reyes'); },
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6 · BELOW THE WATERLINE  (bonded store & engine room — discover the smuggling; escape a lockdown)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_6', title: 'Below the Waterline', act: 2, kind: 'main', requires: ['undertow_5'],
    brief: 'Get into the Bonded Store on deck 1, find what Varga smuggles — and get out when the deck locks down.',
    approaches: ['Engineer / deckhand disguise through the working alley', 'Officer keycard on the watertight doors', 'Force the doors and run the lockdown'],
    begin(M) { M.set('m6_started'); E.flags.bonded_found = E.flags.bonded_found || false; },
    update(M) {
      // when the crates are searched, trigger a section lockdown on deck 1 as the escape beat
      if (E.flags.bonded_found && !E.flags.bonded_lockdown) {
        E.flags.bonded_lockdown = true;
        setTimeout(() => {
          try { g.security?.addHeat?.(2.2, 'smuggling discovered'); g.security?.lockdown?.(true, 1, { section: 'mid' }); } catch {}
          g.schedule?.say?.('Security to the bonded store. Deck one is sealed. Repeat, deck one is sealed.', { prio: 3, urgent: true });
          M.toast('They know you\'re down here — get back up the ship', 'bad');
        }, 400);
      }
      const escaped = () => E.flags.bonded_found && (g.player.deck >= 3 || (g.security?.heat ?? 0) === 0);
      const done = E.runBeats('undertow_6', [
        M.B.enter('store', 'Reach the Bonded Store (deck 1, forward of the working alley)', 1, 'Bonded Store',
          () => roomCentre(g, 1, 'Bonded Store', 'Bonded Store (deck 1)')),
        M.B.flag('find', 'Find what\'s really in the crates', 'bonded_found',
          () => roomCentre(g, 1, 'Bonded Store')),
        M.B.custom('escape', 'Escape the lockdown — get back above the waterline', () => escaped(), {
          target: () => roomCentre(g, 2, 'The Spine', 'Up and out') || ({ deck: 2, x: -4, z: 0, label: 'Up and out' }),
          onActive: () => {},
        }),
      ], { title: 'Below the Waterline' });
      if (done) {
        E.flags.have_smuggling = true;
        M.msg('Teodor', 'You made it. That\'s motive, method and opportunity. Now — the gala. Varga will be wearing the one keycard that opens his own safe.', 3);
        M.complete('escaped the hold');
      }
    },
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7 · STORM FRONT  (day 3–4 storm — protect the journalist on the open decks / forward mooring at night)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_7', title: 'Storm Front', act: 3, kind: 'main', requires: ['undertow_6'],
    unlock: (M) => (M.day >= 3) || (g.weather?.state?.storm ?? 0) > 0.4,
    brief: 'Jonah Pike, a journalist, has what Varga wants buried. Reach him on the weather decks before Varga\'s men do.',
    approaches: ['Talk him down on the mooring deck', 'Fight off the two heavies', 'Get him inside before the storm takes him'],
    begin(M) {
      M.set('m7_started');
      // place Pike out on the forward mooring deck (deck 6, exterior, bow)
      E._cast.move('pike', 6, 150, 0, Math.PI, true);
      const pike = M.ensureCast('pike');
      if (pike) { pike.noFlee = true; pike._talk = null; }
      M.msg('Jonah Pike', 'Quill? I need to meet. Forward mooring deck, deck 6, bow — now. They know I have the manifest. Hurry.', 1);
    },
    update(M) {
      const pike = M.ensureCast('pike');
      // spawn two heavies near Pike once the player gets close, if not already
      if (!E.flags.storm_thugs && g.player.deck === 6 && g.player.x > 120) {
        E.flags.storm_thugs = true;
        try {
          E.vars.thug1 = g.npcs?.spawnAt?.('crew_deckhand', 6, 144, 6, { name: 'Varga\'s man', tag: 'thug', job: 'guard', access: ['crew'] })?.id;
          E.vars.thug2 = g.npcs?.spawnAt?.('crew_deckhand', 6, 144, -6, { name: 'Varga\'s man', tag: 'thug', job: 'guard', access: ['crew'] })?.id;
        } catch {}
        g.weather?.set?.('storm', 3);
        M.toast('Two of Varga\'s men are already here — the storm is closing in', 'bad');
      }
      const done = E.runBeats('undertow_7', [
        M.B.reach('toPike', 'Reach Jonah Pike (forward mooring deck, deck 6)',
          () => ({ deck: pike?.deck ?? 6, x: pike?.x ?? 150, z: pike?.z ?? 0, label: 'Jonah Pike' }), 5),
        M.B.custom('secure', 'Get Pike to safety (talk the men down, fight them, or escort him inside)',
          () => E.flags.pike_safe, {
          target: () => ({ deck: pike?.deck ?? 6, x: pike?.x ?? 150, z: pike?.z ?? 0, label: 'Jonah Pike' }),
          onActive: () => {
            if (!pike) return;
            pike._talk = { label: 'Reassure Pike', run: async () => {
              const pick = await M.ask({ speaker: 'Jonah Pike', role: 'Journalist', lines: [
                'They were waiting for me. If I go over the rail in this weather, it\'s just another "accident".',
              ], options: [
                { id: 'inside', text: "Follow me inside. Stay behind me." },
                { id: 'fight', text: "Stay here. I'll deal with them." },
              ] });
              pike.noFlee = true;
              if (pick === 'inside') { g.npcs?.setGoal?.(pike, { type: 'follow', target: 'player' }); E.flags.pike_follow = true; M.toast('Pike is following you — get him off the weather deck', 'good'); }
              else { M.toast('Deal with Varga\'s men', 'info'); }
            } };
          },
        }),
      ], { title: 'Storm Front' });
      // success conditions
      if (!E.flags.pike_safe) {
        const thugsDown = () => { const t1 = E.vars.thug1 && g.npcs?.get?.(E.vars.thug1), t2 = E.vars.thug2 && g.npcs?.get?.(E.vars.thug2); const dn = (n) => !n || n.gone || n.state === 'ko' || n.state === 'dead'; return dn(t1) && dn(t2); };
        const inside = pike && pike.deck === 6 && pike.x < 134;  // back inside the superstructure
        if (E.flags.storm_thugs && thugsDown()) { E.flags.pike_safe = true; E.flags.pike_how = 'fought them off'; }
        else if (E.flags.pike_follow && inside) { E.flags.pike_safe = true; E.flags.pike_how = 'got him inside'; }
        else if (E.flags.pike_talk_down) { E.flags.pike_safe = true; E.flags.pike_how = 'talked them down'; }
      }
      if (done) {
        E.flags.have_journalist = true; E.flags.pike_alive = true;
        if (pike) pike._talk = null;
        g.weather?.auto?.(20);
        M.msg('Jonah Pike', 'I owe you. I\'ll hold the story until you say go. Get the last piece — the owner\'s own ledger — and I\'ll put it on every front page.', 3);
        M.complete(E.flags.pike_how || 'protected the journalist');
      }
    },
    steps(M) { return []; },
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8 · THE GALA  (formal night — lift the owner's keycard: pickpocket at the gala / bribe the purser)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_8', title: 'The Gala', act: 3, kind: 'main', requires: ['undertow_7'],
    unlock: (M) => true,
    brief: "Varga carries the only keycard to his own suite. Lift it at the gala, or buy the purser's master copy.",
    approaches: ["Pickpocket Varga on the gala floor", "Bribe Purser Daan for the master key", "Dress formal and get close at the reception"],
    begin(M) {
      M.set('m8_started');
      // Varga appears at the evening reception on formal nights; otherwise in his suite.
      const daan = M.ensureCast('daan');
      if (daan) daan._talk = { label: 'Approach Purser Daan', run: async () => {
        const cash = g.economy?.cash ?? g.player?.money ?? 0;
        const pick = await M.ask({ speaker: 'Purser Leopold Daan', role: 'Chief Purser', lines: [
          'Ms. Quill. I know exactly who you are, and I know exactly what you\'re circling.',
          'I\'m a reasonable man with an unreasonable pension to protect. The owner\'s suite master key could... go missing. For a consideration.',
        ], options: [
          { id: 'pay', text: 'A master key. §1,500.', enabled: cash >= 1500, hint: cash >= 1500 ? undefined : 'You need §1,500 in cash' },
          { id: 'lean', text: "I could tell Okafor what you skim.", enabled: !!E.flags.have_ledger },
          { id: 'walk', text: 'Not today.' },
        ] });
        if (pick === 'pay') { g.economy?.spend?.(1500, 'Bribe'); g.inventory?.add?.('master_key', 1); E.flags.owner_key = true; E.flags.m8_how = 'bribed the purser'; M.toast('Daan slides you a master key', 'good'); daan._talk = null; }
        else if (pick === 'lean') { g.inventory?.add?.('master_key', 1); E.flags.owner_key = true; E.flags.m8_how = 'leaned on the purser'; M.toast('"...Fine. Take it and we never spoke."', 'good'); daan._talk = null; }
      } };
    },
    update(M) {
      // Put Varga at the reception venue during the evening reception, else his suite.
      const recep = g.schedule?.current?.().find(e => e.kind === 'reception');
      const varga = M.ensureCast('varga');
      if (varga && recep && recep.x != null) E._cast.move('varga', recep.deck, recep.x + 2, recep.z, Math.PI);
      const hasKey = () => E.flags.owner_key || playerHas(g, 'master_key') || playerHas(g, 'cabinkey_14000') || g.player.keycards?.has?.('cabin:14000');
      // detect a pickpocket of Varga
      if (varga && !E.flags.owner_key) {
        if ((varga.identity && varga.identity._pickpocketed) || playerHas(g, 'cabinkey_14000')) { E.flags.owner_key = true; E.flags.m8_how = 'lifted it at the gala'; }
      }
      const done = E.runBeats('undertow_8', [
        M.B.custom('key', "Get into the owner's suite keycard (pickpocket Varga, or a master key)", () => hasKey(), {
          target: () => { const v = E._cast.get('varga'); return v ? { deck: v.deck, x: v.x, z: v.z, label: 'Hollis Varga' } : roomCentre(g, 2, "Purser", 'Purser Daan'); },
          onActive: () => M.toast('Varga is at the reception on formal nights — or bribe Daan on deck 2', 'info'),
        }),
      ], { title: 'The Gala' });
      if (done) {
        E.flags.have_owner_key = true;
        M.msg('Teodor', 'You have the key. His master ledger is in the suite safe on deck 14. I\'ll pull Okafor\'s patrol — go when it\'s quiet.', 2);
        M.complete(E.flags.m8_how || (playerHas(g, 'master_key') ? 'already held a master key' : 'got the key'));
      }
    },
    end() { clearTalk('daan'); },
  });

  // Hook: when the player pickpockets Varga, flag it.
  g.bus?.on('activity:pickpocket', (e) => {
    if (e?.success && e.victim?.castKey === 'varga') { if (e.victim.identity) e.victim.identity._pickpocketed = true; try { g.inventory?.add?.(keycardFor(14000), 1, { stolen: true }); } catch {} E.flags.owner_key = true; E.flags.m8_how = 'lifted it at the gala'; }
    if (e?.success && e.victim?.castKey === 'daan') { try { g.inventory?.add?.('master_key', 1); } catch {} E.flags.owner_key = true; E.flags.m8_how = 'lifted the purser\'s key'; }
  });

  // ════════════════════════════════════════════════════════════════════════
  // 9 · OWNER'S SUITE  (crack the owner's safe on deck 14 for the master ledger while security is drawn off)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_9', title: "Owner's Suite", act: 3, kind: 'main', requires: ['undertow_8'],
    brief: "The master ledger is in the safe in the Larkspur Owner's Suite, deck 14 forward. Get in, crack it, get out clean.",
    approaches: ['Slip in quietly while Varga is out', 'Loop the CCTV / pull an alarm to draw security', 'Crack the safe with a drill if you must'],
    begin(M) { M.set('m9_started'); },
    update(M) {
      const done = E.runBeats('undertow_9', [
        M.B.enter('suite', "Enter the Owner's Suite (deck 14 forward)", 14, "Owner's Suite",
          () => roomCentre(g, 14, "Owner's Suite", "Larkspur Owner's Suite")),
        M.B.flag('crack', 'Crack the safe and take the master ledger', 'owner_safe',
          () => item(g, 14, i => i.ownerSafe) || roomCentre(g, 14, "Owner's Suite")),
        M.B.custom('leave', 'Get the ledger out of the suite', () => playerHas(g, 'ledger') && !inRoom(g.player, "Owner's Suite"), {
          target: () => roomCentre(g, 14, 'Forward Crossover', 'Out of the suite') || ({ deck: 14, x: 100.5, z: 0, label: 'Out' }),
        }),
      ], { title: "Owner's Suite" });
      if (done) {
        E.flags.have_master_ledger = true;
        M.msg('Teodor', 'That\'s everything. It\'s your call now, Mara. Okafor, the Captain, the journalist — or make Varga pay to keep it buried. However it ends, end it.', 3);
        M.complete('took the ledger');
      }
    },
  });

  // ════════════════════════════════════════════════════════════════════════
  // 10 · UNDERTOW  (finale — choose who gets the evidence: Okafor / Captain / journalist / blackmail Varga)
  // ════════════════════════════════════════════════════════════════════════
  reg({
    id: 'undertow_10', title: 'Undertow', act: 4, kind: 'main', requires: ['undertow_9'],
    brief: 'You have the evidence. Decide how this ends.',
    approaches: ['Hand it to Chief Okafor (deck 2)', 'Take it to the Captain (bridge, deck 13)', 'Give it to Pike the journalist', 'Blackmail Varga for a fortune'],
    begin(M) {
      M.set('m10_started');
      M.title('UNDERTOW', 'How does it end?');
      wireFinale(M);
    },
    update(M) {
      // keep recipients wired (in case of save/load)
      if (!E.flags.finale_done) {
        const anyTalk = ['okafor', 'holt', 'pike', 'varga'].some(k => E._cast.get(k)?._talk);
        if (!anyTalk) wireFinale(M);
      }
      E.runBeats('undertow_10', [
        M.B.custom('choose', 'Decide how it ends: Okafor (deck 2) · Captain (bridge, deck 13) · Pike · or blackmail Varga',
          () => E.flags.finale_done, {
          target: () => { const o = E._cast.get('okafor'); return o ? { deck: o.deck, x: o.x, z: o.z, label: 'Chief Okafor' } : roomCentre(g, 2, 'Security Office'); },
        }),
      ], { title: 'Undertow' });
    },
  });
}
