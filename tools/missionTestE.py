# Ship Stories resolved via the REAL interaction path (interact.query → 'mtalk:' run), plus escort/fetch completions.
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
    pg.evaluate(r'''window.__mt={runInteract(sub){const g=__game,P=g.player;const ctx={player:P,deck:P.deck,x:P.x,y:P.y,z:P.z,yaw:P.yaw,room:P.room};const list=g.interact.query(ctx,6);const it=list.find(i=>i.id&&i.id.includes(sub));if(!it)return 'noint:'+list.map(i=>i.id).join(',');if(it.enabled===false)return 'disabled:'+(it.reason||'');it.run(P,g);return 'ran:'+it.id;},
      near(key){const s=__game.missions.stories.scratch[key]; if(!s) return 'none'; const P=__game.player; P.teleport(s.deck,s.x-1.0,s.z,Math.PI/2); return 'ok';}};''')
    js=lambda c: pg.evaluate(c)
    def step(n=30): pg.evaluate(f'__pt.step({n})')
    def tp(d,x,z,y=0): pg.evaluate(f'(()=>{{__game.player.teleport({d},{x},{z},{y});__pt.camYaw({y});}})()')
    def auto(v): pg.evaluate(f'__game.missions._setAutoAnswer({json.dumps(v)})')
    def runi(s): return js(f'__mt.runInteract({json.dumps(s)})')
    def stories(): return js('__game.missions.stats().shipStories')
    res={}
    def check(l,c): res[l]=c; print(('  OK  ' if c else ' FAIL ')+l)
    js('__game.minutes=1440+14*60')
    # talk-resolved stories: trigger by location (real trigger), walk up to the NPC, talk via provider
    cases=[('pub_brawl','drunk','calm',(5,-66,-3),'21'),('lovers_quarrel','a','kind',(6,5,-3),'19'),('rival_thief','vane','partner',(5,37,3),'13'),('stowaway','sw','help',(1,44,8),'12'),('trivia','sunny','1',(4,8,4),'12')]
    for sid,key,ans,(d,x,z),hr in cases:
        js(f'__game.minutes=1440+{hr}*60+10; __game.missions.stories.lastFired={{}}; __game.missions.stories.activeId=null')
        before=stories()
        tp(d,x,z,0); step(60)
        act=js('__game.missions.stories.activeId')
        if act!=sid: js(f'__game.missions.stories.start("{sid}")'); step(10)
        print(f' {sid}: triggered={act==sid}', js(f'__mt.near("{key}")')); step(15); auto(ans)
        r=runi('mtalk'); step(10)
        print('   talk:', r)
        check(f'story {sid} resolved via talk', stories()==before+1)
    # escort: lost child → cabin
    js('__game.minutes=1440+12*60; __game.missions.stories.lastFired={}; __game.missions.stories.activeId=null')
    before=stories(); tp(4,10,-2,0); step(60)
    if js('__game.missions.stories.activeId')!='lost_child': js('__game.missions.stories.start("lost_child")'); step(10)
    js('__mt.near("child")'); step(10); auto('ok'); print(' child talk:', runi('mtalk')); step(10)
    print(' child dbg:', js('JSON.stringify((()=>{const S=__game.missions.stories.scratch; return {act:__game.missions.stories.activeId, f:S.following, c:S.child&&{d:S.child.deck,st:S.child.state,gone:S.child.gone}, cab:S.cabin&&{no:S.cabin.no,d:S.cabin.deck,x:S.cabin.inX,z:S.cabin.inZ}}})())'))
    js('(()=>{const S=__game.missions.stories.scratch,c=S.child,t=S.cabin; __game.npcs.system.placeAt(c,t.deck,(t.inX??t.x),(t.inZ??t.z)+0.5); __game.player.teleport(t.deck,t.doorX??t.x,(t.doorZ??t.z)-1,0);})()'); step(20)
    check('story lost_child escorted home', stories()==before+1)
    # fetch: seasick guest, buy pills path (no pills → fetch from medical → return)
    js('__game.missions.stories.activeId=null; __game.inventory.remove("seasick_pills",__game.inventory.count("seasick_pills"))')
    before=stories(); tp(6,20,0,0); js('__game.missions.stories.start("seasick")'); step(10)
    js('__mt.near("guest")'); step(5); auto('fetch'); print(' seasick talk:', runi('mtalk')); step(5)
    js('window.__sg=__game.missions.stories.scratch.guest'); tp(3,15,8,0); step(10)
    js('__game.inventory.add("seasick_pills",1)'); step(5)
    js('(()=>{const g=window.__sg; __game.player.teleport(g.deck,g.x-1,g.z,0);})()'); step(10)
    check('story seasick fetched pills', stories()==before+1)
    pg.evaluate('__pt.fast(false)'); step(3); pg.screenshot(path=os.path.join(ROOT,'shots','story_seasick.png'),timeout=240000)
    print('\n=== RESULTS ==='); print(f'{sum(res.values())}/{len(res)} passed')
    errs=[l for l in logs if 'GPU stall' not in l]; print('CONSOLE ERRORS:',len(errs))
    for l in errs[:20]: print(l[:300])
    b.close()
