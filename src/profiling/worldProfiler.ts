export interface WorldProfilerSnapshot {
  readonly enabled: boolean;
  readonly fps: number | null;
  readonly frameP95Ms: number | null;
  readonly frameP99Ms: number | null;
  readonly frameMaxMs: number | null;
  readonly framesOver240BudgetPercent: number | null;
  readonly frameSamples: number;
  readonly sampleWindowMs: number;
  readonly eventLoopDelayP95Ms: number | null;
  readonly uiRenderP95Ms: number | null;
  readonly updateP95Ms: number | null;
  /** Main-thread time spent submitting the Three.js render to WebGL, not GPU time. */
  readonly webglSubmitP95Ms: number | null;
  readonly gpuP95Ms: number | null;
  readonly snapshotSyncP95Ms: number | null;
  readonly dismantleSelectionP95Ms: number | null;
  readonly workerRpcP95Ms: number | null;
  readonly workerProcessingP95Ms: number | null;
  /** Per-request RPC minus worker processing; includes transport and thread scheduling. */
  readonly workerWaitP95Ms: number | null;
  readonly workerQueueP95Ms: number | null;
  readonly previousWorkerPostMessageP95Ms: number | null;
  readonly workerDeltaP95Ms: number | null;
  readonly deltaApplyP95Ms: number | null;
  readonly postMessageP95Ms: number | null;
  readonly mainCalls: number;
  readonly calls: number;
  readonly mainTriangles: number;
  readonly triangles: number;
  readonly entities: number;
  readonly rails: number;
  readonly pods: number;
  readonly missions: number;
  readonly geometries: number;
  readonly textures: number;
  readonly sceneObjects: number;
  /** Estimated geometry/instance buffers and render targets; not driver VRAM. */
  readonly estimatedGpuBufferBytes: number | null;
  readonly jsHeapUsedBytes: number | null;
  readonly jsHeapLimitBytes: number | null;
  readonly jsHeapChangePerMinuteBytes: number | null;
  readonly missionChangePerMinute: number | null;
  readonly longTasks: number;
  readonly recentLongTasks: number;
  readonly maxLongTaskMs: number | null;
  readonly quality: string;
}

interface FrameSample {
  readonly intervalMs: number;
  readonly updateMs: number;
  readonly webglSubmitMs: number;
  readonly mainCalls: number;
  readonly calls: number;
  readonly mainTriangles: number;
  readonly triangles: number;
  readonly entities: number;
  readonly rails: number;
  readonly pods: number;
  readonly missions: number;
  readonly geometries: number;
  readonly textures: number;
  readonly sceneObjects: number;
  readonly estimatedGpuBufferBytes: number | null;
  readonly quality: string;
}

interface WorkerSample {
  readonly rpcMs: number;
  readonly processingMs?: number;
  readonly deltaMs?: number;
  readonly postMessageMs: number;
  readonly previousWorkerPostMessageMs?: number;
}

export const PROFILE_WINDOW_MS = 5_000;
const FRAME_BUDGET_240_MS = 1000 / 240;

/** Time-based window with a fixed cap, including at very high refresh rates. */
class RollingSamples {
  private readonly values = new Float64Array(4096);
  private readonly times = new Float64Array(4096);
  private count = 0;
  private next = 0;

  add(value: number, at = performance.now()) {
    if (!Number.isFinite(value) || value < 0) return;
    this.values[this.next] = value;
    this.times[this.next] = at;
    this.next = (this.next + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }

  clear() {
    this.count = 0;
    this.next = 0;
  }

  private recentValues() {
    const cutoff = performance.now() - PROFILE_WINDOW_MS;
    const recent: number[] = [];
    for (let i = 0; i < this.count; i++)
      if (this.times[i]! >= cutoff) recent.push(this.values[i]!);
    return recent;
  }

  get length() {
    return this.recentValues().length;
  }

  mean() {
    const values = this.recentValues();
    return values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  percentile(fraction: number) {
    const sorted = this.recentValues().sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  }

  p95() {
    return this.percentile(0.95);
  }

  abovePercent(budget: number) {
    const values = this.recentValues();
    return values.length === 0
      ? null
      : (100 * values.filter((value) => value > budget).length) / values.length;
  }

  max() {
    const values = this.recentValues();
    return values.length === 0 ? null : Math.max(...values);
  }
}

class TrendSamples {
  private readonly times = new Float64Array(120);
  private readonly values = new Float64Array(120);
  private count = 0;
  private next = 0;

  add(at: number, value: number) {
    if (!Number.isFinite(at) || !Number.isFinite(value)) return;
    this.times[this.next] = at;
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }

  clear() {
    this.count = 0;
    this.next = 0;
  }

  changePerMinute() {
    if (this.count < 2) return null;
    const firstIndex = this.count < this.values.length ? 0 : this.next;
    const lastIndex = (this.next + this.values.length - 1) % this.values.length;
    const duration = this.times[lastIndex]! - this.times[firstIndex]!;
    if (duration < 10_000) return null;
    return (
      ((this.values[lastIndex]! - this.values[firstIndex]!) * 60_000) / duration
    );
  }
}

/** Opt-in, bounded diagnostics shared by the renderer and world worker client. */
class WorldProfiler {
  enabled = false;
  private readonly frameIntervals = new RollingSamples();
  private readonly updates = new RollingSamples();
  private readonly webglSubmissions = new RollingSamples();
  private readonly gpuFrames = new RollingSamples();
  private readonly snapshotSyncs = new RollingSamples();
  private readonly dismantleSelections = new RollingSamples();
  private readonly workerRpcs = new RollingSamples();
  private readonly workerProcessing = new RollingSamples();
  private readonly workerWaits = new RollingSamples();
  private readonly workerQueues = new RollingSamples();
  private readonly previousWorkerPosts = new RollingSamples();
  private readonly eventLoopDelays = new RollingSamples();
  private readonly uiRenders = new RollingSamples();
  private readonly workerDeltas = new RollingSamples();
  private readonly deltaApplies = new RollingSamples();
  private readonly postMessages = new RollingSamples();
  private readonly longTaskSamples = new RollingSamples();
  private readonly heapTrend = new TrendSamples();
  private readonly missionTrend = new TrendSamples();
  private latestFrame: FrameSample | undefined;
  private longTaskCount = 0;

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.clear();
  }

  recordFrame(sample: FrameSample) {
    if (!this.enabled) return;
    this.frameIntervals.add(sample.intervalMs);
    this.updates.add(sample.updateMs);
    this.webglSubmissions.add(sample.webglSubmitMs);
    this.latestFrame = sample;
  }

  recordSnapshotSync(durationMs: number) {
    if (this.enabled) this.snapshotSyncs.add(durationMs);
  }

  recordGpuFrame(durationMs: number) {
    if (this.enabled) this.gpuFrames.add(durationMs);
  }

  recordDismantleSelection(durationMs: number) {
    if (this.enabled) this.dismantleSelections.add(durationMs);
  }

  recordWorker(sample: WorkerSample) {
    if (!this.enabled) return;
    this.workerRpcs.add(sample.rpcMs);
    if (sample.processingMs !== undefined) {
      this.workerProcessing.add(sample.processingMs);
      this.workerWaits.add(Math.max(0, sample.rpcMs - sample.processingMs));
    }
    if (sample.previousWorkerPostMessageMs !== undefined)
      this.previousWorkerPosts.add(sample.previousWorkerPostMessageMs);
    if (sample.deltaMs !== undefined) this.workerDeltas.add(sample.deltaMs);
    this.postMessages.add(sample.postMessageMs);
  }

  recordWorkerQueue(durationMs: number) {
    if (this.enabled) this.workerQueues.add(durationMs);
  }

  recordEventLoopDelay(durationMs: number) {
    if (this.enabled) this.eventLoopDelays.add(durationMs);
  }

  recordUiRender(durationMs: number) {
    if (this.enabled) this.uiRenders.add(durationMs);
  }

  recordDeltaApply(durationMs: number) {
    if (this.enabled) this.deltaApplies.add(durationMs);
  }

  recordLongTask(durationMs: number) {
    if (!this.enabled) return;
    this.longTaskCount += 1;
    this.longTaskSamples.add(durationMs);
  }

  snapshot(): WorldProfilerSnapshot {
    const frameMean = this.frameIntervals.mean();
    const memory = (
      performance as Performance & {
        memory?: {
          readonly usedJSHeapSize?: number;
          readonly jsHeapSizeLimit?: number;
        };
      }
    ).memory;
    const frame = this.latestFrame;
    if (this.enabled) {
      const now = performance.now();
      if (memory?.usedJSHeapSize !== undefined)
        this.heapTrend.add(now, memory.usedJSHeapSize);
      if (frame !== undefined) this.missionTrend.add(now, frame.missions);
    }
    return {
      enabled: this.enabled,
      fps: frameMean !== null && frameMean > 0 ? 1000 / frameMean : null,
      frameP95Ms: this.frameIntervals.p95(),
      frameP99Ms: this.frameIntervals.percentile(0.99),
      frameMaxMs: this.frameIntervals.max(),
      framesOver240BudgetPercent:
        this.frameIntervals.abovePercent(FRAME_BUDGET_240_MS),
      frameSamples: this.frameIntervals.length,
      sampleWindowMs: PROFILE_WINDOW_MS,
      eventLoopDelayP95Ms: this.eventLoopDelays.p95(),
      uiRenderP95Ms: this.uiRenders.p95(),
      updateP95Ms: this.updates.p95(),
      webglSubmitP95Ms: this.webglSubmissions.p95(),
      gpuP95Ms: this.gpuFrames.p95(),
      snapshotSyncP95Ms: this.snapshotSyncs.p95(),
      dismantleSelectionP95Ms: this.dismantleSelections.p95(),
      workerRpcP95Ms: this.workerRpcs.p95(),
      workerProcessingP95Ms: this.workerProcessing.p95(),
      workerWaitP95Ms: this.workerWaits.p95(),
      workerQueueP95Ms: this.workerQueues.p95(),
      previousWorkerPostMessageP95Ms: this.previousWorkerPosts.p95(),
      workerDeltaP95Ms: this.workerDeltas.p95(),
      deltaApplyP95Ms: this.deltaApplies.p95(),
      postMessageP95Ms: this.postMessages.p95(),
      mainCalls: frame?.mainCalls ?? 0,
      calls: frame?.calls ?? 0,
      mainTriangles: frame?.mainTriangles ?? 0,
      triangles: frame?.triangles ?? 0,
      entities: frame?.entities ?? 0,
      rails: frame?.rails ?? 0,
      pods: frame?.pods ?? 0,
      missions: frame?.missions ?? 0,
      geometries: frame?.geometries ?? 0,
      textures: frame?.textures ?? 0,
      sceneObjects: frame?.sceneObjects ?? 0,
      estimatedGpuBufferBytes: frame?.estimatedGpuBufferBytes ?? null,
      jsHeapUsedBytes: memory?.usedJSHeapSize ?? null,
      jsHeapLimitBytes: memory?.jsHeapSizeLimit ?? null,
      jsHeapChangePerMinuteBytes: this.heapTrend.changePerMinute(),
      missionChangePerMinute: this.missionTrend.changePerMinute(),
      longTasks: this.longTaskCount,
      recentLongTasks: this.longTaskSamples.length,
      maxLongTaskMs: this.longTaskSamples.max(),
      quality: frame?.quality ?? '—',
    };
  }

  private clear() {
    for (const samples of [
      this.frameIntervals,
      this.updates,
      this.webglSubmissions,
      this.gpuFrames,
      this.snapshotSyncs,
      this.dismantleSelections,
      this.workerRpcs,
      this.workerProcessing,
      this.workerWaits,
      this.workerQueues,
      this.previousWorkerPosts,
      this.eventLoopDelays,
      this.uiRenders,
      this.workerDeltas,
      this.deltaApplies,
      this.postMessages,
      this.longTaskSamples,
    ])
      samples.clear();
    this.heapTrend.clear();
    this.missionTrend.clear();
    this.latestFrame = undefined;
    this.longTaskCount = 0;
  }
}

export const worldProfiler = new WorldProfiler();
