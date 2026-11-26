/**
 * Proyección equirectangular local a metros, escala 1:1, norte hacia -Z.
 *   x = (lon - lon0) * cos(lat0) * 111320
 *   z = -(lat - lat0) * 110540
 */
export const M_PER_DEG_LON_EQ = 111320;
export const M_PER_DEG_LAT = 110540;

export interface LatLon { lat: number; lon: number }
export interface XZ { x: number; z: number }

export function makeProjection(origin: LatLon) {
  const cosLat0 = Math.cos((origin.lat * Math.PI) / 180);
  return {
    toXZ(p: LatLon): XZ {
      return {
        x: (p.lon - origin.lon) * cosLat0 * M_PER_DEG_LON_EQ,
        z: -(p.lat - origin.lat) * M_PER_DEG_LAT,
      };
    },
    toLatLon(p: XZ): LatLon {
      return {
        lon: origin.lon + p.x / (cosLat0 * M_PER_DEG_LON_EQ),
        lat: origin.lat - p.z / M_PER_DEG_LAT,
      };
    },
  };
}
export type Projection = ReturnType<typeof makeProjection>;
