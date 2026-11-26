// Importa un .osm (XML exportado de openstreetmap.org) a data/trigal-sur.json
// Uso: node scripts/osm-import.mjs [entrada.osm] [salida.json]
import { readFile, writeFile } from 'node:fs/promises';

const KEYS = ['highway', 'building', 'amenity', 'shop', 'leisure', 'landuse', 'natural', 'barrier'];
const KEEP_TAGS = new Set([...KEYS, 'name', 'oneway', 'lanes', 'layer', 'bridge', 'surface', 'building:levels', 'ref']);

export function parseOsm(xml) {
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const attrs = (s) => { const o = {}; for (const m of s.matchAll(/(\w[\w:]*)="([^"]*)"/g)) o[m[1]] = decode(m[2]); return o; };
  const tagsOf = (body) => { const t = {}; for (const m of body.matchAll(/<tag\s+([^>]*?)\/>/g)) { const a = attrs(m[1]); t[a.k] = a.v; } return t; };
  const nodes = new Map();
  const tagged = [];
  for (const m of xml.matchAll(/<node\s+([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const a = attrs(m[1]);
    const n = { id: a.id, lat: +a.lat, lon: +a.lon };
    nodes.set(a.id, n);
    if (m[3]) { const t = tagsOf(m[3]); if (Object.keys(t).length) tagged.push({ ...n, tags: filter(t) }); }
  }
  const ways = [];
  for (const m of xml.matchAll(/<way\s+([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const a = attrs(m[1]);
    const tags = tagsOf(m[2]);
    if (!KEYS.some((k) => k in tags)) continue;
    const coords = [];
    for (const r of m[2].matchAll(/<nd\s+ref="(\d+)"/g)) {
      const n = nodes.get(r[1]);
      if (n) coords.push([+n.lat.toFixed(7), +n.lon.toFixed(7), n.id]);
    }
    if (coords.length >= 2) ways.push({ id: a.id, tags: filter(tags), coords });
  }
  const b = xml.match(/<bounds\s+([^>]*?)\/>/);
  const bounds = b ? attrs(b[1]) : null;
  return {
    bounds: bounds && { south: +bounds.minlat, west: +bounds.minlon, north: +bounds.maxlat, east: +bounds.maxlon },
    ways,
    nodes: tagged.filter((n) => KEYS.some((k) => k in n.tags) || n.tags.name),
  };
}
function filter(t) { const o = {}; for (const [k, v] of Object.entries(t)) if (KEEP_TAGS.has(k)) o[k] = v; return o; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2] ?? 'data/trigal-sur.osm';
  const output = process.argv[3] ?? 'data/trigal-sur.json';
  const data = parseOsm(await readFile(input, 'utf8'));
  data.source = '© OpenStreetMap contributors (ODbL)';
  data.importedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(data));
  const c = (k) => data.ways.filter((w) => k in w.tags).length;
  console.log(`OK: ${data.ways.length} vías (highway ${c('highway')}, building ${c('building')}, leisure ${c('leisure')}), ${data.nodes.length} nodos con etiquetas -> ${output}`);
}
