/** Constantes globales del demo. Todas las unidades en metros, segundos y grados salvo que se indique. */
export const CONFIG = {
  loop: {
    fixedDt: 1 / 60,
    maxStepsPerFrame: 5,
  },
  map: {
    // Bounding box de El Trigal Sur (sur, oeste, norte, este)
    bbox: { south: 10.2095, west: -68.002, north: 10.2155, east: -67.99 },
    // Origen de proyección: centro del bbox
    origin: { lat: (10.2095 + 10.2155) / 2, lon: (-68.002 + -67.99) / 2 },
    spawn: { lat: 10.213, lon: -67.9947 }, // Plaza José Martí (se ajusta en fase 2)
  },
  player: {
    radius: 0.35,
    height: 1.75,
    speeds: { walk: 1.6, jog: 3.5, run: 6 },
    accel: 10,
    jumpHeight: 0.8,
    gravity: 18,
    stepUp: 0.25,
  },
  stamina: { max: 100, drain: 12, regen: 18, regenDelay: 1, minToRun: 25 },
  /** Salud y escudo. Daño solo por caídas altas y choques al conducir (sin violencia). */
  vitals: {
    healthMax: 100,
    shieldMax: 100,
    healthRegen: 2,          // por segundo, tras `regenDelay`
    regenDelay: 5,
    regenCap: 60,            // la regeneración natural no supera este valor
    fallSafeHeight: 3,       // caídas menores no hacen daño
    fallDamagePerMeter: 12,
    crashDamagePerMs: 2.5,   // daño por cada m/s de cambio brusco de velocidad del vehículo
    crashThreshold: 6,       // m/s mínimos de impacto
  },
  vehicle: {
    enterRadius: 2.5,        // tecla F
    maxForward: 16,          // m/s (~58 km/h, calle urbana)
    maxReverse: 5,
    accel: 5,
    brake: 10,
    drag: 0.6,
    steerMax: 0.6,           // rad
    wheelBase: 2.6,
  },
  camera: {
    pitchMin: -10,
    pitchMax: 60,
    distances: [2.5, 4.5, 8] as const,
    targetHeight: 1.5,
    fov: 60,
    fovRunBoost: 8,
    recenterDelay: 3,
  },
  day: {
    realSecondsPerDay: 24 * 60,
    startHour: 17.5,
  },
  storageKey: 'trigal-sur:v1',
} as const;

export type Config = typeof CONFIG;
