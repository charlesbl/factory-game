import { expect, test, type Page } from '@playwright/test';

const placePreview = async (
  page: Page,
  offsetX = 0,
  offsetY = 0,
  repeat = false,
) => {
  await expect(page.getByRole('status')).toContainText('click to confirm');
  const canvas = page.getByLabel('Factory graph editor');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await canvas.click({
    position: {
      x: bounds!.width / 2 + offsetX,
      y: bounds!.height / 2 + offsetY,
    },
    ...(repeat ? { modifiers: ['Shift'] as const } : {}),
  });
};

test('opens the graph editor and compiles the demo factory', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Machine catalogue' }),
  ).toBeVisible();
  await expect(page.getByText('Contract ready')).toBeVisible();
  await expect(page.getByLabel('Factory graph editor')).toBeVisible();
  const machine = page.locator('.graph-node--machine').first();
  const body = await machine.boundingBox();
  const inputPad = await machine.getByLabel('input Iron ore').boundingBox();
  const outputPad = await machine.getByLabel('output Iron ingot').boundingBox();
  expect(body).not.toBeNull();
  expect(inputPad).not.toBeNull();
  expect(outputPad).not.toBeNull();
  expect(Math.abs(inputPad!.x + inputPad!.width / 2 - body!.x)).toBeLessThan(3);
  expect(
    Math.abs(outputPad!.x + outputPad!.width / 2 - (body!.x + body!.width)),
  ).toBeLessThan(3);
});

test('adds a machine and supports undo', async ({ page }) => {
  await page.goto('/');
  const nodes = page.locator('.graph-node');
  await expect(nodes).toHaveCount(3);
  await page.getByRole('button', { name: /Copper smelting/i }).click();
  await placePreview(page, 80, 80);
  await expect(nodes).toHaveCount(4);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nodes).toHaveCount(3);
});

test('previews repeated placement and cancels without history', async ({
  page,
}) => {
  await page.goto('/');
  const committed = page.locator(
    '.react-flow__node:not(.placement-flow-node) .graph-node',
  );
  await expect(committed).toHaveCount(3);
  await page.getByRole('button', { name: /Copper smelting/i }).click();
  const ghost = page.locator('.placement-flow-node');
  await expect(ghost).toBeVisible();
  await ghost.evaluate((element) => {
    element.setAttribute('data-stability-check', 'mounted');
  });
  const canvas = await page.getByLabel('Factory graph editor').boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.move(
    canvas!.x + canvas!.width * 0.35,
    canvas!.y + canvas!.height * 0.35,
  );
  const firstTranslate = await ghost.evaluate(
    (element) => getComputedStyle(element).translate,
  );
  await page.mouse.move(
    canvas!.x + canvas!.width * 0.65,
    canvas!.y + canvas!.height * 0.65,
    { steps: 12 },
  );
  await expect(ghost).toHaveAttribute('data-stability-check', 'mounted');
  await expect
    .poll(() =>
      ghost.evaluate((element) => getComputedStyle(element).translate),
    )
    .not.toBe(firstTranslate);
  await page.keyboard.press('Escape');
  await expect(page.locator('.placement-flow-node')).toHaveCount(0);
  await expect(committed).toHaveCount(3);

  await page.getByRole('button', { name: /Copper smelting/i }).click();
  await placePreview(page, 70, 80, true);
  await expect(page.locator('.placement-flow-node')).toBeVisible();
  await placePreview(page, 150, 120);
  await expect(page.locator('.placement-flow-node')).toHaveCount(0);
  await expect(committed).toHaveCount(5);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(committed).toHaveCount(4);
});

test('copies, pastes, cuts, and restores a selected component', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  const committed = page.locator(
    '.react-flow__node:not(.placement-flow-node) .graph-node',
  );
  await page.locator('.graph-node--machine').click();
  await page.getByRole('button', { name: 'Copy selection' }).click();
  await expect(
    page.getByRole('button', { name: 'Paste selection' }),
  ).toBeEnabled();
  await page.keyboard.press('Control+V');
  await expect(page.getByRole('status')).toContainText('click to confirm');
  await expect(page.locator('.placement-flow-node')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(committed).toHaveCount(3);

  await page.getByRole('button', { name: 'Paste selection' }).click();
  await placePreview(page, 120, 120);
  await expect(committed).toHaveCount(4);
  await expect(page.locator('.graph-node--machine.is-selected')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cut selection' }).click();
  await expect(committed).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(committed).toHaveCount(4);
});

test('moves a copied subgraph ghost without remounting nodes or routes', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.locator('.graph-node--external-input').click({ force: true });
  await page
    .locator('.graph-node--machine')
    .click({ force: true, modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Copy selection' }).click();
  await page.getByRole('button', { name: 'Paste selection' }).click();
  const ghostNodes = page.locator('.placement-flow-node');
  await expect(ghostNodes).toHaveCount(2);
  await ghostNodes.evaluateAll((elements) =>
    elements.forEach((element) =>
      element.setAttribute('data-stability-check', 'mounted'),
    ),
  );
  const canvas = await page.getByLabel('Factory graph editor').boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.move(
    canvas!.x + canvas!.width * 0.3,
    canvas!.y + canvas!.height * 0.3,
  );
  const firstTranslate = await ghostNodes
    .first()
    .evaluate((element) => getComputedStyle(element).translate);
  await page.mouse.move(
    canvas!.x + canvas!.width * 0.7,
    canvas!.y + canvas!.height * 0.7,
    { steps: 16 },
  );
  await expect(ghostNodes.first()).toHaveAttribute(
    'data-stability-check',
    'mounted',
  );
  await expect(ghostNodes.last()).toHaveAttribute(
    'data-stability-check',
    'mounted',
  );
  await expect
    .poll(() =>
      ghostNodes
        .first()
        .evaluate((element) => getComputedStyle(element).translate),
    )
    .not.toBe(firstTranslate);
});

test('selects multiple components with a direct marquee', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  const targets = page.locator('.react-flow__node').filter({
    has: page.locator('.graph-node--machine, .graph-node--external-output'),
  });
  const first = await targets.nth(0).boundingBox();
  const second = await targets.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  const left = Math.min(first!.x, second!.x) - 12;
  const top = Math.min(first!.y, second!.y) - 12;
  const right =
    Math.max(first!.x + first!.width, second!.x + second!.width) + 12;
  const bottom =
    Math.max(first!.y + first!.height, second!.y + second!.height) + 12;
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.graph-node--machine.is-selected')).toHaveCount(1);
  await expect(
    page.locator('.graph-node--external-output.is-selected'),
  ).toHaveCount(1);
});

test('runs the authoritative world clock without direct supply mutations', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Supply +12' })).toHaveCount(0);
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(page.getByLabel('World build tools')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rail' })).toBeVisible();
  await page.getByRole('button', { name: 'Play world' }).click();
  await expect(page.getByText('1×', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '5×' }).click();
  await expect(page.getByText('5×', { exact: true })).toBeVisible();
});

test('switches between the world overview and factory editor', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(page.getByLabel('World overview')).toBeVisible();
  await expect(page.getByText('Contract rate')).toHaveCount(2);
  await expect(page.getByText('2/s')).toBeVisible();
  await expect(page.getByText('max 6/s')).toBeVisible();
  await expect(page.getByText('1/s')).toBeVisible();
  await expect(page.getByText('max 4/s')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Open Starter iron line factory/i }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /Open Starter iron line factory/i })
    .click();
  await expect(page.getByLabel('Factory graph editor')).toBeVisible();
});

test('changes the factory displayed in the world without opening the editor', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: 'Library' }).click();
  page.once('dialog', (dialog) => dialog.accept('Test factory'));
  await page.getByRole('button', { name: 'Create factory' }).click();
  await page.getByRole('button', { name: 'World', exact: true }).click();

  await expect(page.getByLabel('World overview')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'View Test factory in world' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: 'View Starter iron line in world' })
    .click();

  await expect(page.getByLabel('World overview')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'View Starter iron line in world' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Open Starter iron line factory' }),
  ).toBeVisible();
});

test('deletes a selected node with its routes and restores it with undo', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  const nodes = page.locator('.graph-node');
  const edges = page.locator('.conveyor-path');
  await expect(nodes).toHaveCount(3);
  await expect(edges).toHaveCount(2);
  await nodes.filter({ hasText: 'Iron smelting' }).click();
  await page.getByRole('button', { name: /Delete \(1\)/ }).click();
  await expect(nodes).toHaveCount(2);
  await expect(edges).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nodes).toHaveCount(3);
  await expect(edges).toHaveCount(2);
});

test('deletes a selected route and restores it with undo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  const edges = page.locator('.conveyor-path');
  await page
    .locator('.route-segment-hit[data-edge-id="edge-ingot"]')
    .first()
    .click();
  await page.getByRole('button', { name: /Delete \(1\)/ }).click();
  await expect(edges).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(edges).toHaveCount(2);
});

test('filters the machine catalogue', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search machines').fill('wire');
  await expect(page.locator('.catalogue-item')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: /Wire drawing/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Circuit assembly/i }),
  ).toBeVisible();
});

test('does not intercept editing shortcuts inside form controls', async ({
  page,
}) => {
  await page.goto('/');
  const search = page.getByLabel('Search machines');
  await search.fill('wire');
  await search.press('Control+A');
  await search.press('Backspace');
  await expect(search).toHaveValue('');
  await expect(page.locator('.graph-node')).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: 'Paste selection' }),
  ).toBeDisabled();
});

test('rejects a second route on an occupied connector', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: /Iron smelting/i }).click();
  await placePreview(page, 90, 100);
  const nodes = page.locator('.graph-node');
  const secondFurnace = nodes.filter({ hasText: 'Iron smelting' }).last();
  const intake = nodes.filter({ hasText: 'Iron ore intake' });
  await page
    .locator('.react-flow__minimap')
    .evaluate((element) => element.remove());

  const drag = async (
    from: ReturnType<typeof page.locator>,
    to: ReturnType<typeof page.locator>,
  ) => {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
    await page.mouse.down();
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
  };
  await drag(
    intake.getByLabel('output Iron ore'),
    secondFurnace.getByLabel('input Iron ore'),
  );
  await expect(
    page.getByText('This connector already carries a route.'),
  ).toBeVisible();
  await expect(page.locator('.conveyor-path')).toHaveCount(2);
  await expect(page.locator('.conveyor-label')).toHaveCount(0);
});

test('creates persistent loose connections without editor modes and cancels only the active gesture', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  const edges = page.locator('.conveyor-path');
  await expect(edges).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Route', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Select', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /Intake/ }).click();
  await placePreview(page, -160, 140);
  await page.getByRole('button', { name: 'Fit View' }).click();
  const source = page
    .locator('.graph-node--external-input')
    .last()
    .getByLabel('output Iron ore');
  const box = await source.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 80, { steps: 5 });
  await expect(page.locator('.route-preview')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.loose-route')).toHaveCount(1);
  await expect(page.getByLabel('Free route endpoint')).toHaveCount(1);
  const free = await page.getByLabel('Free route endpoint').boundingBox();
  expect(free).not.toBeNull();
  await page.mouse.move(free!.x + free!.width / 2, free!.y + free!.height / 2);
  await page.mouse.down();
  await page.mouse.move(free!.x + 90, free!.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.route-connector')).toHaveCount(4);
  await page.locator('.loose-route-segment-hit').first().click();
  await expect(page.locator('.loose-route.is-selected')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Copy selection' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Copy selection' }).click();
  await page.getByRole('button', { name: 'Paste selection' }).click();
  await expect(page.locator('.placement-flow-node')).toBeVisible();
  await placePreview(page, 150, -80);
  await expect(page.locator('.loose-route')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.loose-route')).toHaveCount(1);
  await page.locator('.loose-route-segment-hit').first().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.loose-route')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.loose-route')).toHaveCount(1);
  await page.getByRole('button', { name: /Intake/ }).click();
  await placePreview(page, -120, -140);
  await page.getByRole('button', { name: 'Fit View' }).click();
  const sourceAgain = await page
    .locator('.graph-node--external-input')
    .last()
    .getByLabel('output Iron ore')
    .boundingBox();
  expect(sourceAgain).not.toBeNull();
  const x2 = sourceAgain!.x + sourceAgain!.width / 2;
  const y2 = sourceAgain!.y + sourceAgain!.height / 2;
  await page.mouse.move(x2, y2);
  await page.mouse.down();
  await page.mouse.move(x2 + 60, y2 - 70, { steps: 4 });
  await expect(page.locator('.route-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.loose-route')).toHaveCount(1);
  await expect(edges).toHaveCount(2);
});

test('places the same boundary components used by the starter factory', async ({
  page,
}) => {
  await page.goto('/');
  const nodes = page.locator('.graph-node');
  await expect(nodes).toHaveCount(3);
  await page.getByLabel('Boundary resource').selectOption('copperOre');
  await page.getByRole('button', { name: /Intake/ }).click();
  await placePreview(page, -140, 120);
  await expect(nodes).toHaveCount(4);
  await expect(
    page
      .locator('.graph-node--external-input')
      .filter({ hasText: 'Copper ore intake' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nodes).toHaveCount(3);
});

test('types a junction component and reveals the next free connector', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: /Intake/ }).click();
  await placePreview(page, -150, 140);
  await page.getByRole('button', { name: 'Junction' }).click();
  await placePreview(page, 80, 140);
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page
    .locator('.react-flow__minimap')
    .evaluate((element) => element.remove());
  const source = page
    .locator('.graph-node--external-input')
    .last()
    .getByLabel('output Iron ore');
  const junction = page.locator('.graph-node--junction').last();
  const target = junction.getByLabel('input Any');
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(junction.getByLabel('input Iron ore')).toHaveCount(2);
  await expect(junction.getByLabel('output Iron ore')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
});

test('shows, adds, moves, and removes connection handles', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  const connectors = page.locator('.route-connector');
  await expect(connectors).toHaveCount(2);
  await page
    .locator('.route-segment-hit[data-edge-id="edge-ore"]')
    .first()
    .dblclick();
  await expect(connectors).toHaveCount(3);
  await page.keyboard.press('Delete');
  await expect(connectors).toHaveCount(2);
  const movable = connectors.first();
  const box = await movable.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 48, box!.y + 48, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const moved = await movable.boundingBox();
      return moved === null
        ? ''
        : `${Math.round(moved.x)},${Math.round(moved.y)}`;
    })
    .not.toBe(`${Math.round(box!.x)},${Math.round(box!.y)}`);
  await connectors.first().dblclick();
  await expect(connectors).toHaveCount(1);
});

test('adds a bridge from a contextual route action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  const segment = page
    .locator('.route-segment-hit[data-edge-id="edge-ore"]')
    .first();
  const box = await segment.boundingBox();
  expect(box).not.toBeNull();
  await segment.click({
    button: 'right',
    position: { x: box!.width - 2, y: box!.height / 2 },
  });
  await page.getByRole('button', { name: 'Add bridge here' }).click();
  await expect(page.locator('.conveyor-path--bridge')).toHaveCount(1);
  await expect(page.locator('.bridge-marker')).toHaveCount(2);
});

test('publishes a factory, pins it in another draft, and upgrades explicitly', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText('v1', { exact: true })).toBeVisible();
  await expect(
    page.locator('.version-row--draft').getByText('Draft', { exact: true }),
  ).toBeVisible();
  const versionButtons = page.locator('.version-row .button');
  await expect(versionButtons).toHaveCount(5);
  const versionButtonStyles = await versionButtons.evaluateAll((buttons) =>
    buttons.map((button) => {
      const style = getComputedStyle(button);
      return {
        background: style.backgroundColor,
        height: button.getBoundingClientRect().height,
      };
    }),
  );
  expect(
    versionButtonStyles.every(
      ({ background, height }) =>
        background !== 'rgb(239, 239, 239)' && height <= 40,
    ),
  ).toBe(true);

  page.once('dialog', (dialog) => dialog.accept('Host factory'));
  await page.getByRole('button', { name: 'Create factory' }).click();
  await expect(page.getByText('Host factory', { exact: true })).toBeVisible();
  const starterEntry = page
    .locator('.factory-catalogue-item')
    .filter({ hasText: 'Starter iron line' });
  await expect(starterEntry).toBeEnabled();
  await starterEntry.click();
  await placePreview(page);
  const child = page
    .locator('.graph-node--sub-factory')
    .filter({ hasText: 'Starter iron line' });
  await expect(child).toBeVisible();
  await child.click();
  await expect(page.getByLabel('Sub-factory version')).toHaveValue('1');
  await expect(
    page.locator('.inspector').getByRole('button', { name: 'Edit factory' }),
  ).toBeVisible();

  await page
    .locator('.inspector')
    .getByRole('button', { name: 'Edit factory' })
    .click();
  await expect(
    page
      .locator('.factory-title')
      .getByText('Starter iron line', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Factory graph editor')).toBeVisible();
  await page.getByRole('button', { name: 'Library' }).click();
  await page
    .locator('.library-entry')
    .filter({ hasText: 'Host factory' })
    .click();
  await page
    .locator('.library-actions')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();

  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Host factory', { exact: true })).toBeVisible();
  await expect(child).toBeVisible();

  await page.getByRole('button', { name: 'Library' }).click();
  await page
    .locator('.library-entry')
    .filter({ hasText: 'Starter iron line' })
    .click();
  await page
    .locator('.library-actions')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const segment = page
    .locator('.route-segment-hit[data-edge-id="edge-ore"]')
    .first();
  const box = await segment.boundingBox();
  expect(box).not.toBeNull();
  await segment.click({
    button: 'right',
    position: { x: box!.width - 2, y: box!.height / 2 },
  });
  await page.getByRole('button', { name: 'Add bridge here' }).click();
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();

  await page
    .locator('.library-entry')
    .filter({ hasText: 'Host factory' })
    .click();
  await page
    .locator('.library-actions')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await child.click();
  await expect(page.getByLabel('Sub-factory version')).toHaveValue('1');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Upgrade to v2' }).click();
  await expect(page.getByLabel('Sub-factory version')).toHaveValue('2');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Sub-factory version').selectOption('1');
  await expect(page.getByLabel('Sub-factory version')).toHaveValue('1');

  await page.getByRole('button', { name: 'Library' }).click();
  await page
    .locator('.library-entry')
    .filter({ hasText: 'Starter iron line' })
    .click();
  await page
    .locator('.version-row')
    .filter({ has: page.getByText('v2', { exact: true }) })
    .getByRole('button', { name: 'Inspect' })
    .click();
  await expect(page.getByLabel('Factory dependencies')).toBeVisible();
  await expect(
    page.locator('.dependency-canvas').getByText(/Starter iron line · v2/),
  ).toBeVisible();
});

test('reverts a draft and recreates it from the latest version on factory edit', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.version-row--draft')).toContainText(
    'Based on v1',
  );
  await page
    .locator('.version-row--draft')
    .getByRole('button', { name: 'Inspect' })
    .click();
  const draftInspection = page.getByRole('complementary', {
    name: 'Draft inspection',
  });
  await expect(draftInspection).toBeVisible();
  await expect(
    draftInspection.getByLabel('Factory inputs and outputs'),
  ).toContainText('Iron ore');
  await expect(
    draftInspection.getByLabel('Factory dependencies'),
  ).toContainText('Starter iron line · Draft');
  await draftInspection
    .getByRole('button', { name: 'Close draft inspection' })
    .click();
  const publishedVersion = page
    .locator('.version-row')
    .filter({ has: page.getByText('v1', { exact: true }) });
  await expect(
    publishedVersion.getByRole('button', { name: 'Edit' }),
  ).toHaveCount(0);
  await expect(
    publishedVersion.getByRole('button', { name: 'Fork' }),
  ).toBeVisible();

  await publishedVersion.getByRole('button', { name: 'Inspect' }).click();
  const flow = page.getByLabel('Factory inputs and outputs');
  await expect(flow).toContainText('Iron ore');
  await expect(flow).toContainText('2/s');
  await expect(flow).toContainText('Iron ingot');
  await expect(flow).toContainText('1/s');

  await page
    .locator('.version-row--draft')
    .getByRole('button', { name: 'Revert' })
    .click();
  await expect(page.locator('.version-row--draft')).toHaveCount(0);
  await expect(page.getByText('No draft · Edit starts from v1')).toBeVisible();
  await page
    .locator('.library-actions')
    .getByRole('button', { name: 'Edit' })
    .click();
  await expect(page.getByLabel('Factory graph editor')).toBeVisible();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.version-row--draft')).toContainText(
    'Based on v1',
  );
});

test('groups inspected components by name in alphabetical order', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  const ironSmelting = page
    .locator('.catalogue-item')
    .filter({ hasText: 'Iron smelting' });
  await ironSmelting.click();
  await placePreview(page, 80, 80);
  await ironSmelting.click();
  await placePreview(page, 140, 120);
  await page.getByRole('button', { name: 'Library' }).click();
  await page
    .locator('.version-row--draft')
    .getByRole('button', { name: 'Inspect' })
    .click();
  await expect(page.getByLabel('Components by type')).toHaveText(
    'Components by typeIron ingot dispatch × 1 · Iron ore intake × 1 · Iron smelting × 3',
  );
});

test('forks a published version into a newly named factory', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Library' }).click();
  page.once('dialog', (dialog) => dialog.accept('Forked iron line'));
  await page
    .locator('.version-row')
    .filter({ has: page.getByText('v1', { exact: true }) })
    .getByRole('button', { name: 'Fork' })
    .click();
  await expect(page.getByLabel('Factory graph editor')).toBeVisible();
  await expect(
    page.getByText('Forked iron line', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.graph-node')).toHaveCount(3);
});

test('deletes a factory only after its draft and versions are gone', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  page.once('dialog', (dialog) => dialog.accept('Disposable factory'));
  await page.getByRole('button', { name: 'Create factory' }).click();
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(
    page.getByRole('button', { name: 'Delete factory' }),
  ).toHaveCount(0);
  await page
    .locator('.version-row--draft')
    .getByRole('button', { name: 'Revert' })
    .click();
  await page.getByRole('button', { name: 'Delete factory' }).click();
  await expect(
    page.getByText('Disposable factory', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Factory library')).toBeVisible();
  await page
    .locator('.version-row--draft')
    .getByRole('button', { name: 'Revert' })
    .click();
  await page.getByRole('button', { name: 'Delete factory' }).click();
  await expect(page.getByText('No factory.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('No factory.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create factory' }),
  ).toBeVisible();
});

test('blocks an identity cycle and shows the exact published dependency DAG', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();
  page.once('dialog', (dialog) => dialog.accept('Factory A'));
  await page.getByRole('button', { name: 'Create factory' }).click();
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();

  await page.getByRole('button', { name: 'Library' }).click();
  page.once('dialog', (dialog) => dialog.accept('Factory B'));
  await page.getByRole('button', { name: 'Create factory' }).click();
  const factoryA = page
    .locator('.factory-catalogue-item')
    .filter({ hasText: 'Factory A' });
  await expect(factoryA).toBeEnabled();
  await factoryA.click();
  await placePreview(page);
  await page.locator('.graph-node--sub-factory').click();
  await page.getByRole('button', { name: 'Copy selection' }).click();
  await expect(page.getByText('Contract ready')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();

  await page.getByRole('button', { name: 'Library' }).click();
  await page.locator('.library-entry').filter({ hasText: 'Factory A' }).click();
  await page
    .locator('.library-actions')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const factoryB = page
    .locator('.factory-catalogue-item')
    .filter({ hasText: 'Factory B' });
  await expect(factoryB).toBeDisabled();
  await expect(factoryB).toContainText(
    /already contains Factory A.*Factory B v1 → Factory A v1/,
  );
  await page.getByRole('button', { name: 'Paste selection' }).click();
  await expect(
    page.getByText(/Placement blocked:.*would create a factory cycle/),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.locator('.library-entry').filter({ hasText: 'Factory B' }).click();
  await page
    .locator('.version-row')
    .filter({ has: page.getByText('v1', { exact: true }) })
    .getByRole('button', { name: 'Inspect' })
    .click();
  await expect(
    page.locator('.dependency-canvas').getByText('Factory B · v1'),
  ).toBeVisible();
  await expect(
    page.locator('.dependency-canvas').getByText('Factory A · v1'),
  ).toBeVisible();
});
