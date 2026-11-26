import type { CityMap } from '../map/osm';
import type { Lot } from '../world/buildings';
import { rectCorners } from '../world/buildings';

export type MapIcon = 'gym' | 'comida' | 'abasto' | 'carrera' | 'cerro' | 'heli';
export interface MapMarker { x: number; z: number; color: string; icon?: MapIcon; label?: string }

export const ICON_INFO: Record<MapIcon, { bg: string; label: string }> = {
  gym: { bg: '#e05020', label: 'Gimnasio' },
  comida: { bg: '#f0b020', label: 'Camión de comida' },
  abasto: { bg: '#40a050', label: 'Abasto / tienda' },
  carrera: { bg: '#2080e0', label: 'Carrera de motos ($100)' },
  cerro: { bg: '#8a6a40', label: 'Cerro' },
  heli: { bg: '#20b0c0', label: 'Helicóptero' },
};

/** Dibuja un ícono redondo con su símbolo (pesa, cubiertos, bolsa, bandera, montaña, H). */
export function drawIcon(c: CanvasRenderingContext2D, x: number, y: number, icon: MapIcon, r: number): void {
  c.save(); c.translate(x, y);
  c.fillStyle = ICON_INFO[icon].bg; c.strokeStyle = '#000'; c.lineWidth = Math.max(1.5, r * 0.18);
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = Math.max(1.2, r * 0.16); c.lineCap = 'round';
  const k = r * 0.55;
  if (icon === 'gym') { c.beginPath(); c.moveTo(-k, 0); c.lineTo(k, 0); c.stroke(); c.fillRect(-k - k * 0.25, -k * 0.6, k * 0.4, k * 1.2); c.fillRect(k - k * 0.15, -k * 0.6, k * 0.4, k * 1.2); }
  else if (icon === 'comida') { c.beginPath(); c.moveTo(-k * 0.45, -k); c.lineTo(-k * 0.45, k); c.moveTo(-k * 0.8, -k); c.lineTo(-k * 0.8, -k * 0.2); c.lineTo(-k * 0.1, -k * 0.2); c.lineTo(-k * 0.1, -k); c.moveTo(k * 0.55, -k); c.quadraticCurveTo(k * 0.05, -k * 0.2, k * 0.55, 0); c.lineTo(k * 0.55, k); c.stroke(); }
  else if (icon === 'abasto') { c.fillRect(-k * 0.75, -k * 0.35, k * 1.5, k * 1.2); c.beginPath(); c.arc(0, -k * 0.35, k * 0.45, Math.PI, 0); c.stroke(); }
  else if (icon === 'carrera') { c.beginPath(); c.moveTo(-k * 0.6, k); c.lineTo(-k * 0.6, -k); c.stroke(); for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) c.fillRect(-k * 0.6 + j * k * 0.5, -k + i * k * 0.5, k * 0.5, k * 0.5); c.strokeRect(-k * 0.6, -k, k * 1.5, k); }
  else if (icon === 'cerro') { c.beginPath(); c.moveTo(-k, k * 0.7); c.lineTo(-k * 0.2, -k * 0.7); c.lineTo(k * 0.25, 0); c.lineTo(k * 0.5, -k * 0.35); c.lineTo(k, k * 0.7); c.closePath(); c.fill(); }
  else { c.font = `bold ${Math.round(r * 1.3)}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', 0, r * 0.08); }
  c.restore();
}

/** Minimapa circular que rota con la cámara. El mapa base se pinta una vez en un lienzo grande. */
export class Minimap {
  private base: HTMLCanvasElement;
  private view: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly S = 1.6; // px por metro en el mapa base
  private ox: number; private oz: number;
  zoom = 1.1; // escala de visualización

  constructor(container: HTMLElement, map: CityMap, lots: Lot[], hill?: { cx: number; cz: number; r: number; path: { x: number; z: number }[] }) {
    const W = Math.ceil((map.half.w * 2 + 200) * this.S), H = Math.ceil((map.half.h * 2 + 600) * this.S);
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
    for (const l of lots) { g.fillStyle = l.kind === 'baldio' ? '#8a7a5a' : '#9a8f80'; const c = rectCorners(l.c, l.u, l.n, l.hw, l.hd); g.beginPath(); c.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.closePath(); g.fill(); }
    if (hill) {
      g.fillStyle = '#7a7048'; g.beginPath(); g.arc(X(hill.cx), Z(hill.cz), hill.r * this.S, 0, 7); g.fill();
      g.strokeStyle = '#c8a870'; g.lineWidth = 6 * this.S; g.beginPath(); hill.path.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.stroke();
    }
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
  draw(px: number, pz: number, yaw: number, facing: number, markers: MapMarker[] = []): void {
    const c = this.ctx, R = 150;
    c.save();
    c.clearRect(0, 0, 300, 300);
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();
    c.translate(R, R);
    c.rotate(yaw);
    c.scale(this.zoom, this.zoom);
    c.drawImage(this.base, -(px + this.ox) * this.S, -(pz + this.oz) * this.S);
    for (const m of markers) {
      if (m.icon) {
        // íconos derechos aunque el mapa gire; los lejanos se pegan al borde
        let dx = (m.x - px) * this.S * this.zoom, dz = (m.z - pz) * this.S * this.zoom;
        const sx = dx * Math.cos(yaw) - dz * Math.sin(yaw), sy = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        const d = Math.hypot(sx, sy), lim = 130;
        const f = d > lim ? lim / d : 1;
        if (d > lim && m.icon === 'abasto') continue; // los abastos solo cuando están cerca
        c.save(); c.rotate(-yaw); c.scale(1 / this.zoom, 1 / this.zoom);
        drawIcon(c, sx * f, sy * f, m.icon, m.icon === 'abasto' ? 9 : 12);
        c.restore();
        void dx; void dz;
        continue;
      }
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

  /** Mapa completo (norte arriba) en un lienzo: ciudad, cerro, íconos, Joan y leyenda. */
  drawFull(cv: HTMLCanvasElement, px: number, pz: number, facing: number, markers: MapMarker[]): void {
    const W = cv.clientWidth, H = cv.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#3c4a34'; c.fillRect(0, 0, W, H);
    const k = Math.min(W / this.base.width, H / this.base.height) * 0.98;
    const ox = (W - this.base.width * k) / 2, oy = (H - this.base.height * k) / 2;
    c.drawImage(this.base, ox, oy, this.base.width * k, this.base.height * k);
    const X = (x: number) => ox + (x + this.ox) * this.S * k, Y = (z: number) => oy + (z + this.oz) * this.S * k;
    const boxes: [number, number, number, number][] = [];
    const sorted = [...markers].sort((a, b) => (a.icon === 'abasto' ? 0 : 1) - (b.icon === 'abasto' ? 0 : 1)); // los íconos grandes encima
    for (const m of sorted) {
      if (m.icon) drawIcon(c, X(m.x), Y(m.z), m.icon, m.icon === 'abasto' ? 7 : 12);
      else { c.fillStyle = m.color; c.beginPath(); c.arc(X(m.x), Y(m.z), 4, 0, Math.PI * 2); c.fill(); }
    }
    // Letreros que se esquivan: arriba, abajo, derecha o izquierda del ícono
    c.font = 'bold 13px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000'; c.fillStyle = '#fff'; c.textBaseline = 'middle';
    for (const m of sorted) {
      if (!m.label) continue;
      const w = c.measureText(m.label).width, h = 14, x = X(m.x), y = Y(m.z);
      const opts: [number, number][] = [[x - w / 2, y - 26], [x - w / 2, y + 12], [x + 16, y - h / 2], [x - 16 - w, y - h / 2], [x - w / 2, y - 42], [x - w / 2, y + 28]];
      const free = opts.find(([bx, by]) => !boxes.some(([ax, ay, aw, ah]) => bx < ax + aw && bx + w > ax && by < ay + ah && by + h > ay)) ?? opts[0]!;
      boxes.push([free[0], free[1], w, h]);
      c.textAlign = 'left'; c.strokeText(m.label, free[0], free[1] + h / 2); c.fillText(m.label, free[0], free[1] + h / 2);
    }
    // Joan
    c.save(); c.translate(X(px), Y(pz)); c.rotate(Math.PI - facing);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // Norte
    c.font = 'bold 20px sans-serif'; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#000'; c.fillStyle = '#fff';
    c.strokeText('N ▲', W - 40, 30); c.fillText('N ▲', W - 40, 30);
  }
}
