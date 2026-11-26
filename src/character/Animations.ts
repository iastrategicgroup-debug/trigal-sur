import * as THREE from 'three';
import type { BoneName } from './HumanModel';

/**
 * Clips creados por código (QuaternionKeyframeTrack). Cíclicos con duración 1 (se escalan con timeScale
 * según la velocidad real para que los pies no patinen). Convenciones (personaje mirando a +Z):
 *  - muslo/brazo rot.x < 0 => hacia delante; espinilla rot.x > 0 => rodilla dobla hacia atrás (nunca negativa)
 *  - columna rot.x > 0 => inclina el torso hacia delante
 */
type Pose = Partial<Record<BoneName, [number, number, number]>> & { _y?: number; _z?: number };

const q = new THREE.Quaternion(), e = new THREE.Euler();

function clip(name: string, duration: number, samples: number, pose: (t: number) => Pose, loop = true): THREE.AnimationClip {
  const times: number[] = [];
  const n = loop ? samples : samples + 1;
  for (let i = 0; i < n + (loop ? 1 : 0); i++) times.push((i / samples) * duration);
  const poses = times.map((t) => pose(t / duration));
  const bones = new Set<BoneName>();
  poses.forEach((p) => Object.keys(p).forEach((k) => k[0] !== '_' && bones.add(k as BoneName)));
  const tracks: THREE.KeyframeTrack[] = [];
  for (const b of bones) {
    const vals: number[] = [];
    for (const p of poses) {
      const r = p[b] ?? [0, 0, 0];
      q.setFromEuler(e.set(r[0], r[1], r[2]));
      vals.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, vals));
  }
  if (poses.some((p) => p._y !== undefined || p._z !== undefined)) {
    const vals: number[] = [];
    for (const p of poses) vals.push(0, p._y ?? 0, p._z ?? 0);
    tracks.push(new THREE.VectorKeyframeTrack('root.position', times, vals));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

const S = Math.sin, PI2 = Math.PI * 2;

/** Ciclo de locomoción parametrizado (caminar, trotar, correr). */
function gait(amp: number, knee: number, arm: number, lean: number, bob: number, elbow: number, hunch = 0) {
  return (t: number): Pose => {
    const ph = t * PI2;
    const L = S(ph), R = S(ph + Math.PI);
    // rodilla: se dobla al levantar el pie (fase de vuelo), nunca hacia delante
    const kL = Math.max(0, S(ph - 0.9)) * knee + 0.08, kR = Math.max(0, S(ph + Math.PI - 0.9)) * knee + 0.08;
    return {
      thigh_L: [-L * amp, 0, 0], thigh_R: [-R * amp, 0, 0],
      shin_L: [kL, 0, 0], shin_R: [kR, 0, 0],
      foot_L: [L * amp * 0.3 - kL * 0.3, 0, 0], foot_R: [R * amp * 0.3 - kR * 0.3, 0, 0],
      upperArm_L: [R * arm, 0, 0.08], upperArm_R: [L * arm, 0, -0.08],
      foreArm_L: [-elbow - Math.max(0, R) * arm * 0.6, 0, 0], foreArm_R: [-elbow - Math.max(0, L) * arm * 0.6, 0, 0],
      spine: [lean + hunch * 0.35, S(ph) * 0.06, 0], chest: [hunch * 0.2, -S(ph) * 0.1, 0],
      hips: [0, -S(ph) * 0.08, 0],
      neck: [-lean * 0.5 - hunch * 0.3, 0, 0],
      _y: -Math.abs(Math.cos(ph)) * bob + bob * 0.5,
    };
  };
}

export function buildClips(): Record<string, THREE.AnimationClip> {
  const c: Record<string, THREE.AnimationClip> = {};
  c.idle = clip('idle', 4, 16, (t) => {
    const b = S(t * PI2);
    return {
      chest: [b * 0.025, 0, 0], spine: [0.02, 0, 0], neck: [-0.02, S(t * PI2 * 0.5) * 0.08, 0],
      upperArm_L: [0.02, 0, 0.1 + b * 0.01], upperArm_R: [0.02, 0, -0.1 - b * 0.01],
      foreArm_L: [-0.12, 0, 0], foreArm_R: [-0.12, 0, 0], shin_L: [0.04, 0, 0], shin_R: [0.04, 0, 0],
      _y: b * 0.004,
    };
  });
  c.idleOld = clip('idleOld', 4, 12, (t) => {
    const b = S(t * PI2);
    return { spine: [0.35, 0, 0], chest: [0.2, 0, 0], neck: [-0.35, 0, 0], upperArm_L: [-0.1, 0, 0.1], upperArm_R: [-0.1, 0, -0.1], foreArm_L: [-0.4, 0, 0], foreArm_R: [-0.4, 0, 0], shin_L: [0.15, 0, 0], shin_R: [0.15, 0, 0], thigh_L: [-0.1, 0, 0], thigh_R: [-0.1, 0, 0], _y: -0.03 + b * 0.003 };
  });
  // Espera (tras 8 s sin moverse): mira alrededor y revisa el reloj (muñeca izquierda)
  c.lookAround = clip('lookAround', 5, 20, (t) => {
    const look = t < 0.5 ? S(t * 2 * PI2) * 0.6 : 0;
    const watch = t >= 0.55 && t < 0.95 ? S(((t - 0.55) / 0.4) * Math.PI) : 0;
    return {
      neck: [watch * 0.45, look, 0], chest: [0, look * 0.2, 0],
      upperArm_L: [-watch * 0.9, 0, 0.1 + watch * 0.2], foreArm_L: [-watch * 1.6 - 0.12, -watch * 0.8, 0],
      upperArm_R: [0, 0, -0.1], foreArm_R: [-0.12, 0, 0],
    };
  });
  c.walk = clip('walk', 1, 16, gait(0.42, 0.75, 0.35, 0.03, 0.025, 0.15));
  c.walkOld = clip('walkOld', 1, 16, gait(0.26, 0.5, 0.15, 0.05, 0.015, 0.4, 1));
  c.jog = clip('jog', 1, 16, gait(0.6, 1.3, 0.55, 0.12, 0.05, 1.0));
  c.run = clip('run', 1, 16, gait(0.85, 1.8, 0.85, 0.25, 0.07, 1.3));
  c.jump = clip('jump', 0.6, 8, (t) => ({
    thigh_L: [-0.9, 0, 0], shin_L: [1.3, 0, 0], thigh_R: [-0.2, 0, 0], shin_R: [0.6, 0, 0],
    upperArm_L: [-0.6 - t * 0.6, 0, 0.5], upperArm_R: [-0.6 - t * 0.6, 0, -0.5], foreArm_L: [-0.6, 0, 0], foreArm_R: [-0.6, 0, 0], spine: [0.1, 0, 0],
  }), false);
  c.fall = clip('fall', 1, 8, (t) => ({
    thigh_L: [-0.4, 0, 0.1], shin_L: [0.7, 0, 0], thigh_R: [-0.1, 0, -0.1], shin_R: [0.4, 0, 0],
    upperArm_L: [-0.3, 0, 1.0 + S(t * PI2 * 2) * 0.2], upperArm_R: [-0.3, 0, -1.0 - S(t * PI2 * 2) * 0.2], foreArm_L: [-0.4, 0, 0], foreArm_R: [-0.4, 0, 0],
  }));
  c.land = clip('land', 0.3, 6, (t) => {
    const k = S(t * Math.PI);
    return { thigh_L: [-0.6 * k, 0, 0], thigh_R: [-0.6 * k, 0, 0], shin_L: [1.1 * k, 0, 0], shin_R: [1.1 * k, 0, 0], foot_L: [-0.5 * k, 0, 0], foot_R: [-0.5 * k, 0, 0], spine: [0.3 * k, 0, 0], _y: -0.18 * k };
  }, false);
  // Guardia de pelea
  // Euler XYZ: primero Z (abrir el brazo), luego Y (barrido horizontal), luego X (adelante).
  const guard: Pose = {
    // valores resueltos numéricamente (puños frente a la barbilla, codos protegiendo las costillas)
    upperArm_L: [-0.8, -0.4, -0.3], foreArm_L: [-1.7, 0, 0], upperArm_R: [-0.8, 0.4, 0.3], foreArm_R: [-1.7, 0, 0],
    thigh_L: [-0.25, 0, 0.05], shin_L: [0.4, 0, 0], thigh_R: [0.2, 0, -0.05], shin_R: [0.35, 0, 0], spine: [0.15, 0.2, 0], neck: [-0.1, -0.2, 0], _y: -0.04,
  };
  c.guard = clip('guard', 1, 8, (t) => ({ ...guard, chest: [0, S(t * PI2) * 0.06, 0], _y: -0.04 + S(t * PI2 * 2) * 0.01 }));
  // Golpes con mecánica real: amague (0–0,15), impacto (0,15–0,32), sostén breve y regreso a la guardia.
  // Paso con el pie contrario, giro de cadera y hombro, puño a la línea central y la otra mano cubriendo la barbilla.
  const ease = (t: number) => t * t * (3 - 2 * t);
  const strike = (t: number) => t < 0.15 ? -0.15 * ease(t / 0.15) : t < 0.32 ? -0.15 + 1.15 * ease((t - 0.15) / 0.17) : t < 0.45 ? 1 : 1 - ease((t - 0.45) / 0.55);
  const straight = (side: 'R' | 'L') => (t: number): Pose => {
    const k = strike(t), kp = Math.max(0, k);
    const a = side, o = side === 'R' ? 'L' : 'R', sg = side === 'R' ? 1 : -1;
    const lead = side === 'R' ? 'L' : 'R';  // pie que avanza
    return {
      ...guard,
      [`upperArm_${a}`]: [-0.8 - 0.3 * kp, sg * (0.4 - 1.3 * kp), sg * (0.3 + 0.4 * kp)], // guardia -> puño al centro, altura de barbilla
      [`foreArm_${a}`]: [-1.7 + kp * 1.6, 0, 0],
      [`hand_${a}`]: [0, 0, -sg * 0.3 * kp],
      [`upperArm_${o}`]: [-0.8, -sg * 0.4, -sg * 0.3], [`foreArm_${o}`]: [-1.7, 0, 0],
      [`thigh_${lead}`]: [-0.3 - 0.2 * kp, 0, 0], [`shin_${lead}`]: [0.35 + 0.1 * kp, 0, 0],
      [`thigh_${a}`]: [0.25 + 0.1 * kp, 0, 0], [`shin_${a}`]: [0.35 + 0.25 * kp, 0, 0], [`foot_${a}`]: [0.35 * kp, 0, 0],
      hips: [0, sg * 0.15 * kp, 0], spine: [0.12 + 0.1 * kp, sg * 0.06 * kp, 0], chest: [0.05, sg * 0.15 * kp, 0], neck: [-0.15, -sg * 0.32 * kp, 0],
      _y: -0.05 - 0.03 * kp, _z: 0.12 * kp,
    } as Pose;
  };
  c.punchR = clip('punchR', 0.42, 14, straight('R'), false);
  c.punchL = clip('punchL', 0.38, 14, straight('L'), false);
  // Gancho de derecha: codo a 90°, brazo horizontal que barre de lado a centro con giro fuerte del torso
  c.hookR = clip('hookR', 0.5, 14, (t) => {
    const k = strike(t), kp = Math.max(0, k);
    return {
      ...guard,
      // brazo abierto a la altura del hombro (Z) que barre de atrás hacia delante (Y), antebrazo a 90° en horizontal
      upperArm_R: [0, -0.25 + 1.25 * kp, -1.35], foreArm_R: [-1.55, 0, 0],
      upperArm_L: [-0.8, -0.4, -0.3], foreArm_L: [-1.7, 0, 0],
      thigh_L: [-0.35, 0, 0.05], shin_L: [0.4, 0, 0], thigh_R: [0.25, 0, -0.05], shin_R: [0.5, 0.2 * kp, 0], foot_R: [0.3 * kp, 0.3 * kp, 0],
      hips: [0, 0.55 * kp - 0.15, 0], chest: [0.05, 0.6 * kp - 0.25, 0], spine: [0.18, 0.2 * kp, 0], neck: [-0.15, -0.7 * kp + 0.2, 0],
      _y: -0.07, _z: 0.08 * kp,
    };
  }, false);
  c.hit = clip('hit', 0.35, 6, (t) => {
    const k = S(t * Math.PI);
    return { spine: [-0.35 * k, 0, 0], chest: [-0.2 * k, 0.2 * k, 0], neck: [-0.4 * k, 0, 0], upperArm_L: [-0.3 * k, 0, 0.5 * k], upperArm_R: [-0.3 * k, 0, -0.5 * k], shin_L: [0.3 * k, 0, 0], shin_R: [0.3 * k, 0, 0] };
  }, false);
  // Caer muerto: se desploma de espaldas y queda tendido (sin sangre)
  c.death = clip('death', 1.2, 12, (t) => {
    const k = Math.min(1, t * 1.25);
    const ease = k * k * (3 - 2 * k);
    return {
      hips: [-1.45 * ease, 0, 0], spine: [0.15 * (1 - ease), 0, 0], neck: [0.2 * ease, 0.4 * ease, 0],
      thigh_L: [-1.3 * ease + 0.1, 0, 0.15 * ease], thigh_R: [-1.0 * ease, 0, -0.2 * ease], shin_L: [0.4 * (1 - ease) + 0.15, 0, 0], shin_R: [0.6 * ease, 0, 0],
      upperArm_L: [-0.3 * ease, 0, 1.2 * ease], upperArm_R: [-0.5 * ease, 0, -0.9 * ease], foreArm_L: [-0.4 * ease, 0, 0], foreArm_R: [-0.8 * ease, 0, 0],
      _y: -0.82 * ease + Math.sin(k * Math.PI) * 0.03,
    };
  }, false);
  c.wave = clip('wave', 1.6, 16, (t) => {
    const up = Math.min(1, t * 5, (1 - t) * 5);
    return { upperArm_R: [-0.3 * up, 0, -2.4 * up], foreArm_R: [0, 0, -0.6 * up + S(t * PI2 * 3) * 0.45 * up], neck: [0, -0.15 * up, 0], upperArm_L: [0, 0, 0.1] };
  }, false);
  c.sit = clip('sit', 1, 4, () => ({
    thigh_L: [-1.55, 0, 0.08], thigh_R: [-1.55, 0, -0.08], shin_L: [1.55, 0, 0], shin_R: [1.55, 0, 0], foot_L: [0, 0, 0], foot_R: [0, 0, 0],
    spine: [-0.08, 0, 0], upperArm_L: [-0.5, 0, 0.12], upperArm_R: [-0.5, 0, -0.12], foreArm_L: [-0.6, 0, 0], foreArm_R: [-0.6, 0, 0], _y: -0.46,
  }));
  c.flee = clip('flee', 1, 16, gait(0.85, 1.8, 1.0, 0.3, 0.07, 1.4));
  return c;
}

/** Distancia recorrida por ciclo completo (dos pasos) de cada marcha, en metros, para una persona de 1,75 m. */
export const CYCLE_LENGTH: Record<string, number> = { walk: 1.45, walkOld: 0.95, jog: 2.2, run: 3.1, flee: 3.1 };
