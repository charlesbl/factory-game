import { formatRate } from '../domain'
import type { RateRaw } from '../domain'

export const formatPortRate = (flow: RateRaw | undefined, capacity: RateRaw): string =>
  flow === undefined ? `${formatRate(capacity)}/s` : `${formatRate(flow)}/s (max ${formatRate(capacity)}/s)`

export const formatMachinePortRate = (flow: RateRaw | undefined, fallback: RateRaw): string =>
  `${formatRate(flow ?? fallback)}/s`
