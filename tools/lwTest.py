# Living-world test harness (schedule / weather / sea life). PORT env (use 8784).
# Usage:
#   python3 tools/lwTest.py schedule [days]           → simulate full days, print PA log + programme
#   python3 tools/lwTest.py shots '<json>'            → [[name, [cx,cy,cz,lx,ly,lz], hour, deck, {weather, steps, js, dt}], ...]
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import ROOT, PORT, route
from playwright.sync_api import sync_playwright
mode = sys.argv[1]
os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
SETUP = r"""
(() => {
  const g = window.__game;
  window.__lw = {
    setView(cam, hour, deck) {
      const [x,y,z,lx,ly,lz] = cam; g.debugCam = true;
      g.camera.position.set(x,y,z); g.camera.lookAt(lx,ly,lz); g.camera.updateMatrixWorld();
      if (hour != null) g.minutes = Math.floor(g.minutes/1440)*1440 + hour*60;
      const d = deck || Math.max(1, Math.min(17, Math.floor((y + 6.5)/3)+1));
      g.world.setActiveDeck(d, 1); g.focus = g.camera.position;
    },
    step(n, dt=1/30, keepTime=true) { const m = g.minutes; if (!g.composer._r) g.composer._r = g.composer.render.bind(g.composer); g.composer.render = () => {}; for (let i=0;i<n;i++) { if (i === n-1) g.composer.render = g.composer._r; g.step(dt); if (keepTime) g.minutes = m; } g.composer.render = g.composer._r; },
  };
})();
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    q = sys.argv[3] if len(sys.argv) > 3 else ''
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?shotmode=1&{q}')
    pg.wait_for_function('window.__game && window.__game.frame > 1 && !!window.__shot', timeout=300000)
    pg.evaluate('window.__stop = true'); time.sleep(1)
    pg.evaluate(SETUP)
    if mode == 'schedule':
        days = int(sys.argv[2]) if len(sys.argv) > 2 else 2
        res = pg.evaluate("""(days) => {
          const g = window.__game, S = g.schedule, out = [];
          const bus = []; const tap = (n) => g.bus.on(n, (d) => bus.push([g.minutes, n, d && (d.event ? d.event.name : d.name || d.kind || d.preset || '') , d && d.on]));
          ['alarm','sfx','schedule:moved','weather:change'].forEach(tap);
          g.composer._r = g.composer.render; g.composer.render = () => {};
          // run systems only (fast): call schedule/weather updates directly in 0.5 game-minute steps
          const sys = g.systems.filter(s => ['schedule','weather'].includes(s.name));
          const start = g.minutes; const end = start + days*1440;
          let sfxN = 0;
          while (g.minutes < end) { g.minutes += 0.5; for (const s of sys) s.update(0.625, 0.625); const W=g.env.weather; for (const k of ['cloud','storm','rain','fog','wind']) W[k] += (W.target[k]-W[k])*(1-Math.exp(-0.625*0.05)); }
          g.composer.render = g.composer._r;
          return { pa: S.paLog.map(l => l.clock + ' d' + Math.floor(l.minutes/1440) + ' ' + l.text), bus: bus.filter(b => b[1] !== 'weather:change' || true).map(b => `${Math.floor(b[0]/1440)} ${String(Math.floor(b[0]%1440/60)).padStart(2,'0')}:${String(Math.floor(b[0]%60)).padStart(2,'0')} ${b[1]} ${b[2]} ${b[3] ?? ''}`), prog: [0,1,2,3,4,5,6].map(d => 'DAY ' + (d+1) + ' — ' + S.THEMES[d+1].name + '\\n' + S.printDay(d)).join('\\n\\n'), fc: JSON.stringify(g.weather.forecast()) };
        }""", days)
        print('=== PA LOG ==='); print('\n'.join(res['pa']))
        print('=== BUS ==='); print('\n'.join(res['bus']))
        print('=== FORECAST ==='); print(res['fc'])
        if len(sys.argv) > 4: print('=== PROGRAMME ==='); print(res['prog'])
    else:
        shots = json.loads(sys.argv[2])
        for s in shots:
            name, cam = s[0], s[1]; h = s[2] if len(s) > 2 else None; d = s[3] if len(s) > 3 else None; o = s[4] if len(s) > 4 else {}
            pg.evaluate(f'__lw.setView({json.dumps(cam)}, {json.dumps(h)}, {json.dumps(d)})')
            if o.get('weather'): pg.evaluate(f"__game.weather.set({json.dumps(o['weather'])}, 0, 1e9)")
            if o.get('js'): logs.append(str(pg.evaluate(o['js'])))
            n = o.get('steps', 40)
            t0 = time.time()
            pg.evaluate(f"__lw.step({n}, {o.get('dt', 1/30)})")
            if o.get('js2'): logs.append(str(pg.evaluate(o['js2'])))
            pg.screenshot(path=os.path.join(ROOT, 'shots', name + '.png'), timeout=240000)
            logs.append(f"{name}: {time.time()-t0:.1f}s " + str(pg.evaluate('JSON.stringify(__game.seaLife ? __game.seaLife.stats() : {})')))
    b.close()
print('\n'.join(l for l in logs if 'GPU stall' not in l and 'swiftshader' not in l.lower())[-6000:])
