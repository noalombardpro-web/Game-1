// Third and first person camera. Third person uses a spring arm that pulls in
// when the terrain would otherwise hide the robot.
import * as THREE from 'three';
import { clamp } from '../core/math.js';

const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera, settings) {
    this.camera = camera;
    this.settings = settings;
    this.mode = 'third';
    this.yaw = 0;
    this.pitch = -0.12;
    this.distance = 4.2;
    this.desired = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.initialised = false;
  }

  toggleMode() {
    this.mode = this.mode === 'third' ? 'first' : 'third';
  }

  /** Applies mouse look. `look` = { dx, dy } in pixels. */
  applyLook(look, active) {
    if (!active) return;
    const s = this.settings.sensitivity * 0.0006 * (this.lookScale ?? 1);
    const invert = this.settings.invertY ? -1 : 1;
    this.yaw -= look.dx * s;
    this.pitch = clamp(this.pitch - look.dy * s * invert, -1.2, 0.9);
  }

  /** Points the camera at a world position (used by scripted tests). */
  aimAt(x, y, z) {
    const from = this.camera.position;
    const dx = x - from.x;
    const dy = y - from.y;
    const dz = z - from.z;
    this.yaw = Math.atan2(dx, dz);
    this.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.2, 0.9);
  }

  forward() {
    return new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  /**
   * @param target { x, y, z, height, distance? } focus point of the robot or vehicle
   * @param heightAt terrain height function, used by the spring arm
   */
  update(dt, target, heightAt) {
    const cam = this.camera;
    const eyeHeight = target.height ?? 1.6;
    const distance = target.distance ?? this.distance;

    if (this.mode === 'first' && !target.forceThird) {
      const head = new THREE.Vector3(target.x, target.y + eyeHeight, target.z);
      const fwd = this.forward();
      cam.position.copy(head).addScaledVector(fwd, 0.12);
      cam.lookAt(head.clone().addScaledVector(fwd, 20));
      this.initialised = false;
      return;
    }

    this.pivot.set(target.x, target.y + eyeHeight, target.z);
    const fwd = this.forward();
    const offset = fwd.clone().multiplyScalar(-distance);
    offset.x += Math.cos(this.yaw) * 0.6;
    offset.z -= Math.sin(this.yaw) * 0.6;
    this.desired.copy(this.pivot).add(offset);

    // Spring arm: shorten the boom while the line of sight is below the ground.
    let usable = distance;
    for (let d = 0.5; d <= distance; d += 0.5) {
      const t = d / distance;
      const x = this.pivot.x + (this.desired.x - this.pivot.x) * t;
      const y = this.pivot.y + (this.desired.y - this.pivot.y) * t;
      const z = this.pivot.z + (this.desired.z - this.pivot.z) * t;
      if (y < heightAt(x, z) + 0.4) {
        usable = Math.max(0.6, d - 0.5);
        break;
      }
    }
    if (usable < distance) {
      this.desired.copy(this.pivot).addScaledVector(offset.normalize(), usable);
    }

    if (!this.initialised) {
      cam.position.copy(this.desired);
      this.initialised = true;
    } else {
      const k = 1 - Math.exp(-14 * dt);
      cam.position.lerp(this.desired, k);
    }
    cam.lookAt(this.pivot);
    cam.up.copy(UP);
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
}
