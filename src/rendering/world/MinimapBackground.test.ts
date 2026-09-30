import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinimapBackground } from './MinimapBackground';
import { OreKind, TerrainKind, type WorldGrid } from '../../world/model';

afterEach(() => vi.unstubAllGlobals());

describe('minimap background', () => {
  it('reuses terrain across snapshots and refreshes depleted ore, visibility and size', () => {
    const fillRect = vi.fn();
    const background = {
      width: 0,
      height: 0,
      getContext: () => ({ fillRect, fillStyle: '' }),
    };
    vi.stubGlobal('document', { createElement: () => background });
    const drawImage = vi.fn();
    const target = { canvas: { width: 128, height: 128 }, drawImage };
    const context = target as unknown as CanvasRenderingContext2D;
    const grid: WorldGrid = {
      width: 2,
      height: 2,
      terrain: new Uint8Array([TerrainKind.OBSTACLE, 0, 0, 0]),
      oreKinds: new Uint8Array([0, OreKind.IRON, 0, 0]),
      oreRemaining: new Uint32Array([0, 10, 0, 0]),
      occupancy: new Int32Array(4),
    };
    const cache = new MinimapBackground();
    cache.draw(context, grid, true);
    expect(fillRect).toHaveBeenCalledTimes(3);
    fillRect.mockClear();

    cache.draw(context, { ...grid, occupancy: new Int32Array(4) }, true);
    expect(fillRect).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledTimes(2);

    const depleted = { ...grid, oreRemaining: new Uint32Array(4) };
    cache.draw(context, depleted, true);
    expect(fillRect).toHaveBeenCalledTimes(2);
    fillRect.mockClear();
    cache.draw(context, grid, false);
    expect(fillRect).toHaveBeenCalledTimes(2);
    fillRect.mockClear();

    cache.draw(context, depleted, false);
    expect(fillRect).not.toHaveBeenCalled();
    target.canvas.width = 256;
    cache.draw(context, depleted, false);
    expect(background.width).toBe(256);
    expect(fillRect).toHaveBeenCalledTimes(2);
  });
});
