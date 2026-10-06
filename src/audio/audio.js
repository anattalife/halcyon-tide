// HALCYON TIDE — audio system.
//   installAudio(game) → AudioSystem (registered as game system 'audio', order 90, runs while paused)
// Fully procedural Web Audio: ambience beds crossfaded by listener context, positional generative venue
// music, a heat-driven tension score, positional one-shots with distance/deck/wall occlusion, alarms,
// PA announcements and NPC barks through speechSynthesis. See the bottom of this file for the bus API.
import { deckOfY, deckY, CORES, CREW_CORES, SHIP } from '../core/config.js';
import { modal as _modal, makeLib, createMixer, gain, filter, noise, osc, rand, pick, chance, clamp, makeBabble, vocal, VOWELS, panner2, CHANNELS, shaper } from './dsp.js';
import { SFX, SFX_NAMES, footstep as footstepGen, doorSound, elevatorChime, fireBell, klaxon, musterPattern, securityTone, paChime, gullCall, creak, metalHit, woodKnock, coins, chipClack, bubble, chimeNote, thud, whoosh } from './sfx.js';
import { Band, styleForRoom, venueActive, sting } from './music.js';

const LS_KEY = 'ht.audio.v1';
const DEFAULT_VOL = { master: 0.8, music: 0.7, sfx: 0.9, ambience: 0.85, voice: 1 };
const MAX_VOICES = 56;

// expected crowd sizes per room `dens` when no NPC system is available
const CROWD = { transit: 4, atrium: 18, dining: 26, buffet: 28, bar: 14, club: 30, casino: 22, theater: 12, shop: 5, lounge: 8, spa: 3, gym: 4, kids: 12,
  medical: 2, crewtransit: 3, crewmess: 12, crewbar: 10, office: 3, galley: 7, store: 1, laundry: 3, engine: 1, security: 3, bridge: 3,
  deck: 6, promenade: 8, pool: 26, swim: 20, sport: 6 };
// how loud each sfx carries (reference distance in m) and its channel
const SFX_REF = { gunshot: 14, ship_horn: 120, thunder: 400, scream: 6, alarm_beep: 3, whistle: 8, glass_break: 4, splash_big: 8, body_fall: 2.5, punch: 2, kick: 2, taser: 2.5,
  baton_hit: 2, radio_chatter: 1.5, slot_win: 3, slot_spin: 1.5, chips: 1.2, cash: 1.5, swing: 1.5, whiz: 3, spray: 2, button: 1 };
const SFX_MAXD = { gunshot: 400, ship_horn: 5000, thunder: 9999, scream: 90, whistle: 120, glass_break: 60, splash_big: 120 };
const UI_SFX = new Set(['ui_click', 'ui_hover', 'ui_open', 'ui_close', 'objective', 'levelup']);
const VOICE_SFX = new Set(['grunt', 'scream', 'gasp']);

export function installAudio(game) {
  const sys = new AudioSystem(game);
  game.addSystem(sys);
  game.audio = sys;
  return sys;
}

export class AudioSystem {
  constructor(game) {
    this.name = 'audio'; this.order = 90; this.runWhilePaused = true;
    this.game = game;
    this.ctx = null; this.lib = null; this.mix = null;
    this.vol = { ...DEFAULT_VOL }; this.muted = false;
    try { const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (s) { Object.assign(this.vol, s.vol || {}); this.muted = !!s.muted; } } catch {}
    this.voices = 0;
    this.listener = { x: 0, y: 0, z: 0, deck: 5, room: null, exterior: true, inWater: false };
    this.ctxT = 0; this.spawnT = {}; this.bands = new Map(); this.tension = null;
    this.heat = 0; this.heatShown = 0;
    this.announceQ = []; this.announcing = false; this.speaking = false; this.lastBark = 0;
    this.alarms = {}; this.elevHums = new Map(); this.lastShot = { t: -1, x: 0, z: 0 };
    this.stepBudget = 0; this.duckState = 1; this.duckUntil = 0;
    this.gust = 0; this.gustTarget = 0; this.gustT = 0;
    this.venues = null;
    this.unsub = [];
    this.enabled = true;
    this._bindUnlock();
    this._bindBus();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────
  _bindUnlock() {
    if (typeof window === 'undefined') return;
    const h = () => { this.unlock(); if (this.ctx && this.ctx.state === 'running') { window.removeEventListener('pointerdown', h, true); window.removeEventListener('keydown', h, true); window.removeEventListener('touchstart', h, true); } };
    this._unlockHandler = h;
    window.addEventListener('pointerdown', h, true); window.addEventListener('keydown', h, true); window.addEventListener('touchstart', h, true);
    // suspend audio while the tab is hidden (the game loop stops too), resume when visible again
    this._visHandler = () => {
      if (!this.ctx) return;
      try { if (document.hidden) { this.ctx.suspend(); window.speechSynthesis?.pause?.(); } else { this.ctx.resume().catch(() => {}); window.speechSynthesis?.resume?.(); } } catch {}
    };
    document.addEventListener?.('visibilitychange', this._visHandler);
  }
  // Create (once) and resume the AudioContext. Safe to call any time; requires a user gesture in browsers.
  unlock(injected) {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC && !injected) { this.enabled = false; return false; }
        this.ctx = injected || new AC({ latencyHint: 'interactive' });
        this._build();
      }
      if (this.ctx.state === 'suspended' && this.ctx.resume && !injected) this.ctx.resume().catch(() => {});
      return true;
    } catch (e) { console.warn('[audio] unlock failed', e); this.enabled = false; return false; }
  }
  _build() {
    const ctx = this.ctx;
    this.lib = makeLib(ctx);
    this.mix = createMixer(ctx, this.lib);
    this._applyVolumes(true);
    this._buildBeds();
    this._scanVenues();
    if (this.heat > 0) this._ensureTension();
  }
  get ready() { return !!(this.ctx && this.mix && this.ctx.state !== 'closed'); }

  // ── volumes ──────────────────────────────────────────────────────────────
  setVolume(channel, v) {
    if (!(channel in this.vol)) return;
    this.vol[channel] = clamp(+v || 0, 0, 1);
    this._applyVolumes(); this._save();
  }
  getVolume(channel) { return this.vol[channel]; }
  mute(on = true) { this.muted = !!on; this._applyVolumes(); this._save(); if (this.muted) try { window.speechSynthesis?.cancel(); } catch {} }
  _save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ vol: this.vol, muted: this.muted })); } catch {} }
  _applyVolumes(now = false) {
    if (!this.mix) return;
    const t = this.ctx.currentTime, tc = now ? 0.001 : 0.05;
    const curve = (v) => v * v;   // perceptual taper
    this.mix.master.gain.setTargetAtTime(this.muted ? 0 : curve(this.vol.master), t, tc);
    for (const c of CHANNELS) {
      const C = this.mix.ch[c]; const v = curve(this.vol[c]);
      C.out.gain.setTargetAtTime(v, t, tc);
      C.send.gain.setTargetAtTime(C.sendBase * v, t, tc);
    }
  }
  _voiceVolume() { return this.muted ? 0 : this.vol.master * this.vol.voice; }

  // ── ambience beds ───────────────────────────────────────────────────────
  _stereoNoise(type, out, rate = 1) {
    const ctx = this.ctx, m = ctx.createChannelMerger(2);
    const l = gain(ctx, 1), r = gain(ctx, 1); l.connect(m, 0, 0); r.connect(m, 0, 1);
    noise(this.lib, type, ctx.currentTime, null, l, rate); noise(this.lib, type, ctx.currentTime, null, r, rate * 1.003);
    m.connect(out); return m;
  }
  _bed(name, build) {
    const ctx = this.ctx, A = this.mix.ch.ambience;
    const g = gain(ctx, 0, A.world);
    const node = { g, level: 0 };
    build(node, g);
    this.beds[name] = node;
    return node;
  }
  _buildBeds() {
    const ctx = this.ctx, lib = this.lib, t0 = ctx.currentTime;
    this.beds = {};
    // ocean: wash of brown+pink noise with slow swell LFOs (waves along the hull)
    this._bed('ocean', (n, out) => {
      n.lp = filter(ctx, 'lowpass', 2500, 0.5, out);
      const sw = gain(ctx, 0.6, n.lp);
      const l1 = osc(ctx, 'sine', 0.11, t0, null, gain(ctx, 0.25, sw.gain)); const l2 = osc(ctx, 'sine', 0.173, t0, null, gain(ctx, 0.18, sw.gain)); void l1; void l2;
      this._stereoNoise('brown', gain(ctx, 1.4, sw));
      const hiss = filter(ctx, 'bandpass', 900, 0.4, gain(ctx, 0.45, sw)); this._stereoNoise('pink', hiss);
      n.wake = gain(ctx, 0, n.lp); const wbp = filter(ctx, 'bandpass', 500, 0.6, n.wake); this._stereoNoise('pink', wbp, 0.8);  // hull wake rush
    });
    // wind: band-limited pink noise; filter + level driven per frame by a gust model; storm whistle layer
    this._bed('wind', (n, out) => {
      n.bp = filter(ctx, 'bandpass', 500, 0.7, out); this._stereoNoise('pink', n.bp);
      n.low = filter(ctx, 'lowpass', 180, 0.7, gain(ctx, 1.6, out)); this._stereoNoise('brown', n.low);
      n.whG = gain(ctx, 0, out); n.wh = filter(ctx, 'bandpass', 1400, 12, n.whG); this._stereoNoise('white', n.wh);
    });
    // rain: hiss + droplet crackle (outdoor) / filtered pattering (indoor windows)
    this._bed('rain', (n, out) => {
      n.lp = filter(ctx, 'lowpass', 9000, 0.5, out);
      const h = filter(ctx, 'highpass', 1800, 0.5, gain(ctx, 0.5, n.lp)); this._stereoNoise('pink', h);
      const c = filter(ctx, 'highpass', 900, 0.5, gain(ctx, 1.4, n.lp)); this._stereoNoise('crackle', c, 0.9);
      const lo = filter(ctx, 'lowpass', 400, 0.5, gain(ctx, 0.5, n.lp)); this._stereoNoise('brown', lo);
    });
    // HVAC: low air rush + faint 120 Hz/180 Hz electrical hum + diffuser hiss
    this._bed('hvac', (n, out) => {
      const lp = filter(ctx, 'lowpass', 260, 0.6, gain(ctx, 1.2, out)); this._stereoNoise('brown', lp);
      const air = filter(ctx, 'bandpass', 700, 0.5, gain(ctx, 0.18, out)); this._stereoNoise('pink', air);
      const hum = gain(ctx, 0.012, out); osc(ctx, 'sine', 120, t0, null, hum); osc(ctx, 'sine', 180, t0, null, gain(ctx, 0.4, hum)); osc(ctx, 'sine', 60, t0, null, gain(ctx, 1.4, hum));
    });
    // engine: diesel sub rumble, firing pulse (AM), machinery whine
    this._bed('engine', (n, out) => {
      const lp = filter(ctx, 'lowpass', 140, 0.8, out);
      const s1 = osc(ctx, 'sawtooth', 31.5, t0, null, gain(ctx, 0.35, lp)); osc(ctx, 'sawtooth', 47.3, t0, null, gain(ctx, 0.2, lp)); void s1;
      const rum = filter(ctx, 'lowpass', 220, 0.6, gain(ctx, 1.6, out)); this._stereoNoise('brown', rum);
      // mechanical rhythm (cylinder firing 8.4 Hz) — depth controlled by n.rhythm
      n.rhythm = gain(ctx, 0, out);
      const am = gain(ctx, 0, n.rhythm);
      const lfo = osc(ctx, 'sine', 8.4, t0, null, gain(ctx, 1, am.gain)); void lfo;
      const fb = filter(ctx, 'bandpass', 380, 0.9, am); this._stereoNoise('pink', fb);
      const clank = filter(ctx, 'bandpass', 2200, 2, gain(ctx, 0.25, am)); this._stereoNoise('white', clank);
      n.whine = gain(ctx, 0, out); osc(ctx, 'triangle', 1180, t0, null, filter(ctx, 'lowpass', 1500, 0.7, n.whine)); osc(ctx, 'sine', 590, t0, null, gain(ctx, 0.6, n.whine));
    });
    // room tone: very quiet dampened carpet/corridor tone
    this._bed('roomtone', (n, out) => { const lp = filter(ctx, 'lowpass', 500, 0.5, out); this._stereoNoise('pink', lp); });
    // crowd walla (adults) and kids — pre-rendered formant babble loops, two layers each with offset
    // galley: extractor fans + sizzle
    this._bed('galley', (n, out) => {
      const fan = filter(ctx, 'bandpass', 520, 0.8, gain(ctx, 0.5, out)); this._stereoNoise('pink', fan);
      osc(ctx, 'sine', 98, t0, null, gain(ctx, 0.02, out));
      const sz = gain(ctx, 0.5, out); const lfo = osc(ctx, 'sine', 0.13, t0, null, gain(ctx, 0.3, sz.gain)); void lfo;
      this._stereoNoise('crackle', filter(ctx, 'highpass', 3000, 0.6, sz), 1.2);
    });
    // laundry: rotating drums (slow AM) + motor hum
    this._bed('laundry', (n, out) => {
      const drum = gain(ctx, 0.6, out); osc(ctx, 'sine', 0.75, t0, null, gain(ctx, 0.4, drum.gain));
      this._stereoNoise('brown', filter(ctx, 'lowpass', 320, 0.8, drum));
      const swish = gain(ctx, 0.2, out); osc(ctx, 'sine', 0.55, t0, null, gain(ctx, 0.18, swish.gain)); this._stereoNoise('pink', filter(ctx, 'bandpass', 900, 0.8, swish));
      osc(ctx, 'sawtooth', 50, t0, null, filter(ctx, 'lowpass', 160, 0.7, gain(ctx, 0.05, out)));
    });
    // pool water: lapping + jets
    this._bed('water', (n, out) => {
      const lap = gain(ctx, 0.5, out); osc(ctx, 'sine', 0.4, t0, null, gain(ctx, 0.3, lap.gain)); osc(ctx, 'sine', 0.67, t0, null, gain(ctx, 0.2, lap.gain));
      this._stereoNoise('pink', filter(ctx, 'bandpass', 600, 0.7, lap));
      this._stereoNoise('crackle', filter(ctx, 'highpass', 2500, 0.6, gain(ctx, 0.25, out)), 0.7);
    });
    // casino electrical bed: soft slot-machine idle melodies are spawned; here a faint shimmer
    this._bed('casino', (n, out) => {
      const sh = gain(ctx, 0.002, out);
      [76, 79, 83, 88].forEach((m, i) => { const o = osc(ctx, 'sine', 440 * Math.pow(2, (m - 69) / 12), t0, null, sh); o.detune.value = rand(-8, 8) + i; });
      this._stereoNoise('pink', filter(ctx, 'highpass', 5000, 0.5, gain(ctx, 0.08, out)));
    });
    // crowd walla & kids babble are synthesised sample-by-sample (~200 ms each) → build them in later tasks
    const later = [
      () => this._bed('crowd', (n, out) => {
        n.lp = filter(ctx, 'lowpass', 4000, 0.5, out);
        n.add = (b) => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rand(0.97, 1.03); s.connect(gain(ctx, 0.6, n.lp)); s.start(ctx.currentTime, rand(0, b.duration)); };
        n.add(makeBabble(ctx, 7, 10, 1, 1, 11));
      }),
      () => this.beds.crowd?.add(makeBabble(ctx, 9, 8, 1, 1, 23)),
      () => this._bed('kids', (n, out) => {
        const b = makeBabble(ctx, 6, 7, 1.75, 1.3, 37);
        const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.connect(gain(ctx, 0.7, out)); s.start(ctx.currentTime);
      }),
    ];
    const run = () => { const f = later.shift(); if (!f || !this.ctx) return; try { f(); } catch (e) { console.warn('[audio] bed', e); } if (later.length) setTimeout(run, 120); };
    setTimeout(run, 60);
  }
  _setBed(name, level, tc = 0.8) { const b = this.beds?.[name]; if (!b) return; level = Math.max(0, level); if (Math.abs(level - b.level) < 1e-4) return; b.level = level; b.g.gain.setTargetAtTime(level, this.ctx.currentTime, tc); }

  // ── listener & context ──────────────────────────────────────────────────
  _updateListener() {
    const g = this.game, cam = g.camera, L = this.listener;
    const p = g.player;
    const cx = cam?.position?.x ?? 0, cy = cam?.position?.y ?? 20, cz = cam?.position?.z ?? 0;
    // the "ears" for occlusion/context are the player when present (third-person camera may clip walls)
    const ex = p && Number.isFinite(p.x) ? p.x : cx, ez = p && Number.isFinite(p.z) ? p.z : cz;
    const ey = p && Number.isFinite(p.y) ? p.y + 1.6 : cy;
    let deck = p?.deck ?? deckOfY(ey - 1.2);
    if (!Number.isFinite(deck)) deck = 5;
    let room = p?.room;
    if (room === undefined) { try { room = g.world?.roomAt?.(deck, ex, ez) || null; } catch { room = null; } }
    L.x = ex; L.y = ey; L.z = ez; L.deck = deck; L.room = room || null;
    L.exterior = p?.exterior ?? (room ? !!room.exterior : true);
    L.inWater = !!p?.inWater;
    L.camX = cx; L.camY = cy; L.camZ = cz;
    // Web Audio listener at camera (rendering perspective)
    const al = this.ctx.listener, t = this.ctx.currentTime;
    let fx = 0, fy = 0, fz = -1, ux = 0, uy = 1, uz = 0;
    const e = cam?.matrixWorld?.elements;
    if (e) { fx = -e[8]; fy = -e[9]; fz = -e[10]; ux = e[4]; uy = e[5]; uz = e[6]; }
    if (al.positionX) {
      al.positionX.setTargetAtTime(cx, t, 0.02); al.positionY.setTargetAtTime(cy, t, 0.02); al.positionZ.setTargetAtTime(cz, t, 0.02);
      al.forwardX.setTargetAtTime(fx, t, 0.02); al.forwardY.setTargetAtTime(fy, t, 0.02); al.forwardZ.setTargetAtTime(fz, t, 0.02);
      al.upX.setTargetAtTime(ux, t, 0.02); al.upY.setTargetAtTime(uy, t, 0.02); al.upZ.setTargetAtTime(uz, t, 0.02);
    } else { try { al.setPosition(cx, cy, cz); al.setOrientation(fx, fy, fz, ux, uy, uz); } catch {} }
    this._fwd = { x: fx, z: fz };
  }

  _weather() { const w = this.game.env?.weather || {}; return { wind: +w.wind || 0, storm: +w.storm || 0, rain: +w.rain || 0, fog: +w.fog || 0 }; }
  _hour() { const h = this.game.hour; return Number.isFinite(h) ? h : 12; }

  _crowdCount(room) {
    const L = this.listener, n = this.game.npcs;
    if (n && typeof n.countNear === 'function') {
      try { const c = n.countNear(L.x, L.y - 1.6, L.z, 14); if (Number.isFinite(c)) return c; } catch {}
    }
    if (!room) return 0;
    let c = CROWD[room.dens] ?? (room.type === 'corridor' ? 3 : 0);
    const h = this._hour();
    const night = (h >= 1.5 && h < 6.5) ? 0.15 : (h >= 23 || h < 1.5) ? 0.6 : 1;
    if (room.dens === 'club') c *= (h >= 21 || h < 3) ? 1 : 0.15;
    else if (room.dens === 'pool' || room.dens === 'swim') c *= (h >= 8 && h < 20) ? 1 : 0.1;
    else if (room.dens === 'theater') c *= this._showOn(room) ? 0.1 : 1;
    else c *= night;
    return c;
  }
  _showOn(room) { const s = styleForRoom(room); return !!(s && s.shows && venueActive(s, this._hour())); }

  _context(dt) {
    const L = this.listener, r = L.room, W = this._weather(), h = this._hour();
    const ext = L.exterior;
    const hWater = Math.max(0, L.y - SHIP.waterY);
    const dens = r?.dens, type = r?.type;
    const lowDeck = L.deck <= 3;
    const hasWindow = r && (r.facade === 'window' || r.facade === 'glass' || r.facade === 'porthole');
    const big = r && (type === 'atrium' || type === 'theater' || (r.area || 0) > 900);
    // ocean
    if (ext) {
      const near = clamp(1 - (hWater - 6) / 55, 0.25, 1);
      this._setBed('ocean', (0.2 + 0.18 * W.wind + 0.18 * W.storm) * near);
      this.beds.ocean.lp.frequency.setTargetAtTime(2200 + 1800 * near, this.ctx.currentTime, 0.6);
      this.beds.ocean.wake.gain.setTargetAtTime(0.5 * near * (this.game.shipSpeedK ?? 1), this.ctx.currentTime, 1);
    } else {
      this._setBed('ocean', lowDeck ? 0.08 : hasWindow ? 0.04 + 0.08 * W.storm : 0.012);
      this.beds.ocean.lp.frequency.setTargetAtTime(lowDeck ? 260 : 420, this.ctx.currentTime, 0.6);
      this.beds.ocean.wake.gain.setTargetAtTime(lowDeck ? 0.8 : 0.2, this.ctx.currentTime, 1);
    }
    // wind gust model
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = rand(0.6, 2.5); this.gustTarget = Math.pow(Math.random(), 2) * (0.5 + W.storm); }
    this.gust += (this.gustTarget - this.gust) * (1 - Math.exp(-dt * 1.5));
    const hK = clamp(0.6 + hWater / 60, 0.6, 1.3);
    const windBase = 0.05 + 0.2 * W.wind + 0.22 * W.storm;
    const windLvl = ext ? windBase * hK * (0.65 + 0.7 * this.gust) : hasWindow ? 0.025 * W.storm * (0.5 + this.gust) : 0;
    this._setBed('wind', windLvl, 0.25);
    if (this.beds.wind) {
      const t = this.ctx.currentTime, w = this.beds.wind;
      w.bp.frequency.setTargetAtTime(300 + 700 * this.gust + 600 * W.storm, t, 0.3);
      w.whG.gain.setTargetAtTime(ext ? 0.15 * W.storm * this.gust : 0.4 * W.storm * this.gust * (hasWindow ? 1 : 0), t, 0.3);
      w.wh.frequency.setTargetAtTime(900 + 900 * this.gust, t, 0.4);
    }
    // rain
    const rainLvl = W.rain * (ext ? 0.3 : hasWindow ? 0.12 : lowDeck ? 0 : 0.02);
    this._setBed('rain', rainLvl, 1.2);
    this.beds.rain?.lp.frequency.setTargetAtTime(ext ? 9000 : 1600, this.ctx.currentTime, 0.5);
    // HVAC / roomtone
    const crewish = r && (r.zone === 'crew' || r.zone === 'restricted');
    this._setBed('hvac', ext ? 0 : type === 'corridor' ? 0.045 : crewish ? (type === 'engine' ? 0.05 : 0.12) : type === 'cabin' || type === 'suite' ? 0.06 : 0.09);
    this._setBed('roomtone', ext ? 0 : (type === 'corridor' || type === 'cabin' || type === 'crew_corridor') ? 0.04 : 0.015);
    // engine
    const inEngine = type === 'engine';
    const eLvl = inEngine ? 0.42 : L.deck === 1 ? 0.2 : L.deck === 2 ? 0.11 : L.deck === 3 ? 0.07 : ext ? 0.0 : L.deck <= 6 ? 0.03 : 0.015;
    this._setBed('engine', eLvl * (0.4 + 0.6 * clamp(this.game.shipSpeedK ?? 1, 0, 1)), 1.2);
    if (this.beds.engine) {
      const t = this.ctx.currentTime;
      this.beds.engine.rhythm.gain.setTargetAtTime(inEngine ? 0.35 : L.deck === 1 ? 0.08 : 0, t, 0.8);
      this.beds.engine.whine.gain.setTargetAtTime(inEngine ? 0.012 : 0, t, 0.8);
    }
    // crowd
    const n = this._crowdCount(r);
    const kidsRoom = dens === 'kids' || dens === 'pool' || dens === 'swim';
    const crowdLvl = clamp(Math.sqrt(Math.max(0, n)) / 6, 0, 1) * (ext ? 0.28 : 0.34) * (dens === 'club' ? 1.2 : 1) * (type === 'corridor' ? 0.5 : 1);
    this._setBed('crowd', crowdLvl * (kidsRoom ? 0.7 : 1), 1.0);
    this.beds.crowd?.lp.frequency.setTargetAtTime(dens === 'theater' || dens === 'library' ? 1800 : ext ? 3000 : 4200, this.ctx.currentTime, 1);
    this._setBed('kids', (dens === 'kids' ? 0.28 : kidsRoom && h >= 9 && h < 19 ? 0.1 : 0), 1.0);
    this._setBed('galley', dens === 'galley' ? 0.32 : 0);
    this._setBed('laundry', dens === 'laundry' ? 0.3 : 0);
    this._setBed('water', (dens === 'pool' || dens === 'swim' || type === 'spa' && r?.venue !== 'gym') ? (dens === 'swim' ? 0.32 : 0.18) : L.inWater ? 0.4 : 0);
    this._setBed('casino', dens === 'casino' ? 1 : 0);
    // reverb character
    const M = this.mix, t = this.ctx.currentTime;
    let small = 0, hall = 0, large = 0, wet = 0.9;
    if (ext) { small = 0.25; hall = 0; large = 0; wet = 0.15; }
    else if (!r) { small = 0.6; }
    else if (big) { large = 1; hall = 0.25; wet = 1.0; }
    else if (type === 'engine') { hall = 0.8; large = 0.4; wet = 1.1; }
    else if (type === 'cabin' || type === 'crew_cabin' || type === 'suite' || type === 'office' || type === 'officer') { small = 1; wet = 0.5; }
    else if (type === 'corridor') { small = 0.8; hall = 0.1; wet = 0.45; }   // carpet-dampened
    else if (type === 'stair' || type === 'lobby' || type === 'galley' || type === 'crew_corridor') { small = 0.6; hall = 0.5; wet = 0.8; }
    else if ((r.area || 0) > 300) { hall = 1; small = 0.2; wet = 0.85; }
    else { small = 0.5; hall = 0.5; wet = 0.7; }
    if (L.inWater) { small = 0; hall = 0; large = 0; }
    M.rev.small.gain.setTargetAtTime(small, t, 0.5); M.rev.hall.gain.setTargetAtTime(hall, t, 0.5); M.rev.large.gain.setTargetAtTime(large, t, 0.5);
    M.revOut.gain.setTargetAtTime(wet, t, 0.5);
    // under water: everything muffled
    this._underwater = L.inWater;
  }

  // ── ambient one-shot spawners ───────────────────────────────────────────
  _every(key, min, max, dt) { this.spawnT[key] = (this.spawnT[key] ?? rand(min * 0.3, max)) - dt; if (this.spawnT[key] <= 0) { this.spawnT[key] = rand(min, max); return true; } return false; }
  _roomPoint(r, L) {
    if (!r || !Number.isFinite(r.x0)) return { x: L.x + rand(-12, 12), y: L.y, z: L.z + rand(-10, 10) };
    for (let k = 0; k < 6; k++) {
      const x = rand(r.x0, r.x1), z = rand(r.z0, r.z1);
      if (Math.hypot(x - L.x, z - L.z) > 2.5 || k === 5) return { x, y: deckY(L.deck) + rand(0.8, 1.4), z };
    }
  }
  _spawners(dt) {
    const L = this.listener, r = L.room, W = this._weather(), h = this._hour(), dens = r?.dens, type = r?.type;
    const day = h >= 7 && h < 19.5;
    const amb = { channel: 'ambience', occl: false };
    if (L.exterior) {
      if (this._every('rig', 6, 18, dt * (0.5 + W.wind + W.storm * 2))) {
        const p = { x: L.x + rand(-15, 15), y: L.y + rand(1, 6), z: L.z + rand(-10, 10) };
        if (chance(0.6)) this.play3D((lib, o, t) => creak(lib, o, t, { lvl: 0.08, f: rand(350, 700), Q: 7, rate: rand(12, 25), dur: rand(0.6, 1.6) }), p, { ...amb, ref: 4 });
        else this.play3D((lib, o, t) => { let e = 0; for (let i = 0; i < Math.floor(rand(1, 4)); i++) { metalHit(lib, o, t + e, rand(900, 1400), 0.03, 0.4, 5); e += rand(0.15, 0.5); } return e + 0.4; }, p, { ...amb, ref: 3 });
      }
      if (day && W.storm < 0.3 && W.rain < 0.3 && this._every('gull', 25, 90, dt) && chance(0.45)) {
        const a = rand(0, Math.PI * 2), d = rand(40, 120);
        this.play3D(gullCall, { x: L.x + Math.cos(a) * d, y: L.y + rand(10, 30), z: L.z + Math.sin(a) * d }, { ...amb, ref: 20, lp: 3500 });
      }
      if ((W.wind > 0.55 || W.storm > 0.2) && this._every('gust', 8, 25, dt)) this.play2D(SFX.wind_gust, { channel: 'ambience', vol: 0.5 + W.storm * 0.6 });
    } else {
      // ship structure creak (more in heavy weather)
      if (this._every('creak', 10, 30, dt * (0.4 + W.storm * 2.5 + W.wind * 0.5))) {
        const p = this._roomPoint(r, L);
        this.play3D((lib, o, t) => creak(lib, o, t, { lvl: 0.05 + W.storm * 0.06, f: rand(160, 340), Q: 5, rate: rand(8, 16), dur: rand(0.8, 2.2) }), p, { ...amb, ref: 3 });
      }
      if (W.rain > 0.3 && r && (r.facade === 'window' || r.facade === 'glass') && this._every('drip', 0.2, 1.2, dt * W.rain)) {
        const p = this._roomPoint(r, L);
        this.play3D((lib, o, t) => { burst2(lib, o, t); return 0.05; }, p, { ...amb, ref: 1.5, vol: 0.4 });
      }
    }
    // when the weather system exists it emits its own distance-delayed 'sfx' thunder in sync with lightning
    if (!this.game.weather && W.storm > 0.45 && this._every('thunder', 14, 50, dt * W.storm)) {
      const near = Math.random();
      this.play2D((lib, o, t) => SFX.thunder(lib, o, t, { near }), { channel: 'ambience', vol: (L.exterior ? 0.9 : 0.4), lp: L.exterior ? 20000 : 600, delay: near > 0.6 ? 0 : rand(0.5, 3) });
    }
    switch (dens) {
      case 'casino': {
        if (this._every('slotj', 0.8, 3, dt)) this.play3D((lib, o, t) => { const base = pick([72, 74, 76, 77, 79]); const n = Math.floor(rand(3, 7)); for (let i = 0; i < n; i++) chimeNote(lib, o, t + i * rand(0.07, 0.12), 440 * Math.pow(2, (base + pick([0, 4, 7, 12, 16]) - 69) / 12), 0.05, 0.6); return n * 0.1 + 0.6; }, this._roomPoint(r, L), { ...amb, ref: 3 });
        if (this._every('chips', 1.5, 5, dt)) this.play3D(SFX.chips, this._roomPoint(r, L), { ...amb, ref: 1.5, vol: 0.6 });
        if (this._every('slotw', 20, 60, dt)) this.play3D(SFX.slot_win, this._roomPoint(r, L), { ...amb, ref: 3, vol: 0.6 });
        if (this._every('spin', 3, 8, dt)) this.play3D(SFX.slot_spin, this._roomPoint(r, L), { ...amb, ref: 1.5, vol: 0.5 });
        break;
      }
      case 'galley': {
        if (this._every('clatter', 0.6, 2.5, dt)) this.play3D((lib, o, t) => { const k = Math.random(); if (k < 0.4) return metalHit(lib, o, t, rand(300, 700), 0.07, 0.6, 6); if (k < 0.7) { let e = 0; for (let i = 0; i < Math.floor(rand(4, 10)); i++) { woodKnock(lib, o, t + e, rand(400, 600), 0.06, 0.04); e += rand(0.12, 0.2); } return e; } return coins(lib, o, t, 3, 0.06); }, this._roomPoint(r, L), { ...amb, ref: 2 });
        break;
      }
      case 'laundry': {
        if (this._every('tumble', 0.5, 1.4, dt)) this.play3D((lib, o, t) => thud(lib, o, t, rand(70, 110), 0.12, 0.12), this._roomPoint(r, L), { ...amb, ref: 2 });
        if (this._every('buzz', 30, 80, dt)) this.play3D((lib, o, t) => { chimeNote(lib, o, t, 880, 0.05, 0.4); chimeNote(lib, o, t + 0.3, 880, 0.05, 0.4); return 0.8; }, this._roomPoint(r, L), { ...amb, ref: 2 });
        break;
      }
      case 'pool': case 'swim': {
        if (h >= 8 && h < 20 && this._every('splash', 1.5, 6, dt)) this.play3D(chance(0.15) ? SFX.splash_big : SFX.splash, this._roomPoint(r, L), { ...amb, ref: 3, vol: 0.6 });
        if (h >= 9 && h < 19 && this._every('whee', 8, 25, dt)) this.play3D((lib, o, t) => vocal(lib, o, t, rand(0.5, 0.9), { f0: rand(380, 480), f0Mid: rand(550, 650), f0End: rand(350, 420), vowel: VOWELS.i, vowelEnd: VOWELS.e, formantMul: 1.3, lvl: 0.12, attack: 0.05, release: 0.2, breath: 0.5 }), this._roomPoint(r, L), { ...amb, ref: 3 });
        break;
      }
      case 'engine': {
        if (this._every('clank', 1.2, 4, dt)) this.play3D((lib, o, t) => metalHit(lib, o, t, rand(150, 320), 0.09, 0.8, 6), this._roomPoint(r, L), { ...amb, ref: 3 });
        if (this._every('hiss', 6, 18, dt)) this.play3D((lib, o, t) => whoosh(lib, o, t, rand(0.8, 1.6), 3000, 5000, 0.05, 0.8, 'white'), this._roomPoint(r, L), { ...amb, ref: 2 });
        break;
      }
      case 'bar': case 'dining': case 'buffet': case 'crewmess': case 'crewbar': {
        if (this._every('cutlery', 0.8, 3, dt)) this.play3D((lib, o, t) => { const f = rand(2200, 4200); modalClink(lib, o, t, f); if (chance(0.4)) modalClink(lib, o, t + rand(0.05, 0.2), f * rand(0.8, 1.2)); return 0.3; }, this._roomPoint(r, L), { ...amb, ref: 1.5, vol: 0.7 });
        if (dens === 'bar' && this._every('shaker', 12, 35, dt)) this.play3D((lib, o, t) => { for (let i = 0; i < 10; i++) noiseTick(lib, o, t + i * 0.13); return 1.4; }, this._roomPoint(r, L), { ...amb, ref: 2 });
        break;
      }
      case 'kids': {
        if (this._every('toy', 3, 9, dt)) this.play3D((lib, o, t) => chance(0.5) ? woodKnock(lib, o, t, rand(500, 900), 0.08, 0.06) : SFX.ui_open(lib, o, t), this._roomPoint(r, L), { ...amb, ref: 2 });
        break;
      }
    }
    if (type === 'corridor' && this._every('cabdoor', 18, 50, dt)) this.play3D((lib, o, t) => doorSound(lib, o, t, { type: 'cabin', opening: chance(0.5) }), this._roomPoint(r, L), { ...amb, ref: 1.5, vol: 0.5, occl: true });
  }

  // ── positional playback ─────────────────────────────────────────────────
  // Occlusion between the listener and a source on (deck, x, z): returns {g, lp}.
  _occlusion(x, y, z, deck) {
    const L = this.listener, w = this.game.world;
    if (!Number.isFinite(deck)) deck = deckOfY(y - 0.5);
    const dd = Math.abs(deck - L.deck);
    let srcRoom = null; try { srcRoom = w?.roomAt?.(deck, x, z) || null; } catch {}
    const srcExt = srcRoom ? !!srcRoom.exterior : true;
    if (dd > 0) {
      if (srcExt && L.exterior) return { g: Math.pow(0.6, dd), lp: 9000 };
      const voidLink = (srcRoom?.type === 'atrium' || srcRoom?.isVoid) && (L.room?.type === 'atrium' || L.room?.isVoid);
      if (voidLink) return { g: Math.pow(0.55, dd), lp: 5000 };
      return { g: Math.pow(0.16, dd), lp: dd === 1 ? 380 : 220 };
    }
    let clear = true;
    if (w?.lineClear && Math.hypot(x - L.x, z - L.z) > 0.6) { try { clear = w.lineClear(deck, L.x, L.z, x, z); } catch { clear = true; } }
    if (clear) return { g: 1, lp: 20000 };
    const sameRoom = srcRoom && L.room && srcRoom === L.room;
    if (sameRoom) return { g: 0.85, lp: 6000 };
    if (srcExt !== L.exterior) return { g: 0.32, lp: 750 };
    return { g: 0.38, lp: 900 };
  }
  // Play a generator positionally. opts: {channel, ref, maxD, vol, occl(true), lp, delay, deck, prio}
  play3D(gen, pos, opts = {}) {
    if (!this.ready || !pos) return 0;
    const L = this.listener;
    const dx = pos.x - L.camX, dy = (pos.y ?? L.y) - L.camY, dz = pos.z - L.camZ;
    const dist = Math.hypot(dx, dy, dz);
    const maxD = opts.maxD ?? 60;
    if (dist > maxD) return 0;
    if (this.voices >= MAX_VOICES && !opts.prio) return 0;
    const ctx = this.ctx, C = this.mix.ch[opts.channel || 'sfx'];
    let occ = { g: 1, lp: 20000 };
    if (opts.occl !== false) occ = this._occlusion(pos.x, pos.y ?? L.y, pos.z, opts.deck);
    if (occ.g < 0.02) return 0;
    const t = ctx.currentTime + 0.01 + (opts.delay || 0);
    const pn = ctx.createPanner();
    pn.panningModel = dist < 30 ? 'HRTF' : 'equalpower';
    pn.distanceModel = 'inverse'; pn.refDistance = opts.ref ?? 2; pn.rolloffFactor = opts.rolloff ?? 1; pn.maxDistance = 10000;
    if (pn.positionX) { pn.positionX.value = pos.x; pn.positionY.value = pos.y ?? L.y; pn.positionZ.value = pos.z; } else pn.setPosition(pos.x, pos.y ?? L.y, pos.z);
    const lpF = Math.min(occ.lp, opts.lp ?? 20000, this._underwater ? 500 : 20000);
    // air absorption: distant sounds lose highs
    const air = clamp(20000 * Math.exp(-dist / 140), 2500, 20000);
    const g = gain(ctx, (opts.vol ?? 1) * occ.g, pn);
    const lp = filter(ctx, 'lowpass', Math.min(lpF, air), 0.6, g);
    pn.connect(C.world);
    let dur = 1;
    try { dur = gen(this.lib, lp, t, { ...opts, exterior: opts.exterior ?? (L.exterior && occ.g > 0.5), dist }) || 1; } catch (e) { console.warn('[audio] gen error', e); }
    this._retire([pn, g, lp], t + dur + 0.5);
    return dur;
  }
  // Non-positional playback. opts: {channel, vol, lp, direct(true→bypass pause filter/reverb), pan, delay}
  play2D(gen, opts = {}) {
    if (!this.ready) return 0;
    if (this.voices >= MAX_VOICES + 8 && !opts.prio) return 0;
    const ctx = this.ctx, C = this.mix.ch[opts.channel || 'sfx'];
    const t = ctx.currentTime + 0.01 + (opts.delay || 0);
    const dest = opts.direct ? C.direct : opts.dry ? C.dry : C.world;
    const p = panner2(ctx, opts.pan || 0, dest);
    const g = gain(ctx, opts.vol ?? 1, p);
    const lp = filter(ctx, 'lowpass', Math.min(opts.lp ?? 20000, this._underwater && !opts.direct ? 500 : 20000), 0.6, g);
    let dur = 1;
    try { dur = gen(this.lib, lp, t, opts) || 1; } catch (e) { console.warn('[audio] gen error', e); }
    this._retire([p, g, lp], t + dur + 0.5);
    return dur;
  }
  _retire(nodes, endT) {
    this.voices++;
    const ms = Math.max(50, (endT - this.ctx.currentTime) * 1000 + 600);
    setTimeout(() => { this.voices--; for (const n of nodes) try { n.disconnect(); } catch {} }, ms);
  }

  // public helper: play a named sfx (as the bus would)
  playSfx(name, d = {}) {
    const gen = SFX[name];
    if (!gen || !this.ready) return 0;
    const vol = d.vol ?? 1;
    if (UI_SFX.has(name)) return this.play2D(gen, { channel: 'sfx', vol: vol * 0.8, direct: true });
    if (name === 'ship_horn') return this._horn(d);
    if (name === 'thunder') return this.play2D(gen, { channel: 'ambience', vol: vol * (this.listener.exterior ? 0.9 : 0.45), lp: this.listener.exterior ? 20000 : 600, near: d.near });
    if (name === 'wind_gust') return this.play2D(gen, { channel: 'ambience', vol: vol * (this.listener.exterior ? 0.8 : 0.1), lp: this.listener.exterior ? 20000 : 500 });
    if (!Number.isFinite(d.x) || !Number.isFinite(d.z)) return this.play2D(gen, { channel: VOICE_SFX.has(name) ? 'voice' : 'sfx', vol, sex: d.sex });
    if (name === 'gunshot') { const ls = this.lastShot; if (this.ctx.currentTime - ls.t < 0.06 && Math.hypot(ls.x - d.x, ls.z - d.z) < 2) return 0; this.lastShot = { t: this.ctx.currentTime, x: d.x, z: d.z }; }
    return this.play3D(gen, { x: d.x, y: Number.isFinite(d.y) ? d.y + (d.y < deckY(d.deck ?? 5) + 0.5 ? 1.2 : 0) : this.listener.y, z: d.z }, {
      channel: VOICE_SFX.has(name) ? 'voice' : 'sfx', ref: SFX_REF[name] ?? 2, maxD: SFX_MAXD[name] ?? 70, vol, deck: d.deck, sex: d.sex, prio: name === 'gunshot', exterior: d.exterior,
    });
  }
  _horn(d = {}) {
    // the horns are on the funnel, high above the sun deck; heard ship-wide, muffled inside
    const L = this.listener;
    const p = { x: Number.isFinite(d.x) ? d.x : 40, y: Number.isFinite(d.y) ? d.y : 58, z: Number.isFinite(d.z) ? d.z : 0 };
    const dist = Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z);
    const vol = (d.vol ?? 1) * clamp(60 / Math.max(30, dist), 0.35, 1) * (L.exterior ? 1 : 0.55);
    const dur = d.dur ?? rand(4, 5.5);
    return this.play2D((lib, o, t) => SFX.ship_horn(lib, o, t, { dur }), { channel: 'sfx', vol, lp: L.exterior ? 20000 : 320, pan: clamp(((p.z - L.z) / Math.max(20, dist)) * 0.4, -0.4, 0.4) });
  }

  // ── music ────────────────────────────────────────────────────────────────
  _scanVenues() {
    const plans = this.game.world?.plans || this.game.layout?.plans;
    const groups = new Map();
    if (plans) for (let d = 1; d < plans.length; d++) {
      const p = plans[d]; if (!p?.rooms) continue;
      for (const r of p.rooms) {
        if (!r || !r.cells) continue;
        const spec = styleForRoom(r); if (!spec) continue;
        const key = r.venue ? 'v:' + r.venue + (r.venue === 'pool' || r.venue === 'pool_aft' ? d : '') : 'r:' + d + ':' + r.id;
        let G = groups.get(key);
        if (!G) { G = { key, spec, rooms: [], aud: 0, lp: 20000, pan: 0, quietT: 0 }; groups.set(key, G); }
        G.rooms.push(r);
      }
    }
    this.venues = [...groups.values()];
  }
  _venueAudibility(G) {
    const L = this.listener, w = this.game.world;
    let best = { a: 0, lp: 20000, pan: 0, inside: false };
    for (const r of G.rooms) {
      const dd = Math.abs(r.deck - L.deck);
      if (dd > 1) continue;
      const qx = clamp(L.x, r.x0, r.x1), qz = clamp(L.z, r.z0, r.z1);
      const inside = dd === 0 && L.room === r;
      const d = inside ? 0 : Math.hypot(qx - L.x, qz - L.z) + dd * 6;
      if (d > 70) continue;
      let a = inside ? 1 : 1 / (1 + Math.pow(d / 7, 1.6));
      let lp = 20000;
      if (!inside) {
        if (dd > 0) { a *= r.type === 'atrium' || r.type === 'theater' ? 0.35 : 0.12; lp = 350; }
        else {
          // probe toward the room centre and toward the nearest point
          let clear = false;
          try { clear = w?.lineClear ? (w.lineClear(L.deck, L.x, L.z, qx + (r.cx - qx) * 0.1, qz + (r.cz - qz) * 0.1) || w.lineClear(L.deck, L.x, L.z, r.cx, r.cz)) : true; } catch { clear = true; }
          if (!clear) { a *= r.facade === 'glass' ? 0.5 : 0.3; lp = r.facade === 'glass' ? 1800 : 700; }
          else lp = 9000;
          if (L.exterior !== !!r.exterior && !clear) { a *= 0.6; lp = Math.min(lp, 600); }
        }
      }
      if (a > best.a) {
        const fx = this._fwd?.x ?? 0, fz = this._fwd?.z ?? -1;
        const vx = r.cx - L.x, vz = r.cz - L.z, vl = Math.hypot(vx, vz) || 1;
        const right = fx * vz - fz * vx;    // cross(forward, v) in xz (y-up, right-handed: +right = to the right)
        best = { a, lp, pan: inside ? 0 : clamp(-right / vl, -1, 1) * clamp(d / 10, 0, 0.8), inside };
      }
    }
    return best;
  }
  _updateMusic(dt) {
    if ((!this.venues || !this.venues.length) && !this._rescanned && (this.game.world?.plans || this.game.layout?.plans)) { this._rescanned = true; this._scanVenues(); }
    if (!this.venues) return;
    const h = this._hour();
    // evaluate audibility (4 Hz)
    this._musT = (this._musT || 0) - dt;
    if (this._musT <= 0) {
      this._musT = 0.25;
      const cands = [];
      for (const G of this.venues) {
        const act = venueActive(G.spec, h);
        const A = act > 0 ? this._venueAudibility(G) : { a: 0 };
        G.target = A.a * act; G.lp = A.lp ?? 20000; G.pan = A.pan ?? 0; G.inside = A.inside;
        if (G.target > 0.01) cands.push(G);
      }
      cands.sort((a, b) => b.target - a.target);
      const keep = new Set(cands.slice(0, 3).map(G => G.key));
      for (const G of this.venues) {
        let B = this.bands.get(G.key);
        if (keep.has(G.key) && !B) {
          const ctx = this.ctx;
          const node = gain(ctx, 0, this.mix.ch.music.world);
          const pan = panner2(ctx, 0, node);
          const lp = filter(ctx, 'lowpass', 20000, 0.6, pan);
          const band = new Band(this.lib, lp, G.spec.style, G.spec.opts || {});
          B = { band, node, pan, lp, G };
          this.bands.set(G.key, B);
        }
        if (!B) continue;
        const tgt = keep.has(G.key) ? G.target : 0;
        const t = this.ctx.currentTime;
        const heatDuck = 1 - 0.5 * clamp(this.heatShown / 5, 0, 1);
        B.node.gain.setTargetAtTime(tgt * heatDuck * 0.9, t, 0.6);
        B.lp.frequency.setTargetAtTime(G.lp, t, 0.4);
        if (B.pan.pan) B.pan.pan.setTargetAtTime(G.pan, t, 0.3);
        B.band.level = G.inside ? 1 : 0.7;
        if (tgt < 0.005) { B.quiet = (B.quiet || 0) + 0.25; if (B.quiet > 4) { B.band.stop(); setTimeout(() => { try { B.node.disconnect(); } catch {} }, 3000); this.bands.delete(G.key); } }
        else B.quiet = 0;
      }
    }
    const until = this.ctx.currentTime + 0.3;
    for (const B of this.bands.values()) B.band.schedule(until);
    // tension
    const target = clamp(this.heat / 5, 0, 1);
    this.heatShown += (this.heat - this.heatShown) * (1 - Math.exp(-dt * 0.6));
    if (this.heat > 0) this._ensureTension();
    if (this.tension) {
      const T = this.tension, t = this.ctx.currentTime;
      T.band.level = target;
      T.band.bpm = 92 + 40 * target;
      T.node.gain.setTargetAtTime(this.heat > 0 ? 0.25 + 0.55 * target : 0, t, this.heat > 0 ? 1.0 : 2.0);
      if (this.heat <= 0) { T.quiet = (T.quiet || 0) + dt; if (T.quiet > 10) { T.band.stop(); this.tension = null; } } else T.quiet = 0;
      if (this.tension) T.band.schedule(until);
    }
  }
  _ensureTension() {
    if (this.tension || !this.ready) return;
    const node = gain(this.ctx, 0, this.mix.ch.music.direct);
    this.tension = { band: new Band(this.lib, node, 'tension', {}), node };
  }
  setHeat(level) { this.heat = clamp(+level || 0, 0, 5); }
  sting(kind = 'success') {
    if (!this.ready) return;
    this._duck('music', 0.35, 3.5);
    this.play2D((lib, o, t) => sting(lib, o, t, kind), { channel: 'music', direct: true, vol: 0.9, prio: true });
  }

  // ── ducking ──────────────────────────────────────────────────────────────
  _duck(channel, level, seconds) {
    if (!this.ready) return;
    const C = this.mix.ch[channel], t = this.ctx.currentTime;
    C.duck.gain.cancelScheduledValues(t); C.duck.gain.setTargetAtTime(level, t, 0.15);
    if (seconds != null) C.duck.gain.setTargetAtTime(1, t + seconds, 0.6);
  }
  _unduck(channel) { if (!this.ready) return; const C = this.mix.ch[channel]; C.duck.gain.cancelScheduledValues(this.ctx.currentTime); C.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.6); }

  // ── announcements & speech ──────────────────────────────────────────────
  announce(text, chime = true, opts = {}) {
    if (!text && !chime) return;
    this.announceQ.push({ text: String(text || ''), chime: chime !== false, ...opts });
    if (this.announceQ.length > 6) this.announceQ.splice(0, this.announceQ.length - 6);
    if (!this.announcing) this._nextAnnounce();
  }
  _pickVoice(pref = {}) {
    const ss = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!ss) return null;
    let vs = []; try { vs = ss.getVoices() || []; } catch {}
    const en = vs.filter(v => /^en(-|_|$)/i.test(v.lang || ''));
    const pool = en.length ? en : vs;
    if (!pool.length) return null;
    if (pref.sex) {
      const fem = /female|samantha|victoria|karen|moira|tessa|serena|fiona|susan|zira|hazel|libby|sonia|aria|jenny|kate|google uk english female/i;
      const mal = /male|daniel|alex|fred|oliver|george|ryan|guy|david|mark|james|google uk english male/i;
      const re = pref.sex === 'f' ? fem : mal;
      const m = pool.filter(v => re.test(v.name) && !(pref.sex === 'm' && /female/i.test(v.name)));
      if (m.length) return m[(pref.seed ?? 0) % m.length];
    }
    if (pref.calm) {
      const order = [/Google UK English Female/i, /Samantha/i, /Serena/i, /Karen/i, /Moira/i, /Daniel/i, /Libby|Sonia|Aria|Jenny/i, /Natural/i, /en-GB/i];
      for (const re of order) { const v = pool.find(v => re.test(v.name) || re.test(v.lang)); if (v) return v; }
    }
    return pool.find(v => v.default) || pool[0];
  }
  _speak(text, { voice, rate = 1, pitch = 1, volume = 1, onend, timeout } = {}) {
    const ss = typeof window !== 'undefined' ? window.speechSynthesis : null;
    const U = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null;
    let done = false;
    const finish = () => { if (done) return; done = true; this.speaking = false; onend && onend(); };
    const est = timeout ?? (1.5 + text.split(/\s+/).length * 0.42 / rate) * 1000;
    if (!ss || !U || !text || this.muted || volume <= 0.001) { setTimeout(finish, Math.min(est, ss && U && text ? est : 300)); return false; }
    try {
      const u = new U(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || 'en-GB'; u.rate = clamp(rate, 0.5, 2); u.pitch = clamp(pitch, 0, 2); u.volume = clamp(volume, 0, 1);
      u.onend = finish; u.onerror = finish;
      this.speaking = true;
      ss.speak(u);
      setTimeout(finish, est + 4000);   // safety net: some engines never fire onend
      return true;
    } catch (e) { setTimeout(finish, 300); return false; }
  }
  _nextAnnounce() {
    const a = this.announceQ.shift();
    if (!a) { this.announcing = false; this._unduck('music'); this._unduck('ambience'); return; }
    this.announcing = true;
    try { window.speechSynthesis?.cancel(); } catch {}
    if (a.local) {
      // in-venue speech (bartender's last call etc.): no chime, no PA colouring, quieter, only a light music dip
      this._duck('music', 0.6);
      this._speak(a.text, { voice: this._pickVoice({ calm: true }), rate: 1.0, pitch: 1.0, volume: this._voiceVolume() * 0.5, onend: () => setTimeout(() => this._nextAnnounce(), 300) });
      return;
    }
    this._duck('music', 0.3); this._duck('ambience', 0.55);
    let wait = 0;
    if (a.chime && this.ready) wait = (a.tone === 'security' ? securityTone(this.lib, this._paOut(), this.ctx.currentTime + 0.05) : paChime(this.lib, this._paOut(), this.ctx.currentTime + 0.05)) * 0.85;
    else if (a.chime && !this.ready) wait = 0.1;
    setTimeout(() => {
      this._speak(a.text, { voice: this._pickVoice({ calm: true }), rate: 0.92, pitch: 1.0, volume: this._voiceVolume() * 0.9, onend: () => setTimeout(() => this._nextAnnounce(), 400) });
    }, wait * 1000);
  }
  _paOut() {
    // PA loudspeaker colouring on the voice channel: band-limited, slightly reverberant
    const ctx = this.ctx, C = this.mix.ch.voice;
    const hp = filter(ctx, 'highpass', 280, 0.7, C.world); const pk = filter(ctx, 'peaking', 2400, 1, hp, 3);
    const g = gain(ctx, this.listener.exterior ? 0.9 : 1, pk);
    setTimeout(() => { try { hp.disconnect(); } catch {} }, 8000);
    return g;
  }
  bark(d = {}) {
    if (!this.ready || !d.text && !d.murmur) return;
    const L = this.listener;
    const x = Number.isFinite(d.x) ? d.x : L.x, z = Number.isFinite(d.z) ? d.z : L.z;
    const y = Number.isFinite(d.y) ? d.y + 1.6 : L.y;
    const deck = d.deck ?? deckOfY(y - 1);
    const dist = Math.hypot(x - L.x, z - L.z) + Math.abs(deck - L.deck) * 8;
    if (dist > 28) return;
    const vo = d.voice || {};
    const now = this.ctx.currentTime;
    const occ = this._occlusion(x, y, z, deck);
    const vol = clamp(1 / (1 + Math.pow(dist / 4, 1.3)), 0, 1) * occ.g;
    const canSpeak = !this.announcing && !this.speaking && now - this.lastBark > 1.2 && dist < 14 && occ.g > 0.5 && d.text && typeof window !== 'undefined' && window.speechSynthesis && vol > 0.08;
    // handheld radio voice (security AI also emits the 'radio_chatter' squelch sfx itself)
    const radio = d.ctx === 'security_radio';
    if (canSpeak) {
      this.lastBark = now;
      const sex = vo.sex || (Math.random() < 0.5 ? 'f' : 'm');
      const seed = Math.floor(Math.abs((vo.pitch ?? 1) * 1000));
      const voice = this._pickVoice({ sex, seed });
      this._speak(String(d.text), { voice, rate: radio ? (vo.rate ?? 1.05) * 1.1 : vo.rate ?? 1.05, pitch: vo.pitch ?? (sex === 'f' ? 1.15 : 0.9), volume: this._voiceVolume() * vol * (radio ? 0.75 : 1), timeout: 1200 + String(d.text).length * 75 });
      return;
    }
    if (now - (this._lastMurmur || 0) < 0.25) return;
    this._lastMurmur = now;
    this.play3D((lib, o, t) => {
      if (!radio) return murmur(lib, o, t, String(d.text || 'mm hmm yes'), vo);
      // radio-filtered: band-limited 500–2800 Hz, saturated, with carrier hiss
      const c = lib.ctx, hp = filter(c, 'highpass', 520, 0.7), lp = filter(c, 'lowpass', 2700, 1.3), sat = shaper(c, 3.5, gain(c, 0.6, o));
      hp.connect(lp); lp.connect(sat);
      const dur = murmur(lib, hp, t, String(d.text || 'copy that'), vo);
      noise(lib, 'white', t, dur + 0.1, filter(c, 'bandpass', 1800, 0.5, gain(c, 0.02, o)));
      return dur;
    }, { x, y, z }, { channel: 'voice', ref: 2, maxD: 28, deck, vol: radio ? 0.8 : 0.9 });
  }

  // ── alarms ───────────────────────────────────────────────────────────────
  setAlarm(kind, on, deck) {
    if (!kind) return;
    const A = this.alarms[kind] || (this.alarms[kind] = { on: false, t: 0 });
    const was = A.on;
    A.on = !!on; A.deck = deck;
    if (A.on && !was) {
      A.t = 0; A.count = 0;
      if (kind === 'security') this.announce(`Attention all security personnel. Code Bravo, Code Bravo${Number.isFinite(deck) ? `, deck ${deck}` : ''}.`, true, { tone: 'security' });
      if (kind === 'muster') A.t = 0.2;
      if (kind === 'fire' && Number.isFinite(deck)) A.announceAt = 6;
    }
    if (!A.on && was && kind !== 'security') { this._unduck('music'); }
  }
  _updateAlarms(dt) {
    for (const kind in this.alarms) {
      const A = this.alarms[kind]; if (!A.on) continue;
      A.t -= dt;
      if (A.announceAt != null) { A.announceAt -= dt; if (A.announceAt <= 0) { A.announceAt = null; this.announce(`Bravo, Bravo, Bravo. Crew alert, deck ${A.deck}. All passengers please remain calm and follow crew instructions.`, false); } }
      if (A.t > 0 || !this.ready) continue;
      const lp = this.listener.exterior ? 6000 : 20000;
      if (kind === 'fire') {
        this._duck('music', 0.25, 6);
        this.play2D((lib, o, t) => { fireBell(lib, o, t, 3.0); klaxon(lib, o, t + 3.3, 1.1); klaxon(lib, o, t + 4.7, 1.1); return 6.2; }, { channel: 'sfx', vol: 0.6, dry: true, lp, prio: true });
        A.t = 7.5;
      } else if (kind === 'muster') {
        this._duck('music', 0.15, 20);
        const dur = this.play2D((lib, o, t) => musterPattern(lib, o, t), { channel: 'sfx', vol: this.listener.exterior ? 0.85 : 0.6, lp: this.listener.exterior ? 20000 : 1500, prio: true });
        A.count = (A.count || 0) + 1;
        if (A.count === 1) setTimeout(() => this.announce('This is the Captain speaking. This is the general emergency alarm. All passengers proceed immediately to your assigned muster station, wearing warm clothing and carrying any medication. Do not use the elevators.', false), dur * 1000 + 300);
        A.t = dur + 22;
      } else if (kind === 'security') {
        A.t = 45;
        if (A.count++ > 0) this.play2D(securityTone, { channel: 'sfx', vol: 0.5, dry: true });
      }
    }
  }

  // ── elevators ────────────────────────────────────────────────────────────
  _carPos(car, deck) {
    const plans = this.game.world?.plans || this.game.layout?.plans;
    const d = Number.isFinite(deck) ? deck : this.listener.deck;
    const p = plans?.[d];
    const dr = p?.doors?.find(o => o.car === car && o.type === 'elevator');
    if (dr) return { x: dr.x, z: dr.z, y: deckY(d) + 1.4, deck: d };
    const coreId = String(car || '').split('-')[0];
    const c = CORES.find(c => c.id === coreId) || CREW_CORES.find(c => c.id === coreId);
    return { x: c ? c.x : this.listener.x, z: 0, y: deckY(d) + 1.4, deck: d };
  }
  _elevatorMove(d) {
    if (!this.ready) return;
    const key = String(d?.car ?? 'car');
    const cur = this.elevHums.get(key);
    if (d?.moving && !cur) {
      const ctx = this.ctx, C = this.mix.ch.sfx;
      const g = gain(ctx, 0, C.world);
      const lp = filter(ctx, 'lowpass', 600, 0.7, g);
      const t = ctx.currentTime;
      const m1 = osc(ctx, 'sawtooth', 58, t, null, gain(ctx, 0.25, lp));
      const m2 = osc(ctx, 'sine', 116, t, null, gain(ctx, 0.3, lp));
      const ns = noise(this.lib, 'brown', t, null, filter(ctx, 'lowpass', 300, 0.7, gain(ctx, 1.2, g)));
      const rt = noise(this.lib, 'pink', t, null, filter(ctx, 'bandpass', 1400, 2, gain(ctx, 0.12, g)));   // rail swish
      const H = { g, lp, srcs: [m1, m2, ns, rt], car: key };
      this.elevHums.set(key, H);
      m1.frequency.setValueAtTime(40, t); m1.frequency.linearRampToValueAtTime(58, t + 1.5);
    } else if (!d?.moving && cur) {
      const t = this.ctx.currentTime;
      cur.g.gain.cancelScheduledValues(t); cur.g.gain.setTargetAtTime(0, t, 0.25);
      for (const s of cur.srcs) try { s.stop(t + 1.5); } catch {}
      setTimeout(() => { try { cur.g.disconnect(); } catch {} }, 2000);
      this.elevHums.delete(key);
    }
  }
  _updateElevators() {
    if (!this.elevHums.size) return;
    const L = this.listener, t = this.ctx.currentTime;
    const player = this.game.player;
    for (const H of this.elevHums.values()) {
      const coreId = H.car.split('-')[0];
      const c = CORES.find(c => c.id === coreId) || CREW_CORES.find(c => c.id === coreId);
      const dx = c ? Math.abs(L.x - c.x) : 0;
      const inCar = player?.elevator === H.car || player?.inElevator === H.car || (L.room && L.room.type === 'shaft' && dx < 6);
      const lvl = inCar ? 0.25 : clamp(1 - dx / 12, 0, 1) * 0.06 * (Math.abs(L.z) < 12 ? 1 : 0.3);
      H.g.gain.setTargetAtTime(lvl, t, 0.3);
      H.lp.frequency.setTargetAtTime(inCar ? 900 : 300, t, 0.3);
    }
  }

  // ── bus wiring ───────────────────────────────────────────────────────────
  _bindBus() {
    const bus = this.game.bus; if (!bus?.on) return;
    const on = (ev, fn) => { this.unsub.push(bus.on(ev, (d) => { if (!this.enabled) return; try { fn(d || {}); } catch (e) { console.warn('[audio]', ev, e); } })); };
    on('sfx', (d) => this.playSfx(d.name, d));
    on('footstep', (d) => this._footstep(d));
    on('door:move', (d) => this._door(d));
    on('elevator:arrive', (d) => { if (!this.ready) return; const p = this._carPos(d.car, d.deck); this.play3D((lib, o, t) => elevatorChime(lib, o, t, { up: d.up ?? d.dir !== 'down' }), p, { channel: 'sfx', ref: 2.5, maxD: 40, deck: p.deck }); });
    on('elevator:move', (d) => this._elevatorMove(d));
    on('announce', (d) => this.announce(d.text, d.local ? false : d.chime !== false, d.local ? { local: true } : {}));
    on('bark', (d) => this.bark(d));
    on('alarm', (d) => this.setAlarm(d.kind || 'security', d.on !== false, d.deck));
    on('heat:change', (d) => this.setHeat(d.level ?? d.heat ?? 0));
    on('mission:complete', () => this.sting('success'));
    on('mission:failed', () => this.sting('failure'));
    on('combat:shot', (d) => {
      if (!this.ready || !Number.isFinite(d.x)) return;
      if (d.silent || d.weapon === 'taser' || d.weapon === 'baton' || d.weapon === 'fist') return;
      this.playSfx('gunshot', d);
    });
    on('game:pause', () => {}); // pause state is polled in update
  }
  _footstep(d) {
    if (!this.ready || !Number.isFinite(d.x)) return;
    const L = this.listener;
    const isPlayer = d.actor && (d.actor === this.game.player || d.actor.isPlayer || d.actor === 'player');
    const dist = Math.hypot(d.x - L.x, d.z - L.z);
    if (!isPlayer) { if (dist > 26) return; if (this.stepBudget > 10) return; this.stepBudget++; }
    let surface = d.surface;
    if (!surface) {
      const r = (() => { try { return this.game.world?.roomAt?.(d.deck ?? L.deck, d.x, d.z); } catch { return null; } })();
      surface = surfaceForRoom(r);
    }
    const y = Number.isFinite(d.y) ? d.y + 0.05 : L.y - 1.55;
    this.play3D((lib, o, t) => footstepGen(lib, o, t, { surface, run: d.run }), { x: d.x, y, z: d.z }, {
      channel: 'sfx', ref: isPlayer ? 2.2 : 1.6, maxD: 30, deck: d.deck, vol: (isPlayer ? 0.75 : 0.5) * (d.vol ?? 1) * rand(0.85, 1.1), prio: isPlayer, occl: !isPlayer,
    });
  }
  _door(d) {
    if (!this.ready) return;
    const w = this.game.world; let dr = null;
    try { dr = w?.door ? w.door(d.deck, d.door) : null; } catch {}
    if (!dr) dr = (w?.plans || this.game.layout?.plans)?.[d.deck]?.doors?.[d.door];
    if (!dr && !Number.isFinite(d.x)) return;
    const x = dr?.x ?? d.x, z = dr?.z ?? d.z, deck = d.deck ?? this.listener.deck;
    const type = d.type || dr?.type || 'cabin';
    this.play3D((lib, o, t) => doorSound(lib, o, t, { type, opening: d.opening !== false }), { x, y: deckY(deck) + 1.2, z }, { channel: 'sfx', ref: type === 'watertight' ? 3 : 1.8, maxD: 40, deck, vol: 0.8 });
  }

  // ── frame ────────────────────────────────────────────────────────────────
  update(dt, realDt) {
    if (!this.ready || !this.enabled) return;
    if (this.ctx.state !== 'running') return;
    const rdt = Math.min(0.1, realDt ?? dt ?? 0.016);
    try {
      this._updateListener();
      this.stepBudget = Math.max(0, this.stepBudget - rdt * 40);
      // pause: muffle world, keep music direct path
      const paused = !!this.game.paused;
      if (paused !== this._paused) {
        this._paused = paused;
        const t = this.ctx.currentTime;
        for (const c of ['sfx', 'ambience', 'voice', 'music']) this.mix.ch[c].lp.frequency.setTargetAtTime(paused ? 700 : 20000, t, 0.15);
        this.mix.revLP.frequency.setTargetAtTime(paused ? 700 : 20000, t, 0.15);
        this.mix.ch.ambience.duck.gain.setTargetAtTime(paused ? 0.5 : 1, t, 0.3);
      }
      const uw = !!this.listener.inWater;
      if (uw !== this._uwState) {
        this._uwState = uw; const t = this.ctx.currentTime;
        for (const c of ['ambience', 'music']) this.mix.ch[c].lp.frequency.setTargetAtTime(uw ? 450 : (this._paused ? 700 : 20000), t, 0.1);
      }
      this.ctxT -= rdt;
      if (this.ctxT <= 0) { this.ctxT = 0.1; this._context(0.1); }
      if (!paused) this._spawners(rdt);
      this._updateMusic(rdt);
      this._updateAlarms(rdt);
      this._updateElevators();
      // heat polling (in case no events are emitted)
      const sh = this.game.security?.heat;
      if (Number.isFinite(sh) && sh !== this.heat) this.setHeat(sh);
    } catch (e) {
      if (!this._warned) { this._warned = true; console.warn('[audio] update error', e); }
    }
  }

  // diagnostics for tests / debug overlay
  debugState() {
    const beds = {}; for (const k in this.beds || {}) beds[k] = +this.beds[k].level.toFixed(3);
    return { ready: this.ready, state: this.ctx?.state, voices: this.voices, listener: { deck: this.listener.deck, room: this.listener.room?.name, type: this.listener.room?.type, exterior: this.listener.exterior },
      beds, bands: [...this.bands.keys()], tension: !!this.tension, heat: this.heat, announcing: this.announcing };
  }
  dispose() {
    for (const u of this.unsub) try { u(); } catch {}
    this.unsub = [];
    if (this._visHandler) document.removeEventListener?.('visibilitychange', this._visHandler);
    if (this._unlockHandler) { window.removeEventListener('pointerdown', this._unlockHandler, true); window.removeEventListener('keydown', this._unlockHandler, true); window.removeEventListener('touchstart', this._unlockHandler, true); }
    try { this.ctx?.close(); } catch {}
    this.ctx = null; this.mix = null;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
export function surfaceForRoom(r) {
  if (!r) return 'steel';
  if (r.pool) return 'water';
  switch (r.type) {
    case 'corridor': case 'cabin': case 'stair': case 'lounge': case 'dining': case 'bar': case 'theater': case 'casino': case 'library': case 'office': case 'officer': case 'bridge': return 'carpet';
    case 'suite': case 'pub': case 'shop': case 'gallery': case 'crew_bar': return 'wood';
    case 'lobby': case 'atrium': case 'services': return 'marble';
    case 'buffet': case 'spa': case 'medical': case 'galley': case 'laundry': return 'tile';
    case 'gym': case 'kids': case 'sportdeck': return 'rubber';
    case 'deck': case 'promenade': case 'pooldeck': case 'balcony': return 'teak';
    case 'nightclub': return 'wood';
    case 'crew_corridor': case 'crew_cabin': case 'crew_mess': case 'service': case 'security': return 'tile';
    default: return 'steel';
  }
}
function modalClink(lib, o, t, f) { SFX_HELPERS.modal(lib, o, t, { freqs: [f, f * 2.32, f * 4.1], amps: [1, 0.4, 0.15], decays: [rand(0.15, 0.4), 0.1, 0.05], lvl: 0.06 }); }
function noiseTick(lib, o, t) { const g = gain(lib.ctx, 0, o); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.02); g.gain.setTargetAtTime(0, t + 0.03, 0.02); noise(lib, 'crackle', t, 0.12, filter(lib.ctx, 'highpass', 3500, 0.7, g)); for (let i = 0; i < 3; i++) SFX_HELPERS.modal(lib, o, t + rand(0, 0.05), { freqs: [rand(3000, 5000)], amps: [1], decays: [0.03], lvl: 0.03 }); }
function burst2(lib, o, t) { const f = rand(1500, 4000); SFX_HELPERS.modal(lib, o, t, { freqs: [f, f * 1.6], amps: [1, 0.4], decays: [0.02, 0.012], lvl: rand(0.02, 0.06) }); }
const SFX_HELPERS = { modal: _modal };

// Gibberish murmur: syllables from the text's vowels, intonation from punctuation, voice from {pitch, rate, sex}.
export function murmur(lib, out, t, text, vo = {}) {
  const sex = vo.sex || (Math.random() < 0.5 ? 'f' : 'm');
  const f0 = (sex === 'f' ? 205 : 115) * (vo.pitch ?? 1) * rand(0.95, 1.05);
  const rate = vo.rate ?? 1;
  const words = text.split(/\s+/).filter(Boolean).slice(0, 14);
  const question = /\?\s*$/.test(text), excl = /!\s*$/.test(text);
  const VMAP = { a: VOWELS.a, e: VOWELS.e, i: VOWELS.i, o: VOWELS.o, u: VOWELS.u, y: VOWELS.i };
  let tt = t, k = 0, total = 0;
  const syl = []; for (const w of words) { const vs = (w.toLowerCase().match(/[aeiouy]+/g) || ['uh']); for (const v of vs) syl.push(VMAP[v[0]] || VOWELS.uh); syl.push(null); }
  const n = syl.length;
  for (const v of syl) {
    if (!v) { tt += rand(0.03, 0.08) / rate; continue; }
    const d = rand(0.08, 0.16) / rate;
    const prog = k / Math.max(1, n - 1);
    const contour = question && prog > 0.75 ? 1 + (prog - 0.75) * 1.2 : 1 + 0.18 * (1 - prog) + (excl ? 0.15 : 0);
    vocal(lib, out, tt, d, { f0: f0 * contour * rand(0.95, 1.06), f0End: f0 * contour * rand(0.9, 1.0), vowel: v, vowelEnd: pick(Object.values(VOWELS)), formantMul: sex === 'f' ? 1.17 : 1, lvl: (excl ? 0.32 : 0.24), attack: 0.012, release: 0.04, breath: 0.35, bright: 3200 });
    tt += d; k++;
  }
  total = tt - t;
  return total;
}

export { SFX_NAMES };
export const AUDIO_EVENTS = ['sfx', 'footstep', 'door:move', 'elevator:arrive', 'elevator:move', 'announce', 'bark', 'alarm', 'heat:change', 'mission:complete', 'mission:failed', 'combat:shot'];
