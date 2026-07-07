import { describe, expect, it } from 'vitest'
import { gridPoint } from '../domain'
import { MAX_ORE_PER_TILE, OreKind, TerrainKind, defaultWorldGenerationConfig, deserializeGeneratedWorld, generateWorld, gridIndex, serializeGeneratedWorld } from './index'

const flood = (terrain: Uint8Array, width: number, start: number): Uint8Array => {
  const seen = new Uint8Array(terrain.length); const queue = [start]; seen[start] = 1
  for (let head = 0; head < queue.length; head += 1) { const index = queue[head]!; const x = index % width; const candidates = [index - width, index + 1, index + width, index - 1]; for (const next of candidates) if (next >= 0 && next < terrain.length && Math.abs(next % width - x) + Math.abs(Math.floor(next / width) - Math.floor(index / width)) === 1 && seen[next] === 0 && terrain[next] === TerrainKind.BUILDABLE) { seen[next] = 1; queue.push(next) } }
  return seen
}

const bytes = (array: Uint8Array | Uint32Array | Int32Array): readonly number[] => [...new Uint8Array(array.buffer, array.byteOffset, array.byteLength)]
const countPatches = (oreKinds: Uint8Array, width: number, ore: OreKind): number => {
  const seen = new Uint8Array(oreKinds.length); let patches = 0
  for (let start = 0; start < oreKinds.length; start += 1) if (oreKinds[start] === ore && seen[start] === 0) {
    patches += 1; const queue = [start]; seen[start] = 1
    for (let head = 0; head < queue.length; head += 1) { const index = queue[head]!; const x = index % width; for (const next of [index - width, index + 1, index + width, index - 1]) if (next >= 0 && next < oreKinds.length && Math.abs(next % width - x) === (next === index - width || next === index + width ? 0 : 1) && oreKinds[next] === ore && seen[next] === 0) { seen[next] = 1; queue.push(next) } }
  }
  return patches
}

describe('procedural world generation', () => {
  it('is byte deterministic for a seed and keeps the spawn clearing buildable', () => {
    const config = defaultWorldGenerationConfig('deterministic-seed'); const first = generateWorld(config); const second = generateWorld(config)
    for (const key of ['terrain', 'oreKinds', 'oreRemaining', 'occupancy'] as const) expect(bytes(first.grid[key])).toEqual(bytes(second.grid[key]))
    expect(bytes(generateWorld({ ...config, seed: 'different-seed' }).grid.terrain)).not.toEqual(bytes(first.grid.terrain))
    const startX = first.spawn.x - Math.floor(config.spawnClearingSize / 2); const startY = first.spawn.y - Math.floor(config.spawnClearingSize / 2)
    for (let y = startY; y < startY + config.spawnClearingSize; y += 1) for (let x = startX; x < startX + config.spawnClearingSize; x += 1) { const index = gridIndex(first.grid, gridPoint(x, y)); expect(first.grid.terrain[index]).toBe(TerrainKind.BUILDABLE); expect(first.grid.oreKinds[index]).toBe(OreKind.NONE) }
  })

  it('creates three finite patches per resource and makes iron and copper reachable', () => {
    const world = generateWorld(defaultWorldGenerationConfig('accessibility')); const access = flood(world.grid.terrain, world.grid.width, gridIndex(world.grid, world.spawn))
    for (const ore of [OreKind.IRON, OreKind.COPPER]) { expect(countPatches(world.grid.oreKinds, world.grid.width, ore)).toBe(3); expect(world.grid.oreKinds.filter((item) => item === ore).length).toBeGreaterThanOrEqual(3 * 24); expect(world.grid.oreKinds.some((item, index) => item === ore && access[index] === 1)).toBe(true) }
    expect(world.grid.oreRemaining.every((amount, index) => world.grid.oreKinds[index] === OreKind.NONE ? amount === 0 : amount === 100)).toBe(true)
  })

  it('keeps exact patches, clearing, quantities, and reachability over bounded seeds', () => {
    for (let seed = 0; seed < 24; seed += 1) {
      const config = { ...defaultWorldGenerationConfig(`bounded-${seed}`), width: 64, height: 64, spawnClearingSize: 17, orePerTile: seed + 1 }; const world = generateWorld(config); const access = flood(world.grid.terrain, world.grid.width, gridIndex(world.grid, world.spawn))
      for (const ore of [OreKind.IRON, OreKind.COPPER]) { expect(countPatches(world.grid.oreKinds, world.grid.width, ore)).toBe(config.patchesPerResource); expect(world.grid.oreKinds.some((kind, index) => kind === ore && access[index] === 1)).toBe(true) }
      expect(world.grid.oreRemaining.every((amount, index) => Number.isInteger(amount) && (world.grid.oreKinds[index] === OreKind.NONE ? amount === 0 : amount === config.orePerTile))).toBe(true)
      const startX = world.spawn.x - Math.floor(config.spawnClearingSize / 2); const startY = world.spawn.y - Math.floor(config.spawnClearingSize / 2)
      for (let y = startY; y < startY + config.spawnClearingSize; y += 1) for (let x = startX; x < startX + config.spawnClearingSize; x += 1) expect(world.grid.oreKinds[gridIndex(world.grid, gridPoint(x, y))]).toBe(OreKind.NONE)
    }
  })

  it('round-trips the authoritative generated arrays', () => {
    const world = generateWorld(defaultWorldGenerationConfig('round-trip')); world.grid.terrain[0] = TerrainKind.BUILDABLE; world.grid.occupancy[0] = 42; const restored = deserializeGeneratedWorld(serializeGeneratedWorld(world))
    expect(restored.id).toBe(world.id); expect(restored.grid.terrain).toEqual(world.grid.terrain); expect(restored.grid.oreKinds).toEqual(world.grid.oreKinds); expect(restored.grid.oreRemaining).toEqual(world.grid.oreRemaining); expect(restored.grid.occupancy).toEqual(world.grid.occupancy)
  })

  it('rejects invalid configs and corrupt arrays before typed-array coercion', () => {
    const config = { ...defaultWorldGenerationConfig('validation'), width: 64, height: 64, spawnClearingSize: 17 }
    expect(() => generateWorld({ ...config, orePerTile: 0 })).toThrow(/positive/); expect(() => generateWorld({ ...config, orePerTile: MAX_ORE_PER_TILE + 1 })).toThrow(/Uint32/); expect(() => generateWorld({ ...config, patchesPerResource: 32 })).toThrow(/distinct ore patches/); expect(() => generateWorld({ ...config, seed: 7 } as unknown as typeof config)).toThrow(/string/)
    const serialized = serializeGeneratedWorld(generateWorld(config)); expect(() => deserializeGeneratedWorld({ ...serialized, occupancy: serialized.occupancy.map((slot, index) => index === 0 ? -1 : slot) })).toThrow(/occupancy/)
    expect(() => deserializeGeneratedWorld({ ...serialized, oreRemaining: serialized.oreRemaining.map((amount, index) => index === 0 && serialized.oreKinds[index] === OreKind.NONE ? 1 : amount) })).toThrow(/ore quantity/)
  })
})
