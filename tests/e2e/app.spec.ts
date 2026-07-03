import { expect, test } from '@playwright/test'

test('opens the graph editor and compiles the demo factory', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Machine catalogue' })).toBeVisible()
  await expect(page.getByText('Contract ready')).toBeVisible()
  await expect(page.getByLabel('Factory graph editor')).toBeVisible()
  const machine = page.locator('.graph-node--machine').first()
  const body = await machine.boundingBox(); const inputPad = await machine.getByLabel('input Iron ore').boundingBox(); const outputPad = await machine.getByLabel('output Iron ingot').boundingBox()
  expect(body).not.toBeNull(); expect(inputPad).not.toBeNull(); expect(outputPad).not.toBeNull()
  expect(Math.abs(inputPad!.x + inputPad!.width / 2 - body!.x)).toBeLessThan(3)
  expect(Math.abs(outputPad!.x + outputPad!.width / 2 - (body!.x + body!.width))).toBeLessThan(3)
})

test('adds a machine and supports undo', async ({ page }) => {
  await page.goto('/')
  const nodes = page.locator('.graph-node'); await expect(nodes).toHaveCount(3)
  await page.getByRole('button', { name: /Copper drill/i }).click(); await expect(nodes).toHaveCount(4)
  await page.getByRole('button', { name: 'Undo' }).click(); await expect(nodes).toHaveCount(3)
})

test('runs the exact world boundary simulation', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  await page.getByRole('button', { name: 'Supply +12' }).click(); await page.getByRole('button', { name: 'Run 5 s' }).click()
  await expect(page.getByText('5/24')).toBeVisible()
})

test('switches between the world overview and factory editor', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  await page.getByRole('button', { name: 'World', exact: true }).click()
  await expect(page.getByLabel('World overview')).toBeVisible()
  await expect(page.getByText('Contract rate')).toHaveCount(2)
  await expect(page.getByText('2/s')).toBeVisible()
  await expect(page.getByText('max 6/s · 33%')).toBeVisible()
  await expect(page.getByText('1/s')).toBeVisible()
  await expect(page.getByText('max 4/s · 25%')).toBeVisible()
  await expect(page.getByRole('button', { name: /Open Starter iron line factory/i })).toBeVisible()
  await page.getByRole('button', { name: /Open Starter iron line factory/i }).click()
  await expect(page.getByLabel('Factory graph editor')).toBeVisible()
})

test('deletes a selected node with its routes and restores it with undo', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  const nodes = page.locator('.graph-node'); const edges = page.locator('.react-flow__edge')
  await expect(nodes).toHaveCount(3); await expect(edges).toHaveCount(2)
  await nodes.filter({ hasText: 'Iron smelting' }).click()
  await page.getByRole('button', { name: /Delete \(1\)/ }).click()
  await expect(nodes).toHaveCount(2); await expect(edges).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(nodes).toHaveCount(3); await expect(edges).toHaveCount(2)
})

test('deletes a selected route and restores it with undo', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  const edges = page.locator('.react-flow__edge')
  await page.getByLabel('Route edge-ingot segment 1').click()
  await page.getByRole('button', { name: /Delete \(1\)/ }).click()
  await expect(edges).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(edges).toHaveCount(2)
})

test('filters the machine catalogue', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Search machines').fill('wire')
  await expect(page.locator('.catalogue-item')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /Wire drawing/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Circuit assembly/i })).toBeVisible()
})

test('rejects a second route on an occupied connector', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  await page.getByRole('button', { name: /Iron smelting/i }).click()
  const nodes = page.locator('.graph-node')
  const secondFurnace = nodes.filter({ hasText: 'Iron smelting' }).last()
  const intake = nodes.filter({ hasText: 'Iron ore intake' })
  await page.locator('.react-flow__minimap').evaluate((element) => element.remove())

  const drag = async (from: ReturnType<typeof page.locator>, to: ReturnType<typeof page.locator>) => {
    const a = await from.boundingBox(); const b = await to.boundingBox(); expect(a).not.toBeNull(); expect(b).not.toBeNull()
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2); await page.mouse.down(); await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 5 }); await page.mouse.up()
  }
  await drag(intake.getByLabel('output Iron ore'), secondFurnace.getByLabel('input Iron ore'))
  await expect(page.getByText('This connector already carries a route.')).toBeVisible()
  await expect(page.locator('.react-flow__edge')).toHaveCount(2)
  await expect(page.locator('.conveyor-label')).toHaveCount(0)
})

test('creates persistent loose connections without editor modes and cancels only the active gesture', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  const edges = page.locator('.react-flow__edge'); await expect(edges).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Route', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '→ Intake' }).click()
  await page.getByRole('button', { name: 'Fit View' }).click()
  const source = page.locator('.graph-node--external-input').last().getByLabel('output Iron ore'); const box = await source.boundingBox(); expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2; const y = box!.y + box!.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y + 80, { steps: 5 }); await expect(page.locator('.route-preview')).toBeVisible(); await page.mouse.up()
  await expect(page.locator('.loose-route')).toHaveCount(1); await expect(page.getByLabel('Free route endpoint')).toHaveCount(1)
  const free = await page.getByLabel('Free route endpoint').boundingBox(); expect(free).not.toBeNull()
  await page.mouse.move(free!.x + free!.width / 2, free!.y + free!.height / 2); await page.mouse.down(); await page.mouse.move(free!.x + 90, free!.y + 60, { steps: 5 }); await page.mouse.up()
  await expect(page.locator('.route-connector')).toHaveCount(4)
  await page.getByRole('button', { name: '→ Intake' }).click(); await page.getByRole('button', { name: 'Fit View' }).click()
  const sourceAgain = await page.locator('.graph-node--external-input').last().getByLabel('output Iron ore').boundingBox(); expect(sourceAgain).not.toBeNull(); const x2 = sourceAgain!.x + sourceAgain!.width / 2; const y2 = sourceAgain!.y + sourceAgain!.height / 2
  await page.mouse.move(x2, y2); await page.mouse.down(); await page.mouse.move(x2 + 60, y2 - 70, { steps: 4 }); await expect(page.locator('.route-preview')).toBeVisible(); await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(page.locator('.loose-route')).toHaveCount(1)
  await expect(edges).toHaveCount(2)
})

test('places the same boundary components used by the starter factory', async ({ page }) => {
  await page.goto('/')
  const nodes = page.locator('.graph-node'); await expect(nodes).toHaveCount(3)
  await page.getByLabel('Boundary resource').selectOption('copperOre')
  await page.getByRole('button', { name: '→ Intake' }).click(); await expect(nodes).toHaveCount(4)
  await expect(page.locator('.graph-node--external-input').filter({ hasText: 'Copper ore intake' })).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click(); await expect(nodes).toHaveCount(3)
})

test('types a junction component and reveals the next free connector', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  await page.getByRole('button', { name: '→ Intake' }).click()
  await page.getByRole('button', { name: 'Junction' }).click()
  await page.getByRole('button', { name: 'Fit View' }).click()
  await page.locator('.react-flow__minimap').evaluate((element) => element.remove())
  const source = page.locator('.graph-node--external-input').last().getByLabel('output Iron ore')
  const junction = page.locator('.graph-node--junction').last(); const target = junction.getByLabel('input Any')
  const a = await source.boundingBox(); const b = await target.boundingBox(); expect(a).not.toBeNull(); expect(b).not.toBeNull()
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2); await page.mouse.down(); await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 5 }); await page.mouse.up()
  await expect(junction.getByLabel('input Iron ore')).toHaveCount(2)
  await expect(junction.getByLabel('output Iron ore')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge')).toHaveCount(3)
})

test('shows, adds, moves, and removes connection handles', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  const connectors = page.locator('.route-connector'); await expect(connectors).toHaveCount(2)
  const path = page.locator('.conveyor-path').first(); const before = await path.getAttribute('d')
  await page.locator('.route-segment-hit[data-edge-id="edge-ore"]').first().dblclick(); await expect(connectors).toHaveCount(3)
  await page.keyboard.press('Delete'); await expect(connectors).toHaveCount(2)
  const movable = connectors.first(); const box = await movable.boundingBox(); expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down(); await page.mouse.move(box!.x + 48, box!.y + 48, { steps: 4 }); await page.mouse.up()
  await expect.poll(() => path.getAttribute('d')).not.toBe(before)
  await connectors.first().dblclick(); await expect(connectors).toHaveCount(1)
})

test('adds a bridge from a contextual route action', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  const segment = page.locator('.route-segment-hit[data-edge-id="edge-ore"]').first(); const box = await segment.boundingBox(); expect(box).not.toBeNull()
  await segment.click({ button: 'right', position: { x: box!.width - 2, y: box!.height / 2 } })
  await page.getByRole('button', { name: 'Add bridge here' }).click()
  await expect(page.locator('.conveyor-path--bridge')).toHaveCount(1)
  await expect(page.locator('.bridge-marker')).toHaveCount(2)
})
