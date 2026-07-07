import { describe, expect, it } from 'vitest'
import { asId, gridPoint } from '../domain'
import type { ResourceId } from '../domain'
import { WorldBuffer } from '../simulation'
import { LogisticsDispatcher } from './dispatcher'
import { RailNetwork } from './rail'

const setup = () => {
  const rails = new RailNetwork(); rails.addNode({ id: 'a', position: gridPoint(0, 0) }); rails.addNode({ id: 'b', position: gridPoint(10, 0) }); rails.addEdge({ id: 'rail', from: 'a', to: 'b', bidirectional: true })
  const dispatcher = new LogisticsDispatcher(rails); const resource = asId<ResourceId>('ironOre'); const provider = new WorldBuffer(resource, 100, 30); const requester = new WorldBuffer(resource, 20)
  dispatcher.addStation({ id: 'provider', railNodeId: 'a', role: 'provider', buffer: provider, priority: 0, target: 0, minBatch: 1, maxBatch: 20 })
  dispatcher.addStation({ id: 'requester', railNodeId: 'b', role: 'requester', buffer: requester, priority: 1, target: 20, minBatch: 5, maxBatch: 10 })
  dispatcher.addVehicle({ id: 'train', capacity: 10, speed: 10n, state: 'IDLE', cargo: 0, stationId: 'provider' })
  return { dispatcher, provider, requester }
}
describe('external logistics', () => {
  it('reserves an integer batch and completes deterministic travel', () => { const { dispatcher, provider, requester } = setup(); const jobs = dispatcher.dispatch(0n); expect(jobs[0]?.quantity).toBe(10); expect(provider.quantity).toBe(20); dispatcher.advanceTo(1_000_000n); expect(requester.quantity).toBe(10); expect(jobs[0]?.status).toBe('DELIVERED') })
  it('keeps cargo when the destination becomes full', () => { const { dispatcher, requester } = setup(); const jobs = dispatcher.dispatch(0n); requester.add(20); dispatcher.advanceTo(1_000_000n); expect(jobs[0]?.status).toBe('BLOCKED'); expect(dispatcher.vehicles.get('train')?.cargo).toBe(10) })
  it('chooses stable equal-cost routes', () => { const { dispatcher } = setup(); expect(dispatcher.rails.route('a', 'b')?.edgeIds).toEqual(['rail']) })
  it('removes unused rails and invalidates cached routes', () => { const { dispatcher } = setup(); expect(dispatcher.rails.route('a', 'b')).toBeDefined(); dispatcher.rails.removeEdge('rail'); expect(dispatcher.rails.route('a', 'b')).toBeUndefined(); expect(dispatcher.rails.blocks.has('block:rail')).toBe(false) })
  it('does not remove an occupied rail', () => { const { dispatcher } = setup(); dispatcher.rails.reserve('rail', 'train'); expect(() => dispatcher.rails.removeEdge('rail')).toThrow(/in use/); expect(dispatcher.rails.edges.has('rail')).toBe(true) })
})
