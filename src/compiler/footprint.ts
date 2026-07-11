import type { EdgeId, GridPoint, GridRect, RateRaw } from '../domain';
import type { FactoryBlueprint } from '../editor';
import type { CompiledPort, FactoryContract } from './contract';

export interface ProjectedBoundaryPort extends CompiledPort {
  readonly nodeId: string;
  readonly direction: 'input' | 'output';
  readonly side: 'top' | 'right' | 'bottom' | 'left';
}
export const projectExternalPorts = (
  blueprint: FactoryBlueprint,
  footprint: GridRect,
  edgeFlows?: ReadonlyMap<EdgeId, RateRaw>,
): readonly ProjectedBoundaryPort[] => {
  const occupied = new Set<string>();
  return [...blueprint.externalPorts]
    .sort(
      (a, b) =>
        a.side.localeCompare(b.side) ||
        a.offset - b.offset ||
        a.portId.localeCompare(b.portId),
    )
    .flatMap((external) => {
      const node = blueprint.nodes.get(external.nodeId);
      if (node?.kind !== 'external-input' && node?.kind !== 'external-output')
        return [];
      const port = node.ports.find((item) => item.id === external.portId);
      if (port === undefined) return [];
      const limit =
        external.side === 'left' || external.side === 'right'
          ? footprint.height
          : footprint.width;
      let offset = Math.max(0, Math.min(limit - 1, external.offset));
      while (occupied.has(`${external.side}:${offset}`) && offset < limit - 1)
        offset += 1;
      while (occupied.has(`${external.side}:${offset}`) && offset > 0)
        offset -= 1;
      occupied.add(`${external.side}:${offset}`);
      const positions: Record<typeof external.side, GridPoint> = {
        left: { x: footprint.x, y: footprint.y + offset },
        right: {
          x: footprint.x + footprint.width - 1,
          y: footprint.y + offset,
        },
        top: { x: footprint.x + offset, y: footprint.y },
        bottom: {
          x: footprint.x + offset,
          y: footprint.y + footprint.height - 1,
        },
      };
      const direction = node.kind === 'external-input' ? 'input' : 'output';
      const rate =
        edgeFlows === undefined
          ? undefined
          : [...blueprint.edges.values()]
              .filter((edge) =>
                direction === 'input'
                  ? edge.sourceNodeId === node.id &&
                    edge.sourcePortId === port.id
                  : edge.targetNodeId === node.id &&
                    edge.targetPortId === port.id,
              )
              .reduce(
                (total, edge) => total + (edgeFlows.get(edge.id) ?? 0n),
                0n,
              );
      return [
        {
          nodeId: node.id,
          direction,
          side: external.side,
          portId: port.id,
          resourceId: port.resourceId,
          capacity: port.capacity,
          position: positions[external.side],
          ...(rate === undefined ? {} : { rate }),
        },
      ];
    });
};

export const hydrateBoundaryPortRates = (
  blueprint: FactoryBlueprint,
  contract: FactoryContract,
): FactoryContract => {
  if (
    [...contract.inputPorts, ...contract.outputPorts].every(
      (port) => port.rate !== undefined,
    )
  )
    return contract;
  const ports = projectExternalPorts(
    blueprint,
    contract.footprint,
    contract.edgeFlows,
  );
  return {
    ...contract,
    inputPorts: ports.filter((port) => port.direction === 'input'),
    outputPorts: ports.filter((port) => port.direction === 'output'),
  };
};
