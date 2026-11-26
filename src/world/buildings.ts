import * as THREE from 'three';
import type { CityMap, Road, V2 } from '../map/osm';
import { pointInPoly } from '../map/osm';
import type { GeoBank, GeoBuilder } from './GeoBuilder';
import { densify } from './roads';

/** Lote: rectángulo orientado. `u` va a lo largo de la calle; `n` apunta hacia la calle (frente). */
export interface Lot {
  c: V2; u: V2; n: V2; hw: number; hd: number;
  kind: 'quinta' | 'comercio' | 'baldio';
  road: Road;
}

export interface BuildingsOut {
  solids: V2[][];                         // polígonos de colisión (planta)
  wires: number[];                        // segmentos de cerco eléctrico (x,y,z,x,y,z…)
  tanks: { x: number; y: number; z: number; s: number }[];
  backyardTrees: V2[];
  plants: V2[];
  yardPalms: V2[];
  /** Puertas con marcador: se puede entrar (casas y comercios). facing = dirección hacia adentro. */
  entries: { p: V2; facing: number; kind: 'casa' | 'tienda'; seed: number }[];
  lots: Lot[];
}

const STUCCO = ['#efe3c8', '#e9c9a3', '#f2e7a6', '#f4f1ea', '#cfe0c0', '#f0c2a0', '#c9dbe6', '#e8d0d8', '#f3d9a4', '#dcd2c2',
  '#a8d8b8', '#9cc8e8', '#f0d860', '#d88a5a', '#e8a8b8', '#c0a8d8', '#b8c870', '#f2b880'];
const ROOF_TINTS = ['#8a8e94', '#5a6a80', '#6a7a5a', '#7a5a48', '#9a9488'];
const SHEET_TINTS = ['#4a7a5a', '#4a6a9a', '#8a4a3a', '#9a9a9a'];
const GATES = ['#e8e8e8', '#2a2a2a', '#3c5a3a', '#5a3a26', '#8a8a8a', '#283c5a'];
const SIGNS = [
  'PANADERÍA LA ESPIGA', 'FARMACIA SAN BLAS', 'FERRETERÍA EL TORNILLO', 'LICORERÍA LOS MANGOS',
  'ABASTO MI ESPERANZA', 'PELUQUERÍA ESTILO', 'REPUESTOS CARABOBO', 'POLLOS DON PEPE',
  'AREPERA LA VALENCIANA', 'ÓPTICA VISIÓN', 'TASCA EL RINCÓN', 'BODEGÓN EL TRIGAL',
  'LAVANDERÍA BURBUJAS', 'ZAPATERÍA PASO FIRME', 'CYBER RED', 'HELADERÍA FRESCURA',
];
export const SIGN_COUNT = SIGNS.length;

/** Atlas de letreros ficticios (2 columnas x 8 filas de 256x64). */
export function signAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d')!;
  const bgs = ['#c8282a', '#1f4f9a', '#f2c230', '#2a7a3a', '#f4f0e6', '#e26a1c', '#5a2a7a', '#202020'];
  SIGNS.forEach((name, i) => {
    const x = (i % 2) * 256, y = Math.floor(i / 2) * 64;
    const bg = bgs[i % bgs.length]!;
    g.fillStyle = bg; g.fillRect(x, y, 256, 64);
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 4; g.strokeRect(x + 2, y + 2, 252, 60);
    const light = bg === '#f2c230' || bg === '#f4f0e6';
    g.fillStyle = light ? '#1a1a1a' : '#ffffff';
    g.font = 'bold 26px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const words = name.split(' ');
    if (g.measureText(name).width > 236 && words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      g.font = 'bold 22px "Arial Narrow", Arial, sans-serif';
      g.fillText(words.slice(0, mid).join(' '), x + 128, y + 21, 240);
      g.fillText(words.slice(mid).join(' '), x + 128, y + 45, 240);
    } else g.fillText(name, x + 128, y + 33, 240);
    // Desgaste
    for (let k = 0; k < 120; k++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(x + Math.random() * 256, y + Math.random() * 64, 3, 2); }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- Colocación de lotes ----------

/** Recorre cada calle y coloca lotes a ambos lados, sin invadir calles, parques ni otros lotes. */
export function placeLots(map: CityMap, rnd: () => number): Lot[] {
  const lots: Lot[] = [];
  const occ = new Set<string>();
  const placedRects: V2[][] = [];
  const OC = 1.5;
  const parks = map.areas.filter((a) => a.kind === 'park' || a.kind === 'pitch' || a.kind === 'parking' || a.kind === 'building');
  const lim = { w: map.half.w - 4, h: map.half.h - 4 };
  const cellsOf = (corners: V2[]) => {
    const xs = corners.map((p) => p.x), zs = corners.map((p) => p.z);
    const out: string[] = [];
    for (let x = Math.floor(Math.min(...xs) / OC); x <= Math.floor(Math.max(...xs) / OC); x++)
      for (let z = Math.floor(Math.min(...zs) / OC); z <= Math.floor(Math.max(...zs) / OC); z++) {
        const cx = (x + 0.5) * OC, cz = (z + 0.5) * OC;
        if (pointInPoly(cx, cz, corners)) out.push(`${x},${z}`);
      }
    return out;
  };

  const roads = [...map.roads].filter((r) => r.kind !== 'motorway' && r.kind !== 'motorway_link' && r.kind !== 'service')
    .sort((a, b) => b.width - a.width);
  for (const road of roads) {
    const commercial = road.kind === 'tertiary' || /^Avenida (Arturo Michelena|88 Cabriales|El Trigal|San Jos)/.test(road.name);
    const pts = densify(road.pts, 2);
    const setback = road.width / 2 + road.sidewalk + 0.5;
    for (const side of [1, -1]) {
      let acc = rnd() * 4;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!, b = pts[i + 1]!;
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        acc += seg;
        const hw = commercial ? 5 + rnd() * 2 : 7 + rnd() * 3;          // frente: comercio 10–14 m, quinta 14–20 m
        if (acc < hw * 2 + 0.6) continue;
        // Fondo deseado; si la manzana no da, se prueban fondos más cortos (mín. 9 m)
        const want = commercial ? 10 + rnd() * 4 : 14 + rnd() * 4;
        const ux = (b.x - a.x) / seg, uz = (b.z - a.z) / seg;
        const lx = -uz * side, lz = ux * side; // normal hacia el lote; n (frente) apunta a la calle
        const mid = { x: (a.x + b.x) / 2 - ux * hw, z: (a.z + b.z) / 2 - uz * hw };
        const n = { x: -lx, z: -lz }, u = { x: n.z, z: -n.x };
        let placed: { c: V2; hd: number; corners: V2[]; cells: string[] } | null = null;
        for (const hd of [want, want * 0.8, 11, 9]) {
          if (hd > want) continue;
          const c = { x: mid.x + lx * (setback + hd), z: mid.z + lz * (setback + hd) };
          const corners = rectCorners(c, u, n, hw, hd);
          const testPts = [...corners, c, ...corners.map((p) => ({ x: (p.x + c.x) / 2, z: (p.z + c.z) / 2 }))];
          const ok = testPts.every((p) => Math.abs(p.x) < lim.w && Math.abs(p.z) < lim.h && !map.onRoadCorridor(p.x, p.z, 0.2))
            && !parks.some((pk) => testPts.some((p) => pointInPoly(p.x, p.z, pk.poly)) || pk.poly.some((q) => pointInPoly(q.x, q.z, corners)));
          if (!ok) continue;
          const cells = cellsOf(corners);
          if (cells.some((k) => occ.has(k))) continue;
          if (placedRects.some((r) => Math.hypot(r[0]!.x - c.x, r[0]!.z - c.z) < 60 && rectsOverlap(r, corners))) continue;
          placed = { c, hd, corners, cells };
          break;
        }
        if (!placed) { acc = Math.min(acc, hw); continue; }
        const { c, hd, cells } = placed;
        placedRects.push(placed.corners);
        cells.forEach((k) => occ.add(k));
        lots.push({ c, u, n, hw, hd, kind: commercial ? 'comercio' : rnd() < 0.08 ? 'baldio' : 'quinta', road });
        acc = 0;
      }
    }
  }
  return lots;
}

/** Separación de ejes (SAT) entre dos rectángulos (con 5 cm de tolerancia). */
function rectsOverlap(a: V2[], b: V2[]): boolean {
  for (const poly of [a, b]) for (let i = 0; i < 4; i++) {
    const p = poly[i]!, q = poly[(i + 1) % 4]!;
    const nx = -(q.z - p.z), nz = q.x - p.x, l = Math.hypot(nx, nz) || 1;
    const pa = a.map((v) => (v.x * nx + v.z * nz) / l), pb = b.map((v) => (v.x * nx + v.z * nz) / l);
    if (Math.max(...pa) <= Math.min(...pb) + 0.05 || Math.max(...pb) <= Math.min(...pa) + 0.05) return false;
  }
  return true;
}

export function rectCorners(c: V2, u: V2, n: V2, hw: number, hd: number): V2[] {
  const P = (a: number, b: number) => ({ x: c.x + u.x * a + n.x * b, z: c.z + u.z * a + n.z * b });
  return [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)];
}

// ---------- Construcción ----------

const tmpC = new THREE.Color();
function col(hex: string, k = 1): THREE.Color { return new THREE.Color(hex).multiplyScalar(k); }

class LotFrame {
  constructor(readonly lot: Lot) {}
  x(a: number, b: number): number { return this.lot.c.x + this.lot.u.x * a + this.lot.n.x * b; }
  z(a: number, b: number): number { return this.lot.c.z + this.lot.u.z * a + this.lot.n.z * b; }
  v(a: number, y: number, b: number): THREE.Vector3 { return new THREE.Vector3(this.x(a, b), y, this.z(a, b)); }
  /** Pared local de (a0,b0) a (a1,b1). */
  wall(g: GeoBuilder, a0: number, b0: number, a1: number, b1: number, y0: number, y1: number, scale: number, c: THREE.Color, top?: THREE.Color, uOff = 0): void {
    g.wall(this.x(a0, b0), this.z(a0, b0), this.x(a1, b1), this.z(a1, b1), y0, y1, scale, c, top, uOff);
  }
  /** Rectángulo plano sobre una pared (ventana/puerta), desplazado `out` hacia fuera por la normal local (na, nb). */
  decal(g: GeoBuilder, a: number, b: number, ta: number, tb: number, na: number, nb: number, w: number, y0: number, y1: number, c: THREE.Color, uv: [number, number, number, number] = [0, 0, 1, 1]): void {
    const o = 0.04;
    const p0 = this.v(a - ta * w / 2 + na * o, y0, b - tb * w / 2 + nb * o);
    const p1 = this.v(a + ta * w / 2 + na * o, y0, b + tb * w / 2 + nb * o);
    g.quad(p0, p1, new THREE.Vector3(p1.x, y1, p1.z), new THREE.Vector3(p0.x, y1, p0.z), uv, c);
  }
  box(g: GeoBuilder, a: number, b: number, hwA: number, hwB: number, y0: number, y1: number, scale: number, c: THREE.Color): void {
    const ang = Math.atan2(this.lot.u.z, this.lot.u.x);
    g.box(this.x(a, b), this.z(a, b), y0, y1, hwA, hwB, ang, scale, c);
  }
}

export function buildLots(lots: Lot[], bankFor: (lot: Lot) => GeoBank, rnd: () => number): BuildingsOut {
  const out: BuildingsOut = { solids: [], wires: [], tanks: [], backyardTrees: [], plants: [], yardPalms: [], entries: [], lots };
  for (const lot of lots) {
    const bank = bankFor(lot);
    if (lot.kind === 'quinta') buildQuinta(lot, bank, rnd, out);
    else if (lot.kind === 'baldio') buildBaldio(lot, bank, rnd, out);
    else buildShop(lot, bank, rnd, out);
  }
  return out;
}

function addWindows(f: LotFrame, bank: GeoBank, rnd: () => number, a0: number, b0: number, a1: number, b1: number, na: number, nb: number, floors: number, floorH: number, skip?: (t: number) => boolean, floorOffset = 0): void {
  const len = Math.hypot(a1 - a0, b1 - b0);
  const ta = (a1 - a0) / len, tb = (b1 - b0) / len;
  const n = Math.max(1, Math.floor(len / 3.2));
  for (let fl = 0; fl < floors; fl++) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (fl + floorOffset === 0 && skip?.(t * len)) continue;
      const lit = rnd() < 0.45;
      const upper = fl + floorOffset > 0;
      const variant = upper ? (rnd() < 0.6 ? 3 : 2) : Math.floor(rnd() * 3);
      const g = bank.get(lit ? 'windowLit' : 'window');
      const y0 = (fl + floorOffset) * floorH + 0.95, y1 = y0 + 1.25;
      const ca = a0 + (a1 - a0) * t, cb = b0 + (b1 - b0) * t;
      f.decal(g, ca, cb, ta, tb, na, nb, 1.4, y0, y1, tmpC.setScalar(0.95 + rnd() * 0.1), [variant * 0.25, 0, variant * 0.25 + 0.25, 1]);
      // Alféizar y dintel con volumen (dan sombra real)
      const st = bank.get('stucco');
      const sc = col('#eeeae2');
      // Alféizar y dintel: cara frontal + cara superior (lo único visible), sobresalen 14 cm
      for (const [ya, yb] of [[y0 - 0.1, y0 - 0.02], [y1 + 0.02, y1 + 0.14]] as const) {
        const a0 = ca - ta * 0.82, b0 = cb - tb * 0.82, a1 = ca + ta * 0.82, b1 = cb + tb * 0.82;
        const o = 0.14;
        st.quad(f.v(a0 + na * o, ya, b0 + nb * o), f.v(a1 + na * o, ya, b1 + nb * o), f.v(a1 + na * o, yb, b1 + nb * o), f.v(a0 + na * o, yb, b0 + nb * o), [0, 0, 0.5, 0.05], sc);
        st.quad(f.v(a0, yb, b0), f.v(a1, yb, b1), f.v(a1 + na * o, yb, b1 + nb * o), f.v(a0 + na * o, yb, b0 + nb * o), [0, 0, 0.5, 0.05], sc.clone().multiplyScalar(1.08));
      }
    }
  }
}

function hipRoof(f: LotFrame, g: GeoBuilder, aMin: number, aMax: number, bMin: number, bMax: number, y: number, o: number, c: THREE.Color): number {
  const a0 = aMin - o, a1 = aMax + o, b0 = bMin - o, b1 = bMax + o;
  const ra = (a1 - a0) / 2, rb = (b1 - b0) / 2, ac = (a0 + a1) / 2, bc = (b0 + b1) / 2;
  const slope = Math.tan((24 * Math.PI) / 180);
  const along = ra >= rb;
  const r = Math.min(ra, rb);
  const h = r * slope;
  const sec = 1 / Math.cos((24 * Math.PI) / 180);
  const top = y + h;
  // Ridge
  const R0 = along ? f.v(ac - (ra - r), top, bc) : f.v(ac, top, bc - (rb - r));
  const R1 = along ? f.v(ac + (ra - r), top, bc) : f.v(ac, top, bc + (rb - r));
  const E = [f.v(a0, y, b0), f.v(a1, y, b0), f.v(a1, y, b1), f.v(a0, y, b1)] as const; // atrás-izq, atrás-der, frente-der, frente-izq
  const S = 2; // m por repetición de teja
  const uvAlong = (p: THREE.Vector3, eA: THREE.Vector3, eB: THREE.Vector3): [number, number] => {
    const ex = eB.x - eA.x, ez = eB.z - eA.z, el = Math.hypot(ex, ez);
    const ux = ex / el, uz = ez / el;
    const dx = p.x - eA.x, dz = p.z - eA.z;
    return [(dx * ux + dz * uz) / S, (Math.abs(-dx * uz + dz * ux) * sec) / S];
  };
  const face = (e0: THREE.Vector3, e1: THREE.Vector3, r0: THREE.Vector3, r1: THREE.Vector3 | null) => {
    g.tri(e0, e1, r1 ?? r0, uvAlong(e0, e0, e1), uvAlong(e1, e0, e1), uvAlong(r1 ?? r0, e0, e1), c);
    if (r1) g.tri(e0, r1, r0, uvAlong(e0, e0, e1), uvAlong(r1, e0, e1), uvAlong(r0, e0, e1), c);
  };
  if (along) {
    face(E[3], E[2], R0, R1);       // frente
    face(E[1], E[0], R1, R0);       // atrás
    face(E[2], E[1], R1, null);     // derecha
    face(E[0], E[3], R0, null);     // izquierda
  } else {
    face(E[0], E[3], R0, R1);
    face(E[2], E[1], R1, R0);
    face(E[3], E[2], R1, null);
    face(E[1], E[0], R0, null);
  }
  return top;
}

type FrontStyle = 'muro' | 'reja' | 'abierta';
type RoofStyle = 'cuatroAguas' | 'dosAguas' | 'lamina' | 'platabanda';

function pick<T>(rnd: () => number, items: [T, number][]): T {
  let x = rnd() * items.reduce((t, [, w]) => t + w, 0);
  for (const [v, w] of items) { if ((x -= w) <= 0) return v; }
  return items[0]![0];
}

/** Techo a dos aguas: cumbrera paralela a la calle; hastiales (triángulos laterales) en friso. */
function gableRoof(f: LotFrame, roof: GeoBuilder, wall: GeoBuilder, hA: number, bBack: number, bFront: number, y: number, o: number, c: THREE.Color, wallC: THREE.Color): void {
  const slope = Math.tan((28 * Math.PI) / 180);
  const bc = (bBack + bFront) / 2, half = (bFront - bBack) / 2;
  const top = y + half * slope;
  const yEave = y - o * slope;
  const sec = 1 / Math.cos((28 * Math.PI) / 180);
  const S = 2;
  const L = (hA + o) * 2;
  const vSpan = ((half + o) * sec) / S;
  // Faldón delantero y trasero
  roof.quad(f.v(-hA - o, yEave, bFront + o), f.v(hA + o, yEave, bFront + o), f.v(hA + o, top, bc), f.v(-hA - o, top, bc), [0, 0, L / S, vSpan], c);
  roof.quad(f.v(hA + o, yEave, bBack - o), f.v(-hA - o, yEave, bBack - o), f.v(-hA - o, top, bc), f.v(hA + o, top, bc), [0, 0, L / S, vSpan], c);
  // Hastiales
  for (const a of [-hA, hA]) {
    wall.tri(f.v(a, y, bBack), f.v(a, y, bFront), f.v(a, top, bc), [bBack / 3, y / 3], [bFront / 3, y / 3], [bc / 3, top / 3], wallC);
  }
  // Tapa de cumbrera
  roof.quad(f.v(-hA - o, top + 0.04, bc - 0.15), f.v(hA + o, top + 0.04, bc - 0.15), f.v(hA + o, top + 0.04, bc + 0.15), f.v(-hA - o, top + 0.04, bc + 0.15), [0, 0, L / S, 0.15], c.clone().multiplyScalar(0.7));
}

function buildQuinta(lot: Lot, bank: GeoBank, rnd: () => number, out: BuildingsOut): void {
  const f = new LotFrame(lot);
  const { hw, hd } = lot;
  const stucco = bank.get('stucco');
  const front = hd;
  const style = pick<FrontStyle>(rnd, [['muro', 0.4], ['reja', 0.4], ['abierta', 0.2]]);
  const roofStyle = pick<RoofStyle>(rnd, [['cuatroAguas', 0.35], ['dosAguas', 0.3], ['lamina', 0.12], ['platabanda', 0.23]]);
  const wallCol = col(STUCCO[Math.floor(rnd() * STUCCO.length)]!);
  const fenceCol = rnd() < 0.5 ? wallCol.clone() : col(STUCCO[Math.floor(rnd() * STUCCO.length)]!, 0.95);
  const fenceDark = fenceCol.clone().multiplyScalar(0.6);
  const WH = style === 'muro' ? 2.4 + rnd() * 0.4 : style === 'reja' ? 0.9 : 0;   // muro de lindero 2,4–2,8 m
  const FENCE_TOP = 2.0;

  // --- Casa (se decide antes para alinear puerta, caminería y portón) ---
  const floors = rnd() < 0.25 ? 2 : 1;
  // Medidas: retiro de frente ≥ 6 m (Ordenanza de Zonificación de Valencia), laterales ≥ 3 m, fondo ≥ 3 m;
  // altura de piso a piso 3,0 m; casa de 10–16 m de fondo.
  const FH = 3.0;
  const H = floors * FH;
  const hA = hw - 3 - rnd() * 0.8;
  const bFront = hd - (6 + rnd() * 1.5);
  const bBack = Math.max(-hd + 3, bFront - (10 + rnd() * 6));
  const gateW = 3.2, gateSide = rnd() < 0.5 ? -1 : 1;
  const gA0 = gateSide * (hw - 1.2) - (gateSide > 0 ? gateW : 0);
  const gA1 = gA0 + gateW;
  const doorA = -gateSide * hA * 0.45;
  const dA0 = doorA - 0.5, dA1 = doorA + 0.5; // entrada peatonal alineada con la puerta

  // --- Frente del lote ---
  const cuts = [[gA0, gA1], [dA0, dA1]].sort((p, q) => p[0]! - q[0]!) as [number, number][];
  const segs: [number, number][] = [];
  let a = -hw;
  for (const [c0, c1] of cuts) { if (c0 > a) segs.push([a, c0]); a = Math.max(a, c1); }
  if (a < hw) segs.push([a, hw]);
  const gateC = col(GATES[Math.floor(rnd() * GATES.length)]!);
  if (style !== 'abierta') {
    for (const [s0, s1] of segs) {
      f.wall(stucco, s0, front, s1, front, 0, WH, 3, fenceDark, fenceCol, s0);
      f.wall(stucco, s1, front - 0.2, s0, front - 0.2, 0, WH, 3, fenceDark, fenceCol);
      capTop(f, stucco, s0, s1, front, WH, fenceCol);
      if (style === 'reja') f.decal(bank.get('fence'), (s0 + s1) / 2, front - 0.1, 1, 0, 0, 1, s1 - s0, WH, FENCE_TOP, gateC, [0, 0, (s1 - s0) / 1.2, 1]);
    }
    const PH = style === 'muro' ? WH + 0.3 : FENCE_TOP + 0.15;
    for (const pa of [gA0 - 0.2, gA1 + 0.2, dA0 - 0.15, dA1 + 0.15, -hw + 0.15, hw - 0.15]) f.box(stucco, pa, front - 0.1, 0.2, 0.2, 0, PH, 3, fenceCol);
    // Portón y puerta peatonal: lámina en muro alto, reja en muro bajo
    const gateKey = style === 'muro' ? 'gate' : 'fence';
    const gateTop = style === 'muro' ? WH - 0.05 : FENCE_TOP;
    f.decal(bank.get(gateKey), (gA0 + gA1) / 2, front, 1, 0, 0, 1, gateW, 0.02, gateTop, gateC, [0, 0, gateKey === 'gate' ? gateW / 3 : gateW / 1.2, 1]);
    f.decal(bank.get(gateKey), doorA, front, 1, 0, 0, 1, 1.0, 0.02, gateTop, gateC, [0, 0, gateKey === 'gate' ? 0.33 : 0.8, 1]);
  } else {
    // Frente abierto: brocal bajo y setos, como un jardín
    const hedge = bank.get('hedge');
    for (const [s0, s1] of segs) {
      f.box(stucco, (s0 + s1) / 2, front - 0.1, (s1 - s0) / 2, 0.12, 0, 0.3, 3, fenceCol);
      if (s1 - s0 > 1.5) f.box(hedge, (s0 + s1) / 2, front - 0.5, (s1 - s0) / 2 - 0.3, 0.35, 0.3, 1.0 + rnd() * 0.3, 1.5, tmpC.setScalar(0.85 + rnd() * 0.3));
    }
  }
  // Muros laterales y de fondo (siempre; los linderos en Valencia se cierran)
  const SH = Math.max(2.4, WH);
  const iw = hw - 0.05, id = -hd + 0.05;
  f.wall(stucco, iw, front, iw, id, 0, SH, 3, fenceDark, fenceCol);
  f.wall(stucco, -iw, id, -iw, front, 0, SH, 3, fenceDark, fenceCol);
  f.wall(stucco, iw, id, -iw, id, 0, SH, 3, fenceDark, fenceCol);
  if (style === 'muro' && rnd() < 0.6) {
    const P = [[-hw, front], [hw, front], [hw, -hd], [-hw, -hd], [-hw, front]] as const;
    for (let k = 0; k < 4; k++) for (const dy of [0.25, 0.45, 0.65]) {
      const p = P[k]!, q = P[k + 1]!;
      out.wires.push(f.x(p[0], p[1]), WH + dy, f.z(p[0], p[1]), f.x(q[0], q[1]), WH + dy, f.z(q[0], q[1]));
    }
  }
  // Colisión: lote cerrado salvo el frente abierto (se puede entrar al jardín)
  if (style === 'abierta') {
    const R = (a0: number, b0: number, a1: number, b1: number) => [f.x(a0, b0), f.x(a1, b0), f.x(a1, b1), f.x(a0, b1)].map((x, i) => ({ x, z: [f.z(a0, b0), f.z(a1, b0), f.z(a1, b1), f.z(a0, b1)][i]! }));
    out.solids.push(R(-hA - 0.1, bBack, hA + 0.1, bFront));
    out.solids.push(R(-hw, -hd, -hw + 0.2, front), R(hw - 0.2, -hd, hw, front), R(-hw, -hd, hw, -hd + 0.2));
  } else out.solids.push(rectCorners(lot.c, lot.u, lot.n, hw, hd));

  // Piso del frente: entrada de carro de concreto y caminerito de lajas
  const yG = 0.03;
  const gc = (gA0 + gA1) / 2;
  if (rnd() < 0.35) out.entries.push({ p: { x: f.x(doorA, front + 0.75), z: f.z(doorA, front + 0.75) }, facing: Math.atan2(-lot.n.x, -lot.n.z), kind: 'casa', seed: Math.floor(rnd() * 1e9) });
  bank.get('sidewalk').quad(f.v(gc - 1.4, yG, bFront), f.v(gc + 1.4, yG, bFront), f.v(gc + 1.4, yG, front), f.v(gc - 1.4, yG, front), [0, 0, 1.4, (front - bFront) / 2], tmpC.setScalar(0.85));
  bank.get('pavers').quad(f.v(doorA - 0.6, yG + 0.005, bFront), f.v(doorA + 0.6, yG + 0.005, bFront), f.v(doorA + 0.6, yG + 0.005, front), f.v(doorA - 0.6, yG + 0.005, front), [0, 0, 1, (front - bFront) / 1.2], tmpC.setScalar(1));
  // Plantas en el jardín (fuera de setos, porche, garaje, caminería y entrada de carro)
  const plantSpots: [number, number][] = [];
  for (let k = 0; k < 8 && plantSpots.length < 4; k++) {
    const pa = (rnd() - 0.5) * (hw * 2 - 2.4), pb = bFront + 0.9 + rnd() * Math.max(0.3, front - bFront - 2.3);
    if (Math.abs(pa - doorA) < 2.0 || Math.abs(pa - gc) < 2.2) continue;               // caminería, porche y garaje
    if (plantSpots.some(([a, b]) => Math.hypot(a - pa, b - pb) < 1.4)) continue;
    plantSpots.push([pa, pb]);
  }
  for (const [pa, pb] of plantSpots) out.plants.push({ x: f.x(pa, pb), z: f.z(pa, pb) });

  // --- Cuerpo de la casa ---
  const houseCol = rnd() < 0.6 ? wallCol : col(STUCCO[Math.floor(rnd() * STUCCO.length)]!);
  const houseDark = houseCol.clone().multiplyScalar(0.65);
  f.wall(stucco, -hA, bFront, hA, bFront, 0, H, 3, houseDark, houseCol);
  f.wall(stucco, hA, bFront, hA, bBack, 0, H, 3, houseDark, houseCol);
  f.wall(stucco, hA, bBack, -hA, bBack, 0, H, 3, houseDark, houseCol);
  f.wall(stucco, -hA, bBack, -hA, bFront, 0, H, 3, houseDark, houseCol);
  // Zócalo (franja inferior de otro color) en la mitad de las casas
  if (rnd() < 0.5) {
    const zc = col(['#7a6a5a', '#5a6a7a', '#8a5a4a', '#6a7a5a'][Math.floor(rnd() * 4)]!);
    for (const [p, q] of [[[-hA, bFront], [hA, bFront]], [[hA, bFront], [hA, bBack]], [[hA, bBack], [-hA, bBack]], [[-hA, bBack], [-hA, bFront]]] as const) {
      const nx = q[1] - p[1], nz = -(q[0] - p[0]), nl = Math.hypot(nx, nz);
      const o = 0.02;
      f.wall(stucco, p[0] + (nx / nl) * o, p[1] + (nz / nl) * o, q[0] + (nx / nl) * o, q[1] + (nz / nl) * o, 0, 0.7, 3, zc.clone().multiplyScalar(0.8), zc);
    }
  }
  if (floors === 2) f.box(stucco, 0, (bFront + bBack) / 2, hA + 0.08, (bFront - bBack) / 2 + 0.08, FH - 0.1, FH + 0.1, 3, houseCol.clone().multiplyScalar(1.05));
  f.decal(bank.get('door'), doorA, bFront, 1, 0, 0, 1, 1.0, 0.0, 2.15, tmpC.setScalar(1));
  // Marco de la puerta
  f.decal(stucco, doorA, bFront - 0.01, 1, 0, 0, 1, 1.3, 0.0, 2.35, col('#f4f0e8'));
  addWindows(f, bank, rnd, -hA, bFront, hA, bFront, 0, 1, floors, FH, (t) => Math.abs(t - hA - doorA) < 1.3);
  addWindows(f, bank, rnd, hA, bFront, hA, bBack, 1, 0, floors, FH);
  addWindows(f, bank, rnd, -hA, bBack, -hA, bFront, -1, 0, floors, FH);
  if (rnd() < 0.7) {
    // Condensadora del aire (tipo split) en el suelo, pegada a la pared lateral cerca del fondo
    const sideA = rnd() < 0.5 ? hA : -hA;
    f.box(bank.get('ac'), sideA + Math.sign(sideA) * 0.3, bBack + 0.6, 0.22, 0.38, 0.05, 0.65, 1, tmpC.setScalar(1));
  }
  // Porche: losa sobre la puerta con dos columnas
  const carport = rnd() < 0.5;
  if (style !== 'muro' && rnd() < 0.7 && (!carport || Math.abs(doorA - gc) > 1.6 + 1.9)) {
    const pw = 1.6;
    f.box(stucco, doorA, bFront + 1.1, pw, 1.1, 2.55, 2.7, 3, col('#ece6dc'));
    for (const ca of [doorA - pw + 0.12, doorA + pw - 0.12]) f.box(stucco, ca, bFront + 2.05, 0.1, 0.1, 0, 2.55, 3, col('#f2eee6'));
  }

  // --- Techo ---
  const o = 0.6;
  const fascia = () => {
    const fc = col('#f0ece4');
    f.wall(stucco, -hA - o, bFront + o, hA + o, bFront + o, H - 0.22, H, 3, fc);
    f.wall(stucco, hA + o, bBack - o, -hA - o, bBack - o, H - 0.22, H, 3, fc);
    f.wall(stucco, hA + o, bFront + o, hA + o, bBack - o, H - 0.22, H, 3, fc);
    f.wall(stucco, -hA - o, bBack - o, -hA - o, bFront + o, H - 0.22, H, 3, fc);
    stucco.quad(f.v(-hA - o, H - 0.22, bFront + o), f.v(hA + o, H - 0.22, bFront + o), f.v(hA, H - 0.22, bFront), f.v(-hA, H - 0.22, bFront), [0, 0, 1, 0.2], col('#b8b0a4'));
  };
  if (roofStyle === 'cuatroAguas') {
    hipRoof(f, bank.get('roof'), -hA, hA, bBack, bFront, H, o, tmpC.setScalar(0.85 + rnd() * 0.25));
    fascia();
  } else if (roofStyle === 'dosAguas') {
    const tint = col(ROOF_TINTS[Math.floor(rnd() * ROOF_TINTS.length)]!);
    gableRoof(f, bank.get('shingles'), stucco, hA, bBack, bFront, H, o, tint, houseCol);
  } else if (roofStyle === 'lamina') {
    const tint = col(SHEET_TINTS[Math.floor(rnd() * SHEET_TINTS.length)]!);
    gableRoof(f, bank.get('sheet'), stucco, hA, bBack, bFront, H, 0.4, tint, houseCol);
  } else {
    const flat = bank.get('flatroof');
    flat.quad(f.v(-hA, H, bBack), f.v(-hA, H, bFront), f.v(hA, H, bFront), f.v(hA, H, bBack), [0, 0, (bFront - bBack) / 4, hA / 2], tmpC.setScalar(1));
    for (const [p, q] of [[[-hA, bFront], [hA, bFront]], [[hA, bFront], [hA, bBack]], [[hA, bBack], [-hA, bBack]], [[-hA, bBack], [-hA, bFront]]] as const) {
      f.wall(stucco, p[0], p[1], q[0], q[1], H, H + 0.5, 3, houseCol);
    }
    const ta = (rnd() - 0.5) * hA, tb = bBack + 1.5;
    out.tanks.push({ x: f.x(ta, tb), y: H, z: f.z(ta, tb), s: 0.9 + rnd() * 0.3 });
  }
  // Estacionamiento techado
  if (carport) {
    const cA = gc, cw = 1.7;
    const b0 = bFront, b1 = Math.min(hd - 0.5, bFront + 5);
    f.box(stucco, cA, (b0 + b1) / 2, cw + 0.1, (b1 - b0) / 2, 2.45, 2.6, 3, col('#e8e2d8'));
    for (const ca of [cA - cw, cA + cw]) f.box(stucco, ca, b1 - 0.15, 0.1, 0.1, 0, 2.45, 3, col('#e8e2d8'));
  }
  if (rnd() < 0.25) { const pa = (gc > 0 ? -1 : 1) * (hw - 1.3), pb = front - 1.4; if (!plantSpots.some(([a, b]) => Math.hypot(a - pa, b - pb) < 1.6) && Math.abs(pa - doorA) > 2.2) out.yardPalms.push({ x: f.x(pa, pb), z: f.z(pa, pb) }); }
  const yard = bBack - (-hd);
  if (yard >= 5 && rnd() < 0.7) { const tb = (-hd + bBack) / 2; const ta = (rnd() - 0.5) * (hw - 2.5); out.backyardTrees.push({ x: f.x(ta, tb), z: f.z(ta, tb) }); }
}

function capTop(f: LotFrame, g: GeoBuilder, a0: number, a1: number, b: number, y: number, c: THREE.Color): void {
  g.quad(f.v(a0, y, b), f.v(a1, y, b), f.v(a1, y, b - 0.2), f.v(a0, y, b - 0.2), [0, 0, (a1 - a0) / 3, 0.07], c.clone().multiplyScalar(1.05));
}

function buildShop(lot: Lot, bank: GeoBank, rnd: () => number, out: BuildingsOut): void {
  const f = new LotFrame(lot);
  const { hw, hd } = lot;
  const stucco = bank.get('stucco');
  const c = col(STUCCO[Math.floor(rnd() * STUCCO.length)]!);
  const dark = c.clone().multiplyScalar(0.6);
  const floors = rnd() < 0.45 ? 2 : 1;
  const FH = 3.4;
  const H = floors * FH + 0.8; // con parapeto
  const front = hd - 0.6;
  out.entries.push({ p: { x: f.x(0, hd + 0.35), z: f.z(0, hd + 0.35) }, facing: Math.atan2(-lot.n.x, -lot.n.z), kind: 'tienda', seed: Math.floor(rnd() * 1e9) });
  const back = -hd + 1;
  f.wall(stucco, -hw, front, hw, front, 0, H, 3, dark, c);
  f.wall(stucco, hw, front, hw, back, 0, H, 3, dark, c);
  f.wall(stucco, hw, back, -hw, back, 0, H, 3, dark, c);
  f.wall(stucco, -hw, back, -hw, front, 0, H, 3, dark, c);
  const flat = bank.get('flatroof');
  const y = H - 0.6;
  flat.quad(f.v(-hw, y, back), f.v(-hw, y, front), f.v(hw, y, front), f.v(hw, y, back), [0, 0, (front - back) / 4, hw / 2], tmpC.setScalar(1));
  // Fachada: santamaría (persiana metálica) o vidriera
  const shopW = hw * 2 - 1.2;
  if (rnd() < 0.5) {
    f.decal(bank.get('gate'), 0, front, 1, 0, 0, 1, shopW, 0.0, 2.8, col('#9a9a94'), [0, 0, shopW / 3, 1]);
  } else {
    f.decal(bank.get(rnd() < 0.6 ? 'storefrontLit' : 'storefront'), 0, front, 1, 0, 0, 1, shopW, 0.0, 2.8, tmpC.setScalar(1), [0, 0, shopW / 3, 1]);
  }
  // Toldo / marquesina
  const aw = bank.get('stucco');
  const awC = col(['#b03020', '#2a5a9a', '#2a7a3a', '#d08a20'][Math.floor(rnd() * 4)]!);
  aw.quad(f.v(-hw + 0.3, 3.0, front), f.v(hw - 0.3, 3.0, front), f.v(hw - 0.3, 2.7, front + 1.3), f.v(-hw + 0.3, 2.7, front + 1.3), [0, 0, 1, 0.3], awC);
  // Letrero
  const si = Math.floor(rnd() * SIGN_COUNT);
  const u0 = (si % 2) * 0.5, v1 = 1 - Math.floor(si / 2) / 8, v0 = v1 - 1 / 8;
  const sw = Math.min(shopW, 6);
  f.decal(bank.get('signs'), 0, front + 0.05, 1, 0, 0, 1, sw, 3.1, 3.1 + Math.min(sw / 4, 0.85), tmpC.setScalar(1), [u0, v0, u0 + 0.5, v1]);
  if (floors === 2) addWindows(f, bank, rnd, -hw, front, hw, front, 0, 1, 1, FH, undefined, 1);
  addWindows(f, bank, rnd, hw, front, hw, back, 1, 0, floors, FH);
  if (rnd() < 0.5) out.tanks.push({ x: f.x(0, back + 2), y: y, z: f.z(0, back + 2), s: 1.1 });
  out.solids.push(rectCorners(lot.c, lot.u, lot.n, hw, hd - 0.3));
}

/** Terreno baldío: tierra, monte, alguna mata y cerca de postes con alambre de púas. Se puede caminar adentro. */
function buildBaldio(lot: Lot, bank: GeoBank, rnd: () => number, out: BuildingsOut): void {
  const f = new LotFrame(lot);
  const { hw, hd } = lot;
  const d = bank.get('dirt');
  const y = 0.015;
  d.quad(f.v(-hw, y, -hd), f.v(hw, y, -hd), f.v(hw, y, hd), f.v(-hw, y, hd), [lot.c.x / 6, lot.c.z / 6, lot.c.x / 6 + (hw * 2) / 6, lot.c.z / 6 + (hd * 2) / 6], tmpC.setScalar(0.9 + rnd() * 0.15));
  // Postes de madera cada 2,5 m en el perímetro (salvo un hueco de entrada) y 3 hilos de alambre
  const st = bank.get('stucco');
  const P: [number, number][] = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd], [-hw, hd]];
  const gap = (rnd() - 0.5) * hw;
  for (let k = 0; k < 4; k++) {
    const [a0, b0] = P[k]!, [a1, b1] = P[k + 1]!;
    const len = Math.hypot(a1 - a0, b1 - b0), n = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n, b = b0 + ((b1 - b0) * i) / n;
      if (k === 0 && Math.abs(a - gap) < 1.6) continue;
      f.box(st, a, b, 0.05, 0.05, 0, 1.3, 1, col('#6a5038'));
    }
    if (k === 0) continue;
    for (const hy of [0.4, 0.8, 1.2]) out.wires.push(f.x(a0, b0), hy, f.z(a0, b0), f.x(a1, b1), hy, f.z(a1, b1));
  }
  for (const hy of [0.4, 0.8, 1.2]) {
    out.wires.push(f.x(-hw, hd), hy, f.z(-hw, hd), f.x(gap - 1.6, hd), hy, f.z(gap - 1.6, hd));
    out.wires.push(f.x(gap + 1.6, hd), hy, f.z(gap + 1.6, hd), f.x(hw, hd), hy, f.z(hw, hd));
  }
  // Monte y matas
  for (let k = 0; k < 5 + Math.floor(rnd() * 6); k++) out.plants.push({ x: f.x((rnd() - 0.5) * hw * 1.8, (rnd() - 0.5) * hd * 1.8), z: f.z((rnd() - 0.5) * hw * 1.8, (rnd() - 0.5) * hd * 1.8) });
  if (rnd() < 0.6) out.yardPalms.push({ x: f.x((rnd() - 0.5) * hw, (rnd() - 0.5) * hd), z: f.z((rnd() - 0.5) * hw, (rnd() - 0.5) * hd) });
  if (rnd() < 0.5) out.backyardTrees.push({ x: f.x((rnd() - 0.5) * hw, -hd * 0.5), z: f.z((rnd() - 0.5) * hw, -hd * 0.5) });
}
