// Procedural sci-fi weapon meshes. Each model points its barrel along +Z with the grip at the origin,
// in metres. `muzzle` (an Object3D) marks where beams start.
import * as THREE from 'three';

const shared = {};
function mats() {
  if (shared.body) return shared;
  shared.body = new THREE.MeshStandardMaterial({ color: '#2a2f38', metalness: 0.7, roughness: 0.35 });
  shared.plate = new THREE.MeshStandardMaterial({ color: '#c8ced6', metalness: 0.8, roughness: 0.25 });
  shared.grip = new THREE.MeshStandardMaterial({ color: '#15171b', metalness: 0.1, roughness: 0.8 });
  shared.glow = {};
  return shared;
}
function glow(color) {
  const m = mats();
  m.glow[color] ??= new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2, roughness: 0.4 });
  return m.glow[color];
}

function box(group, w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}
function tube(group, r, len, x, y, z, material, segments = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segments), material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

const BUILDERS = {
  plasma_pistol(g, c) {
    const m = mats();
    box(g, 0.05, 0.12, 0.05, 0, -0.05, -0.01, m.grip);
    box(g, 0.06, 0.07, 0.24, 0, 0.04, 0.07, m.body);
    box(g, 0.065, 0.025, 0.18, 0, 0.085, 0.06, m.plate);
    tube(g, 0.018, 0.08, 0, 0.04, 0.22, glow(c));
    return 0.27;
  },
  laser_rifle(g, c) {
    const m = mats();
    box(g, 0.05, 0.12, 0.05, 0, -0.06, 0, m.grip);
    box(g, 0.07, 0.09, 0.62, 0, 0.03, 0.16, m.body);
    box(g, 0.06, 0.08, 0.22, 0, 0.01, -0.2, m.grip);
    box(g, 0.075, 0.03, 0.4, 0, 0.09, 0.14, m.plate);
    box(g, 0.04, 0.1, 0.06, 0, -0.06, 0.16, m.body);
    tube(g, 0.02, 0.22, 0, 0.03, 0.56, m.plate);
    box(g, 0.01, 0.02, 0.3, 0.04, 0.03, 0.15, glow(c));
    box(g, 0.01, 0.02, 0.3, -0.04, 0.03, 0.15, glow(c));
    return 0.68;
  },
  pulse_shotgun(g, c) {
    const m = mats();
    box(g, 0.05, 0.12, 0.05, 0, -0.06, 0, m.grip);
    box(g, 0.1, 0.1, 0.5, 0, 0.03, 0.12, m.body);
    box(g, 0.07, 0.08, 0.2, 0, 0.0, -0.18, m.grip);
    tube(g, 0.035, 0.36, 0.025, 0.05, 0.35, m.plate);
    tube(g, 0.035, 0.36, -0.025, 0.05, 0.35, m.plate);
    box(g, 0.11, 0.02, 0.2, 0, -0.03, 0.25, glow(c));
    return 0.54;
  },
  rail_sniper(g, c) {
    const m = mats();
    box(g, 0.05, 0.12, 0.05, 0, -0.06, 0, m.grip);
    box(g, 0.06, 0.08, 0.7, 0, 0.03, 0.2, m.body);
    box(g, 0.05, 0.1, 0.26, 0, 0.0, -0.24, m.grip);
    tube(g, 0.016, 0.55, 0, 0.04, 0.78, m.plate);
    tube(g, 0.03, 0.22, 0, 0.12, 0.15, m.body);
    tube(g, 0.032, 0.01, 0, 0.12, 0.26, glow(c));
    box(g, 0.012, 0.012, 0.5, 0, 0.075, 0.55, glow(c));
    return 1.05;
  },
  rocket_launcher(g, c) {
    const m = mats();
    box(g, 0.05, 0.12, 0.05, 0, -0.06, 0.1, m.grip);
    tube(g, 0.075, 1.0, 0, 0.08, 0.2, m.body, 16);
    tube(g, 0.085, 0.12, 0, 0.08, 0.68, m.plate, 16);
    tube(g, 0.085, 0.12, 0, 0.08, -0.28, m.plate, 16);
    box(g, 0.04, 0.06, 0.12, 0.09, 0.14, 0.2, m.body);
    tube(g, 0.05, 0.01, 0, 0.08, 0.745, glow(c), 16);
    return 0.75;
  },
  harvest(g) {
    const m = mats();
    const handle = tube(g, 0.02, 0.7, 0, 0, 0.2, m.grip);
    handle.rotation.x = Math.PI / 2;
    box(g, 0.05, 0.08, 0.06, 0, 0, 0.55, m.body);
    const head = box(g, 0.035, 0.42, 0.05, 0, 0.0, 0.56, m.plate);
    head.rotation.x = 0.25;
    box(g, 0.03, 0.06, 0.03, 0, 0.21, 0.6, glow('#7fe9ff'));
    return 0.6;
  }
};

/** Builds a new weapon mesh (Group) with a `userData.muzzle` Object3D. */
export function createWeaponMesh(id, color = '#7fe9ff') {
  const group = new THREE.Group();
  group.name = `weapon ${id}`;
  const length = (BUILDERS[id] ?? BUILDERS.plasma_pistol)(group, color);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, length);
  group.add(muzzle);
  group.userData.muzzle = muzzle;
  return group;
}
