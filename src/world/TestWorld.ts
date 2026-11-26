import * as THREE from 'three';

/**
 * Mundo provisional de la fase 1: suelo, cuadrícula de referencia y cajas.
 * Se reemplaza por el mapa real de OSM en la fase 2.
 */
export function buildTestWorld(scene: THREE.Scene): { update(hours: number): void } {
  scene.background = new THREE.Color(0xf0a868);
  scene.fog = new THREE.Fog(0xe8a070, 60, 380);

  const hemi = new THREE.HemisphereLight(0xffe2b8, 0x5a4030, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc080, 1.6);
  sun.position.set(-80, 60, 40);
  scene.add(sun);

  // Suelo
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x7a8a4a }),
  );
  ground.name = 'suelo';
  scene.add(ground);

  const grid = new THREE.GridHelper(400, 40, 0x3a2a1a, 0x5a4a3a);
  (grid.material as THREE.Material).opacity = 0.35;
  (grid.material as THREE.Material).transparent = true;
  grid.position.y = 0.01;
  scene.add(grid);

  // Cajas de referencia (una sola InstancedMesh = 1 draw call)
  const count = 60;
  const boxes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    count,
  );
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const palette = [0xe8d8b8, 0xd8a878, 0xb8c8a8, 0xf0e0c8, 0xc87858];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 25 + rnd() * 150;
    const w = 6 + rnd() * 12, h = 3 + rnd() * 12, d = 6 + rnd() * 12;
    m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    boxes.setMatrixAt(i, m);
    boxes.setColorAt(i, c.setHex(palette[i % palette.length]!));
  }
  scene.add(boxes);

  // Cerros al horizonte (silueta simple)
  const hills = new THREE.Mesh(
    new THREE.CylinderGeometry(600, 600, 80, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x6a5a6a, side: THREE.BackSide, fog: false }),
  );
  hills.position.y = 10;
  const pos = hills.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      pos.setY(i, 10 + 25 * Math.abs(Math.sin(ang * 3)) + 12 * Math.sin(ang * 7));
    } else pos.setY(i, -40);
  }
  scene.add(hills);

  const skyDay = new THREE.Color(0x9ac8e8), skyDusk = new THREE.Color(0xf0a868), skyNight = new THREE.Color(0x101828);
  return {
    // Ciclo de luz básico; el ciclo completo (faroles, ventanas) llega en la fase 6.
    update(hours: number) {
      const sunAng = ((hours - 6) / 12) * Math.PI; // 6h amanece, 18h anochece
      const elev = Math.sin(sunAng);
      sun.position.set(Math.cos(sunAng) * -100, Math.max(elev, -0.2) * 100, 40);
      const dayK = THREE.MathUtils.clamp(elev * 2, 0, 1);
      const duskK = THREE.MathUtils.clamp(1 - Math.abs(elev) * 4, 0, 1);
      const col = skyNight.clone().lerp(skyDay, dayK).lerp(skyDusk, duskK * 0.8);
      (scene.background as THREE.Color).copy(col);
      (scene.fog as THREE.Fog).color.copy(col);
      sun.intensity = 0.2 + 1.4 * dayK + 1.0 * duskK;
      hemi.intensity = 0.45 + 0.7 * dayK + 0.5 * duskK;
    },
  };
}
