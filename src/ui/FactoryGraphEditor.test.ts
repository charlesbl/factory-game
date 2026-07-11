import { describe, expect, it } from 'vitest';
import { gridToPixel, pixelToGrid } from './grid-projection';
describe('grid projection', () => {
  it('round-trips integer logical positions', () => {
    for (let value = -50; value <= 50; value += 1)
      expect(pixelToGrid(gridToPixel(value))).toBe(value);
  });
});
