// Procedural creature bodies. Four archetypes (quadruped, biped, sauropod, flyer) are
// scaled from the species data sheet. Geometry and materials are shared per species.
import * as THREE from 'three';
import { getModel } from './modelLibrary.js';

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

function buildFish(species, a) {
  const { length: L, height: H } = species.size;
  const root = new THREE.Group();
  const body = pivot(root, [0, 0, 0]);
  const flat = species.id === 'manta';
  body.add(mesh(ellipsoid(H * 0.5, flat ? 3.2 : 0.8, flat ? 0.4 : 1, (L / H) * (flat ? 0.6 : 1)), a.body, [0, 0, 0]));
  const head = pivot(body, [0, 0, L * 0.4]);
  head.add(mesh(new THREE.SphereGeometry(H * 0.06, 6, 5), a.eye, [H * 0.22, H * 0.1, 0]));
  head.add(mesh(new THREE.SphereGeometry(H * 0.06, 6, 5), a.eye, [-H * 0.22, H * 0.1, 0]));
  const tail = pivot(body, [0, 0, -L * 0.45]);
  tail.add(mesh(new THREE.ConeGeometry(H * (flat ? 0.15 : 0.45), L * (flat ? 0.9 : 0.3), 4), a.accent, [0, 0, -L * (flat ? 0.4 : 0.12)], [-Math.PI / 2, 0, 0]));
  if (!flat) body.add(mesh(new THREE.ConeGeometry(H * 0.25, H * 0.7, 3), a.accent, [0, H * 0.55, -L * 0.05]));
  if (species.id === 'angler') {
    const lure = pivot(body, [0, H * 0.6, L * 0.35]);
    lure.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, H * 0.9, 4), a.dark, [0, H * 0.4, H * 0.3], [0.8, 0, 0]));
    lure.add(mesh(new THREE.SphereGeometry(H * 0.12, 8, 6), a.accent, [0, H * 0.75, H * 0.7]));
    body.add(mesh(new THREE.ConeGeometry(H * 0.5, H * 0.4, 6), a.dark, [0, -H * 0.1, L * 0.45], [Math.PI / 2, 0, 0]));
  }
  return { root, body, head, tail, legs: [], wings: [], neck: null, swim: true, flat };
}

function buildSwarm(species, a) {
  const root = new THREE.Group();
  const body = pivot(root, [0, 0, 0]);
  const geo = new THREE.SphereGeometry(0.05, 5, 4);
  const inst = new THREE.InstancedMesh(geo, a.accent, 18);
  body.add(inst);
  const phases = Array.from({ length: 18 }, (_, i) => ({ f: 0.8 + (i % 5) * 0.35, p: i * 1.7, r: 0.35 + (i % 4) * 0.22 }));
  const dummy = new THREE.Object3D();
  return {
    root, body, head: pivot(root, [0, 0, 0]), tail: pivot(root, [0, 0, 0]), legs: [], wings: [], neck: null,
    tick(time) {
      phases.forEach((q, i) => {
        dummy.position.set(Math.sin(time * q.f + q.p) * q.r, 0.2 + Math.sin(time * q.f * 1.3 + q.p) * 0.35, Math.cos(time * q.f * 0.9 + q.p) * q.r);
        dummy.scale.setScalar(0.8 + 0.5 * Math.sin(time * 4 + q.p));
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
    },
    dispose() { inst.dispose(); }
  };
}

function buildFloater(species, a) {
  const { height: H } = species.size;
  const root = new THREE.Group();
  const body = pivot(root, [0, H * 0.7, 0]);
  const dome = mesh(new THREE.SphereGeometry(H * 0.45, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), a.accent, [0, 0, 0]);
  dome.material = dome.material.clone();
  dome.material.transparent = true;
  dome.material.opacity = 0.75;
  body.add(dome);
  body.add(mesh(new THREE.SphereGeometry(H * 0.14, 8, 6), a.body, [0, H * 0.05, 0]));
  const tentacles = [];
  for (let i = 0; i < 6; i++) {
    const t = pivot(body, [Math.cos(i * 1.05) * H * 0.3, 0, Math.sin(i * 1.05) * H * 0.3]);
    t.add(mesh(new THREE.CylinderGeometry(0.015, 0.03, H * 1.1, 4), a.accent, [0, -H * 0.55, 0]));
    tentacles.push(t);
  }
  const light = new THREE.PointLight(species.colors.accent, 0.8, 7, 2);
  body.add(light);
  return {
    root, body, head: pivot(root, [0, 0, 0]), tail: pivot(root, [0, 0, 0]), legs: [], wings: [], neck: null,
    tick(time) {
      dome.scale.y = 1 + Math.sin(time * 2.2) * 0.18;
      tentacles.forEach((t, i) => { t.rotation.x = Math.sin(time * 1.5 + i) * 0.35; t.rotation.z = Math.cos(time * 1.2 + i) * 0.35; });
      light.intensity = 0.7 + Math.sin(time * 2.2) * 0.3;
    },
    dispose() { light.dispose?.(); }
  };
}

function buildCrawler(species, a) {
  const { length: L, height: H } = species.size;
  const root = new THREE.Group();
  const body = pivot(root, [0, H * 0.5, 0]);
  body.add(mesh(ellipsoid(H * 0.4, 1, 0.7, (L / H) * 0.9), a.body, [0, 0, 0]));
  for (let i = 0; i < 6; i++) {
    body.add(mesh(new THREE.ConeGeometry(H * 0.09, H * 0.7, 5), a.accent, [((i % 2) - 0.5) * H * 0.5, H * 0.35, (i / 5 - 0.5) * L * 0.6], [0.2 * ((i % 2) - 0.5), 0, 0.3 * ((i % 2) - 0.5)]));
  }
  const head = pivot(body, [0, 0, L * 0.45]);
  head.add(mesh(ellipsoid(H * 0.22, 1, 0.8, 1.1), a.body, [0, 0, 0]));
  head.add(mesh(new THREE.SphereGeometry(H * 0.05, 6, 5), a.accent, [H * 0.1, H * 0.08, H * 0.2]));
  head.add(mesh(new THREE.SphereGeometry(H * 0.05, 6, 5), a.accent, [-H * 0.1, H * 0.08, H * 0.2]));
  const tail = pivot(body, [0, 0, -L * 0.45]);
  tail.add(mesh(new THREE.ConeGeometry(H * 0.12, L * 0.3, 5), a.body, [0, 0, -L * 0.12], [-Math.PI / 2, 0, 0]));
  const legs = [];
  for (const z of [-0.3, 0, 0.3]) {
    for (const x of [-1, 1]) {
      const leg = pivot(root, [x * H * 0.35, H * 0.45, z * L]);
      leg.rotation.z = x * 0.6;
      leg.add(mesh(new THREE.CylinderGeometry(H * 0.05, H * 0.035, H * 0.7, 5), a.dark, [x * H * 0.15, -H * 0.3, 0], [0, 0, x * 0.4]));
      legs.push(leg);
    }
  }
  return { root, body, head, tail, legs, wings: [], neck: null };
}

function buildStilt(species, a) {
  const { length: L, height: H } = species.size;
  const root = new THREE.Group();
  const body = pivot(root, [0, H * 0.78, 0]);
  body.add(mesh(ellipsoid(H * 0.15, 1, 0.9, 1.9 * L / H), a.body, [0, 0, 0]));
  for (let i = 0; i < 4; i++) body.add(mesh(new THREE.SphereGeometry(H * 0.03, 6, 5), a.accent, [0, H * 0.13, -L * 0.15 + i * L * 0.12]));
  const neck = pivot(body, [0, H * 0.05, L * 0.3]);
  neck.rotation.x = -0.7;
  neck.add(mesh(new THREE.CylinderGeometry(H * 0.03, H * 0.045, H * 0.35, 6), a.body, [0, H * 0.17, 0]));
  const head = pivot(neck, [0, H * 0.36, 0]);
  head.rotation.x = 0.7;
  head.add(mesh(ellipsoid(H * 0.05, 1, 0.9, 1.7), a.body, [0, 0, H * 0.04]));
  head.add(mesh(new THREE.SphereGeometry(H * 0.022, 6, 5), a.accent, [H * 0.035, H * 0.02, H * 0.08]));
  head.add(mesh(new THREE.SphereGeometry(H * 0.022, 6, 5), a.accent, [-H * 0.035, H * 0.02, H * 0.08]));
  const tail = pivot(body, [0, 0, -L * 0.3]);
  tail.add(mesh(new THREE.ConeGeometry(H * 0.03, L * 0.5, 5), a.body, [0, 0, -L * 0.22], [-Math.PI / 2, 0, 0]));
  const legs = [];
  for (const [x, z] of [[-0.18, 0.12], [0.18, 0.12], [-0.18, -0.12], [0.18, -0.12]]) {
    const leg = pivot(root, [x * H, H * 0.78, z * L]);
    leg.add(mesh(new THREE.CylinderGeometry(H * 0.014, H * 0.022, H * 0.8, 5), a.dark, [0, -H * 0.4, 0]));
    legs.push(leg);
  }
  return { root, body, head, tail, legs, wings: [], neck, gait: 0.35 };
}

const BUILDERS = {
  quadruped: buildQuadruped, biped: buildBiped, sauropod: buildSauropod, flyer: buildFlyer, aquatic: buildQuadruped,
  fish: buildFish, swarm: buildSwarm, floater: buildFloater, crawler: buildCrawler, stilt: buildStilt
};

/** Creates a posed creature view. Call update(dt, creature) every frame. */
export function createCreatureView(species, traits = { size: 1 }) {
  const assets = speciesAssets(species);
  const build = BUILDERS[species.archetype] ?? buildQuadruped;
  const parts = build(species, assets);
  const isFlyer = species.archetype === 'flyer';
  parts.root.scale.setScalar(traits.size ?? 1);
  let phase = Math.random() * Math.PI * 2;
  let time = Math.random() * 10;
  const baseBodyY = parts.body.position.y;

  return {
    root: parts.root,
    dispose: parts.dispose,
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

      const gait = parts.gait ?? 0.5;
      parts.legs.forEach((leg, i) => {
        const offset = i % 2 === 0 ? 0 : Math.PI;
        const crossOffset = i < 2 ? 0 : Math.PI;
        const swing = (Math.sin(phase + offset + crossOffset * 0.5) * gait * stride) + (sleeping ? 1.2 : 0);
        leg.rotation.x = dead ? 0 : swing;
      });
      if (parts.tick) parts.tick(time);
      if (parts.swim) {
        parts.tail.rotation.y = Math.sin(time * (3 + c.speed * 1.5)) * 0.5;
        parts.body.rotation.z = Math.sin(time * 1.3) * 0.05;
        if (dead) parts.root.rotation.z = Math.PI;
      }
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

const modelBox = new THREE.Box3();
const modelSize = new THREE.Vector3();

/**
 * View built from an animated glTF (species.model: horse, flamingo, parrot, stork, fish).
 * Returns null while the file is not loaded, so the caller falls back to the procedural view.
 */
export function createModelView(species, traits = { size: 1 }) {
  if (!species.model) return null;
  const gltf = getModel(species.model);
  if (!gltf) return null;
  const root = new THREE.Group();
  const inner = gltf.scene.clone(true);
  inner.updateMatrixWorld(true);
  modelBox.setFromObject(inner);
  modelBox.getSize(modelSize);
  const scale = (species.size.length * (traits.size ?? 1)) / Math.max(modelSize.x, modelSize.z, 1e-3);
  inner.scale.setScalar(scale);
  const swimmer = species.archetype === 'fish';
  inner.position.y = swimmer ? -((modelBox.min.y + modelBox.max.y) / 2) * scale : -modelBox.min.y * scale;
  const yawFix = new THREE.Group();
  yawFix.rotation.y = species.modelYaw ?? 0;
  yawFix.add(inner);
  root.add(yawFix);
  inner.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const mixer = gltf.animations.length ? new THREE.AnimationMixer(inner) : null;
  const action = mixer ? mixer.clipAction(gltf.animations[0]) : null;
  action?.play();
  if (action) action.time = Math.random() * action.getClip().duration;
  let time = Math.random() * 10;
  return {
    root,
    dispose() { mixer?.stopAllAction(); },
    update(dt, c) {
      time += dt;
      root.position.set(c.x, c.y, c.z);
      root.rotation.set(0, c.yaw, c.alive ? 0 : Math.min(1.5, c.deadTimer * 2));
      if (swimmer) yawFix.rotation.y = (species.modelYaw ?? 0) + Math.sin(time * (4 + c.speed * 2)) * 0.18;
      if (!mixer) return;
      const flyer = species.archetype === 'flyer';
      const asleep = c.asleep || c.state === 'sleep' || !c.alive;
      const rate = flyer ? (c.speed > 0.5 ? 1 : 0.35) : Math.min(2.2, c.speed / Math.max(1, species.speed.walk * 2.5));
      action.timeScale = asleep ? 0 : rate;
      mixer.update(dt);
    }
  };
}
