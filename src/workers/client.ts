import type { CompileDiagnostic, FactoryContract } from '../compiler'
import { compileBlueprint, deserializeContract, isContract } from '../compiler'
import { canonicalBlueprint, serializeBlueprint, type FactoryBlueprint } from '../editor'
import { ContractCache } from './cache'
import type { CompileRequest, CompileResponse } from './protocol'

export const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export interface CompilationResult { readonly revision: number; readonly contract?: FactoryContract; readonly diagnostics: readonly CompileDiagnostic[]; readonly stale: boolean }

export class CompilationClient {
  readonly cache = new ContractCache()
  readonly #worker: Worker | undefined
  readonly #pending = new Map<string, (response: CompileResponse) => void>()
  #request = 0
  constructor() {
    this.#worker = typeof Worker === 'undefined' ? undefined : new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module', name: 'factory-compiler' })
    this.#worker?.addEventListener('message', (event: MessageEvent<CompileResponse>) => { const resolve = this.#pending.get(event.data.requestId); if (resolve !== undefined) { this.#pending.delete(event.data.requestId); resolve(event.data) } })
  }
  async compile(blueprint: FactoryBlueprint): Promise<CompilationResult> {
    const requestNumber = ++this.#request; const requestId = `compile-${requestNumber}`; const revision = blueprint.revision
    const hash = await sha256(canonicalBlueprint(blueprint)); const cached = this.cache.get(hash)
    if (cached !== undefined) return { revision, contract: cached, diagnostics: cached.diagnostics, stale: requestNumber !== this.#request }
    if (this.#worker === undefined) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); const compiled = compileBlueprint(blueprint)
      if (requestNumber !== this.#request) return { revision, diagnostics: [], stale: true }
      if (!isContract(compiled)) return { revision, diagnostics: compiled, stale: false }
      const contract = this.cache.set({ ...compiled, blueprintHash: hash }); return { revision, contract, diagnostics: contract.diagnostics, stale: false }
    }
    const request: CompileRequest = { protocolVersion: 1, requestId, revision, blueprint: serializeBlueprint(blueprint), childContracts: [] }
    const response = await new Promise<CompileResponse>((resolve) => { this.#pending.set(requestId, resolve); this.#worker!.postMessage(request) })
    if (requestNumber !== this.#request || response.revision !== blueprint.revision) return { revision, diagnostics: [], stale: true }
    if (!response.ok) return { revision, diagnostics: response.diagnostics, stale: false }
    const contract = this.cache.set(deserializeContract(response.contract)); return { revision, contract, diagnostics: contract.diagnostics, stale: false }
  }
  cancel(): void { this.#request += 1 }
  dispose(): void { this.#worker?.terminate(); this.#pending.clear() }
}
