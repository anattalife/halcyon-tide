# Second-approach walkthroughs: prove each main mission completes via a DIFFERENT path than missionTest.py.
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('PORT', '8785')
import shot
from shot import ROOT, PORT, route
from playerTest import HELPERS
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type=='error' else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?notitle=1')
    pg.wait_for_function('window.__game && window.__game.player && window.__game.frame > 1', timeout=300000)
    pg.evaluate('window.__stop=true'); time.sleep(0.3); pg.evaluate(HELPERS); pg.evaluate('__pt.fast(true)')
    pg.evaluate(r'''window.__mt={runInteract(sub){const g=__game,P=g.player;const ctx={player:P,deck:P.deck,x:P.x,y:P.y,z:P.z,yaw:P.yaw,room:P.room};const list=g.interact.query(ctx,6);const it=list.find(i=>i.id&&i.id.includes(sub));if(!it)return 'noint:'+list.map(i=>i.id).join(',');if(it.enabled===false)return 'disabled:'+(it.reason||'');it.run(P,g);return 'ran';},talk(k){const n=__game.missions.cast.get(k);if(!n||!n._talk)return 'notalk';n._talk.run(__game.player,__game);return 'talked';}};''')
    def js(c): return pg.evaluate(c)
    def step(n=30): pg.evaluate(f'__pt.step({n})')
    def setmin(m): pg.evaluate(f'__game.minutes={m}')
    def tp(d,x,z,y=0): pg.evaluate(f'(()=>{{__game.player.teleport({d},{x},{z},{y});__pt.camYaw({y});}})()')
    def ms(i): return js(f'JSON.stringify(__game.missions.state("{i}"))')
    def auto(v): pg.evaluate(f'__game.missions._setAutoAnswer({json.dumps(v)})')
    def runi(s): return js(f'__mt.runInteract({json.dumps(s)})')
    def talk(k): return js(f'__mt.talk({json.dumps(k)})')
    def skip(i): pg.evaluate(f'__game.missions.skipTo("{i}")')
    res={}
    def check(l,c): res[l]=c; print(('  OK  ' if c else ' FAIL ')+l)

    # M2 alt: master key instead of crew card
    print('\n== M2 alt (master key) ==')
    skip('undertow_2'); js('__game.inventory.add("master_key",1)'); step(5)
    tp(6,13.5,6,3.14); step(20); check('M2 via master key', 'completed' in ms('undertow_2'))

    # M3 alt: crack the payroll safe instead of photographing the ledger
    print('\n== M3 alt (payroll safe) ==')
    skip('undertow_3'); js('__game.player.wearDisguise("crew_housekeeping"); __game.inventory.add("safe_note",1)')
    tp(2,-16,-6.8,0); step(20)          # beside payroll safe (-15.2,-6.8)
    print('safe:', runi('mact:payroll_safe'))
    step(15); check('M3 via safe', 'completed' in ms('undertow_3'))

    # M5 alt: crack the Captain's safe instead of the chart table
    print('\n== M5 alt (captain safe) ==')
    skip('undertow_5'); js('__game.player.wearDisguise("crew_officer"); __game.inventory.add("drill",1)')
    tp(13,109.5,18,0); step(20)         # beside captain safe (110.8,18)
    print('capsafe:', runi('mact:captain_safe'))
    step(15); check('M5 via captain safe', 'completed' in ms('undertow_5'))

    # M7 alt: escort the journalist inside (follow) instead of fighting
    print('\n== M7 alt (escort inside) ==')
    skip('undertow_7'); js('__game.weather.set("storm",2)'); setmin(4*1440+1*60)
    tp(6,150,0,0); step(30)
    auto('inside'); print('talk pike:', talk('pike')); step(10)
    # move pike inside the superstructure (x<134) to satisfy the escort condition
    js('(()=>{const p=__game.missions.cast.get("pike"); if(p){__game.npcs.system.placeAt(p,6,120,0); p.goal={type:"follow",target:"player"}; p.state="follow";}})()')
    tp(6,118,0,0); step(20)
    check('M7 via escort', 'completed' in ms('undertow_7'))
    print('how:', js('JSON.stringify(__game.missions.engine.completed.find(c=>c.id==="undertow_7"))'))

    # M8 alt: pickpocket Varga at the gala (simulate the pickpocket bus event)
    print('\n== M8 alt (pickpocket Varga) ==')
    js('__game.inventory.remove("master_key",1)'); skip('undertow_8'); step(5)
    js('(()=>{const v=__game.missions.cast.ensure("varga"); __game.bus.emit("activity:pickpocket",{success:true,victim:v});})()')
    step(15); check('M8 via pickpocket', 'completed' in ms('undertow_8'))
    print('how:', js('JSON.stringify(__game.missions.engine.completed.find(c=>c.id==="undertow_8"))'))

    # M10 alt: the journalist ending
    print('\n== M10 alt (Pike ending) ==')
    skip('undertow_10'); step(10)
    tp(6,41,0,0)
    js('(()=>{const p=__game.missions.cast.ensure("pike"); __game.npcs.system.placeAt(p,6,41,2);})()')
    step(5); auto('give'); print('talk pike:', talk('pike')); time.sleep(11); step(10)
    check('M10 Pike ending', js('JSON.stringify(__game.missions.flags.ending)')=='"pike"')

    print('\n=== RESULTS ==='); ok=sum(1 for v in res.values() if v); print(f'{ok}/{len(res)} passed')
    errs=[l for l in logs if 'GPU stall' not in l]; print('CONSOLE ERRORS:',len(errs))
    for l in errs[:20]: print(l[:300])
    b.close()
