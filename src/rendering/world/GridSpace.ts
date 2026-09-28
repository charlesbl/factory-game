import type { GridPoint } from '../../domain';
import type { QuarterTurn, WorldTransform } from '../../world';

/** One logical tile is one world unit. Logical Y maps to world Z. */
export const gridToWorld = (
  point: GridPoint,
): readonly [number, number, number] => [point.x + 0.5, 0, point.y + 0.5];

export const worldToGrid = (x: number, z: number): GridPoint => ({
  x: Math.floor(x),
  y: Math.floor(z),
});

export const footprintSize = (
  transform: WorldTransform,
): readonly [number, number] =>
  transform.rotation % 2 === 0
    ? [transform.size.width, transform.size.height]
    : [transform.size.height, transform.size.width];

export const footprintCentre = (
  transform: WorldTransform,
): readonly [number, number, number] => {
  const [width, depth] = footprintSize(transform);
  return [
    transform.position.x + width / 2,
    0,
    transform.position.y + depth / 2,
  ];
};

export const quarterTurnRadians = (rotation: QuarterTurn): number =>
  (-rotation * Math.PI) / 2;
