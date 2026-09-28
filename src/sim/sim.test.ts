import { describe, expect, it } from 'vitest';
import { TICKS_PER_MONTH } from '../config';
import { generateTerrain } from './mapgen';
import { deserialize, serialize } from './save';
import { Simulation } from './simulation';
import { planTool } from './tools';
import { Terrain, Tool, Zone } from './types';
import { World } from './world';

function flatWorld(size = 32): World {
  return new World(size, 1);
}

function runMonths(sim: Simulation, months: number): void {
  for (let t = 0; t < months * TICKS_PER_MONTH; t++) sim.step();
}

describe('mapgen', () => {
  it('is deterministic for a seed and leaves most of the map buildable', () => {
    const a = new World(128, 42);
    const b = new World(128, 42);
    generateTerrain(a, 42); 
    generateTerrain(b, 42);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.trees).toEqual(b.trees);
    const water = a.terrain.reduce((n, t) => n + (t === Terrain.Water ? 1 : 0), 0) / a.count;
    expect(water).toBeGreaterThan(0.02);
    expect(water).toBeLessThan(0.3);
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
});

describe('growth', () => {
  it('develops zones that have road access and ignores those that do not', () => {
    const sim = new Simulation(flatWorld());
    sim.applyTool(planTool(sim.world, Tool.Road, 0, 10, 31, 10));
    sim.applyTool(planTool(sim.world, Tool.Residential, 0, 11, 15, 12));
    sim.applyTool(planTool(sim.world, Tool.Industrial, 16, 11, 31, 12));
    sim.applyTool(planTool(sim.world, Tool.Residential, 0, 25, 31, 26));
    runMonths(sim, 12);

    const { world } = sim;
    const developedNear = [...Array(world.size).keys()].filter((x) => world.level[world.idx(x, 11)] > 0).length;
    const developedFar = [...Array(world.size).keys()].filter((x) => world.level[world.idx(x, 25)] > 0).length;
    expect(developedNear).toBeGreaterThan(10);
    expect(developedFar).toBe(0);
    expect(sim.stats.population).toBeGreaterThan(0);
    expect(sim.stats.indJobs).toBeGreaterThan(0);
  });

  it('grows a gridded city into the thousands within a few years', () => {
    const world = new World(64, 3);
    const sim = new Simulation(world);
    sim.funds = 1e9;
    for (let z = 0; z < 64; z += 6) sim.applyTool(planTool(world, Tool.Road, 0, z, 63, z));
    for (let x = 0; x < 64; x += 8) sim.applyTool(planTool(world, Tool.Road, x, 0, x, 63));
    sim.applyTool(planTool(world, Tool.Residential, 0, 0, 39, 63));
    sim.applyTool(planTool(world, Tool.Commercial, 40, 0, 47, 63));
    sim.applyTool(planTool(world, Tool.Industrial, 48, 0, 63, 63));

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
    for (const key of ['terrain', 'trees', 'zone', 'road', 'level', 'variant', 'construction'] as const) {
      expect(restored.world[key]).toEqual(world[key]);
    }
    expect(restored.funds).toBe(sim.funds);
    expect(restored.tick).toBe(sim.tick);
    expect(restored.stats.population).toBe(sim.stats.population);
  });
});
