# Halcyon Tide

An open-world action game set entirely aboard **MS Halcyon Tide**, a life-size 330 m, 17-deck cruise ship on a seven-night Atlantic crossing. Built with Three.js; everything (ship, characters, textures, music and sound) is generated procedurally in the browser. No asset files.

## Play it

The game is plain ES modules with no build step, but browsers won't load modules from `file://`, so serve the folder over HTTP:

```sh
cd halcyon-tide
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, etc.). An internet connection is needed: Three.js r169 and the fonts load from public CDNs. Use a desktop browser with a keyboard and mouse; a dedicated GPU helps. If it stutters, lower the graphics quality in the pause menu.

## On a phone

Open the hosted site on your phone. Phones and tablets are sent to the touch version (`mobile.html`) automatically; add `?desktop` to the address to force the desktop version.
To get a full-screen app icon without browser bars:
- **iPhone:** open the site in Safari → Share → **Add to Home Screen**, then launch it from the icon.
- **Android:** open it in Chrome → ⋮ → **Install app** or **Add to Home screen**.

Hosting: the repo is ready for GitHub Pages (Settings → Pages → Deploy from branch → `main` / root). Free Pages needs a public repo; private repos need a paid GitHub plan.

## Controls

| Action | Key |
|---|---|
| Move | WASD / arrows |
| Look | Mouse (click to capture, Esc to release) |
| Sprint / crouch / jump | Shift / C / Space |
| Interact / alternate | E / F |
| Aim / attack | Right / left mouse |
| Weapons | 1–5, mouse wheel; R reload |
| Map / inventory / journal / pause | M / Tab / J / Esc |
| Surrender | Hold H |
| First person | V |

## What's in it

- **The ship:** about 4,300 rooms on 17 decks, including 1,721 passenger staterooms and 388 crew cabins, venues, crew corridors, machinery spaces and the bridge. Stairs, elevators and doors all work.
- **People:** up to about 160 passengers and crew at once, following a daily schedule.
- **Security:** witnesses and CCTV report crimes; heat runs 0–5 with lockdowns, disguises and the brig.
- **Combat:** melee, takedowns, baton, taser, pistol and fire extinguisher. Non-lethal play is supported.
- **Activities:** casino (slots, blackjack, roulette), shops, bars, pickpocketing, burglary, odd jobs and 40 hidden medallions.
- **Story:** "Undertow", a 10-mission campaign with multiple approaches and six endings, plus side encounters and contracts.
- **World:** day/night, weather up to a full storm, sea life, passing ships, a daily entertainment programme and ship announcements.
- **Saves:** stored in the browser's local storage.

## Project layout

- `index.html`: entry point and import map
- `src/main.js`: boot, renderer, main loop. `src/gameplay.js` installs the gameplay systems.
- `src/world/`: ship layout generator, deck geometry, hull, furniture, doors, elevators, lighting
- `src/actors/`: characters, player, camera, NPCs and navigation
- `src/systems/`: security, combat, economy, activities, missions, schedule, saves
- `src/env/`: sky, ocean, weather, sea life
- `src/audio/`: procedural audio and music
- `src/ui/`: HUD, map, menus, dialogue, title screen
- `docs/ARCHITECTURE.md`: coordinates, data model and system contracts. Read this before changing code.
- `tools/`: headless test and screenshot harnesses (Playwright + Python). These expect a local copy of Three.js r169 in `vendor/` (`build/` and `examples/jsm/` from the three.js repo).

Layout checks run in Node: `node tools/connectivity.mjs` and `node tools/layoutTest.mjs`.
