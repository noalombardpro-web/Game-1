// Procedural models for every vehicle type. Each builder returns { root, beam, lamp, rotors? }.
import * as THREE from 'three';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5, ...extra });

function box(parent, w, h, d, material, x, y, z, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function cyl(parent, rt, rb, h, seg, material, x, y, z, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function lights(root, z, y, intensity = 0) {
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#fff1c0', emissiveIntensity: 2 });
  for (const x of [-0.5, 0.5]) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), lampMat);
    head.position.set(x, y, z);
    root.add(head);
  }
  const beam = new THREE.SpotLight('#fff1c0', intensity, 70, Math.PI / 5, 0.5, 1.4);
  beam.position.set(0, y, z);
  beam.target.position.set(0, y - 1, z + 14);
  root.add(beam);
  root.add(beam.target);
  return { beam, lamp: lampMat };
}

function wheels(root, base, track, radius, material) {
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const w = cyl(root, radius, radius, radius * 0.8, 14, material, x * (track / 2 + 0.2), radius, z * base / 2, [0, 0, Math.PI / 2]);
      w.userData.wheel = true;
    }
  }
}

function rover() {
  const root = new THREE.Group();
  const paint = mat('#e8eef2');
  const accent = mat('#e0873a');
  const dark = mat('#23272e', { metalness: 0.2, roughness: 0.8 });
  const glass = mat('#16303f', { metalness: 0.9, roughness: 0.05 });
  box(root, 2.5, 0.5, 4.0, paint, 0, 0.55, 0);
  box(root, 2.1, 0.9, 1.6, glass, 0, 1.2, -0.2);
  box(root, 2.3, 0.12, 1.9, accent, 0, 1.72, -0.2);
  box(root, 3.3, 0.05, 1.8, mat('#1b3557', { metalness: 0.6, roughness: 0.3 }), 0, 2.05, -0.2, [-0.15, 0, 0]);
  wheels(root, 2.6, 1.9, 0.62, dark);
  return { root, ...lights(root, 1.9, 0.7) };
}

function buggy() {
  const root = new THREE.Group();
  const frame = mat('#d94f2b');
  const dark = mat('#1d1f24', { metalness: 0.2, roughness: 0.8 });
  box(root, 1.7, 0.3, 3.2, frame, 0, 0.55, 0);
  box(root, 1.3, 0.12, 1.0, dark, 0, 0.85, -0.2);
  for (const x of [-0.7, 0.7]) {
    cyl(root, 0.04, 0.04, 1.4, 6, dark, x, 1.3, -0.5);
    cyl(root, 0.04, 0.04, 1.2, 6, dark, x, 1.25, 0.7, [0.3, 0, 0]);
  }
  cyl(root, 0.04, 0.04, 1.5, 6, dark, 0, 1.95, 0.1, [Math.PI / 2, 0, 0]);
  box(root, 0.5, 0.45, 0.5, mat('#444a55'), 0, 0.85, -1.2);
  wheels(root, 2.0, 1.6, 0.5, dark);
  return { root, ...lights(root, 1.6, 0.65) };
}

function transport() {
  const root = new THREE.Group();
  const paint = mat('#c9ced4');
  const accent = mat('#d6a21f');
  const dark = mat('#22262c', { metalness: 0.2, roughness: 0.8 });
  const glass = mat('#16303f', { metalness: 0.9, roughness: 0.05 });
  box(root, 3.0, 0.7, 6.2, paint, 0, 0.9, 0);
  box(root, 2.8, 1.4, 1.9, glass, 0, 1.95, 2.0);
  box(root, 3.0, 0.12, 2.1, accent, 0, 2.7, 2.0);
  box(root, 2.9, 1.8, 3.6, mat('#7b838d'), 0, 2.0, -1.4);
  box(root, 3.0, 0.15, 3.8, accent, 0, 2.95, -1.4);
  wheels(root, 4.2, 2.6, 0.85, dark);
  return { root, ...lights(root, 3.2, 1.0) };
}

function drone() {
  const root = new THREE.Group();
  const paint = mat('#d8dde3');
  const dark = mat('#1d2027', { metalness: 0.3, roughness: 0.6 });
  const glow = new THREE.MeshStandardMaterial({ color: '#7fe9ff', emissive: '#2fd8ff', emissiveIntensity: 2 });
  box(root, 0.7, 0.28, 0.9, paint, 0, 0.5, 0);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow);
  eye.position.set(0, 0.45, 0.48);
  root.add(eye);
  const rotors = [];
  for (const [x, z] of [[0.75, 0.75], [-0.75, 0.75], [0.75, -0.75], [-0.75, -0.75]]) {
    box(root, 0.08, 0.06, 1.1, dark, x * 0.5, 0.52, z * 0.5, [0, Math.atan2(x, z), 0]);
    const r = cyl(root, 0.45, 0.45, 0.02, 12, mat('#5a6270', { transparent: true, opacity: 0.55 }), x, 0.62, z);
    rotors.push(r);
  }
  return { root, rotors, ...lights(root, 0.5, 0.35) };
}

function aircraft() {
  const root = new THREE.Group();
  const paint = mat('#eef1f4');
  const accent = mat('#e0873a');
  const dark = mat('#22262c', { metalness: 0.3, roughness: 0.7 });
  const glass = mat('#16303f', { metalness: 0.9, roughness: 0.05 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 3.4, 4, 10), paint);
  body.rotation.x = Math.PI / 2;
  body.position.y = 1.4;
  body.castShadow = true;
  root.add(body);
  box(root, 1.5, 0.8, 1.6, glass, 0, 1.9, 1.3);
  box(root, 7.5, 0.18, 1.5, accent, 0, 1.55, -0.2);
  box(root, 2.6, 0.14, 0.9, paint, 0, 1.9, -2.8);
  box(root, 0.14, 1.1, 0.9, accent, 0, 2.3, -2.8);
  const rotors = [];
  for (const x of [-3.2, 3.2]) {
    const nacelle = cyl(root, 0.3, 0.3, 1.0, 8, dark, x, 1.7, -0.2, [Math.PI / 2, 0, 0]);
    nacelle.castShadow = true;
    rotors.push(cyl(root, 1.1, 1.1, 0.03, 14, mat('#5a6270', { transparent: true, opacity: 0.5 }), x, 2.15, -0.2));
  }
  for (const x of [-0.6, 0.6]) cyl(root, 0.05, 0.05, 1.0, 5, dark, x, 0.6, 0.2);
  return { root, rotors, ...lights(root, 2.4, 1.4) };
}

function submarine() {
  const root = new THREE.Group();
  const paint = mat('#e0b323');
  const dark = mat('#22262c', { metalness: 0.3, roughness: 0.7 });
  const glass = mat('#0c2a3a', { metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.8 });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 3.0, 4, 12), paint);
  hull.rotation.x = Math.PI / 2;
  hull.position.y = 1.2;
  hull.castShadow = true;
  root.add(hull);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 10), glass);
  dome.position.set(0, 1.6, 1.4);
  root.add(dome);
  box(root, 0.7, 0.9, 1.0, dark, 0, 2.3, -0.4);
  const rotors = [cyl(root, 0.55, 0.55, 0.05, 12, mat('#5a6270', { transparent: true, opacity: 0.5 }), 0, 1.2, -2.6, [Math.PI / 2, 0, 0])];
  box(root, 2.8, 0.1, 0.7, dark, 0, 1.2, -2.2);
  box(root, 0.1, 1.4, 0.7, dark, 0, 1.2, -2.2);
  return { root, rotors, ...lights(root, 2.8, 1.2) };
}

export const MODEL_BUILDERS = { rover, buggy, transport, drone, aircraft, submarine };
