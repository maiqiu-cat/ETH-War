import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { FeedItem } from '../data/market';
import type { LayoutResult } from '../game/armies';
import type { Round, Team } from '../game/battle';
import { FIELD_DEPTH, frontWave, type FieldMap } from '../game/field';
import type { AudioEngine } from '../audio/engine';
import { fmtPrice, fmtUsd } from '../ui/format';
import { t } from '../ui/i18n';
import { BASE_CENTER, Bases, TEAM_COLORS } from './bases';
import { CameraRig } from './camera';
import { Effects } from './effects';
import { Lighting, PRESETS, type LightingName } from './lighting';
import { PostFX } from './post';
import { groundHeight, ROAD_Z, Terrain } from './terrain';
import { ArmyRenderer } from './units';

export interface WorldOptions {
  shadows: boolean;
  pixelRatio: number;
  post: boolean;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly labels: CSS2DRenderer;
  readonly terrain = new Terrain();
  readonly bases = new Bases();
  readonly army = new ArmyRenderer();
  readonly effects = new Effects();
  readonly lighting: Lighting;
  readonly rig: CameraRig;
  readonly post: PostFX | null;
  field: FieldMap | null = null;
  round: Round | null = null;
  frontPrice = 0;
  targetPrice = 0;
  momentum = 0;
  onModeChange?: (cinematic: boolean) => void;
  /** Optional battle audio; every visual event below also triggers its sound. */
  audio: AudioEngine | null = null;
  private amp = 2;
  private time = 0;
  private hazeT = 0;
  private flash = { color: new THREE.Color(), k: 0 };
  private frontLabel: CSS2DObject;
  private reserveLabels: Record<Team, CSS2DObject>;
  /** Screen rectangles the reserve labels must not sit under (the HUD panels). */
  labelObstacles?: () => DOMRect[];
  private activity = { buyPerSec: 0, sellPerSec: 0 };
  private celebrations: { at: number; team: Team }[] = [];
  private teamGlow: Record<Team, THREE.Color> = {
    bulls: new THREE.Color(TEAM_COLORS.bulls.glow),
    bears: new THREE.Color(TEAM_COLORS.bears.glow),
  };
  readonly frontFn = (z: number) => this.frontX(z);

  constructor(private readonly container: HTMLElement, opts: WorldOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !opts.post, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(opts.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = opts.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels-layer';
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
    this.rig = new CameraRig(this.camera, this.labels.domElement);
    this.lighting = new Lighting(this.scene, this.renderer, opts.shadows);
    this.scene.add(this.terrain.group, this.bases.group, this.army.group, this.effects.group);
    this.post = opts.post ? new PostFX(this.renderer, this.scene, this.camera) : null;
    this.post?.setCinematic(this.rig.cinematic);
    this.rig.onModeChange = (on) => {
      this.post?.setCinematic(on);
      this.onModeChange?.(on);
    };

    this.frontLabel = this.makeLabel('front-label', '');
    this.reserveLabels = {
      bulls: this.makeLabel('reserve-label bulls', ''),
      bears: this.makeLabel('reserve-label bears', ''),
    };

    this.army.onKilled = (x, y, z) => {
      if (Math.random() < 0.35) this.effects.dust(tmp.set(x, y + 0.2, z), 0.5);
    };
    this.army.onDust = (x, y, z) => this.effects.dust(tmp.set(x, y + 0.15, z), 0.45);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private makeLabel(cls: string, text: string) {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    const obj = new CSS2DObject(div);
    this.scene.add(obj);
    return obj;
  }

  setLighting(name: LightingName) {
    const p = this.lighting.apply(name);
    this.terrain.uniforms.uLineGlow.value = p.lineGlow;
    this.terrain.uniforms.uCloud.value = p.cloudShadow;
    this.effects.smokeTint.set(p.smoke);
    this.bases.setNight(name === 'night');
    this.post?.setGrade({ bloom: p.bloom, threshold: p.bloomThreshold, warm: p.warm, vignette: p.vignette });
    document.documentElement.dataset.lighting = name;
    return PRESETS[name];
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.effects.setViewportHeight(h * this.renderer.getPixelRatio());
  }

  setRound(field: FieldMap, round: Round, price: number) {
    this.field = field;
    this.round = round;
    this.frontPrice = this.targetPrice = price;
    this.terrain.setField(field);
    this.bases.reset();
    this.audio?.horn();
  }

  /** Normalized screen x (-1..1) and camera distance of a world point, for stereo placement. */
  private ear(p: THREE.Vector3) {
    const d = this.camera.position.distanceTo(p);
    const v = tmp2.copy(p).project(this.camera);
    const x = v.z > 1 ? Math.sign(v.x || 1) : v.x; // behind the camera: hard side
    return { x, d };
  }

  setPrice(price: number) {
    if (this.targetPrice && price !== this.targetPrice) {
      // flash the front line in the colour of whoever just gained ground
      const team: Team = price > this.targetPrice ? 'bulls' : 'bears';
      const strength = Math.min(1, Math.abs(price / this.targetPrice - 1) / 0.0001);
      this.flash.color.copy(this.teamGlow[team]);
      this.flash.k = Math.max(this.flash.k, 0.35 + strength * 1.2);
    }
    this.targetPrice = price;
  }

  setActivity(buyPerSec: number, sellPerSec: number) {
    this.activity = { buyPerSec, sellPerSec };
    const total = buyPerSec + sellPerSec;
    const imb = total > 0 ? Math.abs(buyPerSec - sellPerSec) / total : 0;
    this.amp = 1.4 + imb * 2.6;
  }

  setLayout(layout: LayoutResult) {
    if (!this.field) return;
    this.army.setTargets(layout.units, this.frontFn);
    for (const team of ['bulls', 'bears'] as const) {
      const s = layout[team];
      const dir = team === 'bulls' ? 1 : -1;
      const baseX = team === 'bulls' ? this.field.bullBaseX : this.field.bearBaseX;
      const el = this.reserveLabels[team].element;
      el.innerHTML =
        `<b>${t(`reserve.${team}`)}</b><span>≈${fmtUsd(s.reserveUsd)}</span>` +
        `<small>${t('reserve.units', { n: s.reserveSoldiers.toLocaleString(), k: s.reserveTanks })}</small>`;
      this.reserveLabels[team].position.set(baseX - dir * 7, groundHeight(baseX, -20) + 6, -20);
    }
  }

  /** Front price clamped to the board (after a win the price can run past the base). */
  get visualPrice() {
    if (!this.field) return this.frontPrice;
    return Math.min(this.field.maxPrice, Math.max(this.field.minPrice, this.frontPrice));
  }

  frontX(z: number) {
    if (!this.field) return 0;
    return this.field.x(this.visualPrice) + frontWave(z, this.time, this.amp);
  }

  private shakeNear(p: THREE.Vector3, size: number) {
    const d = this.camera.position.distanceTo(p);
    if (d < 110) this.rig.shake(size * 0.32 * (1 - d / 110));
  }

  /** Visualise a market event on the battlefield. */
  onMarketEvent(e: FeedItem) {
    if (!this.field) return;
    const attacker: Team = e.bull ? 'bulls' : 'bears';
    const defender: Team = e.bull ? 'bears' : 'bulls';
    const dir = attacker === 'bulls' ? 1 : -1;
    const color = this.teamGlow[attacker];

    if (e.kind === 'option') {
      const z = (Math.random() - 0.5) * FIELD_DEPTH * 0.8;
      const x = this.frontX(z) - dir * (8 + Math.random() * 20);
      const p = new THREE.Vector3(x, groundHeight(x, z) + 0.5, z);
      this.effects.flare(p, color);
      if (this.audio) {
        const e2 = this.ear(p);
        this.audio.flare(e2.x, e2.d);
      }
      return;
    }

    const big = e.kind === 'liq' ? (Math.log10(e.usd) - 3.8) * 1.0 : (Math.log10(e.usd) - 4.4) * 1.1;
    const size = THREE.MathUtils.clamp(big, 0.5, 3.6);
    let from: THREE.Vector3;
    let z: number;
    if (e.kind === 'liq') {
      // Liquidations: heavy artillery from far behind the attacking lines.
      z = (Math.random() - 0.5) * FIELD_DEPTH * 0.75;
      const fx = this.frontX(z) - dir * (30 + Math.random() * 15);
      from = new THREE.Vector3(fx, groundHeight(fx, z) + 2, z + (Math.random() - 0.5) * 10);
    } else {
      const shooter = this.army.pickShooter(attacker, this.frontFn, e.usd >= 100_000);
      if (shooter) {
        this.army.fire(shooter);
        from = this.army.muzzle(shooter, new THREE.Vector3());
        z = shooter.z + (Math.random() - 0.5) * 14;
      } else {
        z = (Math.random() - 0.5) * FIELD_DEPTH * 0.7;
        const fx = this.frontX(z) - dir * 10;
        from = new THREE.Vector3(fx, groundHeight(fx, z) + 1, z);
      }
    }
    z = THREE.MathUtils.clamp(z, -FIELD_DEPTH / 2 + 3, FIELD_DEPTH / 2 - 3);
    const tx = this.frontX(z) + dir * (1.5 + Math.random() * (e.kind === 'liq' ? 10 : 5) + size);
    const to = new THREE.Vector3(tx, groundHeight(tx, z) + 0.3, z);
    if (this.audio) {
      const src = this.ear(from);
      if (e.kind === 'liq') this.audio.whistle(src.x, src.d, 0.5 + from.distanceTo(to) / 45);
      else this.audio.cannon(src.x, src.d, size);
    }
    this.effects.shell(from, to, size, color, () => {
      this.army.hit(defender, to.x, to.z, 2 + size * 1.6, Math.round(4 + size * 5));
      this.floatLabel(to, e);
      this.shakeNear(to, size);
      if (this.audio) {
        const hit = this.ear(to);
        this.audio.explosion(hit.x, hit.d, e.kind === 'liq' ? size * 1.25 : size);
      }
    });
    if ((e.kind === 'liq' && e.usd >= 125_000) || e.usd >= 300_000) this.rig.focusEvent(to, e.usd >= 1_000_000 ? 2 : 1);
  }

  private floatLabel(p: THREE.Vector3, e: FeedItem) {
    // Skip labels the screen edge would cut in half (frequent on an upright phone).
    const v = tmp2.set(p.x, p.y + 3, p.z).project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1 - 72 / Math.max(1, this.container.clientWidth)) return;
    const div = document.createElement('div');
    div.className = `event-label ${e.bull ? 'bull' : 'bear'} ${e.kind}`;
    div.innerHTML = `<span>${e.kind === 'liq' ? t(`feed.${e.type}`) : t(e.bull ? 'ev.buy' : 'ev.sell')}</span><b>${fmtUsd(e.usd)}</b>`;
    const obj = new CSS2DObject(div);
    obj.position.set(p.x, p.y + 3, p.z);
    this.scene.add(obj);
    setTimeout(() => {
      this.scene.remove(obj);
      div.remove();
    }, 2600);
  }

  celebrate(winner: Team) {
    const loser: Team = winner === 'bulls' ? 'bears' : 'bulls';
    this.bases.capture(loser, winner);
    this.audio?.fanfare(winner);
    for (let i = 0; i < 12; i++) this.celebrations.push({ at: this.time + 0.3 + i * 0.38, team: winner });
  }

  /** Rifle fire along the front, scaled by taker flow: muzzle flash + tracer + recoil. */
  private rifleFire(dt: number) {
    for (const team of ['bulls', 'bears'] as const) {
      const flow = team === 'bulls' ? this.activity.buyPerSec : this.activity.sellPerSec;
      const rate = Math.min(26, 3 + Math.log10(1 + flow) * 3.5);
      let shots = rate * dt;
      while (shots > 0) {
        if (Math.random() >= Math.min(1, shots)) break;
        shots -= 1;
        const s = this.army.randomFrontSoldier(team);
        if (!s) break;
        const dir = team === 'bulls' ? 1 : -1;
        this.army.fire(s);
        const from = this.army.muzzle(s, tmp);
        const z = s.z + (Math.random() - 0.5) * 5;
        const tx = this.frontX(z) + dir * (0.8 + Math.random() * 3);
        const to = tmp2.set(tx, groundHeight(tx, z) + 0.5 + Math.random() * 0.5, z);
        this.effects.muzzle(from, new THREE.Vector3(dir, 0, 0));
        this.effects.tracer(from, to, this.teamGlow[team]);
        if (this.audio) {
          const e2 = this.ear(from);
          this.audio.rifle(team, e2.x, e2.d);
        }
        if (Math.random() < 0.035) this.army.hit(team === 'bulls' ? 'bears' : 'bulls', tx, z, 0.9, 1);
      }
    }
  }

  frame(dt: number) {
    this.time += dt;
    // Smooth the front so it glides between ticks.
    const prev = this.frontPrice;
    this.frontPrice += (this.targetPrice - this.frontPrice) * (1 - Math.exp(-dt * 4));
    this.momentum = this.momentum * 0.98 + (this.frontPrice - prev) * 2;
    const u = this.terrain.uniforms;
    u.uTime.value = this.time;
    u.uAmp.value += (this.amp - u.uAmp.value) * (1 - Math.exp(-dt));
    u.uFront.value = this.field ? this.field.x(this.visualPrice) : 0;
    this.flash.k *= Math.exp(-dt * 2.2);
    u.uFlash.value.copy(this.flash.color).multiplyScalar(this.flash.k * 2.5);

    if (this.field) {
      this.rifleFire(dt);
      // drifting smoke over the front
      this.hazeT += dt;
      while (this.hazeT > 0.16) {
        this.hazeT -= 0.16;
        const z = (Math.random() - 0.5) * FIELD_DEPTH * 0.95;
        const x = this.frontX(z) + (Math.random() - 0.5) * 7;
        this.effects.haze(tmp.set(x, groundHeight(x, z) + 0.4, z));
      }
    }

    while (this.celebrations.length && this.celebrations[0].at <= this.time) {
      const c = this.celebrations.shift()!;
      const loser = c.team === 'bulls' ? 'bears' : 'bulls';
      const b = BASE_CENTER[loser];
      const p = new THREE.Vector3(b.x + (Math.random() - 0.5) * 22, groundHeight(b.x, b.z) + 1 + Math.random() * 7, b.z + (Math.random() - 0.5) * 22);
      const size = 1.4 + Math.random() * 1.6;
      this.effects.explosion(p, size, this.teamGlow[c.team]);
      this.shakeNear(p, size * 0.6);
      if (this.audio) {
        const e2 = this.ear(p);
        this.audio.explosion(e2.x, e2.d, size);
      }
      // fireworks above the captured base
      this.effects.flare(tmp.set(p.x, p.y + 2, p.z), this.teamGlow[c.team]);
    }

    this.army.update(dt, this.time, this.frontFn);
    this.effects.update(dt);
    this.bases.update(this.time, dt);

    const fx = this.frontX(ROAD_Z);
    this.frontLabel.position.set(fx, groundHeight(fx, ROAD_Z) + 3.2, ROAD_Z);
    this.frontLabel.element.textContent = this.targetPrice ? fmtPrice(this.targetPrice) : '';

    this.rig.update(dt, {
      frontX: this.field ? this.field.x(this.visualPrice) : 0,
      momentum: this.momentum,
      progress: this.round ? (this.frontPrice - this.round.bearsWinAt) / (this.round.bullsWinAt - this.round.bearsWinAt) : 0.5,
    });

    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    this.fitReserveLabels();
  }

  /**
   * Fade out reserve labels the screen edge would cut (an upright phone only sees the middle of the
   * field) or that would sit under a HUD panel and show through it.
   */
  private fitReserveLabels() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const panels = this.labelObstacles?.() ?? [];
    for (const obj of Object.values(this.reserveLabels)) {
      const el = obj.element;
      const v = tmp2.copy(obj.position).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (0.5 - v.y * 0.5) * h;
      const [l, r, t, b] = [x - el.offsetWidth / 2, x + el.offsetWidth / 2, y - el.offsetHeight / 2, y + el.offsetHeight / 2];
      const covered = panels.some((p) => l < p.right && r > p.left && t < p.bottom && b > p.top);
      el.classList.toggle('cut', v.z > 1 || l < 4 || r > w - 4 || t < 4 || b > h - 4 || covered);
    }
  }
}
