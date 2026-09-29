import { ROAD_ACCESS_RANGE } from '../config';
import { DIRS } from './types';
import { World } from './world';

/**
 * Where a building meets the street: the direction it faces (index into DIRS) and the street tile
 * its traffic uses. Prefers an adjacent street, else the nearest one in a straight line. Highways
 * never count: nothing can front onto a highway. `variant` breaks ties so corner lots differ.
 */
export function frontage(world: World, x: number, z: number, variant: number): { dir: number; road: number } {
  const start = variant % 4;
  for (let dist = 1; dist <= ROAD_ACCESS_RANGE; dist++) {
    for (let s = 0; s < 4; s++) {
      const k = (start + s) % 4;
      const rx = x + DIRS[k][0] * dist;
      const rz = z + DIRS[k][1] * dist;
      if (world.isStreet(rx, rz)) return { dir: k, road: world.idx(rx, rz) };
    }
  }
  return { dir: start, road: -1 };
}
