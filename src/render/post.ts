import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Tilt-shift (diorama look) + vignette + light grading, in linear HDR before tone mapping. */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uBlur: { value: 3 },
    uFocus: { value: 0.5 },
    uBand: { value: 0.16 },
    uVignette: { value: 0.32 },
    uSat: { value: 1.1 },
    uWarm: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uBlur, uFocus, uBand, uVignette, uSat;
    uniform vec3 uWarm;
    varying vec2 vUv;
    const vec2 P[12] = vec2[12](
      vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
      vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
      vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float d = abs(vUv.y - uFocus);
      float b = smoothstep(uBand, uBand + 0.4, d) * uBlur;
      if (b > 0.25) {
        vec3 acc = col.rgb;
        for (int i = 0; i < 12; i++) acc += texture2D(tDiffuse, vUv + P[i] * b / uRes).rgb;
        col.rgb = acc / 13.0;
      }
      float l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb = mix(vec3(l), col.rgb, uSat) * uWarm;
      vec2 q = vUv - 0.5;
      q.x *= uRes.x / uRes.y;
      col.rgb *= mix(1.0 - uVignette, 1.0, smoothstep(1.05, 0.3, length(q)));
      gl_FragColor = col;
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly finish: ShaderPass;
  private tilt = { cur: 3, target: 3 };

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.65, 0.55, 1.15);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.finish.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
  }

  /** Stronger miniature blur in cinematic mode, subtle when the user drives the camera. */
  setCinematic(on: boolean) {
    this.tilt.target = on ? 3.2 : 1.4;
  }

  setGrade(opts: { bloom: number; threshold: number; warm: [number, number, number]; vignette: number }) {
    this.bloom.strength = opts.bloom;
    this.bloom.threshold = opts.threshold;
    this.finish.uniforms.uWarm.value.set(...opts.warm);
    this.finish.uniforms.uVignette.value = opts.vignette;
  }

  render(dt: number) {
    this.tilt.cur += (this.tilt.target - this.tilt.cur) * (1 - Math.exp(-dt * 2));
    this.finish.uniforms.uBlur.value = this.tilt.cur * this.finish.uniforms.uRes.value.y / 1000;
    this.composer.render(dt);
  }
}
