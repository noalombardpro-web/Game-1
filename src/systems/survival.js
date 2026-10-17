// Robot vital stats: energy, mechanical integrity and component temperature.
// Pure logic, no rendering.
import { clamp, approach } from '../core/math.js';

export const MAX_STAT = 100;

/** Target component temperature (degC) for a biome, time of day and altitude. */
export function thermalTarget(biomeId, dayFactor, altitude) {
  const base = {
    desert: 38, jungle: 30, meadow: 20, temperate_forest: 18, conifer_forest: 12,
    wetland: 18, rocky_plateau: 16, tundra: -12, snow_peaks: -22, lake_bed: 14
  }[biomeId] ?? 18;
  const dayBonus = (dayFactor - 0.5) * 2 * (biomeId === 'desert' ? 14 : 6);
  const altitudeCooling = Math.max(0, altitude - 60) * -0.05;
  return base + dayBonus + altitudeCooling;
}

export class RobotState {
  constructor(data = {}) {
    this.energy = clamp(data.energy ?? MAX_STAT, 0, MAX_STAT);
    this.integrity = clamp(data.integrity ?? MAX_STAT, 0, MAX_STAT);
    this.temperature = data.temperature ?? 20;
    this.tool = clamp(data.tool ?? MAX_STAT, 0, MAX_STAT);
  }

  toJSON() {
    return { energy: this.energy, integrity: this.integrity, temperature: this.temperature, tool: this.tool };
  }

  /** Spends energy. Returns false (and does nothing) when there is not enough. */
  spend(amount) {
    if (this.energy < amount) return false;
    this.energy -= amount;
    return true;
  }

  drain(amount) {
    this.energy = Math.max(0, this.energy - amount);
  }

  recharge(amount) {
    this.energy = Math.min(MAX_STAT, this.energy + amount);
  }

  /** Applies damage scaled by the armour multiplier. Returns the amount actually taken. */
  damage(amount, multiplier = 1) {
    const taken = Math.max(0, amount * multiplier);
    this.integrity = Math.max(0, this.integrity - taken);
    return taken;
  }

  /** Wears the tools (weapon, scanner, collector). A low tool state weakens them. */
  wear(amount) {
    this.tool = Math.max(0, this.tool - amount);
  }

  repairTools(amount) {
    this.tool = Math.min(MAX_STAT, this.tool + amount);
  }

  /** 1 when tools are fine, down to 0.5 when nearly worn out. */
  get toolEfficiency() {
    return this.tool > 40 ? 1 : 0.5 + (this.tool / 40) * 0.5;
  }

  repair(amount) {
    this.integrity = Math.min(MAX_STAT, this.integrity + amount);
  }

  get destroyed() {
    return this.integrity <= 0;
  }

  /**
   * Advances thermal state and passive drains.
   * @param dt seconds
   * @param env { target, thermalFactor } from thermalTarget and installed modules
   */
  tick(dt, env) {
    this.temperature = approach(this.temperature, env.target, dt * 0.6);
    const cold = Math.max(0, -this.temperature) / 40;
    const hot = Math.max(0, this.temperature - 50) / 30;
    this.drain((0.04 + cold * 0.05 + hot * 0.05) * (env.thermalFactor ?? 1) * dt * (1 + cold));
    if (this.temperature > 60 || this.temperature < -20) {
      this.damage(0.6 * dt);
    }
  }
}
