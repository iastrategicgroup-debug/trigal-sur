import * as THREE from 'three';
import { Avatar } from '../character/Avatar';
import { npcParams, randomArchetype, type Archetype } from '../character/archetypes';
import type { CityWorld } from '../world/CityWorld';
import type { Pickups } from '../world/Pickups';
import type { Road, V2 } from '../map/osm';
import { densify, offsetPolyline, CURB_W } from '../world/roads';

type NpcState = 'caminar' | 'parado' | 'saludar' | 'huir' | 'pelear' | 'acechar' | 'golpeado' | 'muerto';

/** Contexto del jugador que la IA necesita. */
export interface PlayerCtx {
  pos: THREE.Vector3;
  dead: boolean;
  money: number;
  hurt(amount: number, source: 'golpe'): void;
  rob(amount: number): void;
  notify(html: string): void;
}

export interface Npc {
  id: number;
  kind: Archetype;
  avatar: Avatar;
  pos: THREE.Vector3;
  facing: number;
  speed: number;
  state: NpcState;
  timer: number;
  health: number;
  path: V2[]; pi: number; dir: 1 | -1;
  road: Road;
  aggressive: boolean;   // se defiende en vez de huir
  stolen: number;        // dinero robado al jugador
  attackCd: number;
  hitStun: number;
  deadTime: number;
  greeted: boolean;
}

const MAX_NPC = 70;

const SPAWN_MIN = 14, SPAWN_MAX = 85, DESPAWN = 120;

/**
 * IA de peatones (máquina de estados por NPC, decisiones cada paso fijo):
 *  caminar ⇄ parado/saludar;  golpeado → (agresivo ? pelear : huir);  ladrón: acechar → golpe+robo → huir
 *  salud ≤ 0 → muerto (cae, suelta dinero flotante; desaparece a los 30 s).
 */
export class NpcManager {
  readonly group = new THREE.Group();
  readonly npcs: Npc[] = [];
  private nextId = 1;
  /** Máximo de peatones (de noche, con las criaturas, la gente se mete en sus casas). */
  max = MAX_NPC;
  /** Tope según la calidad gráfica. */
  cap = 40;
  private spawnTimer = 0;
  private walkPaths: { road: Road; side: number; pts: V2[] }[] = [];
  private rnd: () => number;

  constructor(private world: CityWorld, private pickups: Pickups, seed = 1234) {
    let s = seed;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    // Rutas peatonales: centro de la franja de losas a cada lado de cada calle con acera
    for (const road of world.map.roads) {
      if (road.sidewalk <= 0) continue;
      const verge = road.sidewalk >= 3.5 ? 1.0 : 0.8;
      const mid = road.width / 2 + CURB_W + verge + (road.sidewalk - CURB_W - verge) / 2;
      const base = densify(road.pts, 3);
      for (const side of [1, -1]) this.walkPaths.push({ road, side, pts: offsetPolyline(base, side * mid) });
    }
  }

  get count(): number { return this.npcs.length; }

  /** Llena las aceras de una vez (al cargar) para que haya gente desde el primer momento. */
  populate(player: THREE.Vector3, n: number): void { for (let i = 0; i < n * 3 && this.npcs.length < n; i++) this.spawn(player, 4); }

  private spawn(player: THREE.Vector3, minDist = SPAWN_MIN): void {
    // Punto de acera a 25–90 m del jugador
    for (let tries = 0; tries < 12; tries++) {
      const wp = this.walkPaths[Math.floor(this.rnd() * this.walkPaths.length)]!;
      const pi = Math.floor(this.rnd() * wp.pts.length);
      const p = wp.pts[pi]!;
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < minDist || d > SPAWN_MAX) continue;
      if (this.npcs.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 1.2)) continue; // sin encimarse
      if (Math.abs(p.x) > this.world.map.half.w - 5 || Math.abs(p.z) > this.world.map.half.h - 5) continue;
      this.make(randomArchetype(this.rnd), p, wp, pi);
      return;
    }
  }

  /** Crea un NPC en `p` sobre la ruta peatonal `wp` (o la más cercana). */
  private make(kind: Archetype, p: V2, wp?: { road: Road; pts: V2[] }, pi = 0): Npc {
    if (!wp) { const r = this.nearestPath(p); wp = r.wp; pi = r.i; }
    {
      const avatar = new Avatar(npcParams(kind, Math.floor(this.rnd() * 1e9)));
      const old = kind === 'anciano' || kind === 'anciana';
      const npc: Npc = {
        id: this.nextId++, kind, avatar,
        pos: new THREE.Vector3(p.x, this.world.heightAt(p.x, p.z), p.z), facing: 0,
        speed: old ? 0.8 + this.rnd() * 0.2 : 1.2 + this.rnd() * 0.4,
        state: 'caminar', timer: 0, health: kind === 'policia' ? 160 : kind === 'deportista' ? 130 : old ? 50 : 90,
        path: wp.pts, pi, dir: this.rnd() < 0.5 ? 1 : -1, road: wp.road,
        aggressive: kind === 'policia' || kind === 'ladron' || kind === 'deportista' || (kind === 'hombre' && this.rnd() < 0.45),
        stolen: 0, attackCd: 0, hitStun: 0, deadTime: 0, greeted: false,
      };
      avatar.object.position.copy(npc.pos);
      this.group.add(avatar.object);
      this.npcs.push(npc);
      return npc;
    }
  }

  private nearestPath(p: V2): { wp: { road: Road; pts: V2[] }; i: number } {
    let best = this.walkPaths[0]!, bi = 0, bd = Infinity;
    for (const wp of this.walkPaths) for (let i = 0; i < wp.pts.length; i += 2) {
      const d = Math.hypot(wp.pts[i]!.x - p.x, wp.pts[i]!.z - p.z);
      if (d < bd) { bd = d; best = wp; bi = i; }
    }
    return { wp: best, i: bi };
  }

  /** Conductor sacado de su carro: aparece junto a la puerta; pelea o huye. */
  ejectDriver(p: V2, kind: Archetype, fight: boolean): Npc {
    const n = this.make(kind, p);
    n.facing = this.rnd() * 6.28;
    n.state = 'golpeado'; n.hitStun = 0.6; n.aggressive = fight;
    n.avatar.play('hit', 0.05, true);
    return n;
  }

  /** Ladrón que pasea cerca de `p` (para robar carros). Lo saca del mundo y devuelve su tipo. */
  takeThiefNear(p: V2, r: number): boolean {
    const n = this.npcs.find((n) => n.kind === 'ladron' && n.state === 'caminar' && Math.hypot(n.pos.x - p.x, n.pos.z - p.z) < r);
    if (!n) return false;
    this.remove(n);
    return true;
  }

  /** Atropello: daño según la velocidad. Devuelve [heridos, muertos]. */
  vehicleHit(p: THREE.Vector3, radius: number, speed: number, dx: number, dz: number, byPlayer: boolean): [number, number] {
    let hurt = 0, dead = 0;
    for (const n of this.npcs) {
      if (n.state === 'muerto') continue;
      const ex = n.pos.x - p.x, ez = n.pos.z - p.z;
      if (Math.hypot(ex, ez) > radius) continue;
      const dmg = speed * 9;
      n.health -= dmg;
      n.pos.x += dx * Math.min(3, speed * 0.25); n.pos.z += dz * Math.min(3, speed * 0.25);
      this.world.collision.resolve(n.pos, 0.3);
      if (n.health <= 0) { this.kill(n); dead++; if (byPlayer) this.onCrime?.('muerte', n.kind); }
      else { n.state = 'golpeado'; n.hitStun = 0.6; n.avatar.play('hit', 0.05, true); hurt++; if (byPlayer) this.onCrime?.('asalto', n.kind); }
    }
    return [hurt, dead];
  }

  /** Policía que se baja de la patrulla y va por el jugador. */
  spawnCop(p: V2): Npc { const n = this.make('policia', p); n.state = 'pelear'; n.aggressive = true; return n; }

  /** Delitos del jugador (para el nivel de búsqueda). */
  onCrime: ((type: 'asalto' | 'muerte', kind: Archetype) => void) | null = null;

  private remove(n: Npc): void {
    this.group.remove(n.avatar.object);
    n.avatar.dispose();
    this.npcs.splice(this.npcs.indexOf(n), 1);
  }

  /** El jugador golpea: devuelve true si conectó con alguien. */
  punch(from: THREE.Vector3, facing: number, damage: number): boolean {
    const fx = Math.sin(facing), fz = Math.cos(facing);
    let hit = false;
    for (const n of this.npcs) {
      if (n.state === 'muerto') continue;
      const dx = n.pos.x - from.x, dz = n.pos.z - from.z, d = Math.hypot(dx, dz);
      if (d > 1.35 || (dx * fx + dz * fz) / (d || 1) < 0.45) continue;
      hit = true;
      n.health -= damage;
      // empujón
      n.pos.x += fx * 0.35; n.pos.z += fz * 0.35;
      this.world.collision.resolve(n.pos, 0.3);
      if (n.health <= 0) { this.kill(n); this.onCrime?.('muerte', n.kind); continue; }
      this.onCrime?.('asalto', n.kind);
      n.state = 'golpeado'; n.hitStun = 0.35;
      n.avatar.play('hit', 0.08, true);
      // Los que ven la pelea alrededor huyen
      for (const o of this.npcs) if (o !== n && o.state === 'caminar' && o.pos.distanceTo(n.pos) < 12 && !o.aggressive) { o.state = 'huir'; o.timer = 6; }
    }
    return hit;
  }

  private kill(n: Npc): void {
    n.state = 'muerto'; n.deadTime = 0; n.health = 0;
    n.avatar.play('death', 0.1, true);
    // Botín sin sangre: dinero flotante (+ lo que haya robado)
    this.pickups.drop(n.pos.x, n.pos.y, n.pos.z, this.rnd);
    if (n.stolen > 0) this.pickups.spawn('dinero', n.stolen, n.pos.x, n.pos.y, n.pos.z + 0.6, 60);
  }

  update(dt: number, player: PlayerCtx): void {
    this.spawnTimer -= dt;
    const alive = this.npcs.filter((n) => n.state !== 'muerto').length;
    if (this.spawnTimer <= 0 && alive < this.max) { this.spawn(player.pos); this.spawn(player.pos); this.spawnTimer = 0.1; }

    for (const n of [...this.npcs]) {
      const toP = new THREE.Vector3().subVectors(player.pos, n.pos);
      const dP = Math.hypot(toP.x, toP.z);
      if (dP > DESPAWN || (n.state === 'muerto' && (n.deadTime += dt) > 30) || (alive > this.max + 5 && dP > 40 && n.state === 'caminar')) { this.remove(n); continue; }
      n.attackCd -= dt;
      let vx = 0, vz = 0, anim = 'idle', animSpeed = 0;
      const old = n.kind === 'anciano' || n.kind === 'anciana';

      switch (n.state) {
        case 'caminar': {
          const t = n.path[n.pi]!;
          const dx = t.x - n.pos.x, dz = t.z - n.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.6) {
            n.pi += n.dir;
            if (n.pi < 0 || n.pi >= n.path.length) { n.dir = (n.dir * -1) as 1 | -1; n.pi = Math.max(0, Math.min(n.path.length - 1, n.pi)); }
          } else { vx = (dx / d) * n.speed; vz = (dz / d) * n.speed; }
          // Esquiva al jugador
          if (dP < 1.6 && !player.dead) { const s = toP.x * vz - toP.z * vx > 0 ? -1 : 1; vx += -vz * s * 0.8; vz += vx * s * 0.8; }
          anim = old ? 'walkOld' : 'walk'; animSpeed = n.speed;
          if (this.rnd() < dt * 0.04) { n.state = 'parado'; n.timer = 2 + this.rnd() * 4; }
          // Ladrón: si ve al jugador con dinero, acecha
          if (n.kind === 'ladron' && dP < 14 && player.money > 0 && !player.dead && n.stolen === 0) n.state = 'acechar';
          // Saludo espontáneo al pasar cerca
          if (!n.greeted && dP < 3 && this.rnd() < 0.3 && n.kind !== 'ladron') { n.greeted = true; n.state = 'saludar'; n.timer = 1.6; n.avatar.play('wave', 0.2, true); }
          break;
        }
        case 'parado':
          anim = old ? 'idleOld' : 'idle';
          if ((n.timer -= dt) <= 0) n.state = 'caminar';
          break;
        case 'saludar':
          anim = 'wave';
          n.facing = turn(n.facing, Math.atan2(toP.x, toP.z), dt * 6);
          if ((n.timer -= dt) <= 0) n.state = 'caminar';
          break;
        case 'golpeado':
          anim = 'hit';
          if ((n.hitStun -= dt) <= 0) {
            if (n.aggressive && !player.dead) n.state = 'pelear';
            else { n.state = 'huir'; n.timer = 8; }
          }
          break;
        case 'huir': {
          const away = dP > 0.01 ? -1 / dP : 0;
          vx = toP.x * away * 5.2; vz = toP.z * away * 5.2;
          anim = 'flee'; animSpeed = 5.2;
          if ((n.timer -= dt) <= 0 && dP > 25) { n.state = 'caminar'; this.repath(n); }
          break;
        }
        case 'acechar':
        case 'pelear': {
          if (player.dead) { n.state = n.stolen > 0 ? 'huir' : 'caminar'; n.timer = 6; break; }
          n.facing = turn(n.facing, Math.atan2(toP.x, toP.z), dt * 8);
          if (dP > 1.05) {
            const sp = n.state === 'acechar' ? 4.5 : 3.8;
            vx = (toP.x / dP) * sp; vz = (toP.z / dP) * sp;
            anim = 'jog'; animSpeed = sp;
            if (dP > 35) { n.state = 'caminar'; this.repath(n); }
          } else {
            anim = 'guard';
            if (n.attackCd <= 0) {
              n.attackCd = n.kind === 'policia' ? 0.8 : 1.1;
              n.avatar.play(this.rnd() < 0.5 ? 'punchR' : 'punchL', 0.08, true);
              const dmg = n.kind === 'policia' ? 12 : n.kind === 'deportista' ? 10 : 7;
              player.hurt(dmg, 'golpe');
              if (n.kind === 'ladron' && n.stolen === 0 && player.money > 0) {
                const take = Math.max(1, Math.floor(player.money * 0.3));
                player.rob(take); n.stolen = take;
                player.notify(`<b>¡Te robaron $${take}!</b>Persíguelo y recupéralo`);
                n.state = 'huir'; n.timer = 12;
              }
            }
          }
          break;
        }
        case 'muerto':
          anim = 'death';
          break;
      }

      if (n.state !== 'muerto') {
        // Movimiento con colisiones contra edificios
        if (vx || vz) {
          n.facing = turn(n.facing, Math.atan2(vx, vz), dt * 8);
          this.world.collision.move(n.pos, vx * dt, vz * dt, 0.3);
        }
        n.pos.y += (this.world.heightAt(n.pos.x, n.pos.z) - n.pos.y) * Math.min(1, dt * 12);
        // Separación entre NPC
        for (const o of this.npcs) {
          if (o === n || o.state === 'muerto') continue;
          const dx = n.pos.x - o.pos.x, dz = n.pos.z - o.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.6 && d > 1e-4) { n.pos.x += (dx / d) * (0.6 - d) * 0.5; n.pos.z += (dz / d) * (0.6 - d) * 0.5; }
        }
        // Animación (los golpes de un solo disparo terminan antes de volver al ciclo)
        const oneShot = ['punchR', 'punchL', 'hookR', 'hit', 'wave'].includes(n.avatar.currentName) && !n.avatar.finished;
        if (!oneShot) n.avatar.play(anim);
        n.avatar.setGaitSpeed(animSpeed);
      }
      // Joan y los NPC no se atraviesan: se empujan mutuamente (el NPC cede más)
      if (n.state !== 'muerto' && !player.dead && dP < 0.62 && dP > 1e-4) {
        const push = 0.62 - dP;
        n.pos.x -= (toP.x / dP) * push * 0.7; n.pos.z -= (toP.z / dP) * push * 0.7;
        player.pos.x += (toP.x / dP) * push * 0.3; player.pos.z += (toP.z / dP) * push * 0.3;
        this.world.collision.resolve(n.pos, 0.3);
      }
      n.avatar.object.position.copy(n.pos);
      n.avatar.object.rotation.y = n.facing;
      n.avatar.mesh.castShadow = dP < 32;
      if (dP < 70) n.avatar.update(dt); // fuera de rango la animación se congela (ahorro)
    }
  }

  /** Vuelve a la acera más cercana tras huir o pelear. */
  private repath(n: Npc): void {
    let best = this.walkPaths[0]!, bi = 0, bd = Infinity;
    for (const wp of this.walkPaths) for (let i = 0; i < wp.pts.length; i += 2) {
      const d = Math.hypot(wp.pts[i]!.x - n.pos.x, wp.pts[i]!.z - n.pos.z);
      if (d < bd) { bd = d; best = wp; bi = i; }
    }
    n.path = best.pts; n.pi = bi; n.road = best.road;
  }

  /** NPC vivo más cercano dentro de un radio (para saludar con E). */
  nearest(p: THREE.Vector3, r: number): Npc | null {
    let best: Npc | null = null, bd = r;
    for (const n of this.npcs) { if (n.state === 'muerto') continue; const d = n.pos.distanceTo(p); if (d < bd) { bd = d; best = n; } }
    return best;
  }

  greet(n: Npc, from: THREE.Vector3): void {
    n.state = 'saludar'; n.timer = 1.6; n.greeted = true;
    n.facing = Math.atan2(from.x - n.pos.x, from.z - n.pos.z);
    n.avatar.play('wave', 0.2, true);
  }

  positions(): { x: number; z: number; color: string }[] {
    return this.npcs.filter((n) => n.state === 'pelear' || n.state === 'acechar' || (n.kind === 'ladron' && n.stolen > 0))
      .map((n) => ({ x: n.pos.x, z: n.pos.z, color: '#ff3030' }));
  }
}

function turn(a: number, target: number, k: number): number {
  let d = target - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * Math.min(1, k);
}
