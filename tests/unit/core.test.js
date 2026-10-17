import { describe, it, expect } from 'vitest';
import { hash2, createRng, seedFromString } from '../../src/core/rng.js';
import { createNoise2D, createFbm } from '../../src/core/noise.js';
import { clamp, wrapAngle, smoothstep } from '../../src/core/math.js';

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('keeps values in [0, 1)', () => {
    const r = createRng(9);
    for (let i = 0; i < 5000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hashes coordinates deterministically and spreads them', () => {
    expect(hash2(1, 3, 4)).toBe(hash2(1, 3, 4));
    expect(hash2(1, 3, 4)).not.toBe(hash2(1, 4, 3));
    expect(hash2(2, 3, 4)).not.toBe(hash2(1, 3, 4));
  });

  it('turns strings into stable seeds', () => {
    expect(seedFromString('aurore')).toBe(seedFromString('aurore'));
    expect(seedFromString('aurore')).not.toBe(seedFromString('Aurore'));
  });
});

describe('noise', () => {
  it('is deterministic and bounded', () => {
    const n1 = createNoise2D(77);
    const n2 = createNoise2D(77);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      expect(n1(x, y)).toBe(n2(x, y));
      min = Math.min(min, n1(x, y));
      max = Math.max(max, n1(x, y));
    }
    expect(min).toBeGreaterThanOrEqual(-1.05);
    expect(max).toBeLessThanOrEqual(1.05);
    expect(max - min).toBeGreaterThan(0.8);
  });

  it('fbm stays within [-1, 1] for normalised octaves', () => {
    const f = createFbm(createNoise2D(5), 5);
    for (let i = 0; i < 1000; i++) {
      const v = f(i * 0.13, i * 0.07);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.05);
    }
  });
});

describe('math', () => {
  it('clamps, smooths and wraps angles', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 6);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 6);
  });
});
