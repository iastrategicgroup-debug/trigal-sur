import * as THREE from 'three';
import { Avatar } from './character/Avatar';
import { npcParams, joanParams, ARCHETYPES, type Archetype } from './character/archetypes';
import type { HumanParams } from './character/HumanModel';
import joanJson from './player/personaje.json';

/** Visor: gira, acerca, prueba animaciones y edita en vivo. Compara con la foto (solo si existe en local). */
const canvas = document.getElementById('v') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6a6058);
const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xfff0e0, 0x504030, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); sun.castShadow = true; scene.add(sun);
const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 32).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8a8070 }));
floor.receiveShadow = true; scene.add(floor);

const params = new URLSearchParams(location.search);
const mode = params.get('modo') ?? 'joan';   // joan | todos
let yaw = Number(params.get('yaw') ?? 0.4), dist = Number(params.get('dist') ?? (mode === 'todos' ? 9 : 4)), focusY = Number(params.get('y') ?? 1.0);
const avatars: Avatar[] = [];
let joan: HumanParams = joanParams();

function rebuild(): void {
  avatars.forEach((a) => { scene.remove(a.object); a.dispose(); });
  avatars.length = 0;
  if (mode === 'todos') {
    const list: (HumanParams)[] = [joan, ...ARCHETYPES.map((a, i) => npcParams(a.kind as Archetype, 11 + i * 7))];
    // Muestra del estilo de calle (franelilla + jean ancho)
    for (let sd = 1; sd < 400 && list.length < 10; sd++) { const q = npcParams('hombre', sd); if (q.shirt.type === 'franelilla' && q.pants.type === 'jean_ancho') { list.splice(1, 0, q); break; } }
    list.forEach((p, i) => { const a = new Avatar(p, true); a.object.position.x = (i - (list.length - 1) / 2) * 0.95; scene.add(a.object); avatars.push(a); });
  } else {
    const a = new Avatar(joan, true); scene.add(a.object); avatars.push(a);
  }
  const ft = params.get('t');
  avatars.forEach((a) => (ft !== null ? a.freeze(anim, Number(ft)) : a.play(anim, 0)));
}

let anim = params.get('anim') ?? 'idle';
rebuild();

// Foto de referencia (no se publica: assets/referencia está en .gitignore y fuera del build)
const foto = document.getElementById('foto') as HTMLImageElement;
foto.onload = () => { foto.style.display = 'block'; };
foto.src = '/assets/referencia/jefe-frente.png';

// Panel
const panel = document.getElementById('panel')!;
panel.innerHTML = `<h2>${mode === 'todos' ? 'Todos los modelos' : 'Joan'}</h2>
  <div class="row">${['idle', 'lookAround', 'walk', 'jog', 'run', 'guard', 'punchR', 'wave', 'sit', 'death', 'walkOld'].map((a) => `<button data-a="${a}">${a}</button>`).join('')}</div>
  <div id="sliders"></div>
  <div class="row"><button id="todos">${mode === 'todos' ? 'Ver solo a Joan' : 'Ver todos los modelos'}</button></div>
  <p>Exportar <code>personaje.json</code>:</p><textarea id="json"></textarea>`;
panel.querySelectorAll('button[data-a]').forEach((b) => b.addEventListener('click', () => { anim = (b as HTMLElement).dataset.a!; avatars.forEach((a) => a.play(anim, 0.2, true)); }));
document.getElementById('todos')!.addEventListener('click', () => { location.search = mode === 'todos' ? '' : '?modo=todos'; });
const json = joanJson as Record<string, unknown> & typeof joanJson;
const sliders = document.getElementById('sliders')!;
const defs: [string, number, number, number, () => number, (v: number) => void][] = [
  ['Estatura', 1.5, 2.0, 0.01, () => joan.height, (v) => { joan.height = v; json.estatura = v; }],
  ['Musculatura', 0, 1, 0.05, () => joan.muscle, (v) => { joan.muscle = v; json.contextura.musculatura = v; }],
  ['Gordura', 0, 1, 0.05, () => joan.fat, (v) => { joan.fat = v; json.contextura.gordura = v; }],
  ['Ancho de cara', 0.85, 1.25, 0.01, () => joan.face.width, (v) => { joan.face.width = v; json.rostro.anchoCara = v; }],
  ['Mandíbula', 0.7, 1.2, 0.01, () => joan.face.jaw, (v) => { joan.face.jaw = v; json.rostro.mandibula = v; }],
  ['Sonrisa', 0, 1, 0.05, () => joan.face.smile, (v) => { joan.face.smile = v; json.rostro.boca.sonrisa = v; }],
  ['Barba (densidad)', 0, 1, 0.05, () => joan.beard.density, (v) => { joan.beard.density = v; json.rostro.barba.densidad = v; }],
];
const colors: [string, () => string, (v: string) => void][] = [
  ['Piel', () => joan.skin, (v) => { joan.skin = v; json.piel = v; }],
  ['Camisa', () => joan.shirt.color, (v) => { joan.shirt.color = v; json.ropa.camisa.color = v; }],
  ['Pantalón', () => joan.pants.color, (v) => { joan.pants.color = v; json.ropa.pantalon.color = v; }],
  ['Cabello', () => joan.hair.color, (v) => { joan.hair.color = v; json.cabello.color = v; }],
];
const out = document.getElementById('json') as HTMLTextAreaElement;
const sync = () => { out.value = JSON.stringify(json, null, 2); };
for (const [label, min, max, step, get, set] of defs) {
  const l = document.createElement('label'); l.innerHTML = `<span>${label}</span>`;
  const i = document.createElement('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(get());
  i.addEventListener('change', () => { set(Number(i.value)); rebuild(); sync(); });
  l.append(i); sliders.append(l);
}
for (const [label, get, set] of colors) {
  const l = document.createElement('label'); l.innerHTML = `<span>${label}</span>`;
  const i = document.createElement('input'); i.type = 'color'; i.value = get();
  i.addEventListener('change', () => { set(i.value); rebuild(); sync(); });
  l.append(i); sliders.append(l);
}
sync();

// Órbita con el ratón y zoom con la rueda
let drag = false, lx = 0, ly = 0;
canvas.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
window.addEventListener('pointerup', () => { drag = false; });
window.addEventListener('pointermove', (e) => { if (!drag) return; yaw -= (e.clientX - lx) * 0.01; focusY = Math.min(1.9, Math.max(0.2, focusY + (e.clientY - ly) * 0.004)); lx = e.clientX; ly = e.clientY; });
canvas.addEventListener('wheel', (e) => { dist = Math.min(14, Math.max(0.6, dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: true });

const clock = new THREE.Clock();
function frame(): void {
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== w * devicePixelRatio) { renderer.setPixelRatio(devicePixelRatio); renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  const dt = Math.min(clock.getDelta(), 0.05);
  avatars.forEach((a) => a.update(dt));
  cam.position.set(Math.sin(yaw) * dist, focusY + 0.15, Math.cos(yaw) * dist);
  cam.lookAt(0, focusY, 0);
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { __viewerReady: boolean }).__viewerReady = true;
