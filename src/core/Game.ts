import * as THREE from 'three';
import { CONFIG } from '../config';
import { FixedStepLoop } from './GameLoop';
import { loadSave, writeSave, type SaveData, type Settings } from './Storage';
import { Input } from '../input/Input';
import { UI } from '../ui/UI';
import { Minimap } from '../ui/Minimap';
import { Tutorial } from '../ui/Tutorial';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { PlaceholderPlayer } from '../player/PlaceholderPlayer';
import { Vitals, type DamageSource } from '../player/Vitals';
import { CityMap, type OsmData } from '../map/osm';
import { CityWorld } from '../world/CityWorld';
import { Pickups } from '../world/Pickups';

export type FlowState = 'loading' | 'menu' | 'playing' | 'paused';

/**
 * Orquestador. Orden por paso fijo:
 * entrada -> máquina de estados -> movimiento -> colisiones -> NPC y tráfico -> animación
 * Orden por cuadro: cámara -> mundo -> interfaz -> render.
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
  private readonly vitals = new Vitals();
  private readonly pickups = new Pickups();
  private readonly loop: FixedStepLoop;
  private save: SaveData;
  private map!: CityMap;
  private world!: CityWorld;
  private minimap!: Minimap;
  private gameTime = 0;
  private hours: number = CONFIG.day.startHour;
  private money = 0;
  private stamina: number = CONFIG.stamina.max;
  private sinceRun = 99;
  private exhausted = false;
  private vy = 0;
  private grounded = true;
  private fallStartY = 0;
  private deadTimer = 0;
  private hint = '';
  private debugOn = false;
  private fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private saveTimer = 0;
  private tutorial: Tutorial;
  private tut = { moved: 0, ran: false, jumped: false, picked: false };

  constructor(private readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.save = loadSave();
    this.money = (this.save as SaveData & { money?: number }).money ?? 0;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 1200);
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
    this.tutorial = new Tutorial(this.ui.hud, (this.save as SaveData & { tutorial?: number }).tutorial ?? 0);
    this.bindEvents();
    this.resize();
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => this.autoPause());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause(); });
    document.addEventListener('pointerlockchange', () => { if (!this.input.locked) this.autoPause(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { this.debugOn = !this.debugOn; this.ui.debug.classList.toggle('on', this.debugOn || this.save.settings.showFps); }
      if (e.code === 'Escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
    });
    this.canvas.addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked) this.input.requestLock(); });
  }

  async load(): Promise<void> {
    this.ui.show('loading');
    let data!: OsmData;
    const tasks: [string, () => void | Promise<void>][] = [
      ['Preparando el renderizador', () => this.applySettings(this.save.settings)],
      ['Leyendo el mapa de OpenStreetMap', async () => { data = (await import('../../data/trigal-sur.json')).default as unknown as OsmData; }],
      ['Trazando las calles', () => { this.map = new CityMap(data); }],
      ['Construyendo El Trigal Sur', () => { this.world = new CityWorld(this.map, this.scene, this.save.settings.shadows); }],
      ['Dibujando el minimapa', () => { this.minimap = new Minimap(this.ui.minimap, this.map, this.world.lotsList); }],
      ['Creando al protagonista', () => { this.scene.add(this.player.object, this.pickups.group); this.restorePosition(); this.seedPickups(); }],
      ['Compilando sombreadores', () => { this.world.update(this.hours, this.player.pos); this.renderer.compile(this.scene, this.camera); }],
    ];
    for (let i = 0; i < tasks.length; i++) {
      const [label, fn] = tasks[i]!;
      this.ui.setLoading(i / tasks.length, `${label}…`);
      await new Promise((r) => setTimeout(r, 0));
      await fn();
    }
    this.cam.occlusion = (ax, az, bx, bz) => this.world.collision.raycast(ax, az, bx, bz);
    this.ui.setPlaces(this.save.discovered.length, this.world.places.length);
    this.ui.setLoading(1, 'Listo');
    await new Promise((r) => setTimeout(r, 150));
    this.toMenu();
    this.loop.start(() => this.state === 'playing');
  }

  private restorePosition(): void {
    const p = this.save.position;
    const s = this.world.spawn;
    if (p) { this.player.pos.set(p.x, 0, p.z); this.player.facing = p.yaw; }
    else this.player.pos.set(s.x, 0, s.z);
    this.player.pos.y = this.world.heightAt(this.player.pos.x, this.player.pos.z);
    this.player.prevPos.copy(this.player.pos);
    this.player.prevFacing = this.player.facing;
    this.cam.yaw = this.player.facing + Math.PI;
  }

  /** Escudos y botiquines repartidos por las plazas. */
  private seedPickups(): void {
    for (const pl of this.world.places) {
      if (!/Plaza|Parque/i.test(pl.name)) continue;
      this.pickups.spawn('escudo', 50, pl.p.x + 4, this.world.heightAt(pl.p.x + 4, pl.p.z), pl.p.z);
      this.pickups.spawn('salud', 25, pl.p.x - 4, this.world.heightAt(pl.p.x - 4, pl.p.z), pl.p.z + 3);
    }
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
  private resume(): void { this.state = 'playing'; this.ui.show('none'); this.input.requestLock(); }
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
    this.renderer.shadowMap.enabled = s.shadows;
    this.world?.setShadows(s.shadows);
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
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
    (this.save as SaveData & { money?: number }).money = this.money;
    writeSave(this.save);
  }

  // ---------- Daño ----------
  /** Punto único de entrada de daño al jugador (golpes, caídas, atropellos, choques). */
  hurt(amount: number, source: DamageSource): void {
    if (this.vitals.dead) return;
    this.vitals.damage(amount, source);
    this.ui.hurt();
    if (this.vitals.dead) this.die();
  }

  private die(): void {
    this.deadTimer = 4;
    this.ui.setDead(true);
    // Pierde parte del dinero; queda flotando donde cayó
    const lost = Math.floor(this.money * 0.3);
    this.money -= lost;
    if (lost > 0) this.pickups.spawn('dinero', lost, this.player.pos.x, this.player.pos.y, this.player.pos.z, 120);
  }

  private respawn(): void {
    this.ui.setDead(false);
    this.vitals.respawn();
    const s = this.world.spawn;
    this.player.pos.set(s.x, this.world.heightAt(s.x, s.z), s.z);
    this.player.prevPos.copy(this.player.pos);
    this.player.vel.set(0, 0, 0);
    this.vy = 0;
    this.ui.toast('<b>Plaza José Martí</b>De vuelta en pie', 3);
  }

  // ---------- Paso fijo ----------
  private step(dt: number): void {
    this.gameTime += dt;
    this.vitals.step(dt);
    if (this.vitals.dead) {
      this.deadTimer -= dt;
      this.player.prevPos.copy(this.player.pos);
      if (this.deadTimer <= 0) this.respawn();
      this.input.endStep();
      return;
    }
    // 1. Entrada
    const axes = this.cam.inIntro ? { x: 0, y: 0 } : this.input.axes();
    const moving = axes.x !== 0 || axes.y !== 0;
    const wantRun = (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) && moving;
    const walking = this.input.isDown('AltLeft') || this.input.isDown('AltRight');
    if (this.input.wasPressed('KeyV')) this.cam.cycleDistance();
    if (this.debugOn && this.input.wasPressed('KeyK')) this.hurt(25, 'golpe');           // prueba de daño (solo en F3)
    if (this.debugOn && this.input.wasPressed('KeyL')) this.pickups.drop(this.player.pos.x + 2, this.player.pos.y, this.player.pos.z); // prueba de botín

    // 2. Resistencia
    const st = CONFIG.stamina;
    const running = wantRun && !this.exhausted && this.stamina > 0;
    if (running) { this.stamina = Math.max(0, this.stamina - st.drain * dt); this.sinceRun = 0; if (this.stamina === 0) this.exhausted = true; }
    else { this.sinceRun += dt; if (this.sinceRun > st.regenDelay) this.stamina = Math.min(st.max, this.stamina + st.regen * dt); }
    if (this.exhausted && this.stamina >= st.minToRun) this.exhausted = false;

    // 3. Movimiento horizontal + colisiones (subpasos)
    const s = CONFIG.player.speeds;
    const before = this.player.pos.clone();
    this.player.step(dt, axes, this.cam.yaw, running ? s.run : walking ? s.walk : s.jog);
    const dx = this.player.pos.x - before.x, dz = this.player.pos.z - before.z;
    this.player.pos.x = before.x; this.player.pos.z = before.z;
    this.world.collision.move(this.player.pos, dx, dz, CONFIG.player.radius);
    this.tut.moved += Math.hypot(this.player.pos.x - before.x, this.player.pos.z - before.z);
    if (running) this.tut.ran = true;

    // 4. Vertical: salto, gravedad, brocales (sube hasta 0.25 m)
    const ground = this.world.heightAt(this.player.pos.x, this.player.pos.z);
    if (this.grounded && this.input.wasPressed('Space')) {
      this.vy = Math.sqrt(2 * CONFIG.player.gravity * CONFIG.player.jumpHeight);
      this.grounded = false;
      this.fallStartY = this.player.pos.y;
      this.tut.jumped = true;
    }
    if (!this.grounded) {
      this.vy -= CONFIG.player.gravity * dt;
      this.player.pos.y += this.vy * dt;
      this.fallStartY = Math.max(this.fallStartY, this.player.pos.y);
      if (this.player.pos.y <= ground) {
        this.player.pos.y = ground;
        this.grounded = true;
        this.vitals.fall(this.fallStartY - ground) ;
        this.vy = 0;
      }
    } else {
      const diff = ground - this.player.pos.y;
      if (diff > 0 && diff <= CONFIG.player.stepUp) this.player.pos.y += diff * Math.min(1, 20 * dt);
      else if (diff < -0.05) { this.grounded = false; this.vy = 0; this.fallStartY = this.player.pos.y; }
      else this.player.pos.y = ground + Math.max(diff, 0);
    }
    if (this.player.pos.y < -20) this.respawn(); // cayó del mundo

    // 5. Objetos flotantes
    const got = this.pickups.update(dt, this.player.pos.x, this.player.pos.y, this.player.pos.z,
      (k) => k === 'dinero' || (k === 'salud' && this.vitals.health < 100) || (k === 'escudo' && this.vitals.shield < 100));
    if (got.length) this.tut.picked = true;
    for (const g of got) {
      if (g.kind === 'dinero') { this.money += g.amount; this.ui.toast(`<b>+$${g.amount}</b>`, 1.5); }
      if (g.kind === 'salud') { this.vitals.health = Math.min(100, this.vitals.health + g.amount); this.ui.toast('<b>+Salud</b>', 1.5); }
      if (g.kind === 'escudo') { this.vitals.addShield(g.amount); this.ui.toast('<b>+Escudo</b>', 1.5); }
    }

    // 6. Lugares por descubrir
    for (const pl of this.world.places) {
      if (this.save.discovered.includes(pl.id)) continue;
      if (Math.hypot(pl.p.x - this.player.pos.x, pl.p.z - this.player.pos.z) < pl.r) {
        this.save.discovered.push(pl.id);
        this.ui.toast(`<b>${pl.name}</b>Lugar descubierto · ${this.save.discovered.length}/${this.world.places.length}`, 4);
        this.ui.setPlaces(this.save.discovered.length, this.world.places.length);
        writeSave(this.save);
      }
    }
    if (!this.cam.inIntro && this.tutorial.update(dt, this.tut)) {
      (this.save as SaveData & { tutorial?: number }).tutorial = this.tutorial.step;
      writeSave(this.save);
    }
    this.hint = '';
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
    this.cam.update(frameDt, this.player.object.position, speed > CONFIG.player.speeds.jog + 0.5, speed > 0.3, this.player.facing);
    this.hours = (CONFIG.day.startHour + (this.gameTime / CONFIG.day.realSecondsPerDay) * 24) % 24;
    this.world.update(this.hours, this.player.pos);
    if (playing) {
      this.ui.updateHud({ hours: this.hours, health: this.vitals.health, shield: this.vitals.shield, stamina: this.stamina, hint: this.hint, money: this.money });
      this.ui.street(this.world.streetName(this.player.pos.x, this.player.pos.z), frameDt);
      this.minimap.draw(this.player.pos.x, this.player.pos.z, this.cam.yaw, this.player.facing, this.pickups.positions());
      this.saveTimer += frameDt;
      if (this.saveTimer > 5) { this.saveTimer = 0; this.persist(); }
    }
    this.updateDebug(frameDt, speed);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  private updateDebug(frameDt: number, speed: number): void {
    this.fpsAcc += frameDt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }
    if (!(this.debugOn || this.save.settings.showFps)) return;
    const info = this.renderer.info.render;
    const p = this.player.pos;
    const ll = this.map.proj.toLatLon(p);
    this.ui.debug.textContent = this.debugOn
      ? `FPS ${this.fps.toFixed(0)}  pasos/cuadro ${this.loop.stepsLastFrame}\n` +
        `draw calls ${info.calls}  triángulos ${info.triangles}\n` +
        `pos ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}  (${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)})\n` +
        `vel ${speed.toFixed(2)} m/s  resistencia ${this.stamina.toFixed(0)}\n` +
        `salud ${this.vitals.health.toFixed(0)}  escudo ${this.vitals.shield.toFixed(0)}  hora ${this.hours.toFixed(2)}\n` +
        `lotes ${this.world.stats.lots} (quintas ${this.world.stats.quintas}, comercios ${this.world.stats.comercios})\n` +
        `K: daño 25 · L: soltar botín`
      : `FPS ${this.fps.toFixed(0)}`;
  }

  /** Para pruebas automatizadas y capturas. */
  get debugInfo() {
    return {
      state: this.state, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles, fps: this.fps,
      pos: this.player.pos.toArray(), health: this.vitals.health, shield: this.vitals.shield, dead: this.vitals.dead, money: this.money,
      stats: this.world.stats, pickups: this.pickups.count, places: this.world.places.map((p) => p.name),
    };
  }
  debugSetHour(h: number): void { this.gameTime = ((h - CONFIG.day.startHour + 24) % 24) / 24 * CONFIG.day.realSecondsPerDay; }
  debugTeleport(x: number, z: number, yaw: number, pitchDeg = 15, dist = 1): void {
    this.player.pos.set(x, this.world.heightAt(x, z), z); this.player.prevPos.copy(this.player.pos);
    this.cam.yaw = yaw; this.cam.pitch = pitchDeg * Math.PI / 180; this.cam.distIndex = dist;
  }
}
