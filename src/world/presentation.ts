import type { GridPoint, SimTime } from '../domain';
import type { WorldPod } from './model';

export interface PodPresentationRecord {
  readonly order: number;
  readonly at: SimTime;
  readonly pod: WorldPod;
  readonly position: GridPoint;
  readonly path?: readonly GridPoint[];
}
export interface PodPresentationInterval {
  readonly sequence: number;
  readonly from: SimTime;
  readonly to: SimTime;
  readonly reset: boolean;
  readonly records: readonly PodPresentationRecord[];
}

/** Read-only side channel: no randomness, simulation events or persisted fields. */
export class PresentationRecorder {
  get recording() {
    return this.enabled;
  }
  private sequence = 0;
  private from = 0n;
  private reset = false;
  private enabled = false;
  private order = 0;
  private records: PodPresentationRecord[] = [];
  private signatures = new Map<string, string>();
  begin(time: SimTime, enabled: boolean) {
    this.from = time;
    this.enabled = enabled;
    this.reset = !enabled;
    this.records = [];
    this.signatures.clear();
    this.order = 0;
  }
  capture(
    time: SimTime,
    pods: readonly WorldPod[],
    position: (pod: WorldPod) => GridPoint | undefined,
    path: (pod: WorldPod) => readonly GridPoint[] | undefined,
    scale: number,
  ) {
    if (!this.enabled) return;
    if (time - this.from > BigInt(scale * 2_000_000)) {
      this.records = [];
      this.reset = true;
      this.enabled = false;
      return;
    }
    for (const pod of pods) {
      const key = `${pod.state}:${pod.nodeId}:${pod.cargo?.resourceId}:${pod.cargo?.quantity}:${pod.motion?.edgeId}:${pod.motion?.startsAt}:${pod.motion?.endsAt}`;
      if (this.signatures.get(pod.id) === key) continue;
      const point = position(pod);
      if (!point) continue;
      this.signatures.set(pod.id, key);
      const points = path(pod);
      this.records.push({
        order: ++this.order,
        at: time,
        pod,
        position: point,
        ...(points ? { path: points.map((point) => ({ ...point })) } : {}),
      });
      if (this.records.length > 20_000) {
        this.records = [];
        this.reset = true;
        this.enabled = false;
        return;
      }
    }
  }
  finish(time: SimTime): PodPresentationInterval {
    const interval = {
      sequence: ++this.sequence,
      from: this.from,
      to: time,
      reset: this.reset,
      records: this.records,
    };
    this.records = [];
    this.enabled = false;
    return interval;
  }
  snapshot(time: SimTime): PodPresentationInterval {
    return {
      sequence: this.sequence,
      from: time,
      to: time,
      reset: true,
      records: [],
    };
  }
}
