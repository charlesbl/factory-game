import { expect, test } from '@playwright/test';

test('React development tracking keeps grid buffers out of canvas prop metadata', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const trackingWindow = window as unknown as {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown;
      canvasPropCounts: number[];
    };
    // Reproduce a DevTools-attached development session without installing
    // a Profiler component. React's prop metadata must stay small here too.
    trackingWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberRoot: () => undefined,
      onCommitFiberUnmount: () => undefined,
    };
    trackingWindow.canvasPropCounts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.name.includes('WorldCanvas')) continue;
        const details = (entry as PerformanceMeasure).detail as {
          devtools?: { properties?: unknown[] };
        } | null;
        const properties = details?.devtools?.properties;
        if (properties) trackingWindow.canvasPropCounts.push(properties.length);
      }
    }).observe({ type: 'measure', buffered: true });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('.world-three-host canvas');
  await expect(canvas).toHaveAttribute('data-renderer-ready', 'true', {
    timeout: 30_000,
  });
  // This checks React's prop tracking, not GPU throughput. Stop WebGL work so
  // a software-rendered CI browser does not spend the test budget drawing.
  await canvas.evaluate((element) => {
    (element as HTMLCanvasElement)
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context')!
      .loseContext();
  });
  await canvas.press('F3');
  await expect(page.locator('.world-profiler')).toBeVisible();
  const play = page.getByRole('button', { name: 'Play world' });
  if (await play.count()) await play.click();
  for (let commit = 0; commit < 3; commit++)
    await page.getByRole('button', { name: 'World settings' }).click();
  const counts = () =>
    page.evaluate(
      () =>
        (window as unknown as { canvasPropCounts: number[] }).canvasPropCounts,
    );
  // Require real metadata from multiple commits rather than a vacuous pass
  // when tracking is absent. Raw snapshots produced over 262,000 entries.
  await expect.poll(async () => (await counts()).length).toBeGreaterThan(2);
  expect(Math.max(...(await counts()))).toBeLessThan(100);
});

test('world object lists are mounted only while their browser and inspector are open', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('.world-three-host canvas');
  await expect(canvas).toHaveAttribute('data-renderer-ready', 'true', {
    timeout: 30_000,
  });
  await canvas.evaluate((element) => {
    (element as HTMLCanvasElement)
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context')!
      .loseContext();
  });
  const pause = page.getByRole('button', { name: 'Pause world' });
  if (await pause.count()) await pause.click();
  await expect(page.getByRole('button', { name: 'Play world' })).toBeVisible();

  const browser = page.locator('.world-object-browser');
  const lists = browser.locator('.world-entity-list');
  await expect(browser.locator('summary')).toBeVisible();
  // A closed native details element hides its descendants visually, but still
  // reconciles every row on each snapshot unless the contents are unmounted.
  await expect(lists).toHaveCount(0);
  await browser.locator('summary').click();
  await expect(lists.first()).toBeVisible();
  const entries = await browser.locator('li').count();
  expect(entries).toBeGreaterThan(0);

  await browser.locator('summary').click();
  await expect(lists).toHaveCount(0);
  await browser.locator('summary').click();
  await expect(browser.locator('li')).toHaveCount(entries);

  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(browser).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  // Preserve the browser's state when reopening the inspector.
  await expect(browser.locator('li')).toHaveCount(entries);
});
