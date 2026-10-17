// Points of interest: camp, ruins and wreck. Positions are derived from the seed so
// they are the same in every session. Each POI has a procedural visual and a set of
// interactions (scan, loot) that feed the missions and codex.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { WATER_LEVEL } from './terrain.js';

/**
 * Places the points of interest of a planet. Each definition gives a distance range from the
 * spawn and optionally the biomes it may appear in; the search samples the terrain until a
 * suitable, gentle spot is found. Definitions without a biome constraint (the story places)
 * always get a spot; constrained ones are dropped when the map offers none.
 * @param biomeIds array mapping biome index to biome id
 */
export function placePoints(terrain, worldData, seed, biomeIds = []) {
  const rng = createRng(seed ^ 0x9e37);
  const spawn = worldData.spawn;
  const used = [];
  const result = [];
  worldData.points.forEach((def, index) => {
    const [dmin, dmax] = def.distance;
    const attempts = def.biomes ? 900 : 160;
    let spot = null;
    for (let attempt = 0; attempt < attempts && !spot; attempt++) {
      const angle = def.biomes ? rng() * Math.PI * 2 : (index / worldData.points.length) * Math.PI * 2 + (rng() - 0.5) * 1.4 + 0.5;
      const d = dmin + (dmax - dmin) * rng();
      const x = spawn.x + Math.cos(angle) * d;
      const z = spawn.z + Math.sin(angle) * d;
      const h = terrain.height(x, z);
      const slope = terrain.slopeAt(x, z);
      if (def.underwater) {
        if (h > WATER_LEVEL - 9 || h < -48 || slope > 0.6) continue;
      } else if (h < WATER_LEVEL + 3 || slope > 0.45) continue;
      if (def.biomes && !def.biomes.includes(biomeIds[terrain.biomeAt(x, z)])) continue;
      if (used.some((u) => Math.hypot(u.x - x, u.z - z) < 120)) continue;
      spot = { x, z, h };
    }
    if (!spot) {
      if (def.biomes) return;
      const angle = index * 2;
      const x = spawn.x + Math.cos(angle) * dmin;
      const z = spawn.z + Math.sin(angle) * dmin;
      spot = { x, z, h: terrain.height(x, z) };
    }
    used.push(spot);
    result.push({ ...def, x: spot.x, z: spot.z, y: spot.h, radius: POI_RADIUS[def.type] ?? 9 });
  });
  return result;
}

const POI_RADIUS = { ruins: 12, facility: 16, lab: 12, crater_site: 40, cavern: 10, reef_wreck: 12, sunken_ruins: 14 };

/** What a container yields, by place type. Items are [id, count, chance]. */
export const LOOT = {
  wreck: [['electronic_part', 2, 1], ['alien_sample', 1, 0.5]],
  facility: [['ore_metal', 3, 1], ['electronic_part', 3, 1], ['fiber', 2, 1], ['repair_kit', 1, 0.6], ['ancient_tech', 1, 0.25]],
  lab: [['electronic_part', 2, 1], ['alien_sample', 2, 1], ['cryo_shard', 1, 0.5], ['repair_tool_kit', 1, 0.5]],
  reef_wreck: [['ore_metal', 4, 1], ['electronic_part', 2, 1], ['deep_pearl', 1, 0.5]],
  crater_site: [['alien_sample', 2, 1], ['rare_crystal', 1, 0.7], ['ancient_tech', 1, 0.3]]
};

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, ...extra });
}

/** Builds the visual of a POI at its position. Returns { group, beacon? }. */
export function buildPointVisual(poi, heightAt) {
  const group = new THREE.Group();
  group.position.set(poi.x, poi.y, poi.z);
  const glowMat = new THREE.MeshStandardMaterial({ color: '#7fe9ff', emissive: '#2fd8ff', emissiveIntensity: 2.2 });
  const addMesh = (geo, material, pos = [0, 0, 0], rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  if (poi.type === 'camp') {
    const tent = mat('#d8dde3');
    for (const [x, z, r] of [[-5, 3, 0.3], [4, 4, -0.5], [0, -5, 1.2]]) {
      addMesh(new THREE.ConeGeometry(2.2, 2.6, 6), tent, [x, 1.3, z], [0, r, 0]);
    }
    addMesh(new THREE.BoxGeometry(1.4, 1.1, 1.2), mat('#5a6470'), [-2, 0.55, -2]);
    addMesh(new THREE.BoxGeometry(1.2, 0.9, 1.0), mat('#e0873a'), [2.5, 0.45, -1.5]);
    addMesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 6), mat('#9aa6b2', { metalness: 0.8 }), [0, 3.5, 0]);
    const beacon = addMesh(new THREE.SphereGeometry(0.25, 10, 8), glowMat.clone(), [0, 7.2, 0]);
    beacon.castShadow = false;
    return { group, beacon };
  }
  if (poi.type === 'ruins') {
    const stone = mat('#8c8478', { roughness: 0.9 });
    const pillars = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = 4 + ((i * 7) % 3);
      addMesh(new THREE.BoxGeometry(1.2, h, 1.2), stone, [Math.cos(a) * 9, h / 2, Math.sin(a) * 9]);
      const glyph = addMesh(new THREE.BoxGeometry(0.3, 0.6, 0.1), glowMat.clone(), [Math.cos(a) * 9, h * 0.6, Math.sin(a) * 9 + 0.66]);
      glyph.castShadow = false;
      pillars.push(glyph);
    }
    addMesh(new THREE.CylinderGeometry(3.5, 3.5, 0.5, 12), stone, [0, 0.25, 0]);
    return { group, glyphs: pillars };
  }
  if (poi.type === 'facility' || poi.type === 'lab') {
    const hull = mat('#cfd5db', { metalness: 0.5 });
    const dark = mat('#343a43');
    if (poi.type === 'facility') {
      addMesh(new THREE.BoxGeometry(14, 5, 9), hull, [0, 2.5, 0]);
      addMesh(new THREE.BoxGeometry(14.4, 0.4, 9.4), mat('#a0522d'), [0, 5.2, 0]);
      addMesh(new THREE.BoxGeometry(5, 4, 0.3), mat('#16303f', { metalness: 0.9 }), [0, 2.2, 4.6]);
      addMesh(new THREE.BoxGeometry(3, 2.4, 2.6), mat('#5b6b2f'), [10, 1.2, 3]);
      addMesh(new THREE.BoxGeometry(3, 2.4, 2.6), mat('#7b838d'), [10, 1.2, -1]);
      for (let i = 0; i < 8; i++) addMesh(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 5), dark, -12 + i * 3.4, 1.1, 11);
    } else {
      addMesh(new THREE.SphereGeometry(5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), hull, [0, 0, 0]);
      addMesh(new THREE.BoxGeometry(6, 3, 4), hull, [7, 1.5, 0]);
      addMesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), dark, -4, 5, 0);
      const beacon = addMesh(new THREE.SphereGeometry(0.25, 8, 6), glowMat.clone(), [-4, 8.2, 0]);
      beacon.castShadow = false;
      return { group, beacon };
    }
    return { group };
  }
  if (poi.type === 'crater_site') {
    const metal = mat('#6a7580', { metalness: 0.85, roughness: 0.3 });
    const crystal = new THREE.MeshStandardMaterial({ color: '#8a3fd0', emissive: '#b66bff', emissiveIntensity: 1.8, roughness: 0.2 });
    for (let i = 0; i < 7; i++) {
      const a = i * 2.3;
      const r = 4 + (i % 3) * 3;
      addMesh(new THREE.OctahedronGeometry(1.2 + (i % 3) * 0.5, 0), i % 2 ? crystal : metal, [Math.cos(a) * r, 1.4, Math.sin(a) * r], [a, a, 0]);
    }
    const marker = addMesh(new THREE.CylinderGeometry(0.15, 0.15, 7, 6), metal, [0, 3.5, 0]);
    marker.castShadow = false;
    const beacon = addMesh(new THREE.SphereGeometry(0.4, 8, 6), crystal.clone(), [0, 7.2, 0]);
    beacon.castShadow = false;
    return { group, beacon };
  }
  if (poi.type === 'cavern') {
    const rock = mat('#6d665e', { roughness: 0.95 });
    addMesh(new THREE.BoxGeometry(3, 9, 4), rock, [-5, 4.5, 0]);
    addMesh(new THREE.BoxGeometry(3, 9, 4), rock, [5, 4.5, 0]);
    addMesh(new THREE.BoxGeometry(14, 3, 4.5), rock, [0, 9, 0]);
    addMesh(new THREE.BoxGeometry(11, 7, 5), mat('#06090d'), [0, 3.5, -1]);
    const blue = new THREE.MeshStandardMaterial({ color: '#4fc8ff', emissive: '#2fd4ff', emissiveIntensity: 2 });
    for (let i = 0; i < 6; i++) addMesh(new THREE.ConeGeometry(0.35, 1.6 + (i % 3) * 0.6, 5), blue, [-3 + i * 1.2, 0.9, 2.4], [0.1 * (i % 3), 0, 0.2 * (i % 2 ? 1 : -1)]);
    const beacon = addMesh(new THREE.SphereGeometry(0.4, 8, 6), blue.clone(), [0, 6, 2.2]);
    beacon.castShadow = false;
    return { group, beacon };
  }
  if (poi.type === 'reef_wreck') {
    const hull = mat('#4a525c', { metalness: 0.6 });
    addMesh(new THREE.BoxGeometry(5, 3.4, 15), hull, [0, 1.6, 0], [0.1, 0.5, 0.35]);
    addMesh(new THREE.BoxGeometry(3, 2.4, 4), mat('#d8dde3'), [0.5, 3.6, -3], [0, 0.5, 0.2]);
    addMesh(new THREE.BoxGeometry(2.2, 1.6, 1.6), mat('#e0873a'), [4, 0.8, 5]);
    addMesh(new THREE.BoxGeometry(1.6, 1.2, 1.2), mat('#5b6b2f'), [-3.5, 0.6, 6]);
    return { group };
  }
  if (poi.type === 'sunken_ruins') {
    const stone = mat('#6a7a7c', { roughness: 0.9 });
    const glyphs = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const h = 5 + (i % 3) * 2.2;
      addMesh(new THREE.BoxGeometry(1.4, h, 1.4), stone, [Math.cos(a) * 8, h / 2, Math.sin(a) * 8], [0.05 * (i % 2), 0, 0.06 * (i % 3)]);
      const glyph = addMesh(new THREE.BoxGeometry(0.3, 0.8, 0.1), glowMat.clone(), [Math.cos(a) * 8, h * 0.6, Math.sin(a) * 8 + 0.76]);
      glyph.castShadow = false;
      glyphs.push(glyph);
    }
    addMesh(new THREE.CylinderGeometry(3, 3, 0.5, 10), stone, [0, 0.25, 0]);
    return { group, glyphs };
  }
  // Wreck of a shuttle: fractured hull, wing stump and a sealed container.
  const hull = mat('#3d4650', { metalness: 0.6 });
  addMesh(new THREE.BoxGeometry(3.2, 2.4, 14), hull, [0, 1.2, 0], [0.12, 0.4, -0.2]);
  addMesh(new THREE.BoxGeometry(9, 0.25, 3), hull, [-3, 0.9, 1], [0.1, 0.5, -0.5]);
  addMesh(new THREE.BoxGeometry(0.9, 1.4, 1.3), mat('#e8eef2'), [4.2, 0.7, -3], [0, 0.3, 0]);
  addMesh(new THREE.BoxGeometry(1.1, 0.8, 0.8), mat('#5b6b2f'), [-2.2, 0.4, -4.5]);
  return { group };
}

/** Sample positions for each POI's loot container, used to make loot persistent. */
export const containerId = (poi) => `${poi.id}:container`;
