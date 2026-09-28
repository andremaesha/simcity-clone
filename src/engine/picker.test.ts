import { Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { pickTile } from './picker';

const SIZE = 32;

function ray(from: [number, number, number], to: [number, number, number]): Ray {
  const o = new Vector3(...from);
  return new Ray(o, new Vector3(...to).sub(o).normalize());
}

describe('pickTile', () => {
  it('returns the ground tile straight below', () => {
    expect(pickTile(ray([10.5, 50, 20.5], [10.5, 0, 20.5]), SIZE)).toEqual({ x: 10, z: 20 });
  });

  it('hits a tall object in front of the ground point, but only when heights are given', () => {
    const heights = new Float32Array(SIZE * SIZE);
    heights[5 * SIZE + 5] = 5;
    const r = ray([5.5, 10, 0.5], [5.5, 0, 10.5]);
    expect(pickTile(r, SIZE)).toEqual({ x: 5, z: 10 });
    expect(pickTile(r, SIZE, heights)).toEqual({ x: 5, z: 5 });
  });

  it('passes over objects the ray clears', () => {
    const heights = new Float32Array(SIZE * SIZE);
    heights[5 * SIZE + 5] = 2; // the ray is still at y = 4.5 when it leaves this tile
    expect(pickTile(ray([5.5, 10, 0.5], [5.5, 0, 10.5]), SIZE, heights)).toEqual({ x: 5, z: 10 });
  });

  it('returns null when the ray misses the map', () => {
    expect(pickTile(ray([-20, 10, -20], [-10, 0, -10]), SIZE)).toBeNull();
    expect(pickTile(ray([-20, 10, -20], [-10, 0, -10]), SIZE, new Float32Array(SIZE * SIZE))).toBeNull();
  });
});
