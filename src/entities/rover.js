// Exploration rover: arcade-style vehicle with inertia, throttle/brake, slope effects,
// terrain-following suspension, collisions with trees and rocks, energy and hull damage.
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { WATER_LEVEL } from '../world/terrain.js';

const WHEEL_BASE = 2.6;
const TRACK = 1.9;
const MAX_FORWARD = 24;
const MAX_REVERSE = 6;

function buildRoverModel() {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: '#e8eef2', metalness: 0.4, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: '#e0873a', metalness: 0.3, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#23272e', metalness: 0.2, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: '#16303f', metalness: 0.9, roughness: 0.05 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#fff1c0', emissiveIntensity: 2 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(TRACK + 0.6, 0.5, WHEEL_BASE + 1.4), paint);
  chassis.position.y = 0.55;
  chassis.castShadow = true;
  root.add(chassis);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(TRACK + 0.2, 0.9, 1.6), glass);
  cabin.position.set(0, 1.2, -0.2);
  cabin.castShadow = true;
  root.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(TRACK + 0.4, 0.12, 1.9), accent);
  roof.position.set(0, 1.72, -0.2);
  roof.castShadow = true;
  root.add(roof);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(TRACK + 1.4, 0.05, 1.8), new THREE.MeshStandardMaterial({ color: '#1b3557', metalness: 0.6, roughness: 0.3 }));
  panel.position.set(0, 2.05, -0.2);
  panel.rotation.x = -0.15;
  root.add(panel);
  for (const x of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), dark);
    bar.position.set(x * (TRACK / 2 + 0.2), 1.6, -0.2);
    root.add(bar);
    for (const z of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 14), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x * (TRACK / 2 + 0.2), 0.62, z * WHEEL_BASE / 2);
      wheel.castShadow = true;
      root.add(wheel);
    }
  }
  for (const x of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lamp);
    head.position.set(x, 0.7, WHEEL_BASE / 2 + 0.7);
    root.add(head);
  }
  const beam = new THREE.SpotLight('#fff1c0', 0, 60, Math.PI / 5, 0.5, 1.4);
  beam.position.set(0, 0.8, WHEEL_BASE / 2 + 0.6);
  beam.target.position.set(0, -1, 14);
  root.add(beam);
  root.add(beam.target);
  return { root, beam, lamp };
}

export class Rover {
  constructor(scene, world, x, z) {
    this.scene = scene;
    this.world = world;
    this.x = x;
    this.z = z;
    this.y = world.heightAt(x, z);
    this.yaw = 0;
    this.speed = 0;
    this.pitch = 0;
    this.roll = 0;
    this.energy = 100;
    this.hull = 100;
    this.seated = false;
    this.throttle = 0;
    this.lastImpact = 0;
    this.visual = buildRoverModel();
    scene.add(this.visual.root);
    this.place();
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }

  get headlightsOn() {
    return this.visual.beam.intensity > 0;
  }

  setLights(on) {
    this.visual.beam.intensity = on ? 80 : 0;
    this.visual.lamp.emissiveIntensity = on ? 3 : 1;
  }

  /** Terrain height under a wheel offset from the rover centre, in the rover's frame. */
  wheelHeight(forward, side) {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -fz;
    const rz = fx;
    return this.world.heightAt(this.x + fx * forward + rx * side, this.z + fz * forward + rz * side);
  }

  place() {
    const front = (this.wheelHeight(WHEEL_BASE / 2, 0) + this.wheelHeight(WHEEL_BASE / 2 - 0.1, 0)) / 2;
    const back = this.wheelHeight(-WHEEL_BASE / 2, 0);
    const left = this.wheelHeight(0, -TRACK / 2);
    const right = this.wheelHeight(0, TRACK / 2);
    const centre = this.world.heightAt(this.x, this.z);
    const targetY = Math.max(centre, (front + back + left + right) / 4) + 0.1;
    this.y += (targetY - this.y) * 0.5;
    this.pitch = Math.atan2(front - back, WHEEL_BASE);
    this.roll = Math.atan2(right - left, TRACK);
    const r = this.visual.root;
    r.position.set(this.x, this.y, this.z);
    r.rotation.set(-this.pitch, this.yaw, -this.roll, 'YXZ');
  }

  /**
   * @param dt     seconds
   * @param input  Input (throttle, steering, boost)
   */
  update(dt, input) {
    const boost = this.seated && input.isDown('sprint') && this.energy > 5;
    let throttle = 0;
    let turn = 0;
    if (this.seated) {
      throttle = (input.isDown('move_forward') ? 1 : 0) - (input.isDown('move_back') ? 1 : 0);
      turn = (input.isDown('move_left') ? 1 : 0) - (input.isDown('move_right') ? 1 : 0);
    }
    this.throttle = throttle;
    const slope = (this.wheelHeight(2, 0) - this.wheelHeight(-2, 0)) / 4;
    const onWater = this.world.heightAt(this.x, this.z) < WATER_LEVEL - 0.5;

    let accel = 0;
    if (throttle !== 0 && this.energy > 0) {
      const power = throttle > 0 ? 7.5 * (boost ? 1.6 : 1) : 5;
      if (this.speed * throttle < 0) accel = throttle * 14;
      else accel = throttle * power;
      this.energy = Math.max(0, this.energy - (boost ? 1.4 : 0.5) * Math.abs(throttle) * dt);
    }
    accel -= slope * 9.8;
    accel -= this.speed * 0.25 + this.speed * Math.abs(this.speed) * 0.01;
    accel -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 0.4);
    this.speed = clamp(this.speed + accel * dt, -MAX_REVERSE, onWater ? 4 : MAX_FORWARD);
    if (Math.abs(this.speed) < 0.02 && throttle === 0) this.speed = 0;

    const steerRate = 1.5 * Math.min(1, Math.abs(this.speed) / 5 + 0.2);
    this.yaw += turn * steerRate * dt * (this.speed < 0 ? -1 : 1);

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const prevX = this.x;
    const prevZ = this.z;
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;
    this.world.resolveCollisions(this, 2.0);
    const pushed = Math.hypot(this.x - (prevX + fx * this.speed * dt), this.z - (prevZ + fz * this.speed * dt));
    if (pushed > 0.05 && Math.abs(this.speed) > 4) {
      this.hull = Math.max(0, this.hull - Math.abs(this.speed) * 1.2);
      this.lastImpact = Math.abs(this.speed);
      this.speed *= 0.3;
    }
    this.place();
    this.setLights(this.headlightsOn);
  }

  /** Uses a battery item while seated. Returns the energy restored. */
  recharge(amount) {
    const before = this.energy;
    this.energy = Math.min(100, this.energy + amount);
    return this.energy - before;
  }

  repair(amount) {
    const before = this.hull;
    this.hull = Math.min(100, this.hull + amount);
    return this.hull - before;
  }

  /** Seat position: the robot is hidden and its controls are routed here. */
  dismountPosition() {
    const side = this.yaw + Math.PI / 2;
    return { x: this.x + Math.sin(side) * 2.4, z: this.z + Math.cos(side) * 2.4 };
  }

  /** Engine tone input for audio: 0..1. */
  get engineLoad() {
    return clamp(Math.abs(this.speed) / MAX_FORWARD + (this.throttle !== 0 ? 0.2 : 0), 0, 1);
  }
}
