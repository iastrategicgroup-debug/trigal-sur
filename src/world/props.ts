import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as T from './textures';
import type { V2 } from '../map/osm';

/** Curva de un tronco: desplazamiento lateral en función de la altura normalizada. */
type Bend = (t: number) => { x: number; z: number };

/** Tubo irregular a lo largo de una curva, con radio variable y ruido. Colores por vértice (de abajo a arriba). */
function trunkTube(H: number, r0: number, r1: number, bend: Bend, seg: number, rings: number, rnd: () => number, colorAt: (t: number) => THREE.Color, uvRepeatY: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const noise = Array.from({ length: (rings + 1) * seg }, () => 0.88 + rnd() * 0.24);
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const c = bend(t);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.7) + (t < 0.08 ? (0.08 - t) * 2.5 * r0 : 0); // base ensanchada
    const cc = colorAt(t);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const k = noise[j * seg + (i % seg)]!;
      pos.push(c.x + Math.cos(a) * r * k, t * H, c.z + Math.sin(a) * r * k);
      uv.push(i / seg, t * uvRepeatY);
      col.push(cc.r, cc.g, cc.b);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Chaguaramo (palma real): tronco gris delgado (Ø 40–60 cm), algo curvado, capitel verde liso
 * y penacho de 12–16 hojas de distinto largo; algunas cuelgan secas.
 */
function palmGeometries(seed: number): { trunk: THREE.BufferGeometry; fronds: THREE.BufferGeometry } {
  const rnd = T.rng(seed);
  const H = 12 + rnd() * 4;
  const bx = (rnd() - 0.5) * 1.6, bz = (rnd() - 0.5) * 1.6;
  const bend: Bend = (t) => ({ x: bx * t * t, z: bz * t * t });
  const grey = new THREE.Color(0xb8b2a6), green = new THREE.Color(0x6f8a3c);
  const trunk = trunkTube(H, 0.3, 0.2, bend, 8, 14, rnd, (t) => (t > 0.88 ? green : grey.clone().multiplyScalar(0.85 + 0.25 * t)), 7);
  const top = bend(1);
  const parts: THREE.BufferGeometry[] = [];
  const N = 12 + Math.floor(rnd() * 5);
  for (let k = 0; k < N; k++) {
    const len = 3.6 + rnd() * 1.8;
    const dry = rnd() < 0.1;
    const droop = dry ? 0.32 : 0.11 + rnd() * 0.07;
    const rise = dry ? 0.0 : 0.45 + rnd() * 0.35;
    const g = new THREE.PlaneGeometry(len, 1.5 + rnd() * 0.4, 8, 1);
    const pp = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i) + len / 2;
      pp.setX(i, x);
      pp.setZ(i, pp.getY(i) * (1 - x / len * 0.6)); // se angosta en la punta
      pp.setY(i, -droop * x * x + rise * x);
    }
    g.rotateZ(dry ? -0.35 : (rnd() - 0.5) * 0.25);
    g.rotateY((k / N) * Math.PI * 2 + rnd() * 0.4);
    g.translate(top.x, H - 0.1, top.z);
    parts.push(g);
  }
  const fronds = mergeSimple(parts);
  fronds.computeVertexNormals();
  return { trunk, fronds };
}

/** Mango/samán: tronco torcido, 3–4 ramas y copa de varios lóbulos irregulares + racimos de hojas. */
function broadleafGeometries(seed: number): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry; cards: THREE.BufferGeometry } {
  const r = T.rng(seed);
  const bark = new THREE.Color(0x6a5a48);
  const H = 2.6 + r() * 0.8;
  const lean = { x: (r() - 0.5) * 0.8, z: (r() - 0.5) * 0.8 };
  const trunkParts: THREE.BufferGeometry[] = [trunkTube(H, 0.32, 0.24, (t) => ({ x: lean.x * t + Math.sin(t * 3) * 0.08, z: lean.z * t }), 7, 6, r, () => bark, 2)];
  const lobes: { x: number; y: number; z: number; s: number }[] = [];
  const nb = 3 + Math.floor(r() * 2);
  for (let k = 0; k < nb; k++) {
    const ang = (k / nb) * Math.PI * 2 + r() * 0.8;
    const out = 1.6 + r() * 1.2, up = 2 + r() * 1.4;
    const br = trunkTube(Math.hypot(out, up), 0.17, 0.08, (t) => ({ x: Math.cos(ang) * out * t, z: Math.sin(ang) * out * t }), 5, 4, r, () => bark, 1.5);
    // escala la altura para que la rama suba 'up' y no la hipotenusa
    br.scale(1, up / Math.hypot(out, up), 1);
    br.translate(lean.x, H - 0.3, lean.z);
    trunkParts.push(br);
    lobes.push({ x: lean.x + Math.cos(ang) * out, y: H - 0.3 + up + 0.6, z: lean.z + Math.sin(ang) * out, s: 1.7 + r() * 0.8 });
  }
  lobes.push({ x: lean.x, y: H + 3.2, z: lean.z, s: 2.0 + r() * 0.6 });
  const trunk = mergeSimple(trunkParts.map((g) => { g.deleteAttribute('color'); return g; }));
  trunk.computeVertexNormals();

  const crowns: THREE.BufferGeometry[] = [];
  for (const L of lobes) {
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position as THREE.BufferAttribute;
    const uv: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const j = 0.75 + r() * 0.45;
      const x = p.getX(i) * j * L.s * 1.2, y = p.getY(i) * j * L.s * 0.8, z = p.getZ(i) * j * L.s * 1.2;
      p.setXYZ(i, x + L.x, (y < -0.3 * L.s ? -0.3 * L.s + (y + 0.3 * L.s) * 0.3 : y) + L.y, z + L.z); // base aplanada
      uv.push((Math.atan2(z, x) / Math.PI + 1) * 1.5, (y / L.s + 1) * 1.2);
    }
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    crowns.push(g);
  }
  const crown = mergeSimple(crowns);
  crown.computeVertexNormals();

  const cards: THREE.BufferGeometry[] = [];
  for (const L of lobes) for (let k = 0; k < 4; k++) {
    const th = r() * Math.PI * 2, ph = (0.15 + r() * 0.6) * Math.PI;
    const R = L.s * 1.05;
    cards.push(new THREE.PlaneGeometry(L.s * 1.6, L.s * 1.6).rotateX(-Math.PI / 2 + (r() - 0.5) * 1.4).rotateY(th)
      .translate(L.x + Math.sin(ph) * Math.cos(th) * R * 1.1, L.y + Math.cos(ph) * R * 0.75, L.z + Math.sin(ph) * Math.sin(th) * R * 1.1));
  }
  return { trunk, crown, cards: mergeSimple(cards) };
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv', 'color'] as const;
  const idx: number[] = [];
  let offset = 0;
  const data: Record<string, number[]> = { position: [], normal: [], uv: [], color: [] };
  for (const g of geos) {
    const gi: ArrayLike<number> = g.index ? g.index.array : [...Array(g.attributes.position!.count).keys()];
    for (let i = 0; i < gi.length; i++) idx.push(gi[i]! + offset);
    for (const a of attrs) { const at = g.getAttribute(a); if (at) data[a]!.push(...Array.from(at.array as ArrayLike<number>)); }
    offset += g.attributes.position!.count;
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(data.position!, 3));
  if (data.normal!.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal!, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv!, 2));
  if (data.color!.length === data.position!.length) out.setAttribute('color', new THREE.Float32BufferAttribute(data.color!, 3));
  out.setIndex(idx);
  return out;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: { x: number; y?: number; z: number; s?: number; ry?: number; sy?: number; tilt?: number }[], shadow = true): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  m.count = items.length;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3();
  items.forEach((it, i) => {
    const sc = it.s ?? 1;
    M.compose(t.set(it.x, it.y ?? 0, it.z), q.setFromEuler(e.set(it.tilt ?? 0, it.ry ?? 0, (it.tilt ?? 0) * 0.7, 'YXZ')), s.set(sc, sc * (it.sy ?? 1), sc));
    m.setMatrixAt(i, M);
  });
  m.castShadow = shadow;
  m.receiveShadow = false;
  m.computeBoundingSphere();
  return m;
}

export interface PropsInput {
  palms: V2[];
  mangos: V2[];
  samans: V2[];
  posts: { p: V2; ry: number }[];
  tanks: { x: number; y: number; z: number; s: number }[];
  benches: { p: V2; ry: number }[];
  plants: V2[];
  smallTrees?: V2[];
}

export interface PropsOut {
  group: THREE.Group;
  lampMat: THREE.MeshBasicMaterial;
  cableMat: THREE.LineBasicMaterial;
  trunks: { p: V2; r: number }[];
}

/** `cables`: postes completos para tender cables (globales); si se omite, no se tienden. */
export function buildProps(input: PropsInput, rnd: () => number, cables?: PropsInput['posts']): PropsOut {
  const group = new THREE.Group();
  group.name = 'utilería';
  const trunks: { p: V2; r: number }[] = [];

  // Palmas: 3 variantes de curvatura, cada instancia con inclinación y giro propios
  const palmTrunkMat = new THREE.MeshLambertMaterial({ map: T.bark(true), vertexColors: true });
  const frondMat = new THREE.MeshLambertMaterial({ map: T.palmFrond(), alphaTest: 0.5, side: THREE.DoubleSide });
  const VAR = 3;
  for (let v = 0; v < VAR; v++) {
    const g = palmGeometries(100 + v);
    const items = input.palms.filter((_, i) => i % VAR === v).map((p) => ({ x: p.x, z: p.z, s: 0.9 + rnd() * 0.2, ry: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.08 }));
    group.add(instanced(g.trunk, palmTrunkMat, items), instanced(g.fronds, frondMat, items));
  }
  input.palms.forEach((p) => trunks.push({ p, r: 0.35 }));

  // Mangos y samanes (samán: más ancho y bajo)
  const barkMat = new THREE.MeshLambertMaterial({ map: T.bark(false) });
  const crownMat = new THREE.MeshLambertMaterial({ map: T.leafMass(), color: 0x8ab060 });
  const cardMat = new THREE.MeshLambertMaterial({ map: T.foliage(), alphaTest: 0.4, side: THREE.DoubleSide });
  cardMat.alphaToCoverage = true;
  const trees = [
    ...input.mangos.map((p) => ({ x: p.x, z: p.z, s: 0.85 + rnd() * 0.35, ry: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.06 })),
    ...input.samans.map((p) => ({ x: p.x, z: p.z, s: 1.5 + rnd() * 0.4, sy: 0.75, ry: rnd() * 6.28 })),
    ...(input.smallTrees ?? []).map((p) => ({ x: p.x, z: p.z, s: 0.55 + rnd() * 0.15, ry: rnd() * 6.28 })),
  ];
  for (let v = 0; v < VAR; v++) {
    const g = broadleafGeometries(200 + v);
    const items = trees.filter((_, i) => i % VAR === v);
    group.add(instanced(g.trunk, barkMat, items), instanced(g.crown, crownMat, items), instanced(g.cards, cardMat, items));
  }
  [...input.mangos, ...input.samans].forEach((p) => trunks.push({ p, r: 0.4 }));

  // Plantas de jardín (agaves, matas): tres planos cruzados
  const plantGeo = mergeSimple([0, 1, 2].map((k) => new THREE.PlaneGeometry(1.3, 1.1).translate(0, 0.55, 0).rotateY((k / 3) * Math.PI)));
  plantGeo.computeVertexNormals();
  const plantMat = new THREE.MeshLambertMaterial({ map: T.agave(), alphaTest: 0.5, side: THREE.DoubleSide });
  group.add(instanced(plantGeo, plantMat, input.plants.map((p) => ({ x: p.x, z: p.z, s: 0.7 + rnd() * 0.7, ry: rnd() * 6.28 })), false));

  // Postes de concreto con brazo y farol
  const postGeo = mergeSimple([
    new THREE.CylinderGeometry(0.12, 0.2, 9, 6).translate(0, 4.5, 0),
    new THREE.BoxGeometry(1.6, 0.12, 0.12).translate(0, 8.3, 0),     // cruceta
    new THREE.BoxGeometry(0.08, 0.08, 1.8).translate(0, 7.2, 0.9),   // brazo del farol (hacia la calle = +Z local)
  ]);
  postGeo.computeVertexNormals();
  const postMat = new THREE.MeshLambertMaterial({ map: T.sidewalk(), color: 0xb0aaa0 });
  const postItems = input.posts.map((p) => ({ x: p.p.x, z: p.p.z, ry: p.ry }));
  group.add(instanced(postGeo, postMat, postItems));
  const lampGeo = new THREE.BoxGeometry(0.35, 0.15, 0.6).translate(0, 7.1, 1.8);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x504a40 });
  group.add(instanced(lampGeo, lampMat, postItems, false));
  input.posts.forEach((p) => trunks.push({ p: p.p, r: 0.25 }));

  // Cables con catenaria entre postes consecutivos (de la lista global, para no cortarlos en los bordes de zona)
  const cable: number[] = [];
  const cp = cables ?? [];
  for (let i = 0; i < cp.length - 1; i++) {
    const a = cp[i]!.p, b = cp[i + 1]!.p;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > 45) continue;
    for (const off of [-0.7, 0, 0.7]) {
      const ry = cp[i]!.ry;
      const ox = Math.cos(ry) * off, oz = -Math.sin(ry) * off;
      const N = 6;
      for (let k = 0; k < N; k++) {
        const t0 = k / N, t1 = (k + 1) / N;
        const y0 = 8.3 - 0.8 * 4 * t0 * (1 - t0), y1 = 8.3 - 0.8 * 4 * t1 * (1 - t1);
        cable.push(a.x + (b.x - a.x) * t0 + ox, y0, a.z + (b.z - a.z) * t0 + oz, a.x + (b.x - a.x) * t1 + ox, y1, a.z + (b.z - a.z) * t1 + oz);
      }
    }
  }
  const cableGeo = new THREE.BufferGeometry();
  cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(cable, 3));
  const cableMat = new THREE.LineBasicMaterial({ color: 0x151515 });
  if (cable.length) group.add(new THREE.LineSegments(cableGeo, cableMat));

  // Tanques de agua (negros, tipo Rotoplas genérico)
  const tankGeo = new THREE.CylinderGeometry(0.6, 0.55, 1.3, 10).translate(0, 0.65, 0);
  const tankMat = new THREE.MeshLambertMaterial({ color: 0x1e1e20 });
  group.add(instanced(tankGeo, tankMat, input.tanks.map((t) => ({ x: t.x, y: t.y, z: t.z, s: t.s }))));

  // Bancos de plaza (concreto con listones de madera)
  const benchGeo = mergeSimple([
    new THREE.BoxGeometry(1.8, 0.08, 0.45).translate(0, 0.45, 0),
    new THREE.BoxGeometry(1.8, 0.4, 0.06).translate(0, 0.75, -0.2),
    new THREE.BoxGeometry(0.15, 0.45, 0.45).translate(-0.75, 0.22, 0),
    new THREE.BoxGeometry(0.15, 0.45, 0.45).translate(0.75, 0.22, 0),
  ]);
  benchGeo.computeVertexNormals();
  group.add(instanced(benchGeo, new THREE.MeshLambertMaterial({ map: T.doorTex(), color: 0xc8b8a0 }), input.benches.map((b) => ({ x: b.p.x, z: b.p.z, ry: b.ry }))));

  return { group, lampMat, cableMat, trunks };
}
