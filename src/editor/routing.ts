import type { EdgeId, GridPoint } from '../domain'
import type { CompileDiagnostic } from '../compiler/diagnostics'
import type { BlueprintEdge, FactoryBlueprint, RoutingLayerId } from './blueprint'
import { edgeRoute } from './connector-route'

const pointKey = (point: GridPoint): string => `${point.x},${point.y}`
const samePoint = (a: GridPoint, b: GridPoint): boolean => a.x === b.x && a.y === b.y
const inside = (point: GridPoint, rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, clearance = 0): boolean => point.x >= rect.x - clearance && point.x <= rect.x + rect.width + clearance && point.y >= rect.y - clearance && point.y <= rect.y + rect.height + clearance

export const orthogonalLength = (points: readonly GridPoint[]): number => {
  if (points.length < 2) throw new RangeError('A conveyor requires at least two points')
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index]!
    if (point.x !== previous.x && point.y !== previous.y) throw new RangeError('Conveyor segments must be orthogonal')
    return total + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)
  }, 0)
}
const cellsOnSegment = (a: GridPoint, b: GridPoint): readonly GridPoint[] => {
  if (a.x !== b.x && a.y !== b.y) return []
  const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y); const dx = Math.sign(b.x - a.x); const dy = Math.sign(b.y - a.y)
  return Array.from({ length: length + 1 }, (_, index) => ({ x: a.x + dx * index, y: a.y + dy * index }))
}
export const cellsOnRoute = (points: readonly GridPoint[]): readonly GridPoint[] => points.slice(1).flatMap((point, index) => cellsOnSegment(points[index]!, point).slice(index === 0 ? 0 : 1))

const compressCells = (cells: readonly GridPoint[]): readonly GridPoint[] => {
  const points: GridPoint[] = []
  for (const cell of cells) {
    const previous = points.at(-1); const before = points.at(-2)
    if (previous !== undefined && samePoint(previous, cell)) continue
    if (before !== undefined && previous !== undefined && (before.x === previous.x) === (previous.x === cell.x)) points[points.length - 1] = cell
    else points.push(cell)
  }
  return points
}

export interface RouteSection { readonly layerId: RoutingLayerId; readonly points: readonly GridPoint[] }
const bridgeIndexes = (blueprint: FactoryBlueprint, edge: BlueprintEdge): readonly number[] => {
  const cells = cellsOnRoute(edgeRoute(blueprint, edge).points)
  return edge.bridges.map((bridge) => cells.findIndex((cell) => samePoint(cell, bridge.position)))
}
export const routeSections = (blueprint: FactoryBlueprint, edge: BlueprintEdge): readonly RouteSection[] => {
  const cells = cellsOnRoute(edgeRoute(blueprint, edge).points); if (cells.length < 2) return []
  const indexes = new Set(bridgeIndexes(blueprint, edge).filter((index) => index >= 2 && index <= cells.length - 3))
  const sections: { layerId: RoutingLayerId; cells: GridPoint[] }[] = []
  for (let index = 1; index < cells.length; index += 1) {
    const layerId: RoutingLayerId = indexes.has(index) || indexes.has(index - 1) ? 'bridge' : 'primary'
    const current = sections.at(-1)
    if (current?.layerId === layerId) current.cells.push(cells[index]!)
    else sections.push({ layerId, cells: [cells[index - 1]!, cells[index]!] })
  }
  return sections.map((section) => ({ layerId: section.layerId, points: compressCells(section.cells) }))
}
export const routeBridgeMarkers = (blueprint: FactoryBlueprint, edge: BlueprintEdge): readonly GridPoint[] => {
  const cells = cellsOnRoute(edgeRoute(blueprint, edge).points)
  return bridgeIndexes(blueprint, edge).flatMap((index) => index >= 2 && index <= cells.length - 3 ? [cells[index - 1]!, cells[index + 1]!] : [])
}
export const routePhysicalLength = (blueprint: FactoryBlueprint, edge: BlueprintEdge): number => orthogonalLength(edgeRoute(blueprint, edge).points) + edge.bridges.length * 2

const diagnostic = (code: CompileDiagnostic['code'], edgeId: EdgeId, details?: Readonly<Record<string, string>>): CompileDiagnostic => ({ code, severity: 'error', entity: { edgeId }, ...(details === undefined ? {} : { details }) })
export const validatePhysicalRouting = (blueprint: FactoryBlueprint): readonly CompileDiagnostic[] => {
  const diagnostics: CompileDiagnostic[] = []
  const routes = [...blueprint.edges.values()].sort((a, b) => a.id.localeCompare(b.id))
  for (const edge of routes) {
    const points = edgeRoute(blueprint, edge).points
    try { if (orthogonalLength(points) === 0) diagnostics.push(diagnostic('ZERO_LENGTH', edge.id)) } catch { diagnostics.push(diagnostic('NON_ORTHOGONAL_ROUTE', edge.id)) }
    const cells = cellsOnRoute(points)
    for (const bridge of edge.bridges) {
      const index = cells.findIndex((cell) => samePoint(cell, bridge.position))
      if (index < 2 || index > cells.length - 3) diagnostics.push(diagnostic('INVALID_BRIDGE', edge.id, { bridgeId: bridge.id }))
    }
    const ownerNodes = new Set([edge.sourceNodeId, edge.targetNodeId]); let clearanceReported = false
    for (const point of cells.slice(1, -1)) for (const node of blueprint.nodes.values()) {
      if (ownerNodes.has(node.id)) continue
      const rect = { x: node.position.x + node.footprint.x, y: node.position.y + node.footprint.y, width: node.footprint.width, height: node.footprint.height }
      if (inside(point, rect)) { diagnostics.push(diagnostic('MACHINE_KEEPOUT', edge.id, { nodeId: node.id, x: String(point.x), y: String(point.y) })); break }
      if (!clearanceReported && inside(point, rect, 1)) { diagnostics.push(diagnostic('INSUFFICIENT_CLEARANCE', edge.id, { nodeId: node.id })); clearanceReported = true }
    }
  }
  for (let left = 0; left < routes.length; left += 1) for (let right = left + 1; right < routes.length; right += 1) {
    const a = routes[left]!; const b = routes[right]!; let contact: GridPoint | undefined
    for (const aSection of routeSections(blueprint, a)) {
      const aCells = cellsOnRoute(aSection.points)
      for (const bSection of routeSections(blueprint, b)) {
        if (aSection.layerId !== bSection.layerId) continue
        const bCells = new Set(cellsOnRoute(bSection.points).map(pointKey)); contact = aCells.find((point) => bCells.has(pointKey(point)))
        if (contact !== undefined) break
      }
      if (contact !== undefined) break
    }
    if (contact !== undefined) diagnostics.push(diagnostic('ILLEGAL_CROSSING', a.id, { otherEdgeId: b.id, x: String(contact.x), y: String(contact.y) }))
  }
  return diagnostics
}
