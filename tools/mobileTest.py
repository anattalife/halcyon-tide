# Mobile-version QA driver: serves the project on PORT 8796, opens mobile.html in a phone-emulated Chromium
# (landscape, has_touch, is_mobile), drives REAL touch input through CDP Input.dispatchTouchEvent (multi-touch)
# and steps the game deterministically. Run ONE browser at a time:
#   flock /tmp/qa.lock python3 tools/mobileTest.py [scenarios] [--device iphone|pixel] [--dsf 1] [--query ...]
# scenarios: comma list of: hud, move, look, combat, aim, crouchjump, door, bar, slots, map, panels, editor,
#            portrait, title, dialogue, pool, cctv, all (default all). Screenshots → shots/m_*.png
import sys, os, json, time, math
os.environ['PORT'] = '8796'
sys.path.insert(0, os.path.dirname(__file__))
import shot
from shot import ROOT, PORT, route
from playwright.sync_api import sync_playwright

args = sys.argv[1:]
def opt(name, default=None):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
JS = opt('--js', None); TAG = opt('--tag', ''); DEVICE = opt('--device', 'iphone'); DSF = float(opt('--dsf', '1')); QUERY = opt('--query', '')
SCEN = (args[0] if args else 'all').split(',')
VIEW = {'iphone': (844, 390), 'pixel': (915, 412)}[DEVICE]
UA = {'iphone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'pixel': 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'}[DEVICE]
os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
R = {}          # results
FAIL = []

def check(name, ok, info=None):
    R[name] = {'ok': bool(ok), 'info': info}
    if not ok: FAIL.append(name)
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + json.dumps(info, default=str)[:400] if info is not None else ''), flush=True)

HELP = r"""
(() => {
  const g = window.__game, H = window.__mt = {};
  if (!g._origRender) { g._origRender = g.renderer.render.bind(g.renderer); g._origComp = g.composer.render.bind(g.composer); }
  H.fast = (on) => { g.composer.render = on ? () => {} : g._origComp; g.renderer.render = on ? () => {} : g._origRender; };
  H.step = (n) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  H.st = () => { const P = g.player; return { x: +P.x.toFixed(2), z: +P.z.toFixed(2), deck: P.deck, yaw: +P.yaw.toFixed(3), speed: +P.speed.toFixed(2), sprint: P.sprint, crouch: P.crouch, aiming: P.aiming, state: P.state, onGround: P.onGround, vy: +(P.vy||0).toFixed(2), camYaw: +g.cameraRig.yaw.toFixed(3), pitch: +g.cameraRig.pitch.toFixed(3), mode: g.cameraRig.mode, weapon: g.combat?.weaponId, best: g.player.interaction?.best?.label || null }; };
  H.rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, vis: r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && !e.closest('.off,.hide') }; };
  H.btn = (id) => H.rect(`[data-mb="${id}"]`);
  H.errors = [];
  return 'ok';
})()
"""

class Touch:
    def __init__(self, cdp): self.cdp = cdp; self.pts = {}
    def _send(self, typ):
        self.cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': p[0], 'y': p[1], 'id': i, 'radiusX': 6, 'radiusY': 6, 'force': 1} for i, p in self.pts.items()]})
    def down(self, i, x, y): self.pts[i] = (x, y); self._send('touchStart')
    def move(self, i, x, y): self.pts[i] = (x, y); self._send('touchMove')
    def up(self, i):
        if i in self.pts: del self.pts[i]
        self._send('touchEnd')
    def tap(self, x, y, i=9):
        self.down(i, x, y); self.up(i)

def main():
    t0 = time.time()
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = b.new_context(viewport={'width': VIEW[0], 'height': VIEW[1]}, device_scale_factor=DSF, is_mobile=True, has_touch=True, user_agent=UA)
        pg = ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        pg.route('**/*', route)
        pg.goto(f'http://127.0.0.1:{PORT}/mobile.html?{QUERY}')
        pg.wait_for_function('window.__game && window.__game.player && window.__game.frame > 1 && window.__mobile', timeout=600000)
        pg.evaluate('window.__stop = true'); time.sleep(0.4)
        pg.evaluate(HELP)
        pg.evaluate('__mt.fast(true)')
        print(f'loaded in {time.time() - t0:.0f}s quality={pg.evaluate("__game.qualityName")} mobile={pg.evaluate("__game.mobile")} dpr={pg.evaluate("devicePixelRatio")}', flush=True)
        cdp = ctx.new_cdp_session(pg)
        T = Touch(cdp)
        E = lambda js: pg.evaluate(js)
        step = lambda n: E(f'__mt.step({n})')
        def shotp(name, n=2, wait=0.6):
            time.sleep(wait)   # CSS transitions run in real time
            E('__mt.fast(false)'); step(n)
            pg.screenshot(path=os.path.join(ROOT, 'shots', f'm_{name}{TAG}.png'), timeout=300000)
            E('__mt.fast(true)')
            print('shot m_' + name, flush=True)
        def tp(deck, x, z, yaw=0, hour=None):
            E(f'(()=>{{const P=__game.player; P.teleport({deck},{x},{z},{yaw}); __game.cameraRig.snap({yaw}); __game.cameraRig.yaw={yaw}; __game.cameraRig.pitch=0.12;}})()')
            if hour is not None: E(f'__game.minutes = {hour}*60 + 1440')
            step(3)
        W, Hh = VIEW
        want = lambda s: 'all' in SCEN or s in SCEN

        # ── HUD baseline in a corridor ──
        tp(9, 60, 9.5, -math.pi / 2, 11)
        if JS: print('js:', json.dumps(E(JS), default=str)[:3000], flush=True)
        if want('hud'):
            vis = E('({fire: __mt.btn("fire").vis, lfire: __mt.btn("lfire").vis, aim: __mt.btn("aim").vis, jump: __mt.btn("jump").vis, crouch: __mt.btn("crouch").vis, top: __mt.rect(".htm-top").vis, mm: __mt.rect(".hx .mm canvas"), stick: __mt.rect(".htm-stick .base")})')
            check('hud_controls_visible', all(vis[k] for k in ('fire', 'lfire', 'aim', 'jump', 'crouch', 'top')), vis)
            sizes = E('[...document.querySelectorAll("#htm-hud .mb:not(.hide), .htm-top .tb")].map(e => { const r = e.getBoundingClientRect(); return [e.dataset.mb || e.dataset.tb, Math.round(r.width), Math.round(r.height)]; })')
            check('hud_tap_targets_44px', all(s[1] >= 44 and s[2] >= 44 for s in sizes), sizes)
            shotp('hud_corridor')

        # ── movement: joystick walk / jog / sprint / sprint lock ──
        if want('move'):
            s0 = E('__mt.st()')
            sx, sy = 150, Hh - 110
            T.down(0, sx, sy); step(2)
            T.move(0, sx, sy - 22); step(30); walk = E('__mt.st()')
            T.move(0, sx, sy - 60); step(40); jog = E('__mt.st()')
            T.move(0, sx, sy - 90); step(60); spr = E('__mt.st()')
            check('joystick_walk_analog', 0.3 < walk['speed'] < 2.2, walk)
            check('joystick_jog', jog['speed'] > 2.6 and not jog['sprint'], jog)
            check('joystick_sprint_past_ring', spr['sprint'] and spr['speed'] > 4.5, spr)
            dist = math.hypot(spr['x'] - s0['x'], spr['z'] - s0['z'])
            check('player_moved', dist > 3, {'dist': round(dist, 2)})
            # drag onto the lock icon (base centre y - R - 58) and release
            lock = E('__mt.rect(".htm-lock")')
            T.move(0, lock['x'], lock['y']); step(3)
            hot = E('document.querySelector(".htm-lock").classList.contains("hot")')
            shotp('sprint_lock_hot', 1)
            T.up(0); step(60)
            locked = E('({locked: __mobile.controls.stick.locked, ...__mt.st()})')
            check('sprint_lock_engages', hot and locked['locked'] and locked['sprint'] and locked['speed'] > 4.5, {'hot': hot, **locked})
            T.tap(150, Hh - 100); step(30)
            un = E('({locked: __mobile.controls.stick.locked, ...__mt.st()})')
            check('sprint_lock_cancel_by_tap', not un['locked'] and un['speed'] < 1.0, un)

        # ── look: right-side drag turns the camera; multi-touch move + look + fire ──
        if want('look'):
            tp(9, 60, 9.5, -math.pi / 2)
            y0 = E('__game.cameraRig.yaw')
            T.down(1, W * 0.55, Hh * 0.3); step(1)
            for k in range(1, 9): T.move(1, W * 0.55 + k * 20, Hh * 0.3); step(1)
            T.up(1); step(1)
            y1 = E('__game.cameraRig.yaw')
            check('look_drag_turns_camera', abs(y1 - y0) > 0.5, {'yaw0': y0, 'yaw1': y1, 'deltaRad': round(y1 - y0, 3)})
            p0 = E('__game.cameraRig.pitch')
            T.down(1, W * 0.55, Hh * 0.25)
            for k in range(1, 5): T.move(1, W * 0.55, Hh * 0.25 + k * 15); step(1)
            T.up(1); step(1)
            p1 = E('__game.cameraRig.pitch')
            check('look_drag_pitch', p1 - p0 > 0.15, {'p0': p0, 'p1': p1})
            # multi-touch: joystick held + look drag + fire held simultaneously
            E('__game.combat.give("pistol"); __game.combat.select("pistol")'); step(2)
            s0 = E('__mt.st()'); shots0 = E('__game.combat.hits + (__game.combat.lastShot ? 1 : 0)')
            ammo0 = E('__game.combat.ammo.pistol.mag')
            T.down(0, 150, Hh - 110); T.move(0, 150, Hh - 160); step(10)
            T.down(1, W * 0.55, Hh * 0.3); step(1)
            fb = E('__mt.btn("fire")')
            T.down(2, fb['x'], fb['y']); step(2)
            for k in range(1, 6): T.move(1, W * 0.55 + k * 18, Hh * 0.3); T.move(2, fb['x'] - k * 6, fb['y']); step(2)
            mt = E('({...__mt.st(), fire: __game.input.action("Fire"), mag: __game.combat.ammo.pistol.mag})')
            T.up(2); T.up(1); T.up(0); step(5)
            dist = math.hypot(mt['x'] - s0['x'], mt['z'] - s0['z'])
            check('multitouch_move_look_fire', dist > 0.5 and abs(mt['camYaw'] - s0['camYaw']) > 0.3 and mt['mag'] < ammo0, {'dist': round(dist, 2), 'dyaw': round(mt['camYaw'] - s0['camYaw'], 3), 'mag': [ammo0, mt['mag']]})

        # ── combat: fire button punches when unarmed, shoots when armed; left fire too ──
        if want('combat'):
            tp(9, 60, 9.5, -math.pi / 2)
            E('__game.combat.select("fists")'); step(2)
            E('window.__evs = []; __game.bus.on("sfx", e => { if (e && (e.name==="swing"||e.name==="punch")) __evs.push(e.name); }); __game.bus.on("combat:shot", e => __evs.push("shot:" + e.weapon)); 0')
            fb = E('__mt.btn("fire")')
            T.down(2, fb['x'], fb['y']); step(4); T.up(2); step(20)
            anim = E('({evs: [...__evs], anim: __game.player.anim, cd: __game.combat.cd})')
            check('fire_unarmed_punches', anim['cd'] > 0 or 'swing' in anim['evs'] or 'punch' in anim['evs'] or anim['anim'] == 'punch', anim)
            E('__game.combat.give("pistol"); __game.combat.select("pistol")'); step(30)
            E('window.__ev2 = []; __game.bus.on("combat:shot", e => __ev2.push("shot:" + e.weapon)); 0')
            mag0 = E('__game.combat.ammo.pistol.mag')
            lf = E('__mt.btn("lfire")')
            T.down(3, lf['x'], lf['y']); step(3); T.up(3); step(10)
            ev = E('__ev2'); mag1 = E('__game.combat.ammo.pistol.mag')
            check('left_fire_shoots_pistol', 'shot:pistol' in ev and mag1 == mag0 - 1, {'events': ev, 'mag': [mag0, mag1]})
            vib = E('typeof navigator.vibrate')
            check('haptics_api_guarded', True, {'vibrate': vib})

        # ── aim toggle (ADS / over-shoulder) ──
        if want('aim'):
            tp(15, 0, 8, math.pi / 2, 16)
            E('__game.combat.give("pistol"); __game.combat.select("pistol")'); step(2)
            ab = E('__mt.btn("aim")')
            T.tap(ab['x'], ab['y']); step(30)
            a = E('({...__mt.st(), aimK: __game.cameraRig.aimK, cross: document.querySelector(".ph-cross").classList.contains("on")})')
            check('aim_toggle_on', a['aiming'] and a['aimK'] > 0.8, a)
            shotp('aiming_pistol')
            T.tap(ab['x'], ab['y']); step(30)
            a2 = E('__mt.st()')
            check('aim_toggle_off', not a2['aiming'], a2)

        # ── crouch / jump / first-person ──
        if want('crouchjump'):
            tp(9, 60, 9.5, -math.pi / 2)
            cb = E('__mt.btn("crouch")'); jb = E('__mt.btn("jump")')
            T.tap(cb['x'], cb['y']); step(5); c1 = E('__mt.st()')
            check('crouch_tap', c1['crouch'], c1)
            T.tap(cb['x'], cb['y']); step(5); c2 = E('__mt.st()')
            check('crouch_tap_again_stands', not c2['crouch'], c2)
            T.tap(jb['x'], jb['y']); step(3); j = E('__mt.st()')
            check('jump_tap', (not j['onGround']) or j['vy'] > 0, j)
            step(60)
            vb = E('__mt.btn("fpv")'); T.tap(vb['x'], vb['y']); step(5)
            m = E('__game.cameraRig.mode')
            T.tap(vb['x'], vb['y']); step(5)
            m2 = E('__game.cameraRig.mode')
            check('view_toggle_first_person', m == 'first' and m2 == 'third', [m, m2])

        # ── contextual interact: open a door ──
        if want('door'):
            info = E('''(() => { const W = __game.world, P = __game.player, c = P.homeCabin; const plan = W.plans[c.deck], d = plan.doors[c.door], room = plan.rooms[c.room];
              const st = W.door(c.deck, c.door); st.target = 0; st.open = 0;
              const dx = room.cx - d.x, dz = room.cz - d.z, l = Math.hypot(dx, dz) || 1;
              for (const r of [0.9, 1.2, 0.7, 1.5]) { const x = d.x + dx / l * r, z = d.z + dz / l * r; const yaw = Math.atan2(d.x - x, d.z - z);
                P.teleport(c.deck, x, z, yaw); __game.cameraRig.snap(yaw); __game.cameraRig.yaw = yaw; __mt.step(4);
                const b = P.interaction?.best; if (b && /open/i.test(b.label)) return { id: c.door, deck: c.deck, label: b.label }; }
              return { fail: P.interaction?.best?.label || null }; })()''')
            if info and info.get('fail', 1) is not None and 'id' not in info: info = None
            if not info:
                check('interact_open_door', False, 'no door found')
            else:
                ib = E('__mt.btn("interact")')
                lbl = E('document.querySelector("[data-mb=interact] b").textContent')
                shotp('interact_door')
                T.tap(ib['x'], ib['y']); step(40)
                st = E(f'(() => {{ const s = __game.world.door({info["deck"]}, {info["id"]}); return {{ open: +s.open.toFixed(2), target: s.target }}; }})()')
                check('interact_open_door', ib['vis'] and 'pen' in lbl and st['open'] > 0.5, {'label': lbl, **st})

        # ── buy a drink at a bar ──
        if want('bar'):
            info = E('''(() => { const P = __game.player, L = __game.layout;
              for (const d of [5, 6, 7, 15, 16, 4, 8]) { const plan = L.plans[d]; if (!plan) continue;
                for (const poi of plan.pois || []) { if (poi.role !== 'bartender') continue;
                  for (const r of [1.6, 1.9, 2.2, 1.3]) for (const a of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
                    const yaw0 = (poi.rot || 0) + a; const x = poi.x + Math.sin(yaw0) * r, z = poi.z + Math.cos(yaw0) * r;
                    const room = __game.world.roomAt(d, x, z); if (!room || room.isVoid) continue;
                    const yaw = Math.atan2(poi.x - x, poi.z - z);
                    P.teleport(d, x, z, yaw, {strict: true}); __game.cameraRig.snap(yaw); __game.cameraRig.yaw = yaw; __mt.step(4);
                    const b = P.interaction?.best; if (b && /drink|bar|order|menu/i.test(b.label)) return { deck: d, label: b.label, cash: __game.economy.cash, credit: __game.economy.credit }; } } }
              return null; })()''')
            if not info:
                check('interact_buy_drink', False, 'no bar found')
            else:
                ib = E('__mt.btn("interact")')
                T.tap(ib['x'], ib['y']); step(6)
                shotp('bar_menu')
                bb = E('''(() => { const b = [...document.querySelectorAll('.act-panel .act-btn, .pnl.shop .btn')].find(e => !e.disabled && !e.classList.contains('dis') && /buy|order|§/i.test(e.textContent)); if (!b) return null; b.scrollIntoView({block: 'center'}); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: b.textContent, h: r.height }; })()''')
                if bb:
                    T.tap(bb['x'], bb['y']); time.sleep(0.3); step(4)
                after = E('({cash: __game.economy.cash, credit: __game.economy.credit, intox: __game.player.intox || 0})')
                spent = (info['cash'] + info['credit']) - (after['cash'] + after['credit'])
                check('interact_buy_drink', bool(bb) and spent > 0, {'label': info['label'], 'button': bb, 'spent': spent, **after})
                check('shop_buttons_44px', bool(bb) and bb['h'] >= 40, bb)
                # close with the X / ✕
                closed = E('''(() => { const x = document.querySelector('.act-panel .act-x'); if (x) { const r = x.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, w: r.width}; } const c = document.querySelector('#htm-close.on'); if (c) { const r = c.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, w: r.width}; } return null; })()''')
                if closed: T.tap(closed['x'], closed['y']); time.sleep(0.3); step(3)
                ctxs = E('__game.input.context')
                check('shop_close_by_touch', closed is not None and ctxs == 'play', {'btn': closed, 'ctx': ctxs})

        # ── weapon slot bar ──
        if want('slots'):
            tp(9, 60, 9.5, -math.pi / 2)
            E('for (const w of ["baton","taser","pistol","extinguisher"]) __game.combat.give(w); __game.combat.select("fists")'); step(3)
            sb = E('__mt.rect(\'.htm-slot[data-w="baton"]\')')
            T.tap(sb['x'], sb['y']); step(3); w1 = E('__game.combat.weaponId')
            pb = E('__mt.rect(\'.htm-slot[data-w="pistol"]\')')
            T.tap(pb['x'], pb['y']); step(3); w2 = E('__game.combat.weaponId')
            shotp('weapon_slots')
            T.tap(pb['x'], pb['y']); step(3); w3 = E('__game.combat.weaponId')
            check('weapon_slot_select_and_holster', w1 == 'baton' and w2 == 'pistol' and w3 == 'fists', [w1, w2, w3])
            am = E('document.querySelector(\'.htm-slot[data-w="pistol"] .am\').textContent')
            check('weapon_slot_ammo_count', '/' in am, am)
            rb = E('__mt.btn("reload")')
            E('__game.combat.select("pistol"); __game.combat.ammo.pistol.mag = 3'); step(3)
            rb = E('__mt.btn("reload")')
            T.tap(rb['x'], rb['y']); step(120)
            check('reload_button', E('__game.combat.ammo.pistol.mag') > 3, {'mag': E('__game.combat.ammo.pistol.mag'), 'btn': rb})

        # ── map: open from minimap tap, pinch zoom, pan, tap waypoint, close ──
        if want('map'):
            tp(9, 60, 9.5, -math.pi / 2)
            mm = E('__mt.rect(".hx .mm canvas")')
            T.tap(mm['x'], mm['y']); time.sleep(0.2); step(3)
            op = E('__ui.panel?.name')
            check('minimap_tap_opens_map', op == 'map', op)
            time.sleep(0.4); step(2)
            ppm0 = E('__ui.map.view.ppm')
            cx, cy = W * 0.55, Hh * 0.55
            T.down(4, cx - 40, cy); T.down(5, cx + 40, cy); step(1)
            for k in range(1, 7): T.move(4, cx - 40 - k * 15, cy); T.move(5, cx + 40 + k * 15, cy); step(1)
            T.up(5); T.up(4); step(1)
            ppm1 = E('__ui.map.view.ppm')
            check('map_pinch_zoom', ppm1 > ppm0 * 1.5, {'ppm0': ppm0, 'ppm1': ppm1})
            v0 = E('[__ui.map.view.cx, __ui.map.view.cz]')
            T.down(4, cx, cy)
            for k in range(1, 6): T.move(4, cx + k * 20, cy + k * 6); step(1)
            T.up(4); step(1)
            v1 = E('[__ui.map.view.cx, __ui.map.view.cz]')
            check('map_touch_pan', abs(v1[0] - v0[0]) > 5, {'v0': v0, 'v1': v1})
            E('__ui.setWaypoint(null)')
            tpnt = E('(() => { const m = __ui.map, P = __game.player; m.setDeck(P.deck, false); m.centreOn(P.x, P.z); const [ox, oy] = m._origin(); const r = m.cv.getBoundingClientRect(); return {x: r.left + ox, y: r.top + oy}; })()')
            T.tap(tpnt['x'], tpnt['y']); step(2)
            wp = E('__ui.waypoint')
            check('map_tap_sets_waypoint', wp is not None, wp)
            shotp('map')
            cb = E('__mt.rect("#htm-close")')
            T.tap(cb['x'], cb['y']); time.sleep(0.3); step(3)
            check('map_close_button', E('__ui.panel') is None and E('__game.input.context') == 'play', cb)

        # ── inventory / journal / pause open & close by touch ──
        if want('panels'):
            E('__game.inventory?.add?.("seasick_pills", 2)')
            for name, shot_name in (('inventory', 'inventory'), ('journal', 'journal'), ('pause', 'pause')):
                tb = E(f'__mt.rect(\'.htm-top [data-tb="{name}"]\')')
                T.tap(tb['x'], tb['y']); time.sleep(0.35); step(3)
                opened = E('__ui.panel?.name')
                if name == 'inventory':
                    it = E('(() => { const e = document.querySelector(".pnl .it"); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, w: r.width}; })()')
                    if it: T.tap(it['x'], it['y']); time.sleep(0.2); step(2)
                if name == 'journal':
                    tab = E('(() => { const e = [...document.querySelectorAll(".pnl .ptab")][1]; if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, h: r.height}; })()')
                    if tab: T.tap(tab['x'], tab['y']); time.sleep(0.2); step(2)
                    check('journal_tab_tap_44px', tab is not None and tab['h'] >= 44, tab)
                shotp(shot_name, 1)
                if name == 'pause':
                    st = E('(() => { const e = [...document.querySelectorAll(".pnl .mi")].find(b => b.dataset.k === "settings"); const r = e.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()')
                    T.tap(st['x'], st['y']); time.sleep(0.3); step(2)
                    has = E('!!document.querySelector(\'.pnl [data-act="mob.layout"]\') && !!document.querySelector(\'.pnl input[data-k="mob.lookSens"]\') && !!document.querySelector(\'.pnl .seg[data-k="quality"] button[data-v="mobile"]\')')
                    check('settings_mobile_section', has)
                    shotp('settings', 1)
                    # change look sensitivity via the range input
                    E('(() => { const r = document.querySelector(\'.pnl input[data-k="mob.lookSens"]\'); r.value = 1.6; r.dispatchEvent(new Event("input", {bubbles: true})); })()')
                    check('settings_look_sens_applies', abs(E('__mobile.settings.lookSens') - 1.6) < 1e-6)
                cb = E('__mt.rect("#htm-close")')
                T.tap(cb['x'], cb['y']); time.sleep(0.35); step(3)
                if E('__ui.panel'):   # pause sub-page → back first
                    T.tap(cb['x'], cb['y']); time.sleep(0.35); step(3)
                check(f'panel_{name}_open_close_touch', opened == (name if name != 'journal' else 'journal') and E('__ui.panel') is None, {'opened': opened})
            E('__mobile.setSetting("lookSens", 1)')

        # ── layout editor: drag a button, save, persists in localStorage and survives reload of the layout ──
        if want('editor'):
            E('__mobile.layout.reset(); __mobile.openEditor()'); step(2)
            jb = E('__mt.rect(\'#htm-edit .eb[data-id="jump"]\')')
            T.down(6, jb['x'], jb['y'])
            for k in range(1, 7): T.move(6, jb['x'] - k * 25, jb['y'] - k * 12); step(1)
            T.up(6); step(1)
            # resize with the slider
            E('(() => { const r = document.querySelector("#htm-edit .bar input"); r.value = 1.3; r.dispatchEvent(new Event("input", {bubbles: true})); })()')
            shotp('layout_editor', 1)
            sv = E('__mt.rect(\'#htm-edit [data-e="done"]\')')
            T.tap(sv['x'], sv['y']); time.sleep(0.2); step(3)
            stored = E('JSON.parse(localStorage.getItem("ht.m.layout") || "{}")')
            nb = E('__mt.btn("jump")')
            check('layout_editor_moves_and_persists', 'jump' in stored and abs(nb['x'] - (jb['x'] - 150)) < 3 and nb['w'] > jb['w'] * 1.2, {'stored': stored, 'before': jb, 'after': nb})
            from_disk = E('(() => { const L = new (__mobile.layout.constructor)(); return L.get("jump"); })()')
            check('layout_persisted_reloadable', from_disk == stored['jump'], from_disk)
            E('__mobile.layout.reset()'); step(2)

        # ── dialogue: options are tappable ──
        if want('dialogue'):
            E('window.__dlgRes = "pending"; __ui.dialogue({speaker: "Ines Okafor", role: "Security Chief", lines: ["You look like someone who knows the ship."], options: [{id: "a", text: "I just work here."}, {id: "b", text: "Who is asking?"}, {id: "c", text: "Walk away"}]}).then(r => window.__dlgRes = r); 0')
            time.sleep(0.3)
            for _ in range(4):
                step(30)
                ready = E('document.querySelectorAll(".dlg .op").length')
                if ready: break
                bx = E('__mt.rect(".dlg")')
                if bx: T.tap(bx['x'], bx['y'])
                time.sleep(0.2)
            step(10)
            shotp('dialogue', 1)
            op = E('(() => { const e = document.querySelectorAll(".dlg .op")[1]; if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, h: r.height}; })()')
            if op: T.tap(op['x'], op['y'])
            time.sleep(0.4); step(3)
            check('dialogue_option_tap', E('window.__dlgRes') == 'b' and op['h'] >= 44, {'res': E('window.__dlgRes'), 'op': op})

        # ── pool deck HUD ──
        if want('pool'):
            pos = E('''(() => { const L = __game.layout; for (const d of [15, 14, 16]) { const r = L.plans[d]?.rooms.find(r => r && r.type === 'pooldeck'); if (r) return [d, r.cx, r.cz, r.x0, r.x1]; } return null; })()''')
            if pos:
                tp(pos[0], pos[1] - 6, pos[2] + 6, math.pi * 0.6, 15)
                E('__game.combat.select("fists")'); step(30)
                shotp('hud_pool_deck')
            check('pool_deck_found', pos is not None, pos)

        # ── CCTV console buttons ──
        if want('cctv'):
            ok = E('(() => { try { __game.security.cctv.open(); return __game.security.cctv.active; } catch (e) { return String(e); } })()')
            step(3)
            i0 = E('__game.security.cctv.index')
            nb = E('__mt.rect(\'#htm-cctv [data-c="next"]\')')
            if nb and nb['vis']: T.tap(nb['x'], nb['y']); step(3)
            i1 = E('__game.security.cctv.index')
            shotp('cctv', 1)
            xb = E('__mt.rect(\'#htm-cctv [data-c="exit"]\')')
            if xb: T.tap(xb['x'], xb['y']); step(3)
            check('cctv_touch_controls', ok is True and i1 != i0 and not E('__game.security.cctv.active'), {'open': ok, 'i0': i0, 'i1': i1})

        # ── stealth: takedown appears on Interact when crouched behind someone; drag body (hold); surrender (hold) ──
        if want('stealth'):
            tp(15, -107, 6, -math.pi / 2, 15)
            E('__game.combat.select("fists"); for (const n of __game.npcs.list) if (n._talk) n._talk = null; 0')   # keep mission talk prompts out of the way
            npc = E('''(() => { const P0 = __game.player; const n = __game.npcs.spawnAt('passenger', 15, P0.x - 1.4, P0.z, { name: 'Test Target', goal: { type: 'idle' } }); if (!n) return null; n.yaw = -Math.PI / 2; n.alert = 0; window.__tn = n; return { id: n.id }; })()''')
            cb = E('__mt.btn("crouch")'); T.tap(cb['x'], cb['y']); step(3)
            E('(() => { const n = __tn, P = __game.player; n.yaw = -Math.PI / 2; n.alert = 0; P.teleport(15, n.x + 0.9, n.z, -Math.PI / 2); __game.cameraRig.yaw = -Math.PI / 2; })()'); step(1)
            E('__tn.yaw = -Math.PI / 2; __tn.alert = 0'); step(1)
            lbl = E('(() => { __tn.yaw = -Math.PI/2; __mt.step(1); return { best: __game.player.interaction?.best?.label, pill: document.querySelector("[data-mb=interact] b").textContent, vis: __mt.btn("interact").vis, crouch: __game.player.crouch }; })()')
            shotp('takedown_prompt', 1)
            ib = E('__mt.btn("interact")')
            T.tap(ib['x'], ib['y']); step(90)
            ko = E('({state: __tn.state, anim: __game.player.anim})')
            check('takedown_via_interact', lbl['best'] == 'Takedown' and lbl['vis'] and ko['state'] in ('ko', 'dead', 'down'), {**lbl, **ko})
            # drag the body: hold the interact pill (key G)
            E('(() => { const P = __game.player; if (P.crouch) P.crouch = false; P.teleport(15, __tn.x + 0.8, __tn.z, -Math.PI / 2); __game.cameraRig.yaw = -Math.PI / 2; })()'); step(4)
            dl = E('({best: __game.player.interaction?.best?.label, key: __game.player.interaction?.best?.key})')
            ib = E('__mt.btn("interact")')
            T.down(7, ib['x'], ib['y']); step(20)
            dragging = E('!!__game.combat.dragging')
            T.down(0, 150, Hh - 110); T.move(0, 150, Hh - 150); step(40); T.up(0)
            moved = E('(() => ({x: __tn.x, z: __tn.z}))()')
            T.up(7); step(5)
            stopped = E('!__game.combat.dragging')
            check('drag_body_hold', dragging and stopped and dl['key'] == 'G', {'prompt': dl, 'dragging': dragging, 'released': stopped, 'body': moved})
            # surrender: visible with heat, hold 0.8 s
            E('__game.security.setHeat(2)'); step(3)
            sb = E('__mt.btn("surrender")')
            if sb and sb['vis']:
                T.down(8, sb['x'], sb['y']); step(70); T.up(8); step(2)
            sur = E('!!__game.combat.surrendering')
            if not sur: print('surrender dbg', E('({heat: __game.security.heat, st: __game.player.state, off: document.getElementById("htm-hud").className, cls: document.querySelector("[data-mb=surrender]").className, hide: [...__ui._hide], ctx: __game.input.context})'))
            check('surrender_hold_button', bool(sb and sb['vis']) and sur, {'btn': sb, 'surrendering': sur})
            E('__game.security.clear?.(); __game.combat.surrendering = false; __game.player.animOverride = null'); step(3)

        # ── casino cage (activity panel) by touch ──
        if want('casino'):
            E('(async () => { const m = await import("./src/systems/activities/casino.js"); m.openCage(__game); return 1; })()')
            time.sleep(0.3); step(2)
            chips0 = E('__game.inventory?.count?.("casino_chips") || 0')
            bt = E('''(() => { const b = [...document.querySelectorAll('.act-panel button')].find(x => /[0-9]/.test(x.textContent) && !x.disabled && !x.classList.contains('act-x')); if (!b) return null; const r = b.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, h: r.height, t: b.textContent}; })()''')
            if bt: T.tap(bt['x'], bt['y']); time.sleep(0.2); step(2)
            chips1 = E('__game.inventory?.count?.("casino_chips") || 0')
            shotp('casino_cage', 1)
            xb = E('__mt.rect(".act-panel .act-x")')
            if xb: T.tap(xb['x'], xb['y']); time.sleep(0.2); step(2)
            check('casino_cage_touch', bool(bt) and bt['h'] >= 44 and chips1 > chips0 and xb['w'] >= 44 and not E('!!document.querySelector(".act-panel")'), {'btn': bt, 'chips': [chips0, chips1], 'x': xb})

        # ── elevator deck selector by touch ──
        if want('lift'):
            car = E('''(() => { const P = __game.player, cs = __game.elevators.cars.filter(c => c.kind !== 'service' && !c.moving && c.atDeck != null && c.served.includes(c.atDeck) && c.served.includes(12) && c.atDeck !== 12);
              const c = cs[0]; if (!c) return null; P.teleport(c.atDeck, c.cx + 3, c.cz, 0); P.x = c.cx; P.z = c.cz; P.y = c.y; __mt.step(6);
              return { id: c.id, deck: c.atDeck, state: P.state, open: !!document.querySelector('.lift-ui.on') }; })()''')
            if car:
                shotp('elevator_panel', 1)
                b12 = E('''(() => { const b = [...document.querySelectorAll('.lift-ui .lu-grid button')].find(x => x.textContent.trim() === '12'); if (!b) return null; const r = b.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, h: r.height, w: r.width}; })()''')
                if b12: T.tap(b12['x'], b12['y']); time.sleep(0.2); step(6)
                rd = E(f'(() => {{ const c = __game.elevators.car("{car["id"]}"); return {{ stops: [...c.stops], moving: c.moving, state: c.state, pstate: __game.player.state }}; }})()')
                hidden = E('({fire: __mt.btn("fire").vis, interact: __mt.btn("interact").vis})')
                check('elevator_deck_button_touch', b12 is not None and b12['h'] >= 44 and (12 in rd['stops'] or rd['moving']), {'car': car, 'btn': b12, **rd})
                check('elevator_hides_overlapping_buttons', not hidden['fire'] and not hidden['interact'], hidden)
            else: check('elevator_deck_button_touch', False, 'no idle car')

        # ── title screen (shown again after load) with Fullscreen entry ──
        if want('title'):
            E('__ui.showTitleScreen()'); time.sleep(0.5); step(2)
            fs = E('__mt.rect(".title .mi.fs")')
            time.sleep(3)   # css entrance animations (real time)
            E('__mt.fast(false)'); step(6)
            pg.screenshot(path=os.path.join(ROOT, 'shots', f'm_title{TAG}.png'), timeout=300000); print('shot m_title', flush=True)
            E('__mt.fast(true)')
            check('title_fullscreen_button', fs is not None and fs['vis'] and fs['h'] >= 40, fs)
            nv = E('(() => { const e = document.querySelector(\'.title [data-k="new"]\'); const r = e.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2, h: r.height}; })()')
            T.tap(nv['x'], nv['y']); time.sleep(1.3); step(3); time.sleep(0.3); step(3)
            check('title_new_voyage_tap', not E('__ui.titleActive') and nv['h'] >= 44, nv)

        # ── portrait: rotate overlay ──
        if want('portrait'):
            pg.set_viewport_size({'width': VIEW[1], 'height': VIEW[0]}); time.sleep(0.4)
            ov = E('getComputedStyle(document.getElementById("htm-rotate")).display')
            E('__mt.fast(false)'); step(1)
            pg.screenshot(path=os.path.join(ROOT, 'shots', f'm_portrait{TAG}.png'), timeout=300000); print('shot m_portrait', flush=True)
            E('__mt.fast(true)')
            pg.set_viewport_size({'width': VIEW[0], 'height': VIEW[1]}); time.sleep(0.4)
            ov2 = E('getComputedStyle(document.getElementById("htm-rotate")).display')
            check('portrait_rotate_overlay', ov == 'flex' and ov2 == 'none', [ov, ov2])

        res = E('({q: __game.qualityName, scale: __game.mobileRes?.scale, pr: __game.renderer.getPixelRatio(), mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null, calls: __game.renderer.info.render.calls, tex: __game.renderer.info.memory.textures, geo: __game.renderer.info.memory.geometries})')
        print('renderer', json.dumps(res), flush=True)
        b.close()
    errs = [l for l in logs if ('[error]' in l or 'pageerror' in l) and 'GPU stall' not in l]
    warn = [l for l in logs if '[warning]' in l and 'GPU stall' not in l]
    check('no_console_errors', not errs, errs[:12])
    if warn: print('warnings:', '\n'.join(warn[:10]))
    print(f'\n{len(R) - len(FAIL)}/{len(R)} passed in {time.time() - t0:.0f}s' + (('  FAILED: ' + ', '.join(FAIL)) if FAIL else ''))

main()
