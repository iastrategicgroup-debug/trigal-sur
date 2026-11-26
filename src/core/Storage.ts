import { CONFIG } from '../config';

export interface Settings {
  sensitivity: number;   // multiplicador del ratón
  invertY: boolean;
  volume: number;        // 0..1
  retro480: boolean;     // render a 480p
  showFps: boolean;
}

export interface SaveData {
  settings: Settings;
  position: { x: number; z: number; yaw: number } | null;
  discovered: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  volume: 0.7,
  retro480: false,
  showFps: false,
};

function defaults(): SaveData {
  return { settings: { ...DEFAULT_SETTINGS }, position: null, discovered: [] };
}

/** localStorage con try/catch: el juego funciona aunque el almacenamiento esté bloqueado. */
export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      position: parsed.position ?? null,
      discovered: Array.isArray(parsed.discovered) ? parsed.discovered : [],
    };
  } catch {
    return defaults();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
  } catch {
    /* almacenamiento no disponible: se ignora */
  }
}
