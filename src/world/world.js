// World streaming: keeps the chunks around the player loaded, at a level of detail
// that depends on distance. Chunk data is generated in Web Workers and turned into
// meshes on the main thread, a few per frame, so the frame time stays stable.
import * as THREE from 'three';
import { CHUNK_SIZE, WATER_LEVEL } from './terrain.js';
import { buildChunkGroup } from './chunkMesh.js';
import { generateChunk, COLLIDER_STRIDE } from './chunkGenerator.js';

const MAX_IN_FLIGHT = 6;

/** Level of detail for a chunk at Chebyshev distance `d` (in chunks) from the player. */
export function lodForDistance(d) {
  if (d <= 2) return 0;
  if (d <= 4) return 1;
  return 2;
}

export class World {
  /**
   * @param options.scene            three.js scene
   * @param options.seed             world seed
   * @param options.terrain          terrain model (createTerrain)
   * @param options.content          loaded content tables (loadContent)
   * @param options.assets           vegetation assets (createVegetationAssets)
   * @param options.terrainMaterial  shared terrain material
   * @param options.quality          { viewRadius, vegDensity }
   * @param options.collected        Set of collected resource node ids
   * @param options.onChunkReady     called with a chunk after its meshes are added
   * @param options.onChunkRemoved   called with a chunk key before it is unloaded
   */
  constructor(options) {
    this.scene = options.scene;
    this.seed = options.seed;
    this.terrain = options.terrain;
    this.content = options.content;
    this.assets = options.assets;
    this.terrainMaterial = options.terrainMaterial;
    this.collected = options.collected ?? new Set();
    this.onChunkReady = options.onChunkReady ?? (() => {});
    this.onChunkRemoved = options.onChunkRemoved ?? (() => {});
    this.quality = options.quality;

    this.chunks = new Map();
    this.pending = new Map();
    this.inflight = new Map();
    this.queued = new Map();
    this.wanted = new Map();
    this.results = [];
    this.dynamicColliders = new Float32Array(0);
    this.nextRequestId = 1;
    this.workers = [];
    this.syncFallback = false;
    this.stats = { generated: 0, built: 0, lastBuildMs: 0 };

    this.water = this.createWater();
    this.scene.add(this.water);
    this.startWorkers();
  }

  get viewRadius() {
    return this.quality.viewRadius;
  }

  createWater() {
    const geometry = new THREE.PlaneGeometry(6000, 6000);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: '#1f6f80', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.74, depthWrite: false, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = WATER_LEVEL;
    mesh.renderOrder = 2;
    return mesh;
  }

  startWorkers() {
    if (typeof Worker === 'undefined') {
      this.syncFallback = true;
      return;
    }
    try {
      const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency ?? 4) - 1));
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (event) => this.onWorkerMessage(event.data);
        worker.onerror = (event) => {
          console.error('[world] chunk worker failed', event.message);
          this.syncFallback = true;
        };
        this.workers.push(worker);
      }
    } catch (error) {
      console.warn('[world] workers unavailable, generating on the main thread', error);
      this.syncFallback = true;
    }
  }

  onWorkerMessage(msg) {
    const key = this.inflight.get(msg.requestId);
    if (key === undefined) return;
    this.inflight.delete(msg.requestId);
    const pending = this.pending.get(key);
    this.pending.delete(key);
    if (msg.type === 'error') {
      console.error('[world] chunk generation failed', msg.message);
      return;
    }
    this.results.push({ key, lod: pending.lod, payload: msg.payload });
    this.queued.set(key, pending.lod);
  }

  /** Requests chunk generation, on a worker or synchronously if workers are unavailable. */
  request(cx, cz, lod, key) {
    const req = { cx, cz, lod, seed: this.seed, density: this.quality.vegDensity };
    if (this.syncFallback || this.workers.length === 0) {
      const payload = generateChunk(this.terrain, this.content, req);
      this.results.push({ key, lod, payload });
      this.queued.set(key, lod);
      return;
    }
    const requestId = this.nextRequestId++;
    const worker = this.workers[requestId % this.workers.length];
    this.inflight.set(requestId, key);
    this.pending.set(key, { lod, requestId });
    worker.postMessage({ type: 'chunk', requestId, ...req });
  }

  /**
   * Streams chunks around (px, pz). Call once per frame.
   * @param maxBuilds maximum number of meshes built this frame
   */
  update(px, pz, maxBuilds = 2) {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const R = this.viewRadius;

    const wanted = [];
    this.wanted = new Map();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        const w = { cx: pcx + dx, cz: pcz + dz, d, lod: lodForDistance(d) };
        wanted.push(w);
        this.wanted.set(`${w.cx},${w.cz}`, w.lod);
      }
    }
    wanted.sort((a, b) => a.d - b.d);

    for (const w of wanted) {
      const key = `${w.cx},${w.cz}`;
      const existing = this.chunks.get(key);
      if (existing && existing.lod === w.lod) continue;
      if (this.pending.get(key)?.lod === w.lod || this.queued.get(key) === w.lod) continue;
      if (this.inflight.size >= MAX_IN_FLIGHT && !this.syncFallback) continue;
      this.request(w.cx, w.cz, w.lod, key);
    }

    for (const [key, chunk] of this.chunks) {
      if (Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz)) > R + 1) {
        this.unload(key);
      }
    }

    this.flushResults(maxBuilds, pcx, pcz);
    this.water.position.set(px, WATER_LEVEL, pz);
  }

  flushResults(maxBuilds, pcx, pcz) {
    let built = 0;
    const start = performance.now();
    while (this.results.length && built < maxBuilds) {
      const { key, lod, payload } = this.results.shift();
      this.queued.delete(key);
      // Skip chunks that left the view or changed level of detail while queued.
      if (this.wanted.get(key) !== lod) continue;
      const [cx, cz] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > this.viewRadius + 1) continue;
      this.stats.generated++;
      this.replace(key, cx, cz, lod, payload);
      built++;
    }
    if (built) this.stats.lastBuildMs = performance.now() - start;
  }

  replace(key, cx, cz, lod, payload) {
    const old = this.chunks.get(key);
    if (old) this.unload(key);
    const assets = this.assets;
    const built = buildChunkGroup(this.filterCollected(payload), assets, this.terrainMaterial);
    this.scene.add(built.group);
    const chunk = {
      key, cx, cz, lod, group: built.group, nodes: built.nodes,
      colliders: payload.colliders, spawns: lod === 0 ? payload.spawns : []
    };
    this.chunks.set(key, chunk);
    this.stats.built++;
    this.onChunkReady(chunk);
  }

  filterCollected(payload) {
    if (this.collected.size === 0) return payload;
    return { ...payload, resources: payload.resources.filter((r) => !this.collected.has(r.id)) };
  }

  unload(key) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.onChunkRemoved(chunk);
    this.scene.remove(chunk.group);
    chunk.group.traverse((obj) => {
      if (obj.isInstancedMesh) obj.dispose();
      if (obj.isMesh && !obj.isInstancedMesh && obj.geometry) obj.geometry.dispose();
    });
    this.chunks.delete(key);
  }

  /** Terrain height in metres at (x, z). */
  heightAt(x, z) {
    return this.terrain.height(x, z);
  }

  /** Marks a resource node as collected: it disappears and stays gone after save/load. */
  collectNode(node) {
    this.collected.add(node.id);
    node.mesh.visible = false;
    const chunk = this.chunks.get(chunkKeyAt(node.x, node.z));
    if (chunk) chunk.nodes = chunk.nodes.filter((n) => n.id !== node.id);
  }

  /** Resource nodes in the loaded chunks around (x, z). */
  nodesNear(x, z) {
    const out = [];
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this.chunks.get(`${cx + dx},${cz + dz}`);
        if (chunk) out.push(...chunk.nodes);
      }
    }
    return out;
  }

  /** Solid objects that are not part of the terrain chunks (base structures). */
  setDynamicColliders(array) {
    this.dynamicColliders = array;
  }

  /** Colliders (x, z, radius) around (x, z), as flat arrays. */
  collidersNear(x, z) {
    const out = [];
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this.chunks.get(`${cx + dx},${cz + dz}`);
        if (chunk) out.push(chunk.colliders);
      }
    }
    if (this.dynamicColliders.length) out.push(this.dynamicColliders);
    return out;
  }

  /** Blocks (x, z) when a collider overlaps. Returns the pushed-out position in place. */
  resolveCollisions(pos, radius) {
    for (const arr of this.collidersNear(pos.x, pos.z)) {
      for (let i = 0; i < arr.length; i += COLLIDER_STRIDE) {
        const dx = pos.x - arr[i];
        const dz = pos.z - arr[i + 1];
        const minDist = arr[i + 2] + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < minDist * minDist && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (minDist - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        }
      }
    }
    return pos;
  }

  /** Applies new view distance / vegetation density. Chunks are regenerated when needed. */
  setQuality(quality) {
    const densityChanged = quality.vegDensity !== this.quality.vegDensity;
    this.quality = quality;
    if (densityChanged) {
      for (const key of [...this.chunks.keys()]) this.unload(key);
      this.results = [];
    }
  }

  get loadedCount() {
    return this.chunks.size;
  }

  dispose() {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }
}

function chunkKeyAt(x, z) {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
}
