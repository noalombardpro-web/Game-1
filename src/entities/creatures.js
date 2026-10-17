// Fauna: data-driven creatures with state machines, perception, herd and pack behaviour,
// predator hunting (with giving up), weather shelter, foraging, defensive herbivores,
// individual traits and terrain-aware movement. Models are created only near the player;
// far creatures run a simplified simulation.
import { canSee, canHear } from '../ai/perception.js';
import { chooseHeading, angleDelta } from '../ai/navigation.js';
import { WATER_LEVEL } from '../world/terrain.js';
import { createCreatureView } from './creatureModels.js';
import { clamp } from '../core/math.js';
import { createRng, seedFromString } from '../core/rng.js';

export const VIEW_RADIUS = 120;
export const DESPAWN_RADIUS = 320;
const MAX_CREATURES = 220;
const COARSE_RADIUS = 110;
const MID_RADIUS = 55;

const rand = (a, b) => a + Math.random() * (b - a);
const HOVER = { flyer: 9, floater: 2.5, swarm: 1.2 };

export class Creature {
  constructor(spawn, species, world) {
    this.id = spawn.id;
    this.species = species;
    this.sea = species.habitat === 'sea';
    this.aquatic = species.habitat === 'water' || this.sea;
    this.arch = species.archetype;
    this.x = spawn.x;
    this.z = spawn.z;
    this.y = world.heightAt(spawn.x, spawn.z);
    this.yaw = spawn.yaw ?? 0;
    this.home = { x: spawn.x, z: spawn.z };
    this.hp = species.hp;
    this.maxHp = species.hp;
    this.alive = true;
    this.deadTimer = 0;
    this.speed = 0;
    this.goal = null;
    this.timer = rand(1, 4);
    this.hunger = rand(0.1, 0.4);
    this.thirst = this.sea ? 0 : rand(0.1, 0.4);
    this.asleep = false;
    this.threat = null;
    this.threatTimer = 0;
    this.attackCooldown = 0;
    this.attackTimer = 0;
    this.eatTimer = 0;
    this.prey = null;
    this.huntTimer = 0;
    this.huntCooldown = 0;
    this.provoked = 0;
    this.provokedBy = null;
    this.stuck = 0;
    this.leader = null;
    this.stride = 0;
    this.view = null;
    this.isLeader = false;
    this.state = 'idle';
    // Individual variation, stable for a given creature id.
    const rng = createRng(seedFromString(spawn.id));
    this.traits = { boldness: 0.75 + 0.5 * rng(), speed: 0.92 + 0.16 * rng(), size: 0.9 + 0.25 * rng() };
    this.depthPref = 0.15 + 0.7 * rng();
    this.walkSpeed = species.speed.walk * this.traits.speed;
    this.runSpeed = species.speed.run * this.traits.speed;
  }

  get isPredator() {
    return this.species.diet === 'carnivore';
  }

  get hitRadius() {
    return (this.species.size.length * 0.5 + 0.3) * this.traits.size;
  }

  /** Applies damage. `source` (a creature or { x, z, isPlayer }) is remembered for retaliation. */
  takeDamage(amount, source = null) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (source) {
      this.provoked = 12;
      this.provokedBy = source;
    }
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
   * @param ctx { world, daylight, player: {x,y,z,yaw,noise,alive}, creatures, difficulty, coarse,
   *              damagePlayer(amount), events, weather?: {severity}, foodAt?(x, z) }
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
    this.huntCooldown -= dt;
    this.provoked -= dt;
    this.hunger = Math.min(1, this.hunger + dt * 0.0035);
    if (!this.sea) this.thirst = Math.min(1, this.thirst + dt * 0.005);

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

    // Defensive species retaliate when provoked instead of fleeing.
    if (sp.temperament === 'defensif' && this.provoked > 0 && this.provokedBy && this.charge(ctx)) return;

    const threat = this.findThreat(ctx);
    if (threat) {
      this.asleep = false;
      if (sp.temperament === 'defensif' && threat.creature && sp.hp > 200 && this.charge(ctx, threat.creature)) return;
      this.setThreat(threat, ctx);
    }
    if (this.threatTimer > 0 && this.threat) {
      this.state = 'flee';
      this.fleeFrom(this.threat, this.runSpeed);
      return;
    }
    if (this.asleep) {
      if (!sleepTime) this.asleep = false;
      else return;
    }
    // Severe weather: go home and wait it out (water dwellers and flyers excluded).
    const severity = ctx.weather?.severity ?? 0;
    if (severity >= 0.6 && !this.sea && this.arch !== 'flyer') {
      const dHome = Math.hypot(this.home.x - this.x, this.home.z - this.z);
      this.state = 'shelter';
      this.goal = dHome > 6 ? { x: this.home.x, z: this.home.z, speed: this.walkSpeed * 1.5, stopDist: 4 } : null;
      return;
    }
    if (this.state === 'shelter') this.state = 'idle';
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
        this.goal = { x: ctx.player.x, z: ctx.player.z, speed: this.walkSpeed, stopDist: 9 };
        this.timer = 7;
        return;
      }
    }
    if (this.state === 'curious' && this.timer > 0 && this.goal) return;
    if (this.thirst > 0.7 && !this.goal && this.state !== 'drink' && !this.sea) {
      const water = findWater(ctx.world, this.x, this.z, this.aquatic ? 60 : 45);
      if (water) {
        this.state = 'drink';
        this.goal = { x: water.x, z: water.z, speed: this.walkSpeed, stopDist: 1 };
        this.timer = 12;
        return;
      }
    }
    if (this.goal && this.timer > 0) return;
    this.chooseIdleAction(ctx);
  }

  /** Defensive charge at the provoker (or the given creature). Returns false when there is nothing to charge. */
  charge(ctx, target = this.provokedBy) {
    if (!target || (target.alive === false)) return false;
    const tx = target.x ?? ctx.player.x;
    const tz = target.z ?? ctx.player.z;
    const dist = Math.hypot(tx - this.x, tz - this.z);
    if (dist > 45) return false;
    this.state = 'charge';
    this.goal = { x: tx, z: tz, speed: this.runSpeed, stopDist: 1.6 };
    this.timer = 1;
    if (dist < 2.8 && this.attackCooldown <= 0) {
      this.attackCooldown = 1.5;
      this.attackTimer = 0.5;
      const dmg = this.species.damage * ctx.difficulty.predatorAggression;
      if (target.isPlayer) ctx.damagePlayer(dmg);
      else if (target.takeDamage) target.takeDamage(this.species.damage * 1.2, this);
      ctx.events.push({ type: 'clash', by: this.species.id });
    }
    return true;
  }

  chooseIdleAction(ctx) {
    const sp = this.species;
    const dHome = Math.hypot(this.home.x - this.x, this.home.z - this.z);
    if (dHome > sp.social.radius * 2.5 + 25) {
      this.state = 'return';
      this.goal = { x: this.home.x, z: this.home.z, speed: this.walkSpeed, stopDist: 4 };
      this.timer = 20;
      return;
    }
    if (this.leader && this.leader.alive && this.leader !== this) {
      const d = Math.hypot(this.leader.x - this.x, this.leader.z - this.z);
      if (d > sp.social.radius * 0.6) {
        this.state = 'follow';
        this.goal = { x: this.leader.x + rand(-5, 5), z: this.leader.z + rand(-5, 5), speed: this.walkSpeed, stopDist: 2 };
        this.timer = 8;
        return;
      }
    }
    const roll = Math.random();
    if (roll < 0.35) {
      this.state = 'graze';
      this.goal = null;
      this.timer = rand(4, 9);
    } else if (roll < 0.45) {
      this.state = 'idle';
      this.goal = null;
      this.timer = rand(2, 5);
    } else if (roll < 0.7 && ctx.foodAt && !this.sea) {
      // Foraging: pick the richest of a few candidate spots and drift the home range towards it.
      let best = null;
      let bestFood = -1;
      for (let k = 0; k < 4; k++) {
        const angle = Math.random() * Math.PI * 2;
        const r = 8 + Math.random() * 18;
        const x = this.x + Math.cos(angle) * r;
        const z = this.z + Math.sin(angle) * r;
        const food = ctx.foodAt(x, z);
        if (food > bestFood) { bestFood = food; best = { x, z }; }
      }
      this.state = 'forage';
      this.goal = { x: best.x, z: best.z, speed: this.walkSpeed, stopDist: 1.5 };
      this.home.x += (best.x - this.home.x) * 0.3;
      this.home.z += (best.z - this.home.z) * 0.3;
      this.timer = 14;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 16;
      this.state = 'wander';
      this.goal = { x: this.home.x + Math.cos(angle) * r, z: this.home.z + Math.sin(angle) * r, speed: this.walkSpeed, stopDist: 1.2 };
      this.timer = 14;
    }
  }

  findThreat(ctx) {
    const sp = this.species;
    const p = ctx.player;
    if (p.alive) {
      const dist = Math.hypot(p.x - this.x, p.z - this.z);
      const sight = sp.perception.sight * ctx.difficulty.detectMultiplier;
      if (dist < 70 && (canSee(ctx.world, this, p, sight, sp.perception.fov) || canHear(this, p, sp.perception.hearing, p.noise))) {
        const alarmDist = 16 / this.traits.boldness;
        const alarmed = sp.temperament === 'timide' || p.noise > 0.5 || dist < alarmDist;
        if (alarmed && (p.noise > 0.2 || dist < alarmDist) && sp.temperament !== 'passif') return { x: p.x, z: p.z, isPlayer: true };
      }
    }
    for (const other of ctx.creatures) {
      if (!other.alive || other === this || !other.isPredator) continue;
      if (!other.species.prey?.includes(sp.id)) continue;
      if (other.sea !== this.sea && other.aquatic !== this.aquatic) continue;
      if (canSee(ctx.world, this, other, sp.perception.sight, sp.perception.fov)) {
        return { x: other.x, z: other.z, creature: other };
      }
    }
    return null;
  }

  setThreat(threat, ctx) {
    this.threat = threat;
    this.threatTimer = 4;
    for (const other of ctx.creatures) {
      if (other === this || !other.alive || other.isPredator || other.species.id !== this.species.id) continue;
      if (Math.hypot(other.x - this.x, other.z - this.z) < this.species.social.radius) {
        other.threat = threat;
        other.threatTimer = 3;
      }
    }
  }

  fleeFrom(threat, speed) {
    const dx = this.x - threat.x;
    const dz = this.z - threat.z;
    const dist = Math.hypot(dx, dz) || 1;
    this.goal = { x: this.x + (dx / dist) * 30, z: this.z + (dz / dist) * 30, speed, stopDist: 2 };
    this.timer = 1;
  }

  // ---- Predators --------------------------------------------------------

  /** Gives up the current hunt: the predator will not hunt again for a while. */
  abandonHunt(ctx, reason) {
    this.prey = null;
    this.goal = null;
    this.state = 'idle';
    this.huntTimer = 0;
    this.huntCooldown = 25;
    ctx.events.push({ type: 'abandon', species: this.species.id, reason });
  }

  thinkPredator(dt, ctx) {
    const sp = this.species;
    if (this.state === 'eat') {
      this.eatTimer -= dt;
      this.goal = null;
      if (this.eatTimer <= 0) this.state = 'idle';
      return;
    }
    // Wounded predators back off from whoever hurt them.
    if (this.hp < this.maxHp * 0.35 && this.provokedBy && this.provoked > 0) {
      this.state = 'flee';
      this.fleeFrom({ x: this.provokedBy.x ?? ctx.player.x, z: this.provokedBy.z ?? ctx.player.z }, this.runSpeed);
      this.prey = null;
      return;
    }
    const aggression = ctx.difficulty.predatorAggression;
    const giveUp = sp.giveUp ?? 14;
    const p = ctx.player;
    if (sp.temperament === 'agressif' && p.alive && !this.prey && this.huntCooldown <= 0) {
      const dist = Math.hypot(p.x - this.x, p.z - this.z);
      const sight = sp.perception.sight * aggression;
      const seen = dist < sight && canSee(ctx.world, this, p, sight, sp.perception.fov);
      const provoked = dist < 6 && p.noise > 0.2;
      const nearHome = Math.hypot(p.x - this.home.x, p.z - this.home.z) < (sp.territory ?? 60) + 25;
      if ((seen || provoked) && nearHome && this.reachable(ctx, p)) {
        this.prey = { kind: 'player' };
        this.state = 'hunt';
        this.huntTimer = 0;
      }
    }
    if (this.prey?.kind === 'player') {
      this.huntTimer += dt;
      const dist = Math.hypot(p.x - this.x, p.z - this.z);
      if (!p.alive || dist > sp.perception.sight * 1.4 || this.huntTimer > giveUp * 1.6 || !this.reachable(ctx, p)) {
        this.abandonHunt(ctx, 'player');
      } else {
        this.goal = { x: p.x, z: p.z, speed: this.runSpeed, stopDist: 1.8 };
        if (dist < 2.8 && this.attackCooldown <= 0) {
          this.attackCooldown = 1.6;
          this.attackTimer = 0.5;
          this.state = 'attack';
          ctx.damagePlayer(sp.damage * aggression);
        }
      }
      return;
    }

    if (!this.prey && this.hunger > 0.45 && this.huntCooldown <= 0) {
      const target = this.findPrey(ctx);
      if (target) {
        this.prey = target;
        this.state = 'hunt';
        this.huntTimer = 0;
        if (sp.pack) this.recruitPack(target, ctx);
      }
    }
    if (this.prey && this.prey.kind !== 'player') {
      const prey = this.prey;
      this.huntTimer += dt;
      const dist = Math.hypot(prey.x - this.x, prey.z - this.z);
      if (!prey.alive) {
        this.prey = null;
        this.state = 'idle';
        return;
      }
      if (this.huntTimer > giveUp || dist > sp.perception.sight * 1.3) {
        this.abandonHunt(ctx, 'prey escaped');
        return;
      }
      // Pack members approach from alternating flanks so that the prey is surrounded.
      let gx = prey.x;
      let gz = prey.z;
      if (sp.pack && dist > 6) {
        const side = (this.packSlot ?? 0) % 2 === 0 ? 1 : -1;
        const dx = prey.x - this.x;
        const dz = prey.z - this.z;
        const len = Math.hypot(dx, dz) || 1;
        gx += (-dz / len) * 4 * side;
        gz += (dx / len) * 4 * side;
      }
      this.goal = { x: gx, z: gz, speed: this.runSpeed * 0.9, stopDist: 1.6 };
      if (dist < 2.6 && this.attackCooldown <= 0) {
        this.attackCooldown = 1.1;
        this.attackTimer = 0.45;
        this.state = 'attack';
        if (prey.takeDamage(sp.damage * 1.6, this)) {
          ctx.events.push({ type: 'kill', victim: prey.species.id });
          this.state = 'eat';
          this.eatTimer = 9;
          this.hunger = 0;
          this.prey = null;
          this.goal = null;
        }
      }
      return;
    }

    if (this.goal && this.timer > 0) return;
    const dHome = Math.hypot(this.home.x - this.x, this.home.z - this.z);
    const territory = sp.territory ?? 60;
    if (dHome > territory * 1.3) {
      this.state = 'return';
      this.goal = { x: this.home.x, z: this.home.z, speed: this.walkSpeed, stopDist: 4 };
      this.timer = 20;
      return;
    }
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * territory * 0.8;
    this.state = 'patrol';
    this.goal = { x: this.home.x + Math.cos(angle) * r, z: this.home.z + Math.sin(angle) * r, speed: this.walkSpeed, stopDist: 2 };
    this.timer = 15;
  }

  /** Cheap reachability test: a land hunter cannot follow into deep water and a swimmer cannot leave it. */
  reachable(ctx, target) {
    const h = ctx.world.heightAt(target.x, target.z);
    if (this.sea) return h < WATER_LEVEL - 3;
    if (this.aquatic) return h < WATER_LEVEL + 1.5;
    return h > WATER_LEVEL - 1.2;
  }

  recruitPack(target, ctx) {
    let slot = 1;
    this.packSlot = 0;
    for (const other of ctx.creatures) {
      if (other === this || !other.alive || other.species.id !== this.species.id || other.prey) continue;
      if (Math.hypot(other.x - this.x, other.z - this.z) > 45) continue;
      other.prey = target;
      other.state = 'hunt';
      other.huntTimer = 0;
      other.packSlot = slot++;
    }
  }

  findPrey(ctx) {
    const preyIds = this.species.prey ?? [];
    let best = null;
    let bestDist = Infinity;
    for (const other of ctx.creatures) {
      if (!other.alive || other === this || !preyIds.includes(other.species.id)) continue;
      if ((other.sea || other.aquatic) !== (this.sea || this.aquatic) && !this.reachable(ctx, other)) continue;
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
  coarseStep(dt) {
    if (this.goal && this.timer > 0) return;
    this.timer = rand(6, 14);
    const angle = Math.random() * Math.PI * 2;
    this.goal = { x: this.home.x + Math.cos(angle) * 10, z: this.home.z + Math.sin(angle) * 10, speed: this.walkSpeed * 0.5, stopDist: 2 };
  }

  /** Steering and integration: turn towards the goal, avoid obstacles, move on (or in) the terrain. */
  move(dt, ctx) {
    const world = ctx.world;
    const fast = this.arch === 'flyer' || this.arch === 'floater' || this.arch === 'swarm' || this.sea;
    if (this.asleep || this.state === 'eat' || this.state === 'attack' || this.state === 'dead') {
      this.speed = Math.max(0, this.speed - 8 * dt);
    } else if (this.goal) {
      const dx = this.goal.x - this.x;
      const dz = this.goal.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= this.goal.stopDist) {
        if (!this.prey && this.state !== 'flee' && this.state !== 'hunt' && this.state !== 'charge') {
          this.goal = null;
          this.speed = Math.max(0, this.speed - 6 * dt);
        }
      }
      if (this.goal) {
        const desired = Math.atan2(dx, dz);
        const heading = chooseHeading(world, this.x, this.z, this.y, desired, {
          aquatic: this.aquatic, minDepth: this.sea ? 5 : 0.2, maxSlope: fast ? 3 : 0.75
        });
        const blocked = heading === null;
        const target = blocked ? desired + Math.PI * 0.5 : heading;
        const delta = angleDelta(this.yaw, target);
        const turn = Math.sign(delta) * Math.min(Math.abs(delta), 3.2 * dt);
        this.yaw += turn;
        const aligned = Math.max(0, 1 - Math.abs(delta) / 1.2);
        const targetSpeed = blocked ? 0 : this.goal.speed * aligned;
        this.speed += clamp(targetSpeed - this.speed, -5 * dt, 3 * dt);
        // Stuck detection: an action that cannot make progress is abandoned.
        if (this.speed < 0.25 && dist > 4) this.stuck += dt;
        else this.stuck = Math.max(0, this.stuck - dt);
        if (this.stuck > 4) {
          this.stuck = 0;
          this.goal = null;
          this.timer = 0;
          if (this.prey) this.abandonHunt(ctx, 'blocked');
          if (ctx.events) ctx.events.push({ type: 'stuck', species: this.species.id });
        }
      }
    } else {
      this.speed = Math.max(0, this.speed - 4 * dt);
      this.stuck = 0;
    }

    const step = this.speed * dt;
    this.x += Math.sin(this.yaw) * step;
    this.z += Math.cos(this.yaw) * step;
    world.resolveCollisions(this, 0.5);
    const ground = world.heightAt(this.x, this.z);
    this.stride += this.speed * dt * 1.4;
    if (this.sea) {
      // Swimmers hold a personal depth between the sea floor and the surface.
      const top = WATER_LEVEL - 2.2;
      const floor = ground + 1.0;
      this.y = Math.max(ground + 0.6, floor + Math.max(0, top - floor) * this.depthPref + Math.sin(this.stride * 0.4) * 0.4);
    } else if (HOVER[this.arch]) {
      this.y = ground + HOVER[this.arch] + Math.sin(this.stride * 0.3 + this.depthPref * 6) * (this.arch === 'flyer' ? 1.2 : 0.4);
    } else {
      this.y = ground;
    }
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
   * @param options { scene, world, content, difficulty, damagePlayer, foodAt?, weatherSeverity? }
   */
  constructor(options) {
    this.scene = options.scene;
    this.world = options.world;
    this.content = options.content;
    this.difficulty = options.difficulty;
    this.damagePlayer = options.damagePlayer;
    this.foodAt = options.foodAt;
    this.creatures = [];
    this.events = [];
    this.spawnedChunks = new Set();
    this.activeViews = 0;
    this.frame = 0;
  }

  /** Called by the world when a chunk with fauna spawns becomes active. */
  onChunkReady(chunk) {
    if (chunk.lod !== 0 || this.spawnedChunks.has(chunk.key)) return;
    this.spawnedChunks.add(chunk.key);
    const groups = new Map();
    for (const spawn of chunk.spawns) {
      const species = this.content.speciesById[spawn.species];
      if (!species) continue;
      this.add(spawn, species, groups);
    }
  }

  /** Adds a creature (also used for dynamic events). Returns it, or null when the cap is reached. */
  add(spawn, species, groups = null) {
    if (this.creatures.length >= MAX_CREATURES) return null;
    const creature = new Creature(spawn, species, this.world);
    const leader = groups?.get(species.id);
    if (leader) {
      creature.leader = leader;
    } else {
      creature.isLeader = true;
      creature.leader = creature;
      groups?.set(species.id, creature);
    }
    this.creatures.push(creature);
    return creature;
  }

  onChunkRemoved(chunk) {
    this.spawnedChunks.delete(chunk.key);
  }

  update(dt, playerState, daylight, scene, weatherSeverity = 0) {
    this.frame++;
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
      weather: { severity: weatherSeverity },
      foodAt: this.foodAt,
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
    ctx.creatures = this.creatures;

    // Level of detail for simulation: full rate close by, every 3rd frame in the middle ring,
    // and a slow coarse wander (2 Hz) beyond COARSE_RADIUS.
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      const d = Math.hypot(c.x - px, c.z - pz);
      ctx.coarse = c.alive && d > COARSE_RADIUS;
      c.simAccum = (c.simAccum ?? 0) + dt;
      const interval = !c.alive || d < MID_RADIUS ? 0 : ctx.coarse ? 0.5 : 0.05;
      if (c.simAccum >= interval) {
        c.think(c.simAccum, ctx);
        c.simAccum = 0;
      }
      if (d < VIEW_RADIUS && !c.view) this.addView(c, scene);
      if (d > VIEW_RADIUS + 25 && c.view) this.removeView(c, scene);
      if (c.view) c.view.update(dt, c);
    }
  }

  addView(creature, scene) {
    creature.view = createCreatureView(creature.species, creature.traits);
    creature.view.root.userData.creature = creature;
    scene.add(creature.view.root);
    this.activeViews++;
  }

  removeView(creature, scene) {
    if (!creature.view) return;
    scene.remove(creature.view.root);
    creature.view.dispose?.();
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
