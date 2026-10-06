# UI checks (PORT 8793): python3 tools/qa/cam/ui.py <prefix>
import json, sys, subprocess, os
pre = sys.argv[1]
S = [["hour", 11],
 ["tp", 9, 31.4, 7.3, 3.14], ["step", 30],
 ["log", "'hint '+getComputedStyle(document.querySelector('.ph-hint')).opacity+' webdriver '+navigator.webdriver"],
 # panels: map -> journal -> inventory, count mounted panels and timing
 ["js", "(()=>{const u=__game.ui;u.openPanel('map');return 'map open';})()"], ["step", 3], ["ushot", pre+"_map"],
 ["js", "(()=>{const u=__game.ui;const t=performance.now();u.openPanel('journal');const dt=performance.now()-t;const n=[...document.querySelectorAll('.hx > .pnl')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.className);return 'switch '+dt.toFixed(1)+'ms mounted='+JSON.stringify(n)+' scrim='+document.querySelector('.scrim').className;})()"],
 ["ushot0", pre+"_journal_instant"],
 ["js", "(()=>{const u=__game.ui;u.openPanel('inventory');const n=[...document.querySelectorAll('.hx > .pnl')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.className);return 'inv mounted='+JSON.stringify(n);})()"],
 ["ushot0", pre+"_inv_instant"],
 ["js", "(()=>{const u=__game.ui;u.openPanel('map');const t=performance.now();u.openPanel('map');const n=[...document.querySelectorAll('.hx > .pnl')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.className);u.closePanel();return 'back to map mounted='+JSON.stringify(n);})()"],
 ["raf", 0.5],
 ["js", "'after close: pnl nodes '+[...document.querySelectorAll('.hx > .pnl')].filter(e=>getComputedStyle(e).display!=='none').length+' scrim '+document.querySelector('.scrim').className+' paused '+__game.paused"],
 # prompt after teleport
 ["tp", 9, 31.4, 8.0, 0], ["step", 20],
 ["log", "'prompt before tp: '+document.querySelector('.ph-prompt').className+' | '+document.querySelector('.ph-label').textContent"],
 ["js", "(()=>{__game.player.teleport(5,20,19.2,1.57);return 'prompt right after tp: '+document.querySelector('.ph-prompt').className+' best='+(__game.player.interaction.best&&__game.player.interaction.best.label);})()"],
 ["step", 2],
 ["log", "'prompt 2 frames after tp: '+document.querySelector('.ph-prompt').className"],
 # distance hints
 ["js", "(()=>{const u=__game.ui,p=__game.player;const out=[];u.setObjective({id:'t1',title:'Test',text:'',target:{deck:5,x:p.x+14,z:p.z,label:'Same deck'}});__game.step(1/60);out.push(document.querySelector('.obj .d span').textContent);u.setObjective({id:'t1',title:'Test',text:'',target:{deck:7,x:p.x+48,z:p.z}});__game.step(1/60);out.push(document.querySelector('.obj .d span').textContent);u.setObjective({id:'t1',title:'Test',text:'',target:{x:p.x+14,z:p.z,label:'No deck'}});__game.step(1/60);out.push(document.querySelector('.obj .d span').textContent);u.setObjective({id:'t1',title:'Test',text:'',target:{deck:0,x:p.x+14,z:p.z,label:'Deck 0'}});__game.step(1/60);out.push(document.querySelector('.obj .d span').textContent);return out.join(' | ');})()"],
 ["js", "__game.ui.clearObjective('t1'); __game.ui.setObjective({id:'t2',title:'Meet Teodor',text:'Find Teodor Brask at The Lantern.',steps:[{text:'Take the muster drill',done:true},{text:'Meet Teodor at The Lantern (deck 6)'}],target:{deck:6,x:-60,z:0,label:'The Lantern'}}); 'ok'"],
 ["js", "__game.missions && (__game.missions.paused = true); 'ok'"], ["tp", 5, 20, 19.2, 1.57], ["step", 20], ["shot", pre+"_hud1280"],
 ["size", 1920, 1080], ["step", 5], ["shot", pre+"_hud1920"],
 # with security HUD elements visible (heat, weapon) for overlap check
 ["js", "(()=>{try{__game.security.setHeat(3);}catch(e){} try{__game.combat.give('pistol');__game.combat.select('pistol');}catch(e){} return 'heat '+__game.security.heat;})()"], ["step", 10], ["shot", pre+"_hud1920_sec"],
 ["size", 1280, 720], ["step", 5], ["shot", pre+"_hud1280_sec"],
 ["js", "(()=>{try{__game.security.setHeat(0);__game.security.clear();}catch(e){} return 'ok';})()"],
 # lift ride 9 -> 15
 ["js", "(()=>{const E=__game.elevators;const c=E.car('mid-S2');E.call('mid-S2',9);for(let i=0;i<3000&&!(Math.abs(c.y-18)<0.05&&c.door>0.95);i++)__game.step(1/30);return 'car '+c.y.toFixed(2);})()"],
 ["tp", 9, -11.25, 9.6, 3.14], ["goto", -11.25, 7.0], ["step", 10],
 ["js", "(()=>{const p=__game.player;__game.elevators.ride(p,'mid-S2',15);for(let i=0;i<300;i++)__game.step(1/30);return p.state+' car y '+__game.elevators.car('mid-S2').y.toFixed(2)+' '+document.querySelector('.liftp').className+' '+document.querySelector('.liftp').textContent;})()"],
 ["cam", 0, 0.12], ["step", 2], ["shot", pre+"_lift_ride"],
]
env = dict(os.environ, PORT='8793')
subprocess.run(['python3', 'tools/qa/cam/uidrv.py', json.dumps(S)], env=env)
