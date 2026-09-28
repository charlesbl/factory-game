import { describe, expect, it } from 'vitest';
import { gridPoint, gridSize } from '../../domain';
import { occupiedCells, type QuarterTurn } from '../../world';
import {
  footprintCentre,
  footprintSize,
  gridToWorld,
  quarterTurnRadians,
  worldToGrid,
} from './GridSpace';

describe('the logical grid and 3D transform contract', () => {
  it('centres a non-square footprint on the rotated occupied rectangle in every orientation', () => {
    for (const rotation of [0, 1, 2, 3] as const) {
      const transform = {
        position: gridPoint(10, 20),
        size: gridSize(4, 2),
        rotation,
      };
      const cells = occupiedCells(transform);
      const [width, depth] = footprintSize(transform);
      const centre = footprintCentre(transform);
      expect(centre).toEqual(rotation % 2 ? [11, 0, 22] : [12, 0, 21]);
      expect(centre[0] - width / 2).toBe(
        Math.min(...cells.map((cell) => cell.x)),
      );
      expect(centre[2] + depth / 2).toBe(
        Math.max(...cells.map((cell) => cell.y)) + 1,
      );
      expect(quarterTurnRadians(rotation as QuarterTurn)).toBe(
        (-rotation * Math.PI) / 2,
      );
    }
  });
  it('uses tile centres for nodes and keeps outside hits outside the half-open grid', () => {
    expect(gridToWorld(gridPoint(10, 20))).toEqual([10.5, 0, 20.5]);
    expect(worldToGrid(-0.001, 64)).toEqual({ x: -1, y: 64 });
    expect(worldToGrid(10.999, 20)).toEqual({ x: 10, y: 20 });
  });
});
