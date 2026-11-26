import type { HumanParams } from './HumanModel';
import joanJson from '../player/personaje.json';

export type Archetype = 'hombre' | 'mujer' | 'anciano' | 'anciana' | 'deportista' | 'ladron' | 'policia' | 'senora';

export const ARCHETYPES: { kind: Archetype; weight: number; label: string }[] = [
  { kind: 'hombre', weight: 0.24, label: 'Hombre' },
  { kind: 'mujer', weight: 0.24, label: 'Mujer' },
  { kind: 'anciano', weight: 0.08, label: 'Anciano' },
  { kind: 'anciana', weight: 0.08, label: 'Anciana' },
  { kind: 'deportista', weight: 0.1, label: 'Deportista' },
  { kind: 'ladron', weight: 0.1, label: 'Ladrón' },
  { kind: 'policia', weight: 0.06, label: 'Policía' },
  { kind: 'senora', weight: 0.1, label: 'Señora' },
];

const SKINS = ['#f0c8a8', '#e0b090', '#c99a78', '#b08060', '#8c6448', '#6a4a34', '#4a3224'];
const HAIR = ['#1a1410', '#2a1e16', '#4a3020', '#6a4a2a', '#9a7040', '#c8a060'];
const SHIRTS = ['#e8e4dc', '#2a4a8a', '#8a2a2a', '#2a6a4a', '#d8b040', '#f0f0f0', '#5a5a5a', '#d87040', '#6a3a8a', '#40a0c0', '#e898b0', '#203040'];
const PANTS = ['#1c2840', '#2a3a5a', '#3a3a3a', '#6a5a40', '#1a1a1a', '#8a8070', '#4a5a7a'];
const SHOES = ['#1a1612', '#3a2a20', '#f0f0f0', '#5a5a5a', '#8a5a3a'];

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
const pick = <T,>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)]!;

/** NPC ficticio por arquetipo y semilla (no se parece a personas reales). */
export function npcParams(kind: Archetype, seed: number): HumanParams {
  const r = rng(seed);
  const female = kind === 'mujer' || kind === 'anciana' || kind === 'senora';
  const grey = ['#c8c4bc', '#a8a49c', '#e0dcd4'];
  const base: HumanParams = {
    height: female ? 1.55 + r() * 0.15 : 1.65 + r() * 0.17,
    muscle: 0.2 + r() * 0.3,
    fat: 0.1 + r() * 0.4,
    female,
    skin: pick(r, SKINS),
    hair: { style: female ? (r() < 0.6 ? 'largo' : 'cola') : pick(r, ['corto', 'degradado', 'corto', 'rizado', 'calvo'] as const), color: pick(r, HAIR) },
    face: { width: 0.95 + r() * 0.15, jaw: female ? 0.85 + r() * 0.1 : 0.92 + r() * 0.15, chin: 0.8 + r() * 0.3, smile: r() * 0.6, brow: '#1e1612', browThick: female ? 0.2 : 0.4 + r() * 0.5, eye: pick(r, ['#3a2618', '#2a1a10', '#4a6a3a', '#3a5a7a']) },
    beard: { type: female ? 'ninguna' : pick(r, ['ninguna', 'ninguna', 'sombra', 'candado', 'completa'] as const), color: '#1e1612', density: 0.3 + r() * 0.5 },
    glasses: r() < 0.2 ? pick(r, ['#141414', '#5a3a20', '#a0a0a0']) : null,
    shirt: { type: pick(r, ['manga_corta', 'manga_corta', 'manga_larga', 'franelilla'] as const), color: pick(r, SHIRTS), pattern: 'liso', buttons: r() < 0.3 },
    pants: { type: female && r() < 0.4 ? 'falda' : r() < 0.15 ? 'short' : 'jean', color: pick(r, PANTS) },
    shoes: pick(r, SHOES),
    watch: r() < 0.3,
    cap: null,
    hunch: 0,
  };
  base.face.brow = base.hair.color;
  switch (kind) {
    case 'anciano': case 'anciana':
      base.hair.color = pick(r, grey); base.face.brow = base.hair.color;
      if (kind === 'anciano') base.hair.style = r() < 0.4 ? 'calvo' : 'corto';
      else base.hair.style = 'cola';
      base.height -= 0.05; base.muscle = 0.05; base.fat = 0.2 + r() * 0.3; base.hunch = 0.6 + r() * 0.4;
      base.glasses = r() < 0.7 ? '#5a3a20' : null;
      base.shirt.type = 'manga_larga'; base.shirt.buttons = kind === 'anciano';
      base.shirt.color = pick(r, ['#c8b898', '#8a9aa8', '#e8e0d0', '#a87868']);
      base.pants.type = kind === 'anciana' ? 'falda' : 'jean'; base.pants.color = pick(r, ['#6a5a48', '#4a4a50', '#2a3040']);
      if (kind === 'anciano') base.beard = { type: r() < 0.5 ? 'sombra' : 'ninguna', color: base.hair.color, density: 0.5 };
      break;
    case 'deportista':
      base.muscle = 0.75 + r() * 0.25; base.fat = 0.05 + r() * 0.1;
      base.shirt = { type: 'franelilla', color: pick(r, ['#f0f0f0', '#1a1a1a', '#d02020', '#2050c0']), pattern: 'liso', buttons: false };
      base.pants = { type: 'short', color: pick(r, ['#1a1a1a', '#2a3a6a', '#5a5a5a']) };
      base.shoes = '#f0f0f0';
      break;
    case 'ladron':
      base.shirt = { type: 'manga_larga', color: pick(r, ['#1a1a1c', '#2a2a30', '#3a3020']), pattern: 'liso', buttons: false };
      base.pants = { type: 'jean', color: '#16161a' };
      base.cap = pick(r, ['#101010', '#2a2a2a', '#6a1a1a']);
      base.hair.style = 'corto'; base.muscle = 0.35 + r() * 0.3; base.fat = 0.05 + r() * 0.15;
      base.beard = { type: 'sombra', color: '#1e1612', density: 0.6 };
      break;
    case 'policia':
      base.shirt = { type: 'manga_larga', color: '#2a3a6a', pattern: 'liso', buttons: true };
      base.pants = { type: 'jean', color: '#1a2030' };
      base.shoes = '#0e0e0e'; base.cap = '#1a2440';
      base.muscle = 0.45 + r() * 0.3; base.hair.style = 'degradado';
      break;
    case 'senora':
      base.fat = 0.7 + r() * 0.3; base.muscle = 0.1; base.hair.style = 'cola';
      base.shirt = { type: 'manga_corta', color: pick(r, ['#e898b0', '#f0d860', '#c0a8d8', '#f0f0f0', '#d87040']), pattern: 'liso', buttons: false };
      break;
  }
  return base;
}

/** Joan, el protagonista: parámetros desde personaje.json (ajustables en /personaje.html). */
export function joanParams(json: typeof joanJson = joanJson): HumanParams {
  const j = json;
  return {
    height: j.estatura,
    muscle: j.contextura.musculatura,
    fat: j.contextura.gordura,
    female: false,
    skin: j.piel,
    hair: { style: 'degradado', color: j.cabello.color },
    face: { width: j.rostro.anchoCara, jaw: j.rostro.mandibula, chin: j.rostro.menton, smile: j.rostro.boca.sonrisa, brow: j.rostro.cejas.color, browThick: j.rostro.cejas.grosor, eye: j.rostro.ojos.color },
    beard: { type: 'sombra', color: j.rostro.barba.color, density: j.rostro.barba.densidad },
    glasses: j.lentes.color,
    shirt: { type: 'manga_larga', color: j.ropa.camisa.color, pattern: 'microcuadro', buttons: true },
    pants: { type: 'jean', color: j.ropa.pantalon.color },
    shoes: j.ropa.zapatos.color,
    watch: true,
    cap: null,
    hunch: 0,
  };
}

export function randomArchetype(r: () => number): Archetype {
  let x = r();
  for (const a of ARCHETYPES) { if ((x -= a.weight) <= 0) return a.kind; }
  return 'hombre';
}
