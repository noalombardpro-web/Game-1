// Ray queries used by weapons and the scanner: spheres (creatures, enemies, nodes)
// and the terrain (height-field march).

/** Distance along a unit ray to the first hit with a sphere, or null. */
export function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return c < 0 ? 0 : null;
  return t;
}

/** Distance along a unit ray until it goes below the terrain, or `maxDist` if it never does. */
export function rayTerrain(world, origin, dir, maxDist, step = 1) {
  for (let t = step; t <= maxDist; t += step) {
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    if (y < world.heightAt(x, z)) return Math.max(0, t - step);
  }
  return maxDist;
}
