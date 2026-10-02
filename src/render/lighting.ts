import * as THREE from 'three';

export type LightingName = 'golden' | 'day' | 'night';

interface Preset {
  label: string;
  sunColor: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fog: string;
  exposure: number;
  lineGlow: number;
  /** Post-processing grade. */
  bloom: number;
  bloomThreshold: number;
  warm: [number, number, number];
  vignette: number;
  smoke: string;
  cloudShadow: number;
}

export const PRESETS: Record<LightingName, Preset> = {
  golden: {
    label: 'Golden hour',
    sunColor: '#ffbf80',
    sunIntensity: 3.2,
    sunDir: [-0.55, 0.42, 0.72],
    hemiSky: '#ffd6a6',
    hemiGround: '#3b2a1b',
    hemiIntensity: 0.9,
    skyTop: '#27324d',
    skyHorizon: '#e9a46c',
    skyBottom: '#1b1410',
    fog: '#b7835e',
    exposure: 1.0,
    lineGlow: 1.0,
    bloom: 0.55,
    bloomThreshold: 1.3,
    warm: [1.05, 1.0, 0.92],
    vignette: 0.34,
    smoke: '#9a8270',
    cloudShadow: 0.22,
  },
  day: {
    label: 'Daylight',
    sunColor: '#fff6e8',
    sunIntensity: 3.4,
    sunDir: [-0.35, 0.85, 0.4],
    hemiSky: '#cfe3ff',
    hemiGround: '#4b3b28',
    hemiIntensity: 1.1,
    skyTop: '#3f74b8',
    skyHorizon: '#cfe2f2',
    skyBottom: '#2a2620',
    fog: '#c3d6e6',
    exposure: 0.95,
    lineGlow: 0.85,
    bloom: 0.4,
    bloomThreshold: 1.7,
    warm: [1.0, 1.0, 1.0],
    vignette: 0.26,
    smoke: '#a49c92',
    cloudShadow: 0.25,
  },
  night: {
    label: 'Night',
    sunColor: '#a9c1ff',
    sunIntensity: 1.6,
    sunDir: [0.4, 0.75, -0.5],
    hemiSky: '#5a73a8',
    hemiGround: '#141820',
    hemiIntensity: 0.9,
    skyTop: '#04060c',
    skyHorizon: '#1d2846',
    skyBottom: '#030305',
    fog: '#121a2a',
    exposure: 1.35,
    lineGlow: 0.9,
    bloom: 0.75,
    bloomThreshold: 1.0,
    warm: [0.92, 0.98, 1.1],
    vignette: 0.42,
    smoke: '#3c4250',
    cloudShadow: 0.1,
  },
};

export function autoLighting(d = new Date()): LightingName {
  const h = d.getHours();
  if (h >= 7 && h < 16) return 'day';
  if ((h >= 16 && h < 19) || (h >= 5 && h < 7)) return 'golden';
  return 'night';
}

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  current: LightingName = 'golden';
  private skyMat: THREE.ShaderMaterial;

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer, shadows: boolean) {
    this.sun = new THREE.DirectionalLight('#ffffff', 3);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(4096, 4096);
    const s = this.sun.shadow.camera;
    s.left = -150;
    s.right = 150;
    s.top = 100;
    s.bottom = -100;
    s.near = 10;
    s.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#333333', 1);
    scene.add(this.hemi);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top, horizon, bottom; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.35)); gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), this.skyMat);
    scene.add(this.sky);
  }

  apply(name: LightingName) {
    const p = PRESETS[name];
    this.current = name;
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.sun.position.set(...p.sunDir).multiplyScalar(300);
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.skyMat.uniforms.top.value.set(p.skyTop);
    this.skyMat.uniforms.horizon.value.set(p.skyHorizon);
    this.skyMat.uniforms.bottom.value.set(p.skyBottom);
    this.scene.fog = new THREE.Fog(p.fog, 260, 900);
    this.renderer.toneMappingExposure = p.exposure;
    return p;
  }
}
