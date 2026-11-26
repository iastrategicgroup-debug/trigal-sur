/** Minicuadros de diálogo que enseñan a jugar, paso a paso según lo que hace el jugador. */
export interface TutorialCtx { moved: number; ran: boolean; jumped: boolean; picked: boolean; time: number }

interface Step { title: string; text: string; done: (c: TutorialCtx) => boolean }

export const STEPS: Step[] = [
  { title: 'Bienvenido a El Trigal Sur', text: 'Muévete con <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> o las flechas. Gira la cámara con el ratón.', done: (c) => c.moved > 12 },
  { title: 'Correr', text: 'Mantén <kbd>Shift</kbd> para correr. La barra amarilla es tu resistencia: si se vacía, solo podrás trotar un rato.', done: (c) => c.ran },
  { title: 'Saltar', text: 'Pulsa <kbd>Espacio</kbd> para saltar. Las caídas de más de 3 m quitan salud (barra verde).', done: (c) => c.jumped },
  { title: 'Objetos flotantes', text: 'Pasa por encima para recogerlos: <span style="color:#7ee07e">dinero</span>, <span style="color:#ff7070">salud</span> y <span style="color:#70b8ff">escudo</span>. El escudo (barra azul) absorbe el daño primero.', done: (c) => c.picked || c.time > 25 },
  { title: 'Explora', text: 'Descubre plazas, el centro comercial y las avenidas. El minimapa marca los objetos. <kbd>V</kbd> o la rueda alejan la cámara; <kbd>Esc</kbd> pausa.', done: (c) => c.time > 12 },
];

export class Tutorial {
  private box: HTMLDivElement;
  private shownAt = -1;
  private stepTime = 0;

  constructor(root: HTMLElement, public step: number) {
    this.box = document.createElement('div');
    this.box.className = 'dialog';
    root.append(this.box);
  }

  get finished(): boolean { return this.step >= STEPS.length; }

  /** Devuelve true si el paso avanzó (para guardarlo). */
  update(dt: number, ctx: Omit<TutorialCtx, 'time'>): boolean {
    if (this.finished) { this.box.classList.remove('on'); return false; }
    const s = STEPS[this.step]!;
    if (this.shownAt !== this.step) {
      this.shownAt = this.step;
      this.stepTime = 0;
      this.box.innerHTML = `<div class="dialog-title">${s.title}</div><div class="dialog-text">${s.text}</div><div class="dialog-step">${this.step + 1}/${STEPS.length}</div>`;
      this.box.classList.add('on');
    }
    this.stepTime += dt;
    if (this.stepTime > 2 && s.done({ ...ctx, time: this.stepTime })) {
      this.step++;
      this.box.classList.remove('on');
      return true;
    }
    return false;
  }

  hide(): void { this.box.classList.remove('on'); }
}
