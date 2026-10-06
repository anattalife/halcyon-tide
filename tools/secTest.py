# Security / crime / combat scenario harness.
# Usage: PORT=8783 python3 tools/secTest.py tools/secTestA.js [query]
# Loads the full game (like play.py), installs the playerTest helpers (window.__pt), then runs the JS file as an async
# function body receiving (game, H, shot). `await shot(name)` renders one frame and saves shots/<name>.png.
# console.log('[T] ...') lines are streamed as progress.
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('PORT', '8783')
from shot import ROOT, PORT, route
from playerTest import HELPERS
from playwright.sync_api import sync_playwright

script = open(sys.argv[1]).read()
query = sys.argv[2] if len(sys.argv) > 2 else 'notitle=1'
os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    def _con(m):
        if m.text.startswith('[T]'): print(m.text, flush=True)
        elif m.type in ('error', 'warning'): logs.append(f'[{m.type}] {m.text}')
    pg.on('console', _con)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    t0 = time.time()
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?{query}')
    pg.wait_for_function('window.__game && window.__game.player && window.__game.frame > 1', timeout=300000)
    pg.evaluate('window.__stop = true'); time.sleep(0.5)
    pg.evaluate(HELPERS)
    pg.evaluate('window.__pt.fast(true)')
    print(f'loaded in {time.time()-t0:.0f}s', flush=True)
    shots = []
    pg.evaluate('() => { const game = window.__game, H = window.__pt; window.__wantShot = null; window.__res = undefined; const shot = async (n) => { H.fast(false); H.step(1); window.__wantShot = n; while (window.__wantShot) await new Promise(r => setTimeout(r, 40)); H.fast(true); }; const fn = new (Object.getPrototypeOf(async function(){}).constructor)("game", "H", "shot", ' + json.dumps(script) + '); fn(game, H, shot).then(r => { window.__res = r === undefined ? null : r; }, e => { window.__res = {error: String(e && e.stack || e)}; }); }')
    res = None
    while True:
        st = pg.evaluate('({w: window.__wantShot, done: window.__res !== undefined})')
        if st['w']:
            pg.screenshot(path=os.path.join(ROOT, 'shots', st['w'] + '.png'), timeout=240000)
            shots.append(st['w']); print('shot', st['w'], flush=True)
            pg.evaluate('window.__wantShot = null')
        elif st['done']:
            res = pg.evaluate('window.__res'); break
        else: time.sleep(0.2)
    print(json.dumps(res, indent=1)[:24000])
    print('shots:', shots)
    b.close()
print('\n'.join(l for l in logs if 'GPU stall' not in l and '404' not in l and 'File not found' not in l)[-5000:])
