import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compileBlueprint,
  isContract,
  serializeContract,
} from '../../compiler';
import { asId, gridPoint, gridSize, stringifyExact } from '../../domain';
import type { FactoryId, InstanceId, StationId, WorldId } from '../../domain';
import type { WorldRecord } from '../../persistence/database';
import { createDemoBlueprint } from '../../ui/demo-blueprint';
import type { WorldClient, WorldClientResult } from '../../world/client';
import { generateWorld } from '../../world/generation';
import type { WorldBuildingSnapshot, WorldSnapshot } from '../../world/model';
import {
  defaultWorldGenerationConfig,
  OreKind,
  TerrainKind,
} from '../../world/model';
import type { WorldCommandInput } from '../../world/protocol';
import { WorldRuntime } from '../../world/runtime';
import type { SerializedWorldState } from '../../world/serialization';
import { serializeWorldRuntime } from '../../world/serialization';
import { WorldSession } from './WorldSession';

const flush = async () => {
  for (let hop = 0; hop < 60; hop += 1) await Promise.resolve();
};

interface FakeState {
  revision: number;
  logicalTime: bigint;
  pendingAdvanceTarget?: bigint | undefined;
  paused: boolean;
  timeScale: 1 | 5 | 20;
}

/** Scripted worker queue: logs commands and settles targets on demand. */
class FakeWorldClient {
  readonly log: string[] = [];
  workerError: Error | undefined;
  disposed = false;
  /** Remaining advance/continueAdvance calls that exhaust their event budget. */
  exhaustions = 0;
  /** Fake wall milliseconds consumed by each simulated worker call. */
  processingMs = 0;
  saveResult: { state?: SerializedWorldState; payload?: string } = {
    payload: '{"stub":true}',
  };
  /** When set, every result carries this snapshot (metadata fixtures). */
  fixed: WorldSnapshot | undefined;
  constructor(
    readonly state: FakeState,
    private readonly wall: { value: number },
  ) {}
  snapshot(): WorldSnapshot {
    if (this.fixed) return this.fixed;
    const snapshot = {
      presentation: {
        sequence: 0,
        from: this.state.logicalTime,
        to: this.state.logicalTime,
        reset: true,
        records: [],
      },
      schemaVersion: 1,
      worldId: asId<WorldId>('world-test'),
      generation: {
        config: defaultWorldGenerationConfig('test-seed'),
        spawn: gridPoint(32, 32),
      },
      revision: this.state.revision,
      logicalTime: this.state.logicalTime,
      grid: {
        width: 2,
        height: 2,
        terrain: new Uint8Array(4),
        oreKinds: new Uint8Array(4),
        oreRemaining: new Uint32Array(4),
        occupancy: new Int32Array(4),
      },
      presentationOreChanges: [],
      drillExtractionIds: [],
      entities: [],
      railNodes: [],
      railEdges: [],
      railBlocks: [],
      pods: [],
      missions: [],
      stations: [],
      buildings: [],
      diagnostics: [],
      paused: this.state.paused,
      timeScale: this.state.timeScale,
      scheduledEvents: 0,
    } as WorldSnapshot;
    if (this.state.pendingAdvanceTarget !== undefined)
      return {
        ...snapshot,
        pendingAdvanceTarget: this.state.pendingAdvanceTarget,
      };
    return snapshot;
  }
  private simulate(target: bigint): WorldClientResult {
    this.wall.value += this.processingMs;
    if (this.exhaustions > 0) {
      // ADVANCE_PAUSED exhaustion: partial progress with the target retained.
      this.exhaustions -= 1;
      if (target > this.state.logicalTime)
        this.state.logicalTime += (target - this.state.logicalTime) / 2n;
      this.state.pendingAdvanceTarget = target;
    } else {
      this.state.logicalTime = target;
      this.state.pendingAdvanceTarget = undefined;
    }
    this.state.revision += 1;
    return { snapshot: this.snapshot() };
  }
  async generate(config: unknown): Promise<WorldClientResult> {
    void config;
    this.log.push('GENERATE');
    this.state.revision += 1;
    return { snapshot: this.snapshot() };
  }
  async load(state: SerializedWorldState): Promise<WorldClientResult> {
    this.log.push('LOAD');
    // Mirror the worker's restore from the real serialized payload.
    this.state.logicalTime = BigInt(state.logicalTime);
    this.state.paused = state.paused;
    this.state.timeScale = state.timeScale;
    this.state.pendingAdvanceTarget =
      state.eventQueue.pendingAdvanceTarget === undefined
        ? undefined
        : BigInt(state.eventQueue.pendingAdvanceTarget);
    this.state.revision = state.revision;
    return { snapshot: this.snapshot() };
  }
  async advance(
    target: bigint,
    eventBudget = 100_000,
    recordPresentation = true,
  ): Promise<WorldClientResult> {
    void eventBudget;
    this.log.push(`ADVANCE:${target}${recordPresentation ? '' : ':quiet'}`);
    return this.simulate(target);
  }
  async continueAdvance(
    eventBudget = 100_000,
    recordPresentation = true,
  ): Promise<WorldClientResult> {
    void eventBudget;
    const target = this.state.pendingAdvanceTarget ?? this.state.logicalTime;
    this.log.push(`CONTINUE_ADVANCE${recordPresentation ? '' : ':quiet'}`);
    return this.simulate(target);
  }
  async command(input: WorldCommandInput): Promise<WorldClientResult> {
    this.log.push(
      input.type === 'SET_TIME_CONTROL'
        ? `SET_TIME_CONTROL:${input.paused}:${input.timeScale}`
        : input.type,
    );
    if (input.type === 'SET_TIME_CONTROL') {
      this.state.paused = input.paused;
      this.state.timeScale = input.timeScale;
    }
    this.state.revision += 1;
    return { snapshot: this.snapshot() };
  }
  async save(serialized = false): Promise<WorldClientResult> {
    this.log.push(`SAVE:${serialized}`);
    this.state.revision += 1;
    return {
      snapshot: this.snapshot(),
      ...(serialized ? this.saveResult : {}),
    };
  }
  dispose() {
    this.disposed = true;
  }
}

class FakeWorldSlot {
  readonly writes: WorldRecord[] = [];
  stored: WorldRecord | undefined;
  /** When set, the next put parks until releaseHeld (delayed writes). */
  hold = false;
  inFlight = 0;
  maxInFlight = 0;
  private held: (() => void) | undefined;
  constructor(stored?: WorldRecord) {
    this.stored = stored;
  }
  get(id: 'main') {
    void id;
    return Promise.resolve(this.stored);
  }
  put(record: WorldRecord) {
    this.writes.push({ ...record });
    this.stored = record;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    if (!this.hold) {
      this.inFlight -= 1;
      return Promise.resolve(undefined);
    }
    this.hold = false;
    return new Promise<unknown>((resolve) => {
      this.held = () => {
        this.inFlight -= 1;
        resolve(undefined);
      };
    });
  }
  releaseHeld() {
    this.held?.();
    this.held = undefined;
  }
}

class FakeDocument {
  hidden = false;
  private readonly listeners = new Set<() => void>();
  addEventListener(type: string, listener: () => void) {
    if (type === 'visibilitychange') this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    if (type === 'visibilitychange') this.listeners.delete(listener);
  }
  dispatch() {
    for (const listener of this.listeners) listener();
  }
}

const start = async (
  overrides: {
    state?: FakeState;
    worlds?: FakeWorldSlot;
  } = {},
) => {
  const wall = { value: 0 };
  const client = new FakeWorldClient(
    overrides.state ?? {
      revision: 0,
      logicalTime: 0n,
      paused: false,
      timeScale: 1,
    },
    wall,
  );
  const worlds = overrides.worlds ?? new FakeWorldSlot();
  const doc = new FakeDocument();
  (globalThis as Record<string, unknown>).document = doc;
  const session = new WorldSession({
    createClient: () => client as unknown as WorldClient,
    worlds,
    now: () => wall.value,
  });
  const release = session.retain();
  await flush();
  return { session, client, worlds, doc, release, wall };
};

describe('world session clock, queue, and persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).document;
  });

  it('a pause request sends no advancement and keeps the pending target', async () => {
    const { session, client, wall } = await start();
    client.exhaustions = 1;
    wall.value = 100;
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    // The tick's batch is retained by the exhausted event budget.
    expect(client.state.pendingAdvanceTarget).toBe(100_000n);
    await session.setTime(true, 1);
    // The pause request carries only SET_TIME_CONTROL: no ADVANCE settles the
    // retained target and no advancement is scheduled by the pause itself.
    expect(client.log.slice(2)).toEqual([
      'ADVANCE:100000',
      'SET_TIME_CONTROL:true:1',
      'SAVE:true',
    ]);
    const paused = session.store.getSnapshot().snapshot;
    expect(paused?.paused).toBe(true);
    // The pending target stays due for resume/save; the pause does not clear it.
    expect(paused?.pendingAdvanceTarget).toBe(100_000n);
    // After the accepted pause no advancement command runs until resume.
    wall.value = 300;
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(client.log).toHaveLength(5);
  });

  it('resume settles the retained pending target exactly once', async () => {
    const { session, client } = await start({
      state: {
        revision: 0,
        logicalTime: 50_000n,
        pendingAdvanceTarget: 100_000n,
        paused: true,
        timeScale: 1,
      },
    });
    await session.setTime(false, 5);
    expect(client.log.slice(2)).toEqual([
      'SET_TIME_CONTROL:false:5',
      'CONTINUE_ADVANCE',
      'SAVE:true',
    ]);
    // The retained target is settled by exactly one CONTINUE_ADVANCE chain and
    // is never re-issued as a fresh ADVANCE.
    expect(client.log.some((entry) => entry.startsWith('ADVANCE'))).toBe(false);
    expect(client.state.logicalTime).toBe(100_000n);
    expect(client.state.pendingAdvanceTarget).toBeUndefined();
  });

  it('keeps settling after event-budget exhaustion until the target completes', async () => {
    const { session, client } = await start({
      state: {
        revision: 0,
        logicalTime: 50_000n,
        pendingAdvanceTarget: 100_000n,
        paused: true,
        timeScale: 1,
      },
    });
    client.exhaustions = 2;
    await session.setTime(false, 5);
    // Two exhausted budgets retain the target; the settle keeps going until it
    // completes: exactly one logical settlement despite three commands.
    expect(
      client.log.filter((entry) => entry === 'CONTINUE_ADVANCE'),
    ).toHaveLength(3);
    expect(client.log.some((entry) => entry.startsWith('ADVANCE'))).toBe(false);
    expect(client.state.logicalTime).toBe(100_000n);
    expect(client.state.pendingAdvanceTarget).toBeUndefined();
    // ADVANCE_PAUSED exhaustion must never read as the player's paused flag.
    expect(session.store.getSnapshot().snapshot?.paused).toBe(false);
  });

  it('carries backlog processing time through a speed change without losing or doubling it', async () => {
    const { session, client, wall } = await start({
      state: { revision: 0, logicalTime: 0n, paused: false, timeScale: 5 },
    });
    client.exhaustions = 1;
    wall.value = 200;
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    // Backlog: the worker retains the tick's 1_000_000n target mid-batch.
    expect(client.state.pendingAdvanceTarget).toBe(1_000_000n);
    client.processingMs = 100;
    wall.value = 250;
    await session.setTime(false, 20);
    expect(client.log.slice(2, 5)).toEqual([
      'ADVANCE:1000000',
      'CONTINUE_ADVANCE',
      'SET_TIME_CONTROL:false:20',
    ]);
    // The retained target settles before the speed command. The next tick's
    // target is 350 ms at 5x plus 100 ms at 20x = 3_750_000n: the 100 ms the
    // worker spent processing the backlog stays due (lost would be 3_000_000n,
    // charged twice 8_750_000n).
    wall.value = 450;
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(client.log).toContain('ADVANCE:3750000');
  });

  it('autosaves a serialized write after the dirty interval without overlapping writes', async () => {
    const { session, worlds, wall } = await start();
    // Tick publications dirty the state without writing to the database.
    wall.value = 100;
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(worlds.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9_000);
    await flush();
    // Nothing is written before the 10 s autosave interval elapses.
    expect(worlds.writes).toHaveLength(1);
    worlds.hold = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    // The autosave triggers exactly one serialized write.
    expect(worlds.writes).toHaveLength(2);
    expect(worlds.writes[1]?.payload).toBe('{"stub":true}');
    // A second save queues behind the delayed write instead of overlapping it.
    const second = session.run((current) => current.save(true));
    await flush();
    expect(worlds.writes).toHaveLength(2);
    worlds.releaseHeld();
    await second;
    await flush();
    expect(worlds.writes).toHaveLength(3);
    expect(worlds.maxInFlight).toBe(1);
  });

  it('flushes a pending save when the document becomes hidden', async () => {
    const { client, worlds, doc, wall } = await start();
    wall.value = 100;
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(worlds.writes).toHaveLength(1);
    doc.hidden = true;
    doc.dispatch();
    await flush();
    // Hiding the document serializes a save of the dirty state immediately.
    expect(worlds.writes).toHaveLength(2);
    expect(client.log.filter((entry) => entry === 'SAVE:true')).toHaveLength(2);
    // A clean session flushes nothing on a repeated hide.
    doc.dispatch();
    await flush();
    expect(worlds.writes).toHaveLength(2);
  });

  it('settles an exhausted offline checkpoint without losing or doubling elapsed time', async () => {
    const runtime = new WorldRuntime(
      generateWorld({
        ...defaultWorldGenerationConfig('offline-test'),
        width: 64,
        height: 64,
      }),
    );
    runtime.logicalTime = 2_000_000n;
    runtime.eventQueue.pendingAdvanceTarget = 5_000_000n;
    runtime.paused = false;
    runtime.timeScale = 5;
    const payload = stringifyExact(serializeWorldRuntime(runtime));
    // A serialized save retains its pending target through the round trip.
    expect(JSON.parse(payload).eventQueue.pendingAdvanceTarget).toBe('5000000');
    const t0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    const worlds = new FakeWorldSlot({
      id: 'main',
      schemaVersion: 2,
      revision: runtime.revision,
      savedAt: new Date(t0).toISOString(),
      payload,
    });
    vi.setSystemTime(t0 + 5_000);
    const client = new FakeWorldClient(
      { revision: 0, logicalTime: 0n, paused: true, timeScale: 1 },
      { value: 0 },
    );
    client.exhaustions = 4;
    const session = new WorldSession({
      createClient: () => client as unknown as WorldClient,
      worlds,
      now: () => 0,
    });
    session.retain();
    await flush();
    const catchUp = client.log.filter(
      (entry) =>
        entry.startsWith('ADVANCE') || entry.startsWith('CONTINUE_ADVANCE'),
    );
    // The retained target settles first; offline elapsed time is then added to
    // the completed checkpoint exactly once: 5_000_000n + 5 s at 5x (the settle
    // commands ran first despite exhausted budgets) = 30_000_000n, not 25 M.
    expect(catchUp.at(-1)).toBe('ADVANCE:30000000:quiet');
    expect(
      catchUp.slice(0, -1).every((entry) => entry === 'CONTINUE_ADVANCE:quiet'),
    ).toBe(true);
    // Long offline catch-up suppresses history collection explicitly.
    expect(catchUp.every((entry) => entry.endsWith(':quiet'))).toBe(true);
    const settled = session.store.getSnapshot().snapshot;
    expect(settled?.logicalTime).toBe(30_000_000n);
    expect(settled?.pendingAdvanceTarget).toBeUndefined();
  });

  it('a delayed write from an old session never overwrites the active slot', async () => {
    // Park the startup checkpoint write so the queued save's write closure is
    // created delayed behind it.
    const worlds = new FakeWorldSlot();
    worlds.hold = true;
    const { session, client, release } = await start({ worlds });
    expect(worlds.writes).toHaveLength(1);
    client.saveResult = { payload: '{"stale":true}' };
    const queued = session.run((current) => current.save(true));
    await flush();
    // Unmount the session while the delayed write is still queued.
    release();
    await flush();
    worlds.releaseHeld();
    await queued;
    await flush();
    // The old session's delayed save must never write over the active slot.
    expect(worlds.writes).toHaveLength(1);
    expect(worlds.writes[0]?.payload).toBe('{"stub":true}');
    expect(worlds.stored?.payload).toBe('{"stub":true}');
  });

  it('carries generation and contract metadata on accepted and saved snapshots', async () => {
    const seed = 'metadata-seed';
    const compiled = compileBlueprint(createDemoBlueprint());
    if (!isContract(compiled)) throw new Error('Metadata factory must compile');
    const contract = serializeContract(compiled);
    const runtime = new WorldRuntime(
      generateWorld({
        ...defaultWorldGenerationConfig(seed),
        width: 64,
        height: 64,
        spawnClearingSize: 24,
      }),
    );
    for (let y = 18; y <= 30; y += 1)
      for (let x = 18; x <= 50; x += 1) {
        const index = y * runtime.world.grid.width + x;
        runtime.world.grid.terrain[index] = TerrainKind.BUILDABLE;
        runtime.world.grid.oreKinds[index] = OreKind.NONE;
        runtime.world.grid.oreRemaining[index] = 0;
      }
    const node = runtime.placeControlNode('station', gridPoint(19, 19));
    runtime.place({
      id: asId('metadata-station'),
      kind: 'station',
      stationId: asId<StationId>('metadata-station'),
      railNodeId: node.id,
      transform: {
        position: gridPoint(20, 20),
        size: gridSize(2, 2),
        rotation: 0,
      },
      createdAt: 0n,
    });
    runtime.createConstructionSite({
      targetKind: 'factory',
      transform: {
        position: gridPoint(22, 20),
        size: gridSize(contract.footprint.width, contract.footprint.height),
        rotation: 0,
      },
      stationId: asId<StationId>('metadata-station'),
      cost: [],
      factoryId: asId<FactoryId>('metadata-factory'),
      instanceId: asId<InstanceId>('metadata-instance'),
      contract,
    });
    runtime.advanceTo(runtime.logicalTime + 1n);
    runtime.takeGridChanges();
    const state = serializeWorldRuntime(runtime);
    const payload = stringifyExact(state);
    const client = new FakeWorldClient(
      { revision: 0, logicalTime: 0n, paused: true, timeScale: 1 },
      { value: 0 },
    );
    client.fixed = runtime.snapshot();
    client.saveResult = { state, payload };
    const worlds = new FakeWorldSlot();
    const session = new WorldSession({
      createClient: () => client as unknown as WorldClient,
      worlds,
      now: () => 0,
    });
    session.retain();
    await flush();
    const accepted = session.store.getSnapshot().snapshot;
    // The accepted snapshot carries the generation metadata (seed, generation
    // pack version, schema fields) and the placed factories' contract metadata.
    expect(accepted?.generation.config.seed).toBe(seed);
    expect(accepted?.generation.config.generatorVersion).toBeGreaterThanOrEqual(
      1,
    );
    expect(accepted?.generation.config.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(accepted?.schemaVersion).toBe(1);
    expect(accepted?.generation.spawn).toEqual(runtime.world.spawn);
    const factories = (accepted?.buildings ?? []).filter(
      (
        building,
      ): building is Extract<WorldBuildingSnapshot, { kind: 'factory' }> =>
        building.kind === 'factory',
    );
    expect(factories.length).toBeGreaterThan(0);
    expect(factories[0]?.contract.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(factories[0]?.contract.blueprintHash).not.toBe('');
    // The persisted record keeps the same metadata through the save pipeline.
    const record = worlds.writes.at(-1);
    expect(record?.schemaVersion).toBe(2);
    const saved = JSON.parse(record?.payload ?? '{}');
    expect(saved.schemaVersion).toBe(2);
    expect(saved.generated.config.seed).toBe(seed);
    expect(saved.generated.config.generatorVersion).toBeGreaterThanOrEqual(1);
    expect(saved.factories[0].contract.blueprintHash).not.toBe('');
    expect(saved.factories[0].contract.schemaVersion).toBeGreaterThanOrEqual(1);
  });
});
