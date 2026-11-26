import * as THREE from 'three';
import type { CityWorld } from '../world/CityWorld';
import { Vehicle } from './Vehicle';
import type { Traffic } from './Traffic';
import { Avatar } from '../character/Avatar';
import { npcParams } from '../character/archetypes';

interface Rival { v: Vehicle; rider: Avatar; idx: number; base: number; done: number; lat: number }

/**
 * Carrera de motos cuesta abajo por el camino del cerro. Premio: $100 al primer lugar.
 * Puntos de control = índices del camino; los rivales siguen la ruta con algo de "goma" (se adaptan al jugador).
 */
export class Race {
  state: 'libre' | 'cuenta' | 'corriendo' | 'fin' = 'libre';
  readonly marker: THREE.Vector3;
  private rivals: Rival[] = [];
  private t = 0;
  private idx = 0;
  private finished: string[] = [];
  private offT = 0;
  playerMoto: Vehicle | null = null;
  private ring: THREE.Mesh;
  private flags: THREE.Group;

  constructor(private world: CityWorld, private traffic: Traffic, scene: THREE.Scene) {
    const H = world.hill;
    this.marker = new THREE.Vector3(H.gx, 0, H.gz - 7);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x40c0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ring.position.copy(this.marker).setY(world.heightAt(this.marker.x, this.marker.z) + 0.05);
    scene.add(this.ring);
    // Arcos de salida y meta (banderas a cuadros)
    this.flags = new THREE.Group();
    const P = world.racePath;
    for (const k of [3, P.length - 8]) this.flags.add(this.arch(P[k]!, P[k + 1]!));
    scene.add(this.flags);
  }

  private arch(p: THREE.Vector3, n: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    const c = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d')!;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 4, j * 4, 4, 4); }
    const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.9), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    banner.position.y = 4.2;
    const post = new THREE.CylinderGeometry(0.1, 0.1, 4.6, 6).translate(0, 2.3, 0);
    const pm = new THREE.MeshLambertMaterial({ color: 0xd0d0d0 });
    const a = new THREE.Mesh(post, pm), b = new THREE.Mesh(post, pm);
    a.position.x = -4.5; b.position.x = 4.5;
    g.add(banner, a, b);
    g.position.copy(p);
    g.rotation.y = Math.atan2(n.x - p.x, n.z - p.z);
    return g;
  }

  near(p: THREE.Vector3): boolean { return this.state === 'libre' && Math.hypot(p.x - this.marker.x, p.z - this.marker.z) < 2.2; }

  /** Arranca la carrera: crea la moto de Joan y tres rivales en la cima. */
  start(): Vehicle {
    const P = this.world.racePath;
    const s = P[4]!, n = P[6]!;
    const h = Math.atan2(n.x - s.x, n.z - s.z);
    const side = (k: number) => ({ x: s.x + Math.cos(h) * k, z: s.z - Math.sin(h) * k });
    const mk = (k: number, back: number, paint: string) => {
      const v = new Vehicle('moto', undefined, paint);
      const q = side(k);
      v.place(q.x - Math.sin(h) * back, q.z - Math.cos(h) * back, h, this.world);
      this.traffic.add(v);
      return v;
    };
    this.playerMoto = mk(0, 0, '#d02020');
    this.playerMoto.driver = 'jugador'; this.playerMoto.playerOwned = true;
    const paints = ['#2050c0', '#f0c020', '#20a050'];
    this.rivals = [-2.4, 2.4, 0].map((k, i) => {
      const v = mk(k, i === 2 ? 3.5 : 1.5, paints[i]!);
      v.driver = 'piloto';
      const rider = new Avatar(npcParams('deportista', 100 + i));
      rider.play('ride', 0);
      rider.object.position.set(0, 0.32, -0.2);
      v.object.add(rider.object);
      return { v, rider, idx: 4, base: 15 + i * 0.8, done: 0, lat: [-2.2, 2.2, 0.9][i]! };
    });
    this.state = 'cuenta'; this.t = 3.5; this.idx = 4; this.finished = []; this.offT = 0;
    return this.playerMoto;
  }

  /** Devuelve mensajes para el HUD. `canMove` = false durante la cuenta regresiva. */
  update(dt: number, playerVehicle: Vehicle | null): { banner?: string; result?: { place: number; won: boolean }; canMove: boolean } {
    if (this.state === 'libre') { this.ring.visible = true; (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(performance.now() / 250) * 0.2; return { canMove: true }; }
    this.ring.visible = false;
    const P = this.world.racePath;
    if (this.state === 'cuenta') {
      this.t -= dt;
      for (const r of this.rivals) r.v.step(dt, { throttle: 0, steer: 0, handbrake: true }, this.world);
      r_update(this.rivals, dt);
      if (this.t <= 0) { this.state = 'corriendo'; return { banner: '¡YA!', canMove: true }; }
      return { banner: this.t > 0.5 ? String(Math.ceil(this.t - 0.5)) : '¡YA!', canMove: false };
    }
    if (this.state === 'fin') {
      this.t -= dt;
      for (const r of this.rivals) r.v.step(dt, { throttle: 0, steer: 0, handbrake: true }, this.world);
      if (this.t <= 0) this.cleanup();
      return { canMove: true };
    }
    // Progreso del jugador: índice más avanzado del camino dentro de 14 m
    const pv = playerVehicle ?? this.playerMoto!;
    for (let k = this.idx; k < Math.min(P.length, this.idx + 25); k++) if (P[k]!.distanceTo(pv.pos) < 14) this.idx = k;
    const offRoute = P.slice(Math.max(0, this.idx - 5), this.idx + 25).every((q) => q.distanceTo(pv.pos) > 22);
    this.offT = offRoute ? this.offT + dt : 0;
    if (this.offT > 5 || playerVehicle !== this.playerMoto) { this.state = 'fin'; this.t = 4; return { banner: 'Descalificado', result: { place: 0, won: false }, canMove: true }; }
    // Rivales
    for (const r of this.rivals) {
      if (r.done) { r.v.step(dt, { throttle: 0, steer: 0, handbrake: true }, this.world); continue; }
      for (let k = r.idx; k < Math.min(P.length, r.idx + 10); k++) if (P[k]!.distanceTo(r.v.pos) < 7) r.idx = k;
      const look = P[Math.min(P.length - 1, r.idx + 3)]!, nx = P[Math.min(P.length - 1, r.idx + 4)]!;
      // carril propio dentro del camino (no se encima con los demás)
      let tx = nx.x - look.x, tz = nx.z - look.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let lat = r.lat;
      const pv2 = playerVehicle ?? this.playerMoto!;
      if (pv2.pos.distanceTo(r.v.pos) < 4) lat += (r.lat >= 0 ? 1 : -1) * 1.2;
      const want = Math.atan2(look.x - tz * lat - r.v.pos.x, look.z + tx * lat - r.v.pos.z);
      let diff = want - r.v.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const gap = this.idx - r.idx;                       // >0: el jugador va adelante
      const target = r.base * (1 + THREE.MathUtils.clamp(gap * 0.006, -0.15, 0.2)) * (1 - Math.min(0.5, Math.abs(diff)));
      r.v.step(dt, { throttle: THREE.MathUtils.clamp((target - r.v.speed) * 0.4, -1, 1), steer: THREE.MathUtils.clamp(diff * 2.5, -1, 1), handbrake: false }, this.world);
      if (r.idx >= P.length - 9) { r.done = 1; this.finished.push('rival'); }
    }
    r_update(this.rivals, dt);
    if (this.idx >= P.length - 9) {
      this.finished.push('jugador');
      const place = this.finished.indexOf('jugador') + 1;
      this.state = 'fin'; this.t = 6;
      return { result: { place, won: place === 1 }, canMove: true };
    }
    const pos = 1 + this.rivals.filter((r) => r.done || r.idx > this.idx).length;
    return { banner: `Posición ${pos}/4`, canMove: true };
  }

  private cleanup(): void {
    for (const r of this.rivals) { r.v.object.remove(r.rider.object); r.rider.dispose(); this.traffic.remove(r.v); }
    this.rivals = [];
    this.state = 'libre';
  }
}

function r_update(rs: Rival[], dt: number): void { for (const r of rs) r.rider.update(dt); }
