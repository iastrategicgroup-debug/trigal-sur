import * as THREE from 'three';

/** Parámetros de un personaje (protagonista o NPC). Todas las medidas en metros. */
export interface HumanParams {
  height: number;               // estatura
  muscle: number;               // 0..1
  fat: number;                  // 0..1
  female: boolean;
  skin: string;
  hair: { style: 'degradado' | 'corto' | 'calvo' | 'largo' | 'cola' | 'rizado'; color: string };
  face: { width: number; jaw: number; chin: number; smile: number; brow: string; browThick: number; eye: string };
  beard: { type: 'ninguna' | 'sombra' | 'candado' | 'completa'; color: string; density: number };
  glasses: string | null;
  shirt: { type: 'manga_larga' | 'manga_corta' | 'franelilla'; color: string; pattern: 'liso' | 'microcuadro' | 'rayas' | 'estampado'; buttons: boolean };
  pants: { type: 'jean' | 'jean_ancho' | 'short' | 'falda' | 'mono'; color: string };
  shoes: string;
  watch: boolean;
  cap?: string | null;          // gorra (color) o null
  hunch?: number;               // encorvamiento (ancianos) 0..1
  faceless?: boolean;           // criatura nocturna: rostro liso con cuencas vacías
}

export const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L',
  'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R',
] as const;
export type BoneName = typeof BONES[number];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

type W = [BoneName, number][];

/** Acumulador de malla con pesos de piel. Grupo 0 = cuerpo (color por vértice × tela), grupo 1 = cabeza (textura del rostro). */
class SkinBuilder {
  pos: number[] = []; uv: number[] = []; col: number[] = []; si: number[] = []; sw: number[] = [];
  idx: [number[], number[]] = [[], []];
  /** Franja de tela según el color (piel, algodón, jean, microcuadro, cabello). */
  bandOf: (c: THREE.Color) => number = () => 1;
  /** v dentro de la franja `band` (5 franjas en la textura de telas). */
  static vb(band: number, t: number): number { return (band + 0.08 + 0.84 * Math.min(1, Math.max(0, t))) / 5; }

  vert(p: THREE.Vector3, u: number, v: number, c: THREE.Color, w: W): number {
    this.pos.push(p.x, p.y, p.z); this.uv.push(u, v); this.col.push(c.r, c.g, c.b);
    const ws = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = ws.reduce((t, x) => t + x[1], 0) || 1;
    for (let i = 0; i < 4; i++) { const e = ws[i]; this.si.push(e ? BI[e[0]] : 0); this.sw.push(e ? e[1] / tot : 0); }
    return this.pos.length / 3 - 1;
  }
  tri(g: 0 | 1, a: number, b: number, c: number): void { this.idx[g].push(a, b, c); }

  /**
   * Tubo de anillos elípticos. Cada anillo: centro, radios (rx a lo largo de `side`, rz a lo largo de `front`), pesos y color.
   * `axis` define la dirección del tubo; `front` la referencia "hacia delante" (+Z).
   */
  rings(rs: { c: THREE.Vector3; rx: number; rz: number; w: W; color: THREE.Color; dz?: number; shape?: (a: number) => number; ao?: number; colorAt?: (a: number) => THREE.Color; folds?: number }[], sides: number, capStart = false, capEnd = false, g: 0 | 1 = 0): void {
    const base = this.pos.length / 3;
    for (let j = 0; j < rs.length; j++) {
      const r = rs[j]!;
      const next = rs[Math.min(j + 1, rs.length - 1)]!.c, prev = rs[Math.max(j - 1, 0)]!.c;
      const axis = new THREE.Vector3().subVectors(next, prev).normalize();
      const ref = Math.abs(axis.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const side = new THREE.Vector3().crossVectors(ref, axis).normalize();   // ~X
      const front = new THREE.Vector3().crossVectors(axis, side).normalize(); // ~Z
      if (front.z < 0 && Math.abs(axis.y) > 0.5) { front.negate(); side.negate(); }
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const fz = sa > 0 ? r.rz + (r.dz ?? 0) * sa * sa : r.rz; // barriga/pecho hacia delante
        const k = r.shape ? r.shape(a) : 1;                      // relieve muscular por ángulo
        const p = r.c.clone().addScaledVector(side, ca * r.rx * k).addScaledVector(front, sa * fz * k);
        const col = r.colorAt ? r.colorAt(a) : r.color;
        const band = this.bandOf(col);
        let outCol = r.ao ? col.clone().multiplyScalar(r.ao) : col;
        if (band >= 1 && band <= 3 && (r.folds ?? 1) > 0) {
          // Pliegues de tela: dos ondas cruzadas => crestas y valles en rombo; los valles se oscurecen
          const amp = (band === 2 ? 0.05 : 0.04) * (r.folds ?? 1);
          const fold = 0.5 * Math.sin(a * 5 + j * 1.9 + r.c.y * 30) + 0.5 * Math.sin(a * 3 - j * 1.3 + r.c.x * 40);
          p.addScaledVector(side, ca * r.rx * amp * fold).addScaledVector(front, sa * r.rz * amp * fold);
          outCol = outCol.clone().multiplyScalar(1 + fold * 0.16);
        }
        this.vert(p, (i / sides) * 0.5, SkinBuilder.vb(band, j / (rs.length - 1)), outCol, r.w);
      }
    }
    const S = sides + 1;
    for (let j = 0; j < rs.length - 1; j++) for (let i = 0; i < sides; i++) {
      const a = base + j * S + i, b = a + S;
      this.tri(g, a, a + 1, b); this.tri(g, b, a + 1, b + 1);
    }
    const cap = (j: number, flip: boolean) => {
      const r = rs[j]!;
      const c = this.vert(r.c, 0.25, SkinBuilder.vb(this.bandOf(r.color), 0.5), r.color, r.w);
      for (let i = 0; i < sides; i++) {
        const a = base + j * S + i;
        if (flip) this.tri(g, c, a + 1, a); else this.tri(g, c, a, a + 1);
      }
    };
    if (capStart) cap(0, false);
    if (capEnd) cap(rs.length - 1, true);
  }

  /** Elipsoide rígido (manos, zapatos, orejas, partes de lentes). */
  ellipsoid(c: THREE.Vector3, r: THREE.Vector3, color: THREE.Color, w: W, seg = 6, g: 0 | 1 = 0, flatBottom = false): void {
    const base = this.pos.length / 3;
    const rows = seg, cols = seg + 2;
    for (let j = 0; j <= rows; j++) {
      const ph = (j / rows) * Math.PI;
      for (let i = 0; i <= cols; i++) {
        const th = (i / cols) * Math.PI * 2;
        let y = Math.cos(ph) * r.y;
        if (flatBottom && y < -r.y * 0.4) y = -r.y * 0.4;
        this.vert(new THREE.Vector3(c.x + Math.sin(ph) * Math.cos(th) * r.x, c.y + y, c.z + Math.sin(ph) * Math.sin(th) * r.z), (i / cols) * 0.5, SkinBuilder.vb(this.bandOf(color), j / rows), color, w);
      }
    }
    const C = cols + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = base + j * C + i, b = a + C;
      this.tri(g, a, a + 1, b); this.tri(g, b, a + 1, b + 1);
    }
  }

  box(c: THREE.Vector3, h: THREE.Vector3, color: THREE.Color, w: W): void {
    const P = (x: number, y: number, z: number) => new THREE.Vector3(c.x + x * h.x, c.y + y * h.y, c.z + z * h.z);
    const faces: [number, number, number][][] = [
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
      [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
      [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
    ];
    for (const f of faces) {
      const ids = f.map(([x, y, z]) => this.vert(P(x, y, z), 0.25, SkinBuilder.vb(this.bandOf(color), 0.5), color, w));
      this.tri(0, ids[0]!, ids[1]!, ids[2]!); this.tri(0, ids[0]!, ids[2]!, ids[3]!);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex([...this.idx[0], ...this.idx[1]]);
    g.addGroup(0, this.idx[0].length, 0);
    g.addGroup(this.idx[0].length, this.idx[1].length, 1);
    g.computeVertexNormals();
    // Iluminación horneada: lo que mira hacia abajo (bajo el pecho, los glúteos, los brazos) se oscurece;
    // lo que mira arriba recibe un poco más de luz. Solo en el grupo del cuerpo (la cara tiene su textura pintada).
    const n = g.attributes.normal as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
    const bodyVerts = new Set(this.idx[0]);
    for (const i of bodyVerts) {
      const k = 0.72 + 0.36 * (n.getY(i) * 0.5 + 0.5);
      c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
    }
    return g;
  }
}

/** Posiciones de articulaciones en pose de reposo (A), en metros, mirando a +Z. */
export function joints(p: HumanParams) {
  const H = p.height;
  const sw = H * (p.female ? 0.105 : 0.115) + p.muscle * H * 0.018 + p.fat * H * 0.006; // semiancho de hombros
  const hipX = H * (p.female ? 0.062 : 0.055) + p.fat * H * 0.012;
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y * H, z);
  return {
    H, sw, hipX,
    root: v(0, 0), hips: v(0, 0.53), spine: v(0, 0.6), chest: v(0, 0.72), neck: v(0, 0.835), head: v(0, 0.875),
    shoulder_L: v(H * 0.04, 0.8), upperArm_L: v(sw, 0.797), foreArm_L: v(sw + H * 0.02, 0.625), hand_L: v(sw + H * 0.032, 0.475),
    shoulder_R: v(-H * 0.04, 0.8), upperArm_R: v(-sw, 0.797), foreArm_R: v(-sw - H * 0.02, 0.625), hand_R: v(-sw - H * 0.032, 0.475),
    thigh_L: v(hipX, 0.52), shin_L: v(hipX * 0.78, 0.285), foot_L: v(hipX * 0.8, 0.048),
    thigh_R: v(-hipX, 0.52), shin_R: v(-hipX * 0.78, 0.285), foot_R: v(-hipX * 0.8, 0.048),
  };
}

const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulder_L: 'chest', upperArm_L: 'shoulder_L', foreArm_L: 'upperArm_L', hand_L: 'foreArm_L',
  shoulder_R: 'chest', upperArm_R: 'shoulder_R', foreArm_R: 'upperArm_R', hand_R: 'foreArm_R',
  thigh_L: 'hips', shin_L: 'thigh_L', foot_L: 'shin_L', thigh_R: 'hips', shin_R: 'thigh_R', foot_R: 'shin_R',
};

/** Campana angular centrada en `c` (radianes), ancho `w`. */
const bump = (a: number, c: number, w: number) => { let d = a - c; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.exp(-(d * d) / (w * w)); };
const FRONT = Math.PI / 2, BACK = -Math.PI / 2;
const WHITE = new THREE.Color(1, 1, 1);
const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

/** Construye el personaje: SkinnedMesh con esqueleto, materiales y textura del rostro. */
export function buildHuman(p: HumanParams, fabric: THREE.Texture): { mesh: THREE.SkinnedMesh; bones: Record<BoneName, THREE.Bone>; height: number } {
  const J = joints(p);
  const H = J.H;
  const B = new SkinBuilder();
  const skin = new THREE.Color(p.skin);
  const shirt = new THREE.Color(p.shirt.color);
  const pants = new THREE.Color(p.pants.color);
  const shoe = new THREE.Color(p.shoes);
  const hairC = new THREE.Color(p.hair.color);
  const m = p.muscle, f = p.fat;
  B.bandOf = (c) => c === skin ? 0 : c === hairC ? 4 : c === shirt ? (p.shirt.pattern === 'microcuadro' ? 3 : 1) : c === pants ? (p.pants.type.startsWith('jean') ? 2 : 1) : 1;

  // ---------- Torso: pelvis -> cintura -> barriga -> pecho -> hombros ----------
  /** Columna en S: lordosis lumbar (cintura hacia delante), cifosis torácica (espalda alta hacia atrás). */
  const spineZ = (y: number) => (0.012 * Math.sin(((y - 0.5) / 0.34) * Math.PI) - 0.006 * smooth(0.72, 0.83, y)) * H;
  const tor = (y: number, rx: number, rz: number, dz: number, w: W, c: THREE.Color) => ({ c: new THREE.Vector3(0, y * H, spineZ(y)), rx: rx * H, rz: rz * H, dz: dz * H, w, color: c, shape: torsoShape(y) });
  const mm = p.muscle, ff = p.fat;
  /** Relieve del torso según la altura: pectorales (2 lóbulos y surco del esternón), omóplatos, oblicuos, abdomen. */
  function torsoShape(y: number): (a: number) => number {
    const pecs = p.female ? 0 : smooth(0.68, 0.72, y) * (1 - smooth(0.775, 0.8, y));
    const blades = smooth(0.7, 0.75, y) * (1 - smooth(0.79, 0.81, y));
    const waist = smooth(0.55, 0.6, y) * (1 - smooth(0.66, 0.7, y));
    const glutes = smooth(0.44, 0.48, y) * (1 - smooth(0.53, 0.57, y));
    const lats = smooth(0.66, 0.7, y) * (1 - smooth(0.76, 0.79, y));
    const trap = smooth(0.8, 0.815, y);
    return (a: number) => 1
      + glutes * (0.1 + ff * 0.06 + (p.female ? 0.06 : 0)) * (bump(a, BACK - 0.45, 0.4) + bump(a, BACK + 0.45, 0.4))   // glúteos
      - glutes * 0.04 * bump(a, BACK, 0.1)
      + lats * (0.03 + mm * 0.07) * (bump(a, BACK - 1.1, 0.45) + bump(a, BACK + 1.1, 0.45))                           // dorsales
      + trap * (0.08 + mm * 0.1) * (bump(a, BACK - 0.6, 0.5) + bump(a, BACK + 0.6, 0.5))                              // trapecio
      - trap * 0.06 * bump(a, FRONT, 0.6)                                                                             // clavículas hundidas adelante
      + pecs * (0.05 + mm * 0.12) * (bump(a, FRONT - 0.5, 0.42) + bump(a, FRONT + 0.5, 0.42))
      - pecs * mm * 0.05 * bump(a, FRONT, 0.15)
      + blades * (0.04 + mm * 0.06) * (bump(a, BACK - 0.55, 0.4) + bump(a, BACK + 0.55, 0.4))
      - blades * 0.03 * bump(a, BACK, 0.12)                               // columna
      - waist * mm * 0.07 * (bump(a, 0, 0.45) + bump(a, Math.PI, 0.45))   // cintura en V
      + waist * mm * 0.03 * bump(a, FRONT, 0.5) * (1 - ff);              // abdomen marcado
  }
  const fem = p.female;
  const hipRx = (fem ? 0.098 : 0.088) + f * 0.025;
  const waistRx = (fem ? 0.072 : 0.082) + f * 0.035 + m * 0.004;
  const chestRx = (fem ? 0.085 : 0.095) + m * 0.02 + f * 0.018;
  const belly = f * 0.045;
  const torsoRings = [
    { ...tor(0.465, hipRx * 0.92, 0.062 + f * 0.012, 0, [['hips', 1]], pants), ao: 0.72 },
    tor(0.5, hipRx * 0.98, 0.066 + f * 0.016, f * 0.008, [['hips', 1]], pants),
    tor(0.515, hipRx + 0.004, 0.07 + f * 0.018, f * 0.012, [['hips', 1]], p.shirt.type === 'franelilla' || p.pants.type === 'falda' ? pants : shirt), // ruedo de la camisa por fuera
    tor(0.565, Math.max(waistRx + f * 0.01, hipRx * 0.96), 0.064 + f * 0.02, belly * 0.7, [['hips', 0.6], ['spine', 0.4]], p.pants.type === 'falda' ? pants : shirt),
    tor(0.61, waistRx + f * 0.012, 0.062 + f * 0.022, belly, [['spine', 1]], shirt),
    tor(0.665, waistRx + 0.006 + m * 0.008, 0.066 + f * 0.016, belly * 0.6 + (fem ? 0.01 : 0), [['spine', 0.5], ['chest', 0.5]], shirt),
    tor(0.72, chestRx, 0.07 + m * 0.012 + f * 0.01, (fem ? 0.03 : 0.006) + m * 0.012, [['chest', 1]], shirt),
    tor(0.77, chestRx + 0.008 + m * 0.012, 0.066 + m * 0.01, (fem ? 0.022 : 0.004) + m * 0.01, [['chest', 1]], shirt),
    // Pendiente del trapecio: del deltoides al cuello (sin esquinas)
    tor(0.792, J.sw / H * 0.86, 0.066 + m * 0.012, 0, [['chest', 0.8], ['shoulder_L', 0.1], ['shoulder_R', 0.1]], shirt),
    tor(0.806, J.sw / H * 0.66, 0.06 + m * 0.01, 0, [['chest', 0.85], ['shoulder_L', 0.075], ['shoulder_R', 0.075]], shirt),
    tor(0.82, J.sw / H * 0.42, 0.05 + m * 0.008, 0, [['chest', 0.8], ['neck', 0.2]], shirt),
    tor(0.832, 0.046 + m * 0.01, 0.04, 0, [['chest', 0.6], ['neck', 0.4]], shirt),
  ];
  if (p.shirt.type === 'franelilla') {
    // Franelilla: escote redondo adelante y atrás; solo las tiras cubren los hombros
    for (const r of torsoRings) {
      const y = r.c.y / H;
      if (y < 0.755) continue;
      (r as typeof r & { colorAt?: (a: number) => THREE.Color }).colorAt = (a) => {
        const strap = Math.abs(Math.cos(a)) > (y > 0.8 ? 0.45 : 0.25);
        const scoop = y > 0.77 && (bump(a, FRONT, 0.75) > 0.45 || (y > 0.79 && bump(a, BACK, 0.6) > 0.5));
        return strap && !scoop ? shirt : skin;
      };
    }
  }
  B.rings(torsoRings, 16, true, false);
  // Cuello
  const neckR = (0.041 + m * 0.012 + f * 0.01) * H;
  B.rings([
    { c: new THREE.Vector3(0, 0.82 * H, -0.006 * H), rx: neckR * 1.08, rz: neckR * 0.98, w: [['neck', 1]], color: skin, ao: 0.7,
      shape: (a: number) => 1 + 0.08 * (bump(a, FRONT - 0.7, 0.35) + bump(a, FRONT + 0.7, 0.35)) - 0.05 * bump(a, FRONT, 0.2) }, // esternocleidomastoideo
    { c: new THREE.Vector3(0, 0.875 * H, 0), rx: neckR * 0.92, rz: neckR * 0.9, w: [['neck', 0.4], ['head', 0.6]], color: skin },
  ], 8);
  // Cuello de la camisa
  if (p.shirt.type !== 'franelilla') B.rings([
    { c: new THREE.Vector3(0, 0.828 * H, -0.004 * H), rx: neckR * 1.5, rz: neckR * 1.45, w: [['chest', 0.6], ['neck', 0.4]], color: shirt },
    { c: new THREE.Vector3(0, 0.852 * H, -0.006 * H), rx: neckR * 1.18, rz: neckR * 1.15, w: [['neck', 1]], color: shirt.clone().multiplyScalar(0.92) },
  ], 10);
  // Cinturón con hebilla
  if ((p.pants.type.startsWith('jean') || p.pants.type === 'short') && !p.female) {
    const belt = new THREE.Color(0x1c1612);
    B.rings([
      { c: new THREE.Vector3(0, 0.5 * H, spineZ(0.5) - 0.0), rx: hipRx * H * 1.0, rz: (0.068 + f * 0.016) * H, w: [['hips', 1]], color: belt },
      { c: new THREE.Vector3(0, 0.517 * H, spineZ(0.517)), rx: hipRx * H * 1.0, rz: (0.068 + f * 0.017) * H, w: [['hips', 1]], color: belt },
    ], 16);
    if (p.shirt.type === 'franelilla') B.box(new THREE.Vector3(0, 0.508 * H, spineZ(0.508) + (0.07 + f * 0.017) * H), new THREE.Vector3(0.016 * H, 0.009 * H, 0.003 * H), new THREE.Color(0xb8a060), [['hips', 1]]);
  }
  // Línea de botones (cuerpo) — pequeñas cajas
  if (p.shirt.buttons) for (let k = 0; k < 6; k++) {
    const y = 0.57 + k * 0.042;
    const ring = torsoRings.reduce((best, r) => (Math.abs(r.c.y / H - y) < Math.abs(best.c.y / H - y) ? r : best));
    B.box(new THREE.Vector3(0, y * H, ring.rz + ring.dz + 0.002), new THREE.Vector3(0.004, 0.004, 0.002), new THREE.Color(0xe8e4dc), [['spine', 0.5], ['chest', 0.5]]);
  }

  // ---------- Brazos ----------
  for (const s of ['L', 'R'] as const) {
    const sg = s === 'L' ? 1 : -1;

    const up = J[`upperArm_${s}`], el = J[`foreArm_${s}`], wr = J[`hand_${s}`];
    const ua = `upperArm_${s}` as BoneName, fa = `foreArm_${s}` as BoneName, ha = `hand_${s}` as BoneName, sh = `shoulder_${s}` as BoneName;
    const rUp = (0.032 + m * 0.013 + f * 0.011) * H, rEl = (0.027 + m * 0.006 + f * 0.006) * H, rWr = (0.02 + m * 0.003) * H;
    const sleeveLong = p.shirt.type === 'manga_larga';
    const sleeveShort = p.shirt.type === 'manga_corta';
    const N = 7;
    const arm: Parameters<SkinBuilder['rings']>[0] = [];
    // hombro (deltoides)
    const armDir = new THREE.Vector3().subVectors(up, el).normalize(); // del codo al hombro
    // Deltoides en forma de cúpula (redondo, sin pico)
    const capCol = p.shirt.type === 'franelilla' ? skin : shirt;
    arm.push({ c: up.clone().addScaledVector(armDir, 0.02 * H).add(new THREE.Vector3(-sg * 0.016 * H, 0, 0)), rx: rUp * 0.35, rz: rUp * 0.45, w: [[sh, 0.6], [ua, 0.4]], color: capCol, ao: 0.85 });
    arm.push({ c: up.clone().addScaledVector(armDir, 0.012 * H).add(new THREE.Vector3(-sg * 0.006 * H, 0, 0)), rx: rUp * 0.85, rz: rUp * 0.95, w: [[sh, 0.45], [ua, 0.55]], color: capCol });
    arm.push({ c: up.clone().add(new THREE.Vector3(0, -0.008 * H, 0)), rx: rUp * 1.1, rz: rUp * 1.12, w: [[sh, 0.3], [ua, 0.7]], color: capCol });
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const c = up.clone().lerp(el, t);
      const bulge = Math.sin(t * Math.PI) * m * 0.008 * H; // bíceps
      const r = THREE.MathUtils.lerp(rUp, rEl, t) + bulge;
      const covered = sleeveLong || (sleeveShort && t < 0.45) || (p.shirt.type === 'franelilla' && t < 0.0);
      const bi = Math.sin(Math.min(1, t * 1.2) * Math.PI);
      arm.push({ folds: 1 + 1.5 * Math.exp(-((t - 1) ** 2) / 0.02), c, rx: r, rz: r * 1.05, w: [[ua, 1 - smooth(0.75, 1, t) * 0.5], [fa, smooth(0.75, 1, t) * 0.5]], color: covered ? shirt : skin,
        shape: (a) => 1 + bi * ((0.05 + m * 0.2) * bump(a, FRONT, 0.6) + (0.04 + m * 0.12) * bump(a, BACK, 0.7)) });
    }
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const c = el.clone().lerp(wr, t);
      const r = THREE.MathUtils.lerp(rEl * 1.05, rWr, t) + Math.sin(t * Math.PI * 0.8) * m * 0.004 * H;
      const cuff = sleeveLong && t > 0.88;
      const fo = Math.sin(Math.min(1, t * 2.2) * Math.PI) * (1 - t);
      arm.push({ folds: 1 + 1.5 * Math.exp(-(t * t) / 0.02) + (t > 0.85 ? 1 : 0), shape: (a) => 1 + fo * (0.06 + m * 0.12) * bump(a, FRONT + 0.6, 0.8), c, rx: r * (cuff ? 1.15 : 1), rz: r * 0.9 * (cuff ? 1.15 : 1), w: [[fa, 1 - smooth(0.8, 1, t) * 0.5], [ha, smooth(0.8, 1, t) * 0.5], [ua, (1 - smooth(0, 0.2, t)) * 0.4]], color: sleeveLong ? shirt : skin });
    }
    B.rings(arm, 10, true, true);
    // Mano: palma + 4 dedos (3 falanges, ligeramente flexionados) + pulgar
    const dir = new THREE.Vector3().subVectors(wr, el).normalize();
    const inward = new THREE.Vector3(-sg, 0, 0);              // hacia el cuerpo (la palma mira hacia dentro)
    const fwd = new THREE.Vector3(0, 0, 1);
    const palmC = wr.clone().addScaledVector(dir, 0.04 * H);
    B.ellipsoid(palmC, new THREE.Vector3(0.014 * H, 0.04 * H, 0.028 * H), skin, [[ha, 1]], 6);
    const fingerLen = [0.044, 0.05, 0.047, 0.038];
    for (let k = 0; k < 4; k++) {
      const off = (1.5 - k) * 0.0118 * H;                    // índice adelante, meñique atrás
      let pnt = palmC.clone().addScaledVector(dir, 0.035 * H).addScaledVector(fwd, off).addScaledVector(inward, 0.003 * H);
      const ring: Parameters<SkinBuilder['rings']>[0] = [];
      let d = dir.clone();
      const seg = (fingerLen[k]! * H) / 3;
      for (let jj = 0; jj <= 3; jj++) {
        const rr = (0.0074 - jj * 0.0008) * H;
        ring.push({ c: pnt.clone(), rx: rr, rz: rr * 0.95, w: [[ha, 1]], color: skin });
        pnt = pnt.clone().addScaledVector(d, seg);
        d = d.clone().addScaledVector(inward, 0.75).normalize(); // flexión hacia la palma (mano relajada / puño)
      }
      B.rings(ring, 6, false, true);
    }
    // Pulgar: sale del lado delantero de la palma, hacia delante y abajo
    {
      let pnt = palmC.clone().addScaledVector(dir, -0.012 * H).addScaledVector(fwd, 0.026 * H).addScaledVector(inward, 0.006 * H);
      let d = dir.clone().addScaledVector(fwd, 0.8).addScaledVector(inward, 0.3).normalize();
      const ring: Parameters<SkinBuilder['rings']>[0] = [];
      for (let jj = 0; jj <= 3; jj++) {
        const rr = (0.0075 - jj * 0.0009) * H;
        ring.push({ c: pnt.clone(), rx: rr, rz: rr, w: [[ha, 1]], color: skin });
        pnt = pnt.clone().addScaledVector(d, 0.016 * H);
        d = d.clone().addScaledVector(inward, 0.35).addScaledVector(dir, 0.3).normalize();
      }
      B.rings(ring, 6, false, true);
    }
    // Reloj en la muñeca izquierda
    if (p.watch && s === 'L') B.ellipsoid(wr.clone().addScaledVector(dir, -0.012 * H), new THREE.Vector3(rWr * 1.25, 0.012 * H, rWr * 1.25), new THREE.Color(0x111111), [[fa, 1]], 5);
  }

  // ---------- Piernas ----------
  for (const s of ['L', 'R'] as const) {
    const th = J[`thigh_${s}`], kn = J[`shin_${s}`], an = J[`foot_${s}`];
    const tb = `thigh_${s}` as BoneName, sb = `shin_${s}` as BoneName, fb = `foot_${s}` as BoneName;
    const rTh = (0.04 + m * 0.01 + f * 0.016 + (fem ? 0.006 : 0)) * H, rKn = (0.031 + f * 0.006) * H, rAn = (0.021 + f * 0.003) * H;
    const legCol = (t: number) => {
      if (p.pants.type.startsWith('jean') || p.pants.type === 'mono') return pants;
      if (p.pants.type === 'short') return t < 0.45 ? pants : skin;
      return t < 0.6 ? pants : skin; // falda: muslo cubierto por la falda (se dibuja aparte)
    };
    const leg: Parameters<SkinBuilder['rings']>[0] = [];
    const N = 6;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const c = th.clone().lerp(kn, t).add(new THREE.Vector3(0, 0.012 * H * (1 - t), 0));
      const baggy = p.pants.type === 'jean_ancho';
      const r = baggy ? THREE.MathUtils.lerp(rTh * 1.28, rTh * 1.12, t) : THREE.MathUtils.lerp(rTh, rKn, Math.pow(t, 0.8));
      const q = baggy ? 0.15 : Math.sin(Math.min(1, t * 1.1) * Math.PI);
      leg.push({ folds: 1 + 1.2 * Math.exp(-((t - 1) ** 2) / 0.02) + 0.6 * Math.exp(-(t * t) / 0.01), shape: (a) => 1 + q * ((0.05 + m * 0.12) * bump(a, FRONT, 0.7) + 0.04 * bump(a, BACK, 0.6) + (0.03 + m * 0.06) * bump(a, FRONT - 1.1, 0.5)), c, rx: r * 0.95, rz: r, w: [[tb, 1 - smooth(0.8, 1, t) * 0.5], [sb, smooth(0.8, 1, t) * 0.5], ['hips', (1 - smooth(0, 0.25, t)) * 0.5]], color: legCol(t * 0.5) });
    }
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const c = kn.clone().lerp(an, t);
      const calf = Math.sin(Math.min(1, t * 1.6) * Math.PI) * (0.008 + m * 0.006) * H;
      const baggy = p.pants.type === 'jean_ancho';
      // Jean ancho: pierna recta y amplia que se arruga ("se apila") sobre el zapato
      const stack = baggy && t > 0.62 ? 1 + 0.09 * Math.sin((t - 0.62) * 48) : 1;
      const r = baggy ? rTh * (1.1 + 0.06 * t) * stack : THREE.MathUtils.lerp(rKn, rAn, t) + calf;
      const jeanFlare = p.pants.type === 'jean' || p.pants.type === 'mono' ? 0.004 * H * t : 0;
      if (baggy && k === N) c.y -= 0.03 * H; // el ruedo cubre la parte de arriba del zapato
      const cv = baggy ? 0 : Math.sin(Math.min(1, t * 1.8) * Math.PI) * (t < 0.6 ? 1 : 0.4);
      leg.push({ folds: 1 + 1.2 * Math.exp(-(t * t) / 0.02) + (t > 0.7 ? 1.8 : 0), shape: (a) => 1 + cv * (0.08 + m * 0.14) * bump(a, BACK, 0.9), c: c.add(new THREE.Vector3(0, 0, -calf * 0.4)), rx: r + jeanFlare, rz: r + jeanFlare, w: [[sb, 1 - smooth(0.85, 1, t) * 0.5], [fb, smooth(0.85, 1, t) * 0.5], [tb, (1 - smooth(0, 0.2, t)) * 0.4]], color: legCol(0.5 + t * 0.5) });
    }
    B.rings(leg, 10);
    // Zapato con suela diferenciada
    const fc = an.clone().add(new THREE.Vector3(0, -0.02 * H, 0.04 * H));
    const chunky = p.pants.type === 'jean_ancho' || p.shoes === '#f0f0f0' ? 1.15 : 1;
    B.ellipsoid(fc.clone().add(new THREE.Vector3(0, 0.01 * H, 0)), new THREE.Vector3(0.034 * H * chunky, 0.032 * H, 0.077 * H * chunky), shoe, [[fb, 1]], 7, 0, true);
    B.box(fc.clone().add(new THREE.Vector3(0, -0.016 * H, 0.002 * H)), new THREE.Vector3(0.036 * H * chunky, 0.008 * H * chunky, 0.078 * H * chunky), new THREE.Color(0x1a1612).lerp(new THREE.Color(0xe8e0d0), chunky > 1 ? 1 : 0.15), [[fb, 1]]);
  }
  // Falda
  if (p.pants.type === 'falda') {
    B.rings([
      { c: new THREE.Vector3(0, 0.56 * H, 0), rx: (waistRx + 0.004) * H, rz: (0.064 + f * 0.02) * H, w: [['hips', 1]], color: pants },
      { c: new THREE.Vector3(0, 0.47 * H, 0), rx: (hipRx + 0.03) * H, rz: (0.09 + f * 0.02) * H, w: [['hips', 0.6], ['thigh_L', 0.2], ['thigh_R', 0.2]], color: pants },
      { c: new THREE.Vector3(0, 0.36 * H, 0), rx: (hipRx + 0.05) * H, rz: (0.11 + f * 0.02) * H, w: [['hips', 0.4], ['thigh_L', 0.3], ['thigh_R', 0.3]], color: pants },
    ], 12);
  }

  // ---------- Cabeza ----------
  const headH = H / 7.6;
  const hc = new THREE.Vector3(0, 0.875 * H + headH * 0.4, 0.008 * H);
  const hrx = headH * 0.37 * p.face.width * (1 + f * 0.08), hry = headH * 0.52, hrz = headH * 0.46;
  {
    const rows = 28, cols = 44;
    const base = B.pos.length / 3;
    const G = (dx: number, dy: number, sx: number, sy: number) => Math.exp(-(dx * dx) / sx - (dy * dy) / sy);
    for (let j = 0; j <= rows; j++) {
      const ph = (j / rows) * Math.PI; // 0 = arriba
      for (let i = 0; i <= cols; i++) {
        const th = (i / cols) * Math.PI * 2 - Math.PI / 2; // i=cols/2 => frente (+Z)
        let x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th);
        // Deformaciones: mandíbula, mentón, pómulos, frente
        const low = Math.max(0, -y);
        const jaw = 1 - low * (1 - p.face.jaw) * 1.2 - low * low * 0.35 + f * low * 0.15;
        x *= jaw * (1 + 0.06 * Math.exp(-((y - 0.05) ** 2) / 0.02)); // pómulos
        if (z > 0) z *= 1 + low * 0.18 * p.face.chin * Math.max(0, z);      // mentón adelante
        if (y > 0.3 && z > 0) z *= 0.96;                                    // frente
        if (z < 0) z *= 1.05;                                              // occipital
        // Relieve facial (solo de frente): cuencas, arco de las cejas, nariz, pómulos, labios, mentón, ángulo de la mandíbula
        const ux = x, uy = y; // coordenadas de la textura (deben coincidir con lo pintado)
        if (z > 0.2) {
          const fz = Math.min(1, (z - 0.2) / 0.4);
          let dz = 0;
          dz -= 0.11 * (G(ux - 0.33, uy - 0.06, 0.02, 0.012) + G(ux + 0.33, uy - 0.06, 0.02, 0.012));          // cuencas
          dz += 0.08 * G(0, uy - 0.2, 0.3, 0.006) * (Math.abs(ux) < 0.62 ? 1 : 0.3);                        // arco superciliar
          const noseAmt = uy < 0.14 && uy > -0.32 ? 0.06 + 0.24 * Math.min(1, (0.14 - uy) / 0.38) : 0;        // puente -> punta (~3 cm)
          dz += noseAmt * G(ux, 0, 0.007 + Math.max(0, 0.06 - uy) * 0.05, 1) * (uy < -0.27 ? Math.max(0, 1 - (-0.27 - uy) * 10) : 1);
          dz += 0.08 * (G(ux - 0.1, uy + 0.27, 0.005, 0.003) + G(ux + 0.1, uy + 0.27, 0.005, 0.003));       // aletas de la nariz
          dz += 0.06 * (G(ux - 0.45, uy + 0.02, 0.025, 0.015) + G(ux + 0.45, uy + 0.02, 0.025, 0.015));      // pómulos
          dz += 0.08 * G(ux, uy + 0.44, 0.045, 0.003) + 0.075 * G(ux, uy + 0.52, 0.04, 0.003);              // labios
          dz -= 0.045 * G(ux, uy + 0.61, 0.05, 0.003);                                                       // surco bajo el labio
          dz += 0.1 * G(ux, uy + 0.78, 0.04, 0.014) * p.face.chin;                                          // mentón
          z += dz * fz;
          x *= 1 + 0.05 * G(Math.abs(ux) - 0.6, uy + 0.55, 0.02, 0.02) * p.face.jaw;                          // ángulo mandibular
        }
        const P = new THREE.Vector3(hc.x + x * hrx, hc.y + y * hry, hc.z + z * hrz);
        // UV frontal: proyección plana; la parte de atrás va a una esquina lisa (piel)
        const front = z > -0.15;
        const fu = front ? 0.5 + ux * 0.5 : 0.02, fv = front ? 0.5 + uy * 0.5 : 0.02;
        B.vert(P, 0.5 + fu * 0.5, (64 + fv * 256) / 320, WHITE, [['head', 1]]);
      }
    }
    const C = cols + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = base + j * C + i, b = a + C;
      B.tri(1, a, a + 1, b); B.tri(1, b, a + 1, b + 1);
    }
  }
  // Orejas
  for (const sg of [1, -1]) B.ellipsoid(new THREE.Vector3(sg * hrx * 0.98, hc.y - headH * 0.02, hc.z - headH * 0.04), new THREE.Vector3(0.005 * H, 0.028 * H, 0.016 * H), skin.clone().multiplyScalar(0.92), [['head', 1]], 4);
  // Cabello
  if (p.hair.style !== 'calvo') {
    const rows = 9, cols = 14;
    const base = B.pos.length / 3;
    const keep: boolean[] = [];
    for (let j = 0; j <= rows; j++) {
      const ph = (j / rows) * Math.PI * 0.62;
      for (let i = 0; i <= cols; i++) {
        const th = (i / cols) * Math.PI * 2 - Math.PI / 2;
        let x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th);
        const frontness = Math.max(0, z);
        // Línea del cabello: más alta en la frente; el degradado deja los lados cortos (pegados)
        const hairline = p.hair.style === 'degradado' ? 0.42 + frontness * 0.12 : 0.42 - frontness * 0.1; // degradado: frente despejada
        const isSide = Math.abs(x) > 0.6 && z < 0.5;
        const thick = (p.hair.style === 'degradado' ? (isSide ? 1.035 : 1.07) : p.hair.style === 'rizado' ? 1.14 : 1.06) * (z < 0 ? 1.06 : 1); // atrás el cráneo es más prominente
        // Copete: frente-arriba levantado
        const lift = p.hair.style === 'degradado' ? Math.max(0, z) * Math.max(0, y - 0.6) * 0.35 : 0;
        y += lift;
        const fade = p.hair.style === 'degradado' ? smooth(0.4, 0.8, y) : 1;      // 0 lados/nuca (rapado) .. 1 coronilla
        const th2 = p.hair.style === 'degradado' ? THREE.MathUtils.lerp(1.02 * (z < 0 ? 1.1 : 1), 1.075 * (z < 0 ? 1.06 : 1), fade) : thick;
        const P = new THREE.Vector3(hc.x + x * hrx * th2, hc.y + y * hry * (th2 - 0.01) + headH * 0.02, hc.z + z * hrz * th2);
        keep.push(y > hairline || (z < -0.12 && y > -0.42)); // nuca cubierta hasta abajo (solo detrás de las orejas)
        const hcol = p.hair.style === 'degradado' ? hairC.clone().lerp(skin.clone().multiplyScalar(0.5), (1 - smooth(0.25, 0.7, y)) * 0.6) : hairC;
        B.vert(P, (i / cols) * 0.5, SkinBuilder.vb(4, j / rows), hcol, [['head', 1]]);
      }
    }
    const C = cols + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = base + j * C + i, b = a + C;
      if (!keep[j * C + i] && !keep[(j + 1) * C + i] && !keep[j * C + i + 1]) continue;
      B.tri(0, a, a + 1, b); B.tri(0, b, a + 1, b + 1);
    }
    if (p.hair.style === 'largo' || p.hair.style === 'cola') {
      const long = p.hair.style === 'largo';
      B.rings([
        { c: new THREE.Vector3(0, hc.y + headH * 0.1, hc.z - hrz * 0.6), rx: hrx * (long ? 1.02 : 0.4), rz: hrz * (long ? 0.5 : 0.35), w: [['head', 1]], color: hairC },
        { c: new THREE.Vector3(0, hc.y - headH * 0.5, hc.z - hrz * 0.85), rx: hrx * (long ? 1.0 : 0.25), rz: hrz * 0.3, w: [['head', 0.7], ['neck', 0.3]], color: hairC },
        { c: new THREE.Vector3(0, hc.y - headH * (long ? 1.0 : 0.9), hc.z - hrz * 0.9), rx: hrx * (long ? 0.9 : 0.12), rz: hrz * 0.15, w: [['neck', 0.5], ['chest', 0.5]], color: hairC },
      ], 10, false, true);
    }
  }
  // Gorra
  if (p.cap) {
    const cc = new THREE.Color(p.cap);
    B.ellipsoid(new THREE.Vector3(hc.x, hc.y + hry * 0.35, hc.z - hrz * 0.02), new THREE.Vector3(hrx * 1.1, hry * 0.55, hrz * 1.1), cc, [['head', 1]], 7, 0, true);
    B.box(new THREE.Vector3(hc.x, hc.y + hry * 0.2, hc.z + hrz * 1.15), new THREE.Vector3(hrx * 0.75, 0.004 * H, hrz * 0.4), cc.clone().multiplyScalar(0.8), [['head', 1]]);
  }
  // Lentes: aros rectangulares, puente y patas
  if (p.glasses) {
    const gc = new THREE.Color(p.glasses);
    const ey = hc.y + headH * 0.07, ez = hc.z + hrz * 0.97;
    for (const sg of [1, -1]) {
      const cx = sg * hrx * 0.4, w2 = hrx * 0.25, h2 = headH * 0.065, t = 0.0019 * H;
      B.box(new THREE.Vector3(cx, ey + h2, ez), new THREE.Vector3(w2, t, t), gc, [['head', 1]]);
      B.box(new THREE.Vector3(cx, ey - h2, ez), new THREE.Vector3(w2, t * 0.8, t), gc, [['head', 1]]);
      B.box(new THREE.Vector3(cx + w2, ey, ez), new THREE.Vector3(t, h2, t), gc, [['head', 1]]);
      B.box(new THREE.Vector3(cx - w2, ey, ez), new THREE.Vector3(t, h2, t), gc, [['head', 1]]);
      B.box(new THREE.Vector3(sg * hrx * 0.99, ey + h2 * 0.6, hc.z + hrz * 0.4), new THREE.Vector3(t, t, hrz * 0.6), gc, [['head', 1]]);
    }
    B.box(new THREE.Vector3(0, ey + headH * 0.04, ez), new THREE.Vector3(hrx * 0.13, 0.0017 * H, 0.0017 * H), gc, [['head', 1]]);
  }

  // ---------- Esqueleto ----------
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
    const par = PARENT[name];
    const wp = (J as unknown as Record<string, THREE.Vector3>)[name]!;
    if (par) {
      const pp = (J as unknown as Record<string, THREE.Vector3>)[par]!;
      b.position.copy(wp).sub(pp);
      bones[par].add(b);
    } else b.position.copy(wp);
  }
  const skeleton = new THREE.Skeleton(BONES.map((n) => bones[n]));
  const geo = B.geometry();
  geo.clearGroups();
  const atlas = document.createElement('canvas'); atlas.width = 512; atlas.height = 320;
  const ag = atlas.getContext('2d')!;
  ag.drawImage(fabric.image as HTMLCanvasElement, 0, 0, 256, 320);
  ag.drawImage(faceTexture(p).image as HTMLCanvasElement, 256, 0, 256, 256);
  const atlasTex = new THREE.CanvasTexture(atlas);
  atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 4;
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, map: atlasTex, shininess: 16, specular: new THREE.Color(0x1e1c1a) });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(bones.root);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  // Esfera envolvente generosa (cubre poses de golpe, caída y muerte) => se puede descartar fuera de cámara
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H * 0.5, 0), H * 0.85);
  mesh.frustumCulled = true;
  return { mesh, bones, height: H };
}

/** Pinta el rostro (256×256) a partir de los parámetros. La cara ocupa el centro; los bordes son piel lisa. */
export function faceTexture(p: HumanParams): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const skin = new THREE.Color(p.skin);
  const hex = (col: THREE.Color, k = 1) => col.clone().multiplyScalar(k).getStyle(); // getStyle devuelve sRGB
  g.fillStyle = hex(skin); g.fillRect(0, 0, S, S);
  if (p.faceless) {
    // Piel tirante, venas y cuencas hundidas; sin ojos ni boca
    for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(40,30,50,0.25)'; g.lineWidth = 1; g.beginPath(); let x = Math.random() * S, y = Math.random() * S; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 30; y += Math.random() * 20; g.lineTo(x, y); } g.stroke(); }
    for (const sx of [-0.34, 0.34]) { const gr = g.createRadialGradient(S * (0.5 + sx * 0.5), S * 0.45, 2, S * (0.5 + sx * 0.5), S * 0.45, 30); gr.addColorStop(0, 'rgba(5,0,5,0.95)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
    g.strokeStyle = 'rgba(20,10,15,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(S * 0.36, S * 0.77); g.quadraticCurveTo(S * 0.5, S * 0.8, S * 0.64, S * 0.77); g.stroke();
    const t0 = new THREE.CanvasTexture(c); t0.colorSpace = THREE.SRGBColorSpace; return t0;
  }
  // Pintura de rostro al estilo de la época: sombreado horneado (luz desde arriba y de frente),
  // volúmenes con degradados suaves, rasgos naturales. u = 0.5 + x/2, v = 0.5 + y/2 (y arriba).
  const X = (x: number) => S * (0.5 + x * 0.5), Y = (y: number) => S * (0.5 - y * 0.5);
  const sk = skin;
  const shade = (k: number, a: number) => { const c2 = sk.clone().multiplyScalar(k); c2.r *= 0.92; c2.b *= 0.85; return `rgba(${Math.round(c2.r * 255)},${Math.round(c2.g * 255)},${Math.round(c2.b * 255)},${a})`; };
  const light = (a: number) => { const c2 = sk.clone().lerp(new THREE.Color(1, 0.95, 0.88), 0.45); return `rgba(${Math.round(c2.r * 255)},${Math.round(c2.g * 255)},${Math.round(c2.b * 255)},${a})`; };
  const blob = (x: number, y: number, rx: number, ry: number, col: string, rot = 0) => {
    g.save(); g.translate(X(x), Y(y)); g.rotate(rot); g.scale(rx * S, ry * S);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, col); gr.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
  };
  // Piel con variación sutil
  let sd = 11; const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) blob(rr() * 2 - 1, rr() * 2 - 1, 0.05 + rr() * 0.1, 0.05 + rr() * 0.1, rr() < 0.5 ? shade(0.9, 0.12) : light(0.08));
  // Volúmenes grandes: frente iluminada, sienes y laterales en sombra, mejillas, mandíbula
  blob(0, 0.6, 0.55, 0.3, light(0.35));
  for (const sg of [1, -1]) {
    blob(sg * 0.8, 0.1, 0.25, 0.7, shade(0.62, 0.55));           // laterales de la cara
    blob(sg * 0.44, -0.06, 0.2, 0.12, light(0.3));                // pómulos
    blob(sg * 0.4, -0.3, 0.17, 0.2, shade(0.78, 0.35));           // mejilla hundida bajo el pómulo
    blob(sg * 0.6, -0.55, 0.22, 0.25, shade(0.7, 0.4));           // ángulo de la mandíbula
  }
  blob(0, -0.95, 0.6, 0.18, shade(0.55, 0.55));                   // bajo la mandíbula
  blob(0, -0.78, 0.18, 0.1, light(0.3));                          // mentón
  // Arco superciliar y cuencas
  for (const sg of [1, -1]) {
    blob(sg * 0.34, 0.2, 0.22, 0.06, light(0.25));
    blob(sg * 0.33, 0.08, 0.2, 0.12, shade(0.55, 0.55));
    blob(sg * 0.22, 0.03, 0.08, 0.08, shade(0.5, 0.4));           // lagrimal / junto a la nariz
    blob(sg * 0.33, -0.06, 0.16, 0.05, shade(0.7, 0.35));         // ojera
  }
  // Barba: sombra continua + puntos finos
  if (p.beard.type !== 'ninguna') {
    const bc = new THREE.Color(p.beard.color);
    const dens = p.beard.type === 'completa' ? 0.95 : p.beard.type === 'candado' ? 0.8 : p.beard.density;
    const bcol = (a: number) => `rgba(${Math.round(bc.r * 255)},${Math.round(bc.g * 255)},${Math.round(bc.b * 255)},${a})`;
    if (p.beard.type === 'candado') { blob(0, -0.66, 0.22, 0.2, bcol(0.55 * dens)); blob(0, -0.38, 0.2, 0.05, bcol(0.5 * dens)); }
    else {
      for (const sg of [1, -1]) blob(sg * 0.5, -0.5, 0.3, 0.38, bcol(0.4 * dens));
      blob(0, -0.72, 0.4, 0.22, bcol(0.5 * dens)); blob(0, -0.38, 0.22, 0.05, bcol(0.45 * dens));
    }
    for (let i = 0; i < 2200 * dens; i++) {
      const x = (rr() - 0.5) * 1.5, y = -0.3 - rr() * 0.7;
      if (Math.abs(x) > 0.75 - (y + 1) * 0.05 || (Math.abs(x) < 0.25 && y > -0.56 && y < -0.42)) continue;
      if (p.beard.type === 'candado' && !(Math.abs(x) < 0.3 && y < -0.42) && !(Math.abs(x) < 0.22 && y > -0.42 && y < -0.34)) continue;
      g.fillStyle = bcol(0.35 + dens * 0.3); g.fillRect(X(x), Y(y), 1.2, 1.2);
    }
  }
  // Ojos: almendrados, más pequeños y oscuros; párpado superior grueso en sombra
  const eyeY = 0.06, eyeX = 0.33;
  for (const sg of [1, -1]) {
    const cx = X(sg * eyeX), cy = Y(eyeY);
    g.save();
    g.beginPath(); g.moveTo(cx - 15, cy + 1); g.quadraticCurveTo(cx - 2, cy - 8, cx + 15, cy); g.quadraticCurveTo(cx + 2, cy + 6, cx - 15, cy + 1); g.closePath();
    g.fillStyle = '#d9cfc3'; g.fill(); g.clip();
    const ix = cx - sg * 0.5;
    g.fillStyle = p.face.eye; g.beginPath(); g.arc(ix, cy - 0.5, 5.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.beginPath(); g.arc(ix, cy - 0.5, 2.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(cx - 16, cy - 9, 32, 5);          // sombra del párpado sobre el ojo
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(ix + 1.5, cy - 3, 1.5, 1.5);  // brillo
    g.strokeStyle = 'rgba(25,15,10,0.9)'; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - 15, cy + 1); g.quadraticCurveTo(cx - 2, cy - 8.5, cx + 15, cy); g.stroke();   // línea del párpado
    g.strokeStyle = shade(0.6, 0.6); g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(cx - 14, cy - 5); g.quadraticCurveTo(cx - 1, cy - 14, cx + 15, cy - 5); g.stroke(); // pliegue
    g.strokeStyle = shade(0.75, 0.5); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx - 12, cy + 3); g.quadraticCurveTo(cx, cy + 6, cx + 13, cy + 2); g.stroke();      // párpado inferior
    // Ceja: masa + pelos inclinados
    const bc = p.face.brow;
    g.globalAlpha = 0.5; g.strokeStyle = bc; g.lineWidth = 3 + p.face.browThick * 5;
    g.beginPath(); g.moveTo(cx - sg * 18, Y(eyeY + 0.14)); g.quadraticCurveTo(cx - sg * 2, Y(eyeY + 0.2), cx + sg * 20, Y(eyeY + 0.15)); g.stroke();
    g.globalAlpha = 0.85; g.lineWidth = 1;
    for (let k = 0; k < 30; k++) { const t2 = k / 29; const bx = cx - sg * 18 + sg * 38 * t2, by = Y(eyeY + 0.14 + Math.sin(t2 * Math.PI) * 0.055) + 2 + rr() * 2; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + sg * (3 + t2 * 3), by - 3 - p.face.browThick * 2); g.stroke(); }
    g.globalAlpha = 1;
  }
  // Nariz: puente iluminado, laterales en sombra, punta y aletas, sombra bajo la nariz
  blob(0, -0.05, 0.05, 0.2, light(0.45));
  for (const sg of [1, -1]) { blob(sg * 0.1, -0.08, 0.06, 0.2, shade(0.65, 0.5)); blob(sg * 0.13, -0.26, 0.06, 0.05, shade(0.6, 0.55)); }
  blob(0, -0.24, 0.07, 0.05, light(0.5));
  g.fillStyle = shade(0.35, 0.8);
  for (const sg of [1, -1]) { g.beginPath(); g.ellipse(X(sg * 0.075), Y(-0.29), 4.5, 2.4, sg * 0.3, 0, Math.PI * 2); g.fill(); }
  blob(0, -0.33, 0.12, 0.035, shade(0.6, 0.55));
  blob(0, -0.37, 0.035, 0.04, shade(0.75, 0.35));               // filtrum
  // Surcos nasogenianos
  for (const sg of [1, -1]) {
    g.strokeStyle = shade(0.6, 0.35); g.lineWidth = 3;
    g.beginPath(); g.moveTo(X(sg * 0.2), Y(-0.28)); g.quadraticCurveTo(X(sg * (0.3 + p.face.smile * 0.05)), Y(-0.42), X(sg * 0.26), Y(-0.55)); g.stroke();
  }
  // Boca: labio superior oscuro, inferior más claro y lleno, comisuras, sombra bajo el labio
  const sm = p.face.smile * 0.6;
  const lip = sk.clone().lerp(new THREE.Color(0.55, 0.25, 0.22), 0.45);
  const lipS = (k: number, a: number) => `rgba(${Math.round(lip.r * 255 * k)},${Math.round(lip.g * 255 * k)},${Math.round(lip.b * 255 * k)},${a})`;
  g.fillStyle = lipS(0.75, 0.9);
  g.beginPath(); g.moveTo(X(-0.22), Y(-0.46 + sm * 0.03)); g.quadraticCurveTo(X(-0.08), Y(-0.41), X(0), Y(-0.43)); g.quadraticCurveTo(X(0.08), Y(-0.41), X(0.22), Y(-0.46 + sm * 0.03)); g.quadraticCurveTo(X(0), Y(-0.47), X(-0.22), Y(-0.46 + sm * 0.03)); g.fill();
  g.fillStyle = lipS(0.95, 0.85);
  g.beginPath(); g.moveTo(X(-0.2), Y(-0.47 + sm * 0.03)); g.quadraticCurveTo(X(0), Y(-0.48), X(0.2), Y(-0.47 + sm * 0.03)); g.quadraticCurveTo(X(0), Y(-0.58), X(-0.2), Y(-0.47 + sm * 0.03)); g.fill();
  blob(0.02, -0.52, 0.06, 0.015, 'rgba(255,240,230,0.3)');
  g.strokeStyle = lipS(0.4, 0.9); g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(X(-0.22), Y(-0.46 + sm * 0.03)); g.quadraticCurveTo(X(0), Y(-0.475 - sm * 0.02), X(0.22), Y(-0.46 + sm * 0.03)); g.stroke();
  blob(0, -0.63, 0.13, 0.04, shade(0.6, 0.5));
  // Orejas y nacimiento del cabello
  blob(0, 0.98, 0.7, 0.08, shade(0.5, 0.4));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Atlas de telas (256×320, 5 franjas de 64 px, de abajo arriba): 0 piel (poros), 1 algodón (tejido y pliegues),
 * 2 jean (sarga diagonal, desgaste y costura), 3 camisa de microcuadro, 4 cabello (mechones). Multiplica el color por vértice.
 */
export function fabricTexture(): THREE.CanvasTexture {
  const W = 256, BH = 64, HH = BH * 5;
  const c = document.createElement('canvas'); c.width = W; c.height = HH;
  const g = c.getContext('2d')!;
  let seed = 99; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const band = (k: number) => HH - (k + 1) * BH; // y del borde superior de la franja k
  const noise = (y0: number, amt: number, a = 1) => { for (let i = 0; i < W * BH * 0.5; i++) { const v = 255 - r() * amt; g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(r() * W, y0 + r() * BH, 1, 1); } };
  const folds = (y0: number, n: number, k: number) => { for (let i = 0; i < n; i++) { const x = r() * W, w = 6 + r() * 14; const gr = g.createLinearGradient(x - w, 0, x + w, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, `rgba(0,0,0,${k})`); gr.addColorStop(0.62, `rgba(255,255,255,${k * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - w, y0, w * 2, BH); } };
  // 0 piel
  let y = band(0); g.fillStyle = '#f6f2ee'; g.fillRect(0, y, W, BH); noise(y, 22, 0.5);
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(150,90,70,0.12)'; g.beginPath(); g.arc(r() * W, y + r() * BH, 1 + r() * 1.5, 0, 7); g.fill(); }
  // 1 algodón
  y = band(1); g.fillStyle = '#eeeeee'; g.fillRect(0, y, W, BH);
  for (let x = 0; x < W; x += 2) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, y, 1, BH); }
  for (let yy = y; yy < y + BH; yy += 2) { g.fillStyle = 'rgba(0,0,0,0.04)'; g.fillRect(0, yy, W, 1); }
  folds(y, 14, 0.16);
  // 2 jean: sarga diagonal, desgaste vertical claro, costura lateral anaranjada
  y = band(2); g.fillStyle = '#e4e8f0'; g.fillRect(0, y, W, BH);
  g.save(); g.beginPath(); g.rect(0, y, W, BH); g.clip();
  for (let x = -BH; x < W; x += 3) { g.strokeStyle = 'rgba(0,0,30,0.16)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + BH); g.lineTo(x + BH, y); g.stroke(); }
  for (let i = 0; i < 6; i++) { const x = r() * W; const gr = g.createLinearGradient(x - 18, 0, x + 18, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - 18, y, 36, BH); }
  for (const sx of [64, 192]) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(sx, y, 2, BH); for (let yy = y; yy < y + BH; yy += 5) { g.fillStyle = 'rgba(210,140,60,0.9)'; g.fillRect(sx + 3, yy, 1, 3); } }
  folds(y, 8, 0.14);
  g.restore();
  // 3 microcuadro (camisa): cuadrícula fina clara/oscura
  y = band(3); g.fillStyle = '#ececf2'; g.fillRect(0, y, W, BH);
  for (let x = 0; x < W; x += 3) { g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, y, 1, BH); }
  for (let yy = y; yy < y + BH; yy += 3) { g.fillStyle = 'rgba(0,0,40,0.08)'; g.fillRect(0, yy, W, 1); }
  folds(y, 12, 0.16);
  // 4 cabello: mechones
  y = band(4); g.fillStyle = '#d8d8d8'; g.fillRect(0, y, W, BH);
  for (let i = 0; i < 700; i++) { const x = r() * W; const v = r() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)'; g.strokeStyle = v; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (r() - 0.5) * 6, y + BH / 2, x + (r() - 0.5) * 8, y + BH); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
