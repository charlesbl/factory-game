import type { GridPoint, NetId, RateRaw, ResourceId, TrackId } from '../domain'
import type { CompileDiagnostic } from '../compiler/diagnostics'
import type { FactoryBlueprint, RoutingLayerId } from './blueprint'
import { absolutePortPosition, blueprintNets, blueprintTracks, blueprintTransitions, effectiveTrackPoints } from './blueprint'

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
  const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  const dx = Math.sign(b.x - a.x); const dy = Math.sign(b.y - a.y)
  return Array.from({ length: length + 1 }, (_, index) => ({ x: a.x + dx * index, y: a.y + dy * index }))
}
export const cellsOnTrack = (points: readonly GridPoint[]): readonly GridPoint[] => points.slice(1).flatMap((point, index) => cellsOnSegment(points[index]!, point).slice(index === 0 ? 0 : 1))

export interface DerivedSegment { readonly id: string; readonly trackId: TrackId; readonly layerId: RoutingLayerId; readonly resourceId: ResourceId; readonly capacity: RateRaw; readonly start: GridPoint; readonly end: GridPoint; readonly netIds: readonly NetId[] }
export interface DerivedJunction { readonly id: string; readonly position: GridPoint; readonly layerId: RoutingLayerId; readonly trackIds: readonly TrackId[]; readonly kind: 'merge' | 'split' | 'contact' }
export const derivePhysicalGraph = (blueprint: FactoryBlueprint): { readonly segments: readonly DerivedSegment[]; readonly junctions: readonly DerivedJunction[] } => {
  const segments = [...blueprintTracks(blueprint).values()].sort((a, b) => a.id.localeCompare(b.id)).flatMap((track) => {
    const cells = cellsOnTrack(effectiveTrackPoints(blueprint, track))
    return cells.slice(1).map((end, index) => ({ id: `segment:${track.id}:${index}:${track.layerId}`, trackId: track.id, layerId: track.layerId, resourceId: track.resourceId, capacity: track.capacity, start: cells[index]!, end, netIds: [...track.netIds].sort() }))
  })
  const contacts = new Map<string, Set<TrackId>>()
  for (const track of blueprintTracks(blueprint).values()) for (const point of cellsOnTrack(effectiveTrackPoints(blueprint, track))) { const key = `${track.layerId}:${pointKey(point)}`; const set = contacts.get(key) ?? new Set(); set.add(track.id); contacts.set(key, set) }
  const junctions = [...contacts.entries()].filter(([, ids]) => ids.size > 1).sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => {
    const [layerId, coordinates] = key.split(':') as [RoutingLayerId, string]; const [x, y] = coordinates.split(',').map(Number)
    const trackIds = [...ids].sort(); const endpointCount = trackIds.filter((id) => { const points = effectiveTrackPoints(blueprint, blueprintTracks(blueprint).get(id)!); return samePoint(points[0]!, { x: x!, y: y! }) || samePoint(points.at(-1)!, { x: x!, y: y! }) }).length
    return { id: `junction:${layerId}:${x},${y}:${trackIds.join('+')}`, position: { x: x!, y: y! }, layerId, trackIds, kind: endpointCount > 1 ? 'merge' as const : endpointCount === 1 ? 'split' as const : 'contact' as const }
  })
  return { segments, junctions }
}

const diagnostic = (code: CompileDiagnostic['code'], entity: CompileDiagnostic['entity'], details?: Readonly<Record<string, string>>): CompileDiagnostic => ({ code, severity: 'error', entity, ...(details === undefined ? {} : { details }) })
export const validatePhysicalRouting = (blueprint: FactoryBlueprint): readonly CompileDiagnostic[] => {
  if (blueprint.tracks === undefined && blueprint.nets === undefined) return []
  const diagnostics: CompileDiagnostic[] = []; const nets = blueprintNets(blueprint); const tracks = blueprintTracks(blueprint); const transitions = blueprintTransitions(blueprint)
  for (const net of nets.values()) {
    const attached = [...tracks.values()].filter((track) => track.netIds.includes(net.id))
    if (attached.length === 0) diagnostics.push(diagnostic('UNROUTED_INTENT', { netId: net.id, resourceId: net.resourceId }))
    else {
      const endpoints = attached.flatMap((track) => { const points = effectiveTrackPoints(blueprint, track); return [points[0], points.at(-1)].filter((point): point is GridPoint => point !== undefined) })
      const expected = [absolutePortPosition(blueprint, net.source), ...net.targets.map((target) => absolutePortPosition(blueprint, target))].filter((point): point is GridPoint => point !== undefined)
      if (expected.some((point) => !endpoints.some((endpoint) => samePoint(point, endpoint)))) diagnostics.push(diagnostic('ENDPOINT_DETACHED', { netId: net.id, resourceId: net.resourceId }))
    }
  }
  for (const track of tracks.values()) {
    if (track.netIds.length === 0 || track.netIds.some((id) => !nets.has(id))) diagnostics.push(diagnostic('ORPHANED_TRACK', { trackId: track.id }))
    if (track.capacity <= 0n) diagnostics.push(diagnostic('NON_POSITIVE_CAPACITY', { trackId: track.id }))
    const sharedDemand = track.netIds.reduce((total, id) => total + (nets.get(id)?.requestedCapacity ?? 0n), 0n)
    if (sharedDemand > track.capacity) diagnostics.push({ code: 'SHARED_CAPACITY', severity: 'warning', entity: { trackId: track.id, resourceId: track.resourceId }, details: { demand: sharedDemand.toString(), capacity: track.capacity.toString() } })
    try { if (orthogonalLength(effectiveTrackPoints(blueprint, track)) === 0) diagnostics.push(diagnostic('ZERO_LENGTH', { trackId: track.id })) } catch { diagnostics.push(diagnostic('NON_ORTHOGONAL_TRACK', { trackId: track.id })) }
    const points = effectiveTrackPoints(blueprint, track)
    if (points.some((point, index) => index > 0 && samePoint(point, points[index - 1]!))) diagnostics.push(diagnostic('DUPLICATE_SEGMENT', { trackId: track.id }))
    const ownerNodes = new Set(track.netIds.flatMap((id) => { const net = nets.get(id); return net === undefined ? [] : [net.source.nodeId, ...net.targets.map((target) => target.nodeId)] }))
    let clearanceReported = false
    for (const point of cellsOnTrack(points).slice(1, -1)) for (const node of blueprint.nodes.values()) {
      const rect = { x: node.position.x + node.footprint.x, y: node.position.y + node.footprint.y, width: node.footprint.width, height: node.footprint.height }
      if (inside(point, rect)) { diagnostics.push(diagnostic('MACHINE_KEEPOUT', { trackId: track.id, nodeId: node.id }, { x: String(point.x), y: String(point.y) })); break }
      if (!clearanceReported && !ownerNodes.has(node.id) && inside(point, rect, 1)) { diagnostics.push(diagnostic('INSUFFICIENT_CLEARANCE', { trackId: track.id, nodeId: node.id }, { x: String(point.x), y: String(point.y) })); clearanceReported = true }
    }
  }
  const trackList = [...tracks.values()].sort((a, b) => a.id.localeCompare(b.id))
  for (let left = 0; left < trackList.length; left += 1) for (let right = left + 1; right < trackList.length; right += 1) {
    const a = trackList[left]!; const b = trackList[right]!; if (a.layerId !== b.layerId) continue
    const bCells = new Set(cellsOnTrack(effectiveTrackPoints(blueprint, b)).map(pointKey)); const contact = cellsOnTrack(effectiveTrackPoints(blueprint, a)).find((point) => bCells.has(pointKey(point)))
    if (contact !== undefined && a.resourceId !== b.resourceId) diagnostics.push(diagnostic('ILLEGAL_CROSSING', { trackId: a.id }, { otherTrackId: b.id, x: String(contact.x), y: String(contact.y) }))
  }
  for (const transition of transitions.values()) {
    if (transition.entryLayerId === transition.exitLayerId || transition.capacity <= 0n) diagnostics.push(diagnostic('INVALID_TRANSITION', { transitionId: transition.id }))
    const transitionTracks = [...tracks.values()].filter((track) => track.netIds.some((id) => transition.netIds.includes(id)) && (track.layerId === transition.entryLayerId || track.layerId === transition.exitLayerId))
    const touchesLayers = new Set(transitionTracks.filter((track) => { const points = effectiveTrackPoints(blueprint, track); return points[0] !== undefined && (samePoint(points[0], transition.position) || (points.at(-1) !== undefined && samePoint(points.at(-1)!, transition.position))) }).map((track) => track.layerId))
    if (!touchesLayers.has(transition.entryLayerId) || !touchesLayers.has(transition.exitLayerId) || transition.netIds.some((id) => nets.get(id)?.resourceId !== transition.resourceId)) diagnostics.push(diagnostic('INVALID_TRANSITION', { transitionId: transition.id }))
    const netDemand = transition.netIds.reduce((total, id) => total + (nets.get(id)?.requestedCapacity ?? 0n), 0n)
    if (netDemand > transition.capacity) diagnostics.push({ code: 'TRANSITION_CAPACITY', severity: 'warning', entity: { transitionId: transition.id }, details: { demand: netDemand.toString(), capacity: transition.capacity.toString() } })
  }
  return diagnostics
}
