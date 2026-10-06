# Framed screenshots of key mission scenes (cast + action in view).
import sys, os, json, time
WHICH = sys.argv[1] if len(sys.argv) > 1 else 'a'
sys.path.insert(0, os.path.dirname(__file__)); os.environ.setdefault('PORT','8785')
import shot; from shot import ROOT,PORT,route; from playerTest import HELPERS
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b=pw.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1280,'height':720})
    pg.route('**/*',route); pg.goto(f'http://127.0.0.1:{PORT}/index.html?notitle=1')
    pg.wait_for_function('window.__game&&window.__game.player&&window.__game.frame>1',timeout=300000)
    pg.evaluate('window.__stop=true'); time.sleep(0.3); pg.evaluate(HELPERS); pg.evaluate('__pt.fast(true)')
    def setmin(m): pg.evaluate(f'__game.minutes={m}')
    def tp(d,x,z,y=0): pg.evaluate(f'(()=>{{__game.player.teleport({d},{x},{z},{y});__pt.camYaw({y});}})()')
    def step(n=30): pg.evaluate(f'__pt.step({n})')
    def ensure(k): pg.evaluate(f'__game.missions.cast.ensure("{k}")')
    def move(k,d,x,z,y=0): pg.evaluate(f'(()=>{{const n=__game.missions.cast.ensure("{k}"); __game.npcs.system.placeAt(n,{d},{x},{z}); n.yaw={y};}})()')
    def cam(y,p=0): pg.evaluate(f'__pt.camYaw({y},{p})')
    def shoot(name):
        pg.evaluate('window.__pt.fast(false)'); pg.evaluate('__pt.step(4)')
        pg.screenshot(path=os.path.join(ROOT,'shots',name+'.png'),timeout=240000)
        pg.evaluate('window.__pt.fast(true)'); print('shot',name)

    if WHICH == 'a':
        # 1 Teodor at The Lantern — face the bar (bar at z10.6, player at z6 → yaw 0 faces +z)
        setmin(18*60+30); ensure('teodor'); pg.evaluate('__game.missions.start("undertow_1")')
        tp(6,11.3,8.6,0); step(10); cam(0,0.05); shoot('scene_teodor_lantern')

        # 3 Payroll office infiltration in disguise
        pg.evaluate('__game.missions.skipTo("undertow_3"); __game.player.wearDisguise("crew_steward")')
        setmin(1440+1*60); tp(2,-21,-4.5,-1.5708); step(10); cam(-1.5708,0.08); shoot('scene_payroll_disguise')

        # 5 Bridge at night — officer whites, chart room area
        pg.evaluate('__game.missions.skipTo("undertow_5"); __game.player.wearDisguise("crew_officer")')
        setmin(4*1440+2*60); ensure('reyes'); move('reyes',13,124,0,-1.5708)
        tp(13,120,0,1.5708); step(10); cam(1.5708,0.0); shoot('scene_bridge_night')

    if WHICH == 'b':
        # 7 Storm on the mooring deck with the journalist
        pg.evaluate('__game.missions.skipTo("undertow_7"); __game.weather.set("storm",1)')
        setmin(4*1440+1*60); move('pike',6,150,0,3.14)
        tp(6,145,0,0); step(20); cam(0,0.02); shoot('scene_storm_mooring')

        # 9 Owner's suite safe
        pg.evaluate('__game.missions.skipTo("undertow_9")')
        tp(14,104,13,0); step(10); cam(-0.6,0.05); shoot('scene_owner_suite')

        # 10 Finale — Okafor, security office deck 2
        pg.evaluate('__game.missions.skipTo("undertow_10")')
        ensure('okafor'); move('okafor',2,-52,5,0)
        tp(2,-52,2.5,0); step(10); cam(0,0.05); shoot('scene_finale_okafor')
    b.close()
