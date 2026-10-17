// Perception: sight (range, field of view, terrain occlusion) and hearing (range scaled by noise).
// Entities never read the player's position directly; they call these helpers.

/** True when the terrain blocks the line between two eye positions. */
export function terrainBlocks(world, ax, ay, az, bx, by, bz) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(2, Math.min(18, Math.floor(dist / 6)));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const y = ay + (by - ay) * t;
    if (world.heightAt(x, z) > y) return true;
  }
  return false;
}

/**
 * Sight test from an observer to a target.
 * @param observer { x, y, z, yaw }
 * @param target   { x, y, z }
 * @param range    maximum distance in metres
 * @param fovDeg   full field of view in degrees
 */
export function canSee(world, observer, target, range, fovDeg) {
  const eyeY = observer.y + 1.4;
  const dx = target.x - observer.x;
  const dz = target.z - observer.z;
  const dist = Math.hypot(dx, dz);
  if (dist > range) return false;
  if (fovDeg < 360 && dist > 0.01) {
    const forwardX = Math.sin(observer.yaw);
    const forwardZ = Math.cos(observer.yaw);
    const cos = (dx * forwardX + dz * forwardZ) / dist;
    if (cos < Math.cos((fovDeg * Math.PI) / 360)) return false;
  }
  return !terrainBlocks(world, observer.x, eyeY, observer.z, target.x, (target.y ?? 0) + 1.2, target.z);
}

/** Hearing test: sounds with loudness 0..1 are heard within `range * loudness`. */
export function canHear(observer, source, range, loudness) {
  if (loudness <= 0) return false;
  return Math.hypot(source.x - observer.x, source.z - observer.z) < range * loudness;
}
