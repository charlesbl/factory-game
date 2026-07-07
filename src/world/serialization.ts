import { asId, gridPoint, parseExact, stringifyExact } from '../domain'
import type { FactoryId, GridPoint, InstanceId, ResourceId, StationId, WorldEntityId, WorldId } from '../domain'
import type { SerializedPodTrafficState } from '../logistics'
import type { SerializedFactoryContract } from '../compiler'
import type { InstanceSnapshot } from '../simulation'
import type { GeneratedWorld, SerializedGeneratedWorld, WorldEntity, WorldRailEdge, WorldRailNode, WorldSnapshot } from './model'
import { deserializeGeneratedWorld, serializeGeneratedWorld } from './generation'
import { WorldRuntime, type ConstructionTargetRecord, type SerializedMineRecord, type SerializedStorageRecord } from './runtime'
import type { SerializedWorldEventQueue } from './scheduler'

interface SerializedConstructionTarget extends Omit<ConstructionTargetRecord, 'siteId'> { readonly siteId: string }
export interface SerializedWorldState {
  readonly schemaVersion: 2
  readonly generated: SerializedGeneratedWorld
  readonly revision: number
  readonly logicalTime: string
  readonly paused: boolean
  readonly timeScale: 1 | 5 | 20
  readonly entities: readonly WorldEntity[]
  readonly entitySlots: readonly { readonly entityId: string; readonly slot: number }[]
  readonly nextEntitySlot: number
  readonly railSequence: number
  readonly railNodes: readonly WorldRailNode[]
  readonly railEdges: readonly WorldRailEdge[]
  readonly railBlocks: readonly { readonly id: string; readonly edgeId: string; readonly occupantId?: string; readonly reservedById?: string }[]
  readonly traffic: SerializedPodTrafficState
  readonly eventQueue: SerializedWorldEventQueue
  readonly constructionTargets: readonly SerializedConstructionTarget[]
  readonly mines: readonly SerializedMineRecord[]
  readonly factories: readonly { readonly entityId: string; readonly contract: SerializedFactoryContract; readonly instance: InstanceSnapshot }[]
  readonly storages: readonly SerializedStorageRecord[]
}

export const serializeWorldRuntime = (runtime: WorldRuntime): SerializedWorldState => ({
  schemaVersion: 2, generated: serializeGeneratedWorld(runtime.world), revision: runtime.revision, logicalTime: runtime.logicalTime.toString(), paused: runtime.paused, timeScale: runtime.timeScale,
  entities: [...runtime.entities.values()].sort((a, b) => a.id.localeCompare(b.id)), entitySlots: runtime.entitySlotRecords(), nextEntitySlot: runtime.nextEntitySlot, railSequence: runtime.railSequence,
  railNodes: [...runtime.railNodes.values()].sort((a, b) => a.id.localeCompare(b.id)), railEdges: [...runtime.railEdges.values()].sort((a, b) => a.id.localeCompare(b.id)), railBlocks: [...runtime.rails.blocks.values()].sort((a, b) => a.id.localeCompare(b.id)).map((block) => ({ ...block })),
  traffic: runtime.traffic.serialize(), eventQueue: runtime.eventQueue.serialize(), constructionTargets: [...runtime.constructionTargets.values()].sort((a, b) => a.siteId.localeCompare(b.siteId)).map((target) => ({ ...target, siteId: target.siteId })), mines: runtime.mineRecords(), factories: runtime.factoryRecords(), storages: runtime.storageRecords(),
})

export const deserializeWorldRuntime = (state: SerializedWorldState): WorldRuntime => {
  if (typeof state !== 'object' || state === null || state.schemaVersion !== 2 || !Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.logicalTime !== 'string' || !/^\d+$/.test(state.logicalTime) || typeof state.paused !== 'boolean' || ![1, 5, 20].includes(state.timeScale) || !Array.isArray(state.entities) || !Array.isArray(state.entitySlots) || !Number.isSafeInteger(state.nextEntitySlot) || !Number.isSafeInteger(state.railSequence) || !Array.isArray(state.railNodes) || !Array.isArray(state.railEdges) || !Array.isArray(state.railBlocks) || state.traffic === undefined || state.eventQueue === undefined || !Array.isArray(state.constructionTargets) || !Array.isArray(state.mines) || !Array.isArray(state.factories) || !Array.isArray(state.storages)) throw new Error('Unsupported or corrupt world state: expected schema 2')
  const runtime = new WorldRuntime(deserializeGeneratedWorld(state.generated))
  for (const node of state.railNodes) runtime.addRailNode({ ...node, id: asId(node.id), position: gridPoint(node.position.x, node.position.y) })
  for (const edge of state.railEdges) runtime.addRailEdge({ ...edge, id: asId(edge.id), from: asId(edge.from), to: asId(edge.to), points: edge.points.map((point: GridPoint) => gridPoint(point.x, point.y)) })
  for (const saved of state.railBlocks) { const block = runtime.rails.blocks.get(saved.id); if (block === undefined || block.edgeId !== saved.edgeId) throw new Error('Saved rail block does not match topology'); if (saved.occupantId !== undefined) block.occupantId = saved.occupantId; if (saved.reservedById !== undefined) block.reservedById = saved.reservedById }
  runtime.restoreEntities(state.entities.map((entity) => ({ ...entity, id: asId<WorldEntityId>(entity.id) }) as WorldEntity), state.entitySlots.map((record) => ({ entityId: asId<WorldEntityId>(record.entityId), slot: record.slot })), state.nextEntitySlot)
  runtime.restoreTraffic(state.traffic); runtime.restoreRailSequence(state.railSequence); runtime.restoreMines(state.mines); runtime.restoreStorages(state.storages); runtime.restoreFactories(state.factories); runtime.restoreEventQueue(state.eventQueue)
  for (const target of state.constructionTargets) runtime.constructionTargets.set(asId<WorldEntityId>(target.siteId), { ...target, siteId: asId<WorldEntityId>(target.siteId), stationId: asId<StationId>(target.stationId), ...(target.factoryId === undefined ? {} : { factoryId: asId<FactoryId>(target.factoryId) }), ...(target.instanceId === undefined ? {} : { instanceId: asId<InstanceId>(target.instanceId) }), ...(target.resourceId === undefined ? {} : { resourceId: asId<ResourceId>(target.resourceId) }) })
  runtime.logicalTime = BigInt(state.logicalTime); runtime.paused = state.paused; runtime.timeScale = state.timeScale; runtime.revision = state.revision; return runtime
}

export const stringifyWorldRuntime = (runtime: WorldRuntime): string => stringifyExact(serializeWorldRuntime(runtime))
export const parseWorldRuntime = (raw: string): WorldRuntime => deserializeWorldRuntime(parseExact<SerializedWorldState>(raw))
export const generatedFromSnapshot = (snapshot: WorldSnapshot, source: GeneratedWorld): GeneratedWorld => ({ ...source, id: asId<WorldId>(snapshot.worldId), grid: snapshot.grid })
