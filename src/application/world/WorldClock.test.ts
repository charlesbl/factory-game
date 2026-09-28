import { describe, expect, it } from 'vitest';
import { WorldClock } from './WorldClock';

describe('world session clock', () => {
  it('keeps elapsed time independent of publication frequency and late worker responses', () => {
    let now = 500;
    const clock = new WorldClock(() => now);
    clock.reset({ logicalTime: 1_000_000n, paused: false, timeScale: 5 });
    now = 620;
    expect(clock.target()).toBe(1_600_000n);
    now = 1800;
    expect(clock.target()).toBe(7_500_000n);
    // SAVE completion time cannot be used as the checkpoint timestamp.
    expect(
      clock.checkpointWallTime(
        { logicalTime: 2_500_000n, paused: false, timeScale: 5 },
        100_000,
      ),
    ).toBe(99_000);
  });
  it('preserves a pending target across pause and adds time spent settling it after resume', () => {
    let now = 0;
    const clock = new WorldClock(() => now);
    clock.reset({
      logicalTime: 10n,
      pendingAdvanceTarget: 2_000_000n,
      paused: true,
      timeScale: 20,
    });
    now = 60_000;
    expect(clock.target()).toBe(2_000_000n);
    clock.reset({
      logicalTime: 10n,
      pendingAdvanceTarget: 2_000_000n,
      paused: false,
      timeScale: 5,
    });
    now += 200;
    expect(clock.target()).toBe(3_000_000n);
    now += 100;
    expect(clock.target()).toBe(3_500_000n);
  });
  it('carries backlog processing time across a speed change without losing or doubling it', () => {
    let now = 0;
    const clock = new WorldClock(() => now);
    clock.reset({ logicalTime: 0n, paused: false, timeScale: 5 });
    // A retained target of 1_000_000n settles after 300 ms of elapsed running
    // time: 300 ms at 5x is 1_500_000n due, of which only 1_000_000n settled.
    now = 300;
    clock.rebase({
      logicalTime: 1_000_000n,
      paused: false,
      timeScale: 20,
    });
    // The 500_000n of backlog processing time stays due at the old speed...
    expect(clock.target()).toBe(1_500_000n);
    now = 350;
    // ...and the new speed applies only afterwards: 300 ms at 5x plus 50 ms at
    // 20x. Losing the debt would give 2_000_000n; charging it twice 8_500_000n.
    expect(clock.target()).toBe(2_500_000n);
  });
});
