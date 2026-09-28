import { BufferAttribute, BufferGeometry } from 'three';
import { RGB } from './palette';

/** Window pattern style drawn procedurally by the city material (see materials.ts). */
export const Win = {
  None: 0,
  Residential: 1,
  Office: 2,
  Industrial: 3,
} as const;
export type Win = (typeof Win)[keyof typeof Win];

/** Bottom vertices of walls get darkened by this factor: a cheap fake ambient occlusion. */
const AO = 0.78;

/**
 * Accumulates flat-shaded, vertex-coloured geometry into growable typed arrays.
 *
 * All primitives are given in a local frame: a tile-sized space with the origin at the tile centre
 * and the building's front facing +z. `setFrame` moves and rotates that frame in 90 degree steps,
 * which lets procedural buildings be written once and face any road.
 *
 * Quads are wound counter-clockwise seen from the front, starting at the bottom edge; the optional
 * `top` colour is applied to the last two vertices, which is how walls get a vertical gradient.
 */
export class GeometryBuilder {
  private pos = new Float32Array(3 * 4096);
  private nrm = new Float32Array(3 * 4096);
  private col = new Float32Array(3 * 4096);
  private win = new Float32Array(4096);
  private idx = new Uint32Array(6 * 1024);
  private vertices = 0;
  private indices = 0;
  private ox = 0;
  private oz = 0;
  private rot = 0;
  private readonly v = new Float32Array(12);
  private readonly low: [number, number, number] = [0, 0, 0];
  private top = 0;

  get vertexCount(): number {
    return this.vertices;
  }

  /** Highest y emitted since the last `beginTile` (never below ground level). Used for height-aware picking. */
  get tileTop(): number {
    return this.top;
  }

  beginTile(): void {
    this.top = 0;
  }

  reset(): void {
    this.vertices = 0;
    this.indices = 0;
    this.setFrame(0, 0, 0);
  }

  /** Places the local frame at world (ox, oz), rotated by `rot` quarter turns (0 = +z, 1 = +x, 2 = -z, 3 = -x). */
  setFrame(ox: number, oz: number, rot = 0): void {
    this.ox = ox;
    this.oz = oz;
    this.rot = ((rot % 4) + 4) % 4;
  }

  private put(slot: number, x: number, y: number, z: number): void {
    let wx = x;
    let wz = z;
    switch (this.rot) {
      case 1:
        wx = z;
        wz = -x;
        break;
      case 2:
        wx = -x;
        wz = -z;
        break;
      case 3:
        wx = -z;
        wz = x;
        break;
    }
    const o = slot * 3;
    this.v[o] = wx + this.ox;
    this.v[o + 1] = y;
    this.v[o + 2] = wz + this.oz;
  }

  private reserve(verts: number, indices: number): void {
    if (this.vertices + verts > this.win.length) {
      const cap = Math.max(this.win.length * 2, this.vertices + verts);
      this.pos = grow(this.pos, cap * 3);
      this.nrm = grow(this.nrm, cap * 3);
      this.col = grow(this.col, cap * 3);
      this.win = grow(this.win, cap);
    }
    if (this.indices + indices > this.idx.length) {
      const next = new Uint32Array(Math.max(this.idx.length * 2, this.indices + indices));
      next.set(this.idx);
      this.idx = next;
    }
  }

  /** Emits the polygon stored in `this.v` (3 or 4 vertices). */
  private emit(n: 3 | 4, bottom: RGB, top: RGB, win: number): void {
    this.reserve(n, n === 4 ? 6 : 3);
    const v = this.v;
    const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
    const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    const base = this.vertices;
    for (let k = 0; k < n; k++) {
      const o = (base + k) * 3;
      this.pos[o] = v[k * 3];
      this.pos[o + 1] = v[k * 3 + 1];
      this.pos[o + 2] = v[k * 3 + 2];
      if (v[k * 3 + 1] > this.top) this.top = v[k * 3 + 1];
      this.nrm[o] = nx;
      this.nrm[o + 1] = ny;
      this.nrm[o + 2] = nz;
      const c = k < 2 ? bottom : top;
      this.col[o] = c[0];
      this.col[o + 1] = c[1];
      this.col[o + 2] = c[2];
      this.win[base + k] = win;
    }
    const idx = this.idx;
    let i = this.indices;
    idx[i++] = base;
    idx[i++] = base + 1;
    idx[i++] = base + 2;
    if (n === 4) {
      idx[i++] = base;
      idx[i++] = base + 2;
      idx[i++] = base + 3;
    }
    this.indices = i;
    this.vertices += n;
  }

  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    color: RGB, win: number = Win.None,
  ): void {
    this.put(0, ax, ay, az);
    this.put(1, bx, by, bz);
    this.put(2, cx, cy, cz);
    this.emit(3, color, color, win);
  }

  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    color: RGB, win: number = Win.None, top: RGB = color,
  ): void {
    this.put(0, ax, ay, az);
    this.put(1, bx, by, bz);
    this.put(2, cx, cy, cz);
    this.put(3, dx, dy, dz);
    this.emit(4, color, top, win);
  }

  /** Horizontal, upward-facing rectangle. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, color: RGB): void {
    this.quad(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0, color);
  }

  private shadeLow(color: RGB, onGround: boolean): RGB {
    if (!onGround) return color;
    this.low[0] = color[0] * AO;
    this.low[1] = color[1] * AO;
    this.low[2] = color[2] * AO;
    return this.low;
  }

  /** Axis-aligned box without a bottom face. Walls get fake AO when they stand on the ground. */
  box(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    color: RGB,
    opts: { win?: number; top?: RGB; ao?: boolean } = {},
  ): void {
    const win = opts.win ?? Win.None;
    const low = this.shadeLow(color, opts.ao ?? y0 < 0.05);
    this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, low, win, color); // +z
    this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, low, win, color); // -z
    this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, low, win, color); // +x
    this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, low, win, color); // -x
    this.flat(x0, z0, x1, z1, y1, opts.top ?? color);
  }

  /** Gable roof with the ridge running along local x. */
  gable(x0: number, z0: number, x1: number, z1: number, yb: number, h: number, roof: RGB, wall: RGB): void {
    const zm = (z0 + z1) / 2;
    const yr = yb + h;
    this.quad(x0, yb, z1, x1, yb, z1, x1, yr, zm, x0, yr, zm, roof);
    this.quad(x1, yb, z0, x0, yb, z0, x0, yr, zm, x1, yr, zm, roof);
    this.tri(x1, yb, z1, x1, yb, z0, x1, yr, zm, wall);
    this.tri(x0, yb, z0, x0, yb, z1, x0, yr, zm, wall);
  }

  /** Four-sided pyramid roof. */
  pyramid(x0: number, z0: number, x1: number, z1: number, yb: number, h: number, color: RGB): void {
    const xm = (x0 + x1) / 2;
    const zm = (z0 + z1) / 2;
    const yr = yb + h;
    this.tri(x0, yb, z1, x1, yb, z1, xm, yr, zm, color);
    this.tri(x1, yb, z1, x1, yb, z0, xm, yr, zm, color);
    this.tri(x1, yb, z0, x0, yb, z0, xm, yr, zm, color);
    this.tri(x0, yb, z0, x0, yb, z1, xm, yr, zm, color);
  }

  cylinder(cx: number, cz: number, y0: number, y1: number, r: number, segments: number, color: RGB, top?: RGB): void {
    const low = this.shadeLow(color, y0 < 0.05);
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      this.quad(x1, y0, z1, x0, y0, z0, x0, y1, z0, x1, y1, z1, low, Win.None, color);
      this.tri(cx, y1, cz, x1, y1, z1, x0, y1, z0, top ?? color);
    }
  }

  /** Cone pointing up (h > 0) or down (h < 0) from a base ring at y0. */
  cone(cx: number, cz: number, y0: number, h: number, r: number, segments: number, color: RGB): void {
    const apex = y0 + h;
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      if (h > 0) this.tri(x1, y0, z1, x0, y0, z0, cx, apex, cz, color);
      else this.tri(x0, y0, z0, x1, y0, z1, cx, apex, cz, color);
    }
  }

  /** Copies the accumulated data into a new BufferGeometry; the builder can be reset and reused afterwards. */
  toGeometry(): BufferGeometry {
    const n = this.vertices;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new BufferAttribute(this.nrm.slice(0, n * 3), 3));
    g.setAttribute('color', new BufferAttribute(this.col.slice(0, n * 3), 3));
    g.setAttribute('aWindow', new BufferAttribute(this.win.slice(0, n), 1));
    const index = n > 65535 ? this.idx.slice(0, this.indices) : Uint16Array.from(this.idx.subarray(0, this.indices));
    g.setIndex(new BufferAttribute(index, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function grow(a: Float32Array, size: number): Float32Array<ArrayBuffer> {
  const next = new Float32Array(size);
  next.set(a);
  return next;
}
