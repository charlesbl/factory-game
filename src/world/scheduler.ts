import type { SimTime } from '../domain'

export type WorldEventKind = 'CONSTRUCTION_READY' | 'FACTORY' | 'MINE_EXTRACT' | 'TRAFFIC'
export interface WorldEvent {
  readonly time: SimTime
  readonly kind: WorldEventKind
  readonly entityId: string
  readonly sequence: number
}
export interface SerializedWorldEventQueue {
  readonly sequence: number
  readonly events: readonly { readonly time: string; readonly kind: WorldEventKind; readonly entityId: string; readonly sequence: number }[]
  readonly pendingAdvanceTarget?: string
}

const kindPriority: Readonly<Record<WorldEventKind, number>> = { TRAFFIC: 0, CONSTRUCTION_READY: 1, MINE_EXTRACT: 2, FACTORY: 3 }
const before = (a: WorldEvent, b: WorldEvent): boolean => a.time < b.time || a.time === b.time && (kindPriority[a.kind] < kindPriority[b.kind] || kindPriority[a.kind] === kindPriority[b.kind] && (a.entityId < b.entityId || a.entityId === b.entityId && a.sequence < b.sequence))

export class WorldEventQueue {
  readonly #heap: WorldEvent[] = []
  #sequence = 0
  pendingAdvanceTarget?: SimTime

  get size(): number { return this.#heap.length }
  get nextTime(): SimTime | undefined { return this.#heap[0]?.time }
  schedule(time: SimTime, kind: WorldEventKind, entityId: string): WorldEvent {
    if (time < 0n) throw new RangeError('World event time cannot be negative')
    const event = { time, kind, entityId, sequence: ++this.#sequence }; this.#heap.push(event); this.up(this.#heap.length - 1); return event
  }
  cancel(kind: WorldEventKind, entityId: string): void { const retained = this.#heap.filter((event) => event.kind !== kind || event.entityId !== entityId); this.#heap.length = 0; for (const event of retained) { this.#heap.push(event); this.up(this.#heap.length - 1) } }
  popBatch(target: SimTime): readonly WorldEvent[] {
    const time = this.#heap[0]?.time; if (time === undefined || time > target) return []
    const batch: WorldEvent[] = []; while (this.#heap[0]?.time === time) batch.push(this.pop()!); return batch
  }
  serialize(): SerializedWorldEventQueue { return { sequence: this.#sequence, events: [...this.#heap].sort((a, b) => before(a, b) ? -1 : before(b, a) ? 1 : 0).map((event) => ({ ...event, time: event.time.toString() })), ...(this.pendingAdvanceTarget === undefined ? {} : { pendingAdvanceTarget: this.pendingAdvanceTarget.toString() }) } }
  static restore(state: SerializedWorldEventQueue): WorldEventQueue {
    if (typeof state !== 'object' || state === null || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Array.isArray(state.events)) throw new Error('Invalid world event queue')
    const queue = new WorldEventQueue(); queue.#sequence = state.sequence
    for (const saved of state.events) { if (!/^\d+$/.test(saved.time) || !Number.isSafeInteger(saved.sequence) || saved.sequence < 1 || !(saved.kind in kindPriority)) throw new Error('Invalid world event'); const event: WorldEvent = { ...saved, time: BigInt(saved.time) }; queue.#heap.push(event); queue.up(queue.#heap.length - 1) }
    if (state.pendingAdvanceTarget !== undefined) { if (!/^\d+$/.test(state.pendingAdvanceTarget)) throw new Error('Invalid pending advance target'); queue.pendingAdvanceTarget = BigInt(state.pendingAdvanceTarget) }
    return queue
  }
  private up(index: number): void { while (index > 0) { const parent = Math.floor((index - 1) / 2); if (before(this.#heap[parent]!, this.#heap[index]!)) break; [this.#heap[parent], this.#heap[index]] = [this.#heap[index]!, this.#heap[parent]!]; index = parent } }
  private pop(): WorldEvent | undefined { const first = this.#heap[0]; const last = this.#heap.pop(); if (first === undefined || last === undefined) return first; if (this.#heap.length > 0) { this.#heap[0] = last; let index = 0; while (true) { const left = index * 2 + 1; const right = left + 1; let smallest = index; if (left < this.#heap.length && before(this.#heap[left]!, this.#heap[smallest]!)) smallest = left; if (right < this.#heap.length && before(this.#heap[right]!, this.#heap[smallest]!)) smallest = right; if (smallest === index) break; [this.#heap[index], this.#heap[smallest]] = [this.#heap[smallest]!, this.#heap[index]!]; index = smallest } } return first }
}
