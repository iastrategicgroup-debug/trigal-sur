import * as THREE from 'three';

/** Cúpula de cielo con degradado, halo solar, estrellas y cerros al horizonte. */
export class Sky {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private hillsMat: THREE.MeshBasicMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
        uTime: { value: 0 }, uNight: { value: 0 }, uHaze: { value: new THREE.Color(0xd8cfae) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 zenith, horizon, sunDir, sunColor, uHaze; uniform float uTime, uNight; varying vec3 vDir;
        // Ruido de valor + fbm para nubes procedurales
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.1, 1.0);
          vec3 c = mix(horizon, zenith, pow(max(h,0.0), 0.6));
          // Banda de smog cálido pegada al horizonte
          c = mix(c, uHaze, (1.0 - smoothstep(0.0, 0.22, h)) * 0.55 * (1.0 - uNight));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunColor * (pow(s, 900.0) * 2.5 + pow(s, 14.0) * 0.3);
          // Nubes: proyección sobre un plano alto; se desvanecen hacia el horizonte (por la bruma)
          if (d.y > 0.02) {
            vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
            float n = fbm(uv);
            float n2 = fbm(uv * 2.7 + 5.0);
            float cover = smoothstep(0.5, 0.78, n * 0.75 + n2 * 0.35);
            float lit = clamp(0.55 + 0.6 * dot(normalize(vec3(sunDir.x, 0.0, sunDir.z) + 1e-4), normalize(vec3(d.x, 0.0, d.z))) * 0.5 + (n2 - 0.5), 0.0, 1.2);
            vec3 cloudDay = mix(vec3(0.62, 0.62, 0.66), vec3(1.0, 0.97, 0.9), lit);
            vec3 cloudCol = mix(cloudDay * mix(vec3(1.0), sunColor, 0.35), vec3(0.08, 0.09, 0.13), uNight);
            float fade = smoothstep(0.02, 0.25, d.y);
            c = mix(c, cloudCol, cover * fade * 0.92);
          }
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), this.mat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    // Estrellas
    const sp: number[] = [];
    for (let i = 0; i < 900; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.05, r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(th) * r * 750, y * 750, Math.sin(th) * r * 750);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Cerros (Valencia está rodeada de montañas: silueta azulada)
    const hills = new THREE.CylinderGeometry(700, 700, 1, 96, 1, true);
    const pos = hills.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      if (pos.getY(i) > 0) {
        // Más altos al norte (-Z): cordillera de la Costa
        const north = Math.max(0, -Math.sin(ang));
        pos.setY(i, 18 + 55 * north + 14 * Math.abs(Math.sin(ang * 5)) + 9 * Math.sin(ang * 13 + 1) + 5 * Math.sin(ang * 31));
      } else pos.setY(i, -20);
    }
    this.hillsMat = new THREE.MeshBasicMaterial({ color: 0x5a6a78, side: THREE.BackSide, fog: false });
    const hm = new THREE.Mesh(hills, this.hillsMat);
    hm.renderOrder = -9;
    hm.frustumCulled = false;
    this.group.add(hm);
  }

  update(center: THREE.Vector3, sunDir: THREE.Vector3, zenith: THREE.Color, horizon: THREE.Color, sunColor: THREE.Color, night: number, time = 0): void {
    this.mat.uniforms.uTime!.value = time;
    this.mat.uniforms.uNight!.value = night;
    this.group.position.set(center.x, 0, center.z);
    this.mat.uniforms.zenith!.value.copy(zenith);
    this.mat.uniforms.horizon!.value.copy(horizon);
    this.mat.uniforms.sunDir!.value.copy(sunDir);
    this.mat.uniforms.sunColor!.value.copy(sunColor);
    (this.stars.material as THREE.PointsMaterial).opacity = night;
    this.stars.visible = night > 0.02;
    this.hillsMat.color.copy(horizon).lerp(new THREE.Color(0x2a3440), 0.55).multiplyScalar(0.85);
  }
}
