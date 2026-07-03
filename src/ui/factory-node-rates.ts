import { formatRate } from '../domain'
import type { RateRaw } from '../domain'

export const formatPortRate = (flow: RateRaw | undefined, capacity: RateRaw): string =>
  flow === undefined ? `${formatRate(capacity)}/s` : `${formatRate(flow)}/s (max ${formatRate(capacity)}/s)`

export const formatPortFlow = (flow: RateRaw | undefined): string =>
  `${flow === undefined ? '—' : formatRate(flow)}/s`

export const portUtilizationPercent = (flow: RateRaw | undefined, capacity: RateRaw): number | undefined => {
  if (flow === undefined) return undefined
  if (capacity === 0n) return flow === 0n ? 0 : 100
  return Math.min(100, Number((flow * 100n) / capacity))
}
