import * as THREE from 'three';
import { hash01 } from '../game/armies';
import type { Team } from '../game/battle';
import { FIELD_DEPTH } from '../game/field';
import { BEAR_BASE_X, BULL_BASE_X, groundHeight, mergeSimple } from './terrain';

export const TEAM_COLORS: Record<Team, { main: string; dark: string; glow: string }> = {
  bulls: { main: '#3fd46b', dark: '#1f7a3a', glow: '#5cff8a' },
  bears: { main: '#ff4d4d', dark: '#9e2424', glow: '#ff6b5c' },
};

export const BASE_CENTER: Record<Team, THREE.Vector3> = {
  bulls: new THREE.Vector3(BULL_BASE_X - 14, 0, -10),
  bears: new THREE.Vector3(BEAR_BASE_X + 14, 0, -10),
};

function colored(geo: THREE.BufferGeometry, c: string) {
  const col = new THREE.Color(c);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function houseGeometry(roof: string) {
  const walls = colored(new THREE.BoxGeometry(2.2, 1.4, 1.8).translate(0, 0.7, 0), '#e9e0cf');
  const r = new THREE.CylinderGeometry(0.01, 1.45, 1.0, 4, 1).rotateY(Math.PI / 4).scale(1.1, 1, 0.9).translate(0, 1.9, 0);
  const door = colored(new THREE.BoxGeometry(0.4, 0.7, 0.05).translate(0, 0.35, 0.92), '#5a4030');
  return mergeSimple([walls, colored(r, roof), door]);
}

export class Bases {
  readonly group = new THREE.Group();
  private flags: {
    team: Team;
    mesh: THREE.Mesh;
    geo: THREE.PlaneGeometry;
    base: Float32Array;
    topY: number;
    owner: Team;
    anim: { t: number; to: Team } | null;
  }[] = [];
  readonly lights: THREE.PointLight[] = [];
  readonly winLines: Record<Team, THREE.Mesh> = {} as never;

  constructor() {
    for (const team of ['bulls', 'bears'] as const) this.group.add(this.buildBase(team));
  }

  private buildBase(team: Team) {
    const g = new THREE.Group();
    const c = BASE_CENTER[team];
    const colors = TEAM_COLORS[team];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });

    // Village: a grid of houses with a little jitter.
    const houses = new THREE.InstancedMesh(houseGeometry(colors.dark), mat, 26);
    const m = new THREE.Matrix4();
    let n = 0;
    const seed = team === 'bulls' ? 1 : 2;
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 5; j++) {
        if (n >= 26) break;
        if (hash01(i, j, seed) < 0.18) continue;
        const x = c.x + (i - 2.5) * 3.6 + (hash01(i, j, seed + 10) - 0.5) * 0.8;
        const z = c.z + (j - 2) * 4.2 + (hash01(i, j, seed + 20) - 0.5) * 0.8;
        if (Math.abs(x - c.x) < 3 && Math.abs(z - c.z) < 3) continue; // plaza for the HQ
        const s = 0.85 + hash01(i, j, seed + 30) * 0.4;
        m.compose(
          new THREE.Vector3(x, groundHeight(x, z), z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(hash01(i, j, seed + 40) * 3) * (Math.PI / 2)),
          new THREE.Vector3(s, s, s),
        );
        houses.setMatrixAt(n++, m);
      }
    houses.count = n;
    houses.castShadow = houses.receiveShadow = true;
    g.add(houses);

    // HQ + flag
    const hq = new THREE.Mesh(
      mergeSimple([
        colored(new THREE.BoxGeometry(4.2, 2.4, 3.6).translate(0, 1.2, 0), '#ddd3bf'),
        colored(new THREE.BoxGeometry(4.6, 0.4, 4.0).translate(0, 2.6, 0), colors.dark),
        colored(new THREE.BoxGeometry(1.4, 1.2, 1.4).translate(0, 3.4, 0), '#ddd3bf'),
      ]),
      mat,
    );
    hq.position.set(c.x, groundHeight(c.x, c.z), c.z);
    hq.castShadow = hq.receiveShadow = true;
    g.add(hq);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.5, 6), new THREE.MeshStandardMaterial({ color: '#d8d8d8', metalness: 0.6, roughness: 0.4 }));
    pole.position.set(c.x + 1.5, groundHeight(c.x, c.z) + 3.25 + 1.8, c.z + 1.5);
    pole.castShadow = true;
    g.add(pole);
    const flagGeo = new THREE.PlaneGeometry(2.4, 1.4, 12, 4);
    flagGeo.translate(1.2, 0, 0);
    const flag = new THREE.Mesh(
      flagGeo,
      new THREE.MeshStandardMaterial({ color: colors.main, emissive: colors.main, emissiveIntensity: 0.25, side: THREE.DoubleSide, roughness: 0.7 }),
    );
    flag.position.set(pole.position.x, pole.position.y + 2.5, pole.position.z);
    flag.castShadow = true;
    g.add(flag);
    this.flags.push({
      team,
      mesh: flag,
      geo: flagGeo,
      base: Float32Array.from(flagGeo.attributes.position.array),
      topY: flag.position.y,
      owner: team,
      anim: null,
    });

    // Perimeter fence
    const fenceMat = new THREE.MeshStandardMaterial({ color: '#8a7358', roughness: 1 });
    const hw = 13;
    const hd = 13;
    const fence = (x: number, z: number, w: number, d: number) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), fenceMat);
      f.position.set(x, groundHeight(x, z) + 0.35, z);
      f.castShadow = f.receiveShadow = true;
      g.add(f);
    };
    fence(c.x, c.z - hd, hw * 2, 0.25);
    fence(c.x, c.z + hd, hw * 2, 0.25);
    const outer = team === 'bulls' ? -1 : 1;
    fence(c.x + outer * hw, c.z, 0.25, hd * 2);
    // gate side facing the battlefield has two segments
    fence(c.x - outer * hw, c.z - hd * 0.6, 0.25, hd * 0.8);
    fence(c.x - outer * hw, c.z + hd * 0.6, 0.25, hd * 0.8);

    // Win line: dashed glowing strip across the field at the capture price.
    const lineX = team === 'bulls' ? BULL_BASE_X : BEAR_BASE_X;
    const dashes: THREE.BufferGeometry[] = [];
    for (let z = -FIELD_DEPTH / 2; z < FIELD_DEPTH / 2; z += 3) {
      const geo = new THREE.BoxGeometry(0.35, 0.08, 1.8).translate(lineX, groundHeight(lineX, z + 0.9) + 0.08, z + 0.9);
      dashes.push(geo);
    }
    const line = new THREE.Mesh(
      mergeSimple(dashes),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.glow).multiplyScalar(2.2), transparent: true, opacity: 0.75 }),
    );
    this.winLines[team] = line;
    g.add(line);

    const light = new THREE.PointLight(colors.glow, 0, 40, 1.6);
    light.position.set(c.x, 6, c.z);
    this.lights.push(light);
    g.add(light);
    return g;
  }

  /** The loser's flag is lowered and raised again in the winner's colours. */
  capture(loser: Team, winner: Team) {
    const f = this.flags.find((x) => x.team === loser);
    if (f && f.owner !== winner) f.anim = { t: 0, to: winner };
  }

  /** New round: every base flies its own flag again. */
  reset() {
    for (const f of this.flags) if (f.owner !== f.team) f.anim = { t: 0, to: f.team };
  }

  update(t: number, dt = 0.016) {
    for (const f of this.flags) {
      if (f.anim) {
        f.anim.t += dt;
        const k = f.anim.t;
        const lowered = f.topY - 5.2;
        if (k < 1.1) f.mesh.position.y = f.topY + (lowered - f.topY) * easeInOut(k / 1.1);
        else {
          if (f.owner !== f.anim.to) {
            f.owner = f.anim.to;
            const c = TEAM_COLORS[f.owner].main;
            const m = f.mesh.material as THREE.MeshStandardMaterial;
            m.color.set(c);
            m.emissive.set(c);
          }
          const r = Math.min(1, (k - 1.1) / 1.6);
          f.mesh.position.y = lowered + (f.topY - lowered) * easeInOut(r);
          if (r >= 1) f.anim = null;
        }
      }
      const pos = f.geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = f.base[i * 3];
        const y = f.base[i * 3 + 1];
        pos.setZ(i, Math.sin(x * 2.2 - t * 5 + y) * 0.18 * (x / 2.4));
      }
      pos.needsUpdate = true;
      f.geo.computeVertexNormals();
    }
    const pulse = 0.55 + 0.25 * Math.sin(t * 2.5);
    for (const team of ['bulls', 'bears'] as const) (this.winLines[team].material as THREE.MeshBasicMaterial).opacity = pulse;
  }

  setNight(night: boolean) {
    for (const l of this.lights) l.intensity = night ? 60 : 0;
  }
}

function easeInOut(x: number) {
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}
