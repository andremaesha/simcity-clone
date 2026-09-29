import { describe, expect, it } from 'vitest';
import { TICKS_PER_MONTH } from '../config';
import { buildHighway, generateTerrain } from './mapgen';
import { PathFinder, highwayEnds } from './roadNetwork';
import { deserialize, serialize } from './save';
import { Simulation } from './simulation';
import { planTool } from './tools';
import { DIRS, Road, Terrain, Tool, Zone } from './types';
import { World } from './world';

function flatWorld(size = 32): World {
  return new World(size, 1);
}

/** A flat world with the highway running down its right edge (columns size-2 and size-1). */
function worldWithHighway(size = 32): World {
  const world = flatWorld(size);
  buildHighway(world, 'z', size - 2);
  return world;
}

function runMonths(sim: Simulation, months: number): void {
  for (let t = 0; t < months * TICKS_PER_MONTH; t++) sim.step();
}

function developedInRow(world: World, z: number): number {
  let n = 0;
  for (let x = 0; x < world.size; x++) if (world.level[world.idx(x, z)] > 0) n++;
  return n;
}

describe('mapgen', () => {
  it('is deterministic for a seed and leaves most of the map buildable', () => {
    const a = new World(128, 42);
    const b = new World(128, 42);
    generateTerrain(a, 42);
    generateTerrain(b, 42);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.trees).toEqual(b.trees);
    expect(a.road).toEqual(b.road);
    const water = a.terrain.reduce((n, t) => n + (t === Terrain.Water ? 1 : 0), 0) / a.count;
    expect(water).toBeGreaterThan(0.02);
    expect(water).toBeLessThan(0.3);
  });

  it('lays a two-lane highway across the whole map with one lane per direction', () => {
    const world = new World(128, 7);
    generateTerrain(world, 7);
    const highway = world.road.reduce((n, r) => n + (r === Road.Highway ? 1 : 0), 0);
    expect(highway).toBe(128 * 2);
    const { entries, exits } = highwayEnds(world);
    expect(entries).toHaveLength(2);
    expect(exits).toHaveLength(2);
    const dirs = new Set(entries.map((i) => world.highwayDir[i]));
    expect(dirs.size).toBe(2);
  });
});

describe('tools', () => {
  it('draws roads as an L-shaped path and refuses water', () => {
    const world = flatWorld();
    world.terrain[world.idx(5, 3)] = Terrain.Water;
    const plan = planTool(world, Tool.Road, 2, 3, 8, 6);
    expect(plan.tiles.length).toBe(7 + 3);
    expect(plan.tiles.find((t) => t.x === 5 && t.z === 3)?.ok).toBe(false);
    expect(plan.count).toBe(9);
  });

  it('skips tiles already in the target state', () => {
    const sim = new Simulation(flatWorld());
    sim.applyTool(planTool(sim.world, Tool.Residential, 0, 0, 3, 3));
    const again = planTool(sim.world, Tool.Residential, 0, 0, 3, 3);
    expect(again.count).toBe(0);
  });

  it('charges funds and rejects plans the city cannot afford', () => {
    const sim = new Simulation(flatWorld());
    const plan = planTool(sim.world, Tool.Road, 0, 0, 9, 0);
    const before = sim.funds;
    expect(sim.applyTool(plan).ok).toBe(true);
    expect(sim.funds).toBe(before - plan.cost);
    sim.funds = 0;
    expect(sim.applyTool(planTool(sim.world, Tool.Road, 0, 5, 9, 5))).toEqual({ ok: false, reason: 'Not enough funds' });
  });

  it('protects the highway from bulldozing, zoning and road building', () => {
    const world = worldWithHighway();
    expect(planTool(world, Tool.Bulldoze, 30, 5, 31, 5).count).toBe(0);
    expect(planTool(world, Tool.Residential, 30, 5, 31, 5).count).toBe(0);
    expect(planTool(world, Tool.Road, 28, 5, 31, 5).count).toBe(2);
  });
});

describe('growth', () => {
  it('develops zones on roads connected to the highway and ignores the rest', () => {
    const sim = new Simulation(worldWithHighway());
    sim.applyTool(planTool(sim.world, Tool.Road, 0, 10, 29, 10));
    sim.applyTool(planTool(sim.world, Tool.Residential, 0, 11, 15, 12));
    sim.applyTool(planTool(sim.world, Tool.Industrial, 16, 11, 29, 12));
    sim.applyTool(planTool(sim.world, Tool.Residential, 0, 25, 29, 26));
    runMonths(sim, 12);

    expect(developedInRow(sim.world, 11)).toBeGreaterThan(10);
    expect(developedInRow(sim.world, 25)).toBe(0);
    expect(sim.stats.population).toBeGreaterThan(0);
    expect(sim.stats.indJobs).toBeGreaterThan(0);
  });

  it('does not grow along a street network that never reaches the highway', () => {
    const sim = new Simulation(worldWithHighway());
    sim.applyTool(planTool(sim.world, Tool.Road, 0, 10, 20, 10));
    sim.applyTool(planTool(sim.world, Tool.Residential, 0, 11, 20, 12));
    sim.applyTool(planTool(sim.world, Tool.Industrial, 0, 8, 20, 9));
    runMonths(sim, 12);
    expect(sim.stats.population).toBe(0);
    expect(sim.stats.disconnectedTiles).toBeGreaterThan(0);

    // Linking the network to the highway brings people in.
    sim.applyTool(planTool(sim.world, Tool.Road, 21, 10, 29, 10));
    runMonths(sim, 12);
    expect(sim.stats.population).toBeGreaterThan(0);
    expect(sim.stats.disconnectedTiles).toBe(0);
  });

  it('grows a gridded city into the thousands within a few years', () => {
    const world = worldWithHighway(64);
    const sim = new Simulation(world);
    sim.funds = 1e9;
    for (let z = 0; z < 64; z += 6) sim.applyTool(planTool(world, Tool.Road, 0, z, 61, z));
    for (let x = 0; x < 62; x += 8) sim.applyTool(planTool(world, Tool.Road, x, 0, x, 63));
    sim.applyTool(planTool(world, Tool.Residential, 0, 0, 39, 63));
    sim.applyTool(planTool(world, Tool.Commercial, 40, 0, 47, 63));
    sim.applyTool(planTool(world, Tool.Industrial, 48, 0, 61, 63));

    const history: string[] = [];
    for (let year = 1; year <= 8; year++) {
      runMonths(sim, 12);
      const s = sim.stats;
      const d = sim.demand;
      history.push(
        `y${year} pop=${s.population} com=${s.comJobs} ind=${s.indJobs} ` +
          `R=${d.residential.toFixed(2)} C=${d.commercial.toFixed(2)} I=${d.industrial.toFixed(2)}`,
      );
    }
    console.log(history.join('\n'));
    expect(sim.stats.population).toBeGreaterThan(2000);
    expect(sim.stats.developedTiles[Zone.Commercial]).toBeGreaterThan(0);
  });

  it('reports finished buildings so newcomers can be sent to them', () => {
    const sim = new Simulation(worldWithHighway());
    sim.applyTool(planTool(sim.world, Tool.Road, 0, 10, 29, 10));
    sim.applyTool(planTool(sim.world, Tool.Residential, 0, 11, 29, 11));
    runMonths(sim, 6);
    expect(sim.completed.length).toBeGreaterThan(0);
    for (const i of sim.completed) expect(sim.world.zone[i]).toBe(Zone.Residential);
  });
});

describe('road network', () => {
  it('routes from a highway entry to a city street and back out', () => {
    const world = worldWithHighway();
    const sim = new Simulation(world);
    sim.applyTool(planTool(world, Tool.Road, 5, 10, 29, 10));
    const finder = new PathFinder(world);
    const target = world.idx(5, 10);
    const { entries, exits } = highwayEnds(world);
    for (const entry of entries) {
      const path = finder.findTo(entry, target);
      expect(path).not.toBeNull();
      expect(path![0]).toBe(entry);
      expect(path![path!.length - 1]).toBe(target);
    }
    const out = finder.find(target, (i) => exits.includes(i));
    expect(out).not.toBeNull();
  });

  it('keeps highway traffic in the direction of its lane', () => {
    const world = worldWithHighway();
    const finder = new PathFinder(world);
    // Lane x=30 runs +z. Without any junction there is no way to go back up it.
    const down = finder.findTo(world.idx(30, 5), world.idx(30, 20));
    const up = finder.findTo(world.idx(30, 20), world.idx(30, 5));
    expect(down).not.toBeNull();
    expect(up).toBeNull();
    for (let k = 1; k < down!.length; k++) {
      const [dx, dz] = DIRS[world.highwayDir[down![k - 1]]];
      expect(down![k] - down![k - 1]).toBe(world.idx(30 + dx, 5 + dz) - world.idx(30, 5));
    }
  });
});

describe('save', () => {
  it('round-trips the world and city state', () => {
    const world = new World(64, 9);
    generateTerrain(world, 9);
    const sim = new Simulation(world);
    sim.applyTool(planTool(world, Tool.Road, 2, 2, 20, 2));
    sim.applyTool(planTool(world, Tool.Residential, 2, 3, 20, 4));
    runMonths(sim, 3);

    const restored = deserialize(JSON.parse(JSON.stringify(serialize(sim))));
    for (const key of ['terrain', 'trees', 'zone', 'road', 'highwayDir', 'level', 'variant', 'construction'] as const) {
      expect(restored.world[key]).toEqual(world[key]);
    }
    expect(restored.funds).toBe(sim.funds);
    expect(restored.tick).toBe(sim.tick);
    expect(restored.stats.population).toBe(sim.stats.population);
  });

  it('adds a highway when loading a city saved before highways existed', () => {
    const world = flatWorld(64);
    const sim = new Simulation(world);
    const data = JSON.parse(JSON.stringify(serialize(sim)));
    data.version = 1;
    delete data.arrays.highwayDir;
    const restored = deserialize(data);
    expect(highwayEnds(restored.world).entries).toHaveLength(2);
  });
});
