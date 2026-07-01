import { describe, expect, it } from 'vitest'
import { gridPoint, polylineLength } from './geometry'

describe('integer grid', () => {
  it('calculates Manhattan polylines', () => expect(polylineLength([gridPoint(0, 0), gridPoint(4, 0), gridPoint(4, 3)])).toBe(7))
  it('rejects fractional coordinates', () => expect(() => gridPoint(0.5, 2)).toThrow())
})
