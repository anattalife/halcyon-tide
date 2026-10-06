// Offline audio test bench: renders sounds through OfflineAudioContext and computes objective metrics.
// Used by tools/audioTest.py (Playwright) and usable manually by opening tools/audioTest.html.
import { makeLib, createMixer, gain } from '../src/audio/dsp.js';
import { SFX, SFX_NAMES, fireBell, klaxon, musterPattern, securityTone, paChime, gullCall } from '../src/audio/sfx.js';
import { Band, STYLES, sting } from '../src/audio/music.js';
import { AudioSystem, murmur } from '../src/audio/audio.js';

const SR = 44100;

function metrics(buf, skip = 0) {
  const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const n = buf.length, s0 = Math.floor(skip * buf.sampleRate);
  let peak = 0, sum = 0, nan = 0, dc = 0;
  for (const d of chs) for (let i = s0; i < n; i++) { const v = d[i]; if (!Number.isFinite(v)) { nan++; continue; } const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; dc += v; }
  const cnt = (n - s0) * chs.length;
  const rms = Math.sqrt(sum / Math.max(1, cnt));
  // active duration: last 10 ms window above peak-50dB
  const win = Math.floor(buf.sampleRate * 0.01); let last = 0, first = -1;
  const thr = peak * Math.pow(10, -50 / 20);
  for (let w = s0; w < n; w += win) { let m = 0; for (const d of chs) for (let i = w; i < Math.min(n, w + win); i++) m = Math.max(m, Math.abs(d[i])); if (m > thr) { last = w + win; if (first < 0) first = w; } }
  // spectral centroid & band energies via DFT on 2048-sample frames (mono mix), up to 40 frames
  const N = 1024, frames = [];
  const a0 = Math.max(s0, first < 0 ? s0 : first), a1 = Math.min(n - N, Math.max(a0 + N, last));
  const step = Math.max(N / 2, Math.floor((a1 - a0) / 60));
  for (let st = a0; st <= a1 && frames.length < 60; st += step) frames.push(st);
  let cNum = 0, cDen = 0; const bands = [0, 0, 0, 0]; // <200, 200-2k, 2k-6k, >6k
  const re = new Float32Array(N), im = new Float32Array(N);
  for (const st of frames) {
    for (let i = 0; i < N; i++) { let v = 0; for (const d of chs) v += d[st + i]; re[i] = (v / chs.length) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const f = k * buf.sampleRate / N, p = re[k] * re[k] + im[k] * im[k]; cNum += f * p; cDen += p; bands[f < 200 ? 0 : f < 2000 ? 1 : f < 6000 ? 2 : 3] += p; }
  }
  const bt = bands.reduce((a, b) => a + b, 0) || 1;
  return {
    peak: +peak.toFixed(3), rmsDb: +(20 * Math.log10(rms + 1e-12)).toFixed(1), crest: +(20 * Math.log10((peak + 1e-12) / (rms + 1e-12))).toFixed(1),
    dur: +((last - Math.max(0, first)) / buf.sampleRate).toFixed(2), onset: +((Math.max(0, first) - s0) / buf.sampleRate).toFixed(3),
    centroid: Math.round(cNum / (cDen || 1)), nan, dc: +(dc / Math.max(1, cnt)).toFixed(4),
    bands: bands.map(b => Math.round(100 * b / bt)),
  };
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const a = i + j, b = a + len / 2; const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}

// Render a generator raw (gain 1 → destination) or through the full mixer chain.
async function renderGen(gen, seconds, { mixed = false, channel = 'sfx', opts = {} } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const lib = makeLib(ctx);
  let out;
  if (mixed) { const M = createMixer(ctx, lib); M.master.gain.value = 0.64; for (const c in M.ch) M.ch[c].out.gain.value = 0.81; out = M.ch[channel].world; }
  else out = gain(ctx, 1, ctx.destination);
  const d = gen(lib, out, 0.05, opts) || 1;
  const buf = await ctx.startRendering();
  return { buf, genDur: d };
}

export const CASES = () => {
  const list = [];
  for (const n of SFX_NAMES) list.push({ name: n, gen: SFX[n], secs: n === 'thunder' ? 8 : n === 'ship_horn' ? 7 : 3 });
  for (const s of ['carpet', 'wood', 'tile', 'steel', 'teak', 'water', 'rubber', 'marble']) {
    list.push({ name: 'step_' + s, gen: (lib, o, t) => SFX.footstep(lib, o, t, { surface: s }), secs: 0.8 });
    list.push({ name: 'step_' + s + '_run', gen: (lib, o, t) => SFX.footstep(lib, o, t, { surface: s, run: true }), secs: 0.8 });
  }
  for (const ty of ['cabin', 'swing', 'glass', 'watertight', 'crew', 'balcony', 'elevator']) for (const op of [true, false]) list.push({ name: `door_${ty}_${op ? 'open' : 'close'}`, gen: (lib, o, t) => SFX.door(lib, o, t, { type: ty, opening: op }), secs: 3.5 });
  list.push({ name: 'gunshot_ext', gen: (lib, o, t) => SFX.gunshot(lib, o, t, { exterior: true }), secs: 3 });
  list.push({ name: 'elevator_chime', gen: SFX.elevator_chime, secs: 4 });
  list.push({ name: 'fire_bell', gen: (lib, o, t) => fireBell(lib, o, t, 3), secs: 4 });
  list.push({ name: 'klaxon', gen: (lib, o, t) => klaxon(lib, o, t, 1.2), secs: 2 });
  list.push({ name: 'muster', gen: musterPattern, secs: 26 });
  list.push({ name: 'security_tone', gen: securityTone, secs: 3.5 });
  list.push({ name: 'pa_chime', gen: paChime, secs: 4 });
  list.push({ name: 'gull', gen: gullCall, secs: 2.5 });
  list.push({ name: 'murmur', gen: (lib, o, t) => murmur(lib, o, t, 'Excuse me, do you know where the buffet is?', { sex: 'f' }), secs: 4 });
  list.push({ name: 'sting_success', gen: (lib, o, t) => sting(lib, o, t, 'success'), secs: 4.5 });
  list.push({ name: 'sting_failure', gen: (lib, o, t) => sting(lib, o, t, 'failure'), secs: 6 });
  return list;
};

export async function runSfx(filter = null, mixed = false) {
  const rows = [];
  for (const c of CASES()) {
    if (filter && !filter.some(f => c.name.includes(f))) continue;
    try {
      const { buf, genDur } = await renderGen(c.gen, c.secs, { mixed, channel: ['grunt', 'scream', 'gasp', 'murmur'].includes(c.name) ? 'voice' : 'sfx' });
      rows.push({ name: c.name, genDur: +(+genDur).toFixed(2), ...metrics(buf) });
    } catch (e) { rows.push({ name: c.name, error: String(e && e.stack || e).slice(0, 300) }); }
  }
  return rows;
}

export async function runMusic(seconds = 20, mixed = false, which = null) {
  const rows = [];
  for (const style of Object.keys(STYLES)) {
    if (which && !which.includes(style)) continue;
    try {
      const ctx = new OfflineAudioContext(2, SR * seconds, SR);
      const lib = makeLib(ctx);
      let out;
      if (mixed) { const M = createMixer(ctx, lib); M.master.gain.value = 0.64; M.ch.music.out.gain.value = 0.49; out = M.ch.music.world; }
      else out = gain(ctx, 1, ctx.destination);
      const b = new Band(lib, out, style, {});
      if (style === 'tension') b.level = 0.9;
      let notes = 0;
      for (let i = 0; i < 4000 && b.nextT < seconds - 1; i++) { const before = b.stepI + b.bar * 100; b.schedule(b.nextT + 0.5); notes += (b.stepI + b.bar * 100) !== before ? 1 : 0; }
      const buf = await ctx.startRendering();
      rows.push({ name: 'music_' + style, bars: b.bar, bpm: Math.round(b.bpm), ...metrics(buf, 1) });
    } catch (e) { rows.push({ name: 'music_' + style, error: String(e && e.stack || e).slice(0, 300) }); }
  }
  return rows;
}

// Ambience: drive a real AudioSystem with a fake game and an injected OfflineAudioContext.
export async function runAmbience(seconds = 8) {
  const rooms = [
    ['exterior_calm', { type: 'deck', dens: 'deck', exterior: true }, { wind: 0.3 }, 25],
    ['exterior_storm', { type: 'deck', dens: 'deck', exterior: true }, { wind: 0.9, storm: 0.9, rain: 0.8 }, 25],
    ['corridor', { type: 'corridor', dens: 'transit', facade: 'solid', zone: 'public' }, {}, 21],
    ['cabin', { type: 'cabin', facade: 'window', zone: 'private' }, {}, 21],
    ['cabin_rain', { type: 'cabin', facade: 'window', zone: 'private' }, { rain: 0.9, storm: 0.5 }, 21],
    ['engine_room', { type: 'engine', dens: 'engine', zone: 'restricted', facade: 'solid' }, {}, -4.4],
    ['crew_corr_d2', { type: 'crew_corridor', dens: 'crewtransit', zone: 'crew' }, {}, -1.4],
    ['galley', { type: 'galley', dens: 'galley', zone: 'crew' }, {}, 4.6],
    ['laundry', { type: 'laundry', dens: 'laundry', zone: 'crew' }, {}, -4.4],
    ['casino', { type: 'casino', dens: 'casino', facade: 'solid', zone: 'public', area: 774 }, {}, 7.6],
    ['atrium', { type: 'atrium', dens: 'atrium', facade: 'glass', zone: 'public', area: 1000 }, {}, 7.6],
    ['pool_deck', { type: 'pooldeck', dens: 'pool', exterior: true }, { wind: 0.3 }, 37.6],
    ['nightclub', { type: 'nightclub', dens: 'club', zone: 'public', area: 676 }, {}, 10.6],
  ];
  const rows = [];
  for (const [name, room, weather, y] of rooms) {
    try {
      const ctx = new OfflineAudioContext(2, SR * seconds, SR);
      const bus = { on: () => () => {} };
      const game = { bus, camera: { position: { x: 0, y, z: 0 }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } },
        env: { weather: { wind: 0.3, storm: 0, rain: 0, fog: 0, ...weather } }, hour: name === 'nightclub' ? 23 : 14, shipSpeedK: 1,
        player: { x: 0, y: y - 1.6, z: 0, deck: Math.floor((y - 1.6 + 6) / 3 + 1e-3) + 1, room: { ...room, x0: -15, x1: 15, z0: -10, z1: 10, cx: 0, cz: 0 }, exterior: !!room.exterior, inWater: false } };
      const sys = new AudioSystem(game);
      sys.unlock(ctx);
      await new Promise(r => setTimeout(r, 700));   // deferred babble beds
      sys.venues = [];   // music measured separately
      sys._updateListener();
      for (let k = 0; k < 10; k++) sys._context(0.1);
      // spawn ambient one-shots over the render period by running spawners with a fake clock
      // (Offline: schedule spawns at future times by temporarily shifting via delay)
      const origPlay3D = sys.play3D.bind(sys), origPlay2D = sys.play2D.bind(sys);
      let simT = 0;
      sys.play3D = (g, p, o = {}) => origPlay3D(g, p, { ...o, delay: (o.delay || 0) + simT });
      sys.play2D = (g, o = {}) => origPlay2D(g, { ...o, delay: (o.delay || 0) + simT });
      for (simT = 0; simT < seconds - 1; simT += 0.1) { sys.voices = 0; sys._spawners(0.1); }
      const buf = await ctx.startRendering();
      rows.push({ name: 'amb_' + name, beds: Object.entries(sys.debugState().beds).filter(([, v]) => v > 0.001).map(([k, v]) => k + ':' + v).join(' '), ...metrics(buf, 4) });
    } catch (e) { rows.push({ name: 'amb_' + name, error: String(e && e.stack || e).slice(0, 400) }); }
  }
  return rows;
}

// live (realtime) smoke test of installAudio against a fake game
window.__audioTest = { runSfx, runMusic, runAmbience, metrics };
window.__audioTestReady = true;
