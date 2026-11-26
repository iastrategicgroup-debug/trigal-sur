import * as THREE from 'three';

/**
 * Acumula triángulos con posición, normal, UV y color por vértice.
 * Al final produce una sola BufferGeometry (una draw call por material).
 */
export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  get vertexCount(): number { return this.pos.length / 3; }

  /** Cuadrilátero p0-p1-p2-p3 (antihorario visto desde la cara visible). */
  quad(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3,
    uv: [number, number, number, number], color: THREE.Color, colorTop?: THREE.Color): void {
    const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0)).normalize();
    const [u0, v0, u1, v1] = uv;
    const ct = colorTop ?? color;
    const verts: [THREE.Vector3, number, number, THREE.Color][] = [
      [p0, u0, v0, color], [p1, u1, v0, color], [p2, u1, v1, ct],
      [p0, u0, v0, color], [p2, u1, v1, ct], [p3, u0, v1, ct],
    ];
    for (const [p, u, v, c] of verts) {
      this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); this.col.push(c.r, c.g, c.b);
    }
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], color: THREE.Color): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]] as const) {
      this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u[0], u[1]); this.col.push(color.r, color.g, color.b);
    }
  }

  /** Pared vertical entre dos puntos en planta, de y0 a y1. UV en metros / escala. Normal hacia la izquierda de a->b. */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, scale: number, color: THREE.Color, colorTop?: THREE.Color, uOffset = 0): void {
    const len = Math.hypot(bx - ax, bz - az);
    this.quad(
      new THREE.Vector3(ax, y0, az), new THREE.Vector3(bx, y0, bz), new THREE.Vector3(bx, y1, bz), new THREE.Vector3(ax, y1, az),
      [uOffset / scale, y0 / scale, (uOffset + len) / scale, y1 / scale], color, colorTop,
    );
  }

  /** Caja orientada: centro, medio ancho (a lo largo de dir), medio fondo, altura. */
  box(cx: number, cz: number, y0: number, y1: number, hw: number, hd: number, angle: number, scale: number, color: THREE.Color, top = true): void {
    const c = Math.cos(angle), s = Math.sin(angle);
    const P = (lx: number, lz: number) => [cx + lx * c - lz * s, cz + lx * s + lz * c] as const;
    const corners = [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)];
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!, b = corners[(i + 1) % 4]!;
      this.wall(b[0], b[1], a[0], a[1], y0, y1, scale, color); // invertido: normal hacia fuera
    }
    if (top) {
      const [a, b, cc, d] = corners as [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
      this.quad(new THREE.Vector3(a[0], y1, a[1]), new THREE.Vector3(d[0], y1, d[1]), new THREE.Vector3(cc[0], y1, cc[1]), new THREE.Vector3(b[0], y1, b[1]),
        [0, 0, (hd * 2) / scale, (hw * 2) / scale], color);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Banco de builders por clave de material. */
export class GeoBank {
  private map = new Map<string, GeoBuilder>();
  get(key: string): GeoBuilder {
    let b = this.map.get(key);
    if (!b) this.map.set(key, (b = new GeoBuilder()));
    return b;
  }
  entries(): [string, GeoBuilder][] { return [...this.map.entries()].filter(([, b]) => b.vertexCount > 0); }
}
