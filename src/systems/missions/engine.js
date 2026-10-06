// HALCYON TIDE — mission engine. Drives the "Undertow" campaign, Ship Stories and Cutter's contracts.
// State machine + journal + phone messages + an objective/waypoint driver + a dialogue helper with a
// test auto-answer hook. Layout/time/heat reactive. Save-friendly.
//
// A Mission object:
//   { id, title, act?, kind:'main'|'side'|'contract', approaches?:[...], brief?,
//     requires?:[ids],                 must be completed first (main chain)
//     unlock(M) -> bool,               extra gate (day/time/flags); default always
//     repeatable?:bool,                contracts
//     begin(M), update(M, dt), end(M, how),
//     steps(M) -> [{text,done}] }       for the journal (optional; engine shows objective otherwise)
//
// Missions talk to the engine through `M` (the facade passed to every hook): see MissionAPI below.
import { B } from './util.js';

const CLOCK = (m) => { const x = ((m % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(Math.floor(x % 60)).padStart(2, '0'); };

export class MissionEngine {
  constructor(game) {
    this.game = game;
    this.defs = new Map();           // id -> mission def
    this.order = [];                 // registration order
    this.state = new Map();          // id -> { status, beat, scratch }
    this.flags = {};                 // persistent story flags
    this.vars = {};                  // persistent numeric/string vars
    this.messages = [];              // phone texts {from, text, minutes, read}
    this.active = new Set();         // currently running mission ids
    this.completed = [];             // [{id,title,minutes}]
    this.failed = [];                // [{id,title,minutes}]
    this.counters = { contracts: 0, stories: 0, evidence: 0, approaches: {} };
    this._auto = null;               // test dialogue auto-answer: id -> optionId, or fn(cfg)->optionId
    this._msgSeen = new Set();
    this._t = 0;
    this._cast = null;               // set by cast.js
    this._stories = null;            // story manager
    this._booted = false;
  }

  // ── registration ──────────────────────────────────────────────────────────
  register(def) {
    if (!def || !def.id) return;
    if (!this.defs.has(def.id)) this.order.push(def.id);
    this.defs.set(def.id, def);
    if (!this.state.has(def.id)) this.state.set(def.id, { status: 'locked', beat: 0, scratch: {} });
    return def;
  }
  def(id) { return this.defs.get(id); }
  st(id) { return this.state.get(id); }

  // ── the facade handed to missions ───────────────────────────────────────────
  api(id) {
    const E = this, g = this.game, def = this.defs.get(id), s = this.state.get(id);
    return {
      id, game: g, def,
      get flags() { return E.flags; },
      get vars() { return E.vars; },
      get player() { return g.player; },
      get heat() { return g.security?.heat ?? 0; },
      get day() { return (g.schedule?.voyageDay) ?? ((g.day % 7) + 1); },
      get hour() { return g.hour; },
      get minutes() { return g.minutes; },
      s,                                   // per-mission scratch { ...; beats runner uses s._bi }
      scratch: s.scratch,
      // story flags
      set(k, v = true) { E.flags[k] = v; return v; },
      unset(k) { delete E.flags[k]; },
      got(k) { return !!E.flags[k]; },
      inc(k, n = 1) { E.vars[k] = (E.vars[k] || 0) + n; return E.vars[k]; },
      // cast
      cast: (key) => E._cast?.get(key) || null,
      ensureCast: (key) => E._cast?.ensure(key) || null,
      // objective + waypoint (namespaced)
      objective(o) { g.ui?.setObjective?.({ id: 'mission', ...o }); },
      steps(list, opts = {}) { g.ui?.setObjective?.({ id: 'mission', title: opts.title || def.title, text: opts.text || '', steps: list, target: opts.target || null }); },
      waypoint(wp) { g.ui?.setWaypoint?.(wp || null); },
      clearObjective() { g.ui?.clearObjective?.('mission'); g.ui?.setWaypoint?.(null); },
      marker(m) { g.ui?.addMapMarker?.(m); },
      clearMarker(mid) { g.ui?.removeMapMarker?.(mid); },
      // flow
      complete: (how) => E.complete(id, how),
      fail: (reason) => E.fail(id, reason),
      // comms / feedback
      msg: (from, text, delaySec = 0) => E.message(from, text, delaySec),
      toast: (t, kind = 'info') => g.ui?.toast?.(t, { kind }),
      notify: (title, body) => g.ui?.notify?.(title, body),
      say: (text, opts) => g.schedule?.say?.(text, opts),
      title: (t, sub) => g.ui?.showTitle?.(t, sub),
      sting: (k) => g.audio?.sting?.(k),
      // dialogue (await; test hook can auto-answer)
      ask: (cfg) => E.ask(id, cfg),
      // beat runner — advances a linear sequence, updates journal, returns true when all done
      runBeats: (beats, opts) => E.runBeats(id, beats, opts),
      B,
      // handy predicates
      reward: (cash, reason) => { if (cash) g.economy?.add?.(cash, reason || def.title); },
      give: (itemId, qty = 1, meta) => { try { g.inventory?.add?.(itemId, qty, meta); } catch {} },
      has: (itemId, qty = 1) => !!(g.inventory?.has?.(itemId, qty) || g.player?.keycards?.has?.(itemId)),
      take: (itemId, qty = 1) => { try { return g.inventory?.remove?.(itemId, qty); } catch { return false; } },
    };
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────
  canStart(id) {
    const def = this.defs.get(id), s = this.state.get(id);
    if (!def || !s) return false;
    if (s.status === 'active') return false;
    if (s.status === 'completed' && !def.repeatable) return false;
    for (const r of def.requires || []) { const rs = this.state.get(r); if (!rs || rs.status !== 'completed') return false; }
    try { if (def.unlock && !def.unlock(this.api(id))) return false; } catch (e) { console.warn('[missions] unlock', id, e); return false; }
    return true;
  }
  start(id, opts = {}) {
    const def = this.defs.get(id), s = this.state.get(id);
    if (!def || !s) return false;
    if (s.status === 'active') return false;
    s.status = 'active'; s.beat = 0; s.scratch = {}; s.startedAt = this.game.minutes;
    this.active.add(id);
    this._cast?.ensureFor?.(id);
    try { def.begin?.(this.api(id)); } catch (e) { console.error('[missions] begin', id, e); }
    this.game.bus?.emit('mission:start', { id, title: def.title });
    if (def.kind !== 'contract' && !opts.silent) { try { this.game.ui?.toast?.(def.title, { kind: 'mission' }); } catch {} }
    return true;
  }
  complete(id, how) {
    const def = this.defs.get(id), s = this.state.get(id);
    if (!def || !s || s.status === 'completed' && !def.repeatable) return false;
    this.active.delete(id);
    s.status = 'completed'; s.how = how || s.how || null;
    { const prev = this.completed.find(c => c.id === id); if (prev) { prev.how = s.how; prev.minutes = this.game.minutes; } else this.completed.push({ id, title: def.title, minutes: this.game.minutes, how: s.how }); }
    if (def.kind === 'contract') this.counters.contracts++;
    if (def.kind === 'side') this.counters.stories++;
    if (how) this.counters.approaches[how] = (this.counters.approaches[how] || 0) + 1;
    try { def.end?.(this.api(id), 'complete'); } catch (e) { console.warn('[missions] end', id, e); }
    const api = this.api(id); api.clearObjective();
    this.game.bus?.emit('mission:complete', { id, title: def.title, how });
    try { this.game.audio?.sting?.('success'); } catch {}
    return true;
  }
  fail(id, reason) {
    const def = this.defs.get(id), s = this.state.get(id);
    if (!def || !s || s.status !== 'active') return false;
    this.active.delete(id);
    s.status = def.repeatable ? 'available' : 'failed';
    if (!def.repeatable && !this.failed.some(c => c.id === id)) this.failed.push({ id, title: def.title, minutes: this.game.minutes, reason });
    try { def.end?.(this.api(id), 'fail'); } catch (e) { console.warn('[missions] end', id, e); }
    this.api(id).clearObjective();
    this.game.bus?.emit('mission:failed', { id, title: def.title, reason });
    if (reason) try { this.game.ui?.toast?.(reason, { kind: 'bad' }); } catch {}
    return true;
  }
  // skip straight to a main mission (debug): mark prerequisites complete, start it.
  skipTo(id) {
    const def = this.defs.get(id); if (!def) return false;
    const chain = this.order.filter(x => this.defs.get(x)?.kind === 'main');
    for (const x of chain) { if (x === id) break; const s = this.state.get(x); if (s.status !== 'completed') { s.status = 'completed'; if (!this.completed.some(c => c.id === x)) this.completed.push({ id: x, title: this.defs.get(x).title, minutes: this.game.minutes, how: 'skipped' }); } }
    if (this.state.get(id).status === 'active') { this.active.delete(id); this.state.get(id).status = 'locked'; }
    return this.start(id);
  }

  // ── beat runner ───────────────────────────────────────────────────────────
  // beats: [{id,text,target(g,M)?,check(g,M)->bool,onActive(g,M)?,onDone(g,M)?,skip(g,M)?}]
  // Advances through them in order; the active beat shows as the tracked step with a waypoint.
  runBeats(id, beats, opts = {}) {
    const g = this.game, s = this.state.get(id), def = this.defs.get(id), api = this.api(id);
    const list = beats.filter(Boolean);
    let bi = s.beat | 0;
    // skip already-satisfied leading beats
    while (bi < list.length && list[bi].skip && list[bi].skip(g, api)) bi++;
    const cur = list[bi];
    if (cur && !s._activated) { try { cur.onActive?.(g, api); } catch (e) { console.warn('[missions] onActive', id, cur.id, e); } s._activated = cur.id; }
    if (cur && cur.check && cur.check(g, api)) {
      try { cur.onDone?.(g, api); } catch (e) { console.warn('[missions] onDone', id, cur.id, e); }
      bi++; s._activated = null;
      // advance over any now-skippable beats
      while (bi < list.length && list[bi].skip && list[bi].skip(g, api)) bi++;
      const nx = list[bi];
      if (nx) { try { nx.onActive?.(g, api); } catch {} s._activated = nx.id; }
      try { g.audio?.sting?.('success'); } catch {}
    }
    s.beat = bi;
    // render the journal objective
    const steps = list.map((b, i) => ({ text: typeof b.text === 'function' ? b.text(g, api) : b.text, done: i < bi }));
    const active = list[bi];
    let target = null;
    if (active && active.target) { try { target = active.target(g, api); } catch {} }
    api.steps(steps, { title: opts.title || def.title, text: opts.text || '', target });
    if (target) api.waypoint({ deck: target.deck, x: target.x, z: target.z, label: target.label || active.text });
    else api.waypoint(null);
    return bi >= list.length;
  }

  // ── comms ────────────────────────────────────────────────────────────────
  message(from, text, delaySec = 0) {
    const fire = () => {
      this.messages.push({ from, text, minutes: this.game.minutes, read: false });
      if (this.messages.length > 120) this.messages.shift();
      try { this.game.ui?.notify?.(from, text); } catch {}
    };
    if (delaySec > 0) setTimeout(fire, delaySec * 1000); else fire();
  }

  // ── dialogue (with test auto-answer) ────────────────────────────────────────
  async ask(id, cfg) {
    const g = this.game;
    // test hook: resolve without the UI
    if (this._auto != null) {
      let pick = typeof this._auto === 'function' ? this._auto(cfg, id) : this._auto;
      if (pick && typeof pick === 'object') pick = pick[cfg.id] ?? pick[id];
      if (pick !== undefined && pick !== null) {
        const opts = cfg.options || [];
        const chosen = opts.find(o => o.id === pick) || opts[pick] || null;
        this.game.bus?.emit('dialogue:end', { speaker: cfg.speaker, choice: chosen ? (chosen.id ?? pick) : pick });
        return chosen ? (chosen.id ?? pick) : pick;
      }
    }
    if (!g.ui?.dialogue) return null;
    return g.ui.dialogue(cfg);
  }

  // ── queries (public API surface) ───────────────────────────────────────────
  list() {
    return this.order.map(id => { const d = this.defs.get(id), s = this.state.get(id); return { id, title: d.title, kind: d.kind, act: d.act ?? null, status: s.status, approaches: d.approaches || [] }; });
  }
  stateOf(id) {
    const d = this.defs.get(id), s = this.state.get(id); if (!d || !s) return null;
    return { id, title: d.title, kind: d.kind, status: s.status, beat: s.beat, how: s.how || null, requires: d.requires || [], canStart: this.canStart(id) };
  }
  journal() {
    const activeOut = [];
    for (const id of this.active) {
      const d = this.defs.get(id), s = this.state.get(id);
      let steps = [];
      try { steps = d.steps ? d.steps(this.api(id)) : []; } catch {}
      if (!steps.length) { const o = this.game.ui?.currentObjective?.(); if (o && o.id === 'mission') steps = o.steps || []; }
      activeOut.push({ id, title: d.title, text: d.brief || '', steps });
    }
    return {
      active: activeOut,
      completed: this.completed.map(c => ({ id: c.id, title: c.title, text: c.how ? 'Resolved: ' + c.how : '' })),
      failed: this.failed.map(c => ({ id: c.id, title: c.title })),
    };
  }
  stats() {
    return {
      completed: this.completed.length,
      mainDone: this.completed.filter(c => this.defs.get(c.id)?.kind === 'main').length + '/' + this.order.filter(id => this.defs.get(id).kind === 'main').length,
      shipStories: this.counters.stories,
      contracts: this.counters.contracts,
      evidenceGathered: this.counters.evidence,
    };
  }

  // ── per-frame ───────────────────────────────────────────────────────────────
  update(dt) {
    if (!this.game.player) return;
    this._t += dt;
    // auto-start eligible main missions (campaign chain) + any auto side content
    if (this._t > 0.4 || !this._booted) {
      this._t = 0; this._booted = true;
      for (const id of this.order) {
        const def = this.defs.get(id), s = this.state.get(id);
        if (s.status !== 'locked' && s.status !== 'available') continue;
        if (def.auto === false) { if (s.status === 'locked' && this.canStart(id)) s.status = 'available'; continue; }
        if (this.canStart(id)) this.start(id);
      }
    }
    // tick active missions
    for (const id of [...this.active]) {
      const def = this.defs.get(id);
      try { def.update?.(this.api(id), dt); } catch (e) { console.error('[missions] update', id, e); }
    }
    try { this._stories?.update(dt); } catch (e) { console.error('[missions] stories', e); }
  }

  // ── save / load ───────────────────────────────────────────────────────────
  save() {
    const states = {};
    for (const [id, s] of this.state) states[id] = { status: s.status, beat: s.beat, how: s.how || null };
    return {
      flags: this.flags, vars: this.vars, states,
      active: [...this.active], completed: this.completed, failed: this.failed,
      messages: this.messages.slice(-80), counters: this.counters,
      contracts: this._contracts?.save?.() || null,
    };
  }
  load(d) {
    if (!d) return;
    this.flags = d.flags || {}; this.vars = d.vars || {};
    this.completed = d.completed || []; this.failed = d.failed || [];
    this.messages = d.messages || []; this.counters = d.counters || this.counters;
    this.active = new Set(d.active || []);
    for (const [id, s] of Object.entries(d.states || {})) { const cur = this.state.get(id) || { scratch: {} }; this.state.set(id, { status: s.status, beat: s.beat || 0, scratch: {}, how: s.how }); }
    try { this._contracts?.load?.(d.contracts); } catch {}
    // re-arm active missions: re-run begin() to restore spawns/objective, then let beat index resume
    for (const id of [...this.active]) {
      const def = this.defs.get(id); const s = this.state.get(id);
      const savedBeat = s.beat; s.scratch = {};
      this._cast?.ensureFor?.(id);
      try { def.begin?.(this.api(id)); } catch (e) { console.warn('[missions] re-begin', id, e); }
      s.beat = savedBeat;
    }
  }
}

export { CLOCK };
