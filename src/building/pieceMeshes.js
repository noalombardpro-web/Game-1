// three.js meshes for grid-building pieces: textured wood / brick / metal, a translucent placement
// preview and the cell overlay shown in edit mode.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, LEVEL, THICK, ROOF_RISE, EDIT_GRID, pieceBounds, pieceBoxes } from './pieces.js';
import { loadTexture } from '../world/materials.js';

let materials = null;
function pieceMaterials() {
  if (materials) return materials;
  const metal = loadTexture('stone.jpg');
  materials = {
    wood: new THREE.MeshStandardMaterial({ map: loadTexture('wood.jpg'), roughness: 0.75 }),
    stone: new THREE.MeshStandardMaterial({ map: loadTexture('brick.jpg'), roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ map: metal, color: '#aab4c0', metalness: 0.75, roughness: 0.35 }),
    ghost: new THREE.MeshBasicMaterial({ color: '#58b8ff', transparent: true, opacity: 0.35, depthWrite: false }),
    ghostBad: new THREE.MeshBasicMaterial({ color: '#ff5a5a', transparent: true, opacity: 0.35, depthWrite: false }),
    cellOn: new THREE.MeshBasicMaterial({ color: '#58b8ff', transparent: true, opacity: 0.28, depthWrite: false }),
    cellOff: new THREE.MeshBasicMaterial({ color: '#ff9a3d', transparent: true, opacity: 0.18, depthWrite: false, wireframe: true })
  };
  return materials;
}

/** Box geometry in world coordinates with planar UVs (1 texture tile per 2 m) so cells line up. */
function worldBox(min, max) {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (ay > 0.5) uv.setXY(i, x / 2, z / 2);
    else if (ax > 0.5) uv.setXY(i, z / 2, y / 2);
    else uv.setXY(i, x / 2, y / 2);
  }
  return g;
}

function rampGeometry(p) {
  const b = pieceBounds(p);
  const len = Math.hypot(CELL, LEVEL);
  const g = new THREE.BoxGeometry(CELL, THICK, len);
  const tilt = new THREE.Matrix4().makeRotationX(-Math.atan2(LEVEL, CELL));
  const yaw = new THREE.Matrix4().makeRotationY([0, Math.PI / 2, Math.PI, -Math.PI / 2][p.d ?? 0]);
  g.applyMatrix4(tilt).applyMatrix4(yaw);
  g.translate((b.minX + b.maxX) / 2, b.minY + LEVEL / 2 + THICK / 2, (b.minZ + b.maxZ) / 2);
  return g;
}

function roofGeometry(p) {
  const b = pieceBounds(p);
  const g = new THREE.ConeGeometry(CELL / Math.SQRT2, ROOF_RISE, 4, 1, false, Math.PI / 4);
  g.translate((b.minX + b.maxX) / 2, b.minY + THICK + ROOF_RISE / 2, (b.minZ + b.maxZ) / 2);
  return g;
}

/** Geometry of a piece (after edits), in world space. */
export function pieceGeometry(p) {
  if (p.type === 'ramp') return rampGeometry(p);
  if (p.type === 'roof') return roofGeometry(p);
  const boxes = pieceBoxes(p).map((box) => worldBox(box.min, box.max));
  const merged = mergeGeometries(boxes, false);
  for (const g of boxes) g.dispose();
  return merged;
}

export function createPieceMesh(p) {
  const mesh = new THREE.Mesh(pieceGeometry(p), pieceMaterials()[p.m]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.piece = p;
  return mesh;
}

/** Translucent preview of a piece about to be placed. */
export function createGhostMesh(p, valid) {
  const m = pieceMaterials();
  const mesh = new THREE.Mesh(pieceGeometry({ ...p, edit: 0 }), valid ? m.ghost : m.ghostBad);
  mesh.renderOrder = 5;
  return mesh;
}

/** Cell overlay for edit mode: one translucent box per cell, highlighted when kept. */
export function createEditOverlay(p) {
  const group = new THREE.Group();
  const grid = EDIT_GRID[p.type];
  if (!grid) return group;
  const m = pieceMaterials();
  const all = pieceBoxes({ ...p, edit: 0 });
  all.forEach((box, n) => {
    const removed = (p.edit >> n) & 1;
    const pad = 0.04;
    const g = worldBox(box.min.map((v) => v - pad), box.max.map((v) => v + pad));
    const mesh = new THREE.Mesh(g, removed ? m.cellOff : m.cellOn);
    mesh.renderOrder = 6;
    group.add(mesh);
  });
  return group;
}

/** Keeps one mesh per piece in sync with a BuildGrid. */
export class PieceRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'grid pieces';
    scene.add(this.group);
    this.meshes = new Map();
    this.version = -1;
  }

  sync(grid) {
    if (grid.version === this.version) return;
    this.version = grid.version;
    const live = new Set();
    for (const p of grid.list) {
      live.add(p);
      const old = this.meshes.get(p);
      const sig = `${p.edit}:${p.m}`;
      if (old && old.userData.sig === sig) continue;
      if (old) { this.group.remove(old); old.geometry.dispose(); }
      const mesh = createPieceMesh(p);
      mesh.userData.sig = sig;
      this.group.add(mesh);
      this.meshes.set(p, mesh);
    }
    for (const [p, mesh] of this.meshes) {
      if (live.has(p)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(p);
    }
  }

  dispose() {
    for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    this.scene.remove(this.group);
    this.meshes.clear();
  }
}
