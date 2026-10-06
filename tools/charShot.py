# Screenshot harness for tools/charTest.html. Usage:
#   python3 tools/charShot.py '[["name","view=lineup",{"wait":3,"js":"..."}], ...]'
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shot  # starts the static server
from playwright.sync_api import sync_playwright
ROOT = shot.ROOT
def run(shots, w=1400, h=800):
    logs = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        pg.route('**/*', shot.route)
        for name, query, opt in shots:
            pg.goto(f'http://127.0.0.1:{shot.PORT}/tools/charTest.html?{query}')
            try: pg.wait_for_function('window.__frames > 1', timeout=120000)
            except Exception as e: logs.append('TIMEOUT ' + str(e)[:200])
            time.sleep(opt.get('wait', 2))
            pg.evaluate('window.__stop = true'); time.sleep(0.5)
            if opt.get('js'):
                r = pg.evaluate(opt['js']); logs.append(f'{name}: js -> {r}')
            if opt.get('frames'):
                for i, js in enumerate(opt['frames']):
                    pg.evaluate(js); time.sleep(0.2)
                    pg.screenshot(path=os.path.join(ROOT, 'shots', f'{name}_{i}.png'))
            else:
                pg.screenshot(path=os.path.join(ROOT, 'shots', name + '.png'))
        b.close()
    return logs
if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
    print('\n'.join(l for l in run(json.loads(sys.argv[1])) if 'GPU stall' not in l)[-5000:])
