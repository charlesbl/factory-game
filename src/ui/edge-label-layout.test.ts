import { describe, expect, it } from 'vitest'
import { layoutEdgeLabels, metricLabelAnchor } from './edge-label-layout'

describe('edge label layout', () => {
  it('uses the metric midpoint rather than a polyline vertex', () => {
    expect(metricLabelAnchor([{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }] }])).toEqual({ x: 60, y: 0, axis: 'horizontal' })
  })

  it('separates labels that start from the same anchor', () => {
    const sections = [{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
    const layout = layoutEdgeLabels([{ id: 'a', text: 'first label', sections }, { id: 'b', text: 'second label', sections }])
    expect(layout.get('a')).not.toEqual(layout.get('b'))
  })
})
