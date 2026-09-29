/** A point and unit heading on a path. */
export interface PathSample {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

/** Floats stored per segment: start (2), control (2), end (2), length (1). */
const STRIDE = 7;

/**
 * Turns a list of tiles into a smooth, drivable (or walkable) curve.
 *
 * Each tile becomes one quadratic Bézier segment running from the edge where the agent enters to
 * the edge where it leaves, offset sideways from the tile centre line (to its lane or sidewalk).
 * Straight tiles give straight segments; corners give round turns; a reversal gives a U-turn.
 * Tile coordinates: tile (x, z) spans [x, x+1] x [z, z+1].
 */
export class LanePath {
  readonly tiles: readonly number[];
  private readonly data: Float32Array;

  /**
   * @param offset Sideways offset (positive = right of travel) used on the edge between two tiles.
   */
  constructor(tiles: readonly number[], size: number, offset: (from: number, to: number) => number) {
    this.tiles = tiles;
    const n = tiles.length;
    this.data = new Float32Array(Math.max(0, n) * STRIDE);
    if (n < 2) return;

    const cx = (t: number) => (t % size) + 0.5;
    const cz = (t: number) => Math.floor(t / size) + 0.5;
    // Unit direction from tile a to neighbouring tile b.
    const dir = (a: number, b: number): [number, number] => [Math.sign(cx(b) - cx(a)), Math.sign(cz(b) - cz(a))];

    // Point where the path crosses from tile k to tile k+1, shifted to the right of travel.
    const edgePoint = (k: number): [number, number] => {
      const a = tiles[k];
      const b = tiles[k + 1];
      const [dx, dz] = dir(a, b);
      const off = offset(a, b);
      return [(cx(a) + cx(b)) / 2 - dz * off, (cz(a) + cz(b)) / 2 + dx * off];
    };

    for (let k = 0; k < n; k++) {
      const t = tiles[k];
      const din = k === 0 ? dir(tiles[0], tiles[1]) : dir(tiles[k - 1], t);
      const dout = k === n - 1 ? din : dir(t, tiles[k + 1]);
      let sx: number, sz: number, ex: number, ez: number;
      if (k === 0) {
        const off = offset(tiles[0], tiles[1]);
        sx = cx(t) - din[1] * off;
        sz = cz(t) + din[0] * off;
      } else {
        [sx, sz] = edgePoint(k - 1);
      }
      if (k === n - 1) {
        const off = offset(tiles[n - 2], t);
        ex = cx(t) - dout[1] * off;
        ez = cz(t) + dout[0] * off;
      } else {
        [ex, ez] = edgePoint(k);
      }

      let qx: number, qz: number;
      if (din[0] === dout[0] && din[1] === dout[1]) {
        qx = (sx + ex) / 2;
        qz = (sz + ez) / 2;
      } else if (din[0] === -dout[0] && din[1] === -dout[1]) {
        // U-turn: loop out into the tile and come back.
        qx = (sx + ex) / 2 + din[0] * 0.45;
        qz = (sz + ez) / 2 + din[1] * 0.45;
      } else if (din[0] === 0) {
        // Travelling along z, then along x: the corner keeps the entry x and the exit z.
        qx = sx;
        qz = ez;
      } else {
        qx = ex;
        qz = sz;
      }
      const length = (Math.hypot(qx - sx, qz - sz) + Math.hypot(ex - qx, ez - qz) + Math.hypot(ex - sx, ez - sz)) / 2;
      const o = k * STRIDE;
      this.data.set([sx, sz, qx, qz, ex, ez, Math.max(length, 1e-3)], o);
    }
  }

  get segments(): number {
    return this.tiles.length;
  }

  length(k: number): number {
    return this.data[k * STRIDE + 6];
  }

  /** True when segment k bends (used to slow down in corners). */
  isTurn(k: number): boolean {
    const o = k * STRIDE;
    const d = this.data;
    const straightX = (d[o] + d[o + 4]) / 2;
    const straightZ = (d[o + 1] + d[o + 5]) / 2;
    return Math.abs(d[o + 2] - straightX) + Math.abs(d[o + 3] - straightZ) > 0.05;
  }

  sample(k: number, t: number, out: PathSample): PathSample {
    const o = k * STRIDE;
    const d = this.data;
    const u = 1 - t;
    out.x = u * u * d[o] + 2 * u * t * d[o + 2] + t * t * d[o + 4];
    out.z = u * u * d[o + 1] + 2 * u * t * d[o + 3] + t * t * d[o + 5];
    let hx = 2 * u * (d[o + 2] - d[o]) + 2 * t * (d[o + 4] - d[o + 2]);
    let hz = 2 * u * (d[o + 3] - d[o + 1]) + 2 * t * (d[o + 5] - d[o + 3]);
    const len = Math.hypot(hx, hz);
    if (len > 1e-6) {
      hx /= len;
      hz /= len;
    } else {
      hx = out.hx;
      hz = out.hz;
    }
    out.hx = hx;
    out.hz = hz;
    return out;
  }
}
