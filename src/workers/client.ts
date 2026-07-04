import type { CompileDiagnostic, FactoryContract } from '../compiler'
import { compileBlueprint, deserializeContract, ExactDagFlowSolver, isContract, serializeContract } from '../compiler'
import { canonicalCompilationInput, serializeBlueprint, type FactoryBlueprint } from '../editor'
import { ContractCache } from './cache'
import type { CompileRequest, CompileResponse } from './protocol'

export const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export interface CompilationResult { readonly generation: number; readonly revision: number; readonly contract?: FactoryContract; readonly diagnostics: readonly CompileDiagnostic[]; readonly stale: boolean }

interface QueuedCompilation {
  readonly generation: number
  readonly blueprint: FactoryBlueprint
  readonly childContracts: ReadonlyMap<string, FactoryContract>
  readonly resolve: (result: CompilationResult) => void
  readonly reject: (reason?: unknown) => void
}

export class CompilationClient {
  readonly cache = new ContractCache()
  readonly #worker: Worker | undefined
  readonly #pending = new Map<string, (response: CompileResponse) => void>()
  #request = 0
  #active: QueuedCompilation | undefined
  #queued: QueuedCompilation | undefined
  constructor() {
    this.#worker = typeof Worker === 'undefined' ? undefined : new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module', name: 'factory-compiler' })
    this.#worker?.addEventListener('message', (event: MessageEvent<CompileResponse>) => { const resolve = this.#pending.get(event.data.requestId); if (resolve !== undefined) { this.#pending.delete(event.data.requestId); resolve(event.data) } })
  }
  compile(blueprint: FactoryBlueprint, childContracts: ReadonlyMap<string, FactoryContract> = new Map()): Promise<CompilationResult> {
    const generation = ++this.#request
    return new Promise<CompilationResult>((resolve, reject) => {
      const compilation = { generation, blueprint, childContracts, resolve, reject }
      if (this.#active === undefined) {
        void this.#run(compilation)
        return
      }
      this.#queued?.resolve({ generation: this.#queued.generation, revision: this.#queued.blueprint.revision, diagnostics: [], stale: true })
      this.#queued = compilation
    })
  }

  async #compile(blueprint: FactoryBlueprint, childContracts: ReadonlyMap<string, FactoryContract>, generation: number): Promise<Omit<CompilationResult, 'generation' | 'stale'>> {
    const requestId = `compile-${generation}`; const revision = blueprint.revision
    const hash = await sha256(canonicalCompilationInput(blueprint)); const cached = this.cache.get(hash)
    if (cached !== undefined) return { revision, contract: cached, diagnostics: cached.diagnostics }
    if (this.#worker === undefined) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); const compiled = compileBlueprint(blueprint, new ExactDagFlowSolver(childContracts))
      if (!isContract(compiled)) return { revision, diagnostics: compiled }
      const contract = this.cache.set({ ...compiled, blueprintHash: hash }); return { revision, contract, diagnostics: contract.diagnostics }
    }
    const request: CompileRequest = { protocolVersion: 1, requestId, revision, blueprint: serializeBlueprint(blueprint), childContracts: [...new Map([...childContracts.values()].map((contract) => [contract.blueprintHash, contract])).values()].map(serializeContract) }
    const response = await new Promise<CompileResponse>((resolve) => { this.#pending.set(requestId, resolve); this.#worker!.postMessage(request) })
    if (!response.ok) return { revision, diagnostics: response.diagnostics }
    const contract = this.cache.set(deserializeContract(response.contract)); return { revision, contract, diagnostics: contract.diagnostics }
  }

  async #run(compilation: QueuedCompilation): Promise<void> {
    this.#active = compilation
    try {
      const result = await this.#compile(compilation.blueprint, compilation.childContracts, compilation.generation)
      compilation.resolve({ ...result, generation: compilation.generation, stale: compilation.generation !== this.#request })
    } catch (error) {
      compilation.reject(error)
    } finally {
      this.#active = undefined
      const next = this.#queued
      this.#queued = undefined
      if (next !== undefined) void this.#run(next)
    }
  }
  cancel(): void {
    this.#request += 1
    this.#queued?.resolve({ generation: this.#queued.generation, revision: this.#queued.blueprint.revision, diagnostics: [], stale: true })
    this.#queued = undefined
  }
  dispose(): void { this.cancel(); this.#worker?.terminate(); this.#pending.clear() }
}
