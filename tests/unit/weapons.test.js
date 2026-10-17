import { describe, it, expect } from 'vitest';
import { loadContent } from '../../src/world/content.js';
import { Inventory } from '../../src/systems/inventory.js';
import { Weapons, stepProjectile, blastDamage } from '../../src/systems/weapons.js';

const content = loadContent();
const kit = () => {
  const inv = new Inventory(content);
  for (const [id, n] of Object.entries(content.weapons.start)) inv.add(id, n);
  return inv;
};

describe('weapons', () => {
  it('only owned weapons can be selected', () => {
    const w = new Weapons(content.weapons, kit());
    expect(w.select(1)).toBe('Pistolet plasma');
    expect(w.current).toBe('plasma_pistol');
    expect(w.select(4)).toMatch(/pas encore/);
    expect(w.current).toBe('plasma_pistol');
  });

  it('fires, empties the magazine, reloads from the reserve', () => {
    const inv = kit();
    const w = new Weapons(content.weapons, inv);
    w.select(2);
    w.cooldown = 0;
    let shots = 0;
    for (let i = 0; i < 200 && shots < 30; i++) {
      const r = w.tryFire(true, false, () => 0.5);
      if (r?.type === 'shot') shots++;
      w.update(0.11);
    }
    expect(shots).toBe(30);
    expect(w.reloading).toBeGreaterThan(0);
    const before = inv.count('ammo_cell');
    for (let i = 0; i < 30; i++) w.update(0.1);
    expect(w.mags.laser_rifle).toBe(30);
    expect(inv.count('ammo_cell')).toBe(before - 30);
  });

  it('semi-automatic weapons need a new trigger press', () => {
    const w = new Weapons(content.weapons, kit());
    w.select(1);
    w.cooldown = 0;
    expect(w.tryFire(true, true)?.type).toBe('shot');
    w.update(1);
    expect(w.tryFire(true, false)).toBeNull();
  });

  it('ammunition and materials do not fill the cargo hold', () => {
    const inv = kit();
    expect(inv.used).toBe(0);
    expect(inv.add('ammo_cell', 500)).toBe(500);
  });

  it('rockets fall and explode on the ground; blast damage fades with distance', () => {
    const p = { x: 0, y: 10, z: 0, vx: 0, vy: 0, vz: 40, gravity: 20, range: 500, travelled: 0 };
    let t = 0;
    while (!stepProjectile(p, 0.05, () => 0) && t < 200) t++;
    expect(p.y).toBeLessThan(0.3);
    expect(blastDamage(100, 6, 0)).toBe(100);
    expect(blastDamage(100, 6, 3)).toBeLessThan(60);
    expect(blastDamage(100, 6, 7)).toBe(0);
  });
});
