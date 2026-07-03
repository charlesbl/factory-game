import { describe, expect, it } from 'vitest'
import { parseRate } from '../domain'
import { formatPortFlow, formatPortRate, portUtilizationPercent } from './factory-node-rates'

describe('factory node port rates', () => {
  it('distinguishes the current recipe flow from the port capacity', () => {
    expect(formatPortRate(parseRate('2'), parseRate('4'))).toBe('2/s (max 4/s)')
    expect(formatPortRate(parseRate('1'), parseRate('2'))).toBe('1/s (max 2/s)')
  })

  it('falls back to capacity while no compiled flow is available', () => {
    expect(formatPortRate(undefined, parseRate('4'))).toBe('4/s')
  })

  it('formats the current flow without mixing it with capacity', () => {
    expect(formatPortFlow(parseRate('2'))).toBe('2/s')
    expect(formatPortFlow(undefined)).toBe('—/s')
  })

  it('calculates a bounded utilization percentage for the meter', () => {
    expect(portUtilizationPercent(parseRate('2'), parseRate('4'))).toBe(50)
    expect(portUtilizationPercent(parseRate('5'), parseRate('4'))).toBe(100)
    expect(portUtilizationPercent(undefined, parseRate('4'))).toBeUndefined()
  })
})
