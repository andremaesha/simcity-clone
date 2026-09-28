import { FLOOR_HEIGHT as F } from '../config';
import { Rng, hash3 } from '../sim/rng';
import { DIRS, Zone } from '../sim/types';
import { World } from '../sim/world';
import { GeometryBuilder, Win } from './geometryBuilder';
import {
  APARTMENT_WALLS,
  AWNINGS,
  C,
  CRATES,
  HOUSE_ROOFS,
  HOUSE_WALLS,
  INDUSTRY_ROOFS,
  INDUSTRY_WALLS,
  OFFICE_WALLS,
  SHOP_WALLS,
  TOWER_WALLS,
  rgb,
  shade,
} from './palette';
import { LAYER, meshTree } from './props';

const BRICK = rgb(0xa4553f);
const CAR_COLORS = [0xd23c3c, 0x2f63b8, 0xeeeeee, 0x333638, 0xe0b22c, 0x3f8f5f, 0x9a9ea3].map(rgb);

/**
 * Procedural building for a developed zone tile. Everything is authored in the local frame
 * (tile centre at the origin, front facing +z toward the road) and rotated by `facing`.
 */
export function meshBuilding(world: World, x: number, z: number, b: GeometryBuilder): void {
  const i = world.idx(x, z);
  const zone = world.zone[i] as Zone;
  const level = world.level[i];
  const variant = world.variant[i];
  const rng = new Rng(Math.floor(hash3(x, z, variant) * 0x7fffffff));
  b.setFrame(x + 0.5, z + 0.5, facing(world, x, z, variant));

  if (world.construction[i] > 0) {
    construction(b, rng, level);
    return;
  }

  switch (zone) {
    case Zone.Residential:
      [house, bigHouse, apartment, residentialTower][level - 1]?.(b, rng);
      break;
    case Zone.Commercial:
      [shop, mixedUse, office, skyscraper][level - 1]?.(b, rng);
      break;
    case Zone.Industrial:
      [workshop, warehouse, factory, heavyPlant][level - 1]?.(b, rng);
      break;
  }
}

/** Direction (index into DIRS) the building should face: an adjacent road, else the nearest road in a straight line. */
export function facing(world: World, x: number, z: number, variant: number): number {
  const start = variant % 4;
  for (let dist = 1; dist <= 3; dist++) {
    for (let s = 0; s < 4; s++) {
      const k = (start + s) % 4;
      if (world.isRoad(x + DIRS[k][0] * dist, z + DIRS[k][1] * dist)) return k;
    }
  }
  return start;
}

// ---------------------------------------------------------------------------------------------
// Shared details

function car(b: GeometryBuilder, rng: Rng, cx: number, cz: number, alongZ: boolean): void {
  const color = rng.pick(CAR_COLORS);
  const hw = 0.035;
  const hl = 0.065;
  const [w, l] = alongZ ? [hw, hl] : [hl, hw];
  b.box(cx - w, 0.01, cz - l, cx + w, 0.055, cz + l, color, { ao: false });
  const [cw, cl] = alongZ ? [hw * 0.85, hl * 0.5] : [hl * 0.5, hw * 0.85];
  b.box(cx - cw, 0.055, cz - cl, cx + cw, 0.085, cz + cl, shade(color, 0.7), { ao: false });
}

function rooftopUnits(b: GeometryBuilder, rng: Rng, x0: number, z0: number, x1: number, z1: number, y: number): void {
  const n = rng.int(1, 3);
  for (let k = 0; k < n; k++) {
    const w = rng.range(0.06, 0.12);
    const px = rng.range(x0 + w, x1 - w);
    const pz = rng.range(z0 + w, z1 - w);
    b.box(px - w / 2, y, pz - w / 2, px + w / 2, y + rng.range(0.04, 0.08), pz + w / 2, C.lightMetal, { ao: false });
  }
}

function door(b: GeometryBuilder, cx: number, zFront: number, w = 0.07, h = 0.13): void {
  b.box(cx - w / 2, 0, zFront, cx + w / 2, h, zFront + 0.01, C.door);
}

function path(b: GeometryBuilder, x0: number, z0: number, x1: number, z1: number): void {
  b.flat(x0, z0, x1, z1, LAYER.detail, C.concrete);
}

// ---------------------------------------------------------------------------------------------
// Residential

function house(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(HOUSE_WALLS);
  const roof = rng.pick(HOUSE_ROOFS);
  const w = rng.range(0.4, 0.52);
  const d = rng.range(0.3, 0.38);
  const floors = rng.chance(0.3) ? 2 : 1;
  const h = floors * F + 0.04;
  const cx = rng.range(-0.1, 0.02);
  const cz = rng.range(-0.1, -0.02);
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;

  b.box(x0, 0, z0, x1, h, z1, wall, { win: Win.Residential });
  b.gable(x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, h, rng.range(0.13, 0.19), roof, wall);
  if (rng.chance(0.45)) b.box(x0 + 0.06, h, z0 + 0.06, x0 + 0.11, h + 0.18, z0 + 0.11, BRICK);
  door(b, cx - w * 0.2, z1);
  path(b, cx - w * 0.2 - 0.03, z1, cx - w * 0.2 + 0.03, 0.5);

  if (x1 + 0.2 < 0.48 && rng.chance(0.55)) {
    // Garage with its own driveway.
    b.box(x1, 0, cz - 0.02, x1 + 0.17, 0.17, z1, shade(wall, 0.92), { top: shade(roof, 1.1) });
    b.flat(x1 + 0.02, z1, x1 + 0.15, 0.5, LAYER.detail, C.concrete);
    if (rng.chance(0.5)) car(b, rng, x1 + 0.085, z1 + 0.12, true);
  }
  if (rng.chance(0.6)) meshTree(b, rng.range(-0.35, 0.35), rng.range(-0.42, -0.3), 0.8, rng.float());
}

function bigHouse(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(HOUSE_WALLS);
  const roof = rng.pick(HOUSE_ROOFS);
  const w = rng.range(0.6, 0.72);
  const d = rng.range(0.42, 0.5);
  const h = 2 * F + 0.04;
  const cz = -0.08;
  const x0 = -w / 2, x1 = w / 2, z0 = cz - d / 2, z1 = cz + d / 2;

  b.box(x0, 0, z0, x1, h, z1, wall, { win: Win.Residential });
  if (rng.chance(0.5)) b.pyramid(x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, h, 0.2, roof);
  else b.gable(x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, h, 0.2, roof, wall);

  // Front porch with a small roof.
  b.box(-0.16, 0, z1, 0.16, 0.025, z1 + 0.09, C.concrete);
  b.box(-0.17, F * 0.8, z1, 0.17, F * 0.8 + 0.02, z1 + 0.1, shade(roof, 1.1), { ao: false });
  door(b, -0.08, z1);
  door(b, 0.08, z1);
  path(b, -0.04, z1 + 0.09, 0.04, 0.5);
  if (rng.chance(0.5)) meshTree(b, rng.chance(0.5) ? -0.38 : 0.38, 0.36, 0.75, rng.float());
}

function apartment(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(APARTMENT_WALLS);
  const floors = rng.int(3, 5);
  const h = floors * F;
  const w = rng.range(0.76, 0.84);
  const d = rng.range(0.6, 0.72);
  const cz = -0.04;
  const x0 = -w / 2, x1 = w / 2, z0 = cz - d / 2, z1 = cz + d / 2;

  b.box(x0, 0, z0, x1, h, z1, wall, { win: Win.Residential, top: C.concrete });
  b.box(x0 - 0.01, h, z0 - 0.01, x1 + 0.01, h + 0.035, z1 + 0.01, shade(wall, 0.8), { top: C.concrete, ao: false });
  // Balconies on the street side.
  for (let f = 1; f < floors; f++) {
    b.box(x0 + 0.08, f * F - 0.012, z1, x1 - 0.08, f * F + 0.012, z1 + 0.045, shade(wall, 0.9), { ao: false });
  }
  b.box(-0.1, F * 0.7, z1, 0.1, F * 0.7 + 0.02, z1 + 0.08, C.darkMetal, { ao: false });
  door(b, 0, z1, 0.1, 0.13);
  b.box(-0.07, h + 0.035, z0 + 0.08, 0.07, h + 0.15, z0 + 0.2, shade(wall, 0.85));
  rooftopUnits(b, rng, x0 + 0.1, z0 + 0.25, x1 - 0.1, z1 - 0.05, h + 0.035);
  path(b, -0.06, z1, 0.06, 0.5);
}

function residentialTower(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(APARTMENT_WALLS.concat(TOWER_WALLS));
  const floors = rng.int(9, 16);
  const h = floors * F;
  const w = rng.range(0.6, 0.7);
  const cz = -0.03;

  b.box(-0.44, 0, -0.44, 0.44, F * 1.2, 0.42, C.concrete, { win: Win.Office });
  b.box(-w / 2, F * 1.2, cz - w / 2, w / 2, h, cz + w / 2, wall, { win: Win.Residential });
  // Vertical accent strips on the facade.
  b.box(-0.04, F * 1.2, cz + w / 2, 0.04, h, cz + w / 2 + 0.015, shade(wall, 0.75), { ao: false });
  b.box(-w / 2 + 0.05, h, cz - w / 2 + 0.05, w / 2 - 0.05, h + 0.12, cz + w / 2 - 0.05, shade(wall, 0.8));
  if (rng.chance(0.5)) {
    b.cylinder(0.1, cz - 0.1, h + 0.12, h + 0.28, 0.07, 8, C.darkMetal);
    b.cone(0.1, cz - 0.1, h + 0.28, 0.06, 0.075, 8, C.darkMetal);
  } else {
    rooftopUnits(b, rng, -w / 2 + 0.1, cz - w / 2 + 0.1, w / 2 - 0.1, cz + w / 2 - 0.1, h + 0.12);
  }
  b.box(-0.12, F * 0.6, 0.42, 0.12, F * 0.6 + 0.02, 0.48, C.darkMetal, { ao: false });
}

// ---------------------------------------------------------------------------------------------
// Commercial

function parkingLot(b: GeometryBuilder, rng: Rng, z0: number, z1: number): void {
  b.flat(-0.46, z0, 0.46, z1, LAYER.detail, C.parking);
  for (let s = -0.4; s <= 0.41; s += 0.13) b.flat(s - 0.006, z0 + 0.02, s + 0.006, z0 + 0.14, LAYER.marking, C.roadWhite);
  for (let s = -0.4; s < 0.35; s += 0.13) {
    if (rng.chance(0.55)) car(b, rng, s + 0.065, z0 + 0.08, true);
  }
}

function shop(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(SHOP_WALLS);
  const accent = rng.pick(AWNINGS);
  const w = rng.range(0.74, 0.86);
  const z0 = -0.44;
  const z1 = z0 + rng.range(0.38, 0.46);
  const h = F * 1.3;
  b.box(-w / 2, 0, z0, w / 2, h, z1, wall, { win: Win.Office, top: C.concrete });
  b.box(-w / 2 + 0.02, F * 0.8, z1, w / 2 - 0.02, F * 0.8 + 0.025, z1 + 0.1, accent, { ao: false });
  b.box(-0.18, h, z1 - 0.03, 0.18, h + 0.09, z1, accent, { ao: false });
  rooftopUnits(b, rng, -w / 2 + 0.1, z0 + 0.08, w / 2 - 0.1, z1 - 0.1, h);
  parkingLot(b, rng, z1 + 0.13, 0.48);
}

function mixedUse(b: GeometryBuilder, rng: Rng): void {
  const ground = rng.pick(SHOP_WALLS);
  const upper = rng.pick(APARTMENT_WALLS.concat(OFFICE_WALLS));
  const accent = rng.pick(AWNINGS);
  const floors = rng.int(2, 3);
  const w = rng.range(0.78, 0.86);
  const z0 = -0.42;
  const z1 = rng.range(0.22, 0.3);
  const h = floors * F + F;

  b.box(-w / 2, 0, z0, w / 2, F, z1, ground, { win: Win.Office });
  b.box(-w / 2, F, z0, w / 2, h, z1, upper, { win: Win.Residential, top: C.concrete });
  b.box(-w / 2 - 0.01, h, z0 - 0.01, w / 2 + 0.01, h + 0.03, z1 + 0.01, shade(upper, 0.8), { top: C.concrete, ao: false });
  b.box(-w / 2 + 0.03, F * 0.75, z1, w / 2 - 0.03, F * 0.75 + 0.02, z1 + 0.09, accent, { ao: false });
  // Billboard on the roof.
  b.box(-0.2, h + 0.03, z0 + 0.1, -0.18, h + 0.16, z0 + 0.12, C.darkMetal);
  b.box(0.18, h + 0.03, z0 + 0.1, 0.2, h + 0.16, z0 + 0.12, C.darkMetal);
  b.box(-0.24, h + 0.12, z0 + 0.1, 0.24, h + 0.26, z0 + 0.13, accent, { ao: false });
  b.flat(-0.46, z1, 0.46, 0.5, LAYER.detail, C.concrete);
}

function office(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(OFFICE_WALLS);
  const floors = rng.int(5, 9);
  const h = floors * F;
  const w = rng.range(0.7, 0.82);
  const d = rng.range(0.7, 0.8);
  const cz = -0.05;
  const x0 = -w / 2, x1 = w / 2, z0 = cz - d / 2, z1 = cz + d / 2;

  if (rng.chance(0.4)) {
    // Setback: the top third is narrower.
    const split = Math.ceil(floors * 0.65) * F;
    b.box(x0, 0, z0, x1, split, z1, wall, { win: Win.Office, top: C.concrete });
    b.box(x0 + 0.08, split, z0 + 0.08, x1 - 0.08, h, z1 - 0.08, wall, { win: Win.Office, top: C.concrete });
    rooftopUnits(b, rng, x0 + 0.15, z0 + 0.15, x1 - 0.15, z1 - 0.15, h);
  } else {
    b.box(x0, 0, z0, x1, h, z1, wall, { win: Win.Office, top: C.concrete });
    b.box(x0 + 0.15, h, z0 + 0.15, x1 - 0.15, h + 0.14, z1 - 0.3, shade(wall, 0.75));
  }
  b.box(-0.14, F * 0.75, z1, 0.14, F * 0.75 + 0.025, z1 + 0.1, C.darkMetal, { ao: false });
  b.flat(-0.46, z1, 0.46, 0.5, LAYER.detail, C.concrete);
}

function skyscraper(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(TOWER_WALLS);
  const floors = rng.int(14, 26);
  const base = 3;
  const mid = Math.floor((floors - base) * rng.range(0.55, 0.7));
  const y1 = base * F;
  const y2 = y1 + mid * F;
  const y3 = floors * F;
  const cz = -0.02;

  b.box(-0.44, 0, cz - 0.44, 0.44, y1, cz + 0.44, shade(wall, 1.15), { win: Win.Office, top: C.concrete });
  b.box(-0.36, y1, cz - 0.36, 0.36, y2, cz + 0.36, wall, { win: Win.Office, top: C.concrete });
  b.box(-0.27, y2, cz - 0.27, 0.27, y3, cz + 0.27, wall, { win: Win.Office, top: shade(wall, 0.7) });
  if (rng.chance(0.5)) {
    b.pyramid(-0.27, cz - 0.27, 0.27, cz + 0.27, y3, rng.range(0.25, 0.5), shade(wall, 0.8));
  } else {
    b.box(-0.12, y3, cz - 0.12, 0.12, y3 + 0.12, cz + 0.12, C.darkMetal);
    b.box(-0.012, y3 + 0.12, cz - 0.012, 0.012, y3 + rng.range(0.5, 0.9), cz + 0.012, C.lightMetal);
  }
}

// ---------------------------------------------------------------------------------------------
// Industrial

function crates(b: GeometryBuilder, rng: Rng, x0: number, z0: number, x1: number, z1: number, n: number): void {
  for (let k = 0; k < n; k++) {
    const s = rng.range(0.05, 0.09);
    const px = rng.range(x0 + s, x1 - s);
    const pz = rng.range(z0 + s, z1 - s);
    b.box(px - s / 2, 0, pz - s / 2, px + s / 2, s * rng.range(0.8, 1.4), pz + s / 2, rng.pick(CRATES));
  }
}

function truck(b: GeometryBuilder, rng: Rng, cx: number, cz: number): void {
  b.box(cx - 0.04, 0.015, cz - 0.02, cx + 0.04, 0.09, cz + 0.05, rng.pick(CAR_COLORS), { ao: false });
  b.box(cx - 0.045, 0.02, cz - 0.24, cx + 0.045, 0.12, cz - 0.03, C.white, { ao: false });
}

function workshop(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(INDUSTRY_WALLS);
  const roof = rng.pick(INDUSTRY_ROOFS);
  const w = rng.range(0.48, 0.58);
  const d = rng.range(0.38, 0.46);
  const x0 = -0.44, x1 = x0 + w, z0 = -0.44, z1 = z0 + d;
  const h = F * 1.2;
  b.box(x0, 0, z0, x1, h, z1, wall, { win: Win.Industrial });
  b.gable(x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, h, 0.08, roof, wall);
  b.box(x0 + w * 0.3, 0, z1, x0 + w * 0.7, F * 0.9, z1 + 0.01, C.darkMetal);
  crates(b, rng, x1 + 0.02, -0.4, 0.46, 0.1, rng.int(2, 4));
  if (rng.chance(0.5)) truck(b, rng, 0.25, 0.4);
}

function warehouse(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(INDUSTRY_WALLS);
  const roof = rng.pick(INDUSTRY_ROOFS);
  const w = rng.range(0.82, 0.9);
  const z0 = -0.45;
  const z1 = z0 + rng.range(0.5, 0.58);
  const h = F * 1.7;
  b.box(-w / 2, 0, z0, w / 2, h, z1, wall, { win: Win.Industrial });
  b.gable(-w / 2 - 0.01, z0 - 0.01, w / 2 + 0.01, z1 + 0.01, h, 0.05, roof, wall);
  const docks = rng.int(2, 3);
  for (let k = 0; k < docks; k++) {
    const dx = -w / 2 + ((k + 0.5) * w) / docks;
    b.box(dx - 0.07, 0, z1, dx + 0.07, F * 0.9, z1 + 0.01, C.darkMetal);
  }
  b.box(-w / 2, 0, z1, w / 2, 0.04, z1 + 0.06, C.concrete);
  if (rng.chance(0.7)) truck(b, rng, -w / 2 + (0.5 * w) / docks, z1 + 0.3);
  if (rng.chance(0.4)) truck(b, rng, w / 2 - (0.5 * w) / docks, z1 + 0.3);
}

function factory(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(INDUSTRY_WALLS);
  const roof = rng.pick(INDUSTRY_ROOFS);
  const x0 = -0.44, x1 = 0.22, z0 = -0.42, z1 = 0.12;
  const h = F * 1.8;
  b.box(x0, 0, z0, x1, h, z1, wall, { win: Win.Industrial });
  // Sawtooth roof: three shallow gables side by side.
  const teeth = 3;
  const step = (z1 - z0) / teeth;
  for (let k = 0; k < teeth; k++) b.gable(x0, z0 + k * step, x1, z0 + (k + 1) * step, h, 0.08, roof, wall);

  const chx = 0.34, chz = -0.3;
  const chH = rng.range(0.9, 1.2);
  b.cylinder(chx, chz, 0, chH, 0.05, 8, BRICK);
  b.cylinder(chx, chz, chH - 0.12, chH - 0.05, 0.056, 8, C.white);
  b.cylinder(0.33, 0.05, 0, 0.26, 0.1, 10, C.lightMetal);
  b.cone(0.33, 0.05, 0.26, 0.06, 0.1, 10, C.lightMetal);
  crates(b, rng, -0.4, 0.2, 0.1, 0.46, rng.int(1, 3));
}

function heavyPlant(b: GeometryBuilder, rng: Rng): void {
  const wall = rng.pick(INDUSTRY_WALLS);
  const roof = rng.pick(INDUSTRY_ROOFS);
  const h = F * 2.6;
  b.box(-0.46, 0, -0.42, 0.02, h, 0.16, wall, { win: Win.Industrial });
  b.gable(-0.47, -0.43, 0.03, 0.17, h, 0.1, roof, wall);
  for (const sz of [-0.22, 0.14]) {
    b.cylinder(0.25, sz, 0, 0.75, 0.13, 12, C.lightMetal);
    b.cone(0.25, sz, 0.75, 0.08, 0.13, 12, shade(C.lightMetal, 0.9));
  }
  // Pipe bridge between the hall and the silos.
  b.box(0.02, 0.45, -0.25, 0.14, 0.49, -0.19, C.darkMetal, { ao: false });
  for (const [cx, cz] of [
    [-0.36, -0.32],
    [-0.2, -0.32],
  ] as const) {
    const chH = rng.range(1.2, 1.6);
    b.cylinder(cx, cz, h, chH, 0.045, 8, BRICK);
    b.cylinder(cx, cz, chH - 0.1, chH - 0.04, 0.05, 8, C.white);
  }
  if (rng.chance(0.6)) truck(b, rng, -0.2, 0.44);
}

// ---------------------------------------------------------------------------------------------

const CONSTRUCTION_HEIGHT = [0, 0.3, 0.45, 0.8, 1.6];

function construction(b: GeometryBuilder, rng: Rng, level: number): void {
  const H = CONSTRUCTION_HEIGHT[level] ?? 0.3;
  const r = level >= 3 ? 0.4 : 0.3;
  b.box(-r - 0.03, 0, -r - 0.03, r + 0.03, 0.03, r + 0.03, C.foundation);
  const top = Math.max(0.12, H * 0.55);
  for (const [px, pz] of [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ] as const) {
    b.box(px - 0.015, 0.03, pz - 0.015, px + 0.015, top, pz + 0.015, C.scaffold);
  }
  for (let y = F; y < top; y += F) b.box(-r, y, -r, r, y + 0.02, r, C.concrete, { ao: false });
  b.box(-r, top - 0.02, -r, r, top, r, C.scaffold, { top: C.concrete, ao: false });

  if (level >= 3) {
    const mastH = H + 0.4;
    b.box(r - 0.06, 0.03, -r + 0.02, r - 0.02, mastH, -r + 0.06, C.crane);
    b.box(r - 0.7, mastH, -r + 0.025, r + 0.12, mastH + 0.04, -r + 0.055, C.crane, { ao: false });
    b.box(r + 0.05, mastH - 0.08, -r + 0.01, r + 0.13, mastH, -r + 0.07, C.darkMetal, { ao: false });
  }
  b.pyramid(-0.4, 0.3, -0.2, 0.46, 0, rng.range(0.05, 0.09), C.dirt);
}
