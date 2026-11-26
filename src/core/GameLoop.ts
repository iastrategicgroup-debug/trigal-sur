/**
 * Bucle de paso fijo con acumulador.
 * - step(dt) se llama con dt fijo (1/60 s), máximo `maxSteps` veces por cuadro.
 * - render(alpha) recibe la fracción [0,1) para interpolar entre el estado anterior y el actual.
 */
export interface LoopCallbacks {
  step(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class FixedStepLoop {
  private acc = 0;
  private last = -1;
  private rafId = 0;
  private running = false;
  /** Pasos descartados por exceder el máximo (para depuración). */
  droppedTime = 0;
  stepsLastFrame = 0;

  constructor(
    private readonly cb: LoopCallbacks,
    readonly fixedDt = 1 / 60,
    readonly maxSteps = 5,
  ) {}

  /** Avanza el bucle con un tiempo de reloj en segundos. Expuesto para pruebas. */
  advance(nowSec: number, simulate = true): void {
    if (this.last < 0) this.last = nowSec;
    const frameDt = Math.max(0, nowSec - this.last);
    this.last = nowSec;
    let steps = 0;
    if (simulate) {
      this.acc += frameDt;
      while (this.acc >= this.fixedDt && steps < this.maxSteps) {
        this.cb.step(this.fixedDt);
        this.acc -= this.fixedDt;
        steps++;
      }
      if (this.acc >= this.fixedDt) {
        // Demasiado atraso (pestaña lenta): se descarta para evitar la "espiral de la muerte".
        this.droppedTime += this.acc;
        this.acc = this.acc % this.fixedDt;
      }
    } else {
      this.acc = 0;
    }
    this.stepsLastFrame = steps;
    this.cb.render(simulate ? this.acc / this.fixedDt : 1, frameDt);
  }

  start(shouldSimulate: () => boolean): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    const tick = (t: number) => {
      if (!this.running) return;
      this.advance(t / 1000, shouldSimulate());
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
