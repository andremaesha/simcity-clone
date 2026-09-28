import { BufferGeometry, Material, Mesh, Scene } from 'three';
import { CHUNK_SIZE } from '../config';
import { World } from '../sim/world';
import { GeometryBuilder } from './geometryBuilder';
import { meshTile } from './tileMesher';

/**
 * Splits the map into CHUNK_SIZE x CHUNK_SIZE blocks, each rendered as one merged mesh.
 * A tile change only rebuilds the chunks it can visually affect, and a per-frame budget
 * keeps big edits (or a fresh load) from stalling the frame.
 */
export class ChunkManager {
  private readonly perSide: number;
  private readonly meshes: Mesh[] = [];
  private readonly dirty = new Set<number>();
  private readonly builder = new GeometryBuilder();
  /** Top of the tallest object on each tile, refreshed whenever its chunk is rebuilt. */
  readonly heights: Float32Array;

  constructor(
    private readonly scene: Scene,
    private world: World,
    material: Material,
  ) {
    this.perSide = Math.ceil(world.size / CHUNK_SIZE);
    this.heights = new Float32Array(world.count);
    for (let c = 0; c < this.perSide * this.perSide; c++) {
      const mesh = new Mesh(new BufferGeometry(), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `chunk-${c}`;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.markAll();
  }

  /** Swaps in a new world (e.g. after loading) and schedules a full rebuild. */
  setWorld(world: World): void {
    if (world.size !== this.world.size) throw new Error('World size changed; recreate the ChunkManager');
    this.world = world;
    this.markAll();
  }

  get chunkMeshes(): readonly Mesh[] {
    return this.meshes;
  }

  markAll(): void {
    for (let c = 0; c < this.meshes.length; c++) this.dirty.add(c);
  }

  /** Marks every chunk within `r` tiles of tile i. */
  markTile(i: number, r: number): void {
    const { size } = this.world;
    const x = i % size;
    const z = (i - x) / size;
    const cx0 = Math.max(0, Math.floor((x - r) / CHUNK_SIZE));
    const cx1 = Math.min(this.perSide - 1, Math.floor((x + r) / CHUNK_SIZE));
    const cz0 = Math.max(0, Math.floor((z - r) / CHUNK_SIZE));
    const cz1 = Math.min(this.perSide - 1, Math.floor((z + r) / CHUNK_SIZE));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) this.dirty.add(cz * this.perSide + cx);
    }
  }

  /**
   * Pulls pending tile changes from the world and rebuilds dirty chunks, nearest to the focus point
   * first, until `budgetMs` is spent (always at least one, so progress is guaranteed).
   * Returns how many chunks were rebuilt.
   */
  update(focusX: number, focusZ: number, budgetMs = 4): number {
    this.world.drainDirty((i, r) => this.markTile(i, r));
    const start = performance.now();
    let rebuilt = 0;
    while (this.dirty.size > 0) {
      let best = -1;
      let bestDist = Infinity;
      for (const c of this.dirty) {
        const cx = ((c % this.perSide) + 0.5) * CHUNK_SIZE;
        const cz = (Math.floor(c / this.perSide) + 0.5) * CHUNK_SIZE;
        const d = (cx - focusX) ** 2 + (cz - focusZ) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      this.rebuild(best);
      this.dirty.delete(best);
      rebuilt++;
      if (performance.now() - start >= budgetMs) break;
    }
    return rebuilt;
  }

  /** Rebuilds everything pending immediately; used on start-up and load so the first frame is complete. */
  flush(): number {
    this.world.drainDirty((i, r) => this.markTile(i, r));
    const rebuilt = this.dirty.size;
    for (const c of this.dirty) this.rebuild(c);
    this.dirty.clear();
    return rebuilt;
  }

  private rebuild(c: number): void {
    const { world, builder } = this;
    const cx = c % this.perSide;
    const cz = (c - cx) / this.perSide;
    builder.reset();
    const x1 = Math.min(world.size, (cx + 1) * CHUNK_SIZE);
    const z1 = Math.min(world.size, (cz + 1) * CHUNK_SIZE);
    for (let z = cz * CHUNK_SIZE; z < z1; z++) {
      for (let x = cx * CHUNK_SIZE; x < x1; x++) {
        builder.beginTile();
        meshTile(world, x, z, builder);
        this.heights[world.idx(x, z)] = builder.tileTop;
      }
    }
    const mesh = this.meshes[c];
    const old = mesh.geometry;
    mesh.geometry = builder.toGeometry();
    old.dispose();
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      this.scene.remove(mesh);
    }
  }
}
