import * as THREE from 'three';
import type { CityMap, Road, V2 } from '../map/osm';
import type { GeoBank } from './GeoBuilder';

const WHITE = new THREE.Color(1, 1, 1);

/** Desplaza una polilínea lateralmente (uniones a inglete limitadas). */
export function offsetPolyline(pts: V2[], d: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[i - 1], next = pts[i + 1];
    const n1 = prev ? normal(prev, p) : null;
    const n2 = next ? normal(p, next) : null;
    let nx: number, nz: number;
    if (n1 && n2) {
      nx = n1.x + n2.x; nz = n1.z + n2.z;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      const cos = nx * n2.x + nz * n2.z;
      const k = 1 / Math.max(cos, 0.5); // inglete limitado
      nx *= k; nz *= k;
    } else {
      const n = (n1 ?? n2)!;
      nx = n.x; nz = n.z;
    }
    out.push({ x: p.x + nx * d, z: p.z + nz * d });
  }
  return out;
}
function normal(a: V2, b: V2): V2 {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  return { x: -dz / l, z: dx / l }; // izquierda de a->b
}

function cumLen(pts: V2[]): number[] {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  return L;
}

/** Cinta horizontal entre dos polilíneas paralelas a altura y. */
function ribbon(b: ReturnType<GeoBank['get']>, left: V2[], right: V2[], y: number, uScale: number, vScale: number, color: THREE.Color, keep?: (i: number) => boolean): void {
  const L = cumLen(left.map((p, i) => ({ x: (p.x + right[i]!.x) / 2, z: (p.z + right[i]!.z) / 2 })));
  for (let i = 0; i < left.length - 1; i++) {
    if (keep && !keep(i)) continue;
    const l0 = left[i]!, l1 = left[i + 1]!, r0 = right[i]!, r1 = right[i + 1]!;
    b.quad(
      new THREE.Vector3(r0.x, y, r0.z), new THREE.Vector3(r1.x, y, r1.z), new THREE.Vector3(l1.x, y, l1.z), new THREE.Vector3(l0.x, y, l0.z),
      [L[i]! / vScale, 0, L[i + 1]! / vScale, uScale], color,
    );
  }
}

/** Subdivide una polilínea para que ningún tramo supere `max` metros. */
export function densify(pts: V2[], max: number): V2[] {
  const out: V2[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / max));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

/** Altura del brocal: 30 cm (pedido del usuario). */
export const SIDEWALK_H = 0.30;
/** Ancho del canto del brocal. */
export const CURB_W = 0.15;

/**
 * Construye calzadas, rayado, aceras y brocales.
 * Las calzadas se dibujan sin escribir profundidad (encima del suelo, en orden fijo) para evitar parpadeo en los cruces.
 */
export function buildRoads(map: CityMap, bank: GeoBank, rnd: () => number): void {
  const asphalt = bank.get('asphalt');
  const marks = bank.get('marks');
  const walk = bank.get('sidewalk');
  const curb = bank.get('curb');
  const curbTopB = bank.get('curbTop');
  const vergeB = bank.get('verge');

  const sorted = [...map.roads].sort((a, b) => a.width - b.width); // las anchas encima
  for (const road of sorted) {
    const pts = densify(road.pts, 4);
    const hw = road.width / 2;
    const tint = new THREE.Color().setScalar(0.9 + rnd() * 0.15);
    ribbon(asphalt, offsetPolyline(pts, hw), offsetPolyline(pts, -hw), 0.02, road.width / 8, 8, tint);
    buildMarkings(road, pts, marks);

    if (road.sidewalk > 0) {
      for (const side of [1, -1]) {
        const inner = offsetPolyline(pts, side * hw);
        const outer = offsetPolyline(pts, side * (hw + road.sidewalk));
        // Todas las aceras: brocal gris (0.15) + franja de grama + losas largas de concreto.
        const verge = road.sidewalk >= 3.5 ? 1.0 : 0.8; // franja de grama
        const curbTop = offsetPolyline(pts, side * (hw + CURB_W));
        const walkIn = offsetPolyline(pts, side * (hw + CURB_W + verge));
        // Tramos de acera que no invaden otra calzada (cruces)
        const keep = (i: number) => {
          const mx = (inner[i]!.x + outer[i + 1]!.x) / 2, mz = (inner[i]!.z + outer[i + 1]!.z) / 2;
          return !onOtherCarriageway(map, road, mx, mz);
        };
        const tone = new THREE.Color().setScalar(0.92 + rnd() * 0.1);
        const pair = (a: V2[], b: V2[]) => (side > 0 ? [b, a] : [a, b]) as [V2[], V2[]];
        ribbon(curbTopB, ...pair(inner, curbTop), SIDEWALK_H, CURB_W, 1, WHITE, keep);
        if (verge > 0) ribbon(vergeB, ...pair(curbTop, walkIn), SIDEWALK_H, verge / 4, 4, WHITE, keep);
        ribbon(walk, ...pair(walkIn, outer), SIDEWALK_H, (road.sidewalk - CURB_W - verge) / 1.5, 3, tone, keep); // losas de 1,5 m
        // Brocal: cara vertical del lado de la calzada
        const L = cumLen(inner);
        for (let i = 0; i < inner.length - 1; i++) {
          if (!keep(i)) continue;
          const a = inner[i]!, b = inner[i + 1]!;
          const [p, q] = side > 0 ? [b, a] : [a, b];
          curb.wall(p.x, p.z, q.x, q.z, 0, SIDEWALK_H, 1, WHITE, WHITE, L[i]!);
        }
      }
    }
  }
}

function onOtherCarriageway(map: CityMap, self: Road, x: number, z: number): boolean {
  const near = map.nearestRoad(x, z, 25);
  if (!near) return false;
  // Revisa todas las vías cercanas, no solo la más cercana
  for (const r of map.roads) {
    if (r === self) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i]!, b = r.pts[i + 1]!;
      if (Math.min(a.x, b.x) - 15 > x || Math.max(a.x, b.x) + 15 < x || Math.min(a.z, b.z) - 15 > z || Math.max(a.z, b.z) + 15 < z) continue;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      let t = L2 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < r.width / 2 + 0.3) return true;
    }
  }
  return false;
}

/** Rayado: línea central (amarilla doble si es doble sentido, blanca discontinua si es un sentido) y bordes. */
function buildMarkings(road: Road, pts: V2[], marks: ReturnType<GeoBank['get']>): void {
  if (road.kind === 'service') return;
  const yellow = new THREE.Color(0.85, 0.68, 0.18);
  const white = new THREE.Color(0.85, 0.85, 0.82);
  const L = cumLen(pts);
  const strip = (off: number, w: number, color: THREE.Color, dash: number) => {
    const a = offsetPolyline(pts, off + w / 2), b = offsetPolyline(pts, off - w / 2);
    for (let i = 0; i < pts.length - 1; i++) {
      if (dash > 0 && Math.floor(L[i]! / dash) % 2 === 1) continue;
      marks.quad(
        new THREE.Vector3(b[i]!.x, 0.03, b[i]!.z), new THREE.Vector3(b[i + 1]!.x, 0.03, b[i + 1]!.z),
        new THREE.Vector3(a[i + 1]!.x, 0.03, a[i + 1]!.z), new THREE.Vector3(a[i]!.x, 0.03, a[i]!.z),
        [0, L[i]! / 6, 1, L[i + 1]! / 6], color,
      );
    }
  };
  if (road.oneway) {
    if (road.width > 7) strip(0, 0.12, white, 4);
  } else {
    strip(0.1, 0.1, yellow, 0);
    strip(-0.1, 0.1, yellow, 0);
  }
  if (road.width >= 8) {
    strip(road.width / 2 - 0.35, 0.12, white, 0);
    strip(-road.width / 2 + 0.35, 0.12, white, 0);
  }
}
