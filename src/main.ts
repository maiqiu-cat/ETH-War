import '@fontsource-variable/inter';
import './ui/styles.css';
import { AudioEngine, renderPreview } from './audio/engine';
import { netState } from './data/connectivity';
import { ALL_SOURCES, createFeeds } from './data/feeds/exchanges';
import { MarketHub, type FeedItem } from './data/market';
import { SimFeed } from './data/sim';
import type { ExchangeId } from './data/types';
import { DEFAULT_LAYOUT, layoutArmies, niceUsd } from './game/armies';
import { BattleEngine, narrate } from './game/battle';
import { FieldMap } from './game/field';
import { autoLighting, type LightingName } from './render/lighting';
import { World } from './render/world';
import { fmtPrice } from './ui/format';
import { Hud } from './ui/hud';

/* ----------------------------------------------------------------- Options */
const params = new URLSearchParams(location.search);
const simMode = params.has('sim');
const quality = params.get('q') ?? 'high';
const halfRange = Number(params.get('range') ?? 0.25) / 100;
const sources = (params.get('sources')?.split(',') as ExchangeId[] | undefined) ?? ALL_SOURCES;

/* -------------------------------------------------------------------- Data */
// `big=N` fixes the large-trade threshold; by default (`auto`) it follows the market: ETH's
// spot flow is thin in quiet hours, so it comes down to $2K to keep about 10 events a minute.
const bigParam = params.get('big');
const hub = new MarketHub(
  bigParam && bigParam !== 'auto'
    ? { bigTradeUsd: Number(bigParam) }
    : { bigTradeUsd: 10_000, adaptiveBig: { minUsd: 2_000, perMin: 10, windowMs: 5 * 60_000 } },
);
const feeds: { start(): void; stop(): void }[] = simMode
  ? [new SimFeed(hub, Number(params.get('seed') ?? 7), 2_720, Number(params.get('speed') ?? 1))]
  : createFeeds(hub, sources);
feeds.forEach((f) => f.start());

/* ------------------------------------------------------------------- World */
const world = new World(document.getElementById('app')!, {
  shadows: quality !== 'low',
  pixelRatio: Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 2),
  post: quality !== 'low' && params.get('post') !== '0',
});
const battle = new BattleEngine({ halfRange });

/* ------------------------------------------------------------------- Audio */
// Browsers only start audio after a user gesture; the first click/key/touch unlocks it.
const audio = new AudioEngine();
world.audio = audio;
// Default on: start loading and try to play right away; browsers that block autoplay
// will start on the first click / key / touch anywhere.
audio.boot();
for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, (e) => {
  // Let the speaker button handle its own first gesture. Unlocking on pointerdown and then
  // toggling on click would immediately turn the newly started sound back off.
  if (e.target instanceof Element && e.target.closest('[data-k="sound"]')) return;
  audio.unlock();
}, { passive: true });

let lightingChoice: LightingName | 'auto' = (params.get('light') as LightingName) ?? 'auto';
const applyLighting = () => world.setLighting(lightingChoice === 'auto' ? autoLighting() : lightingChoice);
applyLighting();
setInterval(() => lightingChoice === 'auto' && applyLighting(), 60_000);

let depthSource: ExchangeId | 'all' = 'all';
const hud = new Hud(document.getElementById('hud')!, simMode ? 'sim' : 'live', {
  onLighting: (name) => {
    lightingChoice = name;
    applyLighting();
  },
  onCinematic: () => world.rig.setCinematic(!world.rig.cinematic),
  onSource: (src) => (depthSource = src),
  onFocus: () => world.field && world.rig.focusFront(world.field.x(world.frontPrice)),
  onSound: () => audio.state === 'locked' ? audio.unlock() : audio.toggle(),
});
audio.onState = (s) => hud.setSound(s);
world.labelObstacles = () => hud.obstacles();
hud.setSound(audio.state);
hud.setLightingValue(lightingChoice);
hud.setCinematic(world.rig.cinematic);
world.onModeChange = (on) => hud.setCinematic(on);
// Live mode: ask the visitor to check their network when the browser is offline or no exchange sends trades.
if (!simMode) {
  const startedAt = Date.now();
  const checkNet = () => hud.setNet(netState(hub.venues.values(), Date.now(), startedAt, navigator.onLine));
  setInterval(checkNet, 1000);
  window.addEventListener('offline', checkNet);
  window.addEventListener('online', checkNet);
}
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'f' && world.field) world.rig.focusFront(world.field.x(world.frontPrice));
  if (e.key.toLowerCase() === 'm' && !(e.target instanceof HTMLSelectElement)) audio.toggle();
});

/* ------------------------------------------------------------------ Events */
// Rate-limit battlefield effects so a burst of prints does not flood the scene.
let effectBudget = 6;
setInterval(() => (effectBudget = Math.min(6, effectBudget + 1)), 400);
hub.onEvent((e: FeedItem) => {
  hud.addFeed([e]);
  if (effectBudget > 0 || e.usd >= 250_000) {
    effectBudget--;
    world.onMarketEvent(e);
  }
});

/* -------------------------------------------------------------- Game state */
let field: FieldMap | null = null;
let usdPerSoldier = 0;
let usdPerTank = 0;
const nearHist: { ts: number; bid: number; ask: number; progress: number }[] = [];
let liq = { bid: 0, ask: 0 };
let lastSlow = 0;

function regimeKey() {
  const v = hub.realizedVolPct(5);
  if (!Number.isFinite(v)) return 'regime.warming';
  if (v < 0.03) return 'regime.quiet';
  if (v < 0.08) return 'regime.active';
  return 'regime.volatile';
}

function tick() {
  const now = Date.now();
  const idx = hub.tick();
  if (!idx) return;
  const price = idx.price;

  for (const ev of battle.update(price, now)) {
    if (ev.type === 'start') {
      field = new FieldMap(ev.round);
      world.setRound(field, ev.round, price);
      usdPerSoldier = 0;
      nearHist.length = 0;
      hud.showBanner({
        title: 'banner.begin',
        sub: 'banner.beginSub',
        vars: { bulls: fmtPrice(ev.round.bullsWinAt), bears: fmtPrice(ev.round.bearsWinAt) },
      });
    } else {
      hud.showBanner({
        title: `banner.${ev.winner}`,
        sub: 'banner.winSub',
        vars: { id: ev.round.id, price: fmtPrice(price) },
        team: ev.winner,
      });
      world.celebrate(ev.winner);
    }
  }
  world.setPrice(price);
  hud.setPrice(idx);
  if (!field) return;

  // Armies from aggregated depth (±1% so reserves are counted too).
  const bucket = (field.maxPrice - field.minPrice) / 110;
  const depth = hub.depth(bucket, price * 0.99, price * 1.01);
  let bidField = 0;
  let askField = 0;
  depth.bids.forEach((v, k) => (k * bucket >= field!.minPrice ? (bidField += v) : 0));
  depth.asks.forEach((v, k) => (k * bucket <= field!.maxPrice ? (askField += v) : 0));
  const target = niceUsd(Math.max(bidField, askField) / 1100);
  if (bidField + askField > 0 && (!usdPerSoldier || target / usdPerSoldier > 2.5 || usdPerSoldier / target > 2.5)) {
    usdPerSoldier = target;
    usdPerTank = usdPerSoldier * 25;
  }
  if (usdPerSoldier) {
    const layout = layoutArmies(depth, price, field, { ...DEFAULT_LAYOUT, usdPerSoldier, usdPerTank, frontZoneUsd: bucket * 3 });
    world.setLayout(layout);
    hud.setLegend(usdPerSoldier, usdPerTank, layout.bulls.soldiers + layout.bears.soldiers, layout.bulls.tanks + layout.bears.tanks);
    stats.layoutUnits = layout.units.length;
  }

  // Narration inputs: liquidity close to the front, taker flow, progress.
  let bidNear = 0;
  let askNear = 0;
  const near = price * 0.0006;
  depth.bids.forEach((v, k) => ((k + 0.5) * bucket >= price - near ? (bidNear += v) : 0));
  depth.asks.forEach((v, k) => ((k + 0.5) * bucket <= price + near ? (askNear += v) : 0));
  const progress = battle.progress(price);
  nearHist.push({ ts: now, bid: bidNear, ask: askNear, progress });
  while (nearHist.length && now - nearHist[0].ts > 30_000) nearHist.shift();
  const ago = (ms: number) => nearHist.find((h) => h.ts >= now - ms) ?? nearHist[0];
  const flow = hub.flow(20_000);
  const status = narrate({
    progress,
    progressBefore: ago(20_000).progress,
    buyFlow: flow.buy,
    sellFlow: flow.sell,
    bidNear,
    bidNearBefore: ago(10_000).bid,
    askNear,
    askNearBefore: ago(10_000).ask,
    secondsSinceStart: (now - battle.round!.startedAt) / 1000,
  });
  hud.setRound(battle.round, progress, status, battle.score());
  const f5 = hub.flow(5_000);
  world.setActivity(f5.buy / 5, f5.sell / 5);
  audio.setActivity({
    flowPerSec: (f5.buy + f5.sell) / 5,
    progress,
    storming: status === 'bullsStorm' || status === 'bearsStorm',
    eventsPerMin: hub.feed.filter((e) => e.kind !== 'option' && now - e.ts < 60_000).length,
  });

  // Depth chart (selectable source) every tick, heavier panels once a second.
  const half = price * halfRange * 1.6;
  hud.drawDepth(hub.depth(Math.max(0.05, price * 0.00004), price - half, price + half, depthSource), price, half);
  if (now - lastSlow > 1000) {
    lastSlow = now;
    liq = hub.liquidity(0.01, depthSource);
    hud.setLiquidity(liq.bid, liq.ask);
    hud.setVenues(hub.venues, idx);
    hud.setSources([...hub.books.keys()]);
    hud.setRegime(regimeKey());
    hud.setBigThreshold(hub.bigTradeUsd);
  }
}
setInterval(tick, 250);

/* --------------------------------------------------------------- Rendering */
const stats = { fps: 0, frames: 0, layoutUnits: 0 };
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  world.frame(dt);
  hud.frame(dt);
  audio.frame(dt);
  stats.frames++;
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 1) {
    stats.fps = fpsN / fpsAcc;
    fpsAcc = fpsN = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/verification hook (used by scripts/screenshot.mjs).
Object.assign(window, { __ew: { hub, battle, world, hud, stats, sim: simMode, army: () => world.army.stats, audio, renderPreview } });
