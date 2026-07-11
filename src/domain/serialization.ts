export const stringifyExact = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? { $bigint: item.toString() } : item,
  );

export const parseExact = <T>(value: string): T =>
  JSON.parse(value, (_key, item: unknown) => {
    if (typeof item === 'object' && item !== null && '$bigint' in item) {
      const raw = (item as { $bigint: unknown }).$bigint;
      if (typeof raw !== 'string' || !/^-?\d+$/.test(raw))
        throw new Error('Invalid bigint encoding');
      return BigInt(raw);
    }
    return item;
  }) as T;
