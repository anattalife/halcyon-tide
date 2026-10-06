# Alternate approaches added in round 2: M2 via Cutter purchase + Bilge jacket, M4 via big win + croupier swap,
# M5 via bridge tour, M10 tender escape. Real interactions via game.interact.query → run.
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__)); os.environ.setdefault('PORT','8785')
import shot; from shot import ROOT,PORT,route; from playerTest import HELPERS
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b=pw.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1280,'height':720})
    logs=[]; pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type=='error' else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}')); pg.route('**/*',route)
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?notitle=1')
    pg.wait_for_function('window.__game&&window.__game.player&&window.__game.frame>1',timeout=300000)
    pg.evaluate('window.__stop=true'); time.sleep(0.3); pg.evaluate(HELPERS); pg.evaluate('__pt.fast(true)')
    pg.evaluate(r'''window.__mt={runInteract(sub){const g=__game,P=g.player;const ctx={player:P,deck:P.deck,x:P.x,y:P.y,z:P.z,yaw:P.yaw,room:P.room};const list=g.interact.query(ctx,6);const it=list.find(i=>i.id&&i.id.includes(sub));if(!it)return 'noint:'+list.map(i=>i.id).join(',');if(it.enabled===false)return 'disabled:'+(it.reason||'');it.run(P,g);return 'ran:'+it.id;}};''')
    js=lambda c: pg.evaluate(c)
    def step(n=30): pg.evaluate(f'__pt.step({n})')
    def tp(d,x,z,y=0): pg.evaluate(f'(()=>{{__game.player.teleport({d},{x},{z},{y});__pt.camYaw({y});}})()')
    def ms(i): return js(f'__game.missions.state("{i}").status')
    def how(i): return js(f'(__game.missions.engine.completed.find(c=>c.id==="{i}")||{{}}).how')
    def skip(i): js(f'__game.missions.skipTo("{i}")')
    def runi(s): return js(f'__mt.runInteract({json.dumps(s)})')
    res={}
    def check(l,c): res[l]=c; print(('  OK  ' if c else ' FAIL ')+l)

    print('== M2 buy from Cutter ==')
    skip('undertow_2'); js('__game.economy.cash=500'); tp(2,42,3.6,0); step(40)
    print(' fence:', js('JSON.stringify((()=>{const f=__game.npcs.list.find(n=>n.tag==="fence");return f&&{x:f.x,z:f.z}})())'))
    print(' buy:', runi('mapp:cutter_card')); step(5)
    tp(6,13.5,6,3.14); step(20); check('M2 via Cutter', ms('undertow_2')=='completed' and how('undertow_2')=='bought from Cutter')

    print('== M2 Bilge jacket ==')
    js('__game.inventory.remove("crew_keycard",1)'); skip('undertow_2'); tp(2,37.9,3.6,0); step(20)
    print(' lift:', runi('mapp:bilge_jacket')); step(5)
    tp(6,13.5,6,3.14); step(20); check('M2 via Bilge jacket', ms('undertow_2')=='completed' and how('undertow_2')=='lifted it in the crew bar')

    print('== M4 win big ==')
    skip('undertow_4'); js('__game.minutes=2*1440+14*60'); tp(5,62,0,0); step(20)
    js('__game.bus.emit("activity:blackjack",{net:250}); __game.bus.emit("activity:roulette",{net:200,n:7})'); step(10)
    check('M4 win-big watched cage', js('!!__game.missions.flags.cage_watched'))
    tp(5,82.5,16.8,0); step(10); print(' records:', runi('mact:cage_swap')); step(15)
    check('M4 via win big', ms('undertow_4')=='completed' and how('undertow_4')=='won big')

    print('== M4 croupier fill swap ==')
    js('delete __game.missions.flags.cage_watched; delete __game.missions.flags.cage_evidence; delete __game.missions.flags.m4_how')
    skip('undertow_4'); js('__game.player.wearDisguise("croupier")'); tp(5,81.5,17.2,0); step(20)
    print(' dbg:', js('JSON.stringify({dis:__game.player.disguise,st:__game.player.state,act:__game.missions.state("undertow_4").status,f:__game.missions.flags.cage_evidence,d:__game.player.deck,x:__game.player.x,z:__game.player.z})'))
    print(' swap:', runi('mapp:cage_fill_swap')); step(15)
    check('M4 via croupier swap', ms('undertow_4')=='completed' and how('undertow_4')=='swapped the fill')
    js('__game.player.removeDisguise()')

    print('== M5 bridge tour ==')
    js('delete __game.missions.flags.route_log'); skip('undertow_5'); js('__game.minutes=1440+10*60+40'); step(5)
    print(' tour on:', js('__game.schedule.isOn("bridge-tour")'))
    tp(4,4,9.5,0); step(20); print(' join:', runi('mapp:bridge_tour')); time.sleep(1.5); step(30)
    print(' at:', js('JSON.stringify({d:__game.player.deck,r:__game.player.room&&__game.player.room.name})'))
    print(' log:', runi('mact:route_log')); step(20)
    check('M5 via bridge tour', ms('undertow_5')=='completed' and how('undertow_5')=='bridge tour')
    pg.evaluate('__pt.fast(false)'); step(3); pg.screenshot(path=os.path.join(ROOT,'shots','m5_bridge_tour.png'),timeout=240000); pg.evaluate('__pt.fast(true)')

    print('== M10 tender escape ==')
    skip('undertow_10'); step(5); js('__game.security.setHeat(3)'); tp(3,22,-11,0); step(20)
    print(' esc:', runi('mapp:tender_escape')); time.sleep(11); step(10)
    check('M10 tender ending', js('__game.missions.flags.ending')=='tender' and ms('undertow_10')=='completed')

    print('\n=== RESULTS ==='); print(f'{sum(res.values())}/{len(res)} passed')
    errs=[l for l in logs if 'GPU stall' not in l]; print('CONSOLE ERRORS:',len(errs))
    for l in errs[:20]: print(l[:300])
    b.close()
