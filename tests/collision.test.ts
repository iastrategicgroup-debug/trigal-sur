import { describe, expect, it } from 'vitest';
import { Collision } from '../src/world/Collision';

const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];

describe('colisiones', () => {
  it('empuja fuera de una pared y conserva el deslizamiento', () => {
    const c = new Collision(); c.addPolygon(square);
    const p = { x: -0.2, z: 5 };
    expect(c.resolve(p, 0.35)).toBe(true);
    expect(p.x).toBeCloseTo(-0.35, 5);
    expect(p.z).toBeCloseTo(5, 5);
  });
  it('no atraviesa la pared corriendo a 6 m/s con pasos grandes', () => {
    const c = new Collision(); c.addPolygon(square);
    const p = { x: -1, z: 5 };
    for (let i = 0; i < 60; i++) c.move(p, 6 / 60 * 10, 0, 0.35); // 10x más rápido que correr
    expect(p.x).toBeLessThan(0);
  });
  it('si el centro queda dentro, lo saca por el borde más cercano', () => {
    const c = new Collision(); c.addPolygon(square);
    const p = { x: 9.5, z: 5 };
    c.resolve(p, 0.35);
    expect(p.x).toBeGreaterThan(10);
  });
  it('se desliza a lo largo de la pared en diagonal', () => {
    const c = new Collision(); c.addPolygon(square);
    const p = { x: -0.4, z: 2 };
    c.move(p, 0.3, 0.3, 0.35);
    expect(p.x).toBeLessThanOrEqual(-0.35 + 1e-6);
    expect(p.z).toBeGreaterThan(2.25);
  });
  it('círculos (troncos)', () => {
    const c = new Collision(); c.addCircle(0, 0, 0.4);
    const p = { x: 0.5, z: 0 };
    c.resolve(p, 0.35);
    expect(p.x).toBeCloseTo(0.75, 5);
  });
  it('raycast de cámara', () => {
    const c = new Collision(); c.addPolygon(square);
    expect(c.raycast(-5, 5, 5, 5)).toBeCloseTo(0.5, 5);
    expect(c.raycast(-5, -5, -1, -1)).toBe(1);
  });
});
