import { worldQuantity } from '../domain'
import type { GridPoint, ResourceId, SimTime, WorldEntityId, WorldQuantity } from '../domain'
import { WorldBuffer } from '../simulation'
import { OreKind, gridIndex, type WorldGrid, type WorldItemStack, type WorldTransform } from './model'
import { occupiedCells } from './placement'

const canonicalStacks = (items: ReadonlyMap<ResourceId, number>): readonly WorldItemStack[] => [...items].filter(([, quantity]) => quantity > 0).sort(([a], [b]) => a.localeCompare(b)).map(([resourceId, quantity]) => ({ resourceId, quantity }))

export class SharedInventory {
  readonly #items = new Map<ResourceId, number>()
  readonly #limits = new Map<ResourceId, number>()
  constructor(readonly capacity: number, limits: readonly { readonly resourceId: ResourceId; readonly maximum: number }[] = [], initial: readonly WorldItemStack[] = []) {
    worldQuantity(capacity); for (const limit of limits) { worldQuantity(limit.maximum); this.#limits.set(limit.resourceId, limit.maximum) }
    for (const item of initial) this.add(item.resourceId, item.quantity)
  }
  get quantity(): number { return [...this.#items.values()].reduce((total, value) => total + value, 0) }
  get freeSpace(): number { return this.capacity - this.quantity }
  amount(resourceId: ResourceId): number { return this.#items.get(resourceId) ?? 0 }
  freeSpaceFor(resourceId: ResourceId): number { return Math.min(this.freeSpace, (this.#limits.get(resourceId) ?? this.capacity) - this.amount(resourceId)) }
  add(resourceId: ResourceId, quantity: number): void { const amount = worldQuantity(quantity); if (amount > this.freeSpaceFor(resourceId)) throw new RangeError('Shared inventory is full for this resource'); this.#items.set(resourceId, this.amount(resourceId) + amount) }
  remove(resourceId: ResourceId, quantity: number): void { const amount = worldQuantity(quantity); if (amount > this.amount(resourceId)) throw new RangeError('Shared inventory has insufficient items'); const next = this.amount(resourceId) - amount; if (next === 0) this.#items.delete(resourceId); else this.#items.set(resourceId, next) }
  moveAllTo(target: SharedInventory): void { for (const item of this.snapshot()) { if (target.freeSpaceFor(item.resourceId) < item.quantity) throw new RangeError('Target inventory cannot receive all items'); target.add(item.resourceId, item.quantity); this.remove(item.resourceId, item.quantity) } }
  snapshot(): readonly WorldItemStack[] { return canonicalStacks(this.#items) }
}
export class SharedInventoryBuffer extends WorldBuffer {
  constructor(readonly inventory: SharedInventory, resourceId: ResourceId) { super(resourceId, inventory.capacity, inventory.amount(resourceId)) }
  override get quantity(): WorldQuantity { return worldQuantity(this.inventory.amount(this.resourceId)) }
  override get freeSpace(): number { return this.inventory.freeSpaceFor(this.resourceId) }
  override add(quantity: number): void { this.inventory.add(this.resourceId, quantity) }
  override remove(quantity: number): void { this.inventory.remove(this.resourceId, quantity) }
  override snapshot(): { readonly resourceId: ResourceId; readonly capacity: number; readonly quantity: number } { return { resourceId: this.resourceId, capacity: this.inventory.capacity, quantity: this.quantity } }
}

export type ConstructionState = 'WAITING' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'EVACUATING' | 'REMOVED'
export class ConstructionSiteRuntime {
  readonly required = new Map<ResourceId, number>()
  readonly delivered: SharedInventory
  readonly salvage: SharedInventory
  state: ConstructionState = 'WAITING'
  constructor(cost: readonly WorldItemStack[]) {
    for (const item of cost) { worldQuantity(item.quantity); this.required.set(item.resourceId, (this.required.get(item.resourceId) ?? 0) + item.quantity) }
    const capacity = [...this.required.values()].reduce((total, quantity) => total + quantity, 0); this.delivered = new SharedInventory(capacity); this.salvage = new SharedInventory(capacity)
  }
  missing(resourceId: ResourceId): number { return Math.max(0, (this.required.get(resourceId) ?? 0) - this.delivered.amount(resourceId)) }
  deliver(resourceId: ResourceId, quantity: number): void { if (this.state !== 'WAITING') throw new Error('Construction site is not accepting deliveries'); if (quantity > this.missing(resourceId)) throw new RangeError('Delivery exceeds construction requirement'); this.delivered.add(resourceId, quantity); if ([...this.required].every(([id, amount]) => this.delivered.amount(id) === amount)) this.state = 'READY' }
  complete(): readonly WorldItemStack[] { if (this.state !== 'READY') throw new Error('Construction requirements are incomplete'); const consumed = this.delivered.snapshot(); for (const item of consumed) this.delivered.remove(item.resourceId, item.quantity); this.state = 'COMPLETED'; return consumed }
  cancel(): void { if (this.state !== 'WAITING' && this.state !== 'READY') throw new Error('Construction site cannot be cancelled'); this.delivered.moveAllTo(this.salvage); this.state = this.salvage.quantity === 0 ? 'REMOVED' : 'EVACUATING' }
  evacuate(resourceId: ResourceId, quantity: number): void { if (this.state !== 'EVACUATING') throw new Error('Construction site is not evacuating'); this.salvage.remove(resourceId, quantity); if (this.salvage.quantity === 0) this.state = 'REMOVED' }
}

export interface DrillGhost { readonly id: WorldEntityId; readonly position: GridPoint; readonly placedAt: SimTime; state: 'GHOST' | 'ACTIVE' | 'EXHAUSTED' }

const adjacent = (a: GridPoint, b: GridPoint): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1
const distanceToTransform = (point: GridPoint, transform: WorldTransform): number => occupiedCells(transform).reduce((minimum, cell) => Math.min(minimum, Math.abs(point.x - cell.x) + Math.abs(point.y - cell.y)), Number.MAX_SAFE_INTEGER)

export class MineRuntime {
  readonly drills = new Map<WorldEntityId, DrillGhost>()
  readonly construction: SharedInventory
  readonly salvage: SharedInventory
  readonly output: WorldBuffer
  constructor(readonly grid: WorldGrid, readonly main: WorldTransform, readonly resourceId: ResourceId, readonly oreKind: OreKind, readonly drillCost: readonly WorldItemStack[], outputCapacity = 100) {
    if (oreKind === OreKind.NONE) throw new Error('A mine requires a concrete ore kind')
    if (occupiedCells(main).some((point) => grid.oreKinds[gridIndex(grid, point)] !== OreKind.NONE)) throw new Error('Mine main building must be outside an ore patch')
    const cost = drillCost.reduce((total, item) => total + worldQuantity(item.quantity), 0); this.construction = new SharedInventory(cost * grid.oreKinds.filter((kind) => kind === oreKind).length); this.salvage = new SharedInventory(cost * grid.oreKinds.filter((kind) => kind === oreKind).length); this.output = new WorldBuffer(resourceId, outputCapacity)
  }
  placeDrill(id: WorldEntityId, position: GridPoint, placedAt: SimTime): void {
    if (this.drills.has(id)) throw new Error('Duplicate drill'); const index = gridIndex(this.grid, position)
    if (index < 0 || this.grid.oreKinds[index] !== this.oreKind || this.grid.oreRemaining[index] === 0) throw new Error('Drill must be placed on matching, non-exhausted ore')
    if ([...this.drills.values()].some((drill) => drill.position.x === position.x && drill.position.y === position.y)) throw new Error('Drill tile is already occupied')
    const connected = distanceToTransform(position, this.main) === 1 || [...this.drills.values()].some((drill) => adjacent(drill.position, position)); if (!connected) throw new Error('Drill must touch the mine or another drill')
    this.drills.set(id, { id, position, placedAt, state: 'GHOST' })
  }
  nextGhost(): DrillGhost | undefined { return [...this.drills.values()].filter((drill) => drill.state === 'GHOST').sort((a, b) => distanceToTransform(a.position, this.main) - distanceToTransform(b.position, this.main) || (a.placedAt < b.placedAt ? -1 : a.placedAt > b.placedAt ? 1 : a.id.localeCompare(b.id)))[0] }
  buildNext(): DrillGhost | undefined {
    const drill = this.nextGhost(); if (drill === undefined) return undefined
    if (this.drillCost.some((item) => this.construction.amount(item.resourceId) < item.quantity)) return undefined
    for (const item of this.drillCost) this.construction.remove(item.resourceId, item.quantity); drill.state = 'ACTIVE'; return drill
  }
  extract(): number {
    let produced = 0
    for (const drill of [...this.drills.values()].filter((item) => item.state === 'ACTIVE').sort((a, b) => a.id.localeCompare(b.id))) {
      const index = gridIndex(this.grid, drill.position); if (this.grid.oreRemaining[index] === 0) { drill.state = 'EXHAUSTED'; continue }
      if (this.output.freeSpace === 0) break; const remaining = this.grid.oreRemaining[index]! - 1; this.grid.oreRemaining[index] = remaining; this.output.add(1); produced += 1; if (remaining === 0) drill.state = 'EXHAUSTED'
    }
    return produced
  }
  dismantleDrill(id: WorldEntityId): void { const drill = this.drills.get(id); if (drill === undefined) throw new Error('Unknown drill'); for (const item of this.drillCost) this.salvage.add(item.resourceId, item.quantity); this.drills.delete(id) }
}

export interface SalvageDestination { readonly id: string; readonly kind: 'request' | 'storage'; readonly distance: number; readonly priority: number; readonly freeSpace: number }
export const chooseSalvageDestination = (quantity: number, destinations: readonly SalvageDestination[]): SalvageDestination | undefined => destinations.filter((item) => item.freeSpace >= quantity).sort((a, b) => (a.kind === 'request' ? 0 : 1) - (b.kind === 'request' ? 0 : 1) || (a.kind === 'request' && b.kind === 'request' ? b.priority - a.priority : 0) || a.distance - b.distance || a.id.localeCompare(b.id))[0]
