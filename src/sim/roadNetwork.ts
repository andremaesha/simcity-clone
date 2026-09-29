import { DIRS, Road } from './types';
import { World } from './world';

/**
 * The road graph vehicles drive on. Streets are two-way and connect to every neighbouring road.
 * Highway lanes are one-way: a vehicle carries on down its lane, leaves onto a street alongside it,
 * or, only where a street joins (an interchange), crosses over to the opposite carriageway.
 */
export function roadNeighbors(world: World, i: number, out: number[]): number[] {
  out.length = 0;
  const { size, road, highwayDir } = world;
  const x = i % size;
  const z = (i - x) / size;

  if (road[i] === Road.Street) {
    for (const [dx, dz] of DIRS) {
      if (world.isRoad(x + dx, z + dz)) out.push(world.idx(x + dx, z + dz));
    }
    return out;
  }
  if (road[i] !== Road.Highway) return out;

  const d = highwayDir[i];
  const fx = x + DIRS[d][0];
  const fz = z + DIRS[d][1];
  if (world.isHighway(fx, fz) && highwayDir[world.idx(fx, fz)] === d) out.push(world.idx(fx, fz));

  for (const k of [(d + 1) % 4, (d + 3) % 4]) {
    const nx = x + DIRS[k][0];
    const nz = z + DIRS[k][1];
    if (!world.inBounds(nx, nz)) continue;
    const n = world.idx(nx, nz);
    if (road[n] === Road.Street) {
      out.push(n);
    } else if (road[n] === Road.Highway && highwayDir[n] === (d + 2) % 4 && (isJunction(world, i) || isJunction(world, n))) {
      out.push(n);
    }
  }
  return out;
}

/** A highway lane tile with a street joining it from the side. */
export function isJunction(world: World, i: number): boolean {
  const x = i % world.size;
  const z = (i - x) / world.size;
  for (const [dx, dz] of DIRS) {
    if (world.isStreet(x + dx, z + dz)) return true;
  }
  return false;
}

/** Highway lane tiles on the map edge: where traffic arrives from and leaves to the outside world. */
export function highwayEnds(world: World): { entries: number[]; exits: number[] } {
  const entries: number[] = [];
  const exits: number[] = [];
  const { size } = world;
  for (let i = 0; i < world.count; i++) {
    if (world.road[i] !== Road.Highway) continue;
    const x = i % size;
    const z = (i - x) / size;
    const [dx, dz] = DIRS[world.highwayDir[i]];
    if (!world.inBounds(x - dx, z - dz)) entries.push(i);
    if (!world.inBounds(x + dx, z + dz)) exits.push(i);
  }
  return { entries, exits };
}

/** Breadth-first path finder over the directed road graph, with buffers reused between searches. */
export class PathFinder {
  private prev: Int32Array;
  private stamp: Uint32Array;
  private queue: Int32Array;
  private generation = 0;
  private readonly next: number[] = [];

  constructor(private world: World) {
    this.prev = new Int32Array(world.count);
    this.stamp = new Uint32Array(world.count);
    this.queue = new Int32Array(world.count);
  }

  setWorld(world: World): void {
    this.world = world;
    if (world.count !== this.prev.length) {
      this.prev = new Int32Array(world.count);
      this.stamp = new Uint32Array(world.count);
      this.queue = new Int32Array(world.count);
    }
    this.stamp.fill(0);
    this.generation = 0;
  }

  /** Shortest path (list of road tiles, both ends included) from `from` to the first tile where `isGoal` holds. */
  find(from: number, isGoal: (i: number) => boolean): number[] | null {
    const { world, prev, stamp, queue } = this;
    if (world.road[from] === Road.None) return null;
    this.generation++;
    const gen = this.generation;
    let tail = 0;
    queue[tail++] = from;
    stamp[from] = gen;
    prev[from] = -1;
    for (let head = 0; head < tail; head++) {
      const i = queue[head];
      if (isGoal(i)) {
        const path: number[] = [];
        for (let p = i; p !== -1; p = prev[p]) path.push(p);
        return path.reverse();
      }
      for (const n of roadNeighbors(world, i, this.next)) {
        if (stamp[n] === gen) continue;
        stamp[n] = gen;
        prev[n] = i;
        queue[tail++] = n;
      }
    }
    return null;
  }

  findTo(from: number, to: number): number[] | null {
    return this.find(from, (i) => i === to);
  }
}
