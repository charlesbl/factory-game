import type { InstanceId, SimTime } from '../domain';
import type { FactoryRuntimeInstance, RuntimeEvent } from './instance';

const before = (a: RuntimeEvent, b: RuntimeEvent): boolean =>
  a.time < b.time ||
  (a.time === b.time &&
    (a.actorId < b.actorId ||
      (a.actorId === b.actorId && a.sequence < b.sequence)));
export class EventScheduler {
  readonly #heap: RuntimeEvent[] = [];
  readonly #actors = new Map<InstanceId, FactoryRuntimeInstance>();
  processedEvents = 0;
  register(actor: FactoryRuntimeInstance): void {
    this.#actors.set(actor.id, actor);
    this.schedule(actor);
  }
  schedule(actor: FactoryRuntimeInstance): void {
    const event = actor.nextEvent;
    if (event === undefined) return;
    this.#heap.push(event);
    this.up(this.#heap.length - 1);
  }
  get scheduledEvents(): number {
    return this.#heap.length;
  }
  get sleepingActors(): number {
    return [...this.#actors.values()].filter(
      (actor) => actor.nextEvent === undefined,
    ).length;
  }
  advanceTo(target: SimTime, maxEvents = Number.MAX_SAFE_INTEGER): SimTime {
    let lastTime = target;
    const started = this.processedEvents;
    while (
      this.#heap[0] !== undefined &&
      this.#heap[0].time <= target &&
      this.processedEvents - started < maxEvents
    ) {
      const event = this.pop()!;
      const actor = this.#actors.get(event.actorId);
      if (
        actor === undefined ||
        actor.generation !== event.generation ||
        actor.nextEvent?.sequence !== event.sequence
      )
        continue;
      lastTime = event.time;
      actor.transition(event.time);
      this.processedEvents += 1;
      this.schedule(actor);
    }
    return this.#heap[0] !== undefined && this.#heap[0].time <= target
      ? lastTime
      : target;
  }
  private up(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (before(this.#heap[parent]!, this.#heap[index]!)) break;
      [this.#heap[parent], this.#heap[index]] = [
        this.#heap[index]!,
        this.#heap[parent]!,
      ];
      index = parent;
    }
  }
  private pop(): RuntimeEvent | undefined {
    const first = this.#heap[0];
    const last = this.#heap.pop();
    if (first === undefined || last === undefined) return first;
    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (
          left < this.#heap.length &&
          before(this.#heap[left]!, this.#heap[smallest]!)
        )
          smallest = left;
        if (
          right < this.#heap.length &&
          before(this.#heap[right]!, this.#heap[smallest]!)
        )
          smallest = right;
        if (smallest === index) break;
        [this.#heap[index], this.#heap[smallest]] = [
          this.#heap[smallest]!,
          this.#heap[index]!,
        ];
        index = smallest;
      }
    }
    return first;
  }
}
