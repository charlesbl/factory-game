import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

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
  for (let x = from.x; x < to.x; x += 1) await surface.press('ArrowRight');
  for (let x = from.x; x > to.x; x -= 1) await surface.press('ArrowLeft');
  for (let y = from.y; y < to.y; y += 1) await surface.press('ArrowDown');
  for (let y = from.y; y > to.y; y -= 1) await surface.press('ArrowUp');
  expect(await readCursor(page)).toEqual(to);
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

const commitRailDraft = async (page: Page): Promise<void> => {
  // A real mouse click at the map action bar's commit button: raw input at the
  // button's coordinates, immune to the actionability scroll loop that hung on
  // this bar and to keyboard-activation quirks.
  const buildRail = page.getByRole('button', { name: 'Build rail' });
  await expect(buildRail).toBeEnabled();
  const box = await buildRail.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  // A cleared draft disables the button again; a rejected path leaves it armed.
  await expect(buildRail).toBeDisabled();
};

const drawRailPath = async (
  page: Page,
  points: readonly HookupCell[],
): Promise<void> => {
  await canvas(page).press('t');
  for (const point of points) {
    await moveCursor(page, point);
    await canvas(page).press('Enter');
  }
  await commitRailDraft(page);
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
  // Delivery direction: hub depot -> hub station -> this hookup cell.
  await drawRailPath(page, [
    { x: hubDepot!.x, y: hubDepot!.y },
    { x: hubStation!.x, y: hubDepot!.y },
    { x: hubStation!.x, y: hubStation!.y },
    { x: hook.x, y: hubStation!.y },
    hook,
  ]);
  // Return leg: rails are one-way, so pods need a route back to the hub
  // provider to reload. Runs one lane clear of the forward path.
  await drawRailPath(page, [
    hook,
    { x: hook.x + 1, y: hook.y },
    { x: hook.x + 1, y: hubStation!.y - 1 },
    { x: hubStation!.x - 1, y: hubStation!.y - 1 },
    { x: hubStation!.x - 1, y: hubStation!.y },
    { x: hubStation!.x, y: hubStation!.y },
  ]);
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
  const depotSite = { x: spawn.x + 6, y: spawn.y + 10 };
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
