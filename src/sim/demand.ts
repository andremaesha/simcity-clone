import { CityStats, Demand, Zone } from './types';

/** Residents or jobs provided by a completed building, indexed by [zone][level]. */
export const CAPACITY: Record<Zone, readonly number[]> = {
  [Zone.None]: [0, 0, 0, 0, 0],
  [Zone.Residential]: [0, 6, 20, 70, 200],
  [Zone.Commercial]: [0, 4, 14, 45, 130],
  [Zone.Industrial]: [0, 8, 22, 45, 80],
};

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Classic RCI balance, all values in [-1, 1]:
 * - residents move in when there are more jobs than workers,
 * - shops follow the population,
 * - industry has a baseline export demand plus local demand from the population.
 * Uses planned capacity so buildings under construction already dampen demand.
 */
export function computeDemand(stats: CityStats): Demand {
  const pop = stats.plannedPopulation;
  const com = stats.plannedComJobs;
  const ind = stats.plannedIndJobs;
  const workforce = pop * 0.5;
  const jobs = com + ind;

  const residential = (jobs * 1.1 - workforce + 60) / Math.max(80, workforce * 0.25);
  const comTarget = pop * 0.2;
  const commercial = (comTarget - com + 4) / Math.max(30, comTarget * 0.25);
  const indTarget = pop * 0.3 + 40;
  const industrial = (indTarget - ind) / Math.max(40, indTarget * 0.25);

  return {
    residential: clamp(residential),
    commercial: clamp(commercial),
    industrial: clamp(industrial),
  };
}

export function demandFor(demand: Demand, zone: Zone): number {
  switch (zone) {
    case Zone.Residential:
      return demand.residential;
    case Zone.Commercial:
      return demand.commercial;
    case Zone.Industrial:
      return demand.industrial;
    default:
      return 0;
  }
}

export function emptyStats(): CityStats {
  return {
    population: 0,
    comJobs: 0,
    indJobs: 0,
    plannedPopulation: 0,
    plannedComJobs: 0,
    plannedIndJobs: 0,
    zonedTiles: { 0: 0, 1: 0, 2: 0, 3: 0 },
    developedTiles: { 0: 0, 1: 0, 2: 0, 3: 0 },
  };
}
