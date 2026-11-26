import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Modelos de vehículos por código (diseños genéricos, sin marcas): sedán, camioneta, patrulla, moto y helicóptero.
 * Cada vehículo = carrocería (una malla con colores por vértice) + ejes de ruedas que giran. Eje adelante = +Z.
 */
export type CarStyle = 'sedan' | 'hatch' | 'camioneta' | 'policia' | 'taxi';

function colored(g: THREE.BufferGeometry, c: THREE.Color | number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const col = new THREE.Color(c);
  const n = ng.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  ng.computeVertexNormals();
  return ng;
}

/** Silueta lateral (z adelante, y arriba) extruida a lo ancho y centrada. */
function profile(pts: [number, number][], width: number, bevel = 0.04): THREE.BufferGeometry {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // x del perfil -> z del mundo
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function wheels(x: number, r: number, w: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    parts.push(colored(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2).translate(s * x, 0, 0), 0x161616));
    parts.push(colored(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.01, 10).rotateZ(Math.PI / 2).translate(s * x, 0, 0), 0x9a9a9a));
  }
  return mergeGeometries(parts)!;
}

export interface VehicleModel { group: THREE.Group; body: THREE.Mesh; front: THREE.Object3D; rear: THREE.Object3D; rotor?: THREE.Object3D; tailRotor?: THREE.Object3D; siren?: THREE.Mesh; lights: THREE.Mesh }

const MAT = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: new THREE.Color(0x555555) });
const MAT_MATTE = new THREE.MeshLambertMaterial({ vertexColors: true });
export const LIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
const cache = new Map<string, THREE.BufferGeometry>();

function finish(body: THREE.BufferGeometry, lights: THREE.BufferGeometry, wheelX: number, r: number, ww: number, zf: number, zr: number, glossy = true): VehicleModel {
  const group = new THREE.Group();
  const bm = new THREE.Mesh(body, glossy ? MAT : MAT_MATTE); bm.castShadow = true;
  const lm = new THREE.Mesh(lights, LIGHT_MAT);
  const wg = cache.get(`w${wheelX}${r}${ww}`) ?? wheels(wheelX, r, ww); cache.set(`w${wheelX}${r}${ww}`, wg);
  const front = new THREE.Group(); front.position.set(0, r, zf); front.add(new THREE.Mesh(wg, MAT_MATTE));
  const rear = new THREE.Group(); rear.position.set(0, r, zr); rear.add(new THREE.Mesh(wg, MAT_MATTE));
  group.add(bm, lm, front, rear);
  return { group, body: bm, front, rear, lights: lm };
}

export function carModel(style: CarStyle, paint: string): VehicleModel {
  const key = `${style}|${paint}`;
  let body = cache.get(key), lights = cache.get(key + 'L');
  const tall = style === 'camioneta', short = style === 'hatch';
  const L = short ? 3.9 : tall ? 4.7 : 4.5, W = tall ? 1.9 : 1.76, hl = L / 2;
  if (!body || !lights) {
    const c = new THREE.Color(paint);
    const lift = tall ? 0.18 : 0;
    const lower: [number, number][] = [[-hl, 0.32 + lift], [-hl - 0.05, 0.62 + lift], [-hl + 0.08, 0.9 + lift], [-hl + 0.75, 0.96 + lift], [hl - 1.0, 0.92 + lift], [hl - 0.15, 0.76 + lift], [hl, 0.5 + lift], [hl - 0.05, 0.32 + lift]];
    const roofTop = (tall ? 1.78 : 1.42);
    const gh: [number, number][] = short || tall
      ? [[-hl + 0.12, 0.92 + lift], [-hl + 0.25, roofTop], [hl - 1.65, roofTop], [hl - 1.0, 0.94 + lift]]
      : [[-hl + 0.65, 0.93], [-hl + 1.05, roofTop], [hl - 1.95, roofTop], [hl - 1.1, 0.93]];
    const parts: THREE.BufferGeometry[] = [
      colored(profile(lower, W), c),
      colored(profile(gh, W - 0.16), 0x1c2228),                                   // vidrios
      colored(box(W - 0.14, 0.05, (gh[2]![0] - gh[1]![0]) + 0.05, 0, roofTop + 0.02, (gh[1]![0] + gh[2]![0]) / 2), c), // techo
      colored(box(W + 0.02, 0.16, 0.12, 0, 0.42 + lift, hl - 0.02), 0x2a2a2a),    // parachoques
      colored(box(W + 0.02, 0.16, 0.12, 0, 0.42 + lift, -hl + 0.02), 0x2a2a2a),
      colored(box(0.9, 0.14, 0.04, 0, 0.62 + lift, hl + 0.02), 0x101010),          // parrilla
      colored(box(W + 0.03, 0.06, L * 0.55, 0, 0.52 + lift, 0), c.clone().multiplyScalar(0.7)), // moldura lateral
    ];
    // Pilares (dan forma de cabina)
    for (const sx of [-1, 1]) parts.push(colored(box(0.06, roofTop - 0.95 - lift, 0.1, sx * (W / 2 - 0.1), (roofTop + 0.95 + lift) / 2, (gh[1]![0] + gh[2]![0]) / 2), c));
    if (style === 'policia') {
      parts.push(colored(box(W + 0.03, 0.3, 1.9, 0, 0.72, 0.1), 0x111111));      // puertas negras
      parts.push(colored(box(1.1, 0.12, 0.3, 0, roofTop + 0.1, (gh[1]![0] + gh[2]![0]) / 2), 0x202020)); // base de la sirena
    }
    if (style === 'taxi') parts.push(colored(box(0.5, 0.18, 0.2, 0, roofTop + 0.12, (gh[1]![0] + gh[2]![0]) / 2), 0xf0d020));
    body = mergeGeometries(parts)!;
    const lp: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      lp.push(colored(box(0.32, 0.13, 0.04, sx * (W / 2 - 0.28), 0.7 + lift, hl - 0.06), 0xfff6d8));  // faros
      lp.push(colored(box(0.3, 0.14, 0.04, sx * (W / 2 - 0.25), 0.78 + lift, -hl + 0.02), 0xc01010)); // stops
    }
    lights = mergeGeometries(lp)!;
    cache.set(key, body); cache.set(key + 'L', lights);
  }
  const m = finish(body, lights, W / 2 - 0.08, 0.33, 0.24, hl - 0.95, -hl + 0.85);
  if (style === 'policia') {
    const siren = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.24), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    siren.position.set(0, (tall ? 1.78 : 1.42) + 0.21, -0.4);
    m.group.add(siren); m.siren = siren;
  }
  return m;
}

export function motoModel(paint: string): VehicleModel {
  const key = 'moto|' + paint;
  let body = cache.get(key);
  if (!body) {
    const c = new THREE.Color(paint);
    body = mergeGeometries([
      colored(box(0.24, 0.22, 0.55, 0, 0.78, 0.15), c),                     // tanque
      colored(box(0.26, 0.1, 0.6, 0, 0.82, -0.4), 0x151515),                // asiento
      colored(box(0.3, 0.3, 0.42, 0, 0.5, -0.05), 0x5a5a5a),                // motor
      colored(box(0.08, 0.08, 1.1, 0, 0.55, -0.1).rotateX(0.1), 0x333333), // chasis
      colored(box(0.06, 0.6, 0.06, 0, 0.62, 0.62).rotateX(-0.4), 0x9a9a9a), // horquilla
      colored(box(0.7, 0.04, 0.04, 0, 1.0, 0.5), 0x111111),                 // manubrio
      colored(box(0.24, 0.12, 0.3, 0, 0.78, -0.75), c),                     // colín
      colored(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8).rotateX(Math.PI / 2).translate(0.15, 0.38, -0.45), 0xaaaaaa), // escape
    ])!;
    cache.set(key, body);
  }
  let lights = cache.get('motoL');
  if (!lights) { lights = mergeGeometries([colored(box(0.16, 0.12, 0.05, 0, 0.9, 0.68), 0xfff6d8), colored(box(0.14, 0.06, 0.04, 0, 0.84, -0.9), 0xc01010)])!; cache.set('motoL', lights); }
  return finish(body, lights, 0, 0.31, 0.12, 0.68, -0.68);
}

export function heliModel(paint: string): VehicleModel {
  const c = new THREE.Color(paint);
  const body = mergeGeometries([
    colored(new THREE.SphereGeometry(1, 14, 10).scale(1.15, 1.05, 2.0).translate(0, 1.55, 0.4), c),
    colored(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1.0, 0.85, 1.0).translate(0, 1.6, 1.55), 0x1c2228),
    colored(new THREE.CylinderGeometry(0.16, 0.32, 4.2, 8).rotateX(Math.PI / 2).translate(0, 1.75, -3.3), c),
    colored(box(0.08, 1.0, 0.6, 0, 2.15, -5.3), c),
    colored(box(1.2, 0.06, 0.4, 0, 1.75, -5.0), c),
    colored(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 8).translate(0, 2.65, 0.3), 0x333333),
    ...[-0.85, 0.85].map((x) => colored(new THREE.CylinderGeometry(0.05, 0.05, 3.0, 6).rotateX(Math.PI / 2).translate(x, 0.12, 0.3), 0x333333)),
    ...[-0.85, 0.85].flatMap((x) => [-0.6, 1.2].map((z) => colored(box(0.05, 0.5, 0.05, x * 0.9, 0.4, z), 0x333333))),
  ])!;
  const lights = mergeGeometries([colored(box(0.2, 0.1, 0.1, 0, 0.75, 2.3), 0xfff6d8), colored(box(0.1, 0.1, 0.1, 0, 2.6, -5.5), 0xff2020)])!;
  const group = new THREE.Group();
  const bm = new THREE.Mesh(body, MAT); bm.castShadow = true;
  const rotor = new THREE.Group(); rotor.position.set(0, 2.88, 0.3);
  rotor.add(new THREE.Mesh(colored(mergeGeometries([box(9.5, 0.04, 0.32, 0, 0, 0), box(0.32, 0.04, 9.5, 0, 0, 0)])!, 0x222222), MAT_MATTE));
  const tail = new THREE.Group(); tail.position.set(0.12, 2.15, -5.4);
  tail.add(new THREE.Mesh(colored(box(0.04, 1.4, 0.16, 0, 0, 0), 0x222222), MAT_MATTE));
  group.add(bm, new THREE.Mesh(lights, LIGHT_MAT), rotor, tail);
  return { group, body: bm, front: new THREE.Group(), rear: new THREE.Group(), rotor, tailRotor: tail, lights: new THREE.Mesh() };
}
