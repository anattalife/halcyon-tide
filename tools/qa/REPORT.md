# QA report — round 1 (independent critic). Evidence in shots/qa/, tools/qa/*.log
## Measurements
GPU: every view 3–7M tris, 370–710 draw calls, 75 programs (cabin 5.66M, exterior side 7.12M). Exterior layer always drawn (2.29M), each detailed deck ~1.04M (3 detailed), 2.5–2.9M tris cast into 4096² PCFSoft shadow map; plus 1.25 pixel ratio, 4x MSAA half-float RT, bloom. Est. 15–30 fps on GTX1650/Iris Xe.
CPU: normal 2–3 ms; 160 NPCs avg 3.5 ms p99 11 ms (chars 1.13, npcs 0.67, player 0.49). Deck change spike 32–71 ms. No leaks.
## Defects
1 P0 Triangle/draw budget: setActiveDeck streams full detail d±1 with no chunking; exterior meshes huge, never culled; QUALITY_PRESETS detailRadius/drawDistance unused. Fix: ~40 m chunks, full detail only nearby, skip/LOD exterior when indoors, furniture LOD, wire presets.
2 P0 Shadow pass doubles cost (2.5–2.9M casters every frame even indoors at night). Disable indoors/at night, 2048 non-soft, update less often, trim casters.
3 P0 1.4 s stall every 4 s: env PMREM rebuilt on timer with new RT (environment.js). Rebuild on hour/weather change only, reuse RT. First frame 51 s shader compile: precompile during loading (renderer.compile / compileAsync).
4 P0 Heat≥4 guards shoot player dead (34 shots, no taser/cuffs), revive in Medical with §0 / -§70 and +6h. securityAI.js:370-373 arms all & pistol >2.2 m. Taser first, add busted/wasted screen.
5 P0 Casino/theatre/nightclub/bridge dark ceiling = black starry void.
6 P1 Characters look like low-poly mannequins: faceted limbs, blank faces, helmet hair, stiff/clipping poses (charGeometry.js, charAnim.js).
7 P1 Crowds don't change with time: 03:00 only 7 NPCs ship-wide; 23:00 pool deck 40 sunbathing + 33 heading there in dark rain; existing NPCs never re-evaluate venue (population.js, npcs.js).
8 P1 Rain doesn't move seated/lying NPCs indoors (73 stayed on loungers).
9 P1 Security state not saved (record, strikes, evidence locker, jail, heat) → save-scum clears wanted.
10 P1 Crime prompts dominate: Pickpocket top prompt 92/120, Takedown priority 6 (combat.js:649) hides Sit/Buy/Talk.
11 P1 Pickpocket trivial: 4/10 success, heat 0 then 1 after 15 s; ~32% even facing victim (activities/crime.js).
12 P1 Shooting in air logged as shooting a person (camera ray pitched up hits gallery) — combat.js _aimRay.
13 P1 Teleport/load/revive can place player over atrium void (floorY returns deck height on void). Snap to nearest walkable.
14 P1 Camera in tight spaces: pulls to 0.3–1 m, walls fill frame (cabin 9147, stateroom 8049); shops/promenade camera below head height looking up, NPCs through camera (cameraRig.js).
15 P1 Pool deck huge flat untextured overhang (underside of deck 16).
16 P1 Hull/stern repetitive & flat: identical balcony tiers, row of dark dots under each tier, plain hull with black rect windows, floating panel above lifeboats, no foam at hull/water line.
17 P1 Arrest aftermath: in cell still hands-up pose, HUD still PURSUIT/ON CAMERA, radio "Got them!" after.
18 P1 Not saved: jobs, schedule progress, weather override, door/lock states, KO/killed NPCs.
19 P2 Interior lighting flat; only 8 spots; dining blown-out stern windows.
20 P2 Crew Spine deck 2, engine room, stair stores bare white boxes.
21 P2 NPCs inside wall cells at doorways deck 4 (Port Gallery x46–58 z-13.1; Boardroom/Card Room doors z15.5).
22 P2 Map→journal/inventory leaves map drawn underneath; no scrim; teardown 280 ms.
23 P2 Stale door prompt after teleport; corridor "◄ 9001" sign ~1.2 m wide oversized.
24 P2 Atrium crowd stands in rows (60% chatting idle); children walk alone; dining no waiters in view.
25 P2 Deck change spikes 32–71 ms (NPC spawn burst, path searches 10 ms avg); EventBus logs errors unthrottled (217 in a firefight).
Lesser: theatre stage tiny/no house lighting; dining repetitive; sea sparkle noisy; at night ship glows as one white sheet; funnel smoke smear; "Click to look around" never hides; objective distance ignores height; minimap/objective text hard to read; lift 9→15 15 s; bridge warning has no follow-up.
Mission team requests: pickpocket should allow crew targets (stewards' keycard route); shipSchedule names captain "Sofia Lindqvist"/officer "Tom Okafor" → must be Captain Rhiannon Holt / Security Chief Ines Okafor; evidence items (kind 'evidence' / mission flag) exempt from confiscation; Medical Centre should sell seasickness pills; document game.missions in ARCHITECTURE.md.
