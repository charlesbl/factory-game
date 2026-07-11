import { describe, expect, it } from 'vitest';
import { asId } from '../domain';
import type {
  ContractId,
  EdgeId,
  FactoryId,
  NodeId,
  PortId,
  ResourceId,
} from '../domain';
import { createBoundaryNode } from '../ui/demo-blueprint';
import type {
  BlueprintEdge,
  BlueprintNode,
  FactoryBlueprint,
  SubFactoryNode,
  SubFactoryPort,
} from './blueprint';
import { createBlueprint } from './blueprint';
import { replaceSubFactoryVersion } from './commands';

const factoryId = asId<FactoryId>('child-factory');
const subPort = (
  id: string,
  contractPortId: string,
  direction: 'input' | 'output' = 'input',
): SubFactoryPort => ({
  id: asId<PortId>(id),
  contractPortId: asId<PortId>(contractPortId),
  direction,
  resourceId: asId<ResourceId>('ironOre'),
  capacity: 2n,
  anchor: { x: direction === 'input' ? 0 : 4, y: 1 },
});
const subNode = (
  version: number,
  ports: readonly SubFactoryPort[],
): SubFactoryNode => ({
  id: asId<NodeId>('sub-node'),
  kind: 'sub-factory',
  name: 'Child',
  factoryId,
  version,
  contractId: asId<ContractId>(`contract-${version}`),
  position: { x: 8, y: 2 },
  footprint: { x: 0, y: 0, width: 4, height: 3 },
  ports,
});
const connected = (): {
  readonly blueprint: FactoryBlueprint;
  readonly edge: BlueprintEdge;
} => {
  const source = createBoundaryNode(
    asId<NodeId>('source-node'),
    asId<PortId>('source-port'),
    'external-input',
    asId<ResourceId>('ironOre'),
    0,
    2,
  );
  const child = subNode(1, [subPort('placed-input', 'contract-input')]);
  const edge: BlueprintEdge = {
    id: asId<EdgeId>('edge-child'),
    sourceNodeId: source.id,
    sourcePortId: source.ports[0]!.id,
    targetNodeId: child.id,
    targetPortId: child.ports[0]!.id,
    routeHandles: [],
    bridges: [],
  };
  const base = createBlueprint(asId<FactoryId>('parent-factory'));
  return {
    blueprint: {
      ...base,
      nodes: new Map<NodeId, BlueprintNode>([
        [source.id, source],
        [child.id, child],
      ]),
      edges: new Map([[edge.id, edge]]),
    },
    edge,
  };
};

describe('sub-factory version replacement', () => {
  it('preserves a compatible placed port and its route', () => {
    const { blueprint, edge } = connected();
    const replacement = subNode(2, [
      subPort('generated-v2-input', 'contract-input'),
    ]);
    const result = replaceSubFactoryVersion(replacement.id, replacement).apply(
      blueprint,
    ).blueprint;
    expect(result.edges.get(edge.id)?.targetPortId).toBe(
      asId<PortId>('placed-input'),
    );
    expect((result.nodes.get(replacement.id) as SubFactoryNode).version).toBe(
      2,
    );
    expect(result.looseConnections.size).toBe(0);
  });

  it('turns an incompatible route into a persistent loose route', () => {
    const { blueprint, edge } = connected();
    const replacement = subNode(2, [
      subPort('generated-output', 'contract-output', 'output'),
    ]);
    const result = replaceSubFactoryVersion(replacement.id, replacement).apply(
      blueprint,
    ).blueprint;
    expect(result.edges.has(edge.id)).toBe(false);
    expect(result.looseConnections.size).toBe(1);
    expect([...result.looseConnections.values()][0]?.origin.nodeId).toBe(
      asId<NodeId>('source-node'),
    );
  });
});
