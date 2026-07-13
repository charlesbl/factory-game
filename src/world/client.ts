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
  readonly validation?: WorldValidationResult;
  readonly exhaustedBudget?: boolean;
}
export class WorldClient {
  readonly #worker: Worker;
  readonly #pending = new Map<
    string,
    {
      resolve: (value: WorldClientResult) => void;
      reject: (reason: Error) => void;
    }
  >();
  #sequence = 0;
  #snapshot: WorldSnapshot | undefined = undefined;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(
    worker = new Worker(new URL('./world.worker.ts', import.meta.url), {
      type: 'module',
    }),
  ) {
    this.#worker = worker;
    worker.onmessage = (event: MessageEvent<WorldWorkerResponse>) =>
      this.receive(event.data);
    worker.onerror = (event) => {
      for (const pending of this.#pending.values())
        pending.reject(new Error(event.message));
      this.#pending.clear();
    };
  }
  generate(config: WorldGenerationConfig): Promise<WorldClientResult> {
    this.#snapshot = undefined;
    return this.enqueue({ type: 'GENERATE', config });
  }
  load(state: SerializedWorldState): Promise<WorldClientResult> {
    this.#snapshot = undefined;
    return this.enqueue({ type: 'LOAD', state });
  }
  advance(target: bigint, eventBudget = 100_000): Promise<WorldClientResult> {
    return this.enqueue({ type: 'ADVANCE', target, eventBudget });
  }
  continueAdvance(eventBudget = 100_000): Promise<WorldClientResult> {
    return this.enqueue({ type: 'CONTINUE_ADVANCE', eventBudget });
  }
  snapshot(): Promise<WorldClientResult> {
    return this.enqueue({ type: 'SNAPSHOT' });
  }
  save(): Promise<WorldClientResult> {
    return this.enqueue({ type: 'SAVE' });
  }
  command(command: WorldCommandInput): Promise<WorldClientResult> {
    return this.enqueue(command);
  }
  dispose(): void {
    this.#worker.terminate();
    for (const pending of this.#pending.values())
      pending.reject(new Error('World client disposed'));
    this.#pending.clear();
  }
  private enqueue(command: WorldCommandInput): Promise<WorldClientResult> {
    const run = () => this.send(command);
    const result = this.#tail.then(run, run);
    this.#tail = result.catch(() => undefined);
    return result;
  }
  private send(command: WorldCommandInput): Promise<WorldClientResult> {
    const requestId = `world-${++this.#sequence}`;
    const revisioned = !['GENERATE', 'LOAD', 'SAVE', 'SNAPSHOT'].includes(
      command.type,
    );
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      this.#worker.postMessage({
        ...command,
        ...(revisioned
          ? { expectedRevision: this.#snapshot?.revision ?? 0 }
          : {}),
        protocolVersion: WORLD_PROTOCOL_VERSION,
        requestId,
      } as WorldCommand);
    });
  }
  private receive(response: WorldWorkerResponse): void {
    if (response.protocolVersion !== WORLD_PROTOCOL_VERSION) return;
    const pending = this.#pending.get(response.requestId);
    if (pending === undefined) return;
    this.#pending.delete(response.requestId);
    if (response.type === 'ERROR') {
      pending.reject(new Error(response.error));
      return;
    }
    if (response.type === 'READY') {
      if (
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
        });
      return;
    }
    if (response.type === 'SAVE_RESULT') {
      if (this.#snapshot === undefined)
        pending.reject(new Error('World client is not initialised'));
      else pending.resolve({ snapshot: this.#snapshot, state: response.state });
      return;
    }
    if (this.#snapshot === undefined) {
      pending.reject(new Error('World delta arrived before initial snapshot'));
      return;
    }
    if (response.delta.revision >= this.#snapshot.revision)
      this.#snapshot = applyWorldDelta(this.#snapshot, response.delta);
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
  const grid =
    delta.oreChanges.length === 0
      ? snapshot.grid
      : (() => {
          const oreRemaining = snapshot.grid.oreRemaining.slice();
          for (const change of delta.oreChanges)
            oreRemaining[change.index] = change.remaining;
          return { ...snapshot.grid, oreRemaining };
        })();
  const { pendingAdvanceTarget, ...base } = snapshot;
  void pendingAdvanceTarget;
  return {
    ...base,
    revision: delta.revision,
    logicalTime: delta.logicalTime,
    grid,
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
