// Descarga OSM de El Trigal Sur y lo importa a data/trigal-sur.json
// 1) API oficial de OSM (/api/0.6/map, bbox pequeño)  2) Overpass como respaldo.
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const B = { south: 10.2095, west: -68.002, north: 10.2155, east: -67.99 };
const KEYS = ['highway', 'building', 'amenity', 'shop', 'leisure', 'landuse', 'natural', 'barrier'];
const bb = `${B.south},${B.west},${B.north},${B.east}`;
const overpassQuery = `[timeout:90];(${KEYS.map((k) => `nwr["${k}"](${bb});`).join('')});out body;>;out skel qt;`;
const SOURCES = [
  { name: 'API de OpenStreetMap', url: `https://api.openstreetmap.org/api/0.6/map?bbox=${B.west},${B.south},${B.east},${B.north}` },
  { name: 'Overpass', url: 'https://overpass-api.de/api/interpreter', body: 'data=' + encodeURIComponent(overpassQuery) },
];
const headers = { 'User-Agent': 'trigal-sur-demo/0.1' };

await mkdir('data', { recursive: true });
for (const s of SOURCES) {
  try {
    console.log(`Descargando desde ${s.name}…`);
    const res = await fetch(s.url, s.body
      ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: s.body }
      : { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    if (!xml.includes('<osm')) throw new Error('respuesta no es OSM XML');
    await writeFile('data/trigal-sur.osm', xml);
    execFileSync(process.execPath, ['scripts/osm-import.mjs', 'data/trigal-sur.osm', 'data/trigal-sur.json'], { stdio: 'inherit' });
    process.exit(0);
  } catch (e) {
    console.warn(`  falló: ${e?.cause?.message ?? e.message}`);
  }
}
console.error('\nNo se pudo descargar el mapa. Exporta el área en https://www.openstreetmap.org/export,');
console.error('guárdala como data/trigal-sur.osm y ejecuta: node scripts/osm-import.mjs');
process.exit(1);
