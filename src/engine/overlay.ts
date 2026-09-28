import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  Texture,
} from 'three';
import { Plan } from '../sim/tools';
import { Tool } from '../sim/types';
import { highlightUniforms } from './materials';

const CURSOR_Y = 0.05;
const PREVIEW_Y = 0.045;

/** How quickly the cursor glides to a new tile (1/s). High enough to feel instant, low enough to look smooth. */
const GLIDE_RATE = 32;
const FADE_RATE = 18;
const COLOR_RATE = 20;
/** Jumps longer than this (in tiles) snap instead of gliding across the map. */
const SNAP_DISTANCE = 6;

const TOOL_COLORS: Record<Tool, number> = {
  [Tool.Inspect]: 0xffffff,
  [Tool.Road]: 0xdfe4ea,
  [Tool.Residential]: 0x5fd35f,
  [Tool.Commercial]: 0x4fa3ff,
  [Tool.Industrial]: 0xffc933,
  [Tool.Bulldoze]: 0xff8a3d,
  [Tool.Dezone]: 0xf2f2f2,
};
const INVALID = new Color(0xff3b30);

/** Draws a white rounded tile marker on a canvas; materials tint it with their colour. */
function markerTexture(fillAlpha: number, lineWidth: number, glow: number): Texture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const inset = 14;
  const path = () => {
    ctx.beginPath();
    ctx.roundRect(inset, inset, s - inset * 2, s - inset * 2, 20);
  };
  path();
  ctx.fillStyle = `rgba(255,255,255,${fillAlpha})`;
  ctx.fill();
  if (lineWidth > 0) {
    ctx.shadowColor = 'rgba(255,255,255,0.95)';
    ctx.shadowBlur = glow;
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = '#ffffff';
    path();
    ctx.stroke();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Plane size such that the drawn rounded rect (inside the texture's inset) nearly fills one tile. */
const MARKER_SIZE = 0.97 * (128 / 100);

/**
 * A tile marker that eases toward its target: position glides, colour blends, it fades in and out
 * and gives a small "pop" when it lands on a new tile. It is drawn twice: normally (hidden behind
 * buildings in front of it) and as a faint x-ray copy so it never disappears completely.
 */
class TileMarker {
  private readonly solid: Mesh;
  private readonly ghost: Mesh;
  private readonly color = new Color();
  private readonly targetColor = new Color();
  private x = 0;
  private z = 0;
  private tx = 0;
  private tz = 0;
  private opacity = 0;
  private shown = false;
  private scale = 1;

  constructor(
    scene: Scene,
    texture: Texture,
    private readonly maxOpacity: number,
    private readonly pulse: boolean,
  ) {
    const geometry = new PlaneGeometry(MARKER_SIZE, MARKER_SIZE).rotateX(-Math.PI / 2);
    const material = (depthTest: boolean) =>
      new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, depthTest, toneMapped: false });
    this.ghost = new Mesh(geometry, material(false));
    this.ghost.renderOrder = 11;
    this.solid = new Mesh(geometry, material(true));
    this.solid.renderOrder = 12;
    for (const m of [this.ghost, this.solid]) {
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  /** Moves the marker to a tile, or hides it with `null`. */
  set(tile: { x: number; z: number } | null, color?: Color): void {
    if (!tile) {
      this.shown = false;
      return;
    }
    if (color) this.targetColor.copy(color);
    const cx = tile.x + 0.5;
    const cz = tile.z + 0.5;
    if (!this.shown || this.opacity < 0.05 || Math.hypot(cx - this.x, cz - this.z) > SNAP_DISTANCE) {
      // Appearing from nothing or jumping far: snap instead of sliding across the map.
      this.x = cx;
      this.z = cz;
      this.color.copy(this.targetColor);
    }
    if (cx !== this.tx || cz !== this.tz) this.scale = 1.1;
    this.tx = cx;
    this.tz = cz;
    this.shown = true;
  }

  /** Advances the animation; returns true while anything is still moving so the caller keeps rendering. */
  update(dt: number, time: number): boolean {
    const target = this.shown ? this.maxOpacity : 0;
    this.opacity = MathUtils.damp(this.opacity, target, FADE_RATE, dt);
    this.x = MathUtils.damp(this.x, this.tx, GLIDE_RATE, dt);
    this.z = MathUtils.damp(this.z, this.tz, GLIDE_RATE, dt);
    this.scale = MathUtils.damp(this.scale, 1, 14, dt);
    this.color.lerp(this.targetColor, 1 - Math.exp(-COLOR_RATE * dt));

    const visible = this.opacity > 0.01;
    const breathe = this.pulse ? 0.85 + 0.15 * Math.sin(time * 4) : 1;
    const s = this.scale * (this.pulse ? 1 + 0.03 * Math.sin(time * 4) : 1);
    for (const [mesh, alpha] of [
      [this.solid, 1],
      [this.ghost, 0.28],
    ] as const) {
      mesh.visible = visible;
      mesh.position.set(this.x, CURSOR_Y, this.z);
      mesh.scale.setScalar(s);
      const mat = mesh.material as MeshBasicMaterial;
      mat.color.copy(this.color);
      mat.opacity = this.opacity * alpha * breathe;
    }
    const c = this.color;
    const t = this.targetColor;
    const settling =
      Math.abs(c.r - t.r) + Math.abs(c.g - t.g) + Math.abs(c.b - t.b) > 0.003 ||
      Math.abs(this.opacity - target) > 0.005 ||
      Math.abs(this.x - this.tx) > 0.002 ||
      Math.abs(this.z - this.tz) > 0.002 ||
      Math.abs(this.scale - 1) > 0.002;
    return settling || (this.pulse && visible);
  }
}

/**
 * Drives the city material's tile highlights: the hovered tile's objects glow in the tool colour and
 * cross-fade to the next tile (two alternating slots), and the inspected tile pulses gently.
 */
class TileHighlights {
  private readonly slots = highlightUniforms.uHighlight.value;
  private readonly colors = highlightUniforms.uHighlightColor.value;
  private readonly targetColor = new Color();
  private active = 0;
  private hoverShown = false;
  private selectionShown = false;

  setHover(tile: { x: number; z: number } | null, color?: Color): void {
    if (!tile) {
      this.hoverShown = false;
      return;
    }
    if (color) this.targetColor.copy(color);
    const cur = this.slots[this.active];
    if (cur.x !== tile.x || cur.y !== tile.z) {
      // Let the old tile fade out in its slot while the new one fades in in the other.
      this.active = 1 - this.active;
      this.slots[this.active].set(tile.x, tile.z, 0);
      this.colors[this.active].copy(this.targetColor);
    }
    this.hoverShown = true;
  }

  setSelection(tile: { x: number; z: number } | null): void {
    this.selectionShown = tile !== null;
    if (tile) this.slots[2].set(tile.x, tile.z, this.slots[2].z);
  }

  update(dt: number, time: number): boolean {
    let moving = false;
    for (let k = 0; k < 2; k++) {
      const slot = this.slots[k];
      const target = k === this.active && this.hoverShown ? 1 : 0;
      slot.z = MathUtils.damp(slot.z, target, 16, dt);
      if (slot.z < 0.002 && target === 0) slot.z = 0;
      moving ||= Math.abs(slot.z - target) > 0.002;
    }
    this.colors[this.active].lerp(this.targetColor, 1 - Math.exp(-COLOR_RATE * dt));
    const sel = this.slots[2];
    const selTarget = this.selectionShown ? 0.55 + 0.3 * Math.sin(time * 4) : 0;
    sel.z = MathUtils.damp(sel.z, selTarget, 12, dt);
    if (sel.z < 0.002 && !this.selectionShown) sel.z = 0;
    return moving || this.selectionShown || sel.z > 0;
  }
}

/** Transient visuals drawn on top of the city: the hover cursor, the inspected tile, tool previews and the grid. */
export class Overlay {
  private readonly preview: InstancedMesh;
  private readonly cursor: TileMarker;
  private readonly selection: TileMarker;
  private readonly highlights = new TileHighlights();
  private readonly grid: LineSegments;
  private readonly matrix = new Matrix4();
  private readonly tmpColor = new Color();
  private time = 0;
  private dirty = true;

  constructor(scene: Scene, size: number) {
    const tile = markerTexture(0.5, 6, 0);
    const quad = new PlaneGeometry(MARKER_SIZE, MARKER_SIZE).rotateX(-Math.PI / 2);
    this.preview = new InstancedMesh(
      quad,
      new MeshBasicMaterial({ map: tile, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
      size * size,
    );
    this.preview.count = 0;
    this.preview.frustumCulled = false;
    this.preview.renderOrder = 10;
    scene.add(this.preview);

    this.cursor = new TileMarker(scene, markerTexture(0.14, 7, 10), 0.95, false);
    this.selection = new TileMarker(scene, markerTexture(0.22, 8, 14), 1, true);

    const lines: number[] = [];
    for (let k = 0; k <= size; k++) {
      lines.push(k, 0, 0, k, 0, size);
      lines.push(0, 0, k, size, 0, k);
    }
    const gridGeom = new BufferGeometry();
    gridGeom.setAttribute('position', new Float32BufferAttribute(lines, 3));
    this.grid = new LineSegments(gridGeom, new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 }));
    this.grid.position.y = 0.035;
    this.grid.visible = false;
    scene.add(this.grid);
  }

  /** Points the hover cursor at a tile in the tool's colour (red when the tool cannot be used there), or hides it. */
  setHover(tile: { x: number; z: number } | null, tool: Tool = Tool.Inspect, invalid = false): void {
    if (!tile) {
      this.cursor.set(null);
      this.highlights.setHover(null);
      return;
    }
    const color = invalid ? INVALID : this.tmpColor.setHex(TOOL_COLORS[tool]);
    this.cursor.set(tile, color);
    this.highlights.setHover(tile, color);
  }

  /** Marks the tile shown in the inspect panel. */
  setSelection(tile: { x: number; z: number } | null): void {
    this.selection.set(tile, this.tmpColor.setHex(0xffffff));
    this.highlights.setSelection(tile);
  }

  showPlan(plan: Plan): void {
    const valid = this.tmpColor.setHex(TOOL_COLORS[plan.tool]);
    let n = 0;
    for (const t of plan.tiles) {
      this.matrix.makeTranslation(t.x + 0.5, PREVIEW_Y, t.z + 0.5);
      this.preview.setMatrixAt(n, this.matrix);
      this.preview.setColorAt(n, t.ok ? valid : INVALID);
      n++;
    }
    this.preview.count = n;
    this.preview.instanceMatrix.needsUpdate = true;
    if (this.preview.instanceColor) this.preview.instanceColor.needsUpdate = true;
    this.dirty = true;
  }

  clearPlan(): void {
    if (this.preview.count === 0) return;
    this.preview.count = 0;
    this.dirty = true;
  }

  get gridVisible(): boolean {
    return this.grid.visible;
  }

  set gridVisible(v: boolean) {
    if (this.grid.visible === v) return;
    this.grid.visible = v;
    this.dirty = true;
  }

  /** Advances animations. Returns true when the overlay changed and the frame should be redrawn. */
  update(dt: number): boolean {
    this.time += dt;
    const cursorMoving = this.cursor.update(dt, this.time);
    const selectionMoving = this.selection.update(dt, this.time);
    const highlightsMoving = this.highlights.update(dt, this.time);
    const changed = this.dirty || cursorMoving || selectionMoving || highlightsMoving;
    this.dirty = false;
    return changed;
  }
}
