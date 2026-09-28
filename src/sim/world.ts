import { ROAD_ACCESS_RANGE } from '../config';
import { DIRS, Terrain, Zone } from './types';

/**
 * The tile grid, stored as struct-of-arrays so it is cheap to iterate and trivial to serialise.
 * Rendering never mutates the world; it only drains the dirty-tile queue.
 */
export class World {
  readonly size: number;
  readonly count: number;
  seed: number;

  terrain: Uint8Array;
  /** Number of trees on the tile (0..3). */
  trees: Uint8Array;
  zone: Uint8Array;
  road: Uint8Array;
  /** Development level of a zone tile: 0 = empty lot, 1..MAX_LEVEL = building density. */
  level: Uint8Array;
  /** Random per-building style seed, re-rolled whenever a building is (re)built. */
  variant: Uint8Array;
  /** Ticks left until the building on this tile finishes construction (0 = done). */
  construction: Uint8Array;

  /** Derived: Manhattan distance to the nearest road, 255 when farther than ROAD_ACCESS_RANGE. */
  roadDist: Uint8Array;
  private roadsChanged = true;

  /** 0 = clean, otherwise 1 + the radius (in tiles) whose visuals the change can affect. */
  private dirtyFlags: Uint8Array;
  private dirtyList: number[] = [];

  constructor(size: number, seed: number) {
    this.size = size;
    this.count = size * size;
    this.seed = seed;
    this.terrain = new Uint8Array(this.count);
    this.trees = new Uint8Array(this.count);
    this.zone = new Uint8Array(this.count);
    this.road = new Uint8Array(this.count);
    this.level = new Uint8Array(this.count);
    this.variant = new Uint8Array(this.count);
    this.construction = new Uint8Array(this.count);
    this.roadDist = new Uint8Array(this.count).fill(255);
    this.dirtyFlags = new Uint8Array(this.count);
  }

  idx(x: number, z: number): number {
    return z * this.size + x;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.size && z < this.size;
  }

  isWater(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.terrain[this.idx(x, z)] === Terrain.Water;
  }

  isRoad(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.road[this.idx(x, z)] === 1;
  }

  /** Bitmask of road neighbours, bit k set when DIRS[k] is a road. */
  roadMask(x: number, z: number): number {
    let mask = 0;
    for (let k = 0; k < 4; k++) {
      if (this.isRoad(x + DIRS[k][0], z + DIRS[k][1])) mask |= 1 << k;
    }
    return mask;
  }

  hasBuilding(i: number): boolean {
    return this.level[i] > 0;
  }

  /**
   * Queues tile i for re-rendering. `radius` widens the visual impact: roads change how neighbours
   * connect and which way nearby buildings face, so road edits pass ROAD_ACCESS_RANGE.
   */
  markDirty(i: number, radius = 0): void {
    const flag = this.dirtyFlags[i];
    if (flag === 0) this.dirtyList.push(i);
    if (radius + 1 > flag) this.dirtyFlags[i] = radius + 1;
  }

  markAllDirty(): void {
    for (let i = 0; i < this.count; i++) this.markDirty(i);
  }

  /** Hands every tile changed since the last call to `visit` (with its impact radius), then clears the queue. */
  drainDirty(visit: (i: number, radius: number) => void): void {
    const list = this.dirtyList;
    this.dirtyList = [];
    for (const i of list) {
      const radius = this.dirtyFlags[i] - 1;
      this.dirtyFlags[i] = 0;
      visit(i, radius);
    }
  }

  setRoad(i: number, value: boolean): void {
    this.road[i] = value ? 1 : 0;
    this.roadsChanged = true;
    this.markDirty(i, ROAD_ACCESS_RANGE);
  }

  clearBuilding(i: number): void {
    this.level[i] = 0;
    this.construction[i] = 0;
    this.markDirty(i);
  }

  setZone(i: number, zone: Zone): void {
    this.zone[i] = zone;
    if (zone === Zone.None) this.clearBuilding(i);
    this.markDirty(i);
  }

  /** Recomputes `roadDist` with a multi-source BFS if any road changed. */
  updateRoadAccess(): void {
    if (!this.roadsChanged) return;
    this.roadsChanged = false;
    const { size, roadDist } = this;
    roadDist.fill(255);
    const queue = new Int32Array(this.count);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.road[i]) {
        roadDist[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++];
      const d = roadDist[i];
      if (d >= ROAD_ACCESS_RANGE) continue;
      const x = i % size;
      const z = (i - x) / size;
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.inBounds(nx, nz)) continue;
        const n = this.idx(nx, nz);
        if (roadDist[n] !== 255 || this.terrain[n] === Terrain.Water) continue;
        roadDist[n] = d + 1;
        queue[tail++] = n;
      }
    }
  }

  hasRoadAccess(i: number): boolean {
    return this.roadDist[i] <= ROAD_ACCESS_RANGE;
  }

  /** Forces derived data to be recomputed, e.g. after loading a save. */
  invalidateDerived(): void {
    this.roadsChanged = true;
  }
}
