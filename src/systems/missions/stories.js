// HALCYON TIDE — "Ship Stories": emergent side encounters triggered by location + time, each with
// variants and real-system resolutions. Driven by a lightweight manager so they don't clutter the main
// mission state machine. Each story: { id, title, trigger(g)->bool, cooldownH, begin(S), update(S,dt) }.
// S is a small facade (toast/msg/objective/ask/spawn/complete) with per-story scratch.
import { roomCentre, room, near, inRoom } from './util.js';

export class StoryManager {
  constructor(game, engine) {
    this.game = game; this.engine = engine; engine._stories = this;
    this.defs = []; this.byId = new Map();
    this.activeId = null; this.scratch = {};
    this.lastFired = {};           // id -> game minutes
    this._t = 0;
    this._spawned = [];            // NPCs spawned by the running story (cleaned up when it ends or is preempted)
    this._register();
  }
  add(def) { this.defs.push(def); this.byId.set(def.id, def); }

  facade(def) {
    const g = this.game, E = this.engine, S = this.scratch;
    return {
      id: def.id, game: g, s: S, engine: E,
      get player() { return g.player; }, get day() { return g.schedule?.voyageDay ?? ((g.day % 7) + 1); }, get hour() { return g.hour; },
      toast: (t, k = 'info') => g.ui?.toast?.(t, { kind: k }),
      msg: (from, text, d = 0) => E.message(from, text, d),
      objective: (o) => g.ui?.setObjective?.({ id: 'story', ...o }),
      waypoint: (w) => g.ui?.setWaypoint?.(w || null),
      clear: () => { g.ui?.clearObjective?.('story'); if (!E.active.size) g.ui?.setWaypoint?.(null); },
      ask: (cfg) => E.ask('story:' + def.id, cfg),
      reward: (c, r) => { if (c) g.economy?.add?.(c, r || def.title); },
      give: (id, q = 1) => { try { g.inventory?.add?.(id, q); } catch {} },
      has: (id, q = 1) => !!(g.inventory?.has?.(id, q) || g.player?.keycards?.has?.(id)),
      spawn: (role, deck, x, z, opts) => { try { const n = g.npcs?.spawnAt?.(role, deck, x, z, opts); if (n) this._spawned.push(n); return n; } catch { return null; } },
      setGoal: (n, goal) => g.npcs?.setGoal?.(n, goal),
      npcAt: (deck, x, z, r, f) => g.npcs?.nearest?.(deck, x, z, r, f) || null,
      roomCentre: (d, n, l) => roomCentre(g, d, n, l),
      done: (reward, note) => this._finish(def.id, reward, note),
    };
  }

  // retire the current story's NPCs: disarm their talk and let them leave (removed once off-screen, or after a beat)
  _cleanup(keepCast = true) {
    const g = this.game, list = this._spawned; this._spawned = [];
    for (const k of Object.keys(this.scratch || {})) { const v = this.scratch[k]; if (v && typeof v === 'object' && '_talk' in v) v._talk = null; }
    for (const n of list) {
      if (!n || n.gone) continue;
      n._talk = null;
      if (keepCast && n.castKey) continue;
      setTimeout(() => { try { if (!n.gone) g.npcs?.remove?.(n); } catch {} }, 6000);
    }
  }
  start(id) {
    const def = this.byId.get(id); if (!def) return false;
    if (this.activeId) this._cleanup();
    this.activeId = id; this.scratch = {}; this.lastFired[id] = this.game.minutes;
    try { def.begin?.(this.facade(def)); } catch (e) { console.warn('[story] begin', id, e); }
    this.engine.counters && null;
    return true;
  }
  _finish(id, reward, note) {
    const def = this.byId.get(id); const f = this.facade(def);
    f.clear();
    if (reward) f.reward(reward, def.title);
    if (note) f.toast(note, 'good');
    this.engine.counters.stories++;
    this.lastFired[id] = this.game.minutes;
    if (this.activeId === id) { this._cleanup(); this.activeId = null; this.scratch = {}; }
    this.game.bus?.emit('mission:complete', { id: 'story:' + id, title: def.title, how: 'ship story' });
  }

  update(dt) {
    const g = this.game, p = g.player; if (!p) return;
    this._t += dt;
    if (this.activeId) {
      const def = this.byId.get(this.activeId);
      try { def.update?.(this.facade(def), dt); } catch (e) { console.warn('[story] update', this.activeId, e); }
      return;
    }
    if (this._t < 0.7) return; this._t = 0;
    // pick a triggerable story (location/time), respecting cooldowns
    for (const def of this.defs) {
      const last = this.lastFired[def.id] ?? -1e9;
      if (g.minutes - last < (def.cooldownH ?? 6) * 60) continue;
      let ok = false; try { ok = def.trigger(g); } catch {}
      if (ok) { this.start(def.id); break; }
    }
  }

  save() { return { lastFired: this.lastFired, activeId: this.activeId }; }
  load(d) { if (d) { this.lastFired = d.lastFired || {}; /* don't resume mid-story */ this.activeId = null; } }

  // ── the stories ───────────────────────────────────────────────────────────
  _register() {
    const atrium = (g) => g.player.deck === 6 && inRoom(g.player, 'Atrium');
    // 1 · Lost child → follow you back to their cabin
    this.add({ id: 'lost_child', title: 'A Lost Child', cooldownH: 8,
      trigger: (g) => g.player.deck === 4 && inRoom(g.player, 'Atrium') && g.hour > 9 && g.hour < 21,
      begin(S) {
        const child = S.spawn('child', 4, 10, -4, { name: 'Lila', tag: 'lost_child', noFlee: true });
        S.s.child = child; S.s.cabin = (() => { const cs = (S.game.layout.cabins || []).filter(c => !c.crew && c.deck >= 9 && c.deck <= 11); return cs[(S.game.day * 37 + 11) % Math.max(1, cs.length)]; })() || { no: 9120, deck: 9, inX: 60, inZ: 9.5, x: 60, z: 9.5 };
        if (child) child._talk = { label: 'Help the child', run: async () => {
          await S.ask({ speaker: 'Lila', role: 'Lost child', lines: ["I can't find my mum and dad. Our room is a nine... something."], options: [{ id: 'ok', text: "I'll take you back. Stay close." }] });
          S.setGoal(child, { type: 'follow', target: 'player' }); S.s.following = true;
          S.objective({ title: 'A Lost Child', text: 'Walk Lila back to her family', steps: [{ text: 'Take Lila to stateroom ' + S.s.cabin.no + ' (deck ' + S.s.cabin.deck + ')' }], target: { deck: S.s.cabin.deck, x: S.s.cabin.inX ?? S.s.cabin.x, z: S.s.cabin.inZ ?? S.s.cabin.z, label: 'Lila\'s cabin' } });
        } };
        S.msg('Sunny Marsh', 'Mara — spotted a little one on her own near Guest Services on deck 4. Could you help her find her folks?', 0);
        S.toast('A child is looking for her parents near Guest Services (deck 4)', 'info');
      },
      update(S) {
        const c = S.s.child;
        if (S.s.following && c && !c.gone) {
          const t = S.s.cabin;
          const near = (a) => a.deck === t.deck && Math.hypot(a.x - (t.doorX ?? t.inX ?? t.x), a.z - (t.doorZ ?? t.inZ ?? t.z)) < 4.5;
          const pl = S.player;
          if (near(c) || (near(pl) && c.deck === pl.deck && Math.hypot(c.x - pl.x, c.z - pl.z) < 6)) { S.setGoal(c, { type: 'idle' }); S.done(40, 'Lila is home safe — her parents are grateful'); setTimeout(() => S.game.npcs?.remove?.(c), 4000); }
        }
      } });

    // 2 · Drunk guest picks a fight at the pub
    this.add({ id: 'pub_brawl', title: 'Last Orders', cooldownH: 10,
      trigger: (g) => g.player.deck === 5 && inRoom(g.player, 'Driftwood') && g.hour > 20,
      begin(S) {
        const drunk = S.spawn('passenger', 5, -66, -6, { name: 'A drunk guest', tag: 'drunk', noFlee: true });
        S.s.drunk = drunk;
        if (drunk) { drunk.persona = { ...(drunk.persona || {}), drunk: true, rude: true };
          drunk._talk = { label: 'Deal with the drunk', run: async () => {
            const pick = await S.ask({ speaker: 'Drunk Guest', lines: ["You lookin' at me? This is MY ship, pal."], options: [
              { id: 'calm', text: 'Easy. Let me buy you a coffee.' }, { id: 'back', text: 'Back off.' }, { id: 'shove', text: '[Shove him down]' } ] });
            if (pick === 'calm') { S.give('coffee', 1); S.done(25, 'You talk him down — the barman nods his thanks'); }
            else if (pick === 'shove') { try { S.game.npcs?.knockOut?.(drunk, 40); } catch {} S.done(10, 'He goes down hard. Not elegant, but quiet.'); }
            else { S.toast('He squares up — careful', 'warn'); }
          } };
        }
        S.toast('A drunk guest is spoiling for a fight at the Driftwood Arms', 'info');
      },
      update(S) { if (S.s.drunk && (S.s.drunk.gone || S.s.drunk.state === 'ko')) { /* handled */ } } });

    // 3 · Seasick passenger needs pills from the Medical Centre
    this.add({ id: 'seasick', title: 'Green Around the Gills', cooldownH: 9,
      trigger: (g) => (g.weather?.state?.storm ?? 0) > 0.4 && g.player.deck >= 5 && g.player.deck <= 9,
      begin(S) {
        const guest = S.spawn('passenger', S.player.deck, S.player.x + 4, S.player.z, { name: 'Queasy Guest', tag: 'seasick', noFlee: true });
        S.s.guest = guest; S.s.deck = S.player.deck;
        if (guest) guest._talk = { label: 'Check on the guest', run: async () => {
          const have = S.has('seasick_pills');
          const pick = await S.ask({ speaker: 'Queasy Guest', lines: ["This swell is killing me. I don't suppose you have anything?"], options: [
            { id: 'give', text: 'Here — seasickness pills.', enabled: have, hint: have ? undefined : 'You have none — the Medical Centre (deck 3) has them' },
            { id: 'fetch', text: "I'll get some from the Medical Centre." } ] });
          if (pick === 'give') { S.game.inventory?.remove?.('seasick_pills', 1); S.done(20, 'They go green-to-grateful in about a minute'); }
          else { S.s.fetching = true; S.objective({ title: 'Green Around the Gills', text: 'Fetch seasickness pills', steps: [{ text: 'Get pills from the Medical Centre (deck 3)' }], target: { deck: 3, x: 24, z: 19.5, label: 'Medical Centre' } }); }
        } };
        S.toast('A seasick guest could use a hand', 'info');
      },
      update(S) {
        if (S.s.fetching && S.has('seasick_pills')) { S.toast('Take the pills back to the guest', 'info'); S.s.fetching = false; S.s.returning = true; }
        if (S.s.returning && S.s.guest && !S.s.guest.gone && S.player.deck === S.s.guest.deck && Math.hypot(S.player.x - S.s.guest.x, S.player.z - S.s.guest.z) < 2.2) { S.game.inventory?.remove?.('seasick_pills', 1); S.done(25, 'Crisis averted'); }
      } });

    // 4 · A couple's argument on a balcony / in a bar
    this.add({ id: 'lovers_quarrel', title: 'A Quiet Word', cooldownH: 12,
      trigger: (g) => g.player.deck === 6 && inRoom(g.player, 'Lantern') && g.hour > 18,
      begin(S) {
        S.s.a = S.spawn('passenger', 6, 2, -6, { name: 'Guest', tag: 'quarrel', dress: 'evening', noFlee: true });
        if (S.s.a) S.s.a._talk = { label: 'Step in', run: async () => {
          const pick = await S.ask({ speaker: 'Upset Guest', lines: ["We've ruined the whole trip arguing. I don't even remember why."], options: [
            { id: 'kind', text: "It's not too late to turn the evening around." }, { id: 'mind', text: 'None of my business.' } ] });
          if (pick === 'kind') S.done(15, 'A small kindness — they order champagne and make up');
          else S.done(0, 'You leave them to it');
        } };
        S.toast('A couple are quarrelling at The Lantern', 'info');
      }, update() {} });

    // 5 · Jewel thief rival — foil or partner
    this.add({ id: 'rival_thief', title: 'Professional Courtesy', cooldownH: 14,
      trigger: (g) => g.player.deck === 5 && inRoom(g.player, 'Tidewell') && g.hour > 11,
      begin(S) {
        const vane = S.engine?._cast?.ensure?.('vane') || S.spawn('passenger', 5, 35, 7, { name: 'Celeste Vane', tag: 'rival', dress: 'evening', noFlee: true });
        S.s.vane = vane;
        if (vane) vane._talk = { label: 'Talk to Celeste Vane', run: async () => {
          const pick = await S.ask({ speaker: 'Celeste Vane', role: 'Fellow traveller', lines: [
            "I've seen you working the ship. Takes one to know one.",
            'There\'s a necklace in the Tidewell window worth more than this tub. Partner up, or stay out of my way.' ], options: [
            { id: 'partner', text: 'Partners. 50/50.' }, { id: 'foil', text: 'I\'ll be tipping security.' }, { id: 'walk', text: 'Not interested.' } ] });
          if (pick === 'partner') { S.done(400, 'You split the take — a useful contact for later'); S.engine.flags.vane_ally = true; }
          else if (pick === 'foil') { S.toast('Vane melts into the crowd — you\'ve made an enemy', 'warn'); S.done(0); S.engine.flags.vane_enemy = true; }
          else S.done(0);
        } };
        S.toast('A sharp-eyed passenger is casing the jewellers', 'info');
      }, update() {} });

    // 6 · Stowaway in the laundry
    this.add({ id: 'stowaway', title: 'Below Decks', cooldownH: 16,
      trigger: (g) => g.player.deck === 1 && inRoom(g.player, 'Laundry'),
      begin(S) {
        const sw = S.spawn('passenger', 1, 46, 10.5, { name: 'Stowaway', tag: 'stowaway', dress: 'casual', noFlee: true });
        S.s.sw = sw;
        if (sw) sw._talk = { label: 'Confront the stowaway', run: async () => {
          const pick = await S.ask({ speaker: 'Stowaway', lines: ["Please — don't turn me in. I just need to reach Southampton. I'll do anything."], options: [
            { id: 'help', text: 'Keep your head down. I didn\'t see you.' }, { id: 'turn', text: 'Hand them to security.' } ] });
          if (pick === 'help') { S.done(0, 'They press a crumpled note into your hand — a crew locker code, they say'); S.give('safe_note', 1); S.engine.flags.stowaway_helped = true; }
          else { try { S.game.security?.report?.({ type: 'trespass' }); } catch {} S.done(30, 'Security collects the stowaway. The purser slips you a reward'); }
        } };
        S.toast('Someone is hiding among the laundry carts', 'info');
      }, update() {} });

    // 7 · Engineer's missing tool in the engine room
    this.add({ id: 'lost_tool', title: 'A Borrowed Spanner', cooldownH: 12,
      trigger: (g) => g.player.deck === 1 && (inRoom(g.player, 'Engineering Workshop') || inRoom(g.player, 'Engine Control')),
      begin(S) {
        const eng = S.spawn('crew_engineer', 1, -95, -5, { name: 'Engineer Sato', tag: 'engineer', noFlee: true });
        S.s.eng = eng; S.s.toolAt = { deck: 1, x: -140, z: 12 };   // dropped in Engine Room No.1
        if (eng) eng._talk = { label: 'Talk to Engineer Sato', run: async () => {
          if (S.has('screwdriver')) { S.game.inventory?.remove?.('screwdriver', 1); S.done(35, 'Sato takes the tool with a grin and waves you off'); return; }
          await S.ask({ speaker: 'Engineer Sato', lines: ["Lost my torque wrench somewhere in Engine Room No.1. Chief'll have my hide. See it anywhere?"], options: [{ id: 'ok', text: "I'll keep an eye out." }] });
          S.s.looking = true;
          S.objective({ title: 'A Borrowed Spanner', text: 'Find the engineer\'s tool', steps: [{ text: 'Search Engine Room No.1 (deck 1, aft)' }], target: { ...S.s.toolAt, label: 'Engine Room No.1' } });
        } };
        S.toast("An engineer has lost a tool somewhere aft", 'info');
      },
      update(S) {
        if (S.s.looking && !S.s.found && S.player.deck === 1 && near(S.player, 1, S.s.toolAt.x, S.s.toolAt.z, 3)) { S.s.found = true; S.give('screwdriver', 1); S.toast('Found the wrench — take it back to Sato', 'good'); S.objective({ title: 'A Borrowed Spanner', text: 'Return the tool to Sato', steps: [{ text: 'Found it', done: true }, { text: 'Return to Engineer Sato' }], target: { deck: 1, x: S.s.eng?.x ?? -95, z: S.s.eng?.z ?? -5, label: 'Engineer Sato' } }); }
        if (S.s.found && S.s.eng && !S.s.eng.gone && near(S.player, 1, S.s.eng.x, S.s.eng.z, 2.4) && S.has('screwdriver')) { S.game.inventory?.remove?.('screwdriver', 1); S.done(35, 'Sato slips you a tenner and a nod — you keep an engineer on side'); }
      } });

    // 8 · Guest who lost their keycard
    this.add({ id: 'lost_keycard', title: 'Locked Out', cooldownH: 10,
      trigger: (g) => (g.player.deck >= 7 && g.player.deck <= 12) && (g.player.room?.type === 'corridor') && g.hour > 10 && g.hour < 23,
      begin(S) {
        const guest = S.spawn('elderly', S.player.deck, S.player.x + 3, S.player.z, { name: 'Locked-out Guest', tag: 'locked', noFlee: true });
        S.s.guest = guest;
        if (guest) guest._talk = { label: 'Help the guest', run: async () => {
          await S.ask({ speaker: 'Locked-out Guest', lines: ["I've gone and lost my cruise card and I can't raise anyone. My cabin's right there and I can't get in."], options: [{ id: 'ok', text: "I'll walk you to Guest Services." }] });
          S.setGoal(guest, { type: 'follow', target: 'player' }); S.s.escort = true;
          S.objective({ title: 'Locked Out', text: 'Escort the guest to Guest Services', steps: [{ text: 'Take them to the Meridian Atrium (deck 4)' }], target: { deck: 4, x: 5, z: 11, label: 'Guest Services' } });
        } };
        S.toast('A guest is locked out of their cabin', 'info');
      },
      update(S) { const gt = S.s.guest; if (S.s.escort && gt && !gt.gone && gt.deck === 4 && Math.hypot(gt.x - 5, gt.z - 11) < 6) { S.setGoal(gt, { type: 'idle' }); S.done(20, 'Guest Services sorts them out — grateful thanks'); setTimeout(() => S.game.npcs?.remove?.(gt), 4000); } } });

    // 9 · Sunny's daily trivia — rewards observing the ship
    this.add({ id: 'trivia', title: "Sunny's Trivia", cooldownH: 20,
      trigger: (g) => g.player.deck === 4 && inRoom(g.player, 'Atrium') && g.hour > 10 && g.hour < 18,
      begin(S) {
        const sunny = S.engine?._cast?.ensure?.('sunny'); S.s.sunny = sunny;
        const QS = [
          { q: 'Quick one, Mara! How many decks does the Halcyon Tide have?', opts: [['15', 0], ['17', 1], ['19', 0]], a: 1 },
          { q: 'What\'s the name of our owner\'s shipping line?', opts: [['Larkspur Oceanic', 1], ['Meridian Lines', 0], ['Halcyon Group', 0]], a: 0 },
          { q: 'Which deck is the Gilded Reef Casino on?', opts: [['Deck 5', 1], ['Deck 2', 0], ['Deck 9', 0]], a: 0 },
          { q: 'Where would you muster in an emergency?', opts: [['The bridge', 0], ['Deck 5 promenade', 1], ['The casino', 0]], a: 1 },
        ];
        const Q = QS[(S.game.day) % QS.length];
        if (sunny) sunny._talk = { label: 'Answer Sunny\'s trivia', run: async () => {
          const pick = await S.ask({ speaker: 'Sunny Marsh', role: 'Cruise Director', lines: [Q.q], options: Q.opts.map(([t], i) => ({ id: String(i), text: t })) });
          if (Number(pick) === Q.a) S.done(30, 'Correct! Sunny hands you a little Larkspur pin and a wink');
          else S.done(0, '"Ooh, so close! Try again tomorrow."');
        } };
        S.toast('Sunny Marsh has today\'s trivia question', 'info');
      }, update() {} });

    // 10 · Medical emergency — a guest has collapsed (fetch the doctor)
    this.add({ id: 'collapse', title: 'Man Down', cooldownH: 18,
      trigger: (g) => g.player.deck === 15 && inRoom(g.player, 'Pool') && g.hour > 11 && g.hour < 18,
      begin(S) {
        const guest = S.spawn('elderly', 15, S.player.x + 3, S.player.z, { name: 'Collapsed Guest', tag: 'collapse' });
        S.s.guest = guest; if (guest) { try { S.game.npcs?.knockOut?.(guest, 999); } catch {} }
        S.msg('Sunny Marsh', 'Mara! A guest has collapsed by the Sunward pool. Get Dr. Venn from the Medical Centre, deck 3, fast!', 0);
        S.objective({ title: 'Man Down', text: 'Fetch the ship\'s doctor', steps: [{ text: 'Get Dr. Venn (Medical Centre, deck 3)' }], target: { deck: 3, x: 15, z: 11.8, label: 'Dr. Venn' } });
        S.s.phase = 'fetch';
      },
      update(S) {
        if (S.s.phase === 'fetch' && S.player.deck === 3 && inRoom(S.player, 'Medical')) {
          S.s.phase = 'bring'; const venn = S.engine?._cast?.ensure?.('venn'); if (venn) S.setGoal(venn, { type: 'follow', target: 'player' }); S.s.venn = venn;
          S.objective({ title: 'Man Down', text: 'Lead the doctor to the pool deck', steps: [{ text: 'Got the doctor', done: true }, { text: 'Return to the Sunward Pool (deck 15)' }], target: { deck: 15, x: S.s.guest?.x ?? 20, z: S.s.guest?.z ?? 0, label: 'Collapsed guest' } });
        }
        if (S.s.phase === 'bring' && S.s.venn && S.player.deck === 15 && near(S.player, 15, S.s.guest?.x ?? 20, S.s.guest?.z ?? 0, 6)) {
          S.setGoal(S.s.venn, { type: 'idle' }); S.done(50, 'Dr. Venn stabilises the guest — you likely saved a life');
          setTimeout(() => { if (S.s.venn) S.engine._cast.move('venn', 3, 15, 11.8, Math.PI, false); }, 5000);
        }
      } });
  }
}
