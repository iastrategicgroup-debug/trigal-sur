import * as THREE from 'three';
import { CONFIG } from '../config';

const DEG = Math.PI / 180;

/** Cámara orbital en tercera persona. Raycast contra paredes y recentrado llegan en la fase 3. */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = 15 * DEG;
  distIndex = 1;
  private dist: number = CONFIG.camera.distances[1];
  private introT = -1;
  private readonly introDur = 2.6;
  private readonly target = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  startIntro(): void { this.introT = 0; }
  get inIntro(): boolean { return this.introT >= 0 && this.introT < 1; }

  look(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    if (this.inIntro) return;
    this.yaw -= dx * 0.0025 * sensitivity;
    this.pitch += dy * 0.0025 * sensitivity * (invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, CONFIG.camera.pitchMin * DEG, CONFIG.camera.pitchMax * DEG);
  }

  cycleDistance(dir = 1): void {
    const n = CONFIG.camera.distances.length;
    this.distIndex = (this.distIndex + dir + n) % n;
  }
  zoom(steps: number): void {
    this.distIndex = THREE.MathUtils.clamp(this.distIndex + steps, 0, CONFIG.camera.distances.length - 1);
  }

  update(frameDt: number, playerPos: THREE.Vector3, running: boolean): void {
    const goal = CONFIG.camera.distances[this.distIndex]!;
    this.dist += (goal - this.dist) * (1 - Math.exp(-8 * frameDt));
    this.target.copy(playerPos).y += CONFIG.camera.targetHeight;
    const cp = Math.cos(this.pitch);
    const desired = new THREE.Vector3(
      Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp,
    ).multiplyScalar(this.dist).add(this.target);

    if (this.inIntro) {
      this.introT = Math.min(1, this.introT + frameDt / this.introDur);
      const e = 1 - Math.pow(1 - this.introT, 3); // ease-out cúbico
      const sky = this.target.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 30, 160, Math.cos(this.yaw) * 30));
      this.camera.position.lerpVectors(sky, desired, e);
    } else {
      this.camera.position.copy(desired);
    }
    this.camera.lookAt(this.target);

    const fovGoal = CONFIG.camera.fov + (running ? CONFIG.camera.fovRunBoost : 0);
    if (Math.abs(this.camera.fov - fovGoal) > 0.01) {
      this.camera.fov += (fovGoal - this.camera.fov) * (1 - Math.exp(-5 * frameDt));
      this.camera.updateProjectionMatrix();
    }
  }
}
