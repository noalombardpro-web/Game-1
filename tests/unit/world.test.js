import { describe, it, expect } from 'vitest';
import { loadContent } from '../../src/world/content.js';
import { createTerrain, CHUNK_SIZE, WATER_LEVEL } from '../../src/world/terrain.js';
import { generateChunk, LOD_SEGMENTS, VEG_STRIDE, COLLIDER_STRIDE } from '../../src/world/chunkGenerator.js';
import { lodForDistance } from '../../src/world/world.js';
import { placePoints } from '../../src/world/pois.js';

const content = loadContent();
const terrain = createTerrain(4242, content.biomeRules);

describe('terrain', () => {
  it('is reproducible for the same seed and differs between seeds', () => {
    const other = createTerrain(4242, content.biomeRules);
    const far = createTerrain(9, content.biomeRules);
    for (const [x, z] of [[10, 20], [-500, 800], [1234, -4321]]) {
      expect(terrain.height(x, z)).toBe(other.height(x, z));
    }
    expect(terrain.height(10, 20)).not.toBe(far.height(10, 20));
  });

  it('has a varied relief with mountains, plains and water', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 400; i++) {
      const h = terrain.height((i % 20) * 300, Math.floor(i / 20) * 300);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    expect(max - min).toBeGreaterThan(60);
    expect(min).toBeLessThan(WATER_LEVEL);
    expect(max).toBeGreaterThan(90);
  });

  it('classifies at least three visually distinct biomes', () => {
    const seen = new Set();
    for (let i = 0; i < 1500; i++) {
      seen.add(terrain.biomeAt((i % 50) * 180, Math.floor(i / 50) * 180));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

describe('chunk generation', () => {
  const req = { cx: 3, cz: -2, lod: 0, seed: 4242, density: 1 };
  const a = generateChunk(terrain, content, req);
  const b = generateChunk(terrain, content, req);

  it('is reproducible: same seed and coordinates give identical data', () => {
    expect(Array.from(a.heights.slice(0, 50))).toEqual(Array.from(b.heights.slice(0, 50)));
    expect(Object.keys(a.veg)).toEqual(Object.keys(b.veg));
    for (const kind of Object.keys(a.veg)) expect(Array.from(a.veg[kind])).toEqual(Array.from(b.veg[kind]));
    expect(a.resources.map((r) => r.id)).toEqual(b.resources.map((r) => r.id));
  });

  it('builds a grid of the expected resolution and bounds', () => {
    const n = LOD_SEGMENTS[0];
    expect(a.heights.length).toBe((n + 1) * (n + 1));
    expect(a.origin).toEqual([3 * CHUNK_SIZE, -2 * CHUNK_SIZE]);
    expect(a.normals.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('places vegetation with variation (several variants, varied scale) and valid records', () => {
    let instances = 0;
    const variants = new Set();
    const scales = new Set();
    for (const kind of Object.keys(a.veg)) {
      const arr = a.veg[kind];
      expect(arr.length % VEG_STRIDE).toBe(0);
      for (let i = 0; i < arr.length; i += VEG_STRIDE) {
        instances++;
        variants.add(`${kind}:${arr[i + 5]}`);
        scales.add(Math.round(arr[i + 4] * 20));
        expect(arr[i + 4]).toBeGreaterThan(0.4);
      }
    }
    expect(instances).toBeGreaterThan(0);
    expect(scales.size).toBeGreaterThan(3);
    expect(a.colliders.length % COLLIDER_STRIDE).toBe(0);
  });

  it('only generates detail data at LOD 0 and uses lower resolution for far rings', () => {
    const far = generateChunk(terrain, content, { ...req, lod: 2 });
    expect(far.heights.length).toBe((LOD_SEGMENTS[2] + 1) ** 2);
    expect(Object.keys(far.veg)).toHaveLength(0);
    expect(far.spawns).toHaveLength(0);
  });

  it('chooses level of detail by ring distance', () => {
    expect(lodForDistance(0)).toBe(0);
    expect(lodForDistance(2)).toBe(0);
    expect(lodForDistance(3)).toBe(1);
    expect(lodForDistance(6)).toBe(2);
  });

  it('keeps fauna spawns referring to known species', () => {
    for (let cx = -4; cx < 4; cx++) {
      const chunk = generateChunk(terrain, content, { cx, cz: 1, lod: 0, seed: 4242, density: 1 });
      for (const s of chunk.spawns) expect(content.speciesById[s.species]).toBeDefined();
    }
  });
});

describe('points of interest', () => {
  it('places camp, ruins and wreck on dry ground at their distances', () => {
    const pois = placePoints(terrain, content.world, 4242);
    expect(pois.map((p) => p.id)).toEqual(['camp', 'ruins', 'wreck']);
    for (const poi of pois) {
      const d = Math.hypot(poi.x, poi.z);
      expect(d).toBeGreaterThan(poi.distance[0] - 1);
      expect(d).toBeLessThan(poi.distance[1] + 1);
      expect(poi.y).toBeGreaterThan(WATER_LEVEL);
    }
  });
});
