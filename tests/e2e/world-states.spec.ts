import { expect, test, type Page } from '@playwright/test';
import type * as DomainModule from '../../src/domain/index';
import type * as PersistenceModule from '../../src/persistence/index';
import type * as SerializationModule from '../../src/world/serialization';
import type * as FixtureModule from '../../src/world/states-fixture';

test.setTimeout(240_000);

interface Tile {
  readonly x: number;
  readonly y: number;
}

interface FixtureLayout {
  readonly waiting: Tile;
  readonly blocked: Tile;
  readonly mine: Tile;
  readonly drill: Tile;
  readonly chainFirst: Tile;
  readonly chainSecond: Tile;
  readonly disconnected: Tile;
  readonly wrongOre: Tile;
  readonly exhaustedOre: Tile;
  readonly mineHeadPosition: Tile;
  readonly mineHeadStation: Tile;
  readonly waitingStation: Tile;
  readonly mineStation: Tile;
  readonly constructionSite: Tile;
  readonly completeSite: Tile;
  readonly ids: {
    readonly waitingFactory: string;
    readonly blockedFactory: string;
    readonly mine: string;
    readonly drill: string;
    readonly mineHeadStation: string;
    readonly constructionSite: string;
    readonly completeSite: string;
  };
}

/** Seed the deterministic states fixture as the persisted 'main' world. */
const seedWorld = (page: Page): Promise<FixtureLayout> =>
  page.evaluate(async () => {
    const fixturePath = '/src/world/states-fixture.ts';
    const serializationPath = '/src/world/serialization.ts';
    const domainPath = '/src/domain/index.ts';
    const databasePath = '/src/persistence/index.ts';
    const { createStatesFixture } = (await import(
      fixturePath
    )) as typeof FixtureModule;
    const { serializeWorldRuntime } = (await import(
      serializationPath
    )) as typeof SerializationModule;
    const { stringifyExact } = (await import(
      domainPath
    )) as typeof DomainModule;
    const { database } = (await import(
      databasePath
    )) as typeof PersistenceModule;
    const fixture = createStatesFixture();
    fixture.runtime.setTimeControl(true, 1);
    await database.worlds.put({
      id: 'main',
      schemaVersion: 2,
      revision: fixture.runtime.revision,
      savedAt: new Date().toISOString(),
      payload: stringifyExact(serializeWorldRuntime(fixture.runtime)),
    });
    return {
      waiting: fixture.positions.waitingFactory,
      blocked: fixture.positions.blockedFactory,
      mine: fixture.positions.mine,
      drill: fixture.positions.drill,
      chainFirst: fixture.tiles.chainFirst,
      chainSecond: fixture.tiles.chainSecond,
      disconnected: fixture.tiles.disconnected,
      wrongOre: fixture.tiles.wrongOre,
      exhaustedOre: fixture.tiles.exhaustedOre,
      mineHeadPosition: fixture.tiles.mineHeadPosition,
      mineHeadStation: fixture.tiles.mineHeadStation,
      waitingStation: fixture.positions.waitingStation,
      mineStation: fixture.positions.mineStation,
      constructionSite: fixture.positions.constructionSite,
      completeSite: fixture.positions.completeSite,
      ids: {
        waitingFactory: String(fixture.ids.waitingFactory),
        blockedFactory: String(fixture.ids.blockedFactory),
        mine: String(fixture.ids.mine),
        drill: String(fixture.ids.drill),
        mineHeadStation: String(fixture.ids.mineHeadStation),
        constructionSite: String(fixture.ids.constructionSite),
        completeSite: String(fixture.ids.completeSite),
      },
    } as FixtureLayout;
  });

test('stopped machinery reports only known facts and placement rules reject invalid mine/drill targets', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // Let the boot autosave settle so the seeded record cannot be overwritten.
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  const layout = await seedWorld(page);
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  const entityButton = (kind: string, at: Tile) =>
    page.getByRole('button', {
      name: `${kind} · ${at.x}, ${at.y}`,
      exact: true,
    });
  // The seeded fixture world is on screen (guards against save races).
  await expect(entityButton('factory', layout.waiting)).toBeVisible();
  // The seeded world presents as paused and only offers to resume.
  await expect(page.getByRole('button', { name: 'Play world' })).toBeVisible();

  const card = page.locator('.world-building-card');
  const causeLanguage = /downstream|because|caused|starved|blocked by/i;

  // ---- Stopped factory: waiting for input ----
  await entityButton('factory', layout.waiting).click();
  await expect(card).toContainText('Selected factory');
  await expect(card.locator('.world-building-status .badge')).toHaveText(
    'waiting input',
  );
  await expect(card).toContainText('Machine state');
  await expect(card).toContainText('Input buffers');
  await expect(card).toContainText(/Input buffers[\s\S]*?0 \/ \d+/);
  // The inspector names the missing input resource.
  await expect(card).toContainText('Iron ore');
  await expect(card).not.toContainText(causeLanguage);

  // ---- Stopped factory: output blocked on a full, undeliverable output ----
  await entityButton('factory', layout.blocked).click();
  await expect(card).toContainText('Selected factory');
  await expect(card.locator('.world-building-status .badge')).toHaveText(
    'output blocked',
  );
  await expect(card).toContainText('Output buffers');
  // Known buffer fact: the output buffer is full.
  await expect(card).toContainText(/Output buffers[\s\S]*?(\d+) \/ \1/);
  await expect(card).not.toContainText(causeLanguage);

  // ---- Mine: full extraction output with a stopped, ACTIVE drill ----
  await entityButton('mine', layout.mine).click();
  await expect(card).toContainText('Selected mine');
  await expect(card).toContainText('Extraction output');
  await expect(card).toContainText(/Extraction output[\s\S]*?(\d+) \/ \1/);
  await expect(card).toContainText('Active drills');
  await expect(card).not.toContainText(causeLanguage);

  await entityButton('drill', layout.drill).click();
  await expect(card).toContainText('Selected drill');
  await expect(card).toContainText('Ore remaining');
  await expect(card).toContainText('400'); // 500 seeded - 1 reported extraction
  // Drill state and ore identity are source-backed facts.
  await expect(
    card
      .locator('dl.world-building-counts')
      .filter({ hasText: 'Ore remaining' }),
  ).toContainText(/State\s*active/);
  await expect(card).toContainText('Iron ore');
  await expect(card).toContainText('Mine output');
  // Known blockage fact: the mine output buffer is full.
  await expect(card).toContainText(/Mine output[\s\S]*?(\d+) \/ \1/);
  await expect(card).toContainText('Output blockage');
  await expect(card).toContainText('Mine output full');
  await expect(card).not.toContainText(causeLanguage);
  // No activity is claimed while extraction is stopped.
  await expect(card).not.toContainText(
    /extracting|moving|working|producing|running/i,
  );

  // ---- Placement rules through the real UI ----
  await entityButton('mine', layout.mine).click();
  await canvas.press('d'); // drill tool, bound to the selected mine
  await page
    .getByRole('button', { name: 'Keyboard placement', exact: true })
    .click();

  const readCursor = async (): Promise<Tile> => {
    const text =
      (await page.locator('.world-keyboard-cursor').textContent()) ?? '';
    const match = /Cursor (\d+), (\d+)/.exec(text);
    if (match === null)
      throw new Error(`keyboard cursor text missing: ${text}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  };
  // Learn the arrow mapping empirically; robust to any sign convention.
  const start = await readCursor();
  await canvas.press('ArrowRight');
  const right = await readCursor();
  await canvas.press('ArrowDown');
  const down = await readCursor();
  const deltas: Record<string, Tile> = {
    ArrowRight: { x: right.x - start.x, y: right.y - start.y },
    ArrowDown: { x: down.x - right.x, y: down.y - right.y },
    ArrowLeft: { x: start.x - right.x, y: start.y - right.y },
    ArrowUp: { x: right.x - down.x, y: right.y - down.y },
  };
  const moveCursorTo = async (target: Tile): Promise<void> => {
    for (let step = 0; step < 160; step += 1) {
      const current = await readCursor();
      if (current.x === target.x && current.y === target.y) return;
      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const key = Object.entries(deltas).find(
        ([, d]) =>
          (d.x !== 0 && dx !== 0 && Math.sign(d.x) === Math.sign(dx)) ||
          (d.y !== 0 && dy !== 0 && Math.sign(d.y) === Math.sign(dy)),
      )?.[0];
      if (key === undefined)
        throw new Error('no arrow key moves toward the target');
      await canvas.press(key);
    }
    throw new Error(
      `cursor navigation stalled before ${target.x}, ${target.y}`,
    );
  };

  const feedback = page.locator('.world-placement-feedback');
  const alerts = page.locator('.world-alerts').first();
  const errorAlert = page.getByRole('alert').first();
  const boundMineText = async (): Promise<string> => {
    const text = (await feedback.textContent()) ?? '';
    return /Bound mine: \S+/.exec(text)?.[0] ?? '';
  };

  // A second drill that touches neither mine nor chain is rejected, before AND
  // after the first placement.
  await moveCursorTo(layout.chainSecond);
  await expect(feedback).toContainText('Placement blocked');
  await expect(feedback).toContainText(
    'Drills must touch the selected mine or its drill chain.',
  );
  await canvas.press('Enter');
  await expect(alerts).toContainText(
    'Drill must touch the mine or another drill',
  );
  await expect(errorAlert).toContainText(
    'Drill must touch the mine or another drill',
  );
  await expect(entityButton('drill', layout.chainSecond)).toHaveCount(0);

  // The first drill touches the mine directly.
  await moveCursorTo(layout.chainFirst);
  await expect(feedback).toContainText('Placement ready');
  const firstBound = await boundMineText();
  expect(firstBound).toContain('Bound mine: ');
  await canvas.press('Enter');
  await expect(entityButton('drill', layout.chainFirst)).toBeVisible();

  // The second drill chains to the first drill; the mine binding is unchanged.
  await moveCursorTo(layout.chainSecond);
  await expect(feedback).toContainText('Placement ready');
  expect(await boundMineText()).toBe(firstBound);
  await canvas.press('Enter');
  await expect(entityButton('drill', layout.chainSecond)).toBeVisible();
  // After the commit the cursor sits on the new drill: the feedback reports the
  // local placement state instead of the tool requirement again. The unchanged
  // mine binding is the pre-commit requirement text compared above.
  await expect(feedback).toContainText('Placement blocked');

  // Disconnected, wrong-ore and exhausted-ore targets keep their exact reasons.
  await moveCursorTo(layout.disconnected);
  await expect(feedback).toContainText('Placement blocked');
  await expect(feedback).toContainText(
    'Drills must touch the selected mine or its drill chain.',
  );
  await canvas.press('Enter');
  await expect(alerts).toContainText(
    'Drill must touch the mine or another drill',
  );
  await expect(entityButton('drill', layout.disconnected)).toHaveCount(0);
  await moveCursorTo(layout.wrongOre);
  await expect(feedback).toContainText('Placement blocked');
  await expect(feedback).toContainText(
    'The deposit must match the selected mine resource.',
  );
  await moveCursorTo(layout.exhaustedOre);
  await expect(feedback).toContainText('Placement blocked');
  await expect(feedback).toContainText('This deposit is exhausted.');

  // Mine head on ore is rejected with its reason and leaves the world unchanged.
  await canvas.press('m'); // mine tool
  await moveCursorTo(layout.mineHeadPosition);
  await expect(feedback).toContainText('Placement blocked');
  await expect(feedback).toContainText(
    'Place the mine head outside the ore patch.',
  );
  await canvas.press('Enter');
  await expect(alerts).toContainText('ORE_MISMATCH');
  await expect(errorAlert).toContainText('ORE_MISMATCH');
  await expect(entityButton('mine', layout.mineHeadPosition)).toHaveCount(0);
});

test('construction stages report per-resource delivery and labelled progress', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // Let the boot autosave settle so the seeded record cannot be overwritten.
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  const layout = await seedWorld(page);
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  await page
    .getByRole('button', {
      name: `construction site · ${layout.constructionSite.x}, ${layout.constructionSite.y}`,
      exact: true,
    })
    .click();
  const card = page.locator('.world-building-card');
  await expect(card).toContainText('Construction materials');
  // Labelled progress: delivered total against the required total.
  await expect(card).toContainText('6 / 18');
  // Per-resource delivered counts arrive with the surface.
  await expect(
    card.locator('li').filter({ hasText: 'Iron plate' }),
  ).toContainText('6');
  await expect(
    card.locator('li').filter({ hasText: 'Electronic circuit' }),
  ).toContainText('0');
});

test('dismantling marks the factory and parks salvage at its station', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // Let the boot autosave settle so the seeded record cannot be overwritten.
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  const layout = await seedWorld(page);
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  const entityButton = (kind: string, at: Tile) =>
    page.getByRole('button', {
      name: `${kind} · ${at.x}, ${at.y}`,
      exact: true,
    });
  const card = page.locator('.world-building-card');
  const dialog = page.getByRole('alertdialog');

  // Factory: dismantling stays visible while the building recovers.
  await entityButton('factory', layout.waiting).click();
  await card.getByRole('button', { name: /Dismantle/ }).click();
  await expect(dialog).toContainText('Dismantle building?');
  await dialog.getByRole('button', { name: 'Dismantle', exact: true }).click();
  await entityButton('factory', layout.waiting).click();
  await expect(card.locator('.world-building-identity .badge')).toHaveText(
    'dismantling',
  );

  // Recovered material is parked at the linked station as provider buffers.
  await entityButton('station', layout.waitingStation).click();
  const salvage = card
    .locator('.world-logistics-row')
    .filter({ hasText: /Buffer (\d+) \/ \1/ });
  await expect(salvage.filter({ hasText: 'provider' })).not.toHaveCount(0);
  await expect(salvage.filter({ hasText: 'Iron ore' })).not.toHaveCount(0);

  // The mine is not a factory: it disappears immediately and its salvage
  // stays parked at its station.
  await entityButton('mine', layout.mine).click();
  await card.getByRole('button', { name: /Dismantle/ }).click();
  await expect(dialog).toContainText('Dismantle building?');
  await dialog.getByRole('button', { name: 'Dismantle', exact: true }).click();
  await expect(entityButton('mine', layout.mine)).toHaveCount(0);
  await entityButton('station', layout.mineStation).click();
  const mineSalvage = card
    .locator('.world-logistics-row')
    .filter({ hasText: /Buffer (\d+) \/ \1/ });
  await expect(mineSalvage.filter({ hasText: 'provider' })).not.toHaveCount(0);
  await expect(mineSalvage.filter({ hasText: 'Iron ore' })).not.toHaveCount(0);
});

test('the paused world presents as paused and keeps drill bindings across save/load', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('canvas[data-renderer-ready="true"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // Let the boot autosave settle so the seeded record cannot be overwritten.
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  const layout = await seedWorld(page);
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  const entityButton = (kind: string, at: Tile) =>
    page.getByRole('button', {
      name: `${kind} · ${at.x}, ${at.y}`,
      exact: true,
    });
  // The seeded world presents as paused and only offers to resume.
  await expect(page.getByRole('button', { name: 'Play world' })).toBeVisible();

  // Hover and cursor inspection never dirty the save state.
  const saveState = page.locator('.world-save-state');
  await expect(saveState).toHaveText('Saved');
  await page.mouse.move(400, 300);
  await expect(saveState).toHaveText('Saved');
  await page.mouse.move(520, 360);
  await expect(saveState).toHaveText('Saved');
  await page.mouse.move(300, 420);
  await expect(saveState).toHaveText('Saved');

  // An explicit save then reload keeps the drill bound to its mine.
  await page.getByRole('button', { name: 'Save world now' }).click();
  await expect(saveState).toHaveText('Saved');
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(page.locator('canvas[data-renderer-ready="true"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(saveState).toHaveText('Saved');
  await entityButton('drill', layout.drill).click();
  await expect(page.locator('.world-building-card')).toContainText(
    `Mine at ${layout.mine.x}, ${layout.mine.y}`,
  );
});
