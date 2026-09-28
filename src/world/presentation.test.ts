import { describe, expect, it } from 'vitest';
import { asId, gridPoint } from '../domain';
import type { PodId, RailNodeId } from '../domain';
import type { WorldPod } from './model';
import { PresentationRecorder } from './presentation';

const pod = (id: string, patch: Partial<WorldPod> = {}): WorldPod => ({
  id: asId<PodId>(`pod-${id}`),
  capacity: 10,
  state: 'IDLE',
  nodeId: asId<RailNodeId>(`node-${id}`),
  ...patch,
});
const here = () => gridPoint(1, 1);
const noPath = () => undefined;

describe('presentation movement stream', () => {
  it('records each pod transition once and preserves stationary pods per interval', () => {
    const recorder = new PresentationRecorder();
    recorder.begin(0n, true);
    const idle = [pod('a'), pod('b')];
    recorder.capture(0n, idle, here, noPath, 1);
    // Unchanged signatures are ignored: stationary periods add no duplicates.
    recorder.capture(100_000n, idle, here, noPath, 1);
    const moving = [pod('a', { state: 'TO_PROVIDER' }), pod('b')] as const;
    recorder.capture(
      200_000n,
      moving,
      () => gridPoint(2, 1),
      () => [gridPoint(1, 1), gridPoint(2, 1)],
      1,
    );
    const interval = recorder.finish(300_000n);
    expect(interval.sequence).toBe(1);
    expect(interval.from).toBe(0n);
    expect(interval.to).toBe(300_000n);
    expect(interval.reset).toBe(false);
    expect(interval.records.map((record) => record.pod.id)).toEqual([
      'pod-a',
      'pod-b',
      'pod-a',
    ]);
    expect(interval.records[2]?.path).toEqual([
      gridPoint(1, 1),
      gridPoint(2, 1),
    ]);
    // Every new interval starts from the full accepted pod state again.
    recorder.begin(300_000n, true);
    recorder.capture(300_000n, moving, here, noPath, 1);
    const next = recorder.finish(400_000n);
    expect(next.sequence).toBe(2);
    expect(next.reset).toBe(false);
    expect(next.records.map((record) => record.pod.id)).toEqual([
      'pod-a',
      'pod-b',
    ]);
  });

  it('explicitly resets when the retained history exceeds the two-second window', () => {
    const recorder = new PresentationRecorder();
    recorder.begin(0n, true);
    recorder.capture(0n, [pod('a')], here, noPath, 1);
    recorder.capture(
      1_900_000n,
      [pod('a', { state: 'TO_PROVIDER' })],
      here,
      noPath,
      1,
    );
    const within = recorder.finish(1_950_000n);
    expect(within.reset).toBe(false);
    expect(within.records).toHaveLength(2);
    // Retention converts wall time through the accepted speed: 2 s at 5x is
    // 10_000_000n ticks, so 9_000_000n ticks are still inside the window.
    recorder.begin(0n, true);
    recorder.capture(0n, [pod('a')], here, noPath, 5);
    recorder.capture(
      9_000_000n,
      [pod('a', { state: 'TO_PROVIDER' })],
      here,
      noPath,
      5,
    );
    const scaled = recorder.finish(9_500_000n);
    expect(scaled.reset).toBe(false);
    // Beyond the window the interval resets explicitly instead of silently
    // retaining an unbounded backlog.
    recorder.begin(0n, true);
    recorder.capture(0n, [pod('a')], here, noPath, 1);
    recorder.capture(
      2_100_000n,
      [pod('a', { state: 'TO_PROVIDER' })],
      here,
      noPath,
      1,
    );
    const overflowed = recorder.finish(2_200_000n);
    expect(overflowed.reset).toBe(true);
    expect(overflowed.records).toEqual([]);
    expect(recorder.recording).toBe(false);
  });

  it('explicitly resets at the 20 000-record cap', () => {
    const recorder = new PresentationRecorder();
    recorder.begin(0n, true);
    const pods = Array.from({ length: 20_001 }, (_, index) => pod(`${index}`));
    recorder.capture(0n, pods, here, noPath, 1);
    const interval = recorder.finish(100_000n);
    expect(interval.reset).toBe(true);
    expect(interval.records).toEqual([]);
    expect(recorder.recording).toBe(false);
  });

  it('marks suppressed catch-up intervals as explicit resets', () => {
    const recorder = new PresentationRecorder();
    recorder.begin(1_000_000n, false);
    expect(recorder.recording).toBe(false);
    recorder.capture(5_000_000n, [pod('a')], here, noPath, 1);
    expect(recorder.finish(5_000_000n)).toEqual({
      sequence: 1,
      from: 1_000_000n,
      to: 5_000_000n,
      reset: true,
      records: [],
    });
    // Snapshots for cache rebuilds always announce the discontinuity.
    expect(recorder.snapshot(5_000_000n)).toEqual({
      sequence: 1,
      from: 5_000_000n,
      to: 5_000_000n,
      reset: true,
      records: [],
    });
  });
});
