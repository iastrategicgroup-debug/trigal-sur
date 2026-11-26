// Descarga los datos de OSM de El Trigal Sur vía Overpass API -> data/trigal-sur.json
// Uso: npm run map:fetch
import { writeFile, mkdir } from 'node:fs/promises';

const BBOX = { south: 10.2095, west: -68.002, north: 10.2155, east: -67.99 };
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const KEYS = ['highway', 'building', 'amenity', 'shop', 'leisure', 'landuse', 'natural', 'barrier'];
const bb = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `[out:json][timeout:90];
(
${KEYS.map((k) => `  nwr["${k}"](${bb});`).join('\n')}
);
out body;
>;
out skel qt;`;

let lastErr;
for (const url of ENDPOINTS) {
  try {
    console.log(`Consultando ${url} …`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'trigal-sur-demo/0.1' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.elements) || json.elements.length === 0) throw new Error('respuesta vacía');
    await mkdir('data', { recursive: true });
    await writeFile('data/trigal-sur.json', JSON.stringify({ bbox: BBOX, fetchedAt: new Date().toISOString(), source: url, ...json }));
    const count = (t) => json.elements.filter((e) => e.type === t).length;
    console.log(`OK: ${json.elements.length} elementos (nodos ${count('node')}, vías ${count('way')}, relaciones ${count('relation')}) -> data/trigal-sur.json`);
    process.exit(0);
  } catch (e) {
    lastErr = e;
    console.warn(`  falló: ${e?.cause?.message ?? e.message}`);
  }
}
console.error(`\nNo se pudo descargar el mapa (${lastErr?.message}).`);
console.error('Alternativa: exporta el área desde https://www.openstreetmap.org/export (bbox arriba) y guarda el .osm en data/trigal-sur.osm');
process.exit(1);
