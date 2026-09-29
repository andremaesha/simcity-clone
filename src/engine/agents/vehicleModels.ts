import { BufferGeometry } from 'three';
import { GeometryBuilder } from '../geometryBuilder';
import { RGB, rgb } from '../palette';

/**
 * Low-poly vehicle meshes, authored facing +z with the origin at ground level. Body panels are
 * white so the per-instance colour paints them; glass, tyres and trim are dark so they stay dark.
 */

/** Vehicles are drawn larger than true scale (like most city builders) so traffic reads at a glance. */
export const VEHICLE_SCALE = 1.6;

const WHITE = rgb(0xffffff);
const GLASS = rgb(0x2a3440);
const TRIM = rgb(0x3a3d42);
const LIGHT = rgb(0xfff2c0);
const BRAKE = rgb(0xc0392b);

function wheels(b: GeometryBuilder, halfW: number, zs: number[]): void {
  for (const z of zs) {
    b.box(-halfW - 0.004, 0, z - 0.014, -halfW + 0.008, 0.024, z + 0.014, TRIM, { ao: false });
    b.box(halfW - 0.008, 0, z - 0.014, halfW + 0.004, 0.024, z + 0.014, TRIM, { ao: false });
  }
}

function lights(b: GeometryBuilder, halfW: number, front: number, back: number, y: number): void {
  b.box(-halfW + 0.006, y, front, -halfW + 0.018, y + 0.01, front + 0.003, LIGHT, { ao: false });
  b.box(halfW - 0.018, y, front, halfW - 0.006, y + 0.01, front + 0.003, LIGHT, { ao: false });
  b.box(-halfW + 0.006, y, back - 0.003, -halfW + 0.018, y + 0.01, back, BRAKE, { ao: false });
  b.box(halfW - 0.018, y, back - 0.003, halfW - 0.006, y + 0.01, back, BRAKE, { ao: false });
}

export function carGeometry(): BufferGeometry {
  const b = new GeometryBuilder();
  const w = 0.036;
  b.box(-w, 0.01, -0.072, w, 0.042, 0.072, WHITE, { ao: false });
  b.box(-w * 0.86, 0.042, -0.04, w * 0.86, 0.07, 0.03, GLASS, { top: WHITE, ao: false });
  wheels(b, w, [-0.045, 0.045]);
  lights(b, w, 0.072, -0.072, 0.024);
  return b.toGeometry().scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
}

/** Box van: the moving van that brings new residents in from the highway. */
export function vanGeometry(): BufferGeometry {
  const b = new GeometryBuilder();
  const w = 0.042;
  b.box(-w, 0.012, 0.035, w, 0.07, 0.095, WHITE, { ao: false });
  b.box(-w * 0.9, 0.045, 0.07, w * 0.9, 0.068, 0.096, GLASS, { ao: false });
  b.box(-w - 0.004, 0.012, -0.1, w + 0.004, 0.105, 0.03, WHITE, { ao: false });
  wheels(b, w, [-0.07, 0.06]);
  lights(b, w, 0.095, -0.1, 0.026);
  return b.toGeometry().scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
}

/** Semi truck for freight between industry, shops and the highway. */
export function truckGeometry(): BufferGeometry {
  const b = new GeometryBuilder();
  const w = 0.044;
  b.box(-w, 0.014, 0.075, w, 0.085, 0.14, WHITE, { ao: false });
  b.box(-w * 0.9, 0.055, 0.12, w * 0.9, 0.08, 0.141, GLASS, { ao: false });
  b.box(-w - 0.004, 0.02, -0.16, w + 0.004, 0.115, 0.068, rgb(0xe8e8e4), { ao: false });
  wheels(b, w, [-0.13, -0.09, 0.03, 0.11]);
  lights(b, w, 0.14, -0.16, 0.03);
  return b.toGeometry().scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
}

export const CAR_PAINT: readonly RGB[] = [
  0xd23c3c, 0x2f63b8, 0xf0f0ec, 0x2b2e33, 0x9aa0a6, 0xe0b22c, 0x3f8f5f, 0x7a2e3a, 0x4a7bd0, 0xc8c8c4, 0xe07b2c,
].map(rgb);
export const VAN_PAINT: readonly RGB[] = [0xf2f2ee, 0xf0c040, 0xe96b2c, 0x3d7ec9].map(rgb);
export const TRUCK_PAINT: readonly RGB[] = [0xd23c3c, 0x2f63b8, 0x3f8f5f, 0xf0f0ec, 0x444a52].map(rgb);
