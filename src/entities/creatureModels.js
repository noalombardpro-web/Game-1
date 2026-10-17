// Procedural creature bodies. Four archetypes (quadruped, biped, sauropod, flyer) are
// scaled from the species data sheet. Geometry and materials are shared per species.
import * as THREE from 'three';

const cache = new Map();

function speciesAssets(species) {
  if (cache.has(species.id)) return cache.get(species.id);
  const body = new THREE.MeshStandardMaterial({ color: species.colors.body, roughness: 0.82, metalness: 0 });
  const accent = new THREE.MeshStandardMaterial({
    color: species.colors.accent,
    roughness: 0.6,
    emissive: species.colors.emissive ? species.colors.accent : '#000000',
    emissiveIntensity: species.colors.emissive ? 1.8 : 0
  });
  const dark = new THREE.MeshStandardMaterial({ color: '#1d1a17', roughness: 0.7 });
  const eye = new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#ffb020', emissiveIntensity: 0.6 });
  const assets = { body, accent, dark, eye };
  cache.set(species.id, assets);
  return assets;
}

const ellipsoid = (r, sx, sy, sz) => {
  const g = new THREE.SphereGeometry(r, 14, 10);
  g.scale(sx, sy, sz);
  return g;
};

function mesh(geometry, material, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

function pivot(parent, pos) {
  const g = new THREE.Group();
  g.position.set(...pos);
  parent.add(g);
  return g;
}

function buildQuadruped(species, a) {
  const { length: L, height: H } = species.size;
  const root = new THREE.Group();
  const body = pivot(root, [0, H * 0.62, 0]);
  body.add(mesh(ellipsoid(H * 0.3, 1, 0.9, 1.5 * L / H), a.body, [0, 0, 0]));
  const head = pivot(body, [0, H * 0.14, L * 0.42]);
  head.add(mesh(ellipsoid(H * 0.2, 0.85, 0.9, 1.25), a.body, [0, H * 0.06, 0.08]));
  head.add(mesh(new THREE.SphereGeometry(H * 0.035, 6, 5), a.eye, [H * 0.1, H * 0.1, H * 0.18]));
  head.add(mesh(new THREE.SphereGeometry(H * 0.035, 6, 5), a.eye, [-H * 0.1, H * 0.1, H * 0.18]));
  const tail = pivot(body, [0, H * 0.08, -L * 0.42]);
  tail.add(mesh(new THREE.ConeGeometry(H * 0.09, L * 0.45, 6), a.body, [0, L * 0.2, 0], [-Math.PI / 2 + 0.6, 0, 0]));
  const legs = [];
  for (const [x, z] of [[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]]) {
    const leg = pivot(root, [x * H, H * 0.55, z * L]);
    leg.add(mesh(new THREE.CylinderGeometry(H * 0.07, H * 0.055, H * 0.55, 8), a.dark, [0, -H * 0.27, 0]));
    legs.push(leg);
  }
  if (species.colors.emissive) {
    for (let i = 0; i < 4; i++) {
      body.add(mesh(new THREE.SphereGeometry(H * 0.05, 6, 5), a.accent, [0, H * 0.28, -L * 0.3 + i * L * 0.2]));
    }
  }
  return { root, body, head, tail, legs, wings: [], neck: null };
}

function buildBiped(species, a) {
  const { length: L, height: H } = species.size;
  const root = new THREE.Group();
  const hips = pivot(root, [0, H * 0.48, 0]);
  hips.add(mesh(ellipsoid(H * 0.2, 0.95, 0.8, 1.3), a.body, [0, 0, 0]));
  const torso = pivot(hips, [0, H * 0.12, 0]);
  torso.rotation.x = -0.45;
  torso.add(mesh(ellipsoid(H * 0.18, 0.9, 1.2, 1.6), a.body, [0, H * 0.1, L * 0.12]));
  const head = pivot(torso, [0, H * 0.25, L * 0.32]);
  head.add(mesh(ellipsoid(H * 0.12, 0.8, 0.9, 1.5), a.body, [0, 0, 0]));
  head.add(mesh(new THREE.BoxGeometry(H * 0.14, H * 0.05, H * 0.28), a.dark, [0, -H * 0.05, H * 0.1]));
  head.add(mesh(new THREE.SphereGeometry(H * 0.025, 6, 5), a.eye, [H * 0.07, H * 0.05, H * 0.08]));
  head.add(mesh(new THREE.SphereGeometry(H * 0.025, 6, 5), a.eye, [-H * 0.07, H * 0.05, H * 0.08]));
  const tail = pivot(hips, [0, H * 0.05, -L * 0.1]);
  tail.add(mesh(new THREE.ConeGeometry(H * 0.1, L * 0.55, 7), a.body, [0, 0, -L * 0.25], [-Math.PI / 2, 0, 0]));
  const legs = [];
  for (const x of [-0.18, 0.18]) {
    const leg = pivot(hips, [x * H, -H * 0.02, 0]);
    leg.add(mesh(new THREE.CylinderGeometry(H * 0.07, H * 0.05, H * 0.5, 8), a.dark, [0, -H * 0.25, 0]));
    leg.add(mesh(new THREE.BoxGeometry(H * 0.14, H * 0.06, H * 0.32), a.dark, [0, -H * 0.5, H * 0.08]));
    legs.push(leg);
  }
  const arms = [];
  for (const x of [-0.2, 0.2]) {
    const arm = pivot(torso, [x * H, H * 0.1, L * 0.12]);
    arm.add(mesh(new THREE.CylinderGeometry(H * 0.03, H * 0.025, H * 0.22, 6), a.body, [0, -H * 0.1, H * 0.04]));
    arms.push(arm);
  }
  return { root, body: torso, head, tail, legs, wings: [], neck: null, arms };
}

function buildSauropod(species, a) {
  const { length: L, height: H } = species.size;
  const root = new THREE.Group();
  const body = pivot(root, [0, H * 0.55, 0]);
  body.add(mesh(ellipsoid(H * 0.3, 1, 0.8, 1.7 * L / H), a.body, [0, 0, 0]));
  const neck = pivot(body, [0, H * 0.18, L * 0.3]);
  neck.rotation.x = -0.9;
  neck.add(mesh(new THREE.CylinderGeometry(H * 0.07, H * 0.12, H * 0.9, 8), a.body, [0, H * 0.45, 0]));
  const head = pivot(neck, [0, H * 0.92, 0]);
  head.rotation.x = 0.9;
  head.add(mesh(ellipsoid(H * 0.08, 1.3, 0.8, 1.7), a.body, [0, 0, 0]));
  const tail = pivot(body, [0, 0, -L * 0.3]);
  tail.add(mesh(new THREE.ConeGeometry(H * 0.14, L * 0.7, 8), a.body, [0, 0, -L * 0.3], [-Math.PI / 2, 0, 0]));
  const legs = [];
  for (const [x, z] of [[-0.25, 0.3], [0.25, 0.3], [-0.25, -0.3], [0.25, -0.3]]) {
    const leg = pivot(root, [x * H, H * 0.5, z * L]);
    leg.add(mesh(new THREE.CylinderGeometry(H * 0.12, H * 0.09, H * 0.5, 9), a.body, [0, -H * 0.25, 0]));
    legs.push(leg);
  }
  return { root, body, head, tail, legs, wings: [], neck };
}

function buildFlyer(species, a) {
  const { length: L, height: H } = species.size;
  const root = new THREE.Group();
  const body = pivot(root, [0, H, 0]);
  body.add(mesh(ellipsoid(0.22 * L, 0.7, 0.7, 1.6), a.body, [0, 0, 0]));
  const head = pivot(body, [0, 0.05, L * 0.3]);
  head.add(mesh(new THREE.SphereGeometry(0.12 * L, 8, 6), a.accent, [0, 0, 0.05]));
  const tail = pivot(body, [0, 0, -L * 0.3]);
  tail.add(mesh(new THREE.BoxGeometry(0.4 * L, 0.04, 0.35 * L), a.dark, [0, 0, -0.15 * L]));
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = pivot(body, [side * 0.1 * L, 0.05, 0]);
    wing.add(mesh(new THREE.BoxGeometry(0.9 * L, 0.03, 0.4 * L), a.accent, [side * 0.45 * L, 0, 0]));
    wings.push(wing);
  }
  return { root, body, head, tail, legs: [], wings, neck: null };
}

const BUILDERS = { quadruped: buildQuadruped, biped: buildBiped, sauropod: buildSauropod, flyer: buildFlyer, aquatic: buildQuadruped };

/** Creates a posed creature view. Call update(dt, creature) every frame. */
export function createCreatureView(species) {
  const assets = speciesAssets(species);
  const build = BUILDERS[species.archetype] ?? buildQuadruped;
  const parts = build(species, assets);
  const isFlyer = species.archetype === 'flyer';
  let phase = Math.random() * Math.PI * 2;
  let time = Math.random() * 10;
  const baseBodyY = parts.body.position.y;

  return {
    root: parts.root,
    update(dt, c) {
      time += dt;
      const stride = Math.min(1.4, c.speed / Math.max(1, species.speed.walk));
      phase += c.speed * dt * (species.size.length > 4 ? 1.1 : 2.4) / Math.max(0.5, species.size.length * 0.5);
      parts.root.position.set(c.x, c.y, c.z);
      parts.root.rotation.set(0, c.yaw, 0);

      const sleeping = c.asleep || c.state === 'sleep';
      const dead = !c.alive;
      const lift = sleeping ? -0.3 : 0;
      parts.body.position.y = baseBodyY + lift + Math.sin(time * 1.8) * 0.01 * (sleeping ? 0 : 1);
      parts.root.rotation.z = dead ? Math.min(1.5, c.deadTimer * 2) : 0;

      parts.legs.forEach((leg, i) => {
        const offset = i % 2 === 0 ? 0 : Math.PI;
        const crossOffset = i < 2 ? 0 : Math.PI;
        const swing = (Math.sin(phase + offset + crossOffset * 0.5) * 0.5 * stride) + (sleeping ? 1.2 : 0);
        leg.rotation.x = dead ? 0 : swing;
      });
      if (parts.arms) parts.arms.forEach((arm, i) => { arm.rotation.x = Math.sin(phase + i * Math.PI) * 0.4 * stride; });

      const grazing = c.state === 'graze' || c.state === 'drink';
      const attacking = c.state === 'attack';
      const headTarget = grazing ? 0.9 : attacking ? -0.5 : sleeping ? 0.5 : 0;
      parts.head.rotation.x += (headTarget - parts.head.rotation.x) * Math.min(1, dt * 6);
      if (parts.neck) {
        parts.neck.rotation.x += ((grazing ? -0.2 : -0.9) - parts.neck.rotation.x) * Math.min(1, dt * 3);
      }
      parts.tail.rotation.y = Math.sin(time * 2.1) * 0.25 * (1 + stride * 0.5);

      if (isFlyer) {
        const flap = c.speed > 0.5 ? Math.sin(time * 14) * 0.8 : Math.sin(time * 2) * 0.12;
        parts.wings.forEach((w, i) => { w.rotation.z = (i === 0 ? 1 : -1) * flap; });
      }
    }
  };
}
