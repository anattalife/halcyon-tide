# HALCYON TIDE — architecture notes (read before changing anything)

Open-world action game aboard **MS Halcyon Tide**, a 330 m × 41 m cruise ship (17 decks, ~5,200 passengers, ~1,900 crew).
Three.js r169 (ES modules via importmap: `three`, `three/addons/...`). No build step, no npm. Plain browser JS.

## Coordinates & scale (metres, everything life-size)
- +X toward the bow (x ∈ [-165, 165]), +Z starboard, +Y up. Waterline y = -2.
- Deck d floor height: `deckY(d) = -6 + (d-1)*3` (deck 5 = y 6, deck 9 = y 18, deck 15 = y 36). Deck-to-deck 3.0 m.
- People: adult eye ≈ 1.62 m above floor, shoulder width ≈ 0.45 m, collision radius 0.3 m. Doors 1.0 m wide, 2.1 m high.
- `src/core/config.js` holds SHIP, GRID (0.5 m cells, x0=-165, z0=-25, nx=660, nz=100), CORES (passenger stair/elevator cores at x=-85,-10,92), CREW_CORES, TIME, QUALITY_PRESETS.

## The ship is data first
- `src/world/shipLayout.js` → `buildShipLayout()` returns `{ plans[1..17], cabins, stats }`.
- `src/world/plan.js` `DeckPlan`: `room` Int16Array per cell (room id), `rooms[]` (type, name, zone public/private/crew/restricted, floor/wall/ceil finishes, bounds x0..x1/z0..z1, cx/cz, light, exterior, isVoid, ramp, pool, cabin no …), `doors[]` (normal 'x'|'z', line, a0..a1, x, z, type cabin|swing|glass|crew|watertight|balcony|elevator, access 'none'|'crew'|'officer'|'security'|'engineer'|'casino'|'vip'|'cabin:NNNN', rooms [a,b]), `items[]` (furniture: t, x, z, rot, room, plus extras), `pois[]` (NPC usable anchors: x,z,rot,pose sit|lie|stand|work|run, act eat|drink|gamble|watch|sunbathe|relax|shop|view|work|…, role bartender|clerk|dealer|cook|officer|guard|…), `cabins[]`, `signs[]`, `cores[]`.
- Edge arrays per plan: `ex[k]` (between cell i and i+1) and `ez[k]` (between j and j+1): 0 none, 1 wall, 2 door (`dx`/`dz` = door id), 3 rail, 4 facade, 6 glass rail. `block[k]` = cell blocked by furniture/void/shaft (navigation).
- Furniture footprints and NPC anchors: `src/world/furnitureDefs.js` (`FDEF`).
- Stairs: rooms with `ramp {xb, xt, dy}`; walking the `up` lane from xb→xt climbs 3 m; when relative height passes +1.5 the actor's deck becomes d+1 (on d+1 the same cells are the `down` lane). `world.floorY(d,x,z)` gives the absolute floor height including ramps and pools.

## Runtime
- `src/main.js` `Game`: `renderer, scene, camera, composer, bus (EventBus), world, layout, env, minutes (game clock, minutes since day-0 00:00), hour, day, paused, timeScale, quality`. `game.addSystem({name, order, update(dt, realDt), lateUpdate?, runWhilePaused?})`. Systems run sorted by `order`.
- `src/gameplay.js` installs gameplay systems (owned by the integrator; workstreams expose `install(game)` functions that it calls).
- `src/world/world.js` `World`: `setActiveDeck(d)` streams interior detail for d±1; queries: `roomAt(d,x,z)`, `roomId`, `floorY(d,x,z)`, `collide(d,x,z,r)` (walls/doors/furniture), `lineClear(d,x0,z0,x1,z1)` (vision), `door(d,id)` runtime door state `{open 0..1, target, lockedState}`, `doorsNear(d,x,z,r)`.
- Rendering of decks: `src/world/deckBuilder.js`. Materials: `src/world/materials.js` — **use `patchSurface(material)` on any MeshStandardMaterial that can appear indoors** and supply a float attribute `aInt` (vertex or instanced, 0 outdoors … ~1 lit interior) or set `material.userData.intDefault.value`. Interiors are lit by this baked term (`shared.uIntLight`) not by the sun.
- Environment `src/env/environment.js`: sky, Gerstner ocean, sun/moon, fog, weather `{cloud, storm, rain, fog, wind}`, ship motion.
- Game time: 1 game minute = 1.25 real seconds.

## Event bus conventions (`game.bus.emit(name, data)`)
- `sfx` {name, x, y, z, deck, vol}          — one-shot positional sound request
- `footstep` {x,y,z,deck,surface,run,actor}  — surface: carpet|wood|tile|steel|teak|water|rubber|marble
- `door:move` {deck, door, opening}          — door started opening/closing
- `elevator:arrive` {car, deck}, `elevator:move` {car, moving}
- `announce` {text, chime:true}              — PA announcement (text shown in UI + spoken)
- `crime` {type, severity, x, y, z, deck, actor, victim}
- `alarm` {deck, kind:'security'|'fire'|'muster', on}
- `combat:shot` {weapon, x,y,z, deck}, `combat:hit` {...}
- `player:enterRoom` {room, deck}, `world:activeDeck` d
- `ui:toast` {text, kind}, `ui:objective` {...}
- `mission:*`, `heat:change` {level}

## Testing
- `python3 tools/multishot.py '[["name",[camx,camy,camz,lookx,looky,lookz],hour,deck], ...]' [query]` → screenshots in `shots/`. Loads once, uses `window.__shot`.
- Headless Chrome uses SwiftShader (slow: ~1–3 fps). Do not judge FPS from it.
- `node tools/layoutTest.mjs` / `node tools/connectivity.mjs` validate the ship layout.
- Rule: never break existing systems; keep modules self-contained; prefer adding new files over editing others' files.

## Shared runtime contracts (all workstreams)
### Characters — `src/actors/characters.js`
`CharacterRenderer(scene,{max,camera})` with `add(appearance)→id`, `set(id,{x,y,z,yaw,anim,speed,interior,visible,held,aim,look})`, `update(dt)`, `headPos/handPos(id,out)`, `hitTest(origin,dir,maxDist)`, `setAppearance`, `remove`. `makeAppearance(rng,{role,sex,age,dress})`. Anim names: idle walk run sprint crouch_idle crouch_walk sit sit_bar lie sleep talk phone drink eat dance clap cheer wave swim tread_water slots deal_cards wipe_bar cook type carry_tray push_cart sweep guard radio point hands_up cower flee punch takedown knocked_out hit_react stagger aim_pistol fire_pistol aim_taser swing_baton drag climb dead.
The game creates ONE shared renderer: `game.chars` (max ≈ 240). Player and NPCs both allocate from it.

### Player — `game.player` (src/actors/player.js)
Fields: `x,y,z,deck,yaw,vx,vz,speed, room (room object|null), roomId, exterior(bool), inWater(bool), crouch(bool), sprint(bool), charId, appearance, disguise (role string|null), health(0..100), stamina, held ('none'|...), state ('free'|'elevator'|'seated'|'cutscene'|'dead'|'arrested'), elevator (car id|null), invisibleTo?`.
Methods: `teleport(deck,x,z,yaw)`, `setAppearance(app)`, `lockControls(bool)`, `sitAt(poi)`, `standUp()`, `damage(amount, source)`.
Player emits `player:enterRoom`, `player:deck`, `footstep`.

### Input — `game.input` (src/core/input.js)
`down(code)`, `pressed(code)` (edge this frame), `released(code)`, `mouse {dx,dy,buttons, wheel}`, `pointerLocked`, `setContext('play'|'ui')`. Codes are KeyboardEvent.code values ('KeyE', 'ShiftLeft', 'Space', 'Mouse0', 'Mouse2').

### Interactions — `game.interact` (src/systems/interact.js)
`game.interact.addProvider(ctx => [...])`. See file header for the Interaction shape. The player system queries it each frame, shows the best prompt and runs it on key press (or hold).

### Doors — `game.doors` (src/world/doors.js)
Runtime door state lives in `world.door(deck,id)` → `{open 0..1, target 0|1, lockedState, forcedOpen, access, type, lastUse}`; `world.doorBlocks()` treats open<0.7 as closed.
API: `game.doors.request(deck, id, who)` → true if it opens for that actor (checks `canPass(actor, door)`), `game.doors.canPass(actor, door)` (actor: player or npc with `access:Set` / `keycards`), `game.doors.lock(deck,id,bool)`, `game.doors.forceOpen(deck,id)`. Doors auto-close ~3 s after last use; glass doors open automatically for anyone approaching (≤1.8 m) who may pass; watertight doors close slowly; cabin doors only open for keyholders, crew with master keys (stewards), or when picked/forced.
Door ⇒ bus `door:move`.

### Elevators — `game.elevators` (src/world/elevators.js)
Cars per core (`aft-S1`…, `svc-cA`…). API: `call(carGroupOrCore, deck)`, `cars` list `{id, core, y, deck (nearest), doorOpen 0..1, moving, queue}`, `ride(actor, carId, targetDeck)`. Player rides by standing in the car (shaft room) and choosing a deck (UI). NPCs may `useAbstract(npc, fromDeck, toDeck, core)` → they vanish into the lobby and reappear after the travel time.

### NPCs — `game.npcs` (src/actors/npcs.js)
`countNear(x,y,z,r)`, `list` (embodied NPCs: `{id, charId, role, name, deck, x, y, z, yaw, state, activity, goal, appearance, access:Set, alert, health, persona}`), `query(deck,x,z,r)`, `spawnAt(...)`, `get(id)`, hooks `npc.onEvent(evt)` for reactions. Emits `npc:*`.

## Implemented systems (wave 1–2) — read the source headers for details
- `src/world/furniture.js` (`game.furniture`: meshesFor, setItemHidden), `furnitureModels.js`, `propsTech.js`, `propsGeo.js`.
- `src/world/doors.js` (`game.doors`: canPass, reasonFor, request, open, close, lock, unlock, forceOpen, unlockWith(deck,id,'pick'|'card'|'force',actor), isLocked, state, occupied). Restricted doors start locked; anyone inside a secured room may exit.
- `src/world/elevators.js` (`game.elevators`: cars, car(id), call, ride, useAbstract, nearestCore, eta, setDisabled). Player ride sets player.state='elevator', player.elevator.
- `src/world/lights.js` (`game.lights`: setEmergency, blackout, …).
- `src/core/input.js` (`game.input`), `src/actors/player.js` (`game.player`, PLAYER_TUNING; extras: inventory placeholder {items:Map,has,add,remove,count}, keycards Set, money, cabin/homeCabin, aiming, aimPitch, noise 0..1, wearDisguise(role), removeDisguise(), playAnim(name,secs), heal, revive, hasAccess), `src/actors/cameraRig.js` (`game.cameraRig`: yaw, pitch, lookDir, camPos, shake, kick, setMode), `src/ui/playerHud.js` (`game.playerHud`: interaction prompt, crosshair; setVisible).
- `src/actors/npcs.js` + nav/schedule/population/names (`game.npcs`: list, count, countNear, query, nearest, get, fromChar(charId), spawnAt(role,deck,x,z,{name,job,access,dress,goal,tag,seed}), setGoal(npc, goal{type:'move'|'use'|'idle'|'follow'|'wander'|'patrol'|'flee',...}), broadcast(type,x,y,z,deck,radius), kill, knockOut, damage, remove, setDensity, simulate, stats). NPC fields: identity {name, cash, valuables, cabin, keycard, persona, nationality}, access Set, alert, perception.canSee(x,y,z,deck), onEvent(evt). Bus out: bark, footstep, npc:spawn/despawn/deck/arrived/goalFailed/alerted/respond/report/bumped/dead/ko/wake. Listens: combat:shot, crime, alarm.
- `src/audio/*` (`game.audio`: playSfx(name,{x,y,z,deck,vol}), announce(text,chime), setAlarm, setHeat(0..5), sting('success'|'failure'), setVolume(channel,v) …).

## Implemented systems (wave 3) — concise API index (module headers are authoritative)
**UI extras** (`src/ui/ui.js`, hud.js, panels.js, mapPanel.js, dialogue.js, title.js, securityHud.js)
- `game.ui` beyond the contract below: `setWaypoint({deck,x,z,label}|null)`, `waypoint`, `objective`, `currentObjective()`, `completeObjective(id)`, `confirm(title,text)→Promise<bool>`, `isBusy()`, `titleActive`, `showTitleScreen()`, `quitToTitle()`, `loadSlot(n)`, `settings`/`getSetting`/`setSetting`, `setHudVisible`, `hideHud(reason,on)`, `sfx(name)`, `hud`, `map`.
- Bus in: `ui:toast`, `ui:notify`, `ui:objective`, `bark` (subtitle ≤14 m), `announce` (PA subtitle), `mission:complete`, `save:done`, `sealife:sighting` (toast unless `minor`). Bus out: `ui:panel`, `ui:waypoint`, `ui:title`, `game:newGame`, `game:continue`.
- Journal/phone (J): tabs Objectives · **Tides Today** (`schedule.today()` theme/dress/sun times + `weather.forecast()` + programme) · Messages · Stats. Heat is drawn only by `securityHud.js` (ship's-wheel icons, top-centre); the HUD no longer has its own heat diamonds. `playerHud` "Click to look around" sits 30 % from the bottom (above PA captions).
- `game.save` (src/systems/save.js): `register(key,{save,load})`, `saveSlot(n)`, `loadSlot(n)`, `hasSave(n)`, `autosave()`, `info(n)`, `latest()`, `keys()`; bus `save:done|loaded|error`, `save:ready` (emitted once at install — systems installed before the UI register on it). Registered keys: see "Missions, saves & gameplay APIs" below.

**Economy / inventory / activities**
- `game.economy`: `cash`, `credit`, `add`, `spend(amount, reason, {account:'credit', cabin})` (charging another cabin = `crime` fraud), `history`. §180 cash + §250 credit at start.
- `game.inventory` + `ITEMS`/`keycardFor(no)`: weapons carry `weapon:'baton'|'taser'|'pistol'|'extinguisher'`, outfits carry `role`.
- `game.activities` (src/systems/activities.js + activities/*): casino (chips = `casino_chips`, rules in `activities.rules`), bars/dining/shops (intox `player.intox`, shoplifting), pickpocket/burglary/fence, odd jobs (room service, deckhand chores, photos), spa/gym, 40 collectible medallions. Bus: `player:intox`.

**Security / combat**
- `game.security`: `heat` 0..5 (`heatValue`), `status`, `known`, `isWanted`, `description`/`describe()`, `lastKnown`, `seen`, `suspicion`, `report(crime)`, `addHeat`, `clear`, `setHeat`, `cameras`, `camerasSeeing`, `setCamerasEnabled`, `breakCamera`, `obscureCameras`, `cctvDown`, `loopFeed`, `wipeRecordings`, `lockdown(on,deck)`, `arrest()`, `record`, `evidenceLocker`, `jailed`, `ai` (securityAI.js), `crime` (crime.js), `hud`, `cctv`.
  Bus out: `heat:change {level,prev,status}`, `alarm {kind:'security'}`, `security:report|arrest|released|suspicious|cctv|radio`, `power:cut`. Witness pipeline (guards/crew/passengers/CCTV) in crime.js; guard modes patrol/investigate/respond/confront/chase/cuff/search/return in securityAI.js (radio barks use bark `ctx:'security_radio'`).
- `game.combat`: `weapon`, `weaponId`, `owned`, `give`, `take`, `select`, `ammo`, `taserReadyIn`, `extCharge`, `holster()`, `confiscate()`, `blocking`, `surrendering`, `stunned`, `dragging`, `attackPlayer(npc, kind)`, `rayWorld(...)`, `fx` (weapons.js CombatFX). Bus out: `combat:shot {weapon,x,y,z,deck,silenced,actor}`, `combat:hit {weapon,target,part,damage,lethal,by}`, `combat:weapon`, `combat:bodyFound`, `player:stunned`, `player:surrender`, `sfx`.

**Schedule / weather / sea life**
- `game.schedule` (shipSchedule.js): `CREW` (`captain` 'Captain Rhiannon Holt', `securityChief` 'Security Chief Ines Okafor' — same names as the missions cast), `events`, `voyageDay`, `day(gd)`, `current()`, `next(n)`, `isOn(key)`, `today()`, `eventsAt(room)`, `attendance(room)` 0..1, `position()`, `musterStations` (deck-5 lifeboat stations), `say(text,opts)`, `paLog`. Bus: `schedule:start|end|day|moved`, `announce` (`local:true` = in-venue speech, no chime), `alarm {kind:'muster', on, drill}`, `sfx ship_horn {dur}`.
- `game.weather` (env/weather.js): `set(preset, transitionMin, holdMin)`, `auto()`, `forecast()`, `state` (wind/sea/temps/visibility/`shelter`…), `wetness` 0..1, `lightning`, `strike()`. Bus: `weather:change {preset,…,shelter}`, `weather:lightning`, `sfx thunder|wind_gust|ship_horn`.
  `env.weather.easeRate` (default 0.05 /s) sets how fast live values chase the target; `env.setFlash(v)` lights the clouds (sky `uFlash`); `game.grade.uniforms.uFlash` is the screen flash. `shared.uWet` (materials.js) darkens/glosses exterior up-facing floor finishes; driven from `weather.wetness` by the `wetDecks` system in gameplay.js.
- `game.seaLife` (env/seaLife.js + vessels.js): birds, flying fish, dolphins, whales, horizon traffic with COLREGS lights; `spawnDolphins()`, `spawnWhale()`, `placeVessel()`, `setEnabled()`. Bus: `sealife:sighting {kind,text,x,z,minor?}`.
- NPC integration: on `weather:change {shelter:true}` exterior passengers walk to the nearest interior public room and open decks get no new passengers until shelter ends; venue targets are boosted by `schedule.attendance(room.name)`; `alarm {kind:'muster', on}` sends passengers on the focus deck ±1 to `schedule.musterStations` until it turns off (`npcs.stats()` reports `shelter, muster, sheltering, mustering, paxOutside`).
- Audio: own random thunder disabled when `game.weather` exists; new sfx `swing`, `whiz`, `spray`, `button` (elevator call buttons).

## UI contract — `game.ui` (src/ui/ui.js, wave 3)
- `toast(text, {kind:'info'|'good'|'bad'|'mission', ms})`
- `notify(title, body, {icon})` — phone-style notification
- `setObjective({id, title, text, steps:[{text, done}], target:{deck,x,z,label}|null})`, `clearObjective(id)`; waypoint marker drawn in-world + on map/minimap.
- `dialogue({speaker, portrait?, lines:[...], options:[{text, id, enabled, hint}]}) → Promise<optionId|null>` (pauses player controls, sets input context 'ui')
- `subtitle(text, speaker, ms)` — for barks/announcements
- `openPanel('map'|'inventory'|'journal'|'phone'|'pause'|'settings'|'shop', opts)`, `closePanel()`, `isPanelOpen()`
- `shop({title, items:[{id,name,price,desc,kind}], onBuy(item)→bool})`
- `prompt` stays in playerHud.
- `addMapMarker({id, deck, x, z, kind, label})`, `removeMapMarker(id)`
- `fade(toBlack:boolean, ms) → Promise`, `cinematicBars(on)`, `showTitle(text, sub)` (chapter cards)
- `hud` shows: health, heat (game.security?.heat 0..5 & status), cash (game.economy?.cash), clock/day (game.hour, game.day), deck & location name (player.room), current objective, minimap.

## Economy & inventory — `game.economy`, `game.inventory` (src/systems/economy.js, inventory.js, wave 3)
- `game.economy`: `cash` (cash in wallet, §), `credit` (onboard account), `add(amount, reason)`, `spend(amount, reason) → bool`, `history`. Keep `game.player.money` in sync (= cash).
- `game.inventory`: `items` Map id→{id, name, kind:'key'|'tool'|'weapon'|'outfit'|'valuable'|'consumable'|'evidence'|'collectible', qty, value, desc, icon}, `add(id, qty, meta)`, `remove(id, qty)`, `has(id)`, `count(id)`, `list(kind)`. Replace `player.inventory` with it (same has/add/remove API). Keycards also mirror into `player.keycards` (Set of access strings like 'crew', 'officer', 'cabin:9147', 'master').
- Item registry `ITEMS` (id → definition) exported from inventory.js.

## Security — `game.security` (src/systems/security.js, wave 3)
`heat` 0..5, `status` text, `known` (is the player's current look known), `report(crime)`, `isWanted`, `cameras` list, `setCamerasEnabled(bool | deck)`, `lockdown(on)`, `arrest()`. Bus: `heat:change` {level}, `crime`, `alarm`.

## Ship schedule — `game.schedule` (src/systems/shipSchedule.js, wave 3)
`events` for the day [{id, name, start (minutes of day), end, venue room name, deck, kind}], `current()`, `next()`, `isOn(id)`. Emits `schedule:start` / `schedule:end` and PA `announce` messages.

## Missions, saves & gameplay APIs (wave 4)
### Missions — `game.missions` (src/systems/missions.js + missions/*; the module header is authoritative)
"Undertow" campaign (10 main missions over the 7-night crossing, ids `undertow_1`…`undertow_10`), 10 emergent Ship
Stories, and Cutter's repeatable contracts. Every main mission has ≥ 2 approaches; objectives complete from real game state.
- Flow: `start(id)`, `complete(id, how?)`, `fail(id, reason?)`, `skipTo(id)` (debug).
- Queries: `list()` → `[{id,title,kind,act,status,approaches}]`, `state(id)` → `{id,title,kind,status,beat,how,requires,canStart}`,
  `journal()` → `{active, completed, failed}`, `messages` (phone texts `{from,text,minutes,read}`), `stats()` →
  `{completed, mainDone, shipStories, contracts, evidenceGathered}`, `flags` / `vars` (story state, read/write).
- Parts: `engine` (MissionEngine), `cast` (CastManager: `get(key)`, `ensure(key)`, `move(...)`; cast NPCs carry `npc.castKey`,
  e.g. `okafor` = Security Chief Ines Okafor, `holt` = Captain Rhiannon Holt, `teodor`, `varga`, `daan`, `pike`), `contracts`, `stories`.
- Debug: `offerContract()`, `startStory(id)`, `_setAutoAnswer(mapOrFn|null)` (auto-resolve mission dialogue in tests).
- Bus out: `mission:start {id,title}`, `mission:complete {id,title,how}`, `mission:failed {id,title,reason}`. Saved as `missions`.
- Gameplay hooks missions rely on: `activity:pickpocket {success, victim, chance}` (crew targets allowed — stewards/housekeeping
  carry a `master_key`, other crew a `crew_keycard`); items of kind `evidence` or with `meta.mission` are never confiscated
  on arrest/revive; the Medical Centre counter (deck 3) sells `seasick_pills` / `painkillers` into the inventory.

### Saves — what is persisted (`game.save.keys()`)
`player` (position snapped to walkable, health, disguise, keycards) · `clock` · `weather` (live env values) · `weatherSys`
(manual override from `weather.set()` relative to the clock, deck wetness) · `schedule` (events already started/ended, PAs
already made) · `doors` (only doors whose lock state differs from default, incl. picked/forced; lockdown seals are saved as
their pre-lockdown state) · `inventory` · `economy` · `medallions` · `activities` (room-service job + time left, searched
burglary containers, intox, crimeMode) · `security` (below) · `missions`.
`security` = heat value, circulated description, last known position, record `{strikes,fines,arrests}`, evidence locker,
jail (time left — reloading puts you back in the cell), CCTV/power (broken cameras, disabled decks, looped feeds, junction
outage time left), general alert, and `npcFlags` — cast/mission NPCs (`castKey`, or `kind:'mission'` + `tag`) that were killed
or KO'd are re-killed / re-KO'd when they next spawn. A saved heat > 0 loads as **searching**: same heat & description, nobody
has eyes on you, no chase or reinforcement wave on load (patrols recognise you as usual).

### Security outcomes (src/systems/security.js)
- Escalation (securityAI.js `_combat`): heat ≤ 3 batons (standing still unarmed → cuffed); heat 4 taser first (2–7 m,
  3.5 s recharge, baton up close in between); pistols only at heat 4 when the player carries a pistol **and** fired it within
  30 s, or at heat 5. A surrendered / stunned / downed player is closed in on and cuffed — guards hold fire. At heat ≤ 4
  guard hits are non-lethal (`combat.attackPlayer(npc, kind, {nonLethal:true})`: at ≤ 1 hp the player is stunned instead).
- `arrest()` → **BUSTED** outcome card (fine: wallet first, then the cabin account down to its credit limit, rest waived;
  confiscation; strike; 3 h) → holding cells; `revive` → **MEDICAL EMERGENCY** card (bill §250 with the same cap — shortfall
  covered by "travel insurance"; 45 min pass; weapons confiscated only if you were at heat ≥ 2) → Medical Centre, deck 3.
  `security.lastOutcome = {kind:'busted'|'medical', summary:[lines], bill:{cash,account,waived}, …}`; the summary is also
  in `security:arrest` / `security:revived` events. Aftermath: player pose & controls reset, heat HUD hidden, pending reports
  cancelled (`crime.cancelAll(why)`), guards released (`ai.standDown(true)`), radio/barks silenced while jailed.
- `security._bill(amount, reason)` → `{cash, account, waived}`; `securityHud.outcome(title, sub, lines, kind)` / `clearRadio()`.

### Interaction priorities (crime vs. social)
Crime prompts (Pickpocket, Pocket it = shoplifting, Takedown) carry `crimePrompt: true`. Standing normally they sit on the
alt key **F** at priority −6 (Pickpocket is offered only from behind/beside a slow-moving player; Takedown not at all), so
Talk / Sit / Buy / Use / Open always win. Crouched (sneaking) or with `game.activities.crimeMode` / `player.crimeMode` set
they jump to the top (Takedown on E at priority 6, Pickpocket F at 5, Pocket it F at 4).
Pickpocket chance (`activities.pickpocketChance(npc)`): ~55 % from behind (+crowd up to +15 %, crouch +8 %) → ~70 % behind in
a crowd, ~35 % beside, ≤ 6 % in front; alert victims ×0.3. A failed lift: the victim turns and shouts, report lands in ~2 s.

### Shooting (combat.js)
`combat.aimPoint(range)` = what the crosshair rests on (camera ray). `_fireRay` then traces from the muzzle (`handPos`) to that
point (+ spread): only a person actually on the muzzle ray is hit (→ 'shooting'/'murder'); otherwise the shot is a
'discharge'; 'vandalism' only when glass/cameras are actually hit. `combat.lastShot = {from, to, dir, aim, hit, wall}`.

### Misc
- `player.teleport(deck,x,z,yaw,{strict})` snaps to the nearest walkable cell (never void/pool/shaft; `strict` also leaves
  furniture footprints — used by arrest, revive and load); `player.snapWalkable(deck,x,z,strict)`.
- `EventBus` throttles listener errors per (event, message): first 3 in full, then a summary every 100 repeats / 10 s;
  `bus.errorStats()`.
