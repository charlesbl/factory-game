import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_WINDOW_MS, worldProfiler } from './worldProfiler';

const frame = (intervalMs: number) => ({
  intervalMs,
  updateMs: 0.2,
  webglSubmitMs: 0.5,
  mainCalls: 10,
  calls: 12,
  mainTriangles: 100,
  triangles: 120,
  entities: 2,
  rails: 10,
  pods: 1,
  missions: 3,
  geometries: 4,
  textures: 1,
  sceneObjects: 20,
  estimatedGpuBufferBytes: 1024,
  quality: 'standard',
});

describe('world profiler', () => {
  let now: number;
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    worldProfiler.setEnabled(false);
    worldProfiler.setEnabled(true);
  });
  afterEach(() => {
    worldProfiler.setEnabled(false);
    vi.restoreAllMocks();
  });

  it('expires old stalls while retaining session long-task count', () => {
    worldProfiler.recordFrame(frame(400));
    worldProfiler.recordLongTask(350);
    now = PROFILE_WINDOW_MS + 1;
    worldProfiler.recordFrame(frame(4));
    const snapshot = worldProfiler.snapshot();
    expect(snapshot.fps).toBe(250);
    expect(snapshot.frameP95Ms).toBe(4);
    expect(snapshot.frameSamples).toBe(1);
    expect(snapshot.framesOver240BudgetPercent).toBe(0);
    expect(snapshot.recentLongTasks).toBe(0);
    expect(snapshot.longTasks).toBe(1);
    expect(snapshot.maxLongTaskMs).toBeNull();
  });

  it('computes residual wait per request before taking the percentile', () => {
    worldProfiler.recordWorker({
      rpcMs: 100,
      processingMs: 95,
      postMessageMs: 1,
    });
    worldProfiler.recordWorker({
      rpcMs: 90,
      processingMs: 1,
      postMessageMs: 2,
    });
    const snapshot = worldProfiler.snapshot();
    expect(snapshot.workerRpcP95Ms).toBe(100);
    expect(snapshot.workerProcessingP95Ms).toBe(95);
    expect(snapshot.workerWaitP95Ms).toBe(89);
  });

  it('clears a measurement after a profiler session is reopened', () => {
    worldProfiler.recordFrame(frame(10));
    worldProfiler.recordLongTask(80);
    worldProfiler.setEnabled(false);
    worldProfiler.setEnabled(true);
    expect(worldProfiler.snapshot().frameSamples).toBe(0);
    expect(worldProfiler.snapshot().longTasks).toBe(0);
  });
});
