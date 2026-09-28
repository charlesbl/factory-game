import type { WorldSnapshot } from '../../world/model';

type ClockState = Pick<
  WorldSnapshot,
  'logicalTime' | 'pendingAdvanceTarget' | 'paused' | 'timeScale'
>;

/** Monotonic live time. A pending target was already charged before a checkpoint. */
export class WorldClock {
  private anchor = 0n;
  private startedAt = 0;
  private paused = true;
  private scale: 1 | 5 | 20 = 1;
  constructor(private readonly now: () => number = () => performance.now()) {}
  /** Load, replacement and pause: anchor exactly to the accepted checkpoint. */
  reset(snapshot: ClockState) {
    this.anchor = snapshot.pendingAdvanceTarget ?? snapshot.logicalTime;
    this.startedAt = this.now();
    this.paused = snapshot.paused;
    this.scale = snapshot.timeScale;
  }
  /** Speed change/resume: elapsed running time stays due across the rebase. */
  rebase(snapshot: ClockState) {
    const target = this.target();
    const accounted = snapshot.pendingAdvanceTarget ?? snapshot.logicalTime;
    this.anchor = target > accounted ? target : accounted;
    this.startedAt = this.now();
    this.paused = snapshot.paused;
    this.scale = snapshot.timeScale;
  }
  target(): bigint {
    return (
      this.anchor +
      (this.paused
        ? 0n
        : BigInt(Math.floor(Math.max(0, this.now() - this.startedAt) * 1000)) *
          BigInt(this.scale))
    );
  }
  checkpointWallTime(snapshot: ClockState, epochNow: number): number {
    if (snapshot.paused) return epochNow;
    const accounted = snapshot.pendingAdvanceTarget ?? snapshot.logicalTime;
    const debt = this.target() - accounted;
    return (
      epochNow -
      (debt > 0n ? Number(debt / BigInt(snapshot.timeScale)) / 1000 : 0)
    );
  }
}
