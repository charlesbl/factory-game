import { expect, test, type Locator } from '@playwright/test';

const setRange = async (slider: Locator, value: number) => {
  await expect(slider).toBeEnabled();
  await slider.focus();
  await expect(slider).toBeEnabled();
  await slider.evaluate((element, next) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};

test('stock ranges clamp crossing handles and adding an item excludes duplicates', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  const canvas = page.locator('.world-three-host canvas');
  await expect(canvas).toHaveAttribute('data-renderer-ready', 'true', {
    timeout: 30_000,
  });
  await canvas.evaluate((element) =>
    (element as HTMLCanvasElement)
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context')!
      .loseContext(),
  );
  const pause = page.getByRole('button', { name: 'Pause world' });
  if (await pause.count()) await pause.click();
  await page.locator('.world-object-browser summary').click();
  await page
    .locator('.world-object-browser button')
    .filter({ hasText: 'storage' })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Stock rules' }),
  ).toBeVisible();
  const maximum = page.getByRole('slider', {
    name: 'ironPlate maximum',
    exact: true,
  });
  const minimum = page.getByRole('slider', {
    name: 'ironPlate minimum',
    exact: true,
  });
  await setRange(maximum, 100);
  await maximum.press('ArrowRight');
  await expect(maximum).toHaveValue('101');
  await setRange(minimum, 50);
  await minimum.press('ArrowRight');
  await expect(minimum).toHaveValue('51');
  await setRange(maximum, 40);
  await maximum.press('ArrowLeft');
  await expect(maximum).toHaveValue('39');
  await expect(minimum).toHaveValue('39');
  const selector = page.getByLabel('Rule resource', { exact: true });
  await expect(selector.locator('option[value="ironPlate"]')).toHaveCount(0);
  await selector.selectOption('ironOre');
  await page.getByRole('button', { name: 'Add stock rule' }).click();
  await expect(
    page.getByRole('slider', { name: 'ironOre minimum', exact: true }),
  ).toHaveValue('0');
  await expect(
    page.getByRole('slider', { name: 'ironOre maximum', exact: true }),
  ).toHaveValue('0');
  await expect(selector.locator('option[value="ironOre"]')).toHaveCount(0);
  await expect(page.locator('.world-save-state')).toHaveText('Saved');
  await page.reload();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-renderer-ready', 'true', {
    timeout: 30_000,
  });
  await page.locator('.world-object-browser summary').click();
  await page
    .locator('.world-object-browser button')
    .filter({ hasText: 'storage' })
    .first()
    .click();
  await expect(
    page.getByRole('slider', { name: 'ironPlate minimum', exact: true }),
  ).toHaveValue('39');
  await expect(
    page.getByRole('slider', { name: 'ironPlate maximum', exact: true }),
  ).toHaveValue('39');
});
