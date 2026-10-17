import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadContent } from '../../src/world/content.js';
import { Enemy, EnemyManager } from '../../src/entities/enemies.js';
import { Creature } from '../../src/entities/creatures.js';

const content = loadContent();
const flatWorld = {
  heightAt: () => 20,
  collidersNear: () => [],
  resolveCollisions: (pos) => pos
};
const normal = content.enemies.difficulty.normal;

function makeManager(damagePlayer = () => {}) {
  const effects = { beam: vi.fn(), burst: vi.fn() };
  const manager = new EnemyManager({
    scene: { add() {}, remove() {} }, content, world: flatWorld, difficulty: normal, damagePlayer, effects, seed: 5
  });
  return { manager, effects };
}

function spawnDrone(manager, x = 0, z = 0, yaw = 0) {
  manager.spawnForPoint({ id: 'p', x, z }, { type: 'sentinel_drone', count: 1, offset: 6 });
  const drone = manager.enemies[0];
  drone.x = x;
  drone.z = z;
  drone.y = 24.5;
  drone.yaw = yaw;
  // Short route straight ahead so the drone keeps facing +Z during the test.
  drone.patrol = [{ x, z: z + 1 }, { x, z: z + 2 }];
  return drone;
}

const player = (x, z, extra = {}) => ({ x, y: 20, z, yaw: 0, noise: 0.5, alive: true, crouched: false, ...extra });
const run = (manager, p, seconds, dt = 0.1) => { for (let t = 0; t < seconds; t += dt) manager.update(dt, p); };

afterEach(() => vi.restoreAllMocks());

describe('sentinel drone AI', () => {
  it('patrols and ignores a player behind it, out of sight and silent', () => {
    const { manager } = makeManager();
    const drone = spawnDrone(manager, 0, 0, 0); // faces +Z
    run(manager, player(0, -30, { noise: 0 }), 5);
    expect(drone.fsm.current).toBe('patrol');
    expect(drone.detect).toBe(0);
  });

  it('detects a visible player progressively, alerts, then enters combat and fires', () => {
    const hits = [];
    const { manager, effects } = makeManager((d) => hits.push(d));
    const drone = spawnDrone(manager, 0, 0, 0);
    const p = player(0, 25);
    const seen = [];
    for (let t = 0; t < 12; t += 0.1) {
      manager.update(0.1, p);
      if (seen[seen.length - 1] !== drone.fsm.current) seen.push(drone.fsm.current);
    }
    expect(seen).toContain('alert');
    expect(seen).toContain('combat');
    expect(seen.indexOf('alert')).toBeLessThan(seen.indexOf('combat'));
    expect(effects.beam).toHaveBeenCalled();
  });

  it('does not damage a player it cannot see', () => {
    const hits = [];
    const { manager } = makeManager((d) => hits.push(d));
    spawnDrone(manager, 0, 0, 0);
    run(manager, player(0, -35, { noise: 0 }), 20);
    expect(hits).toHaveLength(0);
  });

  it('searches the last known position after losing sight, then resumes patrol', () => {
    const { manager } = makeManager();
    const drone = spawnDrone(manager, 0, 0, 0);
    run(manager, player(0, 20), 6);
    expect(drone.fsm.current).toBe('combat');
    // The player vanishes (far away and silent): the drone must not track the real position.
    const gone = player(0, -300, { noise: 0 });
    run(manager, gone, 5);
    expect(['search', 'combat']).toContain(drone.fsm.current);
    expect(drone.lastKnown.z).toBeGreaterThan(0);
    run(manager, gone, 25);
    expect(drone.fsm.current).toBe('patrol');
  });

  it('raises the alarm for allies of the same group', () => {
    const { manager } = makeManager();
    manager.spawnForPoint({ id: 'p', x: 0, z: 0 }, { type: 'sentinel_drone', count: 2, offset: 6 });
    const [a, b] = manager.enemies;
    for (const [e, x] of [[a, 0], [b, 8]]) { e.x = x; e.z = 0; e.yaw = 0; e.y = 24.5; e.patrol = [{ x, z: 0 }, { x, z: 1 }]; }
    b.yaw = Math.PI; // b looks away and sees nothing itself
    run(manager, player(0, 25), 4);
    expect(['alert', 'combat']).toContain(b.fsm.current);
  });

  it('retreats at low health and can be destroyed by player hits', () => {
    const { manager } = makeManager();
    const drone = spawnDrone(manager, 0, 0, 0);
    drone.hp = drone.maxHp * 0.2;
    drone.fsm.set('combat');
    drone.lastKnown = { x: 0, y: 20, z: 20 };
    run(manager, player(0, 20), 1);
    expect(drone.fsm.current).toBe('retreat');
    const destroyed = manager.hit(drone, 500);
    expect(destroyed).toBe(true);
    expect(drone.alive).toBe(false);
    expect(manager.drainLoot()[0].item).toBe('ore_metal');
  });

  it('builds a visual for a turret and a drone near the player without crashing', () => {
    const { manager } = makeManager();
    manager.spawnForPoint({ id: 'q', x: 0, z: 0 }, { type: 'ruin_turret', count: 1, offset: 10 });
    manager.spawnForPoint({ id: 'q', x: 0, z: 0 }, { type: 'sentinel_drone', count: 1, offset: 10 });
    expect(() => run(manager, player(0, 15), 1)).not.toThrow();
    expect(manager.enemies.every((e) => e.view !== null)).toBe(true);
  });

  it('keeps static turrets in place', () => {
    const { manager } = makeManager();
    manager.spawnForPoint({ id: 'q', x: 0, z: 0 }, { type: 'ruin_turret', count: 1, offset: 10 });
    const turret = manager.enemies[0];
    const start = { x: turret.x, z: turret.z };
    run(manager, player(start.x, start.z + 15), 10);
    expect(Math.hypot(turret.x - start.x, turret.z - start.z)).toBeLessThan(0.01);
  });
});

describe('fauna AI', () => {
  const species = content.speciesById;
  const baseCtx = (extra = {}) => ({
    world: flatWorld, daylight: 1, creatures: [], events: [],
    difficulty: normal, damagePlayer: vi.fn(), coarse: false,
    player: { x: 500, y: 20, z: 500, yaw: 0, noise: 0, alive: true },
    ...extra
  });
  const make = (id, x, z, yaw = 0) => new Creature({ id: `${id}:${x}:${z}`, species: id, x, z, yaw }, species[id], flatWorld);

  it('a herbivore flees from a noisy player in sight', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const prey = make('lumifer', 0, 0, 0);
    const ctx = baseCtx({ player: { x: 0, y: 20, z: 12, yaw: 0, noise: 1, alive: true } });
    ctx.creatures = [prey];
    for (let i = 0; i < 30; i++) prey.think(0.1, ctx);
    expect(prey.state).toBe('flee');
    expect(prey.z).toBeLessThan(0);
    expect(prey.speed).toBeGreaterThan(1);
  });

  it('a nocturnal species sleeps during the day', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const c = make('nocturne', 0, 0);
    const ctx = baseCtx();
    ctx.creatures = [c];
    for (let i = 0; i < 20; i++) c.think(0.1, ctx);
    expect(c.asleep).toBe(true);
    ctx.daylight = 0;
    for (let i = 0; i < 20; i++) c.think(0.1, ctx);
    expect(c.asleep).toBe(false);
  });

  it('a hungry predator hunts a visible prey and kills it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const predator = make('tyrannoraptor', 0, 0, 0);
    predator.hunger = 1;
    const prey = make('velox', 0, 15, 0);
    prey.hp = 20;
    const ctx = baseCtx({ creatures: [predator, prey] });
    for (let i = 0; i < 200 && prey.alive; i++) {
      predator.think(0.1, ctx);
      // The prey stands still here: only the predator behaviour is under test.
      prey.goal = null; prey.threatTimer = 0; prey.speed = 0;
    }
    expect(prey.alive).toBe(false);
    expect(ctx.events.some((e) => e.type === 'kill')).toBe(true);
    expect(predator.state).toBe('eat');
  });

  it('an aggressive predator attacks a player who comes close', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const predator = make('tyrannoraptor', 0, 0, 0);
    const ctx = baseCtx({ player: { x: 0, y: 20, z: 6, yaw: 0, noise: 0.6, alive: true } });
    ctx.creatures = [predator];
    for (let i = 0; i < 60; i++) predator.think(0.1, ctx);
    expect(ctx.damagePlayer).toHaveBeenCalled();
  });

  it('avoids water: land animals do not steer into a lake', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const lakeWorld = { ...flatWorld, heightAt: (x) => (x > 10 ? 2 : 20) };
    const c = new Creature({ id: 'a', species: 'lumifer', x: 0, z: 0, yaw: Math.PI / 2 }, species.lumifer, lakeWorld);
    c.goal = { x: 100, z: 0, speed: 3, stopDist: 1 };
    c.timer = 99;
    const ctx = baseCtx({ world: lakeWorld });
    ctx.creatures = [c];
    for (let i = 0; i < 100; i++) {
      c.goal = { x: 100, z: 0, speed: 3, stopDist: 1 };
      c.move(0.1, ctx);
    }
    expect(c.x).toBeLessThan(13);
  });
});
