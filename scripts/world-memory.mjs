import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { launchWorldBrowser } from './world-browser.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
};
const origin = process.env.WORLD_URL ?? 'http://127.0.0.1:4173';
const fixtureName = arg('--fixture', 'world-performance-v1');
const durationMs = Number(arg('--duration-ms', '120000'));
const quality = arg('--quality', 'standard');
const viewportText = arg('--viewport', '1366x768');
const deviceScaleFactor = Number(arg('--device-scale-factor', '1'));
const browserChannel = arg(
  '--browser-channel',
  process.env.WORLD_BROWSER_CHANNEL,
);
const outputPath = arg('--output', undefined);
const [viewportWidth, viewportHeight] = viewportText.split('x').map(Number);

if (
  !Number.isSafeInteger(durationMs) ||
  durationMs < 1_000 ||
  !['world-performance-v1', 'world-large-v1'].includes(fixtureName) ||
  !['low', 'standard', 'high', 'auto'].includes(quality) ||
  !Number.isSafeInteger(viewportWidth) ||
  !Number.isSafeInteger(viewportHeight) ||
  !Number.isFinite(deviceScaleFactor) ||
  deviceScaleFactor <= 0 ||
  deviceScaleFactor > 4 ||
  viewportWidth < 320 ||
  viewportHeight < 240
) {
  throw new Error(
    'Usage: node scripts/world-memory.mjs [--duration-ms 120000] [--fixture world-performance-v1|world-large-v1] [--quality standard] [--viewport 1366x768] [--device-scale-factor 1] [--browser-channel chrome|msedge] [--output new-report.json]',
  );
}

const fixturePath = `benchmarks/generated/${fixtureName}.json`;
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const machine = {
  platform: platform(),
  release: release(),
  cpu: cpus()[0]?.model,
  memoryBytes: totalmem(),
  node: process.version,
};

function parseLinuxMemory(text) {
  const value = (key) => {
    const match = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, 'm'));
    return match ? Number(match[1]) * 1024 : undefined;
  };
  return {
    rssBytes: value('Rss'),
    pssBytes: value('Pss'),
    privateBytes: (value('Private_Clean') ?? 0) + (value('Private_Dirty') ?? 0),
  };
}

async function sampleProcessMemory(processes) {
  const valid = processes
    .map((item) => ({ ...item, pid: item.pid ?? item.id }))
    .filter((item) => Number.isSafeInteger(item.pid));
  if (valid.length === 0)
    return { unavailable: 'Chromium process ids unavailable' };
  try {
    if (process.platform === 'linux') {
      const records = await Promise.all(
        valid.map(async (item) => ({
          type: item.type,
          pid: item.pid,
          ...parseLinuxMemory(
            await readFile(`/proc/${item.pid}/smaps_rollup`, 'utf8'),
          ),
        })),
      );
      return { processes: records };
    }
    if (process.platform === 'darwin') {
      const rows = execFileSync(
        'ps',
        ['-o', 'pid=,rss=,vsz=', '-p', valid.map((item) => item.pid).join(',')],
        { encoding: 'utf8', timeout: 2_000 },
      )
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((row) => row.trim().split(/\s+/).map(Number));
      return {
        processes: rows.map(([pid, rssKb, virtualKb]) => ({
          pid,
          rssBytes: rssKb * 1024,
          virtualBytes: virtualKb * 1024,
          type: valid.find((item) => item.pid === pid)?.type,
        })),
      };
    }
    if (process.platform === 'win32') {
      const ids = valid.map((item) => item.pid).join(',');
      const raw = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-Process -Id ${ids} | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8', timeout: 3_000, windowsHide: true },
      );
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return {
        processes: rows.map((item) => ({
          pid: item.Id,
          name: item.ProcessName,
          rssBytes: item.WorkingSet64,
          privateBytes: item.PrivateMemorySize64,
          type: valid.find((candidate) => candidate.pid === item.Id)?.type,
        })),
      };
    }
    return { unavailable: `Unsupported platform: ${process.platform}` };
  } catch (error) {
    return {
      unavailable: error instanceof Error ? error.message : String(error),
    };
  }
}

const browser = await launchWorldBrowser({ channel: browserChannel });
const context = await browser.newContext({
  viewport: { width: viewportWidth, height: viewportHeight },
  deviceScaleFactor,
});
const page = await context.newPage();
const errors = [];
const browserEvents = [];
const browserCdp = await browser.newBrowserCDPSession();
const pageCdp = await context.newCDPSession(page);
await pageCdp.send('Performance.enable');
let closingBrowser = false;
page.on('pageerror', (error) =>
  errors.push({ type: 'pageerror', message: error.message }),
);
page.on('console', (message) => {
  if (message.type() === 'error')
    errors.push({ type: 'console', message: message.text() });
});
page.on('crash', () =>
  browserEvents.push({ type: 'page-crash', at: new Date().toISOString() }),
);
browser.on('disconnected', () => {
  if (!closingBrowser)
    browserEvents.push({
      type: 'browser-disconnected',
      at: new Date().toISOString(),
    });
});
await page.addInitScript(() => {
  globalThis.window.__worldMemoryEvents = [];
  globalThis.document.addEventListener(
    'webglcontextlost',
    (event) => {
      globalThis.window.__worldMemoryEvents.push({
        type: 'webglcontextlost',
        at: performance.now(),
        statusMessage: event.statusMessage,
      });
    },
    true,
  );
  globalThis.document.addEventListener(
    'webglcontextrestored',
    () =>
      globalThis.window.__worldMemoryEvents.push({
        type: 'webglcontextrestored',
        at: performance.now(),
      }),
    true,
  );
});

const samples = [];
let processInfo = [];
const runStartedAt = Date.now();
let measurementStartedAt;
const report = {
  recordedAt: new Date().toISOString(),
  machine,
  browser: browser.version(),
  browserChannel: browserChannel ?? 'playwright-chromium',
  origin,
  fixture: fixtureName,
  quality,
  viewport: { width: viewportWidth, height: viewportHeight },
  deviceScaleFactor,
  durationMs,
  samples,
  errors,
  browserEvents,
};

try {
  await page.goto(`${origin}/?world-metrics`, {
    waitUntil: 'domcontentloaded',
  });
  await page.evaluate(
    async ({ fixture: saved, quality: selectedQuality }) => {
      globalThis.window.localStorage.setItem(
        'factory-world-ui-v1',
        JSON.stringify({ quality: selectedQuality, reducedMotion: true }),
      );
      await new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open('factory-game-world-v1');
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('worlds', 'readwrite');
          transaction.objectStore('worlds').put({
            ...saved,
            savedAt: new Date().toISOString(),
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    { fixture, quality },
  );
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await page
    .locator('canvas[data-renderer-ready="true"]')
    .waitFor({ timeout: 120_000 });
  report.worldReadyMs = Date.now() - runStartedAt;
  await page.getByRole('button', { name: 'Close inspector' }).click();
  try {
    processInfo = (await browserCdp.send('SystemInfo.getProcessInfo'))
      .processInfo;
  } catch (error) {
    report.processInfoError =
      error instanceof Error ? error.message : String(error);
  }
  try {
    report.gpuInfo = (await browserCdp.send('SystemInfo.getInfo')).gpu;
  } catch (error) {
    report.gpuInfoError =
      error instanceof Error ? error.message : String(error);
  }
  measurementStartedAt = Date.now();
  while (
    Date.now() - measurementStartedAt < durationMs &&
    !page.isClosed() &&
    !browserEvents.some((event) =>
      ['page-crash', 'browser-disconnected'].includes(event.type),
    )
  ) {
    const elapsedMs = Date.now() - measurementStartedAt;
    let pageMetrics;
    try {
      const response = await pageCdp.send('Performance.getMetrics');
      pageMetrics = Object.fromEntries(
        response.metrics
          .filter((metric) =>
            [
              'JSHeapUsedSize',
              'JSHeapTotalSize',
              'Documents',
              'Nodes',
              'LayoutCount',
            ].includes(metric.name),
          )
          .map((metric) => [metric.name, metric.value]),
      );
    } catch (error) {
      pageMetrics = {
        unavailable: error instanceof Error ? error.message : String(error),
      };
    }
    let pageState;
    try {
      pageState = await page.evaluate(() => {
        const canvas = globalThis.document.querySelector(
          'canvas[data-renderer-ready="true"]',
        );
        if (!canvas)
          return {
            canvas: null,
            events: globalThis.window.__worldMemoryEvents,
          };
        const rect = canvas.getBoundingClientRect();
        return {
          canvas: {
            cssWidth: rect.width,
            cssHeight: rect.height,
            backingWidth: canvas.width,
            backingHeight: canvas.height,
            devicePixelRatio: globalThis.window.devicePixelRatio,
            worldStats: canvas.dataset.worldStats
              ? JSON.parse(canvas.dataset.worldStats)
              : undefined,
            contextAttributes: canvas
              .getContext('webgl2')
              ?.getContextAttributes(),
          },
          memory: globalThis.performance.memory,
          events: globalThis.window.__worldMemoryEvents,
        };
      });
    } catch (error) {
      pageState = {
        unavailable: error instanceof Error ? error.message : String(error),
      };
    }
    samples.push({
      at: new Date().toISOString(),
      elapsedMs,
      page: pageMetrics,
      renderer: pageState,
      chromiumProcesses: await sampleProcessMemory(processInfo),
    });
    await page.waitForTimeout(1_000).catch(() => undefined);
  }
  report.elapsedMs = Date.now() - measurementStartedAt;
  const terminalEvent = browserEvents.find((event) =>
    ['page-crash', 'browser-disconnected'].includes(event.type),
  );
  if (terminalEvent !== undefined)
    samples.push({
      at: new Date().toISOString(),
      elapsedMs: report.elapsedMs,
      page: { unavailable: terminalEvent.type },
      renderer: { unavailable: 'Renderer stopped before the next sample' },
      chromiumProcesses: await sampleProcessMemory(processInfo),
    });
  report.processInfo = processInfo.map(({ type, id, pid, cpuTime }) => ({
    type,
    pid: pid ?? id,
    cpuTime,
  }));
} catch (error) {
  report.fatalError = error instanceof Error ? error.message : String(error);
  report.elapsedMs = Date.now() - (measurementStartedAt ?? runStartedAt);
  if (processInfo.length === 0) {
    try {
      processInfo = (await browserCdp.send('SystemInfo.getProcessInfo'))
        .processInfo;
    } catch (processError) {
      report.processInfoError =
        processError instanceof Error
          ? processError.message
          : String(processError);
    }
  }
  if (report.gpuInfo === undefined) {
    try {
      report.gpuInfo = (await browserCdp.send('SystemInfo.getInfo')).gpu;
    } catch (gpuError) {
      report.gpuInfoError =
        gpuError instanceof Error ? gpuError.message : String(gpuError);
    }
  }
  report.processInfo = processInfo.map(({ type, id, pid, cpuTime }) => ({
    type,
    pid: pid ?? id,
    cpuTime,
  }));
  samples.push({
    at: new Date().toISOString(),
    elapsedMs: report.elapsedMs,
    page: { unavailable: report.fatalError },
    renderer: {
      unavailable: 'Profile stopped before the next renderer sample',
    },
    chromiumProcesses: await sampleProcessMemory(processInfo),
  });
} finally {
  await pageCdp.detach().catch(() => undefined);
  await browserCdp.detach().catch(() => undefined);
  await context.close().catch(() => undefined);
  closingBrowser = true;
  await browser.close().catch(() => undefined);
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath === undefined) process.stdout.write(serialized);
else {
  await writeFile(outputPath, serialized, { flag: 'wx' });
  process.stdout.write(`Wrote memory profile to ${outputPath}\n`);
}
if (report.fatalError !== undefined) process.exitCode = 1;
