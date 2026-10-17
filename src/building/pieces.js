// Grid building (walls, floors, ramps, roofs) in the style of arena shooters: pieces snap to a
// 4 m grid with 3.6 m levels, cost wood / stone / metal, can be edited (cells removed to make doors
// and windows), take damage, and collapse when nothing connects them to the ground.
// Pure logic: geometry descriptions, walkable surfaces and collisions; meshes live in pieceMeshes.js.

export const CELL = 4;
export const LEVEL = 3.6;
export const THICK = 0.2;
export const ROOF_RISE = 1.8;

export const MATERIALS = {
  wood: { item: 'mat_wood', name: 'Bois', hp: 150, cost: 10 },
  stone: { item: 'mat_stone', name: 'Pierre', hp: 300, cost: 10 },
  metal: { item: 'mat_metal', name: 'Métal', hp: 500, cost: 10 }
};
export const MATERIAL_ORDER = ['wood', 'stone', 'metal'];
export const PIECE_TYPES = ['wall', 'floor', 'ramp', 'roof'];
export const PIECE_NAMES = { wall: 'Mur', floor: 'Sol', ramp: 'Rampe', roof: 'Toit' };
/** Editable cell grid per piece type: [columns, rows]. */
export const EDIT_GRID = { wall: [3, 3], floor: [2, 2] };

/** Cardinal directions: 0 = +z, 1 = +x, 2 = -z, 3 = -x. */
export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export function cardinal(yaw) {
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(a / (Math.PI / 2)) % 4;
}

/**
 * Unique slot key of a piece. Walls sit on cell edges: o = 0 for an edge along x (at z = j*CELL),
 * o = 1 for an edge along z (at x = i*CELL). Ramps and roofs share the cell volume.
 */
export function pieceKey(p) {
  if (p.type === 'wall') return `W:${p.i}:${p.j}:${p.k}:${p.o}`;
  if (p.type === 'floor') return `F:${p.i}:${p.j}:${p.k}`;
  return `V:${p.i}:${p.j}:${p.k}`;
}

/** Axis-aligned bounds { minX, maxX, minY, maxY, minZ, maxZ } of a piece. */
export function pieceBounds(p) {
  const y0 = p.k * LEVEL;
  if (p.type === 'wall') {
    if (p.o === 0) return { minX: p.i * CELL, maxX: (p.i + 1) * CELL, minY: y0, maxY: y0 + LEVEL, minZ: p.j * CELL - THICK / 2, maxZ: p.j * CELL + THICK / 2 };
    return { minX: p.i * CELL - THICK / 2, maxX: p.i * CELL + THICK / 2, minY: y0, maxY: y0 + LEVEL, minZ: p.j * CELL, maxZ: (p.j + 1) * CELL };
  }
  const top = p.type === 'floor' ? y0 + THICK : p.type === 'ramp' ? y0 + LEVEL : y0 + ROOF_RISE;
  return { minX: p.i * CELL, maxX: (p.i + 1) * CELL, minY: y0, maxY: top, minZ: p.j * CELL, maxZ: (p.j + 1) * CELL };
}

const cellRemoved = (p, c, r) => {
  const grid = EDIT_GRID[p.type];
  return grid ? ((p.edit ?? 0) >> (r * grid[0] + c)) & 1 : 0;
};

/**
 * Boxes making up the piece (after edits), in world space: [{ min: [x,y,z], max: [x,y,z] }].
 * Ramps and roofs are not boxes and return [] (see surfaceHeight).
 */
export function pieceBoxes(p) {
  const b = pieceBounds(p);
  const grid = EDIT_GRID[p.type];
  if (!grid) return [];
  const [cols, rows] = grid;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellRemoved(p, c, r)) continue;
      if (p.type === 'wall') {
        const h = LEVEL / rows;
        const along = CELL / cols;
        const y0 = b.minY + r * h;
        if (p.o === 0) out.push({ min: [b.minX + c * along, y0, b.minZ], max: [b.minX + (c + 1) * along, y0 + h, b.maxZ] });
        else out.push({ min: [b.minX, y0, b.minZ + c * along], max: [b.maxX, y0 + h, b.minZ + (c + 1) * along] });
      } else {
        const s = CELL / cols;
        out.push({ min: [b.minX + c * s, b.minY, b.minZ + r * s], max: [b.minX + (c + 1) * s, b.maxY, b.minZ + (r + 1) * s] });
      }
    }
  }
  return out;
}

/** Height of the walkable top of a ramp / roof / floor at (x, z), or null when (x, z) is outside it. */
export function surfaceHeight(p, x, z) {
  const b = pieceBounds(p);
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return null;
  const u = (x - b.minX) / CELL;
  const v = (z - b.minZ) / CELL;
  if (p.type === 'floor') {
    const [cols, rows] = EDIT_GRID.floor;
    if (cellRemoved(p, Math.min(cols - 1, Math.floor(u * cols)), Math.min(rows - 1, Math.floor(v * rows)))) return null;
    return b.maxY;
  }
  if (p.type === 'ramp') {
    const t = [v, u, 1 - v, 1 - u][p.d ?? 0];
    return b.minY + THICK + t * LEVEL;
  }
  if (p.type === 'roof') {
    const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
    return b.minY + THICK + (1 - edge) * ROOF_RISE;
  }
  return null;
}

/**
 * Where a new piece goes, from the player's feet position, camera yaw and pitch (Fortnite-like
 * placement relative to the player rather than to the crosshair).
 */
export function placementFor(type, feet, yaw, pitch) {
  const pi = Math.floor(feet.x / CELL);
  const pj = Math.floor(feet.z / CELL);
  const k0 = Math.floor((feet.y + 0.6) / LEVEL);
  const d = cardinal(yaw);
  const [dx, dz] = DIRS[d];
  const up = pitch > 0.45 ? 1 : 0;
  if (type === 'wall') {
    // Edge of the player's cell in the facing direction.
    if (d === 0) return { type, i: pi, j: pj + 1, k: k0 + up, o: 0 };
    if (d === 2) return { type, i: pi, j: pj, k: k0 + up, o: 0 };
    if (d === 1) return { type, i: pi + 1, j: pj, k: k0 + up, o: 1 };
    return { type, i: pi, j: pj, k: k0 + up, o: 1 };
  }
  if (type === 'floor') {
    const here = pitch < -0.55;
    return { type, i: here ? pi : pi + dx, j: here ? pj : pj + dz, k: k0 + up };
  }
  if (type === 'ramp') return { type, i: pi + dx, j: pj + dz, k: k0 + up, d };
  return { type, i: pitch > 0.2 ? pi : pi + dx, j: pitch > 0.2 ? pj : pj + dz, k: k0 + 1 };
}

function overlap(a, b, pad = 0.05) {
  return a.minX <= b.maxX + pad && a.maxX >= b.minX - pad && a.minY <= b.maxY + pad && a.maxY >= b.minY - pad
    && a.minZ <= b.maxZ + pad && a.maxZ >= b.minZ - pad;
}

export class BuildGrid {
  /** @param saved array of pieces from a save */
  constructor(saved = []) {
    this.pieces = new Map();
    this.version = 0;
    for (const s of saved) {
      if (!PIECE_TYPES.includes(s.type) || !MATERIALS[s.m]) continue;
      const p = { type: s.type, i: s.i | 0, j: s.j | 0, k: s.k | 0, o: s.o | 0, d: s.d | 0, m: s.m, hp: s.hp ?? MATERIALS[s.m].hp, edit: s.edit | 0 };
      this.pieces.set(pieceKey(p), p);
    }
  }

  get list() {
    return [...this.pieces.values()];
  }

  has(p) {
    return this.pieces.has(pieceKey(p));
  }

  /** Checks cost and slot; returns { ok, reason }. */
  canPlace(p, inventory) {
    if (this.has(p)) return { ok: false, reason: 'Emplacement occupé.' };
    const mat = MATERIALS[p.m];
    if (inventory.count(mat.item) < mat.cost) return { ok: false, reason: `${mat.name} insuffisant (${mat.cost} requis).` };
    return { ok: true };
  }

  place(p, inventory) {
    const check = this.canPlace(p, inventory);
    if (!check.ok) return check;
    const mat = MATERIALS[p.m];
    inventory.remove(mat.item, mat.cost);
    const piece = { type: p.type, i: p.i, j: p.j, k: p.k, o: p.o ?? 0, d: p.d ?? 0, m: p.m, hp: mat.hp, edit: 0 };
    this.pieces.set(pieceKey(piece), piece);
    this.version++;
    return { ok: true, piece };
  }

  /** Removes a piece (refunding half its cost when `refund`), then drops anything left unsupported. */
  remove(piece, inventory = null, terrainHeight = null) {
    if (!this.pieces.delete(pieceKey(piece))) return [];
    if (inventory) inventory.add(MATERIALS[piece.m].item, Math.floor(MATERIALS[piece.m].cost / 2));
    this.version++;
    return terrainHeight ? [piece, ...this.collapseUnsupported(terrainHeight)] : [piece];
  }

  /** Damages a piece; returns the list of pieces destroyed (itself and collapsed neighbours). */
  damage(piece, amount, terrainHeight) {
    piece.hp -= amount;
    if (piece.hp > 0) return [];
    return this.remove(piece, null, terrainHeight);
  }

  /** Toggles one edit cell. Returns false for non-editable pieces. */
  toggleCell(piece, c, r) {
    const grid = EDIT_GRID[piece.type];
    if (!grid || c < 0 || r < 0 || c >= grid[0] || r >= grid[1]) return false;
    const next = piece.edit ^ (1 << (r * grid[0] + c));
    // Keep at least one cell, otherwise the piece would vanish.
    if (next === (1 << (grid[0] * grid[1])) - 1) return false;
    piece.edit = next;
    this.version++;
    return true;
  }

  resetEdit(piece) {
    piece.edit = 0;
    this.version++;
  }

  /**
   * Removes every piece that has no path to the ground. A piece touches the ground when the terrain
   * under one of its corners reaches its base. Returns the removed pieces.
   */
  collapseUnsupported(terrainHeight) {
    const list = this.list;
    const bounds = list.map(pieceBounds);
    const grounded = list.map((p, n) => {
      const b = bounds[n];
      for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ], [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]]) {
        if (terrainHeight(x, z) >= b.minY - 0.6) return true;
      }
      return false;
    });
    const supported = new Array(list.length).fill(false);
    const queue = [];
    grounded.forEach((g, n) => { if (g) { supported[n] = true; queue.push(n); } });
    while (queue.length) {
      const a = queue.pop();
      for (let b = 0; b < list.length; b++) {
        if (!supported[b] && overlap(bounds[a], bounds[b])) {
          supported[b] = true;
          queue.push(b);
        }
      }
    }
    const fallen = list.filter((_, n) => !supported[n]);
    for (const p of fallen) this.pieces.delete(pieceKey(p));
    if (fallen.length) this.version++;
    return fallen;
  }

  /** Pieces whose bounds come within `r` metres of (x, z). */
  near(x, z, r = 8) {
    const out = [];
    for (const p of this.pieces.values()) {
      const b = pieceBounds(p);
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) out.push(p);
    }
    return out;
  }

  /**
   * Highest walkable surface under the feet: floors, ramps and roofs whose top is at most
   * `stepUp` above `y` (so the player can walk up ramps but not teleport onto a floor overhead).
   */
  groundAt(x, z, y, stepUp = 0.65) {
    let best = -Infinity;
    for (const p of this.near(x, z, 0.5)) {
      const h = surfaceHeight(p, x, z);
      if (h !== null && h <= y + stepUp && h > best) best = h;
    }
    return best;
  }

  /** Lowest ceiling (underside of a floor, ramp or roof) above the head, or Infinity. */
  ceilingAt(x, z, headY, feetY) {
    let best = Infinity;
    for (const p of this.near(x, z, 0.5)) {
      if (p.type === 'wall') continue;
      const h = surfaceHeight(p, x, z);
      if (h === null) continue;
      const under = h - THICK;
      if (under >= feetY + 0.7 && under < best && under <= headY + 0.5) best = under;
    }
    return best;
  }

  /**
   * Pushes a vertical cylinder (feet y .. y + height, radius) out of walls and of the vertical
   * faces of floors' edges. Mutates pos. Returns true when a collision happened.
   */
  resolve(pos, radius, height = 1.8) {
    let hit = false;
    for (const p of this.near(pos.x, pos.z, radius + 0.5)) {
      if (p.type !== 'wall') continue;
      for (const box of pieceBoxes(p)) {
        if (pos.y + height <= box.min[1] + 0.05 || pos.y >= box.max[1] - 0.05) continue;
        const cx = Math.max(box.min[0], Math.min(pos.x, box.max[0]));
        const cz = Math.max(box.min[2], Math.min(pos.z, box.max[2]));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (radius - d);
          pos.z += (dz / d) * (radius - d);
        } else if (p.o === 0) {
          pos.z += pos.z < (box.min[2] + box.max[2]) / 2 ? -(radius + THICK) : radius + THICK;
        } else {
          pos.x += pos.x < (box.min[0] + box.max[0]) / 2 ? -(radius + THICK) : radius + THICK;
        }
      }
    }
    return hit;
  }

  /**
   * First piece hit by a ray (origin, unit dir) within maxT, using the pieces' boxes (walls, floors)
   * or bounds (ramps, roofs). Returns { piece, t, point } or null.
   */
  raycast(origin, dir, maxT) {
    let best = null;
    for (const p of this.near(origin.x, origin.z, maxT)) {
      const boxes = EDIT_GRID[p.type] ? pieceBoxes(p) : [(() => { const b = pieceBounds(p); return { min: [b.minX, b.minY, b.minZ], max: [b.maxX, b.maxY, b.maxZ] }; })()];
      for (const box of boxes) {
        const t = rayBox(origin, dir, box);
        if (t !== null && t <= maxT && (!best || t < best.t)) best = { piece: p, t };
      }
    }
    if (best) best.point = { x: origin.x + dir.x * best.t, y: origin.y + dir.y * best.t, z: origin.z + dir.z * best.t };
    return best;
  }

  toJSON() {
    return this.list.map((p) => ({ type: p.type, i: p.i, j: p.j, k: p.k, o: p.o, d: p.d, m: p.m, hp: Math.round(p.hp), edit: p.edit }));
  }
}

/** Slab-method ray / AABB intersection; returns the entry distance or null. */
export function rayBox(o, d, box) {
  let tmin = 0;
  let tmax = Infinity;
  const oo = [o.x, o.y, o.z];
  const dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) {
      if (oo[a] < box.min[a] || oo[a] > box.max[a]) return null;
      continue;
    }
    let t1 = (box.min[a] - oo[a]) / dd[a];
    let t2 = (box.max[a] - oo[a]) / dd[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Which edit cell of `piece` contains the world point (on its surface). Returns { c, r } or null. */
export function cellAt(piece, point) {
  const grid = EDIT_GRID[piece.type];
  if (!grid) return null;
  const b = pieceBounds(piece);
  let u;
  let v;
  if (piece.type === 'wall') {
    u = piece.o === 0 ? (point.x - b.minX) / CELL : (point.z - b.minZ) / CELL;
    v = (point.y - b.minY) / LEVEL;
  } else {
    u = (point.x - b.minX) / CELL;
    v = (point.z - b.minZ) / CELL;
  }
  const c = Math.min(grid[0] - 1, Math.max(0, Math.floor(u * grid[0])));
  const r = Math.min(grid[1] - 1, Math.max(0, Math.floor(v * grid[1])));
  return { c, r };
}
