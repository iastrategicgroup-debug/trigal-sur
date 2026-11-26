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
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 zenith, horizon, sunDir, sunColor; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.1, 1.0);
          vec3 c = mix(horizon, zenith, pow(max(h,0.0), 0.55));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += sunColor * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.35);
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

  update(center: THREE.Vector3, sunDir: THREE.Vector3, zenith: THREE.Color, horizon: THREE.Color, sunColor: THREE.Color, night: number): void {
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
