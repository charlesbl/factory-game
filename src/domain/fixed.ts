export const RATE_SCALE = 1_000_000n
export const TIME_TICKS_PER_SECOND = 1_000_000n
export const ITEM_WORK = RATE_SCALE * TIME_TICKS_PER_SECOND

export type RateRaw = bigint
export type SimTime = bigint
export type WorkPhase = bigint
export type FixedRatio = bigint

export class NumericParseError extends Error {}

export const assertNonNegative = (value: bigint, label: string): bigint => {
  if (value < 0n) throw new RangeError(`${label} cannot be negative`)
  return value
}

export const parseRate = (decimal: string): RateRaw => {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(decimal.trim())
  if (match?.[1] === undefined) throw new NumericParseError(`Invalid rate: ${decimal}`)
  const fraction = (match[2] ?? '').padEnd(6, '0')
  return BigInt(match[1]) * RATE_SCALE + BigInt(fraction || '0')
}

export const formatRate = (raw: RateRaw, maximumFractionDigits = 3): string => {
  assertNonNegative(raw, 'Rate')
  return (Number(raw) / Number(RATE_SCALE)).toLocaleString('en', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  })
}

export const addExact = (a: bigint, b: bigint): bigint => a + b
export const subtractNonNegative = (a: bigint, b: bigint): bigint => {
  if (b > a) throw new RangeError('Subtraction would produce a negative value')
  return a - b
}
export const compareExact = (a: bigint, b: bigint): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0)
export const workForDuration = (rate: RateRaw, duration: SimTime): WorkPhase =>
  assertNonNegative(rate, 'Rate') * assertNonNegative(duration, 'Duration')
export const ceilingDivide = (numerator: bigint, denominator: bigint): bigint => {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('Ceiling division requires non-negative numerator and positive denominator')
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator
}

export const ratioFromRate = (value: RateRaw, nominal: RateRaw): FixedRatio =>
  nominal === 0n ? RATE_SCALE : (value * RATE_SCALE) / nominal

export const scaleRate = (rate: RateRaw, ratio: FixedRatio): RateRaw => (rate * ratio) / RATE_SCALE
