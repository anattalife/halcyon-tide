// HALCYON TIDE (mobile) — installs the phone layer onto the game (called by gameplay.js when game.mobile).
//   game.mobileHud  (mobileHud.js: touch controls, phone HUD, layout editor, settings, haptics)
//   game.mobileRes  (mobileQuality.js: adaptive resolution scaler)
import { MobileHud } from './mobileHud.js';
import { installAdaptiveResolution } from './mobileQuality.js';

export function installMobile(game) {
  installAdaptiveResolution(game);
  if (game.input) game.input.lastDevice = 'touch';
  // "Click to look around" is a pointer-lock hint: never relevant on touch
  if (game.playerHud) game.playerHud._everLocked = true;
  const hud = game.mobileHud = new MobileHud(game);
  game.addSystem({ name: 'mobileHud', order: 97, runWhilePaused: true, lateUpdate() { hud.update(); } });
  // touch input must be applied before the player reads it (player order 20)
  game.addSystem({ name: 'touchInput', order: 1, runWhilePaused: true, update() { hud.controls.update(); } });
  window.__mobile = hud;
  return hud;
}
