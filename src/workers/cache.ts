import type { FactoryContract } from '../compiler'

export class ContractCache {
  readonly #values = new Map<string, FactoryContract>()
  hits = 0; misses = 0
  constructor(readonly capacity = 64) {}
  get(hash: string): FactoryContract | undefined { const value = this.#values.get(hash); if (value === undefined) { this.misses += 1; return undefined }; this.hits += 1; this.#values.delete(hash); this.#values.set(hash, value); return value }
  set(contract: FactoryContract): FactoryContract { const existing = this.#values.get(contract.blueprintHash); if (existing !== undefined) return existing; this.#values.set(contract.blueprintHash, contract); while (this.#values.size > this.capacity) this.#values.delete(this.#values.keys().next().value as string); return contract }
  get size(): number { return this.#values.size }
}

export class ContractDependencyGraph {
  readonly #parentsByChild = new Map<string, Set<string>>()
  link(parent: string, child: string): void { const parents = this.#parentsByChild.get(child) ?? new Set<string>(); parents.add(parent); this.#parentsByChild.set(child, parents) }
  ancestorsOf(child: string): ReadonlySet<string> { const result = new Set<string>(); const pending = [child]; while (pending.length > 0) for (const parent of this.#parentsByChild.get(pending.pop()!) ?? []) if (!result.has(parent)) { result.add(parent); pending.push(parent) }; return result }
  wouldCreateCycle(parent: string, child: string): boolean { return parent === child || this.ancestorsOf(parent).has(child) }
}
