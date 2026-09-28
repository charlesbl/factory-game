import type { GridPoint } from '../domain';
import {
  MAX_OCCUPANCY_SLOT,
  TerrainKind,
  gridIndex,
  rotatedSize,
  type QuarterTurn,
  type WorldGrid,
  type WorldTransform,
} from './model';

export interface PlacementResult {
  readonly valid: boolean;
  readonly reason?:
    'INVALID_TRANSFORM' | 'OUT_OF_BOUNDS' | 'OBSTACLE' | 'OCCUPIED';
}

/** Shared by the draft and the worker. Validate the entire path before mutation. */
export const validateRailPath = (
  grid: Pick<WorldGrid, 'width' | 'height' | 'occupancy'>,
  points: readonly GridPoint[],
): { readonly valid: boolean; readonly reason?: string } => {
  if (
    points.length < 2 ||
    points.every((p) => p.x === points[0]!.x && p.y === points[0]!.y)
  )
    return {
      valid: false,
      reason: 'Rail path needs at least two distinct points',
    };
  for (const point of points)
    if (gridIndex(grid, point) < 0)
      return { valid: false, reason: 'Rail path must stay inside the world' };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    if (a.x !== b.x && a.y !== b.y)
      return { valid: false, reason: 'Rail segments must be cardinal' };
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const dx = Math.sign(b.x - a.x),
      dy = Math.sign(b.y - a.y);
    for (let step = 0; step <= length; step++) {
      const x = a.x + dx * step,
        y = a.y + dy * step;
      if (grid.occupancy[y * grid.width + x] !== 0)
        return {
          valid: false,
          reason: `Rail crosses a building at ${x}, ${y}. Route around its footprint; connect stations and depots at their exterior hookup.`,
        };
    }
  }
  return { valid: true };
};

const validTransform = (transform: WorldTransform): boolean =>
  Number.isSafeInteger(transform.position.x) &&
  Number.isSafeInteger(transform.position.y) &&
  Number.isSafeInteger(transform.size.width) &&
  transform.size.width > 0 &&
  Number.isSafeInteger(transform.size.height) &&
  transform.size.height > 0 &&
  (transform.rotation === 0 ||
    transform.rotation === 1 ||
    transform.rotation === 2 ||
    transform.rotation === 3);

export const occupiedCells = (
  transform: WorldTransform,
): readonly GridPoint[] => {
  const size = rotatedSize(transform.size, transform.rotation);
  const cells: GridPoint[] = [];
  for (let y = 0; y < size.height; y += 1)
    for (let x = 0; x < size.width; x += 1)
      cells.push({ x: transform.position.x + x, y: transform.position.y + y });
  return cells;
};

export const validatePlacement = (
  grid: WorldGrid,
  transform: WorldTransform,
): PlacementResult => {
  if (!validTransform(transform))
    return { valid: false, reason: 'INVALID_TRANSFORM' };
  for (const point of occupiedCells(transform)) {
    const index = gridIndex(grid, point);
    if (index < 0) return { valid: false, reason: 'OUT_OF_BOUNDS' };
    if (grid.terrain[index] === TerrainKind.OBSTACLE)
      return { valid: false, reason: 'OBSTACLE' };
    if (grid.occupancy[index] !== 0)
      return { valid: false, reason: 'OCCUPIED' };
  }
  return { valid: true };
};

export const occupy = (
  grid: WorldGrid,
  transform: WorldTransform,
  slot: number,
): void => {
  if (!Number.isSafeInteger(slot) || slot <= 0 || slot > MAX_OCCUPANCY_SLOT)
    throw new RangeError('Occupancy slot must fit a positive Int32');
  const result = validatePlacement(grid, transform);
  if (!result.valid) throw new Error(`Invalid placement: ${result.reason}`);
  for (const point of occupiedCells(transform))
    grid.occupancy[gridIndex(grid, point)] = slot;
};
export const release = (
  grid: WorldGrid,
  transform: WorldTransform,
  slot: number,
): void => {
  if (!Number.isSafeInteger(slot) || slot <= 0 || slot > MAX_OCCUPANCY_SLOT)
    throw new RangeError('Occupancy slot must fit a positive Int32');
  if (!validTransform(transform)) throw new Error('Invalid release transform');
  const indexes = occupiedCells(transform).map((point) =>
    gridIndex(grid, point),
  );
  if (indexes.some((index) => index < 0 || grid.occupancy[index] !== slot))
    throw new Error('Occupancy does not exactly match the released entity');
  for (const index of indexes) grid.occupancy[index] = 0;
};
export const rotateQuarter = (
  rotation: QuarterTurn,
  delta: 1 | -1 = 1,
): QuarterTurn => ((rotation + delta + 4) % 4) as QuarterTurn;

/** Outward direction of the building's front edge per quarter turn. Rotation 0
 * fronts +Y (south); each turn is one clockwise map turn (Y rotation -PI/2). */
export const frontDirection = (rotation: QuarterTurn): GridPoint => {
  if (rotation === 0) return { x: 0, y: 1 };
  if (rotation === 1) return { x: -1, y: 0 };
  if (rotation === 2) return { x: 0, y: -1 };
  return { x: 1, y: 0 };
};

/** The rail hookup cell of a rotated footprint: one cell outside the centre of
 * the front edge of the rotated occupied rectangle. Along the edge the cell is
 * `min + floor(len / 2)`, deterministic for even sizes. */
export const hookupCell = (transform: WorldTransform): GridPoint => {
  const size = rotatedSize(transform.size, transform.rotation);
  const direction = frontDirection(transform.rotation);
  const centre =
    direction.x === 0
      ? transform.position.x + Math.floor(size.width / 2)
      : transform.position.y + Math.floor(size.height / 2);
  return {
    x:
      direction.x === 0
        ? centre
        : direction.x > 0
          ? transform.position.x + size.width
          : transform.position.x - 1,
    y:
      direction.x !== 0
        ? centre
        : direction.y > 0
          ? transform.position.y + size.height
          : transform.position.y - 1,
  };
};
