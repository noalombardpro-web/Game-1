// Procedural low-poly assets for vegetation, rocks and resource nodes.
// Each kind has several variants so that neighbouring instances differ.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng.js';

/** Applies a flat colour to every vertex of a non-indexed geometry. */
function paint(geometry, hex) {
  const color = new THREE.Color(hex);
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = color.r;
    array[i * 3 + 1] = color.g;
    array[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return geometry;
}

/** Builds one painted, positioned primitive. Geometries are made non-indexed so they can be merged. */
function part(geometry, hex, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.scale(scale[0], scale[1], scale[2]);
  g.rotateX(rot[0]);
  g.rotateY(rot[1]);
  g.rotateZ(rot[2]);
  g.translate(at[0], at[1], at[2]);
  return paint(g, hex);
}

function jitterVertices(geometry, rng, amount) {
  const pos = geometry.attributes.position;
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    if (!seen.has(key)) seen.set(key, 1 + (rng() * 2 - 1) * amount);
    const f = seen.get(key);
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function pine(variant) {
  const H = 6.5 + variant * 1.6;
  const parts = [
    part(new THREE.CylinderGeometry(0.1, 0.16, H * 0.5, 6), '#5a4330', { at: [0, H * 0.25, 0] })
  ];
  const tiers = [[0.36, 0.3, 0.46], [0.6, 0.23, 0.42], [0.8, 0.14, 0.36]];
  const shade = ['#2c4a2b', '#355a33', '#3d6638'][variant % 3];
  for (const [yf, rf, hf] of tiers) {
    parts.push(part(new THREE.ConeGeometry(H * rf, H * hf, 7), shade, { at: [0, H * yf, 0] }));
  }
  return mergeGeometries(parts);
}

function broadleaf(variant) {
  const rng = createRng(0xa000 + variant);
  const r = 2.1 + variant * 0.45;
  const crown = jitterVertices(new THREE.IcosahedronGeometry(r, 1), rng, 0.18);
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.22, 0.32, r * 1.4, 6), '#4a3a2a', { at: [0, r * 0.7, 0] }),
    part(crown, ['#3f6b2a', '#4f7a31'][variant % 2], { at: [0, r * 1.9, 0] })
  ]);
}

function palm(variant) {
  const H = 7 + variant * 1.2;
  const parts = [part(new THREE.CylinderGeometry(0.14, 0.22, H, 6), '#7b6443', { at: [0.3, H / 2, 0], rot: [0.12, 0, 0.1] })];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(part(new THREE.BoxGeometry(0.4, 0.06, 3.2), '#3d7a34', {
      at: [0.3 + Math.cos(a) * 1.4, H + 0.2 - 0.6, Math.sin(a) * 1.4],
      rot: [0, -a, -0.45]
    }));
  }
  return mergeGeometries(parts);
}

function fern() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(part(new THREE.BoxGeometry(0.1, 0.02, 1.1), '#2f6b2a', {
      at: [Math.cos(a) * 0.45, 0.35, Math.sin(a) * 0.45], rot: [0.5, -a, 0]
    }));
  }
  return mergeGeometries(parts);
}

function grass(variant) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.55, 0.75 + variant * 0.1);
    g.translate(0, 0.37, 0);
    parts.push(part(g, ['#6f9a3c', '#8aa84a', '#5c8a34'][(i + variant) % 3], { rot: [0, i * 1.05, 0] }));
  }
  return mergeGeometries(parts);
}

function shrub(variant) {
  const rng = createRng(0xb000 + variant);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const blob = jitterVertices(new THREE.IcosahedronGeometry(0.7 + rng() * 0.3, 1), rng, 0.2);
    parts.push(part(blob, variant ? '#6b7b3c' : '#4c6e33', {
      at: [(rng() - 0.5) * 1.2, 0.5, (rng() - 0.5) * 1.2], scale: [1.2, 0.75, 1.1]
    }));
  }
  return mergeGeometries(parts);
}

function cactus() {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.3, 0.34, 3.2, 8), '#5f8a4a', { at: [0, 1.6, 0] }),
    part(new THREE.CylinderGeometry(0.16, 0.18, 1.1, 6), '#5f8a4a', { at: [0.5, 1.7, 0], rot: [0, 0, Math.PI / 2] }),
    part(new THREE.CylinderGeometry(0.16, 0.18, 1.2, 6), '#5f8a4a', { at: [0.95, 2.25, 0] })
  ]);
}

function rock(variant) {
  const rng = createRng(0xc000 + variant);
  const g = jitterVertices(new THREE.IcosahedronGeometry(1.0 + variant * 0.2, 1), rng, 0.3);
  return mergeGeometries([part(g, ['#7d766b', '#8a8176', '#6b6358'][variant % 3], { at: [0, 0.4, 0], scale: [1.2, 0.7, 1] })]);
}

const KIND_VARIANTS = { pine: 2, broadleaf: 2, palm: 1, fern: 1, grass: 1, shrub: 1, cactus: 1, rock: 2 };
const KIND_FACTORY = { pine, broadleaf, palm, fern: () => fern(), grass, shrub, cactus: () => cactus(), rock };
const TREE_KINDS = new Set(['pine', 'broadleaf', 'palm', 'cactus']);

/** Creates and caches geometries and materials for vegetation. */
export function createVegetationAssets(windUniforms) {
  const geometries = new Map();
  const materials = new Map();

  function geometry(kind, variant) {
    const key = `${kind}:${variant}`;
    if (!geometries.has(key)) {
      const factory = KIND_FACTORY[kind];
      if (!factory) throw new Error(`Unknown vegetation kind ${kind}`);
      geometries.set(key, factory(variant));
    }
    return geometries.get(key);
  }

  function material(kind) {
    if (!materials.has(kind)) {
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0,
        side: kind === 'grass' || kind === 'fern' ? THREE.DoubleSide : THREE.FrontSide
      });
      if (!TREE_KINDS.has(kind) && kind !== 'grass' && kind !== 'fern' && kind !== 'shrub') {
        materials.set(kind, mat);
        return mat;
      }
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = windUniforms.uTime;
        shader.uniforms.uWind = windUniforms.uWind;
        shader.uniforms.uStrength = windUniforms.uStrength;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uTime;
            uniform vec2 uWind;
            uniform float uStrength;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              float swayPhase = uTime * 1.7 + instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
              float sway = (sin(swayPhase) * 0.6 + sin(swayPhase * 2.3) * 0.4) * uStrength;
              float bend = max(position.y, 0.0);
              transformed.x += sway * bend * 0.012 * (1.0 + uWind.x * 0.5);
              transformed.z += sway * bend * 0.012 * (uWind.y * 0.5 + 0.3);
            #endif`);
      };
      mat.customProgramCacheKey = () => `veg-wind-${kind}`;
      materials.set(kind, mat);
    }
    return materials.get(kind);
  }

  return { geometry, material, variants: KIND_VARIANTS, isTree: (kind) => TREE_KINDS.has(kind) };
}

const resourceGeometries = new Map();
const resourceMaterials = new Map();

/** Geometry and material for a resource node, keyed by item id. Shared across nodes. */
export function resourceVisual(item) {
  if (!resourceGeometries.has(item)) {
    let geo;
    let mat;
    switch (item) {
      case 'crystal_energy':
        geo = new THREE.OctahedronGeometry(0.6, 0);
        geo.scale(0.6, 1.6, 0.6);
        geo.translate(0, 0.9, 0);
        mat = new THREE.MeshStandardMaterial({
          color: '#2fa8d8', emissive: '#2fd4ff', emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.2,
          transparent: true, opacity: 0.92
        });
        break;
      case 'ore_metal':
        geo = jitterVertices(new THREE.IcosahedronGeometry(0.9, 1), createRng(77), 0.25);
        mat = new THREE.MeshStandardMaterial({ color: '#9aa6b2', metalness: 0.75, roughness: 0.35, emissive: '#2a2010', emissiveIntensity: 0.3 });
        break;
      case 'mineral_silicate':
        geo = new THREE.ConeGeometry(0.6, 1.4, 5);
        geo.translate(0, 0.7, 0);
        mat = new THREE.MeshStandardMaterial({ color: '#d9c9a3', roughness: 0.5, metalness: 0.05 });
        break;
      case 'electronic_part':
        geo = new THREE.BoxGeometry(0.9, 0.35, 0.6);
        geo.translate(0, 0.2, 0);
        mat = new THREE.MeshStandardMaterial({ color: '#1f3b2c', metalness: 0.5, roughness: 0.4, emissive: '#27ff9a', emissiveIntensity: 0.5 });
        break;
      case 'alien_sample':
        geo = new THREE.TorusKnotGeometry(0.45, 0.14, 48, 8);
        geo.translate(0, 0.6, 0);
        mat = new THREE.MeshStandardMaterial({ color: '#8a3fd0', emissive: '#c060ff', emissiveIntensity: 1.2, roughness: 0.3 });
        break;
      default:
        geo = new THREE.SphereGeometry(0.5, 10, 8);
        geo.scale(1, 0.7, 1);
        geo.translate(0, 0.35, 0);
        mat = new THREE.MeshStandardMaterial({ color: '#7fb069', emissive: '#2b5a2a', emissiveIntensity: 0.4, roughness: 0.6 });
    }
    resourceGeometries.set(item, geo);
    resourceMaterials.set(item, mat);
  }
  return { geometry: resourceGeometries.get(item), material: resourceMaterials.get(item) };
}
