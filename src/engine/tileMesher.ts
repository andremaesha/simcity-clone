import { WATER_DEPTH } from '../config';
import { hash3 } from '../sim/rng';
import { isJunction } from '../sim/roadNetwork';
import { DIRS, Road, Terrain, Zone } from '../sim/types';
import { World } from '../sim/world';
import { meshBuilding } from './buildingMesher';
import { GeometryBuilder } from './geometryBuilder';
import { C, RGB, mix, shade } from './palette';
import { LAYER, meshTree } from './props';

const ROAD_HALF = 0.36;

const ZONE_TINT: Record<Zone, RGB> = {
  [Zone.None]: C.grass,
  [Zone.Residential]: C.zoneR,
  [Zone.Commercial]: C.zoneC,
  [Zone.Industrial]: C.zoneI,
};

const LOT_COLOR: Record<Zone, RGB> = {
  [Zone.None]: C.grass,
  [Zone.Residential]: C.lawn,
  [Zone.Commercial]: C.concrete,
  [Zone.Industrial]: C.gravel,
};

/** Appends everything static on tile (x, z) to the builder. */
export function meshTile(world: World, x: number, z: number, b: GeometryBuilder): void {
  const i = world.idx(x, z);
  const cx = x + 0.5;
  const cz = z + 0.5;

  if (world.terrain[i] === Terrain.Water) {
    meshWater(world, x, z, b);
    if (world.road[i] === Road.Highway) meshHighway(world, x, z, b, true);
    return;
  }

  b.setFrame(cx, cz, 0);
  if (world.road[i] === Road.Highway) {
    meshHighway(world, x, z, b, false);
  } else if (world.road[i] === Road.Street) {
    meshRoad(world, x, z, b);
  } else {
    meshGround(world, x, z, b);
  }

  // Banks down to the water surface on every side that borders water.
  for (let k = 0; k < 4; k++) {
    if (!world.isWater(x + DIRS[k][0], z + DIRS[k][1])) continue;
    b.setFrame(cx, cz, k);
    b.quad(-0.5, -WATER_DEPTH, 0.5, 0.5, -WATER_DEPTH, 0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, C.cliff, 0, C.sand);
  }
  b.setFrame(cx, cz, 0);

  if (world.trees[i] > 0) meshTrees(x, z, world.trees[i], b);
  if (world.level[i] > 0) meshBuilding(world, x, z, b);
}

function meshWater(world: World, x: number, z: number, b: GeometryBuilder): void {
  let open = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (world.isWater(x + dx, z + dz) || !world.inBounds(x + dx, z + dz)) open++;
    }
  }
  const depth = open / 9;
  const color = mix(C.water, C.waterDeep, depth * 0.8 + hash3(x, z, 5) * 0.2);
  b.setFrame(x + 0.5, z + 0.5, 0);
  b.flat(-0.5, -0.5, 0.5, 0.5, -WATER_DEPTH, color);
}

/**
 * One carriageway tile of the highway: two lanes in the lane's travel direction. Built in a frame
 * where local +z is the direction of travel, so the right shoulder is local -x and the opposite
 * carriageway (with the median barrier) is local +x. Over water it becomes a bridge deck on piers.
 */
function meshHighway(world: World, x: number, z: number, b: GeometryBuilder, bridge: boolean): void {
  const i = world.idx(x, z);
  const d = world.highwayDir[i];
  const [lx, lz] = DIRS[(d + 1) % 4];
  const [rx, rz] = DIRS[(d + 3) % 4];
  const oppositeLane = world.isHighway(x + lx, z + lz) ? world.idx(x + lx, z + lz) : -1;
  const streetOnRight = world.isStreet(x + rx, z + rz);
  const interchange = isJunction(world, i) || (oppositeLane >= 0 && isJunction(world, oppositeLane));

  b.setFrame(x + 0.5, z + 0.5, d);
  if (bridge) {
    b.box(-0.5, -0.08, -0.5, 0.5, 0, 0.5, C.barrier, { top: C.highway, ao: false });
    if ((x + z) % 2 === 0) b.box(-0.12, -WATER_DEPTH, -0.1, 0.12, -0.08, 0.1, shade(C.barrier, 0.8), { ao: false });
  } else {
    b.flat(-0.5, -0.5, 0.5, 0.5, LAYER.ground, C.highway);
  }

  // Dashed lane divider, solid shoulder line (broken where a street joins) and yellow median line.
  for (const s of [-0.45, -0.05]) b.flat(-0.015, s, 0.015, s + 0.25, LAYER.marking, C.roadWhite);
  if (!streetOnRight) b.flat(-0.43, -0.5, -0.41, 0.5, LAYER.marking, C.roadWhite);
  b.flat(0.41, -0.5, 0.43, 0.5, LAYER.marking, C.roadLine);

  // Median barrier, open at interchanges so traffic can cross to the other carriageway.
  if (oppositeLane >= 0 && !interchange) b.box(0.46, 0, -0.5, 0.5, 0.07, 0.5, C.barrier);
  // Guardrail on the outer shoulder, open where a street joins.
  if (!streetOnRight) {
    b.box(-0.5, 0.035, -0.5, -0.475, 0.06, 0.5, C.guardrail, { ao: false });
    for (const s of [-0.3, 0.2]) b.box(-0.495, 0, s, -0.48, 0.035, s + 0.02, C.guardrail);
  }
  b.setFrame(x + 0.5, z + 0.5, 0);
}

function meshGround(world: World, x: number, z: number, b: GeometryBuilder): void {
  const i = world.idx(x, z);
  let grass = mix(C.grass, C.grassDark, hash3(x, z, 17) * 0.7);
  if (nearWater(world, x, z)) grass = mix(grass, C.sand, 0.6);

  const zone = world.zone[i] as Zone;
  if (zone === Zone.None) {
    b.flat(-0.5, -0.5, 0.5, 0.5, LAYER.ground, grass);
    return;
  }

  if (world.level[i] === 0) {
    // Empty zoned lot: tinted tile with a darker rim so individual lots read at a glance.
    const tint = mix(grass, ZONE_TINT[zone], 0.7);
    framedTile(b, 0.06, shade(tint, 0.82), tint);
    return;
  }

  const lot = world.construction[i] > 0 ? C.dirt : mix(LOT_COLOR[zone], grass, zone === Zone.Residential ? 0.3 : 0.1);
  framedTile(b, 0.04, shade(lot, 0.9), lot);
}

/** Tile split into a centre and four rim strips; no overlapping faces, so no z-fighting. */
function framedTile(b: GeometryBuilder, inset: number, rim: RGB, centre: RGB): void {
  const a = 0.5 - inset;
  const y = LAYER.ground;
  b.flat(-0.5, a, 0.5, 0.5, y, rim);
  b.flat(-0.5, -0.5, 0.5, -a, y, rim);
  b.flat(a, -a, 0.5, a, y, rim);
  b.flat(-0.5, -a, -a, a, y, rim);
  b.flat(-a, -a, a, a, y, centre);
}

function nearWater(world: World, x: number, z: number): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (world.isWater(x + dx, z + dz)) return true;
    }
  }
  return false;
}

function meshRoad(world: World, x: number, z: number, b: GeometryBuilder): void {
  const cx = x + 0.5;
  const cz = z + 0.5;
  const mask = world.roadMask(x, z);
  const links = popcount(mask);
  const r = ROAD_HALF;

  b.flat(-0.5, -0.5, 0.5, 0.5, LAYER.ground, C.sidewalk);
  b.flat(-r, -r, r, r, LAYER.asphalt, C.asphalt);
  for (let k = 0; k < 4; k++) {
    if (!(mask & (1 << k))) continue;
    b.setFrame(cx, cz, k);
    b.flat(-r, r, r, 0.5, LAYER.asphalt, C.asphalt);
  }

  const straight = mask === 0b0101 || mask === 0b1010;
  if (straight) {
    // Dashed centre line plus solid edge lines along the road axis.
    b.setFrame(cx, cz, mask === 0b0101 ? 0 : 1);
    b.flat(-0.018, -0.42, 0.018, -0.12, LAYER.marking, C.roadLine);
    b.flat(-0.018, 0.08, 0.018, 0.38, LAYER.marking, C.roadLine);
    b.flat(-r + 0.03, -0.5, -r + 0.05, 0.5, LAYER.marking, C.roadWhite);
    b.flat(r - 0.05, -0.5, r - 0.03, 0.5, LAYER.marking, C.roadWhite);
  } else if (links >= 3) {
    // Zebra crossings on every arm of an intersection.
    for (let k = 0; k < 4; k++) {
      if (!(mask & (1 << k))) continue;
      b.setFrame(cx, cz, k);
      for (let s = -r + 0.04; s < r - 0.05; s += 0.12) {
        b.flat(s, 0.37, s + 0.06, 0.47, LAYER.marking, C.roadWhite);
      }
    }
  } else {
    // Corners and dead ends: centre line that follows the road.
    for (let k = 0; k < 4; k++) {
      if (!(mask & (1 << k))) continue;
      b.setFrame(cx, cz, k);
      b.flat(-0.018, 0.02, 0.018, 0.4, LAYER.marking, C.roadLine);
    }
  }
  b.setFrame(cx, cz, 0);
}

function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
}

function meshTrees(x: number, z: number, count: number, b: GeometryBuilder): void {
  for (let t = 0; t < count; t++) {
    const px = (hash3(x, z, t * 3 + 1) - 0.5) * 0.62;
    const pz = (hash3(x, z, t * 3 + 2) - 0.5) * 0.62;
    const kind = hash3(x, z, t * 3 + 3);
    const s = 0.8 + hash3(x, z, t + 40) * 0.5;
    meshTree(b, px, pz, s, kind);
  }
}
