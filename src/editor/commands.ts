import type { GridPoint, IdFactory, NodeId, PortId, RecipeId } from '../domain'
import type { BlueprintEdge, BlueprintNode, ExternalPort, FactoryBlueprint, SubFactoryNode } from './blueprint'
import { findPort, updateBlueprint } from './blueprint'

export interface ChangeSet {
  readonly resources: ReadonlySet<string>
  readonly childContracts: ReadonlySet<string>
  readonly structureChanged: boolean
}
export interface EditResult { readonly blueprint: FactoryBlueprint; readonly changes: ChangeSet }
export interface EditCommand {
  readonly label: string
  readonly affectsCompilation: boolean
  apply(blueprint: FactoryBlueprint): EditResult
}

const changes = (structureChanged = true, resources: readonly string[] = [], childContracts: readonly string[] = []): ChangeSet => ({
  resources: new Set(resources), childContracts: new Set(childContracts), structureChanged,
})
const result = (blueprint: FactoryBlueprint, command: EditCommand, update: Partial<Omit<FactoryBlueprint, 'id' | 'revision'>>, changeSet = changes()): EditResult => ({
  blueprint: updateBlueprint(blueprint, update, command.affectsCompilation), changes: changeSet,
})

export const addNode = (node: BlueprintNode): EditCommand => ({
  label: `Add ${node.name}`, affectsCompilation: true,
  apply(blueprint) {
    if (blueprint.nodes.has(node.id)) throw new Error(`Node ${node.id} already exists`)
    return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(node.id, node) })
  },
})
export const moveNode = (nodeId: NodeId, position: GridPoint): EditCommand => ({
  label: 'Move node', affectsCompilation: true,
  apply(blueprint) {
    const node = blueprint.nodes.get(nodeId)
    if (node === undefined) throw new Error(`Unknown node ${nodeId}`)
    return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(nodeId, { ...node, position }) })
  },
})
export const removeNode = (nodeId: NodeId): EditCommand => ({
  label: 'Remove node', affectsCompilation: true,
  apply(blueprint) {
    if (!blueprint.nodes.has(nodeId)) return { blueprint, changes: changes(false) }
    const nodes = new Map(blueprint.nodes); nodes.delete(nodeId)
    const edges = new Map([...blueprint.edges].filter(([, edge]) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId))
    return result(blueprint, this, { nodes, edges, externalPorts: blueprint.externalPorts.filter((port) => port.nodeId !== nodeId) })
  },
})
export const connectPorts = (edge: BlueprintEdge): EditCommand => ({
  label: 'Connect ports', affectsCompilation: true,
  apply(blueprint) {
    if (blueprint.edges.has(edge.id)) throw new Error(`Edge ${edge.id} already exists`)
    const source = findPort(blueprint, edge.sourceNodeId, edge.sourcePortId)
    const target = findPort(blueprint, edge.targetNodeId, edge.targetPortId)
    if (source?.direction !== 'output' || target?.direction !== 'input') throw new Error('Connections must run from an output to an input')
    if (source.resourceId !== target.resourceId || source.resourceId !== edge.resourceId) throw new Error('Connected ports must transport the same resource')
    return result(blueprint, this, { edges: new Map(blueprint.edges).set(edge.id, edge) }, changes(true, [edge.resourceId]))
  },
})
export const disconnectEdge = (edgeId: BlueprintEdge['id']): EditCommand => ({
  label: 'Disconnect ports', affectsCompilation: true,
  apply(blueprint) {
    const edge = blueprint.edges.get(edgeId)
    if (edge === undefined) return { blueprint, changes: changes(false) }
    const edges = new Map(blueprint.edges); edges.delete(edgeId)
    return result(blueprint, this, { edges }, changes(true, [edge.resourceId]))
  },
})
export const changeConnectionGeometry = (edgeId: BlueprintEdge['id'], points: BlueprintEdge['points']): EditCommand => ({
  label: 'Route connection', affectsCompilation: true,
  apply(blueprint) {
    const edge = blueprint.edges.get(edgeId)
    if (edge === undefined) throw new Error(`Unknown edge ${edgeId}`)
    return result(blueprint, this, { edges: new Map(blueprint.edges).set(edgeId, { ...edge, points }) }, changes(true, [edge.resourceId]))
  },
})
export const changeRecipe = (nodeId: NodeId, recipeId: RecipeId): EditCommand => ({
  label: 'Change recipe', affectsCompilation: true,
  apply(blueprint) {
    const node = blueprint.nodes.get(nodeId)
    if (node?.kind !== 'machine') throw new Error('Only machines have recipes')
    return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(nodeId, { ...node, recipeId }) })
  },
})
export const renameFactory = (name: string): EditCommand => ({
  label: 'Rename factory', affectsCompilation: false,
  apply(blueprint) { return result(blueprint, this, { name }, changes(false)) },
})
export const addExternalPort = (port: ExternalPort): EditCommand => ({ label: 'Add external port', affectsCompilation: true, apply(blueprint) { return result(blueprint, this, { externalPorts: [...blueprint.externalPorts, port] }) } })
export const moveExternalPort = (portId: PortId, side: ExternalPort['side'], offset: number): EditCommand => ({ label: 'Move external port', affectsCompilation: true, apply(blueprint) { return result(blueprint, this, { externalPorts: blueprint.externalPorts.map((port) => port.portId === portId ? { ...port, side, offset } : port) }) } })
export const removeExternalPort = (portId: PortId): EditCommand => ({ label: 'Remove external port', affectsCompilation: true, apply(blueprint) { return result(blueprint, this, { externalPorts: blueprint.externalPorts.filter((port) => port.portId !== portId) }) } })
export const replaceSubFactoryContract = (nodeId: NodeId, contractId: SubFactoryNode['contractId']): EditCommand => ({
  label: 'Update sub-factory', affectsCompilation: true,
  apply(blueprint) {
    const node = blueprint.nodes.get(nodeId)
    if (node?.kind !== 'sub-factory') throw new Error('Node is not a sub-factory')
    return result(blueprint, this, { nodes: new Map(blueprint.nodes).set(nodeId, { ...node, contractId }) }, changes(true, [], [contractId]))
  },
})
export const transaction = (label: string, commands: readonly EditCommand[]): EditCommand => ({
  label, affectsCompilation: commands.some((command) => command.affectsCompilation),
  apply(blueprint) {
    let current = blueprint
    const resources = new Set<string>(); const children = new Set<string>(); let structural = false
    for (const command of commands) {
      const applied = command.apply(current); current = applied.blueprint
      applied.changes.resources.forEach((value) => resources.add(value)); applied.changes.childContracts.forEach((value) => children.add(value)); structural ||= applied.changes.structureChanged
    }
    return { blueprint: current, changes: { resources, childContracts: children, structureChanged: structural } }
  },
})

export const duplicateNodes = (blueprint: FactoryBlueprint, ids: readonly NodeId[], idFactory: IdFactory): EditCommand => {
  const selected = ids.map((id) => blueprint.nodes.get(id)).filter((node): node is BlueprintNode => node !== undefined)
  const copies = selected.map((node) => ({
    ...node,
    id: idFactory.next('NodeId'),
    position: { x: node.position.x + 2, y: node.position.y + 2 },
    ports: node.ports.map((port) => ({ ...port, id: idFactory.next('PortId') })),
  })) as BlueprintNode[]
  return transaction('Duplicate nodes', copies.map(addNode))
}
