import * as THREE from 'three';
import type { UnitKind, UnitTarget } from '../game/armies';
import type { Team } from '../game/battle';
import { TEAM_COLORS } from './bases';
import { groundHeight } from './terrain';

const MAX_SOLDIERS = 5000;
const MAX_TANKS = 220;

/* Vertex "parts" animated in the shader. */
const BODY = 0;
const LEG_L = 1;
const LEG_R = 2;
const ARMS = 3;
const TURRET = 4;
const BARREL = 5;

function part(geo: THREE.BufferGeometry, shadeV: number, partId: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(shadeV), 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(partId), 1));
  return g;
}

function merge(parts: THREE.BufferGeometry[]) {
  const out = new THREE.BufferGeometry();
  const total = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['color', 3],
    ['aPart', 1],
  ] as const) {
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of parts) {
      arr.set((g.attributes[name] as THREE.BufferAttribute).array as Float32Array, off);
      off += g.attributes[name].count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

function soldierGeometry() {
  return merge([
    part(new THREE.BoxGeometry(0.15, 0.46, 0.13).translate(0, 0.23, 0.075), 0.5, LEG_L),
    part(new THREE.BoxGeometry(0.15, 0.46, 0.13).translate(0, 0.23, -0.075), 0.5, LEG_R),
    part(new THREE.BoxGeometry(0.36, 0.44, 0.26).translate(0, 0.68, 0), 1.0, BODY), // torso
    part(new THREE.BoxGeometry(0.12, 0.08, 0.3).translate(0.02, 0.88, 0), 0.75, BODY), // shoulders / pack strap
    part(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 1.02, 0), 1.3, BODY), // head
    part(new THREE.BoxGeometry(0.27, 0.09, 0.27).translate(0, 1.15, 0), 0.62, BODY), // helmet
    part(new THREE.BoxGeometry(0.2, 0.32, 0.18).translate(-0.24, 0.7, 0), 0.7, BODY), // backpack
    part(new THREE.BoxGeometry(0.34, 0.09, 0.09).translate(0.14, 0.76, 0.15), 0.9, ARMS), // arm
    part(new THREE.BoxGeometry(0.7, 0.06, 0.06).translate(0.26, 0.76, 0.13), 0.3, ARMS), // rifle (points +x)
  ]);
}

function tankGeometry() {
  return merge([
    part(new THREE.BoxGeometry(2.4, 0.44, 0.42).translate(0, 0.22, 0.64), 0.32, BODY), // tracks
    part(new THREE.BoxGeometry(2.4, 0.44, 0.42).translate(0, 0.22, -0.64), 0.32, BODY),
    part(new THREE.BoxGeometry(2.1, 0.5, 1.32).translate(0, 0.64, 0), 1.0, BODY), // hull
    part(new THREE.BoxGeometry(0.5, 0.3, 1.2).translate(1.0, 0.58, 0).rotateZ(0), 0.85, BODY), // glacis
    part(new THREE.BoxGeometry(1.05, 0.44, 0.92).translate(-0.12, 1.11, 0), 1.15, TURRET),
    part(new THREE.BoxGeometry(0.3, 0.14, 0.3).translate(-0.3, 1.4, 0.2), 0.6, TURRET), // hatch
    part(new THREE.CylinderGeometry(0.07, 0.085, 1.5, 6).rotateZ(Math.PI / 2).translate(1.15, 1.14, 0), 0.45, BARREL),
  ]);
}

const UNIT_VERTEX_DECL = /* glsl */ `
attribute float aPart;
attribute vec4 aAnim; // x: phase, y: moving, z: fire recoil, w: hit flash
uniform float uTime;
varying float vFlash;`;

const UNIT_VERTEX_BODY = /* glsl */ `
vFlash = aAnim.w;
float bbWalk = sin(uTime * 10.0 + aAnim.x * 6.2831);
if (aPart > 0.5 && aPart < 2.5) {
  float s = (aPart < 1.5 ? 1.0 : -1.0) * bbWalk * 0.7 * aAnim.y;
  vec2 p = transformed.xy - vec2(0.0, 0.46);
  float c = cos(s); float sn = sin(s);
  transformed.xy = vec2(c * p.x - sn * p.y, sn * p.x + c * p.y) + vec2(0.0, 0.46);
} else if (aPart > 2.5 && aPart < 3.5) {
  transformed.x -= aAnim.z * 0.14;
  transformed.y += aAnim.z * 0.05 + bbWalk * 0.035 * aAnim.y;
} else if (aPart > 3.5 && aPart < 4.5) {
  transformed.x -= aAnim.z * 0.08;
} else if (aPart > 4.5) {
  transformed.x -= aAnim.z * 0.45;
}`;

function unitMaterial(uTime: { value: number }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${UNIT_VERTEX_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${UNIT_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlash;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * vFlash * 1.4;');
  };
  return mat;
}

/** Shadow pass needs the same deformation, otherwise legs would not swing in the shadows. */
function unitDepthMaterial(uTime: { value: number }) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${UNIT_VERTEX_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${UNIT_VERTEX_BODY}`);
  };
  return mat;
}

type Phase = 'alive' | 'dying' | 'retreating' | 'knocked';

export interface Unit {
  key: string;
  team: Team;
  kind: UnitKind;
  slot: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  frontRow?: number;
  phase: Phase;
  /** Seconds in current phase. */
  pt: number;
  spawn: number;
  yaw: number;
  seed: number;
  moving: number;
  fire: number;
  flash: number;
  /** Seconds since the unit spawned, for the deploy pop-in. */
  age: number;
}

export interface FrontFn {
  (z: number): number;
}

/**
 * Instanced soldiers and tanks. Targets come from layoutArmies(); units march to
 * them, and units that disappear near the front are "killed" (topple) while the
 * rest retreat (shrink away). Limb and recoil animation runs in the vertex shader.
 */
export class ArmyRenderer {
  readonly group = new THREE.Group();
  readonly soldiers: THREE.InstancedMesh;
  readonly tanks: THREE.InstancedMesh;
  readonly uTime = { value: 0 };
  private animS: THREE.InstancedBufferAttribute;
  private animT: THREE.InstancedBufferAttribute;
  private units = new Map<string, Unit>();
  private freeS: number[] = [];
  private freeT: number[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private seq = 0;
  private list: Unit[] | null = null;
  onKilled?: (x: number, y: number, z: number, team: Team) => void;
  onDust?: (x: number, y: number, z: number) => void;

  constructor() {
    this.soldiers = new THREE.InstancedMesh(soldierGeometry(), unitMaterial(this.uTime), MAX_SOLDIERS);
    this.tanks = new THREE.InstancedMesh(tankGeometry(), unitMaterial(this.uTime), MAX_TANKS);
    this.animS = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SOLDIERS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.animT = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TANKS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.soldiers.geometry.setAttribute('aAnim', this.animS);
    this.tanks.geometry.setAttribute('aAnim', this.animT);
    for (const im of [this.soldiers, this.tanks]) {
      im.customDepthMaterial = unitDepthMaterial(this.uTime);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      for (let i = 0; i < im.count; i++) {
        im.setMatrixAt(i, this.zero);
        im.setColorAt(i, new THREE.Color(1, 1, 1));
      }
      this.group.add(im);
    }
    for (let i = MAX_SOLDIERS - 1; i >= 0; i--) this.freeS.push(i);
    for (let i = MAX_TANKS - 1; i >= 0; i--) this.freeT.push(i);
  }

  get stats() {
    let soldiers = 0;
    let tanks = 0;
    for (const u of this.units.values()) if (u.phase === 'alive') u.kind === 'tank' ? tanks++ : soldiers++;
    return { soldiers, tanks, total: this.units.size };
  }

  setTargets(targets: UnitTarget[], front: FrontFn) {
    const seen = new Set<string>();
    for (const t of targets) {
      seen.add(t.key);
      let u = this.units.get(t.key);
      if (u && (u.phase === 'dying' || u.phase === 'retreating')) {
        u.phase = 'alive';
        u.pt = 0;
      }
      if (!u) {
        const free = t.kind === 'tank' ? this.freeT : this.freeS;
        const slot = free.pop();
        if (slot === undefined) continue;
        const dir = t.team === 'bulls' ? 1 : -1;
        const tx = t.frontRow !== undefined ? front(t.z) - dir * (0.9 + t.frontRow * 0.62) : t.x;
        // Reinforcements arrive from behind their own lines.
        const back = t.frontRow !== undefined ? 7 + Math.random() * 6 : 0;
        const base = new THREE.Color(TEAM_COLORS[t.team].main);
        const hsl = { h: 0, s: 0, l: 0 };
        base.getHSL(hsl);
        // slight per-unit tint so crowds don't look flat
        const col = new THREE.Color().setHSL(hsl.h + (Math.random() - 0.5) * 0.02, hsl.s * (0.85 + Math.random() * 0.15), hsl.l * (0.85 + Math.random() * 0.25));
        u = {
          key: t.key,
          team: t.team,
          kind: t.kind,
          slot,
          x: tx - dir * back,
          z: t.z,
          tx,
          tz: t.z,
          frontRow: t.frontRow,
          phase: 'alive',
          pt: 0,
          spawn: back > 0 ? 1 : 0,
          yaw: dir > 0 ? 0 : Math.PI,
          seed: (this.seq = (this.seq * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff,
          moving: 0,
          fire: 0,
          flash: 0,
          age: 0,
        };
        (t.kind === 'tank' ? this.tanks : this.soldiers).setColorAt(slot, col);
        this.units.set(t.key, u);
      }
      u.frontRow = t.frontRow;
      if (t.frontRow === undefined) u.tx = t.x;
      u.tz = t.z;
    }
    for (const u of this.units.values()) {
      if (seen.has(u.key) || u.phase === 'dying' || u.phase === 'retreating') continue;
      const nearFront = Math.abs(u.x - front(u.z)) < 4 || u.frontRow !== undefined;
      u.phase = nearFront ? 'dying' : 'retreating';
      u.pt = 0;
      if (nearFront) {
        u.flash = 1;
        this.onKilled?.(u.x, groundHeight(u.x, u.z), u.z, u.team);
      }
    }
    this.soldiers.instanceColor!.needsUpdate = true;
    this.tanks.instanceColor!.needsUpdate = true;
    this.list = null;
  }

  /** Knock down alive units of `team` around a point (artillery hit); they get back up. */
  hit(team: Team, x: number, z: number, radius: number, max = 12) {
    let n = 0;
    for (const u of this.units.values()) {
      if (n >= max || u.team !== team || u.phase !== 'alive') continue;
      if ((u.x - x) ** 2 + (u.z - z) ** 2 < radius * radius) {
        u.flash = 1;
        if (u.kind !== 'tank') {
          u.phase = 'knocked';
          u.pt = 0;
        }
        n++;
      }
    }
    return n;
  }

  /** A random alive unit of a team close to the front, preferring tanks; used as a shooter. */
  pickShooter(team: Team, front: FrontFn, preferTank = true): Unit | null {
    let best: Unit | null = null;
    let bestScore = Infinity;
    for (const u of this.units.values()) {
      if (u.team !== team || u.phase !== 'alive') continue;
      const d = Math.abs(u.x - front(u.z));
      const score = d + Math.random() * 25 - (preferTank && u.kind === 'tank' ? 20 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  }

  /** Random front-line soldier (for rifle fire). */
  randomFrontSoldier(team: Team): Unit | null {
    const arr = (this.list ??= [...this.units.values()]);
    const n = arr.length;
    if (!n) return null;
    for (let i = 0; i < 10; i++) {
      const u = arr[Math.floor(Math.random() * n)];
      if (u.team === team && u.phase === 'alive' && u.frontRow !== undefined && u.frontRow < 2 && u.moving < 0.3) return u;
    }
    return null;
  }

  /** World position of the weapon muzzle. */
  muzzle(u: Unit, out = new THREE.Vector3()) {
    const reach = u.kind === 'tank' ? 1.9 : 0.62;
    const h = u.kind === 'tank' ? 1.14 : 0.76;
    return out.set(u.x + Math.cos(u.yaw) * reach, groundHeight(u.x, u.z) + h, u.z - Math.sin(u.yaw) * reach);
  }

  fire(u: Unit) {
    u.fire = 1;
  }

  update(dt: number, t: number, front: FrontFn) {
    this.uTime.value = t;
    const toFree: Unit[] = [];
    const animS = this.animS.array as Float32Array;
    const animT = this.animT.array as Float32Array;
    for (const u of this.units.values()) {
      u.pt += dt;
      u.age += dt;
      u.fire = Math.max(0, u.fire - dt * (u.kind === 'tank' ? 2.5 : 7));
      u.flash = Math.max(0, u.flash - dt * 4);
      const dir = u.team === 'bulls' ? 1 : -1;
      const tank = u.kind === 'tank';
      if (u.frontRow !== undefined && u.phase === 'alive') u.tx = front(u.tz) - dir * (0.9 + u.frontRow * 0.62 + (u.seed - 0.5) * 0.25);
      let scale = Math.min(1, 0.2 + u.age * 2.4); // deploy pop-in
      let tilt = 0;
      let sink = 0;
      let bob = 0;
      let lean = 0;

      if (u.phase === 'alive' || u.phase === 'knocked') {
        const dx = u.tx - u.x;
        const dz = u.tz - u.z;
        const dist = Math.hypot(dx, dz);
        const speed = (tank ? 5 : 7) * (u.spawn > 0 ? 1.4 : 1);
        if (dist > 0.02 && u.phase === 'alive') {
          const step = Math.min(dist, speed * dt);
          u.x += (dx / dist) * step;
          u.z += (dz / dist) * step;
          u.moving = Math.min(1, u.moving + dt * 4);
          if (dist > 1.5) u.yaw = lerpAngle(u.yaw, Math.atan2(-dz, dx), Math.min(1, dt * 6));
        } else {
          u.moving = Math.max(0, u.moving - dt * 3);
          u.yaw = lerpAngle(u.yaw, dir > 0 ? 0 : Math.PI, Math.min(1, dt * 3));
        }
        if (dist < 0.5) u.spawn = 0;
        if (!tank) {
          bob = Math.abs(Math.sin((t + u.seed * 10) * 10)) * 0.07 * u.moving;
          lean = 0.12 * u.moving; // lean forward when marching
          if (u.moving < 0.1 && u.frontRow !== undefined) bob += Math.max(0, Math.sin(t * 2.6 + u.seed * 40)) * 0.03;
        } else {
          bob = Math.sin(t * 30 + u.seed * 10) * 0.02 * u.moving;
          if (u.moving > 0.5 && Math.random() < dt * 5) this.onDust?.(u.x - Math.cos(u.yaw) * 1.3, groundHeight(u.x, u.z), u.z + Math.sin(u.yaw) * 1.3);
          lean = -u.fire * 0.06; // recoil rocks the hull
        }
        if (u.phase === 'knocked') {
          const k = u.pt;
          if (k < 0.3) tilt = (k / 0.3) * 1.45;
          else if (k < 1.6) tilt = 1.45;
          else if (k < 2.1) tilt = 1.45 * (1 - (k - 1.6) / 0.5);
          else u.phase = 'alive';
        }
      } else if (u.phase === 'dying') {
        const k = u.pt;
        tilt = Math.min(1, k / 0.3) ** 2 * 1.55;
        sink = Math.max(0, k - 1.2) * 0.7;
        if (k > 2.0) toFree.push(u);
      } else if (u.phase === 'retreating') {
        scale *= Math.max(0, 1 - u.pt / 0.7);
        if (u.pt > 0.7) toFree.push(u);
      }

      const y = groundHeight(u.x, u.z) + bob - sink;
      // tilt > 0 topples backwards, lean > 0 pitches forwards
      this.e.set(0, u.yaw, (tank ? 0.15 * tilt : tilt) - lean, 'YXZ');
      this.q.setFromEuler(this.e);
      this.v.set(u.x, y, u.z);
      this.s.setScalar(scale);
      this.m.compose(this.v, this.q, this.s);
      (tank ? this.tanks : this.soldiers).setMatrixAt(u.slot, this.m);
      const a = tank ? animT : animS;
      const o = u.slot * 4;
      a[o] = u.seed;
      a[o + 1] = u.phase === 'alive' ? u.moving : 0;
      a[o + 2] = u.fire;
      a[o + 3] = u.flash;
    }
    for (const u of toFree) {
      (u.kind === 'tank' ? this.tanks : this.soldiers).setMatrixAt(u.slot, this.zero);
      (u.kind === 'tank' ? this.freeT : this.freeS).push(u.slot);
      this.units.delete(u.key);
      this.list = null;
    }
    this.soldiers.instanceMatrix.needsUpdate = true;
    this.tanks.instanceMatrix.needsUpdate = true;
    this.animS.needsUpdate = true;
    this.animT.needsUpdate = true;
  }

  clear() {
    for (const u of this.units.values()) {
      (u.kind === 'tank' ? this.tanks : this.soldiers).setMatrixAt(u.slot, this.zero);
      (u.kind === 'tank' ? this.freeT : this.freeS).push(u.slot);
    }
    this.units.clear();
    this.list = null;
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
