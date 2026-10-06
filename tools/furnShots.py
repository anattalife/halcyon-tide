# Furniture workstream screenshot harness (like multishot.py, but tolerant timeouts and per-shot logging).
# Usage: PORT=8771 python3 tools/furnShots.py '[["name",[x,y,z,lx,ly,lz],hour,deck],...]'
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import ROOT, PORT, route
from playwright.sync_api import sync_playwright
shots = json.loads(sys.argv[1]); query = sys.argv[2] if len(sys.argv) > 2 else ''
os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.set_default_timeout(600000)
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    t0 = time.time()
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?shotmode=1&{query}')
    pg.wait_for_function('window.__game && window.__game.frame > 1 && !!window.__shot', timeout=600000)
    pg.evaluate('window.__stop = true'); time.sleep(1)
    print(f'loaded in {time.time() - t0:.0f}s', flush=True)
    for l in logs:
        if 'furniture' in l or 'pageerror' in l or '[error]' in l and '404' not in l: print(l, flush=True)
    if len(sys.argv) > 3:
        print('EVAL:', pg.evaluate(sys.argv[3]), flush=True)
    for s in shots:
        name, cam = s[0], s[1]; h = s[2] if len(s) > 2 else None; d = s[3] if len(s) > 3 else None
        try:
            info = pg.evaluate(f'window.__shot({json.dumps(cam)}, {json.dumps(h)}, {json.dumps(d)})')
            pg.screenshot(path=os.path.join(ROOT, 'shots', name + '.png'), timeout=600000)
            print(f'{name}: {info} ({time.time() - t0:.0f}s)', flush=True)
        except Exception as e:
            print(f'{name}: FAILED {str(e)[:200]}', flush=True)
    b.close()
