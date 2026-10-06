// HALCYON TIDE — input: keyboard, mouse (pointer lock), wheel, gamepad → virtual actions.
//
// game.input API
//   down(code) / pressed(code) / released(code)    raw KeyboardEvent.code or 'Mouse0'..'Mouse4' / 'Pad:A' …
//   action(name) / actionPressed(name) / actionReleased(name)   virtual actions (see ACTIONS)
//   axis('moveX'|'moveY'|'lookX'|'lookY')            -1..1 (keyboard + left stick; look = right stick)
//   move()  → {x, y} normalised move vector (x = right, y = forward), magnitude ≤ 1
//   mouse  {dx, dy, wheel, buttons, x, y}            deltas accumulated since last frame
//   pointerLocked, everLocked, context ('play'|'ui'), setContext(ctx), requestLock(), releaseLock()
//   bind(action, codes[])                             remap
//   sensitivity (mouse), invertY, padSensitivity
//   _debugSet(code, down), _debugMouse(dx, dy), _debugClear()   deterministic test injection
// Edge flags are cleared in a late system (order 99) each frame.

export const ACTIONS = {
  MoveF: ['KeyW', 'ArrowUp'],
  MoveB: ['KeyS', 'ArrowDown'],
  MoveL: ['KeyA', 'ArrowLeft'],
  MoveR: ['KeyD', 'ArrowRight'],
  Sprint: ['ShiftLeft', 'ShiftRight', 'Pad:L3'],
  Crouch: ['KeyC', 'ControlLeft', 'Pad:B'],
  Jump: ['Space', 'Pad:A'],
  Interact: ['KeyE', 'Pad:X'],
  AltInteract: ['KeyF', 'Pad:Y'],
  Aim: ['Mouse2', 'Pad:LT'],
  Fire: ['Mouse0', 'Pad:RT'],
  Map: ['KeyM', 'Pad:Back'],
  Inventory: ['Tab', 'KeyI', 'Pad:DUp'],
  Phone: ['KeyJ', 'Pad:DDown'],
  Pause: ['Escape', 'KeyP', 'Pad:Start'],
  WalkToggle: ['CapsLock', 'AltLeft', 'Pad:DLeft'],
  CameraSwap: ['KeyV', 'Pad:R3'],
  ShoulderSwap: ['KeyQ', 'Pad:RB'],
};

// keys whose default browser behaviour must be suppressed while playing
const GAME_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight', 'ControlLeft',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyC', 'KeyQ', 'KeyV', 'KeyM', 'KeyI', 'KeyJ', 'KeyP', 'ShiftLeft', 'ShiftRight', 'Slash', 'F1']);

// standard gamepad mapping
const PAD_BTN = ['Pad:A', 'Pad:B', 'Pad:X', 'Pad:Y', 'Pad:LB', 'Pad:RB', 'Pad:LT', 'Pad:RT', 'Pad:Back', 'Pad:Start', 'Pad:L3', 'Pad:R3', 'Pad:DUp', 'Pad:DDown', 'Pad:DLeft', 'Pad:DRight'];
const DEAD = 0.16;
const dz = (v) => { const a = Math.abs(v); if (a < DEAD) return 0; return Math.sign(v) * (a - DEAD) / (1 - DEAD); };

export class Input {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: 0, x: 0, y: 0 };
    this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, connected: false, lt: 0, rt: 0 };
    this._padPrev = new Set();
    this.pointerLocked = false;
    this.everLocked = false;     // pointer lock was obtained at least once this session (UI hints)
    this.context = 'play';
    this.map = {}; for (const k in ACTIONS) this.map[k] = ACTIONS[k].slice();
    this.sensitivity = 1.0;
    this.padSensitivity = 1.0;
    this.invertY = false;
    this.lastDevice = 'kbm';
    this._debug = false;
    try {
      const s = JSON.parse(localStorage.getItem('ht.input') || '{}');
      if (s.sensitivity) this.sensitivity = s.sensitivity;
      if (s.invertY != null) this.invertY = s.invertY;
    } catch {}
    this._install();
  }

  saveSettings() { try { localStorage.setItem('ht.input', JSON.stringify({ sensitivity: this.sensitivity, invertY: this.invertY })); } catch {} }

  // ── raw ───────────────────────────────────────────────────────────────
  down(code) { return this.keys.has(code); }
  pressed(code) { return this._pressed.has(code); }
  released(code) { return this._released.has(code); }

  // ── actions ───────────────────────────────────────────────────────────
  bind(action, codes) { this.map[action] = codes.slice(); }
  _gate(action) {
    if (this.context === 'play') return true;
    // in UI context only meta actions work
    return action === 'Pause' || action === 'Map' || action === 'Inventory' || action === 'Phone';
  }
  action(a) { if (!this._gate(a)) return false; const c = this.map[a]; if (!c) return false; for (const k of c) if (this.keys.has(k)) return true; return false; }
  actionPressed(a) { if (!this._gate(a)) return false; const c = this.map[a]; if (!c) return false; for (const k of c) if (this._pressed.has(k)) return true; return false; }
  actionReleased(a) { if (!this._gate(a)) return false; const c = this.map[a]; if (!c) return false; for (const k of c) if (this._released.has(k)) return true; return false; }
  // key cap for display, e.g. keyLabel('Interact') → 'E'
  keyLabel(a) {
    const c = this.map[a]; if (!c) return '?';
    if (this.lastDevice === 'pad') { const p = c.find(k => k.startsWith('Pad:')); if (p) return p.slice(4); }
    const k = c.find(k => !k.startsWith('Pad:')) || c[0];
    return codeLabel(k);
  }

  axis(name) {
    if (this.context !== 'play') return 0;
    switch (name) {
      case 'moveX': return clamp1((this.action('MoveR') ? 1 : 0) - (this.action('MoveL') ? 1 : 0) + this.pad.lx);
      case 'moveY': return clamp1((this.action('MoveF') ? 1 : 0) - (this.action('MoveB') ? 1 : 0) - this.pad.ly);
      case 'lookX': return this.pad.rx;
      case 'lookY': return this.pad.ry * (this.invertY ? -1 : 1);
    }
    return 0;
  }
  move() {
    let x = this.axis('moveX'), y = this.axis('moveY');
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y, mag: Math.min(1, l) };
  }

  setContext(ctx) {
    this.context = ctx;
    if (ctx === 'ui') { this.releaseLock(); this.keys.clear(); }
    this.game.bus?.emit('input:context', ctx);
  }
  requestLock() {
    const el = this.game.renderer?.domElement;
    if (!el || this.context !== 'play' || this._debug) return;
    try { const p = el.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { el.requestPointerLock(); } catch {} }); } catch { try { el.requestPointerLock(); } catch {} }
  }
  releaseLock() { if (document.pointerLockElement) try { document.exitPointerLock(); } catch {} }

  // ── test injection ───────────────────────────────────────────────────
  _debugSet(code, isDown) {
    this._debug = true;
    if (isDown) { if (!this.keys.has(code)) this._pressed.add(code); this.keys.add(code); }
    else { if (this.keys.has(code)) this._released.add(code); this.keys.delete(code); }
  }
  _debugMouse(dx, dy) { this._debug = true; this.mouse.dx += dx; this.mouse.dy += dy; }
  _debugClear() { for (const k of this.keys) this._released.add(k); this.keys.clear(); }

  // ── per-frame ────────────────────────────────────────────────────────
  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
    this.pad.connected = !!gp;
    if (!gp) { this.pad.lx = this.pad.ly = this.pad.rx = this.pad.ry = 0; return; }
    const ax = gp.axes;
    this.pad.lx = dz(ax[0] || 0); this.pad.ly = dz(ax[1] || 0);
    this.pad.rx = dz(ax[2] || 0); this.pad.ry = dz(ax[3] || 0);
    const now = new Set();
    gp.buttons.forEach((b, i) => { const v = typeof b === 'object' ? b.value : b; if ((b.pressed || v > 0.5) && PAD_BTN[i]) now.add(PAD_BTN[i]); });
    this.pad.lt = gp.buttons[6]?.value || 0; this.pad.rt = gp.buttons[7]?.value || 0;
    for (const k of now) if (!this._padPrev.has(k)) { this._pressed.add(k); this.keys.add(k); }
    for (const k of this._padPrev) if (!now.has(k)) { this._released.add(k); this.keys.delete(k); }
    if (now.size || this.pad.lx || this.pad.ly || this.pad.rx || this.pad.ry) this.lastDevice = 'pad';
    this._padPrev = now;
  }
  endFrame() {
    this._pressed.clear(); this._released.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  _install() {
    const g = this.game;
    const canvas = g.renderer?.domElement;
    const isTyping = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.lastDevice = 'kbm';
      if (this.context === 'play' && (GAME_KEYS.has(e.code) || e.code.startsWith('F') && e.code.length <= 3 && e.code !== 'F5' && e.code !== 'F12' && e.code !== 'F11')) e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      if (!this.keys.has(e.code)) this._pressed.add(e.code);
      this.keys.add(e.code);
    }, { capture: true });
    window.addEventListener('keyup', (e) => {
      if (this.keys.has(e.code)) this._released.add(e.code);
      this.keys.delete(e.code);
      if (this.context === 'play' && GAME_KEYS.has(e.code)) e.preventDefault();
    }, { capture: true });
    window.addEventListener('blur', () => { for (const k of this.keys) this._released.add(k); this.keys.clear(); this.mouse.buttons = 0; });
    const mcode = (b) => 'Mouse' + b;
    window.addEventListener('mousedown', (e) => {
      this.lastDevice = 'kbm';
      if (e.target !== canvas && !this.pointerLocked) return;   // clicks on UI elements are not game input
      if (!this.pointerLocked && this.context === 'play' && e.button === 0) { this.requestLock(); return; }
      const c = mcode(e.button);
      if (!this.keys.has(c)) this._pressed.add(c);
      this.keys.add(c); this.mouse.buttons = e.buttons;
    });
    window.addEventListener('mouseup', (e) => {
      const c = mcode(e.button);
      if (this.keys.has(c)) this._released.add(c);
      this.keys.delete(c); this.mouse.buttons = e.buttons;
    });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.pointerLocked) {
        // clamp pathological spikes some browsers produce on lock
        const mx = Math.max(-300, Math.min(300, e.movementX || 0)), my = Math.max(-300, Math.min(300, e.movementY || 0));
        this.mouse.dx += mx; this.mouse.dy += my;
        this.lastDevice = 'kbm';
      }
    });
    window.addEventListener('wheel', (e) => { if (this.context === 'play' && (this.pointerLocked || e.target === canvas)) { this.mouse.wheel += Math.sign(e.deltaY); } }, { passive: true });
    window.addEventListener('contextmenu', (e) => { if (e.target === canvas || this.pointerLocked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      const was = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === canvas;
      if (this.pointerLocked) this.everLocked = true;
      if (was && !this.pointerLocked) {
        // Esc released the lock: browsers swallow the Escape keydown, so synthesise Pause
        if (this.context === 'play') { this._pressed.add('Escape'); this._released.add('Escape'); }
        for (const k of [...this.keys]) if (k.startsWith('Mouse')) { this.keys.delete(k); this._released.add(k); }
      }
      g.bus?.emit('input:lock', this.pointerLocked);
    });
    window.addEventListener('gamepadconnected', () => { this.lastDevice = 'pad'; g.bus?.emit('input:pad', true); });
    window.addEventListener('gamepaddisconnected', () => g.bus?.emit('input:pad', false));
  }
}

function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

const LABELS = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', Escape: 'Esc', Tab: 'Tab', CapsLock: 'Caps',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter' };
export function codeLabel(code) {
  if (LABELS[code]) return LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Pad:')) return code.slice(4);
  return code;
}
// map an interaction's key letter ('E','F','G','Q','R') to a KeyboardEvent.code
export function letterCode(k) { return k && k.length === 1 ? 'Key' + k.toUpperCase() : (k || 'KeyE'); }

export function installInput(game) {
  const input = game.input = new Input(game);
  game.addSystem({ name: 'input', order: 0, runWhilePaused: true, update() { input._pollPad(); } });
  game.addSystem({ name: 'inputEnd', order: 99, runWhilePaused: true, lateUpdate() { input.endFrame(); } });
  return input;
}
