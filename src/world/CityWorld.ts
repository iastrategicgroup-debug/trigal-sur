import * as THREE from 'three';
import type { CityMap, V2 } from '../map/osm';
import { pointInPoly, centroid } from '../map/osm';
import { GeoBank } from './GeoBuilder';
import { buildRoads, densify, offsetPolyline, SIDEWALK_H } from './roads';
import { placeLots, buildLots, signAtlas } from './buildings';
import { buildProps, type PropsInput } from './props';
import { Collision } from './Collision';
import { Sky } from './Sky';
import { solarPosition, sunDirection, dayOfYear } from './sun';
import * as T from './textures';
import { rng } from './textures';
import { CONFIG } from '../config';

const lerpC = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1));

export class CityWorld {
  readonly collision = new Collision();
  readonly root = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private sky = new Sky();
  private litMat!: THREE.MeshLambertMaterial;
  private shopLit?: THREE.MeshLambertMaterial;
  private signMat!: THREE.MeshLambertMaterial;
  private lampMat?: THREE.MeshBasicMaterial;
  private poolMat!: THREE.MeshBasicMaterial;
  private parks: { poly: V2[] }[] = [];
  readonly benches: { p: V2; ry: number }[] = [];
  /** Cerro ficticio al sur, con su camino de tierra (ruta de la carrera de motos). */
  hill!: { cx: number; cz: number; r: number; h: number; gx: number; gz: number };
  racePath: THREE.Vector3[] = [];

  hillHeight(x: number, z: number): number {
    const H = this.hill; if (!H) return 0;
    const d = Math.hypot(x - H.cx, z - H.cz);
    if (d >= H.r) return 0;
    const k = 0.5 + 0.5 * Math.cos((Math.PI * d) / H.r);
    // pequeñas lomas para que no sea un domo perfecto
    return H.h * k * k * (3 - 2 * k) + 2.2 * Math.sin(x * 0.07) * Math.sin(z * 0.06) * k;
  }

  private buildHill(rnd: () => number): void {
    const H = this.hill;
    // Camino en espiral desde la cima hasta la entrada (norte del cerro)
    const pts: THREE.Vector3[] = [];
    const turns = 1.6, N = 260;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const th = -Math.PI / 2 - turns * Math.PI * 2 * (1 - t);
      const r = 10 + (H.r - 14) * t;
      const x = H.cx + Math.cos(th) * r, z = H.cz + Math.sin(th) * r;
      pts.push(new THREE.Vector3(x, this.hillHeight(x, z), z));
    }
    // tramo final hasta la entrada del barrio
    for (let z = H.cz - H.r + 2; z > H.gz - 4; z -= 3) pts.push(new THREE.Vector3(H.cx, 0, z));
    this.racePath = pts;
    // Terreno (malla polar) con grama seca
    const g = new THREE.BufferGeometry();
    const R = 48, A = 72, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= R; i++) for (let j = 0; j <= A; j++) {
      const r = (H.r + 2) * (i / R), a = (j / A) * Math.PI * 2;
      const x = H.cx + Math.cos(a) * r, z = H.cz + Math.sin(a) * r;
      pos.push(x, this.hillHeight(x, z) + 0.02, z); uv.push(x / 5, z / 5);
    }
    for (let i = 0; i < R; i++) for (let j = 0; j < A; j++) { const a = i * (A + 1) + j, b = a + A + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: T.grass(), color: 0xd8c898 }));
    terrain.receiveShadow = true; this.root.add(terrain);
    // Camino de tierra sobre el terreno
    const road = new THREE.BufferGeometry(); const rp: number[] = [], ru: number[] = [], ri: number[] = [];
    let acc = 0;
    pts.forEach((p, i) => {
      const n = pts[Math.min(i + 1, pts.length - 1)]!, q = pts[Math.max(i - 1, 0)]!;
      let dx = n.x - q.x, dz = n.z - q.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      if (i > 0) acc += p.distanceTo(pts[i - 1]!);
      for (const s of [-1, 1]) { const x = p.x - dz * 3.6 * s, z = p.z + dx * 3.6 * s; rp.push(x, this.heightAtRaw(x, z) + 0.08, z); ru.push(s > 0 ? 1 : 0, acc / 6); }
      if (i > 0) { const b = (i - 1) * 2; ri.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    });
    road.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); road.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2)); road.setIndex(ri); road.computeVertexNormals();
    const dirtMesh = new THREE.Mesh(road, new THREE.MeshLambertMaterial({ map: T.dirt(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    dirtMesh.receiveShadow = true; this.root.add(dirtMesh);
    // Bordes del cerro: cerca natural (anillo de colisión) con hueco hacia la entrada
    const ring = 40;
    for (let k = 0; k < ring; k++) {
      const a0 = (k / ring) * Math.PI * 2, a1 = ((k + 1) / ring) * Math.PI * 2;
      const mid = (a0 + a1) / 2; if (Math.abs(Math.atan2(Math.sin(mid + Math.PI / 2), Math.cos(mid + Math.PI / 2))) < 0.09) continue;
      const P = (a: number, r: number) => ({ x: H.cx + Math.cos(a) * r, z: H.cz + Math.sin(a) * r });
      this.collision.addPolygon([P(a0, H.r + 1), P(a1, H.r + 1), P(a1, H.r + 4), P(a0, H.r + 4)]);
    }
    // Pasillo de la entrada (muros a los lados)
    const z0 = H.gz, z1 = H.cz - H.r + 1;
    for (const s of [-1, 1]) this.collision.addPolygon([{ x: H.gx + s * 9, z: z0 }, { x: H.gx + s * 12, z: z0 }, { x: H.gx + s * 12, z: z1 + 3 }, { x: H.gx + s * 9, z: z1 + 3 }]);
    const corr = new THREE.Mesh(new THREE.PlaneGeometry(18, z1 - z0 + 4).rotateX(-Math.PI / 2).translate(H.gx, 0.03, (z0 + z1) / 2), new THREE.MeshLambertMaterial({ map: T.dirt() }));
    this.root.add(corr);
    // Árboles sueltos y piedras en el cerro (lejos del camino)
    this.hillTrees = [];
    for (let i = 0, tries = 0; i < 70 && tries < 600; tries++) {
      const a = rnd() * Math.PI * 2, r = 8 + rnd() * (H.r - 12);
      const p = { x: H.cx + Math.cos(a) * r, z: H.cz + Math.sin(a) * r };
      if (pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 8)) continue;
      this.hillTrees.push(p); i++;
    }
  }
  hillTrees: V2[] = [];
  private heightAtRaw(x: number, z: number): number { return this.hillHeight(x, z); }
  readonly spawn: V2;
  readonly places: { id: string; name: string; p: V2; r: number }[] = [];
  lotsList: import('./buildings').Lot[] = [];
  entries: import('./buildings').BuildingsOut['entries'] = [];
  readonly stats = { lots: 0, quintas: 0, comercios: 0, palms: 0, trees: 0, posts: 0 };
  private readonly doy = dayOfYear(new Date());
  private time = 0;

  constructor(readonly map: CityMap, readonly scene: THREE.Scene, shadows: boolean) {
    const rnd = rng(20261126);
    scene.add(this.root, this.sky.group);
    scene.fog = new THREE.Fog(0xe8a070, 80, 520);
    scene.background = null;

    // Luces
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3; // penumbra (PCFSoft)
    scene.add(this.sun, this.sun.target, this.hemi);

    // Suelo (tierra y grama)
    const groundTex = T.grass().clone();
    groundTex.repeat.set(2000 / 4, 2000 / 4);
    groundTex.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: groundTex, color: 0xd8d4c0 }));
    ground.receiveShadow = true;
    ground.renderOrder = 0;
    this.root.add(ground);

    const bank = new GeoBank();
    buildRoads(map, bank, rnd);
    this.buildParks(bank, rnd);
    this.buildOsmBuildings(bank);

    const lots = placeLots(map, rnd);
    // Edificios divididos por zonas de 200 m: la cámara y las sombras solo dibujan las zonas que ven
    const zoneBanks = new Map<string, GeoBank>();
    const built = buildLots(lots, (lot) => {
      const k = `${Math.floor(lot.c.x / 200)},${Math.floor(lot.c.z / 200)}`;
      let zb = zoneBanks.get(k);
      if (!zb) zoneBanks.set(k, (zb = new GeoBank()));
      return zb;
    }, rnd);
    this.lotsList = lots;
    this.entries = built.entries;
    built.solids.forEach((p) => this.collision.addPolygon(p));
    this.stats.lots = lots.length;
    this.stats.quintas = lots.filter((l) => l.kind === 'quinta').length;
    this.stats.comercios = lots.filter((l) => l.kind === 'comercio').length;

    this.root.add(...this.meshesFromBank(bank));
    for (const zb of zoneBanks.values()) this.root.add(...this.meshesFromBank(zb));

    // Cerco eléctrico
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(built.wires, 3));
    this.root.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x3a3a3a })));

    // Límites del mapa: muro bajo de tierra/vegetación (barrera natural)
    const h = map.half;
    // Entrada al cerro: en el borde sur, frente a la calle que más se acerca a él
    let gx = 0, gd = Infinity;
    for (const r of map.roads) for (const q of r.pts) if (r.sidewalk > 0 && Math.abs(q.x) < h.w - 60 && h.h - q.z < gd && q.z < h.h) { gd = h.h - q.z; gx = q.x; }
    this.hill = { cx: gx, cz: h.h + 24 + 160, r: 160, h: 55, gx, gz: h.h };
    const B = [{ x: -h.w, z: -h.h }, { x: h.w, z: -h.h }, { x: h.w, z: h.h }, { x: gx + 9, z: h.h }, { x: gx - 9, z: h.h }, { x: -h.w, z: h.h }];
    for (let i = 0; i < B.length; i++) {
      if (i === 3) continue; // hueco de la entrada al cerro
      const a = B[i]!, b = B[(i + 1) % B.length]!;
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l;
      // franja delgada por fuera del borde
      this.collision.addPolygon([a, b, { x: b.x - nx * 3, z: b.z - nz * 3 }, { x: a.x - nx * 3, z: a.z - nz * 3 }]);
    }
    this.buildHill(rnd);
    // Utilería
    const props = this.collectProps(rnd, built.backyardTrees, built.tanks);
    props.plants = built.plants;
    props.palms.push(...built.yardPalms);
    props.mangos.push(...this.hillTrees.slice(0, 40)); props.samans.push(...this.hillTrees.slice(40));
    // Utilería por zonas de 300 m: cámara y sombras solo dibujan los árboles/postes de las zonas visibles
    const Z = 300;
    const zk = (p: V2) => `${Math.floor(p.x / Z)},${Math.floor(p.z / Z)}`;
    const zones = new Map<string, PropsInput>();
    const zoneOf = (p: V2) => { const k = zk(p); let z = zones.get(k); if (!z) zones.set(k, (z = { palms: [], mangos: [], samans: [], posts: [], tanks: [], benches: [], plants: [], smallTrees: [] })); return z; };
    props.palms.forEach((p) => zoneOf(p).palms.push(p));
    props.mangos.forEach((p) => zoneOf(p).mangos.push(p));
    props.samans.forEach((p) => zoneOf(p).samans.push(p));
    props.posts.forEach((p) => zoneOf(p.p).posts.push(p));
    props.tanks.forEach((t) => zoneOf(t).tanks.push(t));
    props.benches.forEach((b) => zoneOf(b.p).benches.push(b));
    props.plants.forEach((p) => zoneOf(p).plants.push(p));
    (props.smallTrees ?? []).forEach((p) => zoneOf(p).smallTrees!.push(p));
    let first = true;
    for (const zin of zones.values()) {
      const out = buildProps(zin, rnd, first ? props.posts : undefined);
      first = false;
      this.root.add(out.group);
      this.lampMat ??= out.lampMat;
      out.trunks.forEach((t) => this.collision.addCircle(t.p.x, t.p.z, t.r));
      // todas las zonas comparten el color de los faroles (de noche se encienden juntos)
      out.group.traverse((o) => { const m = o as THREE.Mesh; if (m.material === out.lampMat && this.lampMat) m.material = this.lampMat; });
    }
    this.buildLightPools(props.posts);


    // Lugares por descubrir y punto de aparición
    const plaza = map.findArea('Plaza Jose Marti');
    this.spawn = plaza ? centroid(plaza.poly) : map.proj.toXZ(CONFIG.map.spawn);
    for (const a of map.areas) if (a.name && (a.kind === 'park' || a.tags.shop === 'mall')) this.places.push({ id: a.id, name: a.name, p: centroid(a.poly), r: 45 });
    for (const n of map.pois) if (n.tags.shop === 'mall') this.places.push({ id: n.id, name: n.name, p: n.p, r: 45 });
    const avenues = new Map<string, V2>();
    for (const r of map.roads) if (/^Avenida (El Trigal|Arturo Michelena|88 Cabriales)$/.test(r.name) && !avenues.has(r.name)) avenues.set(r.name, r.pts[Math.floor(r.pts.length / 2)]!);
    for (const [name, p] of avenues) this.places.push({ id: 'av:' + name, name, p, r: 25 });
  }

  private matCache = new Map<string, THREE.Material>();
  private material(key: string): THREE.Material {
    const hit = this.matCache.get(key);
    if (hit) return hit;
    const m = this.makeMaterial(key);
    this.matCache.set(key, m);
    return m;
  }

  private makeMaterial(key: string): THREE.Material {
    const L = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial({ vertexColors: true, ...o });
    switch (key) {
      case 'asphalt': return L({ map: T.asphalt(), side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      case 'marks': return L({ map: T.sidewalk(), side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, transparent: true, opacity: 0.85 });
      case 'sidewalk': return L({ map: T.sidewalk(), side: THREE.DoubleSide });
      case 'curb': return L({ map: T.curbGrey(), side: THREE.DoubleSide });
      case 'curbTop': return L({ map: T.curbGrey(), color: 0xd8d4cc, side: THREE.DoubleSide });
      case 'verge': return L({ map: T.grass(), color: 0xe0e8c8, side: THREE.DoubleSide });
      case 'park': return L({ map: T.grass(), color: 0xd8f0c0, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 });
      case 'stucco': return L({ map: T.stucco('#dcd8d0'), bumpMap: T.stuccoBump(), bumpScale: 1.1, side: THREE.DoubleSide });
      case 'roof': return L({ map: T.roofTiles(), side: THREE.DoubleSide });
      case 'flatroof': return L({ map: T.flatRoof(), side: THREE.DoubleSide });
      case 'gate': return L({ map: T.gateTex('#b8b8b8'), side: THREE.DoubleSide });
      case 'door': return L({ map: T.doorTex(), side: THREE.DoubleSide });
      case 'ac': return L({ map: T.acTex() });
      case 'shingles': return L({ map: T.shingles(), side: THREE.DoubleSide });
      case 'sheet': return L({ map: T.sheetMetal(), side: THREE.DoubleSide });
      case 'fence': return L({ map: T.ironFence(), alphaTest: 0.5, side: THREE.DoubleSide });
      case 'pavers': return L({ map: T.pavers(), side: THREE.DoubleSide });
      case 'dirt': return L({ map: T.dirt(), side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 });
      case 'hedge': return L({ map: T.leafMass(), color: 0x9ac070 });
      case 'window': return L({ map: windowAtlas(), side: THREE.DoubleSide });
      case 'windowLit':
        this.litMat = L({ map: windowAtlas(), emissiveMap: windowAtlas(), emissive: new THREE.Color(0xffb860), emissiveIntensity: 0, side: THREE.DoubleSide });
        return this.litMat;
      case 'storefront': return L({ map: T.storefront(), side: THREE.DoubleSide });
      case 'storefrontLit': this.shopLit = L({ map: T.storefront(), emissiveMap: T.storefront(), emissive: new THREE.Color(0xfff0d0), emissiveIntensity: 0, side: THREE.DoubleSide }); return this.shopLit;
      case 'signs':
        this.signMat = L({ map: signAtlas(), emissiveMap: null, emissive: new THREE.Color(0x000000), side: THREE.DoubleSide });
        return this.signMat;
      default: return L({ color: 0xff00ff });
    }
  }

  private meshesFromBank(bank: GeoBank): THREE.Mesh[] {
    const order: Record<string, number> = { park: 0.5, dirt: 0.5, asphalt: 1, marks: 2 };
    return bank.entries().map(([key, b]) => {
      const m = new THREE.Mesh(b.build(), this.material(key));
      m.name = key;
      m.renderOrder = order[key] ?? 3;
      const flat = key === 'asphalt' || key === 'marks' || key === 'sidewalk' || key === 'park' || key === 'pavers' || key === 'verge' || key === 'curbTop' || key === 'dirt';
      m.receiveShadow = true;
      m.castShadow = !flat;
      return m;
    });
  }

  private buildParks(bank: GeoBank, rnd: () => number): void {
    const park = bank.get('park');
    const curb = bank.get('curb');
    const walk = bank.get('sidewalk');
    const white = new THREE.Color(1, 1, 1);
    for (const a of this.map.areas) {
      if (a.kind !== 'park' && a.kind !== 'pitch') continue;
      this.parks.push({ poly: a.poly });
      // El césped va al ras y debajo del asfalto: si el polígono de OSM invade la calzada, manda la calle
      const y = 0.01;
      const tris = THREE.ShapeUtils.triangulateShape(a.poly.map((p) => new THREE.Vector2(p.x, p.z)), []);
      for (const t of tris) { const [i, j, k] = t as [number, number, number];
        const P = (n: number) => new THREE.Vector3(a.poly[n]!.x, y, a.poly[n]!.z);
        park.tri(P(i), P(j), P(k), [a.poly[i]!.x / 6, a.poly[i]!.z / 6], [a.poly[j]!.x / 6, a.poly[j]!.z / 6], [a.poly[k]!.x / 6, a.poly[k]!.z / 6], white);
      }
      void curb;
      // Caminerías: la vía peatonal más cercana o un sendero central
      const ring = offsetPolyline([...a.poly, a.poly[0]!], 0);
      const c = centroid(a.poly);
      const inner = ring.map((p) => ({ x: c.x + (p.x - c.x) * 0.7, z: c.z + (p.z - c.z) * 0.7 }));
      const L = offsetPolyline(densify(inner, 3), 1), R = offsetPolyline(densify(inner, 3), -1);
      for (let i = 0; i < L.length - 1; i++) {
        const mx = (L[i]!.x + R[i]!.x) / 2, mz = (L[i]!.z + R[i]!.z) / 2;
        if (this.map.onRoadCorridor(mx, mz, 0.5)) continue;
        walk.quad(new THREE.Vector3(R[i]!.x, 0.06, R[i]!.z), new THREE.Vector3(R[i + 1]!.x, 0.06, R[i + 1]!.z),
          new THREE.Vector3(L[i + 1]!.x, 0.06, L[i + 1]!.z), new THREE.Vector3(L[i]!.x, 0.06, L[i]!.z), [0, 0, 1, 1], white);
      }
      // Bancos a lo largo del sendero
      for (let i = 0; i < inner.length - 1; i += 2) {
        const p = inner[i]!, q = inner[i + 1]!;
        const ang = Math.atan2(q.z - p.z, q.x - p.x);
        const nx = -(q.z - p.z), nz = q.x - p.x, nl = Math.hypot(nx, nz) || 1;
        const side = rnd() < 0.5 ? 1 : -1;
        const bp = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
        if (this.map.onRoadCorridor(bp.x, bp.z, 1.5)) continue;
        this.benches.push({ p: { x: (p.x + q.x) / 2 + (nx / nl) * 1.6 * side, z: (p.z + q.z) / 2 + (nz / nl) * 1.6 * side }, ry: -ang + (side > 0 ? Math.PI : 0) });
      }
    }
  }

  /** Edificios con huella en OSM (p. ej. el C.C. Trigal Centro): extrusión con vidrieras. */
  private buildOsmBuildings(bank: GeoBank): void {
    const stucco = bank.get('stucco');
    const glass = bank.get('storefrontLit');
    const roof = bank.get('flatroof');
    for (const a of this.map.areas) {
      if (a.kind !== 'building') continue;
      const levels = Number(a.tags['building:levels'] ?? (a.tags.shop === 'mall' ? 3 : 2));
      const H = levels * 3.6;
      const c1 = new THREE.Color('#e8e4dc'), c0 = c1.clone().multiplyScalar(0.7);
      const poly = signedArea(a.poly) > 0 ? a.poly : [...a.poly].reverse();
      let u = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
        stucco.wall(p.x, p.z, q.x, q.z, 0, H, 3, c0, c1, u);
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        // Vidrieras en planta baja (desplazadas 5 cm hacia fuera)
        const nx = (q.z - p.z) / len, nz = -(q.x - p.x) / len;
        if (len > 4) glass.wall(p.x + nx * 0.05 + (q.x - p.x) / len, p.z + nz * 0.05 + (q.z - p.z) / len, q.x + nx * 0.05 - (q.x - p.x) / len, q.z + nz * 0.05 - (q.z - p.z) / len, 0.1, 3, 3, new THREE.Color(1, 1, 1));
        u += len;
      }
      const tris = THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p.x, p.z)), []);
      for (const t of tris) { const [i, j, k] = t as [number, number, number];
        const P = (n: number) => new THREE.Vector3(poly[n]!.x, H, poly[n]!.z);
        roof.tri(P(i), P(j), P(k), [poly[i]!.x / 4, poly[i]!.z / 4], [poly[j]!.x / 4, poly[j]!.z / 4], [poly[k]!.x / 4, poly[k]!.z / 4], new THREE.Color(1, 1, 1));
      }
      this.collision.addPolygon(poly);
    }
  }

  private collectProps(rnd: () => number, backyard: V2[], tanks: PropsInput['tanks']): PropsInput {
    const palms: V2[] = [], mangos: V2[] = [], samans: V2[] = [], posts: PropsInput['posts'] = [];
    const occupied = (p: V2, m: number) => this.map.onRoadCorridor(p.x, p.z, -m) || this.collision.raycast(p.x - 0.5, p.z, p.x + 0.5, p.z) < 1;
    const inLimits = (p: V2) => Math.abs(p.x) < this.map.half.w - 3 && Math.abs(p.z) < this.map.half.h - 3;
    for (const road of this.map.roads) {
      if (road.sidewalk <= 0) continue;
      const pts = densify(road.pts, 1);
      const isAvenue = road.kind === 'tertiary';
      const step = isAvenue ? 18 : 32;
      for (const side of isAvenue ? [1, -1] : [rnd() < 0.5 ? 1 : -1]) {
        const edge = offsetPolyline(pts, side * (road.width / 2 + road.sidewalk - 0.4));
        let acc = rnd() * step;
        for (let i = 1; i < edge.length; i++) {
          acc += Math.hypot(edge[i]!.x - edge[i - 1]!.x, edge[i]!.z - edge[i - 1]!.z);
          if (acc < step) continue;
          const p = edge[i]!;
          if (!inLimits(p)) continue;
          // No dentro de otra calzada
          if (this.map.onCarriageway(p.x, p.z, 0.6)) continue;
          acc = 0;
          if (isAvenue) palms.push(p);
          else {
            const a = pts[Math.min(i, pts.length - 1)]!;
            posts.push({ p, ry: Math.atan2(a.x - p.x, a.z - p.z) });
          }
        }
      }
    }
    this.stats.palms = palms.length; this.stats.posts = posts.length;
    // Vegetación en parques
    for (const pk of this.parks) {
      const xs = pk.poly.map((p) => p.x), zs = pk.poly.map((p) => p.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const area = Math.abs(signedArea(pk.poly));
      const n = Math.min(35, Math.floor(area / 260));
      for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
        const p = { x: minX + rnd() * (maxX - minX), z: minZ + rnd() * (maxZ - minZ) };
        if (!pointInPoly(p.x, p.z, pk.poly) || this.map.onRoadCorridor(p.x, p.z, 1)) continue;
        if (this.benches.some((b) => Math.hypot(b.p.x - p.x, b.p.z - p.z) < 3)) continue;
        if ([...palms, ...mangos, ...samans].some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 7)) continue;
        const r = rnd();
        (r < 0.35 ? palms : r < 0.75 ? mangos : samans).push(p);
        i++;
      }
    }
    void occupied;
    this.stats.trees = mangos.length + samans.length;
    return { palms, mangos, samans, posts, tanks, benches: this.benches, plants: [], smallTrees: backyard };
  }

  /** Charcos de luz bajo los faroles (decal aditivo), visibles de noche. */
  private buildLightPools(posts: PropsInput['posts']): void {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,200,120,1)'); grd.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.poolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    const geo = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2);
    const m = new THREE.InstancedMesh(geo, this.poolMat, Math.max(1, posts.length));
    m.count = posts.length;
    const M = new THREE.Matrix4();
    posts.forEach((p, i) => {
      const x = p.p.x + Math.sin(p.ry) * 1.8, z = p.p.z + Math.cos(p.ry) * 1.8;
      m.setMatrixAt(i, M.makeTranslation(x, 0.2, z));
    });
    m.renderOrder = 4;
    m.computeBoundingSphere();
    this.root.add(m);
  }

  /** Altura del suelo: aceras y plazas están 15 cm arriba de la calzada. */
  heightAt(x: number, z: number): number {
    const hz = this.hillHeight(x, z);
    if (hz > 0 || z > this.map.half.h) return hz;
    const near = this.map.nearestRoad(x, z, 20);
    if (!near) return 0;
    if (this.parks.some((pk) => pointInPoly(x, z, pk.poly)) && near.dist > near.road.width / 2 + near.road.sidewalk) return 0;
    if (near.dist < near.road.width / 2) return 0;
    if (near.road.sidewalk > 0 && near.dist < near.road.width / 2 + near.road.sidewalk) return SIDEWALK_H;
    return 0;
  }

  streetName(x: number, z: number): string {
    const near = this.map.nearestRoad(x, z, 18);
    return near?.road.name ?? '';
  }

  /** Iluminación según la hora: sol astronómico, colores de cielo, noche. Devuelve el factor de noche (0..1). */
  /** Noche de terror: el cielo se cierra con la niebla (sin estrellas ni luna). */
  horror = false;

  update(hours: number, focus: THREE.Vector3): number {
    const { origin } = CONFIG.map;
    const sp = solarPosition(this.doy, hours, origin.lat, origin.lon, -4);
    const d = sunDirection(sp.elevation, sp.azimuth);
    const dir = new THREE.Vector3(d.x, d.y, d.z);
    const elevDeg = THREE.MathUtils.radToDeg(sp.elevation);
    const day = THREE.MathUtils.smoothstep(elevDeg, -2, 20);
    const dusk = 1 - THREE.MathUtils.smoothstep(Math.abs(elevDeg - 2), 0, 14);
    const night = 1 - THREE.MathUtils.smoothstep(elevDeg, -10, 0);

    const zDay = new THREE.Color(0x7fa8c8), zDusk = new THREE.Color(0x5a6a9a), zNight = new THREE.Color(0x0a1226);
    const hDay = new THREE.Color(0xd6d4c2), hDusk = new THREE.Color(0xf0a060), hNight = new THREE.Color(0x24304a);
    const zenith = lerpC(lerpC(zNight, zDay, day), zDusk, dusk * 0.7);
    const horizon = lerpC(lerpC(hNight, hDay, day), hDusk, dusk);
    const sunCol = lerpC(new THREE.Color(0xffffff), new THREE.Color(0xff8a3a), dusk);

    // Luz direccional: sol de día, luna (azulada, opuesta) de noche
    const useMoon = sp.elevation < 0;
    const lightDir = useMoon ? new THREE.Vector3(-d.x, Math.max(0.4, -d.y), -d.z).normalize() : dir.clone().setY(Math.max(dir.y, 0.05)).normalize();
    this.sun.position.copy(focus).addScaledVector(lightDir, 150);
    this.sun.target.position.copy(focus);
    this.sun.color.copy(useMoon ? new THREE.Color(0x8aa0d0) : lerpC(new THREE.Color(0xffeccc), new THREE.Color(0xff9a50), dusk));
    this.sun.intensity = useMoon ? 0.55 * night : 0.45 + 2.3 * day + 0.9 * dusk;
    this.hemi.color.copy(lerpC(new THREE.Color(0x5a70a8), new THREE.Color(0xe6e2d0), day).lerp(new THREE.Color(0xffb880), dusk * 0.5));
    this.hemi.groundColor.copy(lerpC(new THREE.Color(0x262c3a), new THREE.Color(0x8a7a58), day)); // rebote cálido del suelo
    this.hemi.intensity = 0.75 + 0.5 * day + 0.35 * dusk;

    const fog = this.scene.fog as THREE.Fog;
    // Smog: bruma amarillo-grisácea que funde lo lejano (más densa de día)
    fog.color.copy(horizon).lerp(new THREE.Color(0xcfc39c), 0.45 * day).lerp(new THREE.Color(0xe8a070), dusk * 0.3);
    fog.near = 18 + 10 * day; fog.far = 240 + 120 * day;

    this.time += 1 / 60;
    if (this.horror) { const fc = new THREE.Color(0.07, 0.075, 0.08); zenith.copy(fc).multiplyScalar(0.6); horizon.copy(fc); sunCol.setScalar(0); }
    this.sky.update(focus, dir, zenith, horizon, sunCol, this.horror ? 0 : night, this.time);
    if (this.litMat) this.litMat.emissiveIntensity = 1.1 * night + 0.1 * dusk;
    if (this.shopLit) this.shopLit.emissiveIntensity = 0.9 * night;
    if (this.signMat) this.signMat.emissive.setScalar(0.35 * night);
    this.lampMat?.color.copy(lerpC(new THREE.Color(0x504a40), new THREE.Color(0xffe0a0), night * 1.2));
    this.poolMat.opacity = 0.7 * night;
    return night;
  }

  /** Faroles que parpadean (noche de terror). */
  flicker(off: boolean): void { if (this.lampMat) this.lampMat.color.setHex(off ? 0x101010 : 0xffe0a0); if (this.poolMat) this.poolMat.opacity = off ? 0.05 : 0.7; }

  setShadows(on: boolean, size = 1024): void {
    this.sun.castShadow = on;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget; }
  }
}

function signedArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i]!, q = poly[(i + 1) % poly.length]!; a += p.x * q.z - q.x * p.z; }
  return a / 2;
}

function windowAtlas(): THREE.CanvasTexture { return T.windowAtlasTex(); }
