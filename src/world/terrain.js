// Procedural terrain: height, climate and biome classification.
// Pure functions only (no three.js), so the same code runs in the main thread
// (player physics) and in the chunk worker (mesh data generation).
//
// Large-scale layout (all derived from the seed):
//   continents and oceans -> archipelagos in the shallow ocean -> mountains, hills, plains
//   -> canyons carved in high dry plateaus -> volcano cones and impact craters (cell based)
//   -> latitude gradient (polar caps far along +/-z).
import { createNoise2D, createFbm } from '../core/noise.js';
import { hash2, createRng } from '../core/rng.js';
import { smoothstep } from '../core/math.js';

export const CHUNK_SIZE = 96;
export const WATER_LEVEL = 6;

const VOLCANO_CELL = 2600;
const CRATER_CELL = 3600;
const LAKE_CELL = 1100;
const SAFE_SPAWN_RADIUS = 1000;

/** True when a biome rule (minAlt, maxTemp, minVolcano ...) accepts the sample. */
export function ruleMatches(rule, s) {
  if (rule.minAlt !== undefined && s.h < rule.minAlt) return false;
  if (rule.maxAlt !== undefined && s.h > rule.maxAlt) return false;
  if (rule.minTemp !== undefined && s.temp < rule.minTemp) return false;
  if (rule.maxTemp !== undefined && s.temp > rule.maxTemp) return false;
  if (rule.minMoist !== undefined && s.moist < rule.minMoist) return false;
  if (rule.maxMoist !== undefined && s.moist > rule.maxMoist) return false;
  if (rule.minVolcano !== undefined && s.vol < rule.minVolcano) return false;
  if (rule.minCrater !== undefined && s.crater < rule.minCrater) return false;
  if (rule.minCanyon !== undefined && s.canyon < rule.minCanyon) return false;
  if (rule.minLake !== undefined && !(s.lake >= rule.minLake)) return false;
  return true;
}

/**
 * Creates the terrain model for a seed.
 * `biomeRules` is the ordered list of biome `when` rules (see data/biomes.json).
 * `options.climateShift` (degC) cools or warms a whole planet.
 */
export function createTerrain(seed, biomeRules, options = {}) {
  const s = seed >>> 0;
  const climateShift = options.climateShift ?? 0;
  const continent = createFbm(createNoise2D(s ^ 0x1111), 4);
  const mountainMask = createFbm(createNoise2D(s ^ 0x2222), 3);
  const ridge = createFbm(createNoise2D(s ^ 0x3333), 4);
  const hills = createFbm(createNoise2D(s ^ 0x4444), 4);
  const detail = createNoise2D(s ^ 0x5555);
  const climateTemp = createFbm(createNoise2D(s ^ 0x6666), 3);
  const climateMoist = createFbm(createNoise2D(s ^ 0x7777), 4);
  const landShape = createFbm(createNoise2D(s ^ 0x9999), 3);
  const islandNoise = createFbm(createNoise2D(s ^ 0xaaaa), 3);
  const canyonNoise = createFbm(createNoise2D(s ^ 0xbbbb), 3);

  /** Volcano influence at (x, z): { vol 0..1 (cone footprint), lift (m, negative inside the crater) }. */
  function volcanoAt(x, z, out) {
    out.vol = 0;
    out.lift = 0;
    const ci = Math.floor(x / VOLCANO_CELL);
    const cj = Math.floor(z / VOLCANO_CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const h = hash2(s ^ 0x70c, i, j);
        if ((h & 255) / 255 > 0.38) continue;
        const cx = (i + 0.2 + 0.6 * (((h >>> 8) & 255) / 255)) * VOLCANO_CELL;
        const cz = (j + 0.2 + 0.6 * (((h >>> 16) & 255) / 255)) * VOLCANO_CELL;
        if (Math.hypot(cx, cz) < SAFE_SPAWN_RADIUS + 400) continue;
        const R = 380 + 140 * (((h >>> 24) & 255) / 255);
        const d = Math.hypot(x - cx, z - cz);
        if (d >= R) continue;
        const t = d / R;
        const H = 150 + 70 * (((h >>> 4) & 255) / 255);
        let lift = H * Math.pow(1 - t, 1.6);
        if (t < 0.14) lift -= H * 0.5 * (1 - (t / 0.14) * (t / 0.14));
        if (1 - t > out.vol) out.vol = 1 - t;
        out.lift += lift;
      }
    }
  }

  /** Impact crater bowl with a raised rim: { crater 0..1 (bowl footprint), lift (m) }. */
  function craterAt(x, z, out) {
    out.crater = 0;
    out.craterLift = 0;
    const ci = Math.floor(x / CRATER_CELL);
    const cj = Math.floor(z / CRATER_CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const h = hash2(s ^ 0xc7a, i, j);
        if ((h & 255) / 255 > 0.3) continue;
        const cx = (i + 0.25 + 0.5 * (((h >>> 8) & 255) / 255)) * CRATER_CELL;
        const cz = (j + 0.25 + 0.5 * (((h >>> 16) & 255) / 255)) * CRATER_CELL;
        if (Math.hypot(cx, cz) < SAFE_SPAWN_RADIUS + 500) continue;
        const R = 260 + 160 * (((h >>> 24) & 255) / 255);
        const d = Math.hypot(x - cx, z - cz);
        if (d >= R * 1.25) continue;
        const t = d / R;
        const depth = 55 + 25 * (((h >>> 4) & 255) / 255);
        if (t < 1) {
          out.craterLift -= depth * (1 - t * t);
          out.crater = Math.max(out.crater, 1 - t * 0.9);
        }
        out.craterLift += 16 * Math.exp(-((t - 1.02) * (t - 1.02)) / 0.012);
      }
    }
  }

  /**
   * Freshwater lakes: round basins dug into low ground, deep enough to hold water (the sea level is
   * shared). Returns the lake mask (0..1) and writes the carved height into out.lakeH.
   */
  function lakeAt(x, z, h, land, out) {
    out.lake = 0;
    out.lakeH = h;
    if (land < 0.5) return;
    const lowland = smoothstep(WATER_LEVEL + 52, WATER_LEVEL + 30, h) * smoothstep(0.5, 0.95, land);
    if (lowland <= 0) return;
    const ci = Math.floor(x / LAKE_CELL);
    const cj = Math.floor(z / LAKE_CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const k = hash2(s ^ 0x1a4e, i, j);
        if ((k & 255) / 255 > 0.55) continue;
        const cx = (i + 0.2 + 0.6 * (((k >>> 8) & 255) / 255)) * LAKE_CELL;
        const cz = (j + 0.2 + 0.6 * (((k >>> 16) & 255) / 255)) * LAKE_CELL;
        if (Math.hypot(cx, cz) < 160) continue;
        const R = 110 + 170 * (((k >>> 24) & 255) / 255);
        // Wobbly shoreline.
        const wobble = 1 + 0.18 * detail(x / 45 + i * 7, z / 45 - j * 3);
        const t = Math.hypot(x - cx, z - cz) / (R * wobble);
        if (t >= 1.7) continue;
        const depth = 5 + 5 * (((k >>> 4) & 255) / 255);
        const bowl = WATER_LEVEL - 0.8 - depth * Math.max(0, 1 - t * t);
        const carved = Math.min(h, bowl + (h - bowl) * smoothstep(0.85, 1.7, t));
        const lakeH = h + (carved - h) * lowland;
        if (lakeH < out.lakeH) out.lakeH = lakeH;
        out.lake = Math.max(out.lake, lowland * smoothstep(1.08, 0.75, t));
      }
    }
  }

  const scratch = { h: 0, vol: 0, lift: 0, crater: 0, craterLift: 0, canyon: 0, ocean: 0, depth: 0, lake: 0, lakeH: 0 };

  /** Fills `out` with ground height and the large-scale masks at (x, z). */
  function compute(x, z, out) {
    // Continents: the spawn area is forced to be land so that the game always starts on dry ground.
    const spawnBoost = 1.4 * (1 - smoothstep(350, 1800, Math.hypot(x, z)));
    const cont = landShape(x / 5200 + 13, z / 5200 - 7) * 1.6 + spawnBoost + 0.1;
    const land = smoothstep(-0.32, -0.04, cont);

    const base = 24 + continent(x / 2200, z / 2200) * 26;
    const mask = smoothstep(-0.05, 0.35, mountainMask(x / 1400 + 97, z / 1400 - 53));
    const r = 1 - Math.abs(ridge(x / 520, z / 520));
    const mountains = mask * r * r * 115;
    const hillAmplitude = 8 + 8 * mask;
    const landH = base + mountains + hills(x / 160, z / 160) * hillAmplitude + detail(x / 22, z / 22) * 1.4;

    // Ocean floor: continental shelf, abyss, and archipelagos in the shallow ocean.
    const abyss = smoothstep(-0.05, -0.75, cont);
    const shelf = -4 - 52 * abyss + detail(x / 40, z / 40) * 2.2;
    const island = smoothstep(0.26, 0.6, islandNoise(x / 380 + 3, z / 380 - 5)) * (1 - smoothstep(-0.55, -0.25, cont)) * (1 - land);
    const oceanH = shelf + island * 62;

    let h = oceanH + (landH - oceanH) * land;

    // Canyons: narrow ridged valleys cut into high ground.
    const c = 1 - Math.abs(canyonNoise(x / 1100 + 21, z / 1100 - 9));
    const canyon = smoothstep(0.955, 0.99, c) * smoothstep(22, 48, landH) * land * (1 - 0.6 * mask);
    h -= canyon * (46 + detail(x / 30, z / 30) * 4);

    lakeAt(x, z, h, land, out);
    h = out.lakeH;

    volcanoAt(x, z, out);
    craterAt(x, z, out);
    h += out.lift + out.craterLift;

    out.h = h;
    out.canyon = canyon;
    out.ocean = 1 - land;
    out.depth = Math.max(0, WATER_LEVEL - h);
  }

  /** Ground elevation in metres. */
  function height(x, z) {
    compute(x, z, scratch);
    return scratch.h;
  }

  /** Full sample: height, climate (temp degC, moist 0..1) and the large-scale masks. */
  function sample(x, z) {
    compute(x, z, scratch);
    const lat = smoothstep(4200, 8200, Math.abs(z));
    const equator = 1 - smoothstep(0, 3200, Math.abs(z));
    const temp = 19 + equator * 6 + climateShift + climateTemp(x / 2600, z / 2600) * 12 - lat * 40 - Math.max(0, scratch.h) * 0.0065 + scratch.vol * 22;
    const moist = Math.min(1, Math.max(0, 0.5 + 0.55 * climateMoist(x / 1800, z / 1800)));
    return { h: scratch.h, temp, moist, vol: scratch.vol, canyon: scratch.canyon, crater: scratch.crater, ocean: scratch.ocean, lake: scratch.lake };
  }

  /** Index into biomeRules of the first rule matching the sample. */
  function classify(sampleValue) {
    for (let i = 0; i < biomeRules.length; i++) {
      if (ruleMatches(biomeRules[i], sampleValue)) return i;
    }
    return biomeRules.length - 1;
  }

  function biomeAt(x, z) {
    return classify(sample(x, z));
  }

  /** Steepness of the ground at (x, z), as the magnitude of the height gradient (rise over run). */
  function slopeAt(x, z) {
    const e = 1;
    const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
    const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
    return Math.sqrt(dx * dx + dz * dz);
  }

  return { seed: s, height, sample, classify, biomeAt, slopeAt, waterLevel: WATER_LEVEL, climateShift };
}

/** Deterministic RNG stream for features tied to the planet (used by POI placement). */
export const planetRng = (seed, salt) => createRng((seed ^ salt) >>> 0);
