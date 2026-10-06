// HALCYON TIDE — procedural one-shot sound library.
// Every generator has the signature (lib, out, t, o) => duration (seconds, excluding reverb tail).
// `out` is any AudioNode; `o` carries options ({exterior, vol, surface, run, …}).
// All generators randomise pitch/timing/partials so repeated triggers never sound identical.
import { rand, pick, chance, gain, filter, noise, osc, envAD, envAHR, burst, tone, modal, vocal, VOWELS, shaper, mtof } from './dsp.js';

const R = (v, j = 0.08) => v * rand(1 - j, 1 + j);

// ── building blocks ────────────────────────────────────────────────────────
function thud(lib, out, t, f = 90, lvl = 0.5, d = 0.12, drop = 0.5) {
  return tone(lib, out, t, { f: R(f), f2: f * drop, a: 0.002, d, lvl, sweep: d * 0.8 });
}
function click(lib, out, t, f = 3000, lvl = 0.3, d = 0.012, Q = 1.2) {
  return burst(lib, out, t, { type: 'bandpass', f: R(f, 0.15), Q, a: 0.0005, d, lvl });
}
function metalHit(lib, out, t, base = 420, lvl = 0.25, d = 0.35, n = 6) {
  const ratios = [1, 2.32, 4.25, 6.63, 9.38, 12.6, 15.8];
  const freqs = [], amps = [], decays = [];
  for (let i = 0; i < n; i++) { freqs.push(base * ratios[i] * rand(0.97, 1.03)); amps.push(rand(0.4, 1) / (1 + i * 0.6)); decays.push(d * rand(0.6, 1.1) / (1 + i * 0.35)); }
  modal(lib, out, t, { freqs, amps, decays, lvl });
  click(lib, out, t, base * 6, lvl * 0.8, 0.006);
  return d;
}
function woodKnock(lib, out, t, base = 220, lvl = 0.3, d = 0.09) {
  const freqs = [base, base * 2.7, base * 4.9].map(f => f * rand(0.95, 1.05));
  modal(lib, out, t, { freqs, amps: [1, 0.4, 0.15], decays: [d, d * 0.6, d * 0.35], lvl });
  burst(lib, out, t, { type: 'bandpass', f: base * 6, Q: 0.9, d: 0.012, lvl: lvl * 0.5 });
  return d;
}
function whoosh(lib, out, t, dur = 0.4, f0 = 400, f1 = 1600, lvl = 0.15, Q = 0.9, noiseT = 'pink') {
  const g = gain(lib.ctx, 0, out);
  const bp = filter(lib.ctx, 'bandpass', f0, Q, g);
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.55);
  bp.frequency.exponentialRampToValueAtTime(Math.max(60, f0 * 0.8), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(lvl, t + dur * 0.5);
  g.gain.linearRampToValueAtTime(0, t + dur);
  noise(lib, noiseT, t, dur + 0.05, bp);
  return dur;
}
function bubble(lib, out, t, f = 700, lvl = 0.12, d = 0.05) {
  return tone(lib, out, t, { f: R(f, 0.25), f2: f * rand(1.6, 2.4), a: 0.002, d, lvl, sweep: d });
}
function creak(lib, out, t, o = {}) {
  // stick-slip friction: low saw pulse train through resonant band-pass
  const ctx = lib.ctx, dur = o.dur ?? rand(0.4, 1.2);
  const g = gain(ctx, 0, out);
  const bp1 = filter(ctx, 'bandpass', o.f ?? rand(450, 1100), o.Q ?? 9, g);
  const bp2 = filter(ctx, 'bandpass', (o.f ?? 700) * 2.3, 6, gain(ctx, 0.35, g));
  const src = gain(ctx, 1); src.connect(bp1); src.connect(bp2);
  const o1 = osc(ctx, 'sawtooth', o.rate ?? rand(18, 45), t, dur, src);
  const f0 = o1.frequency.value;
  o1.frequency.setValueAtTime(f0, t);
  o1.frequency.linearRampToValueAtTime(f0 * rand(1.3, 2.2), t + dur * rand(0.3, 0.7));
  o1.frequency.linearRampToValueAtTime(f0 * rand(0.6, 1.1), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.lvl ?? 0.12, t + dur * 0.25);
  g.gain.linearRampToValueAtTime((o.lvl ?? 0.12) * 0.6, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur);
  return dur;
}
function coins(lib, out, t, n = 8, lvl = 0.12) {
  let e = 0;
  for (let i = 0; i < n; i++) {
    const tt = t + e; e += rand(0.008, 0.05);
    const b = rand(2400, 4200);
    modal(lib, out, tt, { freqs: [b, b * 1.52, b * 2.31], amps: [1, 0.6, 0.3], decays: [rand(0.08, 0.2), 0.08, 0.05], lvl: lvl * rand(0.5, 1) });
  }
  return e + 0.2;
}
function chipClack(lib, out, t, lvl = 0.2) {
  const f = rand(2600, 3800);
  modal(lib, out, t, { freqs: [f, f * 1.41, f * 2.1], amps: [1, 0.5, 0.2], decays: [0.03, 0.02, 0.015], lvl });
  click(lib, out, t, f * 1.5, lvl * 0.7, 0.004);
  return 0.04;
}
export function bellStrike(lib, out, t, f = 900, lvl = 0.3, len = 2.5) {
  const ratios = [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011, 4.166];
  const amps = [0.35, 1, 0.6, 0.45, 0.55, 0.3, 0.25, 0.2, 0.1];
  const decays = ratios.map((r, i) => len * (i === 0 ? 1.3 : 1) / Math.pow(r, 0.55));
  modal(lib, out, t, { freqs: ratios.map(r => r * f * rand(0.998, 1.002)), amps, decays, lvl });
  click(lib, out, t, f * 3, lvl * 0.3, 0.004);
  return len;
}
function chimeNote(lib, out, t, f, lvl = 0.2, len = 1.6) {
  // soft vibraphone/chime: fundamental + 4th partial + weak 10th, warm attack
  modal(lib, out, t, { freqs: [f, f * 4.0, f * 10.0, f * 2.0], amps: [1, 0.25, 0.04, 0.12], decays: [len, len * 0.35, len * 0.12, len * 0.5], lvl, a: 0.004 });
  return len;
}

// ── footsteps ──────────────────────────────────────────────────────────────
export function footstep(lib, out, t, o = {}) {
  const s = o.surface || 'carpet', run = !!o.run;
  const v = (run ? 1.35 : 1) * (o.vol ?? 1);
  const heelToe = run ? rand(0.012, 0.025) : rand(0.03, 0.06);
  switch (s) {
    case 'carpet': {
      burst(lib, out, t, { type: 'lowpass', f: R(520), Q: 0.6, a: 0.004, d: 0.07, lvl: 0.5 * v, noise: 'pink' });
      burst(lib, out, t, { type: 'bandpass', f: R(900), Q: 0.9, a: 0.003, d: 0.04, lvl: 0.22 * v, noise: 'pink' });
      thud(lib, out, t, 75, 0.08 * v, 0.05);
      burst(lib, out, t + heelToe, { type: 'bandpass', f: R(1600), Q: 0.7, a: 0.008, d: 0.05, lvl: 0.06 * v });
      return 0.12;
    }
    case 'rubber': {
      thud(lib, out, t, 110, 0.1 * v, 0.04);
      burst(lib, out, t, { type: 'bandpass', f: R(650), Q: 0.8, d: 0.035, lvl: 0.4 * v });
      if (chance(0.15)) tone(lib, out, t + heelToe, { f: rand(1600, 2400), f2: rand(2000, 3000), a: 0.005, d: 0.05, lvl: 0.025 * v, wave: 'triangle' });
      return 0.1;
    }
    case 'wood': case 'teak': {
      const ext = s === 'teak';
      woodKnock(lib, out, t, rand(170, 240), 0.2 * v, ext ? 0.05 : 0.08);
      thud(lib, out, t, 90, 0.1 * v, 0.05);
      burst(lib, out, t, { type: 'bandpass', f: R(ext ? 1500 : 1100), Q: 0.8, d: 0.03, lvl: 0.3 * v });
      burst(lib, out, t + heelToe, { type: 'bandpass', f: R(2800), Q: 1.2, a: 0.004, d: 0.03, lvl: (ext ? 0.12 : 0.08) * v }); // grit/scuff
      if (!ext && chance(0.06)) creak(lib, out, t + 0.02, { dur: rand(0.15, 0.3), lvl: 0.03, f: rand(500, 800) });
      return 0.15;
    }
    case 'tile': case 'marble': {
      const m = s === 'marble';
      thud(lib, out, t, 120, 0.06 * v, 0.03);
      burst(lib, out, t, { type: 'highpass', f: R(m ? 2600 : 2000), Q: 0.7, d: R(0.018), lvl: 0.45 * v });
      burst(lib, out, t, { type: 'bandpass', f: R(m ? 4200 : 3200), Q: 3, d: m ? 0.02 : 0.012, lvl: 0.3 * v });
      burst(lib, out, t + heelToe, { type: 'bandpass', f: R(1400), Q: 1, d: 0.025, lvl: 0.18 * v });
      return 0.1;
    }
    case 'steel': {
      metalHit(lib, out, t, rand(260, 380), 0.1 * v, run ? 0.18 : 0.25, 5);
      thud(lib, out, t, 80, 0.14 * v, 0.07);
      burst(lib, out, t, { type: 'bandpass', f: R(1300), Q: 1.2, d: 0.03, lvl: 0.32 * v });
      burst(lib, out, t + heelToe, { type: 'bandpass', f: R(2600), Q: 2, d: 0.015, lvl: 0.1 * v });
      return 0.3;
    }
    case 'water': {
      burst(lib, out, t, { type: 'bandpass', f: R(900), f2: 350, Q: 0.8, a: 0.004, d: 0.14, lvl: 0.7 * v });
      burst(lib, out, t + 0.02, { type: 'highpass', f: 2500, d: 0.12, lvl: 0.18 * v, noise: 'crackle' });
      for (let i = 0; i < 3; i++) bubble(lib, out, t + rand(0.01, 0.15), rand(500, 1100), 0.08 * v, 0.04);
      return 0.25;
    }
    default: return footstep(lib, out, t, { ...o, surface: 'carpet' });
  }
}

// ── doors ──────────────────────────────────────────────────────────────────
export function doorSound(lib, out, t, o = {}) {
  const type = o.type || 'cabin', opening = o.opening !== false;
  switch (type) {
    case 'glass': case 'balcony': case 'elevator': {
      // motor hum + rubber seal release + airflow whoosh + soft stop bump
      const ctx = lib.ctx, dur = type === 'elevator' ? 1.6 : 1.1;
      const mg = gain(ctx, 0, out); const mlp = filter(ctx, 'lowpass', 500, 0.8, mg);
      const m = osc(ctx, 'sawtooth', R(type === 'elevator' ? 95 : 120, 0.04), t, dur, mlp);
      m.frequency.setValueAtTime(m.frequency.value * 0.8, t); m.frequency.linearRampToValueAtTime(m.frequency.value * 1.15, t + dur * 0.5); m.frequency.linearRampToValueAtTime(m.frequency.value * 0.75, t + dur);
      envAHR(mg.gain, t, 0.15, 0.035, dur - 0.45, 0.3);
      whoosh(lib, out, t + 0.05, dur * 0.85, 300, opening ? 1500 : 1100, type === 'balcony' ? 0.06 : 0.09, 0.7);
      if (type !== 'balcony') burst(lib, out, t, { type: 'bandpass', f: 1200, Q: 1.5, d: 0.04, lvl: 0.05 }); // seal
      thud(lib, out, t + dur - 0.05, 120, opening ? 0.08 : 0.14, 0.08);
      click(lib, out, t + dur - 0.05, 1800, 0.05, 0.01);
      if (type === 'balcony') { burst(lib, out, t, { type: 'bandpass', f: R(3000), Q: 3, d: 0.02, lvl: 0.08 }); creak(lib, out, t + 0.1, { dur: dur * 0.6, lvl: 0.02, f: 1500, Q: 4, rate: 60 }); }
      return dur + 0.1;
    }
    case 'watertight': {
      // hydraulic hiss + pump whine + heavy steel thunk
      const ctx = lib.ctx, dur = 2.4;
      const hg = gain(ctx, 0, out); const hp = filter(ctx, 'highpass', 2500, 0.7, hg);
      noise(lib, 'white', t, dur, hp);
      hg.gain.setValueAtTime(0, t); hg.gain.linearRampToValueAtTime(0.09, t + 0.12); hg.gain.setTargetAtTime(0.03, t + 0.3, 0.4); hg.gain.setTargetAtTime(0, t + dur - 0.4, 0.08);
      const wg = gain(ctx, 0, out); const wlp = filter(ctx, 'bandpass', 700, 2, wg);
      const w = osc(ctx, 'sawtooth', 160, t, dur, wlp); w.frequency.setValueAtTime(140, t); w.frequency.linearRampToValueAtTime(230, t + 0.6); w.frequency.setValueAtTime(230, t + dur - 0.6); w.frequency.linearRampToValueAtTime(150, t + dur);
      envAHR(wg.gain, t, 0.3, 0.05, dur - 0.8, 0.4);
      thud(lib, out, t + 0.05, 60, 0.35, 0.25);
      const te = t + dur - 0.15;
      thud(lib, out, te, 55, 0.6, 0.35, 0.6);
      metalHit(lib, out, te, rand(120, 150), 0.12, 0.9, 6);
      burst(lib, out, te, { type: 'lowpass', f: 1500, d: 0.08, lvl: 0.3 });
      return dur + 0.6;
    }
    case 'crew': {
      // push bar clack, swing, door closer thunk
      if (opening) {
        metalHit(lib, out, t, rand(700, 900), 0.15, 0.08, 4);
        click(lib, out, t, 2000, 0.4, 0.012);
        thud(lib, out, t, 140, 0.12, 0.05);
        whoosh(lib, out, t + 0.05, 0.5, 250, 700, 0.04);
        return 0.6;
      }
      whoosh(lib, out, t, 0.6, 250, 600, 0.03);
      thud(lib, out, t + 0.6, 80, 0.32, 0.15);
      metalHit(lib, out, t + 0.6, rand(500, 650), 0.06, 0.12, 4);
      click(lib, out, t + 0.62, 3000, 0.12, 0.01);
      return 0.85;
    }
    default: { // cabin / swing: latch click + swing
      const heavy = type === 'swing';
      if (opening) {
        click(lib, out, t, 2200, 0.35, 0.01); metalHit(lib, out, t + 0.01, rand(1100, 1500), 0.09, 0.06, 3);
        click(lib, out, t + rand(0.05, 0.08), 1600, 0.25, 0.012); thud(lib, out, t + 0.06, 160, 0.08, 0.04);
        whoosh(lib, out, t + 0.08, heavy ? 0.6 : 0.45, 220, 600, 0.06);
        if (chance(0.25)) creak(lib, out, t + 0.1, { dur: rand(0.3, 0.5), lvl: 0.025, f: rand(700, 1100) });
        return 0.6;
      }
      whoosh(lib, out, t, 0.4, 220, 520, 0.03);
      thud(lib, out, t + 0.4, heavy ? 85 : 110, 0.3, heavy ? 0.14 : 0.1);
      woodKnock(lib, out, t + 0.4, heavy ? 140 : 180, 0.15, 0.08);
      click(lib, out, t + 0.42, 3000, 0.16, 0.008); metalHit(lib, out, t + 0.42, rand(1500, 1900), 0.03, 0.06, 3);
      return 0.65;
    }
  }
}

// ── elevator ───────────────────────────────────────────────────────────────
export function elevatorChime(lib, out, t, o = {}) {
  const up = o.up !== false;
  const a = mtof(88), b = mtof(84);   // E6, C6
  chimeNote(lib, out, t, up ? b : a, 0.14, 1.4);
  chimeNote(lib, out, t + 0.32, up ? a : b, 0.14, 1.8);
  doorSound(lib, out, t + 0.6, { type: 'elevator', opening: true });
  return 2.4;
}

// ── horn / whistle ─────────────────────────────────────────────────────────
// A cruise-ship horn: three detuned reed/pipe tones (D2, F#2, A2) with rich harmonics,
// bell-resonance EQ, breathy turbulence, a pitch "bloom" at the onset and a slight sag at release.
export function shipHorn(lib, out, t, o = {}) {
  const ctx = lib.ctx, dur = o.dur ?? 4.5;
  const bus = gain(ctx, o.lvl ?? 0.5, out);
  const sat = shaper(ctx, 1.6, bus);
  const lp = filter(ctx, 'lowpass', 1400, 0.6, sat);
  const pk = filter(ctx, 'peaking', 380, 1.4, lp, 6);
  const pk2 = filter(ctx, 'peaking', 820, 2, pk, 3);
  const env = gain(ctx, 0, pk2);
  const atk = 0.35, rel = 0.9;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.85, t + atk * 0.6);
  env.gain.linearRampToValueAtTime(1, t + atk);
  env.gain.setValueAtTime(1, t + dur);
  env.gain.setTargetAtTime(0, t + dur, rel / 4);
  const pipes = o.pipes || [73.42, 92.5, 110.0];
  const ampsP = [1, 0.7, 0.75];
  pipes.forEach((f, i) => {
    const pg = gain(ctx, 0.22 * ampsP[i], env);
    for (const [wave, mix, det] of [['sawtooth', 1, 0], ['square', 0.45, 7], ['sawtooth', 0.6, -9]]) {
      const v = osc(ctx, wave, f, t, dur + rel + 0.2, gain(ctx, mix, pg), det + rand(-3, 3));
      const fp = v.frequency;
      fp.setValueAtTime(f * 0.93, t);
      fp.exponentialRampToValueAtTime(f * 1.004, t + atk * 1.2);
      fp.exponentialRampToValueAtTime(f, t + atk * 2);
      fp.setValueAtTime(f, t + dur);
      fp.exponentialRampToValueAtTime(f * 0.97, t + dur + rel);
      // slow wobble
      const l = osc(ctx, 'sine', rand(3.5, 5.5), t, dur + rel, gain(ctx, f * 0.0025, fp));
    }
  });
  // breath / turbulence
  const ng = gain(ctx, 0.06, env); const nbp = filter(ctx, 'bandpass', 500, 0.8, ng);
  noise(lib, 'pink', t, dur + rel + 0.1, nbp);
  // sub reinforcement
  const sg = gain(ctx, 0.25, env); osc(ctx, 'sine', pipes[0], t, dur + rel + 0.2, sg);
  return dur + rel;
}
function shipWhistleBlast(lib, out, t, dur, lvl = 0.45) { return shipHorn(lib, out, t, { dur, lvl, pipes: [82.4, 103.8, 123.5] }); }

// ── weapons & combat ───────────────────────────────────────────────────────
export function gunshot(lib, out, t, o = {}) {
  const ctx = lib.ctx, ext = !!o.exterior;
  const bus = gain(ctx, 1, out);
  const sat = shaper(ctx, 2.5, gain(ctx, 0.9, bus));
  const v = o.vol ?? 1;
  // supersonic crack + muzzle blast
  burst(lib, sat, t, { type: 'highpass', f: 1800, a: 0.0003, d: 0.01, lvl: 0.9 * v });
  burst(lib, sat, t, { type: 'lowpass', f: R(5000), f2: 350, sweep: 0.12, a: 0.0008, d: 0.16, lvl: 1.0 * v });
  tone(lib, sat, t, { f: R(170), f2: 42, a: 0.001, d: 0.2, lvl: 0.6 * v, sweep: 0.15 });
  burst(lib, sat, t + 0.001, { type: 'bandpass', f: R(1100), Q: 0.7, d: 0.05, lvl: 0.9 * v });
  burst(lib, bus, t + 0.002, { type: 'bandpass', f: R(2500), Q: 0.7, d: 0.04, lvl: 0.35 * v });
  // mechanism
  metalHit(lib, bus, t + rand(0.05, 0.07), rand(1800, 2400), 0.06 * v, 0.04, 3);
  if (ext) {
    // outdoor: dry crack then rolling echoes off the superstructure and sea
    for (const [d, l, f] of [[rand(0.18, 0.26), 0.22, 1200], [rand(0.45, 0.6), 0.14, 800], [rand(0.9, 1.2), 0.08, 500]]) {
      burst(lib, bus, t + d, { type: 'lowpass', f, a: 0.01, d: 0.35, lvl: l * v, noise: 'pink' });
      tone(lib, bus, t + d, { f: 90, f2: 40, d: 0.3, lvl: l * 0.6 * v });
    }
    burst(lib, bus, t + 0.05, { type: 'lowpass', f: 400, a: 0.08, d: 1.8, lvl: 0.12 * v, noise: 'brown' });
    return 2.2;
  }
  // indoor: dense slap-back reflections + boomy room tail
  for (let i = 0; i < 6; i++) burst(lib, bus, t + 0.012 + i * rand(0.009, 0.02), { type: 'bandpass', f: rand(600, 2200), Q: 0.7, d: 0.05, lvl: (0.25 - i * 0.03) * v });
  burst(lib, bus, t + 0.01, { type: 'lowpass', f: 1600, f2: 300, sweep: 0.8, a: 0.02, d: 0.9, lvl: 0.22 * v, noise: 'pink' });
  return 1.2;
}
const reload = (lib, out, t) => {
  metalHit(lib, out, t, 1500, 0.06, 0.05, 3); click(lib, out, t, 2500, 0.15, 0.01);                       // mag release
  burst(lib, out, t + 0.12, { type: 'bandpass', f: 1800, Q: 1.5, a: 0.02, d: 0.08, lvl: 0.06 });          // mag slide out
  burst(lib, out, t + 0.55, { type: 'bandpass', f: 1500, Q: 1.5, a: 0.02, d: 0.06, lvl: 0.06 });
  metalHit(lib, out, t + 0.62, 900, 0.1, 0.08, 4); thud(lib, out, t + 0.62, 160, 0.15, 0.05);            // mag seat
  burst(lib, out, t + 0.9, { type: 'bandpass', f: 2600, Q: 1, a: 0.01, d: 0.06, lvl: 0.1 });             // slide back
  metalHit(lib, out, t + 0.98, 1200, 0.12, 0.08, 4); click(lib, out, t + 0.98, 3500, 0.2, 0.01);          // slide forward
  return 1.1;
};

// ── voices ─────────────────────────────────────────────────────────────────
function grunt(lib, out, t, o = {}) {
  const fem = o.sex === 'f' || (o.sex == null && chance(0.35));
  const f0 = fem ? rand(210, 260) : rand(100, 140);
  const dur = rand(0.18, 0.32);
  vocal(lib, out, t, dur, { f0, f0End: f0 * rand(0.7, 0.85), vowel: pick([VOWELS.uh, VOWELS.aw, VOWELS.er]), formantMul: fem ? 1.15 : 1, lvl: 0.35, attack: 0.015, release: 0.1, breath: 0.6, bright: 2500 });
  burst(lib, out, t, { type: 'bandpass', f: 1200, Q: 0.7, a: 0.01, d: dur, lvl: 0.05 });
  return dur;
}
function scream(lib, out, t, o = {}) {
  const fem = o.sex !== 'm';
  const f0 = fem ? rand(520, 700) : rand(300, 380);
  const dur = rand(0.9, 1.5);
  vocal(lib, out, t, dur, { f0: f0 * 0.85, f0Mid: f0 * 1.12, f0End: f0 * 0.75, vowel: VOWELS.ae, vowelEnd: VOWELS.a, formantMul: fem ? 1.2 : 1.05, vib: 0.025, vibRate: 7, lvl: 0.3, attack: 0.06, release: 0.3, breath: 1.2, bright: 5000 });
  // roughness layer
  vocal(lib, out, t + 0.01, dur * 0.95, { f0: f0 * 0.86 * 1.01, f0Mid: f0 * 1.1, f0End: f0 * 0.76, vowel: VOWELS.ae, vowelEnd: VOWELS.a, formantMul: fem ? 1.2 : 1.05, vib: 0.03, vibRate: 11, lvl: 0.12, attack: 0.08, release: 0.3, bright: 4000 });
  return dur;
}
function gasp(lib, out, t, o = {}) {
  const fem = o.sex === 'f' || (o.sex == null && chance(0.5));
  const ctx = lib.ctx, dur = rand(0.28, 0.4);
  const g = gain(ctx, 0, out); const bp = filter(ctx, 'bandpass', 900, 1.2, g);
  bp.frequency.setValueAtTime(fem ? 1100 : 800, t); bp.frequency.linearRampToValueAtTime(fem ? 2200 : 1700, t + dur);
  noise(lib, 'white', t, dur, bp);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.05); g.gain.linearRampToValueAtTime(0.12, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
  vocal(lib, out, t + 0.02, dur * 0.6, { f0: fem ? 330 : 180, f0End: fem ? 420 : 230, vowel: VOWELS.uh, vowelEnd: VOWELS.ae, formantMul: fem ? 1.15 : 1, lvl: 0.06, attack: 0.03, release: 0.1, breath: 0.8 });
  return dur;
}

// ── radio ──────────────────────────────────────────────────────────────────
function radioChatter(lib, out, t, o = {}) {
  const ctx = lib.ctx;
  const bus = gain(ctx, 1, out);
  const hp = filter(ctx, 'highpass', 500, 0.7); const lp = filter(ctx, 'lowpass', 2800, 1.2);
  const sat = shaper(ctx, 3, gain(ctx, 0.5, bus));
  hp.connect(lp); lp.connect(sat);
  // key-up squelch
  burst(lib, bus, t, { type: 'bandpass', f: 2500, Q: 1, a: 0.002, d: 0.06, lvl: 0.12 });
  tone(lib, bus, t, { f: 1400, d: 0.05, lvl: 0.03, wave: 'square' });
  const f0 = rand(95, 150);
  let tt = t + 0.12; const n = Math.floor(rand(6, 14));
  for (let i = 0; i < n; i++) {
    const d = rand(0.07, 0.18);
    vocal(lib, hp, tt, d, { f0: f0 * rand(0.9, 1.25), f0End: f0 * rand(0.8, 1.1), vowel: pick(Object.values(VOWELS)), vowelEnd: pick(Object.values(VOWELS)), lvl: 0.5, attack: 0.01, release: 0.03, breath: 0.4 });
    if (chance(0.4)) burst(lib, hp, tt, { type: 'highpass', f: 3000, d: 0.04, lvl: 0.2 });
    tt += d + (chance(0.2) ? rand(0.08, 0.2) : rand(0.0, 0.03));
  }
  // carrier hiss under voice
  const hg = gain(ctx, 0, bus); const hbp = filter(ctx, 'bandpass', 1800, 0.5, hg);
  noise(lib, 'white', t, tt - t + 0.1, hbp); envAHR(hg.gain, t, 0.02, 0.02, tt - t - 0.05, 0.03);
  // unkey: squelch tail
  burst(lib, bus, tt, { type: 'bandpass', f: 2200, Q: 0.6, a: 0.005, d: 0.18, lvl: 0.1 });
  return tt - t + 0.2;
}

// ── UI ─────────────────────────────────────────────────────────────────────
const ui = {
  ui_click: (lib, out, t) => { tone(lib, out, t, { f: R(1800, 0.03), d: 0.035, lvl: 0.14 }); click(lib, out, t, 4000, 0.12, 0.005); return 0.05; },
  ui_hover: (lib, out, t) => { tone(lib, out, t, { f: R(2200, 0.02), d: 0.025, lvl: 0.05 }); return 0.03; },
  ui_open: (lib, out, t) => { whoosh(lib, out, t, 0.22, 600, 3000, 0.04, 0.8); tone(lib, out, t + 0.02, { f: mtof(79), d: 0.25, lvl: 0.08, a: 0.004 }); tone(lib, out, t + 0.08, { f: mtof(86), d: 0.35, lvl: 0.07, a: 0.004 }); return 0.45; },
  ui_close: (lib, out, t) => { whoosh(lib, out, t, 0.2, 2400, 600, 0.035, 0.8); tone(lib, out, t + 0.02, { f: mtof(86), d: 0.2, lvl: 0.07, a: 0.004 }); tone(lib, out, t + 0.08, { f: mtof(79), d: 0.3, lvl: 0.07, a: 0.004 }); return 0.4; },
  objective: (lib, out, t) => { [72, 76, 79, 84].forEach((m, i) => chimeNote(lib, out, t + i * 0.11, mtof(m), 0.1, 1.5)); return 2.0; },
  levelup: (lib, out, t) => {
    [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => chimeNote(lib, out, t + i * 0.06, mtof(m), 0.08, 1.4));
    whoosh(lib, out, t, 0.9, 2000, 9000, 0.03, 0.5, 'white');
    [72, 76, 79].forEach(m => tone(lib, out, t + 0.45, { f: mtof(m), a: 0.05, hold: 0.4, d: 0.8, lvl: 0.04, wave: 'triangle' }));
    return 1.8;
  },
};

// ── registry ───────────────────────────────────────────────────────────────
export const SFX = {
  punch: (lib, out, t) => { thud(lib, out, t, 120, 0.22, 0.1, 0.45); burst(lib, out, t, { type: 'bandpass', f: R(700), Q: 0.8, d: 0.07, lvl: 0.7 }); burst(lib, out, t, { type: 'bandpass', f: R(2200), Q: 1, d: 0.03, lvl: 0.45 }); burst(lib, out, t + 0.004, { type: 'highpass', f: 3500, d: 0.015, lvl: 0.25 }); return 0.2; },
  kick: (lib, out, t) => { whoosh(lib, out, t, 0.12, 300, 1200, 0.05); const h = t + 0.1; thud(lib, out, h, 90, 0.28, 0.14, 0.45); burst(lib, out, h, { type: 'bandpass', f: R(600), Q: 0.7, d: 0.09, lvl: 0.75 }); burst(lib, out, h, { type: 'bandpass', f: R(1800), Q: 0.8, d: 0.035, lvl: 0.4 }); return 0.35; },
  body_fall: (lib, out, t) => {
    burst(lib, out, t, { type: 'bandpass', f: 1200, Q: 0.6, a: 0.05, d: 0.2, lvl: 0.06 }); // cloth
    const hits = [[0.0, 0.7, 70], [rand(0.08, 0.14), 0.5, 95], [rand(0.22, 0.32), 0.3, 110]];
    for (const [d, l, f] of hits) { thud(lib, out, t + d, f, l * 0.35, 0.15, 0.5); burst(lib, out, t + d, { type: 'bandpass', f: 500, Q: 0.6, d: 0.1, lvl: l * 0.9, noise: 'pink' }); burst(lib, out, t + d, { type: 'bandpass', f: 1600, Q: 0.8, d: 0.04, lvl: l * 0.25 }); }
    return 0.6;
  },
  grunt, scream, gasp,
  taser: (lib, out, t) => {
    const ctx = lib.ctx, dur = rand(0.7, 1.0);
    const g = gain(ctx, 0, out); const bp = filter(ctx, 'bandpass', 3200, 1.2, g); const s = shaper(ctx, 4, bp);
    const buzz = gain(ctx, 0.6, s); osc(ctx, 'sawtooth', rand(55, 70), t, dur, buzz); osc(ctx, 'square', rand(110, 140), t, dur, gain(ctx, 0.3, s));
    noise(lib, 'crackle', t, dur, gain(ctx, 3.5, s));
    envAHR(g.gain, t, 0.005, 0.22, dur - 0.08, 0.06);
    burst(lib, out, t, { type: 'highpass', f: 4000, d: 0.02, lvl: 0.3 });
    const hg = gain(ctx, 0, out); noise(lib, 'crackle', t, dur, filter(ctx, 'highpass', 5000, 0.7, hg)); envAHR(hg.gain, t, 0.01, 0.35, dur - 0.1, 0.05);
    return dur;
  },
  baton_hit: (lib, out, t) => { whoosh(lib, out, t, 0.12, 400, 1500, 0.06); const h = t + 0.1; thud(lib, out, h, 140, 0.2, 0.1, 0.5); burst(lib, out, h, { type: 'bandpass', f: R(1100), Q: 1.2, d: 0.05, lvl: 0.7 }); burst(lib, out, h, { type: 'highpass', f: 3000, d: 0.012, lvl: 0.2 }); woodKnock(lib, out, h, 300, 0.15, 0.05); return 0.3; },
  gunshot, reload,
  gun_click: (lib, out, t) => { metalHit(lib, out, t, rand(1500, 1900), 0.2, 0.04, 3); click(lib, out, t, 2800, 0.45, 0.008); return 0.08; },
  glass_break: (lib, out, t) => {
    burst(lib, out, t, { type: 'highpass', f: 2500, a: 0.001, d: 0.25, lvl: 0.4 });
    burst(lib, out, t, { type: 'bandpass', f: 1200, Q: 0.6, d: 0.08, lvl: 0.25 });
    thud(lib, out, t, 160, 0.2, 0.06);
    const n = Math.floor(rand(18, 30));
    for (let i = 0; i < n; i++) {
      const tt = t + Math.pow(Math.random(), 1.8) * 0.9, f = rand(2500, 8000);
      modal(lib, out, tt, { freqs: [f, f * 1.7, f * 2.6], amps: [1, 0.5, 0.3], decays: [rand(0.05, 0.25), 0.06, 0.04], lvl: rand(0.03, 0.12) * (1 - (tt - t)) });
    }
    return 1.2;
  },
  splash: (lib, out, t) => {
    burst(lib, out, t, { type: 'bandpass', f: 1400, f2: 300, Q: 0.6, a: 0.005, d: 0.4, lvl: 0.45 });
    burst(lib, out, t + 0.04, { type: 'highpass', f: 2500, a: 0.02, d: 0.5, lvl: 0.15, noise: 'crackle' });
    thud(lib, out, t, 120, 0.15, 0.08);
    for (let i = 0; i < 8; i++) bubble(lib, out, t + rand(0.05, 0.6), rand(400, 1200), 0.04, 0.05);
    return 0.8;
  },
  splash_big: (lib, out, t) => {
    thud(lib, out, t, 70, 0.6, 0.3, 0.5);
    burst(lib, out, t, { type: 'lowpass', f: 3000, f2: 400, sweep: 0.6, a: 0.005, d: 0.8, lvl: 0.6 });
    burst(lib, out, t + 0.1, { type: 'highpass', f: 2000, a: 0.08, d: 1.4, lvl: 0.25, noise: 'crackle' });
    for (let i = 0; i < 20; i++) bubble(lib, out, t + rand(0.1, 1.6), rand(250, 900), 0.05, 0.07);
    burst(lib, out, t + 0.6, { type: 'bandpass', f: 1000, Q: 0.5, a: 0.2, d: 1.0, lvl: 0.12, noise: 'crackle' }); // falling spray
    return 2.0;
  },
  cash: (lib, out, t) => {
    burst(lib, out, t, { type: 'bandpass', f: 900, Q: 0.8, a: 0.03, d: 0.15, lvl: 0.12 });          // drawer
    bellStrike(lib, out, t + 0.12, 2100, 0.1, 0.9);
    coins(lib, out, t + 0.2, 7, 0.08);
    thud(lib, out, t + 0.22, 130, 0.15, 0.06);
    return 1.0;
  },
  chips: (lib, out, t) => { let e = 0; const n = Math.floor(rand(4, 9)); for (let i = 0; i < n; i++) { chipClack(lib, out, t + e, rand(0.06, 0.16)); e += rand(0.02, 0.07); } return e + 0.1; },
  slot_win: (lib, out, t) => {
    const sc = [72, 76, 79, 84, 88, 91, 96];
    for (let k = 0; k < 14; k++) chimeNote(lib, out, t + k * 0.075, mtof(sc[k % sc.length] + (k >= 7 ? 0 : 0)), 0.05, 0.8);
    coins(lib, out, t + 0.3, 22, 0.05);
    return 2.0;
  },
  slot_spin: (lib, out, t) => {
    let e = 0, dt = 0.03;
    while (e < 1.6) { click(lib, out, t + e, 2000 + rand(-200, 200), 0.06, 0.006, 3); e += dt; if (e > 1.0) dt *= 1.12; }
    [0.6, 1.0, 1.5].forEach((d, i) => { thud(lib, out, t + d, 200, 0.12, 0.05); chimeNote(lib, out, t + d, mtof(76 + i * 4), 0.04, 0.4); });
    return 1.8;
  },
  card_flip: (lib, out, t) => { burst(lib, out, t, { type: 'bandpass', f: R(1800), Q: 0.8, a: 0.003, d: 0.04, lvl: 0.45 }); burst(lib, out, t + 0.03, { type: 'bandpass', f: 3500, Q: 1, d: 0.02, lvl: 0.2 }); return 0.07; },
  pickup: (lib, out, t) => { burst(lib, out, t, { type: 'bandpass', f: 1500, Q: 0.7, a: 0.02, d: 0.1, lvl: 0.08 }); tone(lib, out, t + 0.04, { f: mtof(76), d: 0.15, lvl: 0.06, wave: 'triangle' }); tone(lib, out, t + 0.1, { f: mtof(83), d: 0.25, lvl: 0.06, wave: 'triangle' }); return 0.35; },
  keycard_ok: (lib, out, t) => { tone(lib, out, t, { f: 1318, a: 0.003, hold: 0.06, d: 0.05, lvl: 0.08 }); tone(lib, out, t + 0.12, { f: 1760, a: 0.003, hold: 0.09, d: 0.08, lvl: 0.08 }); click(lib, out, t + 0.25, 2600, 0.15, 0.01); thud(lib, out, t + 0.25, 180, 0.1, 0.04); return 0.4; },
  keycard_deny: (lib, out, t) => { const lp = filter(lib.ctx, 'lowpass', 1200, 0.7, out); for (let i = 0; i < 2; i++) tone(lib, lp, t + i * 0.2, { f: 220, a: 0.005, hold: 0.12, d: 0.04, lvl: 0.07, wave: 'square' }); return 0.45; },
  lockpick: (lib, out, t) => { let e = 0; for (let i = 0; i < 7; i++) { burst(lib, out, t + e, { type: 'bandpass', f: rand(2500, 5000), Q: 2.5, a: 0.003, d: rand(0.02, 0.06), lvl: 0.14 }); if (chance(0.6)) metalHit(lib, out, t + e, rand(1800, 2800), 0.06, 0.04, 3); e += rand(0.05, 0.14); } click(lib, out, t + e, 2800, 0.1, 0.01); return e + 0.1; },
  phone_snap: (lib, out, t) => { click(lib, out, t, 2400, 0.4, 0.012); tone(lib, out, t + 0.01, { f: 1200, d: 0.04, lvl: 0.05 }); burst(lib, out, t + 0.06, { type: 'bandpass', f: 1800, Q: 1, d: 0.035, lvl: 0.3 }); click(lib, out, t + 0.07, 3000, 0.3, 0.01); return 0.15; },
  camera_shutter: (lib, out, t) => { metalHit(lib, out, t, 2000, 0.12, 0.03, 3); click(lib, out, t, 2200, 0.4, 0.01); burst(lib, out, t + 0.05, { type: 'bandpass', f: 2000, Q: 1, d: 0.02, lvl: 0.08 }); metalHit(lib, out, t + 0.09, 2400, 0.07, 0.03, 3); whoosh(lib, out, t + 0.14, 0.25, 1500, 2600, 0.02, 4, 'white'); return 0.45; },
  radio_chatter: radioChatter,
  whistle: (lib, out, t) => {
    const ctx = lib.ctx, dur = rand(0.5, 0.9);
    const g = gain(ctx, 0, out);
    const o1 = osc(ctx, 'sine', R(2900, 0.03), t, dur, g);
    osc(ctx, 'sine', rand(22, 30), t, dur, gain(ctx, 180, o1.frequency)); // pea trill
    const h = osc(ctx, 'sine', o1.frequency.value * 2, t, dur, gain(ctx, 0.08, g));
    const nb = filter(ctx, 'bandpass', 3000, 2, gain(ctx, 0.8, g)); noise(lib, 'white', t, dur, nb);
    envAHR(g.gain, t, 0.02, 0.12, dur - 0.08, 0.05);
    return dur;
  },
  alarm_beep: (lib, out, t) => { const lp = filter(lib.ctx, 'lowpass', 2500, 0.7, out); for (let i = 0; i < 3; i++) tone(lib, lp, t + i * 0.25, { f: 1046, a: 0.004, hold: 0.12, d: 0.03, lvl: 0.08, wave: 'square' }); return 0.8; },
  ...ui,
  eat: (lib, out, t) => { let e = 0; for (let i = 0; i < 4; i++) { burst(lib, out, t + e, { type: 'bandpass', f: rand(900, 2200), Q: 0.8, a: 0.004, d: rand(0.04, 0.08), lvl: 0.3 }); burst(lib, out, t + e, { type: 'highpass', f: 2500, d: 0.04, lvl: 0.12, noise: 'crackle' }); e += rand(0.18, 0.3); } return e; },
  drink: (lib, out, t) => { let e = 0.05; for (let i = 0; i < 4; i++) { tone(lib, out, t + e, { f: rand(250, 380), f2: rand(450, 650), a: 0.01, d: 0.08, lvl: 0.1, sweep: 0.08 }); thud(lib, out, t + e, 120, 0.06, 0.05); e += rand(0.25, 0.35); } tone(lib, out, t + e, { f: 500, f2: 300, d: 0.1, lvl: 0.04 }); return e + 0.1; },
  ship_horn: (lib, out, t, o) => shipHorn(lib, out, t, { dur: o?.dur ?? rand(4, 5.5), lvl: 0.5 }),
  wind_gust: (lib, out, t) => { const d = rand(2, 3.5); whoosh(lib, out, t, d, 250, rand(700, 1100), 0.25, 1.2); whoosh(lib, out, t + 0.2, d * 0.8, 1200, 2600, 0.06, 2); return d; },
  thunder: (lib, out, t, o = {}) => {
    const ctx = lib.ctx, near = o.near ?? Math.random(), dur = rand(4, 7);
    if (near > 0.6) { burst(lib, out, t, { type: 'highpass', f: 1500, a: 0.002, d: 0.15, lvl: 0.35 * near }); burst(lib, out, t, { type: 'lowpass', f: 3000, d: 0.4, lvl: 0.4 * near }); }
    const g = gain(ctx, 0, out); const lp = filter(ctx, 'lowpass', 180 + near * 300, 0.7, g); const sat = shaper(ctx, 1.5, lp);
    noise(lib, 'brown', t, dur, gain(ctx, 3, sat));
    // rolling envelope: several swells
    g.gain.setValueAtTime(0, t);
    let tt = t + (near > 0.6 ? 0.02 : rand(0.1, 0.4)), lvl = 0.6 + near * 0.3;
    while (tt < t + dur - 0.5) { g.gain.linearRampToValueAtTime(lvl * rand(0.4, 1), tt + rand(0.05, 0.25)); tt += rand(0.3, 0.9); lvl *= 0.8; }
    g.gain.setTargetAtTime(0, tt, 0.5);
    return dur;
  },
  // melee whoosh (baton / fist swing through air)
  swing: (lib, out, t) => { const d = rand(0.16, 0.24); whoosh(lib, out, t, d, rand(250, 350), rand(1400, 2000), 0.16, 1.1); whoosh(lib, out, t + 0.01, d * 0.8, 1800, 4200, 0.04, 2, 'white'); return d + 0.05; },
  // supersonic crack + doppler whine of a round passing close by
  whiz: (lib, out, t) => {
    click(lib, out, t, 4500, 0.25, 0.004, 0.8);
    tone(lib, out, t + 0.004, { f: rand(2600, 3400), f2: rand(900, 1300), a: 0.004, d: 0.14, lvl: 0.05, sweep: 0.13 });
    whoosh(lib, out, t, 0.12, 6000, 1800, 0.08, 1.4, 'white');
    return 0.18;
  },
  // fire extinguisher discharge: pressurised hiss with valve pop, ~1.6 s (re-triggered while held)
  spray: (lib, out, t) => {
    const ctx = lib.ctx, d = rand(1.4, 1.8);
    click(lib, out, t, 1600, 0.25, 0.02, 0.8);
    const g = gain(ctx, 0, out); const hp = filter(ctx, 'highpass', 1800, 0.6, g); const bp = filter(ctx, 'bandpass', 4200, 0.7, gain(ctx, 0.6, g));
    const src = gain(ctx, 1); src.connect(hp); src.connect(bp);
    noise(lib, 'white', t, d + 0.1, src);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.06); g.gain.setValueAtTime(0.3, t + d - 0.25); g.gain.linearRampToValueAtTime(0, t + d);
    burst(lib, out, t + 0.01, { type: 'lowpass', f: 400, d: 0.15, lvl: 0.18 });
    return d;
  },
  // elevator / door call button: plastic click + soft confirmation beep
  button: (lib, out, t) => { click(lib, out, t, 2200, 0.3, 0.008); woodKnock(lib, out, t, 900, 0.05, 0.03); tone(lib, out, t + 0.05, { f: 1568, a: 0.003, hold: 0.08, d: 0.06, lvl: 0.05 }); return 0.2; },
  footstep, door: doorSound, elevator_chime: elevatorChime,
  bell: (lib, out, t) => bellStrike(lib, out, t, rand(880, 920), 0.25, 2.5),
};

// ── alarms (patterns that last many seconds) ───────────────────────────────
// Electric fire bell: striker hammering a gong at ~18 Hz.
export function fireBell(lib, out, t, dur = 3) {
  const f = 1250, rate = 18;
  for (let k = 0; k < dur * rate; k++) {
    const tt = t + k / rate + rand(-0.002, 0.002);
    modal(lib, out, tt, { freqs: [f, f * 2.76, f * 5.4, f * 0.5], amps: [1, 0.5, 0.25, 0.15], decays: [0.25, 0.12, 0.06, 0.4], lvl: 0.05 * rand(0.8, 1) });
  }
  return dur;
}
export function klaxon(lib, out, t, dur = 1.2) {
  const ctx = lib.ctx; const g = gain(ctx, 0, out);
  const lp = filter(ctx, 'lowpass', 1800, 1, g); const pk = filter(ctx, 'peaking', 700, 2, lp, 8);
  const sat = shaper(ctx, 2, pk);
  for (const [f, w] of [[392, 'sawtooth'], [466, 'square']]) { const o = osc(ctx, w, f, t, dur, gain(ctx, 0.3, sat)); o.frequency.setValueAtTime(f * 0.85, t); o.frequency.linearRampToValueAtTime(f, t + 0.15); }
  envAHR(g.gain, t, 0.04, 0.16, dur - 0.1, 0.08);
  return dur;
}
// 7 short + 1 long on whistle and general-alarm bells. Returns total duration.
export function musterPattern(lib, out, t) {
  let tt = t;
  for (let i = 0; i < 7; i++) { shipWhistleBlast(lib, out, tt, 0.9, 0.38); fireBell(lib, out, tt, 0.9); tt += 1.8; }
  shipWhistleBlast(lib, out, tt, 5.5, 0.38); fireBell(lib, out, tt, 5.5);
  return tt - t + 6.4;
}
export function securityTone(lib, out, t) {
  // discreet three-note descending tone (doorbell-ish), twice
  for (let r = 0; r < 2; r++) [81, 77, 72].forEach((m, i) => chimeNote(lib, out, t + r * 0.9 + i * 0.22, mtof(m), 0.08, 0.9));
  return 2.3;
}
export function paChime(lib, out, t) {
  // pleasant four-note "bing-bong" (G5 E5 C5 G4 style descending arpeggio, warm)
  [79, 76, 72, 67].forEach((m, i) => { chimeNote(lib, out, t + i * 0.42, mtof(m), 0.12, 2.2); tone(lib, out, t + i * 0.42, { f: mtof(m), a: 0.01, d: 1.5, lvl: 0.04, wave: 'triangle' }); });
  return 2.6;
}
export function gullCall(lib, out, t) {
  const n = Math.floor(rand(2, 5)); let e = 0;
  for (let i = 0; i < n; i++) {
    const d = rand(0.18, 0.35), f = rand(1300, 1800);
    vocal(lib, out, t + e, d, { f0: f, f0Mid: f * 1.15, f0End: f * 0.7, vowel: VOWELS.ae, vowelEnd: VOWELS.e, formantMul: 1.8, lvl: 0.12, attack: 0.02, release: 0.06, breath: 0.2, bright: 6000 });
    e += d + rand(0.05, 0.12);
  }
  return e;
}
export { creak, coins, chipClack, bubble, metalHit, woodKnock, thud, click, whoosh, chimeNote };

export const SFX_NAMES = Object.keys(SFX).filter(n => !['footstep', 'door', 'elevator_chime', 'bell'].includes(n));
