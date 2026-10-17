// Procedural articulated model of the exploration robot.
// Hierarchy: root (feet on the ground) > hips > torso/head/arms/legs with pivots,
// so that the animation code only has to rotate joints.
import * as THREE from 'three';

const HIP_HEIGHT = 0.9;

function part(geometry, material, { pos = [0, 0, 0], rot = [0, 0, 0], parent }) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function pivot(parent, pos) {
  const group = new THREE.Group();
  group.position.set(...pos);
  parent.add(group);
  return group;
}

export function createRobotModel() {
  const materials = {
    metal: new THREE.MeshStandardMaterial({ color: '#c9d1da', metalness: 0.85, roughness: 0.3 }),
    composite: new THREE.MeshStandardMaterial({ color: '#2b3038', metalness: 0.25, roughness: 0.62 }),
    worn: new THREE.MeshStandardMaterial({ color: '#8a7f6f', metalness: 0.6, roughness: 0.55 }),
    accent: new THREE.MeshStandardMaterial({ color: '#e0873a', metalness: 0.35, roughness: 0.42 }),
    visor: new THREE.MeshStandardMaterial({ color: '#0b1620', metalness: 0.9, roughness: 0.05 }),
    glow: new THREE.MeshStandardMaterial({ color: '#7fe9ff', emissive: '#2fd8ff', emissiveIntensity: 2.5 })
  };

  const root = new THREE.Group();
  root.name = 'robot';
  const hips = pivot(root, [0, HIP_HEIGHT, 0]);
  part(new THREE.BoxGeometry(0.34, 0.16, 0.22), materials.composite, { pos: [0, 0.02, 0], parent: hips });

  const torso = pivot(hips, [0, 0.12, 0]);
  part(new THREE.CapsuleGeometry(0.2, 0.36, 4, 10), materials.metal, { pos: [0, 0.3, 0], parent: torso });
  part(new THREE.BoxGeometry(0.3, 0.26, 0.08), materials.accent, { pos: [0, 0.32, 0.17], parent: torso });
  part(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12), materials.composite, { pos: [0, 0.03, 0], parent: torso });
  // Backpack with energy core.
  part(new THREE.BoxGeometry(0.3, 0.42, 0.14), materials.composite, { pos: [0, 0.32, -0.23], parent: torso });
  const core = part(new THREE.TorusGeometry(0.1, 0.02, 8, 24), materials.glow, { pos: [0, 0.34, -0.31], rot: [0, Math.PI / 2, 0], parent: torso });
  core.castShadow = false;

  const neck = pivot(torso, [0, 0.6, 0]);
  part(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8), materials.composite, { parent: neck });
  const head = pivot(neck, [0, 0.14, 0]);
  part(new THREE.SphereGeometry(0.19, 16, 12), materials.metal, { pos: [0, 0.04, 0], parent: head });
  part(new THREE.BoxGeometry(0.28, 0.1, 0.12), materials.visor, { pos: [0, 0.05, 0.13], parent: head });
  const sensorL = part(new THREE.SphereGeometry(0.03, 8, 6), materials.glow, { pos: [-0.07, 0.05, 0.19], parent: head });
  const sensorR = part(new THREE.SphereGeometry(0.03, 8, 6), materials.glow, { pos: [0.07, 0.05, 0.19], parent: head });
  sensorL.castShadow = sensorR.castShadow = false;
  part(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), materials.composite, { pos: [0.1, 0.26, -0.02], parent: head });
  const antenna = part(new THREE.SphereGeometry(0.025, 8, 6), materials.glow, { pos: [0.1, 0.37, -0.02], parent: head });
  antenna.castShadow = false;

  const arms = {};
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'L' : 'R';
    const shoulder = pivot(torso, [side * 0.29, 0.5, 0]);
    part(new THREE.SphereGeometry(0.09, 10, 8), materials.composite, { parent: shoulder });
    part(new THREE.CylinderGeometry(0.055, 0.05, 0.3, 8), materials.metal, { pos: [0, -0.15, 0], parent: shoulder });
    const elbow = pivot(shoulder, [0, -0.3, 0]);
    part(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 8), materials.worn, { pos: [0, -0.14, 0], parent: elbow });
    part(new THREE.BoxGeometry(0.1, 0.12, 0.09), materials.composite, { pos: [0, -0.33, 0], parent: elbow });
    arms[key] = { shoulder, elbow };
  }

  const legs = {};
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'L' : 'R';
    const hip = pivot(hips, [side * 0.13, -0.02, 0]);
    part(new THREE.CylinderGeometry(0.085, 0.07, 0.42, 10), materials.metal, { pos: [0, -0.21, 0], parent: hip });
    const knee = pivot(hip, [0, -0.42, 0]);
    part(new THREE.SphereGeometry(0.075, 10, 8), materials.composite, { parent: knee });
    part(new THREE.CylinderGeometry(0.065, 0.055, 0.4, 10), materials.worn, { pos: [0, -0.2, 0], parent: knee });
    const ankle = pivot(knee, [0, -0.4, 0]);
    part(new THREE.BoxGeometry(0.16, 0.07, 0.3), materials.composite, { pos: [0, -0.02, 0.05], parent: ankle });
    legs[key] = { hip, knee, ankle };
  }

  const lamp = new THREE.SpotLight('#fff1d6', 0, 40, Math.PI / 6, 0.4, 1.2);
  lamp.position.set(0, 0, 0.2);
  head.add(lamp);
  lamp.target.position.set(0, -0.2, 6);
  head.add(lamp.target);

  return {
    root, hips, torso, head, neck, arms, legs, lamp, glow: [sensorL, sensorR, antenna, core],
    phase: 0, time: 0, materials,
    /**
     * Animates the body. `s` = { speed (m/s), grounded, crouch (0..1), sprint (bool), dt, airVel }.
     * Returns the stride phase so the caller can trigger footsteps.
     */
    animate(s) {
      this.time += s.dt;
      const stride = Math.min(1, s.speed / 6);
      this.phase += s.speed * s.dt * 1.25;
      const swing = Math.sin(this.phase) * 0.55 * stride;
      const flex = (p) => Math.max(0, -Math.cos(p)) * 0.65 * stride;

      const crouch = s.crouch;
      hips.position.y = HIP_HEIGHT - crouch * 0.38 + (s.grounded ? 0 : Math.max(-0.1, s.airVel * 0.01));
      torso.rotation.x = Math.min(0.25, s.speed * 0.018) * (s.sprint ? 1 : 0.6) + crouch * 0.3;
      torso.position.y = 0.12 + Math.sin(this.time * 2.1) * 0.006;
      neck.rotation.x = -torso.rotation.x * 0.5;

      const legAngles = { L: this.phase, R: this.phase + Math.PI };
      for (const key of ['L', 'R']) {
        const { hip, knee } = legs[key];
        const p = legAngles[key];
        const air = s.grounded ? 0 : 1;
        hip.rotation.x = Math.sin(p) * 0.55 * stride - crouch * 1.0 - air * 0.5;
        knee.rotation.x = flex(p) + crouch * 1.3 + air * 0.6;
        legs[key].ankle.rotation.x = -hip.rotation.x * 0.3 - crouch * 0.4;
      }
      for (const key of ['L', 'R']) {
        const sign = key === 'L' ? 1 : -1;
        arms[key].shoulder.rotation.x = -swing * sign * 0.9 - crouch * 0.6 - (s.grounded ? 0 : 0.6);
        arms[key].shoulder.rotation.z = key === 'L' ? -0.08 : 0.08;
        arms[key].elbow.rotation.x = -0.45 - Math.max(0, swing * sign) * 0.4;
      }
      sensorL.material.emissiveIntensity = sensorR.material.emissiveIntensity = 2.2 + Math.sin(this.time * 3) * 0.3;
      return this.phase;
    },
    /** Sets the root position and yaw (model faces +Z at yaw 0). */
    place(x, y, z, yaw) {
      root.position.set(x, y, z);
      root.rotation.y = yaw;
    }
  };
}
