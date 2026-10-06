// Installs all gameplay systems onto the game (integration point — owned by the integrator).
// Each workstream module exports an install function; missing modules are skipped so that
// workstreams can be developed and tested independently.
import * as THREE from 'three';
import { deckOfY } from './core/config.js';
import { Interactions } from './systems/interact.js';
import { shared } from './world/materials.js';

const MODULES = [
  // [path, exportName, label]
  ['./core/input.js', 'installInput', 'Input'],
  ['./world/furniture.js', 'installFurniture', 'Furnishing cabins'],
  ['./world/doors.js', 'installDoors', 'Hanging doors'],
  ['./world/elevators.js', 'installElevators', 'Commissioning lifts'],
  ['./world/lights.js', 'installLights', 'Switching on lights'],
  ['./actors/player.js', 'installPlayer', 'Checking in'],
  ['./actors/npcs.js', 'installNPCs', 'Boarding passengers'],
  ['./ui/ui.js', 'installUI', 'Printing the daily programme'],
  ['./systems/economy.js', 'installEconomy', 'Opening accounts'],
  ['./systems/shipSchedule.js', 'installSchedule', 'Scheduling the entertainment'],
  ['./env/weather.js', 'installWeather', 'Reading the barometer'],
  ['./env/seaLife.js', 'installSeaLife', 'Charting the sea lanes'],
  ['./systems/security.js', 'installSecurity', 'Briefing security'],
  ['./systems/combat.js', 'installCombat', 'Locking the armoury'],
  ['./systems/activities.js', 'installActivities', 'Shuffling the decks'],
  ['./systems/missions.js', 'installMissions', 'Writing the story'],
  ['./audio/audio.js', 'installAudio', 'Tuning the band'],
];

export async function installGameplay(game, progress = () => {}) {
  const p = game.params;
  game.interact = new Interactions(game);
  // shared character renderer
  try {
    const { CharacterRenderer } = await import('./actors/characters.js');
    game.chars = new CharacterRenderer(game.scene, { max: 240, camera: game.camera });
    game.addSystem({ name: 'chars', order: 70, update: (dt) => game.chars.update(dt) });
  } catch (e) { console.error('characters failed', e); }

  game.debugCam = p.has('cam') || p.has('shotmode');
  const skip = new Set((p.get('skip') || '').split(',').filter(Boolean));
  for (const [path, fn, label] of MODULES) {
    if (skip.has(fn)) continue;
    try {
      const mod = await import(path);
      if (mod[fn]) { progress(0.9, label); await mod[fn](game); }
    } catch (e) {
      if (!String(e).includes('Failed to fetch') && !String(e).includes('Cannot find module') && !String(e).includes('404')) console.error(`[gameplay] ${path}`, e);
      else console.info(`[gameplay] module not present: ${path}`);
    }
  }

  // wet exterior decks: materials.js floor shader follows the weather's deck wetness (0..1)
  game.addSystem({ name: 'wetDecks', order: 15, update() {
    const w = game.weather?.wetness ?? 0;
    shared.uWet.value += (Math.max(0, Math.min(1, w)) - shared.uWet.value) * 0.05;
  } });

  // ── debug / screenshot helpers ───────────────────────────────────────────
  window.__shot = (cam, h, deck) => {
    const [x, y, z, lx, ly, lz] = cam;
    game.debugCam = true;
    game.camera.position.set(x, y, z); game.camera.lookAt(lx, ly, lz);
    if (h != null) game.minutes = h * 60;
    game.world.setActiveDeck(deck || deckOfY(y + 0.5), 1);
    game.focus = game.camera.position;
    for (let k = 0; k < 3; k++) game.step(0.016);
    return game.renderer.info.render.calls + ' calls';
  };
  if (p.has('cam')) {
    const [x, y, z, lx, ly, lz] = p.get('cam').split(',').map(Number);
    game.camera.position.set(x, y, z); game.camera.lookAt(lx, ly, lz);
    if (p.has('h')) game.minutes = parseFloat(p.get('h')) * 60;
    game.addSystem({ name: 'debugcam', order: 0, update() {
      const d = p.has('deck') ? +p.get('deck') : deckOfY(game.camera.position.y + 0.5);
      game.world.setActiveDeck(d, 1);
    } });
  } else if (!game.player) {
    game.world.setActiveDeck(9, 1);
  }
}
