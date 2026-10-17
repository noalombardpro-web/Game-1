// Inventory (capacity-limited stacks), installed robot modules and crafting.
// Pure logic; the UI reads and calls these methods.

export const MODULE_SLOTS = ['propulsion', 'armor', 'sensors', 'survival', 'science', 'diving', 'tools', 'storage'];

/** Crafting stations, from the portable kit to the research lab. A higher station can craft lower recipes. */
export const STATION_RANK = { hand: 0, workbench: 1, lab: 2 };

/** Categories carried outside the cargo hold (weapon rack, ammo belt, building materials): they only respect their stack limit. */
export const UNBAGGED = new Set(['weapon', 'ammo', 'material']);

export class Inventory {
  /**
   * @param content  loaded content (items, recipes, capacity)
   * @param saved    { counts, modules } or undefined
   */
  constructor(content, saved = {}) {
    this.items = content.itemsById;
    this.recipes = content.recipes;
    this.baseCapacity = content.capacity;
    /** Extra room provided by the vehicle currently driven (heavy transport hold). */
    this.externalCapacity = 0;
    this.counts = {};
    this.modules = Object.fromEntries(MODULE_SLOTS.map((slot) => [slot, null]));
    for (const [id, n] of Object.entries(saved.counts ?? {})) {
      if (this.items[id] && Number.isInteger(n) && n > 0) this.counts[id] = Math.min(n, this.isBagged(id) ? this.capacity : this.items[id].stack ?? 999);
    }
    for (const slot of MODULE_SLOTS) {
      const id = saved.modules?.[slot];
      if (id && this.items[id]?.slot === slot) this.modules[slot] = id;
    }
  }

  get capacity() {
    return this.baseCapacity + this.effects.capacityBonus + this.externalCapacity;
  }

  isBagged(id) {
    return !UNBAGGED.has(this.items[id]?.category);
  }

  get used() {
    let sum = 0;
    for (const [id, n] of Object.entries(this.counts)) if (this.isBagged(id)) sum += n;
    return sum;
  }

  count(id) {
    return this.counts[id] ?? 0;
  }

  /** Adds items; returns how many were actually stored (capacity is respected). */
  add(id, amount = 1) {
    const item = this.items[id];
    if (!item) throw new Error(`Unknown item ${id}`);
    const space = this.isBagged(id) ? Math.max(0, this.capacity - this.used) : Math.max(0, (item.stack ?? 999) - this.count(id));
    const stored = Math.min(amount, space);
    if (stored > 0) this.counts[id] = (this.counts[id] ?? 0) + stored;
    return stored;
  }

  remove(id, amount = 1) {
    if (this.count(id) < amount) return false;
    this.counts[id] -= amount;
    if (this.counts[id] === 0) delete this.counts[id];
    return true;
  }

  /** Equips a module. The previously installed module returns to the inventory. */
  equip(id) {
    const item = this.items[id];
    if (!item || item.category !== 'module') return false;
    const old = this.modules[item.slot];
    this.modules[item.slot] = id;
    if (old) this.add(old, 1);
    return true;
  }

  /** True when the ingredients are in the inventory and `station` (best nearby station) is good enough. */
  canCraft(recipe, station = 'lab') {
    if ((STATION_RANK[recipe.station ?? 'hand'] ?? 0) > (STATION_RANK[station] ?? 0)) return false;
    return Object.entries(recipe.ingredients).every(([id, n]) => this.count(id) >= n);
  }

  /** Crafts a recipe. Modules are installed directly. Returns { ok, message }. */
  craft(recipe, station = 'lab') {
    if ((STATION_RANK[recipe.station ?? 'hand'] ?? 0) > (STATION_RANK[station] ?? 0)) {
      return { ok: false, message: `Il faut un ${recipe.station === 'lab' ? 'laboratoire' : 'établi'} à proximité.` };
    }
    if (!this.canCraft(recipe, station)) return { ok: false, message: 'Ressources insuffisantes.' };
    const output = recipe.output;
    const outputItem = this.items[output.item];
    const freeSpace = this.capacity - this.used + Object.entries(recipe.ingredients).reduce((s, [, n]) => s + n, 0);
    if (outputItem.category !== 'module' && this.isBagged(output.item) && freeSpace < output.count) {
      return { ok: false, message: 'Capacité de stockage insuffisante.' };
    }
    for (const [id, n] of Object.entries(recipe.ingredients)) this.remove(id, n);
    if (outputItem.category === 'module') {
      this.equip(output.item);
    } else {
      this.add(output.item, output.count);
    }
    return { ok: true, message: `${outputItem.name} fabriqué.` };
  }

  /** Aggregated effects of installed modules. */
  get effects() {
    const fx = {
      sprintBonus: 0, damageReduction: 0, scanRangeBonus: 0, thermalFactor: 1, lootBonus: 0,
      diveDepth: 0, swimBonus: 0, jumpBonus: 0, repairBonus: 0, collectRange: 0, toolWear: 1, capacityBonus: 0
    };
    for (const id of Object.values(this.modules)) {
      if (!id) continue;
      const effect = this.items[id].effect ?? {};
      if (effect.sprintBonus) fx.sprintBonus += effect.sprintBonus;
      if (effect.damageReduction) fx.damageReduction += effect.damageReduction;
      if (effect.scanRangeBonus) fx.scanRangeBonus += effect.scanRangeBonus;
      if (effect.thermalFactor) fx.thermalFactor = Math.min(fx.thermalFactor, effect.thermalFactor);
      if (effect.lootBonus) fx.lootBonus += effect.lootBonus;
      for (const key of ['diveDepth', 'swimBonus', 'jumpBonus', 'repairBonus', 'collectRange', 'capacityBonus']) {
        if (effect[key]) fx[key] += effect[key];
      }
      if (effect.toolWear) fx.toolWear = Math.min(fx.toolWear, effect.toolWear);
    }
    return fx;
  }

  /**
   * Uses the most useful consumable for the robot's state.
   * Returns { ok, message } and applies the effect to the robot (energy / integrity).
   */
  useConsumable(robot) {
    const wantsEnergy = robot.energy < 60 && this.count('energy_cell') > 0;
    const wantsRepair = robot.integrity < 70 && this.count('repair_kit') > 0;
    const wantsTools = robot.tool < 55 && this.count('repair_tool_kit') > 0;
    const id = wantsEnergy ? 'energy_cell' : wantsRepair ? 'repair_kit' : wantsTools ? 'repair_tool_kit' : null;
    if (!id) return { ok: false, message: 'Aucun consommable utile.' };
    const effect = this.items[id].effect;
    this.remove(id, 1);
    if (effect.energy) robot.recharge(effect.energy);
    if (effect.integrity) robot.repair(effect.integrity * (1 + this.effects.repairBonus));
    if (effect.tools) robot.repairTools(effect.tools * (1 + this.effects.repairBonus));
    return { ok: true, message: `${this.items[id].name} utilisé.` };
  }

  toJSON() {
    return { counts: { ...this.counts }, modules: { ...this.modules } };
  }
}
