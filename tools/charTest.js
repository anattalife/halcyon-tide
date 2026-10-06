// Character lineup / animation test bed. URL params: view=lineup|walk|close|perf, cam=x,y,z,lx,ly,lz
import * as THREE from 'three';
import { Rng } from '../src/core/util.js';
import { CharacterRenderer, makeAppearance } from '../src/actors/characters.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') || 'lineup';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9aa4ad);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 300);
scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x6a6058, 1.1));
const sun = new THREE.DirectionalLight(0xfff2e0, 2.4); sun.position.set(6, 12, 9); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 8, bottom: -8, near: 1, far: 40 }); sun.shadow.bias = -0.0005;
scene.add(sun); scene.add(sun.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
// 1 m grid lines for stride checking
const grid = new THREE.GridHelper(40, 40, 0x666666, 0x8a8a8a); grid.position.y = 0.002; scene.add(grid);
const props = new THREE.MeshStandardMaterial({ color: 0x6d4c35, roughness: 0.7 });
const water = new THREE.MeshStandardMaterial({ color: 0x3a8fb0, roughness: 0.1, transparent: true, opacity: 0.55 });

const CR = new CharacterRenderer(scene, { max: 220, camera });
window.CR = CR;
const rng = new Rng(12345);
const list = [];
function addChar(opts, st, x, z) {
  const ap = makeAppearance(rng, opts);
  const id = CR.add(ap);
  CR.set(id, Object.assign({ x, y: 0, z, yaw: 0, anim: 'idle', interior: 0 }, st));
  list.push({ id, opts, st, x, z, ap });
  return id;
}
function box(w, h, d, x, y, z, m = props) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; scene.add(b); return b; }

if (view === 'lineup' || view === 'close') {
  const row1 = [
    [{ role: 'passenger', sex: 'm' }, { anim: 'idle' }], [{ role: 'passenger', sex: 'f' }, { anim: 'idle' }],
    [{ role: 'passenger', sex: 'f', dress: 'evening' }, { anim: 'talk' }], [{ role: 'passenger', sex: 'm', dress: 'evening' }, { anim: 'drink', held: 'drink' }],
    [{ role: 'passenger', sex: 'f', dress: 'swim' }, { anim: 'idle' }], [{ role: 'passenger', sex: 'm', dress: 'swim' }, { anim: 'wave' }],
    [{ role: 'child', sex: 'f' }, { anim: 'idle' }], [{ role: 'child', sex: 'm' }, { anim: 'cheer' }],
    [{ role: 'elderly', sex: 'm' }, { anim: 'idle' }], [{ role: 'elderly', sex: 'f' }, { anim: 'phone', held: 'phone' }],
    [{ role: 'crew_officer', sex: 'm' }, { anim: 'guard' }], [{ role: 'captain', sex: 'm' }, { anim: 'idle' }],
  ];
  const row2 = [
    [{ role: 'security', sex: 'm' }, { anim: 'aim_pistol', held: 'pistol', aim: 0.0 }], [{ role: 'security', sex: 'f' }, { anim: 'radio' }],
    [{ role: 'crew_steward', sex: 'm' }, { anim: 'carry_tray', held: 'tray' }], [{ role: 'crew_waiter', sex: 'f' }, { anim: 'idle' }],
    [{ role: 'crew_bartender', sex: 'm' }, { anim: 'wipe_bar' }], [{ role: 'crew_chef', sex: 'm' }, { anim: 'cook' }],
    [{ role: 'crew_deckhand', sex: 'm' }, { anim: 'sweep', held: 'mop' }], [{ role: 'crew_engineer', sex: 'm' }, { anim: 'idle', held: 'extinguisher' }],
    [{ role: 'crew_housekeeping', sex: 'f' }, { anim: 'idle' }], [{ role: 'croupier', sex: 'f' }, { anim: 'deal_cards' }],
    [{ role: 'medic', sex: 'f' }, { anim: 'idle' }], [{ role: 'lifeguard', sex: 'm' }, { anim: 'idle' }],
  ];
  row1.forEach((r, i) => addChar(r[0], r[1], (i - 5.5) * 0.85, 0));
  row2.forEach((r, i) => addChar(r[0], r[1], (i - 5.5) * 0.85, -2.2));
  // row 3: poses needing props
  const r3 = -4.6;
  box(0.45, 0.45, 0.45, -5.0, 0.225, r3 - 0.05); addChar({ role: 'passenger', sex: 'f' }, { anim: 'sit', y: 0.45 }, -5.0, r3);
  box(0.4, 0.75, 0.4, -4.0, 0.375, r3 - 0.05); addChar({ role: 'passenger', sex: 'm' }, { anim: 'sit_bar', y: 0.75 }, -4.0, r3);
  box(0.7, 0.35, 1.9, -2.6, 0.175, r3); addChar({ role: 'passenger', sex: 'f', dress: 'swim' }, { anim: 'lie', y: 0.35, yaw: Math.PI }, -2.6, r3 + 0.0);
  box(2.0, 0.6, 1.2, -0.6, -0.31, r3, water); addChar({ role: 'passenger', sex: 'm', dress: 'swim' }, { anim: 'swim', speed: 0.8, y: 0 }, -0.6, r3);
  addChar({ role: 'player', sex: 'm' }, { anim: 'walk', speed: 1.3 }, 1.0, r3);
  addChar({ role: 'passenger', sex: 'f' }, { anim: 'run', speed: 4 }, 2.0, r3);
  addChar({ role: 'entertainer', sex: 'f' }, { anim: 'dance' }, 3.0, r3);
  addChar({ role: 'passenger', sex: 'm' }, { anim: 'knocked_out' }, 4.3, r3);
  addChar({ role: 'passenger', sex: 'f' }, { anim: 'walk', speed: 1.3, held: 'luggage' }, 5.6, r3);
  if (q.get('int')) { scene.children.forEach(o => { if (o.isLight) o.intensity *= 0.05; }); for (const l of list) CR.set(l.id, { interior: +q.get('int') }); }
  const pos = q.get('cam');
  if (pos) { const v = pos.split(',').map(Number); camera.position.set(v[0], v[1], v[2]); camera.lookAt(v[3], v[4], v[5]); }
  else if (view === 'close') { camera.position.set(-2.4, 1.5, 3.2); camera.lookAt(-2.4, 1.1, 0); }
  else { camera.position.set(0, 3.3, 9.5); camera.lookAt(0, 0.7, -2.2); }
} else if (view === 'heads') {
  const roles = [['passenger','m'],['passenger','f'],['child','f'],['elderly','m'],['crew_officer','f'],['security','m'],['crew_chef','m'],['passenger','f']];
  roles.forEach((r, i) => addChar({ role: r[0], sex: r[1] }, { anim: 'idle' }, (i - 3.5) * 0.4, 0));
  for (const c of CR.chars) if (c) c.body.idleStyle = 0;
  camera.position.set(0, 1.55, 2.2); camera.lookAt(0, 1.45, 0);
} else if (view === 'crowd') {
  const dresses = ['casual', 'casual', 'casual', 'evening', 'swim'];
  const helds = ['none', 'none', 'none', 'phone', 'drink', 'camera', 'luggage'];
  for (let i = 0; i < 48; i++) {
    const role = i % 9 === 0 ? 'child' : i % 11 === 0 ? 'elderly' : 'passenger';
    const walk = i % 3 !== 0;
    const held = helds[i % helds.length];
    addChar({ role, dress: dresses[i % dresses.length] }, { anim: walk ? 'walk' : (i % 2 ? 'talk' : 'idle'), speed: walk ? 1.1 + (i % 5) * 0.1 : 0, yaw: (i * 2.3) % 6.28, held }, (i % 8 - 3.5) * 1.3 + (i % 3) * 0.2, -Math.floor(i / 8) * 1.4 + 1);
  }
  camera.position.set(0, 3.0, 7.5); camera.lookAt(0, 0.8, -2.5);
} else if (view === 'walk') {
  // side view of locomotion: walk, run, sprint, crouch_walk, and others (treadmill: x fixed)
  const anims = [['walk', 1.3], ['walk', 1.3], ['run', 4.0], ['sprint', 6.2], ['crouch_walk', 0.9], ['flee', 5]];
  anims.forEach((a, i) => addChar({ role: i % 2 ? 'passenger' : 'crew_officer', sex: i % 2 ? 'f' : 'm', dress: 'casual' }, { anim: a[0], speed: a[1], yaw: Math.PI / 2 }, (i - 2.5) * 1.3, 0));
  camera.position.set(0, 0.9, 9); camera.lookAt(0, 0.8, 0);
  const pos = q.get('cam'); if (pos) { const v = pos.split(',').map(Number); camera.position.set(v[0], v[1], v[2]); camera.lookAt(v[3], v[4], v[5]); }
} else if (view === 'anims') {
  const names = (q.get('list') || 'idle,talk,clap,punch,takedown,hit_react,stagger,fire_pistol,aim_taser,swing_baton,hands_up,cower,point,tread_water,slots,type,eat,sleep,dead,climb,crouch_idle,push_cart,drag,phone').split(',');
  names.forEach((n, i) => {
    const x = (i % 8 - 3.5) * 1.1, z = -Math.floor(i / 8) * 2.0;
    const seated = ['slots', 'type', 'eat'].includes(n);
    if (seated) box(0.45, 0.45, 0.45, x, 0.225, z - 0.05);
    if (n === 'sleep') box(0.9, 0.4, 2.0, x, 0.2, z);
    const held = { fire_pistol: 'pistol', aim_taser: 'taser', swing_baton: 'baton', phone: 'phone' }[n] || 'none';
    addChar({ role: i % 3 === 0 ? 'security' : 'passenger', sex: i % 2 ? 'f' : 'm' }, { anim: n, held, y: seated ? 0.45 : n === 'sleep' ? 0.4 : n === 'tread_water' ? 0 : 0, yaw: n === 'sleep' ? Math.PI : +(q.get('yaw') || 0), speed: n === 'drag' ? 0.8 : undefined }, x, z);
  });
  camera.position.set(0, 3.6, 8.5); camera.lookAt(0, 0.5, -2.0);
  const pos = q.get('cam'); if (pos) { const v = pos.split(',').map(Number); camera.position.set(v[0], v[1], v[2]); camera.lookAt(v[3], v[4], v[5]); }
} else if (view === 'perf') {
  for (let i = 0; i < 200; i++) {
    const roles = ['passenger', 'passenger', 'passenger', 'child', 'elderly', 'crew_steward', 'security', 'crew_waiter'];
    const anims = ['walk', 'idle', 'talk', 'run', 'sit', 'drink', 'walk', 'idle'];
    addChar({ role: roles[i % roles.length], dress: i % 5 === 0 ? 'evening' : 'casual' }, { anim: anims[i % anims.length], speed: anims[i % 8] === 'walk' ? 1.3 : anims[i % 8] === 'run' ? 4 : 0 , yaw: i }, (i % 20 - 10) * 1.0, -Math.floor(i / 20) * 1.5);
  }
  camera.position.set(0, 8, 14); camera.lookAt(0, 0, -6);
}

window.__bench = function (frames = 60) {
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) CR.update(1 / 60);
  return (performance.now() - t0) / frames;
};
window.__step = function (dt, n = 1) { for (let i = 0; i < n; i++) CR.update(dt); renderer.render(scene, camera); };
window.__render = () => renderer.render(scene, camera);
// set every walker's gait phase (0..1) for cycle captures
window.__phase = function (p) { for (const c of CR.chars) if (c) { c.phase = p; c.fadeT = 1; } CR.update(0.0001); for (const c of CR.chars) if (c) c.phase = p; CR.update(0); renderer.render(scene, camera); };
const info = document.getElementById('info');
let last = performance.now(), frames = 0;
function loop() {
  if (window.__stop) { window.__ready = true; return; }
  const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  CR.update(dt); renderer.render(scene, camera);
  frames++;
  if (frames % 10 === 0) info.textContent = `chars ${CR.count}  update ${CR.stats.ms.toFixed(2)} ms  visible ${CR.stats.visible}`;
  window.__frames = frames;
  requestAnimationFrame(loop);
}
loop();
window.__atlas = () => CR.face.image.toDataURL();
