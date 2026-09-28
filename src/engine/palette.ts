import { Color } from 'three';

/** Linear-space RGB triple, ready to be written into a vertex colour buffer. */
export type RGB = readonly [number, number, number];

/** Converts an sRGB hex colour to linear RGB (three.js colour management does the conversion). */
export function rgb(hex: number): RGB {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

export function shade(c: RGB, factor: number): RGB {
  return [c[0] * factor, c[1] * factor, c[2] * factor];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const C = {
  grass: rgb(0x7fb356),
  grassDark: rgb(0x6aa048),
  sand: rgb(0xd8c690),
  dirt: rgb(0x8a6a48),
  cliff: rgb(0x6e5a44),
  water: rgb(0x3f8fc4),
  waterDeep: rgb(0x2e74a8),

  sidewalk: rgb(0xb9b7ae),
  asphalt: rgb(0x4a4d52),
  roadLine: rgb(0xf2d24b),
  roadWhite: rgb(0xeeeeea),

  zoneR: rgb(0x9ed67a),
  zoneC: rgb(0x7fb5e6),
  zoneI: rgb(0xe8c86a),
  lawn: rgb(0x86bf5c),
  concrete: rgb(0xa9a8a2),
  parking: rgb(0x5d6066),
  gravel: rgb(0x9a917f),
  foundation: rgb(0x8f8c86),
  scaffold: rgb(0xd9a03a),
  crane: rgb(0xf0c030),

  trunk: rgb(0x6b4a2e),
  leaf: rgb(0x4f8f3a),
  leafLight: rgb(0x6aa84a),
  pine: rgb(0x2f6b3a),

  door: rgb(0x5a3b28),
  darkMetal: rgb(0x55595e),
  lightMetal: rgb(0xb4b8bc),
  white: rgb(0xf4f4f0),
};

export const HOUSE_WALLS = [0xf3ead8, 0xe9e2cf, 0xf0dca8, 0xcfdde8, 0xe8c4b0, 0xd9d4c8, 0xbfd3b0].map(rgb);
export const HOUSE_ROOFS = [0xa0453a, 0x7a4a36, 0x5b6470, 0x44484e, 0x3f6b6e, 0x8c5a3c].map(rgb);
export const APARTMENT_WALLS = [0xc98d6a, 0xd8c3a5, 0xb56e52, 0xe0d6c4, 0xa9b4bd, 0xcfc0a0].map(rgb);
export const SHOP_WALLS = [0xf1e6d0, 0xe6d3b3, 0xd6e2e8, 0xf4d6c8, 0xdfe7d0].map(rgb);
export const AWNINGS = [0xd8433a, 0x2f8f5a, 0x2f6fb0, 0xe38b2c, 0x8f3fa0, 0xe0b92c].map(rgb);
export const OFFICE_WALLS = [0x9fb4c4, 0x7f97a8, 0xb9c4cc, 0x8aa6a0, 0xc6c0b4, 0x6f8494].map(rgb);
export const TOWER_WALLS = [0x6f8ea8, 0x4f6d86, 0x8aa2b4, 0x5e7a70, 0x9aa7b0, 0x3f556a].map(rgb);
export const INDUSTRY_WALLS = [0xb8b0a0, 0xa39a88, 0x9aa3a8, 0xc2b28f, 0x8f8878].map(rgb);
export const INDUSTRY_ROOFS = [0x6b7076, 0x7c6f5f, 0x5d6b73, 0x8a8f94].map(rgb);
export const CRATES = [0xa87a44, 0x3f6f9f, 0xb04a3a, 0x5f8f4f].map(rgb);
