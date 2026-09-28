import type {
  WorldCommand,
  WorldCommandInput,
  WorldDelta,
  WorldWorkerResponse,
} from './protocol';
import { WORLD_PROTOCOL_VERSION } from './protocol';
import type {
  WorldGenerationConfig,
  WorldSnapshot,
  WorldValidationResult,
} from './model';
import type { SerializedWorldState } from './serialization';

export interface WorldClientResult {
  readonly snapshot: WorldSnapshot;
  readonly state?: SerializedWorldState;
  readonly payload?: string;
  readonly validation?: WorldValidationResult;
  readonly validationRevision?: number;
  readonly exhaustedBudget?: boolean;
}
export class WorldCommandError extends Error {
  constructor(
    message: string,
    readonly snapshot?: WorldSnapshot,
  ) {
    super(message);
    this.name = 'WorldCommandError';
  }
}
export class WorldClient {
  readonly #worker: Worker;
  readonly #pending = new Map<
    string,
    {
      commandType: WorldCommandInput['type'];
      startedAt: number;
      postMs: number;
      resolve: (value: WorldClientResult) => void;
      reject: (reason: Error) => void;
    }
  >();
  readonly #metrics =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).has('world-metrics');
  #sequence = 0;
  #snapshot: WorldSnapshot | undefined = undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #workerError: Error | undefined;
  #disposed = false;
  constructor(
    worker = new Worker(new URL('./world.worker.ts', import.meta.url), {
      type: 'module',
    }),
  ) {
    this.#worker = worker;
    worker.onmessage = (event: MessageEvent<WorldWorkerResponse>) =>
      this.receive(event.data);
    worker.onerror = (event) => {
      this.#workerError = new Error(event.message || 'World worker failed');
      for (const pending of this.#pending.values())
        pending.reject(this.#workerError);
      this.#pending.clear();
    };
  }
  generate(config: WorldGenerationConfig): Promise<WorldClientResult> {
    return this.enqueue({ type: 'GENERATE', config });
  }
  load(state: SerializedWorldState): Promise<WorldClientResult> {
    return this.enqueue({ type: 'LOAD', state });
  }
  advance(
    target: bigint,
    eventBudget = 100_000,
    recordPresentation = true,
  ): Promise<WorldClientResult> {
    return this.enqueue({
      type: 'ADVANCE',
      target,
      eventBudget,
      recordPresentation,
    });
  }
  continueAdvance(
    eventBudget = 100_000,
    recordPresentation = true,
  ): Promise<WorldClientResult> {
    return this.enqueue({
      type: 'CONTINUE_ADVANCE',
      eventBudget,
      recordPresentation,
    });
  }
  snapshot(): Promise<WorldClientResult> {
    return this.enqueue({ type: 'SNAPSHOT' });
  }
  save(serialized = false): Promise<WorldClientResult> {
    return this.enqueue({ type: 'SAVE', serialized });
  }
  command(command: WorldCommandInput): Promise<WorldClientResult> {
    return this.enqueue(command);
  }
  dispose(): void {
    this.#disposed = true;
    this.#worker.terminate();
    for (const pending of this.#pending.values())
      pending.reject(new Error('World client disposed'));
    this.#pending.clear();
  }
  get workerError(): Error | undefined {
    return this.#workerError;
  }
  private enqueue(command: WorldCommandInput): Promise<WorldClientResult> {
    const run = () => this.send(command);
    const result = this.#tail.then(run, run);
    this.#tail = result.catch(() => undefined);
    return result;
  }
  private send(command: WorldCommandInput): Promise<WorldClientResult> {
    if (this.#disposed)
      return Promise.reject(new Error('World client is disposed'));
    if (this.#workerError !== undefined)
      return Promise.reject(this.#workerError);
    const requestId = `world-${++this.#sequence}`;
    const revisioned = !['GENERATE', 'LOAD', 'SAVE', 'SNAPSHOT'].includes(
      command.type,
    );
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, {
        commandType: command.type,
        startedAt: performance.now(),
        postMs: 0,
        resolve,
        reject,
      });
      try {
        const postStarted = performance.now();
        this.#worker.postMessage({
          ...command,
          ...(revisioned
            ? { expectedRevision: this.#snapshot?.revision ?? 0 }
            : {}),
          ...(this.#metrics ? { metrics: true } : {}),
          protocolVersion: WORLD_PROTOCOL_VERSION,
          requestId,
        } as WorldCommand);
        const pending = this.#pending.get(requestId);
        if (pending) pending.postMs = performance.now() - postStarted;
      } catch (error) {
        this.#pending.delete(requestId);
        reject(
          error instanceof Error
            ? error
            : new Error('World worker request failed'),
        );
      }
    });
  }
  private receive(response: WorldWorkerResponse): void {
    if (response.protocolVersion !== WORLD_PROTOCOL_VERSION) {
      this.#workerError = new Error(
        `World worker protocol mismatch: expected ${WORLD_PROTOCOL_VERSION}, received ${response.protocolVersion}`,
      );
      for (const pending of this.#pending.values())
        pending.reject(this.#workerError);
      this.#pending.clear();
      return;
    }
    const pending = this.#pending.get(response.requestId);
    if (pending === undefined) return;
    this.#pending.delete(response.requestId);
    if (this.#metrics)
      performance.measure('world:rpc', {
        start: pending.startedAt,
        detail: {
          command: pending.commandType,
          postMs: pending.postMs,
          ...response.metrics,
        },
      });
    if (response.type === 'WORLD_ERROR') {
      this.#workerError = new Error(response.message);
      pending.reject(this.#workerError);
      return;
    }
    if (response.type === 'ERROR') {
      if (
        this.#snapshot !== undefined &&
        response.revision !== undefined &&
        response.revision !== this.#snapshot.revision
      ) {
        const message = response.error;
        void this.send({ type: 'SNAPSHOT' }).then(
          (result) =>
            pending.reject(new WorldCommandError(message, result.snapshot)),
          (error: unknown) =>
            pending.reject(error instanceof Error ? error : new Error(message)),
        );
      } else pending.reject(new WorldCommandError(response.error));
      return;
    }
    if (response.type === 'READY') {
      if (
        pending.commandType === 'GENERATE' ||
        pending.commandType === 'LOAD' ||
        this.#snapshot === undefined ||
        response.snapshot.revision >= this.#snapshot.revision ||
        response.snapshot.worldId !== this.#snapshot.worldId
      )
        this.#snapshot = response.snapshot;
      pending.resolve({ snapshot: this.#snapshot });
      return;
    }
    if (response.type === 'VALIDATION') {
      if (this.#snapshot === undefined)
        pending.reject(new Error('World client is not initialised'));
      else
        pending.resolve({
          snapshot: this.#snapshot,
          validation: response.validation,
          validationRevision: response.revision,
        });
      return;
    }
    if (response.type === 'SAVE_RESULT' || response.type === 'SAVE_PAYLOAD') {
      if (this.#snapshot === undefined)
        pending.reject(new Error('World client is not initialised'));
      else
        pending.resolve({
          snapshot: this.#snapshot,
          ...(response.type === 'SAVE_PAYLOAD'
            ? { payload: response.payload }
            : { state: response.state }),
        });
      return;
    }
    if (this.#snapshot === undefined) {
      pending.reject(new Error('World delta arrived before initial snapshot'));
      return;
    }
    if (response.delta.revision <= this.#snapshot.revision) {
      pending.resolve({ snapshot: this.#snapshot });
      return;
    }
    if (
      response.delta.baseRevision !== this.#snapshot.revision ||
      response.delta.revision < response.delta.baseRevision
    ) {
      void this.send({ type: 'SNAPSHOT' }).then(
        (result) => pending.resolve({ snapshot: result.snapshot }),
        (error: unknown) =>
          pending.reject(
            error instanceof Error ? error : new Error('World resync failed'),
          ),
      );
      return;
    }
    const applyStarted = performance.now();
    this.#snapshot = applyWorldDelta(this.#snapshot, response.delta);
    if (this.#metrics)
      performance.measure('world:delta-apply', { start: applyStarted });
    pending.resolve({
      snapshot: this.#snapshot,
      exhaustedBudget: response.type === 'ADVANCE_PAUSED',
    });
  }
}

export const applyWorldDelta = (
  snapshot: WorldSnapshot,
  delta: WorldDelta,
): WorldSnapshot => {
  if (delta.revision < snapshot.revision) return snapshot;
  const oreRemaining =
    delta.oreChanges.length > 0
      ? snapshot.grid.oreRemaining.slice()
      : snapshot.grid.oreRemaining;
  const occupancy =
    delta.occupancyChanges.length > 0
      ? snapshot.grid.occupancy.slice()
      : snapshot.grid.occupancy;
  for (const change of delta.oreChanges)
    oreRemaining[change.index] = change.remaining;
  for (const change of delta.occupancyChanges)
    occupancy[change.index] = change.slot;
  const grid =
    delta.oreChanges.length === 0 && delta.occupancyChanges.length === 0
      ? snapshot.grid
      : { ...snapshot.grid, oreRemaining, occupancy };
  const { pendingAdvanceTarget, ...base } = snapshot;
  void pendingAdvanceTarget;
  return {
    ...base,
    revision: delta.revision,
    logicalTime: delta.logicalTime,
    grid,
    presentationOreChanges: delta.oreChanges,
    presentation: delta.presentation,
    drillExtractionIds: delta.drillExtractionIds,
    entities: delta.entities.filter(
      (entity) => !delta.removedEntityIds.includes(entity.id),
    ),
    railNodes: delta.railNodes,
    railEdges: delta.railEdges,
    railBlocks: delta.railBlocks,
    pods: delta.pods,
    missions: delta.missions,
    stations: delta.stations,
    buildings: delta.buildings,
    diagnostics: delta.diagnostics,
    paused: delta.paused,
    timeScale: delta.timeScale,
    scheduledEvents: delta.scheduledEvents,
    ...(delta.pendingAdvanceTarget === undefined
      ? {}
      : { pendingAdvanceTarget: delta.pendingAdvanceTarget }),
  };
};
