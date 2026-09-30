import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { SerializedWorldState } from '../../src/world/serialization';
import type * as DatabaseModule from '../../src/persistence';
import type * as ClientModule from '../../src/world/client';
import type * as DomainModule from '../../src/domain';

type HookupDraw = {
  nodeId: string;
  kind: string;
  x: number;
  y: number;
  crane: boolean;
};

type HookupCell = { x: number; y: number };

const canvas = (page: Page): Locator =>
  page.locator('canvas[data-renderer-ready="true"]');

const openWorld = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  if ((await page.getByRole('button', { name: 'Pause world' }).count()) > 0)
    await page.getByRole('button', { name: 'Pause world' }).click();
};

const saveWorld = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Save world now' }).click();
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
};

const readCursor = async (page: Page): Promise<HookupCell> => {
  const text = await page
    .getByText(/^Cursor \d+, \d+/)
    .first()
    .innerText();
  const match = /(\d+), (\d+)/.exec(text);
  if (match === null) throw new Error(`Keyboard cursor missing in "${text}"`);
  return { x: Number(match[1]), y: Number(match[2]) };
};

const moveCursor = async (page: Page, to: HookupCell): Promise<void> => {
  const surface = canvas(page);
  const from = await readCursor(page);
  await surface.focus();
  for (let x = from.x; x < to.x; x += 1)
    await page.keyboard.press('ArrowRight');
  for (let x = from.x; x > to.x; x -= 1) await page.keyboard.press('ArrowLeft');
  for (let y = from.y; y < to.y; y += 1) await page.keyboard.press('ArrowDown');
  for (let y = from.y; y > to.y; y -= 1) await page.keyboard.press('ArrowUp');
  await expect.poll(() => readCursor(page)).toEqual(to);
};

const enableKeyboardPlacement = async (page: Page): Promise<void> => {
  const toggle = page.getByRole('button', {
    name: 'Keyboard placement',
    exact: true,
  });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true')
    await toggle.click();
};

const hookupDraws = async (page: Page): Promise<HookupDraw[]> =>
  JSON.parse((await canvas(page).getAttribute('data-hookup-draws')) ?? '[]');

const hookupGhost = (page: Page): Promise<string | null> =>
  canvas(page).getAttribute('data-hookup-ghost');

const placeStation = async (
  page: Page,
): Promise<{ site: HookupCell; hook: HookupCell }> => {
  await canvas(page).press('g');
  await enableKeyboardPlacement(page);
  const spawn = await readCursor(page);
  const site = { x: spawn.x + 8, y: spawn.y + 8 };
  const hook = { x: site.x + 1, y: site.y + 2 };
  await moveCursor(page, site);
  await expect.poll(() => hookupGhost(page)).toBe(`${hook.x},${hook.y},valid`);
  await canvas(page).press('Enter');
  await expect
    .poll(async () =>
      (await hookupDraws(page)).find(
        (draw) => draw.x === hook.x && draw.y === hook.y,
      ),
    )
    .toMatchObject({ kind: 'station', crane: true });
  // The hookup cell sits outside the 2x2 footprint (site..site+1).
  expect(hook.y).toBeGreaterThan(site.y + 1);
  return { site, hook };
};

const selectStation = async (
  page: Page,
  site: HookupCell,
  hook: HookupCell,
  state: 'connected' | 'not connected',
): Promise<void> => {
  await canvas(page).press('s');
  await moveCursor(page, site);
  await canvas(page).press('Enter');
  await expect(page.getByText('Rail hookup')).toBeVisible();
  await expect(page.getByText(`${hook.x}, ${hook.y} · ${state}`)).toBeVisible();
  await expect(canvas(page)).toHaveAttribute(
    'data-hookup-selected',
    `${hook.x},${hook.y}`,
  );
};

const placeRailLines = async (
  page: Page,
  points: readonly HookupCell[],
): Promise<void> => {
  // Keep this topology test focused on connections: each straight section is
  // one production worker command. Pointer release is exercised in world.spec.
  await page.evaluate(async (path) => {
    const databasePath = '/src/persistence/index.ts';
    const clientPath = '/src/world/client.ts';
    const domainPath = '/src/domain/index.ts';
    const { database } = (await import(databasePath)) as typeof DatabaseModule;
    const { WorldClient } = (await import(clientPath)) as typeof ClientModule;
    const { parseExact } = (await import(domainPath)) as typeof DomainModule;
    const saved = await database.worlds.get('main');
    if (!saved) throw new Error('World save is missing');
    const client = new WorldClient();
    try {
      await client.load(parseExact<SerializedWorldState>(saved.payload));
      for (let index = 1; index < path.length; index += 1) {
        const start = path[index - 1]!;
        const end = path[index]!;
        if (start.x !== end.x && start.y !== end.y)
          throw new Error('Each test rail line must be cardinal');
        await client.command({
          type: 'PLACE_RAIL_PATH',
          points: [start, end],
        });
      }
      const checkpoint = await client.save(true);
      if (checkpoint.payload === undefined)
        throw new Error('World worker did not return a save payload');
      await database.worlds.put({
        ...saved,
        revision: checkpoint.snapshot.revision,
        savedAt: new Date().toISOString(),
        payload: checkpoint.payload,
      });
    } finally {
      client.dispose();
    }
  }, points);
};

const reopenWorld = async (page: Page): Promise<void> => {
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await enableKeyboardPlacement(page);
};

const drawDeliveryRail = async (
  page: Page,
  hook: HookupCell,
): Promise<void> => {
  const draws = await hookupDraws(page);
  const mine = draws.find((draw) => draw.x === hook.x && draw.y === hook.y);
  expect(mine).toBeDefined();
  const hubStation = draws.find(
    (draw) => draw.kind === 'station' && draw.nodeId !== mine?.nodeId,
  );
  const hubDepot = draws.find((draw) => draw.kind === 'depot');
  expect(hubStation).toBeDefined();
  expect(hubDepot).toBeDefined();
  // Keep the trunk south of the starter buildings and approach the new
  // station from its eastern side, outside both occupied footprints.
  const delivery = [
    { x: hubDepot!.x, y: hubDepot!.y },
    { x: hubStation!.x, y: hubDepot!.y },
    { x: hubStation!.x, y: hubStation!.y },
    { x: hubStation!.x, y: hubDepot!.y },
    { x: hook.x + 1, y: hubDepot!.y },
    { x: hook.x + 1, y: hook.y },
    hook,
  ];
  await saveWorld(page);
  await placeRailLines(page, delivery);
  // The return direction shares the same clear corridor.
  await placeRailLines(page, [
    hook,
    { x: hook.x + 1, y: hook.y },
    { x: hook.x + 1, y: hubDepot!.y },
    { x: hubStation!.x, y: hubDepot!.y },
    { x: hubStation!.x, y: hubStation!.y },
  ]);
  await reopenWorld(page);
};

test('station hookup renders crane and marker outside its footprint', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openWorld(page);
  const { site, hook } = await placeStation(page);
  await page.screenshot({
    path: 'docs/visual-baselines/world/hookup-station-crane.png',
    fullPage: true,
  });
  await selectStation(page, site, hook, 'not connected');
  await saveWorld(page);
});

test('rail to the hookup cell connects and selection highlights the cell', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openWorld(page);
  const { site, hook } = await placeStation(page);
  await selectStation(page, site, hook, 'not connected');
  await drawDeliveryRail(page, hook);
  await selectStation(page, site, hook, 'connected');
  await page.screenshot({
    path: 'docs/visual-baselines/world/hookup-station-selected.png',
    fullPage: true,
  });
  await saveWorld(page);
});

test('depot shows its own hookup and blocked hookup reports the reason', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openWorld(page);
  const { site, hook } = await placeStation(page);
  await drawDeliveryRail(page, hook);
  const spawn = { x: site.x - 8, y: site.y - 8 };
  const depotSite = { x: spawn.x + 4, y: spawn.y + 8 };
  const depotHook = { x: depotSite.x + 2, y: depotSite.y + 4 };
  await canvas(page).press('p');
  await moveCursor(page, depotSite);
  await expect
    .poll(() => hookupGhost(page))
    .toBe(`${depotHook.x},${depotHook.y},valid`);
  expect(depotHook).not.toEqual(hook);
  await page.screenshot({
    path: 'docs/visual-baselines/world/hookup-depot-ghost.png',
    fullPage: true,
  });
  await canvas(page).press('Enter');
  await expect
    .poll(async () =>
      (await hookupDraws(page)).find(
        (draw) => draw.x === depotHook.x && draw.y === depotHook.y,
      ),
    )
    .toMatchObject({ kind: 'construction-site', crane: true });
  await saveWorld(page);
  await placeRailLines(page, [hook, { x: hook.x, y: depotHook.y }, depotHook]);
  await placeRailLines(page, [depotHook, { x: hook.x, y: depotHook.y }, hook]);
  await reopenWorld(page);
  await page.getByRole('button', { name: 'Play world' }).click();
  await page
    .locator('.world-time-controls')
    .getByRole('button', { name: /^20/ })
    .click();
  await expect
    .poll(
      async () =>
        (await hookupDraws(page)).find(
          (draw) =>
            draw.kind === 'depot' &&
            draw.x === depotHook.x &&
            draw.y === depotHook.y &&
            draw.crane,
        ),
      { timeout: 60_000 },
    )
    .toMatchObject({ kind: 'depot', crane: true });
  const depotNode = (await hookupDraws(page)).find(
    (draw) => draw.x === depotHook.x && draw.y === depotHook.y,
  );
  const stationNode = (await hookupDraws(page)).find(
    (draw) => draw.x === hook.x && draw.y === hook.y,
  );
  expect(depotNode?.nodeId).not.toBe(stationNode?.nodeId);
  await page.getByRole('button', { name: 'Pause world' }).click();
  const junction = { x: hook.x + 3, y: hook.y + 2 };
  const blockedSite = { x: junction.x - 1, y: junction.y - 2 };
  await canvas(page).press('j');
  await moveCursor(page, junction);
  await canvas(page).press('Enter');
  await canvas(page).press('g');
  await moveCursor(page, blockedSite);
  await expect
    .poll(() => hookupGhost(page))
    .toBe(`${junction.x},${junction.y},invalid`);
  await expect(
    page.getByText('The rail hookup cell is blocked.').first(),
  ).toBeVisible();
  await expect(
    page.getByText('Placement blocked', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'docs/visual-baselines/world/hookup-blocked-reason.png',
    fullPage: true,
  });
  await saveWorld(page);
});
