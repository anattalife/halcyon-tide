// Behaviour tests for doors / elevators / lights. Run: PORT=8772 python3 tools/sysTest.py tools/sysTest.js 'skip=installFurniture,installNPCs'
const R = { ok: [], fail: [], info: {} };
const check = (name, cond, extra) => { (cond ? R.ok : R.fail).push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); };
const W = game.world, D = game.doors, E = game.elevators, P = game.player;
const step = (n, dt = 1 / 30) => { for (let k = 0; k < n; k++) for (const s of game.systems) { if (s.name === 'player' || s.name === 'playerRender' || s.name === 'cameraRig' || s.name === 'chars') continue; try { s.update && s.update(dt, dt); } catch (e) { R.fail.push('sys ' + s.name + ': ' + e); } } };
const events = []; for (const ev of ['door:move', 'elevator:arrive', 'elevator:move', 'sfx']) game.bus.on(ev, (d) => events.push([ev, JSON.stringify(d).slice(0, 80)]));
check('doors installed', !!D); check('elevators installed', !!E); check('lights installed', !!game.lights);
R.info.doorRecords = D.records.length; R.info.cars = E.cars.length;

// ── cabin door access ─────────────────────────────────────────────────
const plan9 = W.plans[9];
const cab = plan9.doors.find(d => d.type === 'cabin' && d.x > 25 && d.x < 40 && d.z > 0);
const st = W.door(9, cab.id);
const corridorPt = { x: cab.x, z: cab.z + (st.inside === plan9.roomAt(cab.x, cab.z + 0.3)?.id ? -0.8 : 0.8) };
const stranger = { x: corridorPt.x, z: corridorPt.z, deck: 9, access: new Set(), keycards: new Set() };
check('cabin locked by default', D.isLocked(9, cab.id));
check('stranger denied cabin', D.request(9, cab.id, stranger) === false);
check('reason text', /Stateroom/.test(D.reasonFor(stranger, st)), D.reasonFor(stranger, st));
const guest = { ...stranger, keycards: new Set([cab.access]) };
check('keyholder opens', D.request(9, cab.id, guest) === true);
step(40);
check('door fully open', st.open > 0.99, st.open);
check('collision passable', !W.doorBlocks(9, cab.id));
step(30 * 5);
check('auto-closed after ~3.5 s', st.open < 0.01, st.open);
const steward = { ...stranger, access: new Set(['crew', 'master']) };
check('steward master key', D.canPass(steward, st));
// occupancy: actor standing in doorway keeps it open
D.request(9, cab.id, guest); step(40);
const ox = P.x, oz = P.z, od = P.deck;
P.x = cab.x; P.z = cab.z; P.deck = 9;
step(30 * 6);
check('stays open while player in doorway', st.open > 0.9, st.open);
P.x = corridorPt.x; P.z = corridorPt.z + (corridorPt.z > cab.z ? 1.5 : -1.5);
step(30 * 6);
check('closes after player leaves', st.open < 0.05, st.open);
// egress: inside the cabin anyone may open
const inside = W.plans[9].rooms[st.inside];
check('free egress from inside', D.canPass({ x: inside.cx, z: inside.cz, deck: 9, access: new Set() }, st));
// lockpick
check('pick unlocks', D.unlockWith(9, cab.id, 'pick', stranger) && !D.isLocked(9, cab.id));
D.lock(9, cab.id, true);

// ── crew door + disguise ──────────────────────────────────────────────
const crewD = plan9.doors.find(d => d.type === 'crew' && d.access === 'crew' && !d.locked) || plan9.doors.find(d => d.type === 'crew' && d.access === 'crew');
const cst = W.door(9, crewD.id);
const outRoom = cst.inside === crewD.rooms[0] ? crewD.rooms[1] : crewD.rooms[0];
const outR = plan9.rooms[outRoom];
const pax = { x: crewD.x, z: crewD.z, deck: 9, access: new Set() };
// place pax in the outer room near door
const nrm = crewD.normal;
for (const s of [0.5, -0.5]) { const x = nrm === 'x' ? crewD.x + s : crewD.x, z = nrm === 'z' ? crewD.z + s : crewD.z; if (W.roomId(9, x, z) === outRoom) { pax.x = x; pax.z = z; } }
check('passenger denied crew door', !D.canPass(pax, cst), D.reasonFor(pax, cst));
check('crew NPC passes', D.canPass({ ...pax, access: new Set(['crew']) }, cst));
check('disguised player passes', D.canPass({ ...pax, disguise: 'crew_steward' }, cst));
check('security disguise passes crew', D.canPass({ ...pax, disguise: 'security' }, cst));
check('crew keycard passes', D.canPass({ ...pax, keycards: new Set(['crew']) }, cst));
// sealed overrides
D.lock(9, crewD.id, 'sealed'); check('sealed blocks crew', !D.canPass({ ...pax, access: new Set(['crew']) }, cst)); D.lock(9, crewD.id, true);

// ── glass door auto-open ──────────────────────────────────────────────
const plan5 = W.plans[5];
const gd = plan5.doors.find(d => d.type === 'glass' && d.x === 52);
const gst = W.door(5, gd.id);
P.deck = 5; P.x = gd.x - 1.4; P.z = gd.z;
step(30);
check('glass opens for approaching player', gst.open > 0.9, gst.open);
P.x = gd.x - 6; step(30 * 4);
check('glass closes after leaving', gst.open < 0.05, gst.open);

// ── swing door swings away ─────────────────────────────────────────────
let sw = null, swd = 0;
for (let d = 3; d <= 6 && !sw; d++) { sw = W.plans[d].doors.find(x => x.type === 'swing' && x.access === 'none'); swd = d; }
if (sw) { const s = W.door(swd, sw.id); const a = { x: sw.normal === 'x' ? sw.x - 0.8 : sw.x, z: sw.normal === 'z' ? sw.z - 0.8 : sw.z, deck: swd, access: new Set() }; D.request(swd, sw.id, a); step(30); check('swing door opens', s.open > 0.9); R.info.swingSide = s.swing; step(30 * 5); }

// ── watertight ─────────────────────────────────────────────────────────
const wt = W.plans[1].doors.find(d => d.type === 'watertight' && d.x === -95 && d.z > 0);
const wst = W.door(1, wt.id);
check('watertight needs credential', !D.canPass({ x: wt.x, z: wt.z - 0.8, deck: 1, access: new Set() }, wst));
D.request(1, wt.id, { x: wt.x, z: wt.z - 0.8, deck: 1, access: new Set(['crew', 'engineer', 'officer']) });
step(30 * 2); const wmid = wst.open; step(30 * 4);
check('watertight opens slowly', wmid > 0.2 && wmid < 0.7 && wst.open > 0.99, [wmid, wst.open]);
D.forceOpen(1, wt.id); step(30 * 12); check('forced stays open', wst.open > 0.99);

// ── elevators ─────────────────────────────────────────────────────────
const car = E.car('mid-S2');
check('car exists', !!car);
R.info.carServed = car.served;
// ensure the group's cars are all elsewhere: call on deck 9
P.deck = 12; P.x = 0; P.z = 0;
for (const c of E.groups.get('mid').cars) { c.y = -6 + 2 * 3; c.atDeck = 3; c.deck = 3; c.state = 'idle'; c.door = 0; }
const c1 = E.call('mid', 9);
R.info.called = c1.id; R.info.callFrom = c1.deck;
let tArr = -1, t = 0, vmax = 0;
const arriveListener = (d) => { if (d.car === c1.id && d.deck === 9 && tArr < 0) tArr = t; };
const un = game.bus.on('elevator:arrive', arriveListener);
for (let k = 0; k < 30 * 60 && tArr < 0; k++) { step(1); t += 1 / 30; vmax = Math.max(vmax, Math.abs(c1.v)); }
check('car arrived at deck 9', tArr >= 0, { tArr, carDeck: c1.deck, y: c1.y, state: c1.state });
check('vmax ≤ 2.5', vmax <= 2.51, vmax);
step(30 * 2);
const L9 = c1.landings.get(9).door; const lst = W.door(9, L9.id);
check('landing door open with car', lst.open > 0.95 && !W.doorBlocks(9, L9.id), lst.open);
// player steps into the car
const shaft = W.plans[9].rooms.find(r => r && r.car === c1.id);
P.deck = 9; P.x = (shaft.x0 + shaft.x1) / 2; P.z = (shaft.z0 + shaft.z1) / 2; P.state = 'free';
step(2);
check('player state elevator', P.state === 'elevator' && P.elevator === c1.id, [P.state, P.elevator]);
const uiOn = !!document.querySelector('.lift-ui.on');
check('deck UI open', uiOn);
R.shots = [];
window.__sysPrep = (name) => {
  if (name === 'ui_lift') { game.camera.position.set(P.x - 0.3, P.y + 1.6, P.z - 0.6); game.camera.lookAt(P.x - 0.3 + 0.1, P.y + 1.5, P.z + 2); game.step(0.016); }
};
// select deck 14 by keyboard
game.input._debugSet('Digit1', true); step(1); game.input._debugSet('Digit1', false); game.input._debugSet('Digit4', true); step(1); game.input._debugSet('Digit4', false); step(1);
check('keyboard queued deck 14', c1.stops.has(14) || c1.state === 'moving', [...c1.stops]);
let tRide = 0, arrived14 = false; let deckChanges = [];
let pd = P.deck;
for (let k = 0; k < 30 * 60 && !arrived14; k++) { step(1); tRide += 1 / 30; if (P.deck !== pd) { deckChanges.push(P.deck); pd = P.deck; } if (c1.atDeck === 14 && c1.door > 0.9) arrived14 = true; }
check('ride to 14', arrived14, { y: c1.y, deck: c1.deck, state: c1.state, tRide });
check('player deck follows', P.deck === 14 && Math.abs(P.y - c1.y) < 1e-6, [P.deck, P.y, c1.y]);
R.info.deckChanges = deckChanges; R.info.ride9to14 = tRide.toFixed(1);
check('landing 9 closed again', W.door(9, L9.id).open < 0.01);
check('landing 14 open', W.door(14, c1.landings.get(14).door.id).open > 0.9);
// walk out
const L14 = c1.landings.get(14).door;
const lobbyR = W.plans[14].rooms[c1.landings.get(14).lobby];
P.x = lobbyR.cx; P.z = lobbyR.cz; step(2);
check('player state free after exit', P.state === 'free' && !P.elevator, [P.state, P.elevator]);
check('UI closed', !document.querySelector('.lift-ui.on'));
// nearest core & abstract
const nc = E.nearestCore(9, -12, 3);
check('nearestCore mid', nc && nc.core === 'mid', nc && nc.core);
const eta = E.useAbstract({ x: -12, z: 3 }, 9, 15, 'mid');
check('useAbstract ETA plausible', eta > 8 && eta < 90, eta);
// service lift
const sv = E.call('svc-cA', 2); check('service call', !!sv && sv.id === 'svc-cA');
// door interactions provider
P.deck = 9; P.x = corridorPt.x; P.z = corridorPt.z; P.yaw = Math.atan2(cab.x - P.x, cab.z - P.z); P.state = 'free';
const its = game.interact.query({ player: P, deck: 9, x: P.x, y: P.y, z: P.z, yaw: P.yaw, room: null });
const di = its.find(i => String(i.id).startsWith('door:9:' + cab.id));
check('door prompt offered', !!di, its.map(i => i.label + '|' + i.reason));
R.info.doorPrompt = di && [di.label, di.enabled, di.reason];
P.inventory = P.inventory || {}; const hadHas = P.inventory.has; P.inventory.has = (k) => k === 'lockpick' || (hadHas ? hadHas.call(P.inventory, k) : false);
const its2 = game.interact.query({ player: P, deck: 9, x: P.x, y: P.y, z: P.z, yaw: P.yaw, room: null });
const pi = its2.find(i => String(i.id).endsWith(':pick'));
check('pick prompt with lockpick', !!pi && pi.hold === 3 && pi.crime?.type === 'trespass');
P.inventory.has = hadHas;
// lobby call prompt
const ld = W.plans[9].doors.find(d => d.car === 'mid-S3');
P.x = ld.x; P.z = ld.z - 1.0; P.yaw = 0;
const its3 = game.interact.query({ player: P, deck: 9, x: P.x, y: P.y, z: P.z, yaw: P.yaw, room: null });
check('call prompt', its3.some(i => /elevator/i.test(i.label)), its3.map(i => i.label));

// ── lights ─────────────────────────────────────────────────────────────
game.camera.position.set(30, 19.65, 9.5); game.camera.lookAt(40, 19.4, 9.5); game.world.setActiveDeck(9);
P.deck = 9; P.x = 30; P.z = 9.5;
step(30);
const lit = game.lights.pool.filter(s => s.light.intensity > 0.1);
check('pool lights active in corridor', lit.length >= 4, lit.length);
R.info.poolPos = game.lights.pool.map(s => s.fix ? [s.fix.x.toFixed(1), s.fix.z.toFixed(1), s.light.intensity.toFixed(2)] : null);
game.lights.blackout(9, true); step(30 * 2);
check('blackout dims interior', game.lights.pool.every(s => s.light.intensity < 0.05) && (window.__intK = 1, true));
game.lights.blackout(9, false); game.lights.setEmergency(true); step(30 * 2);
const { shared } = await import('/src/world/materials.js');
const c = shared.uIntLight.value; check('emergency red', c.r > c.g * 3, [c.r, c.g, c.b]);
game.lights.setEmergency(false); step(30 * 2);
R.info.events = events.length; R.info.evSample = events.slice(0, 6);
R.info.ext = game.lights.extLamps.length;
return R;
