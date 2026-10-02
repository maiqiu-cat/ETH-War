import * as THREE from 'three';
import { FIELD_DEPTH, FIELD_WIDTH, FRONT_WAVE_GLSL, type FieldMap } from '../game/field';
import { hash01 } from '../game/armies';

export const BOARD_W = FIELD_WIDTH + 44;
export const BOARD_D = FIELD_DEPTH + 24;
export const ROAD_Z = 7;
const BASE_FRAC = 0.2 / 1.4; // see FieldMap: win line sits at this fraction of the width
export const BULL_BASE_X = (BASE_FRAC - 0.5) * FIELD_WIDTH;
export const BEAR_BASE_X = -BULL_BASE_X;
export const LAKES = [
  { x: BULL_BASE_X - 14, z: 34, r: 9 },
  { x: BEAR_BASE_X + 16, z: -30, r: 10 },
  { x: -30, z: -44, r: 5.5 },
  { x: 42, z: 46, r: 6 },
];

/** Gentle rolling hills, flattened under the road and lakes. Units use this to stand on the ground. */
export function groundHeight(x: number, z: number) {
  let h = 0.9 * Math.sin(x * 0.045 + 0.7) * Math.cos(z * 0.06) + 0.45 * Math.sin(x * 0.12 + z * 0.09) + 0.25 * Math.cos(z * 0.21 - x * 0.05);
  const roadD = Math.abs(z - ROAD_Z);
  h *= THREE.MathUtils.smoothstep(roadD, 2.5, 7);
  for (const l of LAKES) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (d < l.r + 4) h = THREE.MathUtils.lerp(-0.6, h, THREE.MathUtils.smoothstep(d, l.r - 1, l.r + 4));
  }
  // fade to flat at the board edges
  const ex = BOARD_W / 2 - Math.abs(x);
  const ez = BOARD_D / 2 - Math.abs(z);
  return h * THREE.MathUtils.smoothstep(Math.min(ex, ez), 0, 6);
}

export interface TerrainUniforms {
  uFront: { value: number };
  uAmp: { value: number };
  uTime: { value: number };
  uBull: { value: THREE.Color };
  uBullDark: { value: THREE.Color };
  uBear: { value: THREE.Color };
  uBearDark: { value: THREE.Color };
  uLine: { value: THREE.Color };
  uLineGlow: { value: number };
  /** Momentary tint of the front line when price ticks (team colour * intensity). */
  uFlash: { value: THREE.Color };
  uCloud: { value: number };
}

export class Terrain {
  readonly group = new THREE.Group();
  readonly uniforms: TerrainUniforms;
  private ticks = new THREE.Group();

  constructor() {
    this.uniforms = {
      uFront: { value: 0 },
      uAmp: { value: 2 },
      uTime: { value: 0 },
      uBull: { value: new THREE.Color('#6f9a3a') },
      uBullDark: { value: new THREE.Color('#47702a') },
      uBear: { value: new THREE.Color('#9a6a44') },
      uBearDark: { value: new THREE.Color('#6e4630') },
      uLine: { value: new THREE.Color('#d8ffe6') },
      uLineGlow: { value: 1.4 },
      uFlash: { value: new THREE.Color(0, 0, 0) },
      uCloud: { value: 0.22 },
    };
    this.group.add(this.buildGround(), this.buildBoard(), this.buildRoad(), this.buildLakes(), this.buildTrees(), this.ticks);
  }

  private buildGround() {
    const geo = new THREE.PlaneGeometry(BOARD_W, BOARD_D, 264, 144);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBBWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvBBWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vBBWorld;
uniform float uFront, uAmp, uTime, uLineGlow, uCloud;
uniform vec3 uBull, uBullDark, uBear, uBearDark, uLine, uFlash;
${FRONT_WAVE_GLSL}
float bbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bbNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bbHash(i), bbHash(i + vec2(1, 0)), f.x), mix(bbHash(i + vec2(0, 1)), bbHash(i + vec2(1, 1)), f.x), f.y);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float bbFx = uFront + frontWave(vBBWorld.z, uTime, uAmp);
float bbD = vBBWorld.x - bbFx;
float bbN = bbNoise(vBBWorld.xz * 0.18) * 0.65 + bbNoise(vBBWorld.xz * 0.9) * 0.35;
vec3 bbBull = mix(uBullDark, uBull, bbN);
vec3 bbBear = mix(uBearDark, uBear, bbN);
vec3 bbCol = mix(bbBull, bbBear, smoothstep(-0.5, 0.5, bbD));
float bbNear = exp(-abs(bbD) * 0.3);
bbCol *= 1.0 - 0.28 * bbNear * (0.6 + 0.4 * bbNoise(vBBWorld.xz * 2.3));
// drifting cloud shadows
float bbCloud = bbNoise(vBBWorld.xz * 0.022 + vec2(uTime * 0.018, uTime * 0.007)) * 0.7 + bbNoise(vBBWorld.xz * 0.06 - vec2(uTime * 0.01, 0.0)) * 0.3;
bbCol *= 1.0 - uCloud * smoothstep(0.5, 0.72, bbCloud);
diffuseColor.rgb *= bbCol;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
float bbLine = smoothstep(0.45, 0.0, abs(bbD));
float bbPulse = pow(0.5 + 0.5 * sin(vBBWorld.z * 0.22 - uTime * 2.6), 10.0) + pow(0.5 + 0.5 * sin(-vBBWorld.z * 0.13 - uTime * 1.7 + 2.0), 14.0);
vec3 bbSide = bbD < 0.0 ? vec3(0.25, 0.9, 0.45) : vec3(1.0, 0.3, 0.25);
totalEmissiveRadiance += (uLine * (0.75 + bbPulse * 1.1) + uFlash) * bbLine * uLineGlow
  + (bbSide * 0.09 * uLineGlow + uFlash * 0.18) * exp(-abs(bbD) * 0.9);`,
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Diorama slab: side "skirts" that follow the terrain edge down to a flat bottom. */
  private buildBoard() {
    const bottom = -6;
    const segs = 200;
    const pos: number[] = [];
    const hw = BOARD_W / 2;
    const hd = BOARD_D / 2;
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      for (let i = 0; i < segs; i++) {
        const a = i / segs;
        const b = (i + 1) / segs;
        const xa = x0 + (x1 - x0) * a;
        const za = z0 + (z1 - z0) * a;
        const xb = x0 + (x1 - x0) * b;
        const zb = z0 + (z1 - z0) * b;
        const ya = groundHeight(xa, za);
        const yb = groundHeight(xb, zb);
        pos.push(xa, ya, za, xa, bottom, za, xb, yb, zb, xb, yb, zb, xa, bottom, za, xb, bottom, zb);
      }
    };
    edge(-hw, hd, hw, hd);
    edge(hw, hd, hw, -hd);
    edge(hw, -hd, -hw, -hd);
    edge(-hw, -hd, -hw, hd);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#3a2a1f', roughness: 1, side: THREE.DoubleSide });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    const base = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 1.2, 0.6, BOARD_D + 1.2), new THREE.MeshStandardMaterial({ color: '#2a1f17', roughness: 0.8 }));
    base.position.y = bottom - 0.3;
    g.add(base);
    return g;
  }

  private buildRoad() {
    const segs = 200;
    const width = 3.4;
    const geo = new THREE.PlaneGeometry(BOARD_W - 2, width, segs, 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i) + ROAD_Z;
      pos.setZ(i, z);
      pos.setY(i, groundHeight(x, z) + 0.05);
    }
    geo.computeVertexNormals();
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3d3a38';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#56524e';
    g.fillRect(0, 2, 256, 4);
    g.fillRect(0, 58, 256, 4);
    g.fillStyle = '#d9cfa8';
    g.fillRect(20, 30, 90, 4);
    g.fillRect(148, 30, 90, 4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(70, 1);
    tex.anisotropy = 8;
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildLakes() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#3f7fa6', roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.9 });
    const shore = new THREE.MeshStandardMaterial({ color: '#c9b98a', roughness: 1 });
    for (const l of LAKES) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(l.r + 1.2, 40), shore);
      s.rotation.x = -Math.PI / 2;
      s.position.set(l.x, -0.42, l.z);
      s.receiveShadow = true;
      const w = new THREE.Mesh(new THREE.CircleGeometry(l.r, 40), mat);
      w.rotation.x = -Math.PI / 2;
      w.position.set(l.x, -0.32, l.z);
      g.add(s, w);
    }
    return g;
  }

  private buildTrees() {
    const trunk = new THREE.CylinderGeometry(0.12, 0.16, 0.8, 5).translate(0, 0.4, 0);
    const leaves = new THREE.ConeGeometry(0.75, 2.0, 6).translate(0, 1.7, 0);
    const paint = (geo: THREE.BufferGeometry, c: THREE.Color) => {
      const n = geo.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return geo;
    };
    const merged = mergeSimple([paint(trunk, new THREE.Color('#5a3d26')), paint(leaves, new THREE.Color('#ffffff'))]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const uTime = this.uniforms.uTime;
    const sway = (shader: { uniforms: Record<string, unknown>; vertexShader: string }) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 bbIp = instanceMatrix[3].xyz;
#else
vec3 bbIp = vec3(0.0);
#endif
float bbSway = (sin(uTime * 1.4 + bbIp.x * 0.21 + bbIp.z * 0.13) + 0.4 * sin(uTime * 3.1 + bbIp.z * 0.5)) * 0.07 * max(0.0, position.y - 0.7);
transformed.x += bbSway;
transformed.z += bbSway * 0.5;`,
      );
    };
    mat.onBeforeCompile = sway;
    const max = 700;
    const mesh = new THREE.InstancedMesh(merged, mat, max);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    for (let i = 0; n < max && i < max * 6; i++) {
      const x = (hash01(i, 1, 11) - 0.5) * (BOARD_W - 6);
      const z = (hash01(i, 2, 11) - 0.5) * (BOARD_D - 6);
      if (Math.abs(z - ROAD_Z) < 4) continue;
      if (LAKES.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 2.5)) continue;
      if (Math.abs(x - BULL_BASE_X + 13) < 13 && Math.abs(z + 8) < 16) continue;
      if (Math.abs(x - BEAR_BASE_X - 13) < 13 && Math.abs(z + 8) < 16) continue;
      // thinner in the middle so the front stays readable
      if (Math.abs(x) < 75 && hash01(i, 3, 11) < 0.7) continue;
      const sc = 0.5 + hash01(i, 4, 11) * 0.55;
      p.set(x, groundHeight(x, z) - 0.05, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash01(i, 5, 11) * 6.28);
      s.set(sc, sc * (0.8 + hash01(i, 6, 11) * 0.5), sc);
      m.compose(p, q, s);
      mesh.setMatrixAt(n, m);
      col.setHSL(0.27 + hash01(i, 7, 11) * 0.08, 0.45, 0.22 + hash01(i, 8, 11) * 0.12);
      mesh.setColorAt(n, col);
      n++;
    }
    mesh.count = n;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Price ticks along both long edges; rebuilt every round. */
  setField(field: FieldMap) {
    this.ticks.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.MeshBasicMaterial).map?.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.ticks.clear();
    const step = field.tickStep(10);
    const minor = step / 5;
    const zEdge = field.depth / 2 + 4;
    const dashMat = new THREE.MeshBasicMaterial({ color: '#f4f1e6', transparent: true, opacity: 0.85 });
    const majorGeo = new THREE.BoxGeometry(0.3, 0.06, 2.6);
    const minorGeo = new THREE.BoxGeometry(0.18, 0.05, 1.1);
    const start = Math.ceil(field.minPrice / minor) * minor;
    for (let p = start; p <= field.maxPrice; p += minor) {
      const major = Math.abs(p / step - Math.round(p / step)) < 1e-6;
      const x = field.x(p);
      for (const side of [-1, 1]) {
        const z = side * zEdge;
        const d = new THREE.Mesh(major ? majorGeo : minorGeo, dashMat);
        d.position.set(x, groundHeight(x, z) + 0.06, z);
        this.ticks.add(d);
        if (major) {
          const label = textPlane(Math.round(p).toLocaleString('en-US'), 7, 1.6);
          label.position.set(x, groundHeight(x, z + side * 3.6) + 0.08, z + side * 3.6);
          this.ticks.add(label);
        }
      }
    }
  }
}

function textPlane(text: string, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d')!;
  g.font = `600 ${Math.round(c.height * 0.72)}px "Inter Variable", "Inter", "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(250,248,238,0.92)';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** Merge non-indexed/indexed geometries that share position/normal/color attributes. */
export function mergeSimple(geos: THREE.BufferGeometry[]) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    if (!parts.every((g) => g.attributes[name])) continue;
    const arr = new Float32Array(total * 3);
    let off = 0;
    for (const g of parts) {
      arr.set((g.attributes[name] as THREE.BufferAttribute).array as Float32Array, off);
      off += g.attributes[name].count * 3;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  return out;
}
