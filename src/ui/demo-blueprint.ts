import { asId, gridPoint, parseRate, recipeById } from '../domain'
import type { EdgeId, FactoryId, NodeId, PortId, RecipeId, ResourceId } from '../domain'
import type { BlueprintEdge, BlueprintNode, BlueprintPort, FactoryBlueprint } from '../editor'

const port = (id: string, direction: 'input' | 'output', resourceId: string, capacity: string, x: number, y: number): BlueprintPort => ({
  id: asId<PortId>(id), direction, resourceId: asId<ResourceId>(resourceId), capacity: parseRate(capacity), anchor: gridPoint(x, y), maxConnections: direction === 'output' ? 8 : 1,
})
const rect = (width: number, height: number) => ({ x: 0, y: 0, width, height })

export const machinePorts = (recipeId: RecipeId, prefix: string): readonly BlueprintPort[] => {
  const recipe = recipeById.get(recipeId)
  if (recipe === undefined) throw new Error(`Unknown recipe ${recipeId}`)
  return [
    ...recipe.inputs.map((input, index) => port(`${prefix}-in-${index}`, 'input', input.resourceId, (input.rate * 2n).toString().replace(/000000$/, ''), 0, index + 1)),
    ...recipe.outputs.map((output, index) => port(`${prefix}-out-${index}`, 'output', output.resourceId, (output.rate * 2n).toString().replace(/000000$/, ''), 4, index + 1)),
  ]
}

export const createDemoBlueprint = (): FactoryBlueprint => {
  const input: BlueprintNode = { id: asId<NodeId>('node-iron-input'), kind: 'external-input', name: 'Iron ore intake', position: gridPoint(0, 4), footprint: rect(2, 2), ports: [port('port-iron-source', 'output', 'ironOre', '6', 2, 1)] }
  const furnace: BlueprintNode = { id: asId<NodeId>('node-furnace'), kind: 'machine', name: 'Iron furnace', position: gridPoint(7, 3), footprint: rect(4, 3), recipeId: asId<RecipeId>('ironIngot'), ports: [port('port-furnace-in', 'input', 'ironOre', '6', 0, 1), port('port-furnace-out', 'output', 'ironIngot', '4', 4, 1)] }
  const output: BlueprintNode = { id: asId<NodeId>('node-iron-output'), kind: 'external-output', name: 'Ingot dispatch', position: gridPoint(16, 4), footprint: rect(2, 2), ports: [port('port-ingot-target', 'input', 'ironIngot', '4', 0, 1)] }
  const oreEdge: BlueprintEdge = { id: asId<EdgeId>('edge-ore'), sourceNodeId: input.id, sourcePortId: input.ports[0]!.id, targetNodeId: furnace.id, targetPortId: furnace.ports[0]!.id, resourceId: asId<ResourceId>('ironOre'), capacity: parseRate('6'), points: [gridPoint(2, 5), gridPoint(7, 5)] }
  const ingotEdge: BlueprintEdge = { id: asId<EdgeId>('edge-ingot'), sourceNodeId: furnace.id, sourcePortId: furnace.ports[1]!.id, targetNodeId: output.id, targetPortId: output.ports[0]!.id, resourceId: asId<ResourceId>('ironIngot'), capacity: parseRate('4'), points: [gridPoint(11, 5), gridPoint(16, 5)] }
  return { id: asId<FactoryId>('factory-main'), revision: 0, name: 'Copperleaf works', nodes: new Map<NodeId, BlueprintNode>([[input.id, input], [furnace.id, furnace], [output.id, output]]), edges: new Map([[oreEdge.id, oreEdge], [ingotEdge.id, ingotEdge]]), externalPorts: [{ nodeId: input.id, portId: input.ports[0]!.id, side: 'left', offset: 1 }, { nodeId: output.id, portId: output.ports[0]!.id, side: 'right', offset: 1 }] }
}

export const createMachineNode = (id: NodeId, recipeId: RecipeId, x: number, y: number): BlueprintNode => {
  const recipe = recipeById.get(recipeId); if (recipe === undefined) throw new Error(`Unknown recipe ${recipeId}`)
  return { id, kind: 'machine', name: recipe.name, position: gridPoint(x, y), footprint: rect(4, Math.max(3, recipe.inputs.length + 1)), recipeId, ports: machinePorts(recipeId, id) }
}
