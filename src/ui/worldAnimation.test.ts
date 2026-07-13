import { describe, expect, it } from 'vitest';
import { asId, gridPoint } from '../domain';
import type { PodId, RailNodeId } from '../domain';
import type { WorldPod } from '../world';
import {
  podPositionAt,
  smoothVisualPoint,
  visualLogicalTime,
} from './worldAnimation';

describe('world animation clock', () => {
  it('advances from wall time at the selected scale and freezes when paused', () => {
    expect(
      visualLogicalTime(
        { logicalTime: 2_000_000n, paused: false, timeScale: 5 },
        100,
        150,
      ),
    ).toBe(2_250_000n);
    expect(
      visualLogicalTime(
        { logicalTime: 2_000_000n, paused: true, timeScale: 20 },
        100,
        150,
      ),
    ).toBe(2_000_000n);
  });

  it('interpolates and clamps timestamped pod motion', () => {
    const pod: WorldPod = {
      id: asId<PodId>('pod'),
      capacity: 10,
      state: 'TO_PROVIDER',
      nodeId: asId<RailNodeId>('from'),
      motion: {
        from: gridPoint(0, 0),
        to: gridPoint(10, 0),
        startsAt: 1_000_000n,
        endsAt: 2_000_000n,
      },
    };
    const nodes = new Map([[pod.nodeId, gridPoint(0, 0)]]);
    expect(podPositionAt(pod, nodes, 500_000n)).toEqual({ x: 0, y: 0 });
    expect(podPositionAt(pod, nodes, 1_500_000n)).toEqual({ x: 5, y: 0 });
    expect(podPositionAt(pod, nodes, 3_000_000n)).toEqual({ x: 10, y: 0 });
  });

  it('smooths authoritative corrections without overshooting', () => {
    const next = smoothVisualPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, 16);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(10);
    expect(next.y).toBe(0);
  });
});
