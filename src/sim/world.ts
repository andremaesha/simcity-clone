import { ROAD_ACCESS_RANGE } from '../config';
import { DIRS, NO_DIR, Road, Terrain, Zone } from './types';

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
  /** Road type (see `Road`): none, street, or highway lane. */
  road: Uint8Array;
  /** Travel direction (index into DIRS) of highway lanes, NO_DIR elsewhere. */
  highwayDir: Uint8Array;
  /** Development level of a zone tile: 0 = empty lot, 1..MAX_LEVEL = building density. */
  level: Uint8Array;
  /** Random per-building style seed, re-rolled whenever a building is (re)built. */
  variant: Uint8Array;
  /** Ticks left until the building on this tile finishes construction (0 = done). */
  construction: Uint8Array;

  /** Bumped on every road change, so caches built from the road network know when to refresh. */
  roadVersion = 0;
  /** Derived: 1 for road tiles whose network reaches the highway. */
  roadConnected: Uint8Array;
  /** Derived: distance to the nearest street connected to the highway (255 when out of range). This is what zones need. */
  roadDist: Uint8Array;
  /** Derived: distance to the nearest street of any kind, used to explain why a zone is not served. */
  streetDist: Uint8Array;
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
    this.highwayDir = new Uint8Array(this.count).fill(NO_DIR);
    this.level = new Uint8Array(this.count);
    this.variant = new Uint8Array(this.count);
    this.construction = new Uint8Array(this.count);
    this.roadConnected = new Uint8Array(this.count);
    this.roadDist = new Uint8Array(this.count).fill(255);
    this.streetDist = new Uint8Array(this.count).fill(255);
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

  /** Any kind of road (street or highway). */
  isRoad(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.road[this.idx(x, z)] !== Road.None;
  }

  isStreet(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.road[this.idx(x, z)] === Road.Street;
  }

  isHighway(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.road[this.idx(x, z)] === Road.Highway;
  }

  /** Bitmask of road neighbours (streets and highways), bit k set when DIRS[k] is a road. */
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

  /** Builds or removes a street. Highway lanes are fixed and never touched by this. */
  setRoad(i: number, value: boolean): void {
    if (this.road[i] === Road.Highway) return;
    this.road[i] = value ? Road.Street : Road.None;
    this.roadsChanged = true;
    this.roadVersion++;
    this.markDirty(i, ROAD_ACCESS_RANGE);
  }

  setHighway(i: number, dir: number): void {
    this.road[i] = Road.Highway;
    this.highwayDir[i] = dir;
    this.roadsChanged = true;
    this.roadVersion++;
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

  /** Recomputes highway connectivity and the access distance fields if any road changed. */
  updateRoadAccess(): void {
    if (!this.roadsChanged) return;
    this.roadsChanged = false;
    this.floodConnected();
    this.distanceField(this.roadDist, (i) => this.road[i] === Road.Street && this.roadConnected[i] === 1);
    this.distanceField(this.streetDist, (i) => this.road[i] === Road.Street);
  }

  /** Flood fill over all roads starting from the highway: everything reached is connected to the outside world. */
  private floodConnected(): void {
    const { size, road, roadConnected } = this;
    roadConnected.fill(0);
    const queue = new Int32Array(this.count);
    let tail = 0;
    for (let i = 0; i < this.count; i++) {
      if (road[i] === Road.Highway) {
        roadConnected[i] = 1;
        queue[tail++] = i;
      }
    }
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      const x = i % size;
      const z = (i - x) / size;
      for (const [dx, dz] of DIRS) {
        if (!this.isRoad(x + dx, z + dz)) continue;
        const n = this.idx(x + dx, z + dz);
        if (roadConnected[n]) continue;
        roadConnected[n] = 1;
        queue[tail++] = n;
      }
    }
  }

  /** Multi-source BFS (up to ROAD_ACCESS_RANGE, not across water) from every tile where `isSource` holds. */
  private distanceField(out: Uint8Array, isSource: (i: number) => boolean): void {
    const { size } = this;
    out.fill(255);
    const queue = new Int32Array(this.count);
    let tail = 0;
    for (let i = 0; i < this.count; i++) {
      if (isSource(i)) {
        out[i] = 0;
        queue[tail++] = i;
      }
    }
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      const d = out[i];
      if (d >= ROAD_ACCESS_RANGE) continue;
      const x = i % size;
      const z = (i - x) / size;
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.inBounds(nx, nz)) continue;
        const n = this.idx(nx, nz);
        if (out[n] !== 255 || this.terrain[n] === Terrain.Water || this.road[n] === Road.Highway) continue;
        out[n] = d + 1;
        queue[tail++] = n;
      }
    }
  }

  /** A zone tile is served when a street connected to the highway is within ROAD_ACCESS_RANGE. */
  hasRoadAccess(i: number): boolean {
    return this.roadDist[i] <= ROAD_ACCESS_RANGE;
  }

  /** Near a street, but that street network does not reach the highway. */
  isDisconnected(i: number): boolean {
    return this.streetDist[i] <= ROAD_ACCESS_RANGE && this.roadDist[i] > ROAD_ACCESS_RANGE;
  }

  /** Forces derived data to be recomputed, e.g. after loading a save. */
  invalidateDerived(): void {
    this.roadsChanged = true;
  }
}
