import { describe, it, expect } from 'vitest';
import { loadContent } from '../../src/world/content.js';
import { Inventory } from '../../src/systems/inventory.js';
import { Missions } from '../../src/systems/missions.js';
import { RobotState, thermalTarget } from '../../src/systems/survival.js';
import { SaveManager, validateSave, checksum, SAVE_VERSION } from '../../src/systems/save.js';
import { canSee, canHear } from '../../src/ai/perception.js';
import { chooseHeading, angleDelta } from '../../src/ai/navigation.js';
import { StateMachine } from '../../src/ai/fsm.js';
import { raySphere } from '../../src/systems/raycast.js';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../../src/app/settings.js';

const content = loadContent();

/** In-memory storage with the same interface as localStorage. */
function memoryStorage(failOn = null) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failOn && k === failOn) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k)
  };
}

const baseState = () => ({
  seed: 77,
  difficulty: 'normal',
  player: { x: 12, z: -4, yaw: 1 },
  robot: { energy: 80, integrity: 60, temperature: 20 },
  inventory: { counts: { ore_metal: 3 }, modules: {} },
  missions: { index: 1, progress: {}, completed: ['signal'] },
  codex: { species: ['lumifer'], points: [] },
  collected: ['0:0:1'],
  rover: { x: 5, z: 5, yaw: 0, energy: 50, hull: 90 },
  clock: { timeOfDay: 0.4 }
});

describe('inventory and crafting', () => {
  it('respects capacity and stacking', () => {
    const inv = new Inventory({ ...content, capacity: 5 });
    expect(inv.add('ore_metal', 3)).toBe(3);
    expect(inv.add('bio_sample', 10)).toBe(2);
    expect(inv.used).toBe(5);
  });

  it('crafts a repair kit from ingredients and refuses when short', () => {
    const inv = new Inventory(content, { counts: { ore_metal: 1 } });
    const recipe = content.recipes.find((r) => r.id === 'craft_repair_kit');
    expect(inv.craft(recipe).ok).toBe(false);
    inv.add('bio_sample', 2);
    expect(inv.craft(recipe).ok).toBe(true);
    expect(inv.count('repair_kit')).toBe(1);
    expect(inv.count('bio_sample')).toBe(0);
  });

  it('installs modules with visible effects and swaps the previous one back', () => {
    const inv = new Inventory(content, { counts: { ore_metal: 10, electronic_part: 10 } });
    inv.craft(content.recipes.find((r) => r.id === 'craft_module_propulsion'));
    expect(inv.effects.sprintBonus).toBeCloseTo(0.15);
    inv.craft(content.recipes.find((r) => r.id === 'craft_module_propulsion'));
    expect(inv.count('module_propulsion')).toBe(1);
  });

  it('uses consumables where they are needed', () => {
    const inv = new Inventory(content, { counts: { energy_cell: 1, repair_kit: 1 } });
    const robot = new RobotState({ energy: 10, integrity: 90 });
    expect(inv.useConsumable(robot).ok).toBe(true);
    expect(robot.energy).toBe(60);
    expect(inv.count('energy_cell')).toBe(0);
  });
});

describe('missions', () => {
  it('advances steps in order and rewards on completion', () => {
    const m = new Missions(content);
    expect(m.mission.id).toBe('signal');
    expect(m.notify({ type: 'scan', poi: 'camp' })).toHaveLength(0);
    m.notify({ type: 'reach', poi: 'camp' });
    const done = m.notify({ type: 'scan', poi: 'camp' });
    expect(done.some((n) => n.kind === 'complete')).toBe(true);
    expect(m.mission.id).toBe('fauna');
  });

  it('counts each species only once', () => {
    const m = new Missions(content, { index: 1 });
    m.notify({ type: 'species', id: 'lumifer' });
    m.notify({ type: 'species', id: 'lumifer' });
    expect(m.progress.scan_species).toBe(1);
  });
});

describe('survival', () => {
  it('drains energy over time and takes damage with armour reduction', () => {
    const r = new RobotState({ energy: 100, integrity: 100 });
    r.tick(60, { target: 20, thermalFactor: 1 });
    expect(r.energy).toBeLessThan(100);
    r.damage(10, 0.8);
    expect(r.integrity).toBeCloseTo(92, 5);
  });

  it('makes deserts hotter by day and tundra colder', () => {
    expect(thermalTarget('desert', 1, 0)).toBeGreaterThan(thermalTarget('desert', 0, 0));
    expect(thermalTarget('tundra', 0.5, 0)).toBeLessThan(0);
  });
});

describe('save system', () => {
  it('round-trips a valid save', () => {
    const storage = memoryStorage();
    const saves = new SaveManager(storage);
    saves.write(baseState());
    const loaded = saves.read();
    expect(loaded.source).toBe('main');
    expect(loaded.data.seed).toBe(77);
    expect(loaded.data.inventory.counts.ore_metal).toBe(3);
    expect(loaded.data.version).toBe(SAVE_VERSION);
  });

  it('keeps the previous save when a write fails midway', () => {
    const storage = memoryStorage();
    const saves = new SaveManager(storage);
    saves.write(baseState());
    const failing = new SaveManager(memoryStorage());
    failing.storage = { ...storage, setItem: (k, v) => { if (k === 'genesis.save.main') throw new Error('disk'); storage.setItem(k, v); } };
    expect(() => failing.write({ ...baseState(), seed: 99 })).toThrow();
    expect(saves.read().data.seed).toBe(77);
  });

  it('falls back to the backup when the main save is corrupted', () => {
    const storage = memoryStorage();
    const saves = new SaveManager(storage);
    saves.write(baseState());
    saves.write({ ...baseState(), seed: 88 });
    storage.setItem('genesis.save.main', storage.getItem('genesis.save.main').slice(0, 40));
    const loaded = saves.read();
    expect(loaded.source).toBe('backup');
    expect(loaded.data.seed).toBe(77);
  });

  it('rejects tampered or malformed saves', () => {
    const storage = memoryStorage();
    const saves = new SaveManager(storage);
    saves.write(baseState());
    const raw = JSON.parse(storage.getItem('genesis.save.main'));
    raw.body = raw.body.replace('"energy":80', '"energy":800');
    storage.setItem('genesis.save.main', JSON.stringify(raw));
    expect(saves.read()).toBeNull();
    expect(() => validateSave({ version: SAVE_VERSION, seed: 'x' })).toThrow();
    expect(checksum('abc')).toBe(checksum('abc'));
  });
});

describe('settings', () => {
  it('stores and reloads settings with validation', () => {
    const storage = memoryStorage();
    saveSettings(storage, { ...DEFAULT_SETTINGS, quality: 'high', sensitivity: 42 });
    const loaded = loadSettings(storage);
    expect(loaded.quality).toBe('high');
    expect(loaded.sensitivity).toBe(10);
    storage.setItem('genesis.settings.v1', '{not json');
    expect(loadSettings(storage).quality).toBe(DEFAULT_SETTINGS.quality);
  });
});

describe('perception and navigation', () => {
  const flat = { heightAt: () => 10, collidersNear: () => [new Float32Array(0)] };

  it('sees targets in front within range and not behind', () => {
    const observer = { x: 0, y: 10, z: 0, yaw: 0 };
    expect(canSee(flat, observer, { x: 0, y: 10, z: 20 }, 40, 120)).toBe(true);
    expect(canSee(flat, observer, { x: 0, y: 10, z: -20 }, 40, 120)).toBe(false);
    expect(canSee(flat, observer, { x: 0, y: 10, z: 60 }, 40, 120)).toBe(false);
  });

  it('is blocked by terrain between observer and target', () => {
    const hill = { heightAt: (x) => (x > 5 && x < 15 ? 80 : 10), collidersNear: () => [] };
    const observer = { x: 0, y: 10, z: 0, yaw: 0 };
    expect(canSee(hill, observer, { x: 0, y: 10, z: 30 }, 60, 360)).toBe(true);
    expect(canSee(hill, observer, { x: 30, y: 10, z: 0 }, 60, 360)).toBe(false);
  });

  it('hears only sounds loud enough for the distance', () => {
    expect(canHear({ x: 0, z: 0 }, { x: 10, z: 0 }, 30, 0.5)).toBe(true);
    expect(canHear({ x: 0, z: 0 }, { x: 10, z: 0 }, 30, 0.2)).toBe(false);
    expect(canHear({ x: 0, z: 0 }, { x: 1, z: 0 }, 30, 0)).toBe(false);
  });

  it('steers around steep slopes and water for land animals', () => {
    const cliff = { heightAt: (x) => (x > 0 ? 40 : 10), collidersNear: () => [] };
    const heading = chooseHeading(cliff, 0, 0, 10, Math.PI / 2, { maxSlope: 0.7 });
    expect(heading).not.toBeNull();
    expect(Math.sin(heading)).toBeLessThan(0.5);
    const lake = { heightAt: () => 2, collidersNear: () => [] };
    expect(chooseHeading(lake, 0, 0, 10, 0, {})).toBeNull();
    expect(chooseHeading(lake, 0, 0, 2, 0, { aquatic: true })).not.toBeNull();
    expect(Math.abs(angleDelta(0, 3 * Math.PI))).toBeCloseTo(Math.PI, 5);
  });
});

describe('state machine and ray queries', () => {
  it('runs entry hooks and timed updates', () => {
    const log = [];
    const owner = {};
    const fsm = new StateMachine(owner)
      .add('a', { enter: () => log.push('enter a'), update: (o, dt) => log.push(`a ${dt}`) })
      .add('b', { enter: () => log.push('enter b') });
    fsm.set('a');
    fsm.update(0.5);
    fsm.set('b');
    expect(log).toEqual(['enter a', 'a 0.5', 'enter b']);
    expect(fsm.elapsed).toBe(0);
  });

  it('intersects rays with spheres', () => {
    const t = raySphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 10 }, 2);
    expect(t).toBeCloseTo(8, 6);
    expect(raySphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 10 }, 2)).toBeNull();
  });
});
