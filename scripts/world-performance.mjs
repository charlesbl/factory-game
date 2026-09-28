import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const origin = process.env.WORLD_URL ?? 'http://127.0.0.1:4173';
const fixture = JSON.parse(
  await readFile('benchmarks/generated/world-performance-v1.json', 'utf8'),
);
const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu'],
});
const results = {
  recordedAt: new Date().toISOString(),
  browser: browser.version(),
  viewport: { width: 1366, height: 768 },
  runs: [],
};
try {
  for (const quality of ['standard', 'low', 'high']) {
    const context = await browser.newContext({ viewport: results.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/?world-metrics');
    await page.evaluate(
      async ({ fixture, quality }) => {
        localStorage.setItem(
          'factory-world-ui-v1',
          JSON.stringify({ quality, reducedMotion: true }),
        );
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('factory-game-world-v1');
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('worlds', 'readwrite');
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
      },
      { fixture, quality },
    );
    const start = Date.now();
    await page.getByRole('button', { name: 'World', exact: true }).click();
    await page
      .locator('canvas[data-renderer-ready="true"]')
      .waitFor({ timeout: 120_000 });
    const readyMs = Date.now() - start;
    await page.getByRole('button', { name: 'Close inspector' }).click();
    const gpu = await page
      .locator('canvas[data-renderer-ready="true"]')
      .evaluate((canvas) => {
        const gl = canvas.getContext('webgl2');
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        return extension
          ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : 'unreported';
      });
    await page.waitForTimeout(5000);
    await page.evaluate(() => {
      performance.clearMeasures();
      const data = (window.worldMeasure = {
        frames: [],
        inputs: [],
        tasks: [],
        stats: [],
        started: performance.now(),
      });
      let last = performance.now();
      data.observer = new PerformanceObserver((list) => {
        data.tasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      data.observer.observe({ type: 'longtask', buffered: false });
      function frame(now) {
        data.frames.push(now - last);
        last = now;
        data.raf = requestAnimationFrame(frame);
      }
      data.raf = requestAnimationFrame(frame);
      data.timer = setInterval(() => {
        const value = document.querySelector('canvas[data-world-stats]')
          ?.dataset.worldStats;
        if (value) data.stats.push(JSON.parse(value));
      }, 1000);
    });
    for (let step = 0; step < 12; step++) {
      await page
        .getByRole('button', {
          name: step % 4 < 2 ? 'Rotate camera right' : 'Rotate camera left',
        })
        .click();
      if (step === 3 || step === 8)
        await page
          .getByRole('button', { name: 'Zoom out', exact: true })
          .click();
      if (step === 6 || step === 11)
        await page
          .getByRole('button', { name: 'Zoom in', exact: true })
          .click();
      if (step === 3)
        await page.locator('canvas[data-renderer-ready="true"]').press('j');
      if (step >= 3 && step <= 8) {
        const latency = await page.evaluate(async (step) => {
          const canvas = document.querySelector(
            'canvas[data-renderer-ready="true"]',
          );
          const rect = canvas.getBoundingClientRect();
          const started = performance.now();
          canvas.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              pointerType: 'mouse',
              clientX: rect.left + rect.width * 0.48 + step * 7,
              clientY: rect.top + rect.height * 0.53,
            }),
          );
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return performance.now() - started;
        }, step);
        await page.evaluate(
          (latency) => window.worldMeasure.inputs.push(latency),
          latency,
        );
        if (step === 6) {
          const rect = await page
            .locator('canvas[data-renderer-ready="true"]')
            .boundingBox();
          await page.mouse.click(
            rect.x + rect.width * 0.48 + step * 7,
            rect.y + rect.height * 0.53,
          );
        }
      }
      if (step === 8)
        await page
          .locator('canvas[data-renderer-ready="true"]')
          .press('Escape');
      await page.waitForTimeout(5000);
    }
    const measured = await page.evaluate(() => {
      const data = window.worldMeasure;
      cancelAnimationFrame(data.raf);
      clearInterval(data.timer);
      data.observer.disconnect();
      const frames = data.frames.slice(1).sort((a, b) => a - b);
      return {
        worker: performance
          .getEntriesByType('measure')
          .filter((entry) => entry.name.startsWith('world:'))
          .map((entry) => ({
            name: entry.name,
            duration: entry.duration,
            detail: entry.detail,
          })),
        elapsedMs: performance.now() - data.started,
        frameCount: frames.length,
        p95Ms: frames[Math.floor(frames.length * 0.95)],
        meanMs: frames.reduce((sum, v) => sum + v, 0) / frames.length,
        longTasks: data.tasks,
        localFeedbackUpperBoundMs: data.inputs,
        stats: data.stats,
      };
    });
    await mkdir('docs/visual-baselines/world', { recursive: true });
    await page.screenshot({
      path: `docs/visual-baselines/world/performance-${quality}.png`,
    });
    results.runs.push({ quality, gpu, readyMs, errors, ...measured });
    await writeFile(
      'docs/world-performance-results.json',
      JSON.stringify(results, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        quality,
        gpu,
        readyMs,
        p95Ms: measured.p95Ms,
        maxCalls: Math.max(...measured.stats.map((s) => s.calls)),
        longTasks: measured.longTasks.length,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
/* global indexedDB, window, document, requestAnimationFrame, cancelAnimationFrame, PointerEvent */
