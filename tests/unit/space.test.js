import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadContent } from '../../src/world/content.js';
import { SpaceSession } from '../../src/space/spaceSession.js';

const content = loadContent();
const ctl = (o = {}) => ({ throttle: 0, yaw: 0, pitch: 0, roll: 0, boost: false, cruise: false, stop: false, fire: false, scan: false, nav: false, land: false, interact: false, ...o });
const make = (planet = 'genesis') => {
  const s = new SpaceSession({ shipConfig: content.vehicles.ship, seed: 5 });
  s.enterOrbit(planet);
  return s;
};
const run = (s, c, seconds, dt = 1 / 30) => { const ev = []; for (let t = 0; t < seconds; t += dt) ev.push(...s.update(dt, c)); return ev; };
const place = (s, id, offset = [0, 0, 0]) => { s.ship.pos.copy(s.byId[id].pos).add(new THREE.Vector3(...offset)); s.ship.vel.set(0, 0, 0); };

describe('space session', () => {
  it('starts in orbit above the planet, at rest', () => {
    const s = make();
    expect(s.altitudeOver('genesis')).toBeGreaterThan(400);
    expect(s.altitudeOver('genesis')).toBeLessThan(700);
    expect(s.speed).toBe(0);
  });

  it('accelerates with throttle, with inertia, and stops on demand', () => {
    const s = make();
    s.ship.q.identity();
    run(s, ctl({ throttle: 1 }), 3);
    expect(s.ship.throttle).toBeGreaterThan(0.9);
    expect(s.speed).toBeGreaterThan(50);
    run(s, ctl({ stop: true }), 4);
    expect(s.speed).toBeLessThan(1);
  });

  it('turns with yaw and pitch inputs', () => {
    const s = make();
    const f0 = s.forward;
    run(s, ctl({ yaw: 1 }), 1);
    expect(s.forward.angleTo(f0)).toBeGreaterThan(0.5);
  });

  it('refuses cruise near a planet and allows it in open space, consuming energy', () => {
    const s = make();
    run(s, ctl({ throttle: 1, cruise: true }), 1);
    expect(s.cruising).toBe(false);
    place(s, 'field', [0, 6000, 0]);
    s.ship.q.identity();
    const e0 = s.ship.energy;
    run(s, ctl({ cruise: true }), 4);
    expect(s.cruising).toBe(true);
    expect(s.speed).toBeGreaterThan(300);
    expect(s.ship.energy).toBeLessThan(e0);
  });

  it('crossing to Cryos takes tens of seconds, not an instant', () => {
    const s = make();
    place(s, 'genesis', [0, 4200, 0]);
    s.ship.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), s.byId.cryos.pos.clone().sub(s.ship.pos).normalize());
    const start = s.ship.pos.distanceTo(s.byId.cryos.pos);
    run(s, ctl({ cruise: true }), 5);
    expect(s.ship.pos.distanceTo(s.byId.cryos.pos)).toBeGreaterThan(start * 0.8);
    expect(start / s.cfg.cruiseSpeed).toBeGreaterThan(40);
  });

  it('collides with planets and asteroids, losing hull', () => {
    const s = make();
    place(s, 'genesis', [0, 3045, 0]);
    s.ship.vel.set(0, -200, 0);
    run(s, ctl(), 0.5);
    expect(s.altitudeOver('genesis')).toBeGreaterThanOrEqual(0);
    expect(s.ship.hull).toBeLessThan(s.cfg.hull);
    const rock = s.field.rocks.find((r) => r.alive);
    const fp = s.byId.field.pos;
    const fresh = make();
    fresh.ship.pos.set(fp.x + rock.x + rock.radius + 30, fp.y + rock.y, fp.z + rock.z);
    fresh.ship.vel.set(-120, 0, 0);
    run(fresh, ctl(), 1);
    expect(fresh.ship.hull).toBeLessThan(fresh.cfg.hull);
  });

  it('mines asteroids with the laser and returns cargo', () => {
    const s = make();
    const fp = s.byId.field.pos;
    const rock = s.field.rocks.reduce((best, r) => (r.radius < best.radius ? r : best));
    s.ship.pos.set(fp.x + rock.x, fp.y + rock.y, fp.z + rock.z + 150);
    s.ship.q.identity();
    s.ship.vel.set(0, 0, 0);
    const events = run(s, ctl({ fire: true }), 6);
    expect(events.some((e) => e.type === 'laser')).toBe(true);
    const cargo = events.find((e) => e.type === 'cargo');
    expect(cargo).toBeDefined();
    expect(['ore_metal', 'mineral_silicate', 'rare_crystal']).toContain(cargo.item);
    expect(rock.alive).toBe(false);
  });

  it('docks only when close and slow, repairs and recharges there, and undocks', () => {
    const s = make();
    place(s, 'station', [0, 124, 0]);
    s.ship.vel.set(0, 80, 0);
    expect(s.dockAvailable()).toBe(false);
    s.ship.vel.set(0, 5, 0);
    expect(s.dockAvailable()).toBe(true);
    s.ship.hull = 50;
    s.ship.energy = 20;
    expect(run(s, ctl({ land: true }), 1 / 30).some((e) => e.type === 'dock')).toBe(true);
    run(s, ctl(), 20);
    expect(s.ship.hull).toBe(s.cfg.hull);
    expect(s.ship.energy).toBe(s.cfg.energy);
    expect(run(s, ctl({ land: true }), 1 / 30).some((e) => e.type === 'undock')).toBe(true);
    expect(s.docked).toBe(false);
  });

  it('offers landing on landable planets only, when low and slow', () => {
    const s = make();
    expect(s.landingCandidate()).toBeNull();
    place(s, 'genesis', [0, 3200, 0]);
    expect(s.landingCandidate()?.id).toBe('genesis');
    expect(run(s, ctl({ land: true }), 1 / 30).find((e) => e.type === 'land').planet).toBe('genesis');
    place(s, 'cryos', [0, 2800, 0]);
    expect(s.landingCandidate()?.id).toBe('cryos');
    place(s, 'pallas', [0, 700, 0]);
    expect(s.landingCandidate()).toBeNull();
  });

  it('salvages the wreck once and scans what is in the crosshair', () => {
    const s = make();
    place(s, 'wreck', [0, 0, 60]);
    expect(s.wreckAvailable()).toBe(true);
    const ev = run(s, ctl({ interact: true }), 1 / 30);
    expect(ev.find((e) => e.type === 'salvage').loot.length).toBeGreaterThan(0);
    expect(s.wreckAvailable()).toBe(false);
    const a = make();
    place(a, 'anomaly', [0, 0, 400]);
    a.ship.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1));
    const scan = run(a, ctl({ scan: true }), 1 / 30).find((e) => e.type === 'scan');
    expect(scan.target?.id).toBe('anomaly');
  });

  it('reports reaching orbit once', () => {
    const s = make();
    const first = run(s, ctl(), 0.2);
    expect(first.filter((e) => e.type === 'orbit')).toHaveLength(1);
    expect(run(s, ctl(), 1).filter((e) => e.type === 'orbit')).toHaveLength(0);
  });

  it('round-trips its state', () => {
    const s = make();
    s.ship.energy = 77;
    s.salvaged.add('wreck');
    s.destroyRock(3);
    const copy = new SpaceSession({ shipConfig: content.vehicles.ship, seed: 5, state: JSON.parse(JSON.stringify(s.toJSON())) });
    expect(copy.ship.energy).toBe(77);
    expect(copy.salvaged.has('wreck')).toBe(true);
    expect(copy.field.rocks[3].alive).toBe(false);
  });
});
