/// <reference lib="webworker" />
import { compileBlueprint, deserializeContract, ExactDagFlowSolver, isContract, serializeContract } from '../compiler'
import { canonicalBlueprint, deserializeBlueprint } from '../editor'
import type { CompileRequest, CompileResponse } from './protocol'

const hash = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
const contracts = new Map<string, ReturnType<typeof serializeContract>>()
self.addEventListener('message', (event: MessageEvent<CompileRequest>) => {
  void (async () => {
    const request = event.data
    try {
      const blueprint = deserializeBlueprint(request.blueprint); const blueprintHash = await hash(canonicalBlueprint(blueprint)); const cached = contracts.get(blueprintHash)
      if (cached !== undefined) { self.postMessage({ protocolVersion: 1, requestId: request.requestId, revision: request.revision, ok: true, contract: cached } satisfies CompileResponse); return }
      const childContracts = new Map(request.childContracts.map((contract) => [contract.blueprintHash, deserializeContract(contract)]))
      const compiled = compileBlueprint(blueprint, new ExactDagFlowSolver(childContracts))
      if (!isContract(compiled)) { self.postMessage({ protocolVersion: 1, requestId: request.requestId, revision: request.revision, ok: false, diagnostics: compiled } satisfies CompileResponse); return }
      const contract = serializeContract({ ...compiled, blueprintHash }); contracts.set(blueprintHash, contract)
      while (contracts.size > 64) contracts.delete(contracts.keys().next().value as string)
      self.postMessage({ protocolVersion: 1, requestId: request.requestId, revision: request.revision, ok: true, contract } satisfies CompileResponse)
    } catch (error) {
      self.postMessage({ protocolVersion: 1, requestId: event.data.requestId, revision: event.data.revision, ok: false, diagnostics: [{ code: 'INTERNAL_VERIFICATION', severity: 'error', entity: {}, details: { value: error instanceof Error ? error.message : 'Worker failure' } }] } satisfies CompileResponse)
    }
  })()
})
