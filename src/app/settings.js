// Player settings (stored locally) and graphics quality presets.
export const QUALITY_PRESETS = {
  low: { label: 'Basse', viewRadius: 4, vegDensity: 0.5, shadowMap: 512, pixelRatio: 1 },
  medium: { label: 'Moyenne', viewRadius: 5, vegDensity: 0.8, shadowMap: 1024, pixelRatio: 1.25 },
  high: { label: 'Haute', viewRadius: 6, vegDensity: 1, shadowMap: 2048, pixelRatio: 2 }
};

export const DEFAULT_SETTINGS = {
  sensitivity: 5,
  invertY: false,
  fov: 72,
  quality: 'medium',
  volume: 0.6,
  difficulty: 'normal',
  bindings: null
};

const KEY = 'genesis.settings.v1';

export function loadSettings(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data = JSON.parse(raw);
    return {
      sensitivity: Math.min(10, Math.max(1, Number(data.sensitivity) || DEFAULT_SETTINGS.sensitivity)),
      invertY: !!data.invertY,
      fov: Math.min(100, Math.max(50, Number(data.fov) || DEFAULT_SETTINGS.fov)),
      quality: QUALITY_PRESETS[data.quality] ? data.quality : DEFAULT_SETTINGS.quality,
      volume: Math.min(1, Math.max(0, Number(data.volume ?? DEFAULT_SETTINGS.volume))),
      difficulty: ['easy', 'normal', 'hard'].includes(data.difficulty) ? data.difficulty : DEFAULT_SETTINGS.difficulty,
      bindings: data.bindings && typeof data.bindings === 'object' ? data.bindings : null
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage, settings) {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.warn('[settings] could not store settings', error);
    return false;
  }
}
