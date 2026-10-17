// Artificial enemies: patrolling sentinel drones and static automated turrets.
// State machine: patrol, investigate, alert, combat, search, retreat.
// Enemies only know the player's position when they see or hear the player; after
// losing sight they search the last known position instead of cheating.
import * as THREE from 'three';
import { canSee, canHear } from '../ai/perception.js';
import { StateMachine } from '../ai/fsm.js';
import { clamp, dist2 } from '../core/math.js';
import { createRng } from '../core/rng.js';

const DRONE_COLORS = { patrol: '#4dff9a', investigate: '#ffd166', alert: '#ff8a3d', combat: '#ff3b3b', search: '#ffd166', retreat: '#7aa7ff' };

function buildVisual(kind) {
  const root = new THREE.Group();
  const rotors = [];
  const metal = new THREE.MeshStandardMaterial({ color: '#4a525c', metalness: 0.8, roughness: 0.35 });
  const glow = new THREE.MeshStandardMaterial({ color: '#4dff9a', emissive: '#4dff9a', emissiveIntensity: 2 });
  const light = new THREE.PointLight('#4dff9a', 0.6, 8, 2);
  if (kind === 'sentinel_drone') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), metal);
    body.castShadow = true;
    root.add(body);
    for (const [x, z] of [[0.85, 0.85], [-0.85, 0.85], [0.85, -0.85], [-0.85, -0.85]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), metal);
      arm.position.set(x * 0.6, 0.05, z * 0.6);
      arm.rotation.y = Math.atan2(x, z);
      root.add(arm);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.02, 12), glow);
      rotor.position.set(x * 0.7, 0.2, z * 0.7);
      root.add(rotor);
      rotors.push(rotor);
    }
    light.position.set(0, -0.4, 0.5);
  } else {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.4, 12), metal);
    base.position.y = -0.4;
    base.castShadow = true;
    root.add(base);
    const head = new THREE.Group();
    head.name = 'head';
    head.position.y = 0.4;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.1), metal);
    housing.castShadow = true;
    head.add(housing);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.4, 8), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.9;
    head.add(barrel);
    const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow);
    sensor.position.set(0, 0.35, 0.55);
    head.add(sensor);
    root.add(head);
    light.position.set(0, 0.8, 0.5);
  }
  root.add(light);
  return { root, light, glow, rotors, head: root.getObjectByName('head') };
}

export class Enemy {
  constructor(spec, type, rng) {
    this.id = spec.id;
    this.type = type;
    this.name = type.name;
    this.group = spec.group;
    this.description = type.description;
    this.mobile = type.mobile;
    this.x = spec.x;
    this.z = spec.z;
    this.y = spec.y;
    this.yaw = spec.yaw ?? 0;
    this.base = { x: spec.baseX, z: spec.baseZ };
    this.hp = type.hp;
    this.maxHp = type.hp;
    this.alive = true;
    this.detect = 0;
    this.lastKnown = null;
    this.lastSeenTimer = 99;
    this.goal = null;
    this.patrol = [];
    this.patrolIndex = 0;
    this.timer = 0;
    this.fireTimer = 1;
    this.view = null;
    this.rng = rng;
    this.fsm = new StateMachine(this);
    this.state = 'patrol';
    this.patrolRing(spec.patrolRadius ?? 18);
    this.fsm
      .add('patrol', { update: patrolUpdate })
      .add('investigate', { enter: (e) => { e.timer = 0; }, update: investigateUpdate })
      .add('alert', { enter: (e) => { e.timer = 1.1; }, update: alertUpdate })
      .add('combat', { update: combatUpdate })
      .add('search', { enter: (e) => { e.timer = 0; e.searchTarget = null; }, update: searchUpdate })
      .add('retreat', { enter: (e) => { e.timer = 7; }, update: retreatUpdate });
    this.fsm.set('patrol');
  }

  patrolRing(radius) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + this.rng() * 0.5;
      this.patrol.push({ x: this.base.x + Math.cos(a) * radius, z: this.base.z + Math.sin(a) * radius });
    }
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  /** Alerts this enemy about a position reported by an ally. */
  alertTo(pos) {
    if (!this.alive || this.fsm.current === 'combat') return;
    this.lastKnown = { ...pos, t: 0 };
    this.fsm.set('alert');
  }

  get lowHealth() {
    return this.hp / this.maxHp < 0.3;
  }
}

function moveTo(e, tx, tz, speed, dt, hover) {
  const dx = tx - e.x;
  const dz = tz - e.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.2) {
    const target = Math.atan2(dx, dz);
    let delta = target - e.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    e.yaw += clamp(delta, -3 * dt, 3 * dt);
    const step = Math.min(d, speed * dt);
    e.x += (dx / d) * step;
    e.z += (dz / d) * step;
  }
  if (hover !== undefined) e.y += clamp(hover - e.y, -2 * dt, 2 * dt);
  return d;
}

function patrolUpdate(e, dt, ctx) {
  if (ctx.seesPlayer && e.detect >= 1) { e.shareAlert(ctx); e.fsm.set('alert'); return; }
  if (ctx.heardPlayer && !ctx.seesPlayer) {
    e.lastKnown = { x: ctx.player.x + (e.rng() - 0.5) * 8, z: ctx.player.z + (e.rng() - 0.5) * 8 };
    e.fsm.set('investigate');
    return;
  }
  if (e.mobile) {
    const wp = e.patrol[e.patrolIndex];
    if (dist2(e.x, e.z, wp.x, wp.z) < 2) e.patrolIndex = (e.patrolIndex + 1) % e.patrol.length;
    moveTo(e, wp.x, wp.z, e.type.speed.patrol, dt, ctx.groundAt(e.x, e.z) + e.type.hover);
  } else {
    e.yaw += Math.sin(e.fsm.elapsed * 0.6) * 0.6 * dt;
    e.y = ctx.groundAt(e.x, e.z) + e.type.hover;
  }
}

function investigateUpdate(e, dt, ctx) {
  if (ctx.seesPlayer && e.detect >= 1) { e.shareAlert(ctx); e.fsm.set('alert'); return; }
  if (!e.mobile) { e.fsm.set('patrol'); return; }
  const d = moveTo(e, e.lastKnown.x, e.lastKnown.z, e.type.speed.patrol * 1.4, dt, ctx.groundAt(e.x, e.z) + e.type.hover);
  if (d < 2.5) {
    e.timer += dt;
    if (e.timer > 4) { e.timer = 0; e.fsm.set('patrol'); }
  }
}

function alertUpdate(e, dt, ctx) {
  e.timer -= dt;
  if (ctx.seesPlayer) e.lastKnown = { x: ctx.player.x, y: ctx.player.y, z: ctx.player.z };
  if (e.timer <= 0) e.fsm.set('combat');
}

function combatUpdate(e, dt, ctx) {
  const data = e.type;
  if (ctx.seesPlayer) {
    e.lastSeenTimer = 0;
    e.lastKnown = { x: ctx.player.x, y: ctx.player.y, z: ctx.player.z };
  }
  if (e.lowHealth && e.mobile) { e.fsm.set('retreat'); return; }
  const aimX = e.lastKnown?.x ?? ctx.player.x;
  const aimZ = e.lastKnown?.z ?? ctx.player.z;
  const d = Math.hypot(aimX - e.x, aimZ - e.z);
  if (e.mobile) {
    const want = data.keepDistance;
    const radial = clamp((d - want) * 0.4, -6, 6);
    const dx = aimX - e.x;
    const dz = aimZ - e.z;
    const len = d || 1;
    const strafe = Math.sin(e.fsm.elapsed * 0.9) * 4;
    const tx = e.x + (dx / len) * radial + (-dz / len) * strafe;
    const tz = e.z + (dz / len) * radial + (dx / len) * strafe;
    moveTo(e, tx, tz, data.speed.chase, dt, ctx.groundAt(e.x, e.z) + data.hover);
    e.yaw = Math.atan2(aimX - e.x, aimZ - e.z);
  } else {
    const target = Math.atan2(aimX - e.x, aimZ - e.z);
    let delta = target - e.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    e.yaw += clamp(delta, -2.5 * dt, 2.5 * dt);
  }
  e.fireTimer -= dt;
  if (ctx.seesPlayer && e.fireTimer <= 0 && d < data.fireRange) {
    e.fireTimer = data.fireCooldown;
    e.fire(ctx);
  }
  if (!ctx.seesPlayer && e.lastSeenTimer > 3) {
    e.lastSeenTimer = 0;
    e.fsm.set('search');
  }
}

function searchUpdate(e, dt, ctx) {
  if (ctx.seesPlayer) { e.fsm.set('combat'); return; }
  e.timer += dt;
  if (!e.searchTarget) {
    const a = e.rng() * Math.PI * 2;
    const r = e.rng() * 8;
    const origin = e.lastKnown ?? { x: e.x, z: e.z };
    e.searchTarget = { x: origin.x + Math.cos(a) * r, z: origin.z + Math.sin(a) * r };
  }
  if (e.mobile) {
    moveTo(e, e.searchTarget.x, e.searchTarget.z, e.type.speed.patrol * 1.5, dt, ctx.groundAt(e.x, e.z) + e.type.hover);
  } else {
    e.yaw += dt * 1.1;
  }
  if (e.timer > 7) {
    e.searchTarget = null;
    e.fsm.set('patrol');
  }
}

function retreatUpdate(e, dt, ctx) {
  e.timer -= dt;
  const away = Math.atan2(e.x - ctx.player.x, e.z - ctx.player.z);
  moveTo(e, e.base.x + Math.sin(away) * 2, e.base.z + Math.cos(away) * 2, e.type.speed.chase, dt, ctx.groundAt(e.x, e.z) + e.type.hover);
  if (e.timer <= 0) {
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.3);
    e.fsm.set('patrol');
  }
}

Enemy.prototype.shareAlert = function shareAlert(ctx) {
  for (const other of ctx.allies(this)) other.alertTo({ x: ctx.player.x, y: ctx.player.y, z: ctx.player.z });
  return true;
};

/** Fires at the player (only called while the player is visible). Accuracy is 70 %. */
Enemy.prototype.fire = function fire(ctx) {
  const origin = { x: this.x, y: this.y, z: this.z };
  const p = ctx.player;
  const hit = this.rng() < 0.7;
  const aim = hit
    ? { x: p.x, y: p.y + 1.1, z: p.z }
    : { x: p.x + (this.rng() - 0.5) * 4, y: p.y + 1.1, z: p.z + (this.rng() - 0.5) * 4 };
  ctx.effects.beam(origin, aim, '#ff4d3d', 0.18);
  if (hit) ctx.damagePlayer(this.type.damage);
};

/** Owns all enemies: creates them from POI specs, updates them, and builds their visuals. */
export class EnemyManager {
  /**
   * @param options { scene, content, world, difficulty, damagePlayer, effects, seed }
   */
  constructor(options) {
    this.scene = options.scene;
    this.content = options.content;
    this.world = options.world;
    this.difficulty = options.difficulty;
    this.damagePlayer = options.damagePlayer;
    this.effects = options.effects;
    this.enemies = [];
    this.rng = createRng(options.seed ^ 0xe0e0);
    this.lootQueue = [];
  }

  /** Spawns the enemies of one POI. `points` = POI info { x, z }. */
  spawnForPoint(poi, spec) {
    const type = this.content.enemies.enemies[spec.type];
    if (!type) return;
    for (let i = 0; i < spec.count; i++) {
      const a = (i / Math.max(1, spec.count)) * Math.PI * 2 + this.rng();
      const r = spec.offset * (0.6 + this.rng() * 0.4);
      const x = poi.x + Math.cos(a) * r;
      const z = poi.z + Math.sin(a) * r;
      const ground = this.world.heightAt(x, z);
      const enemy = new Enemy({
        id: `${poi.id}:${spec.type}:${i}`, group: poi.id, x, z, y: ground + type.hover, baseX: poi.x, baseZ: poi.z,
        yaw: a, patrolRadius: spec.offset
      }, type, this.rng);
      enemy.kind = spec.type;
      this.enemies.push(enemy);
    }
  }

  allies(enemy) {
    return this.enemies.filter((e) => e !== enemy && e.alive && e.group === enemy.group && Math.hypot(e.x - enemy.x, e.z - enemy.z) < 45);
  }

  update(dt, player) {
    this.lastPlayer = player;
    const ctx = {
      player,
      effects: this.effects,
      damagePlayer: (amount) => this.damagePlayer(amount),
      difficulty: this.difficulty,
      allies: (e) => this.allies(e),
      groundAt: (x, z) => this.world.heightAt(x, z)
    };
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const seen = player.alive && canSee(this.world, { x: e.x, y: e.y, z: e.z, yaw: e.yaw }, player, e.type.sight * this.difficulty.detectMultiplier, e.type.fov);
      const dist = Math.hypot(player.x - e.x, player.z - e.z);
      const heard = !seen && player.alive && canHear({ x: e.x, z: e.z }, player, e.type.hearing, player.noise);
      if (seen) {
        const crouchFactor = player.crouched ? 0.6 : 1;
        e.detect = Math.min(1, e.detect + e.type.detectRate * this.difficulty.detectMultiplier * crouchFactor * dt * (1.3 - dist / e.type.sight));
      } else if (heard) {
        e.detect = Math.min(1, e.detect + 0.4 * dt);
      } else {
        e.detect = Math.max(0, e.detect - 0.2 * dt);
      }
      e.lastSeenTimer += dt;
      ctx.seesPlayer = seen;
      ctx.heardPlayer = heard;
      e.fsm.update(dt, ctx);
      if (e.view) {
        e.view.root.position.set(e.x, e.y, e.z);
        e.view.root.rotation.y = e.yaw;
      }
      this.updateVisual(e, dt);
    }
    this.enemies = this.enemies.filter((e) => {
      if (e.alive) return true;
      e.deadTimer -= dt;
      if (e.deadTimer > 0) return true;
      this.removeVisual(e);
      return false;
    });
  }

  /** Applies a hit from the player's weapon. Returns true when the enemy was destroyed. */
  hit(enemy, damage) {
    const destroyed = enemy.takeDamage(damage);
    this.effects.burst({ x: enemy.x, y: enemy.y, z: enemy.z }, destroyed ? '#ffd166' : '#ff8a3d', destroyed ? 3 : 1);
    if (destroyed) {
      enemy.deadTimer = 2;
      this.removeVisual(enemy);
      this.lootQueue.push({ item: enemy.type.dropItem, count: enemy.type.dropCount, name: enemy.name });
    } else {
      enemy.fsm.set('combat');
    }
    return destroyed;
  }

  updateVisual(e, dt) {
    if (!e.view) {
      if (this.distanceToPlayer(e) > 160) return;
      e.view = buildVisual(e.kind);
      this.scene.add(e.view.root);
    }
    const color = DRONE_COLORS[e.fsm.current] ?? '#4dff9a';
    e.view.glow.color.set(color);
    e.view.glow.emissive.set(color);
    e.view.light.color.set(color);
    for (const rotor of e.view.rotors) rotor.rotation.y += dt * 30;
  }

  distanceToPlayer(e) {
    return this.lastPlayer ? Math.hypot(e.x - this.lastPlayer.x, e.z - this.lastPlayer.z) : 0;
  }

  removeVisual(e) {
    if (e.view) {
      this.scene.remove(e.view.root);
      e.view = null;
    }
    return false;
  }

  /** Enemies within `range` of a point, for radar and map. */
  near(x, z, range) {
    return this.enemies.filter((e) => e.alive && Math.hypot(e.x - x, e.z - z) < range);
  }

  drainLoot() {
    const out = this.lootQueue;
    this.lootQueue = [];
    return out;
  }
}
