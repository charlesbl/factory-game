import type { FactoryBlueprint } from './blueprint'
import type { EditCommand } from './commands'

export class BlueprintHistory {
  readonly #limit: number
  #past: FactoryBlueprint[] = []
  #future: FactoryBlueprint[] = []
  #current: FactoryBlueprint

  constructor(initial: FactoryBlueprint, limit = 100) { this.#current = initial; this.#limit = limit }
  get current(): FactoryBlueprint { return this.#current }
  get canUndo(): boolean { return this.#past.length > 0 }
  get canRedo(): boolean { return this.#future.length > 0 }
  execute(command: EditCommand): FactoryBlueprint {
    const next = command.apply(this.#current).blueprint
    if (next === this.#current) return this.#current
    this.#past.push(this.#current); if (this.#past.length > this.#limit) this.#past.shift()
    this.#future = []; this.#current = next; return next
  }
  undo(): FactoryBlueprint { const previous = this.#past.pop(); if (previous === undefined) return this.#current; this.#future.push(this.#current); this.#current = previous; return previous }
  redo(): FactoryBlueprint { const next = this.#future.pop(); if (next === undefined) return this.#current; this.#past.push(this.#current); this.#current = next; return next }
  replace(blueprint: FactoryBlueprint): FactoryBlueprint { this.#past = []; this.#future = []; this.#current = blueprint; return blueprint }
}
