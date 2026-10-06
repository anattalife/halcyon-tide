# Loads the real game headlessly, installs the audio system from a test harness (no gameplay.js edits),
# drives the camera through several spaces, fires every bus event, and reports console errors + live levels.
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from shot import PORT, route
from playwright.sync_api import sync_playwright

INSTALL = """
async () => {
  const m = await import('/src/audio/audio.js');
  const g = window.__game;
  const a = m.installAudio(g);
  a.unlock();
  await new Promise(r => setTimeout(r, 300));
  // tap the master bus with an analyser for live level checks
  const an = a.ctx.createAnalyser(); an.fftSize = 4096; a.mix.lim.connect(an);
  window.__an = an;
  const am = a.ctx.createAnalyser(); am.fftSize = 8192; a.mix.ch.music.out.connect(am);
  window.__lvlM = () => { const d = new Float32Array(am.fftSize); am.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v; return +(10 * Math.log10(s / d.length + 1e-12)).toFixed(1); };
  window.__lvl = () => { const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let s = 0, p = 0; for (const v of d) { s += v * v; p = Math.max(p, Math.abs(v)); } return { rmsDb: +(10 * Math.log10(s / d.length + 1e-12)).toFixed(1), peak: +p.toFixed(3) }; };
  return a.ctx.state;
}
"""

SPOTS = [
    # name, camera [x,y,z,lx,ly,lz] (eye = deckY(d)+1.6), hour, weather
    ('sun_terrace16', [-128, 40.6, 0, -110, 40.6, 0], 14, None),
    ('pool_deck15', [23.5, 37.6, 3, 40, 37.6, 3], 14, None),
    ('promenade5', [-23.5, 7.6, 19.3, 0, 7.6, 19.3], 14, None),
    ('atrium4', [13.5, 4.6, 0, 20, 4.6, 0], 15, None),
    ('piano_bar4', [68.5, 4.6, 0, 80, 4.6, 0], 21, None),
    ('outside_piano4', [45, 4.6, 0, 80, 4.6, 0], 21, None),
    ('casino5', [68.5, 7.6, 0, 80, 7.6, 0], 22, None),
    ('club6', [-65, 10.6, 0, -60, 10.6, 0], 23, None),
    ('pub5', [-65, 7.6, 0, -60, 7.6, 0], 20, None),
    ('theatre_show4', [116.5, 4.6, 0, 125, 4.6, 0], 20, None),
    ('kids16', [-65, 40.6, 0, -60, 40.6, 0], 11, None),
    ('cabin_corr9', [-19.8, 19.6, 9.5, 0, 19.6, 9.5], 14, None),
    ('galley4', [-101.5, 4.6, 0, -95, 4.6, 0], 14, None),
    ('laundry1', [35, -4.4, 10.5, 40, -4.4, 10.5], 14, None),
    ('engine1', [-125.5, -4.4, 10.5, -110, -4.4, 10.5], 14, None),
    ('storm_terrace16', [-128, 40.6, 0, -110, 40.6, 0], 14, {'wind': 1, 'storm': 1, 'rain': 1, 'cloud': 1, 'fog': 0.2}),
    ('storm_corr9', [-19.8, 19.6, 9.5, 0, 19.6, 9.5], 14, {'wind': 1, 'storm': 1, 'rain': 1, 'cloud': 1, 'fog': 0.2}),
]

EVENTS = """
async () => {
  const g = window.__game, b = g.bus, c = g.camera.position, d = 5;
  const p = { x: c.x + 3, y: c.y - 1.6, z: c.z + 1, deck: g.audio.listener.deck };
  const names = %s;
  for (const n of names) { b.emit('sfx', { name: n, ...p }); await new Promise(r => setTimeout(r, 40)); }
  for (const s of ['carpet','wood','tile','steel','teak','water','rubber','marble']) b.emit('footstep', { ...p, surface: s, run: true });
  const plan = g.world.plans[5];
  const types = {}; for (const dr of plan.doors) if (!types[dr.type]) types[dr.type] = dr;
  for (const t in types) b.emit('door:move', { deck: 5, door: types[t].id, opening: true });
  b.emit('elevator:move', { car: 'mid-S1', moving: true });
  b.emit('elevator:arrive', { car: 'mid-S1', deck: 5 });
  b.emit('heat:change', { level: 4 });
  b.emit('mission:complete', {}); b.emit('mission:failed', {});
  b.emit('announce', { text: 'Good afternoon ladies and gentlemen, this is your cruise director.', chime: true });
  b.emit('bark', { text: 'Excuse me!', x: p.x, y: p.y, z: p.z, deck: p.deck, voice: { pitch: 1.1, rate: 1, sex: 'f' } });
  b.emit('alarm', { kind: 'fire', on: true, deck: 5 });
  b.emit('alarm', { kind: 'security', on: true, deck: 5 });
  b.emit('alarm', { kind: 'muster', on: true });
  b.emit('combat:shot', { weapon: 'pistol', ...p });
  g.audio.setVolume('music', 0.6); g.audio.mute(true); g.audio.mute(false);
  await new Promise(r => setTimeout(r, 1500));
  const lvl = window.__lvl();
  b.emit('alarm', { kind: 'fire', on: false }); b.emit('alarm', { kind: 'security', on: false }); b.emit('alarm', { kind: 'muster', on: false });
  b.emit('elevator:move', { car: 'mid-S1', moving: false }); b.emit('heat:change', { level: 0 });
  return { lvl, voices: g.audio.voices, state: g.audio.debugState() };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 960, 'height': 540})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    pg.goto(f'http://127.0.0.1:{PORT}/index.html')
    pg.wait_for_function('window.__game && window.__game.frame > 2', timeout=240000)
    print('ctx', pg.evaluate(INSTALL))
    # the game loop is slow under SwiftShader; drive the audio update from a timer so context tracks the camera
    pg.evaluate("""() => { const g = window.__game; window.__stop = true; setInterval(() => { try { g.audio.update(0.05, 0.05); } catch (e) { console.error('audio update', e); } }, 50); }""")
    for name, cam, hour, weather in SPOTS:
        pg.evaluate(f"""() => {{ const g = window.__game; const [x,y,z,lx,ly,lz] = {json.dumps(cam)}; g.camera.position.set(x,y,z); g.camera.lookAt(lx,ly,lz); g.camera.updateMatrixWorld(); g.minutes = {hour} * 60;
            const w = g.env.weather; Object.assign(w, {json.dumps(weather or {'wind': 0.3, 'storm': 0, 'rain': 0, 'cloud': 0.25, 'fog': 0})}); w.target = null; }}""")
        time.sleep(3.5)
        st = pg.evaluate('() => ({ lvl: window.__lvl(), m: window.__lvlM(), s: window.__game.audio.debugState() })')
        s = st['s']; beds = ' '.join(f'{k}:{v}' for k, v in s['beds'].items() if v > 0.001)
        print(f"{name:16s} music {st['m']:6.1f} rms {st['lvl']['rmsDb']:6.1f} dB  peak {st['lvl']['peak']:.3f}  deck {s['listener']['deck']:2d} room {str(s['listener']['room'])[:34]:34s} ext {int(bool(s['listener']['exterior']))} bands {s['bands']}  voices {s['voices']}\n{'':18s}{beds}")
    r = pg.evaluate(EVENTS % json.dumps(pg.evaluate("() => import('/src/audio/sfx.js').then(m => m.SFX_NAMES)")))
    print('after events', r['lvl'], 'voices', r['voices'], 'bands', r['state']['bands'], 'tension', r['state']['tension'])
    time.sleep(3)
    print('final', pg.evaluate('() => window.__lvl()'))
    errs = [l for l in logs if ('error' in l.lower() or 'warn' in l.lower()) and 'GPU stall' not in l and 'swiftshader' not in l.lower()]
    print('console errors/warnings:', len(errs))
    for l in errs[:30]: print('  ', l[:300])
    b.close()
