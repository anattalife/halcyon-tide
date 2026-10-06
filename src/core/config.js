// ─────────────────────────────────────────────────────────────────────────────
//  HALCYON TIDE — global scale & world constants
//  Units: metres. +X = toward the bow, +Z = starboard, +Y = up.
//  The ship is modelled at true scale: 330 m LOA, 41 m beam, 17 decks.
// ─────────────────────────────────────────────────────────────────────────────

export const SHIP = {
  name: 'MS Halcyon Tide',
  line: 'Larkspur Oceanic',
  length: 330,          // length overall
  beam: 41,             // moulded beam
  halfBeam: 20.5,
  xMin: -165,           // stern (transom)
  xMax: 165,            // bow stem
  waterY: -2.0,         // waterline height in ship space
  keelY: -10.8,         // keel (draft 8.8 m)
  deckHeight: 3.0,      // deck-to-deck
  deckCount: 17,
  passengers: 5180,
  crew: 1940,
  speedKnots: 19.5,
};

// Grid used by deck plans, collision and navigation. 0.5 m cells.
export const GRID = {
  cell: 0.5,
  x0: -165,
  z0: -25,
  nx: 660,   // 330 m / 0.5
  nz: 100,   // 50 m / 0.5 (beam + bridge wings)
};

export const deckY = (d) => -6 + (d - 1) * SHIP.deckHeight;   // floor height of deck d
export const deckOfY = (y) => Math.max(1, Math.min(SHIP.deckCount, Math.floor((y + 6) / SHIP.deckHeight + 1e-3) + 1));

export const cellX = (i) => GRID.x0 + (i + 0.5) * GRID.cell;
export const cellZ = (j) => GRID.z0 + (j + 0.5) * GRID.cell;
export const toI = (x) => Math.floor((x - GRID.x0) / GRID.cell);
export const toJ = (z) => Math.floor((z - GRID.z0) / GRID.cell);
export const idx = (i, j) => j * GRID.nx + i;
export const inGrid = (i, j) => i >= 0 && j >= 0 && i < GRID.nx && j < GRID.nz;

// Passenger stair/elevator cores (centre x) and crew service cores.
export const CORES = [
  { id: 'aft', x: -85, minDeck: 3, maxDeck: 16, label: 'Aft' },
  { id: 'mid', x: -10, minDeck: 3, maxDeck: 16, label: 'Midship' },
  { id: 'fwd', x: 92, minDeck: 3, maxDeck: 17, label: 'Forward' },
];
export const CREW_CORES = [
  { id: 'cA', x: -45, minDeck: 1, maxDeck: 15 },
  { id: 'cB', x: 58, minDeck: 1, maxDeck: 15 },
  { id: 'cC', x: 140, minDeck: 1, maxDeck: 6 },     // forward, below the superstructure (backstage / mooring deck)
  { id: 'cD', x: 104, minDeck: 7, maxDeck: 13 },    // forward accommodation & bridge officers
];

// Game time: one in-game minute every 1.25 real seconds (a day = 30 real minutes).
export const TIME = {
  realSecondsPerGameMinute: 1.25,
  startHour: 16.5,      // embarkation afternoon
};

// Rendering presets (read by main.js applyQuality → renderer / composer / env / world / lights; npcCap by npcs.js).
//  detailRadius  decks above/below the camera deck that interior detail may be shown on (through voids & stairs)
//  detailScale   multiplies the world's detail / LOD / fine-exterior distances (world.js VIS_DEFAULT)
//  drawDistance  exterior slices beyond this are culled; camera far plane = 2× this
//  shadowDist    exterior/furniture shadow casters only within this distance; shadowEvery = shadow map refresh period
//  lights        interior light-pool size (SpotLights); msaa = composer samples
export const QUALITY_PRESETS = {
  low:    { pixelRatio: 0.75, shadows: false, shadowSize: 1024, shadowDist: 0,  shadowEvery: 4, bloom: false, msaa: 0, detailRadius: 1, detailScale: 0.6,  npcCap: 60,  drawDistance: 700,  lights: 6,  ssao: false },
  medium: { pixelRatio: 1.0,  shadows: true,  shadowSize: 1024, shadowDist: 35, shadowEvery: 3, bloom: true,  msaa: 2, detailRadius: 1, detailScale: 0.8,  npcCap: 110, drawDistance: 1400, lights: 10, ssao: false },
  high:   { pixelRatio: 1.25, shadows: true,  shadowSize: 2048, shadowDist: 55, shadowEvery: 2, bloom: true,  msaa: 4, detailRadius: 2, detailScale: 1.0,  npcCap: 160, drawDistance: 3000, lights: 14, ssao: false },
  // Phone presets (mobile.html only; src/mobile/mobileQuality.js picks one and runs an adaptive resolution scaler).
  // pixelRatio multiplies min(devicePixelRatio, 2); post:false renders straight to the canvas (no composer passes).
  'mobile-low': { pixelRatio: 0.5, shadows: false, shadowSize: 512, shadowDist: 0, shadowEvery: 6, bloom: false, msaa: 0, detailRadius: 1, detailScale: 0.45, npcCap: 30, drawDistance: 500, lights: 4, ssao: false, post: false, mobile: true },
  mobile:       { pixelRatio: 0.65, shadows: false, shadowSize: 512, shadowDist: 0, shadowEvery: 6, bloom: false, msaa: 0, detailRadius: 1, detailScale: 0.55, npcCap: 45, drawDistance: 800, lights: 4, ssao: false, post: true, mobile: true },
};
