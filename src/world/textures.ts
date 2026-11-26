import * as THREE from 'three';

/**
 * Texturas procedurales estilo era PS2: 256 px, ruido, suciedad y sombras pintadas.
 * Todo se genera en el navegador; no se usan imágenes externas.
 */
export type Rng = () => number;
export function rng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number, r: Rng) => void, opts: { repeat?: boolean; srgb?: boolean } = {}): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  draw(g, size, rng(hashStr(key)));
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Ruido de grano fino (película/sucio) sobre lo que ya hay. */
function grain(g: CanvasRenderingContext2D, s: number, r: Rng, amount: number, cell = 1): void {
  const img = g.getImageData(0, 0, s, s);
  const d = img.data;
  for (let y = 0; y < s; y += cell) for (let x = 0; x < s; x += cell) {
    const n = (r() - 0.5) * amount;
    for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) {
      const i = ((y + yy) * s + (x + xx)) * 4;
      d[i] = clamp255(d[i]! + n); d[i + 1] = clamp255(d[i + 1]! + n); d[i + 2] = clamp255(d[i + 2]! + n);
    }
  }
  g.putImageData(img, 0, 0);
}
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Manchas suaves (humedad, hollín) dibujadas también en los bordes opuestos para que la textura repita sin costura. */
function blotches(g: CanvasRenderingContext2D, s: number, r: Rng, n: number, color: string, maxR: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const x = r() * s, y = r() * s, rad = maxR * (0.3 + r() * 0.7);
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      grd.addColorStop(0, color.replace('A', String(alpha * (0.4 + r() * 0.6))));
      grd.addColorStop(1, color.replace('A', '0'));
      g.fillStyle = grd;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
}

/** Friso (pared de bloque frisado y pintado) con humedad abajo. 1 repetición = 3 m. */
export function stucco(hex: string): THREE.CanvasTexture {
  return make(`stucco-${hex}`, 256, (g, s, r) => {
    g.fillStyle = hex; g.fillRect(0, 0, s, s);
    // Salpicado del friso: grumos con luz arriba y sombra abajo
    for (let i = 0; i < 1400; i++) {
      const x = r() * s, y = r() * s, rad = 0.6 + r() * 1.3;
      g.fillStyle = 'rgba(0,0,0,0.09)'; g.beginPath(); g.arc(x + 0.8, y + 1.2, rad, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.arc(x - 0.4, y - 0.6, rad * 0.8, 0, Math.PI * 2); g.fill();
    }
    blotches(g, s, r, 18, 'rgba(255,255,255,A)', 40, 0.10);
    blotches(g, s, r, 22, 'rgba(60,45,30,A)', 50, 0.12);
    // Lluvia: chorreones verticales
    for (let i = 0; i < 14; i++) {
      const x = r() * s, w = 2 + r() * 6, h = 20 + r() * 90;
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(50,40,30,0.18)'); grd.addColorStop(1, 'rgba(50,40,30,0)');
      g.fillStyle = grd; g.fillRect(x, r() * 30, w, h);
    }
    grain(g, s, r, 22);
  });
}

/** Franja de humedad/zócalo para la parte baja de los muros (se usa como textura de color del zócalo). */
export function baseboard(): THREE.CanvasTexture {
  return make('baseboard', 256, (g, s, r) => {
    g.fillStyle = '#8c8173'; g.fillRect(0, 0, s, s);
    blotches(g, s, r, 30, 'rgba(40,50,30,A)', 40, 0.25);
    blotches(g, s, r, 20, 'rgba(30,25,20,A)', 30, 0.2);
    grain(g, s, r, 30);
  });
}

/** Teja criolla roja. 1 repetición = 2 m. */
export function roofTiles(): THREE.CanvasTexture {
  return make('roof', 256, (g, s, r) => {
    g.fillStyle = '#7a3420'; g.fillRect(0, 0, s, s);
    const rows = 10, cols = 8, rh = s / rows, cw = s / cols;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const off = (y % 2) * cw * 0.5;
      const px = x * cw + off;
      const base = 120 + r() * 50;
      for (const ox of [0, -s]) {
        const grd = g.createLinearGradient(px + ox, 0, px + ox + cw, 0);
        grd.addColorStop(0, `rgb(${base * 0.55},${base * 0.25},${base * 0.15})`);
        grd.addColorStop(0.5, `rgb(${base * 1.15},${base * 0.5},${base * 0.3})`);
        grd.addColorStop(1, `rgb(${base * 0.5},${base * 0.22},${base * 0.13})`);
        g.fillStyle = grd;
        g.fillRect(px + ox + 1, y * rh, cw - 2, rh - 1);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(px, y * rh + rh - 3, cw, 3);
    }
    blotches(g, s, r, 15, 'rgba(20,20,10,A)', 45, 0.35);  // moho
    blotches(g, s, r, 8, 'rgba(200,190,170,A)', 30, 0.15); // polvo
    grain(g, s, r, 25);
  });
}

/** Platabanda (techo plano) impermeabilizada, gris con manchas. */
export function flatRoof(): THREE.CanvasTexture {
  return make('flatroof', 256, (g, s, r) => {
    g.fillStyle = '#7c7670'; g.fillRect(0, 0, s, s);
    blotches(g, s, r, 30, 'rgba(30,30,30,A)', 50, 0.25);
    blotches(g, s, r, 10, 'rgba(160,90,50,A)', 40, 0.2);
    grain(g, s, r, 35);
  });
}

/** Asfalto gastado con parches y grietas. 1 repetición = 8 m. */
export function asphalt(): THREE.CanvasTexture {
  return make('asphalt', 256, (g, s, r) => {
    g.fillStyle = '#3d3b39'; g.fillRect(0, 0, s, s);
    grain(g, s, r, 40);
    blotches(g, s, r, 20, 'rgba(90,88,84,A)', 40, 0.25);
    // Parches rectangulares más oscuros (bacheo)
    for (let i = 0; i < 5; i++) {
      const w = 20 + r() * 60, h = 15 + r() * 40, x = r() * (s - w), y = r() * (s - h);
      g.fillStyle = `rgba(25,24,24,${0.4 + r() * 0.3})`; g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(15,15,15,0.6)'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
    }
    // Grietas
    g.strokeStyle = 'rgba(15,15,15,0.7)'; g.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      let x = r() * s, y = r() * s;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 22; y += (r() - 0.5) * 22; g.lineTo(x, y); }
      g.stroke();
    }
    grain(g, s, r, 18);
  });
}

/** Acera: losas de concreto de 1 m con juntas marcadas, bordes biselados y manchas. 1 rep = 2 m (2 losas). */
export function sidewalk(): THREE.CanvasTexture {
  return make('sidewalk2', 256, (g, s, r) => {
    g.fillStyle = '#b2aca0'; g.fillRect(0, 0, s, s);
    blotches(g, s, r, 20, 'rgba(90,85,70,A)', 40, 0.18);
    grain(g, s, r, 26);
    // Losas: dos a lo largo (v) — juntas horizontales; una junta longitudinal fina
    for (const y of [0, s / 2]) {
      const v = 0.94 + r() * 0.1;
      g.fillStyle = `rgba(${255 * v},${250 * v},${240 * v},0.06)`; g.fillRect(0, y, s, s / 2);
      g.fillStyle = 'rgba(30,28,24,0.75)'; g.fillRect(0, y, s, 3);                 // junta
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, y + 3, s, 2);          // bisel claro
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y + s / 2 - 3, s, 3);        // bisel oscuro
    }
    // Grietas ocasionales
    g.strokeStyle = 'rgba(40,36,30,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 2; i++) { let x = r() * s, y = r() * s; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += (r() - 0.3) * 16; g.lineTo(x, y); } g.stroke(); }
  });
}

/** Brocal de concreto gris (cara vertical y canto). */
export function curbGrey(): THREE.CanvasTexture {
  return make('curbgrey', 128, (g, s, r) => {
    g.fillStyle = '#a8a298'; g.fillRect(0, 0, s, s);
    blotches(g, s, r, 14, 'rgba(70,65,55,A)', 20, 0.3);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, s, 10);   // canto iluminado
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, s - 14, s, 14);    // mugre abajo
    for (let x = 0; x < s; x += 64) { g.fillStyle = 'rgba(30,28,24,0.6)'; g.fillRect(x, 0, 2, s); }
    grain(g, s, r, 22);
  });
}

/** Grama tropical: tierra de base, macollas, briznas en varios verdes y amarillos, zonas secas. 256 px = 4 m. */
export function grass(): THREE.CanvasTexture {
  return make('grass2', 256, (g, s, r) => {
    g.fillStyle = '#6b6234'; g.fillRect(0, 0, s, s);                       // tierra
    blotches(g, s, r, 30, 'rgba(70,95,35,A)', 60, 0.9);                     // masa verde
    blotches(g, s, r, 14, 'rgba(150,130,70,A)', 35, 0.45);                  // zonas secas
    blotches(g, s, r, 10, 'rgba(95,75,45,A)', 22, 0.5);                     // calvas de tierra
    grain(g, s, r, 26, 2);
    // Briznas (con envoltura para que repita sin costura)
    for (let i = 0; i < 9000; i++) {
      const x = r() * s, y = r() * s, h = 3 + r() * 6, lean = (r() - 0.5) * 4;
      const t = r();
      const c = t < 0.55 ? [70 + r() * 40, 110 + r() * 50, 35 + r() * 20] : t < 0.85 ? [100 + r() * 40, 130 + r() * 40, 45 + r() * 20] : [150 + r() * 40, 140 + r() * 30, 70 + r() * 20];
      g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.8)`;
      g.lineWidth = 1;
      for (const ox of [0, x + lean > s ? -s : x + lean < 0 ? s : 0]) for (const oy of [0, y - h < 0 ? s : 0]) {
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + lean + ox, y - h + oy); g.stroke();
      }
    }
    // Sombra de macollas
    blotches(g, s, r, 40, 'rgba(25,40,12,A)', 10, 0.35);
    // Florecitas y hojas secas
    for (let i = 0; i < 60; i++) { g.fillStyle = r() < 0.5 ? 'rgba(230,220,120,0.8)' : 'rgba(150,110,60,0.8)'; g.fillRect(r() * s, r() * s, 2, 2); }
  });
}

/** Dibuja una reja venezolana: barrotes, travesaños y arabescos en S, con sombra sobre el vidrio. */
function drawReja(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, color: string, fancy: boolean): void {
  const pass = (dx: number, dy: number, c: string, lw: number) => {
    g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'round';
    g.strokeRect(x0 + dx + 2, y0 + dy + 2, w - 4, h - 4);
    for (let x = x0 + 20; x < x0 + w - 8; x += 22) { g.beginPath(); g.moveTo(x + dx, y0 + dy + 2); g.lineTo(x + dx, y0 + h + dy - 2); g.stroke(); }
    for (const fy of [0.33, 0.66]) { g.beginPath(); g.moveTo(x0 + dx + 2, y0 + h * fy + dy); g.lineTo(x0 + w + dx - 2, y0 + h * fy + dy); g.stroke(); }
    if (fancy) {
      g.lineWidth = lw * 0.7;
      for (let x = x0 + 20; x < x0 + w - 30; x += 44) {
        const cy = y0 + h * 0.5 + dy;
        g.beginPath(); g.arc(x + 11 + dx, cy - 8, 8, Math.PI * 0.5, Math.PI * 2.0); g.stroke();
        g.beginPath(); g.arc(x + 11 + dx, cy + 8, 8, Math.PI * 1.5, Math.PI * 3.0); g.stroke();
      }
    }
  };
  pass(4, 5, 'rgba(0,0,0,0.35)', 4);  // sombra proyectada sobre el vidrio
  pass(0, 0, color, 4);
  // brillo del metal
  g.globalAlpha = 0.35; pass(-1, -1, '#ffffff', 1); g.globalAlpha = 1;
}

/** Vidrio que refleja el cielo, con cortina o cuarto oscuro detrás y brillos diagonales. */
function drawGlass(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: Rng, curtain: string | null): void {
  const sky = g.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, '#9cc4dc'); sky.addColorStop(0.45, '#6f8ea4'); sky.addColorStop(0.5, '#3c4c58'); sky.addColorStop(1, '#2a343c');
  g.fillStyle = sky; g.fillRect(x, y, w, h);
  if (curtain) {
    const cw = w * (0.35 + r() * 0.4);
    const left = r() < 0.5;
    const cx = left ? x : x + w - cw;
    for (let i = 0; i < cw; i += 6) {
      const k = 0.75 + 0.25 * Math.sin(i * 0.9);
      g.fillStyle = curtain; g.globalAlpha = 0.75 * k; g.fillRect(cx + i, y, 6, h);
    }
    g.globalAlpha = 1;
  }
  // reflejo de cielo/edificio de enfrente y brillos
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath(); g.moveTo(x + w * 0.15, y); g.lineTo(x + w * 0.4, y); g.lineTo(x + w * 0.1, y + h); g.lineTo(x - w * 0.15, y + h); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath(); g.moveTo(x + w * 0.55, y); g.lineTo(x + w * 0.62, y); g.lineTo(x + w * 0.37, y + h); g.lineTo(x + w * 0.3, y + h); g.fill();
  // polvo
  blotches(g, 256, r, 4, 'rgba(160,150,130,A)', 30, 0.08);
}

/** Marco con bisel (luz arriba-izquierda, sombra abajo-derecha). */
function bevelFrame(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, base: string): void {
  g.fillStyle = base; g.fillRect(x, y, w, t); g.fillRect(x, y + h - t, w, t); g.fillRect(x, y, t, h); g.fillRect(x + w - t, y, t, h);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, y, w, 2); g.fillRect(x, y, 2, h);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + h - 2, w, 2); g.fillRect(x + w - 2, y, 2, h);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + t, y + t, w - 2 * t, 3); g.fillRect(x + t, y + t, 3, h - 2 * t); // sombra interior
}

/** Atlas de 4 ventanas (1024x256): corrediza+reja negra, bronce+reja blanca, romanilla, sin reja. */
export function windowAtlasTex(): THREE.CanvasTexture { return makeWide(); }
let wideCache: THREE.CanvasTexture | null = null;
function makeWide(): THREE.CanvasTexture {
  if (wideCache) return wideCache;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const r = rng(777);
  const curtains = ['#d8c8a0', '#b04848', '#e8e8e0', '#6a8ab0', '#c8a060'];
  for (let v = 0; v < 4; v++) {
    const X = v * 256;
    const frame = v === 1 ? '#6a4a2a' : v === 3 ? '#4a4a48' : '#e6e2d8';
    // fondo = marco exterior
    g.fillStyle = frame; g.fillRect(X, 0, 256, 256);
    const m = 14;
    if (v === 2) {
      // Romanilla: láminas horizontales de vidrio esmerilado inclinadas
      g.fillStyle = '#20282e'; g.fillRect(X + m, m, 256 - 2 * m, 256 - 2 * m);
      for (let y = m + 2; y < 256 - m; y += 14) {
        const grd = g.createLinearGradient(0, y, 0, y + 11);
        grd.addColorStop(0, '#c8d8e0'); grd.addColorStop(1, '#7890a0');
        g.fillStyle = grd; g.fillRect(X + m + 2, y, 256 - 2 * m - 4, 11);
        g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(X + m + 2, y + 11, 256 - 2 * m - 4, 2);
      }
      g.fillStyle = '#9a9a96'; g.fillRect(X + m, m, 6, 256 - 2 * m); g.fillRect(X + 256 - m - 6, m, 6, 256 - 2 * m);
    } else {
      // Corrediza: dos hojas
      const half = (256 - 2 * m) / 2;
      drawGlass(g, X + m, m, half, 256 - 2 * m, r, curtains[Math.floor(r() * curtains.length)]!);
      drawGlass(g, X + m + half, m, half, 256 - 2 * m, r, r() < 0.5 ? curtains[Math.floor(r() * curtains.length)]! : null);
      bevelFrame(g, X + m, m, half, 256 - 2 * m, 8, frame);
      bevelFrame(g, X + m + half - 4, m, half + 4, 256 - 2 * m, 8, frame);
    }
    bevelFrame(g, X, 0, 256, 256, m, frame);
    if (v === 0) drawReja(g, X + 4, 4, 248, 248, '#161616', true);
    if (v === 1) drawReja(g, X + 4, 4, 248, 248, '#f2f0ea', true);
    if (v === 2) drawReja(g, X + 4, 4, 248, 248, '#1e1e1e', false);
    // sombra del dintel
    const sh = g.createLinearGradient(0, 0, 0, 70);
    sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.fillRect(X, 0, 256, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  wideCache = t;
  return t;
}

/** Vidriera de comercio: paños grandes con reflejos, productos detrás y marco de aluminio. 1 rep = 3 m. */
export function storefront(): THREE.CanvasTexture {
  return make('storefront', 256, (g, s, r) => {
    g.fillStyle = '#c8ccd0'; g.fillRect(0, 0, s, s);
    const panes = 3, pw = s / panes;
    for (let i = 0; i < panes; i++) {
      drawGlass(g, i * pw + 5, 10, pw - 10, s - 40, r, null);
      // estantes con productos
      for (let y = 70; y < s - 50; y += 45) {
        g.fillStyle = 'rgba(60,50,40,0.7)'; g.fillRect(i * pw + 8, y + 22, pw - 16, 3);
        for (let x = i * pw + 10; x < (i + 1) * pw - 14; x += 9) {
          g.fillStyle = `hsla(${r() * 360},60%,${40 + r() * 25}%,0.65)`; g.fillRect(x, y + 6 + r() * 6, 7, 16);
        }
      }
      bevelFrame(g, i * pw, 0, pw, s - 28, 6, '#b8bcc0');
    }
    g.fillStyle = '#6a6e72'; g.fillRect(0, s - 28, s, 28); // zócalo
    grain(g, s, r, 14);
  });
}

/** Ventana encendida de noche (mapa emisivo). */
export function windowGlow(): THREE.CanvasTexture {
  return make('window-glow', 64, (g, s) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    const grd = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s * 0.6);
    grd.addColorStop(0, '#ffd890'); grd.addColorStop(1, '#a06020');
    g.fillStyle = grd; g.fillRect(4, 4, s - 8, s - 8);
  }, { repeat: false });
}

/** Puerta de madera con reja. */
export function doorTex(): THREE.CanvasTexture {
  return make('door', 128, (g, s, r) => {
    g.fillStyle = '#5a3a22'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(30,15,5,${r() * 0.25})`; g.fillRect(r() * s, 0, 1 + r() * 2, s); }
    g.strokeStyle = 'rgba(20,10,0,0.7)'; g.lineWidth = 3;
    g.strokeRect(14, 12, s - 28, s * 0.38); g.strokeRect(14, s * 0.55, s - 28, s * 0.38);
    g.fillStyle = '#c8a040'; g.fillRect(s - 26, s * 0.5, 6, 10);
    g.strokeStyle = '#151515'; g.lineWidth = 3;
    for (let x = 8; x < s; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); }
    grain(g, s, r, 22);
  }, { repeat: false });
}

/** Portón de garaje metálico (lámina pintada, oxidado). */
export function gateTex(hex: string): THREE.CanvasTexture {
  return make(`gate-${hex}`, 256, (g, s, r) => {
    g.fillStyle = hex; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, 0, 2, s);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 2, 0, 2, s);
    }
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, s, 10); g.fillRect(0, s - 10, s, 10);
    blotches(g, s, r, 18, 'rgba(120,60,20,A)', 25, 0.55); // óxido
    // Rejilla superior calada
    g.fillStyle = '#141414';
    for (let x = 6; x < s; x += 14) g.fillRect(x, 14, 6, 40);
    grain(g, s, r, 25);
  });
}

/** Bloque de arcilla rojo sin frisar (muros de lindero). 1 repetición = 2 m. */
export function clayBlock(): THREE.CanvasTexture {
  return make('clayblock', 256, (g, s, r) => {
    g.fillStyle = '#7c6658'; g.fillRect(0, 0, s, s);
    const bh = s / 10, bw = s / 4;
    for (let y = 0; y < 10; y++) for (let x = -1; x < 5; x++) {
      const px = x * bw + (y % 2) * bw / 2;
      const v = 0.85 + r() * 0.3;
      g.fillStyle = `rgb(${165 * v},${85 * v},${55 * v})`;
      g.fillRect(px + 2, y * bh + 2, bw - 4, bh - 4);
    }
    blotches(g, s, r, 15, 'rgba(40,40,30,A)', 40, 0.3);
    grain(g, s, r, 28);
  });
}

/** Hojas de palma (alfa). */
export function palmFrond(): THREE.CanvasTexture {
  return make('palm', 128, (g, s, r) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = '#4a5a22'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, s / 2); g.quadraticCurveTo(s / 2, s / 2 - 10, s, s / 2 + 18); g.stroke();
    for (let i = 4; i < s - 4; i += 4) {
      const t = i / s, yc = s / 2 - 10 * Math.sin(t * Math.PI) + 18 * t * t;
      const len = 30 * Math.sin(t * Math.PI) + 6;
      g.strokeStyle = `rgb(${50 + r() * 40},${85 + r() * 50},${25 + r() * 20})`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(i, yc); g.lineTo(i + 8, yc - len); g.stroke();
      g.beginPath(); g.moveTo(i, yc); g.lineTo(i + 8, yc + len); g.stroke();
    }
  }, { repeat: false });
}

/** Hoja individual con nervadura, luz arriba y sombra abajo. */
function leaf(g: CanvasRenderingContext2D, x: number, y: number, len: number, w: number, ang: number, base: [number, number, number], light: number): void {
  g.save(); g.translate(x, y); g.rotate(ang);
  const grd = g.createLinearGradient(0, -w, 0, w);
  const [r, gg, b] = base;
  grd.addColorStop(0, `rgb(${r * light * 1.35},${gg * light * 1.3},${b * light * 1.1})`);
  grd.addColorStop(1, `rgb(${r * light * 0.7},${gg * light * 0.75},${b * light * 0.7})`);
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.45, -w, len, 0);
  g.quadraticCurveTo(len * 0.45, w, 0, 0);
  g.fill();
  g.strokeStyle = `rgba(20,40,10,${0.35 * light})`; g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.95, 0); g.stroke();
  g.restore();
}

/** Follaje (alfa) para mangos y samanes: racimos de hojas lanceoladas, más claras arriba. 256 px. */
export function foliage(): THREE.CanvasTexture {
  return make('foliage2', 256, (g, s, r) => {
    g.clearRect(0, 0, s, s);
    // Ramitas
    g.strokeStyle = 'rgba(70,50,30,0.9)'; g.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2; g.beginPath(); g.moveTo(s / 2, s * 0.62);
      g.quadraticCurveTo(s / 2 + Math.cos(a) * 40, s / 2 + Math.sin(a) * 30, s / 2 + Math.cos(a) * s * 0.4, s / 2 + Math.sin(a) * s * 0.38); g.stroke();
    }
    // Racimos: en cada racimo, hojas en abanico
    const clusters = 46;
    for (let c = 0; c < clusters; c++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.4;
      const cx = s / 2 + Math.cos(a) * d, cy = s / 2 + Math.sin(a) * d * 0.9;
      const light = 0.55 + 0.6 * (1 - cy / s) + (r() - 0.5) * 0.2; // más luz arriba
      const base: [number, number, number] = r() < 0.15 ? [90, 120, 40] : [45 + r() * 20, 95 + r() * 30, 30 + r() * 15];
      const n = 7 + Math.floor(r() * 6);
      const dir = r() * Math.PI * 2;
      for (let k = 0; k < n; k++) leaf(g, cx, cy, 14 + r() * 10, 3 + r() * 2.5, dir + (k / n - 0.5) * 2.4 + (r() - 0.5) * 0.3, base, light);
    }
  }, { repeat: false });
}

/** Corteza. */
export function bark(light: boolean): THREE.CanvasTexture {
  return make(`bark-${light}`, 128, (g, s, r) => {
    g.fillStyle = light ? '#9a958a' : '#4a3a2a'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += light ? 10 : 4) {
      g.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.2})`;
      g.fillRect(0, y, s, light ? 2 : 1 + r() * 2);
    }
    grain(g, s, r, 30);
  });
}

/** Rejilla del aire acondicionado de ventana. */
export function acTex(): THREE.CanvasTexture {
  return make('ac', 64, (g, s, r) => {
    g.fillStyle = '#c8c4b8'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#5a5850';
    for (let y = 8; y < s - 8; y += 4) g.fillRect(6, y, s - 12, 2);
    blotches(g, s, r, 6, 'rgba(90,70,40,A)', 14, 0.4);
    grain(g, s, r, 20);
  }, { repeat: false });
}

/** Masa de hojas opaca (para la copa sólida de los árboles). */
export function leafMass(): THREE.CanvasTexture {
  return make('leafmass', 256, (g, s, r) => {
    g.fillStyle = '#1f3414'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      const x = r() * s, y = r() * s, l = 0.45 + r() * 0.75;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        if (x + ox < -20 || x + ox > s + 20 || y + oy < -20 || y + oy > s + 20) continue;
        leaf(g, x + ox, y + oy, 10 + r() * 8, 2.5 + r() * 2, r() * Math.PI * 2, [45 + r() * 20, 90 + r() * 35, 28 + r() * 15], l);
      }
    }
    grain(g, s, r, 14);
  });
}

/** Tejas asfálticas (shingles) neutras; se tiñen por vértice (gris, azul, verde, marrón). 1 rep = 2 m. */
export function shingles(): THREE.CanvasTexture {
  return make('shingles', 256, (g, s, r) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, s, s);
    const rows = 12, rh = s / rows;
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * 12;
      for (let x = -24; x < s + 24; x += 24) {
        const v = 130 + r() * 60;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x + off + 1, y * rh, 22, rh - 2);
      }
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, y * rh + rh - 3, s, 3);
    }
    blotches(g, s, r, 16, 'rgba(30,30,25,A)', 40, 0.3);
    grain(g, s, r, 30);
  });
}

/** Lámina ondulada (zinc pintado), neutra para teñir. 1 rep = 2 m. */
export function sheetMetal(): THREE.CanvasTexture {
  return make('sheet', 256, (g, s, r) => {
    for (let x = 0; x < s; x++) {
      const v = 150 + 60 * Math.sin((x / s) * Math.PI * 2 * 12);
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, s);
    }
    blotches(g, s, r, 22, 'rgba(120,70,30,A)', 30, 0.5); // óxido
    grain(g, s, r, 20);
  });
}

/** Reja de hierro (alfa) con barrotes y remates. */
export function ironFence(): THREE.CanvasTexture {
  return make('fence', 128, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = '#181818';
    for (let x = 4; x < s; x += 16) { g.fillRect(x, 6, 4, s - 6); g.beginPath(); g.moveTo(x - 2, 8); g.lineTo(x + 2, 0); g.lineTo(x + 6, 8); g.fill(); }
    g.fillRect(0, 18, s, 4); g.fillRect(0, s - 10, s, 5);
    g.strokeStyle = '#181818'; g.lineWidth = 2;
    for (let x = 12; x < s; x += 32) { g.beginPath(); g.arc(x, 40, 7, 0, Math.PI * 2); g.stroke(); }
  });
}

/** Lajas de piedra (caminerito). */
export function pavers(): THREE.CanvasTexture {
  return make('pavers', 128, (g, s, r) => {
    g.fillStyle = '#5a5848'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9; i++) {
      const x = (i % 3) * 43 + 3 + r() * 4, y = Math.floor(i / 3) * 43 + 3 + r() * 4;
      const v = 150 + r() * 50;
      g.fillStyle = `rgb(${v},${v * 0.95},${v * 0.85})`;
      g.beginPath(); g.ellipse(x + 18, y + 18, 18, 16, r(), 0, Math.PI * 2); g.fill();
    }
    grain(g, s, r, 25);
  });
}

/** Agave / mata de hojas puntiagudas (alfa). */
export function agave(): THREE.CanvasTexture {
  return make('agave', 128, (g, s, r) => {
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 22; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.6, len = 40 + r() * 70;
      const ex = s / 2 + Math.cos(a) * len, ey = s - 4 + Math.sin(a) * len;
      const grd = g.createLinearGradient(s / 2, s, ex, ey);
      grd.addColorStop(0, '#2e4a22'); grd.addColorStop(1, r() < 0.3 ? '#a8b060' : '#6a9a48');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(s / 2 - 5, s); g.quadraticCurveTo((s / 2 + ex) / 2, (s + ey) / 2 - 6, ex, ey); g.lineTo(s / 2 + 5, s); g.fill();
    }
  }, { repeat: false });
}

/** Mapa de relieve (escala de grises) para el friso. */
export function stuccoBump(): THREE.CanvasTexture {
  return make('stucco-bump', 256, (g, s, r) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 3500; i++) {
      const v = 110 + r() * 145;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath(); g.arc(r() * s, r() * s, 0.7 + r() * 2, 0, Math.PI * 2); g.fill();
    }
    grain(g, s, r, 40);
  }, { srgb: false });
}
