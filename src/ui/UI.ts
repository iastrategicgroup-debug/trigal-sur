import type { Settings } from '../core/Storage';

export type ScreenId = 'loading' | 'menu' | 'settings' | 'controls' | 'pause' | 'none';

const CONTROLS: [string, string][] = [
  ['WASD / Flechas', 'Moverse (trotar por defecto)'],
  ['Shift', 'Correr (gasta resistencia)'],
  ['Alt', 'Caminar'],
  ['Espacio', 'Saltar'],
  ['Ratón', 'Girar la cámara'],
  ['Rueda / V', 'Distancia de cámara'],
  ['Clic izq. / Q', 'Golpear'],
  ['E', 'Saludar / sentarse en un banco'],
  ['F', 'Subir o bajar de un vehículo'],
  ['M', 'Mapa'],
  ['Esc', 'Pausa'],
  ['F3', 'Depuración'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export interface UIHandlers {
  onPlay(): void;
  onResume(): void;
  onQuitToMenu(): void;
  onSettingsChange(s: Settings): void;
}

export class UI {
  private screens = new Map<ScreenId, HTMLElement>();
  private backTarget: ScreenId = 'menu';
  private loadingFill!: HTMLDivElement;
  private loadingLabel!: HTMLDivElement;
  readonly hud: HTMLDivElement;
  readonly debug: HTMLDivElement;
  readonly minimap: HTMLDivElement;
  private clockEl: HTMLDivElement;
  private healthEl: HTMLDivElement;
  private shieldEl: HTMLDivElement;
  private staminaEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private streetEl: HTMLDivElement;

  constructor(root: HTMLElement, private settings: Settings, private h: UIHandlers) {
    // Carga
    const loading = el('div', 'screen dim');
    loading.append(el('h1', 'logo', 'TRIGAL SUR'));
    const bar = el('div', 'loading-bar');
    this.loadingFill = el('div');
    bar.append(this.loadingFill);
    this.loadingLabel = el('div', 'loading-label', 'Cargando…');
    loading.append(bar, this.loadingLabel);
    this.add('loading', loading);

    // Menú
    const menu = el('div', 'screen dim');
    menu.append(el('h1', 'logo', 'TRIGAL SUR'), el('div', 'sub', 'Valencia · Carabobo · Venezuela'));
    menu.append(this.buttons([
      ['Jugar', () => h.onPlay()],
      ['Ajustes', () => this.show('settings', 'menu')],
      ['Controles', () => this.show('controls', 'menu')],
    ]));
    this.add('menu', menu);

    // Pausa
    const pause = el('div', 'screen dim');
    pause.append(el('h1', 'logo', 'PAUSA'));
    pause.append(this.buttons([
      ['Continuar', () => h.onResume()],
      ['Ajustes', () => this.show('settings', 'pause')],
      ['Controles', () => this.show('controls', 'pause')],
      ['Salir al menú', () => h.onQuitToMenu()],
    ]));
    this.add('pause', pause);

    // Controles
    const controls = el('div', 'screen dim');
    const cp = el('div', 'panel');
    cp.append(el('h2', '', 'Controles'));
    const t = el('table');
    for (const [k, v] of CONTROLS) t.append(el('tr', '', `<td>${k}</td><td>${v}</td>`));
    cp.append(t, this.buttons([['Volver', () => this.show(this.backTarget)]]));
    controls.append(cp);
    this.add('controls', controls);

    // Ajustes
    this.add('settings', this.buildSettings());

    // HUD
    this.hud = el('div', 'hud');
    const tr = el('div', 'hud-tr');
    this.clockEl = el('div', 'clock', '17:30');
    const bars = el('div', 'bars');
    const mk = (cls: string, title: string) => { const b = el('div', `bar ${cls}`); b.title = title; const f = el('div'); b.append(f); bars.append(b); return f; };
    this.healthEl = mk('health', 'Salud');
    this.shieldEl = mk('shield', 'Escudo');
    this.staminaEl = mk('stamina', 'Resistencia');
    tr.append(this.clockEl, bars);
    this.minimap = el('div', 'minimap');
    this.hintEl = el('div', 'hint');
    this.streetEl = el('div', 'street');
    this.hud.append(tr, this.minimap, this.hintEl, this.streetEl);

    this.debug = el('div', 'debug');
    const attrib = el('div', 'attrib', '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors');

    root.append(...this.screens.values(), this.hud, this.debug, attrib);
  }

  private add(id: ScreenId, e: HTMLElement) { this.screens.set(id, e); }

  private buttons(items: [string, () => void][]): HTMLElement {
    const m = el('div', 'menu');
    for (const [label, fn] of items) {
      const b = el('button', '', label);
      b.addEventListener('click', fn);
      m.append(b);
    }
    return m;
  }

  private buildSettings(): HTMLElement {
    const s = el('div', 'screen dim');
    const p = el('div', 'panel');
    p.append(el('h2', '', 'Ajustes'));
    const row = (label: string, input: HTMLInputElement) => { const l = el('label'); l.append(el('span', '', label), input); p.append(l); };
    const range = (key: 'sensitivity' | 'volume', min: number, max: number, step: number) => {
      const i = el('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step);
      i.value = String(this.settings[key]);
      i.addEventListener('input', () => { this.settings = { ...this.settings, [key]: Number(i.value) }; this.h.onSettingsChange(this.settings); });
      return i;
    };
    const check = (key: 'invertY' | 'retro480' | 'showFps') => {
      const i = el('input'); i.type = 'checkbox'; i.checked = this.settings[key];
      i.addEventListener('change', () => { this.settings = { ...this.settings, [key]: i.checked }; this.h.onSettingsChange(this.settings); });
      return i;
    };
    row('Sensibilidad del ratón', range('sensitivity', 0.2, 3, 0.1));
    row('Invertir eje vertical', check('invertY'));
    row('Volumen', range('volume', 0, 1, 0.05));
    row('Render retro (480p)', check('retro480'));
    row('Mostrar FPS', check('showFps'));
    p.append(this.buttons([['Volver', () => this.show(this.backTarget)]]));
    s.append(p);
    return s;
  }

  show(id: ScreenId, back?: ScreenId): void {
    if (back) this.backTarget = back;
    for (const [k, e] of this.screens) e.classList.toggle('on', k === id);
    const first = this.screens.get(id)?.querySelector('button');
    if (first instanceof HTMLButtonElement) first.focus({ preventScroll: true });
  }

  setLoading(fraction: number, label: string): void {
    this.loadingFill.style.width = `${Math.round(fraction * 100)}%`;
    this.loadingLabel.textContent = label;
  }

  setHudVisible(on: boolean): void { this.hud.classList.toggle('on', on); }

  updateHud(v: { hours: number; health: number; shield: number; stamina: number; hint: string; street: string }): void {
    const h = Math.floor(v.hours) % 24;
    const m = Math.floor((v.hours % 1) * 60);
    this.clockEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.healthEl.style.width = `${v.health}%`;
    this.shieldEl.style.width = `${v.shield}%`;
    this.shieldEl.parentElement!.style.display = v.shield > 0 ? '' : 'none';
    this.staminaEl.style.width = `${v.stamina}%`;
    this.hintEl.textContent = v.hint;
    this.streetEl.textContent = v.street;
  }
}
