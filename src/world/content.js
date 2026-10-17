// Loads the data files (data/*.json) and derives lookup tables used by the game.
// Shared by the main thread and the chunk worker.
import biomesData from '../../data/biomes.json';
import speciesData from '../../data/species.json';
import itemsData from '../../data/items.json';
import worldData from '../../data/world.json';
import enemiesData from '../../data/enemies.json';
import missionsData from '../../data/missions.json';
import controlsData from '../../data/controls.json';
import { hexToLinear } from './chunkGenerator.js';

/** Returns a fresh, validated copy of all content tables. */
export function loadContent() {
  const biomes = biomesData.biomes.map((b, index) => ({ ...b, index, rgb: hexToLinear(b.ground) }));
  const species = speciesData.species;
  const items = itemsData.items;
  for (const biome of biomes) {
    for (const entry of biome.animals ?? []) {
      if (!species.some((s) => s.id === entry.species)) {
        throw new Error(`Biome ${biome.id} references unknown species ${entry.species}`);
      }
    }
  }
  return {
    biomes,
    biomesById: Object.fromEntries(biomes.map((b) => [b.id, b])),
    biomeRules: biomes.map((b) => b.when ?? {}),
    species,
    speciesById: Object.fromEntries(species.map((s) => [s.id, s])),
    items,
    itemsById: Object.fromEntries(items.map((i) => [i.id, i])),
    recipes: itemsData.recipes,
    capacity: itemsData.capacity,
    world: worldData,
    enemies: enemiesData,
    missions: missionsData.missions,
    controls: controlsData
  };
}
