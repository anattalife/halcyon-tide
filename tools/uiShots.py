# UI workstream test driver (same harness as play.py) with extra commands:
#   ["ushot", name]        screenshot WITHOUT stepping/rendering the 3D scene again (fast; for panels over a frozen frame)
#   ["render"]             render one 3D frame (slow in SwiftShader)
#   ["raf", seconds]       wall-clock sleep (CSS animations/transitions; the game loop stays frozen)
#   ["size", w, h]         set viewport size
# plus all play.py commands: tp hour step shot keys cam js log
# Usage: PORT=8781 python3 tools/uiShots.py '<json script>' [query]
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('PORT', '8781')
import shot
from shot import ROOT, PORT, route
from playerTest import HELPERS
from playwright.sync_api import sync_playwright
script = json.loads(sys.argv[1]); query = sys.argv[2] if len(sys.argv) > 2 else ''
os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
out = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    t0 = time.time()
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?{query}')
    pg.wait_for_function('window.__game && window.__game.player && window.__game.frame > 1', timeout=300000)
    pg.evaluate('window.__stop = true'); time.sleep(0.5)
    pg.evaluate(HELPERS)
    pg.evaluate('window.__pt.fast(true)')
    out.append(f'loaded in {time.time()-t0:.0f}s')
    for c in script:
        k = c[0]; t1 = time.time()
        if k == 'tp': pg.evaluate(f'(()=>{{const P=__game.player; P.teleport({c[1]},{c[2]},{c[3]},{c[4] if len(c)>4 else 0}); __pt.camYaw({c[4] if len(c)>4 else 0});}})()')
        elif k == 'hour': pg.evaluate(f'__game.minutes = {c[1]}*60 + 1440')
        elif k == 'step': pg.evaluate(f'__pt.step({c[1]})')
        elif k == 'cam': pg.evaluate(f'__pt.camYaw({c[1]}, {c[2] if len(c)>2 else "undefined"})')
        elif k == 'keys': pg.evaluate(f'(()=>{{__pt.keys({json.dumps(c[1])}); __pt.step({c[2]}); __pt.release();}})()')
        elif k in ('js', 'log'): out.append(str(pg.evaluate(c[1])))
        elif k == 'render': pg.evaluate('window.__pt.fast(false)'); pg.evaluate('__pt.step(1)'); pg.evaluate('window.__pt.fast(true)')
        elif k == 'raf': time.sleep(c[1])
        elif k == 'size': pg.set_viewport_size({'width': c[1], 'height': c[2]})
        elif k == 'shot':
            pg.evaluate('window.__pt.fast(false)'); pg.evaluate('__pt.step(2)')
            pg.screenshot(path=os.path.join(ROOT, 'shots', c[1] + '.png'), timeout=240000)
            pg.evaluate('window.__pt.fast(true)')
            out.append(f'shot {c[1]} ({time.time()-t1:.0f}s)')
        elif k == 'ushot':
            time.sleep(0.9)   # let CSS transitions finish
            pg.screenshot(path=os.path.join(ROOT, 'shots', c[1] + '.png'), timeout=240000)
            out.append(f'ushot {c[1]} ({time.time()-t1:.0f}s)')
    b.close()
print('\n'.join(out))
print('\n'.join(l for l in logs if 'GPU stall' not in l and 'Failed to load resource' not in l)[-4000:])
