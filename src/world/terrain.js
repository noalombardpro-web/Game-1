// Procedural terrain: height, climate and biome classification.
// Pure functions only (no three.js), so the same code runs in the main thread
// (player physics) and in the chunk worker (mesh data generation).
import { createNoise2D, createFbm } from '../core/noise.js';
import { smoothstep } from '../core/math.js';

export const CHUNK_SIZE = 96;
export const WATER_LEVEL = 6;

/** True when a biome rule (minAlt, maxTemp, ...) accepts the given climate sample. */
export function ruleMatches(rule, h, temp, moist) {
  if (rule.minAlt !== undefined && h < rule.minAlt) return false;
  if (rule.maxAlt !== undefined && h > rule.maxAlt) return false;
  if (rule.minTemp !== undefined && temp < rule.minTemp) return false;
  if (rule.maxTemp !== undefined && temp > rule.maxTemp) return false;
  if (rule.minMoist !== undefined && moist < rule.minMoist) return false;
  if (rule.maxMoist !== undefined && moist > rule.maxMoist) return false;
  return true;
}

/**
 * Creates the terrain model for a seed.
 * `biomeRules` is the ordered list of biome definitions (see data/biomes.json).
 */
export function createTerrain(seed, biomeRules) {
  const s = seed >>> 0;
  const continent = createFbm(createNoise2D(s ^ 0x1111), 4);
  const mountainMask = createFbm(createNoise2D(s ^ 0x2222), 3);
  const ridge = createFbm(createNoise2D(s ^ 0x3333), 4);
  const hills = createFbm(createNoise2D(s ^ 0x4444), 4);
  const detail = createNoise2D(s ^ 0x5555);
  const climateTemp = createFbm(createNoise2D(s ^ 0x6666), 3);
  const climateMoist = createFbm(createNoise2D(s ^ 0x7777), 4);

  /** Ground elevation in metres. Continental plains, hills, then ridged mountains. */
  function height(x, z) {
    const base = 24 + continent(x / 2200, z / 2200) * 26;
    const mask = smoothstep(-0.05, 0.35, mountainMask(x / 1400 + 97, z / 1400 - 53));
    const r = 1 - Math.abs(ridge(x / 520, z / 520));
    const mountains = mask * r * r * 115;
    const hillAmplitude = 8 + 8 * mask;
    return base + mountains + hills(x / 160, z / 160) * hillAmplitude + detail(x / 22, z / 22) * 1.4;
  }

  /** Climate sample: height (m), temperature (degC, lapse-rate corrected) and moisture (0..1). */
  function sample(x, z) {
    const h = height(x, z);
    const temp = 16 + climateTemp(x / 2600, z / 2600) * 12 - Math.max(0, h) * 0.0065;
    const moist = Math.min(1, Math.max(0, 0.5 + 0.55 * climateMoist(x / 1800, z / 1800)));
    return { h, temp, moist };
  }

  /** Index into biomeRules of the first rule matching the climate sample. */
  function classify(h, temp, moist) {
    for (let i = 0; i < biomeRules.length; i++) {
      if (ruleMatches(biomeRules[i], h, temp, moist)) return i;
    }
    return biomeRules.length - 1;
  }

  function biomeAt(x, z) {
    const { h, temp, moist } = sample(x, z);
    return classify(h, temp, moist);
  }

  /** Steepness of the ground at (x, z), as the magnitude of the height gradient (rise over run). */
  function slopeAt(x, z) {
    const e = 1;
    const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
    const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
    return Math.sqrt(dx * dx + dz * dz);
  }

  return { seed: s, height, sample, classify, biomeAt, slopeAt, waterLevel: WATER_LEVEL };
}
