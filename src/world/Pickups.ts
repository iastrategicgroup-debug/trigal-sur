import * as THREE from 'three';

export type PickupKind = 'dinero' | 'salud' | 'escudo';
interface Pickup { kind: PickupKind; amount: number; x: number; y: number; z: number; t: number; ttl: number; mesh: THREE.Object3D }

const COLORS: Record<PickupKind, number> = { dinero: 0x4ad060, salud: 0xff4a4a, escudo: 0x4aa8ff };

/**
 * Objetos que flotan, giran y brillan; se recogen al pasar cerca.
 * Los NPC derrotados los sueltan (sin sangre).
 */
export class Pickups {
  readonly group = new THREE.Group();
  private items: Pickup[] = [];
  private geos: Record<PickupKind, THREE.BufferGeometry>;
  private mats: Record<PickupKind, THREE.Material>;
  private glowMat: Record<PickupKind, THREE.SpriteMaterial>;

  constructor() {
    // Fajo de billetes, botiquín con cruz, escudo (placa)
    const money = new THREE.BoxGeometry(0.42, 0.12, 0.22);
    const kit = new THREE.BoxGeometry(0.4, 0.3, 0.18);
    const shield = new THREE.CylinderGeometry(0.25, 0.25, 0.08, 6).rotateX(Math.PI / 2);
    this.geos = { dinero: money, salud: kit, escudo: shield };
    this.mats = {
      dinero: new THREE.MeshLambertMaterial({ map: billTex(), emissive: 0x103010 }),
      salud: new THREE.MeshLambertMaterial({ map: kitTex(), emissive: 0x301010 }),
      escudo: new THREE.MeshLambertMaterial({ color: 0x3a8ae0, emissive: 0x0a2a5a }),
    };
    const glow = glowTex();
    this.glowMat = {
      dinero: new THREE.SpriteMaterial({ map: glow, color: COLORS.dinero, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      salud: new THREE.SpriteMaterial({ map: glow, color: COLORS.salud, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      escudo: new THREE.SpriteMaterial({ map: glow, color: COLORS.escudo, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    };
  }

  /** Si se define, reubica cada objeto fuera de muros y edificios (para que siempre se pueda recoger). */
  resolver: ((p: { x: number; z: number }) => void) | null = null;

  spawn(kind: PickupKind, amount: number, x: number, y: number, z: number, ttl = Infinity): void {
    if (this.resolver) { const q = { x, z }; this.resolver(q); x = q.x; z = q.z; }
    const o = new THREE.Group();
    const m = new THREE.Mesh(this.geos[kind], this.mats[kind]);
    m.castShadow = true;
    const s = new THREE.Sprite(this.glowMat[kind]);
    s.scale.setScalar(1.3);
    o.add(m, s);
    o.position.set(x, y, z);
    this.group.add(o);
    this.items.push({ kind, amount, x, y, z, t: Math.random() * 6, ttl, mesh: o });
  }

  /** Lo que suelta un NPC al caer: siempre dinero; a veces salud o escudo. Se esparcen un poco. */
  drop(x: number, y: number, z: number, rnd: () => number = Math.random): void {
    const spread = () => (rnd() - 0.5) * 1.6;
    this.spawn('dinero', 10 + Math.floor(rnd() * 90), x + spread(), y, z + spread(), 60);
    if (rnd() < 0.3) this.spawn('salud', 25, x + spread(), y, z + spread(), 60);
    if (rnd() < 0.15) this.spawn('escudo', 50, x + spread(), y, z + spread(), 60);
  }

  /** Avanza la animación y devuelve lo recogido por el jugador. */
  update(dt: number, px: number, py: number, pz: number, canCollect: (k: PickupKind) => boolean): { kind: PickupKind; amount: number }[] {
    const got: { kind: PickupKind; amount: number }[] = [];
    this.items = this.items.filter((it) => {
      it.t += dt; it.ttl -= dt;
      it.mesh.position.y = it.y + 0.7 + Math.sin(it.t * 2.5) * 0.15;
      it.mesh.children[0]!.rotation.y = it.t * 2;
      const blink = it.ttl < 8 ? (Math.sin(it.t * 12) > 0 ? 1 : 0.2) : 1;
      (it.mesh.children[1] as THREE.Sprite).material.opacity = 0.7 * blink;
      const near = Math.hypot(it.x - px, it.z - pz) < 1.1 && Math.abs(it.y - py) < 1.5;
      if ((near && canCollect(it.kind)) || it.ttl <= 0) {
        this.group.remove(it.mesh);
        if (near) got.push({ kind: it.kind, amount: it.amount });
        return false;
      }
      return true;
    });
    return got;
  }

  get count(): number { return this.items.length; }
  positions(): { x: number; z: number; color: string }[] {
    return this.items.map((i) => ({ x: i.x, z: i.z, color: '#' + COLORS[i.kind].toString(16).padStart(6, '0') }));
  }
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function billTex() {
  return canvasTex(64, 32, (g) => {
    g.fillStyle = '#5aa05a'; g.fillRect(0, 0, 64, 32);
    g.strokeStyle = '#2a5a2a'; g.lineWidth = 3; g.strokeRect(3, 3, 58, 26);
    g.fillStyle = '#2a5a2a'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 32, 17);
  });
}
function kitTex() {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#d02020'; g.fillRect(24, 10, 16, 44); g.fillRect(10, 24, 44, 16);
  });
}
function glowTex() {
  return canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
}
