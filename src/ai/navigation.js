// Terrain-aware steering: looks ahead along candidate headings and picks the first
// one that is walkable (slope limit, water, obstacles).
import { WATER_LEVEL } from '../world/terrain.js';

const OFFSETS = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.2, -2.2];

/**
 * @param world    streaming world (heightAt, collidersNear)
 * @param x, z     current position
 * @param y        current ground height
 * @param desired  desired heading in radians (0 = +Z)
 * @param opts     { aquatic, minDepth (water depth required when aquatic), maxSlope, lookAhead }
 * @returns heading to follow, or null when every candidate is blocked
 */
export function chooseHeading(world, x, z, y, desired, opts = {}) {
  const aquatic = !!opts.aquatic;
  const maxSlope = opts.maxSlope ?? 0.7;
  const look = opts.lookAhead ?? 3;
  const minDepth = opts.minDepth ?? 0.2;
  for (const off of OFFSETS) {
    const yaw = desired + off;
    const px = x + Math.sin(yaw) * look;
    const pz = z + Math.cos(yaw) * look;
    const h = world.heightAt(px, pz);
    if (aquatic ? h > WATER_LEVEL - minDepth : h < WATER_LEVEL - 0.4) continue;
    if (Math.abs(h - y) / look > maxSlope) continue;
    if (blockedByCollider(world, px, pz)) continue;
    return yaw;
  }
  return null;
}

function blockedByCollider(world, x, z) {
  for (const arr of world.collidersNear(x, z)) {
    for (let i = 0; i < arr.length; i += 3) {
      const dx = x - arr[i];
      const dz = z - arr[i + 1];
      const r = arr[i + 2] + 0.7;
      if (dx * dx + dz * dz < r * r) return true;
    }
  }
  return false;
}

/** Wraps an angle difference into [-PI, PI]. */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
