// Turns chunk data (typed arrays from the worker) into three.js objects.
import * as THREE from 'three';
import { VEG_STRIDE, SURFACE_STRIDE } from './chunkGenerator.js';
import { resourceVisual } from './vegetationAssets.js';

const SKIRT_DEPTH = 14;
const UV_SCALE = 1 / 24;

/** Terrain surface with skirts hanging below the edges, which hides LOD seams. */
export function buildTerrainGeometry(payload) {
  const { n, step, origin, heights, normals, colors, surface } = payload;
  const side = n + 1;
  const topCount = side * side;
  const skirtBase = topCount;
  const total = topCount + side * 4;
  const positions = new Float32Array(total * 3);
  const norms = new Float32Array(total * 3);
  const cols = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const surfA = new Float32Array(total * 4);
  const surfB = new Float32Array(total * 4);
  const copySurface = (k, src) => {
    for (let l = 0; l < 4; l++) {
      surfA[k * 4 + l] = surface ? surface[src * SURFACE_STRIDE + l] : l === 0 ? 1 : 0;
      surfB[k * 4 + l] = surface ? surface[src * SURFACE_STRIDE + 4 + l] : 0;
    }
  };

  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      const x = origin[0] + i * step;
      const z = origin[1] + j * step;
      setVertex(k, x, heights[k], z, normals, colors, positions, norms, cols, uvs);
      copySurface(k, k);
    }
  }
  // Skirt vertices: one per top-edge vertex, dropped straight down.
  const edges = [
    (t) => t,                       // j = 0 row (i varies)
    (t) => side * (side - 1) + t,   // j = n row
    (t) => t * side,                // i = 0 column
    (t) => t * side + (side - 1)    // i = n column
  ];
  const edgeMeta = [];
  edges.forEach((indexOf, e) => {
    for (let t = 0; t < side; t++) {
      const top = indexOf(t);
      const s = skirtBase + e * side + t;
      setVertex(s, positions[top * 3], heights[top] - SKIRT_DEPTH, positions[top * 3 + 2], normals, colors, positions, norms, cols, uvs, top);
      copySurface(s, top);
      edgeMeta.push(s);
    }
  });

  const indices = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  edges.forEach((indexOf, e) => {
    for (let t = 0; t < n; t++) {
      const t0 = indexOf(t);
      const t1 = indexOf(t + 1);
      const s0 = skirtBase + e * side + t;
      const s1 = s0 + 1;
      indices.push(t0, s0, t1, t1, s0, s1);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('surfA', new THREE.BufferAttribute(surfA, 4));
  geometry.setAttribute('surfB', new THREE.BufferAttribute(surfB, 4));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function setVertex(k, x, y, z, normals, colors, positions, norms, cols, uvs, source = -1) {
  const src = source >= 0 ? source : k;
  positions[k * 3] = x;
  positions[k * 3 + 1] = y;
  positions[k * 3 + 2] = z;
  norms[k * 3] = normals[src * 3];
  norms[k * 3 + 1] = normals[src * 3 + 1];
  norms[k * 3 + 2] = normals[src * 3 + 2];
  cols[k * 3] = colors[src * 3];
  cols[k * 3 + 1] = colors[src * 3 + 1];
  cols[k * 3 + 2] = colors[src * 3 + 2];
  uvs[k * 2] = x * UV_SCALE;
  uvs[k * 2 + 1] = z * UV_SCALE;
}

/**
 * Builds the group for one chunk: terrain, instanced vegetation, resource nodes.
 * `assets` comes from createVegetationAssets, `terrainMaterial` is shared.
 */
export function buildChunkGroup(payload, assets, terrainMaterial) {
  const group = new THREE.Group();
  group.name = `chunk ${payload.id}`;

  const terrain = new THREE.Mesh(buildTerrainGeometry(payload), terrainMaterial);
  terrain.receiveShadow = true;
  group.add(terrain);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (const kind of Object.keys(payload.veg)) {
    const data = payload.veg[kind];
    const count = data.length / VEG_STRIDE;
    const byVariant = new Map();
    for (let i = 0; i < count; i++) {
      const variant = data[i * VEG_STRIDE + 5];
      if (!byVariant.has(variant)) byVariant.set(variant, []);
      byVariant.get(variant).push(i);
    }
    for (const [variant, list] of byVariant) {
      const mesh = new THREE.InstancedMesh(assets.geometry(kind, variant), assets.material(kind), list.length);
      list.forEach((idx, m) => {
        const o = idx * VEG_STRIDE;
        dummy.position.set(data[o], data[o + 1], data[o + 2]);
        dummy.rotation.set(data[o + 7], data[o + 3], 0, 'YXZ');
        const s = data[o + 4];
        dummy.scale.set(s, kind === 'grass' ? s * 0.9 : s, s);
        dummy.updateMatrix();
        mesh.setMatrixAt(m, dummy.matrix);
        const t = data[o + 6];
        color.setRGB(0.86 + 0.28 * t, 0.9 + 0.2 * (1 - t), 0.86 + 0.24 * t);
        mesh.setColorAt(m, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = assets.isTree(kind);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  const nodes = [];
  for (const node of payload.resources) {
    const visual = resourceVisual(node.item);
    const mesh = new THREE.Mesh(visual.geometry, visual.material);
    mesh.position.set(node.x, node.y, node.z);
    mesh.rotation.y = node.yaw;
    mesh.castShadow = true;
    mesh.userData = { kind: 'resource', id: node.id, item: node.item };
    group.add(mesh);
    nodes.push({ id: node.id, item: node.item, x: node.x, y: node.y, z: node.z, mesh });
  }

  return { group, nodes };
}

