import * as THREE from 'three';
import type { CityWorld } from '../world/CityWorld';
import { carModel, motoModel, heliModel, type CarStyle, type VehicleModel } from './models';
import type { Road } from '../map/osm';

export type VehicleKind = 'carro' | 'policia' | 'moto' | 'heli';
export type Driver = null | 'jugador' | 'ia' | 'ladron' | 'policia' | 'piloto';

interface Spec { maxF: number; maxR: number; accel: number; brake: number; steerMax: number; wheelBase: number; radius: number; len: number; health: number }
const SPECS: Record<VehicleKind, Spec> = {
  carro: { maxF: 30, maxR: 7, accel: 6.5, brake: 14, steerMax: 0.6, wheelBase: 2.6, radius: 1.05, len: 4.4, health: 100 },
  policia: { maxF: 36, maxR: 8, accel: 8, brake: 15, steerMax: 0.6, wheelBase: 2.7, radius: 1.05, len: 4.5, health: 130 },
  moto: { maxF: 33, maxR: 3, accel: 9, brake: 14, steerMax: 0.55, wheelBase: 1.4, radius: 0.55, len: 2.0, health: 100 },
  heli: { maxF: 26, maxR: 8, accel: 6, brake: 8, steerMax: 0, wheelBase: 1, radius: 4.8, len: 11, health: 150 },
};

export interface Controls { throttle: number; steer: number; handbrake: boolean; up?: number }

const PAINTS = ['#b02020', '#e8e8e8', '#202428', '#2a4a8a', '#7a7a7a', '#d0b040', '#2a6a3a', '#6a2a2a', '#c8c0b0', '#1a3a5a', '#e0e0d0'];
let VID = 1;

/** Vehículo con física arcade (modelo de bicicleta). Rumbo: adelante = (sin h, cos h). */
export class Vehicle {
  readonly id = VID++;
  readonly model: VehicleModel;
  readonly spec: Spec;
  readonly pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  steer = 0;
  health: number;
  driver: Driver = null;
  driverKind: string = 'hombre';
  wrecked = false;
  burnT = 0;
  // helicóptero
  alt = 0; vy = 0; rotorSpeed = 0; strafe = 0;
  // IA de tráfico
  road: Road | null = null; ti = 0; dir: 1 | -1 = 1; lane = 0; cruise = 10; pursuit = false; wait = 0; stuck = 0;
  /** Último choque fuerte (m/s de velocidad perdida en este paso). */
  impact = 0;
  playerOwned = false;
  burning = false;

  constructor(readonly kind: VehicleKind, style?: CarStyle, paint?: string) {
    this.spec = SPECS[kind];
    this.health = this.spec.health;
    const p = paint ?? PAINTS[Math.floor(Math.random() * PAINTS.length)]!;
    this.model = kind === 'moto' ? motoModel(p) : kind === 'heli' ? heliModel(paint ?? '#2a3a5a') : carModel(kind === 'policia' ? 'policia' : style ?? 'sedan', kind === 'policia' ? '#f2f2f2' : p);
  }

  get object(): THREE.Group { return this.model.group; }
  get fwd(): THREE.Vector3 { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  place(x: number, z: number, heading: number, world: CityWorld): void {
    this.pos.set(x, world.heightAt(x, z), z); this.heading = heading; this.speed = 0;
    this.sync(0, world);
  }

  /** Puerta del conductor (lado izquierdo). */
  doorPoint(): THREE.Vector3 {
    const s = this.kind === 'moto' ? 0.9 : 1.5;
    return this.pos.clone().add(new THREE.Vector3(Math.cos(this.heading) * s, 0, -Math.sin(this.heading) * s));
  }

  step(dt: number, c: Controls, world: CityWorld): void {
    this.impact = 0;
    if (this.wrecked) { this.speed *= Math.exp(-3 * dt); }
    if (this.kind === 'heli') { this.stepHeli(dt, c, world); return; }
    const S = this.spec;
    const th = this.wrecked ? 0 : c.throttle;
    if (th > 0) this.speed += S.accel * th * dt * (this.speed < 0 ? 2 : 1);
    else if (th < 0) this.speed += (this.speed > 0.3 ? -S.brake : -S.accel * 0.7) * -th * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 1.6 * dt);
    if (c.handbrake) this.speed *= Math.exp(-2.2 * dt);
    this.speed -= this.speed * Math.abs(this.speed) * 0.0012 * dt * 10; // arrastre aerodinámico
    // Pendiente: acelera cuesta abajo
    const f = this.fwd, hl = S.len * 0.4;
    const hf = world.heightAt(this.pos.x + f.x * hl, this.pos.z + f.z * hl), hb = world.heightAt(this.pos.x - f.x * hl, this.pos.z - f.z * hl);
    const slope = (hf - hb) / (hl * 2);
    this.speed -= 9.8 * slope * dt * 0.8;
    this.speed = THREE.MathUtils.clamp(this.speed, -S.maxR, S.maxF);
    // Dirección (menos giro a alta velocidad)
    const target = c.steer * S.steerMax / (1 + Math.abs(this.speed) / 14);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    const grip = c.handbrake && Math.abs(this.speed) > 6 ? 1.8 : 1; // freno de mano: derrapa
    this.heading += (this.speed / S.wheelBase) * Math.tan(this.steer) * grip * dt;
    // Movimiento con colisiones (centro + puntos delantero y trasero)
    const want = Math.abs(this.speed) * dt;
    const before = this.pos.clone();
    world.collision.move(this.pos, f.x * this.speed * dt, f.z * this.speed * dt, S.radius);
    if (this.kind !== 'moto') for (const k of [hl, -hl]) {
      const q = { x: this.pos.x + f.x * k, z: this.pos.z + f.z * k };
      const q0 = { ...q };
      if (world.collision.resolve(q, S.radius * 0.85)) { this.pos.x += q.x - q0.x; this.pos.z += q.z - q0.z; }
    }
    const got = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    if (want > 0.02 && got < want * 0.6) {
      const lost = Math.abs(this.speed) * (1 - got / want);
      if (lost > 2) { this.impact = lost; this.damage(lost * 3.2); }
      this.speed *= got / want * 0.6 - (Math.abs(this.speed) > 8 ? 0.15 : 0);
    }
    this.sync(dt, world, slope);
  }

  private stepHeli(dt: number, c: Controls, world: CityWorld): void {
    const S = this.spec;
    const on = this.driver !== null && !this.wrecked;
    this.rotorSpeed += ((on ? 1 : 0) - this.rotorSpeed) * Math.min(1, dt * 0.8);
    const ground = world.heightAt(this.pos.x, this.pos.z);
    const lift = this.rotorSpeed > 0.85 ? (c.up ?? 0) * 7 : -4;
    this.vy += (lift - this.vy) * Math.min(1, dt * 2) - (this.rotorSpeed < 0.5 ? 9.8 * dt : 0);
    this.alt = Math.max(0, this.alt + this.vy * dt);
    const airborne = this.alt > 0.3;
    if (airborne) {
      this.speed += (c.throttle * S.maxF - this.speed) * Math.min(1, dt * 0.8);
      this.strafe += (0 - this.strafe) * dt;
      this.heading += c.steer * 1.3 * dt;
    } else { this.speed *= Math.exp(-4 * dt); if (this.vy < -8) { this.damage(-this.vy * 6); } this.vy = Math.max(this.vy, 0); }
    const f = this.fwd;
    const nx = this.pos.x + f.x * this.speed * dt, nz = this.pos.z + f.z * this.speed * dt;
    this.pos.x = nx; this.pos.z = nz;
    if (this.alt < 9) world.collision.resolve(this.pos, 3.5);
    const lim = { w: world.map.half.w + 400, h: world.map.half.h + 400 };
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim.w, lim.w); this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim.h, lim.h);
    this.alt = Math.min(this.alt, 160);
    this.pos.y = ground + this.alt;
    const g = this.model.group;
    g.position.copy(this.pos);
    g.rotation.set(this.speed / S.maxF * 0.25, this.heading, -c.steer * 0.15 * (airborne ? 1 : 0), 'YXZ');
    this.model.rotor!.rotation.y += this.rotorSpeed * 28 * dt;
    this.model.tailRotor!.rotation.x += this.rotorSpeed * 40 * dt;
  }

  private sync(dt: number, world: CityWorld, slope = 0): void {
    this.pos.y = world.heightAt(this.pos.x, this.pos.z);
    const g = this.model.group;
    g.position.copy(this.pos);
    const roll = this.kind === 'moto' ? THREE.MathUtils.clamp(-this.steer * this.speed * 0.09, -0.6, 0.6) : -this.steer * this.speed * 0.006;
    g.rotation.set(-Math.atan(slope), this.heading, roll, 'YXZ');
    const r = this.kind === 'moto' ? 0.31 : 0.33;
    this.model.front.rotation.x += (this.speed / r) * dt;
    this.model.rear.rotation.x += (this.speed / r) * dt;
    if (this.kind === 'moto') this.model.front.rotation.y = this.steer;
  }

  damage(n: number): void {
    if (this.wrecked) return;
    this.health -= n;
    if (this.health <= 0) this.health = 0;
  }
}
