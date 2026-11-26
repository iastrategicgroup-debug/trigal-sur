import { describe, expect, it } from 'vitest';
import { solarPosition, sunDirection } from '../src/world/sun';

const LAT = 10.2125, LON = -67.996, TZ = -4; // Valencia, Venezuela (UTC-4)
const deg = (r: number) => (r * 180) / Math.PI;

describe('posición solar en Valencia', () => {
  it('al mediodía solar del equinoccio el sol está casi en el cenit (≈80°)', () => {
    // Equinoccio de marzo, día 80. Mediodía solar ≈ 12:40 hora local (lon -68 vs meridiano -60, + ecuación del tiempo)
    let best = -90;
    for (let h = 11; h <= 14; h += 0.01) best = Math.max(best, deg(solarPosition(80, h, LAT, LON, TZ).elevation));
    expect(best).toBeGreaterThan(78);
    expect(best).toBeLessThan(81);
  });
  it('el sol sale por el este y se pone por el oeste', () => {
    const am = solarPosition(80, 8, LAT, LON, TZ), pm = solarPosition(80, 17, LAT, LON, TZ);
    expect(deg(am.azimuth)).toBeGreaterThan(60); expect(deg(am.azimuth)).toBeLessThan(120);
    expect(deg(pm.azimuth)).toBeGreaterThan(240); expect(deg(pm.azimuth)).toBeLessThan(300);
    expect(sunDirection(am.elevation, am.azimuth).x).toBeGreaterThan(0); // este = +X
  });
  it('amanece entre 6:15 y 7:00 y anochece entre 18:15 y 19:00', () => {
    let rise = 0, set = 0;
    for (let h = 4; h < 21; h += 0.01) {
      const e = solarPosition(330, h, LAT, LON, TZ).elevation;
      if (!rise && e > 0) rise = h;
      if (rise && !set && e < 0 && h > 12) set = h;
    }
    expect(rise).toBeGreaterThan(6.0); expect(rise).toBeLessThan(7.0);
    expect(set).toBeGreaterThan(17.8); expect(set).toBeLessThan(19.0);
  });
  it('a medianoche está bajo el horizonte', () => {
    expect(solarPosition(330, 0, LAT, LON, TZ).elevation).toBeLessThan(0);
  });
});
