import * as THREE from 'three';
import { buildHuman, fabricTexture, type HumanParams, type BoneName } from './HumanModel';
import { buildClips, CYCLE_LENGTH } from './Animations';

let CLIPS: Record<string, THREE.AnimationClip> | null = null;
let FABRIC: THREE.Texture | null = null;

/** Personaje animado: malla con esqueleto + AnimationMixer con transiciones de 0,2 s. */
export class Avatar {
  readonly object = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: Record<BoneName, THREE.Bone>;
  readonly mixer: THREE.AnimationMixer;
  readonly height: number;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  currentName = '';

  constructor(readonly params: HumanParams) {
    CLIPS ??= buildClips();
    FABRIC ??= fabricTexture();
    const h = buildHuman(params, FABRIC);
    this.mesh = h.mesh; this.bones = h.bones; this.height = h.height;
    this.object.add(this.mesh);
    this.mixer = new THREE.AnimationMixer(this.mesh);
    for (const [name, c] of Object.entries(CLIPS)) {
      const a = this.mixer.clipAction(c);
      if (['jump', 'land', 'punchR', 'punchL', 'hookR', 'hit', 'death', 'wave'].includes(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions.set(name, a);
    }
    this.play('idle');
  }

  /** Cambia de animación con transición. `restart` reinicia aunque ya esté sonando (golpes). */
  play(name: string, fade = 0.2, restart = false): void {
    const next = this.actions.get(name);
    if (!next) return;
    if (this.current === next && !restart) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    this.currentName = name;
  }

  /** Para marchas cíclicas: ajusta la velocidad del clip a la velocidad real (los pies no patinan). */
  setGaitSpeed(speed: number): void {
    const len = (CYCLE_LENGTH[this.currentName] ?? 0) * (this.height / 1.75);
    if (this.current && len > 0) this.current.timeScale = Math.max(0.2, speed / len);
    else if (this.current) this.current.timeScale = 1;
  }

  /** ¿Terminó la animación de un solo disparo actual? */
  get finished(): boolean {
    const a = this.current;
    return !!a && a.loop === THREE.LoopOnce && a.time >= a.getClip().duration - 1e-3;
  }

  update(dt: number): void { this.mixer.update(dt); }

  /** Congela la animación `name` en la fracción `t` (0..1) — para el visor. */
  freeze(name: string, t: number): void {
    const a = this.actions.get(name);
    if (!a) return;
    this.mixer.stopAllAction();
    a.reset().play();
    a.time = t * a.getClip().duration;
    a.paused = true;
    this.mixer.update(0);
    this.current = a; this.currentName = name;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mesh.geometry.dispose();
    const m = this.mesh.material as THREE.MeshPhongMaterial;
    m.map?.dispose(); m.dispose();
  }
}
