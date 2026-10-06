# One page load, many camera positions via window.__shot. Usage: multishot.py '[["name",[x,y,z,lx,ly,lz],hour,deck],...]'
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import ROOT, PORT, route
from playwright.sync_api import sync_playwright
shots = json.loads(sys.argv[1]); query = sys.argv[2] if len(sys.argv) > 2 else ''
os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?shotmode=1&{query}')
    pg.wait_for_function('window.__game && window.__game.frame > 1 && !!window.__shot', timeout=240000)
    pg.evaluate('window.__stop = true'); time.sleep(1)
    for s in shots:
        name, cam = s[0], s[1]; h = s[2] if len(s) > 2 else None; d = s[3] if len(s) > 3 else None
        info = pg.evaluate(f'window.__shot({json.dumps(cam)}, {json.dumps(h)}, {json.dumps(d)})')
        logs.append(f'{name}: {info}')
        pg.screenshot(path=os.path.join(ROOT, 'shots', name + '.png'), timeout=180000)
    b.close()
print('\n'.join(l for l in logs if 'GPU stall' not in l and 'swiftshader' not in l.lower())[-5000:])
