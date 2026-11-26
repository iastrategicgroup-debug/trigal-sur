/**
 * Posición solar aproximada (algoritmo de la NOAA simplificado, error < 1°).
 * Devuelve elevación y azimut (desde el norte, sentido horario) en radianes.
 */
export function solarPosition(dayOfYear: number, localHours: number, latDeg: number, lonDeg: number, tzHours: number): { elevation: number; azimuth: number } {
  const rad = Math.PI / 180;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (localHours - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const timeOffset = eqTime + 4 * lonDeg - 60 * tzHours; // minutos
  const tst = localHours * 60 + timeOffset;
  const ha = (tst / 4 - 180) * rad;
  const lat = latDeg * rad;
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const elevation = Math.PI / 2 - zen;
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  az = (az + 2 * Math.PI) % (2 * Math.PI);
  return { elevation, azimuth: az };
}

/** Vector unitario hacia el sol en coordenadas del mundo (norte = -Z, este = +X). */
export function sunDirection(elevation: number, azimuth: number): { x: number; y: number; z: number } {
  const ce = Math.cos(elevation);
  return { x: Math.sin(azimuth) * ce, y: Math.sin(elevation), z: -Math.cos(azimuth) * ce };
}

export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
}
