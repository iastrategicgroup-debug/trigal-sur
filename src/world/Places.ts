import * as THREE from 'three';
import type { V2 } from '../map/osm';
import { centroid } from '../map/osm';
import type { CityWorld } from './CityWorld';
import { GeoBank, type GeoBuilder } from './GeoBuilder';
import * as T from './textures';
import { Avatar } from '../character/Avatar';
import { npcParams, type Archetype } from '../character/archetypes';

export type InteriorKind = 'casa' | 'tienda' | 'gym';
export interface MenuItem { name: string; price: number; heal: number; stamina: number }
export type Action =
  | { type: 'entrar'; kind: InteriorKind; seed: number; back: V2; label: string }
  | { type: 'salir'; label: string }
  | { type: 'comprar'; title: string; items: MenuItem[]; label: string }
  | { type: 'pesas' | 'trotadora'; p: V2; facing: number; label: string };

interface Station { p: V2; r: number; action: Action }
interface NpcSlot { p: V2; facing: number; anim: string; kind: Archetype }
interface Room { kind: InteriorKind; spawn: V2; facing: number; stations: Station[]; slots: NpcSlot[]; greeting: string[] }

const STORE_MENU: MenuItem[] = [
  { name: 'Arepa de queso', price: 5, heal: 30, stamina: 20 },
  { name: 'Malta bien fría', price: 3, heal: 10, stamina: 45 },
  { name: 'Empanada de carne', price: 4, heal: 25, stamina: 15 },
];
const TRUCKS: { name: string; items: MenuItem[] }[] = [
  { name: 'AREPERA LA ESQUINA', items: [{ name: 'Arepa reina pepiada', price: 7, heal: 40, stamina: 25 }, { name: 'Arepa de pabellón', price: 8, heal: 50, stamina: 25 }, { name: 'Jugo de parchita', price: 3, heal: 10, stamina: 40 }] },
  { name: 'PERROS EL GOCHO', items: [{ name: 'Perro caliente', price: 4, heal: 25, stamina: 15 }, { name: 'Perro con todo', price: 6, heal: 40, stamina: 15 }, { name: 'Refresco', price: 2, heal: 5, stamina: 35 }] },
  { name: 'HAMBURGUESAS TRIGAL', items: [{ name: 'Hamburguesa sencilla', price: 6, heal: 40, stamina: 20 }, { name: 'Hamburguesa doble', price: 9, heal: 65, stamina: 20 }, { name: 'Papas fritas', price: 3, heal: 15, stamina: 10 }] },
];

const ROOM_ORIGIN: Record<InteriorKind, V2> = { casa: { x: 3000, z: 3000 }, tienda: { x: 3100, z: 3000 }, gym: { x: 3200, z: 3000 } };

/**
 * Lugares en los que se puede entrar (estilo de la época: cada puerta lleva a un interior aparte, fuera del mapa),
 * camiones de comida y estaciones del gimnasio.
 */
export class Places {
  readonly group = new THREE.Group();
  private outdoor: Station[] = [];
  private rooms = new Map<InteriorKind, Room>();
  private markerMat: THREE.MeshBasicMaterial;
  private inside: Room | null = null;
  private avatars: Avatar[] = [];
  insideKind: InteriorKind | null = null;
  readonly gymDoor: V2 | null;

  constructor(private world: CityWorld) {
    const col = world.collision;
    // ---------- Marcadores de entrada (anillo + haz de luz amarillos) ----------
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const entries = world.entries;
    for (const e of entries) {
      this.outdoor.push({ p: e.p, r: 1.1, action: { type: 'entrar', kind: e.kind, seed: e.seed, back: e.p, label: e.kind === 'casa' ? 'E: Entrar a la casa' : 'E: Entrar al abasto' } });
    }
    // Gimnasio Olimpus (nodo de OSM)
    const gymPoi = world.map.pois.find((p) => /olimpus/i.test(p.name));
    this.gymDoor = gymPoi ? this.freeSpot(gymPoi.p, 2, 25) : null;
    if (this.gymDoor) this.outdoor.push({ p: this.gymDoor, r: 1.2, action: { type: 'entrar', kind: 'gym', seed: 7, back: this.gymDoor, label: 'E: Entrar al Gimnasio Olimpus' } });

    // ---------- Camiones de comida ----------
    const bank = new GeoBank();
    const spots = world.places.filter((p) => /Plaza|C\.C\./i.test(p.name)).slice(0, 3);
    spots.forEach((pl, i) => {
      const spot = this.freeSpot(pl.p, 8, 45, 3.2);
      if (!spot) return;
      const t = TRUCKS[i % TRUCKS.length]!;
      const ang = Math.atan2(spot.x - pl.p.x, spot.z - pl.p.z); // ventana hacia el centro de la plaza
      this.buildTruck(bank, spot, ang + Math.PI / 2, i);
      const fx = -Math.sin(ang), fz = -Math.cos(ang);
      const st = { x: spot.x + fx * 2.1, z: spot.z + fz * 2.1 };
      this.outdoor.push({ p: st, r: 1.3, action: { type: 'comprar', title: t.name, items: t.items, label: `E: Comprar en ${t.name.toLowerCase()}` } });
      const c = Math.cos(ang + Math.PI / 2), s = Math.sin(ang + Math.PI / 2);
      const P = (a: number, b: number) => ({ x: spot.x + a * c - b * s, z: spot.z + a * s + b * c });
      col.addPolygon([P(-2.7, -1.15), P(2.7, -1.15), P(2.7, 1.15), P(-2.7, 1.15)]);
    });

    const markers = this.outdoor.map((s) => s.p);
    const ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2), this.markerMat, Math.max(1, markers.length));
    const beamMat = this.markerMat.clone(); beamMat.opacity = 0.18;
    const beam = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 16, 1, true).translate(0, 0.8, 0), beamMat, Math.max(1, markers.length));
    const M = new THREE.Matrix4();
    markers.forEach((p, i) => { M.makeTranslation(p.x, world.heightAt(p.x, p.z) + 0.03, p.z); ring.setMatrixAt(i, M); beam.setMatrixAt(i, M); });
    ring.count = beam.count = markers.length;
    ring.computeBoundingSphere(); beam.computeBoundingSphere();
    ring.renderOrder = beam.renderOrder = 5;
    this.group.add(ring, beam);

    // ---------- Interiores ----------
    const ib = new GeoBank();
    this.rooms.set('casa', this.buildCasa(ib));
    this.rooms.set('tienda', this.buildTienda(ib));
    this.rooms.set('gym', this.buildGym(ib));
    for (const m of this.meshes(bank, false)) this.group.add(m);
    for (const m of this.meshes(ib, true)) this.group.add(m);
  }

  /** Punto libre (fuera de calzadas y edificios) cerca de `c`. */
  private freeSpot(c: V2, rMin: number, rMax: number, clear = 0.8): V2 | null {
    for (let k = 0; k < 200; k++) {
      const a = k * 2.399, r = rMin + ((rMax - rMin) * k) / 200;
      const p = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
      if (this.world.map.onCarriageway(p.x, p.z, clear)) continue;
      const q = { ...p };
      if (this.world.collision.resolve(q, clear)) continue;
      return p;
    }
    return null;
  }

  private meshes(bank: GeoBank, indoor: boolean): THREE.Mesh[] {
    const mats: Record<string, THREE.Material> = {};
    const L = (map: THREE.Texture | null, side: THREE.Side = THREE.DoubleSide) => new THREE.MeshLambertMaterial({ vertexColors: true, map, side, emissive: new THREE.Color(indoor ? 0x4a4540 : 0x000000), emissiveMap: indoor ? map : null });
    return bank.entries().map(([key, b]) => {
      const mat = mats[key] ??= key === 'floor' ? L(T.floorTiles(), THREE.FrontSide) : key === 'gymfloor' ? L(T.rubber(), THREE.FrontSide)
        : key === 'wall' ? L(T.stucco('#dcd8d0'), THREE.FrontSide) : key === 'ceil' ? L(null, THREE.FrontSide)
        : key === 'shelf' ? L(T.storefront()) : key === 'glow' ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
        : key === 'truckSign' ? L(truckSigns()) : key === 'truckWin' ? L(T.storefront()) : L(null);
      const m = new THREE.Mesh(b.build(), mat);
      m.castShadow = !indoor; m.receiveShadow = !indoor;
      return m;
    });
  }

  // ---------- Construcción de interiores ----------
  private shell(bank: GeoBank, o: V2, w: number, d: number, h: number, wallC: string, floorKey: string): void {
    const col = this.world.collision;
    const c = new THREE.Color(wallC), dark = c.clone().multiplyScalar(0.75);
    const A = { x: o.x - w, z: o.z - d }, B = { x: o.x + w, z: o.z - d }, C = { x: o.x + w, z: o.z + d }, D = { x: o.x - w, z: o.z + d };
    const wall = bank.get('wall');
    for (const [p, q] of [[A, B], [B, C], [C, D], [D, A]] as const) wall.wall(p.x, p.z, q.x, q.z, 0, h, 3, dark, c);
    // zócalo de cerámica
    for (const [p, q] of [[A, B], [B, C], [C, D], [D, A]] as const) {
      const nx = -(q.z - p.z), nz = q.x - p.x, l = Math.hypot(nx, nz);
      wall.wall(p.x + (nx / l) * 0.01, p.z + (nz / l) * 0.01, q.x + (nx / l) * 0.01, q.z + (nz / l) * 0.01, 0, 0.12, 3, new THREE.Color(0x6a5a48));
    }
    const f = bank.get(floorKey);
    f.quad(new THREE.Vector3(A.x, 0.005, A.z), new THREE.Vector3(D.x, 0.005, D.z), new THREE.Vector3(C.x, 0.005, C.z), new THREE.Vector3(B.x, 0.005, B.z), [0, 0, (2 * d) / 2, (2 * w) / 2], new THREE.Color(1, 1, 1));
    bank.get('ceil').quad(new THREE.Vector3(A.x, h, A.z), new THREE.Vector3(B.x, h, B.z), new THREE.Vector3(C.x, h, C.z), new THREE.Vector3(D.x, h, D.z), [0, 0, 1, 1], new THREE.Color(0xf2eee6));
    // Lámparas en el techo
    const glow = bank.get('glow');
    for (let x = -w + 2.5; x < w - 1; x += 4) for (let z = -d + 2.5; z < d - 1; z += 4) glow.box(o.x + x, o.z + z, h - 0.06, h - 0.01, 0.5, 0.12, 0, 1, new THREE.Color(0xfff6e0), false);
    // Puerta de salida (pintada en la pared frontal)
    glow.quad(new THREE.Vector3(o.x - 0.55, 0, o.z + d - 0.02), new THREE.Vector3(o.x + 0.55, 0, o.z + d - 0.02), new THREE.Vector3(o.x + 0.55, 2.1, o.z + d - 0.02), new THREE.Vector3(o.x - 0.55, 2.1, o.z + d - 0.02), [0, 0, 1, 1], new THREE.Color(0x5a3a22));
    const t = 0.3;
    col.addPolygon([{ x: A.x - t, z: A.z - t }, { x: B.x + t, z: B.z - t }, { x: B.x + t, z: B.z }, { x: A.x - t, z: A.z }]);
    col.addPolygon([{ x: B.x, z: B.z - t }, { x: B.x + t, z: B.z - t }, { x: C.x + t, z: C.z + t }, { x: C.x, z: C.z + t }]);
    col.addPolygon([{ x: D.x - t, z: D.z }, { x: C.x + t, z: C.z }, { x: C.x + t, z: C.z + t }, { x: D.x - t, z: D.z + t }]);
    col.addPolygon([{ x: A.x - t, z: A.z - t }, { x: A.x, z: A.z - t }, { x: D.x, z: D.z + t }, { x: D.x - t, z: D.z + t }]);
  }

  /** Caja de mueble con colisión opcional. */
  private furn(b: GeoBuilder, o: V2, x: number, z: number, y0: number, y1: number, hw: number, hd: number, color: number, solid = true): void {
    b.box(o.x + x, o.z + z, y0, y1, hw, hd, 0, 1, new THREE.Color(color));
    if (solid) this.world.collision.addPolygon([{ x: o.x + x - hw, z: o.z + z - hd }, { x: o.x + x + hw, z: o.z + z - hd }, { x: o.x + x + hw, z: o.z + z + hd }, { x: o.x + x - hw, z: o.z + z + hd }]);
  }

  private exitStation(o: V2, d: number): Station {
    return { p: { x: o.x, z: o.z + d - 0.7 }, r: 1.0, action: { type: 'salir', label: 'E: Salir' } };
  }

  private buildCasa(bank: GeoBank): Room {
    const o = ROOM_ORIGIN.casa, w = 5, d = 4;
    this.shell(bank, o, w, d, 2.8, '#e8dcc4', 'floor');
    const F = bank.get('furn');
    // Sala: sofá, mesa de centro, alfombra, TV
    this.furn(F, o, -4.0, -0.5, 0, 0.45, 0.45, 1.5, 0x6a3a28);
    this.furn(F, o, -4.45, -0.5, 0, 0.95, 0.1, 1.5, 0x5a3020, false);
    for (const z of [-2.05, 1.05]) this.furn(F, o, -4.0, z, 0, 0.62, 0.5, 0.1, 0x5a3020, false);
    this.furn(F, o, -2.9, -0.5, 0, 0.42, 0.4, 0.6, 0x7a5a38);
    F.quad(new THREE.Vector3(o.x - 3.9, 0.01, o.z - 2), new THREE.Vector3(o.x - 3.9, 0.01, o.z + 1), new THREE.Vector3(o.x - 1.7, 0.01, o.z + 1), new THREE.Vector3(o.x - 1.7, 0.01, o.z - 2), [0, 0, 1, 1], new THREE.Color(0x8a2a2a));
    this.furn(F, o, -1.3, -0.5, 0, 0.55, 0.22, 0.8, 0x3a2a1e);
    this.furn(F, o, -1.25, -0.5, 0.55, 1.25, 0.04, 0.65, 0x111111, false);
    bank.get('glow').quad(new THREE.Vector3(o.x - 1.3, 0.6, o.z + 0.1), new THREE.Vector3(o.x - 1.3, 0.6, o.z - 1.1), new THREE.Vector3(o.x - 1.3, 1.2, o.z - 1.1), new THREE.Vector3(o.x - 1.3, 1.2, o.z + 0.1), [0, 0, 1, 1], new THREE.Color(0x6aa0d8));
    // Cocina: tope, cocina, nevera; comedor
    this.furn(F, o, 2.4, -3.65, 0, 0.9, 2.2, 0.3, 0xe8e4da);
    this.furn(F, o, 2.4, -3.65, 0.9, 0.94, 2.25, 0.32, 0x3a3a3a, false);
    this.furn(F, o, 1.0, -3.6, 0.94, 0.98, 0.32, 0.25, 0x111111, false);
    this.furn(F, o, 4.55, -3.45, 0, 1.85, 0.4, 0.4, 0xf2f2f2);
    this.furn(F, o, 2.6, -0.4, 0.72, 0.77, 0.9, 0.6, 0x8a6a48);
    for (const [x, z] of [[1.8, -0.9], [3.4, -0.9], [1.8, 0.1], [3.4, 0.1]] as const) this.furn(F, o, x, z, 0, 0.72, 0.06, 0.06, 0x6a4a30, false);
    this.world.collision.addPolygon([{ x: o.x + 1.7, z: o.z - 1 }, { x: o.x + 3.5, z: o.z - 1 }, { x: o.x + 3.5, z: o.z + 0.2 }, { x: o.x + 1.7, z: o.z + 0.2 }]);
    for (const [x, z] of [[1.4, -0.4], [3.8, -0.4]] as const) this.furn(F, o, x, z, 0, 0.45, 0.22, 0.22, 0x7a5a38, false);
    // Cuadros
    const G = bank.get('glow');
    for (const [x, c] of [[-2.5, 0x3a6a8a], [-0.5, 0xc8a050], [1.5, 0x6a8a4a]] as const) G.quad(new THREE.Vector3(o.x + x - 0.4, 1.4, o.z - d + 0.03), new THREE.Vector3(o.x + x + 0.4, 1.4, o.z - d + 0.03), new THREE.Vector3(o.x + x + 0.4, 2.0, o.z - d + 0.03), new THREE.Vector3(o.x + x - 0.4, 2.0, o.z - d + 0.03), [0, 0, 1, 1], new THREE.Color(c));
    return {
      kind: 'casa', spawn: { x: o.x, z: o.z + d - 1.3 }, facing: Math.PI,
      stations: [this.exitStation(o, d)],
      slots: [
        { p: { x: o.x - 3.95, z: o.z - 0.9 }, facing: Math.PI / 2, anim: 'sit', kind: 'senora' },
        { p: { x: o.x - 3.95, z: o.z + 0.1 }, facing: Math.PI / 2, anim: 'sit', kind: 'hombre' },
        { p: { x: o.x + 2.2, z: o.z - 2.9 }, facing: Math.PI, anim: 'idle', kind: 'mujer' },
        { p: { x: o.x + 4.0, z: o.z + 2.2 }, facing: -Math.PI / 2, anim: 'lookAround', kind: 'anciano' },
      ],
      greeting: ['<b>¡Epa! ¿Y usted quién es?</b>Pase adelante, pero se limpia los zapatos', '<b>¡Ay, qué susto!</b>¿Vino por lo del gas?', '<b>Buenas tardes</b>Siéntase como en su casa… pero no mucho'],
    };
  }

  private buildTienda(bank: GeoBank): Room {
    const o = ROOM_ORIGIN.tienda, w = 6, d = 4.5;
    this.shell(bank, o, w, d, 3.0, '#f0ece0', 'floor');
    const F = bank.get('furn'), Sh = bank.get('shelf');
    for (const z of [-3.6, -1.4]) {
      Sh.box(o.x - 2, o.z + z, 0, 1.8, 2.8, 0.35, 0, 3, new THREE.Color(1, 1, 1));
      this.world.collision.addPolygon([{ x: o.x - 4.8, z: o.z + z - 0.35 }, { x: o.x + 0.8, z: o.z + z - 0.35 }, { x: o.x + 0.8, z: o.z + z + 0.35 }, { x: o.x - 4.8, z: o.z + z + 0.35 }]);
    }
    Sh.box(o.x - 5.6, o.z - 0.5, 0, 2.0, 0.35, 2.0, 0, 3, new THREE.Color(0xa8c8e8));
    this.world.collision.addPolygon([{ x: o.x - 6, z: o.z - 2.5 }, { x: o.x - 5.25, z: o.z - 2.5 }, { x: o.x - 5.25, z: o.z + 1.5 }, { x: o.x - 6, z: o.z + 1.5 }]);
    this.furn(F, o, 3.5, 2.2, 0, 1.0, 1.6, 0.4, 0x8a5a30);
    this.furn(F, o, 3.5, 2.2, 1.0, 1.04, 1.65, 0.45, 0xd8d0c0, false);
    this.furn(F, o, 3.0, 2.2, 1.04, 1.3, 0.22, 0.18, 0x2a2a2a, false);
    return {
      kind: 'tienda', spawn: { x: o.x, z: o.z + d - 1.3 }, facing: Math.PI,
      stations: [this.exitStation(o, d), { p: { x: o.x + 3.5, z: o.z + 3.1 }, r: 1.1, action: { type: 'comprar', title: 'ABASTO', items: STORE_MENU, label: 'E: Comprar' } }],
      slots: [
        { p: { x: o.x + 3.5, z: o.z + 1.35 }, facing: 0, anim: 'idle', kind: 'senora' },
        { p: { x: o.x - 2.0, z: o.z - 0.5 }, facing: Math.PI, anim: 'lookAround', kind: 'mujer' },
      ],
      greeting: ['<b>¡Buenas, mi amor!</b>¿Qué va a llevar?', '<b>Bienvenido</b>Hoy llegó la harina'],
    };
  }

  private buildGym(bank: GeoBank): Room {
    const o = ROOM_ORIGIN.gym, w = 8, d = 6;
    this.shell(bank, o, w, d, 3.6, '#d8dce0', 'gymfloor');
    const F = bank.get('furn'), G = bank.get('glow');
    // Espejo en la pared del fondo
    G.quad(new THREE.Vector3(o.x - 7.5, 0.3, o.z - d + 0.03), new THREE.Vector3(o.x + 2, 0.3, o.z - d + 0.03), new THREE.Vector3(o.x + 2, 2.5, o.z - d + 0.03), new THREE.Vector3(o.x - 7.5, 2.5, o.z - d + 0.03), [0, 0, 1, 1], new THREE.Color(0x9ab8c8));
    // Rack de mancuernas
    this.furn(F, o, -3.5, -5.55, 0, 0.8, 3.8, 0.3, 0x2a2a2a);
    for (let x = -7; x <= 0; x += 0.5) F.box(o.x + x, o.z - 5.5, 0.82, 0.95, 0.15, 0.08, 0, 1, new THREE.Color(0x111111));
    // Bancos con barra
    for (const x of [-5, -1.5]) {
      this.furn(F, o, x, 0.5, 0, 0.45, 0.2, 0.8, 0x1a1a1a);
      F.box(o.x + x, o.z - 0.25, 1.05, 1.09, 0.9, 0.02, 0, 1, new THREE.Color(0x9a9a9a));
      for (const s of [-0.75, 0.75]) F.box(o.x + x + s, o.z - 0.25, 0.85, 1.29, 0.04, 0.22, 0, 1, new THREE.Color(0x111111));
    }
    // Trotadoras
    for (const x of [4, 6.2]) {
      F.box(o.x + x, o.z - 4, 0, 0.12, 0.4, 0.95, 0, 1, new THREE.Color(0x222222));
      this.furn(F, o, x, -4.95, 0, 1.35, 0.4, 0.05, 0x333333);
    }
    // Saco de boxeo
    this.furn(F, o, 6, 3, 0.4, 1.6, 0.25, 0.25, 0x8a1a1a);
    F.box(o.x + 6, o.z + 3, 1.6, 3.6, 0.02, 0.02, 0, 1, new THREE.Color(0x777777));
    const pesas = (x: number): Station => ({ p: { x: o.x + x, z: o.z - 4.4 }, r: 0.9, action: { type: 'pesas', p: { x: o.x + x, z: o.z - 4.4 }, facing: Math.PI, label: 'E: Levantar pesas' } });
    return {
      kind: 'gym', spawn: { x: o.x, z: o.z + d - 1.3 }, facing: Math.PI,
      stations: [this.exitStation(o, d), pesas(-5.5), pesas(-3.5), pesas(-1.5),
        { p: { x: o.x + 4, z: o.z - 3.9 }, r: 0.9, action: { type: 'trotadora', p: { x: o.x + 4, z: o.z - 3.9 }, facing: Math.PI, label: 'E: Usar la trotadora' } }],
      slots: [
        { p: { x: o.x + 0.5, z: o.z - 4.4 }, facing: Math.PI, anim: 'lift', kind: 'deportista' },
        { p: { x: o.x + 6.2, z: o.z - 3.9 }, facing: Math.PI, anim: 'jog', kind: 'deportista' },
        { p: { x: o.x + 5.2, z: o.z + 3 }, facing: Math.PI / 2, anim: 'guard', kind: 'hombre' },
      ],
      greeting: ['<b>Gimnasio Olimpus</b>Sin dolor no hay ganancia, mi pana', '<b>¡Epa, campeón!</b>Las pesas están libres'],
    };
  }

  private buildTruck(bank: GeoBank, p: V2, ang: number, idx: number): void {
    const F = bank.get('furn');
    const colors = [0xd84a2a, 0xf0c030, 0x2a6ab0];
    const body = new THREE.Color(colors[idx % 3]!);
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = (a: number, b: number, y: number) => new THREE.Vector3(p.x + a * c - b * s, y, p.z + a * s + b * c);
    F.box(p.x, p.z, 0.55, 2.9, 2.2, 1.1, ang, 1, body);                                       // caja
    F.box(p.x + 2.75 * c, p.z + 2.75 * s, 0.55, 2.0, 0.6, 1.05, ang, 1, body.clone().multiplyScalar(0.85)); // cabina
    for (const a of [-1.5, 1.6]) for (const b of [-1.05, 1.05]) F.box(p.x + a * c - b * s, p.z + a * s + b * c, 0, 0.62, 0.32, 0.12, ang, 1, new THREE.Color(0x151515));
    // Ventana de servicio y toldo (lado b = -1.1)
    const win = bank.get('truckWin');
    win.quad(P(-1.4, -1.12, 1.3), P(1.4, -1.12, 1.3), P(1.4, -1.12, 2.3), P(-1.4, -1.12, 2.3), [0, 0, 1, 1], new THREE.Color(1, 1, 1));
    F.quad(P(-1.7, -1.12, 2.55), P(1.7, -1.12, 2.55), P(1.7, -2.2, 2.25), P(-1.7, -2.2, 2.25), [0, 0, 1, 1], new THREE.Color(0xf0f0e8));
    F.box(p.x - 1.25 * s, p.z + 1.25 * c, 1.15, 1.22, 1.5, 0.15, ang, 1, new THREE.Color(0xc8c8c8));
    const sign = bank.get('truckSign');
    const v0 = 1 - (idx % 3 + 1) / 3, v1 = 1 - (idx % 3) / 3;
    sign.quad(P(-2.1, -1.13, 2.4), P(2.1, -1.13, 2.4), P(2.1, -1.13, 2.88), P(-2.1, -1.13, 2.88), [0, v0, 1, v1], new THREE.Color(1, 1, 1));
  }

  // ---------- Interacción ----------
  nearestAction(pos: THREE.Vector3): Action | null {
    const list = this.inside ? this.inside.stations : this.outdoor;
    let best: Station | null = null, bd = Infinity;
    for (const s of list) {
      const d = Math.hypot(s.p.x - pos.x, s.p.z - pos.z);
      if (d < s.r && d < bd) { bd = d; best = s; }
    }
    return best?.action ?? null;
  }

  /** Entra a un interior; devuelve dónde aparece Joan y un saludo de los habitantes. */
  enter(kind: InteriorKind, seed: number): { spawn: V2; facing: number; greeting: string } {
    const room = this.rooms.get(kind)!;
    this.inside = room; this.insideKind = kind;
    let r = seed || 1;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const n = kind === 'casa' ? 2 + Math.floor(rnd() * 3) : room.slots.length;
    for (const slot of room.slots.slice(0, n)) {
      const a = new Avatar(npcParams(slot.kind, Math.floor(rnd() * 1e9)));
      a.object.position.set(slot.p.x, 0, slot.p.z);
      a.object.rotation.y = slot.facing;
      a.play(slot.anim, 0);
      this.group.add(a.object);
      this.avatars.push(a);
    }
    return { spawn: room.spawn, facing: room.facing, greeting: room.greeting[Math.floor(rnd() * room.greeting.length)]! };
  }

  exit(): void {
    for (const a of this.avatars) { this.group.remove(a.object); a.dispose(); }
    this.avatars = [];
    this.inside = null; this.insideKind = null;
  }

  update(dt: number, t: number): void {
    this.markerMat.opacity = 0.55 + Math.sin(t * 4) * 0.2;
    for (const a of this.avatars) a.update(dt);
  }

  /** Marcadores para el minimapa (gimnasio y camiones). */
  mapMarkers(): import('../ui/Minimap').MapMarker[] {
    const out: import('../ui/Minimap').MapMarker[] = [];
    for (const s of this.outdoor) {
      const a = s.action;
      if (a.type === 'comprar') out.push({ x: s.p.x, z: s.p.z, color: '#f0b020', icon: 'comida', label: a.title });
      else if (a.type === 'entrar' && a.kind === 'gym') out.push({ x: s.p.x, z: s.p.z, color: '#e05020', icon: 'gym', label: 'Gimnasio Olimpus' });
      else if (a.type === 'entrar' && a.kind === 'tienda') out.push({ x: s.p.x, z: s.p.z, color: '#40a050', icon: 'abasto' });
    }
    return out;
  }
}

let signs: THREE.CanvasTexture | null = null;
function truckSigns(): THREE.CanvasTexture {
  if (signs) return signs;
  const c = document.createElement('canvas'); c.width = 512; c.height = 192;
  const g = c.getContext('2d')!;
  const bgs = ['#f8f0d8', '#202020', '#f8f0d8'], fgs = ['#c02020', '#f0c030', '#2050a0'];
  TRUCKS.forEach((t, i) => {
    g.fillStyle = bgs[i]!; g.fillRect(0, i * 64, 512, 64);
    g.fillStyle = fgs[i]!; g.font = 'bold 40px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t.name, 256, i * 64 + 33, 490);
  });
  signs = new THREE.CanvasTexture(c); signs.colorSpace = THREE.SRGBColorSpace;
  return signs;
}

export { centroid };
