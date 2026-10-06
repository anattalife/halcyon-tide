# Offline audio metrics via Playwright. Usage:
#   python3 tools/audioTest.py [sfx|music|amb|all] [--mixed] [filter,...]
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import PORT, route
from playwright.sync_api import sync_playwright

what = sys.argv[1] if len(sys.argv) > 1 else 'all'
mixed = '--mixed' in sys.argv
flt = [a for a in sys.argv[2:] if not a.startswith('--')]
flt = flt[0].split(',') if flt else None

def table(rows, keys):
    w = {k: max(len(k), *(len(str(r.get(k, ''))) for r in rows)) for k in keys}
    print('  '.join(k.ljust(w[k]) for k in keys))
    for r in rows:
        if 'error' in r: print(r['name'].ljust(w['name']), 'ERROR', r['error']); continue
        flag = []
        if r.get('nan'): flag.append('NaN!')
        if r.get('peak', 0) >= 0.99: flag.append('CLIP!')
        if r.get('peak', 1) < 0.003: flag.append('SILENT!')
        print('  '.join(str(r.get(k, '')).ljust(w[k]) for k in keys), ' '.join(flag))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page()
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    pg.goto(f'http://127.0.0.1:{PORT}/tools/audioTest.html')
    pg.wait_for_function('window.__audioTestReady === true', timeout=60000)
    t0 = time.time()
    if what in ('sfx', 'all'):
        rows = pg.evaluate(f'window.__audioTest.runSfx({json.dumps(flt)}, {json.dumps(mixed)})')
        table(rows, ['name', 'peak', 'rmsDb', 'crest', 'dur', 'genDur', 'onset', 'centroid', 'bands', 'nan', 'dc'])
    if what in ('music', 'all'):
        rows = pg.evaluate(f'window.__audioTest.runMusic(24, {json.dumps(mixed)}, {json.dumps(flt)})')
        table(rows, ['name', 'bars', 'bpm', 'peak', 'rmsDb', 'crest', 'centroid', 'bands', 'nan'])
    if what in ('amb', 'all'):
        rows = pg.evaluate('window.__audioTest.runAmbience(10)')
        table(rows, ['name', 'peak', 'rmsDb', 'crest', 'centroid', 'bands', 'nan', 'beds'])
    print(f'({time.time()-t0:.1f}s)')
    for l in logs[-20:]: print(l)
    b.close()
