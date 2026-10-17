// Procedural models for the base modules.
import * as THREE from 'three';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.55, ...extra });
const glowMat = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 });

function add(group, geometry, material, x, y, z, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

const hull = mat('#d9dee4');
const dark = mat('#2a2f37', { metalness: 0.2, roughness: 0.8 });
const accent = mat('#e0873a');
const glass = mat('#16303f', { metalness: 0.9, roughness: 0.05 });

function habitat() {
  const g = new THREE.Group();
  add(g, new THREE.SphereGeometry(3.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hull, 0, 0, 0);
  add(g, new THREE.CylinderGeometry(3.05, 3.2, 0.4, 20), dark, 0, 0.2, 0);
  add(g, new THREE.BoxGeometry(1.4, 2.0, 0.4), glass, 0, 1.0, 3.0);
  add(g, new THREE.BoxGeometry(1.2, 0.08, 0.1), glowMat('#7fe9ff'), 0, 2.15, 3.15);
  add(g, new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), dark, 1.5, 3.2, -1.0);
  return g;
}

function generator() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(2.0, 2.2, 0.5, 8), dark, 0, 0.25, 0);
  add(g, new THREE.CylinderGeometry(0.7, 0.9, 3.4, 10), hull, 0, 2.0, 0);
  const coil = add(g, new THREE.TorusGeometry(1.0, 0.1, 8, 24), glowMat('#2fd8ff'), 0, 2.6, 0, [Math.PI / 2, 0, 0]);
  coil.userData.spin = true;
  add(g, new THREE.SphereGeometry(0.45, 12, 10), glowMat('#7fe9ff'), 0, 4.0, 0);
  for (let i = 0; i < 3; i++) add(g, new THREE.BoxGeometry(2.6, 0.08, 1.0), mat('#1b3557'), Math.cos(i * 2.1) * 1.2, 1.0, Math.sin(i * 2.1) * 1.2, [-0.5, -i * 2.1, 0]);
  return g;
}

function storage() {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(4.4, 2.4, 2.6), mat('#7b838d'), 0, 1.2, 0);
  add(g, new THREE.BoxGeometry(4.5, 0.2, 2.7), accent, 0, 2.5, 0);
  add(g, new THREE.BoxGeometry(1.6, 2.0, 0.1), dark, 0, 1.1, 1.35);
  add(g, new THREE.BoxGeometry(2.0, 1.4, 2.0), mat('#5b6b2f'), 2.8, 0.7, 0.2);
  return g;
}

function workbench() {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(2.6, 0.2, 1.2), mat('#8d6b45'), 0, 1.0, 0);
  for (const [x, z] of [[-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45]]) add(g, new THREE.BoxGeometry(0.12, 1.0, 0.12), dark, x, 0.5, z);
  add(g, new THREE.BoxGeometry(0.8, 0.4, 0.6), accent, -0.6, 1.3, 0);
  add(g, new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), dark, 0.9, 1.8, -0.3, [0, 0, 0.5]);
  add(g, new THREE.SphereGeometry(0.1, 8, 6), glowMat('#ffd166'), 1.4, 2.4, -0.3);
  return g;
}

function lab() {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(5.0, 2.8, 3.6), hull, 0, 1.4, 0);
  add(g, new THREE.BoxGeometry(4.2, 1.0, 0.1), glass, 0, 1.7, 1.85);
  add(g, new THREE.CylinderGeometry(0.9, 0.9, 0.5, 14), dark, 1.4, 3.05, 0);
  add(g, new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), accent, 1.4, 3.3, 0);
  add(g, new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), dark, -1.8, 4.1, 0);
  add(g, new THREE.SphereGeometry(0.15, 8, 6), glowMat('#7fe9ff'), -1.8, 5.4, 0);
  return g;
}

function garage() {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(8.4, 0.3, 7.0), dark, 0, 0.15, 0);
  add(g, new THREE.BoxGeometry(8.0, 3.6, 0.3), hull, 0, 1.95, -3.3);
  add(g, new THREE.BoxGeometry(0.3, 3.6, 6.6), hull, -3.9, 1.95, 0);
  add(g, new THREE.BoxGeometry(0.3, 3.6, 6.6), hull, 3.9, 1.95, 0);
  add(g, new THREE.BoxGeometry(8.4, 0.3, 7.0), accent, 0, 3.9, 0);
  add(g, new THREE.BoxGeometry(6.0, 0.1, 0.1), glowMat('#ffd166'), 0, 3.6, 3.2);
  return g;
}

function comm() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.9, 1.1, 0.6, 8), dark, 0, 0.3, 0);
  add(g, new THREE.CylinderGeometry(0.15, 0.3, 11, 6), hull, 0, 6.0, 0);
  const dish = add(g, new THREE.SphereGeometry(1.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), hull, 0, 9.0, 0.5, [-1.0, 0, 0]);
  dish.scale.set(1, 0.6, 1);
  const beacon = add(g, new THREE.SphereGeometry(0.22, 8, 6), glowMat('#ff5d5d'), 0, 11.7, 0);
  beacon.userData.blink = true;
  return g;
}

function pad() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(7.5, 7.7, 0.4, 28), mat('#5b616b', { metalness: 0.2, roughness: 0.8 }), 0, 0.2, 0);
  add(g, new THREE.TorusGeometry(6.2, 0.12, 6, 40), glowMat('#ffd166'), 0, 0.45, 0, [Math.PI / 2, 0, 0]);
  add(g, new THREE.TorusGeometry(3.0, 0.1, 6, 32), glowMat('#7fe9ff'), 0, 0.45, 0, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(g, new THREE.CylinderGeometry(0.15, 0.15, 1.4, 6), dark, Math.cos(a) * 7.0, 0.9, Math.sin(a) * 7.0);
    add(g, new THREE.SphereGeometry(0.2, 8, 6), glowMat('#ffd166'), Math.cos(a) * 7.0, 1.7, Math.sin(a) * 7.0);
  }
  return g;
}

function turret() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) add(g, new THREE.CylinderGeometry(0.06, 0.1, 1.6, 5), dark, Math.cos(i * 2.1) * 0.5, 0.8, Math.sin(i * 2.1) * 0.5, [Math.sin(i * 2.1) * 0.3, 0, -Math.cos(i * 2.1) * 0.3]);
  const head = new THREE.Group();
  head.position.y = 1.7;
  head.name = 'head';
  add(head, new THREE.BoxGeometry(0.9, 0.5, 0.9), hull, 0, 0, 0);
  add(head, new THREE.CylinderGeometry(0.08, 0.1, 1.1, 8), dark, 0, 0, 0.8, [Math.PI / 2, 0, 0]);
  add(head, new THREE.SphereGeometry(0.1, 8, 6), glowMat('#4dff9a'), 0, 0.3, 0.3);
  g.add(head);
  return g;
}

export const STRUCTURE_BUILDERS = { habitat, generator, storage, workbench, lab, garage, comm, pad, turret };
