// Fauna: data-driven creatures with state machines, perception, herd behaviour,
// predator hunting and terrain-aware movement. Models are created only near the
// player; far creatures run a simplified simulation.
import { canSee, canHear } from '../ai/perception.js';
import { chooseHeading, angleDelta } from '../ai/navigation.js';
import { StateMachine } from '../ai/fsm.js';
import { WATER_LEVEL } from '../world/terrain.js';
import { createCreatureView } from './creatureModels.js';
import { clamp } from '../core/math.js';

export const VIEW_RADIUS = 120;
export const DESPAWN_RADIUS = 320;
const MAX_CREATURES = 170;
const COARSE_RADIUS = 110;

const rand = (a, b) => a + Math.random() * (b - a);

export class Creature {
  constructor(spawn, species, world) {
    this.id = spawn.id;
    this.species = species;
    this.aquatic = species.habitat === 'water';
    this.x = spawn.x;
    this.z = spawn.z;
    this.y = world.heightAt(spawn.x, spawn.z);
    this.yaw = spawn.yaw ?? 0;
    this.home = { x: spawn.x, z: spawn.z };
    this.hp = species.hp;
    this.alive = true;
    this.deadTimer = 0;
    this.speed = 0;
    this.goal = null;
    this.timer = rand(1, 4);
    this.hunger = rand(0.1, 0.4);
    this.thirst = rand(0.1, 0.4);
    this.asleep = false;
    this.threat = null;
    this.threatTimer = 0;
    this.attackCooldown = 0;
    this.attackTimer = 0;
    this.eatTimer = 0;
    this.prey = null;
    this.leader = null;
    this.stride = 0;
    this.view = null;
    this.isLeader = false;
    this.state = 'idle';
    this.fsm = null;
  }

  get isPredator() {
    return this.species.diet === 'carnivore';
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      this.goal = null;
      this.state = 'dead';
      return true;
    }
    return false;
  }

  /**
   * One simulation step.
   * @param ctx { world, daylight, player: {x,y,z,yaw,noise,alive}, creatures, difficulty,
   *              coarse, damagePlayer(amount), events(array) }
   */
  think(dt, ctx) {
    if (!this.alive) {
      this.deadTimer += dt;
      this.speed = 0;
      return;
    }
    this.timer -= dt;
    this.attackCooldown -= dt;
    this.attackTimer -= dt;
    this.threatTimer -= dt;
    this.hunger = Math.min(1, this.hunger + dt * 0.0035);
    this.thirst = Math.min(1, this.thirst + dt * 0.005);

    if (ctx.coarse) {
      this.coarseStep(dt, ctx);
      this.move(dt, ctx);
      return;
    }
    if (this.isPredator) this.thinkPredator(dt, ctx);
    else this.thinkHerbivore(dt, ctx);
    this.move(dt, ctx);
  }

  // ---- Herbivores -------------------------------------------------------

  thinkHerbivore(dt, ctx) {
    const sp = this.species;
    const sleepTime = sp.activity === 'night' ? ctx.daylight > 0.6 : sp.activity === 'day' ? ctx.daylight < 0.15 : false;
    const threat = this.findThreat(ctx);
    if (threat) {
      this.asleep = false;
      this.setThreat(threat, ctx);
    }
    if (this.threatTimer > 0 && this.threat) {
      this.state = 'flee';
      this.fleeFrom(this.threat, sp.speed.run, ctx);
      return;
    }
    if (this.asleep) {
      if (!sleepTime) this.asleep = false;
      else return;
    }
    if (sleepTime && this.state !== 'drink') {
      this.asleep = true;
      this.state = 'sleep';
      this.goal = null;
      return;
    }
    if (this.state === 'drink') {
      if (this.timer > 0) return;
      this.thirst = 0;
      this.state = 'idle';
    }
    if (sp.temperament === 'curieux' && this.state !== 'curious' && ctx.player.alive) {
      const d = Math.hypot(ctx.player.x - this.x, ctx.player.z - this.z);
      if (d > 9 && d < 26 && ctx.player.noise < 0.3 && canSee(ctx.world, this, ctx.player, sp.perception.sight, sp.perception.fov) && Math.random() < dt * 0.25) {
        this.state = 'curious';
        this.goal = { x: ctx.player.x, z: ctx.player.z, speed: sp.speed.walk, stopDist: 9 };
        this.timer = 7;
        return;
      }
    }
    if (this.state === 'curious' && (this.timer > 0 && this.goal)) return;
    if (this.thirst > 0.7 && !this.goal && this.state !== 'drink') {
      const water = findWater(ctx.world, this.x, this.z, this.aquatic ? 60 : 45);
      if (water) {
        this.state = 'drink';
        this.goal = { x: water.x, z: water.z, speed: sp.speed.walk, stopDist: 1 };
        this.timer = 12;
        return;
      }
    }
    if (this.goal && this.timer > 0) return;
    this.chooseIdleAction(ctx);
  }

  chooseIdleAction(ctx) {
    const sp = this.species;
    if (this.leader && this.leader.alive && this.leader !== this) {
      const d = Math.hypot(this.leader.x - this.x, this.leader.z - this.z);
      if (d > sp.social.radius * 0.6) {
        this.state = 'follow';
        this.goal = { x: this.leader.x + rand(-5, 5), z: this.leader.z + rand(-5, 5), speed: sp.speed.walk, stopDist: 2 };
        this.timer = 8;
        return;
      }
    }
    const roll = Math.random();
    if (roll < 0.4) {
      this.state = 'graze';
      this.goal = null;
      this.timer = rand(4, 9);
    } else if (roll < 0.55) {
      this.state = 'idle';
      this.goal = null;
      this.timer = rand(2, 5);
    } else {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 16;
      const tx = this.home.x + Math.cos(angle) * r;
      const tz = this.home.z + Math.sin(angle) * r;
      this.state = 'wander';
      this.goal = { x: tx, z: tz, speed: sp.speed.walk, stopDist: 1.2 };
      this.timer = 14;
    }
  }

  findThreat(ctx) {
    const sp = this.species;
    const p = ctx.player;
    if (p.alive) {
      const dist = Math.hypot(p.x - this.x, p.z - this.z);
      if (dist < 70 && (canSee(ctx.world, this, p, sp.perception.sight * ctx.difficulty.detectMultiplier, sp.perception.fov)
        || canHear(this, p, sp.perception.hearing, p.noise))) {
        const alarmed = sp.temperament === 'timide' || p.noise > 0.5 || dist < 14;
        if (alarmed && (p.noise > 0.2 || dist < 16)) return { x: p.x, z: p.z };
      }
    }
    for (const other of ctx.creatures) {
      if (!other.alive || other === this || !other.isPredator) continue;
      if (!other.species.prey?.includes(sp.id)) continue;
      if (canSee(ctx.world, this, other, sp.perception.sight, sp.perception.fov)) {
        return { x: other.x, z: other.z };
      }
    }
    return null;
  }

  setThreat(threat, ctx) {
    this.threat = threat;
    this.threatTimer = 4;
    // Herd members near the threat share the alarm.
    for (const other of ctx.creatures) {
      if (other === this || !other.alive || other.isPredator || other.species.id !== this.species.id) continue;
      if (Math.hypot(other.x - this.x, other.z - this.z) < this.species.social.radius) {
        other.threat = threat;
        other.threatTimer = 3;
      }
    }
  }

  fleeFrom(threat, speed, ctx) {
    const dx = this.x - threat.x;
    const dz = this.z - threat.z;
    const dist = Math.hypot(dx, dz) || 1;
    const goalX = this.x + (dx / dist) * 30;
    const goalZ = this.z + (dz / dist) * 30;
    this.goal = { x: goalX, z: goalZ, speed, stopDist: 2 };
    this.timer = 1;
  }

  // ---- Predators --------------------------------------------------------

  thinkPredator(dt, ctx) {
    const sp = this.species;
    if (this.state === 'eat') {
      this.eatTimer -= dt;
      this.goal = null;
      if (this.eatTimer <= 0) this.state = 'idle';
      return;
    }
    const aggression = ctx.difficulty.predatorAggression;
    const p = ctx.player;
    if (sp.temperament === 'agressif' && p.alive && !this.prey) {
      const dist = Math.hypot(p.x - this.x, p.z - this.z);
      const seen = dist < sp.perception.sight * aggression && canSee(ctx.world, this, p, sp.perception.sight * aggression, sp.perception.fov);
      const provoked = dist < 6 && p.noise > 0.2;
      if (seen || provoked) {
        if (Math.hypot(p.x - this.home.x, p.z - this.home.z) < (sp.territory ?? 60) + 25) {
          this.prey = { kind: 'player' };
          this.state = 'hunt';
        }
      }
    }
    if (this.prey?.kind === 'player') {
      const dist = Math.hypot(p.x - this.x, p.z - this.z);
      if (!p.alive || dist > 45) {
        this.prey = null;
        this.state = 'idle';
      } else {
        this.goal = { x: p.x, z: p.z, speed: sp.speed.run, stopDist: 1.8 };
        if (dist < 2.8 && this.attackCooldown <= 0) {
          this.attackCooldown = 1.6;
          this.attackTimer = 0.5;
          this.state = 'attack';
          ctx.damagePlayer(sp.damage * aggression);
        }
      }
      return;
    }

    if (!this.prey && this.hunger > 0.45) {
      const target = this.findPrey(ctx);
      if (target) {
        this.prey = target;
        this.state = 'hunt';
      }
    }
    if (this.prey && this.prey.kind !== 'player') {
      const prey = this.prey;
      if (!prey.alive) {
        this.prey = null;
        this.state = 'idle';
        return;
      }
      const dist = Math.hypot(prey.x - this.x, prey.z - this.z);
      this.goal = { x: prey.x, z: prey.z, speed: sp.speed.run * 0.85, stopDist: 1.6 };
      if (dist < 2.6 && this.attackCooldown <= 0) {
        this.attackCooldown = 1.1;
        this.attackTimer = 0.45;
        this.state = 'attack';
        if (prey.takeDamage(sp.damage * 1.6)) {
          ctx.events.push({ type: 'kill', victim: prey.species.id });
          this.state = 'eat';
          this.eatTimer = 9;
          this.hunger = 0;
          this.prey = null;
          this.goal = null;
        }
      }
      if (dist > 60) {
        this.prey = null;
        this.state = 'idle';
      }
      return;
    }

    if (this.goal && this.timer > 0) return;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (sp.territory ?? 60) * 0.8;
    this.state = 'patrol';
    this.goal = { x: this.home.x + Math.cos(angle) * r, z: this.home.z + Math.sin(angle) * r, speed: sp.speed.walk, stopDist: 2 };
    this.timer = 15;
  }

  findPrey(ctx) {
    const preyIds = this.species.prey ?? [];
    let best = null;
    let bestDist = Infinity;
    for (const other of ctx.creatures) {
      if (!other.alive || other === this || !preyIds.includes(other.species.id)) continue;
      const d = Math.hypot(other.x - this.x, other.z - this.z);
      if (d < bestDist && d < this.species.perception.sight && canSee(ctx.world, this, other, this.species.perception.sight, this.species.perception.fov)) {
        best = other;
        bestDist = d;
      }
    }
    return best;
  }

  // ---- Shared -----------------------------------------------------------

  /** Simplified behaviour for creatures beyond COARSE_RADIUS: wandering only. */
  coarseStep(dt, ctx) {
    if (this.goal && this.timer > 0) return;
    this.timer = rand(6, 14);
    const angle = Math.random() * Math.PI * 2;
    this.goal = { x: this.home.x + Math.cos(angle) * 10, z: this.home.z + Math.sin(angle) * 10, speed: this.species.speed.walk * 0.5, stopDist: 2 };
  }

  /** Steering and integration: turn towards the goal, avoid obstacles, move on the terrain. */
  move(dt, ctx) {
    const world = ctx.world;
    if (this.asleep || this.state === 'eat' || this.state === 'attack' || this.state === 'dead') {
      this.speed = Math.max(0, this.speed - 8 * dt);
    } else if (this.goal) {
      const dx = this.goal.x - this.x;
      const dz = this.goal.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= this.goal.stopDist) {
        if (!this.prey && this.state !== 'flee' && this.state !== 'hunt') {
          this.goal = null;
          this.speed = Math.max(0, this.speed - 6 * dt);
        }
      }
      if (this.goal) {
        const desired = Math.atan2(dx, dz);
        const heading = chooseHeading(world, this.x, this.z, this.y, desired, {
          aquatic: this.aquatic, maxSlope: this.species.archetype === 'flyer' ? 3 : 0.75
        });
        const blocked = heading === null;
        const target = blocked ? desired + Math.PI * 0.5 : heading;
        const delta = angleDelta(this.yaw, target);
        const turn = Math.sign(delta) * Math.min(Math.abs(delta), 3.2 * dt);
        this.yaw += turn;
        const aligned = Math.max(0, 1 - Math.abs(delta) / 1.2);
        const targetSpeed = blocked ? 0 : this.goal.speed * aligned;
        this.speed += clamp(targetSpeed - this.speed, -5 * dt, 3 * dt);
      }
    } else {
      this.speed = Math.max(0, this.speed - 4 * dt);
    }

    const step = this.speed * dt;
    this.x += Math.sin(this.yaw) * step;
    this.z += Math.cos(this.yaw) * step;
    world.resolveCollisions(this, 0.5);
    const ground = world.heightAt(this.x, this.z);
    this.y = this.species.archetype === 'flyer' ? ground + 9 : ground;
    this.stride += this.speed * dt * 1.4;
  }
}

/** Searches for a water edge in a few directions and returns its position, or null. */
function findWater(world, x, z, range) {
  for (const r of [range * 0.3, range * 0.6, range]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.random() * 0.4;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (world.heightAt(px, pz) < WATER_LEVEL - 0.6) {
        const edge = r * 0.6;
        return { x: x + Math.cos(a) * (r - edge), z: z + Math.sin(a) * (r - edge) };
      }
    }
  }
  return null;
}

export class CreatureManager {
  /**
   * @param options { scene, world, content, difficulty, damagePlayer }
   */
  constructor(options) {
    this.scene = options.scene;
    this.world = options.world;
    this.content = options.content;
    this.difficulty = options.difficulty;
    this.damagePlayer = options.damagePlayer;
    this.creatures = [];
    this.events = [];
    this.spawnedChunks = new Set();
    this.activeViews = 0;
  }

  /** Called by the world when a chunk with fauna spawns becomes active. */
  onChunkReady(chunk) {
    if (chunk.lod !== 0 || this.spawnedChunks.has(chunk.key)) return;
    this.spawnedChunks.add(chunk.key);
    const groups = new Map();
    for (const spawn of chunk.spawns) {
      const species = this.content.speciesById[spawn.species];
      if (!species || this.creatures.length >= MAX_CREATURES) continue;
      const creature = new Creature(spawn, species, this.world);
      const key = `${spawn.species}`;
      const leader = groups.get(key);
      if (leader) {
        creature.leader = leader;
      } else {
        creature.isLeader = true;
        creature.leader = creature;
        groups.set(key, creature);
      }
      this.creatures.push(creature);
    }
  }

  onChunkRemoved(chunk) {
    this.spawnedChunks.delete(chunk.key);
  }

  update(dt, playerState, daylight, scene) {
    const px = playerState.x;
    const pz = playerState.z;
    const ctx = {
      world: this.world,
      daylight,
      player: playerState,
      creatures: this.creatures,
      difficulty: this.difficulty,
      damagePlayer: this.damagePlayer,
      events: this.events,
      coarse: false
    };

    this.creatures = this.creatures.filter((c) => {
      const d = Math.hypot(c.x - px, c.z - pz);
      if (!c.alive && c.deadTimer > 6) {
        this.removeView(c, scene);
        return false;
      }
      if (c.alive && d > DESPAWN_RADIUS) {
        this.removeView(c, scene);
        return false;
      }
      return true;
    });

    for (const c of this.creatures) {
      const d = Math.hypot(c.x - px, c.z - pz);
      ctx.coarse = c.alive && d > COARSE_RADIUS;
      if (c.alive && ctx.coarse) {
        c.coarseStepAccum = (c.coarseStepAccum ?? 0) + dt;
        if (c.coarseStepAccum < 0.5) continue;
        c.think(c.coarseStepAccum, ctx);
        c.coarseStepAccum = 0;
      } else {
        c.think(dt, ctx);
      }
      if (d < VIEW_RADIUS && !c.view) this.addView(c, scene);
      if (d > VIEW_RADIUS + 25 && c.view) this.removeView(c, scene);
      if (c.view) c.view.update(dt, c);
    }
  }

  addView(creature, scene) {
    creature.view = createCreatureView(creature.species);
    creature.view.root.userData.creature = creature;
    scene.add(creature.view.root);
    this.activeViews++;
  }

  removeView(creature, scene) {
    if (!creature.view) return;
    scene.remove(creature.view.root);
    creature.view = null;
    this.activeViews--;
  }

  /** Creatures in range, sorted by distance (used by scanner, radar and map). */
  near(x, z, range) {
    return this.creatures
      .filter((c) => c.alive && Math.hypot(c.x - x, c.z - z) < range)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  }

  get count() {
    return this.creatures.length;
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}
