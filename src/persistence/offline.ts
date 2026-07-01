import type { SimTime } from '../domain'
import type { EventScheduler } from '../simulation'

export interface OfflineResult { readonly advancedTo: SimTime; readonly exhaustedBudget: boolean }
export const advanceOffline = (scheduler: EventScheduler, from: SimTime, to: SimTime, eventBudget = 100_000): OfflineResult => {
  if (to < from) throw new RangeError('Offline target must not precede saved time')
  const before = scheduler.processedEvents; const advancedTo = scheduler.advanceTo(to, eventBudget)
  return { advancedTo, exhaustedBudget: scheduler.processedEvents - before >= eventBudget && advancedTo < to }
}
