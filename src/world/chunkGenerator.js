// Builds all data needed for one terrain chunk: heights, normals, vertex colours,
// vegetation instances, colliders, resource nodes and fauna spawn points.
// Pure function: runs in the chunk worker and in unit tests.
import { CHUNK_SIZE, WATER_LEVEL } from './terrain.js';
import { createRng, hash2 } from '../core/rng.js';
import { smoothstep } from '../core/math.js';

/** Grid resolution per level of detail (segments per chunk side). */
export const LOD_SEGMENTS = { 0: 48, 1: 24, 2: 12 };

/** Candidate points per chunk for vegetation sampling. */
const CANDIDATES = 1000;

/** Vegetation instance record layout: x, y, z, yaw, scale, variant, tint, lean. */
export const VEG_STRIDE = 8;
/** Collider record layout: x, z, radius. */
export const COLLIDER_STRIDE = 3;

const COLLIDER_RADIUS = {
  pine: 0.32, broadleaf: 0.5, palm: 0.22, cactus: 0.38, rock: 0.9, deadtree: 0.3, icespike: 0.5, spire: 1.2, lavarock: 0.8
};
const SCALE_RANGE = {
  pine: [0.8, 1.35], broadleaf: [0.8, 1.3], palm: [0.85, 1.25], cactus: [0.7, 1.3],
  shrub: [0.7, 1.3], fern: [0.8, 1.2], grass: [0.8, 1.3], rock: [0.5, 1.6],
  kelp: [0.7, 1.5], coral: [0.7, 1.4], deadtree: [0.8, 1.3], icespike: [0.6, 1.6], spire: [0.8, 1.8], lavarock: [0.5, 1.5]
};
/** Harvest kind of solid vegetation: 1 = wood, 2 = stone. */
const HARVEST_KIND = { pine: 1, broadleaf: 1, palm: 1, cactus: 1, deadtree: 1, rock: 2, icespike: 2, spire: 2, lavarock: 2 };
const WATER_PLANTS = new Set(['grass', 'fern', 'kelp', 'coral', 'rock']);

/** Converts '#rrggbb' to linear RGB floats. */
export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => Math.pow(c / 255, 2.2);
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

const ROCK = hexToLinear('#6b655c');
const SNOW = hexToLinear('#eef3f7');
const MUD = hexToLinear('#2b281f');
const LAVA = hexToLinear('#ff5a14');

/** Terrain texture layers, in the order of the `surface` vertex weights (8 per vertex, last unused). */
export const SURFACE_LAYERS = ['grass', 'dirt', 'sand', 'snow', 'dry', 'lava', 'rock'];
export const SURFACE_STRIDE = 8;
const LAYER_INDEX = Object.fromEntries(SURFACE_LAYERS.map((id, i) => [id, i]));

/**
 * @param terrain  object returned by createTerrain
 * @param content  { biomes: [{id,name,rgb,...}], species: [...], items: ... }
 * @param req      { cx, cz, lod, seed, density }
 */
export function generateChunk(terrain, content, req) {
  const { cx, cz, lod, seed } = req;
  const density = req.density ?? 1;
  const n = LOD_SEGMENTS[lod];
  const step = CHUNK_SIZE / n;
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const side = n + 1;
  const count = side * side;

  const heights = new Float32Array(count);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const biomeIds = new Uint8Array(count);
  const volcano = new Float32Array(count);
  const surface = new Float32Array(count * SURFACE_STRIDE);
  const biomes = content.biomes;

  // Pass 1: heights and biome per vertex.
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const x = ox + i * step;
      const z = oz + j * step;
      const sample = terrain.sample(x, z);
      const idx = terrain.classify(sample);
      heights[j * side + i] = sample.h;
      biomeIds[j * side + i] = idx;
      volcano[j * side + i] = sample.vol;
    }
  }

  // Pass 2: normals from central differences (sampled analytically, so chunk seams match)
  // and colours from the biome palette, slope rock and snow caps.
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      const x = ox + i * step;
      const z = oz + j * step;
      const e = step * 0.5;
      const dhx = (terrain.height(x + e, z) - terrain.height(x - e, z)) / (2 * e);
      const dhz = (terrain.height(x, z + e) - terrain.height(x, z - e)) / (2 * e);
      const len = Math.hypot(dhx, 1, dhz);
      const nx = -dhx / len;
      const ny = 1 / len;
      const nz = -dhz / len;
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;

      const h = heights[k];
      const biome = biomes[biomeIds[k]];
      const base = biome.rgb;
      const jitter = (hash2(seed, ox + i, oz + j) / 4294967296 - 0.5) * 0.14;
      let r = base[0] * (1 + jitter);
      let g = base[1] * (1 + jitter);
      let b = base[2] * (1 + jitter);
      const rock = smoothstep(0.84, 0.62, ny);
      r += (ROCK[0] - r) * rock;
      g += (ROCK[1] - g) * rock;
      b += (ROCK[2] - b) * rock;
      const w = k * SURFACE_STRIDE;
      for (const [layer, amount] of Object.entries(biome.surface ?? { grass: 1 })) surface[w + LAYER_INDEX[layer]] = amount;
      if (biome.snowLine !== undefined) {
        const snow = smoothstep(biome.snowLine, biome.snowLine + 12, h) * smoothstep(0.6, 0.85, ny);
        surface[w + 3] += snow * 2;
        r += (SNOW[0] - r) * snow;
        g += (SNOW[1] - g) * snow;
        b += (SNOW[2] - b) * snow;
      }
      if (biome.lava) {
        const glow = smoothstep(0.84, 0.95, volcano[k]);
        surface[w + 5] += glow * 3;
        r += (LAVA[0] - r) * glow;
        g += (LAVA[1] - g) * glow;
        b += (LAVA[2] - b) * glow;
      }
      if (h < WATER_LEVEL && !biome.marine) {
        const submerged = smoothstep(WATER_LEVEL, WATER_LEVEL - 4, h);
        surface[w + 1] += submerged * 2;
        r += (MUD[0] - r) * submerged;
        g += (MUD[1] - g) * submerged;
        b += (MUD[2] - b) * submerged;
      }
      // Steep ground shows bare rock whatever the biome; weights are normalised to sum to 1.
      surface[w + 6] += rock * 3;
      let total = 0;
      for (let l = 0; l < 7; l++) total += surface[w + l];
      for (let l = 0; l < 7; l++) surface[w + l] /= total || 1;
      colors[k * 3] = r;
      colors[k * 3 + 1] = g;
      colors[k * 3 + 2] = b;
    }
  }

  const result = {
    id: `${cx}:${cz}:${lod}`, cx, cz, lod, n, step, origin: [ox, oz],
    heights, normals, colors, biomeIds, surface,
    veg: {}, colliders: new Float32Array(0), colliderKinds: new Uint8Array(0), resources: [], spawns: []
  };
  if (lod !== 0) return result;

  const rng = createRng(hash2(seed, cx, cz));
  const vegetation = populateVegetation(terrain, content, result, rng, density);
  result.veg = vegetation.veg;
  result.colliders = vegetation.colliders;
  result.colliderKinds = vegetation.colliderKinds;
  result.resources = populateResources(content, result, rng);
  result.spawns = populateFauna(content, result, rng);
  return result;
}

/** Nearest-vertex lookup of the grid value at world position (x, z). */
function gridIndex(result, x, z) {
  const side = result.n + 1;
  const i = Math.min(side - 1, Math.max(0, Math.round((x - result.origin[0]) / result.step)));
  const j = Math.min(side - 1, Math.max(0, Math.round((z - result.origin[1]) / result.step)));
  return j * side + i;
}

function populateVegetation(terrain, content, result, rng, density) {
  const area = (CHUNK_SIZE * CHUNK_SIZE) / CANDIDATES;
  const buckets = {};
  const colliders = [];
  const kinds = [];
  const biomes = content.biomes;

  for (let c = 0; c < CANDIDATES; c++) {
    const x = result.origin[0] + rng() * CHUNK_SIZE;
    const z = result.origin[1] + rng() * CHUNK_SIZE;
    const k = gridIndex(result, x, z);
    const y = result.heights[k];
    const ny = result.normals[k * 3 + 1];
    const underwater = y < WATER_LEVEL + 0.5;
    const biome = biomes[result.biomeIds[k]];
    for (const entry of biome.vegetation) {
      const p = Math.min(0.95, entry.perM2 * area * density);
      if (rng() >= p) continue;
      if (underwater && !WATER_PLANTS.has(entry.kind)) break;
      const isRock = entry.kind === 'rock';
      if (ny < (isRock ? 0.55 : 0.8)) break;
      const variants = entry.variants ?? 1;
      const [smin, smax] = SCALE_RANGE[entry.kind];
      const record = [
        x, y, z, rng() * Math.PI * 2, smin + (smax - smin) * rng(),
        Math.floor(rng() * variants), rng(), entry.kind === 'pine' || entry.kind === 'broadleaf' ? rng() * 0.12 : 0
      ];
      (buckets[entry.kind] ??= []).push(...record);
      const radius = COLLIDER_RADIUS[entry.kind];
      if (radius !== undefined) {
        colliders.push(x, z, radius * record[4]);
        kinds.push(HARVEST_KIND[entry.kind] ?? 0);
      }
      break;
    }
  }

  const veg = {};
  for (const kind of Object.keys(buckets)) veg[kind] = new Float32Array(buckets[kind]);
  return { veg, colliders: new Float32Array(colliders), colliderKinds: new Uint8Array(kinds) };
}

function populateResources(content, result, rng) {
  const nodes = [];
  const side = result.n + 1;
  const sampleBiome = result.biomeIds[Math.floor(side * side / 2)];
  const biome = content.biomes[sampleBiome];
  const expected = biome.resources?.expected ?? 0;
  let amount = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0);
  const table = Object.entries(biome.resources?.table ?? {});
  const total = table.reduce((sum, [, w]) => sum + w, 0);
  for (let i = 0; i < amount && total > 0; i++) {
    const x = result.origin[0] + 4 + rng() * (CHUNK_SIZE - 8);
    const z = result.origin[1] + 4 + rng() * (CHUNK_SIZE - 8);
    const k = gridIndex(result, x, z);
    if ((result.heights[k] < WATER_LEVEL + 0.5 && !biome.marine) || result.normals[k * 3 + 1] < 0.7) continue;
    let roll = rng() * total;
    let item = table[0][0];
    for (const [id, w] of table) {
      if ((roll -= w) < 0) { item = id; break; }
    }
    nodes.push({ id: `${result.cx}:${result.cz}:${i}`, item, x, y: result.heights[k], z, yaw: rng() * Math.PI * 2 });
  }
  return nodes;
}

/** Where a species may live: land (default), shallow water, or open sea (deep water). */
export function habitatAllows(species, groundHeight) {
  if (species.habitat === 'sea') return groundHeight < WATER_LEVEL - 6;
  if (species.habitat === 'water') return groundHeight < WATER_LEVEL + 0.5;
  return groundHeight >= WATER_LEVEL + 0.5;
}

function populateFauna(content, result, rng) {
  const spawns = [];
  const side = result.n + 1;
  const biome = content.biomes[result.biomeIds[Math.floor(side * side / 2)]];
  const options = biome.animals ?? [];
  const total = options.reduce((sum, a) => sum + a.weight, 0);
  if (total === 0 || rng() > 0.3) return spawns;
  const cxw = result.origin[0] + CHUNK_SIZE / 2 + (rng() - 0.5) * CHUNK_SIZE * 0.5;
  const czw = result.origin[1] + CHUNK_SIZE / 2 + (rng() - 0.5) * CHUNK_SIZE * 0.5;
  let roll = rng() * total;
  let choice = options[0];
  for (const option of options) {
    if ((roll -= option.weight) < 0) { choice = option; break; }
  }
  const species = content.speciesById[choice.species];
  if (!species) return spawns;
  const k = gridIndex(result, cxw, czw);
  if (!habitatAllows(species, result.heights[k])) return spawns;
  const group = species.social.min + Math.floor(rng() * (species.social.max - species.social.min + 1));
  const spread = Math.max(2, species.social.radius * 0.5);
  for (let m = 0; m < group; m++) {
    const x = cxw + (rng() - 0.5) * spread * 2;
    const z = czw + (rng() - 0.5) * spread * 2;
    const yaw = rng() * Math.PI * 2;
    if (!habitatAllows(species, result.heights[gridIndex(result, x, z)])) continue;
    spawns.push({ id: `${result.cx}:${result.cz}:${choice.species}:${m}`, species: choice.species, x, z, yaw });
  }
  return spawns;
}
