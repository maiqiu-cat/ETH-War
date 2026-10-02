import * as THREE from 'three';
import { groundHeight } from './terrain';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
uniform float uSoft;
uniform float uIntensity;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, uSoft, d) * vAlpha;
  gl_FragColor = vec4(vColor * uIntensity, a);
}`;

interface ParticleOpts {
  max: number;
  additive: boolean;
  soft: number;
  intensity: number;
}

/** CPU-simulated point sprites (fire, sparks, smoke, dust). */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private baseAlpha: Float32Array;
  private next = 0;
  readonly material: THREE.ShaderMaterial;
  /** Constant drift applied to every particle (wind). */
  readonly wind = new THREE.Vector3();

  constructor(private readonly o: ParticleOpts) {
    const n = o.max;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 }, uSoft: { value: o.soft }, uIntensity: { value: o.intensity } },
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, size: number, life: number, alpha = 1, grow = 0, grav = 0, drag = 1.8) {
    const i = this.next;
    this.next = (this.next + 1) % this.o.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = alpha;
    this.baseAlpha[i] = alpha;
    this.grow[i] = grow;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  update(dt: number) {
    const n = this.o.max;
    const wx = this.wind.x * dt;
    const wz = this.wind.z * dt;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const j = i * 3;
      this.vel[j + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-dt * this.drag[i]);
      this.vel[j] *= drag;
      this.vel[j + 1] *= drag;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt + wx;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt + wz;
      this.size[i] += this.grow[i] * dt;
      // fade in quickly, fade out over the last 70% of life
      const age = 1 - k;
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, age * 12) * (k < 0.7 ? k / 0.7 : 1);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}

interface Shell {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  size: number;
  color: THREE.Color;
  onHit?: () => void;
  active: boolean;
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  size: number;
  active: boolean;
}

interface Tracer {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  active: boolean;
}

interface Debris {
  p: THREE.Vector3;
  v: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  size: number;
  active: boolean;
}

interface Scorch {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  active: boolean;
}

const FIRE = [new THREE.Color('#fff2b0'), new THREE.Color('#ffb347'), new THREE.Color('#ff6a2a')];
const WHITE_HOT = new THREE.Color('#fff8e6');
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const tmpColor = new THREE.Color();

function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(12,8,6,0.95)');
  grad.addColorStop(0.45, 'rgba(25,16,10,0.7)');
  grad.addColorStop(1, 'rgba(30,20,12,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // irregular edge
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 28;
    g.fillStyle = `rgba(20,14,9,${0.15 + Math.random() * 0.25})`;
    g.beginPath();
    g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 3 + Math.random() * 7, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Effects {
  readonly group = new THREE.Group();
  private fire = new Particles({ max: 6000, additive: true, soft: 0.05, intensity: 2.6 });
  private smoke = new Particles({ max: 3000, additive: false, soft: 0.12, intensity: 1 });
  private shells: Shell[] = [];
  private rings: Ring[] = [];
  private flashes: { light: THREE.PointLight; t: number; peak: number }[] = [];
  private tracers: Tracer[] = [];
  private tracerMesh: THREE.InstancedMesh;
  private debris: Debris[] = [];
  private debrisMesh: THREE.InstancedMesh;
  private scorches: Scorch[] = [];
  private scorchMat: THREE.MeshBasicMaterial;
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  /** Smoke tint follows the lighting preset. */
  smokeTint = new THREE.Color('#8f857a');

  constructor() {
    this.group.add(this.smoke.points, this.fire.points);
    this.smoke.wind.set(0.6, 0, 0.25);

    const shellGeo = new THREE.SphereGeometry(0.22, 8, 6);
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ color: '#fff3c4' }));
      mesh.visible = false;
      this.group.add(mesh);
      this.shells.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, arc: 0, size: 1, color: new THREE.Color(), active: false });
    }
    const ringGeo = new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 1, size: 1, active: false });
    }
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight('#ffb36b', 0, 34, 1.5);
      this.group.add(light);
      this.flashes.push({ light, t: 1, peak: 0 });
    }

    // Tracers: thin glowing streaks, instanced.
    const tracerGeo = new THREE.BoxGeometry(1, 0.045, 0.045).translate(-0.5, 0, 0);
    this.tracerMesh = new THREE.InstancedMesh(
      tracerGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      240,
    );
    this.tracerMesh.frustumCulled = false;
    for (let i = 0; i < 240; i++) {
      this.tracerMesh.setMatrixAt(i, this.hidden);
      this.tracerMesh.setColorAt(i, new THREE.Color(1, 1, 1));
      this.tracers.push({ from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 0.1, active: false });
    }
    this.group.add(this.tracerMesh);

    // Debris chunks thrown by explosions.
    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1, flatShading: true }),
      400,
    );
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = true;
    for (let i = 0; i < 400; i++) {
      this.debrisMesh.setMatrixAt(i, this.hidden);
      this.debris.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, size: 0.2, active: false });
    }
    this.group.add(this.debrisMesh);

    // Scorch marks that conform to the terrain and fade out.
    this.scorchMat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 6, 6).rotateX(-Math.PI / 2), this.scorchMat.clone());
      mesh.visible = false;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.scorches.push({ mesh, age: 0, life: 30, active: false });
    }
  }

  setViewportHeight(px: number) {
    this.fire.material.uniforms.uScale.value = px * 0.6;
    this.smoke.material.uniforms.uScale.value = px * 0.6;
  }

  explosion(p: THREE.Vector3, size = 1, tint?: THREE.Color) {
    // white-hot core
    this.fire.emit(p, tmpV.set(0, 1, 0), WHITE_HOT, 5 * size + 2, 0.16, 1, 14 * size, 0);
    const n = Math.round(30 * size + 12);
    for (let i = 0; i < n; i++) {
      tmpV.set(Math.random() - 0.5, Math.random() * 0.9 + 0.25, Math.random() - 0.5).normalize().multiplyScalar((2 + Math.random() * 6) * size);
      const c = FIRE[Math.floor(Math.random() * FIRE.length)].clone();
      if (tint) c.lerp(tint, 0.3);
      this.fire.emit(p, tmpV, c, (0.8 + Math.random() * 1.6) * size, 0.35 + Math.random() * 0.55, 1, 2.6 * size, 2.5);
    }
    for (let i = 0; i < Math.round(10 * size + 5); i++) {
      tmpV.set((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2.8, (Math.random() - 0.5) * 2).multiplyScalar(size);
      const g = 0.12 + Math.random() * 0.12;
      this.smoke.emit(
        tmpV2.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * size, 0.4, (Math.random() - 0.5) * size)),
        tmpV,
        new THREE.Color(g, g * 0.95, g * 0.9),
        (2 + Math.random() * 2.2) * size,
        2.8 + Math.random() * 2,
        0.62,
        2.4 * size,
        -0.35,
        1.2,
      );
    }
    // embers with long, falling arcs
    for (let i = 0; i < Math.round(18 * size); i++) {
      tmpV.set(Math.random() - 0.5, Math.random() + 0.5, Math.random() - 0.5).normalize().multiplyScalar(7 + Math.random() * 10 * size);
      this.fire.emit(p, tmpV, FIRE[i % 2], 0.22 + Math.random() * 0.15, 0.8 + Math.random() * 0.9, 1, 0, 13, 0.6);
    }
    this.throwDebris(p, size);
    this.scorch(p, size);
    this.ring(p, 3 + size * 5, 0.55 + size * 0.15);
    this.flash(p, 28 * size + 10);
  }

  private throwDebris(p: THREE.Vector3, size: number) {
    let n = Math.round(5 + size * 6);
    for (const d of this.debris) {
      if (n <= 0) break;
      if (d.active) continue;
      n--;
      d.active = true;
      d.p.copy(p);
      const a = Math.random() * Math.PI * 2;
      const sp = (3 + Math.random() * 6) * Math.sqrt(size);
      d.v.set(Math.cos(a) * sp, 6 + Math.random() * 8 * Math.sqrt(size), Math.sin(a) * sp);
      d.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      d.life = 2.2 + Math.random() * 1.5;
      d.size = 0.12 + Math.random() * 0.22 * size;
    }
  }

  private scorch(p: THREE.Vector3, size: number) {
    const s = this.scorches.find((x) => !x.active) ?? this.scorches.reduce((a, b) => (a.age > b.age ? a : b));
    s.active = true;
    s.age = 0;
    s.life = 25 + size * 8;
    const r = 1.6 + size * 1.6;
    const geo = s.mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    // rebuild a conforming patch around p
    const base = new THREE.PlaneGeometry(1, 1, 6, 6).rotateX(-Math.PI / 2).attributes.position as THREE.BufferAttribute;
    const rot = Math.random() * Math.PI * 2;
    for (let i = 0; i < pos.count; i++) {
      const lx = base.getX(i) * r * 2;
      const lz = base.getZ(i) * r * 2;
      const x = p.x + lx * Math.cos(rot) - lz * Math.sin(rot);
      const z = p.z + lx * Math.sin(rot) + lz * Math.cos(rot);
      pos.setXYZ(i, x, groundHeight(x, z) + 0.06, z);
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
    s.mesh.visible = true;
    (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
  }

  dust(p: THREE.Vector3, size = 0.6) {
    for (let i = 0; i < 3; i++) {
      tmpV.set((Math.random() - 0.5) * 1.5, 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5);
      this.smoke.emit(p, tmpV, new THREE.Color('#9b8467'), size * (1 + Math.random()), 1.1 + Math.random() * 0.8, 0.4, size * 1.3, -0.15);
    }
  }

  /** Slow battlefield haze drifting along the front. */
  haze(p: THREE.Vector3) {
    tmpV.set((Math.random() - 0.5) * 0.4, 0.35 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
    this.smoke.emit(p, tmpV, this.smokeTint, 3.5 + Math.random() * 3, 6 + Math.random() * 4, 0.075, 0.7, -0.03, 0.2);
  }

  muzzle(p: THREE.Vector3, dir: THREE.Vector3, big = false) {
    tmpV.copy(dir).multiplyScalar(big ? 6 : 3);
    this.fire.emit(p, tmpV, WHITE_HOT, big ? 1.6 : 0.5, big ? 0.12 : 0.07, 1, big ? 6 : 2);
    if (big) {
      for (let i = 0; i < 6; i++) {
        tmpV.copy(dir).multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2));
        this.smoke.emit(p, tmpV, new THREE.Color(0.5, 0.48, 0.45), 1.2 + Math.random(), 1.4 + Math.random(), 0.4, 1.8, -0.2);
      }
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color) {
    const idx = this.tracers.findIndex((x) => !x.active);
    if (idx < 0) return;
    const tr = this.tracers[idx];
    tr.active = true;
    tr.from.copy(from);
    tr.to.copy(to);
    tr.t = 0;
    tr.dur = Math.max(0.06, from.distanceTo(to) / 70);
    this.tracerMesh.setColorAt(idx, tmpColor.copy(color).lerp(WHITE_HOT, 0.45).multiplyScalar(4));
    this.tracerMesh.instanceColor!.needsUpdate = true;
  }

  /** Signal flare for option prints. */
  flare(p: THREE.Vector3, color: THREE.Color) {
    for (let i = 0; i < 22; i++) {
      tmpV.set((Math.random() - 0.5) * 0.6, 10 + Math.random() * 3, (Math.random() - 0.5) * 0.6);
      this.fire.emit(p, tmpV, color, 0.7, 1.0 + Math.random() * 0.4, 1, 0.5, 9, 0.8);
    }
  }

  shell(from: THREE.Vector3, to: THREE.Vector3, size: number, color: THREE.Color, onHit?: () => void) {
    const s = this.shells.find((x) => !x.active);
    if (!s) {
      onHit?.();
      return;
    }
    s.active = true;
    s.from.copy(from);
    s.to.copy(to);
    s.t = 0;
    const dist = from.distanceTo(to);
    s.dur = 0.5 + dist / 45;
    s.arc = Math.min(18, 2 + dist * 0.18);
    s.size = size;
    s.color.copy(color);
    s.onHit = onHit;
    s.mesh.visible = true;
    s.mesh.scale.setScalar(0.8 + size * 0.5);
    (s.mesh.material as THREE.MeshBasicMaterial).color.copy(color).lerp(WHITE_HOT, 0.6).multiplyScalar(5);
    this.muzzle(from, tmpV2.copy(to).sub(from).setY(0).normalize(), true);
    this.flash(from, 8);
  }

  ring(p: THREE.Vector3, size: number, dur: number) {
    const r = this.rings.find((x) => !x.active);
    if (!r) return;
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.size = size;
    r.mesh.visible = true;
    r.mesh.position.set(p.x, groundHeight(p.x, p.z) + 0.15, p.z);
  }

  flash(p: THREE.Vector3, peak: number) {
    const f = this.flashes.reduce((a, b) => (a.t > b.t ? a : b));
    f.t = 0;
    f.peak = peak;
    f.light.position.set(p.x, p.y + 2.5, p.z);
  }

  update(dt: number) {
    for (const s of this.shells) {
      if (!s.active) continue;
      s.t += dt / s.dur;
      const k = Math.min(1, s.t);
      tmpV.lerpVectors(s.from, s.to, k);
      tmpV.y += Math.sin(k * Math.PI) * s.arc;
      s.mesh.position.copy(tmpV);
      this.fire.emit(tmpV, tmpV2.set(0, 0.2, 0), s.color, 0.6 + s.size * 0.3, 0.3, 0.8, -0.5);
      if (Math.random() < 0.5) this.smoke.emit(tmpV, tmpV2.set(0, 0.3, 0), new THREE.Color(0.55, 0.53, 0.5), 0.6 + s.size * 0.3, 1.2, 0.25, 1.2, -0.1);
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
        this.explosion(s.to, s.size, s.color);
        s.onHit?.();
      }
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt / r.dur;
      const k = Math.min(1, r.t);
      const e = 1 - (1 - k) ** 3; // ease-out
      r.mesh.scale.setScalar(0.2 + e * r.size);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
      }
    }
    for (const f of this.flashes) {
      f.t += dt;
      f.light.intensity = f.peak * Math.max(0, 1 - f.t / 0.35) ** 2 * 20;
    }
    // tracers
    for (let i = 0; i < this.tracers.length; i++) {
      const tr = this.tracers[i];
      if (!tr.active) continue;
      tr.t += dt / tr.dur;
      if (tr.t >= 1) {
        tr.active = false;
        this.tracerMesh.setMatrixAt(i, this.hidden);
        this.fire.emit(tr.to, tmpV.set(0, 1.5, 0), FIRE[1], 0.35, 0.12, 1, 1);
        continue;
      }
      tmpV.lerpVectors(tr.from, tr.to, tr.t);
      tmpV2.copy(tr.to).sub(tr.from).normalize();
      tmpQ.setFromUnitVectors(X_AXIS, tmpV2);
      tmpS.set(Math.min(1.6, tr.from.distanceTo(tr.to) * tr.t), 1, 1);
      tmpM.compose(tmpV, tmpQ, tmpS);
      this.tracerMesh.setMatrixAt(i, tmpM);
    }
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    // debris
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      if (!d.active) continue;
      d.life -= dt;
      d.v.y -= 22 * dt;
      d.p.addScaledVector(d.v, dt);
      const gy = groundHeight(d.p.x, d.p.z) + d.size * 0.5;
      if (d.p.y < gy) {
        d.p.y = gy;
        d.v.y = Math.abs(d.v.y) * 0.3;
        d.v.x *= 0.55;
        d.v.z *= 0.55;
        d.spin.multiplyScalar(0.5);
      }
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      d.rot.z += d.spin.z * dt;
      const sc = d.size * Math.min(1, d.life / 0.6);
      tmpQ.setFromEuler(d.rot);
      tmpS.setScalar(Math.max(0, sc));
      tmpM.compose(d.p, tmpQ, tmpS);
      this.debrisMesh.setMatrixAt(i, d.life > 0 ? tmpM : this.hidden);
      if (d.life <= 0) d.active = false;
    }
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    // scorch marks fade
    for (const s of this.scorches) {
      if (!s.active) continue;
      s.age += dt;
      const k = s.age / s.life;
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k * k);
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
    this.fire.update(dt);
    this.smoke.update(dt);
  }
}
