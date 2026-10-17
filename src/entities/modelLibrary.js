// Loads the glTF models shipped in public/assets/models once and hands out clones.
// Loading is asynchronous: callers get null until the file is ready and can subscribe with whenReady().
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const FILES = {
  soldier: 'Soldier.glb',
  explorer: 'HVGirl.glb',
  michelle: 'Michelle.glb',
  horse: 'Horse.glb',
  flamingo: 'Flamingo.glb',
  parrot: 'Parrot.glb',
  stork: 'Stork.glb',
  fish: 'fish.glb'
};

const cache = new Map();
const waiting = new Map();
let loader = null;

function base() {
  return `${import.meta.env?.BASE_URL ?? '/'}assets/models/`;
}

/** Starts loading a model (idempotent). Resolves to the glTF or null on failure. */
export function loadModel(name) {
  if (cache.has(name)) return Promise.resolve(cache.get(name));
  if (waiting.has(name)) return waiting.get(name);
  if (typeof document === 'undefined' || !FILES[name]) return Promise.resolve(null);
  loader ??= new GLTFLoader();
  const promise = loader.loadAsync(base() + FILES[name])
    .then((gltf) => { cache.set(name, gltf); return gltf; })
    .catch((error) => { console.warn(`[models] ${name} unavailable`, error?.message ?? error); cache.set(name, null); return null; });
  waiting.set(name, promise);
  return promise;
}

/** Preloads every model in the background (called at boot). */
export function preloadModels() {
  return Promise.all(Object.keys(FILES).map(loadModel));
}

/** The loaded glTF, or null while it is still loading. */
export function getModel(name) {
  return cache.get(name) ?? null;
}

/** Clone of a model's scene (skinned meshes get their own skeleton). */
export function cloneModel(name) {
  const gltf = getModel(name);
  return gltf ? SkeletonUtils.clone(gltf.scene) : null;
}
