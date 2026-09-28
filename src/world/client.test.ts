import { describe, expect, it } from 'vitest';
import { WorldClient, applyWorldDelta } from './client';
import { buildWorldDelta } from './delta';
import {
  WORLD_PROTOCOL_VERSION,
  type WorldCommand,
  type WorldWorkerResponse,
} from './protocol';
import { WorldRuntime } from './runtime';
import { defaultWorldGenerationConfig } from './model';
import { serializeWorldRuntime } from './serialization';
import { createReviewFixture } from './review-fixture';
import type { WorldDelta, WorldSnapshot } from './protocol';

function transport(
  reply: (command: WorldCommand) => WorldWorkerResponse | undefined,
) {
  const commands: WorldCommand[] = [];
  const worker = {
    onmessage: undefined as
      ((event: MessageEvent<WorldWorkerResponse>) => void) | undefined,
    onerror: undefined,
    postMessage(command: WorldCommand) {
      commands.push(command);
      const response = reply(command);
      if (response)
        queueMicrotask(() =>
          worker.onmessage?.({
            data: response,
          } as MessageEvent<WorldWorkerResponse>),
        );
    },
    terminate() {},
  };
  return { worker: worker as unknown as Worker, commands };
}

describe('world client continuity and failure settlement', () => {
  const config = {
    ...defaultWorldGenerationConfig('client-continuity'),
    width: 64,
    height: 64,
    spawnClearingSize: 24,
  };
  it('accepts multi-revision jumps and resynchronises gaps before the queued edit', async () => {
    const initial = WorldRuntime.generate(config).snapshot();
    let revision = 0;
    const fake = transport((command) => {
      const base = {
        protocolVersion: WORLD_PROTOCOL_VERSION,
        requestId: command.requestId,
      };
      if (command.type === 'GENERATE')
        return { ...base, type: 'READY', snapshot: initial };
      if (command.type === 'SNAPSHOT')
        return {
          ...base,
          type: 'READY',
          snapshot: { ...initial, revision: 12 },
        };
      revision++;
      const delta = buildWorldDelta(
        revision === 1 ? 0 : 7,
        new Set(),
        { ...initial, revision: revision === 1 ? 5 : 12 },
        [],
        { oreChanges: [], occupancyChanges: [] },
      );
      return { ...base, type: 'DELTA', delta };
    });
    const client = new WorldClient(fake.worker);
    await client.generate(config);
    expect(
      (
        await client.command({
          type: 'SET_TIME_CONTROL',
          paused: true,
          timeScale: 5,
        })
      ).snapshot.revision,
    ).toBe(5);
    expect(
      (
        await client.command({
          type: 'SET_TIME_CONTROL',
          paused: true,
          timeScale: 20,
        })
      ).snapshot.revision,
    ).toBe(12);
    expect(fake.commands.map((command) => command.type)).toEqual([
      'GENERATE',
      'SET_TIME_CONTROL',
      'SET_TIME_CONTROL',
      'SNAPSHOT',
    ]);
    client.dispose();
  });
  it('settles active and queued requests on protocol mismatch and disposal', async () => {
    const fake = transport(
      (command) =>
        ({
          protocolVersion: 2,
          requestId: command.requestId,
          type: 'ERROR',
          error: 'old worker',
        }) as unknown as WorldWorkerResponse,
    );
    const client = new WorldClient(fake.worker);
    await expect(client.generate(config)).rejects.toThrow('protocol mismatch');
    await expect(client.snapshot()).rejects.toThrow('protocol mismatch');
    client.dispose();
    const silent = new WorldClient(transport(() => undefined).worker);
    const pending = silent.generate(config);
    await Promise.resolve();
    silent.dispose();
    await expect(pending).rejects.toThrow('disposed');
  });
});

describe('presentation isolation', () => {
  it('does not change serialized state or event ordering when recording is enabled', () => {
    const one = createReviewFixture().runtime;
    const two = createReviewFixture().runtime;
    one.beginPresentation(true);
    two.beginPresentation(false);
    one.advanceTo(4_000_000n, 1);
    two.advanceTo(4_000_000n, 1);
    while (one.eventQueue.pendingAdvanceTarget !== undefined)
      one.continueAdvance(1);
    while (two.eventQueue.pendingAdvanceTarget !== undefined)
      two.continueAdvance(1);
    one.capturePresentation();
    two.capturePresentation();
    one.presentation.finish(one.logicalTime);
    two.presentation.finish(two.logicalTime);
    expect(serializeWorldRuntime(one)).toEqual(serializeWorldRuntime(two));
  });
});

describe('stale session deltas and bounded catch-up', () => {
  const config = {
    ...defaultWorldGenerationConfig('stale-deltas'),
    width: 64,
    height: 64,
    spawnClearingSize: 24,
  };
  it('discards stale deltas from a replaced session that kept the world ID', async () => {
    const initial = WorldRuntime.generate(config).snapshot();
    let loads = 0;
    let snapshots = 0;
    let advances = 0;
    const replaced = {
      ...initial,
      revision: 3,
      logicalTime: 400_000n,
      paused: true,
      timeScale: 5 as const,
    };
    const fake = transport((command) => {
      const base = {
        protocolVersion: WORLD_PROTOCOL_VERSION,
        requestId: command.requestId,
      };
      if (command.type === 'LOAD')
        return {
          ...base,
          type: 'READY',
          snapshot:
            loads++ === 0
              ? { ...initial, revision: 10, logicalTime: 1_000_000n }
              : replaced,
        };
      if (command.type === 'SNAPSHOT') {
        snapshots += 1;
        return { ...base, type: 'READY', snapshot: replaced };
      }
      // Stale same-ID deltas: one on the replaced session's old revision line,
      // one past the current revision but with a mismatched base revision.
      const staleLow = advances++ === 0;
      const stale = {
        ...initial,
        revision: staleLow ? 2 : 11,
        logicalTime: 99_000_000n,
        paused: false,
        timeScale: 20 as const,
      };
      return {
        ...base,
        type: 'DELTA',
        delta: buildWorldDelta(staleLow ? 1 : 10, new Set(), stale, [], {
          oreChanges: [],
          occupancyChanges: [],
        }),
      };
    });
    const client = new WorldClient(fake.worker);
    try {
      await client.load(serializeWorldRuntime(createReviewFixture().runtime));
      await client.load(serializeWorldRuntime(createReviewFixture().runtime));
      const staleLow = await client.advance(5_000_000n);
      // A delta on an old revision line never becomes accepted state.
      expect(staleLow.snapshot.revision).toBe(3);
      expect(staleLow.snapshot.logicalTime).toBe(400_000n);
      expect(staleLow.snapshot.paused).toBe(true);
      expect(staleLow.snapshot.timeScale).toBe(5);
      expect(staleLow.snapshot.worldId).toBe(initial.worldId);
      expect(snapshots).toBe(0);
      const staleHigh = await client.advance(6_000_000n);
      // A future delta with a mismatched base triggers a resync instead of
      // being applied; the stale content never reaches accepted state.
      expect(snapshots).toBe(1);
      expect(staleHigh.snapshot.revision).toBe(3);
      expect(staleHigh.snapshot.logicalTime).toBe(400_000n);
      expect(staleHigh.snapshot.paused).toBe(true);
      expect(staleHigh.snapshot.timeScale).toBe(5);
      expect(staleHigh.snapshot.worldId).toBe(initial.worldId);
    } finally {
      client.dispose();
    }
  });
  it('catches up an exhausted advance budget in bounded continuation steps', async () => {
    const initial = WorldRuntime.generate(config).snapshot();
    const steps: (number | undefined)[] = [];
    let turns = 0;
    const fake = transport((command) => {
      const base = {
        protocolVersion: WORLD_PROTOCOL_VERSION,
        requestId: command.requestId,
      };
      if (command.type === 'GENERATE')
        return { ...base, type: 'READY', snapshot: initial };
      if (command.type === 'ADVANCE' || command.type === 'CONTINUE_ADVANCE') {
        steps.push(command.eventBudget);
        turns += 1;
        const done = turns === 3;
        const delta = buildWorldDelta(
          turns - 1,
          new Set(),
          {
            ...initial,
            revision: turns,
            logicalTime: done ? 20_000_000n : BigInt(turns) * 5_000_000n,
            ...(done ? {} : { pendingAdvanceTarget: 20_000_000n }),
          },
          [],
          { oreChanges: [], occupancyChanges: [] },
        );
        return done
          ? { ...base, type: 'DELTA', delta }
          : { ...base, type: 'ADVANCE_PAUSED', delta };
      }
      return undefined;
    });
    const client = new WorldClient(fake.worker);
    try {
      await client.generate(config);
      const first = await client.advance(20_000_000n, 10);
      // An exhausted budget keeps the target pending instead of dropping it.
      expect(first.exhaustedBudget).toBe(true);
      expect(first.snapshot.pendingAdvanceTarget).toBe(20_000_000n);
      const second = await client.continueAdvance(10);
      expect(second.exhaustedBudget).toBe(true);
      expect(second.snapshot.pendingAdvanceTarget).toBe(20_000_000n);
      const third = await client.continueAdvance(10);
      // The settled continuation clears the pending target and reports done.
      expect(third.exhaustedBudget).toBe(false);
      expect(third.snapshot.logicalTime).toBe(20_000_000n);
      expect(third.snapshot.pendingAdvanceTarget).toBeUndefined();
      expect(steps).toEqual([10, 10, 10]);
    } finally {
      client.dispose();
    }
  });
});

const unchangedDelta = (snapshot: WorldSnapshot): WorldDelta =>
  buildWorldDelta(
    snapshot.revision,
    new Set(snapshot.entities.map((entity) => entity.id)),
    {
      ...snapshot,
      revision: snapshot.revision + 1,
      logicalTime: snapshot.logicalTime + 50_000n,
    },
    [],
    { oreChanges: [], occupancyChanges: [] },
  );

describe('world client grid delta sharing', () => {
  it('preserves the grid when a clock delta changes no cells', () => {
    const snapshot = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('client-grid-sharing'),
      width: 64,
      height: 64,
    }).snapshot();
    expect(applyWorldDelta(snapshot, unchangedDelta(snapshot)).grid).toBe(
      snapshot.grid,
    );
  });
  it('copies ore storage only when an ore cell changes', () => {
    const snapshot = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('client-ore-copy'),
      width: 64,
      height: 64,
    }).snapshot();
    const index = snapshot.grid.oreRemaining.findIndex((amount) => amount > 0);
    const amount = snapshot.grid.oreRemaining[index]!;
    const delta = {
      ...unchangedDelta(snapshot),
      oreChanges: [{ index, remaining: amount - 1 }],
    };
    const changed = applyWorldDelta(snapshot, delta);
    expect(changed.grid.oreRemaining[index]).toBe(amount - 1);
    expect(snapshot.grid.oreRemaining[index]).toBe(amount);
  });
});
