// HALCYON TIDE — activities (game.activities). Installs casino, bars/dining, shops,
// pickpocketing, burglary, fence/pawn, odd jobs, wellness, and the 40 collectible medallions.
// gameplay.js calls installActivities(game). Everything guards game.ui/security/save and
// provides fallbacks, so each activity works whether or not those workstreams are present.
// game.activities.crimeMode (bool): when true (or the player is crouched) crime prompts — Pickpocket, Pocket it,
// Takedown — outrank social prompts; otherwise they sit on F at low priority and never hide Talk/Sit/Buy/Open.
// Saved under game.save key 'activities' (job, searched containers, intox, crimeMode).
import * as RULES from './activities/casinoRules.js';
import { registerCasino } from './activities/casino.js';
import { registerVendors } from './activities/vendors.js';
import { registerCrime } from './activities/crime.js';
import { registerJobs } from './activities/jobs.js';
import { registerCollectibles } from './activities/collectibles.js';
import { Panel, toast } from './activities/ui.js';
import { ITEMS, keycardFor } from './inventory.js';

export async function installActivities(game) {
  if (!game.interact) { console.warn('[activities] no interaction system; skipping'); return null; }
  const A = game.activities = {
    rules: RULES,
    job: null,
    _bribed: false,
    toast: (t, k) => toast(game, t, k),
  };

  // Each sub-system registers interaction providers and attaches helpers to A.
  try { registerCasino(game, A); } catch (e) { console.error('[activities] casino', e); }
  try { registerVendors(game, A); } catch (e) { console.error('[activities] vendors', e); }
  try { registerCrime(game, A); } catch (e) { console.error('[activities] crime', e); }
  try { registerJobs(game, A, { ui: { Panel }, items: { ITEMS } }); } catch (e) { console.error('[activities] jobs', e); }
  try { registerCollectibles(game, A); } catch (e) { console.error('[activities] collectibles', e); }

  // natural intox decay over time (screen sway handled by camera/postfx workstream)
  game.addSystem({
    name: 'intox', order: 73,
    update(dt) {
      const p = game.player; if (!p) return;
      if (p.intox > 0) {
        const before = p.intox;
        p.intox = Math.max(0, p.intox - dt * 0.0015);   // ~ slow sober-up
        if (Math.abs(before - p.intox) > 0.02) game.bus?.emit('player:intox', { intox: p.intox });
      }
    },
  });

  // save / load: current odd job (room service target + time left), searched burglary containers, intoxication,
  // the casino's bribed flag and crime mode
  game.save?.register?.('activities', {
    save: () => {
      const j = A.job;
      const job = j && j.type === 'roomservice' ? { type: j.type, no: j.target?.no, deck: j.target?.deck, left: j.deadline - game.minutes, reward: j.reward } : null;
      return { v: 1, job, searched: [...(A._searched || [])].slice(-400), intox: game.player?.intox || 0, bribed: !!A._bribed, crimeMode: !!A.crimeMode };
    },
    load: (d) => {
      if (!d) return;
      A._searched = new Set(d.searched || []);
      A._bribed = !!d.bribed; A.crimeMode = !!d.crimeMode;
      if (game.player) { game.player.intox = d.intox || 0; game.bus?.emit('player:intox', { intox: game.player.intox }); }
      if (A.job && A.job.type === 'roomservice') { game.ui?.clearObjective?.('job'); if (game.player?.held === 'tray') game.player.held = 'none'; }
      A.job = null;
      const j = d.job;
      if (j && j.type === 'roomservice') {
        const target = (game.layout?.cabins || []).find(c => c.no === j.no && (j.deck == null || c.deck === j.deck));
        if (target) {
          A.job = { type: 'roomservice', target, stage: 'deliver', deadline: game.minutes + (j.left ?? 5), reward: j.reward || 60 };
          if (game.player) game.player.held = 'tray';
          game.ui?.setObjective?.({ id: 'job', title: 'Room service', text: `Deliver to stateroom ${target.no} on deck ${target.deck}`, target: { deck: target.deck, x: target.x, z: target.z, label: 'Stateroom ' + target.no } });
        }
      }
    },
  });

  console.info('[activities] installed: casino, bars/dining, shops, pickpocket, burglary, fence, jobs, wellness, 40 medallions');
  return A;
}

export { ITEMS, keycardFor };
