import type {
  ConstructionSiteId, DeliveryId, FactoryId, GridPoint, GridSize, InstanceId, PodId,
  RailBlockId, RailEdgeId, RailNodeId, ResourceId, SimTime, StationId, WorldEntityId, WorldId,
} from '../domain'

export const WORLD_SCHEMA_VERSION = 1 as const
export const WORLD_GENERATOR_VERSION = 1 as const
export const DEFAULT_WORLD_SIZE = 256
export const MAX_OCCUPANCY_SLOT = 0x7fffffff
export const MAX_ORE_PER_TILE = 0xffffffff

export const enum TerrainKind { BUILDABLE = 0, OBSTACLE = 1 }
export const enum OreKind { NONE = 0, IRON = 1, COPPER = 2 }
export type QuarterTurn = 0 | 1 | 2 | 3

export interface WorldGenerationConfig {
  readonly schemaVersion: 1
  readonly generatorVersion: 1
  readonly seed: string
  readonly width: number
  readonly height: number
  readonly spawnClearingSize: number
  readonly patchesPerResource: number
  readonly orePerTile: number
}

export const defaultWorldGenerationConfig = (seed = 'starter-world'): WorldGenerationConfig => ({
  schemaVersion: WORLD_SCHEMA_VERSION,
  generatorVersion: WORLD_GENERATOR_VERSION,
  seed,
  width: DEFAULT_WORLD_SIZE,
  height: DEFAULT_WORLD_SIZE,
  spawnClearingSize: 32,
  patchesPerResource: 3,
  orePerTile: 100,
})

export interface WorldGrid {
  readonly width: number
  readonly height: number
  readonly terrain: Uint8Array
  readonly oreKinds: Uint8Array
  readonly oreRemaining: Uint32Array
  readonly occupancy: Int32Array
}

export interface GeneratedWorld {
  readonly schemaVersion: 1
  readonly id: WorldId
  readonly config: WorldGenerationConfig
  readonly spawn: GridPoint
  readonly grid: WorldGrid
}

export interface SerializedGeneratedWorld {
  readonly schemaVersion: 1
  readonly id: string
  readonly config: WorldGenerationConfig
  readonly spawn: GridPoint
  readonly terrain: readonly number[]
  readonly oreKinds: readonly number[]
  readonly oreRemaining: readonly number[]
  readonly occupancy: readonly number[]
}

export interface WorldTransform { readonly position: GridPoint; readonly size: GridSize; readonly rotation: QuarterTurn }
export interface WorldItemStack { readonly resourceId: ResourceId; readonly quantity: number }
export interface WorldInventory { readonly capacity: number; readonly items: readonly WorldItemStack[] }

interface EntityBase { readonly id: WorldEntityId; readonly transform: WorldTransform; readonly createdAt: SimTime }
export interface FactoryWorldEntity extends EntityBase {
  readonly kind: 'factory'; readonly factoryId: FactoryId; readonly instanceId: InstanceId; readonly stationId: StationId; readonly state: 'CONSTRUCTING' | 'ACTIVE' | 'DISMANTLING'
}
export interface MineWorldEntity extends EntityBase {
  readonly kind: 'mine'; readonly stationId: StationId; readonly resourceId: ResourceId; readonly constructionBuffer: WorldInventory; readonly salvageBuffer: WorldInventory
}
export interface DrillWorldEntity extends EntityBase {
  readonly kind: 'drill'; readonly mineId: WorldEntityId; readonly resourceId: ResourceId; readonly state: 'GHOST' | 'ACTIVE' | 'EXHAUSTED'; readonly placedAt: SimTime
}
export interface StationWorldEntity extends EntityBase { readonly kind: 'station'; readonly stationId: StationId; readonly linkedEntityId?: WorldEntityId; readonly railNodeId: RailNodeId }
export interface StorageWorldEntity extends EntityBase { readonly kind: 'storage'; readonly stationId: StationId; readonly inventory: WorldInventory; readonly limits: readonly StorageLimit[] }
export interface DepotWorldEntity extends EntityBase { readonly kind: 'depot'; readonly railNodeId: RailNodeId; readonly podCapacity: number; readonly podIds: readonly PodId[] }
export interface ConstructionSiteWorldEntity extends EntityBase {
  readonly kind: 'construction-site'; readonly siteId: ConstructionSiteId; readonly targetKind: 'factory' | 'mine' | 'storage' | 'depot'; readonly stationId: StationId; readonly required: readonly WorldItemStack[]; readonly delivered: readonly WorldItemStack[]; readonly state: 'WAITING' | 'READY' | 'CANCELLED' | 'EVACUATING'
}
export type WorldEntity = FactoryWorldEntity | MineWorldEntity | DrillWorldEntity | StationWorldEntity | StorageWorldEntity | DepotWorldEntity | ConstructionSiteWorldEntity

export interface StorageLimit { readonly resourceId: ResourceId; readonly maximum: number }
export interface StationRule {
  readonly resourceId: ResourceId
  readonly mode: 'request' | 'provide'
  readonly target: number
  readonly minBatch: number
  readonly maxBatch: number
  readonly priority: number
  readonly createdAt: SimTime
}

export interface WorldRailNode { readonly id: RailNodeId; readonly position: GridPoint; readonly kind: 'endpoint' | 'junction' | 'station' | 'depot' }
export interface WorldRailEdge { readonly id: RailEdgeId; readonly from: RailNodeId; readonly to: RailNodeId; readonly points: readonly GridPoint[]; readonly length: number }
export interface WorldRailBlock { readonly id: RailBlockId; readonly edgeId: RailEdgeId; readonly occupantId?: PodId; readonly reservedById?: PodId }
export interface PodMotion { readonly from: GridPoint; readonly to: GridPoint; readonly startsAt: SimTime; readonly endsAt: SimTime }
export type PodState = 'IDLE' | 'TO_PROVIDER' | 'LOADING' | 'TO_REQUESTER' | 'UNLOADING' | 'DESTINATION_BLOCKED' | 'TO_DEPOT' | 'WAITING_BLOCK' | 'WAITING_BERTH' | 'GRIDLOCKED'
export interface WorldPod { readonly id: PodId; readonly capacity: 10; readonly state: PodState; readonly nodeId: RailNodeId; readonly cargo?: WorldItemStack; readonly missionId?: DeliveryId; readonly motion?: PodMotion }
export interface PodMission { readonly id: DeliveryId; readonly providerId: StationId; readonly requesterId: StationId; readonly podId: PodId; readonly resourceId: ResourceId; readonly quantity: number; readonly routeEdgeIds: readonly RailEdgeId[]; readonly createdAt: SimTime }
export interface WorldDiagnostic { readonly code: 'GRIDLOCK' | 'DESTINATION_BLOCKED' | 'NO_ROUTE' | 'NO_STORAGE'; readonly entityIds: readonly string[]; readonly message: string }
export type WorldTool = 'select' | 'rail' | 'rail-erase' | 'junction' | 'station' | 'factory' | 'mine' | 'drill' | 'storage' | 'depot'
export interface WorldValidationResult { readonly valid: boolean; readonly reason?: 'OUT_OF_BOUNDS' | 'OBSTACLE' | 'OCCUPIED' | 'INVALID_TRANSFORM' | 'ORE_MISMATCH' | 'MISSING_STATION' | 'STATION_IN_USE' | 'NOT_ORTHOGONAL' | 'NOT_CONNECTED' }
export interface WorldStationSnapshot { readonly id: string; readonly railNodeId: RailNodeId; readonly role: 'provider' | 'requester' | 'depot'; readonly resourceId?: ResourceId; readonly quantity?: number; readonly capacity?: number; readonly target: number; readonly priority: number; readonly berthPodId?: PodId }

export interface WorldBufferSnapshot extends WorldItemStack { readonly capacity: number }
export interface WorldFactoryBufferSnapshot extends WorldBufferSnapshot { readonly wipPercent: number }
export type WorldBuildingSnapshot =
  | { readonly entityId: WorldEntityId; readonly kind: 'factory'; readonly state: 'RUNNING' | 'WAITING_INPUT' | 'OUTPUT_BLOCKED' | 'PAUSED' | 'INVALID' | 'MAINTENANCE'; readonly inputs: readonly WorldFactoryBufferSnapshot[]; readonly outputs: readonly WorldFactoryBufferSnapshot[]; readonly nextEventAt?: SimTime }
  | { readonly entityId: WorldEntityId; readonly kind: 'storage'; readonly inventory: WorldInventory }
  | { readonly entityId: WorldEntityId; readonly kind: 'mine'; readonly output: WorldBufferSnapshot; readonly construction: WorldInventory; readonly salvage: WorldInventory; readonly drills: Readonly<Record<'ghost' | 'active' | 'exhausted', number>> }
  | { readonly entityId: WorldEntityId; readonly kind: 'depot'; readonly podCapacity: number; readonly podCount: number }

export interface WorldSnapshot {
  readonly schemaVersion: 1
  readonly worldId: WorldId
  readonly revision: number
  readonly logicalTime: SimTime
  readonly grid: WorldGrid
  readonly entities: readonly WorldEntity[]
  readonly railNodes: readonly WorldRailNode[]
  readonly railEdges: readonly WorldRailEdge[]
  readonly railBlocks: readonly WorldRailBlock[]
  readonly pods: readonly WorldPod[]
  readonly missions: readonly PodMission[]
  readonly stations: readonly WorldStationSnapshot[]
  readonly buildings: readonly WorldBuildingSnapshot[]
  readonly diagnostics: readonly WorldDiagnostic[]
  readonly paused: boolean
  readonly timeScale: 1 | 5 | 20
  readonly scheduledEvents: number
  readonly pendingAdvanceTarget?: SimTime
}

export const gridIndex = (grid: Pick<WorldGrid, 'width' | 'height'>, point: GridPoint): number => {
  if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y) || point.x < 0 || point.y < 0 || point.x >= grid.width || point.y >= grid.height) return -1
  return point.y * grid.width + point.x
}

export const rotatedSize = (size: GridSize, rotation: QuarterTurn): GridSize => {
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width <= 0 || size.height <= 0) throw new RangeError('World footprint size must use positive safe integers')
  if (rotation !== 0 && rotation !== 1 && rotation !== 2 && rotation !== 3) throw new RangeError('World rotation must be a quarter turn')
  return rotation % 2 === 0 ? size : { width: size.height, height: size.width }
}
