/** Entrada unificada: teclado, ratón con pointer lock. Gamepad y táctil se agregan en fase 3. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'F3' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    target.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  get locked(): boolean { return document.pointerLockElement === this.target; }

  requestLock(): void {
    try {
      const r = this.target.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => { /* sin pointer lock (p. ej. en pruebas headless) */ });
    } catch { /* ignorado */ }
  }
  exitLock(): void { if (this.locked) document.exitPointerLock(); }

  isDown(code: string): boolean { return this.down.has(code); }
  wasPressed(code: string): boolean { return this.pressed.has(code); }

  /** Ejes -1..1. Y positivo = adelante. */
  axes(): { x: number; y: number } {
    const k = (a: string, b: string) => (this.isDown(a) || this.isDown(b) ? 1 : 0);
    return {
      x: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
      y: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
    };
  }

  /** Llamar al final de cada paso fijo. */
  endStep(): void { this.pressed.clear(); }
  /** Llamar al final de cada cuadro (ratón y rueda se consumen por cuadro). */
  endFrame(): void { this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
}
