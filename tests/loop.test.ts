import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../src/core/GameLoop';

function harness() {
  const log = { steps: 0, alphas: [] as number[] };
  const loop = new FixedStepLoop({ step: () => { log.steps++; }, render: (a) => { log.alphas.push(a); } }, 1 / 60, 5);
  return { loop, log };
}

describe('bucle de paso fijo', () => {
  it('a 60 Hz da un paso por cuadro', () => {
    const { loop, log } = harness();
    loop.advance(0);
    for (let i = 1; i <= 60; i++) loop.advance(i / 60 + 1e-9);
    expect(log.steps).toBe(60);
  });

  it('a 30 Hz da dos pasos por cuadro', () => {
    const { loop, log } = harness();
    loop.advance(0);
    loop.advance(1 / 30 + 1e-9);
    expect(log.steps).toBe(2);
  });

  it('limita a 5 pasos por cuadro y descarta el resto', () => {
    const { loop, log } = harness();
    loop.advance(0);
    loop.advance(1); // 1 s de atraso
    expect(log.steps).toBe(5);
    expect(loop.droppedTime).toBeGreaterThan(0.8);
  });

  it('alpha de interpolación en [0,1)', () => {
    const { loop, log } = harness();
    loop.advance(0);
    loop.advance(0.025); // 1.5 pasos
    expect(log.steps).toBe(1);
    expect(log.alphas.at(-1)!).toBeCloseTo(0.5, 5);
  });

  it('en pausa no simula', () => {
    const { loop, log } = harness();
    loop.advance(0, false);
    loop.advance(1, false);
    expect(log.steps).toBe(0);
  });
});
