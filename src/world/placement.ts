import type { GridPoint } from '../domain'
import { MAX_OCCUPANCY_SLOT, TerrainKind, gridIndex, rotatedSize, type QuarterTurn, type WorldGrid, type WorldTransform } from './model'

export interface PlacementResult { readonly valid: boolean; readonly reason?: 'INVALID_TRANSFORM' | 'OUT_OF_BOUNDS' | 'OBSTACLE' | 'OCCUPIED' }

const validTransform = (transform: WorldTransform): boolean => Number.isSafeInteger(transform.position.x) && Number.isSafeInteger(transform.position.y)
  && Number.isSafeInteger(transform.size.width) && transform.size.width > 0 && Number.isSafeInteger(transform.size.height) && transform.size.height > 0
  && (transform.rotation === 0 || transform.rotation === 1 || transform.rotation === 2 || transform.rotation === 3)

export const occupiedCells = (transform: WorldTransform): readonly GridPoint[] => {
  const size = rotatedSize(transform.size, transform.rotation); const cells: GridPoint[] = []
  for (let y = 0; y < size.height; y += 1) for (let x = 0; x < size.width; x += 1) cells.push({ x: transform.position.x + x, y: transform.position.y + y })
  return cells
}

export const validatePlacement = (grid: WorldGrid, transform: WorldTransform): PlacementResult => {
  if (!validTransform(transform)) return { valid: false, reason: 'INVALID_TRANSFORM' }
  for (const point of occupiedCells(transform)) { const index = gridIndex(grid, point); if (index < 0) return { valid: false, reason: 'OUT_OF_BOUNDS' }; if (grid.terrain[index] === TerrainKind.OBSTACLE) return { valid: false, reason: 'OBSTACLE' }; if (grid.occupancy[index] !== 0) return { valid: false, reason: 'OCCUPIED' } }
  return { valid: true }
}

export const occupy = (grid: WorldGrid, transform: WorldTransform, slot: number): void => { if (!Number.isSafeInteger(slot) || slot <= 0 || slot > MAX_OCCUPANCY_SLOT) throw new RangeError('Occupancy slot must fit a positive Int32'); const result = validatePlacement(grid, transform); if (!result.valid) throw new Error(`Invalid placement: ${result.reason}`); for (const point of occupiedCells(transform)) grid.occupancy[gridIndex(grid, point)] = slot }
export const release = (grid: WorldGrid, transform: WorldTransform, slot: number): void => {
  if (!Number.isSafeInteger(slot) || slot <= 0 || slot > MAX_OCCUPANCY_SLOT) throw new RangeError('Occupancy slot must fit a positive Int32')
  if (!validTransform(transform)) throw new Error('Invalid release transform')
  const indexes = occupiedCells(transform).map((point) => gridIndex(grid, point))
  if (indexes.some((index) => index < 0 || grid.occupancy[index] !== slot)) throw new Error('Occupancy does not exactly match the released entity')
  for (const index of indexes) grid.occupancy[index] = 0
}
export const rotateQuarter = (rotation: QuarterTurn, delta: 1 | -1 = 1): QuarterTurn => ((rotation + delta + 4) % 4) as QuarterTurn
