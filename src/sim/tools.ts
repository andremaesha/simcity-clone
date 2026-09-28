import { COSTS } from '../config';
import { Terrain, Tool, Zone } from './types';
import { World } from './world';

export interface PlanTile {
  x: number;
  z: number;
  /** Whether the tool can be applied here. Tiles that are already in the target state are dropped from the plan. */
  ok: boolean;
  cost: number;
}

export interface Plan {
  tool: Tool;
  tiles: PlanTile[];
  cost: number;
  /** Number of tiles that will actually change. */
  count: number;
}

const ZONE_FOR_TOOL: Partial<Record<Tool, Zone>> = {
  [Tool.Residential]: Zone.Residential,
  [Tool.Commercial]: Zone.Commercial,
  [Tool.Industrial]: Zone.Industrial,
};

export function zoneForTool(tool: Tool): Zone | undefined {
  return ZONE_FOR_TOOL[tool];
}

/** Road tools draw an L-shaped path (longer axis first); every other tool drags a rectangle. */
export function toolUsesPath(tool: Tool): boolean {
  return tool === Tool.Road;
}

export function planTool(world: World, tool: Tool, ax: number, az: number, bx: number, bz: number): Plan {
  const coords = toolUsesPath(tool) ? lPath(ax, az, bx, bz) : rect(ax, az, bx, bz);
  const tiles: PlanTile[] = [];
  let cost = 0;
  let count = 0;
  for (const [x, z] of coords) {
    if (!world.inBounds(x, z)) continue;
    const t = evaluateTile(world, tool, x, z);
    if (!t) continue;
    tiles.push(t);
    if (t.ok) {
      cost += t.cost;
      count++;
    }
  }
  return { tool, tiles, cost, count };
}

/** Returns null when the tile is already in the tool's target state (nothing to do, nothing to show). */
function evaluateTile(world: World, tool: Tool, x: number, z: number): PlanTile | null {
  const i = world.idx(x, z);
  const water = world.terrain[i] === Terrain.Water;
  const road = world.road[i] === 1;
  const building = world.hasBuilding(i);
  const treeCost = world.trees[i] > 0 ? COSTS.clearTree : 0;

  switch (tool) {
    case Tool.Road: {
      if (road) return null;
      const ok = !water && !building;
      return { x, z, ok, cost: COSTS.road + treeCost };
    }
    case Tool.Residential:
    case Tool.Commercial:
    case Tool.Industrial: {
      const zone = ZONE_FOR_TOOL[tool]!;
      if (world.zone[i] === zone) return null;
      const ok = !water && !road && !building;
      return { x, z, ok, cost: COSTS.zone };
    }
    case Tool.Dezone: {
      if (world.zone[i] === Zone.None) return null;
      return { x, z, ok: !building, cost: 0 };
    }
    case Tool.Bulldoze: {
      if (road) return { x, z, ok: true, cost: COSTS.bulldoze };
      if (building) return { x, z, ok: true, cost: COSTS.bulldozeBuilding * world.level[i] };
      if (treeCost) return { x, z, ok: true, cost: treeCost };
      return null;
    }
    case Tool.Inspect:
      return null;
  }
}

/** Applies every `ok` tile of a plan. The caller is responsible for charging `plan.cost`. */
export function applyPlan(world: World, plan: Plan): void {
  for (const t of plan.tiles) {
    if (!t.ok) continue;
    const i = world.idx(t.x, t.z);
    switch (plan.tool) {
      case Tool.Road:
        world.trees[i] = 0;
        world.setZone(i, Zone.None);
        world.setRoad(i, true);
        break;
      case Tool.Residential:
      case Tool.Commercial:
      case Tool.Industrial:
        world.setZone(i, ZONE_FOR_TOOL[plan.tool]!);
        break;
      case Tool.Dezone:
        world.setZone(i, Zone.None);
        break;
      case Tool.Bulldoze:
        if (world.road[i]) world.setRoad(i, false);
        else if (world.hasBuilding(i)) world.clearBuilding(i);
        else world.trees[i] = 0;
        world.markDirty(i);
        break;
      case Tool.Inspect:
        break;
    }
  }
}

function rect(ax: number, az: number, bx: number, bz: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const z0 = Math.min(az, bz);
  const z1 = Math.max(az, bz);
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) out.push([x, z]);
  }
  return out;
}

function lPath(ax: number, az: number, bx: number, bz: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const xFirst = Math.abs(bx - ax) >= Math.abs(bz - az);
  const cx = xFirst ? bx : ax;
  const cz = xFirst ? az : bz;
  pushLine(out, ax, az, cx, cz, false);
  pushLine(out, cx, cz, bx, bz, true);
  return out;
}

/** Appends an axis-aligned line of tiles from (x0, z0) to (x1, z1) inclusive. */
function pushLine(out: Array<[number, number]>, x0: number, z0: number, x1: number, z1: number, skipFirst: boolean): void {
  const sx = Math.sign(x1 - x0);
  const sz = Math.sign(z1 - z0);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  for (let s = skipFirst ? 1 : 0; s <= steps; s++) out.push([x0 + sx * s, z0 + sz * s]);
}
