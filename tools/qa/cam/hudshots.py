import json, subprocess, os, sys
pre = sys.argv[1]
S = [["hour", 11], ["tp", 5, 20, 19.2, 1.57], ["step", 20],
 ["js", "(()=>{try{__game.security.setHeat(3);}catch(e){} try{__game.combat.give('pistol');__game.combat.select('pistol');}catch(e){} try{__game.bus.emit('bark',{text:'Dispatch, possible suspect on Promenade, deck five.',ctx:'security_radio'});}catch(e){} return 'heat '+__game.security.heat;})()"],
 ["step", 20], ["shot", pre+"_1280_sec"],
 ["size", 1920, 1080], ["step", 3], ["shot", pre+"_1920_sec"],
 ["js", "(()=>{const r=e=>{const b=e&&e.getBoundingClientRect();return b&&b.width?[Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]:null};const q=s=>r(document.querySelector(s));return JSON.stringify({obj:q('.obj'),wp:q('.wpchip'),tr:q('.tr'),mm:q('.mm'),loc:q('.loc'),toasts:q('.toasts'),notes:q('.notes'),heat:q('.sh-heat'),weapon:q('.sh-weapon'),radio:q('.sh-radio')});})()"],
 ["size", 1280, 720], ["step", 3],
 ["js", "(()=>{const r=e=>{const b=e&&e.getBoundingClientRect();return b&&b.width?[Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]:null};const q=s=>r(document.querySelector(s));return JSON.stringify({obj:q('.obj'),wp:q('.wpchip'),tr:q('.tr'),mm:q('.mm'),loc:q('.loc'),toasts:q('.toasts'),notes:q('.notes'),heat:q('.sh-heat'),weapon:q('.sh-weapon'),radio:q('.sh-radio')});})()"],
 ["js", "(()=>{try{__game.security.setHeat(0);__game.security.clear();}catch(e){} __game.ui.openPanel('map'); return 'map';})()"], ["raf", 0.8], ["ushot0", pre+"_panel_map"],
 ["js", "(()=>{__game.ui.openPanel('journal');return 'journal';})()"], ["ushot0", pre+"_panel_journal_t0"],
 ["js", "(()=>{__game.ui.openPanel('inventory');return 'inv';})()"], ["ushot0", pre+"_panel_inv_t0"],
]
subprocess.run(['python3', 'tools/qa/cam/uidrv.py', json.dumps(S)], env=dict(os.environ, PORT='8793'))
