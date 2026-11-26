import { describe, expect, it } from 'vitest';
import { makeProjection } from '../src/map/projection';
import { CONFIG } from '../src/config';

describe('proyección', () => {
  const proj = makeProjection(CONFIG.map.origin);

  it('el origen proyecta a (0,0)', () => {
    const p = proj.toXZ(CONFIG.map.origin);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('norte va hacia -Z y este hacia +X', () => {
    const o = CONFIG.map.origin;
    expect(proj.toXZ({ lat: o.lat + 0.001, lon: o.lon }).z).toBeLessThan(0);
    expect(proj.toXZ({ lat: o.lat, lon: o.lon + 0.001 }).x).toBeGreaterThan(0);
  });

  it('escala 1:1: 0.001° de latitud ≈ 110.54 m', () => {
    const o = CONFIG.map.origin;
    expect(-proj.toXZ({ lat: o.lat + 0.001, lon: o.lon }).z).toBeCloseTo(110.54, 2);
  });

  it('usa cos(lat0) en radianes para la longitud', () => {
    const o = CONFIG.map.origin;
    const expected = 0.001 * Math.cos((o.lat * Math.PI) / 180) * 111320;
    expect(proj.toXZ({ lat: o.lat, lon: o.lon + 0.001 }).x).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(109); // cos(10.2°) ≈ 0.984
  });

  it('el bbox mide ~1.3 km x ~0.66 km', () => {
    const b = CONFIG.map.bbox;
    const sw = proj.toXZ({ lat: b.south, lon: b.west });
    const ne = proj.toXZ({ lat: b.north, lon: b.east });
    expect(ne.x - sw.x).toBeGreaterThan(1300);
    expect(ne.x - sw.x).toBeLessThan(1330);
    expect(sw.z - ne.z).toBeCloseTo(663.24, 1);
  });

  it('ida y vuelta es exacta', () => {
    const p = { lat: 10.21238, lon: -68.00029 };
    const back = proj.toLatLon(proj.toXZ(p));
    expect(back.lat).toBeCloseTo(p.lat, 10);
    expect(back.lon).toBeCloseTo(p.lon, 10);
  });
});
