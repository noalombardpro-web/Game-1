import { describe, it, expect } from 'vitest';
import { loadContent } from '../../src/world/content.js';
import { BaseManager, canPlace } from '../../src/bases/bases.js';
import { Inventory } from '../../src/systems/inventory.js';

const content = loadContent();
const scene = { add() {}, remove() {} };
const makeWorld = (heightAt = () => 20) => {
  const world = {
    dyn: new Float32Array(0), heightAt,
    setDynamicColliders(a) { this.dyn = a; },
    collidersNear() { return [this.dyn]; }
  };
  return world;
};
const manager = (world = makeWorld()) => new BaseManager({ scene, world, data: content.structures });
const rich = () => new Inventory({ ...content, capacity: 500 }, { counts: { ore_metal: 80, electronic_part: 40, fiber: 30, mineral_silicate: 20, crystal_energy: 12, rare_crystal: 5, deep_pearl: 3 } });

describe('placement rules', () => {
  const defs = content.structures.structures;

  it('accepts flat dry ground and rejects water, slopes, overlaps and obstacles', () => {
    const flat = makeWorld();
    expect(canPlace(flat, [], defs, 'habitat', 0, 0).ok).toBe(true);
    expect(canPlace(makeWorld(() => 2), [], defs, 'habitat', 0, 0).reason).toMatch(/immergé/);
    expect(canPlace(makeWorld((x) => 20 + x * 0.8), [], defs, 'habitat', 0, 0).reason).toMatch(/pente/);
    const m = manager(flat);
    m.add('habitat', 0, 0, 0);
    expect(canPlace(flat, m.list, defs, 'habitat', 4, 0).reason).toMatch(/proche/);
    expect(canPlace(flat, m.list, defs, 'habitat', 20, 0).ok).toBe(true);
    const tree = makeWorld();
    tree.dyn = new Float32Array([30, 0, 1]);
    expect(canPlace(tree, [], defs, 'habitat', 30, 0).reason).toMatch(/Obstacle/);
  });

  it('charges the cost, refuses unaffordable builds, refunds 60 % when dismantled', () => {
    const m = manager();
    const inv = new Inventory(content, { counts: { ore_metal: 5 } });
    expect(m.place(inv, 'generator', 0, 0, 0).ok).toBe(false);
    const full = rich();
    const before = full.count('ore_metal');
    const placed = m.place(full, 'generator', 0, 0, 0);
    expect(placed.ok).toBe(true);
    expect(full.count('ore_metal')).toBe(before - 5);
    const { refund } = m.dismantle(full, placed.structure);
    expect(refund.ore_metal).toBe(3);
    expect(m.list).toHaveLength(0);
  });

  it('structures are solid: they publish colliders to the world', () => {
    const world = makeWorld();
    const m = manager(world);
    m.add('storage', 10, 5, 0);
    expect(world.dyn[0]).toBe(10);
    expect(world.dyn[1]).toBe(5);
    expect(world.dyn[2]).toBeCloseTo(content.structures.structures.storage.radius, 4);
  });
});

describe('power, stations and services', () => {
  it('consumers need a generator in the same network', () => {
    const m = manager();
    const lab = m.add('lab', 0, 0, 0);
    m.updatePower();
    expect(lab.powered).toBe(false);
    const gen = m.add('generator', 20, 0, 0);
    m.updatePower();
    expect(lab.powered).toBe(true);
    expect(gen.networkSupply).toBe(24);
    const far = m.add('workbench', 500, 0, 0);
    m.updatePower();
    expect(far.powered).toBe(false);
  });

  it('overloading a network cuts the consumers, and upgrading the generator restores them', () => {
    const m = manager();
    const gen = m.add('generator', 0, 0, 0);
    m.add('lab', 20, 0, 0);
    m.add('pad', 40, 0, 0);
    m.add('garage', 0, 30, 0);
    m.add('comm', 30, 30, 0);
    m.updatePower();
    expect(m.list.find((s) => s.typeId === 'lab').powered).toBe(false);
    const inv = rich();
    expect(m.upgrade(inv, gen).ok).toBe(true);
    m.updatePower();
    expect(m.list.find((s) => s.typeId === 'lab').powered).toBe(true);
    expect(m.upgrade(inv, gen).ok).toBe(false);
  });

  it('provides the best powered station nearby for crafting', () => {
    const m = manager();
    m.add('generator', 0, 0, 0);
    m.add('workbench', 8, 0, 0);
    m.updatePower();
    expect(m.bestStation(8, 2)).toBe('workbench');
    expect(m.bestStation(300, 0)).toBe('hand');
    m.add('lab', 20, 0, 0);
    m.updatePower();
    expect(m.bestStation(14, 0)).toBe('lab');
    const inv = rich();
    const recipe = content.recipes.find((r) => r.id === 'craft_module_armor_2');
    expect(inv.craft(recipe, 'workbench').ok).toBe(false);
    inv.add('magma_core', 1);
    expect(inv.craft(recipe, 'lab').ok).toBe(true);
    expect(inv.modules.armor).toBe('module_armor_2');
  });

  it('habitat heals the robot, garage repairs vehicles, turret shoots enemies', () => {
    const world = makeWorld();
    const m = manager(world);
    m.add('generator', 0, 0, 0);
    m.add('habitat', 12, 0, 0);
    m.add('garage', -14, 0, 0);
    m.add('turret', 0, 14, 0);
    const robot = { repair: (n) => { robot.integrity += n; }, recharge: (n) => { robot.energy += n; }, repairTools: () => {}, integrity: 50, energy: 50 };
    const vehicle = { x: -14, z: 6, hull: 10, energy: 10, repair(n) { this.hull += n; }, recharge(n) { this.energy += n; } };
    const hits = [];
    const enemy = { alive: true, x: 0, y: 3, z: 30 };
    const ctx = {
      dt: 1, player: { x: 12, z: 0, robot }, vehicles: { list: [vehicle] }, mounted: null,
      enemies: { enemies: [enemy], hit: (e, d) => hits.push(d) }, creatures: { creatures: [] },
      effects: { beam() {} }
    };
    m.update(ctx);
    expect(robot.integrity).toBeGreaterThan(50);
    expect(vehicle.hull).toBeGreaterThan(10);
    expect(hits).toEqual([16]);
  });

  it('storage keeps contents across a save and respects capacity upgrades', () => {
    const m = manager();
    const s = m.add('storage', 0, 0, 0);
    s.storage = { ore_metal: 30 };
    expect(s.capacity).toBe(200);
    m.upgrade(rich(), s);
    expect(s.capacity).toBe(400);
    const copy = manager();
    copy.restore(JSON.parse(JSON.stringify(m.toJSON())));
    expect(copy.list[0].storage.ore_metal).toBe(30);
    expect(copy.list[0].level).toBe(2);
  });
});
