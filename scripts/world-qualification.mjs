/* global indexedDB, document, requestAnimationFrame, getComputedStyle */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const origin = process.env.WORLD_URL ?? 'http://127.0.0.1:4173';
const directory = 'docs/visual-baselines/world';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu'],
});
const results = { browser: browser.version() };
async function enter(fixtureName, cold = false) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  await page.goto(origin + '/?world-metrics');
  if (fixtureName) {
    const fixture = JSON.parse(
      await readFile(`benchmarks/generated/${fixtureName}.json`, 'utf8'),
    );
    await page.evaluate(async (fixture) => {
      localStorage.setItem(
        'factory-world-ui-v1',
        JSON.stringify({ reducedMotion: true }),
      );
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('factory-game-world-v1');
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('worlds', 'readwrite');
          tx.objectStore('worlds').put({
            ...fixture,
            savedAt: new Date().toISOString(),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    }, fixture);
  }
  const network = await context.newCDPSession(page);
  let transferredBytes = 0;
  await network.send('Network.enable');
  network.on('Network.loadingFinished', (event) => {
    transferredBytes += event.encodedDataLength;
  });
  if (cold) {
    await network.send('Network.setCacheDisabled', { cacheDisabled: true });
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 100,
      downloadThroughput: 20_000_000 / 8,
      uploadThroughput: 20_000_000 / 8,
    });
  }
  const start = Date.now();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await page
    .locator('canvas[data-first-frame="true"]')
    .waitFor({ timeout: 120_000 });
  const firstFrameMs = Date.now() - start;
  await page
    .locator('canvas[data-renderer-ready="true"]')
    .waitFor({ timeout: 120_000 });
  const assetsReadyMs = Date.now() - start;
  await page.waitForFunction(() => {
    const value = document.querySelector('canvas[data-world-stats]')?.dataset
      .worldStats;
    return value && JSON.parse(value).ready;
  });
  return { context, page, firstFrameMs, assetsReadyMs, transferredBytes };
}
const stats = (page) =>
  page
    .locator('canvas[data-world-stats]')
    .evaluate((canvas) => JSON.parse(canvas.dataset.worldStats));
try {
  const cold = await enter(undefined, true);
  results.cold = {
    firstFrameMs: cold.firstFrameMs,
    assetsReadyMs: cold.assetsReadyMs,
    transferredBytes: cold.transferredBytes,
  };
  await cold.page.screenshot({ path: `${directory}/starter-1366.png` });
  await cold.context.close();
  const standard = await enter('world-performance-v1');
  let page = standard.page;
  await page.getByRole('button', { name: 'Pause world' }).click();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  results.switches = [];
  for (let i = 0; i <= 20; i++) {
    if (i) {
      await page.getByRole('button', { name: 'Factory', exact: true }).click();
      await page.getByRole('button', { name: 'World', exact: true }).click();
    }
    await page.locator('canvas[data-renderer-ready="true"]').waitFor();
    await page.waitForTimeout(1100);
    results.switches.push(await stats(page));
  }
  await standard.context.close();
  const visual = await enter('world-visual-v1');
  page = visual.page;
  await page.getByRole('button', { name: /^factory.*128, 128$/i }).click();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  for (const [label, zooms] of [
    ['normal', 0],
    ['close', -2],
    ['overview', 5],
  ]) {
    await page.getByRole('button', { name: 'Home camera' }).click();
    for (let i = 0; i < Math.abs(zooms); i++)
      await page
        .getByRole('button', {
          name: zooms < 0 ? 'Zoom in' : 'Zoom out',
          exact: true,
        })
        .click();
    await page.screenshot({ path: `${directory}/finished-${label}-1366.png` });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: `${directory}/finished-1920.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${directory}/finished-390.png` });
  results.narrow = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: 'Home camera' }).click();
  await page
    .getByRole('button', { name: 'Keyboard placement', exact: true })
    .click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await canvas.press('g');
  await page.screenshot({ path: directory + '/ghost-invalid.png' });
  for (let i = 0; i < 16; i++) await canvas.press('ArrowDown');
  await page.waitForTimeout(250);
  await page.screenshot({ path: directory + '/ghost-valid.png' });
  await canvas.press('Escape');
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page
    .getByRole('button', { name: /^construction site.*136, 144$/i })
    .click();
  await page.screenshot({ path: directory + '/construction-inspector.png' });
  await page
    .getByRole('button', { name: /^Pod.*destination blocked/i })
    .first()
    .click();
  await page.screenshot({ path: directory + '/blocked-traffic-inspector.png' });
  results.contrast = await page.evaluate(() => {
    const luminance = (color) => {
      const channels = color
        .match(/[0-9.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const ratio = (a, b) => {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    return [
      '.world-session-bar button',
      '.world-build-dock button',
      '.world-view-controls button',
      '.world-inspector button',
      '.world-placement-feedback',
    ].flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const style = getComputedStyle(element);
      let background = style.backgroundColor,
        parent = element.parentElement;
      while (background === 'rgba(0, 0, 0, 0)' && parent) {
        background = getComputedStyle(parent).backgroundColor;
        parent = parent.parentElement;
      }
      return [
        {
          selector,
          color: style.color,
          background,
          border: style.borderTopColor,
          textRatio: ratio(style.color, background),
          borderRatio: ratio(style.borderTopColor, background),
        },
      ];
    });
  });
  await visual.context.close();
  const large = await enter('world-large-v1');
  results.large = {
    firstFrameMs: large.firstFrameMs,
    assetsReadyMs: large.assetsReadyMs,
    working: await stats(large.page),
  };
  await large.page.getByRole('button', { name: 'Close inspector' }).click();
  for (let i = 0; i < 12; i++)
    await large.page
      .getByRole('button', { name: 'Zoom out', exact: true })
      .click();
  await large.page.waitForTimeout(1100);
  results.large.overview = await stats(large.page);
  await large.page.screenshot({ path: `${directory}/large-overview.png` });
  await large.context.close();
  const gallery = await browser.newPage({
    viewport: { width: 700, height: 520 },
  });
  await gallery.goto(origin + '/?asset-gallery');
  await gallery
    .locator('canvas[data-renderer-ready="true"]')
    .waitFor({ timeout: 60_000 });
  await gallery.waitForFunction(
    () => document.querySelectorAll('select')[0]?.options.length === 21,
  );
  const ids = await gallery
    .getByLabel('Asset', { exact: true })
    .locator('option')
    .allTextContents();
  const tiles = [];
  for (const id of ids) {
    await gallery.getByLabel('Asset', { exact: true }).selectOption(id);
    await gallery.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const capture = await gallery.screenshot();
    tiles.push(
      `<figure><img src="data:image/png;base64,${capture.toString('base64')}"><figcaption>${id}</figcaption></figure>`,
    );
    for (const lod of ['1', '2', '0'])
      await gallery.getByLabel('LOD', { exact: true }).selectOption(lod);
    for (let i = 0; i < 4; i++)
      await gallery.getByRole('button', { name: /Quarter turn/ }).click();
  }
  await gallery.setViewportSize({ width: 1200, height: 800 });
  await gallery.setContent(
    `<body style="margin:0;background:#202d33;color:white;display:grid;grid-template-columns:repeat(3,1fr);font:16px sans-serif"><style>figure{margin:6px}img{width:100%}</style>${tiles.join('')}</body>`,
  );
  await gallery.screenshot({
    path: `${directory}/asset-gallery.png`,
    fullPage: true,
  });
  results.gallery = { assets: ids, lods: 3, rotations: 4 };
  await gallery.close();
  await writeFile(
    'docs/world-qualification-results.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      cold: results.cold,
      large: results.large,
      narrow: results.narrow,
      galleryAssets: ids.length,
    }),
  );
} finally {
  await browser.close();
}
