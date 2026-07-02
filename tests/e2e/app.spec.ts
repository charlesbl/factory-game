import { expect, test } from '@playwright/test'

test('opens the graph editor and compiles the demo factory', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Machine catalogue' })).toBeVisible()
  await expect(page.getByText('Contract ready')).toBeVisible()
  await expect(page.getByLabel('Factory graph editor')).toBeVisible()
  const machine = page.locator('.graph-node--machine').first()
  const inputResource = await machine.locator('.port-row--input .port-resource').boundingBox()
  const inputRate = await machine.locator('.port-row--input .port-rate').boundingBox()
  const outputResource = await machine.locator('.port-row--output .port-resource').boundingBox()
  const outputRate = await machine.locator('.port-row--output .port-rate').boundingBox()
  expect(inputResource).not.toBeNull(); expect(inputRate).not.toBeNull(); expect(outputResource).not.toBeNull(); expect(outputRate).not.toBeNull()
  expect(inputRate!.x - (inputResource!.x + inputResource!.width)).toBeLessThan(12)
  expect(outputResource!.x - (outputRate!.x + outputRate!.width)).toBeLessThan(12)
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
  await expect(page.getByRole('button', { name: /Open Copperleaf works factory/i })).toBeVisible()
  await page.getByRole('button', { name: /Open Copperleaf works factory/i }).click()
  await expect(page.getByLabel('Factory graph editor')).toBeVisible()
})

test('deletes a selected node with its routes and restores it with undo', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  const nodes = page.locator('.graph-node'); const edges = page.locator('.react-flow__edge')
  await expect(nodes).toHaveCount(3); await expect(edges).toHaveCount(2)
  await nodes.filter({ hasText: 'Iron furnace' }).click()
  await page.getByRole('button', { name: /Delete \(1\)/ }).click()
  await expect(nodes).toHaveCount(2); await expect(edges).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(nodes).toHaveCount(3); await expect(edges).toHaveCount(2)
})

test('deletes a selected route and restores it with undo', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  const edges = page.locator('.react-flow__edge')
  await page.getByRole('group', { name: 'Edge from node-furnace to node-iron-output' }).click()
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

test('highlights the conflicting paths when two routes share a single-connection port', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Contract ready')).toBeVisible()
  await page.getByRole('button', { name: /Iron smelting/i }).click()
  const nodes = page.locator('.graph-node')
  const secondFurnace = nodes.filter({ hasText: 'Iron smelting' })
  const intake = nodes.filter({ hasText: 'Iron ore intake' })
  const dispatch = nodes.filter({ hasText: 'Ingot dispatch' })
  await page.locator('.react-flow__minimap').evaluate((element) => element.remove())

  await intake.getByLabel('output Iron ore').dragTo(secondFurnace.getByLabel('input Iron ore'))
  await secondFurnace.getByLabel('output Iron ingot').dragTo(dispatch.getByLabel('input Iron ingot'))

  await expect(page.getByText('Invalid graph')).toBeVisible()
  await expect(page.getByText('This port accepts 1 route, but 2 are connected.').first()).toBeVisible()
  await expect(page.locator('.diagnostic-edge--error')).toHaveCount(2)
  await expect(page.locator('.diagnostic-edge--blocked')).toHaveCount(2)
  await expect(dispatch).toHaveClass(/has-error/)
})
