import type { GridPoint, GridRect } from '../domain'
import type { FactoryBlueprint } from '../editor'
import type { CompiledPort } from './contract'

export interface ProjectedBoundaryPort extends CompiledPort { readonly nodeId: string; readonly direction: 'input' | 'output'; readonly side: 'top' | 'right' | 'bottom' | 'left' }
export const projectExternalPorts = (blueprint: FactoryBlueprint, footprint: GridRect): readonly ProjectedBoundaryPort[] => {
  const occupied = new Set<string>()
  return [...blueprint.externalPorts].sort((a, b) => a.side.localeCompare(b.side) || a.offset - b.offset || a.portId.localeCompare(b.portId)).flatMap((external) => {
    const node = blueprint.nodes.get(external.nodeId); const port = node?.ports.find((item) => item.id === external.portId); if (node === undefined || port === undefined) return []
    const limit = external.side === 'left' || external.side === 'right' ? footprint.height : footprint.width
    let offset = Math.max(0, Math.min(limit - 1, external.offset))
    while (occupied.has(`${external.side}:${offset}`) && offset < limit - 1) offset += 1
    while (occupied.has(`${external.side}:${offset}`) && offset > 0) offset -= 1
    occupied.add(`${external.side}:${offset}`)
    const positions: Record<typeof external.side, GridPoint> = {
      left: { x: footprint.x, y: footprint.y + offset }, right: { x: footprint.x + footprint.width - 1, y: footprint.y + offset },
      top: { x: footprint.x + offset, y: footprint.y }, bottom: { x: footprint.x + offset, y: footprint.y + footprint.height - 1 },
    }
    return [{ nodeId: node.id, direction: node.kind === 'external-input' ? 'input' : 'output', side: external.side, portId: port.id, resourceId: port.resourceId, capacity: port.capacity, position: positions[external.side] }]
  })
}
