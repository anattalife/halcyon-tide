// HALCYON TIDE — audio DSP primitives (context-agnostic: work with AudioContext and OfflineAudioContext).
// Everything here is procedural: noise tables, impulse responses, envelopes, small synthesis helpers,
// a babble (crowd walla) generator and the master mixer graph.

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const chance = (p) => Math.random() < p;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
const EPS = 0.0001;

// ── shared library (noise tables + caches) ────────────────────────────────
export function makeLib(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 4);
  const mk = () => ctx.createBuffer(1, len, sr);
  const white = mk(), pink = mk(), brown = mk();
  const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < len; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926;
    br = (br + 0.02 * x) / 1.02; b[i] = br;
  }
  // make the loops seamless (crossfade the last 50 ms into the start) and normalise RMS
  for (const d of [w, p, b]) {
    const n = Math.floor(sr * 0.05);
    for (let i = 0; i < n; i++) { const k = i / n; d[i] = d[i] * k + d[len - n + i] * (1 - k); }
    let s = 0; for (let i = 0; i < len; i++) s += d[i] * d[i];
    const g = 0.25 / Math.sqrt(s / len);
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  // crackle table: sparse droplets / sizzle impulses
  const crackle = ctx.createBuffer(1, len, sr), c = crackle.getChannelData(0);
  let t = 0;
  while (t < len - 400) {
    const a = Math.pow(Math.random(), 2.5) * 0.9;
    const dec = 0.92 + Math.random() * 0.06;
    let v = a * (Math.random() < 0.5 ? -1 : 1);
    for (let k = 0; k < 300; k++) { c[t + k] += v * (Math.random() * 0.6 + 0.4); v *= dec; }
    t += Math.floor(Math.random() * sr * 0.004) + 20;
  }
  return { ctx, sr, white, pink, brown, crackle, cache: new Map() };
}

// ── node helpers ────────────────────────────────────────────────────────────
export function gain(ctx, v = 1, out) { const g = ctx.createGain(); g.gain.value = v; if (out) g.connect(out); return g; }
export function filter(ctx, type, f, Q = 0.707, out, dbGain = 0) {
  const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, ctx.sampleRate * 0.45); b.Q.value = Q; if (dbGain) b.gain.value = dbGain;
  if (out) b.connect(out); return b;
}
export function panner2(ctx, pan = 0, out) {
  if (!ctx.createStereoPanner) { const g = gain(ctx, 1, out); g.pan = { value: 0, setTargetAtTime() {}, setValueAtTime() {} }; return g; }
  const p = ctx.createStereoPanner(); p.pan.value = pan; if (out) p.connect(out); return p;
}
export function noise(lib, type, t, dur, out, rate = 1) {
  const s = lib.ctx.createBufferSource(); s.buffer = lib[type] || lib.white; s.playbackRate.value = rate;
  const bd = s.buffer.duration;
  if (dur == null || dur > bd * rate - 0.2) s.loop = true;
  s.connect(out);
  s.start(t, Math.random() * (bd - Math.min(bd * 0.5, (dur || 0) * rate)));
  if (dur != null) s.stop(t + dur + 0.02);
  return s;
}
export function osc(ctx, type, f, t, dur, out, detune = 0) {
  const o = ctx.createOscillator();
  if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
  o.frequency.value = f; if (detune) o.detune.value = detune;
  o.connect(out); o.start(t); if (dur != null) o.stop(t + dur + 0.02);
  return o;
}
// attack / exponential decay envelope on an AudioParam
export function envAD(param, t, a, peak, d, floor = EPS) {
  peak = Math.max(peak, EPS * 2);
  param.setValueAtTime(floor, t);
  if (a > 0.0005) param.exponentialRampToValueAtTime(peak, t + a); else param.setValueAtTime(peak, t);
  param.exponentialRampToValueAtTime(floor, t + a + Math.max(0.005, d));
}
// attack / hold / release (linear attack, exponential release) — for sustained tones
export function envAHR(param, t, a, peak, hold, r) {
  peak = Math.max(peak, EPS * 2);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setValueAtTime(peak, t + a + hold);
  param.setTargetAtTime(0, t + a + hold, Math.max(0.005, r / 4));
}

// Filtered noise burst — the workhorse for impacts, scuffs and splashes.
export function burst(lib, out, t, o) {
  const ctx = lib.ctx;
  const g = gain(ctx, 0, out);
  let head = g;
  if (o.type) { const f = filter(ctx, o.type, o.f, o.Q ?? 0.8, g); if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.sweep ?? (o.a || 0.001) + o.d)); head = f; }
  if (o.type2) { const f2 = filter(ctx, o.type2, o.f2b ?? o.f, o.Q2 ?? 0.7, head); head = f2; }
  // bandwidth compensation: `lvl` ≈ peak of the filtered noise. frac = share of the noise power in the passband.
  let comp = 1;
  const nt = o.noise || 'white', nyq = lib.sr / 2, Qv = o.Q ?? 0.8;
  if (o.type && (nt === 'white' || nt === 'pink')) {
    let frac = 1;
    if (nt === 'white') frac = o.type === 'bandpass' ? (o.f / Qv) / nyq : o.type === 'lowpass' ? o.f / nyq : o.type === 'highpass' ? 1 - o.f / nyq : 1;
    else frac = o.type === 'bandpass' ? (1 / Qv) / 7 : o.type === 'lowpass' ? Math.log(Math.max(1.5, o.f / 20)) / 7 : o.type === 'highpass' ? Math.log(Math.max(1.2, nyq / o.f)) / 7 : 1;
    comp = clamp(0.55 / Math.sqrt(clamp(frac, 0.001, 1)), 0.6, 7);
  }
  envAD(g.gain, t, o.a ?? 0.001, (o.lvl ?? 0.5) * comp, o.d ?? 0.05);
  noise(lib, o.noise || 'white', t, (o.a ?? 0.001) + (o.d ?? 0.05) + 0.05, head, o.rate || 1);
  return (o.a ?? 0.001) + (o.d ?? 0.05);
}
// Pitched tone with optional pitch sweep
export function tone(lib, out, t, o) {
  const ctx = lib.ctx;
  const g = gain(ctx, 0, out);
  const dur = (o.a ?? 0.002) + (o.d ?? 0.1);
  const v = osc(ctx, o.wave || 'sine', o.f, t, dur + 0.05, g, o.detune || 0);
  if (o.f2) { v.frequency.setValueAtTime(o.f, t); v.frequency.exponentialRampToValueAtTime(Math.max(5, o.f2), t + (o.sweep ?? dur)); }
  if (o.hold) envAHR(g.gain, t, o.a ?? 0.01, o.lvl ?? 0.3, o.hold, o.d ?? 0.1);
  else envAD(g.gain, t, o.a ?? 0.002, o.lvl ?? 0.3, o.d ?? 0.1);
  return dur + (o.hold || 0);
}
// Modal resonator bank: sum of exponentially decaying sines (metal, glass, bells, wood)
export function modal(lib, out, t, o) {
  const ctx = lib.ctx; let maxD = 0;
  const g = gain(ctx, o.lvl ?? 0.3, out);
  const n = o.freqs.length;
  for (let i = 0; i < n; i++) {
    const d = (o.decays ? o.decays[i] : o.d ?? 0.4) * (o.dJit ? rand(1 - o.dJit, 1 + o.dJit) : 1);
    const a = o.amps ? o.amps[i] : 1 / (i + 1);
    const pg = gain(ctx, 0, g);
    osc(ctx, 'sine', o.freqs[i], t, d + 0.05, pg);
    envAD(pg.gain, t, o.a ?? 0.0008, a, d);
    maxD = Math.max(maxD, d);
  }
  return maxD;
}

// Formant voice: band-limited sawtooth through three formant band-passes (+breath noise).
export const VOWELS = {
  a: [800, 1150, 2900], e: [400, 2000, 2550], i: [300, 2300, 3000], o: [450, 800, 2830], u: [325, 700, 2530],
  ae: [660, 1700, 2400], uh: [600, 1040, 2250], er: [490, 1350, 1690], aw: [570, 840, 2410], oo: [370, 950, 2670],
};
export function vocal(lib, out, t, dur, o) {
  const ctx = lib.ctx;
  const env = gain(ctx, 0, out);
  const mix = gain(ctx, 1, env);
  const pre = filter(ctx, 'lowpass', o.bright ?? 3800, 0.5);
  const src = osc(ctx, 'sawtooth', o.f0, t, dur + 0.1, pre);
  src.frequency.setValueAtTime(o.f0, t);
  if (o.f0Mid) src.frequency.linearRampToValueAtTime(o.f0Mid, t + dur * 0.35);
  src.frequency.linearRampToValueAtTime(o.f0End ?? o.f0, t + dur);
  if (o.vib) {
    const l = osc(ctx, 'sine', o.vibRate || 5.5, t, dur + 0.1, gain(ctx, o.f0 * o.vib, src.frequency));
    l.frequency.value = (o.vibRate || 5.5) * rand(0.9, 1.1);
  }
  const V0 = o.vowel || VOWELS.a, V1 = o.vowelEnd || V0;
  const fm = o.formantMul || 1;
  const amps = [1, 0.55, 0.28];
  for (let k = 0; k < 3; k++) {
    const bp = filter(ctx, 'bandpass', V0[k] * fm, V0[k] / (k === 0 ? 90 : k === 1 ? 110 : 160), gain(ctx, amps[k] * (k === 0 ? 2.2 : 3.2), mix));
    bp.frequency.setValueAtTime(V0[k] * fm, t);
    bp.frequency.linearRampToValueAtTime(V1[k] * fm, t + dur);
    pre.connect(bp);
  }
  if (o.breath) {
    const bn = filter(ctx, 'bandpass', (V0[1] || 1200) * fm, 0.9, gain(ctx, o.breath, mix));
    noise(lib, 'white', t, dur + 0.05, bn);
  }
  const a = o.attack ?? 0.02, r = o.release ?? 0.08, lvl = o.lvl ?? 0.4;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(lvl, t + a);
  if (o.swell) env.gain.linearRampToValueAtTime(lvl * o.swell, t + dur * 0.6);
  env.gain.setValueAtTime(lvl * (o.swell || 1), t + Math.max(a, dur - r));
  env.gain.linearRampToValueAtTime(0, t + dur);
  return dur;
}

// Soft saturation curve for grit
let _satCurves = new Map();
export function satCurve(drive = 2) {
  if (_satCurves.has(drive)) return _satCurves.get(drive);
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  _satCurves.set(drive, c); return c;
}
export function shaper(ctx, drive, out) { const w = ctx.createWaveShaper(); w.curve = satCurve(drive); w.oversample = '2x'; if (out) w.connect(out); return w; }

// ── impulse responses ───────────────────────────────────────────────────────
// Stereo exponentially decaying noise with time-varying low-pass (HF decays faster),
// sparse early reflections and a pre-delay.
export function makeIR(ctx, seconds, o = {}) {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor((o.predelay ?? 0.01) * sr);
  const fc0 = o.bright ?? 9000, fc1 = o.dark ?? 900;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const tt = (i - pre) / sr, k = tt / seconds;
      const env = Math.exp(-6.9 * k) * Math.min(1, tt / 0.004);
      const fc = fc0 * Math.pow(fc1 / fc0, k);
      const a = Math.exp(-2 * Math.PI * fc / sr);
      y = (1 - a) * (Math.random() * 2 - 1) + a * y;
      d[i] = y * env * (1 + (1 - a) * 0.3);
    }
    const er = o.early ?? 8;
    for (let e = 0; e < er; e++) {
      const at = pre + Math.floor(sr * (0.004 + Math.random() * (o.erSpread ?? 0.06)));
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5) * (1 - e / er) * 0.6;
    }
  }
  return buf;
}

// ── crowd babble (walla) ────────────────────────────────────────────────────
// Renders N independent formant-synthesised "talkers" with syllable rhythm, intonation and pauses.
export function makeBabble(ctx, seconds = 6, voices = 9, pitchMul = 1, formantMul = 1, seed = 1) {
  const sr = 22050, len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const VW = Object.values(VOWELS);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const tmp = new Float32Array(len);
  for (let v = 0; v < voices; v++) {
    tmp.fill(0);
    const male = rnd() < 0.5;
    const base = (male ? 105 + rnd() * 40 : 185 + rnd() * 50) * pitchMul;
    const fmul = (male ? 1 : 1.17) * formantMul;
    // per-voice formant resonators (2-pole), coefficients updated per syllable
    let t = Math.floor(rnd() * sr * 0.8), phase = 0;
    while (t < len) {
      // phrase
      const syl = 3 + Math.floor(rnd() * 9);
      const declin = 0.75 + rnd() * 0.15;
      for (let k = 0; k < syl && t < len; k++) {
        const dur = Math.floor(sr * (0.09 + rnd() * 0.17));
        const V = VW[Math.floor(rnd() * VW.length)], V2 = VW[Math.floor(rnd() * VW.length)];
        const f0a = base * (1 + (1 - k / syl) * 0.25 * declin + (rnd() - 0.5) * 0.12);
        const f0b = f0a * (0.92 + rnd() * 0.12);
        const amp = 0.5 + rnd() * 0.5;
        const cons = rnd() < 0.6;   // fricative onset
        const st = [[0, 0], [0, 0], [0, 0]];
        for (let n = 0; n < dur && t + n < len; n++) {
          const u = n / dur;
          const f0 = f0a + (f0b - f0a) * u;
          phase += f0 / sr; if (phase >= 1) phase -= 1;
          let src = (phase * 2 - 1) * 0.6;           // glottal-ish saw
          const e = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
          if (cons && u < 0.18) src = src * (u / 0.18) + (rnd() * 2 - 1) * 0.5 * (1 - u / 0.18);
          let y = 0;
          for (let f = 0; f < 3; f++) {
            if ((n & 15) === 0 || n === 0) { /* coefficients recomputed below */ }
            const Ff = (V[f] + (V2[f] - V[f]) * u) * fmul;
            const bw = f === 0 ? 90 : f === 1 ? 120 : 170;
            const r = Math.exp(-Math.PI * bw / sr), th = 2 * Math.PI * Ff / sr;
            const a1 = 2 * r * Math.cos(th), a2 = -r * r;
            const yy = (1 - r) * src + a1 * st[f][0] + a2 * st[f][1];
            st[f][1] = st[f][0]; st[f][0] = yy;
            y += yy * (f === 0 ? 1 : f === 1 ? 0.7 : 0.35);
          }
          tmp[t + n] += y * e * amp;
        }
        t += dur + Math.floor(sr * rnd() * 0.04);
      }
      t += Math.floor(sr * (0.15 + rnd() * 0.9));      // breath / listening pause
    }
    const pan = rnd();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    for (let i = 0; i < len; i++) { L[i] += tmp[i] * gl; R[i] += tmp[i] * gr; }
  }
  // gentle low-pass, seamless loop, normalise
  for (const d of [L, R]) {
    let y = 0; const a = Math.exp(-2 * Math.PI * 3200 / sr);
    for (let i = 0; i < len; i++) { y = (1 - a) * d[i] + a * y; d[i] = y; }
    const n = Math.floor(sr * 0.3);
    for (let i = 0; i < n; i++) { const k = i / n; d[i] = d[i] * k + d[len - n + i] * (1 - k); }
  }
  let pk = 0; for (const d of [L, R]) for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
  const g = 0.7 / (pk || 1);
  for (const d of [L, R]) for (let i = 0; i < len; i++) d[i] *= g;
  return buf;
}

// ── master mixer ────────────────────────────────────────────────────────────
// channel → [world: pause-LPF] → channel volume → duck → master → glue comp → limiter → soft clip → out
export const CHANNELS = ['music', 'sfx', 'ambience', 'voice'];
export function createMixer(ctx, lib, dest = ctx.destination) {
  const M = { ctx, ch: {} };
  const clipPre = gain(ctx, 0.5);
  const clip = ctx.createWaveShaper();
  {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = ((i / (n - 1)) * 2 - 1) * 2, a = Math.abs(u);
      c[i] = Math.sign(u) * (a < 0.85 ? a : 0.85 + 0.13 * Math.tanh((a - 0.85) / 0.13));
    }
    clip.curve = c; clip.oversample = '4x';
  }
  clipPre.connect(clip); clip.connect(dest);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
  lim.connect(clipPre);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 2.5; comp.attack.value = 0.012; comp.release.value = 0.3;
  comp.connect(lim);
  const dcb = filter(ctx, 'highpass', 22, 0.7, comp);
  M.master = gain(ctx, 1, dcb);
  M.comp = comp; M.lim = lim;
  // reverb: three convolvers (small room / hall / large space) behind a common input
  M.revIn = gain(ctx, 1);
  M.revOut = gain(ctx, 0.9, M.master);
  M.rev = {};
  const IRS = { small: [0.55, { predelay: 0.004, bright: 7000, dark: 1200, early: 10, erSpread: 0.025 }],
                hall: [1.7, { predelay: 0.015, bright: 8000, dark: 900, early: 10, erSpread: 0.06 }],
                large: [3.6, { predelay: 0.035, bright: 7000, dark: 700, early: 12, erSpread: 0.12 }] };
  for (const k in IRS) {
    const cv = ctx.createConvolver(); cv.buffer = makeIR(ctx, IRS[k][0], IRS[k][1]);
    const g = gain(ctx, k === 'hall' ? 1 : 0, cv); M.revIn.connect(g); cv.connect(M.revOut);
    M.rev[k] = g;
  }
  // per channel: world (diegetic, pause-LPF + reverb send) and direct (UI / score) inputs
  //   world → lp → duck → out(user volume) → master ; world → send → reverb
  //   dry   → lp (no reverb send) ; direct → duck
  for (const name of CHANNELS) {
    const C = {};
    C.out = gain(ctx, 1, M.master);
    C.duck = gain(ctx, 1, C.out);
    C.lp = filter(ctx, 'lowpass', 20000, 0.5, C.duck);
    C.world = gain(ctx, 1, C.lp);
    C.dry = gain(ctx, 1, C.lp);
    C.sendBase = name === 'music' ? 0.22 : name === 'ambience' ? 0.25 : name === 'voice' ? 0.3 : 0.35;
    C.send = gain(ctx, C.sendBase, M.revIn);
    C.world.connect(C.send);
    C.direct = gain(ctx, 1, C.duck);
    M.ch[name] = C;
  }
  // reverb return passes through the sfx pause filter so pausing muffles tails too
  M.revOut.disconnect(); M.revLP = filter(ctx, 'lowpass', 20000, 0.5, M.master); M.revOut.connect(M.revLP);
  return M;
}
