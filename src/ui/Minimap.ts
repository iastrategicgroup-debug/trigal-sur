import type { CityMap } from '../map/osm';
import type { Lot } from '../world/buildings';
import { rectCorners } from '../world/buildings';

/** Minimapa circular que rota con la cámara. El mapa base se pinta una vez en un lienzo grande. */
export class Minimap {
  private base: HTMLCanvasElement;
  private view: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly S = 1.6; // px por metro en el mapa base
  private ox: number; private oz: number;
  zoom = 1.1; // escala de visualización

  constructor(container: HTMLElement, map: CityMap, lots: Lot[]) {
    const W = Math.ceil((map.half.w * 2 + 200) * this.S), H = Math.ceil((map.half.h * 2 + 200) * this.S);
    this.ox = map.half.w + 100; this.oz = map.half.h + 100;
    this.base = document.createElement('canvas');
    this.base.width = W; this.base.height = H;
    const g = this.base.getContext('2d')!;
    const X = (x: number) => (x + this.ox) * this.S, Z = (z: number) => (z + this.oz) * this.S;
    g.fillStyle = '#5b6a46'; g.fillRect(0, 0, W, H);
    for (const a of map.areas) {
      g.fillStyle = a.kind === 'building' ? '#8a7f74' : '#4f8a3c';
      g.beginPath(); a.poly.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.closePath(); g.fill();
    }
    g.fillStyle = '#9a8f80';
    for (const l of lots) { const c = rectCorners(l.c, l.u, l.n, l.hw, l.hd); g.beginPath(); c.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.closePath(); g.fill(); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1]) for (const r of [...map.roads].sort((a, b) => a.width - b.width)) {
      g.strokeStyle = pass ? (r.kind === 'motorway' || r.kind === 'motorway_link' ? '#e0b040' : '#2c2c2c') : '#d8d0c0';
      g.lineWidth = (r.width + (pass ? 0 : r.sidewalk * 2 + 1)) * this.S;
      g.beginPath(); r.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.stroke();
    }
    this.view = document.createElement('canvas');
    this.view.width = this.view.height = 300;
    this.view.style.width = this.view.style.height = '100%';
    this.ctx = this.view.getContext('2d')!;
    container.append(this.view);
  }

  /** yaw: orientación de la cámara; facing: orientación del jugador. */
  draw(px: number, pz: number, yaw: number, facing: number, markers: { x: number; z: number; color: string }[] = []): void {
    const c = this.ctx, R = 150;
    c.save();
    c.clearRect(0, 0, 300, 300);
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();
    c.translate(R, R);
    c.rotate(yaw);
    c.scale(this.zoom, this.zoom);
    c.drawImage(this.base, -(px + this.ox) * this.S, -(pz + this.oz) * this.S);
    for (const m of markers) {
      c.fillStyle = m.color;
      c.beginPath(); c.arc((m.x - px) * this.S, (m.z - pz) * this.S, 5 / this.zoom, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    // Norte
    const ang = yaw; // el norte (-Z) rota con el mapa
    const nX = R + Math.sin(ang) * (R - 16), nY = R - Math.cos(ang) * (R - 16);
    c.fillStyle = '#fff'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.strokeStyle = '#000'; c.lineWidth = 4; c.strokeText('N', nX, nY); c.fillText('N', nX, nY);
    // Flecha del jugador (relativa a la cámara)
    c.save();
    c.translate(R, R);
    c.rotate(yaw - facing + Math.PI);
    c.fillStyle = '#ffffff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -14); c.lineTo(9, 10); c.lineTo(0, 5); c.lineTo(-9, 10); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
}
