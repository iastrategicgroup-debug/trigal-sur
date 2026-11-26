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
  pants: { type: 'jean' | 'short' | 'falda' | 'mono'; color: string };
  shoes: string;
  watch: boolean;
  cap?: string | null;          // gorra (color) o null
  hunch?: number;               // encorvamiento (ancianos) 0..1
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
  rings(rs: { c: THREE.Vector3; rx: number; rz: number; w: W; color: THREE.Color; dz?: number; shape?: (a: number) => number }[], sides: number, capStart = false, capEnd = false, g: 0 | 1 = 0): void {
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
        this.vert(p, i / sides, j / (rs.length - 1), r.color, r.w);
      }
    }
    const S = sides + 1;
    for (let j = 0; j < rs.length - 1; j++) for (let i = 0; i < sides; i++) {
      const a = base + j * S + i, b = a + S;
      this.tri(g, a, a + 1, b); this.tri(g, b, a + 1, b + 1);
    }
    const cap = (j: number, flip: boolean) => {
      const r = rs[j]!;
      const c = this.vert(r.c, 0.5, 0.5, r.color, r.w);
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
        this.vert(new THREE.Vector3(c.x + Math.sin(ph) * Math.cos(th) * r.x, c.y + y, c.z + Math.sin(ph) * Math.sin(th) * r.z), i / cols, j / rows, color, w);
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
      const ids = f.map(([x, y, z]) => this.vert(P(x, y, z), 0.5, 0.5, color, w));
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
    shoulder_L: v(H * 0.04, 0.8), upperArm_L: v(sw, 0.81), foreArm_L: v(sw + H * 0.02, 0.625), hand_L: v(sw + H * 0.032, 0.475),
    shoulder_R: v(-H * 0.04, 0.8), upperArm_R: v(-sw, 0.81), foreArm_R: v(-sw - H * 0.02, 0.625), hand_R: v(-sw - H * 0.032, 0.475),
    thigh_L: v(hipX, 0.52), shin_L: v(hipX * 0.92, 0.285), foot_L: v(hipX * 0.9, 0.048),
    thigh_R: v(-hipX, 0.52), shin_R: v(-hipX * 0.92, 0.285), foot_R: v(-hipX * 0.9, 0.048),
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

  // ---------- Torso: pelvis -> cintura -> barriga -> pecho -> hombros ----------
  const tor = (y: number, rx: number, rz: number, dz: number, w: W, c: THREE.Color) => ({ c: new THREE.Vector3(0, y * H, 0), rx: rx * H, rz: rz * H, dz: dz * H, w, color: c, shape: torsoShape(y) });
  const mm = p.muscle, ff = p.fat;
  /** Relieve del torso según la altura: pectorales (2 lóbulos y surco del esternón), omóplatos, oblicuos, abdomen. */
  function torsoShape(y: number): (a: number) => number {
    const pecs = p.female ? 0 : smooth(0.68, 0.72, y) * (1 - smooth(0.775, 0.8, y));
    const blades = smooth(0.7, 0.75, y) * (1 - smooth(0.79, 0.81, y));
    const waist = smooth(0.55, 0.6, y) * (1 - smooth(0.66, 0.7, y));
    return (a: number) => 1
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
    tor(0.465, hipRx * 0.92, 0.062 + f * 0.012, 0, [['hips', 1]], pants),
    tor(0.5, hipRx * 0.98, 0.066 + f * 0.016, f * 0.008, [['hips', 1]], pants),
    tor(0.515, hipRx + 0.004, 0.07 + f * 0.018, f * 0.012, [['hips', 1]], p.shirt.type === 'franelilla' || p.pants.type === 'falda' ? pants : shirt), // ruedo de la camisa por fuera
    tor(0.565, Math.max(waistRx + f * 0.01, hipRx * 0.96), 0.064 + f * 0.02, belly * 0.7, [['hips', 0.6], ['spine', 0.4]], p.pants.type === 'falda' ? pants : shirt),
    tor(0.61, waistRx + f * 0.012, 0.062 + f * 0.022, belly, [['spine', 1]], shirt),
    tor(0.665, waistRx + 0.006 + m * 0.008, 0.066 + f * 0.016, belly * 0.6 + (fem ? 0.01 : 0), [['spine', 0.5], ['chest', 0.5]], shirt),
    tor(0.72, chestRx, 0.07 + m * 0.012 + f * 0.01, (fem ? 0.03 : 0.006) + m * 0.012, [['chest', 1]], shirt),
    tor(0.77, chestRx + 0.008 + m * 0.012, 0.066 + m * 0.01, (fem ? 0.022 : 0.004) + m * 0.01, [['chest', 1]], shirt),
    tor(0.795, J.sw / H * 0.84, 0.068 + m * 0.012, 0, [['chest', 0.8], ['shoulder_L', 0.1], ['shoulder_R', 0.1]], shirt),
    tor(0.818, J.sw / H * 0.58, 0.058 + m * 0.008, 0, [['chest', 0.85], ['shoulder_L', 0.075], ['shoulder_R', 0.075]], shirt),
    tor(0.832, 0.05 + m * 0.01, 0.042, 0, [['chest', 0.6], ['neck', 0.4]], shirt),
  ];
  B.rings(torsoRings, 16, true, false);
  // Cuello
  const neckR = (0.036 + m * 0.01 + f * 0.008) * H;
  B.rings([
    { c: new THREE.Vector3(0, 0.82 * H, -0.004 * H), rx: neckR, rz: neckR * 0.95, w: [['neck', 1]], color: skin },
    { c: new THREE.Vector3(0, 0.875 * H, 0), rx: neckR * 0.92, rz: neckR * 0.9, w: [['neck', 0.4], ['head', 0.6]], color: skin },
  ], 8);
  // Cuello de la camisa
  if (p.shirt.type !== 'franelilla') B.rings([
    { c: new THREE.Vector3(0, 0.828 * H, -0.004 * H), rx: neckR * 1.5, rz: neckR * 1.45, w: [['chest', 0.6], ['neck', 0.4]], color: shirt },
    { c: new THREE.Vector3(0, 0.852 * H, -0.006 * H), rx: neckR * 1.18, rz: neckR * 1.15, w: [['neck', 1]], color: shirt.clone().multiplyScalar(0.92) },
  ], 10);
  // Línea de botones (cuerpo) — pequeñas cajas
  if (p.shirt.buttons) for (let k = 0; k < 6; k++) {
    const y = 0.57 + k * 0.042;
    const ring = torsoRings.reduce((best, r) => (Math.abs(r.c.y / H - y) < Math.abs(best.c.y / H - y) ? r : best));
    B.box(new THREE.Vector3(0, y * H, ring.rz + ring.dz + 0.002), new THREE.Vector3(0.004, 0.004, 0.002), new THREE.Color(0xe8e4dc), [['spine', 0.5], ['chest', 0.5]]);
  }

  // ---------- Brazos ----------
  for (const s of ['L', 'R'] as const) {

    const up = J[`upperArm_${s}`], el = J[`foreArm_${s}`], wr = J[`hand_${s}`];
    const ua = `upperArm_${s}` as BoneName, fa = `foreArm_${s}` as BoneName, ha = `hand_${s}` as BoneName, sh = `shoulder_${s}` as BoneName;
    const rUp = (0.036 + m * 0.014 + f * 0.012) * H, rEl = (0.027 + m * 0.006 + f * 0.006) * H, rWr = (0.02 + m * 0.003) * H;
    const sleeveLong = p.shirt.type === 'manga_larga';
    const sleeveShort = p.shirt.type === 'manga_corta';
    const N = 7;
    const arm: Parameters<SkinBuilder['rings']>[0] = [];
    // hombro (deltoides)
    const armDir = new THREE.Vector3().subVectors(up, el).normalize(); // del codo al hombro
    arm.push({ c: up.clone().addScaledVector(armDir, 0.028 * H), rx: rUp * 0.75, rz: rUp * 0.85, w: [[sh, 0.5], [ua, 0.5]], color: p.shirt.type === 'franelilla' ? skin : shirt });
    arm.push({ c: up.clone().add(new THREE.Vector3(0, 0.004 * H, 0)), rx: rUp * 1.3, rz: rUp * 1.3, w: [[sh, 0.3], [ua, 0.7]], color: p.shirt.type === 'franelilla' ? skin : shirt });
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const c = up.clone().lerp(el, t);
      const bulge = Math.sin(t * Math.PI) * m * 0.008 * H; // bíceps
      const r = THREE.MathUtils.lerp(rUp, rEl, t) + bulge;
      const covered = sleeveLong || (sleeveShort && t < 0.45) || (p.shirt.type === 'franelilla' && t < 0.0);
      const bi = Math.sin(Math.min(1, t * 1.2) * Math.PI);
      arm.push({ c, rx: r, rz: r * 1.05, w: [[ua, 1 - smooth(0.75, 1, t) * 0.5], [fa, smooth(0.75, 1, t) * 0.5]], color: covered ? shirt : skin,
        shape: (a) => 1 + bi * ((0.05 + m * 0.2) * bump(a, FRONT, 0.6) + (0.04 + m * 0.12) * bump(a, BACK, 0.7)) });
    }
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const c = el.clone().lerp(wr, t);
      const r = THREE.MathUtils.lerp(rEl * 1.05, rWr, t) + Math.sin(t * Math.PI * 0.8) * m * 0.004 * H;
      const cuff = sleeveLong && t > 0.88;
      const fo = Math.sin(Math.min(1, t * 2.2) * Math.PI) * (1 - t);
      arm.push({ shape: (a) => 1 + fo * (0.06 + m * 0.12) * bump(a, FRONT + 0.6, 0.8), c, rx: r * (cuff ? 1.15 : 1), rz: r * 0.9 * (cuff ? 1.15 : 1), w: [[fa, 1 - smooth(0.8, 1, t) * 0.5], [ha, smooth(0.8, 1, t) * 0.5], [ua, (1 - smooth(0, 0.2, t)) * 0.4]], color: sleeveLong ? shirt : skin });
    }
    B.rings(arm, 10, true, true);
    // Mano tipo mitón con pulgar
    const dir = new THREE.Vector3().subVectors(wr, el).normalize();
    const hc = wr.clone().addScaledVector(dir, 0.045 * H);
    B.ellipsoid(hc, new THREE.Vector3(0.022 * H, 0.05 * H, 0.03 * H), skin, [[ha, 1]], 6);
    B.ellipsoid(wr.clone().addScaledVector(dir, 0.025 * H).add(new THREE.Vector3(0, 0, 0.026 * H)), new THREE.Vector3(0.011 * H, 0.025 * H, 0.011 * H), skin, [[ha, 1]], 4);
    // Reloj en la muñeca izquierda
    if (p.watch && s === 'L') B.ellipsoid(wr.clone().addScaledVector(dir, -0.012 * H), new THREE.Vector3(rWr * 1.25, 0.012 * H, rWr * 1.25), new THREE.Color(0x111111), [[fa, 1]], 5);
  }

  // ---------- Piernas ----------
  for (const s of ['L', 'R'] as const) {
    const th = J[`thigh_${s}`], kn = J[`shin_${s}`], an = J[`foot_${s}`];
    const tb = `thigh_${s}` as BoneName, sb = `shin_${s}` as BoneName, fb = `foot_${s}` as BoneName;
    const rTh = (0.04 + m * 0.01 + f * 0.016 + (fem ? 0.006 : 0)) * H, rKn = (0.031 + f * 0.006) * H, rAn = (0.021 + f * 0.003) * H;
    const legCol = (t: number) => {
      if (p.pants.type === 'jean' || p.pants.type === 'mono') return pants;
      if (p.pants.type === 'short') return t < 0.45 ? pants : skin;
      return t < 0.6 ? pants : skin; // falda: muslo cubierto por la falda (se dibuja aparte)
    };
    const leg: Parameters<SkinBuilder['rings']>[0] = [];
    const N = 6;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const c = th.clone().lerp(kn, t).add(new THREE.Vector3(0, 0.012 * H * (1 - t), 0));
      const r = THREE.MathUtils.lerp(rTh, rKn, Math.pow(t, 0.8));
      const q = Math.sin(Math.min(1, t * 1.1) * Math.PI);
      leg.push({ shape: (a) => 1 + q * ((0.05 + m * 0.12) * bump(a, FRONT, 0.7) + 0.04 * bump(a, BACK, 0.6) + (0.03 + m * 0.06) * bump(a, FRONT - 1.1, 0.5)), c, rx: r * 0.95, rz: r, w: [[tb, 1 - smooth(0.8, 1, t) * 0.5], [sb, smooth(0.8, 1, t) * 0.5], ['hips', (1 - smooth(0, 0.25, t)) * 0.5]], color: legCol(t * 0.5) });
    }
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const c = kn.clone().lerp(an, t);
      const calf = Math.sin(Math.min(1, t * 1.6) * Math.PI) * (0.008 + m * 0.006) * H;
      const r = THREE.MathUtils.lerp(rKn, rAn, t) + calf;
      const jeanFlare = p.pants.type === 'jean' || p.pants.type === 'mono' ? 0.004 * H * t : 0;
      const cv = Math.sin(Math.min(1, t * 1.8) * Math.PI) * (t < 0.6 ? 1 : 0.4);
      leg.push({ shape: (a) => 1 + cv * (0.08 + m * 0.14) * bump(a, BACK, 0.9), c: c.add(new THREE.Vector3(0, 0, -calf * 0.4)), rx: r + jeanFlare, rz: r + jeanFlare, w: [[sb, 1 - smooth(0.85, 1, t) * 0.5], [fb, smooth(0.85, 1, t) * 0.5], [tb, (1 - smooth(0, 0.2, t)) * 0.4]], color: legCol(0.5 + t * 0.5) });
    }
    B.rings(leg, 10);
    // Zapato con suela diferenciada
    const fc = an.clone().add(new THREE.Vector3(0, -0.02 * H, 0.04 * H));
    B.ellipsoid(fc.clone().add(new THREE.Vector3(0, 0.008 * H, 0)), new THREE.Vector3(0.033 * H, 0.03 * H, 0.075 * H), shoe, [[fb, 1]], 6, 0, true);
    B.box(fc.clone().add(new THREE.Vector3(0, -0.016 * H, 0)), new THREE.Vector3(0.034 * H, 0.006 * H, 0.074 * H), new THREE.Color(0x1a1612).lerp(new THREE.Color(0xe8e0d0), p.shoes === '#f0f0f0' ? 1 : 0.15), [[fb, 1]]);
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
    const rows = 22, cols = 26;
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
          dz -= 0.075 * (G(ux - 0.34, uy - 0.1, 0.018, 0.01) + G(ux + 0.34, uy - 0.1, 0.018, 0.01));          // cuencas
          dz += 0.05 * G(0, uy - 0.24, 0.35, 0.004) * (Math.abs(ux) < 0.62 ? 1 : 0.3);                       // arco superciliar
          const noseAmt = uy < 0.14 && uy > -0.3 ? 0.04 + 0.13 * Math.min(1, (0.14 - uy) / 0.36) : 0;        // puente -> punta
          dz += noseAmt * G(ux, 0, 0.004 + Math.max(0, 0.06 - uy) * 0.03, 1) * (uy < -0.27 ? Math.max(0, 1 - (-0.27 - uy) * 12) : 1);
          dz += 0.04 * (G(ux - 0.1, uy + 0.27, 0.003, 0.002) + G(ux + 0.1, uy + 0.27, 0.003, 0.002));       // aletas de la nariz
          dz += 0.035 * (G(ux - 0.45, uy + 0.05, 0.02, 0.015) + G(ux + 0.45, uy + 0.05, 0.02, 0.015));       // pómulos
          dz += 0.045 * G(ux, uy + 0.44, 0.05, 0.0025) + 0.035 * G(ux, uy + 0.52, 0.04, 0.0025);             // labios
          dz -= 0.03 * G(ux, uy + 0.6, 0.05, 0.003);                                                         // surco bajo el labio
          dz += 0.06 * G(ux, uy + 0.8, 0.04, 0.012) * p.face.chin;                                          // mentón
          z += dz * fz;
          x *= 1 + 0.05 * G(Math.abs(ux) - 0.6, uy + 0.55, 0.02, 0.02) * p.face.jaw;                          // ángulo mandibular
        }
        const P = new THREE.Vector3(hc.x + x * hrx, hc.y + y * hry, hc.z + z * hrz);
        // UV frontal: proyección plana; la parte de atrás va a una esquina lisa (piel)
        const front = z > -0.15;
        const u = front ? 0.5 + ux * 0.5 : 0.02, v = front ? 0.5 + uy * 0.5 : 0.02;
        B.vert(P, u, v, skin, [['head', 1]]);
      }
    }
    const C = cols + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = base + j * C + i, b = a + C;
      B.tri(1, a, a + 1, b); B.tri(1, b, a + 1, b + 1);
    }
  }
  // Orejas
  for (const sg of [1, -1]) B.ellipsoid(new THREE.Vector3(sg * hrx * 0.98, hc.y - headH * 0.02, hc.z - headH * 0.04), new THREE.Vector3(0.006 * H, 0.033 * H, 0.018 * H), skin.clone().multiplyScalar(0.92), [['head', 1]], 4);
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
        const hairline = 0.42 - frontness * 0.1;
        const isSide = Math.abs(x) > 0.6 && z < 0.5;
        const thick = p.hair.style === 'degradado' ? (isSide ? 1.015 : 1.07) : p.hair.style === 'rizado' ? 1.14 : 1.06;
        // Copete: frente-arriba levantado
        const lift = p.hair.style === 'degradado' ? Math.max(0, z) * Math.max(0, y - 0.6) * 0.35 : 0;
        y += lift;
        const P = new THREE.Vector3(hc.x + x * hrx * thick, hc.y + y * hry * (thick - 0.01) + headH * 0.02, hc.z + z * hrz * thick);
        keep.push(y > hairline - (z < 0 ? 0.55 : 0) || z < -0.2);
        B.vert(P, 0.5, 0.5, hairC, [['head', 1]]);
      }
    }
    const C = cols + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = base + j * C + i, b = a + C;
      if (!keep[j * C + i] || !keep[(j + 1) * C + i]) continue;
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
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: fabric });
  const faceMat = new THREE.MeshLambertMaterial({ map: faceTexture(p) });
  const mesh = new THREE.SkinnedMesh(geo, [bodyMat, faceMat]);
  mesh.add(bones.root);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
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
  // Las coordenadas: u = 0.5 + x/2, v = 0.5 + y/2 (y hacia arriba) => en el lienzo y se invierte
  const X = (x: number) => S * (0.5 + x * 0.5), Y = (y: number) => S * (0.5 - y * 0.5);
  // Sombreado suave: mejillas y bajo la mandíbula
  const rad = (x: number, y: number, r: number, col: string) => { const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * S); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); };
  rad(0.38, -0.15, 0.12, 'rgba(200,90,80,0.12)');
  rad(-0.38, -0.15, 0.12, 'rgba(200,90,80,0.12)');
  rad(0, -0.85, 0.25, 'rgba(0,0,0,0.18)');
  rad(0.62, 0.05, 0.12, 'rgba(0,0,0,0.12)');
  rad(-0.62, 0.05, 0.12, 'rgba(0,0,0,0.12)');
  // Barba
  if (p.beard.type !== 'ninguna') {
    const bc = new THREE.Color(p.beard.color);
    const dens = p.beard.type === 'completa' ? 0.9 : p.beard.type === 'candado' ? 0.75 : p.beard.density;
    let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2600 * dens; i++) {
      const x = (r() - 0.5) * 1.5, y = -0.2 - r() * 0.8;
      const inJaw = p.beard.type === 'candado' ? Math.abs(x) < 0.32 && y < -0.42 : y < -0.25 - Math.max(0, 0.45 - Math.abs(x)) * 0 && Math.abs(x) < 0.72 - (y + 1) * 0.1;
      const notMouth = !(Math.abs(x) < 0.22 && y > -0.52 && y < -0.4);
      if (!inJaw || !notMouth) continue;
      g.fillStyle = hex(bc, 1); g.globalAlpha = 0.25 + dens * 0.5;
      g.fillRect(X(x), Y(y), 1.6, 1.6);
    }
    g.globalAlpha = 1;
  }
  // Ojos
  const eyeY = 0.1, eyeX = 0.34;
  for (const sg of [1, -1]) {
    const cx = X(sg * eyeX), cy = Y(eyeY);
    g.fillStyle = 'rgba(60,30,20,0.2)'; g.beginPath(); g.ellipse(cx, cy + 2, 24, 13, 0, 0, Math.PI * 2); g.fill(); // cuenca
    g.fillStyle = '#f4efe6'; g.beginPath(); g.ellipse(cx, cy, 18, 8.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = p.face.eye; g.beginPath(); g.arc(cx + sg * -1, cy, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0a0806'; g.beginPath(); g.arc(cx + sg * -1, cy, 3.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(cx + 1, cy - 3, 2, 2);
    g.strokeStyle = 'rgba(30,18,10,0.9)'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(cx, cy + 1, 18.5, 9.5, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); // párpado
    // Ceja
    g.strokeStyle = p.face.brow; g.lineWidth = 4 + p.face.browThick * 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - sg * 20, Y(eyeY + 0.17)); g.quadraticCurveTo(cx, Y(eyeY + 0.25), cx + sg * 22, Y(eyeY + 0.18)); g.stroke();
  }
  // Nariz
  g.strokeStyle = 'rgba(80,40,25,0.4)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(X(-0.06), Y(0.0)); g.quadraticCurveTo(X(-0.1), Y(-0.2), X(-0.13), Y(-0.24)); g.stroke();
  g.fillStyle = 'rgba(60,25,15,0.55)';
  for (const sg of [1, -1]) { g.beginPath(); g.ellipse(X(sg * 0.1), Y(-0.27), 7, 4, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = 'rgba(80,40,25,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(-0.17), Y(-0.24)); g.quadraticCurveTo(X(0), Y(-0.32), X(0.17), Y(-0.24)); g.stroke();
  rad(0, -0.22, 0.07, 'rgba(255,255,255,0.12)');
  // Boca con sonrisa
  const sm = p.face.smile;
  g.fillStyle = 'rgba(150,70,60,0.85)';
  g.beginPath();
  g.moveTo(X(-0.3), Y(-0.47 + sm * 0.05));
  g.quadraticCurveTo(X(0), Y(-0.43), X(0.3), Y(-0.47 + sm * 0.05));
  g.quadraticCurveTo(X(0), Y(-0.55 - sm * 0.06), X(-0.3), Y(-0.47 + sm * 0.05));
  g.fill();
  if (sm > 0.5) { g.fillStyle = '#f2ece2'; g.beginPath(); g.moveTo(X(-0.23), Y(-0.47)); g.quadraticCurveTo(X(0), Y(-0.45), X(0.23), Y(-0.47)); g.quadraticCurveTo(X(0), Y(-0.51), X(-0.23), Y(-0.47)); g.fill(); }
  g.strokeStyle = 'rgba(70,30,20,0.6)'; g.lineWidth = 1.5;
  for (const sg of [1, -1]) { g.beginPath(); g.moveTo(X(sg * 0.3), Y(-0.36)); g.quadraticCurveTo(X(sg * 0.33), Y(-0.45), X(sg * 0.27), Y(-0.52)); g.stroke(); } // surcos de la sonrisa
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Textura de tela neutra (pliegues y trama) que multiplica los colores por vértice. */
export function fabricTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * S;
    const gr = g.createLinearGradient(x - 6, 0, x + 6, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - 6, 0, 12, S);
  }
  for (let y = 0; y < S; y += 2) { g.fillStyle = 'rgba(0,0,0,0.04)'; g.fillRect(0, y, S, 1); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
