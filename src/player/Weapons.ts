import * as THREE from 'three';

export type WeaponId = 'puños' | 'pistola' | 'escopeta' | 'ak';
export interface WeaponDef { id: WeaponId; name: string; dmg: number; pellets: number; spread: number; rate: number; auto: boolean; range: number; mag: number; reload: number }

export const WEAPONS: Record<Exclude<WeaponId, 'puños'>, WeaponDef> = {
  pistola: { id: 'pistola', name: 'Pistola', dmg: 34, pellets: 1, spread: 0.012, rate: 0.28, auto: false, range: 60, mag: 15, reload: 1.1 },
  escopeta: { id: 'escopeta', name: 'Escopeta', dmg: 22, pellets: 7, spread: 0.07, rate: 0.9, auto: false, range: 35, mag: 6, reload: 2.2 },
  ak: { id: 'ak', name: 'AK', dmg: 28, pellets: 1, spread: 0.025, rate: 0.1, auto: true, range: 90, mag: 30, reload: 1.8 },
};

const metal = new THREE.MeshLambertMaterial({ color: 0x1c1c1e });
const wood = new THREE.MeshLambertMaterial({ color: 0x6a3a18 });
const grey = new THREE.MeshLambertMaterial({ color: 0x3a3a3c });
const geoCache = new Map<string, THREE.BufferGeometry>();
/** Geometrías compartidas entre todas las armas (no se crean de nuevo por cada policía). */
const shared = (g: THREE.BufferGeometry): THREE.BufferGeometry => { const k = JSON.stringify((g as unknown as { parameters: unknown }).parameters) + g.type; const c = geoCache.get(k); if (c) { g.dispose(); return c; } geoCache.set(k, g); return g; };
const part = (g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => { const k = new THREE.Mesh(shared(geo), m); k.position.set(x, y, z); k.rotation.x = rx; g.add(k); };

/** Modelos (en la mano derecha: el cañón apunta a -Y local del hueso de la mano). Devuelven el grupo y la boca del cañón. */
export function gunModel(id: Exclude<WeaponId, 'puños'>): { group: THREE.Group; muzzle: THREE.Object3D } {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  if (id === 'pistola') {
    part(g, new THREE.BoxGeometry(0.03, 0.2, 0.045), metal, 0, -0.1, 0.02);       // corredera
    part(g, new THREE.BoxGeometry(0.028, 0.05, 0.11), grey, 0, 0.0, -0.025, -0.25); // empuñadura
    muzzle.position.set(0, -0.21, 0.02);
  } else if (id === 'escopeta') {
    part(g, new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8), metal, 0, -0.31, 0);
    part(g, new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8), metal, 0.036, -0.31, 0);
    part(g, new THREE.CylinderGeometry(0.028, 0.028, 0.18, 8), wood, 0.018, -0.36, 0.025);
    part(g, new THREE.BoxGeometry(0.06, 0.16, 0.07), metal, 0.018, 0.05, 0);
    part(g, new THREE.BoxGeometry(0.05, 0.32, 0.09), wood, 0.018, 0.26, -0.02, 0.2);
    muzzle.position.set(0.018, -0.63, 0);
  } else {
    part(g, new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8), metal, 0, -0.42, 0.02);   // cañón
    part(g, new THREE.BoxGeometry(0.045, 0.32, 0.07), metal, 0, -0.06, 0.01);            // cajón
    part(g, new THREE.BoxGeometry(0.04, 0.2, 0.05), wood, 0, -0.27, 0.035);              // guardamanos
    part(g, new THREE.BoxGeometry(0.035, 0.14, 0.06), grey, 0, -0.1, -0.08, 0.5);        // cargador curvo
    part(g, new THREE.BoxGeometry(0.035, 0.1, 0.06), grey, 0, -0.18, -0.13, 0.9);
    part(g, new THREE.BoxGeometry(0.04, 0.3, 0.08), wood, 0, 0.23, -0.01, 0.15);         // culata
    muzzle.position.set(0, -0.64, 0.02);
  }
  g.add(muzzle);
  g.position.set(0, -0.06, 0.02);
  return { group: g, muzzle };
}

/** Trazadoras y fogonazos (efectos de un instante). */
export class GunFx {
  readonly group = new THREE.Group();
  private items: { o: THREE.Object3D; t: number; life: number }[] = [];
  private lineMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9 });
  private flashMat = new THREE.SpriteMaterial({ color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  private hitMat = new THREE.SpriteMaterial({ color: 0xc8c0b0, transparent: true, depthWrite: false });

  tracer(a: THREE.Vector3, b: THREE.Vector3): void {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(g, this.lineMat); this.group.add(l); this.items.push({ o: l, t: 0, life: 0.05 });
  }
  flash(p: THREE.Vector3, size = 0.6): void {
    const s = new THREE.Sprite(this.flashMat); s.position.copy(p); s.scale.setScalar(size); this.group.add(s); this.items.push({ o: s, t: 0, life: 0.05 });
  }
  /** Polvo del impacto (sin sangre). */
  dust(p: THREE.Vector3): void {
    const s = new THREE.Sprite(this.hitMat); s.position.copy(p); s.scale.setScalar(0.35); this.group.add(s); this.items.push({ o: s, t: 0, life: 0.3 });
  }
  update(dt: number): void {
    this.items = this.items.filter((it) => {
      it.t += dt;
      if (it.o instanceof THREE.Sprite && it.life > 0.1) it.o.scale.multiplyScalar(1 + dt * 4);
      if (it.t > it.life) { this.group.remove(it.o); if (it.o instanceof THREE.Line) it.o.geometry.dispose(); return false; }
      return true;
    });
  }
}
