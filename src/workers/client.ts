import type { CompileDiagnostic, FactoryContract } from '../compiler';
import {
  compileBlueprint,
  deserializeContract,
  ExactDagFlowSolver,
  isContract,
  serializeContract,
} from '../compiler';
import {
  canonicalCompilationInput,
  serializeBlueprint,
  type FactoryBlueprint,
} from '../editor';
import { ContractCache } from './cache';
import type { CompileRequest, CompileResponse } from './protocol';
import { sha256 } from './sha256';

export { sha256 } from './sha256';
export interface CompilationResult {
  readonly generation: number;
  readonly revision: number;
  readonly contract?: FactoryContract;
  readonly diagnostics: readonly CompileDiagnostic[];
  readonly stale: boolean;
}

interface QueuedCompilation {
  readonly generation: number;
  readonly blueprint: FactoryBlueprint;
  readonly childContracts: ReadonlyMap<string, FactoryContract>;
  readonly resolve: (result: CompilationResult) => void;
  readonly reject: (reason?: unknown) => void;
}
interface PendingWorkerRequest {
  readonly resolve: (response: CompileResponse) => void;
  readonly reject: (reason?: unknown) => void;
}

export class CompilationClient {
  readonly cache = new ContractCache();
  #worker: Worker | undefined;
  readonly #pending = new Map<string, PendingWorkerRequest>();
  #request = 0;
  #active: QueuedCompilation | undefined;
  #queued: QueuedCompilation | undefined;
  constructor() {
    let worker: Worker | undefined;
    try {
      worker =
        typeof Worker === 'undefined'
          ? undefined
          : new Worker(new URL('./compile.worker.ts', import.meta.url), {
              type: 'module',
              name: 'factory-compiler',
            });
    } catch {
      worker = undefined;
    }
    this.#worker = worker;
    this.#worker?.addEventListener(
      'message',
      (event: MessageEvent<CompileResponse>) => {
        const request = this.#pending.get(event.data.requestId);
        if (request !== undefined) {
          this.#pending.delete(event.data.requestId);
          request.resolve(event.data);
        }
      },
    );
    this.#worker?.addEventListener('error', (event: ErrorEvent) => {
      event.preventDefault();
      this.#disableWorker(new Error(event.message || 'Compiler worker failed'));
    });
    this.#worker?.addEventListener('messageerror', () => {
      this.#disableWorker(
        new Error('Compiler worker returned unreadable data'),
      );
    });
  }

  #disableWorker(error: Error): void {
    const worker = this.#worker;
    if (worker === undefined) return;
    this.#worker = undefined;
    worker.terminate();
    for (const request of this.#pending.values()) request.reject(error);
    this.#pending.clear();
  }
  compile(
    blueprint: FactoryBlueprint,
    childContracts: ReadonlyMap<string, FactoryContract> = new Map(),
  ): Promise<CompilationResult> {
    const generation = ++this.#request;
    return new Promise<CompilationResult>((resolve, reject) => {
      const compilation = {
        generation,
        blueprint,
        childContracts,
        resolve,
        reject,
      };
      if (this.#active === undefined) {
        void this.#run(compilation);
        return;
      }
      this.#queued?.resolve({
        generation: this.#queued.generation,
        revision: this.#queued.blueprint.revision,
        diagnostics: [],
        stale: true,
      });
      this.#queued = compilation;
    });
  }

  async #compile(
    blueprint: FactoryBlueprint,
    childContracts: ReadonlyMap<string, FactoryContract>,
    generation: number,
  ): Promise<Omit<CompilationResult, 'generation' | 'stale'>> {
    const requestId = `compile-${generation}`;
    const revision = blueprint.revision;
    const hash = await sha256(canonicalCompilationInput(blueprint));
    const cached = this.cache.get(hash);
    if (cached !== undefined)
      return { revision, contract: cached, diagnostics: cached.diagnostics };
    if (this.#worker === undefined)
      return this.#compileLocally(blueprint, childContracts, revision, hash);
    const request: CompileRequest = {
      protocolVersion: 1,
      requestId,
      revision,
      blueprint: serializeBlueprint(blueprint),
      childContracts: [
        ...new Map(
          [...childContracts.values()].map((contract) => [
            contract.blueprintHash,
            contract,
          ]),
        ).values(),
      ].map(serializeContract),
    };
    const worker = this.#worker;
    if (worker === undefined)
      return this.#compileLocally(blueprint, childContracts, revision, hash);
    let response: CompileResponse;
    try {
      response = await new Promise<CompileResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.#disableWorker(new Error('Compiler worker did not respond'));
        }, 15_000);
        this.#pending.set(requestId, {
          resolve: (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        try {
          worker.postMessage(request);
        } catch (error) {
          this.#disableWorker(
            error instanceof Error
              ? error
              : new Error('Compiler worker failed'),
          );
        }
      });
    } catch (error) {
      if (this.#worker === undefined)
        return this.#compileLocally(blueprint, childContracts, revision, hash);
      throw error;
    }
    if (!response.ok) return { revision, diagnostics: response.diagnostics };
    const contract = this.cache.set(deserializeContract(response.contract));
    return { revision, contract, diagnostics: contract.diagnostics };
  }

  async #compileLocally(
    blueprint: FactoryBlueprint,
    childContracts: ReadonlyMap<string, FactoryContract>,
    revision: number,
    hash: string,
  ): Promise<Omit<CompilationResult, 'generation' | 'stale'>> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const compiled = compileBlueprint(
      blueprint,
      new ExactDagFlowSolver(childContracts),
    );
    if (!isContract(compiled)) return { revision, diagnostics: compiled };
    const contract = this.cache.set({ ...compiled, blueprintHash: hash });
    return { revision, contract, diagnostics: contract.diagnostics };
  }

  async #run(compilation: QueuedCompilation): Promise<void> {
    this.#active = compilation;
    try {
      const result = await this.#compile(
        compilation.blueprint,
        compilation.childContracts,
        compilation.generation,
      );
      compilation.resolve({
        ...result,
        generation: compilation.generation,
        stale: compilation.generation !== this.#request,
      });
    } catch (error) {
      compilation.reject(error);
    } finally {
      this.#active = undefined;
      const next = this.#queued;
      this.#queued = undefined;
      if (next !== undefined) void this.#run(next);
    }
  }
  cancel(): void {
    this.#request += 1;
    this.#queued?.resolve({
      generation: this.#queued.generation,
      revision: this.#queued.blueprint.revision,
      diagnostics: [],
      stale: true,
    });
    this.#queued = undefined;
  }
  dispose(): void {
    this.cancel();
    this.#worker?.terminate();
    this.#pending.clear();
  }
}
