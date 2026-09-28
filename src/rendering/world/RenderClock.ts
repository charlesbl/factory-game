import type { WorldPod, WorldSnapshot } from '../../world/model';
import type { PodPresentationRecord } from '../../world/presentation';
import type { GridPoint } from '../../domain';

export function samplePath(
  points: readonly GridPoint[],
  progress: number,
): { x: number; y: number; angle: number } | undefined {
  if (points.length < 2) return undefined;
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total +=
      Math.abs(points[i]!.x - points[i - 1]!.x) +
      Math.abs(points[i]!.y - points[i - 1]!.y);
  let distance = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (length === 0) continue;
    if (distance <= length || i === points.length - 1) {
      const ratio = Math.min(1, distance / length);
      return {
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio,
        angle: Math.atan2(b.x - a.x, b.y - a.y),
      };
    }
    distance -= length;
  }
  return undefined;
}

/** Samples position, cargo and warning state at one bounded accepted timestamp. */
export class RenderClock {
  private receivedAt = 0;
  private sequence = -1;
  private accepted: WorldSnapshot | undefined;
  private readonly history = new Map<string, PodPresentationRecord[]>();
  catchingUp = false;
  accept(snapshot: WorldSnapshot, now: number) {
    const interval = snapshot.presentation;
    const reset =
      !this.accepted ||
      snapshot.worldId !== this.accepted.worldId ||
      snapshot.logicalTime < this.accepted.logicalTime ||
      interval.reset ||
      interval.sequence < this.sequence ||
      (interval.sequence > this.sequence + 1 && this.sequence >= 0);
    if (reset || snapshot.paused) this.history.clear();
    this.catchingUp = reset && this.accepted !== undefined && !snapshot.paused;
    if (interval.sequence > this.sequence || reset) {
      for (const record of interval.records) {
        const records = this.history.get(record.pod.id) ?? [];
        records.push(record);
        this.history.set(record.pod.id, records);
      }
      this.sequence = interval.sequence;
    }
    const cutoff =
      snapshot.logicalTime - BigInt(snapshot.timeScale * 2_000_000);
    let count = 0;
    for (const [id, records] of this.history) {
      let first = records.findIndex((record) => record.at >= cutoff);
      if (first < 0) first = records.length;
      const retained = records.slice(Math.max(0, first - 1));
      this.history.set(id, retained);
      count += retained.length;
      if (!snapshot.pods.some((pod) => pod.id === id)) this.history.delete(id);
    }
    if (count > 20_000) {
      this.history.clear();
      this.catchingUp = true;
    }
    this.accepted = snapshot;
    this.receivedAt = now;
  }
  time(now: number): bigint {
    const state = this.accepted;
    if (!state) return 0n;
    if (state.paused || this.catchingUp) return state.logicalTime;
    const offset =
      BigInt(Math.floor((Math.max(0, now - this.receivedAt) - 100) * 1000)) *
      BigInt(state.timeScale);
    return state.logicalTime + (offset > 0n ? 0n : offset);
  }
  sample(pod: WorldPod, now: number) {
    const state = this.accepted;
    if (!state) return undefined;
    const time = this.time(now);
    const records = this.history.get(pod.id) ?? [];
    let record: PodPresentationRecord | undefined;
    if (!state.paused)
      for (const candidate of records) {
        if (candidate.at > time) break;
        record = candidate;
      }
    const sampled = record?.pod ?? pod;
    const motion = sampled.motion;
    if (motion) {
      const path =
        record?.path ??
        state.railEdges.find((edge) => edge.id === motion.edgeId)?.points;
      const duration = motion.endsAt - motion.startsAt;
      const position = path
        ? samplePath(
            path,
            duration > 0n
              ? Number(time - motion.startsAt) / Number(duration)
              : 1,
          )
        : undefined;
      if (position) return { pod: sampled, ...position };
    }
    const position =
      record?.position ??
      state.railNodes.find((node) => node.id === sampled.nodeId)?.position;
    return position ? { pod: sampled, ...position, angle: 0 } : undefined;
  }
}
