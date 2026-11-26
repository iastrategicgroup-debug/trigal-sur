import { makeProjection, type Projection } from './projection';
import { CONFIG } from '../config';

export interface OsmWay { id: string; tags: Record<string, string>; coords: [number, number, string][] }
export interface OsmNode { id: string; lat: number; lon: number; tags: Record<string, string> }
export interface OsmData { bounds: { south: number; west: number; north: number; east: number } | null; ways: OsmWay[]; nodes: OsmNode[] }

export type V2 = { x: number; z: number };

export interface Road {
  id: string;
  name: string;
  kind: string;          // valor de highway
  oneway: boolean;
  width: number;         // ancho de calzada (m)
  sidewalk: number;      // ancho de acera a cada lado (m); 0 = sin acera
  pts: V2[];
  nodeIds: string[];
}

export interface Area { id: string; name: string; kind: string; tags: Record<string, string>; poly: V2[] }
export interface Poi { id: string; name: string; tags: Record<string, string>; p: V2 }

/** Anchos por tipo de vía (decisión: valores típicos de Valencia). */
export function roadProfile(kind: string, oneway: boolean, lanes?: number): { width: number; sidewalk: number } | null {
  const lane = 3.2;
  switch (kind) {
    case 'motorway': return { width: (lanes ?? 3) * 3.6, sidewalk: 0 };
    case 'motorway_link': return { width: (lanes ?? 1) * 3.8 + 1, sidewalk: 0 };
    case 'trunk': case 'primary': return { width: (lanes ?? (oneway ? 3 : 4)) * lane, sidewalk: 2.5 };
    case 'secondary': case 'tertiary': return { width: (lanes ?? (oneway ? 2 : 3)) * lane, sidewalk: 2.2 };
    case 'residential': case 'unclassified': case 'living_street': return { width: oneway ? 5 : 6.5, sidewalk: 1.6 };
    case 'service': return { width: 4, sidewalk: 0 };
    default: return null; // footway, path, etc. se tratan aparte
  }
}

export class CityMap {
  readonly proj: Projection;
  readonly roads: Road[] = [];
  readonly footways: { id: string; pts: V2[] }[] = [];
  readonly areas: Area[] = [];
  readonly pois: Poi[] = [];
  readonly barriers: { id: string; kind: string; pts: V2[] }[] = [];
  readonly half: { w: number; h: number };
  private grid = new Map<string, { road: Road; i: number }[]>();
  private static readonly CELL = 20;

  constructor(data: OsmData) {
    this.proj = makeProjection(CONFIG.map.origin);
    const p = (lat: number, lon: number) => this.proj.toXZ({ lat, lon });
    const b = CONFIG.map.bbox;
    const sw = p(b.south, b.west), ne = p(b.north, b.east);
    this.half = { w: (ne.x - sw.x) / 2, h: (sw.z - ne.z) / 2 };

    for (const w of data.ways) {
      const pts = w.coords.map(([la, lo]) => p(la, lo));
      const t = w.tags;
      if (t.highway) {
        if (t.highway === 'footway' || t.highway === 'path' || t.highway === 'pedestrian' || t.highway === 'steps') {
          this.footways.push({ id: w.id, pts });
          continue;
        }
        const oneway = t.oneway === 'yes' || t.highway === 'motorway' || t.highway === 'motorway_link';
        const prof = roadProfile(t.highway, oneway, t.lanes ? Number(t.lanes) : undefined);
        if (!prof) continue;
        const road: Road = { id: w.id, name: t.name ?? '', kind: t.highway, oneway, ...prof, pts, nodeIds: w.coords.map((c) => c[2]) };
        this.roads.push(road);
        for (let i = 0; i < pts.length - 1; i++) this.indexSegment(road, i);
      } else if (t.barrier) {
        this.barriers.push({ id: w.id, kind: t.barrier, pts });
      } else if (pts.length >= 4 && w.coords[0]![2] === w.coords.at(-1)![2]) {
        const kind = t.leisure ?? t.building ? (t.leisure ?? 'building') : t.amenity ?? t.landuse ?? t.natural ?? t.shop ?? 'area';
        this.areas.push({ id: w.id, name: t.name ?? '', kind: t.building ? 'building' : kind, tags: t, poly: pts.slice(0, -1) });
      }
    }
    for (const n of data.nodes) {
      if (n.tags.name) this.pois.push({ id: n.id, name: n.tags.name, tags: n.tags, p: p(n.lat, n.lon) });
    }
  }

  private indexSegment(road: Road, i: number): void {
    const a = road.pts[i]!, b = road.pts[i + 1]!;
    const C = CityMap.CELL, pad = road.width / 2 + road.sidewalk + 2;
    const x0 = Math.floor((Math.min(a.x, b.x) - pad) / C), x1 = Math.floor((Math.max(a.x, b.x) + pad) / C);
    const z0 = Math.floor((Math.min(a.z, b.z) - pad) / C), z1 = Math.floor((Math.max(a.z, b.z) + pad) / C);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = `${x},${z}`;
      let cell = this.grid.get(k);
      if (!cell) this.grid.set(k, (cell = []));
      cell.push({ road, i });
    }
  }

  /** Vía más cercana a un punto (para el nombre en el HUD y para colocar lotes). */
  nearestRoad(x: number, z: number, maxDist = 30): { road: Road; dist: number; t: number; i: number } | null {
    const C = CityMap.CELL;
    let best: { road: Road; dist: number; t: number; i: number } | null = null;
    const cx = Math.floor(x / C), cz = Math.floor(z / C);
    const seen = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const { road, i } of this.grid.get(`${cx + dx},${cz + dz}`) ?? []) {
        const key = road.id + ':' + i;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = distToSegment(x, z, road.pts[i]!, road.pts[i + 1]!);
        if (r.d <= maxDist && (!best || r.d < best.dist)) best = { road, dist: r.d, t: r.t, i };
      }
    }
    return best;
  }

  /** ¿Está el punto sobre alguna calzada o acera (con margen)? */
  onRoadCorridor(x: number, z: number, margin = 0): boolean {
    const C = CityMap.CELL;
    for (const { road, i } of this.grid.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []) {
      const r = distToSegment(x, z, road.pts[i]!, road.pts[i + 1]!);
      if (r.d < road.width / 2 + road.sidewalk + margin) return true;
    }
    return false;
  }

  findArea(name: string): Area | undefined { return this.areas.find((a) => a.name.toLowerCase() === name.toLowerCase()); }
}

export function distToSegment(x: number, z: number, a: V2, b: V2): { d: number; t: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)), t };
}

export function centroid(poly: V2[]): V2 {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const c = p.x * q.z - q.x * p.z;
    a += c; cx += (p.x + q.x) * c; cz += (p.z + q.z) * c;
  }
  if (Math.abs(a) < 1e-9) return { x: poly[0]!.x, z: poly[0]!.z };
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

export function pointInPoly(x: number, z: number, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
