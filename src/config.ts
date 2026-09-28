/** Global tuning knobs. Anything a designer might want to tweak lives here. */

export const MAP_SIZE = 128;
export const CHUNK_SIZE = 16;

export const START_FUNDS = 20_000;
export const CITY_NAME = 'New City';
export const START_YEAR = 2026;

/** Simulation ticks per in-game month. */
export const TICKS_PER_MONTH = 16;
/** Ticks per real-time second for each speed setting (index 0 = paused). */
export const SPEEDS = [0, 4, 10, 25] as const;

/** Every zone tile is re-evaluated for growth once per this many ticks. */
export const GROWTH_STRIDE = 4;
/** Ticks a building spends under construction before it is occupied. */
export const CONSTRUCTION_TICKS = 10;
/** Max Manhattan distance from a road for a zone tile to count as served. */
export const ROAD_ACCESS_RANGE = 3;

export const COSTS = {
  road: 10,
  zone: 5,
  bulldoze: 2,
  bulldozeBuilding: 15,
  clearTree: 3,
} as const;

/** Flat monthly income per resident / per job until the full tax system lands (phase 3). */
export const TAX_PER_RESIDENT = 0.12;
export const TAX_PER_JOB = 0.1;

/** World-space height of one building floor (a tile is 1 unit wide). */
export const FLOOR_HEIGHT = 0.2;
export const WATER_DEPTH = 0.14;

export const AUTOSAVE_INTERVAL_MS = 120_000;
export const SAVE_KEY = 'simcity-clone:save:v1';
