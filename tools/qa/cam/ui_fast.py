# fast DOM-level UI checks (PORT 8793): python3 tools/qa/cam/ui_fast.py <prefix>
import json, sys, subprocess, os
pre = sys.argv[1]
S = [
 ["log", "'hint opacity '+getComputedStyle(document.querySelector('.ph-hint')).opacity+' webdriver '+navigator.webdriver"],
 ["js", "(()=>{const u=__game.ui;u.openPanel('map');return 'map open';})()"], ["raf", 0.6], ["ushot0", pre+"_map"],
 ["js", "(()=>{const u=__game.ui;const t=performance.now();u.openPanel('journal');const dt=performance.now()-t;const n=[...document.querySelectorAll('.hx > .pnl')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.className+' op='+getComputedStyle(e).opacity);return 'switch '+dt.toFixed(1)+'ms mounted='+JSON.stringify(n)+' scrim='+document.querySelector('.scrim').className;})()"],
 ["ushot0", pre+"_journal_instant"],
 ["js", "(()=>{const u=__game.ui;const t=performance.now();u.openPanel('inventory');const dt=performance.now()-t;const n=[...document.querySelectorAll('.hx > .pnl')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.className);return 'inv '+dt.toFixed(1)+'ms mounted='+JSON.stringify(n);})()"],
 ["ushot0", pre+"_inv_instant"],
 ["js", "(()=>{const u=__game.ui;const t=performance.now();u.openPanel('map');const dt=performance.now()-t;const n=[...document.querySelectorAll('.hx > .pnl')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.className);return 'map again (cached) '+dt.toFixed(1)+'ms mounted='+JSON.stringify(n);})()"],
 ["ushot0", pre+"_map_again"],
 ["js", "__game.ui.closePanel(); 'closed'"], ["raf", 0.5],
 ["js", "'after close: visible pnl '+[...document.querySelectorAll('.hx > .pnl')].filter(e=>getComputedStyle(e).display!=='none').length+' scrim '+document.querySelector('.scrim').className+' paused '+__game.paused"],
 ["tp", 9, 31.4, 8.0, 0], ["step", 40],
 ["log", "'prompt before tp: '+document.querySelector('.ph-prompt').className+' | '+document.querySelector('.ph-label').textContent"],
 ["js", "(()=>{__game.player.teleport(5,20,19.2,1.57);return 'prompt right after tp: '+document.querySelector('.ph-prompt').className+' best='+(__game.player.interaction.best&&__game.player.interaction.best.label);})()"],
 ["step", 2], ["log", "'prompt 2 frames after tp: '+document.querySelector('.ph-prompt').className"],
 ["js", "(()=>{const ist=__game.player.interaction;ist.best={id:'stale',label:'Open door',x:-100,z:0,y:6,deck:5,enabled:true};__game.playerHud.update(1/60,ist);return 'stale far target: '+document.querySelector('.ph-prompt').className;})()"],
]
if '--noshot' in sys.argv: S = [c for c in S if c[0] not in ('ushot0','ushot','shot','raf')]
env = dict(os.environ, PORT='8793')
subprocess.run(['python3', 'tools/qa/cam/uidrv.py', json.dumps(S)], env=env)
