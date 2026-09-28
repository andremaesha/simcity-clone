import { GeometryBuilder } from './geometryBuilder';
import { C, mix, shade } from './palette';

/** Stacking heights for the flat layers on top of the ground, far enough apart to avoid z-fighting when zoomed out. */
export const LAYER = {
  ground: 0,
  detail: 0.012,
  asphalt: 0.015,
  marking: 0.03,
} as const;

/** A single low-poly tree in the builder's current frame: conifer or broadleaf depending on `kind` in [0, 1). */
export function meshTree(b: GeometryBuilder, px: number, pz: number, s: number, kind: number): void {
  const tw = 0.022 * s;
  if (kind < 0.45) {
    const green = mix(C.pine, C.leaf, kind);
    b.box(px - tw, 0, pz - tw, px + tw, 0.1 * s, pz + tw, C.trunk);
    b.cone(px, pz, 0.08 * s, 0.3 * s, 0.15 * s, 6, green);
    b.cone(px, pz, 0.22 * s, 0.24 * s, 0.11 * s, 6, shade(green, 1.08));
  } else {
    const green = mix(C.leaf, C.leafLight, kind);
    b.box(px - tw, 0, pz - tw, px + tw, 0.14 * s, pz + tw, C.trunk);
    b.cone(px, pz, 0.22 * s, 0.2 * s, 0.16 * s, 6, green);
    b.cone(px, pz, 0.22 * s, -0.1 * s, 0.16 * s, 6, shade(green, 0.85));
  }
}
