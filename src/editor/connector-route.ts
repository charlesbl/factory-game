import type { GridPoint } from '../domain'
import type { BlueprintEdge, FactoryBlueprint, LooseConnection, PortReference, RouteConnector } from './blueprint'
import { absolutePortPosition, findPort } from './blueprint'

export type RouteAxis = 'horizontal' | 'vertical'
export interface MaterializedRoute { readonly points: readonly GridPoint[]; readonly spans: readonly (readonly GridPoint[])[] }

export const oppositeRouteAxis = (axis: RouteAxis): RouteAxis => axis === 'horizontal' ? 'vertical' : 'horizontal'

export const portRouteAxis = (blueprint: FactoryBlueprint, reference: PortReference): RouteAxis => {
  const node = blueprint.nodes.get(reference.nodeId); const port = findPort(blueprint, reference.nodeId, reference.portId)
  if (node !== undefined && port !== undefined) {
    if (port.anchor.x === 0 || port.anchor.x === node.footprint.width) return 'horizontal'
    if (port.anchor.y === 0 || port.anchor.y === node.footprint.height) return 'vertical'
  }
  return 'horizontal'
}

const samePoint = (a: GridPoint, b: GridPoint): boolean => a.x === b.x && a.y === b.y
const appendDistinct = (points: GridPoint[], point: GridPoint): void => { if (!samePoint(points.at(-1) ?? point, point) || points.length === 0) points.push(point) }
const overlapLength = (a: GridPoint, b: GridPoint, c: GridPoint, d: GridPoint): number => {
  if (a.x === b.x && c.x === d.x && a.x === c.x) return Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)))
  if (a.y === b.y && c.y === d.y && a.y === c.y) return Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)))
  return 0
}
const overlapWithRoute = (span: readonly GridPoint[], route: readonly GridPoint[]): number => span.slice(1).reduce((total, end, index) => total + route.slice(1).reduce((segmentTotal, routeEnd, routeIndex) => segmentTotal + overlapLength(span[index]!, end, route[routeIndex]!, routeEnd), 0), 0)
const lSpan = (start: GridPoint, end: GridPoint, firstAxis: RouteAxis): readonly GridPoint[] => [start, firstAxis === 'horizontal' ? { x: end.x, y: start.y } : { x: start.x, y: end.y }, end]

export const materializeConnectorRoute = (
  start: GridPoint,
  connectors: readonly RouteConnector[],
  startAxis: RouteAxis,
  end?: { readonly position: GridPoint; readonly axis: RouteAxis },
): MaterializedRoute => {
  const destinations = connectors.map((connector) => connector.position).concat(end === undefined ? [] : [end.position])
  const points: GridPoint[] = [start]; const spans: GridPoint[][] = []; let axis = startAxis; let current = start
  destinations.forEach((destination, index) => {
    const final = end !== undefined && index === destinations.length - 1
    let span: GridPoint[] = [current]
    if (current.x !== destination.x && current.y !== destination.y) {
      const preferredAxis = final ? oppositeRouteAxis(end.axis) : axis; const alternateAxis = oppositeRouteAxis(preferredAxis)
      const preferred = lSpan(current, destination, preferredAxis); const alternate = lSpan(current, destination, alternateAxis)
      const firstAxis = !final && overlapWithRoute(alternate, points) < overlapWithRoute(preferred, points) ? alternateAxis : preferredAxis
      span = [...(firstAxis === preferredAxis ? preferred : alternate)]; appendDistinct(points, span[1]!); axis = oppositeRouteAxis(firstAxis)
    } else if (current.x !== destination.x) axis = 'horizontal'
    else if (current.y !== destination.y) axis = 'vertical'
    appendDistinct(span, destination); appendDistinct(points, destination); spans.push(span); current = destination
  })
  return { points, spans }
}

export const edgeRoute = (blueprint: FactoryBlueprint, edge: BlueprintEdge): MaterializedRoute => {
  const source = { nodeId: edge.sourceNodeId, portId: edge.sourcePortId }; const target = { nodeId: edge.targetNodeId, portId: edge.targetPortId }
  const start = absolutePortPosition(blueprint, source); const end = absolutePortPosition(blueprint, target)
  if (start === undefined || end === undefined) return { points: edge.points, spans: [edge.points] }
  const routeConnectors = edge.routeConnectors ?? edge.points.slice(1, -1).map((position, index) => ({ id: `${edge.id}:connector:${index}` as RouteConnector['id'], position }))
  return materializeConnectorRoute(start, routeConnectors, portRouteAxis(blueprint, source), { position: end, axis: portRouteAxis(blueprint, target) })
}

export const looseConnectionRoute = (blueprint: FactoryBlueprint, loose: LooseConnection): MaterializedRoute => {
  const start = absolutePortPosition(blueprint, loose.origin)
  return start === undefined ? { points: [], spans: [] } : materializeConnectorRoute(start, loose.routeConnectors, portRouteAxis(blueprint, loose.origin))
}

const distanceToSegment = (point: GridPoint, a: GridPoint, b: GridPoint): number => {
  if (a.x === b.x) return Math.abs(point.x - a.x) + Math.max(0, Math.min(a.y, b.y) - point.y, point.y - Math.max(a.y, b.y))
  return Math.abs(point.y - a.y) + Math.max(0, Math.min(a.x, b.x) - point.x, point.x - Math.max(a.x, b.x))
}
export const nearestRouteSpan = (route: MaterializedRoute, point: GridPoint): number => {
  let best = 0; let distance = Number.POSITIVE_INFINITY
  route.spans.forEach((span, spanIndex) => span.slice(1).forEach((end, index) => { const next = distanceToSegment(point, span[index]!, end); if (next < distance) { distance = next; best = spanIndex } }))
  return best
}
