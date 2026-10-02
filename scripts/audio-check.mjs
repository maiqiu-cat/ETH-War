/**
 * Audio verification in headless Chrome against the production build.
 *
 *   pnpm build && pnpm verify:audio
 *
 * A. Autoplay allowed (Chrome flag): sound starts with no click (default on), calm score playing.
 * B. Normal autoplay policy: "click to enable sound" hint while locked; a click starts it.
 *    Forced high intensity → battle score; a win → victory cue; effects path; M toggles and persists.
 * C. renderPreview(): 36 s offline scene with the real assets (calm → battle → hits → liquidation →
 *    victory) → verification/audio-preview.wav; no clipping, hits clearly above the score bed.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4174;
// AUDIO_CHECK_URL=https://example.com pnpm verify:audio  → check a deployed site instead of a local preview
const EXTERNAL = process.env.AUDIO_CHECK_URL?.replace(/\/$/, '');
mkdirSync('verification', { recursive: true });
let server = null;
if (!EXTERNAL) {
  server = spawn('./node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('preview server did not start')), 20000);
    server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), res()));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};
const report = {};
const URL = `${EXTERNAL ?? `http://localhost:${PORT}`}/?sim&lang=zh`;
console.log(`target: ${URL}`);
const dbg = (page) => page.evaluate(() => ({ ...__ew.audio.debug, hint: document.querySelector('[data-k=soundHint]').classList.contains('show') }));
const waitFor = async (page, fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await dbg(page);
    if (fn(d)) return d;
    await sleep(250);
  }
  return dbg(page);
};

try {
  // ---------------------------------------------------------------- A: autoplay allowed
  {
    const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    const page = await b.newPage();
    await page.setViewport({ width: 1440, height: 860 });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    const d = await waitFor(page, (x) => x.loaded && x.music === 'calm', 15000);
    report.autoplay = d;
    check(d.state === 'running' && d.loaded && d.music === 'calm' && !d.hint, `A. autoplay allowed, no click: state=${d.state}, assets=${d.buffers}, music=${d.music}, hint=${d.hint}`);
    await b.close();
  }
  // A speaker button is the most obvious first click. It must enable sound while locked.
  {
    const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--ignore-gpu-blocklist'] });
    const p = await b.newPage();
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await waitFor(p, (x) => x.loaded && x.state === 'locked', 15000);
    await p.click('[data-k=sound]');
    const d = await waitFor(p, (x) => x.state === 'running', 3000);
    check(d.state === 'running', `B0. speaker button unlocks sound: state=${d.state}`);
    await p.click('[data-k=sound]');
    const off = await waitFor(p, (x) => x.state === 'off', 3000);
    check(off.state === 'off', `B0a. speaker button mutes: state=${off.state}`);
    await p.click('[data-k=sound]');
    const back = await waitFor(p, (x) => x.state === 'running', 3000);
    check(back.state === 'running', `B0b. speaker button restores sound: state=${back.state}`);
    report.button = { unlock: d, off, back };
    await b.close();
  }
  // ---------------------------------------------------------------- B: normal policy
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 860 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/binance/i.test(m.text()) && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('ew.sound'));
  const locked = await waitFor(page, (x) => x.loaded, 15000);
  check(locked.state === 'locked' && locked.hint && locked.loaded, `B1. default policy before a gesture: state=${locked.state}, hint=${locked.hint}, assets preloaded=${locked.loaded} (${locked.buffers})`);
  await page.mouse.click(720, 430);
  const on = await waitFor(page, (x) => x.state === 'running' && x.music === 'calm', 5000);
  check(on.state === 'running' && on.music === 'calm' && !on.hint, `B2. after one click: state=${on.state}, music=${on.music}, hint=${on.hint}`);
  await page.evaluate(() => __ew.audio.debugForce(1));
  const battle = await waitFor(page, (x) => x.music === 'battle', 12000);
  check(battle.music === 'battle', `B3. sustained high intensity → music=${battle.music} (intensity ${battle.intensity})`);
  await page.evaluate(() => {
    const now = Date.now();
    __ew.world.onMarketEvent({ id: 1, kind: 'liq', type: 'liqShort', ex: 'sim', bull: true, usd: 2_500_000, price: 2720, ts: now, label: 'Shorts liquidated' });
    __ew.world.onMarketEvent({ id: 2, kind: 'trade', type: 'bigSell', ex: 'sim', bull: false, usd: 900_000, price: 2720, ts: now, label: 'Large sell trade' });
    __ew.world.onMarketEvent({ id: 3, kind: 'option', type: 'optBuy', ex: 'deribit', bull: true, usd: 50_000, price: 2720, ts: now, label: 'Large option buy' });
  });
  await sleep(2500);
  await page.evaluate(() => __ew.world.celebrate('bulls'));
  const vic = await waitFor(page, (x) => x.music === 'victory', 3000);
  check(vic.music === 'victory', `B4. win → music=${vic.music}`);
  await page.evaluate(() => __ew.audio.debugForce(null));
  await page.keyboard.press('m');
  await sleep(300);
  const off = await page.evaluate(() => ({ state: __ew.audio.state, pref: localStorage.getItem('ew.sound') }));
  check(off.state === 'off' && off.pref === 'off', `B5. M → off (pref=${off.pref})`);
  await page.keyboard.press('m');
  const back = await waitFor(page, (x) => x.state === 'running', 3000);
  check(back.state === 'running', `B6. M again → ${back.state}`);
  check(errors.length === 0, `B7. no runtime errors (${errors.length}) ${errors.slice(0, 3).join(' | ')}`);
  Object.assign(report, { locked, on, battle, vic, off, back, errors });

  // ---------------------------------------------------------------- C: offline render
  const t0 = Date.now();
  const res = await page.evaluate(async () => __ew.renderPreview(36));
  writeFileSync('verification/audio-preview.wav', Buffer.from(res.wavBase64, 'base64'));
  const { wavBase64, ...levels } = res;
  report.levels = levels;
  console.log(`preview rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, JSON.stringify(levels));
  check(levels.peak > 0.3 && levels.peak < 0.995, `C1. peak ${levels.peak} (audible, no clipping)`);
  check(levels.hitsDb - levels.bedDb >= 8, `C2. hits stand out: loudest hit ${levels.hitsDb} dB vs score bed ${levels.bedDb} dB (+${(levels.hitsDb - levels.bedDb).toFixed(1)} dB)`);
  const w = levels.windowsDb;
  check(Math.min(...w.slice(1, 8)) > -45 && Math.min(...w.slice(28, 34)) > -45, `C3. calm score (1–8 s) and victory cue (28–34 s) audible: min ${Math.min(...w.slice(1, 8))} / ${Math.min(...w.slice(28, 34))} dB`);
  writeFileSync(EXTERNAL ? 'verification/audio-report-production.json' : 'verification/audio-report.json', JSON.stringify({ at: new Date().toISOString(), url: URL, ...report }, null, 1));
  await browser.close();
} finally {
  server?.kill();
}
console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nAUDIO CHECKS PASSED → verification/audio-preview.wav');
process.exit(fails.length ? 1 : 0);
