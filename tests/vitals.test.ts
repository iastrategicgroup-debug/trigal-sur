import { describe, expect, it } from 'vitest';
import { Vitals } from '../src/player/Vitals';

describe('salud y escudo', () => {
  it('el escudo absorbe primero', () => {
    const v = new Vitals(); v.addShield(30);
    v.damage(50, 'golpe');
    expect(v.shield).toBe(0);
    expect(v.health).toBe(80);
  });
  it('muere a 0 y no recibe más daño', () => {
    const v = new Vitals();
    v.damage(150, 'atropello');
    expect(v.dead).toBe(true);
    expect(v.health).toBe(0);
    expect(v.lastCause).toBe('atropello');
    v.respawn();
    expect(v.dead).toBe(false);
    expect(v.health).toBe(100);
  });
  it('caída: segura hasta 3 m', () => {
    const v = new Vitals();
    v.fall(2.9); expect(v.health).toBe(100);
    v.fall(5); expect(v.health).toBeCloseTo(76, 5);
  });
  it('regenera solo tras 5 s y hasta 60', () => {
    const v = new Vitals();
    v.damage(70, 'golpe');
    for (let i = 0; i < 60 * 4; i++) v.step(1 / 60);
    expect(v.health).toBeCloseTo(30, 5);
    for (let i = 0; i < 60 * 60; i++) v.step(1 / 60);
    expect(v.health).toBeCloseTo(60, 5);
  });
});
