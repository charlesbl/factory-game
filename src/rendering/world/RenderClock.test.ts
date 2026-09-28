import { describe, expect, it } from 'vitest';
import { asId } from '../../domain';
import {
  WorldRuntime,
  defaultWorldGenerationConfig,
  type WorldPod,
} from '../../world';
import { RenderClock, samplePath } from './RenderClock';

describe('accepted traffic presentation', () => {
  it('follows two turns by distance instead of cutting diagonally', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 8, y: 3 },
    ];
    expect(samplePath(path, 5.5 / 11)).toEqual({ x: 4, y: 1.5, angle: 0 });
    expect(samplePath(path, 1)).toEqual({ x: 8, y: 3, angle: Math.PI / 2 });
  });
  it('buffers cargo and position together, clamps a late worker, and snaps on pause', () => {
    const base = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('render-clock'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    }).snapshot();
    const id = asId<WorldPod['id']>('moving');
    const loaded: WorldPod = {
      id,
      capacity: 10,
      nodeId: asId('start'),
      state: 'TO_REQUESTER',
      cargo: { resourceId: asId('ironOre'), quantity: 10 },
      motion: {
        edgeId: asId('turn'),
        from: { x: 0, y: 0 },
        to: { x: 4, y: 3 },
        startsAt: 0n,
        endsAt: 2_000_000n,
      },
    };
    const unloaded: WorldPod = {
      id,
      capacity: 10,
      nodeId: asId('end'),
      state: 'IDLE',
    };
    const clock = new RenderClock();
    const snapshot = {
      ...base,
      paused: false,
      timeScale: 20 as const,
      logicalTime: 2_000_000n,
      pods: [unloaded],
      presentation: {
        sequence: 1,
        from: 0n,
        to: 2_000_000n,
        reset: false,
        records: [
          {
            order: 1,
            at: 0n,
            pod: loaded,
            position: { x: 0, y: 0 },
            path: [
              { x: 0, y: 0 },
              { x: 4, y: 0 },
              { x: 4, y: 3 },
            ],
          },
          { order: 2, at: 2_000_000n, pod: unloaded, position: { x: 4, y: 3 } },
        ],
      },
    };
    clock.accept(snapshot, 100);
    expect(clock.sample(unloaded, 150)?.pod.cargo?.quantity).toBe(10);
    expect(clock.time(9000)).toBe(2_000_000n);
    expect(clock.sample(unloaded, 9000)?.pod.cargo).toBeUndefined();
    clock.accept({ ...snapshot, paused: true }, 200);
    expect(clock.time(200)).toBe(snapshot.logicalTime);
    expect(clock.sample(unloaded, 200)?.pod.cargo).toBeUndefined();
  });
});

describe('bounded catch-up presentation', () => {
  const base = WorldRuntime.generate({
    ...defaultWorldGenerationConfig('render-catch-up'),
    width: 64,
    height: 64,
    spawnClearingSize: 24,
  }).snapshot();
  it('follows two turns crossed inside one 20× interval along the accepted path', () => {
    const clock = new RenderClock();
    const pod: WorldPod = {
      id: asId<WorldPod['id']>('two-turn'),
      capacity: 10,
      nodeId: asId('start'),
      state: 'TO_REQUESTER',
      motion: {
        edgeId: asId('two-turn'),
        from: { x: 0, y: 0 },
        to: { x: 8, y: 3 },
        startsAt: 0n,
        endsAt: 2_000_000n,
      },
    };
    const path = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 8, y: 3 },
    ];
    clock.accept(
      {
        ...base,
        paused: false,
        timeScale: 20,
        logicalTime: 2_000_000n,
        pods: [pod],
        presentation: {
          sequence: 1,
          from: 0n,
          to: 2_000_000n,
          reset: false,
          records: [{ order: 1, at: 0n, pod, position: { x: 0, y: 0 }, path }],
        },
      },
      100,
    );
    const onPath = ({ x, y }: { x: number; y: number }) =>
      (y === 0 && x >= 0 && x <= 4) ||
      (x === 4 && y >= 0 && y <= 3) ||
      (y === 3 && x >= 4 && x <= 8);
    // One 20× publication interval covers the whole two-turn run: every
    // sample stays on the accepted polyline and never cuts the diagonal chord.
    const samples = [0, 25, 50, 75, 99].map((elapsed) =>
      clock.sample(pod, 100 + elapsed)!,
    );
    for (const { x, y } of samples) expect(onPath({ x, y })).toBe(true);
    expect({ x: samples[0]!.x, y: samples[0]!.y }).toEqual({ x: 0, y: 0 });
    expect({ x: samples[2]!.x, y: samples[2]!.y }).toEqual({ x: 4, y: 1.5 });
    expect(samples[3]!.y).toBe(3);
    expect(samples[4]!.y).toBe(3);
  });
  it('snaps through a budget-exhausted catch-up instead of animating the gap', () => {
    const clock = new RenderClock();
    const id = asId<WorldPod['id']>('late-worker');
    const moving: WorldPod = {
      id,
      capacity: 10,
      nodeId: asId('start'),
      state: 'TO_REQUESTER',
      cargo: { resourceId: asId('ironOre'), quantity: 10 },
      motion: {
        edgeId: asId('run'),
        from: { x: 0, y: 0 },
        to: { x: 8, y: 0 },
        startsAt: 0n,
        endsAt: 2_000_000n,
      },
    };
    clock.accept(
      {
        ...base,
        paused: false,
        timeScale: 20,
        logicalTime: 2_000_000n,
        pods: [moving],
        presentation: {
          sequence: 1,
          from: 0n,
          to: 2_000_000n,
          reset: false,
          records: [
            {
              order: 1,
              at: 0n,
              pod: moving,
              position: { x: 0, y: 0 },
              path: [
                { x: 0, y: 0 },
                { x: 8, y: 0 },
              ],
            },
          ],
        },
      },
      100,
    );
    expect(clock.catchingUp).toBe(false);
    // The recorder exhausts its budget mid-motion: the interval resets and
    // the presentation must snap through the unrecorded gap.
    const settled: WorldPod = {
      id,
      capacity: 10,
      nodeId: asId('end'),
      state: 'TO_REQUESTER',
      cargo: { resourceId: asId('ironOre'), quantity: 7 },
    };
    clock.accept(
      {
        ...base,
        paused: false,
        timeScale: 20,
        logicalTime: 20_000_000n,
        pods: [settled],
        presentation: {
          sequence: 2,
          from: 2_000_000n,
          to: 20_000_000n,
          reset: true,
          records: [
            {
              order: 1,
              at: 2_000_000n,
              pod: settled,
              position: { x: 8, y: 0 },
            },
          ],
        },
      },
      150,
    );
    expect(clock.catchingUp).toBe(true);
    for (const now of [150, 60_150, 5_000_000]) {
      // Accepted state at every timestamp: no extrapolation, no invented cargo.
      expect(clock.time(now)).toBe(20_000_000n);
      const sample = clock.sample(settled, now)!;
      expect(sample).toBeDefined();
      expect({ x: sample.x, y: sample.y }).toEqual({ x: 8, y: 0 });
      expect(sample.pod.cargo).toEqual({
        resourceId: asId('ironOre'),
        quantity: 7,
      });
    }
    // The next contiguous publication resumes interpolation from the buffer.
    clock.accept(
      {
        ...base,
        paused: false,
        timeScale: 20,
        logicalTime: 22_000_000n,
        pods: [settled],
        presentation: {
          sequence: 3,
          from: 20_000_000n,
          to: 22_000_000n,
          reset: false,
          records: [],
        },
      },
      200,
    );
    expect(clock.catchingUp).toBe(false);
    expect(clock.time(200)).toBeLessThan(22_000_000n);
  });
  it('bounds presentation history and snaps when a single interval overflows', () => {
    const clock = new RenderClock();
    const pod: WorldPod = {
      id: asId<WorldPod['id']>('flood'),
      capacity: 10,
      nodeId: asId('start'),
      state: 'TO_REQUESTER',
    };
    clock.accept(
      {
        ...base,
        paused: false,
        timeScale: 1,
        logicalTime: 10_000_000n,
        pods: [pod],
        presentation: {
          sequence: 1,
          from: 0n,
          to: 10_000_000n,
          reset: false,
          records: [{ order: 1, at: 1n, pod, position: { x: 0, y: 0 } }],
        },
      },
      100,
    );
    expect(clock.catchingUp).toBe(false);
    const flood = Array.from({ length: 20_001 }, (_, index) => ({
      order: index + 1,
      at: 48_000_000n + BigInt(index),
      pod,
      position: { x: 0, y: 0 },
    }));
    clock.accept(
      {
        ...base,
        paused: false,
        timeScale: 1,
        logicalTime: 50_000_000n,
        pods: [pod],
        presentation: {
          sequence: 2,
          from: 10_000_000n,
          to: 50_000_000n,
          reset: false,
          records: flood,
        },
      },
      150,
    );
    // History overflow snaps to the accepted state instead of animating or
    // extrapolating through the unbounded backlog.
    expect(clock.catchingUp).toBe(true);
    expect(clock.time(30_150)).toBe(50_000_000n);
    expect(clock.time(5_000_000)).toBe(50_000_000n);
  });
  it('resumes from a hidden stretch without presentation overflow', () => {
    const clock = new RenderClock();
    const pod: WorldPod = {
      id: asId<WorldPod['id']>('hidden'),
      capacity: 10,
      nodeId: asId('start'),
      state: 'TO_REQUESTER',
    };
    // Snapshots keep arriving while the tab is hidden: contiguous publications
    // accumulate far past the pruning window.
    for (let i = 0; i < 240; i++) {
      const from = BigInt(i) * 200_000n;
      clock.accept(
        {
          ...base,
          paused: false,
          timeScale: 20,
          logicalTime: from + 200_000n,
          pods: [pod],
          presentation: {
            sequence: i + 1,
            from,
            to: from + 200_000n,
            reset: false,
            records: [
              { order: 1, at: from, pod, position: { x: 0, y: 0 } },
              { order: 2, at: from + 200_000n, pod, position: { x: 0, y: 0 } },
            ],
          },
        },
        1_000 + i * 50,
      );
      // Pruning keeps the backlog bounded: no overflow reset accumulates.
      expect(clock.catchingUp).toBe(false);
    }
    // Resuming after the hidden stretch never extrapolates past the accepted
    // state and never overflows the presentation.
    const resume = 73_000;
    expect(clock.time(resume)).toBe(48_000_000n);
    const sample = clock.sample(pod, resume)!;
    expect(sample).toBeDefined();
    expect({ x: sample.x, y: sample.y }).toEqual({ x: 0, y: 0 });
  });
});
