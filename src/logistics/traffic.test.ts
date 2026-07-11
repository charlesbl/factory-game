import { describe, expect, it } from 'vitest';
import { asId, gridPoint } from '../domain';
import type { ResourceId } from '../domain';
import { WorldBuffer } from '../simulation';
import { RailNetwork } from './rail';
import { PodTrafficSystem } from './traffic';

const iron = asId<ResourceId>('ironOre');
const setup = () => {
  const rails = new RailNetwork();
  rails.addNode({ id: 'provider-node', position: gridPoint(0, 0) });
  rails.addNode({ id: 'requester-node', position: gridPoint(10, 0) });
  rails.addNode({ id: 'depot-node', position: gridPoint(10, 10) });
  rails.addEdge({
    id: 'delivery',
    from: 'provider-node',
    to: 'requester-node',
    bidirectional: false,
  });
  rails.addEdge({
    id: 'return',
    from: 'requester-node',
    to: 'depot-node',
    bidirectional: false,
    length: 10,
  });
  const traffic = new PodTrafficSystem(rails);
  const provider = new WorldBuffer(iron, 100, 30);
  const requester = new WorldBuffer(iron, 20);
  traffic.addStation({
    id: 'provider',
    railNodeId: 'provider-node',
    role: 'provider',
    buffer: provider,
    priority: 0,
    target: 0,
    minBatch: 1,
    maxBatch: 10,
  });
  traffic.addStation({
    id: 'requester',
    railNodeId: 'requester-node',
    role: 'requester',
    buffer: requester,
    priority: 1,
    target: 20,
    minBatch: 5,
    maxBatch: 10,
    requestCreatedAt: 0n,
  });
  traffic.addStation({
    id: 'depot',
    railNodeId: 'depot-node',
    role: 'depot',
    priority: 0,
    target: 0,
    minBatch: 0,
    maxBatch: 0,
  });
  traffic.addPod({
    id: 'pod-1',
    nodeId: 'provider-node',
    stationId: 'provider',
  });
  return { rails, traffic, provider, requester };
};

describe('pod traffic', () => {
  it('loads, reserves directional blocks, unloads, and returns to a depot', () => {
    const { traffic, provider, requester } = setup();
    expect(traffic.dispatch(0n)[0]?.quantity).toBe(10);
    expect(provider.quantity).toBe(20);
    traffic.advanceTo(2_999_999n);
    expect(requester.quantity).toBe(0);
    traffic.advanceTo(3_000_000n);
    expect(requester.quantity).toBe(10);
    expect(traffic.pods.get('pod-1')?.state).toBe('TO_DEPOT');
  });
  it('never gives the same block to two pods', () => {
    const { rails } = setup();
    expect(rails.reserve('delivery', 'a')).toBe(true);
    expect(rails.reserve('delivery', 'b')).toBe(false);
    rails.enter('delivery', 'a');
    expect(rails.reserve('delivery', 'b')).toBe(false);
    rails.leave('delivery', 'a');
    expect(rails.reserve('delivery', 'b')).toBe(true);
  });
  it('keeps cargo and sleeps when the destination fills during transit', () => {
    const { traffic, requester } = setup();
    traffic.dispatch(0n);
    requester.add(20);
    traffic.advanceTo(3_000_000n);
    expect(traffic.pods.get('pod-1')?.state).toBe('DESTINATION_BLOCKED');
    requester.remove(10);
    traffic.wakeDestination('requester', 3_000_000n);
    expect(requester.quantity).toBe(20);
  });
});
