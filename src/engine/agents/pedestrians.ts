import { Color, InstancedMesh, Material, Matrix4, Scene } from 'three';
import { frontage } from '../../sim/frontage';
import { DIRS } from '../../sim/types';
import { World } from '../../sim/world';
import { GeometryBuilder } from '../geometryBuilder';
import { RGB, rgb } from '../palette';
import { LanePath, PathSample } from './lanePath';

const MAX_PEDESTRIANS = 260;
/** People are only simulated around the camera, and only when it is close enough to see them. */
const VISIBLE_DISTANCE = 60;
const FULL_CROWD_DISTANCE = 25;
const SPAWN_RADIUS = 16;
const DESPAWN_RADIUS = 26;
const WALK_SPEED = 0.32; // tiles per second
const SIDEWALK = 0.43;
const SIDEWALK_Y = 0.004;
/** Drawn larger than true scale so people are visible at all. */
const PERSON_SCALE = 1.5;

const SHIRTS: readonly RGB[] = [
  0xd9534f, 0x3b7dd8, 0xf0ad4e, 0x5cb85c, 0xf5f5f0, 0x2c2f33, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x34495e,
].map(rgb);
const SKIN: readonly RGB[] = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac].map(rgb);

interface Pedestrian {
  path: LanePath;
  seg: number;
  t: number;
  speed: number;
  phase: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
  shirt: RGB;
  skin: RGB;
}

/** A person: body (tinted per instance with a shirt colour) and a head (tinted with a skin tone). */
function bodyGeometry() {
  const b = new GeometryBuilder();
  const white = rgb(0xffffff);
  b.box(-0.011, 0.0, -0.007, -0.002, 0.03, 0.007, rgb(0x3a3f4a), { ao: false }); // legs
  b.box(0.002, 0.0, -0.007, 0.011, 0.03, 0.007, rgb(0x3a3f4a), { ao: false });
  b.box(-0.014, 0.03, -0.009, 0.014, 0.068, 0.009, white, { ao: false }); // torso
  return b.toGeometry().scale(PERSON_SCALE, PERSON_SCALE, PERSON_SCALE);
}

function headGeometry() {
  const b = new GeometryBuilder();
  b.box(-0.009, 0.068, -0.009, 0.009, 0.087, 0.009, rgb(0xffffff), { ao: false });
  return b.toGeometry().scale(PERSON_SCALE, PERSON_SCALE, PERSON_SCALE);
}

/**
 * Residents strolling along the sidewalks near the camera: they step out of a building, walk a few
 * blocks and go inside again. They exist only where the camera is close enough to see them.
 */
export class Pedestrians {
  private people: Pedestrian[] = [];
  private readonly body: InstancedMesh;
  private readonly head: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly color = new Color();
  private readonly sample: PathSample = { x: 0, z: 0, hx: 0, hz: 1 };

  constructor(
    scene: Scene,
    private world: World,
    material: Material,
  ) {
    this.body = new InstancedMesh(bodyGeometry(), material, MAX_PEDESTRIANS);
    this.head = new InstancedMesh(headGeometry(), material, MAX_PEDESTRIANS);
    for (const m of [this.body, this.head]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  reset(world: World): void {
    this.world = world;
    this.people = [];
    this.body.count = this.head.count = 0;
  }

  /** Returns true when anything visible changed. */
  update(dt: number, speed: number, focusX: number, focusZ: number, cameraDistance: number): boolean {
    const hadPeople = this.people.length > 0;
    const crowd = Math.round(MAX_PEDESTRIANS * clamp01((VISIBLE_DISTANCE - cameraDistance) / (VISIBLE_DISTANCE - FULL_CROWD_DISTANCE)));
    if (crowd === 0) {
      this.people = [];
      this.body.count = this.head.count = 0;
      return hadPeople;
    }
    if (speed <= 0) return false;
    const step = dt * speed;

    for (let attempts = 0; attempts < 6 && this.people.length < crowd; attempts++) this.trySpawn(focusX, focusZ);

    const alive: Pedestrian[] = [];
    for (const p of this.people) {
      if (Math.hypot(p.x - focusX, p.z - focusZ) > DESPAWN_RADIUS) continue;
      if (!this.world.isStreet(p.path.tiles[p.seg] % this.world.size, Math.floor(p.path.tiles[p.seg] / this.world.size))) continue;
      let travel = p.speed * step;
      let done = false;
      while (travel > 0) {
        const len = p.path.length(p.seg);
        const remaining = (1 - p.t) * len;
        if (travel < remaining) {
          p.t += travel / len;
          break;
        }
        travel -= remaining;
        p.seg++;
        p.t = 0;
        if (p.seg >= p.path.segments) {
          done = true;
          break;
        }
      }
      if (done) continue;
      const s = p.path.sample(p.seg, p.t, this.sample);
      p.x = s.x;
      p.z = s.z;
      p.hx = s.hx;
      p.hz = s.hz;
      p.phase += step * 9;
      alive.push(p);
    }
    this.people = alive;
    this.writeInstances();
    return true;
  }

  /** Picks a random finished building near the focus point and sends someone for a short walk from its door. */
  private trySpawn(focusX: number, focusZ: number): void {
    const { world } = this;
    const x = Math.floor(focusX + (Math.random() * 2 - 1) * SPAWN_RADIUS);
    const z = Math.floor(focusZ + (Math.random() * 2 - 1) * SPAWN_RADIUS);
    if (!world.inBounds(x, z)) return;
    const i = world.idx(x, z);
    if (world.level[i] === 0 || world.construction[i] > 0) return;
    const start = frontage(world, x, z, world.variant[i]).road;
    if (start < 0) return;

    const tiles = [start];
    const steps = 3 + Math.floor(Math.random() * 6);
    for (let k = 0; k < steps; k++) {
      const cur = tiles[tiles.length - 1];
      const prev = tiles.length > 1 ? tiles[tiles.length - 2] : -1;
      const cx = cur % world.size;
      const cz = Math.floor(cur / world.size);
      const options: number[] = [];
      for (const [dx, dz] of DIRS) {
        if (world.isStreet(cx + dx, cz + dz)) options.push(world.idx(cx + dx, cz + dz));
      }
      const forward = options.filter((n) => n !== prev);
      const choices = forward.length > 0 ? forward : options;
      if (choices.length === 0) break;
      tiles.push(choices[Math.floor(Math.random() * choices.length)]);
    }
    if (tiles.length < 2) return;

    const side = Math.random() < 0.5 ? SIDEWALK : -SIDEWALK;
    const path = new LanePath(tiles, world.size, () => side);
    const s = path.sample(0, 0, this.sample);
    this.people.push({
      path,
      seg: 0,
      t: 0,
      speed: WALK_SPEED * (0.8 + Math.random() * 0.4),
      phase: Math.random() * 6,
      x: s.x,
      z: s.z,
      hx: s.hx,
      hz: s.hz,
      shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)],
      skin: SKIN[Math.floor(Math.random() * SKIN.length)],
    });
  }

  private writeInstances(): void {
    let n = 0;
    for (const p of this.people) {
      const bob = Math.abs(Math.sin(p.phase)) * 0.006;
      this.matrix.makeRotationY(Math.atan2(p.hx, p.hz));
      this.matrix.setPosition(p.x, SIDEWALK_Y + bob, p.z);
      this.body.setMatrixAt(n, this.matrix);
      this.head.setMatrixAt(n, this.matrix);
      this.body.setColorAt(n, this.color.setRGB(p.shirt[0], p.shirt[1], p.shirt[2]));
      this.head.setColorAt(n, this.color.setRGB(p.skin[0], p.skin[1], p.skin[2]));
      n++;
    }
    for (const m of [this.body, this.head]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
