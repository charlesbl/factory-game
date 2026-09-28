import { parseExact, stringifyExact } from '../../domain';
import { database } from '../../persistence';
import type { WorldRecord } from '../../persistence';
import { WorldClient, WorldCommandError } from '../../world/client';
import { defaultWorldGenerationConfig } from '../../world/model';
import type { SerializedWorldState } from '../../world/serialization';
import type { WorldClientResult } from '../../world/client';
import type { WorldGenerationConfig, WorldSnapshot } from '../../world/model';
import { WorldClock } from './WorldClock';
import { WorldStore } from './WorldStore';
import type { WorldCommandInput } from '../../world/protocol';

type Operation = (client: WorldClient) => Promise<WorldClientResult>;

/** Persistence seam for the single `main` world slot. */
export interface WorldSlotStore {
  get(id: 'main'): Promise<WorldRecord | undefined>;
  put(record: WorldRecord): Promise<unknown>;
}

export interface WorldSessionOptions {
  readonly createClient?: () => WorldClient;
  readonly now?: () => number;
  readonly worlds?: WorldSlotStore;
}

/** Owns one worker and one clock independently of the mounted graphics viewport. */
export class WorldSession {
  readonly store = new WorldStore();
  private client: WorldClient | undefined;
  private readonly clock: WorldClock;
  private readonly createClient: () => WorldClient;
  private readonly worlds: WorldSlotStore;
  private queue: Promise<unknown> = Promise.resolve();
  private writeQueue: Promise<unknown> = Promise.resolve();
  private pendingActions = 0;
  private advancing = false;
  private dirty = false;
  private pauseRequested = false;
  private references = 0;
  private lifetime = 0;
  private started = false;
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private saveTimer: ReturnType<typeof setInterval> | undefined;
  private validationTimer: ReturnType<typeof setTimeout> | undefined;
  private validationInFlight = false;
  private latestValidation:
    | {
        command: Extract<WorldCommandInput, { type: 'VALIDATE_GHOST' }>;
        receive: (result: WorldClientResult) => void;
      }
    | undefined;

  constructor(options: WorldSessionOptions = {}) {
    this.clock = new WorldClock(options.now);
    this.createClient = options.createClient ?? (() => new WorldClient());
    this.worlds = options.worlds ?? database.worlds;
  }

  validateLatest(
    command: Extract<WorldCommandInput, { type: 'VALIDATE_GHOST' }>,
    receive: (result: WorldClientResult) => void,
  ) {
    const intent = { command, receive };
    this.latestValidation = intent;
    this.scheduleValidation();
    return () => {
      if (this.latestValidation === intent) this.latestValidation = undefined;
    };
  }
  private scheduleValidation() {
    if (
      this.validationTimer ||
      this.validationInFlight ||
      !this.latestValidation
    )
      return;
    this.validationTimer = setTimeout(() => {
      this.validationTimer = undefined;
      if (this.pendingActions || this.advancing) {
        this.scheduleValidation();
        return;
      }
      const intent = this.latestValidation,
        client = this.client;
      if (!intent || !client) return;
      this.validationInFlight = true;
      const generation = this.store.getSnapshot().generation;
      const task = this.queue.then(async () => {
        try {
          const result = await client.command(intent.command);
          if (
            this.latestValidation === intent &&
            client === this.client &&
            generation === this.store.getSnapshot().generation
          ) {
            intent.receive(result);
            this.latestValidation = undefined;
          }
        } catch {
          if (this.latestValidation === intent)
            this.latestValidation = undefined;
          /* Commit and worker errors are handled through the command path. */
        } finally {
          this.validationInFlight = false;
          this.scheduleValidation();
        }
      });
      this.queue = task;
    }, 100);
  }

  retain() {
    this.references += 1;
    this.lifetime += 1;
    if (!this.started) {
      this.started = true;
      void this.start();
    }
    return () => {
      this.references -= 1;
      const lifetime = ++this.lifetime;
      // StrictMode's cleanup/setup pair keeps the same session alive.
      queueMicrotask(() => {
        if (this.references === 0 && this.lifetime === lifetime) this.dispose();
      });
    };
  }

  private patch(patch: Partial<ReturnType<WorldStore['getSnapshot']>>) {
    this.store.publish({ ...this.store.getSnapshot(), ...patch });
  }
  private accept(snapshot: WorldSnapshot, reset = false) {
    const previous = this.store.getSnapshot().snapshot;
    if (reset || !previous) this.clock.reset(snapshot);
    else if (
      previous.paused !== snapshot.paused ||
      previous.timeScale !== snapshot.timeScale
    ) {
      // A pause freezes the ledger at the accepted checkpoint; a speed change
      // or resume keeps elapsed running time due across the rebase.
      if (snapshot.paused) this.clock.reset(snapshot);
      else this.clock.rebase(snapshot);
    }
    if (!previous || previous.revision !== snapshot.revision || reset)
      this.dirty = true;
    this.patch({
      snapshot,
      saveState:
        this.dirty && this.store.getSnapshot().saveState !== 'error'
          ? 'dirty'
          : this.store.getSnapshot().saveState,
    });
  }

  private async loadSaved(client: WorldClient): Promise<WorldClientResult> {
    const stored = await this.worlds.get('main');
    if (!stored)
      return client.generate(defaultWorldGenerationConfig('starter-world'));
    if (stored.schemaVersion !== 2)
      throw new Error(
        'Unsupported saved world. The existing save has been preserved.',
      );
    let result = await client.load(
      parseExact<SerializedWorldState>(stored.payload),
    );
    if (!Number.isFinite(Date.parse(stored.savedAt)))
      throw new Error(
        'Invalid saved world timestamp. The existing save has been preserved.',
      );
    if (!result.snapshot.paused) {
      const checkpoint =
        result.snapshot.pendingAdvanceTarget ?? result.snapshot.logicalTime;
      const elapsed = BigInt(
        Math.floor(Math.max(0, Date.now() - Date.parse(stored.savedAt)) * 1000),
      );
      const target = checkpoint + elapsed * BigInt(result.snapshot.timeScale);
      while (result.snapshot.pendingAdvanceTarget !== undefined)
        result = await client.continueAdvance(100_000, false);
      result = await client.advance(target, 100_000, false);
      while (result.snapshot.pendingAdvanceTarget !== undefined)
        result = await client.continueAdvance(100_000, false);
    }
    return result;
  }

  private async start() {
    const client = this.createClient();
    this.client = client;
    try {
      const result = await this.loadSaved(client);
      if (this.client !== client) return;
      this.accept(result.snapshot, true);
      await this.saveCheckpoint(client);
    } catch (reason) {
      if (this.client === client) this.fail(reason, client);
    } finally {
      if (this.client === client) this.patch({ busy: false });
    }
    if (this.client !== client) return;
    this.tickTimer = setInterval(() => this.tick(), 100);
    this.saveTimer = setInterval(() => {
      if (this.dirty && this.pendingActions === 0)
        void this.run((current) => current.save(true));
    }, 10_000);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', this.onVisibility);
  }
  private readonly onVisibility = () => {
    if (typeof document !== 'undefined' && document.hidden && this.dirty)
      void this.run((client) => client.save(true));
  };

  readonly run = (
    operation: Operation,
    save = true,
  ): Promise<WorldClientResult | undefined> => {
    this.pendingActions += 1;
    this.patch({ busy: true });
    const execute = async () => {
      const client = this.client;
      try {
        if (!client) return undefined;
        const result = await operation(client);
        if (client !== this.client) return result;
        this.accept(result.snapshot);
        this.patch({ error: undefined, workerFailed: false });
        if (save)
          await this.saveCheckpoint(
            client,
            result.state === undefined && result.payload === undefined
              ? undefined
              : result,
          );
        return result;
      } catch (reason) {
        if (client && client === this.client) this.fail(reason, client);
        return undefined;
      } finally {
        this.pendingActions -= 1;
        this.patch({ busy: this.pendingActions > 0 });
      }
    };
    const task = this.queue.then(execute, execute);
    this.queue = task.catch(() => undefined);
    return task;
  };

  private tick() {
    if (this.client?.workerError && !this.store.getSnapshot().workerFailed)
      this.fail(this.client.workerError, this.client);
    const state = this.store.getSnapshot();
    if (
      !this.client ||
      state.workerFailed ||
      !state.snapshot ||
      state.snapshot.paused ||
      this.pauseRequested ||
      this.advancing ||
      this.validationInFlight ||
      this.latestValidation !== undefined ||
      this.pendingActions > 0
    )
      return;
    this.advancing = true;
    const client = this.client;
    const task = this.queue.then(async () => {
      const current = this.store.getSnapshot().snapshot;
      if (
        !current ||
        current.paused ||
        this.pauseRequested ||
        client !== this.client
      )
        return;
      try {
        const result =
          current.pendingAdvanceTarget === undefined
            ? await client.advance(this.clock.target())
            : await client.continueAdvance(100_000);
        if (client === this.client) this.accept(result.snapshot);
      } catch (reason) {
        if (client === this.client) this.fail(reason, client);
      }
    });
    this.queue = task.finally(() => {
      this.advancing = false;
    });
  }

  private fail(reason: unknown, client: WorldClient) {
    if (reason instanceof WorldCommandError && reason.snapshot)
      this.accept(reason.snapshot);
    this.patch({
      error: reason instanceof Error ? reason.message : 'World command failed',
      workerFailed: client.workerError !== undefined,
    });
  }

  private async saveCheckpoint(client: WorldClient, saved?: WorldClientResult) {
    this.patch({ saveState: 'saving' });
    const result = saved ?? (await client.save(true));
    if ((!result.state && !result.payload) || this.client !== client) return;
    const generation = this.store.getSnapshot().generation;
    const savedAt = new Date(
      this.clock.checkpointWallTime(result.snapshot, Date.now()),
    ).toISOString();
    const serializeStarted = performance.now();
    const payload = result.payload ?? stringifyExact(result.state);
    if (
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).has('world-metrics')
    )
      performance.measure('world:save-serialize', { start: serializeStarted });
    const write = this.writeQueue.then(async () => {
      if (
        this.client !== client ||
        generation !== this.store.getSnapshot().generation
      )
        return;
      await this.worlds.put({
        id: 'main',
        schemaVersion: 2,
        revision: result.snapshot.revision,
        savedAt,
        payload,
      });
    });
    this.writeQueue = write.catch(() => undefined);
    try {
      await write;
      if (
        client !== this.client ||
        generation !== this.store.getSnapshot().generation
      )
        return;
      this.dirty =
        this.store.getSnapshot().snapshot?.revision !==
        result.snapshot.revision;
      this.patch({ saveState: this.dirty ? 'dirty' : 'saved' });
    } catch (reason) {
      this.dirty = true;
      this.patch({ saveState: 'error' });
      throw reason;
    }
  }

  async setTime(paused: boolean, timeScale: 1 | 5 | 20) {
    this.pauseRequested = paused;
    try {
      return await this.run(async (client) => {
        const current = this.store.getSnapshot().snapshot;
        if (current === undefined)
          return client.command({
            type: 'SET_TIME_CONTROL',
            paused,
            timeScale,
          });
        if (paused)
          // A pause must never schedule advancement; the retained target
          // stays due until resume.
          return client.command({
            type: 'SET_TIME_CONTROL',
            paused,
            timeScale,
          });
        if (current.paused) {
          // No advancement may be sent before the resume is accepted; then the
          // retained target is settled exactly once.
          const resumed = await client.command({
            type: 'SET_TIME_CONTROL',
            paused,
            timeScale,
          });
          this.accept(resumed.snapshot);
          return await this.settleTarget(client, resumed);
        }
        // Settle the retained target at the old speed first; the clock rebase
        // then carries the processing time as advancement still due.
        await this.settleTarget(client, { snapshot: current });
        return client.command({ type: 'SET_TIME_CONTROL', paused, timeScale });
      });
    } finally {
      this.pauseRequested = false;
    }
  }

  private async settleTarget(
    client: WorldClient,
    result: WorldClientResult,
  ): Promise<WorldClientResult> {
    let settled = result;
    while (settled.snapshot.pendingAdvanceTarget !== undefined)
      settled = await client.continueAdvance(100_000);
    return settled;
  }

  async replace(config?: WorldGenerationConfig) {
    this.latestValidation = undefined;
    // Prepare on a separate worker; failure leaves the current world alive.
    return this.run(async () => {
      const replacement = this.createClient();
      try {
        const result = config
          ? await replacement.generate(config)
          : await this.loadSaved(replacement);
        await this.writeQueue;
        this.client?.dispose();
        this.client = replacement;
        this.patch({
          generation: this.store.getSnapshot().generation + 1,
          workerFailed: false,
          error: undefined,
        });
        this.accept(result.snapshot, true);
        await this.saveCheckpoint(replacement);
        return result;
      } catch (reason) {
        if (this.client !== replacement) replacement.dispose();
        throw reason;
      }
    }, false).then((result) => result?.snapshot);
  }

  private dispose() {
    clearInterval(this.tickTimer);
    clearInterval(this.saveTimer);
    clearTimeout(this.validationTimer);
    this.latestValidation = undefined;
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.onVisibility);
    this.client?.dispose();
    this.client = undefined;
  }
}
