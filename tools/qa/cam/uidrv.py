# QA driver (based on tools/play.py). Usage: PORT=8787 python3 tools/qa/qa.py script.json|'<json>' [query]
# extra commands: ["info"] -> real render + renderer.info ; ["shot",name] -> shots/qa/name.png ; ["jsfile",path]
import sys, os, json, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
os.environ.setdefault('PORT', '8787')
import shot
from shot import ROOT, PORT, route
from playerTest import HELPERS
from playwright.sync_api import sync_playwright
a = sys.argv[1]
script = json.loads(a)
query = sys.argv[2] if len(sys.argv) > 2 else ''
OUT = os.path.join(ROOT, 'shots', 'qa')  # ; os.makedirs(OUT, exist_ok=True)
INFO = r"""(() => { const g=__game; g.composer.render = g.composer._origRender; const r=g.renderer; r.info.autoReset=false; r.info.reset();
 const t0=performance.now(); g.step(1/60); const ms=performance.now()-t0; const i=r.info;
 const o={calls:i.render.calls, tris:i.render.triangles, lines:i.render.lines, points:i.render.points, geoms:i.memory.geometries, tex:i.memory.textures, programs:i.programs?i.programs.length:null, stepMs:+ms.toFixed(1)};
 r.info.autoReset=true; window.__pt.fast(true); return JSON.stringify(o); })()"""
out = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
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
        k = c[0]
        try:
            if k == 'tp': pg.evaluate(f'(()=>{{const P=__game.player; P.teleport({c[1]},{c[2]},{c[3]},{c[4] if len(c)>4 else 0}); __pt.camYaw({c[4] if len(c)>4 else 0});}})()')
            elif k == 'hour': pg.evaluate(f'__game.minutes = {c[1]}*60 + 1440')
            elif k == 'step': pg.evaluate(f'__pt.step({c[1]})')
            elif k == 'cam': pg.evaluate(f'__pt.camYaw({c[1]}, {c[2] if len(c)>2 else "undefined"})')
            elif k == 'goto': out.append(json.dumps(pg.evaluate(f'(()=>{{const r=__pt.goto({c[1]},{c[2]}{"," + json.dumps(c[3]) if len(c)>3 else ""}); delete r.trace; return r;}})()')))
            elif k == 'keys': pg.evaluate(f'(()=>{{__pt.keys({json.dumps(c[1])}); __pt.step({c[2]}); __pt.release();}})()')
            elif k in ('js', 'log'): out.append(str(pg.evaluate(c[1])))
            elif k == 'jsfile': out.append(str(pg.evaluate(open(os.path.join(ROOT, c[1])).read())))
            elif k == 'info': out.append('info ' + (c[1] if len(c) > 1 else '') + ' ' + pg.evaluate(INFO))
            elif k == 'free':  # free camera: ["free",[x,y,z,lx,ly,lz],deck]
                cam = c[1]; pg.evaluate(f'(()=>{{const g=__game; g.debugCam=true; g.camera.position.set({cam[0]},{cam[1]},{cam[2]}); g.camera.lookAt({cam[3]},{cam[4]},{cam[5]}); g.world.setActiveDeck({c[2]},1); g.focus=g.camera.position; }})()')
            elif k == 'nofree': pg.evaluate('__game.debugCam=false; __game.focus=null;')
            elif k == 'ushot':
                time.sleep(0.9); pg.screenshot(path=os.path.join(OUT, c[1] + '.png'), timeout=400000); out.append('ushot ' + c[1])
            elif k == 'ushot0':
                pg.evaluate("window.__pt.fast(true)"); pg.screenshot(path=os.path.join(OUT, c[1] + ".png"), timeout=400000, animations="disabled"); out.append('ushot0 ' + c[1])
            elif k == 'raf': time.sleep(c[1])
            elif k == 'size': pg.set_viewport_size({'width': c[1], 'height': c[2]})
            elif k == 'shot':
                pg.evaluate('window.__pt.fast(false)'); pg.evaluate('__pt.step(2)')
                pg.screenshot(path=os.path.join(OUT, c[1] + '.png'), timeout=400000)
                pg.evaluate('window.__pt.fast(true)')
                out.append('shot ' + c[1])
        except Exception as e:
            out.append(f'ERR {c[:2]}: {str(e)[:400]}')
        print(out[-1] if out else '', flush=True)
    b.close()
print('---- logs')
seen = {}
for l in logs:
    if 'GPU stall' in l: continue
    key = l[:160]; seen[key] = seen.get(key, 0) + 1
for k, n in seen.items(): print(f'{n}x {k}'[:600])
