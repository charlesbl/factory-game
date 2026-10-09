import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Placed-factory edit/replace parity plus save/camera continuity.
 *
 * The world fixture is written through the real runtime serialisation and the
 * app's own persistence database, then loaded by the real worker: a starter
 * hub, an external station next to a placed `factory-main` instance (the demo
 * iron contract), a second station with an in-progress storage construction
 * site, and a pod mid-delivery. The factory library gets an extra `Assembly B`
 * definition so the catalogue selection can differ from the placed factory.
 */

const seedWorld = async (page: Page, eastStation = false): Promise<void> => {
  await page.goto('/');
  await page.evaluate(async (eastStation) => {
    // Dynamic imports cannot be static: these Vite-served modules must load
    // inside the page (same module graph as the app's worker), not in Node.
    const runtimePath = '/src/world/runtime.ts';
    const modelPath = '/src/world/model.ts';
    const serializationPath = '/src/world/serialization.ts';
    const domainPath = '/src/domain/index.ts';
    const compilerPath = '/src/compiler/index.ts';
    const demoPath = '/src/ui/demo-blueprint.ts';
    const editorPath = '/src/editor/index.ts';
    const factoriesPath = '/src/factories/index.ts';
    const persistencePath = '/src/persistence/index.ts';

    const { WorldRuntime } = await import(runtimePath);
    const { defaultWorldGenerationConfig, TerrainKind, OreKind } = await import(
      modelPath
    );
    const { serializeWorldRuntime } = await import(serializationPath);
    const { asId, gridPoint, gridSize, stringifyExact } = await import(
      domainPath
    );
    const { compileBlueprint, serializeContract, isContract } = await import(
      compilerPath
    );
    const { createDemoBlueprint } = await import(demoPath);
    const { createBlueprint } = await import(editorPath);
    const { createFactoryDefinition } = await import(factoriesPath);
    const { database } = await import(persistencePath);

    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('factory-edit-e2e'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    for (let index = 0; index < runtime.world.grid.terrain.length; index += 1) {
      runtime.world.grid.terrain[index] = TerrainKind.BUILDABLE;
      runtime.world.grid.oreKinds[index] = OreKind.NONE;
      runtime.world.grid.oreRemaining[index] = 0;
    }

    const nodeById = (id: string) => {
      const node = [...runtime.railNodes.values()].find(
        (candidate) => candidate.id === id,
      );
      if (node === undefined) throw new Error(`missing starter node ${id}`);
      return node;
    };

    const demo = createDemoBlueprint();
    const compiled = compileBlueprint(demo);
    if (!isContract(compiled))
      throw new Error('demo blueprint did not compile');
    // On the east side, a smaller replacement no longer touches its station.
    const stationAPosition = eastStation
      ? gridPoint(11 + compiled.footprint.width, 10)
      : gridPoint(9, 9);
    // External station A: serves the placed factory and its replacement.
    const stationANode = runtime.placeControlNode('station', stationAPosition);
    runtime.place({
      id: asId('e2e-station-a'),
      kind: 'station',
      stationId: asId('e2e-station'),
      railNodeId: stationANode.id,
      transform: {
        position: stationAPosition,
        size: gridSize(2, 2),
        rotation: 0,
      },
      createdAt: 0n,
    });

    // Placed factory: a `factory-main` instance built through the real
    // construction path with an empty bill (instant completion -> ACTIVE).
    runtime.createConstructionSite({
      targetKind: 'factory',
      transform: {
        position: gridPoint(11, 10),
        size: gridSize(compiled.footprint.width, compiled.footprint.height),
        rotation: 0,
      },
      stationId: asId('e2e-station'),
      cost: [],
      factoryId: asId('factory-main'),
      instanceId: asId('e2e-instance'),
      contract: serializeContract(compiled),
    });

    // Station B + a storage construction site whose 500 iron plates cannot be
    // delivered from the hub's 200, so construction is still running.
    const stationBNode = runtime.placeControlNode('station', gridPoint(17, 6));
    runtime.place({
      id: asId('e2e-station-b'),
      kind: 'station',
      stationId: asId('e2e-station-b'),
      railNodeId: stationBNode.id,
      transform: {
        position: gridPoint(17, 6),
        size: gridSize(2, 2),
        rotation: 0,
      },
      createdAt: 0n,
    });

    // Approach the exterior hookups from the south, then route around the
    // factory and starter buildings through the clear western corridor.
    const depot = nodeById('rail-starter-depot').position;
    const hub = nodeById('rail-starter-storage').position;
    for (const path of [
      [depot, gridPoint(depot.x, 36), gridPoint(hub.x, 36), hub],
      [
        hub,
        gridPoint(hub.x, 36),
        gridPoint(8, 36),
        gridPoint(8, stationBNode.position.y),
        stationBNode.position,
      ],
    ]) {
      runtime.placeRailPath(path);
      runtime.placeRailPath([...path].reverse());
    }

    runtime.createConstructionSite({
      targetKind: 'storage',
      transform: {
        position: gridPoint(19, 6),
        size: gridSize(4, 4),
        rotation: 0,
      },
      stationId: asId('e2e-station-b'),
      cost: [{ resourceId: asId('ironPlate'), quantity: 500 }],
    });

    // Freeze the world mid-mission with a pod carrying construction cargo.
    runtime.setTimeControl(true, 1);
    let enRoute = false;
    for (let step = 1; step <= 200 && !enRoute; step += 1) {
      runtime.advanceTo(BigInt(step) * 100_000n);
      enRoute = [...runtime.traffic.pods.values()].some((pod) => pod.cargo > 0);
    }
    if (!enRoute) throw new Error('no pod picked up construction cargo');
    runtime.advanceTo(1_500_000n);

    // Factory library: the placed factory's definition plus a different
    // catalogue selection (empty blueprint named Assembly B).
    try {
      await createFactoryDefinition(demo, 'Starter iron line');
    } catch {
      // Already present from the first app boot with identical content.
    }
    try {
      await createFactoryDefinition(
        createBlueprint(asId('factory-b')),
        'Assembly B',
      );
    } catch {
      // Already present from a previous run with identical content.
    }

    await database.worlds.put({
      id: 'main',
      schemaVersion: 2,
      revision: runtime.revision,
      savedAt: new Date().toISOString(),
      payload: stringifyExact(serializeWorldRuntime(runtime)),
    });
  }, eastStation);
  await page.reload();
};

const openWorld = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(page.locator('canvas[data-renderer-ready="true"]')).toBeVisible({
    timeout: 30_000,
  });
};

const listButton = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });

test('upgrades a placed factory to the chosen published version and persists its contract', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await seedWorld(page, true);
  const { targetHash, targetPosition } = await page.evaluate(async () => {
    const factoriesPath = '/src/factories/index.ts';
    const compilerPath = '/src/compiler/index.ts';
    const editorPath = '/src/editor/index.ts';
    const domainPath = '/src/domain/index.ts';
    const demoPath = '/src/ui/demo-blueprint.ts';
    const { loadFactoryLibrary, publishFactoryVersion } = await import(
      factoriesPath
    );
    const { compileBlueprint, isContract } = await import(compilerPath);
    const { createBlueprint } = await import(editorPath);
    const { asId } = await import(domainPath);
    const { createDemoBlueprint } = await import(demoPath);
    const library = await loadFactoryLibrary();
    let definition = library.definitions.find(
      (item: { id: string }) => item.id === 'factory-main',
    )!;
    let targetHash = '';
    // v2 is deliberately neither the latest version nor the active draft.
    for (const blueprint of [
      createDemoBlueprint(),
      createBlueprint(asId('factory-main')),
      createDemoBlueprint(),
    ]) {
      const contract = compileBlueprint(blueprint);
      if (!isContract(contract)) throw new Error('Version did not compile');
      const published = await publishFactoryVersion(
        definition,
        {
          factoryId: definition.id,
          blueprint,
          autosavedAt: new Date().toISOString(),
        },
        contract,
      );
      definition = published.definition;
      if (published.version.version === 2) targetHash = contract.blueprintHash;
    }
    const other = library.definitions.find(
      (item: { id: string }) => item.id === 'factory-b',
    )!;
    const otherBlueprint = createBlueprint(other.id);
    const otherContract = compileBlueprint(otherBlueprint);
    if (!isContract(otherContract))
      throw new Error('Other factory did not compile');
    await publishFactoryVersion(
      other,
      {
        factoryId: other.id,
        blueprint: otherBlueprint,
        autosavedAt: new Date().toISOString(),
      },
      otherContract,
    );
    const demoContract = compileBlueprint(createDemoBlueprint());
    if (!isContract(demoContract)) throw new Error('Demo did not compile');
    return {
      targetHash,
      targetPosition: { x: 10 + demoContract.footprint.width, y: 10 },
    };
  });
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(page.locator('.world-three-host canvas')).toBeVisible();
  // Stop GPU work in software-rendered test environments.
  await page.locator('.world-three-host canvas').evaluate((element) => {
    (element as HTMLCanvasElement)
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context')!
      .loseContext();
  });
  await page.locator('.world-object-browser summary').click();
  await listButton(page, 'Starter iron line · 11, 10').click();
  const card = page.locator('.world-building-card');
  const versionSelect = card.getByLabel('Target version');
  await expect(versionSelect.locator('option')).toHaveCount(3);
  await expect(
    card.getByRole('button', { name: 'Upgrade to v3', exact: true }),
  ).toBeDisabled();
  await versionSelect.selectOption('2');
  await card
    .getByRole('button', { name: 'Upgrade to v2', exact: true })
    .click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.world-replacement-controls')).toBeVisible();
  await expect(card).toContainText('Current version · v3');
  // Starting and cancelling placement leave the old factory untouched.
  await page
    .getByRole('button', { name: 'Cancel placement', exact: true })
    .click();
  await expect(page.locator('.world-replacement-controls')).toHaveCount(0);
  await card
    .getByRole('button', { name: 'Upgrade to v2', exact: true })
    .click();
  const canvas = page.locator('.world-three-host canvas');
  await canvas.press('Escape');
  await expect(page.locator('.world-replacement-controls')).toHaveCount(0);
  await expect(card).toContainText('Current version · v3');
  await card
    .getByRole('button', { name: 'Upgrade to v2', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Keyboard placement', exact: true })
    .click();
  const moveCursor = async (to: { x: number; y: number }) => {
    const text = await page
      .getByText(/^Cursor \d+, \d+/)
      .first()
      .innerText();
    const [, x, y] = /(\d+), (\d+)/.exec(text)!;
    await canvas.focus();
    for (let n = Number(x); n < to.x; n++) await canvas.press('ArrowRight');
    for (let n = Number(x); n > to.x; n--) await canvas.press('ArrowLeft');
    for (let n = Number(y); n < to.y; n++) await canvas.press('ArrowDown');
    for (let n = Number(y); n > to.y; n--) await canvas.press('ArrowUp');
    await expect(page.locator('.world-keyboard-cursor')).toContainText(
      `Cursor ${to.x}, ${to.y}`,
    );
  };
  // The old origin becomes disconnected when the version shrinks.
  await moveCursor({ x: 11, y: 10 });
  await expect(page.locator('.world-placement-feedback')).toHaveClass(
    /is-invalid/,
  );
  await canvas.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText('Current version · v3');
  // Its own occupied cells may be reused, but the station may not be covered.
  await moveCursor({ x: targetPosition.x + 1, y: targetPosition.y });
  await expect(page.locator('.world-placement-feedback')).toHaveClass(
    /is-invalid/,
  );
  await canvas.press('Enter');
  await expect(dialog).toHaveCount(0);
  await moveCursor(targetPosition);
  await expect(page.locator('.world-placement-feedback')).toHaveClass(
    /is-valid/,
  );
  await canvas.press('r');
  await expect(page.locator('.world-placement-feedback')).toContainText('90°');
  await canvas.press('Enter');
  await expect(dialog).toContainText('Build factory v2?');
  await expect(dialog).toContainText('1 × 1 tiles');
  await expect(dialog).toContainText(
    `at ${targetPosition.x}, ${targetPosition.y}, rotated 90°`,
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card).toContainText('Current version · v3');
  await canvas.press('Enter');
  await dialog
    .getByRole('button', { name: 'Upgrade to v2', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.world-replacement-controls')).toHaveCount(0);
  await listButton(
    page,
    `Starter iron line · ${targetPosition.x}, ${targetPosition.y}`,
  ).click();
  await expect(card).toContainText('Current version · v2');
  await expect(card).toContainText('1 × 1');
  await expect(card).toContainText('No external contract rates');
  await versionSelect.selectOption('2');
  await expect(
    card.getByRole('button', { name: 'Upgrade to v2', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Save world now' }).click();
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  const saved = await page.evaluate(async () => {
    const persistencePath = '/src/persistence/index.ts';
    const domainPath = '/src/domain/index.ts';
    const { database } = await import(persistencePath);
    const { parseExact } = await import(domainPath);
    return parseExact((await database.worlds.get('main'))!.payload);
  });
  expect(
    saved.factories.find(
      (item: { contract: { blueprintHash: string } }) =>
        item.contract.blueprintHash === targetHash,
    ),
  ).toBeDefined();
  expect(
    saved.entities.find((item: { id: string }) => item.id === 'e2e-station-a'),
  ).toMatchObject({
    stationId: 'e2e-station',
    transform: { position: { y: 10 } },
  });
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await page.locator('.world-object-browser summary').click();
  await listButton(
    page,
    `Starter iron line · ${targetPosition.x}, ${targetPosition.y}`,
  ).click();
  await expect(card).toContainText('Current version · v2');
});

test.describe('placed factory edit/replace and save continuity', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    // Repeated pixel reads can switch Chromium's canvas from GPU to CPU
    // rasterisation. Use the same rasteriser before and after reload.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        options?: object,
      ) {
        return Reflect.apply(original, this, [
          type,
          type === '2d' && this.classList.contains('world-minimap-canvas')
            ? { ...options, willReadFrequently: true }
            : options,
        ]);
      } as typeof original;
    });
  });

  test('opens the placed factory blueprint, not the catalogue selection', async ({
    page,
  }) => {
    await seedWorld(page);
    await openWorld(page);

    // The catalogue selection is Assembly B; the placed factory is factory-main.
    // The world sites list lives in the Build catalogue panel, which closes the
    // inspector when opened; toggling back keeps the entity list clickable.
    await page.getByRole('button', { name: 'Build catalogue' }).click();
    await listButton(page, 'View Assembly B in world').click();
    await expect(listButton(page, 'View Assembly B in world')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await expect(page.locator('.world-contract')).toContainText(
      'Build blueprint · Assembly B',
    );

    // Open the placed factory through its own action.
    await listButton(page, 'factory · 11, 10').click();
    const card = page.locator('.world-building-card');
    await expect(card).toContainText('Factory definition: factory-main');
    await page
      .getByRole('button', { name: 'Open placed Starter iron line blueprint' })
      .click();

    // The editor shows the placed factory's identity and blueprint content.
    await expect(page.locator('.factory-title strong')).toHaveText(
      'Starter iron line',
    );
    await expect(page.locator('.factory-title')).not.toContainText(
      'Assembly B',
    );
    await expect(page.locator('.graph-node')).toHaveCount(3);
    await expect(
      page.locator('.graph-node').filter({ hasText: 'Iron smelting' }),
    ).toHaveCount(1);
  });

  test('keeps the placed actor unchanged until an explicit replacement is accepted', async ({
    page,
  }) => {
    await seedWorld(page);
    await openWorld(page);
    const card = page.locator('.world-building-card');
    const presentation = async () => ({
      identity: (
        await card.locator('.world-building-identity').innerText()
      ).trim(),
      status: (await card.locator('.world-building-status').innerText()).trim(),
      counts: (
        await card.locator('.world-building-counts').first().innerText()
      ).trim(),
      rates: (
        await card
          .locator('.world-buffer-group')
          .filter({ hasText: 'Placed factory design rates' })
          .innerText()
      ).trim(),
    });

    await listButton(page, 'factory · 11, 10').click();
    const before = await presentation();
    expect(before.counts).toContain('11, 10');

    // Record the external station identity that must survive the replacement,
    // plus the rail routes and world inventory the swap must not orphan or
    // consume.
    await listButton(page, 'station · 9, 9').click();
    const stationBefore = {
      counts: (
        await card.locator('.world-building-counts').first().innerText()
      ).trim(),
      identity:
        (await card.locator('.world-developer-details').textContent()) ?? '',
    };
    const railsSection = page
      .locator('section.inspector-card')
      .filter({ has: page.getByRole('heading', { name: 'Accessible rails' }) });
    const railsBefore = (await railsSection.innerText()).trim();
    await listButton(page, 'storage · 22, 30').click();
    await expect(card).toContainText('Shared inventory');
    const inventoryBefore = (
      await card.locator('.world-inventory').innerText()
    ).trim();
    await expect(card).not.toContainText(/requester/i);

    // Edit the opened blueprint: remove its machine and boundary nodes.
    await listButton(page, 'factory · 11, 10').click();
    await page
      .getByRole('button', { name: 'Open placed Starter iron line blueprint' })
      .click();
    await expect(page.locator('.graph-node')).toHaveCount(3);
    await page
      .locator('.graph-node')
      .filter({ hasText: 'Iron smelting' })
      .click();
    await page.getByRole('button', { name: /Delete \(1\)/ }).click();
    await expect(page.locator('.graph-node')).toHaveCount(2);
    await page.locator('.graph-node--external-input').click({ force: true });
    await page.getByRole('button', { name: /Delete \(1\)/ }).click();
    await page.locator('.graph-node--external-output').click({ force: true });
    await page.getByRole('button', { name: /Delete \(1\)/ }).click();
    await expect(page.locator('.graph-node')).toHaveCount(0);

    // Return to the world: the blueprint edit never altered the placed actor.
    await listButton(page, 'World').click();
    await expect(
      page.locator('canvas[data-renderer-ready="true"]'),
    ).toBeVisible({ timeout: 30_000 });
    await listButton(page, 'factory · 11, 10').click();
    expect(await presentation()).toEqual(before);

    // The replacement confirmation previews the footprint and consequences.
    const replaceButton = listButton(page, 'Replace with Starter iron line');
    await expect(replaceButton).toBeVisible();
    await replaceButton.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Replace placed factory?');
    const preview = /(\d+) × (\d+) tiles · (\d+) build items/.exec(
      await page.locator('.world-contract p').innerText(),
    );
    expect(preview).not.toBeNull();
    const [, width, height, items] = preview as RegExpExecArray;
    await expect(dialog).toContainText(
      `The new footprint will be ${width} × ${height} tiles`,
    );
    await expect(dialog).toContainText(
      'at the same position, orientation and station',
    );
    await expect(dialog).toContainText(
      'Existing contents will be routed to salvage',
    );
    await expect(dialog).toContainText(
      `the new factory will be rebuilt with ${items} construction items`,
    );

    // Cancel proves the replacement is never automatic.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await presentation()).toEqual(before);

    // Accept: the placed contract and footprint change at the same position,
    // and the external station is preserved.
    await replaceButton.click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Replace factory' })
      .click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(card).toBeHidden();
    await listButton(page, 'factory · 11, 10').click();
    const after = await presentation();
    expect(after).not.toEqual(before);
    expect(after.counts).toContain('11, 10');
    expect(after.counts).toContain('1 × 1');
    expect(after.rates).toContain('No external contract rates');

    await listButton(page, 'station · 9, 9').click();
    const stationAfter = {
      counts: (
        await card.locator('.world-building-counts').first().innerText()
      ).trim(),
      identity:
        (await card.locator('.world-developer-details').textContent()) ?? '',
    };
    expect(stationAfter).toEqual(stationBefore);
    // No route is orphaned by the swap.
    expect((await railsSection.innerText()).trim()).toEqual(railsBefore);
    // The swap conserves materials: the shared inventory is unchanged and the
    // old contents are routed to salvage as recovery requests at the starter
    // inventory.
    await listButton(page, 'storage · 22, 30').click();
    await expect(card).toContainText('Shared inventory');
    expect((await card.locator('.world-inventory').innerText()).trim()).toEqual(
      inventoryBefore,
    );
    await expect(card).toContainText(/requester/i);
  });

  test('restores logical state and the world camera across save, reload, and factory navigation', async ({
    page,
  }) => {
    await seedWorld(page);
    await openWorld(page);
    const card = page.locator('.world-building-card');
    const entitiesSection = page.locator('section.inspector-card').filter({
      has: page.getByRole('heading', { name: 'Accessible entities' }),
    });
    const podsSection = page.locator('section.inspector-card').filter({
      has: page.getByRole('heading', { name: 'Accessible cargo pods' }),
    });
    const podsList = podsSection.locator('.world-entity-list');

    // Camera fingerprint of the world minimap (2D canvas).
    const fingerprint = async () =>
      page.evaluate(() => {
        const canvas = document.querySelector('.world-minimap-canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return 'missing';
        const context = canvas.getContext('2d');
        if (context === null) return 'no-context';
        const { data } = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );
        let hash = 2166136261;
        for (let index = 0; index < data.length; index += 1) {
          hash ^= data[index] as number;
          hash = Math.imul(hash, 16777619);
        }
        return `${canvas.width}x${canvas.height}:${hash >>> 0}`;
      });
    await page.waitForTimeout(400);
    const homeStart = await fingerprint();
    await page.getByRole('button', { name: 'Rotate camera right' }).click();
    await page.getByRole('button', { name: 'Rotate camera right' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(400);
    const moved = await fingerprint();
    expect(moved).not.toEqual(homeStart);

    // Save while construction and a pod delivery are in progress.
    await page.getByRole('button', { name: /^20/ }).click();
    await page.getByRole('button', { name: 'Play world' }).click();
    const podsAtPlay = (await podsList.innerText()).trim();
    await expect
      .poll(async () => (await podsList.innerText()).trim(), {
        timeout: 20_000,
      })
      .not.toBe(podsAtPlay);
    await page.getByRole('button', { name: 'Pause world' }).click();
    await page.getByRole('button', { name: 'Save world now' }).click();
    await expect(page.locator('.world-save-state')).toHaveText('Saved');

    // Capture the frozen logical presentation at save time.
    const capture = async () => {
      await listButton(page, 'storage · 22, 30').click();
      const storageText = (await card.innerText()).trim();
      await listButton(page, 'construction site · 19, 6').click();
      const siteText = (await card.innerText()).trim();
      // innerText renders text-transform: uppercase headings.
      expect(storageText).toMatch(/shared inventory/i);
      expect(siteText).toMatch(/construction materials/i);
      return {
        entities: (await entitiesSection.innerText()).trim(),
        pods: (await podsList.innerText()).trim(),
        storageText,
        siteText,
      };
    };
    const before = await capture();

    // The home camera is a fixed view of the frozen world; its fingerprint is
    // the ground truth a restored camera must return to exactly. Focusing an
    // entity from the inspector moves the camera, so references are captured
    // at the transition they verify.
    await page.getByRole('button', { name: 'Home camera' }).click();
    await page.waitForTimeout(400);
    const home = await fingerprint();
    await page.getByRole('button', { name: 'Rotate camera left' }).click();
    await page.waitForTimeout(400);
    expect(await fingerprint()).not.toEqual(home);

    // Reload immediately after the camera change, without waiting for the
    // debounced save: the camera must still be restored exactly.
    await page.getByRole('button', { name: 'Home camera' }).click();
    await page.reload();
    await openWorld(page);
    await page.waitForTimeout(400);
    expect(await fingerprint()).toEqual(home);

    // Logical state is intact across the reload.
    await expect
      .poll(async () => await capture(), { timeout: 15_000 })
      .toEqual(before);

    // Open a placed factory and return: the camera survives the navigation.
    await listButton(page, 'factory · 11, 10').click();
    await page.waitForTimeout(400);
    const beforeSwitch = await fingerprint();
    expect(beforeSwitch).not.toEqual(home);
    await page
      .getByRole('button', { name: 'Open placed Starter iron line blueprint' })
      .click();
    await expect(page.locator('.factory-title strong')).toHaveText(
      'Starter iron line',
    );
    await listButton(page, 'World').click();
    await expect(
      page.locator('canvas[data-renderer-ready="true"]'),
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(400);
    expect(await fingerprint()).toEqual(beforeSwitch);
  });
});
