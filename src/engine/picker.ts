import { Ray } from 'three';

export interface TileHit {
  x: number;
  z: number;
}

/** Nothing on the map is taller than this; rays are only traced below it. */
const MAX_OBJECT_HEIGHT = 8;

/**
 * Finds the tile under a ray by walking the grid (Amanatides & Woo DDA) from where the ray drops
 * below the tallest possible object, until it enters a tile's column: the box from the ground up to
 * the tallest thing on that tile. With `heights` omitted, every column is flat, which gives a plain
 * ground-plane pick.
 *
 * This costs at most a few hundred steps, so it is cheap enough to run every frame, unlike
 * raycasting a million triangles of merged chunk geometry.
 */
export function pickTile(ray: Ray, size: number, heights?: Float32Array): TileHit | null {
  const o = ray.origin;
  const d = ray.direction;
  if (d.y >= -1e-6) return null;

  const tGround = -o.y / d.y;
  let tStart = heights ? Math.max(0, (MAX_OBJECT_HEIGHT - o.y) / d.y) : tGround;
  let tEnd = tGround;

  // Clip to the map's footprint.
  for (const [origin, dir] of [
    [o.x, d.x],
    [o.z, d.z],
  ]) {
    if (Math.abs(dir) < 1e-9) {
      if (origin < 0 || origin > size) return null;
      continue;
    }
    const t1 = (0 - origin) / dir;
    const t2 = (size - origin) / dir;
    tStart = Math.max(tStart, Math.min(t1, t2));
    tEnd = Math.min(tEnd, Math.max(t1, t2));
  }
  if (tStart > tEnd) return null;

  if (!heights) {
    const x = Math.floor(o.x + d.x * tGround);
    const z = Math.floor(o.z + d.z * tGround);
    return x >= 0 && z >= 0 && x < size && z < size ? { x, z } : null;
  }

  const clamp = (v: number) => Math.min(size - 1, Math.max(0, v));
  let x = clamp(Math.floor(o.x + d.x * tStart));
  let z = clamp(Math.floor(o.z + d.z * tStart));
  const stepX = d.x > 0 ? 1 : -1;
  const stepZ = d.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / d.x);
  const tDeltaZ = Math.abs(1 / d.z);
  let tMaxX = Math.abs(d.x) < 1e-9 ? Infinity : ((d.x > 0 ? x + 1 : x) - o.x) / d.x;
  let tMaxZ = Math.abs(d.z) < 1e-9 ? Infinity : ((d.z > 0 ? z + 1 : z) - o.z) / d.z;

  for (let guard = 0; guard < size * 4; guard++) {
    const tExit = Math.min(tMaxX, tMaxZ, tEnd);
    // The ray descends, so it is lowest where it leaves the tile.
    if (o.y + d.y * tExit <= heights[z * size + x]) return { x, z };
    if (tExit >= tEnd) break;
    if (tMaxX < tMaxZ) {
      x += stepX;
      tMaxX += tDeltaX;
    } else {
      z += stepZ;
      tMaxZ += tDeltaZ;
    }
    if (x < 0 || z < 0 || x >= size || z >= size) break;
  }
  return null;
}
