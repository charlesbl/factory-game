export interface LabelPoint { readonly x: number; readonly y: number }
export interface LabelSection { readonly points: readonly LabelPoint[] }
export interface LabelRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface EdgeLabelCandidate { readonly id: string; readonly text: string; readonly sections: readonly LabelSection[] }

interface LabelAnchor extends LabelPoint { readonly axis: 'horizontal' | 'vertical' }

const segmentLength = (a: LabelPoint, b: LabelPoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const sectionLength = (section: LabelSection): number => section.points.slice(1).reduce((total, point, index) => total + segmentLength(section.points[index]!, point), 0)

export const metricLabelAnchor = (sections: readonly LabelSection[]): LabelAnchor | undefined => {
  const section = [...sections].filter((candidate) => candidate.points.length > 1).sort((a, b) => sectionLength(b) - sectionLength(a))[0]
  if (section === undefined) return undefined
  const length = sectionLength(section); let remaining = length / 2
  for (let index = 1; index < section.points.length; index += 1) {
    const start = section.points[index - 1]!; const end = section.points[index]!; const segment = segmentLength(start, end)
    if (remaining <= segment) {
      const ratio = segment === 0 ? 0 : remaining / segment
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio, axis: start.y === end.y ? 'horizontal' : 'vertical' }
    }
    remaining -= segment
  }
  const end = section.points.at(-1)!; const before = section.points.at(-2)!
  return { ...end, axis: before.y === end.y ? 'horizontal' : 'vertical' }
}

const intersects = (a: LabelRect, b: LabelRect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const rectAt = (point: LabelPoint, width: number, height: number): LabelRect => ({ x: point.x - width / 2, y: point.y - height / 2, width, height })
const routeRects = (sections: readonly LabelSection[]): readonly LabelRect[] => sections.flatMap((section) => section.points.slice(1).flatMap((end, index) => {
  const start = section.points[index]!; const length = segmentLength(start, end); if (length === 0) return []
  return start.y === end.y
    ? [{ x: Math.min(start.x, end.x), y: start.y - 4, width: Math.abs(end.x - start.x), height: 8 }]
    : [{ x: start.x - 4, y: Math.min(start.y, end.y), width: 8, height: Math.abs(end.y - start.y) }]
}))

export const layoutEdgeLabels = (candidates: readonly EdgeLabelCandidate[], fixedObstacles: readonly LabelRect[] = []): ReadonlyMap<string, LabelPoint> => {
  const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id)); const routes = ordered.flatMap((candidate) => routeRects(candidate.sections)); const placed: LabelRect[] = []; const result = new Map<string, LabelPoint>()
  for (const candidate of ordered) {
    const anchor = metricLabelAnchor(candidate.sections); if (anchor === undefined) continue
    const width = Math.max(72, candidate.text.length * 5.4 + 18); const height = 24; const offsets = [-18, 18, -46, 46, -74, 74, -102, 102]
    const choices = offsets.map((offset) => {
      const point = anchor.axis === 'horizontal' ? { x: anchor.x, y: anchor.y + offset } : { x: anchor.x + offset, y: anchor.y }
      const rect = rectAt(point, width, height)
      const labelCollisions = placed.filter((other) => intersects(rect, other)).length
      const fixedCollisions = fixedObstacles.filter((other) => intersects(rect, other)).length
      const routeCollisions = routes.filter((other) => intersects(rect, other)).length
      return { point, rect, score: labelCollisions * 10_000 + fixedCollisions * 1_000 + routeCollisions * 100 + Math.abs(offset) }
    }).sort((a, b) => a.score - b.score)
    const choice = choices[0]!; placed.push(choice.rect); result.set(candidate.id, choice.point)
  }
  return result
}
