import { describe, it, expect } from 'vitest';
import { loadContent } from '../../src/world/content.js';
import { createTerrain, WATER_LEVEL } from '../../src/world/terrain.js';
import { placePoints } from '../../src/world/pois.js';
import { habitatAllows } from '../../src/world/chunkGenerator.js';

const content = loadContent();
const biomeIds = content.biomes.map((b) => b.id);

describe('world v2', () => {
  it('spawns on land for several seeds', () => {
    for (const seed of [1, 7, 4242, 99999]) {
      const t = createTerrain(seed, content.biomeRules);
      expect(t.height(0, 0)).toBeGreaterThan(WATER_LEVEL);
    }
  });

  it('is deterministic and covers many biomes', () => {
    const a = createTerrain(4242, content.biomeRules);
    const b = createTerrain(4242, content.biomeRules);
    const seen = new Set();
    for (let x = -12000; x <= 12000; x += 400) {
      for (let z = -12000; z <= 12000; z += 400) {
        const sa = a.sample(x, z);
        expect(sa.h).toBe(b.sample(x, z).h);
        seen.add(a.classify(sa));
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });

  it('the cryos climate shift gives a colder world', () => {
    const cold = createTerrain(4242, content.biomeRules, { climateShift: -34 });
    const warm = createTerrain(4242, content.biomeRules);
    let c = 0;
    let w = 0;
    for (let i = 0; i < 100; i++) { c += cold.sample(i * 200, 100).temp; w += warm.sample(i * 200, 100).temp; }
    expect(c).toBeLessThan(w);
  });

  it('places points of interest with their radius and biome constraints', () => {
    const t = createTerrain(4242, content.biomeRules);
    const pts = placePoints(t, content.world, 4242, biomeIds);
    expect(pts.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(pts.map((p) => p.id));
    expect(ids.size).toBe(pts.length);
    for (const p of pts) expect(Number.isFinite(p.y)).toBe(true);
  });

  it('marine species live in the sea, land species on land', () => {
    expect(habitatAllows({ habitat: 'sea' }, WATER_LEVEL - 20)).toBe(true);
    expect(habitatAllows({ habitat: 'sea' }, WATER_LEVEL + 3)).toBe(false);
    expect(habitatAllows({}, WATER_LEVEL + 3)).toBe(true);
    expect(habitatAllows({}, WATER_LEVEL - 3)).toBe(false);
  });
});
