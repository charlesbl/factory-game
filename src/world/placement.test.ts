import { describe, expect, it } from 'vitest';
import { gridPoint, gridSize } from '../domain';
import {
  MAX_OCCUPANCY_SLOT,
  TerrainKind,
  defaultWorldGenerationConfig,
  generateWorld,
  occupy,
  release,
  rotatedSize,
  validatePlacement,
} from './index';

describe('world placement', () => {
  it('rotates rectangular footprints through all quarter turns', () => {
    expect(
      [0, 1, 2, 3].map((rotation) =>
        rotatedSize(gridSize(3, 5), rotation as 0 | 1 | 2 | 3),
      ),
    ).toEqual([
      { width: 3, height: 5 },
      { width: 5, height: 3 },
      { width: 3, height: 5 },
      { width: 5, height: 3 },
    ]);
    expect(() => rotatedSize(gridSize(3, 5), 4 as 0)).toThrow(/quarter turn/);
  });
  it('rejects invalid transforms, boundaries, obstacles, and occupied cells', () => {
    const world = generateWorld({
      ...defaultWorldGenerationConfig('placement'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const transform = {
      position: gridPoint(world.spawn.x, world.spawn.y),
      size: gridSize(4, 2),
      rotation: 1 as const,
    };
    expect(validatePlacement(world.grid, transform).valid).toBe(true);
    for (const rotation of [0, 1, 2, 3] as const)
      expect(
        validatePlacement(world.grid, {
          ...transform,
          position: gridPoint(-1, 0),
          rotation,
        }),
      ).toEqual({ valid: false, reason: 'OUT_OF_BOUNDS' });
    expect(
      validatePlacement(world.grid, { ...transform, rotation: 7 as 0 }),
    ).toEqual({ valid: false, reason: 'INVALID_TRANSFORM' });
    const first = world.spawn.y * world.grid.width + world.spawn.x;
    world.grid.terrain[first] = TerrainKind.OBSTACLE;
    expect(validatePlacement(world.grid, transform)).toEqual({
      valid: false,
      reason: 'OBSTACLE',
    });
    world.grid.terrain[first] = TerrainKind.BUILDABLE;
    occupy(world.grid, transform, 7);
    expect(validatePlacement(world.grid, transform)).toEqual({
      valid: false,
      reason: 'OCCUPIED',
    });
    release(world.grid, transform, 7);
    expect(validatePlacement(world.grid, transform).valid).toBe(true);
  });
  it('validates slots and never partially releases another entity', () => {
    const world = generateWorld({
      ...defaultWorldGenerationConfig('exact-release'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const transform = {
      position: world.spawn,
      size: gridSize(3, 2),
      rotation: 0 as const,
    };
    expect(() => occupy(world.grid, transform, 0)).toThrow(/Int32/);
    expect(() => occupy(world.grid, transform, MAX_OCCUPANCY_SLOT + 1)).toThrow(
      /Int32/,
    );
    occupy(world.grid, transform, 9);
    const occupied = world.grid.occupancy.slice();
    expect(() => release(world.grid, transform, 8)).toThrow(/exactly/);
    expect(world.grid.occupancy).toEqual(occupied);
    expect(() =>
      release(
        world.grid,
        {
          ...transform,
          position: gridPoint(transform.position.x + 1, transform.position.y),
        },
        9,
      ),
    ).toThrow(/exactly/);
    expect(world.grid.occupancy).toEqual(occupied);
    release(world.grid, transform, 9);
    expect(world.grid.occupancy.some((slot) => slot !== 0)).toBe(false);
  });
});
