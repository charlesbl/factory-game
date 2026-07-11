import {
  asId,
  gridPoint,
  parseRate,
  recipeById,
  resourceById,
} from '../domain';
import type {
  EdgeId,
  FactoryId,
  NodeId,
  PortId,
  RecipeId,
  ResourceId,
} from '../domain';
import type {
  BlueprintEdge,
  BlueprintNode,
  BlueprintPort,
  FactoryBlueprint,
} from '../editor';

const port = (
  id: string,
  direction: 'input' | 'output',
  resourceId: string,
  capacity: string,
  x: number,
  y: number,
): BlueprintPort => ({
  id: asId<PortId>(id),
  direction,
  resourceId: asId<ResourceId>(resourceId),
  capacity: parseRate(capacity),
  anchor: gridPoint(x, y),
});
const rect = (width: number, height: number) => ({ x: 0, y: 0, width, height });

export const machinePorts = (
  recipeId: RecipeId,
  prefix: string,
): readonly BlueprintPort[] => {
  const recipe = recipeById.get(recipeId);
  if (recipe === undefined) throw new Error(`Unknown recipe ${recipeId}`);
  return [
    ...recipe.inputs.map((input, index) =>
      port(
        `${prefix}-in-${index}`,
        'input',
        input.resourceId,
        (input.rate * 2n).toString().replace(/000000$/, ''),
        0,
        index + 1,
      ),
    ),
    ...recipe.outputs.map((output, index) =>
      port(
        `${prefix}-out-${index}`,
        'output',
        output.resourceId,
        (output.rate * 2n).toString().replace(/000000$/, ''),
        4,
        index + 1,
      ),
    ),
  ];
};

export const createDemoBlueprint = (): FactoryBlueprint => {
  const input = createBoundaryNode(
    asId<NodeId>('node-iron-input'),
    asId<PortId>('port-iron-source'),
    'external-input',
    asId<ResourceId>('ironOre'),
    0,
    4,
  );
  const furnace = createMachineNode(
    asId<NodeId>('node-furnace'),
    asId<RecipeId>('ironIngot'),
    7,
    3,
  );
  const output = createBoundaryNode(
    asId<NodeId>('node-iron-output'),
    asId<PortId>('port-ingot-target'),
    'external-output',
    asId<ResourceId>('ironIngot'),
    16,
    4,
    '4',
  );
  const oreEdge: BlueprintEdge = {
    id: asId<EdgeId>('edge-ore'),
    sourceNodeId: input.id,
    sourcePortId: input.ports[0]!.id,
    targetNodeId: furnace.id,
    targetPortId: furnace.ports[0]!.id,
    routeHandles: [
      { id: asId('edge-ore-handle-1'), position: gridPoint(6, 5) },
    ],
    bridges: [],
  };
  const ingotEdge: BlueprintEdge = {
    id: asId<EdgeId>('edge-ingot'),
    sourceNodeId: furnace.id,
    sourcePortId: furnace.ports[1]!.id,
    targetNodeId: output.id,
    targetPortId: output.ports[0]!.id,
    routeHandles: [
      { id: asId('edge-ingot-handle-1'), position: gridPoint(13, 4) },
    ],
    bridges: [],
  };
  return {
    id: asId<FactoryId>('factory-main'),
    revision: 0,
    nodes: new Map<NodeId, BlueprintNode>([
      [input.id, input],
      [furnace.id, furnace],
      [output.id, output],
    ]),
    edges: new Map([
      [oreEdge.id, oreEdge],
      [ingotEdge.id, ingotEdge],
    ]),
    looseConnections: new Map(),
    externalPorts: [
      { nodeId: input.id, portId: input.ports[0]!.id, side: 'left', offset: 1 },
      {
        nodeId: output.id,
        portId: output.ports[0]!.id,
        side: 'right',
        offset: 1,
      },
    ],
  };
};

export const createMachineNode = (
  id: NodeId,
  recipeId: RecipeId,
  x: number,
  y: number,
): BlueprintNode => {
  const recipe = recipeById.get(recipeId);
  if (recipe === undefined) throw new Error(`Unknown recipe ${recipeId}`);
  return {
    id,
    kind: 'machine',
    name: recipe.name,
    position: gridPoint(x, y),
    footprint: rect(4, Math.max(3, recipe.inputs.length + 1)),
    recipeId,
    ports: machinePorts(recipeId, id),
  };
};

export const createBoundaryNode = (
  id: NodeId,
  portId: PortId,
  kind: 'external-input' | 'external-output',
  resourceId: ResourceId,
  x: number,
  y: number,
  capacity = '6',
): BlueprintNode => {
  const output = kind === 'external-input';
  const resource = resourceById.get(resourceId);
  return {
    id,
    kind,
    name: `${resource?.name ?? resourceId} ${output ? 'intake' : 'dispatch'}`,
    position: gridPoint(x, y),
    footprint: rect(4, 2),
    ports: [
      port(
        portId,
        output ? 'output' : 'input',
        resourceId,
        capacity,
        output ? 4 : 0,
        1,
      ),
    ],
  };
};
