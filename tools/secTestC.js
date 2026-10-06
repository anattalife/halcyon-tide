// round C: headshot debug, (a) rerun metrics, CCTV view, confront dialogue, HUD suspicion, extinguisher, body discovery
const S = game.security, C = game.combat, P = game.player, N = game.npcs, W = game.world;
const R = {}; const T0 = performance.now(); const log = (...a) => console.log('[T]', ((performance.now() - T0) / 1000).toFixed(1), ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)));
const stepS = (sec) => H.step(Math.round(sec * 60));
const reset = () => { for (const n of [...S.ai.engaged]) S.ai._finish(n); S.clear(); S.lockdown(false); S.crime.pending.length = 0; S.suspicion = 0; S._suspCD = 0; if (S.jailed) S.release('test'); P.state = 'free'; P.lockControls(false); C.stunned = 0; C.surrendering = false; P.health = 100; C.holster(); C.take('pistol'); C.take('taser'); C.take('baton'); };
const ONLY = window.__secOnly || 'hackvxb';
if (window.__secOnly2) {}
game.minutes = 1440 + 15 * 60;
const aimAt = (n, h = 1.2) => { for (let k = 0; k < 3; k++) { const cp = game.cameraRig.camPos; const dx = n.x - cp.x, dy = (n.y + h) - cp.y, dz = n.z - cp.z; game.cameraRig.yaw = Math.atan2(dx, dz); game.cameraRig.pitch = -Math.atan2(dy, Math.hypot(dx, dz)); P.camYaw = game.cameraRig.yaw; game.cameraRig.shakeA = 0; game.cameraRig.kickA = 0; game.cameraRig.update(1 / 60, 1 / 60); } };
if (ONLY.includes('h')) {
  reset(); P.teleport(9, 30, 9.5, Math.PI / 2); for (const n of N.list) if (n.deck === 9 && Math.hypot(n.x - P.x, n.z - P.z) < 20) N.remove(n);
  N.setDensity(0);
  C.give('pistol'); C.select('pistol'); H.keys(['Mouse2']); stepS(0.6);
  const t4 = N.spawnAt('passenger', 9, 36, 9.6, { name: 'Head Target', yaw: -Math.PI / 2 }); t4.noFlee = true;
  stepS(0.2);
  const hp = game.camera.position.clone(); game.chars.headPos(t4.charId, hp);
  aimAt(t4, hp.y - t4.y);
  const o = game.cameraRig.camPos.clone(), d = game.cameraRig.lookDir.clone().normalize();
  const tc = hp.clone().sub(o).dot(d); const miss = hp.clone().sub(o.clone().addScaledVector(d, tc)).length();
  const ht = game.chars.hitTest(o, d, 30);
  R.head_dbg = { rayMissDist: +miss.toFixed(3), ht, t4char: t4.charId, headY: +hp.y.toFixed(2), npcY: +t4.y.toFixed(2) };
  C.cd = 0; C._bloom = 0; const h4 = t4.health; const r4 = C.shoot(); stepS(0.05);
  R.f_pistolHead = { hit: r4?.hit ? r4.hit.part : null, outcome: r4?.hit?.outcome, dmg: +(h4 - t4.health).toFixed(1), ls: C.lastShot };
  H.release(); N.setDensity(1);
  log('h', R);
}
if (ONLY.includes('a')) {
  reset(); C.take('pistol');
  P.teleport(5, 0, 10, Math.PI / 2); H.camYaw(Math.PI / 2); stepS(5);
  const victim = N.spawnAt('passenger', 5, 2, 12, { name: 'Test Victim' });
  P.teleport(5, 2, 10.9, 0); H.camYaw(0); stepS(0.2);
  C.melee(false);
  const pend = S.crime.pending.map(r => [r.kind, r.crime.id, +r.delay.toFixed(1)]);
  const track = []; let heatAt = null;
  for (let k = 0; k <= 26; k++) {
    const g5 = N.list.filter(n => n.role === 'security' && n.deck === 5 && n.state !== 'ko');
    const dists = g5.map(n => +Math.hypot(n.x - P.x, n.z - P.z).toFixed(1)).sort((a, b) => a - b).slice(0, 4);
    track.push([k, S.heat, dists.join(','), [...S.ai.engaged].map(n => n.sec.mode[0]).join('')]);
    if (heatAt == null && S.heat > 0) heatAt = k;
    if (k === 16) await shot('a2_guards_converge');
    stepS(1);
  }
  R.a = { pending: pend, heatAt, track: track.filter((_, i) => i % 2 === 0), finalHeat: S.heat, crimes: S.crime.log.slice(-4).map(c => c.type), stats: { ...S.ai.stats } };
  log('a', R.a);
}
if (ONLY.includes('c')) {
  // confront dialogue at heat 1 — description matches
  reset(); N.setDensity(1);
  P.teleport(5, -40, 10, Math.PI / 2); H.camYaw(Math.PI / 2); stepS(1);
  S.report({ type: 'theft', witnessed: true });
  const gd = N.spawnAt('security', 5, -34, 10, { job: 'patrol', yaw: -Math.PI / 2 });
  let dlg = null; game.ui.dialogue = (o) => { dlg = o; return new Promise(r => { window.__dlgResolve = r; }); };
  for (let k = 0; k < 30 && !dlg; k++) stepS(0.5);
  R.confront = { heat: S.heat, mode: gd.sec?.mode, dialog: dlg ? dlg.lines : null, opts: dlg ? dlg.options.map(o => o.id) : null, dist: +Math.hypot(gd.x - P.x, gd.z - P.z).toFixed(1) };
  // show the real UI dialogue for the screenshot
  if (dlg) { const ui = game.ui; H.camYaw(Math.atan2(gd.x - P.x, gd.z - P.z) + 0.35, 0.12); game.cameraRig.update(1 / 60, 1 / 60); ui.dlg.open(dlg); for (let k = 0; k < 10; k++) await new Promise(r => setTimeout(r, 60)); for (let k = 0; k < 40; k++) ui.dlg.update?.(0.1); ui.dlg.advance?.(); for (let k = 0; k < 40; k++) ui.dlg.update?.(0.1); await shot('c_confront'); ui.dlg._finish?.(null); }
  window.__dlgResolve?.('bluff'); for (let k = 0; k < 4; k++) await new Promise(r => setTimeout(r, 30)); stepS(0.5);
  R.confront.afterBluff = { heat: S.heat, choice: S.ai.lastChoice, mode: gd.sec?.mode };
  log('c', R.confront);
}
if (ONLY.includes('k')) {
  // stand still when a chasing guard arrives (heat 2, unarmed) → cuffed rather than beaten
  reset(); P.teleport(5, -40, 10, Math.PI / 2); stepS(0.5);
  S.report({ type: 'assault', witnessed: true });
  const gd = N.spawnAt('security', 5, -30, 10, { job: 'patrol', yaw: -Math.PI / 2 });
  S.ai._engage(gd, 'chase'); S.ai.st(gd).seenT = S.ai.time;
  const hp0 = P.health; let t = 0;
  while (!S.jailed && t < 20) { stepS(0.5); t += 0.5; }
  for (let k = 0; k < 40 && P.controlsLocked; k++) await new Promise(r => setTimeout(r, 100));
  R.comply = { secondsToJail: t, jailed: S.jailed, healthLost: +(hp0 - P.health).toFixed(0), swings: S.ai.stats.swings };
  if (S.jailed) S.release('test');
  log('k', R.comply);
}
if (ONLY.includes('v')) {
  // HUD: heat + suspicion + indicators — trespass in the Spine as a guest while wanted
  reset(); P.removeDisguise();
  P.teleport(2, -80, 0, Math.PI / 2); H.camYaw(-Math.PI / 2, 0.15);
  const crew = N.spawnAt('crew_steward', 2, -75, 0.4, { job: 'steward', yaw: -Math.PI / 2 });
  S.report({ type: 'theft', witnessed: true });
  stepS(1.0); H.camYaw(Math.PI / 2 + 0.25, 0.1); game.cameraRig.update(1 / 60, 1 / 60);
  R.hud = { susp: +S.suspicion.toFixed(2), heat: S.heat, ind: S.ai.indicators([]).map(i => i.icon) };
  await shot('v_hud_suspicion');
  N.remove(crew);
  // CCTV console
  reset();
  const cons = W.plans[2].items.find(i => i.cctvConsole);
  P.teleport(2, cons.x, cons.z - 1.3, 0); stepS(0.3);
  const its = game.interact.query({ player: P, deck: 2, x: P.x, y: P.y, z: P.z, yaw: 0, room: P.room }, 3);
  R.cctv = { prompt: its.filter(i => i.id.startsWith('sec:')).map(i => i.label), room: P.room?.name };
  S.cctv.open();
  const casinoCam = S.cameras.findIndex(c => c.deck === 5 && /Gilded/.test(c.roomName));
  S.cctv.view(casinoCam >= 0 ? casinoCam : 40);
  stepS(1.0); S.cctv.update();
  await shot('v_cctv_view');
  S.cctv.loop(); R.cctv.looped = S.feedLooped(S.cctv.camera.deck);
  S.cctv.close(); S.loopFeed(5, false);
  R.cctv.after = { ctx: game.input.context, locked: P.controlsLocked };
  log('v', R.hud, R.cctv);
}
if (ONLY.includes('x')) {
  // extinguisher: blind a guard + fog a camera
  reset(); P.teleport(9, 30, 9.5, Math.PI / 2); for (const n of N.list) if (n.deck === 9 && Math.hypot(n.x - P.x, n.z - P.z) < 20) N.remove(n);
  N.setDensity(0);
  const gd = N.spawnAt('security', 9, 33, 9.5, { job: 'patrol', yaw: -Math.PI / 2 });
  C.give('extinguisher'); C.select('extinguisher'); stepS(0.2); aimAt(gd, 1.5);
  H.keys(['Mouse2']); game.input._debugSet('Mouse0', true);
  for (let k = 0; k < 50; k++) { aimAt(gd, 1.5); H.step(1); }
  await shot('x_extinguisher');
  game.input._debugSet('Mouse0', false); H.release();
  R.ext = { charge: +C.extCharge.toFixed(0), guardBlind: gd.sec?.blindUntil > S.ai.time || gd.blindUntil > C.time, guardAnim: gd.anim, obscured: S.cameras.filter(c => c.obscuredUntil > S.time).length };
  N.setDensity(1);
  log('x', R.ext);
}
if (ONLY.includes('b')) {
  // body discovery: KO a crew member in a corridor, drag it into a cabin vs leave it
  reset(); P.teleport(9, -30, 9.5, Math.PI / 2);
  for (const n of N.list) if (n.deck === 9 && Math.hypot(n.x - P.x, n.z - P.z) < 25) N.remove(n);
  N.setDensity(0);
  const v = N.spawnAt('crew_steward', 9, -28.9, 9.5, { job: 'steward', yaw: Math.PI / 2 });
  stepS(0.2); R.body = { canTD: C.canTakedown(v) };
  C.takedown(v); stepS(1.5);
  R.body.state = v.state; R.body.heat = S.heat;
  // a passer-by walks up
  const w = N.spawnAt('passenger', 9, -14, 9.5, { name: 'Finder', yaw: -Math.PI / 2 });
  N.setGoal(w, { type: 'move', deck: 9, x: -24, z: 9.5 });
  P.teleport(9, -45, 9.5, -Math.PI / 2);
  for (let k = 0; k < 20; k++) stepS(0.5);
  R.body.found = !!v._found; R.body.pending = S.crime.active.map(r => r.crime.type); stepS(10);
  R.body.after = { heat: S.heat, alert: +S.alert.toFixed(2), incidents: S.incidents.length, engaged: [...S.ai.engaged].map(n => n.sec.mode) };
  N.setDensity(1);
  log('b', R.body);
}
return R;
