import type { Settings } from '../core/Storage';

export type ScreenId = 'loading' | 'menu' | 'settings' | 'controls' | 'pause' | 'none';

/** Controles por sección (título, filas [teclas, acción]). */
const CONTROLS: [string, [string, string][]][] = [
  ['A pie', [
    ['W A S D / Flechas', 'Moverse (trota por defecto)'],
    ['Shift', 'Correr (gasta resistencia, barra amarilla)'],
    ['Alt', 'Caminar despacio'],
    ['Espacio', 'Saltar'],
    ['Ratón', 'Mirar / girar la cámara'],
    ['Rueda · V', 'Acercar o alejar la cámara'],
  ]],
  ['Pelea y armas', [
    ['Clic izq. · Q', 'Golpear (combo de 3 golpes con los puños)'],
    ['1', 'Pistola'],
    ['2', 'Escopeta (fuerte de cerca)'],
    ['3', 'AK (automática: mantén el clic)'],
    ['0', 'Guardar el arma (puños)'],
    ['Clic der. (mantener)', 'Apuntar: cámara al hombro y mira'],
    ['Clic der. + Clic izq.', 'Disparar'],
    ['R', 'Recargar'],
  ]],
  ['Vehículos', [
    ['F', 'Subir / bajarse. Si tiene conductor, lo sacas (sube estrellas)'],
    ['W · S', 'Acelerar · frenar y retroceder'],
    ['A · D', 'Girar'],
    ['Espacio', 'Freno de mano (derrapa)'],
    ['Helicóptero', 'Espacio sube · Shift baja · W/S avanza · A/D gira'],
  ]],
  ['Lugares', [
    ['E', 'Entrar o salir (anillo amarillo) · comprar · gimnasio · sentarse en un banco'],
    ['1 · 2 · 3', 'Elegir comida en el menú de compra'],
    ['E (anillo azul)', 'Carrera de motos en el cerro ($100 al primero)'],
  ]],
  ['Juego', [
    ['Esc', 'Pausa'],
    ['F3', 'Datos de depuración (FPS, posición)'],
  ]],
];
const TIPS = [
  'Estrellas ★: suben con golpes, disparos, muertes y robos de carro. Escóndete 20 s de la policía para bajarlas.',
  'Noche (8 p. m. a 5 a. m.): salen criaturas en la niebla. Los latidos avisan que hay una cerca.',
  'Objetos que flotan: verde = dinero, rojo = salud, azul = escudo, naranja = balas.',
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
  private toastEl: HTMLDivElement;
  private deathEl: HTMLDivElement;
  private placesEl: HTMLDivElement;
  private moneyEl: HTMLDivElement;
  private hurtEl: HTMLDivElement;
  private ammoEl: HTMLDivElement;
  private starsEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private menuEl: HTMLDivElement;
  private crossEl: HTMLDivElement;
  private lastStreet = '';
  private streetTimer = 0;
  private toastTimer = 0;

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
    for (const [title, rows] of CONTROLS) {
      cp.append(el('h3', 'ctl-sec', title));
      const t = el('table');
      for (const [k, v] of rows) t.append(el('tr', '', `<td>${k}</td><td>${v}</td>`));
      cp.append(t);
    }
    const tips = el('ul', 'ctl-tips');
    for (const tip of TIPS) tips.append(el('li', '', tip));
    cp.append(tips, this.buttons([['Volver', () => this.show(this.backTarget)]]));
    cp.classList.add('ctl-panel');
    controls.append(cp);
    this.add('controls', controls);

    // Ajustes
    this.add('settings', this.buildSettings());

    // HUD
    this.hud = el('div', 'hud');
    const tr = el('div', 'hud-tr');
    this.clockEl = el('div', 'clock', '17:30');
    this.moneyEl = el('div', 'money', '$0');
    this.ammoEl = el('div', 'ammo');
    this.starsEl = el('div', 'stars');
    this.speedEl = el('div', 'speedo');
    this.bannerEl = el('div', 'banner');
    this.menuEl = el('div', 'shopmenu');
    const bars = el('div', 'bars');
    const mk = (cls: string, title: string) => { const b = el('div', `bar ${cls}`); b.title = title; const f = el('div'); b.append(f); bars.append(b); return f; };
    this.healthEl = mk('health', 'Salud');
    this.shieldEl = mk('shield', 'Escudo');
    this.staminaEl = mk('stamina', 'Resistencia');
    tr.append(this.clockEl, bars, this.moneyEl, this.ammoEl, this.starsEl);
    this.minimap = el('div', 'minimap');
    this.hintEl = el('div', 'hint');
    this.streetEl = el('div', 'street');
    this.hurtEl = el('div', 'hurt');
    this.crossEl = el('div', 'cross');
    this.toastEl = el('div', 'toast');
    this.placesEl = el('div', 'places');
    this.hud.append(this.speedEl, this.bannerEl, this.menuEl, this.hurtEl, this.crossEl, tr, this.minimap, this.hintEl, this.streetEl, this.toastEl, this.placesEl);
    this.deathEl = el('div', 'death', '<div>HAS CAÍDO</div>');

    this.debug = el('div', 'debug');
    const attrib = el('div', 'attrib', '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors');

    root.append(...this.screens.values(), this.hud, this.deathEl, this.debug, attrib);
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
    const check = (key: 'invertY' | 'retro480' | 'showFps' | 'shadows' | 'postfx') => {
      const i = el('input'); i.type = 'checkbox'; i.checked = this.settings[key];
      i.addEventListener('change', () => { this.settings = { ...this.settings, [key]: i.checked }; this.h.onSettingsChange(this.settings); });
      return i;
    };
    row('Sensibilidad del ratón', range('sensitivity', 0.2, 3, 0.1));
    row('Invertir eje vertical', check('invertY'));
    row('Volumen', range('volume', 0, 1, 0.05));
    row('Render retro (480p)', check('retro480'));
    {
      const sel = document.createElement('select');
      for (const [v, t] of [['baja', 'Baja (equipos modestos)'], ['media', 'Media'], ['alta', 'Alta']] as const) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }
      sel.value = this.settings.quality;
      sel.addEventListener('change', () => { this.settings = { ...this.settings, quality: sel.value as Settings['quality'] }; this.h.onSettingsChange(this.settings); });
      const l = el('label'); l.append(el('span', '', 'Calidad gráfica'), sel); p.append(l);
    }
    row('Sombras', check('shadows'));
    row('Efectos cinematográficos', check('postfx'));
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

  updateHud(v: { hours: number; health: number; shield: number; stamina: number; hint: string; money: number }): void {
    const h = Math.floor(v.hours) % 24;
    const m = Math.floor((v.hours % 1) * 60);
    this.clockEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.healthEl.style.width = `${v.health}%`;
    this.shieldEl.style.width = `${v.shield}%`;
    this.shieldEl.parentElement!.style.display = v.shield > 0 ? '' : 'none';
    this.staminaEl.style.width = `${v.stamina}%`;
    this.hintEl.textContent = v.hint;
    this.moneyEl.textContent = '$' + v.money.toLocaleString('es-VE');
    this.healthEl.parentElement!.classList.toggle('low', v.health < 25);
  }

  /** Muestra el nombre de la calle unos segundos cuando cambia de vía. */
  street(name: string, dt: number): void {
    if (name && name !== this.lastStreet) {
      this.lastStreet = name;
      this.streetEl.textContent = name;
      this.streetTimer = 4;
    }
    this.streetTimer -= dt;
    this.streetEl.style.opacity = this.streetTimer > 0 ? String(Math.min(1, this.streetTimer)) : '0';
    this.toastTimer -= dt;
    this.toastEl.style.opacity = this.toastTimer > 0 ? String(Math.min(1, this.toastTimer)) : '0';
  }

  toast(html: string, seconds = 4): void { this.toastEl.innerHTML = html; this.toastTimer = seconds; }
  setPlaces(found: number, total: number): void { this.placesEl.textContent = `Lugares ${found}/${total}`; }
  /** Destello rojo en los bordes al recibir daño. */
  hurt(): void { this.hurtEl.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => this.hurtEl.classList.remove('on'))); }
  setWanted(n: number): void { const k = Math.ceil(n - 0.01); this.starsEl.innerHTML = k > 0 ? '★'.repeat(k) + '<span>' + '★'.repeat(5 - k) + '</span>' : ''; }
  setSpeed(kmh: number | null): void { this.speedEl.style.display = kmh === null ? 'none' : 'block'; if (kmh !== null) this.speedEl.innerHTML = `${Math.round(kmh)}<small>km/h</small>`; }
  setBanner(t: string): void { this.bannerEl.textContent = t; this.bannerEl.style.display = t ? 'block' : 'none'; this.bannerEl.classList.toggle('small', t.startsWith('Posición')); }
  setAmmo(t: string): void { this.ammoEl.textContent = t; }
  showMenu(title: string, lines: string[], money: number): void {
    this.menuEl.innerHTML = `<div class="dialog-title">${title}</div>${lines.map((l) => `<div class="mi">${l}</div>`).join('')}<div class="dialog-step">Tienes $${money} · <kbd>E</kbd> cerrar</div>`;
    this.menuEl.classList.add('on');
  }
  hideMenu(): void { this.menuEl.classList.remove('on'); }
  setAim(on: boolean): void { this.crossEl.classList.toggle('on', on); }
  fatal(title: string, msg: string): void {
    const d = el('div', 'screen dim on', `<h1 class="logo" style="font-size:40px">${title}</h1><div class="sub">${msg}</div>`);
    this.hud.parentElement!.append(d);
  }
  setDead(on: boolean): void { this.deathEl.classList.toggle('on', on); }
}
