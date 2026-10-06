# Player & camera behaviour tests + gameplay-camera screenshots.
# Usage: python3 tools/playerTest.py [tests|shots|all]   (PORT fixed at 8773)
import sys, os, json, time, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8773
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    h = functools.partial(Q, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), h) as s: s.serve_forever()
threading.Thread(target=serve, daemon=True).start()
def route(r):
    u = r.request.url
    pre = 'https://cdn.jsdelivr.net/npm/three@0.169.0/'
    if u.startswith(pre):
        path = os.path.join(ROOT, 'vendor', u[len(pre):])
        if os.path.exists(path): return r.fulfill(path=path, content_type='application/javascript')
    if 'fonts.googleapis' in u or 'fonts.gstatic' in u: return r.fulfill(body='', content_type='text/css')
    return r.continue_()

# JS helpers installed in the page
HELPERS = r"""
(() => {
  const g = window.__game, I = g.input, P = g.player, W = g.world;
  const H = window.__pt = {};
  if (!g.composer._origRender) g.composer._origRender = g.composer.render.bind(g.composer);
  H.fast = (on) => { g.composer.render = on ? () => {} : g.composer._origRender; };
  H.keys = (list) => { for (const k of ['KeyW','KeyA','KeyS','KeyD','ShiftLeft','KeyC','Space','Mouse2']) I._debugSet(k, list.includes(k)); };
  H.release = () => H.keys([]);
  H.step = (n) => { for (let i = 0; i < n; i++) g.step(1/60); };
  H.state = () => ({ x: +P.x.toFixed(3), y: +P.y.toFixed(3), z: +P.z.toFixed(3), deck: P.deck, yaw: +P.yaw.toFixed(3), speed: +P.speed.toFixed(2), room: P.room ? (P.room.name || P.room.type) : null, state: P.state, inWater: P.inWater, anim: P.anim });
  // face the camera (and hence movement) toward a world heading yaw
  H.camYaw = (yaw, pitch) => { g.cameraRig.yaw = yaw; if (pitch != null) g.cameraRig.pitch = pitch; P.camYaw = yaw; };
  // steer toward target (x,z) holding W; records y trace; returns {ok, steps, trace}
  H.goto = (x, z, opts = {}) => {
    const maxSteps = opts.max ?? 3000, tol = opts.tol ?? 0.35, keys = ['KeyW'].concat(opts.keys || []);
    const trace = []; let stuck = 0, last = [P.x, P.z]; let maxDy = 0; let prevY = P.y; let insideWall = 0;
    for (let s = 0; s < maxSteps; s++) {
      const dx = x - P.x, dz = z - P.z; const d = Math.hypot(dx, dz);
      if (d < tol) { H.release(); return { ok: true, steps: s, maxDy, insideWall, trace, end: H.state() }; }
      H.camYaw(Math.atan2(dx, dz)); H.keys(keys);
      g.step(1/60);
      const dy = Math.abs(P.y - prevY); if (dy > maxDy) maxDy = dy; prevY = P.y;
      if (opts.trace && s % 6 === 0) trace.push([+P.x.toFixed(2), +P.y.toFixed(3), +P.z.toFixed(2), P.deck]);
      if (W.collide(P.deck, P.x, P.z, 0.29, { ignoreItems: true }).hit) insideWall++;
      if (s % 60 === 59) { const m = Math.hypot(P.x - last[0], P.z - last[1]); if (m < 0.15) { stuck++; if (stuck > 2) { H.release(); return { ok: false, reason: 'stuck', steps: s, maxDy, insideWall, trace, end: H.state() }; } } else stuck = 0; last = [P.x, P.z]; }
    }
    H.release(); return { ok: false, reason: 'timeout', maxDy, insideWall, trace, end: H.state() };
  };
  H.path = (pts, opts = {}) => { const res = []; for (const p of pts) { const r = H.goto(p[0], p[1], opts); res.push({ to: p, ok: r.ok, reason: r.reason, steps: r.steps, maxDy: +r.maxDy.toFixed(4), insideWall: r.insideWall, end: r.end, trace: opts.trace ? r.trace : undefined }); if (!r.ok) break; } return res; };
  H.openDoor = (deck, id) => { const s = W.door(deck, id); s.open = 1; s.target = 1; s.lastUse = 1e12; s.forcedOpen = true; };
  H.wallCheck = () => W.collide(P.deck, P.x, P.z, 0.29, { ignoreItems: true }).hit;
  H.camInfo = () => { const c = g.camera.position; const r = g.cameraRig; return { cam: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], dist: +r.distance.toFixed(2), hidden: r.charHidden, camRoom: (W.roomAt(P.deck, c.x, c.z)||{}).name, lineToHead: W.lineClear(P.deck, c.x, c.z, P.x, P.z) }; };
})();
"""

def run_tests(pg):
    results = {}
    pg.evaluate(HELPERS)
    pg.evaluate('__pt.fast(true)')
    st0 = pg.evaluate('__pt.state()')
    info = pg.evaluate('({cabin: __game.player.cabin, home: {x: __game.player.homeCabin.x, z: __game.player.homeCabin.z, door: __game.player.homeCabin.door, room: __game.player.homeCabin.room}, keycards: [...__game.player.keycards]})')
    results['spawn'] = {'state': st0, **info}
    # 1) walk out of the cabin into the corridor (open the cabin door — the doors workstream does that in game)
    r = pg.evaluate('''(() => { const P = __game.player, W = __game.world; let c = P.homeCabin;
        if (P._spawn.corridor) { c = __game.layout.cabins.find(k => k.deck === 9 && k.kind === 'balcony' && k.side === 1); const sp = P._spawnPoint(c); P.teleport(9, sp.x, sp.z, sp.yaw); }
        const d = W.plans[c.deck].doors[c.door];
        __pt.openDoor(c.deck, c.door);
        const nz = Math.sign(d.z - W.plans[c.deck].rooms[c.room].cz) || 1;   // outward
        return {cabin: c.no, start: __pt.state(), path: __pt.path([[d.x, d.z - nz*0.5], [d.x, d.z + nz*1.0], [d.x - 6 * Math.sign(d.x || 1), d.z + nz*1.0]]).map(r => ({ok: r.ok, reason: r.reason, end: r.end}))}; })()''')
    results['cabin_to_corridor'] = r
    # 2) corridor end to end (deck 9 starboard passage x -152..112.5, z 8.5..10.5) sprinting + jogging back
    r = pg.evaluate('''(() => { __game.player.teleport(9, 100, 9.5, -Math.PI/2); const a = __pt.path([[111, 9.5]], {max: 600});
        const b = __pt.path([[-151, 9.5]], {keys: ['ShiftLeft'], max: 6000}); const c = __pt.path([[-140, 9.5]], {max: 900});
        return {a, b: b.map(x => ({...x, trace: undefined})), c, wall: __pt.wallCheck()}; })()''')
    results['corridor'] = r
    # 3) passenger stairs mid core, deck 9 → 10 (up lane z∈[0,2) on odd decks climbs from x=-7 to -12.5) and back down
    r = pg.evaluate('''(() => { const P = __game.player; P.teleport(9, -4, 1.0, -Math.PI/2);
        const up = __pt.path([[-6.5, 1.0], [-13.2, 1.0]], {trace: true, max: 1200});
        const s1 = __pt.state();
        return {up, s1}; })()''')
    results['stairs_up_mid'] = r
    # On deck 10 the landing at x=-12.5..-14: continue: deck 10 is even → up lane z∈[-2,0) from x=-12.5 → -7; down lane z∈[0,2) from -12.5 → -7 descends
    r = pg.evaluate('''(() => { const P = __game.player; const s0 = __pt.state();
        const dn = __pt.path([[-13.6, 1.0], [-13.6, 1.0], [-6.0, 1.0], [-4, 1.0]], {trace: true, max: 1500});
        return {s0, dn, s1: __pt.state()}; })()''')
    results['stairs_down_mid'] = r
    # up two decks in a row (9 → 11): up lane d9 z∈[0,2) -7→-12.5; on d10 up lane z∈[-2,0) -12.5→-7
    r = pg.evaluate('''(() => { const P = __game.player; P.teleport(9, -4, 1.0, -Math.PI/2);
        const res = __pt.path([[-6.5, 1.0], [-13.6, 1.0], [-13.6, -1.0], [-6.0, -1.0], [-4.5, -1.0]], {trace: true, max: 1500});
        return {res: res.map(r => ({to: r.to, ok: r.ok, reason: r.reason, maxDy: r.maxDy, end: r.end})), trace: res.flatMap(r => r.trace || []), s1: __pt.state()}; })()''')
    results['stairs_up_two'] = r
    # 4) crew staircase cA (x -45) deck 9 → 10
    r = pg.evaluate('''(() => { const P = __game.player; P.teleport(9, -41, 1.0, -Math.PI/2);
        const up = __pt.path([[-41.5, 1.0], [-48.2, 1.0]], {trace: true, max: 1200});
        const s1 = __pt.state();
        const dn = __pt.path([[-48.6, 1.0], [-40.8, 1.0]], {trace: true, max: 1200});
        return {up: up.map(r => ({ok: r.ok, reason: r.reason, maxDy: r.maxDy, end: r.end})), s1, dn: dn.map(r => ({ok: r.ok, reason: r.reason, maxDy: r.maxDy, end: r.end})), s2: __pt.state()}; })()''')
    results['stairs_crew'] = r
    # 5) pool deck 15: walk into the Sunward pool (x 6..20, z -6..6) and swim across
    r = pg.evaluate('''(() => { const P = __game.player; P.teleport(15, 3, 0, Math.PI/2);
        const res = __pt.path([[10, 0], [18, 2]], {max: 1500});
        const sIn = __pt.state(); const out = __pt.path([[23, 2]], {max: 900});
        return {res: res.map(r => ({ok: r.ok, reason: r.reason, end: r.end})), sIn, out: out.map(r => ({ok: r.ok, reason: r.reason, end: r.end}))}; })()''')
    results['pool'] = r
    # 6) footsteps + jump + crouch + seat
    r = pg.evaluate('''(() => { const g = __game, P = g.player; const steps = []; const off = g.bus.on('footstep', e => steps.push(e.surface));
        P.teleport(9, 0, 9.5, Math.PI/2); __pt.camYaw(Math.PI/2); __pt.keys(['KeyW']); __pt.step(120); __pt.release(); __pt.step(30);
        const yb = P.y; __game.input._debugSet('Space', true); __pt.step(1); __game.input._debugSet('Space', false); let ymax = P.y; for (let i = 0; i < 60; i++) { __pt.step(1); ymax = Math.max(ymax, P.y); }
        const jump = +(ymax - yb).toFixed(3);
        __game.input._debugSet('KeyC', true); __pt.step(1); __game.input._debugSet('KeyC', false); __pt.keys(['KeyW']); __pt.step(60); const crouchSpeed = P.speed; const crouchAnim = P.anim; __pt.release();
        __game.input._debugSet('KeyC', true); __pt.step(1); __game.input._debugSet('KeyC', false);
        __pt.keys(['KeyW','ShiftLeft']); __pt.step(90); const sprintSpeed = P.speed; __pt.release(); __pt.step(5);
        __pt.keys(['KeyW']); __pt.step(90); const jogSpeed = P.speed; __pt.release(); __pt.step(40); const stopSpeed = P.speed;
        off();
        g.input._debugSet('KeyV', true); __pt.step(1); g.input._debugSet('KeyV', false); __pt.step(3); const fp = {mode: g.cameraRig.mode, hidden: g.cameraRig.charHidden};
        g.input._debugSet('KeyV', true); __pt.step(1); g.input._debugSet('KeyV', false); __pt.step(3);
        const stairSide = (() => { P.teleport(9, -10, 1.0, 0); __pt.camYaw(0); __pt.keys(['KeyW']); __pt.step(90); __pt.release(); return {z: +P.z.toFixed(2), room: P.room && P.room.name}; })();
        return {fp, stairSide, steps: steps.length, surfaces: [...new Set(steps)], jump, crouchSpeed: +crouchSpeed.toFixed(2), crouchAnim, sprintSpeed: +sprintSpeed.toFixed(2), jogSpeed: +jogSpeed.toFixed(2), stopSpeed}; })()''')
    results['moves'] = r
    r = pg.evaluate('''(() => { const g = __game, P = g.player; const c = g.layout.cabins.find(k => k.deck === 9 && k.kind === 'balcony' && k.side === 1); const room = g.world.plans[c.deck].rooms[c.room];
        P.teleport(c.deck, room.cx, room.cz, 0); __pt.step(2);
        // find a seat/bed poi in the cabin
        const pois = g.world.plans[c.deck].pois.filter(p => p.room === c.room && (p.pose === 'sit' || p.pose === 'lie'));
        if (!pois.length) return {err: 'no pois'};
        const poi = pois.find(p => p.pose === 'sit') || pois[0]; const res = __pt.goto(poi.x + 0.0, poi.z + 0.0, {tol: 1.0, max: 400});
        __pt.step(2); const best = P.interaction.best ? P.interaction.best.label : null;
        g.input._debugSet('KeyE', true); __pt.step(1); g.input._debugSet('KeyE', false); __pt.step(30);
        const sat = {state: P.state, anim: P.anim};
        g.input._debugSet('KeyE', true); __pt.step(1); g.input._debugSet('KeyE', false); __pt.step(5);
        return {poi: {pose: poi.pose, t: poi.item.t}, reach: res.ok, best, sat, after: {state: P.state, wall: __pt.wallCheck()}}; })()''')
    results['seat'] = r
    # 7) elevator contract: state=elevator → y not overridden, no deck switch
    r = pg.evaluate('''(() => { const P = __game.player; P.teleport(9, -10, 7.2, 0); P.state = 'elevator'; P.elevator = 'mid-S3'; P.y = 25.0; __pt.step(10); const y = P.y; P.state = 'free'; P.elevator = null; P.teleport(9, 0, 9.5); return {yHeld: y, deck: P.deck}; })()''')
    results['elevator'] = r
    # 8) random walk fuzz: collisions never leave the player inside walls
    r = pg.evaluate('''(() => { const P = __game.player; let bad = 0; const spots = [[9, 0, 9.5], [9, 41, 6], [9, -10, 4], [5, 10, 0], [15, 0, 10], [9, -80, 9.5]];
        let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (const s of spots) { P.teleport(s[0], s[1], s[2]); for (let k = 0; k < 20; k++) { __pt.camYaw(rnd() * 6.283); __pt.keys(rnd() < 0.4 ? ['KeyW','ShiftLeft'] : ['KeyW']); __pt.step(25); if (__pt.wallCheck()) bad++; } }
        __pt.release(); return {bad}; })()''')
    results['fuzz'] = r
    return results

SHOTS = [
    # name, setup js
    ('pt_cabin', '''(() => { const P = __game.player, c = P.homeCabin; const sp = P._spawn; P.teleport(c.deck, sp.x, sp.z, sp.yaw + Math.PI); __pt.camYaw(sp.yaw + Math.PI, 0.15); })()'''),
    ('pt_cabin_door', '''(() => { const P = __game.player, c = P.homeCabin; const sp = P._spawn; P.teleport(c.deck, sp.x, sp.z, sp.yaw); __pt.camYaw(sp.yaw, 0.1); })()'''),
    ('pt_cabin_in', '''(() => { const g = __game, P = g.player; const c = g.layout.cabins.find(k => k.deck === 9 && k.kind === 'balcony' && k.side === 1 && k.x > 0); const sp = P._spawnPoint(c); P.teleport(9, sp.x, sp.z, sp.yaw + Math.PI); __pt.camYaw(sp.yaw + Math.PI, 0.15); __pt.keys(['KeyW']); __pt.step(25); __pt.release(); })()'''),
    ('pt_cabin_in_door', '''(() => { const g = __game, P = g.player; const c = g.layout.cabins.find(k => k.deck === 9 && k.kind === 'balcony' && k.side === 1 && k.x > 0); const room = g.world.plans[9].rooms[c.room]; const sp = P._spawnPoint(c); P.teleport(9, sp.x, sp.z + (room.cz > sp.z ? 1.8 : -1.8), sp.yaw); __pt.camYaw(sp.yaw, 0.1); })()'''),
    ('pt_corridor', '''(() => { const P = __game.player; P.teleport(9, 20, 9.5, Math.PI/2); __pt.camYaw(Math.PI/2, 0.08); __pt.keys(['KeyW']); __pt.step(40); __pt.release(); })()'''),
    ('pt_corridor_side', '''(() => { const P = __game.player; P.teleport(9, 20, 9.2, Math.PI/2); __pt.camYaw(0.2, 0.15); })()'''),
    ('pt_stairs', '''(() => { const P = __game.player; P.teleport(9, -6, 1.0, -Math.PI/2); __pt.camYaw(-Math.PI/2, 0.2); __pt.keys(['KeyW']); __pt.step(80); __pt.release(); })()'''),
    ('pt_stairs_down', '''(() => { const P = __game.player; P.teleport(10, -13.6, 1.0, Math.PI/2); __pt.camYaw(Math.PI/2, 0.25); __pt.keys(['KeyW']); __pt.step(80); __pt.release(); })()'''),
    ('pt_pool', '''(() => { const P = __game.player; P.teleport(15, 4, 2, Math.PI/2); __pt.camYaw(Math.PI/2, 0.2); __pt.keys(['KeyW']); __pt.step(160); __pt.release(); })()'''),
    ('pt_atrium', '''(() => { const P = __game.player; P.teleport(5, 0, 8, Math.PI/2); __pt.camYaw(Math.PI/2, -0.05); __pt.keys(['KeyW']); __pt.step(30); __pt.release(); })()'''),
    ('pt_aim', '''(() => { const P = __game.player; P.teleport(9, 30, 9.5, Math.PI/2); __pt.camYaw(Math.PI/2, 0.0); __game.input._debugSet('Mouse2', true); __pt.step(40); })()'''),
]

def run_shots(pg):
    pg.evaluate(HELPERS)
    out = []
    for name, js in SHOTS:
        pg.evaluate('__pt.fast(true)')
        pg.evaluate('__game.input._debugSet("Mouse2", false); __pt.release(); __game.minutes = 15*60;')
        pg.evaluate(js)
        pg.evaluate('__pt.step(30)')
        pg.evaluate('__pt.fast(false)')
        pg.evaluate('__pt.step(2)')
        info = pg.evaluate('({s: __pt.state(), c: __pt.camInfo()})')
        pg.screenshot(path=os.path.join(ROOT, 'shots', name + '.png'), timeout=180000)
        out.append((name, info))
    return out

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
    os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': 1280, 'height': 720})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        pg.route('**/*', route)
        pg.goto(f'http://127.0.0.1:{PORT}/index.html?q=low')
        pg.wait_for_function('window.__game && window.__game.player && window.__game.frame > 1', timeout=300000)
        pg.evaluate('window.__stop = true')
        time.sleep(1.0)
        pg.set_default_timeout(600000)
        if mode in ('tests', 'all'):
            res = run_tests(pg)
            print(json.dumps(res, indent=1, default=str)[:30000])
        if mode in ('shots', 'all'):
            for name, info in run_shots(pg):
                print(name, json.dumps(info))
        b.close()
    errs = [l for l in logs if ('error' in l.lower() or 'pageerror' in l) and 'GPU stall' not in l]
    print('\n'.join(errs[-30:]))

if __name__ == '__main__':
    main()
