// Points of interest: camp, ruins and wreck. Positions are derived from the seed so
// they are the same in every session. Each POI has a procedural visual and a set of
// interactions (scan, loot) that feed the missions and codex.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { WATER_LEVEL } from './terrain.js';

/** Finds a dry, gentle spot at a distance in [min, max] from the spawn point. */
export function placePoints(terrain, worldData, seed) {
  const rng = createRng(seed ^ 0x9e37);
  const spawn = worldData.spawn;
  return worldData.points.map((def, index) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const angle = (index / worldData.points.length) * Math.PI * 2 + (rng() - 0.5) * 1.4 + 0.5;
      const [dmin, dmax] = def.distance;
      const d = dmin + (dmax - dmin) * rng();
      const x = spawn.x + Math.cos(angle) * d;
      const z = spawn.z + Math.sin(angle) * d;
      if (terrain.height(x, z) < WATER_LEVEL + 3) continue;
      if (terrain.slopeAt(x, z) > 0.45) continue;
      return { ...def, x, z, y: terrain.height(x, z), radius: def.type === 'ruins' ? 12 : 9 };
    }
    const fallback = def.distance[0];
    const angle = index * 2;
    const x = spawn.x + Math.cos(angle) * fallback;
    const z = spawn.z + Math.sin(angle) * fallback;
    return { ...def, x, z, y: terrain.height(x, z), radius: 9 };
  });
}

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
