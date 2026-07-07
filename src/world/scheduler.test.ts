import { describe, expect, it } from 'vitest'
import { WorldEventQueue } from './scheduler'

describe('world event queue', () => {
  it('processes equal-time events by type, entity id, and stable sequence', () => {
    const queue = new WorldEventQueue(); queue.schedule(10n, 'FACTORY', 'z'); queue.schedule(10n, 'MINE_EXTRACT', 'a'); queue.schedule(10n, 'TRAFFIC', 'b'); queue.schedule(10n, 'TRAFFIC', 'a')
    expect(queue.popBatch(10n).map((event) => `${event.kind}:${event.entityId}`)).toEqual(['TRAFFIC:a', 'TRAFFIC:b', 'MINE_EXTRACT:a', 'FACTORY:z'])
  })
  it('round-trips its pending target and exact heap order', () => {
    const queue = new WorldEventQueue(); queue.schedule(4n, 'MINE_EXTRACT', 'mine-2'); queue.schedule(2n, 'FACTORY', 'factory-1'); queue.pendingAdvanceTarget = 100n
    const restored = WorldEventQueue.restore(queue.serialize()); expect(restored.pendingAdvanceTarget).toBe(100n); expect(restored.popBatch(100n)[0]?.entityId).toBe('factory-1'); expect(restored.popBatch(100n)[0]?.entityId).toBe('mine-2')
  })
})
