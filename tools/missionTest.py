# Mission walkthrough driver for Halcyon Tide. Loads the real game once and runs scripted
# walkthroughs that drive the REAL systems (teleport between steps; objectives complete from game state).
# Usage: PORT=8785 python3 tools/missionTest.py [scenario]
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('PORT', '8785')
import shot
from shot import ROOT, PORT, route
from playerTest import HELPERS
from playwright.sync_api import sync_playwright

SCEN = sys.argv[1] if len(sys.argv) > 1 else 'all'

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error',) else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    pg.route('**/*', route)
    pg.goto(f'http://127.0.0.1:{PORT}/index.html?notitle=1')
    pg.wait_for_function('window.__game && window.__game.player && window.__game.frame > 1', timeout=300000)
    pg.evaluate('window.__stop = true'); time.sleep(0.3)
    pg.evaluate(HELPERS)
    pg.evaluate('window.__pt.fast(true)')

    def js(code): return pg.evaluate(code)
    def step(n=30): pg.evaluate(f'__pt.step({n})')
    def setmin(m): pg.evaluate(f'__game.minutes = {m}')
    def tp(deck,x,z,yaw=0): pg.evaluate(f'(()=>{{__game.player.teleport({deck},{x},{z},{yaw}); __pt.camYaw({yaw});}})()')
    def shotpng(name):
        pg.evaluate('window.__pt.fast(false)'); pg.evaluate('__pt.step(3)')
        pg.screenshot(path=os.path.join(ROOT,'shots',name+'.png'), timeout=240000)
        pg.evaluate('window.__pt.fast(true)')
    def mstate(id): return js(f'JSON.stringify(__game.missions.state("{id}"))')
    def auto(v): pg.evaluate(f'__game.missions._setAutoAnswer({json.dumps(v)})')
    def flag(k,v=True): pg.evaluate(f'__game.missions.flags[{json.dumps(k)}]={json.dumps(v)}')

    results = {}
    def check(label, cond):
        results[label] = cond
        print(('  OK  ' if cond else ' FAIL ') + label)

    os.makedirs(os.path.join(ROOT,'shots'), exist_ok=True)

    # expose a helper on the page to run the interaction at the player's feet by id-substring
    pg.evaluate(r'''window.__mt = {
      runInteract(sub){ const g=__game,P=g.player; const ctx={player:P,deck:P.deck,x:P.x,y:P.y,z:P.z,yaw:P.yaw,room:P.room};
        const list=g.interact.query(ctx, 6); const it=list.find(i=>i.id&&i.id.includes(sub)); if(!it) return 'noint:'+list.map(i=>i.id).join(',');
        if(it.enabled===false) return 'disabled:'+(it.reason||''); it.run(P,g); return 'ran:'+it.id; },
      talk(key){ const n=__game.missions.cast.get(key); if(!n||!n._talk) return 'notalk'; n._talk.run(__game.player,__game); return 'talked'; },
      nearCast(key){ const n=__game.missions.cast.get(key); return n?{deck:n.deck,x:+n.x.toFixed(1),z:+n.z.toFixed(1)}:null; }
    };''')

    def runi(sub): return js(f'__mt.runInteract({json.dumps(sub)})')
    def talk(key): return js(f'__mt.talk({json.dumps(key)})')

    # ───────────────────────────────────────────────────────────────────────
    def m1_explore():
        print('\n== M1 All Aboard (explore) ==')
        auto('in')
        setmin(17*60+20)          # after muster, day 0
        tp(6, 13.5, 6, 3.14); step(20)
        # talk beat active: run Teodor's talk
        print('talk:', talk('teodor'))
        step(20)
        check('M1 complete', 'completed' in mstate('undertow_1'))
        shotpng('m1_teodor_lantern')

    def m2_cutter():
        print('\n== M2 Ship\'s Business (buy from Cutter) ==')
        js('__game.inventory.add("crew_keycard",1)')   # represents buying/ lifting a crew card
        step(10)
        tp(6,13.5,6,3.14); step(20)
        check('M2 complete', 'completed' in mstate('undertow_2'))

    def m2_pickpocket():
        print('\n== M2 (force/pickpocket variant via master key) ==')
        # alternate: a master key also satisfies
        pass

    def m3_disguise():
        print('\n== M3 Uniform Code (disguise + photo ledger) ==')
        js('__game.player.wearDisguise("crew_steward")')
        step(10)
        tp(2,-23,-5,0); step(20)            # payroll office, beside the desk (-24,-4.5)
        print('ledger:', runi('mact:payroll_ledger'))
        step(15)
        check('M3 complete', 'completed' in mstate('undertow_3'))
        shotpng('m3_payroll_disguise')

    def m3_safe():
        print('\n== M3 alt (crack payroll safe) ==')
        # reset via skipTo not needed; just checking the alt action exists
        pass

    def m4_cage():
        print('\n== M4 House Edge (watch cage + records) ==')
        pg.evaluate('__game.missions.skipTo("undertow_4")')
        setmin(2*1440 + 12*60)             # day 2 noon, casino lively
        step(10)
        tp(5,68,0,0); step(20)             # casino floor
        tp(5,80,10,0)                      # near cage window
        pg.evaluate('__game.missions.vars.cageWatch=200; __game.missions.flags.cage_watched=true')
        step(10)
        tp(5,82.5,16.8,0); step(5)         # inside cage, beside the records safe
        print('records:', runi('mact:cage_swap'))
        step(15)
        check('M4 complete', 'completed' in mstate('undertow_4'))
        shotpng('m4_casino_cage')

    def m5_bridge():
        print('\n== M5 Dead Reckoning (officer whites, route log) ==')
        pg.evaluate('__game.missions.skipTo("undertow_5")')
        setmin(4*1440 + 2*60)              # night
        js('__game.player.wearDisguise("crew_officer")')
        tp(13,116,0,0); step(20)           # chart room, beside the chart table (115,0)
        print('routelog:', runi('mact:route_log'))
        step(15)
        check('M5 complete', 'completed' in mstate('undertow_5'))
        shotpng('m5_bridge_night')

    def m6_bonded():
        print('\n== M6 Below the Waterline (bonded store + escape) ==')
        pg.evaluate('__game.missions.skipTo("undertow_6")')
        js('__game.player.wearDisguise("crew_engineer")')
        tp(1,9,10.5,0); step(25)           # inside bonded store
        print('crate:', runi('mact:bonded_crate'))
        step(20)
        # escape: go up to deck 3
        tp(3,15,11,0); step(20)
        check('M6 complete', 'completed' in mstate('undertow_6'))
        shotpng('m6_bonded_store')

    def m7_storm():
        print('\n== M7 Storm Front (protect journalist) ==')
        pg.evaluate('__game.missions.skipTo("undertow_7")')
        pg.evaluate('__game.weather.set("storm",2)')
        setmin(3*1440 + 23*60)
        tp(6,150,0,0); step(30)            # mooring deck bow, spawns thugs
        print('cast pike:', js('JSON.stringify(__mt.nearCast("pike"))'))
        auto('inside')
        print('talk pike:', talk('pike'))
        step(10)
        # fought variant: KO the thugs
        js('(()=>{const g=__game; for(const n of g.npcs.list) if(n.tag==="thug") g.npcs.knockOut(n,99);})()')
        step(20)
        check('M7 complete', 'completed' in mstate('undertow_7'))
        shotpng('m7_storm_mooring')

    def m8_gala():
        print('\n== M8 The Gala (bribe purser) ==')
        pg.evaluate('__game.missions.skipTo("undertow_8")')
        js('__game.economy.cash = 3000; __game.player.money=3000')
        tp(2,-22.5,4.5,0); step(20)        # purser office
        auto('pay')
        print('talk daan:', talk('daan'))
        step(15)
        check('M8 complete', 'completed' in mstate('undertow_8'))
        check('M8 has master key', js('JSON.stringify(__game.player.keycards.has("master"))')=='true')

    def m9_suite():
        print('\n== M9 Owner\'s Suite (crack safe) ==')
        pg.evaluate('__game.missions.skipTo("undertow_9")')
        js('__game.inventory.add("safe_note",1)')   # have code → fast crack
        tp(14,103.5,14,0); step(25)        # inside suite, beside the safe (102.5,15)
        print('safe:', runi('mact:owner_safe'))
        step(10)
        tp(14,100.5,0,0); step(15)         # leave suite
        check('M9 complete', 'completed' in mstate('undertow_9'))
        check('M9 has ledger', js('JSON.stringify(__game.inventory.has("ledger"))')=='true')
        shotpng('m9_owner_suite')

    def m10_finale():
        print('\n== M10 Undertow (finale: Okafor ending) ==')
        pg.evaluate('__game.missions.skipTo("undertow_10")')
        step(10)
        tp(2,-51,5.9,3.14); step(15)       # security office / Okafor
        auto('give')
        print('talk okafor:', talk('okafor'))
        time.sleep(11)       # finale plays a fade+title sequence on real timers
        step(10)
        check('M10 complete', 'completed' in mstate('undertow_10'))
        check('ending set', js('JSON.stringify(__game.missions.flags.ending)')=='"okafor"')
        shotpng('m10_finale')

    scen = {
      'm1':m1_explore,'m2':m2_cutter,'m3':m3_disguise,'m4':m4_cage,'m5':m5_bridge,
      'm6':m6_bonded,'m7':m7_storm,'m8':m8_gala,'m9':m9_suite,'m10':m10_finale,
    }
    if SCEN == 'all':
        for fn in [m1_explore,m2_cutter,m3_disguise,m4_cage,m5_bridge,m6_bonded,m7_storm,m8_gala,m9_suite,m10_finale]:
            try: fn()
            except Exception as e: print('EXC', fn.__name__, repr(e))
    else:
        scen[SCEN]()

    print('\n=== RESULTS ===')
    ok = sum(1 for v in results.values() if v); tot=len(results)
    print(f'{ok}/{tot} checks passed')
    errs = [l for l in logs if 'GPU stall' not in l]
    print('CONSOLE ERRORS:', len(errs))
    for l in errs[:30]: print(l[:300])
    b.close()
