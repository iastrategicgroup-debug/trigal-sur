import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Look cinematográfico de la era PS2 (estilo propio): resplandor suave en zonas claras, y después
 * gradación en espacio de pantalla — tinte cálido, negros levantados (aspecto "lavado" por smog),
 * algo de desaturación, viñeta y grano fino.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uWarm: { value: new THREE.Vector3(1.06, 1.05, 0.9) },   // multiplicador de color (día)
    uLift: { value: new THREE.Vector3(0.075, 0.075, 0.055) }, // negros levantados
    uDesat: { value: 0.06 },
    uVignette: { value: 0.24 },
    uGrain: { value: 0.035 },
    uNight: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uDesat, uVignette, uGrain, uNight;
    uniform vec3 uWarm, uLift; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(l), uDesat);
      // Día: tinte cálido amarillo-verdoso; noche: azul frío
      vec3 tint = mix(uWarm, vec3(0.86, 0.95, 1.12), uNight);
      c *= tint * mix(1.12, 1.0, uNight); // exposición un poco más alta de día (look pastel)
      // Negros levantados y contraste suave (curva en S muy leve)
      c = uLift + c * (1.0 - uLift);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.12);
      // Viñeta
      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      // Grano
      c += (hash(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.65, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(Math.floor(w / 2), Math.floor(h / 2));
  }

  /** night: 0 día .. 1 noche. A la noche el resplandor sube (faroles y ventanas brillan). */
  update(time: number, night: number): void {
    this.grade.uniforms.uTime!.value = time % 100;
    this.grade.uniforms.uNight!.value = night;
    this.bloom.strength = 0.32 + night * 0.5;
    this.bloom.threshold = 0.74 - night * 0.3;
  }

  render(dt: number): void {
    if (this.enabled) this.composer.render(dt);
    else this.renderer.render((this.composer.passes[0] as RenderPass).scene, (this.composer.passes[0] as RenderPass).camera);
  }
}
