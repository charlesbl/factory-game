import { describe, expect, it } from 'vitest'
import { gridPoint, polylineLength } from './geometry'

describe('integer grid', () => {
  it('sums the Euclidean length of every polyline segment', () => {
    expect(polylineLength([gridPoint(0, 0), gridPoint(4, 0), gridPoint(4, 3)])).toBe(7)
    expect(polylineLength([gridPoint(0, 0), gridPoint(3, 4)])).toBe(5)
  })
  it('rejects fractional coordinates', () => expect(() => gridPoint(0.5, 2)).toThrow())
})
