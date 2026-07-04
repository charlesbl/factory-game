import type { FactoryContract } from '../compiler'
import { asId } from '../domain'
import type { ContractId, FactoryId, NodeId, PortId } from '../domain'
import type { FactoryDefinition } from './model'
import type { SubFactoryNode, SubFactoryPort } from '../editor'

export const materializeSubFactoryNode = (
  nodeId: NodeId,
  definition: FactoryDefinition,
  version: number,
  contract: FactoryContract,
  position: { readonly x: number; readonly y: number },
): SubFactoryNode => {
  const width = contract.footprint.width + 2; const height = contract.footprint.height + 2
  const makePort = (port: FactoryContract['inputPorts'][number], direction: 'input' | 'output'): SubFactoryPort => ({
    id: asId<PortId>(`${nodeId}:${port.portId}`), contractPortId: port.portId, direction, resourceId: port.resourceId, capacity: port.capacity,
    anchor: {
      x: direction === 'input' ? 0 : width,
      y: Math.max(1, Math.min(height - 1, port.position.y - contract.footprint.y + 1)),
    },
  })
  return {
    id: nodeId, kind: 'sub-factory', name: definition.name, factoryId: definition.id as FactoryId, version,
    contractId: asId<ContractId>(contract.blueprintHash), position, footprint: { x: 0, y: 0, width, height },
    ports: [...contract.inputPorts.map((port) => makePort(port, 'input')), ...contract.outputPorts.map((port) => makePort(port, 'output'))],
  }
}
