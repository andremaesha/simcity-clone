import { Terrain, Zone } from '../sim/types';
import { World } from '../sim/world';

type RGBA = readonly [number, number, number];

const COLORS = {
  grass: [118, 170, 82],
  forest: [66, 120, 58],
  water: [63, 143, 196],
  road: [70, 72, 78],
  construction: [150, 110, 70],
} satisfies Record<string, RGBA>;

const ZONE_EMPTY: Record<Zone, RGBA> = {
  [Zone.None]: COLORS.grass,
  [Zone.Residential]: [150, 214, 120],
  [Zone.Commercial]: [130, 180, 230],
  [Zone.Industrial]: [232, 200, 110],
};
const ZONE_BUILT: Record<Zone, RGBA> = {
  [Zone.None]: COLORS.grass,
  [Zone.Residential]: [46, 160, 70],
  [Zone.Commercial]: [40, 110, 210],
  [Zone.Industrial]: [214, 160, 30],
};

/** Top-down overview of the map with the camera's view outline. Click or drag to move the camera. */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buffer: HTMLCanvasElement;
  private readonly bufferCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private dragging = false;

  constructor(
    private size: number,
    private readonly onPick: (x: number, z: number) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.canvas.width = 352;
    this.canvas.height = 352;
    this.ctx = this.canvas.getContext('2d')!;
    this.buffer = document.createElement('canvas');
    this.buffer.width = size;
    this.buffer.height = size;
    this.bufferCtx = this.buffer.getContext('2d')!;
    this.image = this.bufferCtx.createImageData(size, size);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.pick(e);
    });
    this.canvas.addEventListener('pointermove', (e) => this.dragging && this.pick(e));
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
  }

  private pick(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.onPick(((e.clientX - rect.left) / rect.width) * this.size, ((e.clientY - rect.top) / rect.height) * this.size);
  }

  /** Redraws the map; `view` is the camera footprint on the ground in tile coordinates. */
  draw(world: World, view: ReadonlyArray<readonly [number, number]>): void {
    if (world.size !== this.size) {
      this.size = world.size;
      this.buffer.width = this.buffer.height = world.size;
      this.image = this.bufferCtx.createImageData(world.size, world.size);
    }
    const data = this.image.data;
    for (let i = 0; i < world.count; i++) {
      let c: RGBA;
      if (world.terrain[i] === Terrain.Water) c = COLORS.water;
      else if (world.road[i]) c = COLORS.road;
      else if (world.zone[i] !== Zone.None) {
        const zone = world.zone[i] as Zone;
        if (world.construction[i] > 0) c = COLORS.construction;
        else c = world.level[i] > 0 ? ZONE_BUILT[zone] : ZONE_EMPTY[zone];
      } else c = world.trees[i] > 1 ? COLORS.forest : COLORS.grass;
      const o = i * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
    this.bufferCtx.putImageData(this.image, 0, 0);

    const { ctx, canvas } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.buffer, 0, 0, canvas.width, canvas.height);

    if (view.length >= 3) {
      const s = canvas.width / this.size;
      ctx.beginPath();
      view.forEach(([x, z], k) => (k === 0 ? ctx.moveTo(x * s, z * s) : ctx.lineTo(x * s, z * s)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
    }
  }
}
