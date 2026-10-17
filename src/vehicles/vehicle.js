// Pilotable vehicles: ground (inertia, slope, suspension), air (altitude, bank, hover) and
// submarine (3D underwater movement). One class driven by the data sheets in data/vehicles.json.
import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { WATER_LEVEL } from '../world/terrain.js';
import { MODEL_BUILDERS } from './vehicleModels.js';

export class Vehicle {
  /**
   * @param id       unique vehicle id
   * @param typeId   key of data/vehicles.json
   * @param config   that data sheet
   * @param state    optional saved state { energy, hull, y }
   */
  constructor(id, typeId, config, scene, world, x, z, yaw = 0, state = {}) {
    this.id = id;
    this.typeId = typeId;
    this.cfg = config;
    this.kind = config.kind;
    this.name = config.name;
    this.scene = scene;
    this.world = world;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    const ground = world.heightAt(x, z);
    this.y = state.y ?? (this.kind === 'sub' ? Math.max(ground + 1.3, WATER_LEVEL - 0.9) : ground);
    this.speed = 0;
    this.vy = 0;
    this.pitch = 0;
    this.roll = 0;
    this.energy = state.energy ?? config.energy;
    this.hull = state.hull ?? config.hull;
    this.seated = false;
    this.landed = this.kind === 'ground';
    this.throttle = 0;
    this.lastImpact = 0;
    this.spin = 0;
    this.visual = MODEL_BUILDERS[typeId]();
    scene.add(this.visual.root);
    this.place();
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }

  get disabled() {
    return this.hull <= 0;
  }

  get altitude() {
    return Math.max(0, this.y - this.world.heightAt(this.x, this.z));
  }

  get depth() {
    return Math.max(0, WATER_LEVEL - this.y);
  }

  get lightsOn() {
    return this.visual.beam.intensity > 0;
  }

  setLights(on) {
    this.visual.beam.intensity = on ? 80 : 0;
    this.visual.lamp.emissiveIntensity = on ? 3 : 1;
  }

  /** Engine load 0..1 for the audio engine. */
  get engineLoad() {
    const c = this.cfg;
    return clamp(Math.abs(this.speed) / c.maxSpeed + (this.throttle !== 0 ? 0.25 : 0.05), 0, 1);
  }

  wheelHeight(forward, side) {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    return this.world.heightAt(this.x + fx * forward + -fz * side, this.z + fz * forward + fx * side);
  }

  /** Orients the model on the terrain (ground), or banks it (air and submarine). */
  place() {
    const r = this.visual.root;
    if (this.kind === 'ground') {
      const { wheelBase: base, track } = this.cfg;
      const front = (this.wheelHeight(base / 2, 0) + this.wheelHeight(base / 2 - 0.1, 0)) / 2;
      const back = this.wheelHeight(-base / 2, 0);
      const left = this.wheelHeight(0, -track / 2);
      const right = this.wheelHeight(0, track / 2);
      const centre = this.world.heightAt(this.x, this.z);
      const targetY = Math.max(centre, (front + back + left + right) / 4) + 0.1;
      this.y += (targetY - this.y) * 0.5;
      this.pitch = Math.atan2(front - back, base);
      this.roll = Math.atan2(right - left, track);
      r.position.set(this.x, this.y, this.z);
      r.rotation.set(-this.pitch, this.yaw, -this.roll, 'YXZ');
    } else {
      r.position.set(this.x, this.y, this.z);
      r.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    }
    if (this.visual.rotors) {
      this.spin += (this.seated || !this.landed ? 40 : 0) * 0.016;
      for (const rotor of this.visual.rotors) rotor.rotation.y = this.spin;
    }
  }

  /**
   * @param dt     seconds
   * @param input  Input while someone is driving, null otherwise
   * @param env    { windX, windZ, windStrength, storm }
   */
  update(dt, input, env = {}) {
    this.seated = !!input;
    if (this.kind === 'ground') this.updateGround(dt, input);
    else if (this.kind === 'air') this.updateAir(dt, input, env);
    else this.updateSub(dt, input);
    this.place();
    if (this.disabled) this.speed *= Math.pow(0.1, dt);
  }

  controls(input) {
    if (!input || this.disabled || this.energy <= 0) return { thrust: 0, turn: 0, up: 0, boost: false };
    return {
      thrust: (input.isDown('move_forward') ? 1 : 0) - (input.isDown('move_back') ? 1 : 0),
      turn: (input.isDown('move_left') ? 1 : 0) - (input.isDown('move_right') ? 1 : 0),
      up: (input.isDown('jump') ? 1 : 0) - (input.isDown('crouch') ? 1 : 0),
      boost: input.isDown('sprint') && this.energy > 5
    };
  }

  damage(amount) {
    this.hull = Math.max(0, this.hull - amount * this.cfg.damageFactor);
    this.lastImpact = amount;
  }

  updateGround(dt, input) {
    const c = this.cfg;
    const { thrust, turn, boost } = this.controls(input);
    this.throttle = thrust;
    const slope = (this.wheelHeight(2, 0) - this.wheelHeight(-2, 0)) / 4;
    const onWater = this.world.heightAt(this.x, this.z) < WATER_LEVEL - 0.5;

    let accel = 0;
    if (thrust !== 0) {
      const power = thrust > 0 ? c.power * (boost ? c.boost : 1) : c.power * 0.65;
      accel = this.speed * thrust < 0 ? thrust * c.brake : thrust * power;
      this.energy = Math.max(0, this.energy - (boost ? c.boostUse : c.energyUse) * Math.abs(thrust) * dt);
    }
    accel -= slope * 9.8;
    accel -= this.speed * 0.25 + this.speed * Math.abs(this.speed) * (0.24 / c.maxSpeed);
    accel -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 0.4);
    this.speed = clamp(this.speed + accel * dt, -c.reverse, onWater ? c.waterSpeed : c.maxSpeed);
    if (Math.abs(this.speed) < 0.02 && thrust === 0) this.speed = 0;

    this.yaw += turn * c.steer * Math.min(1, Math.abs(this.speed) / 5 + 0.2) * dt * (this.speed < 0 ? -1 : 1);
    this.stepAndCollide(dt);
  }

  /** Moves along the heading and pushes out of obstacles; hard hits damage the hull. */
  stepAndCollide(dt) {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const nx = this.x + fx * this.speed * dt;
    const nz = this.z + fz * this.speed * dt;
    this.x = nx;
    this.z = nz;
    this.world.resolveCollisions(this, this.cfg.radius);
    const pushed = Math.hypot(this.x - nx, this.z - nz);
    if (pushed > 0.05 && Math.abs(this.speed) > 4) {
      this.damage(Math.abs(this.speed) * 1.2);
      this.speed *= 0.3;
    }
  }

  updateAir(dt, input, env) {
    const c = this.cfg;
    const { thrust, turn, up, boost } = this.controls(input);
    this.throttle = thrust;
    const target = thrust * c.maxSpeed * (boost ? c.boost : 1) * (thrust < 0 ? 0.4 : 1);
    this.speed += clamp(target - this.speed, -c.accel * dt, c.accel * dt);
    this.yaw += turn * c.turn * dt * (this.kind === 'air' && c.bank ? 0.4 + Math.min(1, Math.abs(this.speed) / 20) * 0.6 : 1);

    const gy = this.world.heightAt(this.x, this.z);
    const dead = this.energy <= 0 || this.disabled;
    const vyTarget = dead ? -10 : up * c.vertical;
    this.vy += (vyTarget - this.vy) * Math.min(1, (dead ? 0.8 : 3) * dt);

    // Turbulence: wind gusts push the aircraft and storms shake it.
    const gust = (env.windStrength ?? 0) * (this.typeId === 'drone' ? 1.6 : 0.8);
    let windX = (env.windX ?? 0) * gust * 0.5;
    let windZ = (env.windZ ?? 0) * gust * 0.5;
    if (env.storm && this.altitude > 3) {
      windX += Math.sin(performance.now() * 0.003) * 4;
      this.roll += Math.sin(performance.now() * 0.007) * 0.01;
    }
    this.x += Math.sin(this.yaw) * this.speed * dt + windX * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt + windZ * dt;
    if (this.y - gy < 16) {
      const px = this.x;
      const pz = this.z;
      this.world.resolveCollisions(this, c.radius);
      if (Math.hypot(this.x - px, this.z - pz) > 0.05 && Math.abs(this.speed) > 5) {
        this.damage(Math.abs(this.speed) * 0.9);
        this.speed *= 0.4;
      }
    }
    this.y += this.vy * dt;
    const floor = this.world.heightAt(this.x, this.z) + 0.5;
    if (this.y <= floor) {
      if (this.vy < -9) this.damage((-this.vy - 9) * 7);
      this.y = floor;
      this.vy = Math.max(0, this.vy);
      this.landed = true;
      this.speed *= Math.pow(0.15, dt);
    } else {
      this.landed = false;
    }
    this.y = Math.min(this.y, this.world.heightAt(this.x, this.z) + c.maxAltitude);

    if (input && !this.disabled) {
      const use = 0.25 + (this.landed ? 0 : c.hoverUse) + Math.abs(thrust) * c.energyUse * 0.4 + Math.abs(up) * c.energyUse * 0.3;
      this.energy = Math.max(0, this.energy - use * (boost ? 1.8 : 1) * dt);
    }
    const bank = c.bank ?? 0.5;
    this.roll += (-turn * bank * (0.3 + Math.abs(this.speed) / c.maxSpeed) - this.roll) * Math.min(1, 3 * dt);
    this.pitch += ((thrust > 0 ? 1 : thrust < 0 ? -1 : 0) * 0.2 * (this.speed / c.maxSpeed) - this.pitch) * Math.min(1, 3 * dt);
  }

  updateSub(dt, input) {
    const c = this.cfg;
    const { thrust, turn, up, boost } = this.controls(input);
    this.throttle = thrust;
    const target = thrust * c.maxSpeed * (boost ? c.boost : 1) * (thrust < 0 ? 0.4 : 1);
    this.speed += clamp(target - this.speed, -c.accel * dt, c.accel * dt);
    this.yaw += turn * c.turn * dt;

    const nx = this.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = this.z + Math.cos(this.yaw) * this.speed * dt;
    if (this.world.heightAt(nx, nz) < WATER_LEVEL - 2.5) {
      this.x = nx;
      this.z = nz;
    } else {
      if (Math.abs(this.speed) > 3) this.damage(Math.abs(this.speed) * 0.5);
      this.speed *= 0.2;
    }
    this.world.resolveCollisions(this, c.radius);

    const surface = WATER_LEVEL - 0.9;
    // Unoccupied or without power the submarine floats up.
    const vyTarget = !input || this.energy <= 0 ? 0.8 : up * c.vertical;
    this.vy += (vyTarget - this.vy) * Math.min(1, 3 * dt);
    const floor = this.world.heightAt(this.x, this.z) + 1.3;
    this.y = clamp(this.y + this.vy * dt, floor, Math.max(floor, surface));
    if (this.depth > c.depthLimit) this.damage((this.depth - c.depthLimit) * dt);
    if (input && !this.disabled) {
      const use = 0.2 + Math.abs(thrust) * c.energyUse + (Math.abs(up) > 0 ? c.hoverUse : 0);
      this.energy = Math.max(0, this.energy - use * (boost ? 1.8 : 1) * dt);
    }
    this.roll += (-turn * 0.25 - this.roll) * Math.min(1, 3 * dt);
    this.pitch += (-up * 0.25 - this.pitch) * Math.min(1, 3 * dt);
  }

  /** Whether the pilot may leave now, with the reason when not. */
  canExit() {
    if (this.kind === 'air' && this.altitude > 2.5) return { ok: false, reason: 'Atterrissez avant de descendre.' };
    if (this.kind === 'sub' && this.depth > 1.8) return { ok: false, reason: 'Remontez en surface avant de sortir.' };
    return { ok: true };
  }

  recharge(amount) {
    const before = this.energy;
    this.energy = Math.min(this.cfg.energy, this.energy + amount);
    return this.energy - before;
  }

  repair(amount) {
    const before = this.hull;
    this.hull = Math.min(this.cfg.hull, this.hull + amount);
    return this.hull - before;
  }

  dismountPosition() {
    const side = this.yaw + Math.PI / 2;
    const d = this.cfg.radius + 0.9;
    return { x: this.x + Math.sin(side) * d, z: this.z + Math.cos(side) * d };
  }

  toJSON() {
    return { type: this.typeId, x: this.x, z: this.z, y: this.y, yaw: this.yaw, energy: this.energy, hull: this.hull };
  }

  dispose() {
    this.scene.remove(this.visual.root);
    this.visual.root.traverse((o) => { o.geometry?.dispose(); });
  }
}

export class VehicleManager {
  constructor(scene, world, vehicleData) {
    this.scene = scene;
    this.world = world;
    this.data = vehicleData;
    this.list = [];
    this.nextId = 1;
  }

  add(typeId, x, z, yaw = 0, state = {}) {
    const cfg = this.data[typeId];
    if (!cfg) throw new Error(`Unknown vehicle ${typeId}`);
    const v = new Vehicle(`v${this.nextId++}`, typeId, cfg, this.scene, this.world, x, z, yaw, state);
    this.list.push(v);
    return v;
  }

  nearest(x, z, maxDist = 5) {
    let best = null;
    let bestDist = maxDist;
    for (const v of this.list) {
      const d = Math.hypot(v.x - x, v.z - z) - v.cfg.radius * 0.5;
      if (d < bestDist) { best = v; bestDist = d; }
    }
    return best;
  }

  update(dt, input, mounted, env) {
    for (const v of this.list) v.update(dt, v === mounted ? input : null, env);
  }

  toJSON() {
    return this.list.map((v) => v.toJSON());
  }

  restore(entries) {
    for (const e of entries ?? []) {
      if (this.data[e.type]) this.add(e.type, e.x, e.z, e.yaw ?? 0, { energy: e.energy, hull: e.hull, y: e.y });
    }
  }

  dispose() {
    for (const v of this.list) v.dispose();
    this.list = [];
  }
}
