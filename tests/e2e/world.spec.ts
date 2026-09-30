import { expect, test } from '@playwright/test';
import type * as ClientModule from '../../src/world/client';
import type * as FixtureModule from '../../src/world/review-fixture';
import type * as SerializationModule from '../../src/world/serialization';

test('paused speed changes, failed saves and graphics recovery preserve the session', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/?world-metrics');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  if (await page.getByRole('button', { name: 'Play world' }).count())
    await page.getByRole('button', { name: 'Play world' }).click();
  await page.getByRole('button', { name: 'Pause world' }).click();
  await expect(page.getByRole('button', { name: 'Play world' })).toBeVisible();
  const checkpoint = () =>
    page.evaluate(
      async () =>
        new Promise<string>((resolve) => {
          const request = indexedDB.open('factory-game-world-v1');
          request.onsuccess = () => {
            const db = request.result;
            const read = db
              .transaction('worlds')
              .objectStore('worlds')
              .get('main');
            read.onsuccess = () => {
              db.close();
              resolve(JSON.parse(read.result.payload).logicalTime);
            };
          };
        }),
    );
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  const pausedAt = await checkpoint();
  expect(pausedAt).toMatch(/^\d+$/);
  await page
    .locator('.world-time-controls')
    .getByRole('button', { name: /^20/ })
    .click();
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  await page.waitForTimeout(1200);
  expect(await checkpoint()).toEqual(pausedAt);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'worlds')
        throw new DOMException('Injected write failure', 'QuotaExceededError');
      return Reflect.apply(original, this, args);
    };
  });
  await page.getByRole('button', { name: 'Save world now' }).click();
  await expect(page.locator('.world-save-state')).toHaveText('Save failed');
  await page.evaluate(() =>
    (window as unknown as { restorePut: () => void }).restorePut(),
  );
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  expect(await checkpoint()).toEqual(pausedAt);
  await canvas.evaluate((element) => {
    const extension = (element as HTMLCanvasElement)
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context')!;
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 200);
  });
  await expect(page.getByText(/graphics context was lost/)).toBeVisible();
  await expect(page.getByText(/graphics context was lost/)).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  expect(await checkpoint()).toEqual(pausedAt);
});

test('missing assets retry and WebGL capability fallback keep world controls usable', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.route('**/assets/world/manifest.json', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry models' }),
  ).toBeVisible();
  await expect(page.locator('canvas[data-first-frame="true"]')).toBeVisible();
  await page.unroute('**/assets/world/manifest.json');
  await page.getByRole('button', { name: 'Retry models' }).click();
  await expect(page.locator('canvas[data-renderer-ready="true"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        return type === 'webgl2'
          ? null
          : Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(page.getByText('3D world view unavailable')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save world now' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Save world now' }).click();
  await expect(page.locator('.world-save-state')).not.toHaveText('Save failed');
});

test('releases a hidden world renderer after 30 seconds and restores it on return', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Rotate camera right' }).click();
  await page.getByRole('button', { name: 'World settings' }).click();
  await page.getByLabel('Graphics quality').selectOption('high');
  await page.clock.fastForward(200);
  const cameraKey = await page.evaluate(() =>
    Object.keys(localStorage).find((key) =>
      key.startsWith('factory-world-camera-v1:'),
    ),
  );
  expect(cameraKey).toBeDefined();
  const cameraBeforeRelease = await page.evaluate((key) => {
    if (key === undefined) return null;
    return localStorage.getItem(key);
  }, cameraKey);

  await page.getByRole('button', { name: 'Factory', exact: true }).click();
  await page.clock.fastForward(5_000);
  await expect(canvas).toHaveCount(1);
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(canvas).toBeVisible();

  await page.getByRole('button', { name: 'Factory', exact: true }).click();
  await page.clock.fastForward(30_000);
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Graphics quality')).toHaveValue('high');
  await page.clock.fastForward(200);
  const cameraAfterReturn = await page.evaluate((key) => {
    if (key === undefined) return null;
    return localStorage.getItem(key);
  }, cameraKey);
  expect(JSON.parse(cameraAfterReturn!)).toEqual(
    JSON.parse(cameraBeforeRelease!),
  );
});

test('real worker sends extraction and place/remove/rebuild occupancy deltas', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const clientPath = '/src/world/client.ts';
    const fixturePath = '/src/world/review-fixture.ts';
    const serializationPath = '/src/world/serialization.ts';
    const { WorldClient } = (await import(clientPath)) as typeof ClientModule;
    const { createReviewFixture } = (await import(
      fixturePath
    )) as typeof FixtureModule;
    const { serializeWorldRuntime } = (await import(
      serializationPath
    )) as typeof SerializationModule;
    const { runtime, oreIndex } = createReviewFixture();
    const client = new WorldClient();
    try {
      const before = await client.load(serializeWorldRuntime(runtime));
      const extracted = await client.advance(2_000_000n);
      const placed = await client.command({
        type: 'PLACE_CONTROL_NODE',
        kind: 'station',
        position: { x: 20, y: 20 },
      });
      const entity = placed.snapshot.entities.find(
        (item) =>
          item.transform.position.x === 20 && item.transform.position.y === 20,
      )!;
      const removed = await client.command({
        type: 'REMOVE_ENTITY',
        entityId: entity.id,
      });
      const rebuilt = await client.command({
        type: 'PLACE_CONTROL_NODE',
        kind: 'station',
        position: { x: 20, y: 20 },
      });
      const checkpoint = await client.save();
      const restored = await client.load(checkpoint.state!);
      return {
        before: before.snapshot.grid.oreRemaining[oreIndex],
        after: extracted.snapshot.grid.oreRemaining[oreIndex],
        changes: extracted.snapshot.presentationOreChanges,
        drillIds: extracted.snapshot.drillExtractionIds,
        oldOccupancy: before.snapshot.grid.occupancy[1300],
        placed: placed.snapshot.grid.occupancy[1300],
        removed: removed.snapshot.grid.occupancy[1300],
        rebuilt: rebuilt.snapshot.grid.occupancy[1300],
        restored: restored.snapshot.grid.occupancy[1300],
        logicalTime: restored.snapshot.logicalTime.toString(),
      };
    } finally {
      client.dispose();
    }
  });
  expect(result.before).toBe(1);
  expect(result.after).toBe(0);
  expect(result.changes).toContainEqual({ index: 656, remaining: 0 });
  expect(result.drillIds).toContain('review-drill');
  expect(result.oldOccupancy).toBe(0);
  expect(result.placed).toBeGreaterThan(0);
  expect(result.removed).toBe(0);
  expect(result.rebuilt).toBeGreaterThan(result.placed!);
  expect(result.restored).toBe(result.rebuilt);
  expect(result.logicalTime).toBe('2000000');
});

test('3D readiness, camera persistence, keyboard placement, cancellation and narrow layout', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.getByRole('button', { name: 'Rotate camera right' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).find((key) =>
            key.startsWith('factory-world-camera-v1:'),
          ) ?? null,
      ),
    )
    .not.toBeNull();
  await page
    .getByRole('button', { name: 'Keyboard placement', exact: true })
    .click();
  await canvas.press('g');
  await canvas.press('ArrowDown');
  await expect(page.getByText(/Cursor \d+, \d+/)).toBeVisible();
  await canvas.press('Escape');
  await expect(
    page
      .getByRole('navigation', { name: 'Build tools' })
      .getByRole('button', { name: 'Select S' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'World settings' }).click();
  await page.getByRole('button', { name: 'Generate new world' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(canvas).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'docs/visual-baselines/world/narrow.png' });
  expect(errors).toEqual([]);
});

test('camera and cancelled touch gestures cannot place a junction; keyboard confirmation can', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  if (await page.getByRole('button', { name: 'Pause world' }).count())
    await page.getByRole('button', { name: 'Pause world' }).click();
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  const nodes = async () =>
    page.evaluate(async () => {
      const modulePath = '/src/persistence/index.ts';
      const { database } = await import(modulePath);
      return JSON.parse((await database.worlds.get('main')).payload).railNodes
        .length as number;
    });
  const before = await nodes();
  await canvas.press('j');
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width * 0.5,
    y = box.y + box.height * 0.52;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 80, y + 40, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(x - 60, y, { steps: 5 });
  await page.keyboard.up('Space');
  await page.mouse.up();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x, y, id: 1 },
      { x: x + 60, y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: x - 30, y: y + 20, id: 1 },
      { x: x + 90, y: y + 20, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect(
    page.getByRole('group', { name: 'Confirm touch action' }),
  ).toHaveCount(0);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  await page.getByRole('button', { name: 'Save world now' }).click();
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  expect(await nodes()).toBe(before);
  await page
    .getByRole('button', { name: 'Keyboard placement', exact: true })
    .click();
  await canvas.press('ArrowDown');
  await canvas.press('Enter');
  await expect.poll(nodes).toBe(before + 1);
});

test('delayed writes and failed replacement preserve the last valid session and checkpoint', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/application/world/WorldSession.ts';
    const fixturePath = '/src/world/review-fixture.ts';
    const serializationPath = '/src/world/serialization.ts';
    const domainPath = '/src/domain/index.ts';
    const databasePath = '/src/persistence/index.ts';
    const { WorldSession } = await import(sessionPath);
    const { createReviewFixture } = await import(fixturePath);
    const { serializeWorldRuntime } = await import(serializationPath);
    const { stringifyExact } = await import(domainPath);
    const { database } = await import(databasePath);
    const runtime = createReviewFixture().runtime;
    runtime.setTimeControl(true, 1);
    await database.worlds.put({
      id: 'main',
      schemaVersion: 2,
      revision: runtime.revision,
      savedAt: new Date().toISOString(),
      payload: stringifyExact(serializeWorldRuntime(runtime)),
    });
    const session = new WorldSession();
    const release = session.retain();
    const wait = (predicate: () => boolean) =>
      new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (predicate()) {
            clearInterval(timer);
            resolve();
          }
        }, 10);
      });
    const originalPut = database.worlds.put.bind(database.worlds);
    try {
      await wait(() => !session.store.getSnapshot().busy);
      const initial = session.store.getSnapshot().snapshot;
      await session.setTime(false, 1);
      let writtenAt = 0;
      database.worlds.put = async (record: unknown) => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        writtenAt = Date.now();
        return originalPut(record);
      };
      await session.run(
        (client: InstanceType<typeof ClientModule.WorldClient>) =>
          client.save(true),
      );
      const stored = await database.worlds.get('main');
      const checkpointDelay = writtenAt - Date.parse(stored.savedAt);
      database.worlds.put = originalPut;
      await session.setTime(true, 1);
      const beforeFailed = (await database.worlds.get('main')).payload;
      await session.replace({
        ...initial.generation.config,
        width: 0,
        height: 0,
      });
      return {
        checkpointDelay,
        sameWorld:
          session.store.getSnapshot().snapshot.worldId === initial.worldId,
        error: session.store.getSnapshot().error,
        preserved: (await database.worlds.get('main')).payload === beforeFailed,
      };
    } finally {
      database.worlds.put = originalPut;
      release();
    }
  });
  expect(result.checkpointDelay).toBeGreaterThanOrEqual(240);
  expect(result.sameWorld).toBe(true);
  expect(result.error).toBeTruthy();
  expect(result.preserved).toBe(true);
});

test('real worker connects explicit junctions, deduplicates paths and rolls back rejected drafts', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const clientPath = '/src/world/client.ts',
      fixturePath = '/src/world/review-fixture.ts',
      serializationPath = '/src/world/serialization.ts';
    const { WorldClient } = (await import(clientPath)) as typeof ClientModule;
    const { createReviewFixture } = (await import(
      fixturePath
    )) as typeof FixtureModule;
    const { serializeWorldRuntime } = (await import(
      serializationPath
    )) as typeof SerializationModule;
    const client = new WorldClient();
    try {
      await client.load(serializeWorldRuntime(createReviewFixture().runtime));
      const horizontal = await client.command({
        type: 'PLACE_RAIL_PATH',
        points: [
          { x: 20, y: 20 },
          { x: 24, y: 20 },
        ],
      });
      const firstEdge = horizontal.snapshot.railEdges.at(-1)!;
      const crossed = await client.command({
        type: 'PLACE_RAIL_PATH',
        points: [
          { x: 22, y: 18 },
          { x: 22, y: 22 },
        ],
      });
      const marked = await client.command({
        type: 'PLACE_CONTROL_NODE',
        kind: 'junction',
        position: { x: 22, y: 20 },
      });
      const junction = marked.snapshot.railNodes.find(
        (node) => node.position.x === 22 && node.position.y === 20,
      )!;
      const oldEdge = crossed.snapshot.railEdges.find(
        (edge) => edge.id === firstEdge.id,
      )!;
      const connected = await client.command({
        type: 'PLACE_RAIL_PATH',
        points: [
          { x: 22, y: 20 },
          { x: 24, y: 20 },
        ],
      });
      const shared = connected.snapshot.railEdges.filter(
        (edge) => edge.from === junction.id || edge.to === junction.id,
      ).length;
      const before = await client.save(true);
      let rejected = false;
      try {
        await client.command({
          type: 'PLACE_RAIL_PATH',
          points: [
            { x: 20, y: 16 },
            { x: 22, y: 16 },
            { x: 25, y: 17 },
          ],
        });
      } catch {
        rejected = true;
      }
      const after = await client.save(true);
      return {
        independent: oldEdge.from !== junction.id && oldEdge.to !== junction.id,
        shared,
        duplicateRemoved:
          connected.snapshot.railEdges.length ===
          marked.snapshot.railEdges.length,
        rejected,
        unchanged: before.payload === after.payload,
      };
    } finally {
      client.dispose();
    }
  });
  expect(result).toEqual({
    independent: true,
    shared: 4,
    duplicateRemoved: true,
    rejected: true,
    unchanged: true,
  });
});

test('each rail drag places one line immediately and leaves the rail tool active', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const trackedWindow = window as unknown as Window & {
      railPaths: { x: number; y: number }[][];
    };
    trackedWindow.railPaths = [];
    const workerPrototype = Worker.prototype as unknown as {
      postMessage: (...args: unknown[]) => void;
    };
    const original = workerPrototype.postMessage;
    workerPrototype.postMessage = function (this: Worker, ...args: unknown[]) {
      const message = args[0] as
        | {
            type?: string;
            points?: { x: number; y: number }[];
          }
        | undefined;
      if (message?.type === 'PLACE_RAIL_PATH')
        trackedWindow.railPaths.push(message.points ?? []);
      return Reflect.apply(original, this, args);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Close inspector' }).click();
  const rail = page
    .getByRole('navigation', { name: 'Build tools' })
    .getByRole('button', { name: 'Rail T' });
  await rail.click();
  await expect(rail).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('group', { name: 'Rail construction' }),
  ).toHaveCount(0);
  await expect(page.locator('.world-map-caption')).toContainText(
    'Drag to draw · release to place',
  );
  const edges = async () =>
    page.evaluate(async () => {
      const path = '/src/persistence/index.ts';
      const { database } = await import(path);
      return JSON.parse((await database.worlds.get('main')).payload).railEdges
        .length as number;
    });
  const railCommands = () =>
    page.evaluate(
      () =>
        (window as unknown as Window & { railPaths: unknown[] }).railPaths
          .length,
    );
  const railPaths = () =>
    page.evaluate(
      () =>
        (
          window as unknown as Window & {
            railPaths: { x: number; y: number }[][];
          }
        ).railPaths,
    );
  const before = await edges();
  const box = (await canvas.boundingBox())!;
  const startX = box.x + box.width * 0.4;
  const startY = box.y + box.height * 0.5;
  const endX = startX + 120;
  const endY = startY + 30;
  const dragRail = async (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) => {
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 5 });
    await page.mouse.up();
  };
  await dragRail(startX, startY, endX, endY);
  await expect.poll(railCommands).toBe(1);
  await expect.poll(edges).toBeGreaterThan(before);
  const firstPath = (await railPaths())[0]!;
  expect(firstPath).toHaveLength(2);
  expect(
    firstPath[0]!.x === firstPath[1]!.x || firstPath[0]!.y === firstPath[1]!.y,
  ).toBe(true);
  const afterFirstLine = await edges();
  await dragRail(endX, endY, startX, startY);
  await expect.poll(railCommands).toBe(2);
  await expect.poll(edges).toBeGreaterThan(afterFirstLine);
  await expect(rail).toHaveAttribute('aria-pressed', 'true');

  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: endX, y: endY, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect.poll(railCommands).toBe(3);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: endX, y: endY, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  await expect.poll(railCommands).toBe(3);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: startX, y: startY, id: 1 },
      { x: startX + 40, y: startY, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: startX - 20, y: startY + 10, id: 1 },
      { x: startX + 60, y: startY + 10, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect.poll(railCommands).toBe(3);
  await cdp.detach();

  await page
    .getByRole('button', { name: 'Keyboard placement', exact: true })
    .click();
  await canvas.press('Enter');
  for (let i = 0; i < 4; i++) await canvas.press('ArrowRight');
  await canvas.press('Enter');
  await expect.poll(railCommands).toBe(2);
  await expect.poll(edges).toBeGreaterThan(afterFirstLine);
});

test('late real-worker ghost validation is ignored after rotation, cancellation and world replacement', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/application/world/WorldSession.ts';
    const { WorldSession } = await import(path);
    const modelPath = '/src/world/model.ts';
    const { defaultWorldGenerationConfig } = await import(modelPath);
    const session = new WorldSession(),
      release = session.retain();
    const until = async (condition: () => boolean) => {
      const deadline = Date.now() + 10_000;
      while (!condition()) {
        if (Date.now() > deadline) throw Error('Validation test timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    try {
      await until(
        () =>
          !!session.store.getSnapshot().snapshot &&
          !session.store.getSnapshot().busy,
      );
      const gates: (() => void)[] = [],
        received: string[] = [];
      const client = session.client,
        command = client.command.bind(client);
      client.command = async (input: { type: string }) => {
        const response = await command(input);
        if (input.type === 'VALIDATE_GHOST')
          await new Promise<void>((resolve) => gates.push(resolve));
        return response;
      };
      const intent = {
        type: 'VALIDATE_GHOST',
        targetKind: 'junction',
        position: { x: 2, y: 2 },
        size: { width: 1, height: 1 },
        rotation: 0,
      };
      session.validateLatest(intent, () => received.push('old rotation'));
      await until(() => gates.length === 1);
      session.validateLatest({ ...intent, rotation: 1 }, () =>
        received.push('current rotation'),
      );
      gates[0]!();
      await until(() => gates.length === 2);
      gates[1]!();
      await until(() => received.length === 1);
      const cancel = session.validateLatest(intent, () =>
        received.push('cancelled tool'),
      );
      await until(() => gates.length === 3);
      cancel();
      gates[2]!();
      await until(() => !session.validationInFlight);
      session.validateLatest(intent, () => received.push('old world'));
      await until(() => gates.length === 4);
      const replacement = session.replace({
        ...defaultWorldGenerationConfig('replacement-validation'),
        width: 64,
        height: 64,
      });
      gates[3]!();
      await replacement;
      return { received, generation: session.store.getSnapshot().generation };
    } finally {
      release();
    }
  });
  expect(result.received).toEqual(['current rotation']);
  expect(result.generation).toBe(1);
});

test('separate worker rail builds join a mid-edge endpoint and simplify after save/reload', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const clientPath = '/src/world/client.ts',
      fixturePath = '/src/world/review-fixture.ts',
      serializationPath = '/src/world/serialization.ts';
    const { WorldClient } = await import(clientPath);
    const { createReviewFixture } = await import(fixturePath);
    const { serializeWorldRuntime, deserializeWorldRuntime } = await import(
      serializationPath
    );
    const client = new WorldClient();
    try {
      await client.load(serializeWorldRuntime(createReviewFixture().runtime));
      const build = (points: { x: number; y: number }[]) =>
        client.command({ type: 'PLACE_RAIL_PATH', points });
      const before = await client.save();
      await build([
        { x: 20, y: 20 },
        { x: 30, y: 20 },
      ]);
      await build([
        { x: 25, y: 15 },
        { x: 25, y: 20 },
      ]);
      await build([
        { x: 30, y: 20 },
        { x: 35, y: 20 },
      ]);
      const extended = await client.save();
      const restored = await client.load(extended.state);
      const runtime = deserializeWorldRuntime(extended.state);
      const start = restored.snapshot.railNodes.find(
        (n: { position: { x: number; y: number } }) =>
          n.position.x === 25 && n.position.y === 15,
      );
      const end = restored.snapshot.railNodes.find(
        (n: { position: { x: number; y: number } }) =>
          n.position.x === 35 && n.position.y === 20,
      );
      const joined = restored.snapshot.railNodes.find(
        (n: { position: { x: number; y: number } }) =>
          n.position.x === 25 && n.position.y === 20,
      );
      const duplicate = await build([
        { x: 25, y: 20 },
        { x: 35, y: 20 },
      ]);
      return {
        distance: runtime.rails.route(start.id, end.id)?.distance,
        edgesAdded:
          extended.state.railEdges.length - before.state.railEdges.length,
        joinedBranches: restored.snapshot.railEdges.filter(
          (e: { from: string; to: string }) =>
            e.from === joined.id || e.to === joined.id,
        ).length,
        duplicateIgnored:
          duplicate.snapshot.railEdges.length ===
          restored.snapshot.railEdges.length,
        removedIntermediate: !restored.snapshot.railNodes.some(
          (n: { position: { x: number; y: number } }) =>
            n.position.x === 30 && n.position.y === 20,
        ),
      };
    } finally {
      client.dispose();
    }
  });
  expect(result).toEqual({
    distance: 15,
    edgesAdded: 3,
    joinedBranches: 3,
    duplicateIgnored: true,
    removedIntermediate: true,
  });
});
