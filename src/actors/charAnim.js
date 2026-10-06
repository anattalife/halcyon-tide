// Procedural pose library for characters. A pose is a Float32Array of joint parameters (see indices
// below) expressed in the character's reference frame (metres of a reference 1.75 m body; +Z forward,
// +X = character's left). Locomotion uses foot-trajectory + 2-bone IK so planted feet never slide.

export const PX = 0, PY = 1, PZ = 2, RP = 3, RY = 4, RR = 5, SPX = 6, SPY = 7, SPZ = 8, CHX = 9, CHY = 10, CHZ = 11,
  NKX = 12, NKY = 13, NKZ = 14, HDX = 15, HDY = 16, HDZ = 17, AL = 18, AR = 26, LL = 34, LR = 39, FISTL = 44, FISTR = 45, SKSIT = 46, POSE_N = 48;
// arm block: +0 clavUp +1 clavFwd +2 flex +3 abd +4 twist +5 elbow +6 wristPitch +7 wristRoll
// leg block: +0 flex +1 abd +2 twist +3 knee +4 ankle

const TAU = Math.PI * 2, PI = Math.PI;
const sin = Math.sin, cos = Math.cos, abs = Math.abs, sqrt = Math.sqrt, atan2 = Math.atan2, acos = Math.acos;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);

export const ANIMS = ['idle', 'walk', 'run', 'sprint', 'crouch_idle', 'crouch_walk', 'sit', 'sit_bar', 'lie', 'sleep', 'talk', 'phone',
  'drink', 'eat', 'dance', 'clap', 'cheer', 'wave', 'swim', 'tread_water', 'slots', 'deal_cards', 'wipe_bar', 'cook', 'type', 'carry_tray',
  'push_cart', 'sweep', 'guard', 'radio', 'point', 'hands_up', 'cower', 'flee', 'punch', 'takedown', 'knocked_out', 'hit_react', 'stagger',
  'aim_pistol', 'fire_pistol', 'aim_taser', 'swing_baton', 'drag', 'climb', 'dead'];

// default speeds (m/s) when state.speed is not given
export const DEFAULT_SPEED = { walk: 1.3, run: 4.0, sprint: 6.2, crouch_walk: 0.9, flee: 5.0, drag: 0.8, stagger: 0.6, swim: 0.9, climb: 0.5, push_cart: 1.0 };
export const LOCO_ANIMS = new Set(['walk', 'run', 'sprint', 'crouch_walk', 'flee', 'drag', 'stagger']);
// upper-body anims that may be played while walking (legs come from the walk cycle)
export const UPPER_ANIMS = new Set(['talk', 'phone', 'drink', 'carry_tray', 'push_cart', 'radio', 'point', 'wave', 'aim_pistol', 'fire_pistol',
  'aim_taser', 'swing_baton', 'hands_up', 'clap', 'cheer', 'sweep', 'guard', 'idle']);
// anims in which the right hand is free to hold the carried prop in a default grip
export const HOLD_OK = new Set(['idle', 'walk', 'run', 'sprint', 'crouch_idle', 'crouch_walk', 'sit', 'sit_bar', 'talk', 'stagger', 'guard', 'flee', 'drag', 'lie', 'cheer']);

// Step length (m, one step = half a gait cycle) for a ground speed (m/s), for a 1.75 m body.
export function stepLength(v) {
  if (v < 1.3) return 0.42 + 0.215 * v;          // 0.7 m at 1.3 m/s
  if (v < 4.0) return 0.7 + (v - 1.3) * 0.333;   // 1.6 m at 4 m/s
  return Math.min(2.15, 1.6 + (v - 4.0) * 0.25);
}

const LOCO = {
  walk: { beta: 0.6, lift: 0.07, bob: 0.0, lean: 0.035, sway: 0.022, yaw: 0.11, roll: 0.05, arm: 0.34, elb: 0.22, elbA: 0.28, heel: 1, toe: 0.55, crouch: 0.0, run: 0 },
  run: { beta: 0.34, lift: 0.2, bob: 0.03, lean: 0.14, sway: 0.01, yaw: 0.15, roll: 0.035, arm: 0.65, elb: 1.4, elbA: 0.2, heel: 0, toe: 0.7, crouch: 0.025, run: 1 },
  sprint: { beta: 0.28, lift: 0.28, bob: 0.035, lean: 0.25, sway: 0.008, yaw: 0.19, roll: 0.03, arm: 0.95, elb: 1.45, elbA: 0.25, heel: 0, toe: 0.8, crouch: 0.03, run: 1 },
  crouch_walk: { beta: 0.66, lift: 0.07, bob: 0.0, lean: 0.55, sway: 0.03, yaw: 0.08, roll: 0.04, arm: 0.18, elb: 1.0, elbA: 0.1, heel: 0.6, toe: 0.4, crouch: 0.3, run: 0 },
};

function zero(P) { P.fill(0); }

// ---- helpers ----
function arm(P, base, flex, abd, elbow, twist = 0, wp = 0, wr = 0, cu = 0, cf = 0) {
  P[base] = cu; P[base + 1] = cf; P[base + 2] = flex; P[base + 3] = abd; P[base + 4] = twist; P[base + 5] = elbow; P[base + 6] = wp; P[base + 7] = wr;
}
function leg(P, base, flex, abd, knee, ankle = 0, twist = 0) { P[base] = flex; P[base + 1] = abd; P[base + 2] = twist; P[base + 3] = knee; P[base + 4] = ankle; }

// Rotation of a vector by the root (pelvis) orientation inverse: R = Ry(ry)·Rx(rp)·Rz(rr); returns R^T·v
const _v = [0, 0, 0];
function invRoot(P, x, y, z) {
  const cy = cos(P[RY]), sy = sin(P[RY]), cx = cos(P[RP]), sx = sin(P[RP]), cz = cos(P[RR]), sz = sin(P[RR]);
  // Ry^T
  let x1 = cy * x - sy * z, z1 = sy * x + cy * z, y1 = y;
  // Rx^T
  let y2 = cx * y1 + sx * z1, z2 = -sx * y1 + cx * z1;
  // Rz^T
  _v[0] = cz * x1 + sz * y2; _v[1] = -sz * x1 + cz * y2; _v[2] = z2;
  return _v;
}

// Two-bone leg IK. Target ankle (tx,ty,tz) in character frame; footPitch = desired world foot pitch (+ toes down).
export function legIK(P, ch, side, tx, ty, tz, footPitch = 0, twist = 0) {
  const s = side === 0 ? 1 : -1, base = side === 0 ? LL : LR;
  const d = invRoot(P, tx - P[PX], ty - P[PY], tz - P[PZ]);
  const dx = d[0] - s * ch.hipW, dy = d[1], dz = d[2];
  const a = ch.thighL, b = ch.shinL;
  const D = sqrt(dx * dx + dy * dy);
  const abd = atan2(s * dx, -dy);
  let L = sqrt(D * D + dz * dz);
  L = clamp(L, 0.12, (a + b) * 0.9995);
  const ft = atan2(dz, D);
  const ck = clamp((a * a + b * b - L * L) / (2 * a * b), -1, 1);
  const knee = PI - acos(ck);
  const al = acos(clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1));
  const flex = ft + al;
  P[base] = flex; P[base + 1] = abd; P[base + 2] = twist; P[base + 3] = knee;
  P[base + 4] = footPitch - P[RP] + flex - knee;
}
// max pelvis height so that an ankle at (dx,dy,dz) offset is reachable (pelvis upright)
function reachH(ch, ax, ay, az, side) {
  const s = side === 0 ? 1 : -1;
  const L = (ch.thighL + ch.shinL) * 0.985;
  const hx = ax - s * ch.hipW;
  const h2 = L * L - hx * hx - az * az;
  return ay + (h2 > 0 ? sqrt(h2) : 0);
}
function softmin3(a, b, c, k = 0.012) {
  const m = Math.min(a, b, c);
  return m - k * Math.log(Math.exp((m - a) / k) + Math.exp((m - b) / k) + Math.exp((m - c) / k));
}

function standFeet(P, ch, wL = 0, wR = 0, zL = 0, zR = 0, wide = 0) {
  const w = ch.hipW + 0.015 + wide;
  legIK(P, ch, 0, w + wL, ch.ankleH, zL, 0, -0.12);
  legIK(P, ch, 1, -w + wR, ch.ankleH, zR, 0, -0.12);
}
function base(P, ch) {
  zero(P);
  P[PY] = ch.hipStand - 0.008;
  P[SPX] = 0.02; P[CHX] = -0.02; P[NKX] = 0.04; P[HDX] = -0.02;
  const ab = 0.1 + 0.25 * Math.max(0, (ch.build || 1) - 1);
  arm(P, AL, 0.06, ab, 0.22, 0.25);
  arm(P, AR, 0.06, ab, 0.22, 0.25);
  if (ch.elderly) { P[SPX] += 0.1; P[CHX] += 0.1; P[NKX] += 0.12; P[HDX] -= 0.2; P[PY] -= 0.02; }
}

// ---- locomotion ----
function footTraj(out, u, beta, travel, sp, ch, run) {
  // returns ankle z, y (above floor) and foot pitch for a leg at cycle phase u ∈ [0,1)
  const aH = ch.ankleH, toeL = 0.14;
  const shift = run ? 0.05 : -0.05;          // stance window centred slightly behind the hips for walking
  if (u < beta) {
    const k = u / beta;
    const c = travel * (0.5 - k) + shift;    // planted contact point moves backward at ground speed
    let z = c, y = aH, p = 0;
    if (sp.heel > 0 && k < 0.18) {           // heel contact: toes up, rolling onto the foot
      const q = 1 - k / 0.18;
      p = -0.28 * q * sp.heel; z = c + 0.05 * q * sp.heel; y = aH + 0.005 * q;
    }
    const toeStart = run ? 0.45 : 0.62;
    if (k > toeStart) {                      // heel off: pivot on the toes
      const q = (k - toeStart) / (1 - toeStart);
      p = sp.toe * q * q;
      z = c + toeL - toeL * cos(p); y = aH + toeL * sin(p);
    }
    out[0] = z; out[1] = y; out[2] = p;
  } else {
    const k = (u - beta) / (1 - beta);
    const z0 = travel * -0.5 + shift + toeL - toeL * cos(sp.toe), y0 = aH + toeL * sin(sp.toe), p0 = sp.toe;
    const z1 = travel * 0.5 + shift + 0.05 * sp.heel, y1 = aH + 0.005, p1 = -0.28 * sp.heel;
    const ez = run ? sstep(Math.pow(k, 1.25)) : sstep(k) * 0.85 + k * 0.15;
    out[0] = lerp(z0, z1, ez);
    const lift = run ? sp.lift * sin(PI * Math.pow(k, 0.6)) : sp.lift * sin(PI * Math.pow(k, 0.75));
    out[1] = lerp(y0, y1, k) + lift;
    out[2] = lerp(p0, p1, sstep(k)) - (run ? 0.25 : 0.12) * sin(PI * k);
  }
  return out;
}
const _fa = [0, 0, 0], _fb = [0, 0, 0];

// ph = gait phase [0,1), step = step length in reference metres, dir = 1 forward / -1 backward
export function locomotion(P, ch, kind, ph, step, t, dir = 1) {
  const sp = LOCO[kind] || LOCO.walk;
  base(P, ch);
  const g = ch.gait;
  const run = sp.run;
  const travel = sp.beta * 2 * step;
  const phL = ph, phR = fract(ph + 0.5);
  footTraj(_fa, phL, sp.beta, travel, sp, ch, run);
  footTraj(_fb, phR, sp.beta, travel, sp, ch, run);
  if (dir < 0) { _fa[0] = -_fa[0]; _fb[0] = -_fb[0]; }
  const c2 = cos(TAU * ph), s2 = sin(TAU * ph);
  // pelvis
  const lean = sp.lean * (0.85 + 0.3 * g);
  P[RP] = lean * 0.45 * dir;
  P[RY] = -sp.yaw * c2 * dir;
  P[RR] = sp.roll * cos(TAU * (ph - sp.beta * 0.5));
  P[PX] = sp.sway * cos(TAU * (ph - sp.beta * 0.5));
  const w = ch.hipW + 0.005;
  const base0 = ch.hipStand - sp.crouch - 0.006;
  let py;
  if (run) {
    // lowest at mid-stance of each leg, highest in flight
    const st = Math.max(0, cos(TAU * 2 * (ph - sp.beta * 0.5)));
    py = base0 - sp.bob * st + sp.bob * 0.4 * (1 - st);
  } else {
    const hL = reachH(ch, w - P[PX], _fa[1], _fa[0], 0), hR = reachH(ch, -w - P[PX], _fb[1], _fb[0], 1);
    py = softmin3(hL, hR, base0, 0.012);
  }
  P[PY] = py;
  P[PZ] = 0;
  legIK(P, ch, 0, w, _fa[1], _fa[0], _fa[2], -0.08);
  legIK(P, ch, 1, -w, _fb[1], _fb[0], _fb[2], -0.08);
  // spine: counter-rotate shoulders against hips, keep head level
  P[SPX] = lean * 0.35 + 0.02; P[CHX] = lean * 0.25 - 0.02 + (run ? 0.02 * cos(TAU * 2 * ph) : 0);
  P[SPY] = sp.yaw * c2 * 0.9 * dir; P[CHY] = sp.yaw * c2 * 0.9 * dir;
  P[SPZ] = -P[RR] * 0.6; P[CHZ] = -P[RR] * 0.4;
  P[NKX] = -lean * 0.5 + 0.04; P[HDX] = -lean * 0.45 - 0.02 + (run ? 0 : 0.015 * cos(TAU * 2 * ph));
  P[NKY] = -P[SPY] * 0.4 - P[CHY] * 0.4 - P[RY] * 0.5; P[HDY] = 0;
  P[HDZ] = -P[RR] * 0.3;
  // arms opposite legs, slightly lagging
  const armA = sp.arm * (0.85 + 0.3 * ch.r[3]) * (dir < 0 ? 0.4 : 1);
  const ca = cos(TAU * (ph - 0.04));
  const fl = -armA * ca + (run ? 0.15 : 0.02), fr = armA * ca + (run ? 0.15 : 0.02);
  const eb = sp.elb;
  const abW = 0.12 + 0.25 * Math.max(0, (ch.build || 1) - 1) + (ch.female ? 0.02 : 0);
  arm(P, AL, fl, abW + (run ? 0.12 : 0), eb + sp.elbA * Math.max(0, fl) * 2, run ? 0.6 : 0.3, 0.05, 0, 0, run ? 0.2 * ca : 0);
  arm(P, AR, fr, abW + (run ? 0.12 : 0), eb + sp.elbA * Math.max(0, fr) * 2, run ? 0.6 : 0.3, 0.05, 0, 0, run ? -0.2 * ca : 0);
  if (run) { P[FISTL] = 1; P[FISTR] = 1; }
  if (ch.elderly) { P[SPX] += 0.1; P[CHX] += 0.08; P[NKX] += 0.1; P[HDX] -= 0.18; }
  void s2; void t;
}

// ---- static / gesture poses ----
// smooth pseudo-random hold-and-move signal: value changes to a new random target every ~period seconds
// with an ease, then holds (people glance, then look; shift weight, then stand)
function holdNoise(t, period, seed) {
  const u = t / period + seed * 7.13, i = Math.floor(u), f = u - i;
  const h = (n) => { const x = Math.sin((n + seed * 31.7) * 127.1) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  const e = sstep(clamp(f / 0.28, 0, 1));
  return h(i) + (h(i + 1) - h(i)) * e;
}
export function idle(P, ch, t) {
  base(P, ch);
  const r = ch.r, T = t * (0.85 + 0.3 * r[0]);
  // weight shift: hold on one leg for several seconds, then transfer (with a little overshoot settle)
  const per = 5.5 + 5 * r[1];
  const ws0 = holdNoise(T, per, r[2]);
  const wsh = Math.tanh(ws0 * 2.2) * (0.65 + 0.35 * r[4]);
  P[PX] = 0.034 * wsh;
  P[RR] = 0.06 * wsh; P[RY] = 0.05 * holdNoise(T, per * 1.3, r[0]);
  P[SPZ] = -0.045 * wsh; P[CHZ] = -0.02 * wsh; P[HDZ] = 0.025 * wsh;
  const br = sin(TAU * T / (3.6 + r[5]));
  P[CHX] = -0.025 + 0.014 * br; P[SPX] = 0.025 - 0.005 * br;
  P[PY] = ch.hipStand - 0.015 - 0.016 * abs(wsh);
  // gaze: glance targets held for a few seconds (neck takes part, head leads)
  const gy = holdNoise(T, 2.6 + 2.2 * r[6], r[7]), gp = holdNoise(T, 3.4 + 2 * r[3], r[1]);
  P[NKY] = 0.22 * gy; P[HDY] = 0.3 * gy + 0.04 * sin(T * 0.7 + r[2] * 6);
  P[HDX] = -0.02 + 0.07 * gp; P[NKX] += 0.03 * gp;
  P[SPY] = 0.05 * gy; P[CHY] = 0.06 * gy;
  const a = 0.02 * br;
  const style = ch.idleStyle;
  // occasional fidget: touch face / adjust clothing / check watch (every ~15–30 s, ~2 s)
  const fc = fract(T / (16 + 14 * r[8]) + r[9]);
  const fid = fc < 0.09 ? sin(PI * fc / 0.09) : 0;
  if (style === 1) { // hands clasped behind
    arm(P, AL, -0.35, 0.16, 1.0, 1.0); arm(P, AR, -0.35, 0.16, 1.0, 1.0);
  } else if (style === 2) { // hand on hip
    arm(P, AL, 0.05, 0.7, 1.7, 1.2, 0.2); arm(P, AR, 0.08 + a, 0.13, 0.28, 0.25);
  } else if (style === 3) { // hands loosely clasped in front
    armIK(P, ch, 0, 0.04, -0.34, 0.16, 1, -1, -0.6); armIK(P, ch, 1, -0.025, -0.35, 0.17, -1, -1, -0.6); P[FISTR] = 1;
  } else if (style === 4) { // arms folded
    armIK(P, ch, 0, -0.1, -0.06, 0.2, 1, -1.2, -0.2); armIK(P, ch, 1, 0.1, -0.03, 0.22, -1, -1.2, -0.2); P[AL + 7] = 0.6; P[AR + 7] = 0.6; P[FISTL] = P[FISTR] = 1;
  } else if (style === 5) { // hands in (front) pockets
    armIK(P, ch, 0, 0.17, -0.43, 0.09, 1, -0.2, -1); armIK(P, ch, 1, -0.17, -0.43, 0.09, -1, -0.2, -1); P[AL + 7] = 0.9; P[AR + 7] = 0.9; P[FISTL] = P[FISTR] = 1;
  } else {
    arm(P, AL, 0.06 + a + 0.05 * wsh, 0.11, 0.24 + 0.08 * r[1], 0.3, 0.05 * sin(T * 0.9));
    arm(P, AR, 0.06 + a - 0.05 * wsh, 0.11, 0.24 + 0.08 * r[2], 0.3, 0.05 * sin(T * 0.8 + 1));
    if (fid > 0.01) {
      const kind = Math.floor(fract(T / (16 + 14 * r[8]) * 0.37 + r[3]) * 3);
      if (kind === 0) armIK(P, ch, 1, lerp(-0.2, -0.04, fid), lerp(-0.4, 0.28, fid), lerp(0.05, 0.13, fid), -1, -1, -0.3);       // touch chin
      else if (kind === 1) { armIK(P, ch, 0, lerp(0.2, 0.0, fid), lerp(-0.4, -0.12, fid), lerp(0.05, 0.25, fid), 1, -1, -0.5); P[HDX] += 0.25 * fid; P[HDY] = lerp(P[HDY], 0.1, fid); } // look at watch
      else { armIK(P, ch, 1, lerp(-0.2, -0.13, fid), lerp(-0.4, -0.3, fid), lerp(0.05, 0.13, fid), -1, -1, -0.5); armIK(P, ch, 0, lerp(0.2, 0.13, fid), lerp(-0.4, -0.3, fid), lerp(0.05, 0.13, fid), 1, -1, -0.5); } // adjust top
    }
  }
  // weighted leg straight, other relaxed: knee bent a little, foot out & forward
  const fw = Math.max(0, -wsh), fe = Math.max(0, wsh);
  standFeet(P, ch, 0.03 * fw, -0.03 * fe, 0.07 * fw + 0.02, 0.07 * fe - 0.01, 0.01 * r[5]);
}

function crouchIdle(P, ch, t) {
  base(P, ch);
  const br = sin(t * 1.6 + ch.r[0] * 5);
  P[PY] = ch.hipStand * 0.6; P[PZ] = -0.08; P[RP] = 0.5;
  P[SPX] = 0.2; P[CHX] = 0.1 + 0.01 * br; P[NKX] = -0.3; P[HDX] = -0.25;
  P[NKY] = 0.3 * sin(t * 0.3 + ch.r[1] * 5);
  arm(P, AL, 0.55, 0.15, 0.9, 0.4); arm(P, AR, 0.65, 0.1, 1.1, 0.4);
  legIK(P, ch, 0, ch.hipW + 0.06, ch.ankleH, 0.14, 0.1, -0.2);
  legIK(P, ch, 1, -ch.hipW - 0.06, ch.ankleH + 0.04, -0.12, 0.6, -0.2);
}

// seated: char origin = seat surface. feetY = foot rest relative to seat
function seated(P, ch, t, feetY = -0.45, feetZ = 0.42, hands = true, cross = false) {
  base(P, ch);
  const r = ch.r;
  const br = sin(TAU * t / 4 + r[0] * 5);
  P[PY] = 0.1; P[PZ] = -0.06; P[RP] = -0.12;
  P[SPX] = 0.04 + 0.04 * r[6]; P[CHX] = 0.05 + 0.012 * br; P[NKX] = 0.05; P[HDX] = 0.0;
  const gy = holdNoise(t, 3 + 2 * r[1], r[7]);
  P[NKY] = 0.2 * gy; P[HDY] = 0.25 * gy; P[HDX] = 0.05 * holdNoise(t, 4, r[3]);
  P[SKSIT] = 1;
  const ff = feetY + ch.ankleH;
  const crossed = cross && r[2] > 0.62;   // legs crossed at the knee on low seats
  if (crossed) {
    legIK(P, ch, 0, ch.hipW + 0.035, ff, feetZ - 0.02, 0, -0.06);
    P[PX] = -0.012; P[RR] = -0.05; P[SPZ] = 0.06;
    legIK(P, ch, 1, ch.hipW * 0.55, ff + 0.2, feetZ + 0.07, 0.35, 0.15);   // right leg crossed over the left knee
  } else {
    const spread = ch.female ? 0.0 : 0.04 * r[4];
    legIK(P, ch, 0, ch.hipW + 0.03 + spread, ff, feetZ + 0.04 * r[2] - 0.02, 0, -0.06 - spread);
    legIK(P, ch, 1, -ch.hipW - 0.03 - spread, ff, feetZ - 0.05 * r[3] + 0.02, 0, -0.06 - spread);
  }
  if (!hands) return;
  // hands: resting on the thighs, in the lap (one over the other) or one on the armrest side
  const hv = r[5];
  if (hv > 0.66) { // in the lap, fingers relaxed and overlapping
    armIK(P, ch, 0, 0.03, -0.42, 0.24, 1, -0.6, -1); armIK(P, ch, 1, -0.02, -0.4, 0.25, -1, -0.6, -1);
    P[AL + 7] = 1.35; P[AR + 7] = 1.1; P[AL + 6] = 0.25; P[AR + 6] = 0.2;
  } else if (hv > 0.33) { // on the thighs near the knees
    armIK(P, ch, 0, 0.12, -0.42, 0.33, 1, -0.5, -1); armIK(P, ch, 1, -0.12, -0.42, 0.34, -1, -0.5, -1);
    P[AL + 7] = 1.25; P[AR + 7] = 1.25; P[AL + 6] = 0.35; P[AR + 6] = 0.35;
  } else { // one hand on the thigh, the other resting at the side of the seat
    armIK(P, ch, 0, 0.11, -0.42, 0.28, 1, -0.5, -1); P[AL + 7] = 1.25; P[AL + 6] = 0.3;
    armIK(P, ch, 1, -0.25, -0.47, 0.1, -1, 0, -1); P[AR + 7] = 0.4; P[AR + 6] = -0.4;
  }
  // tiny breathing / fidget motion of the hands
  P[AL + 5] += 0.03 * br; P[AR + 5] += 0.025 * sin(TAU * t / 5.3 + r[1] * 4);
}

function lie(P, ch, t, sleep) {
  base(P, ch);
  const br = sin(TAU * t / (sleep ? 5.5 : 4.2));
  P[RP] = -PI / 2; P[PY] = 0.11; P[PZ] = -0.02;
  P[SPX] = 0.0; P[CHX] = -0.02 - 0.015 * br; P[NKX] = 0.15; P[HDX] = 0.12;
  leg(P, LL, 0.04, 0.07, 0.06, 0.5, -0.4); leg(P, LR, 0.04, 0.07, 0.06, 0.5, -0.4);
  arm(P, AL, 0.08, 0.16, 0.25, 0.3); arm(P, AR, 0.08, 0.16, 0.25, 0.3);
  if (sleep) {
    P[HDY] = 0.55 * (ch.r[0] > 0.5 ? 1 : -1); P[NKY] = 0.2 * Math.sign(P[HDY]);
    arm(P, AL, 0.7, 0.05, 1.6, 0.9); leg(P, LR, 0.45, 0.12, 0.8, 0.4, -0.3);
  } else if (ch.r[1] > 0.55) { // hands behind head
    arm(P, AL, 2.6, 0.6, 2.4, 0.4); arm(P, AR, 2.6, 0.6, 2.4, 0.4); P[HDX] = 0.25;
  } else if (ch.r[1] > 0.3) {
    leg(P, LL, 0.6, 0.05, 1.2, 0.3, 0); // one knee up
  }
}

function prone(P, ch, t, dead) {
  base(P, ch);
  P[RP] = PI / 2; P[PY] = 0.105; P[PZ] = 0.0; P[RR] = dead ? 0.08 : 0.15;
  P[SPX] = 0.02; P[CHX] = -0.05; P[NKX] = -0.15; P[HDX] = -0.25; P[HDY] = 1.25; P[NKY] = 0.25; P[HDZ] = 0.1;
  arm(P, AL, dead ? 2.4 : 2.7, dead ? 0.7 : 0.45, dead ? 0.6 : 1.4, 0.3);
  arm(P, AR, dead ? 0.4 : 0.15, dead ? 0.6 : 0.25, 0.3, -0.9);
  leg(P, LL, dead ? 0.1 : 0.55, dead ? 0.2 : 0.35, dead ? 0.2 : 1.1, 0.9, -0.5);
  leg(P, LR, 0.0, 0.1, 0.1, 1.0, -0.3);
  if (!dead) { const br = sin(t * 1.4); P[CHX] += 0.01 * br; }
}

function talk(P, ch, t) {
  idle(P, ch, t * 0.8);
  const r = ch.r, T = t * (0.9 + 0.3 * r[5]);
  const g1 = sstep(0.5 + 0.8 * sin(T * 1.3 + r[0] * 5)), g2 = sstep(0.5 + 0.8 * sin(T * 0.9 + r[1] * 5 + 2));
  const b1 = sin(T * 5.5), b2 = sin(T * 4.3 + 1);
  arm(P, AR, 0.25 + 0.35 * g1 + 0.08 * b1 * g1, 0.15 + 0.15 * g1, 0.3 + 1.2 * g1 + 0.15 * b1 * g1, 0.5 * g1, 0, -0.6 * g1);
  arm(P, AL, 0.2 + 0.3 * g2 + 0.06 * b2 * g2, 0.12 + 0.12 * g2, 0.3 + 1.1 * g2 + 0.12 * b2 * g2, 0.5 * g2, 0, -0.5 * g2);
  P[HDX] += 0.06 * sin(T * 3.1) * (0.5 + 0.5 * g1);
  P[HDY] += 0.15 * sin(T * 0.7 + r[2] * 3);
  P[CHY] += 0.06 * (g1 - g2);
}

export function poseFor(P, name, ch, t, st, aT) {
  const r = ch.r;
  switch (name) {
    case 'idle': idle(P, ch, t); return;
    case 'crouch_idle': crouchIdle(P, ch, t); return;
    case 'sit': seated(P, ch, t, -0.45, 0.42, true, !ch.child && st.cross !== false); return;
    case 'sit_bar': {
      seated(P, ch, t, -0.5, 0.26);
      P[PY] = 0.1; armIK(P, ch, 0, 0.14, -0.2, 0.36, 1, -1, -0.5); armIK(P, ch, 1, -0.12, -0.18, 0.38, -1, -1, -0.5); P[AL + 7] = 1.3; P[AR + 7] = 1.3;
      return;
    }
    case 'eat': {
      seated(P, ch, t);
      P[CHX] += 0.12; P[HDX] += 0.1;
      const c = fract(t / 3.2 + r[0]); const up = sstep(c < 0.5 ? c * 4 - 0.6 : (1 - c) * 4 - 0.6);
      armIK(P, ch, 1, lerp(-0.14, -0.03, up), lerp(-0.12, 0.38, up), lerp(0.38, 0.17, up), -1, -1, -0.3);
      armIK(P, ch, 0, 0.16, -0.12, 0.36, 1, -1, -0.3);
      P[HDX] -= 0.12 * up; P[FISTR] = 1;
      return;
    }
    case 'type': {
      seated(P, ch, t);
      P[CHX] += 0.12; P[HDX] += 0.05; P[NKY] = 0.05 * sin(t * 0.4);
      const f = 0.04 * sin(t * 17), g = 0.04 * sin(t * 13 + 1);
      armIK(P, ch, 0, 0.14 + f, -0.13 + Math.abs(f) * 0.5, 0.4, 1, -1, -0.4); armIK(P, ch, 1, -0.14 + g, -0.13 + Math.abs(g) * 0.5, 0.4, -1, -1, -0.4);
      P[AL + 7] = 1.2; P[AR + 7] = 1.2; P[AL + 6] = 0.2; P[AR + 6] = 0.2;
      return;
    }
    case 'slots': {
      seated(P, ch, t, -0.5, 0.26);
      const c = fract(t / 2.6 + r[0]); const pull = c < 0.25 ? sstep(c * 4) : c < 0.4 ? 1 - sstep((c - 0.25) / 0.15) : 0;
      arm(P, AR, 1.2 - 0.6 * pull, 0.35, 0.6 + 0.9 * pull, 0.2, 0, 0); P[FISTR] = 1;
      armIK(P, ch, 0, 0.12, -0.18, 0.36, 1, -1, -0.5); P[AL + 7] = 1.3;
      P[CHX] += 0.08; P[HDX] = -0.05; P[CHY] = -0.08 * pull;
      return;
    }
    case 'lie': lie(P, ch, t, false); return;
    case 'sleep': lie(P, ch, t, true); return;
    case 'knocked_out': prone(P, ch, t, false); return;
    case 'dead': prone(P, ch, t, true); return;
    case 'talk': talk(P, ch, t); return;
    case 'phone': {
      idle(P, ch, t * 0.7);
      armIK(P, ch, 1, -0.095, 0.4, 0.04, -1, -1, 0); P[AR + 7] = -0.4;
      P[FISTR] = 1; P[HDZ] -= 0.12; P[HDY] += 0.15 * sin(t * 0.3);
      const g = sstep(0.5 + sin(t * 0.8 + r[0] * 4));
      arm(P, AL, 0.1 + 0.4 * g, 0.12, 0.3 + 1.0 * g, 0.4, 0, -0.4 * g);
      return;
    }
    case 'drink': {
      idle(P, ch, t * 0.8);
      const c = fract(t / 5 + r[0]); const up = c < 0.2 ? sstep(c / 0.08) * (1 - sstep((c - 0.14) / 0.06)) : 0;
      armIK(P, ch, 1, lerp(-0.18, -0.03, up), lerp(-0.08, 0.36, up), lerp(0.25, 0.16, up), -1, -1, -0.2); P[AR + 7] = lerp(0, -0.6, up);
      P[FISTR] = 1; P[HDX] -= 0.25 * up;
      return;
    }
    case 'dance': {
      const bpm = 118 + 12 * r[0], beat = t * bpm / 60;
      base(P, ch);
      const b = sin(PI * beat * 2), sw = sin(PI * beat), style = Math.floor(r[1] * 3);
      P[PY] = ch.hipStand - 0.06 - 0.035 * abs(sin(PI * beat));
      P[PX] = 0.06 * sw; P[RR] = 0.1 * sw; P[RY] = 0.15 * sin(PI * beat * 0.5 + r[2] * 3);
      P[SPZ] = -0.12 * sw; P[CHZ] = -0.06 * sw; P[HDZ] = 0.08 * sw; P[HDX] = 0.08 * b; P[CHX] = 0.03 * b;
      const sideStep = 0.12 * sw;
      legIK(P, ch, 0, ch.hipW + 0.06 + Math.max(0, sideStep), ch.ankleH + 0.04 * Math.max(0, -sw), 0.02, 0, -0.2);
      legIK(P, ch, 1, -ch.hipW - 0.06 + Math.min(0, sideStep), ch.ankleH + 0.04 * Math.max(0, sw), -0.02, 0, -0.2);
      if (style === 0) { arm(P, AL, 0.9 + 0.4 * sw, 0.3, 1.6 - 0.3 * b, 0.3); arm(P, AR, 0.9 - 0.4 * sw, 0.3, 1.6 + 0.3 * b, 0.3); P[FISTL] = P[FISTR] = 1; }
      else if (style === 1) { arm(P, AL, 2.6 + 0.3 * sw, 0.4, 0.5, 0.2); arm(P, AR, 2.6 - 0.3 * sw, 0.4, 0.5, 0.2); }
      else { arm(P, AL, 0.4 + 0.5 * Math.max(0, b), 0.5 + 0.3 * sw, 1.4, 0.8); arm(P, AR, 0.4 + 0.5 * Math.max(0, -b), 0.5 - 0.3 * sw, 1.4, 0.8); }
      return;
    }
    case 'clap': {
      idle(P, ch, t);
      const c = sin(TAU * t * 2.6);
      const hx = 0.015 + 0.05 * Math.max(0, c);
      armIK(P, ch, 0, hx, 0.03, 0.33, 1, -1, -0.2); armIK(P, ch, 1, -hx, 0.03, 0.33, -1, -1, -0.2);
      P[AL + 7] = -1.2; P[AR + 7] = -1.2;
      P[HDX] -= 0.05;
      return;
    }
    case 'cheer': {
      idle(P, ch, t);
      const c = sin(TAU * t * 1.6 + r[0] * 3), j = Math.max(0, c);
      P[PY] += 0.05 * j;
      arm(P, AL, 2.7 + 0.25 * c, 0.35, 0.35 + 0.4 * (1 - j), 0.1); arm(P, AR, 2.7 - 0.25 * c, 0.35, 0.35 + 0.4 * j, 0.1);
      P[FISTL] = P[FISTR] = 1; P[HDX] = -0.25; P[CHX] = -0.08;
      return;
    }
    case 'wave': {
      idle(P, ch, t);
      const w = sin(TAU * t * 1.8);
      armIK(P, ch, 1, -0.36 - 0.07 * w, 0.58, 0.08, -1, -1, 0.1); P[AR + 7] = -1.0; P[AR + 6] = 0.15 * w;
      P[HDZ] = -0.06;
      return;
    }
    case 'point': {
      idle(P, ch, t);
      arm(P, AR, 1.5 + (st.aim || 0), 0.05, 0.08, 0, 0.05); P[FISTR] = 1;
      P[CHY] = -0.15; P[HDY] = -0.1;
      return;
    }
    case 'guard': {
      idle(P, ch, t * 0.6);
      standFeet(P, ch, 0.05, -0.05, 0, 0);
      armIK(P, ch, 0, 0.03, -0.36, 0.14, 1, -1, -0.5); armIK(P, ch, 1, -0.015, -0.37, 0.15, -1, -1, -0.5); P[FISTR] = 1;
      P[CHX] = -0.05; P[SPX] = 0.0;
      return;
    }
    case 'radio': {
      idle(P, ch, t * 0.7);
      armIK(P, ch, 0, 0.11, 0.17, 0.13, 1, -1, 0); P[AL + 7] = -0.8;
      P[HDZ] = 0.18; P[HDX] = 0.12; P[HDY] = 0.25;
      return;
    }
    case 'hands_up': {
      idle(P, ch, t * 0.5);
      const tr = 0.03 * sin(t * 9);
      armIK(P, ch, 0, 0.33, 0.6 + tr, 0.02, 1, -1, 0.3); armIK(P, ch, 1, -0.33, 0.6 - tr, 0.02, -1, -1, 0.3);
      P[AL + 7] = -1.4; P[AR + 7] = -1.4;
      P[CHX] = -0.06; P[HDX] = -0.05;
      return;
    }
    case 'cower': {
      base(P, ch);
      const tr = 0.02 * sin(t * 13);
      P[PY] = ch.hipStand * 0.55; P[PZ] = -0.06; P[RP] = 0.55;
      P[SPX] = 0.35 + tr; P[CHX] = 0.35; P[NKX] = 0.35; P[HDX] = 0.3;
      legIK(P, ch, 0, ch.hipW + 0.04, ch.ankleH, 0.12, 0.2, -0.2);
      legIK(P, ch, 1, -ch.hipW - 0.04, ch.ankleH, 0.06, 0.3, -0.2);
      armIK(P, ch, 0, 0.07, 0.48 + tr, 0.16, 1, 0, 1); armIK(P, ch, 1, -0.07, 0.48 - tr, 0.16, -1, 0, 1);
      return;
    }
    case 'punch': {
      base(P, ch);
      const c = fract(t / 1.1 + r[0] * 0.3);
      const jab = c < 0.22 ? sin(PI * c / 0.22) : 0, cross = c > 0.45 && c < 0.72 ? sin(PI * (c - 0.45) / 0.27) : 0;
      P[PY] = ch.hipStand - 0.06; P[RY] = 0.35 - 0.45 * cross; P[SPY] = 0.1 - 0.2 * cross + 0.1 * jab; P[CHY] = 0.05 - 0.15 * cross;
      P[SPX] = 0.12; P[CHX] = 0.06; P[HDX] = 0.05; P[NKY] = -0.3 + 0.3 * cross; P[HDY] = -0.1;
      legIK(P, ch, 0, ch.hipW + 0.06, ch.ankleH, 0.2, 0, -0.3);
      legIK(P, ch, 1, -ch.hipW - 0.04, ch.ankleH + 0.02, -0.2, 0.2, -0.4);
      armIK(P, ch, 0, lerp(0.09, 0.02, jab), lerp(0.3, 0.33, jab), lerp(0.24, 0.62, jab), 1, -1, -0.3);
      armIK(P, ch, 1, lerp(-0.08, 0.0, cross), lerp(0.32, 0.34, cross), lerp(0.2, 0.63, cross), -1, -1, -0.3);
      P[AL + 7] = -1.3; P[AR + 7] = -1.3;
      P[FISTL] = P[FISTR] = 1;
      return;
    }
    case 'takedown': {
      base(P, ch);
      const s = 0.05 * sin(t * 7) + 0.03 * sin(t * 11);
      P[PY] = ch.hipStand - 0.08; P[RP] = -0.05; P[SPX] = 0.0 + s; P[CHX] = -0.1; P[HDX] = 0.2; P[HDY] = 0.3; P[RY] = s;
      legIK(P, ch, 0, ch.hipW + 0.08, ch.ankleH, 0.22, 0, -0.2);
      legIK(P, ch, 1, -ch.hipW - 0.06, ch.ankleH + 0.02, -0.25, 0.3, -0.3);
      armIK(P, ch, 1, 0.08, 0.1 + s * 0.3, 0.34, -1, -0.8, -0.2);
      armIK(P, ch, 0, -0.02, 0.2 - s * 0.3, 0.3, 1, -0.8, -0.2);
      P[FISTR] = 1;
      return;
    }
    case 'hit_react': {
      idle(P, ch, t);
      const k = Math.exp(-aT * 5) * (aT < 0.06 ? aT / 0.06 : 1), w = sin(Math.min(aT, 1.5) * 18) * Math.exp(-aT * 6);
      P[SPX] -= 0.25 * k; P[CHX] -= 0.2 * k; P[HDX] -= 0.4 * k + 0.1 * w; P[RP] -= 0.08 * k; P[PZ] -= 0.05 * k; P[HDY] += 0.3 * k;
      arm(P, AL, 0.3 + 0.8 * k, 0.3 + 0.4 * k, 0.4 + 1.2 * k, 0.4); arm(P, AR, 0.3 + 0.6 * k, 0.3 + 0.5 * k, 0.4 + 1.0 * k, 0.4);
      return;
    }
    case 'aim_pistol': case 'fire_pistol': case 'aim_taser': {
      base(P, ch);
      const aim = clamp(st.aim || 0, -1.2, 1.2);
      let rec = 0;
      if (name === 'fire_pistol') { const c = fract(t / 0.42); rec = Math.exp(-c * 14) * (c < 0.02 ? c / 0.02 : 1); }
      P[PY] = ch.hipStand - 0.03; P[RY] = 0.25; P[SPY] = -0.12; P[CHY] = -0.1; P[NKY] = -0.03; P[HDY] = 0;
      P[SPX] = 0.06; P[CHX] = 0.04 - aim * 0.25 - 0.05 * rec; P[NKX] = -aim * 0.3; P[HDX] = -aim * 0.35 + 0.02;
      legIK(P, ch, 0, ch.hipW + 0.07, ch.ankleH, 0.16, 0, -0.15);
      legIK(P, ch, 1, -ch.hipW - 0.07, ch.ankleH, -0.14, 0, -0.35);
      const aa = aim * 0.72 + 0.22 * rec, reach = 0.5 - 0.06 * rec;
      const hx = -0.045, hy = 0.2 + Math.sin(aa) * reach, hz = Math.cos(aa) * reach;
      armIK(P, ch, 1, hx, hy, hz, -1, -1, 0);
      armIK(P, ch, 0, hx + 0.035, hy - 0.035, hz - 0.03, 1, -1.2, -0.2);
      P[AR + 6] = -0.05 - aa * 0.1 - 0.5 * rec; P[AR + 7] = -0.1; P[AL + 7] = -1.0;
      P[FISTR] = 1; P[FISTL] = 1;
      return;
    }
    case 'swing_baton': {
      idle(P, ch, t);
      const c = fract(t / 0.95);
      const wind = c < 0.45 ? sstep(c / 0.45) : 1 - sstep((c - 0.45) / 0.15);
      P[CHY] = 0.3 * wind - 0.25 * (1 - wind); P[SPY] = 0.15 * wind - 0.1 * (1 - wind); P[SPX] = 0.05 + 0.12 * (1 - wind);
      arm(P, AR, 0.7 + 1.9 * wind, 0.35 * wind, 0.5 + 1.2 * wind, 0.2, 0.4 - 0.6 * wind); P[FISTR] = 1;
      arm(P, AL, 0.6, 0.1, 1.4, 0.6); P[FISTL] = 1;
      legIK(P, ch, 0, ch.hipW + 0.07, ch.ankleH, 0.18, 0, -0.15);
      legIK(P, ch, 1, -ch.hipW - 0.07, ch.ankleH, -0.14, 0, -0.35);
      return;
    }
    case 'swim': {
      base(P, ch);
      const c = fract(t * 0.75 + r[0]);
      // breaststroke: 0-.35 pull, .35-.55 recover, .55-1 glide/kick
      const pull = c < 0.35 ? sstep(c / 0.35) : 1 - sstep((c - 0.35) / 0.2);
      const kick = c > 0.35 && c < 0.6 ? sin(PI * (c - 0.35) / 0.25) : 0;
      P[RP] = 1.3 - 0.08 * pull; P[PY] = -0.22 + 0.04 * pull; P[PZ] = -0.35;
      P[SPX] = -0.08; P[CHX] = -0.15 - 0.12 * pull; P[NKX] = -0.55; P[HDX] = -0.45;
      const out = sin(PI * Math.min(1, c / 0.35));
      arm(P, AL, 2.8 - 1.4 * pull, 0.3 + 0.9 * out, 0.3 + 1.5 * pull, 0.4 + 0.6 * pull, 0, 0, 0.03);
      arm(P, AR, 2.8 - 1.4 * pull, 0.3 + 0.9 * out, 0.3 + 1.5 * pull, 0.4 + 0.6 * pull, 0, 0, 0.03);
      leg(P, LL, 0.15 + 0.7 * kick, 0.15 + 0.35 * kick, 0.2 + 1.6 * kick, 1.2 - 0.9 * kick, -0.4 * kick);
      leg(P, LR, 0.15 + 0.7 * kick, 0.15 + 0.35 * kick, 0.2 + 1.6 * kick, 1.2 - 0.9 * kick, -0.4 * kick);
      P[SKSIT] = 1;
      return;
    }
    case 'tread_water': {
      base(P, ch);
      const c = t * 1.6 + r[0] * 5;
      P[PY] = -0.6 * ch.k + 0.025 * sin(c * 2); P[RP] = 0.12; P[SPX] = 0.02; P[CHX] = -0.05; P[HDX] = -0.1;
      arm(P, AL, 0.6, 1.0 + 0.25 * sin(c * 2), 0.6, 0.2 + 0.6 * sin(c * 2)); arm(P, AR, 0.6, 1.0 + 0.25 * sin(c * 2 + 1), 0.6, 0.2 + 0.6 * sin(c * 2 + 1));
      leg(P, LL, 0.7 + 0.35 * sin(c), 0.35, 1.0 + 0.5 * sin(c + 1), 0.7, -0.3);
      leg(P, LR, 0.7 + 0.35 * sin(c + PI), 0.35, 1.0 + 0.5 * sin(c + PI + 1), 0.7, -0.3);
      P[SKSIT] = 1;
      return;
    }
    case 'deal_cards': {
      idle(P, ch, t * 0.5);
      standFeet(P, ch, 0.02, -0.02, 0, 0);
      const c = fract(t / 1.4 + r[0]); const fl = c < 0.3 ? sin(PI * c / 0.3) : 0;
      P[SPX] = 0.12; P[CHX] = 0.06; P[HDX] = 0.25; P[CHY] = -0.2 * fl;
      armIK(P, ch, 0, 0.1, -0.22, 0.36, 1, -1, -0.4); P[AL + 7] = 1.0;
      armIK(P, ch, 1, -0.05 - 0.3 * fl, -0.2 + 0.04 * fl, 0.36 + 0.15 * fl, -1, -1, -0.4); P[AR + 7] = 1.0;
      return;
    }
    case 'wipe_bar': {
      idle(P, ch, t * 0.5);
      standFeet(P, ch, 0.03, -0.03, 0, 0);
      const a = TAU * t * 0.9;
      P[SPX] = 0.18; P[CHX] = 0.1; P[HDX] = 0.2; P[CHY] = -0.08 * sin(a);
      armIK(P, ch, 1, -0.15 + 0.13 * sin(a), -0.25, 0.42 + 0.07 * cos(a), -1, -1, -0.3); P[AR + 7] = 1.4;
      armIK(P, ch, 0, 0.22, -0.26, 0.34, 1, -1, -0.3); P[AL + 7] = 1.4;
      return;
    }
    case 'cook': {
      idle(P, ch, t * 0.5);
      standFeet(P, ch, 0.03, -0.03, 0, 0);
      const a = TAU * t * 1.3;
      P[SPX] = 0.12; P[CHX] = 0.08; P[HDX] = 0.28; P[HDY] = 0.1 * sin(t * 0.5);
      armIK(P, ch, 1, -0.12 + 0.05 * sin(a), -0.2, 0.38 + 0.05 * cos(a), -1, -1, -0.3); P[FISTR] = 1;
      armIK(P, ch, 0, 0.17, -0.2 + 0.02 * sin(t * 2), 0.36, 1, -1, -0.3); P[FISTL] = 1;
      return;
    }
    case 'carry_tray': {
      idle(P, ch, t * 0.6);
      armIK(P, ch, 1, -0.2, -0.06, 0.3, -1, -1, -0.5); P[AR + 7] = 1.4; P[FISTR] = 0;
      return;
    }
    case 'push_cart': {
      idle(P, ch, t);
      P[SPX] = 0.16; P[CHX] = 0.06; P[HDX] = -0.12;
      armIK(P, ch, 0, 0.2, -0.22, 0.42, 1, -1, -0.5); armIK(P, ch, 1, -0.2, -0.22, 0.42, -1, -1, -0.5);
      P[FISTL] = P[FISTR] = 1;
      return;
    }
    case 'sweep': {
      idle(P, ch, t * 0.5);
      const a = sin(TAU * t * 0.7);
      P[SPX] = 0.18; P[CHX] = 0.08; P[HDX] = 0.25; P[CHY] = 0.2 * a; P[SPY] = 0.1 * a;
      armIK(P, ch, 1, -0.12 + 0.05 * a, -0.22, 0.26, -1, -1, -0.3); P[FISTR] = 1;
      armIK(P, ch, 0, -0.06 + 0.05 * a, 0.02, 0.32, 1, -1, -0.3); P[FISTL] = 1;
      return;
    }
    case 'climb': {
      base(P, ch);
      const c = t * 1.0;
      const a = sin(TAU * c), b = sin(TAU * c + PI);
      P[PZ] = -0.22; P[RP] = 0.08; P[SPX] = 0.05; P[CHX] = 0.0; P[HDX] = -0.35;
      P[PY] = ch.hipStand - 0.05 + 0.04 * abs(a);
      arm(P, AL, 2.6 + 0.35 * a, 0.25, 0.6 - 0.4 * a, 0.5); arm(P, AR, 2.6 + 0.35 * b, 0.25, 0.6 - 0.4 * b, 0.5);
      P[FISTL] = P[FISTR] = 1;
      leg(P, LL, 0.55 + 0.45 * b, 0.1, 0.8 + 0.7 * b, 0.0 - 0.3 * b); leg(P, LR, 0.55 + 0.45 * a, 0.1, 0.8 + 0.7 * a, 0.0 - 0.3 * a);
      return;
    }
    default: idle(P, ch, t); return;
  }
}

// Default right-arm grip for a held prop (applied over HOLD_OK anims with weight w)
export function holdOverlay(P, held, w, t, moving) {
  if (!held || held === 'none' || w <= 0) return;
  let f, ab, el, tw, wp = 0, wr = 0;
  switch (held) {
    case 'tray': f = 0.35; ab = 0.18; el = 1.5; tw = -0.25; wr = 0.25; break;
    case 'drink': f = 0.3; ab = 0.12; el = 1.4; tw = 0.6; break;
    case 'phone': f = 0.32; ab = 0.1; el = 1.6; tw = 0.9; wp = -0.3; break;
    case 'camera': f = 0.25; ab = 0.1; el = 1.2; tw = 0.6; break;
    case 'radio': f = 0.2; ab = 0.1; el = 1.0; tw = 0.6; break;
    case 'pistol': case 'taser': f = 0.25; ab = 0.05; el = 0.55; tw = 0.6; wp = 0.0; break;
    case 'baton': f = 0.1; ab = 0.1; el = 0.3; tw = 0.2; wp = 0.6; break;
    case 'luggage': f = -0.32; ab = 0.12; el = 0.05; tw = 0.0; wp = 0.0; break;
    case 'mop': f = 0.55; ab = 0.1; el = 1.05; tw = 0.6; break;
    case 'extinguisher': f = 0.02; ab = 0.16; el = 0.1; tw = 0.0; break;
    default: return;
  }
  const swing = moving ? 0.25 : 1; // keep a fraction of the walk swing on the arm
  const B = AR;
  P[B + 2] = lerp(P[B + 2], f + (P[B + 2] - 0.06) * (held === 'luggage' ? 0.1 : 0.15) * swing, w);
  P[B + 3] = lerp(P[B + 3], ab, w); P[B + 4] = lerp(P[B + 4], tw, w); P[B + 5] = lerp(P[B + 5], el, w);
  P[B + 6] = lerp(P[B + 6], wp, w); P[B + 7] = lerp(P[B + 7], wr, w);
  if (held !== 'tray') P[FISTR] = 1;
  if (held === 'mop') { P[AL + 2] = lerp(P[AL + 2], 0.85, w); P[AL + 3] = lerp(P[AL + 3], -0.15, w); P[AL + 5] = lerp(P[AL + 5], 1.25, w); P[AL + 4] = lerp(P[AL + 4], 0.8, w); P[FISTL] = 1; }
  void t;
}

// Legs/root from `src` replace those in `dst` with weight w (upper body walking overlay)
export function copyLower(dst, src, w) {
  for (const i of [PX, PY, PZ, RP, RY, RR]) dst[i] = lerp(dst[i], src[i], w);
  for (let i = LL; i < LR + 5; i++) dst[i] = lerp(dst[i], src[i], w);
  dst[SPY] = lerp(dst[SPY], dst[SPY] + src[SPY] * 0.5, w);
}

// Analytic two-bone arm IK. Target hand (wrist) position (tx,ty,tz) in the CHEST frame (metres; +X left,
// +Y up, +Z forward; origin at the chest joint). pole = preferred elbow direction (chest frame).
// Writes flex/abd/twist/elbow into the arm block; wrist angles kept.
export function armIK(P, ch, side, tx, ty, tz, px = 0, py = -1, pz = -0.3) {
  const s = side === 0 ? 1 : -1, B = side === 0 ? AL : AR;
  const ts = ch.ts, L1 = ch.L1, L2 = ch.L2, kk = ch.k || 1;
  tx *= kk; ty *= kk; tz *= kk;
  const sx = s * ch.shW, sy = 0.195 * ts + P[B] * 0.05, sz = -0.012;
  let dx = tx - sx, dy = ty - sy, dz = tz - sz;
  let L = Math.hypot(dx, dy, dz) || 1e-4;
  dx /= L; dy /= L; dz /= L;
  L = clamp(L, Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.999);
  const e = PI - acos(clamp((L1 * L1 + L2 * L2 - L * L) / (2 * L1 * L2), -1, 1));
  const al = acos(clamp((L1 * L1 + L * L - L2 * L2) / (2 * L1 * L), -1, 1));
  // pole orthogonalised against target direction
  let pd = px * dx + py * dy + pz * dz;
  let qx = px - pd * dx, qy = py - pd * dy, qz = pz - pd * dz;
  let ql = Math.hypot(qx, qy, qz);
  if (ql < 1e-4) { qx = 0; qy = -1; qz = 0; pd = -dy; qx -= pd * dx; qy -= pd * dy; qz -= pd * dz; ql = Math.hypot(qx, qy, qz) || 1; }
  qx /= ql; qy /= ql; qz /= ql;
  const ca = cos(al), sa = sin(al);
  const ux = ca * dx + sa * qx, uy = ca * dy + sa * qy, uz = ca * dz + sa * qz; // upper arm dir
  // forearm direction = (W - E)/L2
  const ex = ux * L1, ey = uy * L1, ez = uz * L1;
  let fx = dx * L - ex, fy = dy * L - ey, fz = dz * L - ez;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // bend direction (local +Z of the upper arm)
  const fu = fx * ux + fy * uy + fz * uz;
  let zx = fx - fu * ux, zy = fy - fu * uy, zz = fz - fu * uz;
  let zl = Math.hypot(zx, zy, zz);
  if (zl < 1e-3) { zx = -qx; zy = -qy; zz = -qz; zl = 1; }
  zx /= zl; zy /= zl; zz /= zl;
  // decompose R = Rx(-f)·Rz(c)·Ry(a): u = (sin c, -cos c cos f, cos c sin f)
  const c = Math.asin(clamp(ux, -1, 1));
  const f = atan2(uz, -uy);
  // R1 = Rx(-f)·Rz(c): columns x1, z1
  const cc = cos(c), sc = sin(c), cf = cos(-f), sf = sin(-f);
  const x1x = cc, x1y = sc * cf, x1z = sc * sf;
  const z1x = 0, z1y = -sf, z1z = cf;
  const a = atan2(zx * x1x + zy * x1y + zz * x1z, zx * z1x + zy * z1y + zz * z1z);
  P[B + 1] = 0; P[B + 2] = f; P[B + 3] = s * c; P[B + 4] = -s * a; P[B + 5] = e;
}
