// Outposts: placement rules, power networks, stations, storage, healing and defence.
import * as THREE from 'three';
import { WATER_LEVEL } from '../world/terrain.js';
import { STRUCTURE_BUILDERS } from './structureModels.js';
import { STATION_RANK } from '../systems/inventory.js';

const MAX_PLACE_DISTANCE = 26;
const MAX_SLOPE = 0.38;

/**
 * Checks whether a structure can be placed at (x, z). Pure function (testable).
 * @returns { ok, reason }
 */
export function canPlace(world, structures, defs, typeId, x, z) {
  const def = defs[typeId];
  if (!def) return { ok: false, reason: 'Structure inconnue.' };
  const r = def.radius;
  const centre = world.heightAt(x, z);
  if (centre < WATER_LEVEL + 0.6) return { ok: false, reason: 'Terrain immergé.' };
  let lo = centre;
  let hi = centre;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const h = world.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  if ((hi - lo) / (2 * r) > MAX_SLOPE) return { ok: false, reason: 'Terrain trop en pente.' };
  for (const s of structures) {
    if (Math.hypot(s.x - x, s.z - z) < s.def.radius + r + 0.6) return { ok: false, reason: 'Trop proche d’une autre structure.' };
  }
  for (const arr of world.collidersNear(x, z)) {
    for (let i = 0; i < arr.length; i += 3) {
      if (Math.hypot(arr[i] - x, arr[i + 1] - z) < arr[i + 2] + r) return { ok: false, reason: 'Obstacle (arbre ou rocher) sur l’emplacement.' };
    }
  }
  return { ok: true };
}

export class Structure {
  constructor(id, typeId, def, x, z, y, yaw, level = 1, storage = {}) {
    this.id = id;
    this.typeId = typeId;
    this.def = def;
    this.x = x;
    this.z = z;
    this.y = y;
    this.yaw = yaw;
    this.level = level;
    this.storage = storage;
    this.powered = def.power >= 0;
    this.mesh = null;
    this.cooldown = 0;
  }

  /** Power produced (positive) or consumed (negative) at the current level. */
  get power() {
    const up = this.def.upgrade?.power ?? 0;
    return this.def.power + (this.def.power > 0 ? up * (this.level - 1) : 0);
  }

  get capacity() {
    return (this.def.capacity ?? 0) + (this.def.upgrade?.capacity ?? 0) * (this.level - 1);
  }

  get stored() {
    return Object.values(this.storage).reduce((a, b) => a + b, 0);
  }
}

export class BaseManager {
  /**
   * @param options { scene, world, data (data/structures.json), itemsById, hooks }
   */
  constructor(options) {
    this.scene = options.scene;
    this.world = options.world;
    this.defs = options.data.structures;
    this.linkRange = options.data.linkRange;
    this.refund = options.data.refund;
    this.list = [];
    this.nextId = 1;
    this.ghost = null;
    this.ghostType = null;
    this.healTimer = 0;
  }

  /** Total cost check against an inventory. */
  affordable(inventory, cost) {
    return Object.entries(cost).every(([id, n]) => inventory.count(id) >= n);
  }

  spend(inventory, cost) {
    for (const [id, n] of Object.entries(cost)) inventory.remove(id, n);
  }

  add(typeId, x, z, yaw, extra = {}) {
    const def = this.defs[typeId];
    const y = this.world.heightAt(x, z);
    const s = new Structure(extra.id ?? `s${this.nextId++}`, typeId, def, x, z, y, yaw, extra.level ?? 1, extra.storage ?? {});
    s.mesh = STRUCTURE_BUILDERS[typeId]();
    s.mesh.position.set(x, y, z);
    s.mesh.rotation.y = yaw;
    this.scene.add(s.mesh);
    this.list.push(s);
    this.syncColliders();
    return s;
  }

  remove(structure) {
    this.scene.remove(structure.mesh);
    structure.mesh.traverse((o) => o.geometry?.dispose());
    this.list = this.list.filter((s) => s !== structure);
    this.syncColliders();
  }

  /** Publishes the structures as solid obstacles to the world (player, creatures, vehicles). */
  syncColliders() {
    const data = [];
    for (const s of this.list) data.push(s.x, s.z, s.def.radius);
    this.world.setDynamicColliders(new Float32Array(data));
  }

  place(inventory, typeId, x, z, yaw) {
    const def = this.defs[typeId];
    const check = canPlace(this.world, this.list, this.defs, typeId, x, z);
    if (!check.ok) return { ok: false, reason: check.reason };
    if (!this.affordable(inventory, def.cost)) return { ok: false, reason: 'Ressources insuffisantes.' };
    this.spend(inventory, def.cost);
    return { ok: true, structure: this.add(typeId, x, z, yaw) };
  }

  /** Dismantles a structure, refunding part of its cost. Stored items go back to the inventory. */
  dismantle(inventory, structure) {
    const refund = {};
    for (const [id, n] of Object.entries(structure.def.cost)) refund[id] = Math.floor(n * this.refund);
    for (const [id, n] of Object.entries(structure.storage)) refund[id] = (refund[id] ?? 0) + n;
    this.remove(structure);
    let lost = 0;
    for (const [id, n] of Object.entries(refund)) lost += n - inventory.add(id, n);
    return { refund, lost };
  }

  upgrade(inventory, structure) {
    const up = structure.def.upgrade;
    if (!up) return { ok: false, reason: 'Pas d’amélioration disponible.' };
    if (structure.level >= 2) return { ok: false, reason: 'Niveau maximal atteint.' };
    if (!this.affordable(inventory, up.cost)) return { ok: false, reason: 'Ressources insuffisantes.' };
    this.spend(inventory, up.cost);
    structure.level++;
    return { ok: true };
  }

  nearest(x, z, maxDist = 6, typeId = null) {
    let best = null;
    let bestDist = maxDist;
    for (const s of this.list) {
      if (typeId && s.typeId !== typeId) continue;
      const d = Math.hypot(s.x - x, s.z - z) - s.def.radius;
      if (d < bestDist) { best = s; bestDist = d; }
    }
    return best;
  }

  /** Recomputes which structures are powered: networks are the connected groups within linkRange. */
  updatePower() {
    const visited = new Set();
    for (const start of this.list) {
      if (visited.has(start)) continue;
      const group = [];
      const queue = [start];
      visited.add(start);
      while (queue.length) {
        const s = queue.pop();
        group.push(s);
        for (const o of this.list) {
          if (!visited.has(o) && Math.hypot(o.x - s.x, o.z - s.z) <= this.linkRange) { visited.add(o); queue.push(o); }
        }
      }
      const supply = group.reduce((sum, s) => sum + Math.max(0, s.power), 0);
      const demand = group.reduce((sum, s) => sum - Math.min(0, s.power), 0);
      const ok = supply >= demand;
      for (const s of group) s.powered = s.power >= 0 ? true : ok;
      for (const s of group) { s.networkSupply = supply; s.networkDemand = demand; }
    }
  }

  /** Best crafting station within reach of a position ('hand' when none). */
  bestStation(x, z) {
    let best = 'hand';
    for (const s of this.list) {
      const station = s.def.station;
      if (!station || !s.powered) continue;
      if (Math.hypot(s.x - x, s.z - z) > s.def.radius + 9 && station !== 'lab') continue;
      if (station === 'lab' && Math.hypot(s.x - x, s.z - z) > s.def.radius + 12) continue;
      if (STATION_RANK[station] > STATION_RANK[best]) best = station;
    }
    return best;
  }

  get hasComm() {
    return this.list.some((s) => s.typeId === 'comm' && s.powered);
  }

  /**
   * Per-frame effects: rest/healing, generator charging, garage service, turret fire, animations.
   * @param ctx { dt, player: {x,z,robot}, vehicles, enemies, creatures, effects, onKill }
   */
  update(ctx) {
    const { dt } = ctx;
    this.updatePower();
    const time = performance.now() * 0.001;
    for (const s of this.list) {
      s.mesh.visible = Math.hypot(s.x - ctx.player.x, s.z - ctx.player.z) < 650;
      s.mesh.traverse((o) => {
        if (o.userData.spin) o.rotation.z += dt * (s.powered ? 3 : 0.3);
        if (o.userData.blink) o.material.emissiveIntensity = 1 + Math.sin(time * 4) * 1.2;
      });
      if (!s.powered) continue;
      const dp = Math.hypot(s.x - ctx.player.x, s.z - ctx.player.z);
      if (s.typeId === 'habitat' && dp < 9) {
        ctx.player.robot.repair(1.5 * dt);
        ctx.player.robot.recharge(3 * dt);
        ctx.player.robot.repairTools(2 * dt);
      }
      if (s.typeId === 'generator' && dp < 6) ctx.player.robot.recharge(5 * dt);
      if (s.typeId === 'garage') {
        for (const v of ctx.vehicles.list) {
          if (Math.hypot(v.x - s.x, v.z - s.z) < 14 && v !== ctx.mounted) {
            v.repair(4 * dt);
            v.recharge(6 * dt);
          }
        }
      }
      if (s.typeId === 'turret') this.fireTurret(s, ctx, dt);
    }
  }

  fireTurret(s, ctx, dt) {
    s.cooldown -= dt;
    const head = s.mesh.getObjectByName('head');
    let target = null;
    let best = s.def.range;
    for (const e of ctx.enemies.enemies) {
      const d = Math.hypot(e.x - s.x, e.z - s.z);
      if (e.alive && d < best) { best = d; target = { kind: 'enemy', obj: e, x: e.x, y: e.y, z: e.z }; }
    }
    for (const c of ctx.creatures.creatures) {
      if (!c.alive || !c.isPredator || c.species.temperament !== 'agressif') continue;
      const d = Math.hypot(c.x - s.x, c.z - s.z);
      if (d < best) { best = d; target = { kind: 'creature', obj: c, x: c.x, y: c.y + 1, z: c.z }; }
    }
    if (!target) return;
    if (head) head.rotation.y = Math.atan2(target.x - s.x, target.z - s.z) - s.yaw;
    if (s.cooldown > 0) return;
    s.cooldown = 1.2;
    const from = { x: s.x, y: s.y + 1.7, z: s.z };
    ctx.effects.beam(from, { x: target.x, y: target.y, z: target.z }, '#4dff9a', 0.14);
    if (target.kind === 'enemy') ctx.enemies.hit(target.obj, s.def.damage);
    else if (target.obj.takeDamage(s.def.damage, { x: s.x, z: s.z })) ctx.onKill?.(target.obj);
  }

  // ---- Placement ghost ---------------------------------------------------

  /** Shows a translucent preview of `typeId` (green when placeable, red otherwise). */
  setGhost(typeId) {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost.traverse((o) => o.geometry?.dispose());
      this.ghost = null;
    }
    this.ghostType = typeId;
    if (!typeId) return;
    this.ghost = STRUCTURE_BUILDERS[typeId]();
    this.ghost.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: '#4dff9a', transparent: true, opacity: 0.45, depthWrite: false });
        o.castShadow = false;
      }
    });
    this.scene.add(this.ghost);
  }

  moveGhost(x, z, yaw, valid) {
    if (!this.ghost) return;
    this.ghost.position.set(x, this.world.heightAt(x, z), z);
    this.ghost.rotation.y = yaw;
    this.ghost.traverse((o) => { if (o.isMesh) o.material.color.set(valid ? '#4dff9a' : '#ff5d5d'); });
  }

  toJSON() {
    return this.list.map((s) => ({ id: s.id, type: s.typeId, x: s.x, z: s.z, yaw: s.yaw, level: s.level, storage: s.storage }));
  }

  restore(entries) {
    for (const e of entries ?? []) {
      if (this.defs[e.type]) this.add(e.type, e.x, e.z, e.yaw ?? 0, { id: e.id, level: e.level ?? 1, storage: e.storage ?? {} });
    }
    this.nextId = Math.max(this.nextId, ...this.list.map((s) => Number(String(s.id).slice(1)) + 1 || 1));
  }

  dispose() {
    for (const s of this.list) this.remove(s);
    this.setGhost(null);
  }
}
