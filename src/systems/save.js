// Save system. Writes are atomic: the new save is written to a temporary key, read back and
// verified, the previous save is kept as a backup, and only then is the main key replaced.
// A failed write therefore never corrupts the last good save.
export const SAVE_VERSION = 1;
const KEY_MAIN = 'genesis.save.main';
const KEY_TMP = 'genesis.save.tmp';
const KEY_BACKUP = 'genesis.save.backup';

/** FNV-1a checksum of a string, hex encoded. Detects truncated or edited saves. */
export function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const isNum = (v, min = -Infinity, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Validates a parsed save and returns a normalised copy, or throws. */
export function validateSave(data) {
  if (!data || typeof data !== 'object') throw new Error('save: not an object');
  if (data.version !== SAVE_VERSION) throw new Error(`save: unsupported version ${data.version}`);
  const { player, robot, inventory, missions, codex, collected, rover, clock, seed, difficulty, checksum: sum, ...rest } = data;
  if (!isNum(seed, 0, 0xffffffff)) throw new Error('save: bad seed');
  if (!player || !isNum(player.x, -1e7, 1e7) || !isNum(player.z, -1e7, 1e7) || !isNum(player.yaw)) throw new Error('save: bad player');
  if (!robot || !isNum(robot.energy, 0, 100) || !isNum(robot.integrity, 0, 100)) throw new Error('save: bad robot');
  if (!inventory || typeof inventory.counts !== 'object') throw new Error('save: bad inventory');
  if (!isNum(clock?.timeOfDay, 0, 1)) throw new Error('save: bad clock');
  if (!Array.isArray(collected) || collected.some((c) => typeof c !== 'string' || c.length > 64)) throw new Error('save: bad collected');
  if (collected.length > 20000) throw new Error('save: too many collected nodes');
  const missionState = missions ?? { index: 0, progress: {}, completed: [] };
  const codexState = codex ?? { species: [], points: [] };
  const vehicleList = Array.isArray(data.vehicles) ? data.vehicles : rover ? [{ type: 'rover', ...rover }] : [];
  if (vehicleList.length > 40) throw new Error('save: too many vehicles');
  for (const v of vehicleList) {
    if (typeof v.type !== 'string' || !isNum(v.x) || !isNum(v.z) || !isNum(v.energy, 0, 1000) || !isNum(v.hull, 0, 1000)) throw new Error('save: bad vehicle');
  }
  const checkpoint = data.checkpoint && isNum(data.checkpoint.x) && isNum(data.checkpoint.z)
    ? { x: data.checkpoint.x, z: data.checkpoint.z }
    : { x: player.x, z: player.z };
  return {
    version: SAVE_VERSION,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : '',
    seed: seed >>> 0,
    checkpoint,
    difficulty: ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal',
    player: { x: player.x, z: player.z, yaw: player.yaw },
    robot: { energy: robot.energy, integrity: robot.integrity, temperature: isNum(robot.temperature, -100, 150) ? robot.temperature : 20, tool: isNum(robot.tool, 0, 100) ? robot.tool : 100 },
    inventory: { counts: inventory.counts, modules: inventory.modules ?? {} },
    missions: missionState,
    codex: { species: codexState.species ?? [], points: codexState.points ?? [] },
    collected,
    vehicles: vehicleList,
    clock: { timeOfDay: clock.timeOfDay },
    extra: rest
  };
}

/** Storage adapter with an in-memory fallback when localStorage is blocked. */
export function createStorage() {
  try {
    const probe = '__genesis_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map();
    return {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, String(v)),
      removeItem: (k) => memory.delete(k),
      memory: true
    };
  }
}

export class SaveManager {
  constructor(storage) {
    this.storage = storage;
  }

  get hasSave() {
    return this.storage.getItem(KEY_MAIN) !== null || this.storage.getItem(KEY_BACKUP) !== null;
  }

  /** Writes a save atomically. Throws (leaving the previous save intact) on failure. */
  write(state) {
    const body = { ...state, version: SAVE_VERSION, savedAt: new Date().toISOString() };
    const text = JSON.stringify(body);
    const wrapped = JSON.stringify({ body: text, checksum: checksum(text) });

    this.storage.setItem(KEY_TMP, wrapped);
    const readBack = this.storage.getItem(KEY_TMP);
    if (readBack !== wrapped) throw new Error('save: verification failed');
    const check = JSON.parse(readBack);
    if (checksum(check.body) !== check.checksum) throw new Error('save: checksum mismatch');

    const previous = this.storage.getItem(KEY_MAIN);
    if (previous !== null) this.storage.setItem(KEY_BACKUP, previous);
    this.storage.setItem(KEY_MAIN, wrapped);
    this.storage.removeItem(KEY_TMP);
    return body.savedAt;
  }

  /** Reads the main save, falling back to the backup. Returns { data, source } or null. */
  read() {
    for (const [key, source] of [[KEY_MAIN, 'main'], [KEY_BACKUP, 'backup']]) {
      const raw = this.storage.getItem(key);
      if (raw === null) continue;
      try {
        const wrapper = JSON.parse(raw);
        if (checksum(wrapper.body) !== wrapper.checksum) throw new Error('checksum');
        return { data: validateSave(JSON.parse(wrapper.body)), source };
      } catch (error) {
        console.warn(`[save] ${source} save unreadable:`, error.message);
      }
    }
    return null;
  }

  clear() {
    for (const key of [KEY_MAIN, KEY_TMP, KEY_BACKUP]) this.storage.removeItem(key);
  }
}
