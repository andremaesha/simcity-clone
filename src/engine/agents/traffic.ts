import { BufferGeometry, Color, InstancedMesh, Material, Matrix4, Scene } from 'three';
import { frontage } from '../../sim/frontage';
import { PathFinder, highwayEnds } from '../../sim/roadNetwork';
import { Simulation } from '../../sim/simulation';
import { DIRS, Road, Zone } from '../../sim/types';
import { World } from '../../sim/world';
import { RGB } from '../palette';
import { LanePath, PathSample } from './lanePath';
import { CAR_PAINT, TRUCK_PAINT, VAN_PAINT, VEHICLE_SCALE, carGeometry, truckGeometry, vanGeometry } from './vehicleModels';

const Kind = { Car: 0, Van: 1, Truck: 2 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

const MAX_VEHICLES = 700;
/** Cruising speeds in tiles per second at normal game speed. */
const STREET_SPEED = 1.1;
const HIGHWAY_SPEED = 2.4;
const TURN_FACTOR = 0.55;
const ACCELERATION = 1.6;
const BRAKING = 7;
/** Sideways lane offsets from the tile centre line (positive = right of travel). */
const STREET_LANE = 0.18;
const HIGHWAY_SLOW_LANE = 0.23;
const HIGHWAY_FAST_LANE = -0.21;
const ROAD_Y = 0.015;
/** A vehicle queued for this long drives through whatever blocks it for GHOST_TIME, so gridlocks always clear. */
const MAX_WAIT = 5;
const GHOST_TIME = 1.5;
const MAX_PATH_SEARCHES_PER_FRAME = 4;
const MOVE_IN_QUEUE_LIMIT = 40;
/** Half the body length of each kind (car, van, truck), for keeping a gap in queues. */
const HALF_LENGTH = [0.075, 0.1, 0.15].map((l) => l * VEHICLE_SCALE);

interface Vehicle {
  kind: Kind;
  /** False for through traffic that only uses the highway. */
  city: boolean;
  path: LanePath;
  seg: number;
  t: number;
  speed: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
  waited: number;
  ghost: number;
  color: RGB;
}

/**
 * Cars, moving vans and freight trucks following real routes over the road graph:
 * through traffic on the highway, newcomers driving from the highway to freshly finished buildings,
 * commuters between homes and workplaces, shoppers and freight. The amount scales with the city.
 * Purely visual for now: congestion slows cars down but does not feed back into the simulation.
 */
export class Traffic {
  private vehicles: Vehicle[] = [];
  private readonly meshes: InstancedMesh[];
  private readonly finder: PathFinder;
  private entries: number[] = [];
  private exits: number[] = [];
  private roadVersion = -1;

  private homes: number[] = [];
  private shops: number[] = [];
  private factories: number[] = [];
  private listTimer = 0;
  private throughTimer = 0;
  private readonly moveIns: number[] = [];

  private readonly sample: PathSample = { x: 0, z: 0, hx: 0, hz: 1 };
  private readonly buckets = new Map<number, Vehicle[]>();
  private readonly matrix = new Matrix4();
  private readonly color = new Color();

  constructor(
    scene: Scene,
    private world: World,
    material: Material,
  ) {
    const geometries: BufferGeometry[] = [carGeometry(), vanGeometry(), truckGeometry()];
    this.meshes = geometries.map((g) => {
      const mesh = new InstancedMesh(g, material, MAX_VEHICLES);
      mesh.count = 0;
      mesh.frustumCulled = false; // instances are spread over the whole map
      mesh.castShadow = false; // moving shadows would force a shadow-map redraw every frame
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });
    this.finder = new PathFinder(world);
  }

  get count(): number {
    return this.vehicles.length;
  }

  reset(world: World): void {
    this.world = world;
    this.finder.setWorld(world);
    this.vehicles = [];
    this.moveIns.length = 0;
    this.roadVersion = -1;
    this.listTimer = 0;
    for (const m of this.meshes) m.count = 0;
  }

  /**
   * Advances traffic by `dt` real seconds scaled by `speed` (0 when paused).
   * Returns true when anything visible changed.
   */
  update(dt: number, speed: number, sim: Simulation): boolean {
    const { world } = this;
    // Newcomers: every finished building gets a delivery from the highway.
    for (const i of sim.completed) if (this.moveIns.length < MOVE_IN_QUEUE_LIMIT) this.moveIns.push(i);
    sim.completed.length = 0;

    if (speed <= 0) return false;
    const step = dt * speed;

    if (world.roadVersion !== this.roadVersion) {
      this.roadVersion = world.roadVersion;
      ({ entries: this.entries, exits: this.exits } = highwayEnds(world));
    }
    this.listTimer -= step;
    if (this.listTimer <= 0) {
      this.listTimer = 2;
      this.refreshDestinations();
    }

    this.spawn(step, sim);
    this.simulate(step);
    this.writeInstances();
    return this.vehicles.length > 0;
  }

  // -------------------------------------------------------------------------------------------
  // Spawning

  private refreshDestinations(): void {
    const { world } = this;
    this.homes = [];
    this.shops = [];
    this.factories = [];
    for (let i = 0; i < world.count; i++) {
      if (world.level[i] === 0 || world.construction[i] > 0 || !world.hasRoadAccess(i)) continue;
      const zone = world.zone[i];
      if (zone === Zone.Residential) this.homes.push(i);
      else if (zone === Zone.Commercial) this.shops.push(i);
      else if (zone === Zone.Industrial) this.factories.push(i);
    }
  }

  private spawn(step: number, sim: Simulation): void {
    const pop = sim.stats.population;
    const jobs = sim.stats.comJobs + sim.stats.indJobs;

    // Through traffic keeps the highway busy even before the city exists.
    this.throughTimer -= step;
    if (this.throughTimer <= 0 && this.entries.length > 0 && this.vehicles.length < MAX_VEHICLES) {
      this.throughTimer = Math.max(0.5, 1.8 - pop / 15000) * (0.6 + Math.random() * 0.8);
      this.spawnThrough();
    }

    let searches = MAX_PATH_SEARCHES_PER_FRAME;
    while (this.moveIns.length > 0 && searches > 0 && this.vehicles.length < MAX_VEHICLES) {
      const i = this.moveIns.shift()!;
      const kind = this.world.zone[i] === Zone.Residential ? Kind.Van : Kind.Truck;
      this.spawnFromHighway(this.frontageOf(i), kind);
      searches--;
    }

    const target = Math.min(MAX_VEHICLES, Math.floor(pop / 25 + jobs / 50));
    let city = 0;
    for (const v of this.vehicles) if (v.city) city++;
    while (searches > 0 && city < target && this.vehicles.length < MAX_VEHICLES) {
      if (this.spawnCityTrip()) city++;
      searches--;
    }
  }

  private spawnThrough(): void {
    const { world } = this;
    const entry = pick(this.entries);
    const tiles: number[] = [];
    const dir = world.highwayDir[entry];
    let x = entry % world.size;
    let z = Math.floor(entry / world.size);
    while (world.isHighway(x, z) && world.highwayDir[world.idx(x, z)] === dir) {
      tiles.push(world.idx(x, z));
      x += DIRS[dir][0];
      z += DIRS[dir][1];
    }
    this.add(tiles, Math.random() < 0.8 ? Kind.Car : Kind.Truck, false);
  }

  private spawnFromHighway(to: number, kind: Kind): boolean {
    if (to < 0 || this.entries.length === 0) return false;
    const path = this.finder.findTo(pick(this.entries), to);
    return path !== null && this.add(path, kind, true);
  }

  private spawnToHighway(from: number, kind: Kind): boolean {
    if (from < 0 || this.exits.length === 0) return false;
    const exits = this.exits;
    const path = this.finder.find(from, (i) => exits.includes(i));
    return path !== null && this.add(path, kind, true);
  }

  /** One trip that makes the city feel inhabited: commuting, shopping, freight, visitors. Returns true if spawned. */
  private spawnCityTrip(): boolean {
    const { homes, shops, factories } = this;
    const workplaces = shops.length + factories.length;
    const r = Math.random();
    if (homes.length > 0 && workplaces > 0 && r < 0.45) {
      // Commute in either direction between a home and a job.
      const home = this.frontageOf(pick(homes));
      const work = this.frontageOf(Math.random() * workplaces < shops.length ? pick(shops) : pick(factories));
      return Math.random() < 0.6 ? this.trip(home, work, Kind.Car) : this.trip(work, home, Kind.Car);
    }
    if (homes.length > 0 && shops.length > 0 && r < 0.65) {
      return this.trip(this.frontageOf(pick(homes)), this.frontageOf(pick(shops)), Kind.Car);
    }
    if (factories.length > 0 && shops.length > 0 && r < 0.78) {
      return this.trip(this.frontageOf(pick(factories)), this.frontageOf(pick(shops)), Kind.Truck);
    }
    if (factories.length > 0 && r < 0.86) return this.spawnToHighway(this.frontageOf(pick(factories)), Kind.Truck);
    if (homes.length > 0 && r < 0.93) return this.spawnToHighway(this.frontageOf(pick(homes)), Kind.Car);
    if (workplaces > 0) {
      const dest = Math.random() * workplaces < shops.length ? pick(shops) : pick(factories);
      return this.spawnFromHighway(this.frontageOf(dest), Kind.Car);
    }
    return false;
  }

  private trip(from: number, to: number, kind: Kind): boolean {
    if (from < 0 || to < 0 || from === to) return false;
    const path = this.finder.findTo(from, to);
    return path !== null && this.add(path, kind, true);
  }

  private frontageOf(i: number): number {
    const { world } = this;
    const road = frontage(world, i % world.size, Math.floor(i / world.size), world.variant[i]).road;
    return road >= 0 && world.roadConnected[road] ? road : -1;
  }

  private add(tiles: number[], kind: Kind, city: boolean): boolean {
    if (tiles.length < 2) return false;
    const { world } = this;
    const lane = kind === Kind.Car && Math.random() < 0.6 ? HIGHWAY_FAST_LANE : HIGHWAY_SLOW_LANE;
    const path = new LanePath(tiles, world.size, (a, b) =>
      world.road[a] === Road.Highway && world.road[b] === Road.Highway ? lane : STREET_LANE,
    );
    const palette = kind === Kind.Van ? VAN_PAINT : kind === Kind.Truck ? TRUCK_PAINT : CAR_PAINT;
    const s = path.sample(0, 0, this.sample);
    this.vehicles.push({
      kind,
      city,
      path,
      seg: 0,
      t: 0,
      speed: 0.3,
      x: s.x,
      z: s.z,
      hx: s.hx,
      hz: s.hz,
      waited: 0,
      ghost: 0,
      color: pick(palette),
    });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Movement

  private simulate(step: number): void {
    const { world, buckets } = this;
    buckets.clear();
    for (const v of this.vehicles) {
      const tile = v.path.tiles[v.seg];
      let list = buckets.get(tile);
      if (!list) buckets.set(tile, (list = []));
      list.push(v);
    }

    const alive: Vehicle[] = [];
    for (const v of this.vehicles) {
      const tiles = v.path.tiles;
      const tile = tiles[v.seg];
      if (world.road[tile] === Road.None) continue; // the road was bulldozed under it

      const onHighway = world.road[tile] === Road.Highway;
      let cruise = onHighway ? HIGHWAY_SPEED : STREET_SPEED;
      if (v.kind === Kind.Truck) cruise *= 0.85;
      if (v.path.isTurn(v.seg)) cruise *= TURN_FACTOR;

      if (v.ghost > 0) v.ghost -= step;
      const blocked = v.ghost <= 0 && this.isBlocked(v, tile, tiles[v.seg + 1]);
      if (blocked) {
        v.waited += step;
        v.speed = Math.max(0, v.speed - BRAKING * step);
        if (v.waited >= MAX_WAIT) {
          v.ghost = GHOST_TIME;
          v.waited = 0;
        }
      } else {
        v.waited = Math.max(0, v.waited - step);
        v.speed = Math.min(cruise, v.speed + ACCELERATION * step);
        if (v.speed > cruise) v.speed = Math.max(cruise, v.speed - BRAKING * step);
      }

      let travel = v.speed * step;
      let arrived = false;
      while (travel > 0) {
        const len = v.path.length(v.seg);
        const remaining = (1 - v.t) * len;
        if (travel < remaining) {
          v.t += travel / len;
          break;
        }
        travel -= remaining;
        v.seg++;
        v.t = 0;
        if (v.seg >= v.path.segments) {
          arrived = true;
          break;
        }
      }
      if (arrived) continue;
      const s = v.path.sample(v.seg, v.t, this.sample);
      v.x = s.x;
      v.z = s.z;
      v.hx = s.hx;
      v.hz = s.hz;
      alive.push(v);
    }
    this.vehicles = alive;
  }

  /** Is another vehicle close ahead in the same lane (current or next tile)? */
  private isBlocked(v: Vehicle, tile: number, next: number | undefined): boolean {
    const reach = HALF_LENGTH[v.kind] + 0.06 + v.speed * 0.1;
    for (const key of next === undefined ? [tile] : [tile, next]) {
      const list = this.buckets.get(key);
      if (!list) continue;
      for (const o of list) {
        if (o === v) continue;
        const dx = o.x - v.x;
        const dz = o.z - v.z;
        const ahead = dx * v.hx + dz * v.hz;
        if (ahead <= 0 || ahead > reach + HALF_LENGTH[o.kind]) continue;
        const side = Math.abs(dx * -v.hz + dz * v.hx);
        if (side > 0.08) continue;
        if (o.hx * v.hx + o.hz * v.hz < 0.3) continue; // crossing or oncoming traffic
        return true;
      }
    }
    return false;
  }

  private writeInstances(): void {
    const counts = [0, 0, 0];
    for (const v of this.vehicles) {
      const mesh = this.meshes[v.kind];
      const n = counts[v.kind]++;
      this.matrix.makeRotationY(Math.atan2(v.hx, v.hz));
      this.matrix.setPosition(v.x, ROAD_Y, v.z);
      mesh.setMatrixAt(n, this.matrix);
      this.color.setRGB(v.color[0], v.color[1], v.color[2]);
      mesh.setColorAt(n, this.color);
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
