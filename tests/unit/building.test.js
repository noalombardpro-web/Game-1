import { describe, it, expect } from 'vitest';
import { BuildGrid, placementFor, surfaceHeight, pieceKey, cellAt, LEVEL, CELL, THICK } from '../../src/building/pieces.js';

const inv = (counts) => ({
  counts: { ...counts },
  count(id) { return this.counts[id] ?? 0; },
  remove(id, n) { if (this.count(id) < n) return false; this.counts[id] -= n; return true; },
  add(id, n) { this.counts[id] = this.count(id) + n; return n; }
});
const flat = () => 0;

describe('grid building', () => {
  it('places pieces in front of the player and charges materials', () => {
    const grid = new BuildGrid();
    const bag = inv({ mat_wood: 25 });
    const wall = placementFor('wall', { x: 2, y: 0, z: 2 }, 0, 0);
    expect(wall).toMatchObject({ type: 'wall', i: 0, j: 1, k: 0, o: 0 });
    expect(grid.place({ ...wall, m: 'wood' }, bag).ok).toBe(true);
    expect(bag.count('mat_wood')).toBe(15);
    expect(grid.place({ ...wall, m: 'wood' }, bag).ok).toBe(false);
    const floor = placementFor('floor', { x: 2, y: 0, z: 2 }, Math.PI / 2, 0);
    expect(floor).toMatchObject({ i: 1, j: 0 });
    expect(grid.place({ ...floor, m: 'wood' }, bag).ok).toBe(true);
    expect(grid.place({ type: 'floor', i: 5, j: 5, k: 0, m: 'wood' }, bag).ok).toBe(false);
  });

  it('walls block movement unless a door is cut', () => {
    const grid = new BuildGrid([{ type: 'wall', i: 0, j: 1, k: 0, o: 0, m: 'stone' }]);
    const pos = { x: 2, y: 0, z: CELL - 0.2 };
    expect(grid.resolve(pos, 0.4)).toBe(true);
    expect(pos.z).toBeLessThan(CELL - 0.4);
    const piece = grid.list[0];
    grid.toggleCell(piece, 1, 0);
    grid.toggleCell(piece, 1, 1);
    const through = { x: 2, y: 0, z: CELL - 0.2 };
    expect(grid.resolve(through, 0.4)).toBe(false);
  });

  it('ramps and floors are walkable surfaces', () => {
    const grid = new BuildGrid([{ type: 'ramp', i: 0, j: 0, k: 0, d: 0, m: 'wood' }, { type: 'floor', i: 0, j: 1, k: 1, m: 'wood' }]);
    const ramp = grid.list[0];
    expect(surfaceHeight(ramp, 2, 0)).toBeCloseTo(THICK);
    expect(surfaceHeight(ramp, 2, CELL)).toBeCloseTo(THICK + LEVEL);
    expect(grid.groundAt(2, 2, 1.5)).toBeGreaterThan(1.5);
    expect(grid.groundAt(2, 6, LEVEL)).toBeCloseTo(LEVEL + THICK);
    expect(grid.groundAt(2, 6, 0)).toBe(-Infinity);
  });

  it('pieces with no path to the ground collapse', () => {
    const grid = new BuildGrid([
      { type: 'wall', i: 0, j: 1, k: 0, o: 0, m: 'wood' },
      { type: 'floor', i: 0, j: 1, k: 1, m: 'wood' },
      { type: 'floor', i: 0, j: 2, k: 1, m: 'wood' }
    ]);
    const wall = grid.list.find((p) => p.type === 'wall');
    const removed = grid.damage(wall, 1000, flat);
    expect(removed.length).toBe(3);
    expect(grid.list.length).toBe(0);
  });

  it('saves and restores pieces with edits', () => {
    const grid = new BuildGrid();
    grid.place({ type: 'floor', i: 1, j: 1, k: 0, m: 'metal' }, inv({ mat_metal: 10 }));
    grid.toggleCell(grid.list[0], 0, 0);
    const copy = new BuildGrid(JSON.parse(JSON.stringify(grid.toJSON())));
    expect(pieceKey(copy.list[0])).toBe('F:1:1:0');
    expect(copy.list[0].edit).toBe(1);
    expect(surfaceHeight(copy.list[0], 4.5, 4.5)).toBeNull();
    expect(cellAt(copy.list[0], { x: 7, y: 0, z: 7 })).toEqual({ c: 1, r: 1 });
  });
});

describe('save validation keeps the new gear', () => {
  it('grid pieces and weapon magazines survive validateSave', async () => {
    const { validateSave, SAVE_VERSION } = await import('../../src/systems/save.js');
    const data = validateSave({
      version: SAVE_VERSION, seed: 1, player: { x: 0, z: 0, yaw: 0 }, robot: { energy: 50, integrity: 50 },
      inventory: { counts: {} }, clock: { timeOfDay: 0.5 }, collected: [],
      grid: [{ type: 'wall', i: 1, j: 2, k: 0, o: 1, m: 'wood', hp: 100, edit: 3 }, { bogus: true }],
      weapons: { current: 'laser_rifle', mags: { laser_rifle: 7 } }
    });
    expect(data.grid).toHaveLength(1);
    expect(data.weapons).toEqual({ current: 'laser_rifle', mags: { laser_rifle: 7 } });
  });
});
