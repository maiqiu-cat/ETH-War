import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Team } from '../game/battle';
import { BASE_CENTER } from './bases';

export interface DirectorContext {
  frontX: number;
  /** Price momentum: + bulls pushing, - bears pushing. */
  momentum: number;
  progress: number;
}

type ShotName = 'overview' | 'frontline' | 'charge' | 'base' | 'event' | 'orbit';

interface Shot {
  name: ShotName;
  dur: number;
  /** Camera position and look target as functions of shot time (0..1) and context. */
  pose(k: number, c: DirectorContext, out: { pos: THREE.Vector3; look: THREE.Vector3 }): void;
}

/**
 * Manual control (OrbitControls + WASD) plus a "cinematic" director that cuts
 * between scripted shots and reacts to big market events.
 */
export class CameraRig {
  readonly controls: OrbitControls;
  cinematic = true;
  shotName: ShotName = 'overview';
  private keys = new Set<string>();
  private shot: Shot;
  private shotT = 0;
  private shotIdx = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tmp = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private eventFocus: { p: THREE.Vector3; until: number } | null = null;
  private time = 0;
  private seedZ = 0;
  private shakeAmt = 0;
  private shakeOffset = new THREE.Vector3();
  onModeChange?: (cinematic: boolean) => void;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.38;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 340;
    this.controls.screenSpacePanning = false;
    this.controls.enabled = false;
    camera.position.set(-40, 120, 150);
    this.pos.copy(camera.position);
    this.look.set(0, 0, 0);
    this.shot = this.makeShot('overview');

    const exit = () => this.setCinematic(false);
    dom.addEventListener('pointerdown', exit);
    dom.addEventListener('wheel', exit, { passive: true });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'c') return this.setCinematic(!this.cinematic);
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) {
        this.keys.add(k);
        if (this.cinematic) exit();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setCinematic(on: boolean) {
    if (on === this.cinematic) return;
    this.cinematic = on;
    this.controls.enabled = !on;
    if (!on) {
      this.controls.target.copy(this.look);
      this.controls.update();
    } else {
      this.pos.copy(this.camera.position);
      this.look.copy(this.controls.target);
      this.shotT = 0;
    }
    this.onModeChange?.(on);
  }

  /** Point the camera at a big event for a few seconds (cinematic mode only). */
  focusEvent(p: THREE.Vector3, importance: number) {
    if (!this.cinematic) return;
    if (this.eventFocus && this.time < this.eventFocus.until && importance < 2) return;
    this.eventFocus = { p: p.clone(), until: this.time + 4.5 };
    this.shot = this.makeShot('event');
    this.shotT = 0;
  }

  focusFront(frontX: number) {
    this.setCinematic(false);
    this.controls.target.set(frontX, 0, 0);
    this.camera.position.set(frontX - 45, 55, 70);
    this.controls.update();
  }

  /** Camera shake from nearby explosions (decays quickly). */
  shake(amount: number) {
    this.shakeAmt = Math.min(2.2, this.shakeAmt + amount);
  }

  update(dt: number, c: DirectorContext) {
    this.time += dt;
    // remove last frame's shake so it never accumulates into the controls
    this.camera.position.sub(this.shakeOffset);
    if (!this.cinematic) {
      this.keyboardPan(dt);
      this.controls.update();
      this.look.copy(this.controls.target);
    } else {
      this.shotT += dt / this.shot.dur;
      if (this.shotT >= 1) this.nextShot();
      const k = Math.min(1, this.shotT);
      this.shot.pose(k * k * (3 - 2 * k), c, this.tmp);
      const a = 1 - Math.exp(-dt * (this.shotT < 0.15 ? 1.4 : 2.6));
      this.pos.lerp(this.tmp.pos, a);
      this.look.lerp(this.tmp.look, a);
      this.camera.position.copy(this.pos);
      // subtle hand-held drift
      const t = this.time;
      this.camera.lookAt(
        this.look.x + Math.sin(t * 0.63) * 0.35 + Math.sin(t * 1.7) * 0.08,
        this.look.y + Math.sin(t * 0.91) * 0.22,
        this.look.z + Math.cos(t * 0.47) * 0.3,
      );
    }
    this.shakeAmt *= Math.exp(-dt * 5);
    const s = this.shakeAmt;
    this.shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.6, (Math.random() - 0.5) * s);
    this.camera.position.add(this.shakeOffset);
  }

  private nextShot() {
    const order: ShotName[] = ['overview', 'frontline', 'charge', 'orbit', 'frontline', 'base'];
    this.shotIdx = (this.shotIdx + 1) % order.length;
    this.seedZ = (Math.random() - 0.5) * 50;
    this.shot = this.makeShot(order[this.shotIdx]);
    this.shotT = 0;
  }

  private makeShot(name: ShotName): Shot {
    this.shotName = name;
    switch (name) {
      case 'overview':
        return {
          name,
          dur: 10,
          pose: (k, c, o) => {
            const ang = -0.9 + k * 0.35;
            o.look.set(c.frontX * 0.6, 0, 0);
            o.pos.set(o.look.x + Math.sin(ang) * 150, 105 - k * 10, Math.cos(ang) * 150);
          },
        };
      case 'frontline':
        return {
          name,
          dur: 9,
          pose: (k, c, o) => {
            const z = -45 + k * 75 + this.seedZ * 0.2;
            o.pos.set(c.frontX - 16, 7.5, z);
            o.look.set(c.frontX + 4, 0.5, z + 14);
          },
        };
      case 'charge':
        return {
          name,
          dur: 8,
          pose: (k, c, o) => {
            const dir = c.momentum >= 0 ? 1 : -1;
            const z = this.seedZ;
            o.pos.set(c.frontX - dir * (42 - k * 14), 20 - k * 6, z - 10);
            o.look.set(c.frontX + dir * 12, 0, z + 2);
          },
        };
      case 'orbit':
        return {
          name,
          dur: 12,
          pose: (k, c, o) => {
            const ang = 0.4 + k * 1.3;
            o.look.set(c.frontX, 0, 0);
            o.pos.set(c.frontX + Math.sin(ang) * 60, 34, Math.cos(ang) * 60);
          },
        };
      case 'base': {
        return {
          name,
          dur: 8,
          pose: (k, c, o) => {
            // Watch the base that is under threat.
            const team: Team = c.progress >= 0.5 ? 'bears' : 'bulls';
            const b = BASE_CENTER[team];
            const side = team === 'bears' ? -1 : 1;
            o.look.set(b.x + side * 6, 1, b.z);
            o.pos.set(b.x + side * (40 - k * 12), 22 - k * 5, b.z + 34 - k * 8);
          },
        };
      }
      case 'event':
        return {
          name,
          dur: 4.5,
          pose: (k, _c, o) => {
            const p = this.eventFocus?.p ?? new THREE.Vector3();
            o.look.copy(p);
            o.pos.set(p.x - 18 + k * 4, 13 - k * 2, p.z + 24 - k * 4);
          },
        };
    }
  }

  private keyboardPan(dt: number) {
    if (!this.keys.size) return;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const move = new THREE.Vector3();
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) move.add(fwd);
    if (k.has('s') || k.has('arrowdown')) move.sub(fwd);
    if (k.has('d') || k.has('arrowright')) move.add(right);
    if (k.has('a') || k.has('arrowleft')) move.sub(right);
    const dist = this.camera.position.distanceTo(this.controls.target);
    move.multiplyScalar(dt * Math.max(20, dist * 0.9));
    this.camera.position.add(move);
    this.controls.target.add(move);
    if (k.has('q') || k.has('e')) {
      const ang = (k.has('q') ? 1 : -1) * dt * 0.9;
      const off = this.camera.position.clone().sub(this.controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      this.camera.position.copy(this.controls.target).add(off);
    }
  }
}
