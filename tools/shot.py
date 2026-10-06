# Headless screenshot harness: serves the game, maps the CDN to the local Three.js copy.
import sys, os, json, time, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '8765'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    h = functools.partial(Q, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), h) as s: s.serve_forever()
_srv = threading.Thread(target=serve, daemon=True); _srv.start()
def route(r):
    u = r.request.url
    pre = 'https://cdn.jsdelivr.net/npm/three@0.169.0/'
    if u.startswith(pre):
        path = os.path.join(ROOT, 'vendor', u[len(pre):])
        if os.path.exists(path):
            return r.fulfill(path=path, content_type='application/javascript')
    if 'fonts.googleapis' in u or 'fonts.gstatic' in u: return r.fulfill(body='', content_type='text/css')
    return r.continue_()
def run(shots, w=1280, h=720, wait=6, script=None, steps=0):
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': w, 'height': h})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        pg.route('**/*', route)
        for name, query in shots:
            pg.goto(f'http://127.0.0.1:{PORT}/index.html?{query}')
            try:
                pg.wait_for_function('window.__game && window.__game.frame > 2', timeout=180000)
            except Exception as e:
                logs.append('TIMEOUT ' + str(e)[:200])
            if script: pg.evaluate(script)
            time.sleep(wait)
            pg.evaluate('window.__stop = true')
            time.sleep(1.5)
            try:
                fr = pg.evaluate('window.__game ? window.__game.frame : -1')
                logs.append(f'{name}: frames={fr}')
            except Exception as e: logs.append(str(e)[:100])
            pg.screenshot(path=os.path.join(ROOT, 'shots', name + '.png'), timeout=180000)
            out.append(name)
        b.close()
    return logs
if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
    shots = json.loads(sys.argv[1])
    wait = float(sys.argv[2]) if len(sys.argv) > 2 else 6
    logs = run(shots, wait=wait)
    print('\n'.join(l for l in logs if 'GPU stall' not in l)[-6000:])
