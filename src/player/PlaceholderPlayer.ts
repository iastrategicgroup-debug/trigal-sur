import * as THREE from 'three';
import { CONFIG } from '../config';

/** Física y orientación del jugador (el nombre es histórico: ya no es una cápsula). */

/** Jugador provisional (cápsula). Guarda estado anterior y actual para interpolar el render. */
export class PlaceholderPlayer {
  readonly object = new THREE.Group();
  pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing = 0;
  prevFacing = 0;

  /** El modelo (Avatar) se agrega a `object` desde Game. */
  constructor() {}

  /** Paso fijo: movimiento relativo a la cámara (versión mínima; la máquina de estados llega en fase 3). */
  step(dt: number, axes: { x: number; y: number }, camYaw: number, speed: number): void {
    this.prevPos.copy(this.pos);
    this.prevFacing = this.facing;
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * axes.y + rx * axes.x;
    let dz = fz * axes.y + rz * axes.x;
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }
    const k = 1 - Math.exp(-CONFIG.player.accel * dt);
    this.vel.x += (dx * speed - this.vel.x) * k;
    this.vel.z += (dz * speed - this.vel.z) * k;
    this.pos.addScaledVector(this.vel, dt);
    if (len > 0) {
      const target = Math.atan2(dx, dz);
      let diff = target - this.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // ángulo más corto
      this.facing += diff * (1 - Math.exp(-12 * dt));
    }
  }

  render(alpha: number): void {
    this.object.position.lerpVectors(this.prevPos, this.pos, alpha);
    let d = this.facing - this.prevFacing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.object.rotation.y = this.prevFacing + d * alpha;
  }
}
