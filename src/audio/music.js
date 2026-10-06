// HALCYON TIDE — generative music: harmony helpers, a step sequencer "Band" and venue styles.
// Each style writes real music on the fly: chord progressions with voice-led voicings, walking/root
// basslines, motif-based melodies drawn from the chord scale, swing and humanised timing/velocity,
// 8-bar sections with arrangement changes, occasional key changes.
import { rand, pick, chance, gain, panner2, filter, mtof } from './dsp.js';
import { INST, DRUM } from './instruments.js';

// ── harmony ────────────────────────────────────────────────────────────────
export const Q = {
  maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '7': [0, 4, 7, 10], m7b5: [0, 3, 6, 10],
  '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], dim7: [0, 3, 6, 9], sus: [0, 5, 7], '9': [0, 4, 7, 10, 14], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14],
};
const COLOR = { // rootless jazz voicings (intervals above root)
  maj7: [4, 7, 11, 14], m7: [3, 7, 10, 14], '7': [4, 9, 10, 14], m7b5: [3, 6, 10, 12], '6': [4, 7, 9, 14], m6: [3, 7, 9, 14],
  dim7: [3, 6, 9, 12], maj: [4, 7, 12, 14], min: [3, 7, 10, 14], sus: [5, 7, 10, 14], '9': [4, 10, 14, 19], add9: [4, 7, 14, 16], m9: [3, 10, 14, 15],
};
const SCALE = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10], dor: [0, 2, 3, 5, 7, 9, 10], mix: [0, 2, 4, 5, 7, 9, 10], penta: [0, 2, 4, 7, 9], mpenta: [0, 3, 5, 7, 10], harm: [0, 2, 3, 5, 7, 8, 11] };
const chordScale = (q) => (q === 'm7' || q === 'min' || q === 'm9' || q === 'm6') ? SCALE.dor : q === '7' || q === '9' ? SCALE.mix : q === 'm7b5' ? [0, 1, 3, 5, 6, 8, 10] : q === 'dim7' ? [0, 2, 3, 5, 6, 8, 9, 11] : SCALE.maj;

// chord = {r: root pitch class relative to key, q: quality}; resolve to absolute pitch classes
const C = (r, q) => ({ r, q });
function pcs(ch, key, color = false) { return (color ? COLOR[ch.q] || Q[ch.q] : Q[ch.q]).map(i => (key + ch.r + i) % 12); }
// Choose a voicing for pitch classes `p` in [lo,hi] closest to the previous voicing (smooth voice leading).
export function voiceLead(p, prev, lo, hi) {
  const n = p.length, cands = [];
  for (let rot = 0; rot < n; rot++) {
    let first = lo + ((p[rot] - lo) % 12 + 12) % 12;
    for (let base = first; base <= hi; base += 12) {
      const v = [base]; let last = base;
      for (let k = 1; k < n; k++) { const pc = p[(rot + k) % n]; let m = last + 1 + ((pc - (last + 1)) % 12 + 12) % 12; v.push(m); last = m; }
      if (last <= hi + 2) cands.push(v);
    }
  }
  if (!cands.length) return p.map((pc, i) => lo + pc + (i ? 12 : 0));
  if (!prev || prev.length !== n) return cands[Math.floor(cands.length / 2)];
  const mid = (lo + hi) / 2;
  let best = cands[0], bs = 1e9;
  for (const c of cands) {
    let s = 0; for (let i = 0; i < n; i++) s += Math.abs(c[i] - prev[i]);
    s += Math.abs((c[0] + c[n - 1]) / 2 - mid) * 0.35 + rand(0, 0.8);
    if (s < bs) { bs = s; best = c; }
  }
  return best;
}
const nearestPc = (m, pcsArr) => { let best = m, bd = 99; for (let d = -6; d <= 6; d++) if (pcsArr.includes(((m + d) % 12 + 12) % 12) && Math.abs(d) < bd) { bd = Math.abs(d); best = m + d; } return best; };
function scaleNotes(key, scale, lo, hi) { const out = []; for (let m = lo; m <= hi; m++) if (scale.includes(((m - key) % 12 + 12) % 12)) out.push(m); return out; }

// Melody generator: motif rhythm memory + stepwise contour + chord-tone landing on strong beats.
class Melody {
  constructor(lo, hi, density = 0.5) { this.lo = lo; this.hi = hi; this.last = Math.round((lo + hi) / 2); this.dir = 1; this.density = density; this.motif = null; this.motifBar = -99; }
  rhythm(spb, bar) {
    if (!this.motif || bar - this.motifBar >= 4 || chance(0.12)) {
      const r = new Array(spb).fill(0);
      for (let s = 0; s < spb; s++) {
        const strong = s % (spb / 4) === 0, mid = s % (spb / 8) === 0;
        const p = strong ? 0.75 : mid ? 0.42 : 0.12;
        if (Math.random() < p * this.density * 1.4) r[s] = 1;
      }
      if (chance(0.5)) for (let s = Math.floor(spb * 0.75); s < spb; s++) r[s] = 0;   // breathe at phrase end
      r[0] = r[0] || (chance(0.6) ? 1 : 0);
      this.motif = r; this.motifBar = bar;
    }
    // light variation
    return this.motif.map(v => (chance(0.08) ? 1 - v : v));
  }
  next(key, chord, strong, scale) {
    const sc = scaleNotes(key, scale, this.lo, this.hi);
    const cpcs = pcs(chord, key, false).concat(pcs(chord, key, true));
    let idx = sc.indexOf(nearestInList(sc, this.last));
    if (this.last > this.hi - 4) this.dir = -1; else if (this.last < this.lo + 4) this.dir = 1; else if (chance(0.2)) this.dir *= -1;
    const step = chance(0.72) ? 1 : chance(0.6) ? 2 : pick([3, 4]);
    idx = Math.max(0, Math.min(sc.length - 1, idx + this.dir * step));
    let m = sc[idx];
    if (strong) m = nearestPc(m, cpcs);
    this.last = Math.max(this.lo, Math.min(this.hi, m));
    return this.last;
  }
}
const nearestInList = (arr, m) => { let b = arr[0], bd = 1e9; for (const v of arr) if (Math.abs(v - m) < bd) { bd = Math.abs(v - m); b = v; } return b; };

// ── Band: sequencer + mixer for one musical source ─────────────────────────
export class Band {
  constructor(lib, out, styleName, opts = {}) {
    this.lib = lib; this.ctx = lib.ctx; this.styleName = styleName;
    this.style = STYLES[styleName] || STYLES.jazz;
    this.out = gain(this.ctx, this.style.gain ?? 1, out);
    this.level = 1;               // musical intensity 0..1 (arrangement density)
    this.parts = {};
    this.state = {};
    this.opts = opts;
    this.bpm = this.style.bpm * rand(0.96, 1.04) * (opts.tempoMul || 1);
    this.spb = this.style.spb || 16;
    this.key = opts.key ?? pick(this.style.keys || [0]);
    this.prog = pick(this.style.progs);
    this.bar = 0; this.stepI = 0;
    this.nextT = this.ctx.currentTime + 0.12;
    this.voicing = null;
    this.section = 0;
    this.style.init?.(this);
  }
  part(name, pan = 0, vol = 1) {
    if (!this.parts[name]) { const p = panner2(this.ctx, pan, this.out); const g = gain(this.ctx, vol, p); this.parts[name] = g; }
    return this.parts[name];
  }
  get stepDur() { return 60 / this.bpm / (this.spb / 4); }
  chordAt(bar, s) {
    const e = this.prog[bar % this.prog.length];
    if (Array.isArray(e)) return e[Math.min(e.length - 1, Math.floor(s / (this.spb / e.length)))];
    return e;
  }
  // schedule steps until `until` (audio time)
  schedule(until) {
    let guard = 0;
    const now = this.ctx.currentTime;
    if (this.nextT < now - 0.25) {   // fell behind (tab hidden / long frame): skip ahead, keep bar position
      const steps = Math.ceil((now + 0.05 - this.nextT) / this.stepDur);
      this.nextT += steps * this.stepDur; this.stepI += steps; this.bar += Math.floor(this.stepI / this.spb); this.stepI %= this.spb;
    }
    while (this.nextT < until && guard++ < 64) {
      const s = this.stepI;
      if (s === 0) this._barStart();
      const chord = this.chordAt(this.bar, s);
      let t = this.nextT;
      const sw = this.style.swing || 0.5;
      const beatSteps = this.spb / 4;
      if (sw > 0.5 && beatSteps === 4) {
        const pos = s % 4;
        if (this.style.swing16) { if (pos % 2 === 1) t += (sw - 0.5) * 2 * this.stepDur; }   // swung 16ths
        else if (pos === 2) t += (sw - 0.5) * 4 * this.stepDur;                             // swung 8ths
      }
      if (t > this.ctx.currentTime - 0.01) {
        try { this.style.step(this, s, t, chord); } catch (e) { if (!this._err) { this._err = 1; console.warn('[audio] style error', this.styleName, e); } }
      }
      this.nextT += this.stepDur;
      this.stepI++;
      if (this.stepI >= this.spb) { this.stepI = 0; this.bar++; }
    }
  }
  _barStart() {
    if (this.bar > 0 && this.bar % 8 === 0) {
      this.section++;
      if (chance(0.45)) this.prog = pick(this.style.progs);
      if (this.style.modulate && chance(0.18)) this.key = (this.key + pick([5, 7, 2, -2, 3]) + 12) % 12;
    }
    this.style.bar?.(this);
  }
  hum(t) { return t + rand(-0.008, 0.008); }      // timing humanisation
  vel(v, j = 0.12) { return Math.max(0.05, Math.min(1, v * rand(1 - j, 1 + j) * (0.55 + 0.45 * this.level))); }
  stop() { try { this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); const o = this.out; setTimeout(() => { try { o.disconnect(); } catch {} }, 2500); } catch {} }
}

// helpers for styles
function play(b, part, inst, t, m, vel, dur, o) { INST[inst](b.lib, b.part(part), b.hum(t), m, b.vel(vel), dur, o); }
function drum(b, part, d, t, vel, o) { DRUM[d](b.lib, b.part(part), b.hum(t), b.vel(vel, 0.18), o); }
function comp(b, part, inst, t, chord, lo, hi, vel, dur, color = true, strum = 0) {
  const p = pcs(chord, b.key, color);
  b.voicing = voiceLead(p, b.voicing, lo, hi);
  b.voicing.forEach((m, i) => play(b, part, inst, t + i * strum + rand(0, 0.012), m, vel * rand(0.85, 1.05), dur));
}
const rootOf = (b, ch, lo) => { const r = (b.key + ch.r) % 12; return lo + ((r - lo) % 12 + 12) % 12; };

// ── styles ─────────────────────────────────────────────────────────────────
export const STYLES = {
  // Lounge jazz piano trio: rootless comping, walking bass, ride + brushes, improvised RH lines.
  jazz: {
    gain: 1.0, bpm: 108, spb: 16, swing: 0.64, keys: [5, 10, 3, 0, 7], modulate: true,
    progs: [
      [C(2, 'm7'), C(7, '7'), C(0, 'maj7'), C(9, '7')],
      [C(2, 'm7'), C(7, '7'), C(4, 'm7'), C(9, '7'), C(2, 'm7'), C(7, '7'), C(0, 'maj7'), C(0, '6')],
      [C(0, 'maj7'), C(9, 'm7'), C(2, 'm7'), C(7, '7')],
      [C(4, 'm7b5'), C(9, '7'), C(2, 'm7'), C(2, 'm7'), C(7, 'm7'), C(0, '7'), C(5, 'maj7'), C(5, '6')],
      [C(5, 'maj7'), C(10, '7'), C(4, 'm7'), C(9, '7'), C(2, 'm7'), C(7, '7'), C(0, 'maj7'), [C(2, 'm7'), C(7, '7')]],
    ],
    init(b) { b.mel = new Melody(67, 86, b.opts.solo ? 0.5 : 0.55); b.drums = !b.opts.solo; b.bassOn = !b.opts.solo; },
    bar(b) {
      // comping rhythm for this bar (Charleston-ish & variations)
      b.compSteps = pick([[0, 6], [2, 10], [6, 12], [0, 10], [4, 14], [6], [2, 8, 14]]);
      b.melOn = (b.section % 4 !== 3) || b.opts.solo;
      b.rh = b.melOn ? b.mel.rhythm(16, b.bar) : null;
    },
    step(b, s, t, ch) {
      const beat = s % 4 === 0, bt = s / 4;
      // piano comping (left hand / rootless voicings)
      if (b.compSteps.includes(s)) comp(b, 'pianoL', 'piano', t, ch, 50, 70, 0.5, s % 4 === 2 ? b.stepDur * 3 : b.stepDur * 6);
      if (b.opts.solo && s === 0) play(b, 'pianoL', 'piano', t, rootOf(b, ch, 36), 0.55, b.stepDur * 14);
      // right hand melody (8th-note grid)
      if (b.rh && b.rh[s] && s % 2 === 0) {
        const m = b.mel.next(b.key, ch, beat, chordScale(ch.q).map(x => (x + ch.r) % 12));
        play(b, 'pianoR', 'piano', t, m, beat ? 0.62 : 0.5, b.stepDur * rand(1.5, 3));
        if (chance(0.12)) play(b, 'pianoR', 'piano', t, m - pick([3, 4, 5]), 0.4, b.stepDur * 2);
      }
      // walking bass on quarter notes
      if (b.bassOn && beat) {
        const root = rootOf(b, ch, 33);
        let m;
        if (bt === 0) m = root;
        else if (bt === 3) { const nx = b.chordAt(b.bar + 1, 0); const nr = rootOf(b, nx, 33); m = nr + (chance(0.6) ? (chance(0.5) ? 1 : -1) : (nr - 5 > 28 ? -5 : 7)); }
        else { const tones = Q[ch.q].map(i => root + i); m = bt === 2 ? pick([root + 7, tones[2], root + 12]) : pick(tones.slice(1)); if (m > 50) m -= 12; }
        play(b, 'bass', 'ubass', t, m, bt === 0 ? 0.8 : 0.68, b.stepDur * 3.6);
      }
      // drums: ride swing + hat foot on 2/4 + brush sweeps
      if (b.drums) {
        if (beat || s % 4 === 2 && (bt === 1 || bt === 3)) drum(b, 'drums', 'ride', t, beat ? (bt % 2 ? 0.75 : 0.6) : 0.45);
        if (beat && bt % 2 === 1) drum(b, 'drums', 'hat', t, 0.35);
        if (s === 0) drum(b, 'drums', 'brush', t, 0.6, { sweep: true });
        if (s === 8) drum(b, 'drums', 'brush', t, 0.5, { sweep: true });
        if (beat && bt === 0 && chance(0.5)) drum(b, 'drums', 'kick', t, 0.25);
        if (s % 4 === 2 && chance(0.12)) drum(b, 'drums', 'snare', t, 0.12);
      }
    },
  },

  // Pub acoustic folk: strummed guitar, fiddle tune, bodhrán (jig in 6/8, 12 steps = two dotted beats × 6).
  folk: {
    gain: 1.9, bpm: 112, spb: 12, swing: 0.5, keys: [7, 2, 9],
    progs: [
      [C(0, 'maj'), C(0, 'maj'), C(5, 'maj'), C(7, 'maj'), C(0, 'maj'), C(9, 'min'), C(5, 'maj'), [C(7, 'maj'), C(0, 'maj')]],
      [C(0, 'maj'), C(7, 'maj'), C(9, 'min'), C(5, 'maj')],
      [C(9, 'min'), C(7, 'maj'), C(5, 'maj'), C(7, 'maj')],
      [C(0, 'maj'), C(10, 'maj'), C(5, 'maj'), C(0, 'maj')],
    ],
    init(b) { b.mel = new Melody(67, 88, 0.85); b.fid = true; },
    bar(b) { b.tuneBar = b.section % 4 !== 2; },
    step(b, s, t, ch) {
      // jig strum: down on 0 and 6, lighter strums on 3 and 9, alternating up-strum
      if (s % 3 === 0) {
        const strong = s === 0 || s === 6;
        const p = pcs(ch, b.key, false);
        const down = s % 6 === 0;
        b.voicing = voiceLead(p.concat([p[0]]), b.voicing && b.voicing.length === 4 ? b.voicing : null, 52, 71);
        const notes = down ? b.voicing : [...b.voicing].reverse();
        notes.forEach((m, i) => play(b, 'guitar', 'guitar', t + i * 0.011, m, strong ? 0.7 : 0.45, b.stepDur * 3, { bright: strong ? 0.6 : 0.45 }));
        if (s === 0) play(b, 'guitar', 'guitar', t, rootOf(b, ch, 40), 0.7, b.stepDur * 6);
        if (s === 6) play(b, 'guitar', 'guitar', t, rootOf(b, ch, 40) + 7, 0.55, b.stepDur * 6);
      }
      // fiddle: running eighths (jig figure) with chord tones on beats
      if (b.tuneBar && (s % 2 === 0 || chance(0.06))) {
        const strong = s === 0 || s === 6;
        if (!strong && chance(0.12)) return;
        const m = b.mel.next(b.key, ch, strong, SCALE.maj);
        play(b, 'fiddle', 'fiddle', t, m, strong ? 0.75 : 0.55, b.stepDur * (strong ? 2.1 : 1.9));
      } else if (!b.tuneBar && s % 6 === 0) {
        play(b, 'fiddle', 'whistleFlute', t, b.mel.next(b.key, ch, true, SCALE.penta.map(x => x)), 0.55, b.stepDur * 5.5);
      }
      // bodhrán
      if (s === 0 || s === 6) drum(b, 'perc', 'bodhran', t, 0.6);
      else if (s % 2 === 0 && chance(0.6)) drum(b, 'perc', 'bodhran', t, 0.3, { high: true });
    },
  },

  // Nightclub four-on-the-floor: kick, claps, offbeat hats, rolling bass, supersaw stabs & pluck arps.
  club: {
    bpm: 124, spb: 16, swing: 0.52, swing16: true, keys: [9, 2, 4, 7],
    progs: [[C(0, 'min'), C(8, 'maj'), C(3, 'maj'), C(10, 'maj')], [C(0, 'min'), C(5, 'min'), C(8, 'maj'), C(7, 'maj')], [C(0, 'm7'), C(0, 'm7'), C(8, 'maj7'), C(10, 'sus')]],
    bar(b) {
      const sec = b.section % 4, pos = b.bar % 8;
      b.phase = sec === 3 ? 'break' : 'drop';
      // filter sweep build in the last two bars of a break
      const now = b.nextT;
      if (b.phase === 'break') { b.lp.frequency.setTargetAtTime(pos >= 6 ? 6000 : 900, now, pos >= 6 ? 1.2 : 0.4); }
      else b.lp.frequency.setTargetAtTime(18000, now, 0.2);
    },
    step(b, s, t, ch) {
      const drop = b.phase === 'drop', beat = s % 4 === 0;
      if (beat && (drop || b.bar % 8 >= 6)) drum(b, 'kick', 'kick', t, 0.95, { club: true });
      if (drop && (s === 4 || s === 12)) drum(b, 'drums', 'clap', t, 0.6);
      if (s % 4 === 2) drum(b, 'drums', 'hat', t, drop ? 0.6 : 0.4, { open: true });
      if (drop && s % 2 === 1) drum(b, 'drums', 'hat', t, 0.25 + (s % 4 === 3 ? 0.1 : 0));
      if (drop && s % 16 === 14 && b.bar % 4 === 3) drum(b, 'drums', 'snare', t, 0.4);
      // bass: offbeat 8ths + octave pops
      if (drop && (s % 4 === 2 || (s % 4 === 3 && chance(0.25)))) play(b, 'bass', 'synbass', t, rootOf(b, ch, 33) + (s % 8 === 6 && chance(0.3) ? 12 : 0), 0.85, b.stepDur * 1.6);
      // pad / stabs
      if (s === 0) comp(b, 'pad', 'supersaw', t, ch, 57, 76, drop ? 0.65 : 0.85, drop ? b.stepDur * 2.5 : b.stepDur * 15, false);
      if (drop && (s === 6 || s === 10) && chance(0.5)) comp(b, 'pad', 'supersaw', t, ch, 57, 76, 0.55, b.stepDur * 1.5, false);
      // pluck arpeggio
      if (s % 2 === 0) {
        const p = pcs(ch, b.key, true).sort((a, c) => a - c);
        const seq = [0, 1, 2, 3, 2, 1, 3, 2];
        const m = 72 + p[seq[(s / 2) % 8] % p.length] - (p[seq[(s / 2) % 8] % p.length] > 7 ? 12 : 0);
        play(b, 'arp', 'pluck', t, m + (b.section % 2 ? 12 : 0), 0.55, b.stepDur);
      }
    },
  },

  // Casino lounge: bossa nova — e-piano comping, bossa bass, rim clave, shaker, vibraphone melody.
  casino: {
    bpm: 128, spb: 16, swing: 0.5, keys: [2, 7, 0, 5], modulate: true,
    progs: [[C(0, 'maj7'), C(0, 'maj7'), C(2, '7'), C(2, '7'), C(2, 'm7'), C(7, '7'), C(0, 'maj7'), C(7, '7')],
            [C(2, 'm7'), C(7, '7'), C(0, 'maj7'), C(9, '7')], [C(9, 'm7'), C(2, '7'), C(7, 'm7'), C(0, '7'), C(5, 'maj7'), C(10, '7'), C(4, 'm7'), C(9, '7')]],
    init(b) { b.mel = new Melody(69, 88, 0.5); },
    bar(b) { b.rh = b.section % 3 !== 2 ? b.mel.rhythm(16, b.bar) : null; },
    step(b, s, t, ch) {
      const clave = [0, 3, 6, 10, 12];
      if ([0, 3, 6, 10, 13].includes(s)) comp(b, 'keys', 'epiano', t, ch, 55, 74, s === 0 ? 0.6 : 0.5, b.stepDur * (s === 6 ? 4 : 2.5));
      const root = rootOf(b, ch, 33);
      if (s === 0) play(b, 'bass', 'ubass', t, root, 0.8, b.stepDur * 3);
      if (s === 6) play(b, 'bass', 'ubass', t, root + 7, 0.7, b.stepDur * 2);
      if (s === 8) play(b, 'bass', 'ubass', t, root + 7, 0.75, b.stepDur * 3);
      if (s === 14) { const nr = rootOf(b, b.chordAt(b.bar + 1, 0), 33); play(b, 'bass', 'ubass', t, nr, 0.65, b.stepDur * 2); }
      if (clave.includes(s)) drum(b, 'perc', 'rim', t, 0.5);
      drum(b, 'perc', 'shaker', t, s % 4 === 0 ? 0.7 : s % 2 ? 0.35 : 0.5);
      if (s === 0 || s === 8) drum(b, 'perc', 'kick', t, 0.35);
      if (b.rh && b.rh[s] && s % 2 === 0) play(b, 'vibes', 'vibes', t, b.mel.next(b.key, ch, s % 4 === 0, chordScale(ch.q).map(x => (x + ch.r) % 12)), 0.6, b.stepDur * 3);
    },
  },

  // Pool deck: tropical pop — steel pan lead, ukulele/marimba chords, light dembow, congas, shaker.
  tropical: {
    gain: 1.05, bpm: 102, spb: 16, swing: 0.55, swing16: true, keys: [5, 0, 7, 2],
    progs: [[C(0, 'maj'), C(7, 'maj'), C(9, 'min'), C(5, 'maj')], [C(5, 'maj'), C(7, 'maj'), C(0, 'maj'), C(0, 'maj')], [C(0, 'maj'), C(5, 'maj'), C(7, 'maj'), C(5, 'maj')], [C(2, 'm7'), C(7, '7'), C(0, 'maj7'), C(0, '6')]],
    init(b) { b.mel = new Melody(67, 86, 0.65); },
    bar(b) { b.rh = b.mel.rhythm(16, b.bar); b.call = (b.bar % 2 === 0); },
    step(b, s, t, ch) {
      // uke skank on offbeats
      if (s % 4 === 2) comp(b, 'uke', 'uke', t, ch, 60, 76, 0.6, b.stepDur * 1.5, false, 0.008);
      if (s === 0 || s === 8) play(b, 'mar', 'marimba', t, rootOf(b, ch, 48) + (s === 8 ? 7 : 0), 0.6, b.stepDur * 2);
      // bass
      if (s === 0 || s === 7 || s === 10) play(b, 'bass', 'ubass', t, rootOf(b, ch, 33) + (s === 10 ? 7 : 0), s === 0 ? 0.85 : 0.65, b.stepDur * 2);
      // steel pan: call (2 bars) and response — on the response bar play a lighter echo
      if (b.rh[s] && (s % 2 === 0 || chance(0.25))) {
        const m = b.mel.next(b.key, ch, s % 4 === 0, SCALE.penta);
        play(b, 'pan', 'steelpan', t, m, b.call ? 0.75 : 0.55, b.stepDur * 2);
        if (chance(0.35)) play(b, 'pan', 'steelpan', t + b.stepDur * 0.5, m, 0.35, b.stepDur);   // classic pan roll
      }
      // percussion
      if (s === 0 || s === 8) drum(b, 'perc', 'kick', t, 0.6);
      if (s === 6 || s === 14 || s === 3 || s === 11) drum(b, 'perc', 'rim', t, 0.35);
      if (s % 4 === 2 || s === 13) drum(b, 'perc', 'conga', t, 0.5, { high: s % 8 === 2, slap: s === 13 });
      drum(b, 'perc', 'shaker', t, s % 2 ? 0.35 : 0.6);
    },
  },

  // Theatre: orchestral overture — string sections with swells, brass fanfare, harp, timpani.
  orchestral: {
    gain: 1.3, bpm: 84, spb: 16, swing: 0.5, keys: [2, 7, 10, 3], modulate: true,
    progs: [[C(0, 'maj'), C(9, 'min'), C(5, 'maj'), C(7, 'maj')], [C(0, 'maj'), C(4, 'min'), C(5, 'maj'), C(7, 'sus'), C(0, 'maj'), C(4, 'min'), [C(5, 'maj'), C(2, 'min')], C(7, 'maj')],
            [C(9, 'min'), C(5, 'maj'), C(0, 'maj'), C(7, 'maj')], [C(0, 'maj'), C(10, 'maj'), C(5, 'maj'), C(0, 'maj')]],
    init(b) { b.mel = new Melody(67, 84, 0.4); b.prevS = null; },
    bar(b) { b.rh = b.mel.rhythm(16, b.bar); b.brassBar = b.section % 2 === 1; },
    step(b, s, t, ch) {
      if (s === 0) {
        const p = pcs(ch, b.key, false);
        b.prevS = voiceLead(p, b.prevS, 55, 72);
        b.prevS.forEach(m => play(b, 'strings', 'strings', t, m, 0.75, b.stepDur * 15.5, { ensemble: true, attack: 0.35, release: 0.8, swell: 1.3, lvl: 0.05 }));
        play(b, 'low', 'strings', t, rootOf(b, ch, 36), 0.8, b.stepDur * 15.5, { ensemble: true, attack: 0.25, release: 0.8, lvl: 0.07 });
        play(b, 'low', 'strings', t, rootOf(b, ch, 48), 0.6, b.stepDur * 15.5, { attack: 0.3, release: 0.8, lvl: 0.05 });
        if (b.bar % 4 === 0) drum(b, 'perc', 'timpani', t, 0.75, { m: rootOf(b, ch, 36) });
        if (b.bar % 8 === 7) drum(b, 'perc', 'cymbalSwell', t, 0.7, b.stepDur * 16);
      }
      if (s === 12 && b.bar % 4 === 3) for (let k = 0; k < 4; k++) drum(b, 'perc', 'timpani', t + k * b.stepDur, 0.35 + k * 0.1, { m: rootOf(b, b.chordAt(b.bar + 1, 0), 36) });
      // violin melody (legato longer notes) or brass fanfare
      if (b.rh[s] && s % 4 === 0) {
        const m = b.mel.next(b.key, ch, s % 8 === 0, SCALE.maj);
        if (b.brassBar) { play(b, 'brass', 'brass', t, m - 12, 0.75, b.stepDur * 3.6, { lvl: 0.06 }); play(b, 'brass', 'brass', t, nearestPc(m - 16, pcs(ch, b.key)), 0.6, b.stepDur * 3.6, { lvl: 0.05 }); }
        else play(b, 'violin', 'strings', t, m, 0.8, b.stepDur * 3.8, { attack: 0.1, release: 0.3, lvl: 0.07 });
      }
      // harp arpeggio
      if (s % 2 === 0 && b.section % 2 === 0) { const p = pcs(ch, b.key).sort((a, c) => a - c); const seq = [0, 1, 2, 3, 4, 5, 4, 3]; const k = seq[(s / 2) % 8]; play(b, 'harp', 'harp', t, 55 + p[k % p.length] + 12 * Math.floor(k / p.length), 0.5, 2); }
    },
  },

  // Atrium: string quartet + harp — classical progressions, cello bass, inner voices, singing 1st violin.
  quartet: {
    gain: 1.9, bpm: 76, spb: 16, swing: 0.5, keys: [2, 7, 0, 9], modulate: true,
    progs: [[C(0, 'maj'), C(7, 'maj'), C(9, 'min'), C(4, 'min'), C(5, 'maj'), C(0, 'maj'), C(5, 'maj'), C(7, 'maj')],
            [C(0, 'maj'), C(5, 'maj'), C(7, 'maj'), C(0, 'maj')], [C(9, 'min'), C(2, 'min'), C(7, 'maj'), C(0, 'maj'), C(5, 'maj'), C(11, 'm7b5'), C(4, '7'), C(9, 'min')],
            [C(0, 'maj'), C(2, 'min'), C(4, 'min'), C(5, 'maj'), C(7, '7'), C(0, 'maj'), C(5, 'maj'), [C(7, 'sus'), C(7, 'maj')]]],
    init(b) { b.mel = new Melody(69, 86, 0.6); b.inner = null; },
    bar(b) { b.rh = b.mel.rhythm(16, b.bar); },
    step(b, s, t, ch) {
      const half = s % 8 === 0;
      if (half) {
        play(b, 'cello', 'strings', t, rootOf(b, ch, 36) + (s === 8 && chance(0.4) ? 7 : 0), 0.75, b.stepDur * 7.6, { attack: 0.08, release: 0.25, lvl: 0.075 });
        const p = pcs(ch, b.key);
        b.inner = voiceLead(p.slice(0, 2).concat(p.length > 2 ? [p[2]] : []).slice(-2), b.inner, 55, 69);
        b.inner.forEach((m, i) => play(b, i ? 'viola' : 'violin2', 'strings', t + rand(0, 0.02), m, 0.6, b.stepDur * 7.6, { attack: 0.12, release: 0.3, lvl: 0.045 }));
      }
      if (b.rh[s] && s % 2 === 0) {
        const m = b.mel.next(b.key, ch, s % 4 === 0, SCALE.maj);
        play(b, 'violin1', 'strings', t, m, s % 4 === 0 ? 0.8 : 0.65, b.stepDur * (s % 4 === 0 ? 3.6 : 1.8), { attack: 0.05, release: 0.2, lvl: 0.06 });
      }
      if (s % 2 === 0 && (b.section % 2 === 1 || s % 4 === 0)) { const p = pcs(ch, b.key).sort((a, c) => a - c); const k = [0, 1, 2, 3, 2, 1, 2, 3][(s / 2) % 8]; play(b, 'harp', 'harp', t, 60 + p[k % p.length] + (k >= p.length ? 12 : 0), 0.4, 2.5); }
    },
  },

  // Kids club: playful — glockenspiel/marimba tune, bouncy pizzicato bass, claps.
  kids: {
    gain: 2.3, bpm: 120, spb: 16, swing: 0.6, keys: [0, 7, 5],
    progs: [[C(0, 'maj'), C(5, 'maj'), C(7, 'maj'), C(0, 'maj')], [C(0, 'maj'), C(9, 'min'), C(5, 'maj'), C(7, 'maj')], [C(5, 'maj'), C(7, 'maj'), C(4, 'min'), C(9, 'min')]],
    init(b) { b.mel = new Melody(72, 91, 0.7); },
    bar(b) { b.rh = b.mel.rhythm(16, b.bar); },
    step(b, s, t, ch) {
      if (s % 4 === 0) play(b, 'bass', 'guitar', t, rootOf(b, ch, 40) + (s === 4 || s === 12 ? 7 : 0), 0.7, b.stepDur * 2, { muted: true });
      if (s % 4 === 2) comp(b, 'chords', 'marimba', t, ch, 60, 74, 0.5, 0.2, false);
      if (b.rh[s] && s % 2 === 0) play(b, 'lead', b.opts.arcade ? 'chip' : 'glock', t, b.mel.next(b.key, ch, s % 4 === 0, SCALE.maj), 0.65, b.stepDur * 2);
      if (s === 4 || s === 12) drum(b, 'perc', 'clap', t, 0.35);
      if (s === 0 || s === 8) drum(b, 'perc', 'kick', t, 0.45);
      if (s % 2 === 0) drum(b, 'perc', 'shaker', t, 0.35);
    },
  },

  // Soft background (shops, buffet, spa, dining): e-piano + pad, no drums.
  soft: {
    gain: 1.7, bpm: 72, spb: 16, swing: 0.5, keys: [5, 0, 7, 2], modulate: true,
    progs: [[C(0, 'maj7'), C(5, 'maj7'), C(9, 'm7'), C(7, 'sus')], [C(2, 'm7'), C(7, '9'), C(0, 'maj7'), C(5, 'maj7')], [C(0, 'add9'), C(4, 'm7'), C(5, 'maj7'), C(7, 'sus')]],
    init(b) { b.mel = new Melody(67, 84, 0.3); },
    bar(b) { b.rh = b.section % 2 ? b.mel.rhythm(16, b.bar) : null; },
    step(b, s, t, ch) {
      if (s === 0) { comp(b, 'keys', 'epiano', t, ch, 55, 72, 0.5, b.stepDur * 15); play(b, 'bass', 'epiano', t, rootOf(b, ch, 41), 0.5, b.stepDur * 15); }
      if (s === 0) comp(b, 'pad', 'strings', t, ch, 60, 76, 0.4, b.stepDur * 15.5, false);
      if (s === 10 && chance(0.5)) comp(b, 'keys', 'epiano', t, ch, 55, 72, 0.35, b.stepDur * 5);
      if (b.rh && b.rh[s] && s % 4 === 0) play(b, 'lead', 'epiano', t, b.mel.next(b.key, ch, true, SCALE.maj), 0.45, b.stepDur * 4);
    },
  },

  // Non-diegetic tension score: drone + pulse + percussion + high ostinato, layered by heat.
  tension: {
    bpm: 100, spb: 16, swing: 0.5, keys: [2],
    progs: [[C(0, 'min'), C(0, 'min'), C(8, 'maj'), C(7, 'maj')], [C(0, 'min'), C(1, 'maj'), C(0, 'min'), C(7, 'sus')]],
    step(b, s, t, ch) {
      const L = b.level; // 0..1
      if (s === 0 && b.bar % 2 === 0) {
        play(b, 'drone', 'strings', t, rootOf(b, ch, 38), 0.8, b.stepDur * 31, { ensemble: true, attack: 1.2, release: 1.5, lvl: 0.06 });
        play(b, 'drone', 'strings', t, rootOf(b, ch, 45), 0.6, b.stepDur * 31, { attack: 1.5, release: 1.5, lvl: 0.035 });
        if (L > 0.75) play(b, 'drone', 'brass', t, rootOf(b, ch, 50), 0.6, b.stepDur * 28, { attack: 1.5, lvl: 0.04, swell: true });
      }
      if (L > 0.25 && s % 2 === 0) play(b, 'pulse', 'synbass', t, rootOf(b, ch, 38) + (s % 8 === 6 ? 12 : 0), s % 4 === 0 ? 0.75 : 0.5, b.stepDur * 1.2);
      if (L > 0.5) {
        if (s === 0 || s === 10) drum(b, 'perc', 'tom', t, 0.8, { f: 70 });
        if (s === 6 || s === 14) drum(b, 'perc', 'tom', t, 0.5, { f: 95, d: 0.3 });
        if (s % 2 === 1) drum(b, 'perc', 'hat', t, 0.3);
      }
      if (L > 0.78 && s % 2 === 0) { const p = pcs(ch, b.key).sort((a, c) => a - c); play(b, 'ost', 'strings', t, 74 + p[(s / 2) % p.length], 0.6, b.stepDur * 1.4, { attack: 0.02, release: 0.08, lvl: 0.035 }); }
      if (L > 0.9 && s === 0 && b.bar % 4 === 0) drum(b, 'perc', 'timpani', t, 0.9, { m: 38 });
    },
  },
};
// fix club init (needs explicit routing) — replace the filter insertion with a self-contained version
STYLES.club.init = function (b) {
  const out = b.out; // band output (connected to destination already)
  const lp = filter(b.ctx, 'lowpass', 18000, 0.9, out);
  b.lp = lp;
  const pre = gain(b.ctx, 1, lp);
  b.part = function (name, pan = 0, vol = 1) {
    if (!this.parts[name]) { const p = panner2(this.ctx, pan, name === 'kick' ? out : pre); this.parts[name] = gain(this.ctx, vol, p); }
    return this.parts[name];
  };
};

// Map a room to a music style (or null). Venue-specific first, then room `dens`.
export function styleForRoom(r) {
  if (!r) return null;
  const v = r.venue, d = r.dens;
  switch (v) {
    case 'piano': return { style: 'jazz', opts: { tempoMul: 0.78 }, hours: [11, 26], name: 'piano' };
    case 'pub': return { style: 'folk', hours: [12, 25.5] };
    case 'club': return { style: 'club', hours: [20, 28], offLevel: 0.25 };
    case 'casino': case 'casino_hl': return { style: 'casino', hours: [0, 24] };
    case 'pool': case 'pool_aft': case 'wakebar': return { style: 'tropical', hours: [8, 21] };
    case 'theater': return { style: 'orchestral', shows: [[19.5, 20.5], [21.75, 22.75]] };
    case 'atrium': case 'lantern': return { style: 'quartet', hours: [10, 23] };
    case 'kids': return { style: 'kids', hours: [8, 21] };
    case 'arcade': return { style: 'kids', opts: { arcade: true }, hours: [8, 24] };
    case 'zenith': case 'cigar': case 'steak': return { style: 'jazz', opts: { tempoMul: 0.85, solo: v === 'steak' }, hours: [16, 26] };
    case 'dining': case 'grill': return { style: 'soft', hours: [7, 23] };
    case 'buffet': case 'spa': case 'solarium': return { style: 'soft', hours: [6, 23] };
    case 'comedy': case 'library': case 'gym': case 'sport': return null;
  }
  switch (d) {
    case 'bar': return { style: 'jazz', hours: [15, 26] };
    case 'club': return { style: 'club', hours: [20, 28] };
    case 'casino': return { style: 'casino', hours: [0, 24] };
    case 'pool': return { style: 'tropical', hours: [8, 21] };
    case 'theater': return { style: 'orchestral', shows: [[19.5, 20.5], [21.75, 22.75]] };
    case 'atrium': return r.type === 'atrium' ? { style: 'quartet', hours: [10, 23] } : null;
    case 'kids': return { style: 'kids', hours: [8, 21] };
    case 'shop': return { style: 'soft', hours: [9, 23], level: 0.45 };
    case 'crewbar': return { style: 'folk', hours: [18, 26], level: 0.6 };
  }
  return null;
}
export function venueActive(spec, hour) {
  if (!spec) return 0;
  const inR = (h, a, b) => (b > 24 ? (h >= a || h < b - 24) : (h >= a && h < b));
  if (spec.shows) return spec.shows.some(([a, b]) => inR(hour, a, b)) ? 1 : 0;
  if (spec.hours) return inR(hour, spec.hours[0], spec.hours[1]) ? (spec.level ?? 1) : (spec.offLevel ?? 0);
  return spec.level ?? 1;
}

// ── stings ─────────────────────────────────────────────────────────────────
export function sting(lib, out, t, kind = 'success') {
  const o = gain(lib.ctx, 1, out);
  if (kind === 'success') {
    const ch = [62, 66, 69, 74];
    ch.forEach((m, i) => INST.brass(lib, o, t + i * 0.09, m, 0.8, 1.6 - i * 0.09, { lvl: 0.07, attack: 0.04, swell: true }));
    INST.brass(lib, o, t + 0.5, 78, 0.8, 1.4, { lvl: 0.05 });
    [50, 57, 62].forEach(m => INST.strings(lib, o, t, m, 0.8, 2.2, { ensemble: true, attack: 0.05, release: 0.9, lvl: 0.06 }));
    for (let k = 0; k < 6; k++) DRUM.timpani(lib, o, t + k * 0.05, 0.3 + k * 0.08, { m: 38 });
    DRUM.timpani(lib, o, t + 0.5, 0.9, { m: 38 });
    DRUM.cymbalSwell(lib, o, t, 0.6, 0.5);
    [74, 78, 81, 86].forEach((m, i) => INST.glock(lib, o, t + 0.5 + i * 0.07, m, 0.6));
    return 3;
  }
  // failure: dark descending cluster, low brass, tam-tam
  [[50, 49], [53, 52], [57, 55]].forEach(([a, b2], i) => { INST.strings(lib, o, t, a, 0.8, 0.9, { ensemble: true, attack: 0.03, release: 0.3, lvl: 0.06 }); INST.strings(lib, o, t + 0.9, b2 - (i === 2 ? 1 : 0), 0.7, 2.0, { ensemble: true, attack: 0.1, release: 1.2, lvl: 0.06 }); });
  INST.brass(lib, o, t + 0.9, 38, 0.8, 2.0, { lvl: 0.08, attack: 0.15 });
  DRUM.tamtam(lib, o, t + 0.9, 0.9);
  DRUM.timpani(lib, o, t, 0.8, { m: 38 }); DRUM.timpani(lib, o, t + 0.9, 0.9, { m: 37 });
  return 4;
}
