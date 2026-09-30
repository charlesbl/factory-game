/* global window, document */
import { launchWorldBrowser } from './world-browser.mjs';
import { writeFile } from 'node:fs/promises';
const origin = process.env.WORLD_URL ?? 'http://127.0.0.1:4173';
const browser = await launchWorldBrowser();
const results = {
  recordedAt: new Date().toISOString(),
  browser: browser.version(),
};
try {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'factory-world-ui-v1',
      JSON.stringify({ quality: 'low', reducedMotion: true }),
    ),
  );
  await page.goto(origin);
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await canvas.waitFor({ timeout: 120_000 });
  await page
    .getByRole('button', { name: 'depot · 132, 126', exact: true })
    .click();
  await page.getByRole('button', { name: 'Build pod', exact: true }).click();
  await page.getByText('1 order(s) queued', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel latest order' }).click();
  await page.getByText('0 order(s) queued', { exact: true }).waitFor();
  results.podQueueAndCancel = true;
  await canvas.press('t');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('World canvas has no visible bounds');
  const startX = bounds.x + bounds.width * 0.35;
  const endX = bounds.x + bounds.width * 0.65;
  const y = bounds.y + bounds.height * 0.5;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();
  await page
    .getByText(/Rail crosses a building at/)
    .first()
    .waitFor();
  results.railRejection = await page
    .getByText(/Rail crosses a building at/)
    .first()
    .innerText();
  results.noRailDraftControls =
    (await page.getByRole('group', { name: 'Rail construction' }).count()) ===
    0;
  if (!results.noRailDraftControls)
    throw new Error('Rail draft controls are still visible');
  await page.screenshot({
    path: 'docs/visual-baselines/world/rail-crossing-rejected.png',
  });
  await canvas.press('Escape');
  await page
    .getByRole('button', { name: 'Keyboard placement', exact: true })
    .click();
  await canvas.press('g');
  await page.waitForFunction(() =>
    document.querySelector('canvas[data-hookup-ghost]'),
  );
  const ghostBefore = await canvas.getAttribute('data-hookup-ghost');
  await canvas.evaluate((element) => {
    const extension = element
      .getContext('webgl2')
      .getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Context-loss extension unavailable');
    extension.loseContext();
    window.setTimeout(() => extension.restoreContext(), 500);
  });
  await page.getByText('3D world view unavailable', { exact: true }).waitFor();
  await page.getByText('3D world view unavailable', { exact: true }).waitFor({
    state: 'hidden',
    timeout: 120_000,
  });
  await canvas.waitFor({ timeout: 120_000 });
  const ghostAfter = await canvas.getAttribute('data-hookup-ghost');
  if (!ghostBefore || ghostBefore !== ghostAfter)
    throw new Error('Placement preview was lost during context restoration');
  results.contextRestoration = {
    ghostBefore,
    ghostAfter,
    minimap: await page.locator('.world-minimap-canvas').isVisible(),
  };
  results.errors = errors;
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(
    'docs/world-integration-review-results.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
