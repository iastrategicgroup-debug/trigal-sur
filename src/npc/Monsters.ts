import * as THREE from 'three';
import { Avatar } from '../character/Avatar';
import type { HumanParams } from '../character/HumanModel';
import type { CityWorld } from '../world/CityWorld';
import type { Pickups } from '../world/Pickups';

/** Criatura nocturna original: alta, esquelética, sin rostro, piel gris ceniza, andar desarticulado. */
function creatureParams(seed: number): HumanParams {
  const r = ((seed * 9301 + 49297) % 233280) / 233280;
  return {
    height: 2.15 + r * 0.25, muscle: 0.05, fat: 0, female: false, skin: r < 0.5 ? '#7a7670' : '#6a6872',
    hair: { style: 'calvo', color: '#000000' },
    face: { width: 0.88, jaw: 0.75, chin: 1.2, smile: 0, brow: '#2a2a2a', browThick: 0, eye: '#000000' },
    beard: { type: 'ninguna', color: '#000', density: 0 }, glasses: null,
    shirt: { type: 'franelilla', color: '#3a3836', pattern: 'liso', buttons: false },
    pants: { type: 'mono', color: '#2a2826' }, shoes: '#5a5650', watch: false, cap: null, hunch: 0.8, faceless: true,
  };
}

interface Monster { avatar: Avatar; pos: THREE.Vector3; facing: number; health: number; state: 'acechar' | 'atacar' | 'muerto'; cd: number; deadT: number; groanT: number }

interface Puff { s: THREE.Sprite; t: number }

export class Monsters {
  readonly group = new THREE.Group();
  readonly list: Monster[] = [];
  private spawnT = 0;
  private puffs: Puff[] = [];
  private puffMat: THREE.SpriteMaterial;
  private seed = 1;
  onGroan: ((dist: number) => void) | null = null;

  constructor(private world: CityWorld, private pickups: Pickups) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(20,18,22,0.9)'); gr.addColorStop(1, 'rgba(20,18,22,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.puffMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  }

  get count(): number { return this.list.filter((m) => m.state !== 'muerto').length; }

  private spawn(player: THREE.Vector3): void {
    for (let k = 0; k < 15; k++) {
      const a = Math.random() * Math.PI * 2, d = 28 + Math.random() * 30;
      const p = { x: player.x + Math.cos(a) * d, z: player.z + Math.sin(a) * d };
      if (Math.abs(p.x) > this.world.map.half.w - 5 || Math.abs(p.z) > this.world.map.half.h - 5) continue;
      const q = { ...p };
      if (this.world.collision.resolve(q, 0.5)) continue;
      const av = new Avatar(creatureParams(this.seed++));
      av.play('stalk', 0);
      const m: Monster = { avatar: av, pos: new THREE.Vector3(p.x, this.world.heightAt(p.x, p.z), p.z), facing: 0, health: 160, state: 'acechar', cd: 0, deadT: 0, groanT: 2 + Math.random() * 6 };
      this.group.add(av.object);
      this.list.push(m);
      this.puff(m.pos, 3);
      return;
    }
  }

  private puff(p: THREE.Vector3, n: number): void {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.puffMat.clone());
      s.position.set(p.x + (Math.random() - 0.5), p.y + 0.5 + Math.random() * 1.5, p.z + (Math.random() - 0.5));
      s.scale.setScalar(1.2);
      this.group.add(s);
      this.puffs.push({ s, t: 0 });
    }
  }

  private remove(m: Monster): void {
    this.group.remove(m.avatar.object); m.avatar.dispose();
    this.list.splice(this.list.indexOf(m), 1);
  }

  /** Daño de bala a una criatura concreta. */
  damage(m: Monster, dmg: number, dir: THREE.Vector3): void {
    if (m.state === 'muerto') return;
    m.health -= dmg;
    m.pos.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), Math.min(0.6, dmg * 0.01));
    if (m.health <= 0) { m.state = 'muerto'; m.deadT = 0; m.avatar.play('death', 0.08, true); }
    else m.avatar.play('hit', 0.05, true);
  }

  /** Distancia a la criatura viva más cercana (para el latido). */
  nearestDist(p: THREE.Vector3): number { let d = Infinity; for (const m of this.list) if (m.state !== 'muerto') d = Math.min(d, m.pos.distanceTo(p)); return d; }

  /** Disparo de escopeta: cono de 7° desde la cámara. Devuelve cuántas criaturas recibieron daño. */
  shoot(origin: THREE.Vector3, dir: THREE.Vector3, from: THREE.Vector3): number {
    let hits = 0;
    for (const m of this.list) {
      if (m.state === 'muerto') continue;
      const chest = m.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
      const v = chest.sub(origin);
      const d = v.length();
      if (d > 40 || v.normalize().dot(dir) < Math.cos(0.12 + 0.4 / Math.max(d, 1))) continue;
      if (this.world.collision.raycast(from.x, from.z, m.pos.x, m.pos.z) < 0.98) continue; // pared en medio
      const dmg = 95 * Math.max(0.25, 1 - d / 40);
      m.health -= dmg; hits++;
      m.pos.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 0.6);
      if (m.health <= 0) { m.state = 'muerto'; m.deadT = 0; m.avatar.play('death', 0.08, true); }
      else m.avatar.play('hit', 0.05, true);
    }
    return hits;
  }

  update(dt: number, active: boolean, player: { pos: THREE.Vector3; dead: boolean; hurt(a: number): void }): void {
    // Partículas de humo
    this.puffs = this.puffs.filter((p) => {
      p.t += dt; p.s.position.y += dt * 0.8; p.s.scale.setScalar(1.2 + p.t * 2);
      (p.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - p.t / 1.6);
      if (p.t > 1.6) { this.group.remove(p.s); (p.s.material as THREE.Material).dispose(); return false; }
      return true;
    });
    // Al amanecer se deshacen en humo
    if (!active) { for (const m of [...this.list]) { this.puff(m.pos, 4); this.remove(m); } return; }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.count < 10) { this.spawn(player.pos); this.spawnT = 2.5; }

    for (const m of [...this.list]) {
      const to = new THREE.Vector3().subVectors(player.pos, m.pos); to.y = 0;
      const d = to.length();
      if (m.state === 'muerto') {
        m.deadT += dt;
        if (m.deadT > 1.6) {
          this.puff(m.pos, 6);
          this.pickups.spawn('municion', 4, m.pos.x, m.pos.y, m.pos.z, 90);
          this.pickups.spawn('dinero', 15 + Math.floor(Math.random() * 30), m.pos.x + 0.6, m.pos.y, m.pos.z, 90);
          this.remove(m); continue;
        }
        m.avatar.update(dt); continue;
      }
      if (d > 110) { this.remove(m); continue; }
      m.cd -= dt;
      m.groanT -= dt;
      if (m.groanT <= 0) { m.groanT = 4 + Math.random() * 6; this.onGroan?.(d); }
      const busy = (m.avatar.currentName === 'hit' || m.avatar.currentName === 'punchR') && !m.avatar.finished;
      if (!player.dead && d < 1.3) {
        m.state = 'atacar';
        m.facing = Math.atan2(to.x, to.z);
        if (m.cd <= 0) { m.cd = 1.5; m.avatar.play('punchR', 0.1, true); player.hurt(14); }
        else if (!busy) m.avatar.play('guard', 0.2);
      } else if (!busy) {
        m.state = 'acechar';
        const sp = d < 16 ? 3.6 : 1.9;               // a corta distancia se lanza
        if (d > 0.01 && !player.dead) {
          const vx = (to.x / d) * sp, vz = (to.z / d) * sp;
          m.facing = Math.atan2(vx, vz);
          this.world.collision.move(m.pos, vx * dt, vz * dt, 0.4);
        }
        m.avatar.play(d < 14 ? 'run' : 'stalk', 0.25);
        m.avatar.setGaitSpeed(sp);
      }
      m.pos.y = this.world.heightAt(m.pos.x, m.pos.z);
      m.avatar.object.position.copy(m.pos);
      m.avatar.object.rotation.y = m.facing;
      m.avatar.update(dt);
    }
  }

  positions(): { x: number; z: number; color: string }[] {
    return this.list.filter((m) => m.state !== 'muerto').map((m) => ({ x: m.pos.x, z: m.pos.z, color: '#b040ff' }));
  }

  clear(): void { for (const m of [...this.list]) this.remove(m); }
}
