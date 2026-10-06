# camera test views: python3 tools/qa/cam/views.py <prefix> [subset,comma]  (PORT 8793)
import json, sys, subprocess, os
pre = sys.argv[1]; sub = [a for a in sys.argv[2].split(',') if a] if len(sys.argv) > 2 else None
sub = sub or None
CI = "JSON.stringify({p:[__game.player.x.toFixed(2),__game.player.z.toFixed(2),__game.player.room&&__game.player.room.name],cam:__pt.camInfo(),int:+(__game.cameraRig.intK||0).toFixed(2),sw:+(__game.cameraRig.swingS||0).toFixed(2),side:+(__game.cameraRig.sideS||0).toFixed(2),fov:+__game.camera.fov.toFixed(1)})"
V = [
 ('cab9147_a', [9, 31.4, 7.3, 3.14], 0.12),
 ('cab9147_b', [9, 30.2, 5.0, 0.0], 0.12),
 ('cab9147_c', [9, 31.0, 6.0, 1.57], 0.12),
 ('cab8049_in', [8, 13.9, 12.5, 0.0], 0.12),
 ('cab8049_in2', [8, 13.0, 16.5, 3.14], 0.12),
 ('cab8049_bal', [8, 13.2, 19.5, 1.57], 0.12),
 ('lift', [9, -11.25, 9.6, 3.14], 0.12),
 ('lift_ride', [9, -11.25, 9.6, 0.0], 0.12),
 ('corr9', [9, 0, 9.5, 1.57], 0.12),
 ('shops5', [5, 35, 0, 1.57], -0.35),
 ('shop_in', [5, 36, 8, 0.0], 0.12),
 ('prom5', [5, 20, 19.2, 1.57], -0.3),
 ('stair', [9, -9.5, 1.0, -1.57], 0.12),
]
script = [["hour", 11]]
for name, tp, pitch in V:
    if sub and name not in sub: continue
    if name.startswith('lift'):
        script += [["js", "(()=>{const E=__game.elevators;const c=E.car('mid-S2');E.call('mid-S2',9);for(let i=0;i<3000&&!(Math.abs(c.y-18)<0.05&&c.door>0.95);i++)__game.step(1/30);return 'car '+c.y.toFixed(2)+' door '+c.door.toFixed(2);})()"]]
    script += [["tp", *tp]]
    if name.startswith('lift'): script += [["js", "(()=>{const P=__game.player;P.x=-11.25;P.z=7.3;P._updateRoom&&P._updateRoom(true);for(let k=0;k<10;k++)__game.step(1/30);return 'in '+P.state;})()"]]
    if name == 'lift_ride': script += [["js", "(()=>{const p=__game.player;__game.elevators.ride(p,'mid-S2',15);for(let i=0;i<200;i++)__game.step(1/30);return 'ride '+p.deck;})()"]]
    script += [["cam", tp[3], pitch], ["step", 90], ["log", f"'{name} '+" + CI]]
    if '--noshot' not in sys.argv: script += [["shot", pre + '_' + name]]
env = dict(os.environ, PORT='8793')
subprocess.run(['python3', 'tools/qa/qa.py', json.dumps(script)], env=env)
