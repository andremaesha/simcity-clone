export const Terrain = {
  Grass: 0,
  Water: 1,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const Zone = {
  None: 0,
  Residential: 1,
  Commercial: 2,
  Industrial: 3,
} as const;
export type Zone = (typeof Zone)[keyof typeof Zone];

export const ZONE_NAMES: Record<Zone, string> = {
  [Zone.None]: 'Unzoned',
  [Zone.Residential]: 'Residential',
  [Zone.Commercial]: 'Commercial',
  [Zone.Industrial]: 'Industrial',
};

export const Tool = {
  Inspect: 'inspect',
  Bulldoze: 'bulldoze',
  Road: 'road',
  Residential: 'residential',
  Commercial: 'commercial',
  Industrial: 'industrial',
  Dezone: 'dezone',
} as const;
export type Tool = (typeof Tool)[keyof typeof Tool];

export const MAX_LEVEL = 4;

/**
 * Directions in the order used by rotated building frames:
 * index 0 faces +z (south), 1 faces +x (east), 2 faces -z (north), 3 faces -x (west).
 */
export const DIRS: ReadonlyArray<readonly [dx: number, dz: number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

export interface CityStats {
  population: number;
  comJobs: number;
  indJobs: number;
  /** Capacity including buildings still under construction; drives demand so growth does not overshoot. */
  plannedPopulation: number;
  plannedComJobs: number;
  plannedIndJobs: number;
  zonedTiles: Record<Zone, number>;
  developedTiles: Record<Zone, number>;
}

export interface Demand {
  residential: number;
  commercial: number;
  industrial: number;
}
