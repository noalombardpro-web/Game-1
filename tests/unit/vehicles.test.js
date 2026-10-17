import { describe, it, expect } from 'vitest';
import { loadContent } from '../../src/world/content.js';
import { Vehicle, VehicleManager } from '../../src/vehicles/vehicle.js';
import { WATER_LEVEL } from '../../src/world/terrain.js';

const content = loadContent();
const scene = { add() {}, remove() {} };
const makeWorld = (heightAt, colliders = []) => ({
  heightAt,
  resolveCollisions(pos, radius) {
    for (const [cx, cz, r] of colliders) {
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const min = r + radius;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 1e-6) { pos.x += (dx / d) * (min - d); pos.z += (dz / d) * (min - d); }
    }
    return pos;
  }
});
const keys = (...down) => ({ isDown: (a) => down.includes(a), pressed: () => false });
const make = (type, world, x = 0, z = 0) => new Vehicle('t', type, content.vehicles[type], scene, world, x, z, 0);
const run = (v, input, seconds, env = {}) => { for (let t = 0; t < seconds; t += 1 / 30) v.update(1 / 30, input, env); };

describe('ground vehicles', () => {
  const flat = makeWorld(() => 20);

  it('accelerates with inertia and stops with drag', () => {
    const v = make('rover', flat);
    run(v, keys('move_forward'), 2);
    expect(v.speed).toBeGreaterThan(5);
    expect(v.speed).toBeLessThan(v.cfg.maxSpeed);
    const z = v.z;
    run(v, null, 1);
    expect(v.z).toBeGreaterThan(z);
    run(v, null, 15);
    expect(v.speed).toBeLessThan(0.1);
  });

  it('the buggy is faster than the rover, which is faster than the transport', () => {
    const top = (type) => { const v = make(type, flat); run(v, keys('move_forward'), 12); return v.speed; };
    expect(top('buggy')).toBeGreaterThan(top('rover'));
    expect(top('rover')).toBeGreaterThan(top('transport'));
  });

  it('consumes energy only while the throttle is applied, and cannot move without energy', () => {
    const v = make('rover', flat);
    run(v, null, 2);
    expect(v.energy).toBe(v.cfg.energy);
    run(v, keys('move_forward'), 2);
    expect(v.energy).toBeLessThan(v.cfg.energy);
    v.energy = 0;
    v.speed = 0;
    run(v, keys('move_forward'), 2);
    expect(v.speed).toBeLessThan(0.5);
  });

  it('steers, and slopes slow it down', () => {
    const v = make('rover', flat);
    v.speed = 10;
    run(v, keys('move_left'), 1);
    expect(v.yaw).toBeGreaterThan(0.3);
    const hill = makeWorld((x, z) => 20 + z * 0.4);
    const up = make('rover', hill);
    run(up, keys('move_forward'), 6);
    const level = make('rover', flat);
    run(level, keys('move_forward'), 6);
    expect(up.speed).toBeLessThan(level.speed);
  });

  it('is stopped by obstacles and takes damage in hard impacts (light vehicles more)', () => {
    const rock = makeWorld(() => 20, [[0, 12, 1.5]]);
    const rover = make('rover', rock);
    const buggy = make('buggy', rock);
    for (const v of [rover, buggy]) { v.speed = 14; run(v, keys('move_forward'), 3); }
    expect(rover.z).toBeLessThan(12);
    expect(rover.hull).toBeLessThan(rover.cfg.hull);
    expect(buggy.cfg.hull - buggy.hull).toBeGreaterThan((rover.cfg.hull - rover.hull) * 0.6);
  });

  it('follows the terrain (no floating, no sinking) and tilts on slopes', () => {
    const hill = makeWorld((x, z) => 20 + z * 0.3);
    const v = make('rover', hill, 0, 10);
    run(v, null, 1);
    expect(Math.abs(v.y - hill.heightAt(v.x, v.z))).toBeLessThan(0.6);
    expect(Math.abs(v.pitch)).toBeGreaterThan(0.1);
  });

  it('can be repaired and recharged, and is disabled at zero hull', () => {
    const v = make('rover', flat);
    v.hull = 0;
    expect(v.disabled).toBe(true);
    v.repair(50);
    expect(v.disabled).toBe(false);
    v.energy = 10;
    expect(v.recharge(1000)).toBeCloseTo(v.cfg.energy - 10);
  });
});

describe('air vehicles', () => {
  const flat = makeWorld(() => 20);

  it('takes off vertically, hovers and lands', () => {
    const v = make('aircraft', flat);
    run(v, keys('jump'), 3);
    expect(v.altitude).toBeGreaterThan(8);
    expect(v.landed).toBe(false);
    run(v, null, 2);
    const hover = v.altitude;
    expect(hover).toBeGreaterThan(8);
    run(v, keys('crouch'), 8);
    expect(v.landed).toBe(true);
    expect(v.canExit().ok).toBe(true);
  });

  it('refuses to let the pilot out in flight', () => {
    const v = make('drone', flat);
    run(v, keys('jump'), 2);
    expect(v.canExit().ok).toBe(false);
  });

  it('crashes without energy and takes impact damage', () => {
    const v = make('aircraft', flat);
    run(v, keys('jump'), 3);
    v.energy = 0;
    run(v, null, 6);
    expect(v.landed).toBe(true);
    expect(v.hull).toBeLessThan(v.cfg.hull);
  });

  it('stays below its ceiling and flies forward with bank', () => {
    const v = make('drone', flat);
    run(v, keys('jump'), 30);
    expect(v.altitude).toBeLessThanOrEqual(v.cfg.maxAltitude + 0.5);
    run(v, keys('move_forward'), 2);
    expect(v.z).toBeGreaterThan(5);
    run(v, keys('move_forward', 'move_left'), 0.6);
    expect(Math.abs(v.roll)).toBeGreaterThan(0.02);
  });

  it('is pushed by wind and shaken by storms (drone more than aircraft)', () => {
    const drift = (type) => { const v = make(type, flat); run(v, keys('jump'), 2); const x = v.x; run(v, null, 3, { windX: 1, windZ: 0, windStrength: 2 }); return v.x - x; };
    expect(drift('drone')).toBeGreaterThan(drift('aircraft'));
  });
});

describe('submarine', () => {
  const sea = makeWorld((x) => (x < 100 ? WATER_LEVEL - 40 : 30));

  it('dives and rises, stays inside the water volume', () => {
    const v = make('submarine', sea);
    run(v, keys('crouch'), 4);
    expect(v.depth).toBeGreaterThan(5);
    run(v, keys('jump'), 8);
    expect(v.depth).toBeLessThan(2);
  });

  it('cannot be driven onto land', () => {
    const v = make('submarine', sea, 90, 0);
    v.yaw = Math.PI / 2;
    run(v, keys('move_forward'), 10);
    expect(v.x).toBeLessThan(100);
  });

  it('floats up when unoccupied and only lets the pilot out at the surface', () => {
    const v = make('submarine', sea);
    run(v, keys('crouch'), 4);
    expect(v.canExit().ok).toBe(false);
    run(v, null, 20);
    expect(v.canExit().ok).toBe(true);
  });
});

describe('vehicle manager', () => {
  it('finds the nearest vehicle and round-trips its state', () => {
    const world = makeWorld(() => 20);
    const mgr = new VehicleManager(scene, world, content.vehicles);
    const a = mgr.add('rover', 0, 0);
    mgr.add('buggy', 30, 0);
    expect(mgr.nearest(2, 0, 5)).toBe(a);
    expect(mgr.nearest(15, 0, 5)).toBeNull();
    a.hull = 33;
    const copy = new VehicleManager(scene, world, content.vehicles);
    copy.restore(JSON.parse(JSON.stringify(mgr.toJSON())));
    expect(copy.list).toHaveLength(2);
    expect(copy.list[0].hull).toBe(33);
  });
});
