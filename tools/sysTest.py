# Ship-systems (doors / elevators / lights) behaviour harness.
# Usage: PORT=8772 python3 tools/sysTest.py tools/sysTest.js [query] [--shots]
# Loads index.html?shotmode=1, stops the RAF loop, then evaluates the JS file (an async function body that
# receives `game` and returns a JSON-able result). The script may call `await shot(name)` via window.__sysShot
# to take screenshots mid-test (written to shots/<name>.png).
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import ROOT, PORT, route
from playwright.sync_api import sync_playwright

script = open(sys.argv[1]).read()
query = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else ''
os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?shotmode=1&{query}')
    pg.wait_for_function('window.__game && window.__game.frame > 1', timeout=300000)
    pg.evaluate('window.__stop = true'); time.sleep(0.5)
    pending = []
    def shot(name):
        pg.screenshot(path=os.path.join(ROOT, 'shots', name + '.png'), timeout=300000)
    # run in chunks: the script returns {shots:[...], done:bool, state}; simple protocol
    res = pg.evaluate('async () => { const game = window.__game; const fn = new (Object.getPrototypeOf(async function(){}).constructor)("game", ' + json.dumps(script) + '); try { return await fn(game); } catch (e) { return {error: String(e && e.stack || e)}; } }')
    if isinstance(res, dict) and res.get('shots'):
        for s in res['shots']:
            # s: name string, or {name, cam:[x,y,z,lx,ly,lz], hour, deck, js (body run with `game` before the shot)}
            if isinstance(s, str):
                pg.evaluate(f'window.__sysPrep && window.__sysPrep({json.dumps(s)})'); shot(s); logs.append('shot ' + s); continue
            js = s.get('js', '')
            info = pg.evaluate('async (a) => { const game = window.__game; const f = new (Object.getPrototypeOf(async function(){}).constructor)("game", a.js); let r = null; try { r = await f(game); } catch (e) { r = String(e); } if (a.cam) window.__shot(a.cam, a.hour, a.deck); return r; }', {'js': js, 'cam': s.get('cam'), 'hour': s.get('hour'), 'deck': s.get('deck')})
            shot(s['name']); logs.append(f"shot {s['name']} {info}")
    print(json.dumps(res, indent=1)[:12000])
    b.close()
print('\n'.join(l for l in logs if 'GPU stall' not in l and 'swiftshader' not in l.lower() and '404' not in l and 'not present' not in l)[-6000:])
