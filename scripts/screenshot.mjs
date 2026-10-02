/**
 * Visual verification: serves the production build, opens it in headless Chrome
 * (sim and live mode), takes screenshots and collects runtime stats/errors.
 *
 *   pnpm build && pnpm verify:screens
 *   CHROME=/path/to/chrome pnpm verify:screens
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4173;
const OUT = 'verification';
mkdirSync(OUT, { recursive: true });

const server = spawn('./node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), res()));
});

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--window-size=1600,900'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { at: new Date().toISOString(), runs: [] };

async function run(name, query, shots) {
  const page = await browser.newPage();
  await page.emulateTimezone('UTC'); // committed screenshots must not show the local timezone
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'domcontentloaded' });
  const webgl = await page.evaluate(() => {
    const c = document.querySelector('#app canvas');
    const gl = c?.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'none';
  });
  const run = { name, query, webgl, shots: [], errors };
  for (const s of shots) {
    await sleep(s.waitMs ?? 0);
    if (s.waitFn) await page.waitForFunction(s.waitFn, { timeout: s.timeoutMs ?? 90000, polling: 100 });
    if (s.setup) await page.evaluate(s.setup);
    if (s.settleMs) await sleep(s.settleMs);
    const path = `${OUT}/${name}-${s.id}.png`;
    await page.screenshot({ path });
    const stats = await page.evaluate(() => {
      const bb = window.__ew;
      const idx = bb.hub.index;
      return {
        fps: Math.round(bb.stats.fps * 10) / 10,
        frames: bb.stats.frames,
        layoutUnits: bb.stats.layoutUnits,
        army: bb.army(),
        index: idx ? Math.round(idx.price * 100) / 100 : null,
        venuesInIndex: idx ? idx.venues.filter((v) => v.included).map((v) => v.ex) : [],
        round: bb.battle.round,
        feedItems: bb.hub.feed.length,
        status: document.querySelector('[data-k=status]')?.textContent,
        shot: bb.world.rig.shotName,
        banner: document.querySelector('[data-k=bTitle]')?.textContent,
        lang: document.documentElement.lang,
        caption: document.querySelector('.caption')?.textContent,
        title: document.title,
        history: bb.battle.history.map((r) => `#${r.id} ${r.winner}`),
      };
    });
    run.shots.push({ id: s.id, path, stats });
    console.log(`[${name}/${s.id}]`, JSON.stringify(stats));
  }
  report.runs.push(run);
  if (errors.length) console.log(`[${name}] errors:`, errors.slice(0, 10));
  await page.close();
}

const manualFront = (dx, h, dz) => `(() => {
  const w = window.__ew.world; const fx = w.field.x(w.frontPrice);
  w.rig.setCinematic(false);
  w.rig.controls.target.set(fx, 0, 0);
  w.camera.position.set(fx + ${dx}, ${h}, ${dz});
  w.rig.controls.update();
})()`;

try {
  await run('sim', '?sim&light=golden&seed=11&lang=zh', [
    { id: '1-overview', waitMs: 9000 },
    { id: '2-front-closeup', waitMs: 3000, setup: manualFront(-26, 16, 34), settleMs: 1500 },
    { id: '3-wide', waitMs: 500, setup: manualFront(-10, 150, 175), settleMs: 1500 },
    { id: '4-night', waitMs: 500, setup: `document.querySelector('[data-k=lighting]').value='night';document.querySelector('[data-k=lighting]').dispatchEvent(new Event('change'))`, settleMs: 1500 },
    // By now round 1 has usually been won (sim drifts); check the next round started cleanly.
    { id: '5-later-round', waitMs: 6000, setup: `document.querySelector('[data-k=lighting]').value='golden';document.querySelector('[data-k=lighting]').dispatchEvent(new Event('change'));` + manualFront(-70, 80, 110), settleMs: 1000 },
  ]);
  // Narrow rounds (±0.06%) so wins happen quickly: verifies win -> celebration -> next round.
  const overview = manualFront(-40, 95, 120);
  await run('sim-rounds', '?sim&range=0.06&seed=5&light=day&lang=zh', [
    { id: '1-win', waitFn: 'window.__ew?.battle.round?.winner', setup: overview, settleMs: 1200 },
    { id: '2-next-round', waitFn: 'window.__ew?.battle.round?.id >= 2 && !window.__ew.battle.round.winner', settleMs: 1500 },
  ]);
  await run('live', '?light=golden&lang=en', [
    { id: '1-overview', waitMs: 16000 },
    { id: '2-front-closeup', waitMs: 3000, setup: manualFront(-30, 18, 38), settleMs: 1500 },
    { id: '3-day', waitMs: 500, setup: `document.querySelector('[data-k=lighting]').value='day';document.querySelector('[data-k=lighting]').dispatchEvent(new Event('change'));` + manualFront(-60, 70, 95), settleMs: 2000 },
    // Language toggle: English -> Chinese via the HUD button.
    { id: '4-lang-toggle', waitMs: 200, setup: `document.querySelector('[data-k=lang]').click()`, settleMs: 800 },
  ]);
} finally {
  writeFileSync(`${OUT}/screens-report.json`, JSON.stringify(report, null, 1));
  await browser.close();
  server.kill();
}
// Binance geo-blocks some regions (HTTP 451); the adapter backs off and the index excludes it.
const EXPECTED = [/stream\.binance\.com.*451/, /fstream\.binance\.com/];
const errs = report.runs.flatMap((r) => r.errors).filter((e) => !EXPECTED.some((re) => re.test(e)));
console.log(errs.length ? `\n${errs.length} runtime errors` : '\nNo runtime errors');
process.exit(errs.length ? 1 : 0);
