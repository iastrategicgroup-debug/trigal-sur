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
import { Avatar } from '../character/Avatar';
import { joanParams } from '../character/archetypes';
import { NpcManager } from '../npc/NpcManager';
import { PostFX } from './PostFX';
import { Places, type Action, type MenuItem } from '../world/Places';
import { Monsters } from '../npc/Monsters';
import { Sfx } from '../audio/Sfx';
import { Traffic } from '../vehicle/Traffic';
import { Vehicle } from '../vehicle/Vehicle';
import { Race } from '../vehicle/Race';
import { WEAPONS, gunModel, GunFx, type WeaponId } from '../player/Weapons';

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
  private joan!: Avatar;
  private fx!: PostFX;
  private night = 0;
  private npcs!: NpcManager;
  /** Estado de acción del jugador (la locomoción se decide por velocidad). */
  private action: 'ninguna' | 'golpe' | 'saludar' | 'sentado' | 'comer' | 'pesas' | 'trotadora' | 'cansado' | 'disparo' = 'ninguna';
  private places!: Places;
  private monsters!: Monsters;
  private readonly sfx = new Sfx();
  private outside: { x: number; z: number; facing: number } | null = null;
  private menu: { title: string; items: MenuItem[] } | null = null;
  private pendingFood: MenuItem | null = null;
  private repT = 0;
  private strength = 0;
  private endurance = 0;
  /** Arsenal de Joan: arma actual, balas en el cargador y de reserva. */
  private weapon: WeaponId = 'pistola';
  private mag: Record<string, number> = { pistola: 15, escopeta: 6, ak: 30 };
  private reserve: Record<string, number> = { pistola: 90, escopeta: 30, ak: 240 };
  private guns: Record<string, { group: THREE.Group; muzzle: THREE.Object3D }> = {};
  private gunFx = new GunFx();
  private reloadT = 0;
  private heartT = 0;
  private gunCd = 0;
  private horror = false;
  private traffic!: Traffic;
  private race!: Race;
  private vehicle: Vehicle | null = null;
  private notSeenT = 0;
  private arrestT = 0;
  private raceLock = false;
  private mapOpen = false;

  /** Mapa grande (M): pausa el juego y muestra la ciudad completa con íconos y leyenda. */
  private toggleMap(): void {
    this.mapOpen = !this.mapOpen;
    this.state = this.mapOpen ? 'paused' : 'playing';
    this.ui.showBigMap(this.mapOpen);
    if (this.mapOpen) this.minimap.drawFull(this.ui.bigMapCanvas, this.player.pos.x, this.player.pos.z, this.player.facing, this.mapMarkers());
  }

  /** Puntos de interés para los mapas. */
  private mapMarkers(): import('../ui/Minimap').MapMarker[] {
    const H = this.world.hill;
    const heli = this.traffic.list.find((v) => v.kind === 'heli');
    return [
      ...this.places.mapMarkers(),
      { x: H.cx, z: H.cz, color: '#8a6a40', icon: 'cerro', label: 'Cerro' },
      { x: this.race.marker.x, z: this.race.marker.z, color: '#2080e0', icon: 'carrera', label: 'Carrera de motos' },
      ...(heli ? [{ x: heli.pos.x, z: heli.pos.z, color: '#20b0c0', icon: 'heli' as const, label: 'Helicóptero' }] : []),
    ];
  }
  private actionT = 0;
  private combo = 0;
  private punchCd = 0;
  private pendingHit = -1;
  private idleT = 0;
  private landT = 0;
  private tut = { moved: 0, ran: false, jumped: false, picked: false };

  constructor(private readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.save = loadSave();
    this.money = (this.save as SaveData & { money?: number }).money ?? 0;
    const ex = this.save as SaveData & { strength?: number; endurance?: number; shotgun?: boolean; ammo?: number };
    this.strength = ex.strength ?? 0; this.endurance = ex.endurance ?? 0; const wx = this.save as SaveData & { mag?: Record<string, number>; reserve?: Record<string, number> }; if (wx.mag) this.mag = wx.mag; if (wx.reserve) this.reserve = wx.reserve;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false; // con postproceso hay varias pasadas: se reinicia una vez por cuadro
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // sombras de borde suave
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 1200);
    this.cam = new ThirdPersonCamera(this.camera);
    this.fx = new PostFX(this.renderer, this.scene, this.camera);
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
    // Si la tarjeta gráfica se queda sin memoria, en vez de una pestaña rota: aviso y recarga en calidad baja
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.persist();
      this.save.settings = { ...this.save.settings, quality: 'baja', postfx: false, shadows: false };
      writeSave(this.save);
      this.ui.fatal('La tarjeta gráfica se quedó sin memoria', 'Se activó la calidad baja. Recargando…');
      setTimeout(() => location.reload(), 2500);
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => this.autoPause());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause(); });
    document.addEventListener('pointerlockchange', () => { if (!this.input.locked) this.autoPause(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { this.debugOn = !this.debugOn; this.ui.debug.classList.toggle('on', this.debugOn || this.save.settings.showFps); }
      if (e.code === 'KeyM' && (this.state === 'playing' || this.mapOpen)) { this.toggleMap(); return; }
      if (e.code === 'Escape') {
        if (this.mapOpen) { this.toggleMap(); return; }
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
      ['Dibujando el minimapa', () => { this.minimap = new Minimap(this.ui.minimap, this.map, this.world.lotsList, { ...this.world.hill, path: this.world.racePath }); }],
      ['Creando a Joan', () => {
        this.joan = new Avatar(joanParams(), true);
        this.player.object.add(this.joan.object);
        this.scene.add(this.player.object, this.pickups.group);
        this.restorePosition();
      }],
      ['Abriendo casas, abastos y el gimnasio', () => { this.places = new Places(this.world); this.scene.add(this.places.group); this.pickups.resolver = (q) => { this.world.collision.resolve(q, 0.6); }; this.seedPickups(); }],
      ['Algo despierta en la noche', () => { this.monsters = new Monsters(this.world, this.pickups); this.scene.add(this.monsters.group); this.monsters.onGroan = (d) => this.sfx.groan(d); this.setupWeapons(); }],
      ['Sacando los carros a la calle', () => {}],
      ['Llenando las calles de gente', () => { this.npcs = new NpcManager(this.world, this.pickups); this.npcs.cap = this.save.settings.quality === 'baja' ? 20 : this.save.settings.quality === 'media' ? 40 : 60; this.scene.add(this.npcs.group); this.npcs.populate(this.player.pos, this.npcs.cap - 5); this.setupVehicles(); }],
      ['Compilando sombreadores', () => { this.world.update(this.hours, this.player.pos); this.renderer.compile(this.scene, this.camera); }],
    ];
    for (let i = 0; i < tasks.length; i++) {
      const [label, fn] = tasks[i]!;
      this.ui.setLoading(i / tasks.length, `${label}…`);
      await new Promise((r) => setTimeout(r, 0));
      await fn();
    }
    this.cam.occlusion = (ax, az, bx, bz) => this.world.collision.raycast(ax, az, bx, bz);
    this.pickups.resolver = (q) => { this.world.collision.resolve(q, 0.5); };
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
    this.input.freeLook = true;
    this.ui.show('none');
    this.ui.setHudVisible(true);
    this.cam.startIntro();
    this.sfx.unlock();
    this.input.requestLock();
  }
  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.freeLook = false;
    this.input.exitLock();
    this.persist();
    this.ui.show('pause', 'pause');
  }
  private autoPause(): void { if (this.state === 'playing' && !this.cam.inIntro && !this.mapOpen) this.pause(); }
  private resume(): void { this.state = 'playing'; this.input.freeLook = true; this.ui.show('none'); this.input.requestLock(); }
  private toMenu(): void {
    this.state = 'menu';
    this.input.freeLook = false;
    this.persist();
    this.input.exitLock();
    this.ui.setHudVisible(false);
    this.ui.show('menu', 'menu');
  }

  private applySettings(s: Settings): void {
    this.save.settings = s;
    this.ui.debug.classList.toggle('on', this.debugOn || s.showFps);
    this.renderer.shadowMap.enabled = s.shadows;
    this.world?.setShadows(s.shadows, s.quality === 'alta' ? 2048 : 1024);
    if (this.npcs) this.npcs.cap = s.quality === 'baja' ? 20 : s.quality === 'media' ? 40 : 60;
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    this.resize();
    writeSave(this.save);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    // Resolución interna limitada: con efectos, los búferes de imagen a resolución "retina" consumen cientos de MB
    const q = this.save.settings.quality;
    const cap = q === 'alta' ? 1.5 : q === 'media' ? 1.25 : 1;
    const ratio = this.save.settings.retro480 ? 480 / h : Math.min(window.devicePixelRatio, cap) * (q === 'baja' ? 0.85 : 1);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.fx?.setSize(w, h, ratio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private persist(): void {
    this.save.position = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.facing };
    (this.save as SaveData & { money?: number }).money = this.money;
    Object.assign(this.save, { strength: this.strength, endurance: this.endurance, mag: this.mag, reserve: this.reserve });
    if (this.outside) this.save.position = { x: this.outside.x, z: this.outside.z, yaw: this.outside.facing };
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
    if (this.vehicle) this.exitVehicle(true);
    this.traffic.wanted = 0;
    this.deadTimer = 4;
    this.joan.play('death', 0.1, true);
    this.action = 'ninguna';
    this.ui.setDead(true);
    // Pierde parte del dinero; queda flotando donde cayó
    const lost = Math.floor(this.money * 0.3);
    this.money -= lost;
    if (lost > 0) this.pickups.spawn('dinero', lost, this.player.pos.x, this.player.pos.y, this.player.pos.z, 120);
  }

  private respawn(): void {
    this.ui.setDead(false);
    this.vitals.respawn();
    this.joan.play('idle', 0.1, true);
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
    // F: subir / bajar de vehículos
    if (this.input.wasPressed('KeyF') && !this.cam.inIntro && !this.raceLock) {
      if (this.vehicle) this.exitVehicle();
      else if (!this.outside) { const v = this.traffic.nearestEnterable(this.player.pos, 3.2); if (v) this.enterVehicle(v); }
    }
    if (this.vehicle) { this.stepVehicle(dt); return; }
    // 1. Entrada
    const axes = this.cam.inIntro ? { x: 0, y: 0 } : this.input.axes();
    const moving = axes.x !== 0 || axes.y !== 0;
    const wantRun = (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) && moving;
    const walking = this.input.isDown('AltLeft') || this.input.isDown('AltRight');
    if (this.input.wasPressed('KeyV')) this.cam.cycleDistance();
    const aiming = this.input.isDown('Mouse2');
    this.cam.aim = aiming;
    // Golpes (clic izquierdo o Q): combo de 3, el tercero más fuerte
    this.punchCd -= dt;
    this.gunCd -= dt;
    const attack = this.input.wasPressed('Mouse0') || this.input.wasPressed('KeyQ');
    if (attack && this.menu) { /* menú abierto: no ataca */ }
    // Cambiar de arma: 1 pistola · 2 escopeta · 3 AK · 0 puños; R recarga
    if (!this.menu) for (const [k, w] of [['Digit1', 'pistola'], ['Digit2', 'escopeta'], ['Digit3', 'ak'], ['Digit0', 'puños']] as const) if (this.input.wasPressed(k)) this.selectWeapon(w);
    if (this.input.wasPressed('KeyR') && this.weapon !== 'puños') this.startReload();
    this.reloadT -= dt;
    const armed = this.weapon !== 'puños';
    const trigger = armed && aiming && !this.menu && (this.input.wasPressed('Mouse0') || (this.weapon === 'ak' && this.input.isDown('Mouse0')));
    if (trigger) this.fire();
    else if (attack && armed && aiming) { /* gatillo sin munición o recargando */ }
    else if (attack && this.punchCd <= 0 && this.grounded && !['pesas', 'trotadora', 'comer'].includes(this.action)) {
      if (aiming) this.player.facing = this.cam.yaw + Math.PI;
      this.combo = (this.combo + 1) % 3;
      this.action = 'golpe'; this.actionT = this.combo === 2 ? 0.5 : 0.4; this.punchCd = this.combo === 2 ? 0.5 : 0.36;
      this.joan.play(['punchL', 'punchR', 'hookR'][this.combo]!, 0.06, true);
      this.pendingHit = this.combo === 2 ? 0.17 : 0.13; // conecta en el impacto // el golpe conecta cuando el brazo se extiende
    }
    if (this.pendingHit >= 0 && (this.pendingHit -= dt) < 0) {
      const dmg = (this.combo === 2 ? 34 : 20) * Math.min(1.6, 1 + this.strength * 0.01); // el gimnasio da fuerza
      this.npcs.punch(this.player.pos, this.player.facing, dmg);
    }
    // Menú de compra abierto: 1-3 para comprar, E para cerrar
    const place = this.places.nearestAction(this.player.pos);
    if (this.menu) {
      const items = this.menu.items;
      const k = items.findIndex((_, i) => this.input.wasPressed(`Digit${i + 1}`) || this.input.wasPressed(`Numpad${i + 1}`));
      if (k >= 0) this.buy(items[k]!);
      else if (this.input.wasPressed('KeyE') || moving) { this.menu = null; this.ui.hideMenu(); }
    }
    // E: entrar/salir, comprar, gimnasio; si no, saludar o sentarse
    else if (this.input.wasPressed('KeyE') && this.race.near(this.player.pos)) { const m = this.race.start(); this.enterVehicle(m); this.raceLock = true; }
    else if (this.input.wasPressed('KeyE') && place && !['golpe', 'comer'].includes(this.action)) this.doPlace(place);
    else if (this.input.wasPressed('KeyE') && this.action !== 'golpe') {
      const bench = this.world.benches.find((b) => Math.hypot(b.p.x - this.player.pos.x, b.p.z - this.player.pos.z) < 1.4);
      if (this.action === 'sentado') this.action = 'ninguna';
      else if (bench) {
        this.player.pos.x = bench.p.x; this.player.pos.z = bench.p.z; this.player.prevPos.copy(this.player.pos);
        this.player.facing = bench.ry + Math.PI; this.action = 'sentado';
      }
    }
    if (['golpe', 'saludar', 'disparo', 'cansado'].includes(this.action)) { if ((this.actionT -= dt) <= 0) this.action = 'ninguna'; }
    if (this.action === 'comer' && (this.actionT -= dt) <= 0) this.finishEating();
    if (moving && ['saludar', 'sentado', 'pesas', 'trotadora'].includes(this.action)) this.action = 'ninguna'; // cualquier movimiento cancela
    this.gymStep(dt);
    if (this.debugOn && this.input.wasPressed('KeyK')) this.hurt(25, 'golpe');           // prueba de daño (solo en F3)
    if (this.debugOn && this.input.wasPressed('KeyL')) this.pickups.drop(this.player.pos.x + 2, this.player.pos.y, this.player.pos.z); // prueba de botín

    // 2. Resistencia
    const st = CONFIG.stamina;
    const running = wantRun && !this.exhausted && this.stamina > 0;
    if (running) { this.stamina = Math.max(0, this.stamina - (st.drain / (1 + this.endurance * 0.01)) * dt); this.sinceRun = 0; if (this.stamina === 0) this.exhausted = true; }
    else if (this.action !== 'pesas' && this.action !== 'trotadora') { this.sinceRun += dt; if (this.sinceRun > st.regenDelay) this.stamina = Math.min(st.max, this.stamina + st.regen * dt); }
    if (this.exhausted && this.stamina >= st.minToRun) this.exhausted = false;

    // 3. Movimiento horizontal + colisiones (subpasos)
    const s = CONFIG.player.speeds;
    const before = this.player.pos.clone();
    const lockMove = ['sentado', 'golpe', 'comer', 'pesas', 'trotadora', 'cansado'].includes(this.action) || !!this.menu;
    const spd = aiming ? s.walk * 1.4 : running ? s.run : walking ? s.walk : s.jog;
    this.player.step(dt, lockMove ? { x: 0, y: 0 } : axes, this.cam.yaw, spd);
    if (aiming) { this.player.facing = this.cam.yaw + Math.PI; }
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
        this.vitals.fall(this.fallStartY - ground);
        if (this.fallStartY - ground > 0.4) { this.landT = 0.25; this.joan.play('land', 0.08, true); }
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
      (k) => k === 'dinero' || k === 'municion' || (k === 'salud' && this.vitals.health < 100) || (k === 'escudo' && this.vitals.shield < 100));
    if (got.length) this.tut.picked = true;
    for (const g of got) {
      if (g.kind === 'dinero') { this.money += g.amount; this.ui.toast(`<b>+$${g.amount}</b>`, 1.5); }
      if (g.kind === 'salud') { this.vitals.health = Math.min(100, this.vitals.health + g.amount); this.ui.toast('<b>+Salud</b>', 1.5); }
      if (g.kind === 'escudo') { this.vitals.addShield(g.amount); this.ui.toast('<b>+Escudo</b>', 1.5); }
      if (g.kind === 'municion') { const w = this.weapon === 'puños' ? 'escopeta' : this.weapon; const n = w === 'ak' ? g.amount * 8 : w === 'pistola' ? g.amount * 4 : g.amount; this.reserve[w] = (this.reserve[w] ?? 0) + n; this.ui.toast(`<b>+${n} balas</b>${WEAPONS[w].name}`, 1.5); }
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
    if (this.menu) this.hint = '';
    else if (this.race.near(this.player.pos)) this.hint = 'E: Carrera de motos cuesta abajo ($100 al primero)';
    else if (place && !['pesas', 'trotadora'].includes(this.action)) this.hint = place.label;
    else if (!this.outside && this.traffic.nearestEnterable(this.player.pos, 3.2)) { const v = this.traffic.nearestEnterable(this.player.pos, 3.2)!; this.hint = v.driver && v.driver !== 'jugador' ? 'F: Sacar al conductor y robar el vehículo' : v.kind === 'heli' ? 'F: Pilotar el helicóptero' : 'F: Subir'; }
    else if (this.action === 'pesas' || this.action === 'trotadora') this.hint = 'Muévete para terminar';
    else if (this.action !== 'sentado') {
      if (this.world.benches.some((b) => Math.hypot(b.p.x - this.player.pos.x, b.p.z - this.player.pos.z) < 1.4)) this.hint = 'E: Sentarse';
    } else this.hint = 'E o moverse: Levantarse';
    // NPC y tráfico (después de las colisiones del jugador)
    // Noche de terror: de 20:00 a 5:00 salen criaturas
    const nightNow = this.hours >= 20 || this.hours < 5;
    const horror = nightNow && !this.outside;
    if (nightNow !== this.horror) {
      this.horror = nightNow;
      if (nightNow) this.ui.toast('<b>Cae la noche…</b>Algo se mueve en la niebla. Prepara las armas', 6);
      else this.ui.toast('<b>Amanece</b>Las criaturas se deshacen con la luz', 4);
    }
    this.npcs.max = nightNow ? Math.min(12, this.npcs.cap) : this.npcs.cap;
    this.monsters.update(dt, horror, { pos: this.player.pos, dead: this.vitals.dead, hurt: (a) => this.hurt(a, 'golpe') });
    if (!this.outside) this.npcs.update(dt, {
      pos: this.player.pos, dead: this.vitals.dead, money: this.money,
      hurt: (a, src) => this.hurt(a, src),
      rob: (a) => { this.money = Math.max(0, this.money - a); },
      notify: (h) => this.ui.toast(h, 3),
      wanted: this.traffic.wanted, copShot: (a, b, h) => this.copShot(a, b, h),
    });
    this.world.collision.resolve(this.player.pos, CONFIG.player.radius);
    this.sharedStep(dt);
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
    if (playing) this.animatePlayer(frameDt, speed);
    this.ui.setAim(this.cam.aim && playing);
    if (this.vehicle) {
      const v = this.vehicle;
      this.cam.vehicle = v.kind === 'heli' ? { dist: 15, height: 3 } : v.kind === 'moto' ? { dist: 5, height: 1.3 } : { dist: 7, height: 1.6 };
      this.cam.update(frameDt, v.object.position, Math.abs(v.speed) > 18, Math.abs(v.speed) > 1, v.heading);
    } else { this.cam.vehicle = null; this.cam.update(frameDt, this.player.object.position, speed > CONFIG.player.speeds.jog + 0.5, speed > 0.3, this.player.facing); }
    this.hours = (CONFIG.day.startHour + (this.gameTime / CONFIG.day.realSecondsPerDay) * 24) % 24;
    this.world.horror = this.horror && !this.outside;
    this.night = this.world.update(this.hours, this.player.pos);
    if (this.horror && !this.outside) {
      // Niebla espesa y fría, casi sin visibilidad
      const fog = this.scene.fog as THREE.Fog;
      fog.color.setRGB(0.07, 0.075, 0.08); fog.near = 4; fog.far = 58;
    }
    this.places.update(frameDt, this.gameTime);
    this.gunFx.update(frameDt);
    // Arma visible en la mano (no en vehículos)
    for (const [id, g] of Object.entries(this.guns)) g.group.visible = id === this.weapon && !this.vehicle;
    // Terror: latidos cuando una criatura se acerca; faroles que parpadean
    if (this.horror && !this.outside && playing) {
      const d = this.monsters.nearestDist(this.player.pos);
      this.heartT -= frameDt;
      if (d < 22 && this.heartT <= 0) { this.sfx.heartbeat(1 - d / 22); this.heartT = 0.45 + (d / 22) * 0.8; }
      this.world.flicker(Math.random() < 0.06);
    }
    if (playing) {
      this.ui.updateHud({ hours: this.hours, health: this.vitals.health, shield: this.vitals.shield, stamina: this.stamina, hint: this.hint, money: this.money });
      this.ui.setAmmo(this.weapon === 'puños' ? 'Puños' : `${WEAPONS[this.weapon].name} · ${this.reloadT > 0 ? 'recargando' : this.mag[this.weapon]}/${this.reserve[this.weapon]}`);
      this.ui.setWanted(this.traffic.wanted);
      this.ui.setSpeed(this.vehicle ? Math.abs(this.vehicle.speed) * 3.6 : null);
      this.ui.minimap.style.visibility = this.outside ? 'hidden' : 'visible';
      this.ui.street(this.world.streetName(this.player.pos.x, this.player.pos.z), frameDt);
      this.minimap.draw(this.player.pos.x, this.player.pos.z, this.cam.yaw, this.player.facing, [...this.pickups.positions(), ...this.npcs.positions(), ...this.monsters.positions(), ...this.traffic.positions().filter((m) => m.color !== '#40e0ff'), ...this.mapMarkers()]);
      this.saveTimer += frameDt;
      if (this.saveTimer > 5) { this.saveTimer = 0; this.persist(); }
    }
    this.updateDebug(frameDt, speed);
    this.fx.enabled = this.save.settings.postfx;
    this.fx.low = this.save.settings.quality === 'baja';
    this.fx.update(this.gameTime, this.night);
    this.renderer.info.reset();
    this.fx.render(frameDt);
    this.input.endFrame();
  }

  /** Máquina de estados de animación del jugador: Reposo, Caminar, Trotar, Correr, Saltar, Caer, Aterrizar, Saludar, Sentado, Golpe, Muerto. */
  private animatePlayer(dt: number, speed: number): void {
    const j = this.joan;
    if (this.vitals.dead) { j.update(dt); return; }
    if (this.vehicle) { if (this.vehicle.kind === 'moto') j.play('ride', 0.2); j.update(dt); return; }
    this.landT -= dt;
    const oneShot = (['golpe', 'saludar', 'comer', 'disparo'].includes(this.action) || this.landT > 0) && !j.finished;
    if (!oneShot) {
      if (this.action === 'sentado') j.play('sit', 0.25);
      else if (this.action === 'pesas') j.play('lift', 0.3);
      else if (this.action === 'trotadora') { j.play('jog', 0.3); j.setGaitSpeed(2.8); }
      else if (this.action === 'cansado' || (this.exhausted && speed < 0.25 && this.grounded)) j.play('tired', 0.3);
      else if (!this.grounded) j.play(this.vy > 0 ? 'jump' : 'fall', 0.15);
      else if (speed > 4.6) { j.play('run'); j.setGaitSpeed(speed); }
      else if (speed > 2.2) { j.play('jog'); j.setGaitSpeed(speed); }
      else if (speed > 0.25) { j.play('walk'); j.setGaitSpeed(speed); }
      else if (this.cam.aim) j.play(this.weapon !== 'puños' ? 'aimGun' : 'guard', 0.15);
      else {
        // Reposo; tras 8 s sin entrada, mira alrededor / revisa el reloj
        this.idleT += dt;
        if (this.idleT > 8) { j.play('lookAround', 0.4); if (this.idleT > 13) this.idleT = 0; }
        else j.play('idle', 0.25);
      }
      if (speed > 0.25 || !this.grounded) this.idleT = 0;
    }
    j.update(dt);
  }

  // ---------- Lugares ----------
  private doPlace(a: Action): void {
    if (a.type === 'entrar') {
      this.outside = { x: a.back.x, z: a.back.z, facing: this.player.facing + Math.PI };
      const r = this.places.enter(a.kind, a.seed);
      this.teleport(r.spawn.x, r.spawn.z, r.facing);
      this.ui.toast(r.greeting, 4);
    } else if (a.type === 'salir' && this.outside) {
      this.places.exit();
      const o = this.outside; this.outside = null;
      this.teleport(o.x, o.z, o.facing);
      this.npcs.populate(this.player.pos, Math.min(30, this.npcs.cap));
    } else if (a.type === 'comprar') {
      this.menu = { title: a.title, items: a.items };
      this.ui.showMenu(a.title, a.items.map((i, k) => `<kbd>${k + 1}</kbd> ${i.name} <span>$${i.price}</span>`), this.money);
    } else if (a.type === 'pesas' || a.type === 'trotadora') {
      if (this.stamina < 20) { this.ui.toast('<b>Joan está agotado</b>Descansa un momento', 2.5); return; }
      this.player.pos.x = a.p.x; this.player.pos.z = a.p.z; this.player.prevPos.copy(this.player.pos);
      this.player.facing = a.facing; this.player.vel.set(0, 0, 0);
      this.action = a.type; this.repT = 0;
    }
  }

  private teleport(x: number, z: number, facing: number): void {
    this.player.pos.set(x, this.world.heightAt(x, z), z); this.player.prevPos.copy(this.player.pos);
    this.player.vel.set(0, 0, 0); this.player.facing = this.player.prevFacing = facing;
    this.cam.yaw = facing + Math.PI;
  }

  private buy(item: MenuItem): void {
    if (this.money < item.price) { this.ui.toast(`<b>No te alcanza</b>${item.name} cuesta $${item.price}`, 2); return; }
    this.money -= item.price;
    this.menu = null; this.ui.hideMenu();
    this.pendingFood = item;
    this.action = 'comer'; this.actionT = 2.4;
    this.joan.play('eat', 0.2, true);
    this.sfx.bite();
  }

  private finishEating(): void {
    const f = this.pendingFood; this.pendingFood = null; this.action = 'ninguna';
    if (!f) return;
    this.vitals.health = Math.min(100, this.vitals.health + f.heal);
    this.stamina = Math.min(CONFIG.stamina.max, this.stamina + f.stamina);
    this.ui.toast(`<b>${f.name}</b>+${f.heal} salud · +${f.stamina} energía`, 2.5);
  }

  /** Gimnasio: cada repetición cansa y da fuerza; la trotadora da resistencia. Al agotarse, Joan descansa. */
  private gymStep(dt: number): void {
    if (this.action === 'pesas') {
      this.repT += dt;
      this.stamina = Math.max(0, this.stamina - 7 * dt);
      if (this.repT >= 2) { this.repT = 0; this.strength += 1; this.ui.toast(`<b>+1 Fuerza</b>Fuerza ${this.strength}`, 1.4); }
    } else if (this.action === 'trotadora') {
      this.stamina = Math.max(0, this.stamina - 6 * dt);
      this.endurance += dt * 0.5;
      this.repT += dt;
      if (this.repT >= 4) { this.repT = 0; this.ui.toast(`<b>Resistencia ${Math.floor(this.endurance)}</b>`, 1.4); }
    } else return;
    if (this.stamina < 8) {
      this.action = 'cansado'; this.actionT = 3.5; this.exhausted = true;
      this.ui.toast('<b>Joan está agotado</b>Recupera el aliento', 3);
    }
  }

  // ---------- Vehículos ----------
  private setupVehicles(): void {
    this.traffic = new Traffic(this.world, this.npcs);
    this.traffic.cap = this.save.settings.quality === 'baja' ? 6 : this.save.settings.quality === 'media' ? 12 : 18;
    this.scene.add(this.traffic.group);
    this.traffic.onNotice = (h) => this.ui.toast(h, 3);
    this.traffic.onFire = (v) => { if (v === this.vehicle) this.ui.toast('<b>¡Se está incendiando!</b>Bájate con F antes de que explote', 4); };
    this.traffic.onExplode = (p) => {
      this.sfx.shotgun();
      const d = p.distanceTo(this.player.pos);
      if (d < 7) this.hurt(this.vehicle && this.vehicle.pos.distanceTo(p) < 1 ? 75 : (7 - d) * 12, 'fuego');
    };
    // Delitos -> nivel de búsqueda
    this.npcs.onCrime = (type, kind) => {
      const cop = kind === 'policia';
      const witnesses = this.npcs.npcs.some((n) => n.kind === 'policia' && n.state !== 'muerto' && n.pos.distanceTo(this.player.pos) < 40);
      this.traffic.addWanted(type === 'muerte' ? (cop ? 2 : 1) : cop ? 1 : witnesses ? 0.5 : 0.25);
    };
    // Helicóptero en un helipuerto cerca del C.C. (o de la plaza)
    const mall = this.world.places.find((p) => /Trigaleña|C\.C\./.test(p.name)) ?? this.world.places[0]!;
    for (let k = 0; k < 300; k++) {
      const a = k * 2.399, r = 15 + k * 0.4, x = mall.p.x + Math.cos(a) * r, z = mall.p.z + Math.sin(a) * r;
      if (this.world.map.onRoadCorridor(x, z, 6) || this.world.collision.resolve({ x, z }, 6.5)) continue;
      const h = new Vehicle('heli'); h.place(x, z, 0, this.world); h.playerOwned = true; this.traffic.add(h);
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
      g.fillStyle = '#3a3a3c'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.strokeStyle = '#f0f0f0'; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
      g.fillStyle = '#f0d020'; g.font = 'bold 70px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 64, 68);
      const pad = new THREE.Mesh(new THREE.CircleGeometry(6, 32).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
      pad.position.set(x, this.world.heightAt(x, z) + 0.04, z); this.scene.add(pad);
      break;
    }
    this.race = new Race(this.world, this.traffic, this.scene);
  }

  private enterVehicle(v: Vehicle): void {
    this.traffic.carjack(v);
    if (v.driver !== 'jugador') v.driver = 'jugador';
    this.vehicle = v;
    this.action = 'ninguna'; this.menu = null; this.ui.hideMenu();
    this.player.object.remove(this.joan.object);
    if (v.kind === 'moto') { v.object.add(this.joan.object); this.joan.object.position.set(0, 0.32, -0.25); this.joan.object.rotation.set(0, 0, 0); this.joan.object.visible = true; }
    else this.joan.object.visible = false;
    this.cam.yaw = v.heading + Math.PI;
  }

  private exitVehicle(force = false): void {
    const v = this.vehicle; if (!v) return;
    if (!force && v.kind === 'heli' && v.alt > 1.2) { this.ui.toast('<b>Aterriza primero</b>', 1.5); return; }
    if (!force && Math.abs(v.speed) > 6) { this.ui.toast('<b>Frena para bajarte</b>', 1.5); return; }
    v.object.remove(this.joan.object);
    this.player.object.add(this.joan.object);
    this.joan.object.position.set(0, 0, 0); this.joan.object.visible = true;
    const d = v.doorPoint();
    this.player.pos.set(d.x, this.world.heightAt(d.x, d.z), d.z);
    this.world.collision.resolve(this.player.pos, CONFIG.player.radius);
    this.player.prevPos.copy(this.player.pos); this.player.vel.set(0, 0, 0);
    this.player.facing = this.player.prevFacing = v.heading;
    v.driver = null; v.speed = 0; v.playerOwned = true;
    this.vehicle = null; this.raceLock = false;
  }

  private stepVehicle(dt: number): void {
    const v = this.vehicle!;
    const k = (a: string, b?: string) => (this.input.isDown(a) || (b ? this.input.isDown(b) : false) ? 1 : 0);
    const lock = this.race.state === 'cuenta' && v === this.race.playerMoto;
    const ctrl = {
      throttle: lock ? 0 : k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
      steer: k('KeyA', 'ArrowLeft') - k('KeyD', 'ArrowRight'),
      handbrake: v.kind !== 'heli' && (lock || this.input.isDown('Space')),
      up: k('Space') - k('ShiftLeft', 'ShiftRight'),
    };
    v.step(dt, ctrl, this.world);
    if (v.impact > 6) { this.hurt((v.impact - 6) * 2.5, 'choque'); if (v.kind === 'moto' && v.impact > 13) { this.ui.toast('<b>¡Te caíste de la moto!</b>', 2); this.exitVehicle(true); } }
    if (!this.vehicle) { this.sharedStep(dt); this.input.endStep(); return; }
    this.player.prevPos.copy(this.player.pos);
    this.player.pos.copy(v.pos);
    this.player.facing = this.player.prevFacing = v.heading;
    this.player.vel.set(0, 0, 0);
    this.hint = v.kind === 'heli' ? 'Espacio: subir · Shift: bajar · F: bajarse (en tierra)' : this.raceLock ? '' : 'F: Bajarse';
    if (v.wrecked) this.exitVehicle(true);
    this.sharedStep(dt);
    this.input.endStep();
  }

  /** NPC, tráfico, policía, criaturas y carrera (a pie o en vehículo). */
  private sharedStep(dt: number): void {
    if (this.outside) return;
    if (this.vehicle) {
      this.npcs.update(dt, { pos: this.player.pos, dead: this.vitals.dead, money: this.money, hurt: (a) => this.hurt(a * 0.6, 'golpe'), rob: () => {}, notify: () => {}, wanted: this.traffic.wanted, copShot: (a, b, h) => this.copShot(a, b, h) });
      this.monsters.update(dt, this.horror, { pos: this.player.pos, dead: this.vitals.dead, hurt: (a) => this.hurt(a, 'golpe') });
    }
    this.traffic.update(dt, { pos: this.player.pos, vehicle: this.vehicle, onFoot: !this.vehicle });
    // Carros que golpean a Joan a pie
    if (!this.vehicle && !this.vitals.dead) for (const v of this.traffic.list) {
      if (Math.abs(v.speed) < 4 || v.kind === 'heli') continue;
      const d = Math.hypot(v.pos.x - this.player.pos.x, v.pos.z - this.player.pos.z);
      if (d < v.spec.radius + 0.6) {
        const f = v.fwd; this.player.pos.x += f.x * 2 * Math.sign(v.speed); this.player.pos.z += f.z * 2 * Math.sign(v.speed);
        this.world.collision.resolve(this.player.pos, CONFIG.player.radius);
        this.hurt(Math.abs(v.speed) * 4, 'atropello'); v.speed *= 0.4;
      }
    }
    // Policía: se bajan de la patrulla y arrestan; la búsqueda baja si no te ven
    const tf = this.traffic;
    if (tf.wanted > 0) {
      let seen = false;
      for (const v of tf.list) if (v.driver === 'policia' && v.pos.distanceTo(this.player.pos) < 55) {
        seen = true;
        if (!this.vehicle && v.pos.distanceTo(this.player.pos) < 14 && Math.abs(v.speed) < 3 && !v.wrecked && this.npcs.npcs.filter((n) => n.kind === 'policia' && n.state !== 'muerto').length < 3) {
          const d = v.doorPoint(); this.npcs.spawnCop({ x: d.x, z: d.z }); v.driver = null; v.pursuit = false;
        }
      }
      const cops = this.npcs.npcs.filter((n) => n.kind === 'policia' && n.state !== 'muerto');
      if (cops.some((n) => n.pos.distanceTo(this.player.pos) < 45)) seen = true;
      this.notSeenT = seen ? 0 : this.notSeenT + dt;
      if (this.notSeenT > 20) { tf.wanted = Math.max(0, Math.ceil(tf.wanted) - 1); this.notSeenT = 0; this.ui.toast(tf.wanted ? '<b>La policía te pierde el rastro</b>' : '<b>Ya no te buscan</b>', 2.5); }
      const close = this.vehicle ? tf.list.some((v) => v.driver === 'policia' && v.pos.distanceTo(this.player.pos) < 5) && Math.abs(this.vehicle.speed) < 1 : cops.some((n) => n.pos.distanceTo(this.player.pos) < 1.4);
      this.arrestT = close ? this.arrestT + dt : Math.max(0, this.arrestT - dt);
      if (this.arrestT > (this.vehicle ? 3 : 2.5)) this.arrest();
    }
    // Carrera
    const r = this.race.update(dt, this.vehicle);
    this.ui.setBanner(r.banner ?? '');
    if (r.result) {
      if (r.result.won) { this.money += 100; this.ui.toast('<b>¡GANASTE LA CARRERA!</b>+$100', 5); }
      else if (r.result.place > 0) this.ui.toast(`<b>Llegaste de ${r.result.place}º</b>Inténtalo otra vez`, 4);
      else this.ui.toast('<b>Descalificado</b>Te saliste de la ruta', 3);
      this.raceLock = false;
    }
  }

  private arrest(): void {
    if (this.vehicle) this.exitVehicle(true);
    const lost = Math.floor(this.money * 0.2);
    this.money -= lost;
    this.traffic.wanted = 0; this.arrestT = 0;
    this.ui.toast(`<b>¡ARRESTADO!</b>Multa: $${lost}. Te soltaron en la plaza`, 5);
    const s = this.world.spawn;
    this.player.pos.set(s.x, this.world.heightAt(s.x, s.z), s.z); this.player.prevPos.copy(this.player.pos);
  }

  // ---------- Armas ----------
  private setupWeapons(): void {
    for (const id of ['pistola', 'escopeta', 'ak'] as const) {
      const g = gunModel(id);
      this.joan.bones.hand_R.add(g.group);
      this.guns[id] = g;
    }
    this.scene.add(this.gunFx.group);
  }

  private selectWeapon(w: WeaponId): void {
    if (w === this.weapon) return;
    this.weapon = w; this.reloadT = 0;
    this.ui.toast(`<b>${w === 'puños' ? 'Puños' : WEAPONS[w].name}</b>`, 1);
  }

  private startReload(): void {
    if (this.weapon === 'puños') return;
    const d = WEAPONS[this.weapon];
    if (this.mag[this.weapon]! >= d.mag || this.reserve[this.weapon]! <= 0 || this.reloadT > 0) return;
    this.reloadT = d.reload;
    const w = this.weapon;
    setTimeout(() => { const need = d.mag - this.mag[w]!; const take = Math.min(need, this.reserve[w]!); this.mag[w] = this.mag[w]! + take; this.reserve[w] = this.reserve[w]! - take; }, d.reload * 1000);
  }

  /** Disparo: rayo desde la cámara (mira al centro) con dispersión; alcanza peatones, criaturas y vehículos; las paredes lo frenan. */
  private fire(): void {
    if (this.weapon === 'puños' || this.gunCd > 0 || this.reloadT > 0) return;
    const d = WEAPONS[this.weapon];
    if (this.mag[this.weapon]! <= 0) { if (this.reserve[this.weapon]! > 0) this.startReload(); else this.ui.toast('<b>Sin balas</b>Las criaturas y la gente sueltan munición', 1.5); this.gunCd = 0.4; return; }
    this.mag[this.weapon] = this.mag[this.weapon]! - 1;
    this.gunCd = d.rate;
    this.action = 'disparo'; this.actionT = Math.max(0.15, d.rate);
    this.joan.play('shoot', 0.03, true);
    if (this.weapon === 'escopeta') this.sfx.shotgun(); else this.sfx.shot(this.weapon);
    const muzzle = new THREE.Vector3(); this.guns[this.weapon]!.muzzle.getWorldPosition(muzzle);
    this.gunFx.flash(muzzle, this.weapon === 'escopeta' ? 0.9 : 0.55);
    const base = new THREE.Vector3(); this.camera.getWorldDirection(base);
    const origin = this.camera.position.clone();
    const skip = origin.distanceTo(this.player.pos) + 0.5; // ignora lo que está entre la cámara y Joan
    for (let k = 0; k < d.pellets; k++) {
      const dir = base.clone().add(new THREE.Vector3((Math.random() - 0.5) * d.spread * 2, (Math.random() - 0.5) * d.spread * 2, (Math.random() - 0.5) * d.spread * 2)).normalize();
      // pared más cercana (2D) dentro del alcance
      const far = origin.clone().addScaledVector(dir, d.range);
      const wallT = this.world.collision.raycast(origin.x, origin.z, far.x, far.z) * d.range;
      let best: { t: number; hit: () => void } | null = null;
      const test = (c: THREE.Vector3, r: number, hit: () => void) => {
        const v = c.clone().sub(origin); const t = v.dot(dir);
        if (t < skip || t > Math.min(wallT, d.range)) return;
        if (v.addScaledVector(dir, -t).length() < r && (!best || t < best.t)) best = { t, hit };
      };
      const dmg = this.weapon === 'escopeta' ? d.dmg * Math.max(0.3, 1) : d.dmg;
      for (const n of this.npcs.npcs) if (n.state !== 'muerto') { const c = n.pos.clone().setY(n.pos.y + 1.1); test(c, 0.55, () => this.npcs.shoot(n, dmg, dir.x, dir.z)); }
      for (const m of this.monsters.list) if (m.state !== 'muerto') { const c = m.pos.clone().setY(m.pos.y + 1.3); test(c, 0.6, () => this.monsters.damage(m, dmg, dir)); }
      for (const v of this.traffic.list) if (v !== this.vehicle && !v.wrecked) { const c = v.pos.clone().setY(v.pos.y + (v.kind === 'heli' ? 1.6 : 0.8)); test(c, v.kind === 'heli' ? 2 : 1.2, () => { v.damage(dmg * 0.25); if (v.driver === 'ia') v.cruise *= 1.3; }); }
      const hb = best as { t: number; hit: () => void } | null;
      const end = origin.clone().addScaledVector(dir, hb ? hb.t : Math.min(wallT, d.range));
      if (hb) hb.hit(); else if (wallT < d.range) this.gunFx.dust(end);
      if (k < 2) this.gunFx.tracer(muzzle, end);
    }
    this.npcs.panic(this.player.pos, 35);
    // Disparar delante de la policía sube la búsqueda
    if (this.npcs.npcs.some((n) => n.kind === 'policia' && n.state !== 'muerto' && n.pos.distanceTo(this.player.pos) < 40) && this.traffic.wanted < 1) this.traffic.addWanted(1);
    this.cam.pitch = Math.min(this.cam.pitch + (this.weapon === 'escopeta' ? 0.035 : this.weapon === 'ak' ? 0.008 : 0.015), 1.0); // retroceso
  }

  /** Disparo de un policía (efectos y sonido). */
  private copShot(from: THREE.Vector3, to: THREE.Vector3, hit: boolean): void {
    this.gunFx.flash(from, 0.45);
    this.gunFx.tracer(from, to);
    if (!hit) this.gunFx.dust(to);
    this.sfx.shot('pistola', Math.max(0.15, 1 - from.distanceTo(this.player.pos) / 40));
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
        `lotes ${this.world.stats.lots} (quintas ${this.world.stats.quintas}, comercios ${this.world.stats.comercios})  NPC ${this.npcs.count}\n` +
        `K: daño 25 · L: soltar botín`
      : `FPS ${this.fps.toFixed(0)}`;
  }

  /** Para pruebas automatizadas y capturas. */
  get debugInfo() {
    return {
      state: this.state, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles, fps: this.fps,
      pos: this.player.pos.toArray(), health: this.vitals.health, shield: this.vitals.shield, dead: this.vitals.dead, money: this.money,
      stats: this.world.stats, pickups: this.pickups.count, npcs: this.npcs.count, places: this.world.places.map((p) => p.name),
    };
  }
  get debugExtra() { return { vehicle: this.vehicle?.kind ?? null, vspeed: this.vehicle?.speed ?? 0, wanted: this.traffic.wanted, cars: this.traffic.list.length, race: this.race.state, inside: this.places.insideKind, monsters: this.monsters.count, weapon: this.weapon, mag: { ...this.mag }, reserve: { ...this.reserve }, strength: this.strength, action: this.action, menu: !!this.menu }; }
  debugSetHour(h: number): void { this.gameTime = ((h - CONFIG.day.startHour + 24) % 24) / 24 * CONFIG.day.realSecondsPerDay; }
  debugTeleport(x: number, z: number, yaw: number, pitchDeg = 15, dist = 1): void {
    this.player.pos.set(x, this.world.heightAt(x, z), z); this.player.prevPos.copy(this.player.pos);
    this.cam.yaw = yaw; this.cam.pitch = pitchDeg * Math.PI / 180; this.cam.distIndex = dist;
  }
}
