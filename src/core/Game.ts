import * as THREE from 'three';
import { CONFIG } from '../config';
import { FixedStepLoop } from './GameLoop';
import { loadSave, writeSave, type SaveData, type Settings } from './Storage';
import { Input } from '../input/Input';
import { UI } from '../ui/UI';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { PlaceholderPlayer } from '../player/PlaceholderPlayer';
import { buildTestWorld } from '../world/TestWorld';

export type FlowState = 'loading' | 'menu' | 'playing' | 'paused';

/**
 * Orquestador. Orden por paso fijo:
 * entrada -> máquina de estados -> movimiento -> colisiones -> NPC y tráfico -> animación
 * Orden por cuadro: cámara -> mundo y chunks -> interfaz -> render.
 */
export class Game {
  state: FlowState = 'loading';
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cam: ThirdPersonCamera;
  private readonly input: Input;
  private readonly ui: UI;
  private readonly player = new PlaceholderPlayer();
  private readonly loop: FixedStepLoop;
  private save: SaveData;
  private world!: { update(hours: number): void };
  private gameTime = 0; // segundos de juego transcurridos
  private debugOn = false;
  private fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private saveTimer = 0;
  // Vitales (lógica completa en fases 3 y 6)
  private health: number = CONFIG.vitals.healthMax;
  private shield = 0;
  private stamina: number = CONFIG.stamina.max;

  constructor(private readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.save = loadSave();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 900);
    this.cam = new ThirdPersonCamera(this.camera);
    this.input = new Input(canvas);
    this.ui = new UI(uiRoot, this.save.settings, {
      onPlay: () => this.play(),
      onResume: () => this.resume(),
      onQuitToMenu: () => this.toMenu(),
      onSettingsChange: (s) => this.applySettings(s),
    });
    this.loop = new FixedStepLoop(
      { step: (dt) => this.step(dt), render: (a, fdt) => this.frame(a, fdt) },
      CONFIG.loop.fixedDt,
      CONFIG.loop.maxStepsPerFrame,
    );
    this.bindEvents();
    this.resize();
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => this.autoPause());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause(); });
    // Esc libera el pointer lock en el navegador: eso dispara la pausa.
    document.addEventListener('pointerlockchange', () => { if (!this.input.locked) this.autoPause(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { this.debugOn = !this.debugOn; this.ui.debug.classList.toggle('on', this.debugOn); }
      if (e.code === 'Escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
    });
    this.canvas.addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked) this.input.requestLock(); });
  }

  /** Carga con barra de progreso. Cada tarea cede el hilo para que la barra se pinte. */
  async load(): Promise<void> {
    this.ui.show('loading');
    const tasks: [string, () => void | Promise<void>][] = [
      ['Preparando el renderizador', () => this.applySettings(this.save.settings)],
      ['Construyendo El Trigal Sur', () => { this.world = buildTestWorld(this.scene); }],
      ['Creando al protagonista', () => { this.scene.add(this.player.object); this.restorePosition(); }],
      ['Compilando sombreadores', () => this.renderer.compile(this.scene, this.camera)],
    ];
    for (let i = 0; i < tasks.length; i++) {
      const [label, fn] = tasks[i]!;
      this.ui.setLoading(i / tasks.length, `${label}…`);
      await new Promise((r) => setTimeout(r, 0));
      await fn();
    }
    this.ui.setLoading(1, 'Listo');
    await new Promise((r) => setTimeout(r, 150));
    this.toMenu();
    this.loop.start(() => this.state === 'playing');
  }

  private restorePosition(): void {
    const p = this.save.position;
    if (p) { this.player.pos.set(p.x, 0, p.z); this.player.facing = p.yaw; }
    this.player.prevPos.copy(this.player.pos);
    this.player.prevFacing = this.player.facing;
    this.cam.yaw = this.player.facing + Math.PI;
  }

  // ---------- Flujo ----------
  private play(): void {
    this.state = 'playing';
    this.ui.show('none');
    this.ui.setHudVisible(true);
    this.cam.startIntro();
    this.input.requestLock();
  }
  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.persist();
    this.ui.show('pause', 'pause');
  }
  private autoPause(): void { if (this.state === 'playing' && !this.cam.inIntro) this.pause(); }
  private resume(): void {
    this.state = 'playing';
    this.ui.show('none');
    this.input.requestLock();
  }
  private toMenu(): void {
    this.state = 'menu';
    this.persist();
    this.input.exitLock();
    this.ui.setHudVisible(false);
    this.ui.show('menu', 'menu');
  }

  private applySettings(s: Settings): void {
    this.save.settings = s;
    this.ui.debug.classList.toggle('on', this.debugOn || s.showFps);
    this.resize();
    writeSave(this.save);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const ratio = this.save.settings.retro480 ? 480 / h : Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private persist(): void {
    this.save.position = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.facing };
    writeSave(this.save);
  }

  // ---------- Paso fijo ----------
  private step(dt: number): void {
    this.gameTime += dt;
    // 1. Entrada
    const axes = this.cam.inIntro ? { x: 0, y: 0 } : this.input.axes();
    const running = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
    const walking = this.input.isDown('AltLeft') || this.input.isDown('AltRight');
    if (this.input.wasPressed('KeyV')) this.cam.cycleDistance();
    // 2-3. Estados y movimiento (fase 3 añade máquina de estados, salto, resistencia y colisiones)
    const s = CONFIG.player.speeds;
    this.player.step(dt, axes, this.cam.yaw, running ? s.run : walking ? s.walk : s.jog);
    // 4-6. Colisiones, NPC/tráfico, animación: pendientes (fases 3, 4 y 6)
    this.input.endStep();
  }

  // ---------- Por cuadro ----------
  private frame(alpha: number, frameDt: number): void {
    const playing = this.state === 'playing';
    if (playing) {
      this.cam.look(this.input.mouseDX, this.input.mouseDY, this.save.settings.sensitivity, this.save.settings.invertY);
      if (this.input.wheel) this.cam.zoom(this.input.wheel);
    }
    this.player.render(playing ? alpha : 1);
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    // Cámara
    this.cam.update(frameDt, this.player.object.position, speed > CONFIG.player.speeds.jog + 0.5);
    // Mundo
    const hours = (CONFIG.day.startHour + (this.gameTime / CONFIG.day.realSecondsPerDay) * 24) % 24;
    this.world.update(hours);
    // Interfaz
    if (playing) {
      this.ui.updateHud({ hours, health: this.health, shield: this.shield, stamina: this.stamina, hint: '', street: 'Fase 1 · Escenario de prueba' });
      this.saveTimer += frameDt;
      if (this.saveTimer > 5) { this.saveTimer = 0; this.persist(); }
    }
    this.updateDebug(frameDt, speed, hours);
    // Render
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  private updateDebug(frameDt: number, speed: number, hours: number): void {
    this.fpsAcc += frameDt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }
    if (!(this.debugOn || this.save.settings.showFps)) return;
    const info = this.renderer.info.render;
    const p = this.player.pos;
    this.ui.debug.textContent = this.debugOn
      ? `FPS ${this.fps.toFixed(0)}  pasos/cuadro ${this.loop.stepsLastFrame}\n` +
        `draw calls ${info.calls}  triángulos ${info.triangles}\n` +
        `pos ${p.x.toFixed(1)}, ${p.z.toFixed(1)}  vel ${speed.toFixed(2)} m/s\n` +
        `cám yaw ${(this.cam.yaw * 57.3).toFixed(0)}°  pitch ${(this.cam.pitch * 57.3).toFixed(0)}°\n` +
        `hora ${hours.toFixed(2)}  estado ${this.state}`
      : `FPS ${this.fps.toFixed(0)}`;
  }

  /** Para pruebas automatizadas. */
  get debugInfo() {
    return { state: this.state, calls: this.renderer.info.render.calls, fps: this.fps, pos: this.player.pos.toArray() };
  }
}
