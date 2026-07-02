import { describe, expect, it } from 'vitest'
import { parseRate } from '../domain'
import { formatMachinePortRate, formatPortRate } from './factory-node-rates'

describe('factory node port rates', () => {
  it('distinguishes the current recipe flow from the port capacity', () => {
    expect(formatPortRate(parseRate('2'), parseRate('4'))).toBe('2/s (max 4/s)')
    expect(formatPortRate(parseRate('1'), parseRate('2'))).toBe('1/s (max 2/s)')
  })

  it('falls back to capacity while no compiled flow is available', () => {
    expect(formatPortRate(undefined, parseRate('4'))).toBe('4/s')
  })

  it('shows only the effective recipe flow on machines', () => {
    expect(formatMachinePortRate(parseRate('2'), parseRate('4'))).toBe('2/s')
    expect(formatMachinePortRate(parseRate('1'), parseRate('2'))).toBe('1/s')
  })
})
