import { placeHighway } from './mapgen';
import { Rng } from './rng';
import { Simulation } from './simulation';
import { World } from './world';

/** v2 added the highway (`highwayDir`). v1 saves are migrated by laying a highway on load. */
const SAVE_VERSION = 2;

/** Arrays that make up the persistent world state. Derived data (road access, connectivity) is rebuilt on load. */
const WORLD_ARRAYS = ['terrain', 'trees', 'zone', 'road', 'highwayDir', 'level', 'variant', 'construction'] as const;
type WorldArrayKey = (typeof WORLD_ARRAYS)[number];

export interface CameraState {
  x: number;
  z: number;
  distance: number;
  yaw: number;
  pitch: number;
}

export interface SaveData {
  version: number;
  savedAt: string;
  cityName: string;
  seed: number;
  size: number;
  tick: number;
  funds: number;
  lastMonthIncome?: number;
  nextMilestone: number;
  /** v1 saves have no `highwayDir`. */
  arrays: Partial<Record<WorldArrayKey, string>>;
  camera?: CameraState;
}

export function serialize(sim: Simulation, camera?: CameraState): SaveData {
  const { world } = sim;
  const arrays = {} as Record<WorldArrayKey, string>;
  for (const key of WORLD_ARRAYS) arrays[key] = toBase64(world[key]);
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    cityName: sim.cityName,
    seed: world.seed,
    size: world.size,
    tick: sim.tick,
    funds: sim.funds,
    lastMonthIncome: sim.lastMonthIncome,
    nextMilestone: sim.nextMilestone,
    arrays,
    camera,
  };
}

export function deserialize(data: SaveData): Simulation {
  if (data.version < 1 || data.version > SAVE_VERSION) throw new Error(`Unsupported save version ${data.version}`);
  const world = new World(data.size, data.seed);
  for (const key of WORLD_ARRAYS) {
    const encoded = data.arrays[key];
    if (encoded === undefined) {
      if (key === 'highwayDir' && data.version === 1) continue;
      throw new Error(`Corrupt save: ${key} is missing`);
    }
    const bytes = fromBase64(encoded);
    if (bytes.length !== world.count) throw new Error(`Corrupt save: ${key} has ${bytes.length} tiles`);
    world[key].set(bytes);
  }
  // Cities from before the highway existed get one now, or nothing could ever move in again.
  if (data.version === 1) placeHighway(world, new Rng(data.seed));
  world.invalidateDerived();
  world.markAllDirty();
  const sim = new Simulation(world);
  sim.cityName = data.cityName;
  sim.tick = data.tick;
  sim.funds = data.funds;
  sim.lastMonthIncome = data.lastMonthIncome ?? 0;
  sim.nextMilestone = data.nextMilestone;
  return sim;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
