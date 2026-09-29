import { describe, expect, it } from 'vitest';
import { LanePath, PathSample } from './lanePath';

const SIZE = 10;
const tile = (x: number, z: number) => z * SIZE + x;
const s = (): PathSample => ({ x: 0, z: 0, hx: 0, hz: 1 });

describe('LanePath', () => {
  it('keeps to the right of travel on a straight road', () => {
    const path = new LanePath([tile(0, 0), tile(1, 0), tile(2, 0)], SIZE, () => 0.2);
    const start = path.sample(0, 0, s());
    const end = path.sample(2, 1, s());
    // Heading +x: right of travel is +z.
    expect(start.x).toBeCloseTo(0.5);
    expect(start.z).toBeCloseTo(0.7);
    expect(start.hx).toBeCloseTo(1);
    expect(start.hz).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(2.5);
    expect(end.z).toBeCloseTo(0.7);
    expect(path.isTurn(1)).toBe(false);
  });

  it('is continuous from one tile to the next, including through a corner', () => {
    const path = new LanePath([tile(0, 0), tile(1, 0), tile(1, 1), tile(1, 2)], SIZE, () => 0.2);
    for (let k = 0; k < path.segments - 1; k++) {
      const a = path.sample(k, 1, s());
      const b = path.sample(k + 1, 0, s());
      expect(a.x).toBeCloseTo(b.x);
      expect(a.z).toBeCloseTo(b.z);
    }
    expect(path.isTurn(1)).toBe(true);
    // After turning from +x to +z the heading follows the new direction.
    const after = path.sample(2, 0.5, s());
    expect(after.hx).toBeCloseTo(0);
    expect(after.hz).toBeCloseTo(1);
    // Heading +z: right of travel is -x.
    expect(after.x).toBeCloseTo(1.3);
  });
});
