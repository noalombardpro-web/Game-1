// Weapon logic: owned weapons, selection, magazines, reserve ammunition (inventory items),
// fire rate, reloading, spread and rockets. No rendering: the game turns shots into rays and effects.

/** Slot index 0 is the harvesting tool; 1..5 are the weapons listed in data/weapons.json `slots`. */
export class Weapons {
  /**
   * @param data       content of data/weapons.json
   * @param inventory  Inventory (weapon_<id> items = owned weapons, ammo items = reserve)
   * @param saved      { current, mags } or undefined
   */
  constructor(data, inventory, saved = {}) {
    this.data = data;
    this.inventory = inventory;
    this.defs = Object.fromEntries(data.weapons.map((w) => [w.id, w]));
    this.slots = data.slots;
    this.mags = {};
    for (const w of data.weapons) this.mags[w.id] = Number.isInteger(saved.mags?.[w.id]) ? Math.min(saved.mags[w.id], w.mag) : w.mag;
    this.current = saved.current ?? null;
    if (this.current && !this.owns(this.current)) this.current = null;
    this.cooldown = 0;
    this.reloading = 0;
    this.harvestCooldown = 0;
  }

  owns(id) {
    return id === 'harvest' || this.inventory.count(`weapon_${id}`) > 0;
  }

  get def() {
    return this.current && this.current !== 'harvest' ? this.defs[this.current] : null;
  }

  /** Selects slot n (0 = harvesting tool). Returns a message for the HUD, or null. */
  select(n) {
    if (n === 0) {
      this.current = this.current === 'harvest' ? null : 'harvest';
      this.reloading = 0;
      return this.current ? this.data.harvest.name : 'Mains libres';
    }
    const id = this.slots[n - 1];
    if (!id) return null;
    if (!this.owns(id)) return `${this.defs[id].name} : pas encore fabriqué.`;
    this.current = this.current === id ? null : id;
    this.reloading = 0;
    this.cooldown = Math.max(this.cooldown, 0.25);
    return this.current ? this.defs[id].name : 'Arme rangée';
  }

  /** Cycles through owned weapons (mouse wheel). */
  cycle(step) {
    const owned = this.slots.filter((id) => this.owns(id));
    if (!owned.length) return null;
    const i = owned.indexOf(this.current);
    const next = owned[(i + step + owned.length) % owned.length];
    this.current = next;
    this.reloading = 0;
    return this.defs[next].name;
  }

  reserve(id = this.current) {
    const def = this.defs[id];
    return def ? this.inventory.count(def.ammo) : 0;
  }

  startReload() {
    const def = this.def;
    if (!def || this.reloading > 0 || this.mags[def.id] >= def.mag || this.reserve() <= 0) return false;
    this.reloading = def.reload;
    return true;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.harvestCooldown = Math.max(0, this.harvestCooldown - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      const def = this.def;
      if (!def) { this.reloading = 0; return null; }
      if (this.reloading <= 0) {
        this.reloading = 0;
        const need = def.mag - this.mags[def.id];
        const take = Math.min(need, this.reserve());
        this.inventory.remove(def.ammo, take);
        this.mags[def.id] += take;
        return { type: 'reloaded', weapon: def.id };
      }
    }
    return null;
  }

  /**
   * Tries to fire. `held` = trigger held this frame, `pressed` = trigger pressed this frame.
   * `rng` returns [0, 1). Returns null, { type: 'empty' }, or
   * { type: 'shot', weapon, pellets: [{ yaw, pitch }] (angular offsets), projectile }.
   */
  tryFire(held, pressed, rng = Math.random) {
    const def = this.def;
    if (!def || this.reloading > 0 || this.cooldown > 0) return null;
    if (!(def.auto ? held : pressed)) return null;
    if (this.mags[def.id] <= 0) {
      this.cooldown = 0.3;
      if (!this.startReload()) return { type: 'empty', weapon: def.id };
      return { type: 'reload', weapon: def.id };
    }
    this.mags[def.id]--;
    this.cooldown = def.rate;
    const pellets = [];
    for (let i = 0; i < def.pellets; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * def.spread;
      pellets.push({ yaw: Math.cos(a) * r, pitch: Math.sin(a) * r });
    }
    if (this.mags[def.id] === 0) this.startReload();
    return { type: 'shot', weapon: def.id, def, pellets, projectile: def.projectile ?? null };
  }

  /** Harvest swing; returns true when a swing happens (the caller resolves what it hit). */
  trySwing(pressedOrHeld) {
    if (this.current !== 'harvest' || this.harvestCooldown > 0 || !pressedOrHeld) return false;
    this.harvestCooldown = this.data.harvest.rate;
    return true;
  }

  toJSON() {
    return { current: this.current, mags: { ...this.mags } };
  }
}

/**
 * Advances a rocket (mutated in place) by dt; returns true when it should explode
 * (ground contact through `heightAt`, or range exhausted).
 */
export function stepProjectile(p, dt, heightAt) {
  p.vy -= p.gravity * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  p.travelled += Math.hypot(p.vx, p.vy, p.vz) * dt;
  return p.y <= heightAt(p.x, p.z) + 0.2 || p.travelled >= p.range;
}

/** Explosion damage falloff: full at the centre, zero at the radius. */
export function blastDamage(damage, radius, distance) {
  if (distance >= radius) return 0;
  return damage * (1 - distance / radius) ** 1.2;
}
