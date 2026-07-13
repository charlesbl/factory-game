import type { GridPoint, RailNodeId } from '../domain';
import type { WorldPod, WorldSnapshot } from '../world';

export const WORLD_SYNC_HZ = 20;
export const WORLD_SYNC_INTERVAL_MS = 1000 / WORLD_SYNC_HZ;
export const WORLD_RENDER_MAX_FPS = 60;

export interface VisualPoint {
  readonly x: number;
  readonly y: number;
}

export const visualLogicalTime = (
  snapshot: Pick<WorldSnapshot, 'logicalTime' | 'paused' | 'timeScale'>,
  receivedAt: number,
  now: number,
): bigint => {
  if (snapshot.paused) return snapshot.logicalTime;
  const elapsedMicroseconds = Math.max(
    0,
    Math.floor((now - receivedAt) * 1000 * snapshot.timeScale),
  );
  return snapshot.logicalTime + BigInt(elapsedMicroseconds);
};

export const podPositionAt = (
  pod: WorldPod,
  nodes: ReadonlyMap<RailNodeId, GridPoint>,
  logicalTime: bigint,
): VisualPoint | undefined => {
  if (pod.motion === undefined) return nodes.get(pod.nodeId);
  const duration = pod.motion.endsAt - pod.motion.startsAt;
  const elapsed =
    logicalTime <= pod.motion.startsAt
      ? 0
      : logicalTime >= pod.motion.endsAt
        ? Number(duration)
        : Number(logicalTime - pod.motion.startsAt);
  const ratio = duration === 0n ? 1 : elapsed / Number(duration);
  return {
    x: pod.motion.from.x + (pod.motion.to.x - pod.motion.from.x) * ratio,
    y: pod.motion.from.y + (pod.motion.to.y - pod.motion.from.y) * ratio,
  };
};

export const smoothVisualPoint = (
  current: VisualPoint | undefined,
  target: VisualPoint,
  elapsedMs: number,
): VisualPoint => {
  if (current === undefined || elapsedMs <= 0) return target;
  const alpha = 1 - Math.exp(-elapsedMs / 35);
  return {
    x: current.x + (target.x - current.x) * alpha,
    y: current.y + (target.y - current.y) * alpha,
  };
};
