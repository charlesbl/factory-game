/* global document, window, requestAnimationFrame */
import { launchWorldBrowser } from './world-browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.env.WORLD_DEV_URL ?? 'http://127.0.0.1:5173';
const directory = 'docs/visual-baselines/world';
await mkdir(directory, { recursive: true });
const browser = await launchWorldBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 720 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseAssets;
  const assetsAllowed = new Promise((resolve) => {
    releaseAssets = resolve;
  });
  await page.route('**/assets/world/manifest.json', async (route) => {
    await assetsAllowed;
    await route.continue();
  });
  await page.goto(origin);
  await page.evaluate(async () => {
    const { WorldRenderer } =
      await import('/src/rendering/world/WorldRenderer.ts');
    const { createReviewFixture } =
      await import('/src/world/review-fixture.ts');
    const { runtime } = createReviewFixture();
    runtime.setTimeControl(true, 1);
    runtime.world.grid.terrain.fill(0);
    const path = [
      { x: 11, y: 12 },
      { x: 11, y: 16 },
      { x: 20, y: 16 },
      { x: 20, y: 34 },
      { x: 27, y: 34 },
      { x: 27, y: 33 },
    ];
    runtime.placeRailPath(path);
    runtime.placeRailPath([...path].reverse());
    runtime.placeControlNode('junction', { x: 20, y: 16 });
    runtime.placeRailPath([
      { x: 20, y: 16 },
      { x: 27, y: 16 },
    ]);
    runtime.placeRailPath([
      { x: 38, y: 34 },
      { x: 27, y: 34 },
    ]);
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '100' });
    document.body.append(host);
    window.review = new WorldRenderer(host, runtime.snapshot(), {
      onSelect() {},
      onSelectEntity() {},
      onHover() {},
      onAssetError(error) {
        throw new Error(error);
      },
    });
    window.review.reducedMotion = true;
    window.review.focus({ x: 24, y: 24 });
    window.review.zoom(1.65);
  });
  await page.locator('canvas[data-first-frame="true"]').waitFor();
  await page.screenshot({ path: `${directory}/models-before-loading.png` });
  releaseAssets();
  await page
    .locator('canvas[data-renderer-ready="true"]')
    .waitFor({ timeout: 120_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${directory}/models-after-loading.png` });
  const assembly = await page.evaluate(() => ({
    loadedModels: window.review.assets.models.size,
    hookups: JSON.parse(window.review.renderer.domElement.dataset.hookupDraws),
  }));
  const stoppedMachinery = await page.evaluate(async () => {
    const { createStatesFixture } =
      await import('/src/world/states-fixture.ts');
    const { runtime, ids } = createStatesFixture();
    runtime.setTimeControl(false, 1);
    window.review.reducedMotion = false;
    window.review.setSnapshot(runtime.snapshot());
    window.review.setTransient({
      activeTool: 'select',
      selectedEntityId: ids.waitingFactory,
    });
    window.review.focus({ x: 30, y: 30 });
    window.review.zoom(0.6);
    const wait = () =>
      new Promise((resolve) => window.setTimeout(resolve, 500));
    await wait();
    const transforms = () => ({
      fans: [...window.review.animatedFans].map(([id, part]) => [
        id,
        part.rotation.y,
      ]),
      drills: [...window.review.animatedDrillHeads].map(([id, part]) => [
        id,
        part.position.y,
      ]),
    });
    const before = transforms();
    await wait();
    const after = transforms();
    if (
      !before.fans.length ||
      !before.drills.length ||
      JSON.stringify(before) !== JSON.stringify(after)
    )
      throw new Error('Stopped machinery animation did not remain stationary');
    return {
      before,
      after,
      runningEntities: [...window.review.runningEntities],
      extractingDrills: [...window.review.extractingDrills],
    };
  });
  await page.evaluate(() => window.review.dispose());
  await page.unroute('**/assets/world/manifest.json');
  await page.goto(origin + '/?asset-gallery');
  await page
    .locator('canvas[data-renderer-ready="true"]')
    .waitFor({ timeout: 120_000 });
  await page.setViewportSize({ width: 600, height: 440 });
  const ids = [
    'rail-straight',
    'rail-corner',
    'rail-junction',
    'hookup-marker',
    'hookup-crane',
    'station',
    'depot',
    'factory',
  ];
  const tiles = [];
  for (const id of ids) {
    await page.getByLabel('Asset', { exact: true }).selectOption(id);
    for (const lod of ['0', '1', '2']) {
      await page.getByLabel('LOD', { exact: true }).selectOption(lod);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const capture = await page.screenshot();
      tiles.push(
        `<figure><img src="data:image/png;base64,${capture.toString('base64')}"><figcaption>${id} · LOD ${lod}</figcaption></figure>`,
      );
    }
  }
  await page.goto('about:blank');
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.setContent(
    `<body style="margin:0;background:#202d33;color:white;display:grid;grid-template-columns:repeat(3,1fr);font:16px sans-serif"><style>figure{margin:6px}img{width:100%}</style>${tiles.join('')}</body>`,
  );
  await page.screenshot({
    path: `${directory}/model-lods.png`,
    fullPage: true,
  });
  await writeFile(
    'docs/world-model-review-results.json',
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        browser: browser.version(),
        assembly,
        stoppedMachinery,
        models: ids,
        lods: [0, 1, 2],
        errors,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ ...assembly, models: ids.length, errors }));
} finally {
  await browser.close();
}
