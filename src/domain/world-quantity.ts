export const MAX_WORLD_QUANTITY = Number.MAX_SAFE_INTEGER;

export type WorldQuantity = number & {
  readonly __worldQuantity: unique symbol;
};
export const worldQuantity = (value: number): WorldQuantity => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_WORLD_QUANTITY) {
    throw new RangeError('World quantity must be a non-negative safe integer');
  }
  return value as WorldQuantity;
};
