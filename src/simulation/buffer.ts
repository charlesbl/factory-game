import type { ResourceId, WorldQuantity } from '../domain';
import { worldQuantity } from '../domain';

export class WorldBuffer {
  readonly resourceId: ResourceId;
  readonly capacity: WorldQuantity;
  #quantity: WorldQuantity;
  constructor(resourceId: ResourceId, capacity: number, quantity = 0) {
    this.resourceId = resourceId;
    this.capacity = worldQuantity(capacity);
    this.#quantity = worldQuantity(quantity);
    if (this.#quantity > this.capacity)
      throw new RangeError('Buffer quantity exceeds capacity');
  }
  get quantity(): WorldQuantity {
    return this.#quantity;
  }
  get freeSpace(): number {
    return this.capacity - this.#quantity;
  }
  add(quantity: number): void {
    const next = this.#quantity + worldQuantity(quantity);
    if (next > this.capacity) throw new RangeError('Buffer is full');
    this.#quantity = worldQuantity(next);
  }
  remove(quantity: number): void {
    const amount = worldQuantity(quantity);
    if (amount > this.#quantity)
      throw new RangeError('Buffer has insufficient items');
    this.#quantity = worldQuantity(this.#quantity - amount);
  }
  snapshot(): {
    readonly resourceId: ResourceId;
    readonly capacity: number;
    readonly quantity: number;
  } {
    return {
      resourceId: this.resourceId,
      capacity: this.capacity,
      quantity: this.#quantity,
    };
  }
}

export const transferItems = (
  source: WorldBuffer,
  target: WorldBuffer,
  requested: number,
): number => {
  if (source.resourceId !== target.resourceId)
    throw new Error('Cannot transfer between different resources');
  const moved = Math.min(
    worldQuantity(requested),
    source.quantity,
    target.freeSpace,
  );
  source.remove(moved);
  target.add(moved);
  return moved;
};
