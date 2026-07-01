export const GRID_SIZE = 28
export const pixelToGrid = (value: number): number => Math.round(value / GRID_SIZE)
export const gridToPixel = (value: number): number => value * GRID_SIZE
