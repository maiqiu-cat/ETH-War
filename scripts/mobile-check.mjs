/**
 * Phone / tablet / small-window layout check in headless Chrome against the production build.
 *
 *   pnpm build && pnpm verify:mobile
 *   MOBILE_CHECK_URL=https://example.com pnpm verify:mobile     # check a deployed site
 *
 * Viewports are the area a page really gets (browser bars excluded), with touch and the device
 * pixel ratio. The market feed is filled and a round banner shown, so the crowded case is measured.
 * For every viewport and language:
 *   1. every visible HUD block lies inside the screen and the page cannot scroll sideways;
 *   2. no two HUD blocks overlap (the menu never covers the price, the change or the war bar);
 *   3. no text sticks out of its box (labels that are meant to end in "…" excepted);
 *   4. feed labels keep room to be read and the depth axis prices do not run together;
 *   5. the round banner and the network notice ("check your network") fit without covering other blocks.
 * Screenshots: verification/mobile/<viewport>-<lang>[-banner|-offline].jpg (git-ignored).
 * Report: verification/mobile-report.json (MOBILE_CHECK_ONLY=iphone,landscape runs a subset and writes no report).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4175;
const EXTERNAL = process.env.MOBILE_CHECK_URL?.replace(/\/$/, '');
const OUT = 'verification/mobile';
const VIEWPORTS = [
  { id: 'iphone-se', width: 375, height: 553, dpr: 2, touch: true }, // iPhone SE, browser bars shown
  { id: 'iphone', width: 393, height: 671, dpr: 3, touch: true }, // iPhone 14 Pro–16 in Chrome (the user's 2026-10-02 screenshot)
  { id: 'iphone-tall', width: 393, height: 852, dpr: 3, touch: true }, // DevTools "iPhone 15 Pro", no browser bars
  { id: 'android', width: 360, height: 670, dpr: 3, touch: true },
  { id: 'iphone-max', width: 430, height: 740, dpr: 3, touch: true },
  { id: 'landscape', width: 667, height: 320, dpr: 2, touch: true }, // iPhone SE turned sideways
  { id: 'landscape-wide', width: 812, height: 360, dpr: 3, touch: true }, // iPhone turned sideways
  { id: 'android-landscape', width: 915, height: 360, dpr: 3, touch: true },
  { id: 'ipad', width: 768, height: 1024, dpr: 2, touch: true },
  { id: 'ipad-landscape', width: 1024, height: 768, dpr: 2, touch: true },
  { id: 'laptop', width: 1280, height: 720, dpr: 1 },
  { id: 'desktop', width: 1440, height: 860, dpr: 1 },
];
const LANGS = ['zh', 'en'];
const VENUES = ['coinbase', 'kraken', 'okx', 'bybit', 'bitstamp', 'deribit'];
const only = process.env.MOBILE_CHECK_ONLY?.split(',');

mkdirSync(OUT, { recursive: true });
let server = null;
if (!EXTERNAL) {
  server = spawn('./node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('preview server did not start')), 20000);
    server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), res()));
  });
}
const BASE = EXTERNAL ?? `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs in the page: boxes of the HUD blocks plus text-fit details. */
function measure(venues) {
  // Live mode lists several exchanges under the menu buttons (the simulator lists one): measure the tall case.
  if (venues && window.__ew?.hud) window.__ew.hud.setVenues(new Map(venues.map((ex) => [ex, { ex, channels: { trades: 'open', book: 'open' } }])), null);
  const shown = (el) => {
    if (!el) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const box = (r) => ({ x: r.left, y: r.top, r: r.right, b: r.bottom });
  // Text extents clipped to the element: a centered caption in a wide row only occupies its text.
  const textBox = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rs = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rs.length) return null;
    const e = el.getBoundingClientRect();
    const b = {
      x: Math.max(e.left, Math.min(...rs.map((r) => r.left))),
      y: Math.max(e.top, Math.min(...rs.map((r) => r.top))),
      r: Math.min(e.right, Math.max(...rs.map((r) => r.right))),
      b: Math.min(e.bottom, Math.max(...rs.map((r) => r.bottom))),
    };
    return b.r > b.x && b.b > b.y ? b : null;
  };
  const blocks = {};
  const add = (name, sel, text = false) => {
    const el = document.querySelector(sel);
    if (!shown(el)) return;
    const b = text ? textBox(el) : box(el.getBoundingClientRect());
    if (b) blocks[name] = b;
  };
  add('brand', '.brand');
  add('xlink', '.masthead .xlink');
  add('xlinkBar', '.top-center .xlink');
  add('caption', '.top-center .caption', true);
  add('price', '.top-center .price-row', true);
  add('change', '.top-center .change');
  add('warbar', '.top-center .warbar');
  add('menu', '.tr');
  add('status', '.tl');
  add('bidLiq', '.side.left');
  add('askLiq', '.side.right');
  add('depth', '.bl');
  add('feed', '.br');
  add('soundHint', '.sound-hint');
  add('hints', '.hints', true);
  add('banner', '.banner');
  add('netAlert', '.net-alert');

  const describe = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}${el.dataset.k ? `[${el.dataset.k}]` : ''}`;
  const overflow = [];
  let minFont = Infinity;
  for (const el of document.querySelectorAll('#hud *')) {
    if (!shown(el) || el.closest('svg') || el.tagName === 'CANVAS') continue;
    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) minFont = Math.min(minFont, parseFloat(cs.fontSize));
    if (cs.display === 'inline' || el.clientWidth === 0) continue;
    if (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') continue;
    const over = el.scrollWidth - el.clientWidth;
    if (over > 2) overflow.push(`${describe(el)} +${over}px "${el.textContent.trim().slice(0, 30)}"`);
  }
  const labels = [...document.querySelectorAll('.br li span')].filter(shown);
  const axis = [...document.querySelectorAll('.bl .axis span')].filter(shown).map((s) => textBox(s)).filter(Boolean);
  let axisGap = Infinity;
  for (let i = 1; i < axis.length; i++) axisGap = Math.min(axisGap, axis[i].x - axis[i - 1].r);
  return {
    W: innerWidth,
    H: innerHeight,
    scrollW: document.documentElement.scrollWidth,
    blocks,
    overflow,
    minFont,
    feedRows: labels.length,
    feedLabelMin: labels.length ? Math.min(...labels.map((s) => s.clientWidth)) : null,
    axisGap: axis.length > 1 ? Math.round(axisGap * 10) / 10 : null,
  };
}

/** Blocks as "left,top,right,bottom" in CSS px, one line each in the report. */
const compact = (blocks) => Object.fromEntries(Object.entries(blocks).map(([k, b]) => [k, [b.x, b.y, b.r, b.b].map((v) => Math.round(v)).join(',')]));
const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));
const overlapsOf = (m, onlyWith) => {
  const out = [];
  const names = Object.keys(m.blocks);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const [a, b] = [names[i], names[j]];
      if (onlyWith && a !== onlyWith && b !== onlyWith) continue;
      if (!onlyWith && (a === 'banner' || b === 'banner')) continue;
      const s = area(m.blocks[a], m.blocks[b]);
      if (s > 4) out.push(`${a}×${b} ${Math.round(s)}px²`);
    }
  return out;
};
const outsideOf = (m, names = Object.keys(m.blocks)) =>
  names.filter((n) => {
    const b = m.blocks[n];
    return b && (b.x < -0.5 || b.y < -0.5 || b.r > m.W + 0.5 || b.b > m.H + 0.5);
  });

const FEED = [
  ['trade', 'bigBuy', true, 44_200, 'coinbase'],
  ['trade', 'bigSell', false, 205_000, 'bybit'],
  ['liq', 'liqShort', true, 2_450_000, 'okx'],
  ['option', 'optBuy', true, 63_800, 'deribit'],
  ['liq', 'liqLong', false, 1_250_000, 'bybit'],
  ['option', 'optSell', false, 26_300, 'deribit'],
  ['trade', 'bigBuy', true, 143_000, 'kraken'],
  ['trade', 'bigSell', false, 980_000, 'bitstamp'],
];

const results = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--ignore-gpu-blocklist'] });
try {
  for (const vp of VIEWPORTS) {
    if (only && !only.includes(vp.id)) continue;
    for (const lang of LANGS) {
      const page = await browser.newPage();
      await page.emulateTimezone('UTC'); // screenshots must not show the local timezone
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && !/websocket|binance|bybit|ERR_/i.test(m.text()) && errors.push(m.text()));
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, isMobile: !!vp.touch, hasTouch: !!vp.touch });
      await page.goto(`${BASE}/?sim&q=low&lang=${lang}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /\d/.test(document.querySelector('[data-k=price]')?.textContent ?? ''), { timeout: 20000 }).catch(() => {});
      await sleep(1700); // staggered entrance animations
      const hasHud = await page.evaluate((feed) => {
        document.querySelector('.banner')?.setAttribute('class', 'banner');
        const hud = window.__ew?.hud;
        if (!hud) return false;
        const now = Date.now();
        hud.addFeed(feed.map(([kind, type, bull, usd, ex], i) => ({ id: 9e9 + i, kind, type, ex, bull, usd, price: 2720, ts: now - (feed.length - i) * 7000, label: type })));
        return true;
      }, FEED);
      await sleep(900);
      const m = await page.evaluate(measure, VENUES);
      await page.screenshot({ path: `${OUT}/${vp.id}-${lang}.jpg`, type: 'jpeg', quality: 72 });
      let mb = null;
      if (hasHud) {
        await page.evaluate(() =>
          window.__ew.hud.showBanner({ title: 'banner.begin', sub: 'banner.beginSub', vars: { bulls: '2,726.80', bears: '2,713.20' } }),
        );
        await sleep(1300);
        mb = await page.evaluate(measure, VENUES);
        await page.screenshot({ path: `${OUT}/${vp.id}-${lang}-banner.jpg`, type: 'jpeg', quality: 72 });
      }
      // The network notice live mode shows when no exchange sends data (sim mode never does by itself).
      let mn = null;
      if (hasHud) {
        await page.evaluate(() => {
          document.querySelector('.banner')?.setAttribute('class', 'banner');
          window.__ew.hud.setNet('unreachable');
        });
        await sleep(700);
        mn = await page.evaluate(measure, VENUES);
        await page.screenshot({ path: `${OUT}/${vp.id}-${lang}-offline.jpg`, type: 'jpeg', quality: 72 });
      }
      await page.close();

      const fails = [];
      const overlaps = overlapsOf(m);
      const outside = outsideOf(m);
      if (m.scrollW > m.W + 1) fails.push(`page scrolls sideways (${m.scrollW} > ${m.W})`);
      if (overlaps.length) fails.push(`overlap: ${overlaps.join(', ')}`);
      if (outside.length) fails.push(`off screen: ${outside.join(', ')}`);
      if (m.overflow.length) fails.push(`text sticks out: ${m.overflow.join(' | ')}`);
      if (m.feedLabelMin !== null && m.feedLabelMin < 24) fails.push(`feed labels squeezed to ${m.feedLabelMin}px`);
      if (m.axisGap !== null && m.axisGap < 4) fails.push(`depth axis prices run together (gap ${m.axisGap}px)`);
      if (errors.length) fails.push(`runtime errors: ${errors.slice(0, 3).join(' | ')}`);
      if (mb) {
        const bo = overlapsOf(mb, 'banner');
        if (bo.length) fails.push(`banner overlaps: ${bo.join(', ')}`);
        if (outsideOf(mb, ['banner']).length) fails.push('banner off screen');
      }
      if (mn) {
        if (!mn.blocks.netAlert) fails.push('network notice not shown');
        const no = overlapsOf(mn, 'netAlert');
        if (no.length) fails.push(`network notice overlaps: ${no.join(', ')}`);
        if (outsideOf(mn, ['netAlert']).length) fails.push('network notice off screen');
        if (mn.overflow.length) fails.push(`network notice text sticks out: ${mn.overflow.join(' | ')}`);
      }
      const ok = fails.length === 0;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${vp.id.padEnd(17)} ${lang}  ${vp.width}×${vp.height}  min font ${m.minFont}px  feed rows ${m.feedRows}${ok ? '' : '\n      ' + fails.join('\n      ')}`);
      results.push({
        id: vp.id,
        size: `${vp.width}×${vp.height}@${vp.dpr}x`,
        lang,
        ok,
        fails,
        minFont: m.minFont,
        feedRows: m.feedRows,
        feedLabelMin: m.feedLabelMin,
        axisGap: m.axisGap,
        blocks: compact(m.blocks),
        banner: mb?.blocks.banner ? compact({ banner: mb.blocks.banner }).banner : null,
        netAlert: mn?.blocks.netAlert ? compact({ netAlert: mn.blocks.netAlert }).netAlert : null,
        overflow: m.overflow,
      });
    }
  }
} finally {
  await browser.close();
  server?.kill();
}
const failed = results.filter((r) => !r.ok);
// A partial run (MOBILE_CHECK_ONLY) never overwrites the full report.
if (!only)
  writeFileSync(
    EXTERNAL ? 'verification/mobile-report-production.json' : 'verification/mobile-report.json',
    JSON.stringify({ at: new Date().toISOString(), url: BASE, results }, null, 1),
  );
console.log(failed.length ? `\n${failed.length}/${results.length} layout(s) failed` : `\nMOBILE LAYOUT CHECKS PASSED (${results.length}) → ${OUT}/`);
process.exit(failed.length ? 1 : 0);
