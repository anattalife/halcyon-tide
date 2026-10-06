// HALCYON TIDE — save / load (game.save).
//
//   game.save.register(key, { save: () => json, load: (json) => void })   systems register themselves
//   game.save.saveSlot(n) → bool        n: 0 = autosave, 1..3 manual slots
//   game.save.loadSlot(n) → bool
//   game.save.hasSave(n) → bool         (n omitted → any slot)
//   game.save.autosave() → bool
//   extras: info(n) → {t, deck, room, minutes, day, label} | null, latest() → slot number | -1, remove(n), slots (count),
//           lastAutosave (game minutes), version
// Built-in registrations: 'player' (position, deck, yaw, health, appearance, disguise, keycards, money),
// 'clock' (game.minutes), 'weather' (env.weather incl. target), 'schedule' (event/PA progress).
// Other systems: 'doors' (doors.js), 'weatherSys' (weather.js override), 'inventory', 'economy', 'medallions',
// 'activities' (jobs etc.), 'security' (heat/record/locker/jail/CCTV/NPC fates), 'missions'.
// Bus 'save:ready' (api) is emitted once at install so earlier-installed systems can register.
// Autosaves every 5 game hours and on bus 'mission:complete'. localStorage, versioned, every access try/catch.
// Bus out: 'save:done' {slot, auto}, 'save:loaded' {slot}, 'save:error' {slot, error}.

export const SAVE_VERSION = 1;
const PREFIX = 'ht.save.v' + SAVE_VERSION + '.';
const SLOTS = 4;                 // 0 autosave + 3 manual
const AUTOSAVE_EVERY = 5 * 60;   // game minutes

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { console.warn('[save] write failed', e); return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch {} }

export function installSave(game) {
  if (game.save && game.save._installed) return game.save;
  const reg = new Map();
  let lastAuto = game.minutes;
  let busy = false;

  const readSlot = (n) => {
    const raw = lsGet(PREFIX + n); if (!raw) return null;
    try { const j = JSON.parse(raw); return j && j.version === SAVE_VERSION ? j : null; } catch { return null; }
  };

  const api = {
    _installed: true,
    version: SAVE_VERSION,
    slots: SLOTS,
    get lastAutosave() { return lastAuto; },
    register(key, h) { if (key && h && typeof h.save === 'function') reg.set(key, h); return api; },
    unregister(key) { reg.delete(key); },
    keys() { return [...reg.keys()]; },
    saveSlot(n = 1, opts = {}) {
      if (busy) return false;
      busy = true;
      try {
        const data = {};
        for (const [k, h] of reg) {
          try { const v = h.save(); if (v !== undefined) data[k] = v; } catch (e) { console.warn('[save] save failed for', k, e); }
        }
        const p = game.player;
        const meta = {
          deck: p?.deck ?? null, room: p?.room?.name || '', minutes: game.minutes, day: game.day,
          label: opts.label || (n === 0 ? 'Autosave' : 'Slot ' + n), objective: game.ui?.currentObjective?.()?.title || '',
        };
        const ok = lsSet(PREFIX + n, JSON.stringify({ version: SAVE_VERSION, t: Date.now(), meta, data }));
        if (ok) game.bus?.emit('save:done', { slot: n, auto: !!opts.auto });
        else game.bus?.emit('save:error', { slot: n, error: 'storage' });
        return ok;
      } finally { busy = false; }
    },
    loadSlot(n = 1) {
      const j = readSlot(n); if (!j) return false;
      // load in registration order so that the player/world come before dependants
      for (const [k, h] of reg) {
        if (!(k in j.data) || typeof h.load !== 'function') continue;
        try { h.load(j.data[k]); } catch (e) { console.warn('[save] load failed for', k, e); }
      }
      lastAuto = game.minutes;
      game.bus?.emit('save:loaded', { slot: n });
      return true;
    },
    hasSave(n) {
      if (n == null) { for (let i = 0; i < SLOTS; i++) if (readSlot(i)) return true; return false; }
      return !!readSlot(n);
    },
    info(n) { const j = readSlot(n); return j ? { t: j.t, ...j.meta } : null; },
    latest() { let best = -1, bt = -1; for (let i = 0; i < SLOTS; i++) { const j = readSlot(i); if (j && j.t > bt) { bt = j.t; best = i; } } return best; },
    remove(n) { lsDel(PREFIX + n); },
    autosave() {
      const p = game.player;
      if (game.ui?.titleActive) return false;
      if (p && (p.state === 'dead' || p.state === 'arrested')) return false;
      lastAuto = game.minutes;
      return api.saveSlot(0, { auto: true });
    },
  };
  game.save = api;

  // ── built-in registrations ─────────────────────────────────────────────
  api.register('player', {
    save() {
      const p = game.player; if (!p) return undefined;
      let appearance = null;
      try { appearance = p.appearance ? JSON.parse(JSON.stringify(p.appearance)) : null; } catch {}
      return {
        deck: p.deck, x: p.x, z: p.z, yaw: p.yaw, health: p.health,
        disguise: p.disguise || null, appearance, keycards: p.keycards ? [...p.keycards] : [],
        money: p.money, cabin: p.cabin,
      };
    },
    load(d) {
      const p = game.player; if (!p || !d) return;
      if (p.state === 'seated') try { p.standUp(); } catch {}
      if (p.state === 'dead' || p.state === 'arrested') { try { p.revive?.(); } catch {} p.state = 'free'; }
      p.animOverride = null; p._animT = 0; p.lockControls?.(false);
      if (Number.isFinite(d.x) && Number.isFinite(d.z) && d.deck) p.teleport(d.deck, d.x, d.z, d.yaw ?? p.yaw, { strict: true });
      if (Number.isFinite(d.health)) p.health = Math.max(1, Math.min(100, d.health));
      if (Array.isArray(d.keycards) && p.keycards) for (const k of d.keycards) p.keycards.add(k);
      if (Number.isFinite(d.money) && !game.economy) p.money = d.money;
      try {
        if (d.disguise && p.wearDisguise) p.wearDisguise(d.disguise);
        else if (p.baseAppearance && p.removeDisguise) p.removeDisguise();
        else if (d.appearance && p.setAppearance) p.setAppearance(d.appearance);
      } catch (e) { console.warn('[save] appearance', e); }
    },
  });
  api.register('clock', {
    save: () => ({ minutes: game.minutes }),
    load: (d) => { if (d && Number.isFinite(d.minutes)) game.minutes = d.minutes; },
  });
  api.register('weather', {
    save: () => { const w = game.env?.weather; if (!w) return undefined; const { cloud, storm, rain, fog, wind, target } = w; return { cloud, storm, rain, fog, wind, target: target ? { ...target } : null }; },
    load: (d) => {
      const w = game.env?.weather; if (!w || !d) return;
      for (const k of ['cloud', 'storm', 'rain', 'fog', 'wind']) if (Number.isFinite(d[k])) w[k] = d[k];
      // game.weather owns the target object (its override/timeline is restored under 'weatherSys'); keep its reference
      if (game.weather?.target && d.target) { Object.assign(game.weather.target, d.target); w.target = game.weather.target; }
      else if (!game.weather) w.target = d.target || null;
    },
  });
  // schedule progress: which of today's/yesterday's events already ran and which PAs were made, so a load neither
  // replays the day's announcements nor re-opens finished events
  api.register('schedule', {
    save: () => { const S = game.schedule; if (!S) return undefined; return { state: [...S.state].filter(([, v]) => v), paDone: [...S.paDone].slice(-300), curDay: S.curDay }; },
    load: (d) => {
      const S = game.schedule; if (!S || !d) return;
      S.state = new Map(d.state || []); S.paDone = new Set(d.paDone || []); S.queue.length = 0;
      S.curDay = d.curDay ?? S.curDay; S.lastMinutes = game.minutes;
    },
  });

  game.bus?.emit('save:ready', api);

  // ── autosave triggers ──────────────────────────────────────────────────
  game.bus?.on('mission:complete', () => setTimeout(() => api.autosave(), 1500));
  game.addSystem({
    name: 'autosave', order: 98,
    update() {
      if (game.minutes < lastAuto) lastAuto = game.minutes;      // clock was set back (load / debug)
      if (game.minutes - lastAuto >= AUTOSAVE_EVERY) {
        const p = game.player;
        const busyUI = game.ui?.isBusy?.();
        if (busyUI || (game.security?.heat ?? 0) > 0 || (p && p.state !== 'free' && p.state !== 'seated')) return;   // try again next frame
        api.autosave();
      }
    },
  });
  return api;
}
