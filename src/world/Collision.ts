import type { V2 } from '../map/osm';
import { pointInPoly } from '../map/osm';

interface Edge { ax: number; az: number; bx: number; bz: number; poly: number }

/**
 * Colisiones en planta: el jugador es un círculo. Polígonos (edificios, muros) y círculos (troncos, postes).
 * Rejilla espacial de 10 m.
 */
export class Collision {
  static readonly CELL = 10;
  private edges = new Map<string, Edge[]>();
  private circles = new Map<string, { x: number; z: number; r: number }[]>();
  readonly polys: V2[][] = [];

  addPolygon(poly: V2[]): void {
    const id = this.polys.push(poly) - 1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const e: Edge = { ax: a.x, az: a.z, bx: b.x, bz: b.z, poly: id };
      this.cellsFor(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), 1, (k) => {
        let arr = this.edges.get(k);
        if (!arr) this.edges.set(k, (arr = []));
        arr.push(e);
      });
    }
  }

  addCircle(x: number, z: number, r: number): void {
    this.cellsFor(x - r, z - r, x + r, z + r, 1, (k) => {
      let arr = this.circles.get(k);
      if (!arr) this.circles.set(k, (arr = []));
      arr.push({ x, z, r });
    });
  }

  private cellsFor(x0: number, z0: number, x1: number, z1: number, pad: number, fn: (k: string) => void): void {
    const C = Collision.CELL;
    for (let x = Math.floor((x0 - pad) / C); x <= Math.floor((x1 + pad) / C); x++)
      for (let z = Math.floor((z0 - pad) / C); z <= Math.floor((z1 + pad) / C); z++) fn(`${x},${z}`);
  }

  /** Empuja el círculo fuera de todo obstáculo. Devuelve true si hubo contacto. */
  resolve(p: { x: number; z: number }, r: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const k = `${Math.floor(p.x / Collision.CELL)},${Math.floor(p.z / Collision.CELL)}`;
      const edges = this.edges.get(k) ?? [];
      // Si el centro quedó dentro de un polígono (atravesó), sácalo por el borde más cercano
      const checked = new Set<number>();
      for (const e of edges) {
        if (checked.has(e.poly)) continue;
        checked.add(e.poly);
        const poly = this.polys[e.poly]!;
        if (pointInPoly(p.x, p.z, poly)) {
          let best = Infinity, bx = 0, bz = 0;
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
            const c = closest(p.x, p.z, a.x, a.z, b.x, b.z);
            const d = Math.hypot(c.x - p.x, c.z - p.z);
            if (d < best) { best = d; bx = c.x; bz = c.z; }
          }
          const dx = bx - p.x, dz = bz - p.z, l = Math.hypot(dx, dz) || 1;
          p.x = bx + (dx / l) * r; p.z = bz + (dz / l) * r;
          moved = hit = true;
        }
      }
      for (const e of edges) {
        const c = closest(p.x, p.z, e.ax, e.az, e.bx, e.bz);
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
        if (d < r && d > 1e-6) {
          p.x = c.x + (dx / d) * r; p.z = c.z + (dz / d) * r;
          moved = hit = true;
        }
      }
      for (const c of this.circles.get(k) ?? []) {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
        if (d < min && d > 1e-6) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; moved = hit = true; }
      }
      if (!moved) break;
    }
    return hit;
  }

  /** Movimiento con subpasos: ningún subpaso supera la mitad del radio (no atraviesa paredes al correr). */
  move(p: { x: number; z: number }, dx: number, dz: number, r: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * 0.5)));
    let hit = false;
    for (let i = 0; i < n; i++) {
      p.x += dx / n; p.z += dz / n;
      if (this.resolve(p, r)) hit = true;
    }
    return hit;
  }

  /** Raycast 2D contra bordes (para la cámara). Devuelve la fracción [0,1] del primer impacto. */
  raycast(ax: number, az: number, bx: number, bz: number): number {
    let tMin = 1;
    const seen = new Set<Edge>();
    this.cellsFor(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), 0, (k) => {
      for (const e of this.edges.get(k) ?? []) {
        if (seen.has(e)) continue;
        seen.add(e);
        const t = segIntersect(ax, az, bx, bz, e.ax, e.az, e.bx, e.bz);
        if (t !== null && t < tMin) tMin = t;
      }
      // Troncos y postes (círculos)
      for (const c of this.circles.get(k) ?? []) {
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
        if (L2 < 1e-9) continue;
        const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / L2));
        if (Math.hypot(ax + dx * t - c.x, az + dz * t - c.z) < c.r + 0.15 && t < tMin) tMin = Math.max(0, t - (c.r + 0.15) / Math.sqrt(L2));
      }
    });
    return tMin;
  }
}

function closest(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { x: number; z: number } {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + dx * t, z: az + dz * t };
}

function segIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number | null {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
