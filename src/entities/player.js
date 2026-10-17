// Robot player controller: ground-following movement on the procedural terrain,
// jumping with gravity, fall damage, shallow swimming, collisions and animation.
import * as THREE from 'three';
import { createRobotModel } from './robotModel.js';
import { WATER_LEVEL } from '../world/terrain.js';
import { clamp, wrapAngle } from '../core/math.js';

const GRAVITY = 18;
const JUMP_SPEED = 6.4;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 8.4;
const CREW_SPEED = 2.2;
const PLAYER_RADIUS = 0.42;
const SAFE_FALL = 6;
const SWIM_SPEED = 3.2;
const BASE_DIVE_LIMIT = 18;

export class Player {
  /**
   * @param scene  three.js scene
   * @param world  streaming world (heightAt, resolveCollisions, collidersNear)
   * @param robot  RobotState
   */
  constructor(scene, world, robot) {
    this.world = world;
    this.robot = robot;
    this.model = createRobotModel();
    scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.grounded = true;
    this.swimming = false;
    this.crouched = false;
    this.sprinting = false;
    this.speed = 0;
    this.noise = 0;
    this.surface = 'grass';
    this.airPeak = 0;
    this.stepPhaseLast = 0;
    this.events = [];
    this.lampOn = false;
    this.biomeTimer = 0;
    this.modifiers = { sprintBonus: 0, damageReduction: 0, diveDepth: 0, swimBonus: 0 };
    this.depthBelowSurface = 0;
    this.diveLimit = BASE_DIVE_LIMIT;
    this.landTimer = 0;
    this.landStrength = 0;
    this.actionState = null;
    this.pressureTimer = 0;
  }

  get groundY() {
    return this.world.heightAt(this.pos.x, this.pos.z);
  }

  /** Drops a spawn point onto the ground. */
  spawnAt(x, z) {
    this.pos.set(x, 0, z);
    this.pos.y = this.world.heightAt(x, z) + 0.05;
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.model.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
  }

  /**
   * Advances movement by one simulation substep.
   * @param input   Input instance
   * @param camYaw  yaw of the camera; movement is relative to it
   * @param biomeAt (x, z) => biome id, sampled every half second for footstep sounds
   */
  update(dt, input, camYaw, biomeAt) {
    if (input.pressed('crouch') && !this.swimming) this.crouched = !this.crouched;
    if (input.pressed('lamp')) this.lampOn = !this.lampOn;
    this.model.lamp.intensity = this.lampOn ? 60 : 0;

    const axis = input.moveAxis();
    const len = Math.hypot(axis.x, axis.z) || 1;
    const mx = axis.x / len;
    const mz = axis.z / len;
    const dirX = Math.sin(camYaw) * mz - Math.cos(camYaw) * mx;
    const dirZ = Math.cos(camYaw) * mz + Math.sin(camYaw) * mx;
    const moving = axis.x !== 0 || axis.z !== 0;

    const wantsSprint = input.isDown('sprint') && moving && !this.crouched && this.robot.energy > 2;
    this.sprinting = wantsSprint;
    const groundY = this.groundY;
    const slope = this.world.terrain.slopeAt(this.pos.x, this.pos.z);
    const depth = WATER_LEVEL - groundY;
    const wasSwimming = this.swimming;
    this.swimming = depth > 0.9 && this.pos.y < WATER_LEVEL - 0.15;
    if (this.swimming && !wasSwimming) this.events.push({ type: 'splash', speed: Math.abs(this.vel.y) });
    if (!this.swimming && wasSwimming) this.vel.y = 0;

    let target = this.crouched ? CREW_SPEED : WALK_SPEED;
    if (wantsSprint) target = SPRINT_SPEED * (1 + this.modifiers.sprintBonus);
    if (this.swimming) target = SWIM_SPEED * (1 + this.modifiers.swimBonus) * (wantsSprint ? 1.5 : 1);
    if (slope > 0.9) target *= 0.45;
    if (moving) {
      const desired = Math.hypot(dirX, dirZ) > 0 ? target : 0;
      const dirLen = Math.hypot(dirX, dirZ) || 1;
      const accel = this.grounded ? 14 : 4;
      const vx = (dirX / dirLen) * desired;
      const vz = (dirZ / dirLen) * desired;
      this.vel.x += (vx - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (vz - this.vel.z) * Math.min(1, accel * dt);
      this.yaw = wrapAngle(Math.atan2(dirX, dirZ));
    } else {
      const k = Math.min(1, 10 * dt);
      this.vel.x -= this.vel.x * k;
      this.vel.z -= this.vel.z * k;
    }

    if (input.pressed('jump') && this.grounded && !this.swimming && this.robot.spend(3)) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
      this.events.push({ type: 'jump' });
    }
    if (!this.grounded && !this.swimming) {
      this.vel.y -= GRAVITY * dt;
    }

    // Horizontal move with collision against trees, rocks and vehicles.
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.resolveCollisions(this.pos, PLAYER_RADIUS);

    // Vertical: ground following, falls and water surface.
    const ground = this.groundY;
    if (this.swimming) {
      // Three-dimensional swimming: Space ascends, C descends, otherwise the robot holds its depth
      // (and floats up gently when it is close to the surface).
      const up = input.isDown('jump');
      const down = input.isDown('crouch');
      const surfaceY = WATER_LEVEL - 0.35;
      let vyTarget = up ? 2.4 : down ? -2.4 : 0;
      if (!up && !down && this.pos.y > surfaceY - 0.6) vyTarget = (surfaceY - this.pos.y) * 1.5;
      this.vel.y += (vyTarget - this.vel.y) * Math.min(1, 6 * dt);
      this.pos.y = Math.min(surfaceY, Math.max(ground + 0.35, this.pos.y + this.vel.y * dt));
      if (this.pos.y >= surfaceY - 0.02) this.pos.y += this.bob(dt);
      this.grounded = false;
      this.airPeak = this.pos.y;
      this.depthBelowSurface = Math.max(0, WATER_LEVEL - this.pos.y);
      this.diveLimit = BASE_DIVE_LIMIT + this.modifiers.diveDepth;
      this.robot.drain((0.35 + this.depthBelowSurface * 0.015) * dt);
      this.pressureTimer -= dt;
      if (this.depthBelowSurface > this.diveLimit) {
        const over = this.depthBelowSurface - this.diveLimit;
        this.robot.damage(0.5 * over * dt);
        if (this.pressureTimer <= 0) {
          this.pressureTimer = 4;
          this.events.push({ type: 'pressure', depth: this.depthBelowSurface, limit: this.diveLimit });
        }
      }
    } else {
      this.depthBelowSurface = 0;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y > this.airPeak) this.airPeak = this.pos.y;
      if (this.pos.y <= ground || (this.grounded && ground - this.pos.y < 0.35 && this.vel.y <= 0)) {
        if (!this.grounded && this.vel.y < -0.1) this.onLand(ground);
        this.pos.y = ground;
        this.vel.y = 0;
        this.grounded = true;
        this.airPeak = ground;
      } else if (this.pos.y - ground > 0.05) {
        this.grounded = false;
      }
    }

    // Energy costs.
    if (moving && this.grounded) {
      this.robot.drain((wantsSprint ? 0.9 : this.crouched ? 0.05 : 0.12) * dt);
    }
    this.surfaceTimer = (this.surfaceTimer ?? 0) - dt;
    if (this.surfaceTimer <= 0 && biomeAt) {
      this.surfaceTimer = 0.5;
      this.surface = surfaceFromBiome(biomeAt(this.pos.x, this.pos.z), this.swimming);
    }

    const horizontal = Math.hypot(this.vel.x, this.vel.z);
    this.speed = horizontal;
    this.noise = this.crouched ? 0.15 : wantsSprint ? 1 : moving ? 0.55 : 0.08;
    this.model.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
    this.landTimer = Math.max(0, this.landTimer - dt);
    let actionEnvelope = 0;
    let actionKind = null;
    if (this.actionState) {
      this.actionState.t += dt;
      const k = this.actionState.t / this.actionState.dur;
      if (k >= 1) this.actionState = null;
      else {
        actionEnvelope = Math.sin(Math.PI * k);
        actionKind = this.actionState.kind;
      }
    }
    const stride = this.model.animate({
      speed: this.grounded ? horizontal : horizontal * 0.4, grounded: this.grounded,
      crouch: this.crouched ? 1 : 0, sprint: wantsSprint, dt, airVel: this.vel.y,
      swim: this.swimming ? 1 : 0, land: this.landStrength * (this.landTimer / 0.35),
      action: actionEnvelope, actionKind
    });
    if (this.grounded && horizontal > 0.5) {
      const crossed = Math.floor(stride / Math.PI) !== Math.floor(this.stepPhaseLast / Math.PI);
      if (crossed) this.events.push({ type: 'step', surface: this.surface, sprint: wantsSprint });
    }
    this.stepPhaseLast = stride;
  }

  bob(dt) {
    this.bobTime = (this.bobTime ?? 0) + dt;
    return Math.sin(this.bobTime * 2) * 0.03;
  }

  /** Plays a tool gesture (scan, collect, repair): the right arm reaches forward and the tool tip glows. */
  playAction(kind, duration = 0.7) {
    this.actionState = { kind, t: 0, dur: duration };
  }

  /** World position of the tool tip (for beams and sparks). */
  toolTipPosition(target) {
    return this.model.toolTip.getWorldPosition(target);
  }

  onLand(ground) {
    const drop = this.airPeak - ground;
    this.landTimer = 0.35;
    this.landStrength = Math.min(1, drop / 5);
    this.events.push({ type: 'land', drop });
    if (drop > SAFE_FALL) {
      const taken = this.robot.damage((drop - SAFE_FALL) * 2.5, 1 - this.modifiers.damageReduction);
      this.events.push({ type: 'fall-damage', amount: taken });
    }
  }

  /** Drains the events produced during the last update(). */
  takeEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}

/** Maps a biome id to the surface type used for footstep sounds. */
export function surfaceFromBiome(biomeId, swimming) {
  if (swimming) return 'water';
  if (biomeId === 'desert') return 'sand';
  if (biomeId === 'snow_peaks' || biomeId === 'rocky_plateau') return 'rock';
  if (biomeId === 'lake_bed' || biomeId === 'wetland') return 'mud';
  return 'grass';
}
