import * as THREE from 'three';
import type { CityWorld } from '../world/CityWorld';
import type { Road, V2 } from '../map/osm';
import { Vehicle, type Controls } from './Vehicle';
import type { NpcManager } from '../npc/NpcManager';
import type { Archetype } from '../character/archetypes';

interface Light { p: V2; offset: number; lamps: number }
const KINDS: Archetype[] = ['hombre', 'mujer', 'senora', 'anciano', 'deportista'];

/**
 * Tráfico: carros que siguen el carril derecho, respetan el sentido de las vías y los semáforos,
 * frenan ante peatones/jugador/otros carros. Patrullas que persiguen. Robos de carro. Choques, humo, fuego y explosión.
 */
export class Traffic {
  readonly group = new THREE.Group();
  readonly list: Vehicle[] = [];
  private nodes = new Map<string, { road: Road; k: number }[]>();
  private lights = new Map<string, Light>();
  private lampMesh!: THREE.InstancedMesh;
  private time = 0;
  private spawnT = 0;
  private thiefT = 3;
  private fx: { s: THREE.Sprite; t: number; life: number; vy: number }[] = [];
  private smokeMat: THREE.SpriteMaterial;
  private fireMat: THREE.SpriteMaterial;
  cap = 14;
  wanted = 0;
  onExplode: ((p: THREE.Vector3) => void) | null = null;
  onNotice: ((html: string) => void) | null = null;
  /** Vehículo del jugador que empezó a incendiarse (aviso una vez). */
  onFire: ((v: Vehicle) => void) | null = null;

  constructor(private world: CityWorld, private npcs: NpcManager) {
    for (const r of world.map.roads) r.nodeIds.forEach((id, k) => { let a = this.nodes.get(id); if (!a) this.nodes.set(id, (a = [])); a.push({ road: r, k }); });
    this.buildLights();
    const sprite = (inner: string, outer: string) => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
    };
    this.smokeMat = new THREE.SpriteMaterial({ map: sprite('rgba(60,58,55,0.8)', 'rgba(60,58,55,0)'), transparent: true, depthWrite: false });
    this.fireMat = new THREE.SpriteMaterial({ map: sprite('rgba(255,220,120,1)', 'rgba(255,80,0,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.spawnParked(22);
  }

  // ---------- Semáforos ----------
  private buildLights(): void {
    const pts: Light[] = [];
    for (const [id, arr] of this.nodes) {
      const deg = arr.reduce((t, e) => t + (e.k > 0 ? 1 : 0) + (e.k < e.road.pts.length - 1 ? 1 : 0), 0);
      if (deg < 3 || !arr.some((e) => e.road.kind === 'tertiary') || arr.some((e) => e.road.kind.startsWith('motorway'))) continue;
      const p = arr[0]!.road.pts[arr[0]!.k]!;
      if (pts.some((q) => Math.hypot(q.p.x - p.x, q.p.z - p.z) < 25)) continue;
      const L: Light = { p, offset: Math.random() * 20, lamps: pts.length * 6 };
      pts.push(L); this.lights.set(id, L);
    }
    // Postes con dos cabezales (uno por eje); los focos son instancias que cambian de color
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6).translate(0, 2.1, 0), new THREE.MeshLambertMaterial({ color: 0x3a3a3a }), Math.max(1, pts.length));
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), Math.max(1, pts.length * 2));
    this.lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, pts.length * 6));
    const M = new THREE.Matrix4();
    pts.forEach((L, i) => {
      // esquina libre (fuera de calzada)
      let c = { x: L.p.x + 6, z: L.p.z + 6 };
      for (const [ox, oz] of [[6, 6], [-6, 6], [6, -6], [-6, -6], [7, 0], [0, 7]] as const) { const q = { x: L.p.x + ox, z: L.p.z + oz }; if (!this.world.map.onCarriageway(q.x, q.z, 0.5)) { c = q; break; } }
      const y = this.world.heightAt(c.x, c.z);
      pole.setMatrixAt(i, M.makeTranslation(c.x, y, c.z));
      for (let a = 0; a < 2; a++) {
        const hx = c.x + (a === 0 ? 0.25 : 0), hz = c.z + (a === 1 ? 0.25 : 0);
        heads.setMatrixAt(i * 2 + a, M.makeTranslation(hx, y + 3.7, hz));
        for (let k = 0; k < 3; k++) this.lampMesh.setMatrixAt(L.lamps + a * 3 + k, M.makeTranslation(hx + (a === 0 ? 0 : 0), y + 4.0 - k * 0.29, hz + (a === 0 ? 0.17 : 0) + (a === 1 ? 0.17 : 0) * 0));
      }
      L.p = { x: L.p.x, z: L.p.z };
    });
    pole.count = pts.length; heads.count = pts.length * 2; this.lampMesh.count = pts.length * 6;
    for (const m of [pole, heads, this.lampMesh]) { m.computeBoundingSphere(); this.group.add(m); }
    this.updateLamps();
  }

  /** Estado del semáforo para un eje (0 = este-oeste, 1 = norte-sur): 'verde' | 'amarillo' | 'rojo'. */
  private phase(L: Light, axis: number): 'verde' | 'amarillo' | 'rojo' {
    const t = (this.time + L.offset) % 20;
    const g0 = t < 8 ? 'verde' : t < 9.5 ? 'amarillo' : 'rojo';
    const g1 = t >= 10 && t < 18 ? 'verde' : t >= 18 && t < 19.5 ? 'amarillo' : 'rojo';
    return axis === 0 ? g0 : g1;
  }

  private updateLamps(): void {
    const on = [new THREE.Color(0xff2a1a), new THREE.Color(0xffc020), new THREE.Color(0x20ff60)], off = new THREE.Color(0x202020);
    for (const L of this.lights.values()) for (let a = 0; a < 2; a++) {
      const ph = this.phase(L, a);
      const idx = ph === 'rojo' ? 0 : ph === 'amarillo' ? 1 : 2;
      for (let k = 0; k < 3; k++) this.lampMesh.setColorAt(L.lamps + a * 3 + k, k === idx ? on[k]! : off);
    }
    if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true;
  }

  // ---------- Aparición ----------
  private spawnParked(n: number): void {
    const roads = this.world.map.roads.filter((r) => r.kind === 'residential' && r.sidewalk > 0);
    for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
      const r = roads[Math.floor(Math.random() * roads.length)]!;
      const k = Math.floor(Math.random() * (r.pts.length - 1));
      const a = r.pts[k]!, b = r.pts[k + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 12) continue;
      const t = 0.3 + Math.random() * 0.4, dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const off = r.width / 2 - 1.1;
      const x = a.x + (b.x - a.x) * t - dz * off, z = a.z + (b.z - a.z) * t + dx * off;
      if (this.list.some((v) => v.pos.distanceTo(new THREE.Vector3(x, 0, z)) < 7)) continue;
      const v = new Vehicle(Math.random() < 0.12 ? 'moto' : 'carro', (['sedan', 'hatch', 'camioneta', 'sedan', 'taxi'] as const)[Math.floor(Math.random() * 5)]);
      v.place(x, z, Math.atan2(dx, dz), this.world);
      this.add(v); i++;
    }
  }

  add(v: Vehicle): void { this.list.push(v); this.group.add(v.object); }
  remove(v: Vehicle): void { this.group.remove(v.object); this.list.splice(this.list.indexOf(v), 1); }

  private spawnMoving(player: THREE.Vector3, police = false): Vehicle | null {
    const roads = this.world.map.roads;
    for (let t = 0; t < 25; t++) {
      const r = roads[Math.floor(Math.random() * roads.length)]!;
      const k = Math.floor(Math.random() * (r.pts.length - 1));
      const a = r.pts[k]!;
      const d = Math.hypot(a.x - player.x, a.z - player.z);
      if (d < (police ? 70 : 60) || d > (police ? 130 : 150)) continue;
      if (Math.abs(a.x) > this.world.map.half.w || Math.abs(a.z) > this.world.map.half.h) continue;
      const dir: 1 | -1 = r.oneway ? 1 : Math.random() < 0.5 ? 1 : -1;
      const ti = dir === 1 ? k + 1 : k;
      if (ti < 0 || ti >= r.pts.length) continue;
      const v = police ? new Vehicle('policia') : new Vehicle(Math.random() < 0.1 ? 'moto' : 'carro', (['sedan', 'hatch', 'camioneta', 'sedan', 'taxi'] as const)[Math.floor(Math.random() * 5)]);
      v.driver = police ? 'policia' : 'ia'; v.pursuit = police;
      v.driverKind = KINDS[Math.floor(Math.random() * KINDS.length)]!;
      v.road = r; v.dir = dir; v.ti = ti; this.setLane(v);
      const b = r.pts[ti]!;
      const lp = this.lanePoint(v, k + (dir === 1 ? 0 : 1));
      v.place(lp.x, lp.z, Math.atan2(b.x - a.x, b.z - a.z) * (dir === 1 ? 1 : 1) + (dir === 1 ? 0 : Math.PI), this.world);
      if (this.list.some((o) => o !== v && o.pos.distanceTo(v.pos) < 8)) continue;
      v.speed = v.cruise * 0.6;
      this.add(v);
      return v;
    }
    return null;
  }

  private setLane(v: Vehicle): void {
    const r = v.road!;
    v.lane = r.oneway ? 0 : r.width / 4;
    v.cruise = (r.kind === 'tertiary' ? 13 : r.kind.startsWith('motorway') ? 20 : 9) * (0.85 + Math.random() * 0.25);
  }

  /** Punto del carril derecho en el nodo `k` de la vía actual (según el sentido de marcha). */
  private lanePoint(v: Vehicle, k: number): V2 {
    const r = v.road!, p = r.pts[k]!;
    const prev = r.pts[k - v.dir] ?? r.pts[k]!, next = r.pts[k + v.dir] ?? r.pts[k]!;
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (k - v.dir < 0 || k - v.dir >= r.pts.length) { /* extremo */ }
    // Normal derecha respecto al sentido de marcha: (-dz, dx)
    return { x: p.x - dz * v.lane, z: p.z + dx * v.lane };
  }

  /** Elige la vía siguiente al llegar a un nodo (respeta sentido único; la policía elige la que acerca al objetivo). */
  private nextRoad(v: Vehicle, target: THREE.Vector3): boolean {
    const r = v.road!, id = r.nodeIds[v.ti]!;
    const opts: { road: Road; k: number; dir: 1 | -1 }[] = [];
    for (const e of this.nodes.get(id) ?? []) {
      if (e.road.kind === 'footway') continue;
      if (e.k < e.road.pts.length - 1) opts.push({ road: e.road, k: e.k, dir: 1 });
      if (e.k > 0 && !e.road.oneway) opts.push({ road: e.road, k: e.k, dir: -1 });
    }
    const fwd = opts.filter((o) => !(o.road === r && o.dir === -v.dir));
    let pick = fwd.length ? fwd : opts;
    if (!pick.length) return false;
    let o: (typeof pick)[number];
    if (v.pursuit) {
      o = pick.reduce((best, c) => { const q = c.road.pts[c.k + c.dir]!; const bq = best.road.pts[best.k + best.dir]!; return Math.hypot(q.x - target.x, q.z - target.z) < Math.hypot(bq.x - target.x, bq.z - target.z) ? c : best; });
    } else o = pick[Math.floor(Math.random() * pick.length)]!;
    v.road = o.road; v.dir = o.dir; v.ti = o.k + o.dir;
    this.setLane(v);
    return true;
  }

  private axisOf(dx: number, dz: number): number { let a = Math.atan2(dz, dx); if (a < 0) a += Math.PI; return a < Math.PI / 4 || a > (3 * Math.PI) / 4 ? 0 : 1; }

  // ---------- IA de manejo ----------
  private aiControls(v: Vehicle, player: { pos: THREE.Vector3; vehicle: Vehicle | null }, dt: number): Controls {
    const r = v.road;
    if (!r) return { throttle: 0, steer: 0, handbrake: true };
    let tp = this.lanePoint(v, v.ti);
    let dist = Math.hypot(tp.x - v.pos.x, tp.z - v.pos.z);
    if (dist < 4.5) {
      v.ti += v.dir;
      if (v.ti < 0 || v.ti >= r.pts.length) { v.ti -= v.dir; if (!this.nextRoad(v, player.pos)) { v.dir = (v.dir * -1) as 1 | -1; v.ti += v.dir; } }
      tp = this.lanePoint(v, v.ti); dist = Math.hypot(tp.x - v.pos.x, tp.z - v.pos.z);
    }
    let target = { x: tp.x, z: tp.z };
    // Persecución: directo al jugador cuando lo ve
    const toP = new THREE.Vector3().subVectors(player.pos, v.pos);
    if (v.pursuit && toP.length() < 40 && this.world.collision.raycast(v.pos.x, v.pos.z, player.pos.x, player.pos.z) >= 1) target = { x: player.pos.x, z: player.pos.z };
    const want = Math.atan2(target.x - v.pos.x, target.z - v.pos.z);
    let diff = want - v.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    let vmax = v.pursuit ? (this.wanted > 2 ? 26 : 20) : v.cruise;
    vmax *= 1 - Math.min(0.6, Math.abs(diff) * 0.6); // frena en curvas
    if (v.driver === 'ladron') vmax *= 1.4;
    // Semáforo en el nodo al que se dirige
    const node = r.nodeIds[v.ti];
    const L = node ? this.lights.get(node) : undefined;
    if (L && !v.pursuit && v.driver !== 'ladron') {
      const dn = Math.hypot(L.p.x - v.pos.x, L.p.z - v.pos.z);
      const prev = r.pts[v.ti - v.dir] ?? L.p;
      const ph = this.phase(L, this.axisOf(L.p.x - prev.x, L.p.z - prev.z));
      if (ph !== 'verde' && dn > 7 && dn < 22) vmax = Math.min(vmax, Math.max(0, (dn - 9) * 0.9));
    }
    // Obstáculos adelante: carros, jugador (a pie o en carro), peatones en la calzada
    const f = v.fwd;
    const ahead = (p: THREE.Vector3, minGap: number) => {
      const dx = p.x - v.pos.x, dz = p.z - v.pos.z, along = dx * f.x + dz * f.z, lat = Math.abs(dx * f.z - dz * f.x);
      if (along > 0 && along < 22 && lat < 2.0) vmax = Math.min(vmax, Math.max(0, (along - minGap) * 0.8));
    };
    for (const o of this.list) if (o !== v && !(v.pursuit && o === player.vehicle)) ahead(o.pos, 6);
    if (!v.pursuit) ahead(player.pos, 4.5);
    for (const n of this.npcs.npcs) if (n.state !== 'muerto' && this.world.map.onCarriageway(n.pos.x, n.pos.z, 0)) ahead(n.pos, 4);
    // Bocinazo al quedarse trabado; si sigue, se reubica en el carril
    if (Math.abs(v.speed) < 0.5 && vmax > 3) { v.stuck += dt; if (v.stuck > 4) { v.stuck = 0; v.speed = -3; } } else v.stuck = 0;
    const throttle = THREE.MathUtils.clamp((vmax - v.speed) * 0.35, -1, 1);
    return { throttle: v.speed < 0 && v.stuck === 0 ? 1 : throttle, steer: THREE.MathUtils.clamp(-diff * 2.2, -1, 1) * -1, handbrake: false };
  }

  // ---------- Actualización ----------
  update(dt: number, player: { pos: THREE.Vector3; vehicle: Vehicle | null; onFoot: boolean }): void {
    this.time += dt;
    if (Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4)) this.updateLamps();
    // Tráfico y patrullas alrededor del jugador
    this.spawnT -= dt;
    const moving = this.list.filter((v) => v.driver === 'ia' || v.driver === 'ladron').length;
    const cops = this.list.filter((v) => v.driver === 'policia').length;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5;
      if (moving < this.cap) this.spawnMoving(player.pos);
      if (cops < Math.min(4, this.wanted)) this.spawnMoving(player.pos, true);
    }
    for (const v of [...this.list]) {
      const d = v.pos.distanceTo(player.pos);
      if (v !== player.vehicle && (v.driver === 'ia' || v.driver === 'policia' || v.wrecked) && d > 200 && !v.playerOwned) { this.remove(v); continue; }
      if (v.driver === 'policia' && this.wanted === 0 && d > 60) { this.remove(v); continue; }
      if (v === player.vehicle) continue;  // lo maneja Game
      if (v.driver === 'ia' || v.driver === 'policia' || v.driver === 'ladron') v.step(dt, this.aiControls(v, player, dt), this.world);
      else if (v.kind !== 'heli' && v.driver !== 'piloto') v.step(dt, { throttle: 0, steer: 0, handbrake: true }, this.world);
      if (v.model.siren) { const on = Math.floor(this.time * 6) % 2 === 0; (v.model.siren.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff2020 : 0x2040ff); v.model.siren.visible = this.wanted > 0 || v.pursuit; }
    }
    this.collide(player);
    this.thieves(dt, player);
    this.burn(dt, player);
    // Efectos
    this.fx = this.fx.filter((e) => { e.t += dt; e.s.position.y += e.vy * dt; e.s.scale.multiplyScalar(1 + dt * 0.9); (e.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - e.t / e.life); if (e.t > e.life) { this.group.remove(e.s); (e.s.material as THREE.Material).dispose(); return false; } return true; });
  }

  /** Choques entre vehículos y atropellos. */
  private collide(player: { pos: THREE.Vector3; vehicle: Vehicle | null; onFoot: boolean }): void {
    const L = this.list;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i]!, b = L[j]!;
      if (a.kind === 'heli' || b.kind === 'heli') continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), min = a.spec.radius + b.spec.radius + 0.4;
      if (d > min || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, push = (min - d) / 2;
      a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push;
      const rel = Math.abs(a.speed - b.speed * (a.fwd.dot(b.fwd)));
      if (rel > 3) {
        const k = a.kind === 'moto' && b.kind === 'moto' ? 0.8 : 2.5; // roces entre motos: casi sin daño
        a.damage(rel * k); b.damage(rel * k);
        a.impact = Math.max(a.impact, rel); b.impact = Math.max(b.impact, rel);
        const avg = (a.speed + b.speed) / 2; a.speed = avg * 0.4; b.speed = avg * 0.4;
        if (rel > 8 && (a === player.vehicle || b === player.vehicle)) this.addWanted(0.4);
      }
    }
    // Atropellos
    for (const v of L) {
      if (Math.abs(v.speed) < 3 || v.kind === 'heli') continue;
      const f = v.fwd, front = v.pos.clone().addScaledVector(f, v.spec.len * 0.35 * Math.sign(v.speed));
      const [hurt, dead] = this.npcs.vehicleHit(front, v.spec.radius + 0.4, Math.abs(v.speed), f.x * Math.sign(v.speed), f.z * Math.sign(v.speed), v === player.vehicle);
      if ((hurt || dead) && v !== player.vehicle) v.speed *= 0.5;
    }
  }

  /** Ladrones que sacan a la gente de sus carros en los semáforos; también se llevan carros abandonados. */
  private thieves(dt: number, player: { pos: THREE.Vector3; vehicle: Vehicle | null }): void {
    this.thiefT -= dt;
    if (this.thiefT > 0) return;
    this.thiefT = 4;
    for (const v of this.list) {
      if (v.kind === 'heli' || v.wrecked || v === player.vehicle) continue;
      const stopped = v.driver === 'ia' && Math.abs(v.speed) < 0.6;
      const abandoned = v.driver === null && v.playerOwned && v.pos.distanceTo(player.pos) > 25;
      if (!stopped && !abandoned) continue;
      if (!this.npcs.takeThiefNear(v.pos, 14)) continue;
      if (stopped) {
        const dp = v.doorPoint();
        this.npcs.ejectDriver({ x: dp.x, z: dp.z }, v.driverKind as Archetype, false);
        if (v.pos.distanceTo(player.pos) < 60) this.onNotice?.('<b>¡Robo de carro!</b>Un ladrón sacó a un conductor');
      } else this.onNotice?.('<b>¡Te robaron el carro!</b>');
      v.driver = 'ladron'; v.playerOwned = false;
      if (!v.road) { const near = this.world.map.nearestRoad(v.pos.x, v.pos.z, 30); if (near) { v.road = near.road; v.dir = near.road.oneway ? 1 : 1; v.ti = Math.min(near.i + 1, near.road.pts.length - 1); this.setLane(v); } }
      return;
    }
  }

  /** El jugador saca al conductor y se queda con el vehículo. */
  carjack(v: Vehicle): void {
    if (v.driver === 'ia' || v.driver === 'ladron' || v.driver === 'policia') {
      const dp = v.doorPoint();
      const fight = v.driver === 'ladron' || v.driver === 'policia' || Math.random() < 0.3;
      if (v.driver === 'policia') this.npcs.spawnCop({ x: dp.x, z: dp.z });
      else this.npcs.ejectDriver({ x: dp.x, z: dp.z }, (v.driver === 'ladron' ? 'ladron' : v.driverKind) as Archetype, fight);
      this.addWanted(v.driver === 'policia' ? 2 : 1);
    }
    v.driver = 'jugador'; v.road = null; v.pursuit = false; v.playerOwned = true;
  }

  addWanted(n: number): void { this.wanted = Math.min(5, this.wanted + n); }

  // ---------- Daño: humo, fuego, explosión ----------
  private puff(p: THREE.Vector3, fire: boolean): void {
    const s = new THREE.Sprite((fire ? this.fireMat : this.smokeMat).clone());
    s.position.set(p.x + (Math.random() - 0.5) * 0.8, p.y + 1.1, p.z + (Math.random() - 0.5) * 0.8);
    s.scale.setScalar(fire ? 0.9 : 1.1);
    this.group.add(s);
    this.fx.push({ s, t: 0, life: fire ? 0.6 : 2.2, vy: fire ? 1.5 : 1.1 });
  }

  private burn(dt: number, player: { pos: THREE.Vector3; vehicle: Vehicle | null }): void {
    for (const v of this.list) {
      if (v.wrecked) { v.burnT += dt; if (Math.random() < dt * 6) this.puff(v.pos, false); if (v.burnT > 40) this.remove(v); continue; }
      const hp = v.health / v.spec.health;
      if (hp < 0.45 && Math.random() < dt * (hp < 0.2 ? 10 : 4)) this.puff(v.pos.clone().addScaledVector(v.fwd, v.spec.len * 0.35), false);
      if (hp < 0.2 && Math.random() < dt * 14) this.puff(v.pos.clone().addScaledVector(v.fwd, v.spec.len * 0.35), true);
      if (hp < 0.2) { if (!v.burning) { v.burning = true; this.onFire?.(v); } v.health -= dt * 2.5; } // se incendia y explota en ~7 s
      if (v.health <= 0) this.explode(v, player);
    }
  }

  private explode(v: Vehicle, player: { pos: THREE.Vector3; vehicle: Vehicle | null }): void {
    v.wrecked = true; v.health = 0; v.driver = v.driver === 'jugador' ? 'jugador' : null; v.speed *= 0.3;
    v.model.body.material = new THREE.MeshLambertMaterial({ color: 0x1a1816 });
    for (let i = 0; i < 14; i++) this.puff(v.pos, true);
    for (let i = 0; i < 10; i++) this.puff(v.pos, false);
    const flash = new THREE.Sprite(this.fireMat.clone()); flash.position.copy(v.pos).add(new THREE.Vector3(0, 1.5, 0)); flash.scale.setScalar(9);
    this.group.add(flash); this.fx.push({ s: flash, t: 0, life: 0.5, vy: 0 });
    this.npcs.vehicleHit(v.pos, 6, 14, 0, 0, v === player.vehicle);
    for (const o of this.list) if (o !== v && o.pos.distanceTo(v.pos) < 6) o.damage(40);
    this.onExplode?.(v.pos.clone());
  }

  nearestEnterable(p: THREE.Vector3, r: number): Vehicle | null {
    let best: Vehicle | null = null, bd = r;
    for (const v of this.list) { if (v.wrecked) continue; const d = Math.min(v.pos.distanceTo(p), v.doorPoint().distanceTo(p)); if (d < bd) { bd = d; best = v; } }
    return best;
  }

  positions(): { x: number; z: number; color: string }[] {
    return this.list.filter((v) => v.driver === 'policia' || v.kind === 'heli').map((v) => ({ x: v.pos.x, z: v.pos.z, color: v.kind === 'heli' ? '#40e0ff' : '#3060ff' }));
  }
}
