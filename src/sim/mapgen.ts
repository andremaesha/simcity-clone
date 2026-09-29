import { fbm } from './noise';
import { Rng } from './rng';
import { Terrain, Zone } from './types';
import { World } from './world';

const LAKE_FRACTION = 0.07;

/** Fills a fresh world with lakes, an optional river, forests and the highway. Deterministic for a given seed. */
export function generateTerrain(world: World, seed: number): void {
  const { size } = world;
  const rng = new Rng(seed);

  // Lakes: the lowest few percent of a low-frequency height field.
  const height = new Float32Array(world.count);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      height[world.idx(x, z)] = fbm(x / 34, z / 34, seed, 4);
    }
  }
  const sorted = Float32Array.from(height).sort();
  const waterLevel = sorted[Math.floor(sorted.length * LAKE_FRACTION)];
  for (let i = 0; i < world.count; i++) {
    if (height[i] < waterLevel) world.terrain[i] = Terrain.Water;
  }

  if (rng.chance(0.75)) carveRiver(world, rng, seed);

  // Forests: dense clumps from one noise field plus a sprinkle of lone trees.
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = world.idx(x, z);
      if (world.terrain[i] === Terrain.Water) continue;
      const f = fbm(x / 18, z / 18, seed + 777, 4);
      if (f > 0.6) world.trees[i] = f > 0.68 ? 3 : f > 0.64 ? 2 : 1;
      else if (rng.chance(0.015)) world.trees[i] = 1;
    }
  }

  removeTinyPonds(world);
  placeHighway(world, rng);
  world.invalidateDerived();
  world.markAllDirty();
}

export type Axis = 'x' | 'z';

/**
 * Lays a two-lane-pair highway across the whole map along `axis`, occupying rows/columns `pos` and
 * `pos + 1`. Each tile is one direction of travel (right-hand traffic). It is the city's only link
 * to the outside world: immigrants and freight arrive through it. Over water it becomes a bridge.
 */
export function buildHighway(world: World, axis: Axis, pos: number): void {
  for (let t = 0; t < world.size; t++) {
    for (const lane of [0, 1]) {
      const x = axis === 'z' ? pos + lane : t;
      const z = axis === 'z' ? t : pos + lane;
      const i = world.idx(x, z);
      // Along z the lower-x lane heads +z (DIRS[0]); along x the higher-z lane heads +x (DIRS[1]).
      const dir = axis === 'z' ? (lane === 0 ? 0 : 2) : lane === 1 ? 1 : 3;
      world.trees[i] = 0;
      world.setZone(i, Zone.None);
      world.setHighway(i, dir);
    }
  }
}

/**
 * Picks a highway line through the middle of the map that crosses as little water as possible and,
 * when added to an existing city (old saves), as few buildings as possible.
 */
export function placeHighway(world: World, rng: Rng): void {
  const { size } = world;
  const axis: Axis = rng.chance(0.5) ? 'x' : 'z';
  let best = Math.floor(size / 2);
  let bestScore = Infinity;
  for (let p = Math.floor(size * 0.3); p <= Math.floor(size * 0.7) - 1; p++) {
    let cost = 0;
    for (let t = 0; t < size; t++) {
      for (const lane of [0, 1]) {
        const x = axis === 'z' ? p + lane : t;
        const z = axis === 'z' ? t : p + lane;
        if (world.isWater(x, z)) cost++;
        if (world.level[world.idx(x, z)] > 0) cost += 3;
      }
    }
    const score = cost + rng.float() * 3;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  buildHighway(world, axis, best);
}

/** A meandering river crossing the whole map along one axis. */
function carveRiver(world: World, rng: Rng, seed: number): void {
  const { size } = world;
  const alongX = rng.chance(0.5);
  let center = rng.range(size * 0.2, size * 0.8);
  const width = rng.range(2.2, 3.4);
  for (let t = 0; t < size; t++) {
    center += (fbm(t / 20, 0.5, seed + 99, 3) - 0.5) * 2.2;
    center = Math.min(size - 6, Math.max(6, center));
    const w = width + (fbm(t / 9, 7.5, seed + 55, 2) - 0.5) * 1.5;
    for (let o = Math.floor(center - w / 2); o <= Math.ceil(center + w / 2); o++) {
      const x = alongX ? t : o;
      const z = alongX ? o : t;
      if (world.inBounds(x, z)) world.terrain[world.idx(x, z)] = Terrain.Water;
    }
  }
}

/** Single water tiles surrounded by land read as noise; turn them back into grass. */
function removeTinyPonds(world: World): void {
  const { size } = world;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = world.idx(x, z);
      if (world.terrain[i] !== Terrain.Water) continue;
      let waterNeighbours = 0;
      if (world.isWater(x + 1, z)) waterNeighbours++;
      if (world.isWater(x - 1, z)) waterNeighbours++;
      if (world.isWater(x, z + 1)) waterNeighbours++;
      if (world.isWater(x, z - 1)) waterNeighbours++;
      if (waterNeighbours <= 1) world.terrain[i] = Terrain.Grass;
    }
  }
}
