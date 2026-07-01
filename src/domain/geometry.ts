export interface GridPoint { readonly x: number; readonly y: number }
export interface GridSize { readonly width: number; readonly height: number }
export interface GridRect extends GridPoint, GridSize {}
export type Polyline = readonly GridPoint[]

const integer = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`)
  return value
}

export const gridPoint = (x: number, y: number): GridPoint => ({ x: integer(x, 'x'), y: integer(y, 'y') })
export const gridSize = (width: number, height: number): GridSize => {
  if (integer(width, 'width') <= 0 || integer(height, 'height') <= 0) throw new RangeError('Grid size must be positive')
  return { width, height }
}
export const manhattanDistance = (a: GridPoint, b: GridPoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
export const polylineLength = (line: Polyline): number => {
  if (line.length < 2) throw new RangeError('A polyline requires at least two points')
  return line.slice(1).reduce((total, point, index) => total + manhattanDistance(line[index]!, point), 0)
}

export const boundingRect = (points: readonly GridPoint[], margin = 0): GridRect => {
  if (points.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs) - margin
  const minY = Math.min(...ys) - margin
  return { x: minX, y: minY, width: Math.max(...xs) - minX + margin + 1, height: Math.max(...ys) - minY + margin + 1 }
}
