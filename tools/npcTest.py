# NPC simulation test: loads the game once, and for each view places the camera, simulates N seconds of
# game time (all systems' update(), no rendering), logs metrics, then renders one screenshot.
# Usage: PORT=8774 python3 tools/npcTest.py [secs=20] [only=name1,name2] [query]
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import ROOT, PORT, route
from playwright.sync_api import sync_playwright

VIEWS = [
    ["npc_dining4", [-120, 4.6, 0, -140, 4.2, 5], 19.0, 4],
    ["npc_lantern6", [5, 10.6, -10, 13, 10.2, 10], 22.0, 6],
    ["npc_casino5", [55, 7.6, -10, 75, 7.2, 5], 22.0, 5],
    ["npc_pool15", [-5, 40, -18, 25, 36, 5], 13.0, 15],
    ["npc_corr9", [20, 19.65, 9.5, 40, 19.4, 9.5], 10.0, 9],
    ["npc_spine2", [-20, -1.4, 0, 10, -1.5, 0], 8.0, 2],
    ["npc_theatre4", [102, 4.7, -15, 125, 4.5, 0], 19.75, 4],
    ["npc_atrium4", [0, 4.7, -12, 14, 5, 2], 15.0, 4],
]
secs = float(sys.argv[1]) if len(sys.argv) > 1 else 20
only = set(sys.argv[2].split(',')) if len(sys.argv) > 2 and sys.argv[2] not in ('', 'all') else None
query = sys.argv[3] if len(sys.argv) > 3 else ''
os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)

SIM = """([cam, hour, deck, secs]) => {
  const g = window.__game; const [x,y,z,lx,ly,lz] = cam;
  g.debugCam = true; g.camera.position.set(x,y,z); g.camera.lookAt(lx,ly,lz); g.camera.updateMatrixWorld();
  g.minutes = hour * 60; g.world.setActiveDeck(deck, 1); g.focus = g.camera.position;
  const dt = 1/30, n = Math.round(secs / dt);
  const sys = g.npcs.system; const times = [];
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    g.frame++; g.minutes += dt / 1.25;
    for (const s of g.systems) { if (s.update) { const a = performance.now(); try { s.update(dt, dt); } catch (e) { console.error(s.name, e); } if (s.name === 'npcs') times.push(performance.now() - a); } }
  }
  const st = g.npcs.stats();
  times.sort((a,b)=>a-b);
  st.simWall = +(performance.now() - t0).toFixed(0);
  st.p50 = +times[Math.floor(times.length*0.5)].toFixed(3); st.p95 = +times[Math.floor(times.length*0.95)].toFixed(3); st.mean = +(times.reduce((a,b)=>a+b,0)/times.length).toFixed(3);
  // steady-state (last third)
  const tail = times.slice(-Math.floor(times.length/3));
  st.chars = g.chars ? g.chars.count : 0;
  // quality checks: overlap, people inside blocked cells, floating seated
  const L = g.npcs.list; let overlap = 0, inWall = 0, bad = [];
  for (let i = 0; i < L.length; i++) { const a = L[i]; if (a.deck !== deck) continue;
    for (let j = i+1; j < L.length; j++) { const b = L[j]; if (b.deck !== a.deck) continue; const d = Math.hypot(a.x-b.x, a.z-b.z); if (d < 0.32 && !(a.state==='use'&&b.state==='use')) overlap++; }
    if (a.state !== 'use' && a.state !== 'stairs' && a.state !== 'approach' && !sys.nav.passable(a.deck, a.x, a.z, a.mask, a.swim)) { inWall++; if (bad.length < 5) bad.push([a.name, a.state, a.x.toFixed(1), a.z.toFixed(1), a.room?.name]); }
  }
  st.overlap = overlap; st.inWall = inWall; st.badSample = bad;
  const anims = {}; for (const a of L) { if (a.deck === deck) anims[a.anim] = (anims[a.anim]||0)+1; } st.anims = anims;
  const dress = {}; for (const a of L) { if (a.deck === deck) { const k = a.appearance?.role + '/' + a.appearance?.dress; dress[k] = (dress[k]||0)+1; } } st.dress = dress;
  delete st.focus;
  return st;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?shotmode=1&{query}')
    pg.wait_for_function('window.__game && window.__game.frame > 1 && !!window.__shot', timeout=300000)
    pg.evaluate('window.__stop = true'); time.sleep(1)
    has = pg.evaluate('!!window.__game.npcs')
    print('npcs installed:', has)
    for v in VIEWS:
        name, cam, hour, deck = v
        if only and name not in only: continue
        st = pg.evaluate(SIM, [cam, hour, deck, secs])
        print(f'== {name} @ {hour}h deck {deck}')
        print(json.dumps(st))
        pg.evaluate(f'window.__shot({json.dumps(cam)}, null, {deck})')
        pg.screenshot(path=os.path.join(ROOT, 'shots', name + '.png'), timeout=180000)
    b.close()
print('\n'.join(l for l in logs if 'GPU stall' not in l and 'swiftshader' not in l.lower())[-4000:])
