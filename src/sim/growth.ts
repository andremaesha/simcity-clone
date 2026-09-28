import { CONSTRUCTION_TICKS, GROWTH_STRIDE, TICKS_PER_MONTH } from '../config';
import { CAPACITY, computeDemand, demandFor, emptyStats } from './demand';
import { Rng } from './rng';
import { CityStats, Demand, MAX_LEVEL, Zone } from './types';
import { World } from './world';

const GROW_BASE = 0.03;
const GROW_PER_DEMAND = 0.2;
const UPGRADE_PER_DEMAND = 0.03;
const DECLINE_PER_DEMAND = 0.03;
const NO_ACCESS_DECLINE = 0.05;

/**
 * Migration budget: how much new capacity (residents or jobs) each zone may start building per month.
 * Without it RCI demand feeds on itself and a city explodes in a single year.
 */
export type GrowthBudget = Record<Zone, number>;
const BUDGET_BASE: GrowthBudget = { [Zone.None]: 0, [Zone.Residential]: 40, [Zone.Commercial]: 20, [Zone.Industrial]: 30 };
const BUDGET_MONTHLY_RATE = 0.05;
const BUDGET_MAX_MONTHS = 1.5;

export function emptyBudget(): GrowthBudget {
  return { [Zone.None]: 0, [Zone.Residential]: 0, [Zone.Commercial]: 0, [Zone.Industrial]: 0 };
}

export function refillBudget(budget: GrowthBudget, stats: CityStats): void {
  const planned: GrowthBudget = {
    [Zone.None]: 0,
    [Zone.Residential]: stats.plannedPopulation,
    [Zone.Commercial]: stats.plannedComJobs,
    [Zone.Industrial]: stats.plannedIndJobs,
  };
  for (const zone of [Zone.Residential, Zone.Commercial, Zone.Industrial]) {
    const monthly = BUDGET_BASE[zone] + planned[zone] * BUDGET_MONTHLY_RATE;
    budget[zone] = Math.min(budget[zone] + monthly / TICKS_PER_MONTH, monthly * BUDGET_MAX_MONTHS);
  }
}

/** Population needed before a zone may reach each level (index = level). */
const POP_FOR_LEVEL = [0, 0, 250, 1500, 6000];
/** Developed tiles needed within a 5x5 neighbourhood before a zone may reach each level. */
const NEIGHBOURS_FOR_LEVEL = [0, 0, 3, 8, 14];

/** Full scan of the grid. Cheap enough (16k tiles) to run every tick, which avoids incremental bookkeeping bugs. */
export function computeStats(world: World): CityStats {
  const stats = emptyStats();
  for (let i = 0; i < world.count; i++) {
    const zone = world.zone[i] as Zone;
    if (zone === Zone.None) continue;
    stats.zonedTiles[zone]++;
    const level = world.level[i];
    if (level === 0) continue;
    const cap = CAPACITY[zone][level];
    const done = world.construction[i] === 0;
    if (done) stats.developedTiles[zone]++;
    addCapacity(stats, zone, cap, done);
  }
  return stats;
}

function addCapacity(stats: CityStats, zone: Zone, cap: number, done: boolean): void {
  if (zone === Zone.Residential) {
    stats.plannedPopulation += cap;
    if (done) stats.population += cap;
  } else if (zone === Zone.Commercial) {
    stats.plannedComJobs += cap;
    if (done) stats.comJobs += cap;
  } else if (zone === Zone.Industrial) {
    stats.plannedIndJobs += cap;
    if (done) stats.indJobs += cap;
  }
}

/** Advances construction timers; returns how many buildings finished this tick. */
export function tickConstruction(world: World): number {
  let finished = 0;
  for (let i = 0; i < world.count; i++) {
    if (world.construction[i] === 0) continue;
    world.construction[i]--;
    if (world.construction[i] === 0) {
      world.markDirty(i);
      finished++;
    }
  }
  return finished;
}

/**
 * Evaluates one stride of zone tiles for growth, upgrade or decline.
 * `stats` is mutated as construction starts so demand reacts within the same tick.
 */
export function tickGrowth(world: World, stats: CityStats, budget: GrowthBudget, tick: number, rng: Rng): Demand {
  let demand = computeDemand(stats);
  const offset = tick % GROWTH_STRIDE;
  const slots = Math.ceil((world.count - offset) / GROWTH_STRIDE);
  // Start the sweep at a random slot so a scarce budget is not always spent on the top rows first.
  const start = rng.int(0, slots - 1);
  for (let s = 0; s < slots; s++) {
    const i = offset + ((start + s) % slots) * GROWTH_STRIDE;
    const zone = world.zone[i] as Zone;
    if (zone === Zone.None || world.construction[i] > 0) continue;
    const level = world.level[i];

    if (!world.hasRoadAccess(i)) {
      if (level > 0 && rng.chance(NO_ACCESS_DECLINE)) setLevel(world, i, level - 1);
      continue;
    }

    const d = demandFor(demand, zone);
    if (level === 0) {
      const gain = CAPACITY[zone][1];
      if (d > 0 && budget[zone] >= gain && rng.chance(GROW_BASE + GROW_PER_DEMAND * d)) {
        startConstruction(world, i, 1, rng);
        addCapacity(stats, zone, gain, false);
        budget[zone] -= gain;
        demand = computeDemand(stats);
      }
    } else if (d > 0.1 && level < maxLevel(world, i, stats)) {
      const gain = CAPACITY[zone][level + 1] - CAPACITY[zone][level];
      if (budget[zone] >= gain && rng.chance(UPGRADE_PER_DEMAND * d)) {
        startConstruction(world, i, level + 1, rng);
        addCapacity(stats, zone, gain, false);
        budget[zone] -= gain;
        demand = computeDemand(stats);
      }
    } else if (d < -0.25 && rng.chance(DECLINE_PER_DEMAND * -d)) {
      setLevel(world, i, level - 1);
      addCapacity(stats, zone, CAPACITY[zone][level - 1] - CAPACITY[zone][level], false);
      demand = computeDemand(stats);
    }
  }
  return demand;
}

function startConstruction(world: World, i: number, level: number, rng: Rng): void {
  world.level[i] = level;
  world.variant[i] = rng.int(0, 255);
  world.construction[i] = CONSTRUCTION_TICKS + rng.int(0, 6);
  world.trees[i] = 0;
  world.markDirty(i);
}

function setLevel(world: World, i: number, level: number): void {
  if (level <= 0) {
    world.clearBuilding(i);
    return;
  }
  world.level[i] = level;
  world.markDirty(i);
}

/** Highest level this tile may grow to, based on city size and how built-up its surroundings are. */
export function maxLevel(world: World, i: number, stats: CityStats): number {
  let max = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) {
    if (stats.population >= POP_FOR_LEVEL[l]) max = l;
  }
  if (max === 1) return 1;

  const x = i % world.size;
  const z = (i - x) / world.size;
  let developed = 0;
  let levelSum = 0;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if ((dx === 0 && dz === 0) || !world.inBounds(x + dx, z + dz)) continue;
      const n = world.idx(x + dx, z + dz);
      if (world.level[n] > 0) {
        developed++;
        levelSum += world.level[n];
      }
    }
  }
  // Tall buildings need direct road frontage.
  const frontage = world.roadDist[i] <= 1;
  const avgLevel = developed > 0 ? levelSum / developed : 0;

  let allowed = 1;
  for (let l = 2; l <= max; l++) {
    if (developed < NEIGHBOURS_FOR_LEVEL[l]) break;
    if (l >= 3 && !frontage) break;
    if (l === 4 && avgLevel < 2) break;
    allowed = l;
  }
  return allowed;
}
