// HALCYON TIDE — procedural instruments for the generative music system.
// Signature: fn(lib, out, t, midi, vel(0..1), dur(seconds), opts) — schedules one note.
import { rand, gain, filter, noise, osc, envAD, mtof, shaper } from './dsp.js';

// ── periodic wave cache ────────────────────────────────────────────────────
function pwave(lib, key, fn, n = 32) {
  const k = 'pw:' + key;
  if (lib.cache.has(k)) return lib.cache.get(k);
  const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
  for (let i = 1; i <= n; i++) im[i] = fn(i);
  const w = lib.ctx.createPeriodicWave(re, im, { disableNormalization: false });
  lib.cache.set(k, w); return w;
}
const pianoWave = (lib, reg) => pwave(lib, 'piano' + reg, (n) => (1 / Math.pow(n, reg === 0 ? 1.05 : reg === 1 ? 1.35 : 1.7)) * (n % 7 === 0 ? 0.3 : 1) * (1 + 0.25 * Math.sin(n * 1.3)), 24);
const bassWave = (lib) => pwave(lib, 'ubass', (n) => n === 1 ? 1 : n === 2 ? 0.55 : n === 3 ? 0.25 : 0.4 / (n * n), 12);
const organWave = (lib) => pwave(lib, 'organ', (n) => ({ 1: 1, 2: 0.6, 3: 0.35, 4: 0.3, 6: 0.15, 8: 0.12 })[n] || 0, 8);

// Karplus–Strong plucked string, rendered once per pitch/preset and cached.
function ksBuffer(lib, midi, o) {
  const key = `ks:${midi}:${o.decay}:${o.bright}:${o.dur}`;
  if (lib.cache.has(key)) return lib.cache.get(key);
  const sr = lib.sr, f = mtof(midi), len = Math.floor(sr * o.dur);
  const buf = lib.ctx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  const D = sr / f - 0.5, d0 = Math.floor(D), fr = D - d0;
  // excitation: lowpassed noise burst with pick-position comb
  const N = Math.max(2, d0 + 1);
  const exc = new Float32Array(N);
  let lp = 0; const a = 1 - o.bright;
  for (let i = 0; i < N; i++) { lp = a * lp + (1 - a) * (Math.random() * 2 - 1); exc[i] = lp; }
  const pp = Math.floor(N * (o.pick ?? 0.18));
  for (let i = N - 1; i >= pp; i--) exc[i] -= exc[i - pp] * 0.9;
  let prev = 0;
  const g = Math.pow(o.decay, 440 / Math.max(80, f)) ;   // keep sustain time roughly constant over pitch
  for (let n = 0; n < len; n++) {
    const i0 = n - d0, i1 = n - d0 - 1;
    const s = (i0 >= 0 ? y[i0] : 0) * (1 - fr) + (i1 >= 0 ? y[i1] : 0) * fr;
    const v = 0.5 * (s + prev); prev = s;
    y[n] = (n < N ? exc[n] : 0) + g * v;
  }
  let pk = 0; for (let n = 0; n < len; n++) pk = Math.max(pk, Math.abs(y[n]));
  const k = 0.9 / (pk || 1); const fade = Math.floor(sr * 0.05);
  for (let n = 0; n < len; n++) y[n] *= k * (n > len - fade ? (len - n) / fade : 1);
  lib.cache.set(key, buf);
  return buf;
}
function playBuf(lib, out, t, buf, vel, dur, rel = 0.12, rate = 1) {
  const s = lib.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  const g = gain(lib.ctx, vel, out); s.connect(g);
  const end = Math.min(t + dur, t + buf.duration / rate);
  g.gain.setValueAtTime(vel, t); g.gain.setTargetAtTime(0, end, rel / 3);
  s.start(t); s.stop(end + rel + 0.05);
  return s;
}

export const INST = {
  piano(lib, out, t, m, vel, dur) {
    const ctx = lib.ctx, f = mtof(m), reg = m < 52 ? 0 : m < 72 ? 1 : 2;
    const g = gain(ctx, 0, out);
    const lp = filter(ctx, 'lowpass', 1000, 0.5, g);
    const w = pianoWave(lib, reg);
    const len = Math.min(dur, 6) + 0.6;
    const o1 = osc(ctx, w, f, t, len, lp, -2.5 + rand(-0.5, 0.5));
    const o2 = osc(ctx, w, f, t, len, gain(ctx, 0.7, lp), 2.5 + rand(-0.5, 0.5));
    const bright = Math.min(12000, f * (3 + vel * 9));
    lp.frequency.setValueAtTime(bright, t);
    lp.frequency.setTargetAtTime(Math.max(f * 1.5, 500), t + 0.01, 0.35 + 0.4 * (1 - reg / 2));
    const decayT = 0.9 * Math.pow(2, (60 - m) / 24);  // lower notes sustain longer
    const pk = 0.28 * Math.pow(vel, 1.3) * (reg === 2 ? 0.85 : 1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.004);
    g.gain.setTargetAtTime(pk * 0.35, t + 0.004, 0.12);
    g.gain.setTargetAtTime(0.0, t + 0.15, decayT);
    g.gain.setTargetAtTime(0, t + dur, 0.06);                // damper
    // hammer thump
    const hg = gain(ctx, 0, out); const hb = filter(ctx, 'bandpass', Math.min(4000, f * 4), 1, hg);
    envAD(hg.gain, t, 0.001, 0.02 * vel, 0.02); noise(lib, 'white', t, 0.05, hb);
  },
  epiano(lib, out, t, m, vel, dur) {   // FM tine piano (Rhodes-ish)
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out);
    const len = Math.min(dur, 4) + 0.5;
    const car = osc(ctx, 'sine', f, t, len, g, rand(-3, 3));
    const modG = gain(ctx, 0, car.frequency);
    osc(ctx, 'sine', f, t, len, modG);
    modG.gain.setValueAtTime(f * (0.6 + vel * 2.2), t); modG.gain.setTargetAtTime(f * 0.25, t, 0.25);
    const tg = gain(ctx, 0, g); osc(ctx, 'sine', f * 7.02, t, 0.3, tg); envAD(tg.gain, t, 0.001, 0.25 * vel, 0.12); // tine ping
    const pk = 0.16 * Math.pow(vel, 1.2);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.01, 1.4 * Math.pow(2, (60 - m) / 30));
    g.gain.setTargetAtTime(0, t + dur, 0.08);
  },
  ubass(lib, out, t, m, vel, dur) {    // upright / acoustic bass
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out); const lp = filter(ctx, 'lowpass', 900, 0.9, g);
    osc(ctx, bassWave(lib), f, t, dur + 0.3, lp, rand(-4, 4));
    lp.frequency.setValueAtTime(400 + vel * 900, t); lp.frequency.setTargetAtTime(f * 2.2, t, 0.08);
    const pk = 0.26 * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.008);
    g.gain.setTargetAtTime(pk * 0.45, t + 0.01, 0.15);
    g.gain.setTargetAtTime(0, t + dur, 0.05);
    const tg = gain(ctx, 0, out); const tb = filter(ctx, 'bandpass', 1200, 1.2, tg); envAD(tg.gain, t, 0.001, 0.05 * vel, 0.03); noise(lib, 'pink', t, 0.06, tb);
  },
  synbass(lib, out, t, m, vel, dur) {  // club bass
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out); const lp = filter(ctx, 'lowpass', 300, 4, g);
    osc(ctx, 'sawtooth', f, t, dur + 0.1, lp, -6); osc(ctx, 'sawtooth', f, t, dur + 0.1, lp, 6);
    osc(ctx, 'sine', f / 2, t, dur + 0.1, gain(ctx, 0.9, g));
    lp.frequency.setValueAtTime(180, t); lp.frequency.linearRampToValueAtTime(600 + vel * 1400, t + 0.01); lp.frequency.setTargetAtTime(220, t + 0.012, 0.07);
    const pk = 0.22 * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.004); g.gain.setValueAtTime(pk, t + dur * 0.8); g.gain.linearRampToValueAtTime(0, t + dur);
  },
  guitar(lib, out, t, m, vel, dur, o = {}) {
    const buf = ksBuffer(lib, m, { decay: o.muted ? 0.93 : 0.996, bright: o.bright ?? 0.55, dur: o.muted ? 0.35 : 2.2, pick: 0.2 });
    const lp = filter(lib.ctx, 'lowpass', o.muted ? 1600 : 5200, 0.6, out);
    playBuf(lib, lp, t, buf, 0.34 * vel, dur, o.muted ? 0.05 : 0.2);
  },
  harp(lib, out, t, m, vel, dur) {
    const buf = ksBuffer(lib, m, { decay: 0.998, bright: 0.35, dur: 3, pick: 0.5 });
    playBuf(lib, out, t, buf, 0.3 * vel, Math.max(dur, 2.5), 0.4);
  },
  uke(lib, out, t, m, vel, dur) {
    const buf = ksBuffer(lib, m, { decay: 0.99, bright: 0.6, dur: 1.2, pick: 0.3 });
    playBuf(lib, out, t, buf, 0.28 * vel, dur, 0.1);
  },
  steelpan(lib, out, t, m, vel, dur) {
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 1, out); const lp = filter(ctx, 'lowpass', 4500, 0.5, g);
    const parts = [[1, 1, 1.1], [2, 0.55, 0.7], [3.0, 0.22, 0.45], [4.01, 0.12, 0.25], [1.003, 0.4, 0.9]];
    for (const [r, a, d] of parts) {
      const pg = gain(ctx, 0, lp); osc(ctx, 'sine', f * r, t, d * 2 + 0.2, pg);
      pg.gain.setValueAtTime(0, t); pg.gain.linearRampToValueAtTime(0.13 * a * vel, t + 0.006 + (r === 2 ? 0.01 : 0));
      pg.gain.setTargetAtTime(0, t + 0.01, d * 0.45 * Math.pow(2, (72 - m) / 36));
    }
    const hg = gain(ctx, 0, g); const hb = filter(ctx, 'bandpass', f * 3, 2, hg); envAD(hg.gain, t, 0.001, 0.03 * vel, 0.015); noise(lib, 'white', t, 0.03, hb);
  },
  marimba(lib, out, t, m, vel) {
    const ctx = lib.ctx, f = mtof(m);
    for (const [r, a, d] of [[1, 1, 0.5], [3.93, 0.25, 0.12], [9.2, 0.05, 0.04]]) {
      const pg = gain(ctx, 0, out); osc(ctx, 'sine', f * r, t, d * 3, pg); envAD(pg.gain, t, 0.002, 0.14 * a * vel, d * 2);
    }
  },
  glock(lib, out, t, m, vel) {
    const ctx = lib.ctx, f = mtof(m);
    for (const [r, a, d] of [[1, 1, 1.4], [2.76, 0.3, 0.5], [5.4, 0.12, 0.25]]) {
      const pg = gain(ctx, 0, out); osc(ctx, 'sine', f * r, t, d * 2, pg); envAD(pg.gain, t, 0.001, 0.08 * a * vel, d);
    }
  },
  vibes(lib, out, t, m, vel, dur) {
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 1, out);
    const trem = gain(ctx, 1, g); const lfo = osc(ctx, 'sine', 5.2, t, Math.max(dur, 1.5) + 0.5, gain(ctx, 0.35, trem.gain));
    for (const [r, a, d] of [[1, 1, 1.6], [4, 0.2, 0.4], [10, 0.03, 0.1]]) {
      const pg = gain(ctx, 0, trem); osc(ctx, 'sine', f * r, t, d * 2 + 0.3, pg); envAD(pg.gain, t, 0.002, 0.1 * a * vel, d);
    }
  },
  strings(lib, out, t, m, vel, dur, o = {}) {  // ensemble/section voice
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out);
    const lp = filter(ctx, 'lowpass', Math.min(7000, 1400 + f * 2.5 + vel * 1500), 0.6, g);
    const pk1 = filter(ctx, 'peaking', 420, 1.2, lp, 3); const pk2 = filter(ctx, 'peaking', 2800, 1.5, pk1, 2);
    const vib = gain(ctx, 0); osc(ctx, 'sine', rand(4.8, 5.8), t, dur + 1.5, vib);
    vib.gain.setValueAtTime(0, t); vib.gain.linearRampToValueAtTime(f * 0.005, t + Math.min(0.6, dur * 0.5));
    const n = o.ensemble ? 3 : 2, spread = o.ensemble ? 9 : 5;
    for (let i = 0; i < n; i++) { const v = osc(ctx, 'sawtooth', f, t, dur + 1.2, pk2, (i - (n - 1) / 2) * spread + rand(-2, 2)); vib.connect(v.frequency); }
    const a = o.attack ?? 0.18, r = o.release ?? 0.45, pk = (o.lvl ?? 0.06) * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a);
    if (o.swell) g.gain.linearRampToValueAtTime(pk * o.swell, t + dur * 0.7);
    g.gain.setValueAtTime(pk * (o.swell || 1), t + dur); g.gain.setTargetAtTime(0, t + dur, r / 3);
  },
  brass(lib, out, t, m, vel, dur, o = {}) {
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out); const lp = filter(ctx, 'lowpass', 300, 1.2, g);
    for (const d of [-5, 4]) osc(ctx, 'sawtooth', f, t, dur + 0.6, lp, d + rand(-2, 2));
    const a = o.attack ?? 0.07;
    lp.frequency.setValueAtTime(f * 1.2, t); lp.frequency.linearRampToValueAtTime(Math.min(6000, f * (2.5 + vel * 5)), t + a + 0.05);
    if (o.swell) lp.frequency.linearRampToValueAtTime(Math.min(7000, f * (4 + vel * 7)), t + dur * 0.8);
    lp.frequency.setTargetAtTime(f * 1.5, t + dur, 0.1);
    const pk = (o.lvl ?? 0.07) * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a);
    g.gain.setValueAtTime(pk, t + dur); g.gain.setTargetAtTime(0, t + dur, 0.08);
  },
  fiddle(lib, out, t, m, vel, dur) {
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out);
    const b3 = filter(ctx, 'peaking', 3000, 2, g, 4); const b2 = filter(ctx, 'peaking', 1000, 2, b3, 3); const b1 = filter(ctx, 'peaking', 450, 2, b2, 5);
    const lp = filter(ctx, 'lowpass', 5500, 0.7, b1);
    const v = osc(ctx, 'sawtooth', f, t, dur + 0.3, lp);
    const vib = gain(ctx, 0, v.frequency); osc(ctx, 'sine', 5.8, t, dur + 0.3, vib);
    vib.gain.setValueAtTime(0, t); vib.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.35, dur));
    const ng = gain(ctx, 0.02 * vel, lp); noise(lib, 'white', t, dur + 0.1, filter(ctx, 'bandpass', 2500, 1, ng));
    const pk = 0.07 * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.035);
    g.gain.setValueAtTime(pk * 0.85, t + Math.max(0.04, dur - 0.04)); g.gain.linearRampToValueAtTime(0, t + dur + 0.06);
  },
  whistleFlute(lib, out, t, m, vel, dur) {
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out);
    const v = osc(ctx, 'triangle', f, t, dur + 0.2, filter(ctx, 'lowpass', f * 3, 0.7, g));
    osc(ctx, 'sine', f * 2, t, dur + 0.2, gain(ctx, 0.12, g));
    const vib = gain(ctx, 0, v.frequency); osc(ctx, 'sine', 5.2, t, dur + 0.2, vib); vib.gain.setValueAtTime(0, t); vib.gain.linearRampToValueAtTime(f * 0.004, t + Math.min(0.4, dur));
    const ng = gain(ctx, 0.25, g); noise(lib, 'white', t, dur + 0.1, filter(ctx, 'bandpass', f * 2, 3, ng));
    const pk = 0.08 * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.03); g.gain.setValueAtTime(pk, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  },
  supersaw(lib, out, t, m, vel, dur, o = {}) {
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out); const lp = filter(ctx, 'lowpass', o.cutoff ?? 2200, 0.8, g);
    for (const d of [-17, -7, 0, 8, 16]) osc(ctx, 'sawtooth', f, t, dur + 0.5, lp, d + rand(-1, 1));
    const pk = 0.025 * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + (o.attack ?? 0.05));
    g.gain.setValueAtTime(pk, t + dur); g.gain.setTargetAtTime(0, t + dur, 0.12);
  },
  pluck(lib, out, t, m, vel, dur) {
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out); const lp = filter(ctx, 'lowpass', 400, 3, g);
    osc(ctx, 'sawtooth', f, t, 0.5, lp, -5); osc(ctx, 'square', f, t, 0.5, gain(ctx, 0.5, lp), 5);
    lp.frequency.setValueAtTime(f * 1.2, t); lp.frequency.linearRampToValueAtTime(Math.min(8000, f * 8), t + 0.004); lp.frequency.setTargetAtTime(f * 1.5, t + 0.005, 0.07);
    envAD(g.gain, t, 0.002, 0.06 * vel, 0.3);
  },
  chip(lib, out, t, m, vel, dur) {   // softened square lead (arcade)
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out); const lp = filter(ctx, 'lowpass', 2800, 0.6, g);
    const v = osc(ctx, 'square', f, t, dur + 0.1, lp);
    const vib = gain(ctx, f * 0.004, v.frequency); osc(ctx, 'sine', 6, t, dur + 0.1, vib);
    const pk = 0.035 * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.005); g.gain.setTargetAtTime(pk * 0.6, t + 0.01, 0.1); g.gain.setTargetAtTime(0, t + dur, 0.03);
  },
  organ(lib, out, t, m, vel, dur) {
    const ctx = lib.ctx, f = mtof(m);
    const g = gain(ctx, 0, out); const lp = filter(ctx, 'lowpass', 3000, 0.5, g);
    osc(ctx, organWave(lib), f, t, dur + 0.2, lp, rand(-3, 3));
    const pk = 0.05 * vel; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.02); g.gain.setValueAtTime(pk, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.08);
  },
};

// ── drums & percussion: fn(lib, out, t, vel, opts) ────────────────────────
export const DRUM = {
  kick(lib, out, t, v = 1, o = {}) {
    const ctx = lib.ctx, g = gain(ctx, 0, out);
    const s = o.club ? shaper(ctx, 1.8, g) : g;
    const k = osc(ctx, 'sine', o.club ? 160 : 110, t, 0.5, s);
    k.frequency.setValueAtTime(o.club ? 160 : 110, t); k.frequency.exponentialRampToValueAtTime(o.club ? 46 : 52, t + (o.club ? 0.09 : 0.07));
    envAD(g.gain, t, 0.001, (o.club ? 0.42 : 0.3) * v, o.club ? 0.38 : 0.22);
    const cg = gain(ctx, 0, out); envAD(cg.gain, t, 0.0005, 0.08 * v, 0.008); noise(lib, 'white', t, 0.02, filter(ctx, 'bandpass', 3500, 1, cg));
  },
  snare(lib, out, t, v = 1) {
    const ctx = lib.ctx;
    const ng = gain(ctx, 0, out); envAD(ng.gain, t, 0.001, 0.22 * v, 0.16); noise(lib, 'white', t, 0.25, filter(ctx, 'highpass', 1400, 0.7, ng));
    const tg = gain(ctx, 0, out); const o1 = osc(ctx, 'triangle', 200, t, 0.12, tg); o1.frequency.exponentialRampToValueAtTime(160, t + 0.08); envAD(tg.gain, t, 0.001, 0.18 * v, 0.07);
  },
  brush(lib, out, t, v = 1, o = {}) {  // brush tap / sweep
    const ctx = lib.ctx, g = gain(ctx, 0, out); const bp = filter(ctx, 'bandpass', 3500, 0.6, g);
    const d = o.sweep ? 0.28 : 0.09;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 * v, t + (o.sweep ? 0.12 : 0.004)); g.gain.setTargetAtTime(0, t + (o.sweep ? 0.13 : 0.005), d / 3);
    noise(lib, 'white', t, d + 0.1, bp);
  },
  clap(lib, out, t, v = 1) {
    const ctx = lib.ctx; const bp = filter(ctx, 'bandpass', 1300, 1.1, out);
    for (let i = 0; i < 3; i++) { const g = gain(ctx, 0, bp); envAD(g.gain, t + i * 0.011, 0.001, 0.32 * v, 0.012); noise(lib, 'white', t + i * 0.011, 0.03, g); }
    const g = gain(ctx, 0, bp); envAD(g.gain, t + 0.033, 0.001, 0.25 * v, 0.14); noise(lib, 'white', t + 0.033, 0.2, g);
  },
  hat(lib, out, t, v = 1, o = {}) {
    const ctx = lib.ctx, g = gain(ctx, 0, out); const hp = filter(ctx, 'highpass', o.open ? 6500 : 7500, 0.7, g);
    const bp = filter(ctx, 'peaking', 10000, 1, hp, 4);
    envAD(g.gain, t, 0.001, (o.open ? 0.09 : 0.11) * v, o.open ? 0.28 : 0.035);
    noise(lib, 'white', t, o.open ? 0.4 : 0.07, bp);
  },
  ride(lib, out, t, v = 1) {
    const ctx = lib.ctx;
    const g = gain(ctx, 0, out); envAD(g.gain, t, 0.001, 0.04 * v, 0.7); noise(lib, 'white', t, 0.8, filter(ctx, 'highpass', 5000, 0.6, g));
    const pg = gain(ctx, 1, filter(ctx, 'highpass', 2000, 0.7, out));
    for (const f of [3240, 4530, 5320, 6870]) { const q = gain(ctx, 0, pg); osc(ctx, 'square', f * rand(0.99, 1.01), t, 0.9, q); envAD(q.gain, t, 0.001, 0.006 * v, 0.6); }
    const cg = gain(ctx, 0, out); envAD(cg.gain, t, 0.0005, 0.05 * v, 0.01); noise(lib, 'white', t, 0.02, filter(ctx, 'bandpass', 6000, 2, cg));
  },
  shaker(lib, out, t, v = 1) {
    const ctx = lib.ctx, g = gain(ctx, 0, out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * v, t + 0.02); g.gain.setTargetAtTime(0, t + 0.025, 0.02);
    noise(lib, 'white', t, 0.12, filter(ctx, 'highpass', 6000, 0.8, g));
  },
  conga(lib, out, t, v = 1, o = {}) {
    const ctx = lib.ctx, f = o.high ? 330 : 220;
    const g = gain(ctx, 0, out); const k = osc(ctx, 'sine', f * 1.15, t, 0.4, g); k.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    envAD(g.gain, t, 0.001, 0.2 * v, o.slap ? 0.08 : 0.22);
    const sg = gain(ctx, 0, out); envAD(sg.gain, t, 0.0005, (o.slap ? 0.12 : 0.04) * v, 0.02); noise(lib, 'white', t, 0.04, filter(ctx, 'bandpass', 1800, 1, sg));
  },
  rim(lib, out, t, v = 1) {
    const ctx = lib.ctx;
    for (const [f, a, d] of [[1700, 1, 0.04], [820, 0.6, 0.05]]) { const g = gain(ctx, 0, out); osc(ctx, 'triangle', f * rand(0.98, 1.02), t, 0.1, g); envAD(g.gain, t, 0.0005, 0.08 * a * v, d); }
  },
  tom(lib, out, t, v = 1, o = {}) {
    const ctx = lib.ctx, f = o.f ?? 85;
    const g = gain(ctx, 0, out); const k = osc(ctx, 'sine', f * 1.5, t, 1.0, g); k.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    envAD(g.gain, t, 0.002, 0.45 * v, o.d ?? 0.6);
    const ng = gain(ctx, 0, out); envAD(ng.gain, t, 0.002, 0.15 * v, 0.12); noise(lib, 'pink', t, 0.2, filter(ctx, 'lowpass', 900, 0.7, ng));
  },
  timpani(lib, out, t, v = 1, o = {}) {
    const ctx = lib.ctx, f = mtof(o.m ?? 38);
    for (const [r, a, d] of [[1, 1, 1.4], [1.5, 0.4, 0.9], [1.99, 0.25, 0.6], [2.44, 0.12, 0.4]]) {
      const g = gain(ctx, 0, out); const k = osc(ctx, 'sine', f * r * 1.02, t, d * 2, g); k.frequency.exponentialRampToValueAtTime(f * r, t + 0.08);
      envAD(g.gain, t, 0.003, 0.22 * a * v, d);
    }
    const ng = gain(ctx, 0, out); envAD(ng.gain, t, 0.002, 0.1 * v, 0.1); noise(lib, 'pink', t, 0.2, filter(ctx, 'lowpass', 700, 0.7, ng));
  },
  bodhran(lib, out, t, v = 1, o = {}) {
    const ctx = lib.ctx, f = o.high ? 140 : 90;
    const g = gain(ctx, 0, out); const k = osc(ctx, 'sine', f * 1.3, t, 0.4, g); k.frequency.exponentialRampToValueAtTime(f, t + 0.05); envAD(g.gain, t, 0.002, 0.28 * v, 0.2);
    const ng = gain(ctx, 0, out); envAD(ng.gain, t, 0.002, 0.08 * v, 0.06); noise(lib, 'pink', t, 0.1, filter(ctx, 'bandpass', 700, 0.8, ng));
  },
  cymbalSwell(lib, out, t, v = 1, dur = 2) {
    const ctx = lib.ctx, g = gain(ctx, 0, out); const hp = filter(ctx, 'highpass', 4000, 0.6, g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 * v, t + dur); g.gain.setTargetAtTime(0, t + dur, 0.6);
    noise(lib, 'white', t, dur + 2.5, hp);
  },
  tamtam(lib, out, t, v = 1) {
    const ctx = lib.ctx, g = gain(ctx, 0, out);
    const bp = filter(ctx, 'bandpass', 300, 0.6, g);
    envAD(g.gain, t, 0.05, 0.25 * v, 4); noise(lib, 'pink', t, 4.5, bp);
    for (const f of [86, 131, 177, 233, 311]) { const q = gain(ctx, 0, out); osc(ctx, 'sine', f * rand(0.98, 1.02), t, 4.5, q); envAD(q.gain, t, 0.1, 0.03 * v, 3.5); }
  },
};
