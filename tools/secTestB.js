// (c) trespass suspicion, (d) CCTV theft casino, (e) arrest flow, (f) taser & pistol hitTest, (g) decay + disguise, (h) lockdown
const S = game.security, C = game.combat, P = game.player, N = game.npcs, W = game.world;
const R = {}; const T0 = performance.now(); const log = (...a) => console.log('[T]', ((performance.now() - T0) / 1000).toFixed(1), ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)));
const stepS = (sec) => H.step(Math.round(sec * 60));
const reset = () => { for (const n of [...S.ai.engaged]) S.ai._finish(n); S.clear(); S.lockdown(false); S.crime.pending.length = 0; S.suspicion = 0; S._suspCD = 0; if (S.jailed) S.release('test'); P.state = 'free'; P.lockControls(false); C.stunned = 0; C.surrendering = false; P.health = 100; C.holster(); C.take('pistol'); C.take('taser'); C.take('baton'); };
game.minutes = 1440 + 14 * 60;
const ONLY = (window.__secOnly || 'cdefgh');
if (game.ui) game.ui.dialogue = async (o) => { window.__lastDlg = o; return window.__dlgChoice || 'flee'; };

// ── (c) trespass: deck 2 Spine, no disguise vs crew disguise ──
if (ONLY.includes('c')) {
  const run = (label, setup) => {
    reset(); setup();
    P.teleport(2, -70, 0, Math.PI / 2); H.camYaw(Math.PI / 2);
    // a crew member and a guard nearby, facing the player
    const crew = N.spawnAt('crew_steward', 2, -64, 0.5, { job: 'steward', name: 'Crew Witness', yaw: -Math.PI / 2 });
    const out = []; let first = null;
    for (let k = 0; k < 24; k++) { stepS(0.5); out.push(+S.suspicion.toFixed(2)); if (first == null && S.crime.pending.some(r => r.crime.type === 'trespass' || r.crime.type === 'impersonation')) first = k * 0.5; }
    const res = { susp: out.filter((_, i) => i % 3 === 0), reportAfter: first, heat: S.heat, watcher: S.watcher?.name || null };
    N.remove(crew);
    return res;
  };
  R.c_noDisguise = run('none', () => P.removeDisguise());
  R.c_crewDisguise = run('crew', () => P.wearDisguise('crew_steward'));
  // disguised but lingering right next to a colleague for a long time
  reset(); P.wearDisguise('crew_steward'); P.teleport(2, -70, 0, Math.PI / 2);
  const col = N.spawnAt('crew_steward', 2, -68.5, 0.3, { job: 'steward', yaw: -Math.PI / 2 });
  const lin = []; for (let k = 0; k < 40; k++) { stepS(0.5); if (k % 4 === 0) lin.push(+S.suspicion.toFixed(2)); }
  R.c_lingerNextToColleague = lin; N.remove(col);
  // disguised as steward inside the security office (restricted)
  reset(); P.wearDisguise('crew_steward');
  const off = W.plans[2].rooms.find(r => r && r.secOffice);
  P.teleport(2, (off.x0 + off.x1) / 2, (off.z0 + off.z1) / 2, 0);
  const g2 = N.spawnAt('security', 2, (off.x0 + off.x1) / 2 + 3, (off.z0 + off.z1) / 2, { job: 'guard', yaw: -Math.PI / 2 });
  const rs = []; for (let k = 0; k < 16; k++) { stepS(0.5); rs.push(+S.suspicion.toFixed(2)); }
  R.c_stewardInSecOffice = { susp: rs.filter((_, i) => i % 2 === 0), heat: S.heat };
  N.remove(g2);
  P.removeDisguise();
  log('c done', R);
  await shot('c_suspicion');
}

// ── (d) CCTV catches theft in the casino with / without power ──
if (ONLY.includes('d')) {
  const casino = W.plans[5].rooms.find(r => r && r.type === 'casino' && /Gilded/.test(r.name));
  const tryTheft = (label) => {
    reset();
    // stand under a camera, nobody else around (clear NPCs nearby)
    const cams = S.cameras.filter(c => c.deck === 5 && c.x > casino.x0 && c.x < casino.x1 && c.z > casino.z0 - 1 && c.z < casino.z1 + 1);
    const cam = cams[0] || S.cameras.find(c => c.deck === 5);
    const q = N.nav.nearestPoint(5, cam.x + Math.sin(cam.yaw) * 3, cam.z + Math.cos(cam.yaw) * 3, 0, 5);
    P.teleport(5, q.x, q.z, 0);
    N.setDensity(0);
    for (const n of N.list) if (n.deck === 5 && Math.hypot(n.x - P.x, n.z - P.z) < 30 && n.role !== 'security') N.remove(n);
    for (const n of N.list) if (n.deck === 5 && n.role === 'security') { n.x = 150; n.z = 0; }
    stepS(0.1);
    const seen = S.camerasSeeing(5, P.x, P.y + 1.4, P.z).length;
    const cr = S.report({ type: 'theft' });
    const kinds = S.crime.pending.filter(r => r.crime === cr).map(r => r.kind);
    stepS(12);
    return { label, camerasSeeing: seen, reporters: kinds, heat: S.heat, desc: S.describe(), cam: cam.id };
  };
  R.d_powerOn = tryTheft('power on');
  S.cctvDown(10);
  R.d_powerOff = tryTheft('cctv junction sabotaged');
  S.cctvDownUntil = -1;
  S.loopFeed(5, true);
  R.d_looped = tryTheft('feed looped');
  S.loopFeed(5, false);
  N.setDensity(1);
  log('d done', R);
}

// ── (f) taser & pistol vs NPC via hitTest ──
if (ONLY.includes('f')) {
  reset();
  P.teleport(9, 30, 9.5, Math.PI / 2); H.camYaw(Math.PI / 2, 0.05);
  for (const n of N.list) if (n.deck === 9 && Math.hypot(n.x - P.x, n.z - P.z) < 20) N.remove(n);
  const t1 = N.spawnAt('passenger', 9, 34, 9.5, { name: 'Taser Target', yaw: -Math.PI / 2 }); t1.noFlee = true;
  C.give('taser'); C.give('pistol'); C.select('taser');
  stepS(0.3);
  // aim at the target's chest: set rig pitch so the camera ray passes through the chest
  const aimAt = (n, h = 1.2) => { stepS(0.05); for (let k = 0; k < 3; k++) { const cp = game.cameraRig.camPos; const dx = n.x - cp.x, dy = (n.y + h) - cp.y, dz = n.z - cp.z; game.cameraRig.yaw = Math.atan2(dx, dz); game.cameraRig.pitch = -Math.atan2(dy, Math.hypot(dx, dz)); P.camYaw = game.cameraRig.yaw; game.cameraRig.shakeA = 0; game.cameraRig.kickA = 0; game.cameraRig.update(1 / 60, 1 / 60); } };
  H.keys(['Mouse2']); stepS(0.6); aimAt(t1);
  const r1 = C.tase(); stepS(0.2);
  R.f_taserDbg = C.lastShot ? { to: [C.lastShot.to.x.toFixed(1), C.lastShot.to.y.toFixed(1), C.lastShot.to.z.toFixed(1)], hit: C.lastShot.hit, t1: [t1.x.toFixed(1), t1.z.toFixed(1)] } : null;
  R.f_taser = { hit: r1?.hit ? { part: r1.hit.part, outcome: r1.hit.outcome } : null, state: t1.state, koTimer: +t1.timer.toFixed(1), readyIn: +C.taserReadyIn.toFixed(2), crime: S.crime.log.at(-1)?.type };
  const r1b = C.tase(); R.f_taserCooldownBlocks = r1b === null;
  // out of range (8 m+)
  const t3 = N.spawnAt('passenger', 9, 40, 8.6, { yaw: -Math.PI / 2 }); t3.noFlee = true;
  C.taserCD = 0; aimAt(t3); const r3 = C.tase(); R.f_taserOutOfRange = { hit: r3?.hit?.outcome || null, state: t3.state, dist: +(t3.x - P.x).toFixed(1) };
  // pistol: body and head
  C.select('pistol'); stepS(0.3);
  const t2 = N.spawnAt('passenger', 9, 37, 10.3, { name: 'Pistol Target', yaw: -Math.PI / 2 }); t2.noFlee = true;
  stepS(0.1); aimAt(t2, 1.15);
  const h0 = t2.health; const r2 = C.shoot(); stepS(0.05);
  R.f_pistolBody = { hit: r2?.hit ? r2.hit.part : null, outcome: r2?.hit?.outcome, dmg: +(h0 - t2.health).toFixed(1), mag: C.ammo.pistol.mag, last: C.lastShot?.wall };
  C.cd = 0; C._bloom = 0;
  const t4 = N.spawnAt('passenger', 9, 36, 8.7, { name: 'Head Target', yaw: -Math.PI / 2 }); t4.noFlee = true;
  stepS(0.1); const hp = game.camera.position.clone(); game.chars.headPos(t4.charId, hp); game.cameraRig.shakeA = 0; aimAt(t4, hp.y - t4.y); aimAt(t4, hp.y - t4.y);
  const h4 = t4.health; const r4 = C.shoot(); stepS(0.05);
  R.f_pistolHead = { hit: r4?.hit ? r4.hit.part : null, outcome: r4?.hit?.outcome, dmg: +(h4 - t4.health).toFixed(1) };
  // miss → bullet hole in the wall
  C.cd = 0; game.cameraRig.yaw = Math.PI / 2 + 1.2; game.cameraRig.pitch = 0; game.cameraRig.update(1 / 60, 1 / 60);
  const r5 = C.shoot(); R.f_pistolWall = { wall: r5?.wall?.kind || null, decals: C.fx.decals.count };
  // shootout screenshot: a guard returning fire
  S.setHeat(4.5);
  for (const n of N.list) if (n.deck === 9 && Math.hypot(n.x - P.x, n.z - P.z) < 25 && n.role !== 'security') N.remove(n);
  N.setDensity(0);
  const gd = N.spawnAt('security', 9, 38, 10.2, { job: 'patrol', yaw: -Math.PI / 2 });
  S.ai._engage(gd, 'chase'); S.ai.st(gd).armed = true; S.ai.st(gd).seenT = S.ai.time;
  H.keys(['Mouse2']); stepS(0.5); C.cd = 0; aimAt(gd, 1.3); stepS(0.05); aimAt(gd, 1.3); C.shoot();
  gd.sec.atk = { kind: 'pistol', t: 0.0 }; gd.sec.atkCD = 5;
  await shot('f_shootout');
  H.release(); N.setDensity(1);
  R.f_heatAfterShooting = S.heat;
  R.f_stats = { ...S.ai.stats };
  log('f done', R);
}

// ── (e) arrest flow ──
if (ONLY.includes('e')) {
  reset();
  try { game.economy.add(1000, 'test'); } catch {}
  C.give('baton'); C.give('pistol');
  const cash0 = game.economy ? game.economy.cash : P.money;
  P.teleport(5, 10, 10, 0);
  S.report({ type: 'assault', witnessed: true });
  const lvl = S.heat;
  // surrender: hands up → guard cuffs
  const gd = N.spawnAt('security', 5, 12, 10, { job: 'patrol', yaw: -Math.PI / 2 });
  stepS(0.2);
  S.ai._engage(gd, 'chase'); S.ai.st(gd).seenT = S.ai.time;
  C.surrendering = true;
  let t = 0; while (!S.jailed && t < 25) { stepS(0.5); t += 0.5; if (t === 2) await shot('e_cuffing'); }
  // the arrest awaits a fade (setTimeout) — give it real time
  for (let k = 0; k < 40 && !S.jailed; k++) await new Promise(r => setTimeout(r, 100));
  for (let k = 0; k < 40 && P.controlsLocked; k++) await new Promise(r => setTimeout(r, 100));
  R.e_arrest = { heatBefore: lvl, secondsToCuff: t, jailed: S.jailed, deck: P.deck, room: P.room?.name, cash0, cash1: game.economy ? game.economy.cash : P.money, strikes: S.record.strikes, evidence: S.evidenceLocker.map(e => e.id), owned: ['baton', 'pistol'].filter(w => C.owned(w)), heatAfter: S.heat, state: P.state };
  await shot('e_brig');
  // jailbreak with a lockpick
  try { game.inventory.add('lockpick', 1); } catch { P.inventory.add('lockpick', 1); }
  const its = game.interact.query({ player: P, deck: P.deck, x: P.x, y: P.y, z: P.z, yaw: P.yaw, room: P.room }, 3);
  R.e_cellOptions = its.filter(i => i.id.startsWith('sec:')).map(i => [i.id, i.enabled]);
  const pick = its.find(i => i.id === 'sec:cellpick'); if (pick) pick.run(P, game);
  R.e_afterPick = { jailed: S.jailed, heat: S.heat };
  // three strikes
  S.record.strikes = 2; reset(); S.record.strikes = 2;
  S.report({ type: 'theft', witnessed: true });
  await S.arrest({ instant: true });
  R.e_thirdStrike = { strikes: S.record.strikes, jailed: S.jailed };
  S.release('test'); reset(); S.record.strikes = 0;
  log('e done', R);
}

// ── (g) heat decay & disguise escape ──
if (ONLY.includes('g')) {
  reset();
  P.removeDisguise();
  P.teleport(9, -20, 9.5, 0);
  for (const n of N.list) if (n.role === 'security') { n.x = 150; n.z = 0; }
  S.report({ type: 'assault', witnessed: true });
  const t0 = S.time; const trace = [];
  // out of sight (cameras on this deck off so they can't re-acquire), same outfit
  S.setCamerasEnabled(false, 9);
  for (let k = 0; k < 90 && S.heat > 0; k++) { S.ai.enabled = false; stepS(1); if (k % 10 === 0) trace.push([k, +S.heatValue.toFixed(2), S.known]); }
  R.g_decaySameOutfit = { seconds: +(S.time - t0).toFixed(0), trace, heat: S.heat };
  S.setCamerasEnabled(true, 9);
  // with an outfit change
  reset();
  S.report({ type: 'assault', witnessed: true });
  P.wearDisguise('crew_waiter');
  const t1 = S.time; const tr2 = [];
  for (let k = 0; k < 90 && S.heat > 0; k++) { stepS(1); if (k % 10 === 0) tr2.push([k, +S.heatValue.toFixed(2), S.known]); }
  R.g_decayDisguised = { seconds: +(S.time - t1).toFixed(0), trace: tr2, heat: S.heat };
  // in own cabin
  reset(); P.removeDisguise();
  S.report({ type: 'assault', witnessed: true });
  const cab = P.homeCabin; const sp = P._spawnPoint(cab); P.teleport(cab.deck, sp.x, sp.z, 0);
  const t2 = S.time; for (let k = 0; k < 90 && S.heat > 0; k++) stepS(1);
  R.g_decayOwnCabin = { seconds: +(S.time - t2).toFixed(0), room: P.room?.name };
  // camera re-acquires a known suspect
  reset(); P.removeDisguise();
  const cam = S.cameras.find(c => c.deck === 9 && !c.broken);
  const q = N.nav.nearestPoint(9, cam.x + Math.sin(cam.yaw) * 3, cam.z + Math.cos(cam.yaw) * 3, 0, 4);
  P.teleport(9, q.x, q.z, 0);
  S.report({ type: 'assault', witnessed: true });
  S.lastKnown = { deck: 9, x: q.x + 60, z: q.z, t: S.time };
  stepS(4);
  R.g_cameraReacquire = { lastKnownDist: +Math.hypot(S.lastKnown.x - P.x, S.lastKnown.z - P.z).toFixed(1), seen: S.seen || S._camLock != null };
  S.ai.enabled = true;
  log('g done', R);
}

// ── (h) lockdown ──
if (ONLY.includes('h')) {
  reset();
  P.teleport(5, 0, 10, 0); S.lastKnown = { deck: 5, x: 0, z: 10, t: S.time };
  const D = game.doors;
  const pub = W.plans[5].doors.filter(d => d.type !== 'cabin' && d.type !== 'elevator' && d.type !== 'balcony' && d.x > -55 && d.x < 55);
  R.h_doorTypes = [...new Set(pub.map(d => d.type + ':' + d.access))];
  const before = pub.filter(d => D.isLocked(5, d.id)).length;
  S.setHeat(3.2, 'test');
  const locked = pub.filter(d => D.isLocked(5, d.id)).length;
  const cars = game.elevators.cars.filter(c => c.served.includes(5));
  const disabled = cars.filter(c => c.disabled).length;
  // guards may pass, passengers not
  const dr = pub.find(d => d.access === 'none') || pub[0];
  const pax = { x: dr.x + 30, z: dr.z + 30, deck: 5, access: new Set(), keycards: new Set() };
  const guard = { x: dr.x + 30, z: dr.z + 30, deck: 5, access: new Set(['crew', 'security']), keycards: new Set() };
  R.h_on = { section: S.locked?.section, doorsInSection: S.locked?.doors.length, sampleLockedBefore: before, sampleLockedAfter: locked, cars: cars.length, carsDisabled: disabled, paxCanPass: D.canPass(pax, W.door(5, dr.id)), guardCanPass: D.canPass(guard, W.door(5, dr.id)), sampleDoor: dr.type + ':' + dr.access };
  S.setHeat(5.2, 'test');
  R.h_ship = { ship: S.locked?.ship, emergency: game.lights?.emergency, doors: S.locked?.doors.length, carsDisabled: game.elevators.cars.filter(c => c.disabled).length };
  await shot('h_lockdown');
  S.clear();
  R.h_off = { locked: !!S.locked, sampleLocked: pub.filter(d => D.isLocked(5, d.id)).length, carsDisabled: game.elevators.cars.filter(c => c.disabled).length, emergency: game.lights?.emergency };
  log('h done', R);
}
return R;
