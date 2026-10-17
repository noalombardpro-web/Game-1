// Web Worker entry: generates chunk data off the main thread.
import { createTerrain } from './terrain.js';
import { generateChunk } from './chunkGenerator.js';
import { loadContent } from './content.js';

const content = loadContent();
let terrain = null;

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type !== 'chunk') return;
  try {
    if (!terrain || terrain.seed !== msg.seed) {
      terrain = createTerrain(msg.seed, content.biomeRules);
    }
    const payload = generateChunk(terrain, content, msg);
    const transfers = [
      payload.heights.buffer, payload.normals.buffer, payload.colors.buffer,
      payload.biomeIds.buffer, payload.colliders.buffer,
      ...Object.values(payload.veg).map((arr) => arr.buffer)
    ];
    self.postMessage({ type: 'chunk', requestId: msg.requestId, payload }, transfers);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: msg.requestId, message: String(error?.message ?? error) });
  }
};
