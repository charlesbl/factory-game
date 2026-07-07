import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { asId, parseExact, stringifyExact } from './domain'
import type { ResourceId } from './domain'
import { WorldBuffer, transferItems } from './simulation'
import { RailNetwork } from './logistics'

describe('generative simulation invariants', () => {
  it('world quantities stay integer and conserved across transfers', () => fc.assert(fc.property(
    fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 10_000 }),
    (sourceQuantity, targetQuantity, request) => {
      const capacity = 10_000; const resource = asId<ResourceId>('ironOre')
      const source = new WorldBuffer(resource, capacity, sourceQuantity); const target = new WorldBuffer(resource, capacity, targetQuantity)
      const total = source.quantity + target.quantity; transferItems(source, target, request)
      expect(source.quantity + target.quantity).toBe(total); expect(Number.isInteger(source.quantity)).toBe(true); expect(Number.isInteger(target.quantity)).toBe(true)
    },
  ), { seed: 20260701, numRuns: 500 }))
  it('exact serialisation is stable for arbitrary phases', () => fc.assert(fc.property(fc.array(fc.bigInt({ min: 0n, max: 10n ** 24n }), { maxLength: 50 }), (phases) => {
    expect(parseExact<bigint[]>(stringifyExact(phases))).toEqual(phases)
  }), { seed: 20260702, numRuns: 300 }))
  it('never grants one rail block to two pods across arbitrary release attempts', () => fc.assert(fc.property(fc.array(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 100 }), (podIds) => {
    const rails = new RailNetwork(); rails.addNode({ id: 'from', position: { x: 0, y: 0 } }); rails.addNode({ id: 'to', position: { x: 1, y: 0 } }); rails.addEdge({ id: 'edge', from: 'from', to: 'to', bidirectional: false })
    let owner: string | undefined; for (const podId of podIds) { const granted = rails.reserve('edge', podId); if (granted) { expect(owner === undefined || owner === podId).toBe(true); owner = podId } expect([...rails.blocks.values()].filter((block) => block.reservedById !== undefined)).toHaveLength(owner === undefined ? 0 : 1); if (owner === podId) { rails.releaseReservation('edge', podId); owner = undefined } }
  }), { seed: 20260706, numRuns: 300 }))
})
