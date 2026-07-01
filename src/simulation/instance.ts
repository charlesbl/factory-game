import { ceilingDivide, ITEM_WORK, TIME_TICKS_PER_SECOND } from '../domain'
import type { InstanceId, ResourceId, SimTime, WorkPhase } from '../domain'
import type { FactoryContract } from '../compiler'
import { WorldBuffer } from './buffer'

export type FactoryState = 'RUNNING' | 'WAITING_INPUT' | 'OUTPUT_BLOCKED' | 'PAUSED' | 'INVALID' | 'MAINTENANCE'
export interface RuntimeEvent { readonly time: SimTime; readonly actorId: InstanceId; readonly sequence: number; readonly generation: number }
export interface InstanceSnapshot {
  readonly id: InstanceId; readonly contractHash: string; readonly state: FactoryState; readonly lastAdvanced: string
  readonly generation: number; readonly inputWork: readonly [ResourceId, string][]; readonly outputWork: readonly [ResourceId, string][]
  readonly inputs: readonly ReturnType<WorldBuffer['snapshot']>[]; readonly outputs: readonly ReturnType<WorldBuffer['snapshot']>[]
  readonly nextEvent?: { readonly time: string; readonly sequence: number; readonly generation: number }
}

export class FactoryRuntimeInstance {
  readonly id: InstanceId
  #contract: FactoryContract
  readonly inputs = new Map<ResourceId, WorldBuffer>()
  readonly outputs = new Map<ResourceId, WorldBuffer>()
  readonly #inputWork = new Map<ResourceId, WorkPhase>()
  readonly #outputWork = new Map<ResourceId, WorkPhase>()
  #state: FactoryState = 'WAITING_INPUT'
  #lastAdvanced: SimTime = 0n
  #generation = 0
  #eventSequence = 0
  #nextEvent: RuntimeEvent | undefined
  #listeners = new Set<() => void>()

  constructor(id: InstanceId, contract: FactoryContract, bufferCapacity = 20) {
    this.id = id; this.#contract = contract
    for (const resourceId of contract.inputRates.keys()) { this.inputs.set(resourceId, new WorldBuffer(resourceId, bufferCapacity)); this.#inputWork.set(resourceId, 0n) }
    for (const resourceId of contract.outputRates.keys()) { this.outputs.set(resourceId, new WorldBuffer(resourceId, bufferCapacity)); this.#outputWork.set(resourceId, 0n) }
    this.transition(0n)
  }
  get state(): FactoryState { return this.#state }
  get contract(): FactoryContract { return this.#contract }
  get lastAdvanced(): SimTime { return this.#lastAdvanced }
  get nextEvent(): RuntimeEvent | undefined { return this.#nextEvent }
  get generation(): number { return this.#generation }
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  private publish(): void { this.#listeners.forEach((listener) => listener()) }

  advanceTo(time: SimTime): void {
    if (time < this.#lastAdvanced) throw new RangeError('Simulation time cannot move backwards')
    if (this.#state === 'RUNNING') {
      const delta = time - this.#lastAdvanced
      for (const [resource, rate] of this.#contract.inputRates) this.#inputWork.set(resource, (this.#inputWork.get(resource) ?? 0n) - rate * delta)
      for (const [resource, rate] of this.#contract.outputRates) this.#outputWork.set(resource, (this.#outputWork.get(resource) ?? 0n) + rate * delta)
    }
    this.#lastAdvanced = time
  }
  transition(time: SimTime): void {
    this.advanceTo(time)
    if (this.#state === 'PAUSED' || this.#state === 'INVALID' || this.#state === 'MAINTENANCE') return
    for (const [resource, phase] of this.#outputWork) {
      const buffer = this.outputs.get(resource)!
      let work = phase
      while (work >= ITEM_WORK && buffer.freeSpace > 0) { buffer.add(1); work -= ITEM_WORK }
      this.#outputWork.set(resource, work)
      if (work >= ITEM_WORK && buffer.freeSpace === 0) { this.setState('OUTPUT_BLOCKED'); return }
    }
    for (const resource of this.#contract.inputRates.keys()) {
      let work = this.#inputWork.get(resource) ?? 0n
      if (work <= 0n) {
        const buffer = this.inputs.get(resource)!
        if (buffer.quantity === 0) { this.setState('WAITING_INPUT'); return }
        buffer.remove(1); work += ITEM_WORK; this.#inputWork.set(resource, work)
      }
    }
    this.setState('RUNNING'); this.scheduleNext()
  }
  private setState(state: FactoryState): void {
    if (this.#state !== state) { this.#state = state; this.#generation += 1 }
    if (state !== 'RUNNING') this.#nextEvent = undefined
    this.publish()
  }
  private scheduleNext(): void {
    let delta: bigint | undefined
    for (const [resource, rate] of this.#contract.inputRates) {
      if (rate === 0n) continue
      const duration = ceilingDivide(this.#inputWork.get(resource) ?? 0n, rate)
      if (delta === undefined || duration < delta) delta = duration
    }
    for (const [resource, rate] of this.#contract.outputRates) {
      if (rate === 0n) continue
      const duration = ceilingDivide(ITEM_WORK - (this.#outputWork.get(resource) ?? 0n), rate)
      if (delta === undefined || duration < delta) delta = duration
    }
    if (delta === undefined) { this.setState('INVALID'); return }
    this.#eventSequence += 1
    this.#nextEvent = { time: this.#lastAdvanced + delta, actorId: this.id, sequence: this.#eventSequence, generation: this.#generation }
    this.publish()
  }
  addInput(resource: ResourceId, quantity: number, time = this.#lastAdvanced): void { this.advanceTo(time); this.inputs.get(resource)?.add(quantity); if (this.#state === 'WAITING_INPUT') this.transition(time); else this.publish() }
  removeOutput(resource: ResourceId, quantity: number, time = this.#lastAdvanced): void { this.advanceTo(time); this.outputs.get(resource)?.remove(quantity); if (this.#state === 'OUTPUT_BLOCKED') this.transition(time); else this.publish() }
  pause(time = this.#lastAdvanced): void { this.advanceTo(time); this.setState('PAUSED') }
  resume(time = this.#lastAdvanced): void { if (this.#state !== 'PAUSED') return; this.#state = 'WAITING_INPUT'; this.transition(time) }
  invalidate(time = this.#lastAdvanced): void { this.advanceTo(time); this.setState('INVALID') }
  swapContractWhenEmpty(contract: FactoryContract, time = this.#lastAdvanced): boolean {
    return this.migrateContract(contract, time)
  }
  migrateContract(contract: FactoryContract, time = this.#lastAdvanced): boolean {
    this.advanceTo(time)
    const compatibleInput = new Set(contract.inputRates.keys()); const compatibleOutput = new Set(contract.outputRates.keys())
    const incompatibleWip = [...this.#inputWork].some(([resource, phase]) => phase !== 0n && !compatibleInput.has(resource)) || [...this.#outputWork].some(([resource, phase]) => phase !== 0n && !compatibleOutput.has(resource))
    const strandedItems = [...this.inputs].some(([resource, buffer]) => buffer.quantity > 0 && !compatibleInput.has(resource)) || [...this.outputs].some(([resource, buffer]) => buffer.quantity > 0 && !compatibleOutput.has(resource))
    if (incompatibleWip || strandedItems) { this.setState('MAINTENANCE'); return false }
    for (const resource of [...this.#inputWork.keys()]) if (!compatibleInput.has(resource)) { this.#inputWork.delete(resource); this.inputs.delete(resource) }
    for (const resource of [...this.#outputWork.keys()]) if (!compatibleOutput.has(resource)) { this.#outputWork.delete(resource); this.outputs.delete(resource) }
    for (const resource of compatibleInput) if (!this.inputs.has(resource)) { this.inputs.set(resource, new WorldBuffer(resource, 20)); this.#inputWork.set(resource, 0n) }
    for (const resource of compatibleOutput) if (!this.outputs.has(resource)) { this.outputs.set(resource, new WorldBuffer(resource, 20)); this.#outputWork.set(resource, 0n) }
    this.#contract = contract; this.#state = 'WAITING_INPUT'; this.#generation += 1; this.transition(time); return true
  }
  getSnapshot = (): InstanceSnapshot => ({
    id: this.id, contractHash: this.#contract.blueprintHash, state: this.#state, lastAdvanced: this.#lastAdvanced.toString(), generation: this.#generation,
    inputWork: [...this.#inputWork].map(([id, phase]) => [id, phase.toString()]), outputWork: [...this.#outputWork].map(([id, phase]) => [id, phase.toString()]),
    inputs: [...this.inputs.values()].map((buffer) => buffer.snapshot()), outputs: [...this.outputs.values()].map((buffer) => buffer.snapshot()),
    ...(this.#nextEvent === undefined ? {} : { nextEvent: { time: this.#nextEvent.time.toString(), sequence: this.#nextEvent.sequence, generation: this.#nextEvent.generation } }),
  })
  progress(resource: ResourceId, role: 'input' | 'output'): number { const phase = role === 'input' ? this.#inputWork.get(resource) ?? 0n : this.#outputWork.get(resource) ?? 0n; return Number((phase * 10_000n) / ITEM_WORK) / 100 }
  static seconds(value: number): SimTime { return BigInt(Math.round(value * Number(TIME_TICKS_PER_SECOND))) }
  static restore(snapshot: InstanceSnapshot, contract: FactoryContract): FactoryRuntimeInstance {
    if (snapshot.contractHash !== contract.blueprintHash) throw new Error('Snapshot contract does not match')
    const instance = new FactoryRuntimeInstance(snapshot.id, contract)
    instance.inputs.clear(); instance.outputs.clear(); instance.#inputWork.clear(); instance.#outputWork.clear()
    for (const buffer of snapshot.inputs) instance.inputs.set(buffer.resourceId, new WorldBuffer(buffer.resourceId, buffer.capacity, buffer.quantity))
    for (const buffer of snapshot.outputs) instance.outputs.set(buffer.resourceId, new WorldBuffer(buffer.resourceId, buffer.capacity, buffer.quantity))
    for (const [resource, phase] of snapshot.inputWork) instance.#inputWork.set(resource, BigInt(phase))
    for (const [resource, phase] of snapshot.outputWork) instance.#outputWork.set(resource, BigInt(phase))
    instance.#state = snapshot.state; instance.#lastAdvanced = BigInt(snapshot.lastAdvanced); instance.#generation = snapshot.generation
    if (snapshot.nextEvent !== undefined) { instance.#eventSequence = snapshot.nextEvent.sequence; instance.#nextEvent = { actorId: snapshot.id, time: BigInt(snapshot.nextEvent.time), sequence: snapshot.nextEvent.sequence, generation: snapshot.nextEvent.generation } }
    else instance.#nextEvent = undefined
    return instance
  }
}
