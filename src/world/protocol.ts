import type {
  FactoryId,
  GridPoint,
  InstanceId,
  RailEdgeId,
  ResourceId,
  SimTime,
  StationId,
  WorldEntityId,
} from '../domain';
import type { SerializedFactoryContract } from '../compiler';
import type { SerializedWorldState } from './serialization';
import type {
  QuarterTurn,
  WorldBuildingSnapshot,
  WorldDiagnostic,
  WorldEntity,
  WorldGenerationConfig,
  WorldRailBlock,
  WorldRailEdge,
  WorldRailNode,
  WorldSnapshot,
  WorldStationSnapshot,
  WorldValidationResult,
  WorldPod,
  PodMission,
} from './model';

export const WORLD_PROTOCOL_VERSION = 2 as const;
interface RequestBase {
  readonly protocolVersion: 2;
  readonly requestId: string;
}
interface RevisionRequest extends RequestBase {
  readonly expectedRevision: number;
}
export type WorldCommand =
  | (RequestBase & {
      readonly type: 'GENERATE';
      readonly config: WorldGenerationConfig;
    })
  | (RequestBase & {
      readonly type: 'LOAD';
      readonly state: SerializedWorldState;
    })
  | (RevisionRequest & {
      readonly type: 'VALIDATE_GHOST';
      readonly targetKind: 'factory' | 'mine' | 'storage' | 'depot';
      readonly position: GridPoint;
      readonly size: { readonly width: number; readonly height: number };
      readonly rotation: QuarterTurn;
      readonly stationId?: StationId;
      readonly resourceId?: ResourceId;
    })
  | (RevisionRequest & {
      readonly type: 'PLACE_RAIL_PATH';
      readonly points: readonly GridPoint[];
    })
  | (RevisionRequest & {
      readonly type: 'REMOVE_RAIL_EDGE';
      readonly edgeId: RailEdgeId;
    })
  | (RevisionRequest & {
      readonly type: 'PLACE_CONTROL_NODE';
      readonly kind: 'junction' | 'station';
      readonly position: GridPoint;
    })
  | (RevisionRequest & {
      readonly type: 'CREATE_SITE';
      readonly targetKind: 'factory' | 'mine' | 'storage' | 'depot';
      readonly position: GridPoint;
      readonly size: { readonly width: number; readonly height: number };
      readonly rotation: QuarterTurn;
      readonly stationId: StationId;
      readonly cost?: readonly {
        readonly resourceId: ResourceId;
        readonly quantity: number;
      }[];
      readonly factoryId?: FactoryId;
      readonly instanceId?: InstanceId;
      readonly resourceId?: ResourceId;
      readonly contract?: SerializedFactoryContract;
    })
  | (RevisionRequest & {
      readonly type: 'PLACE_DRILL';
      readonly mineId: WorldEntityId;
      readonly position: GridPoint;
    })
  | (RevisionRequest & {
      readonly type: 'CONFIGURE_STATION';
      readonly entityId: WorldEntityId;
      readonly resourceId: ResourceId;
      readonly mode: 'request' | 'provide';
      readonly target: number;
      readonly priority: number;
    })
  | (RevisionRequest & {
      readonly type: 'CANCEL_CONSTRUCTION';
      readonly siteId: WorldEntityId;
    })
  | (RevisionRequest & {
      readonly type: 'DISMANTLE_ENTITY';
      readonly entityId: WorldEntityId;
    })
  | (RevisionRequest & {
      readonly type: 'REPLACE_FACTORY';
      readonly entityId: WorldEntityId;
      readonly position: GridPoint;
      readonly size: { readonly width: number; readonly height: number };
      readonly rotation: QuarterTurn;
      readonly cost: readonly {
        readonly resourceId: ResourceId;
        readonly quantity: number;
      }[];
      readonly factoryId: FactoryId;
      readonly instanceId: InstanceId;
      readonly contract: SerializedFactoryContract;
    })
  | (RevisionRequest & {
      readonly type: 'SET_TIME_CONTROL';
      readonly paused: boolean;
      readonly timeScale: 1 | 5 | 20;
    })
  | (RevisionRequest & {
      readonly type: 'ADVANCE';
      readonly target: SimTime;
      readonly eventBudget?: number;
    })
  | (RevisionRequest & {
      readonly type: 'CONTINUE_ADVANCE';
      readonly eventBudget?: number;
    })
  | (RequestBase & { readonly type: 'SAVE' })
  | (RequestBase & { readonly type: 'SNAPSHOT' })
  | (RevisionRequest & {
      readonly type: 'PLACE_ENTITY';
      readonly entity: WorldEntity;
    })
  | (RevisionRequest & {
      readonly type: 'REMOVE_ENTITY';
      readonly entityId: WorldEntityId;
    })
  | (RevisionRequest & {
      readonly type: 'ADD_RAIL_NODE';
      readonly node: WorldRailNode;
    })
  | (RevisionRequest & {
      readonly type: 'ADD_RAIL_EDGE';
      readonly edge: WorldRailEdge;
    })
  | (RevisionRequest & {
      readonly type: 'ADD_TRAFFIC_STATION';
      readonly station: TrafficStationInput;
    })
  | (RevisionRequest & {
      readonly type: 'QUEUE_POD_PRODUCTION';
      readonly depotId: WorldEntityId;
    })
  | (RevisionRequest & {
      readonly type: 'CANCEL_POD_PRODUCTION';
      readonly depotId: WorldEntityId;
    })
  | (RevisionRequest & { readonly type: 'DISPATCH' })
  | (RevisionRequest & {
      readonly type: 'WAKE_DESTINATION';
      readonly stationId: string;
    });

export interface TrafficStationInput {
  readonly id: string;
  readonly railNodeId: string;
  readonly role: 'provider' | 'requester' | 'depot';
  readonly priority: number;
  readonly target: number;
  readonly minBatch: number;
  readonly maxBatch: number;
  readonly requestCreatedAt?: SimTime;
  readonly depotCapacity?: number;
  readonly buffer?: {
    readonly resourceId: ResourceId;
    readonly capacity: number;
    readonly quantity: number;
  };
}
export type WorldCommandInput = WorldCommand extends infer Command
  ? Command extends RequestBase
    ? Omit<Command, keyof RequestBase | 'expectedRevision'>
    : never
  : never;
export interface WorldDelta {
  readonly baseRevision: number;
  readonly revision: number;
  readonly logicalTime: SimTime;
  readonly entities: readonly WorldEntity[];
  readonly removedEntityIds: readonly WorldEntityId[];
  readonly railNodes: readonly WorldRailNode[];
  readonly railEdges: readonly WorldRailEdge[];
  readonly railBlocks: readonly WorldRailBlock[];
  readonly pods: readonly WorldPod[];
  readonly missions: readonly PodMission[];
  readonly stations: readonly WorldStationSnapshot[];
  readonly buildings: readonly WorldBuildingSnapshot[];
  readonly diagnostics: readonly WorldDiagnostic[];
  readonly oreChanges: readonly {
    readonly index: number;
    readonly remaining: number;
  }[];
  readonly paused: boolean;
  readonly timeScale: 1 | 5 | 20;
  readonly scheduledEvents: number;
  readonly pendingAdvanceTarget?: SimTime;
}
export type WorldWorkerResponse =
  | {
      readonly protocolVersion: 2;
      readonly requestId: string;
      readonly type: 'READY';
      readonly snapshot: WorldSnapshot;
    }
  | {
      readonly protocolVersion: 2;
      readonly requestId: string;
      readonly type: 'DELTA';
      readonly delta: WorldDelta;
    }
  | {
      readonly protocolVersion: 2;
      readonly requestId: string;
      readonly type: 'ADVANCE_PAUSED';
      readonly delta: WorldDelta;
    }
  | {
      readonly protocolVersion: 2;
      readonly requestId: string;
      readonly type: 'VALIDATION';
      readonly revision: number;
      readonly validation: WorldValidationResult;
    }
  | {
      readonly protocolVersion: 2;
      readonly requestId: string;
      readonly type: 'SAVE_RESULT';
      readonly revision: number;
      readonly state: SerializedWorldState;
    }
  | {
      readonly protocolVersion: 2;
      readonly requestId: string;
      readonly type: 'ERROR';
      readonly error: string;
      readonly revision?: number;
    };
