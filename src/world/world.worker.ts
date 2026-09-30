/// <reference lib="webworker" />
import { asId, gridSize, worldContent, stringifyExact } from '../domain';
import type { StationId, WorldEntityId } from '../domain';
import { WorldBuffer } from '../simulation';
import type { WorldCommand, WorldWorkerResponse } from './protocol';
import { WORLD_PROTOCOL_VERSION } from './protocol';
import {
  deserializeWorldRuntime,
  serializeWorldRuntime,
} from './serialization';
import { WorldRuntime } from './runtime';
import { buildWorldDelta } from './delta';

let runtime: WorldRuntime | undefined;
const CHECKPOINT_COMMANDS = new Set([
  'PLACE_RAIL_PATH',
  'REMOVE_RAIL_EDGE',
  'PLACE_CONTROL_NODE',
  'CREATE_SITE',
  'PLACE_DRILL',
  'CONFIGURE_STATION',
  'REMOVE_STATION_RULE',
  'CANCEL_CONSTRUCTION',
  'DISMANTLE_ENTITY',
  'DISMANTLE_SELECTION',
  'CANCEL_DISMANTLE',
  'DESTROY_DISMANTLED_ENTITY',
  'REPLACE_FACTORY',
  'PLACE_ENTITY',
  'REMOVE_ENTITY',
  'ADD_RAIL_NODE',
  'ADD_RAIL_EDGE',
  'ADD_TRAFFIC_STATION',
  'ADD_POD',
  'DISPATCH',
  'WAKE_DESTINATION',
]);
let metricsEnabled = false,
  commandStarted = 0,
  deltaMs = 0,
  previousPostMessageMs = 0;
const respond = (response: WorldWorkerResponse): void => {
  const start = performance.now();
  self.postMessage(
    metricsEnabled
      ? {
          ...response,
          metrics: {
            workerMs: start - commandStarted,
            deltaMs,
            previousPostMessageMs,
          },
        }
      : response,
  );
  previousPostMessageMs = performance.now() - start;
};
self.onmessage = (event: MessageEvent<WorldCommand>) => {
  const command = event.data;
  metricsEnabled = command.metrics === true;
  commandStarted = performance.now();
  deltaMs = 0;
  let rollbackState: ReturnType<typeof serializeWorldRuntime> | undefined;
  try {
    if (command.protocolVersion !== WORLD_PROTOCOL_VERSION)
      throw new Error('Unsupported world worker protocol');
    if (command.type === 'GENERATE') {
      runtime = WorldRuntime.generate(command.config);
      runtime.takeGridChanges();
      respond({
        protocolVersion: WORLD_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: 'READY',
        snapshot: runtime.snapshot(),
      });
      return;
    }
    if (command.type === 'LOAD') {
      runtime = deserializeWorldRuntime(command.state);
      runtime.takeGridChanges();
      respond({
        protocolVersion: WORLD_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: 'READY',
        snapshot: runtime.snapshot(),
      });
      return;
    }
    if (runtime === undefined)
      throw new Error('World worker is not initialised');
    if (command.type === 'SAVE') {
      const state = serializeWorldRuntime(runtime);
      if (command.serialized) {
        respond({
          protocolVersion: WORLD_PROTOCOL_VERSION,
          requestId: command.requestId,
          type: 'SAVE_PAYLOAD',
          revision: runtime.revision,
          payload: stringifyExact(state),
        });
        return;
      }
      respond({
        protocolVersion: WORLD_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: 'SAVE_RESULT',
        revision: runtime.revision,
        state,
      });
      return;
    }
    if (command.type === 'SNAPSHOT') {
      respond({
        protocolVersion: WORLD_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: 'READY',
        snapshot: runtime.snapshot(),
      });
      return;
    }
    if (command.expectedRevision !== runtime.revision)
      throw new Error(
        `Stale world command: expected revision ${runtime.revision}`,
      );
    if (command.type === 'VALIDATE_GHOST') {
      const validation =
        command.targetKind === 'drill' ||
        command.targetKind === 'station' ||
        command.targetKind === 'junction'
          ? runtime.validateInteraction(
              command.targetKind,
              command.position,
              command.mineId,
            )
          : runtime.validateGhost(
              command.targetKind,
              {
                position: command.position,
                size: gridSize(command.size.width, command.size.height),
                rotation: command.rotation,
              },
              command.stationId,
              command.resourceId,
            );
      respond({
        protocolVersion: WORLD_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: 'VALIDATION',
        revision: runtime.revision,
        validation,
      });
      return;
    }
    if (CHECKPOINT_COMMANDS.has(command.type))
      rollbackState = serializeWorldRuntime(runtime);
    runtime.beginPresentation(
      !(
        (command.type === 'ADVANCE' || command.type === 'CONTINUE_ADVANCE') &&
        command.recordPresentation === false
      ),
    );
    const baseRevision = runtime.revision;
    const beforeEntityIds = new Set(runtime.entities.keys());
    let exhausted = false;
    let commandFailures:
      | readonly { readonly targetId: string; readonly message: string }[]
      | undefined;
    if (command.type === 'PLACE_RAIL_PATH')
      runtime.placeRailPath(command.points);
    else if (command.type === 'REMOVE_RAIL_EDGE')
      runtime.removeRailEdge(command.edgeId);
    else if (command.type === 'PLACE_CONTROL_NODE') {
      const node = runtime.placeControlNode(command.kind, command.position);
      if (command.kind === 'station') {
        const id = asId<WorldEntityId>(`station-entity-${node.id}`);
        runtime.place({
          id,
          kind: 'station',
          stationId: asId<StationId>(`station-${node.id}`),
          railNodeId: node.id,
          transform: {
            position: command.position,
            size: worldContent.stationFootprint,
            rotation: 0,
          },
          createdAt: runtime.logicalTime,
        });
      }
    } else if (command.type === 'CREATE_SITE') {
      const building = worldContent.buildings.find(
        (item) => item.kind === command.targetKind,
      );
      const cost =
        command.targetKind === 'factory'
          ? (command.cost ?? [])
          : (building?.buildCost ?? []);
      runtime.createConstructionSite({
        targetKind: command.targetKind,
        transform: {
          position: command.position,
          size: gridSize(command.size.width, command.size.height),
          rotation: command.rotation,
        },
        stationId:
          command.stationId ??
          asId<StationId>(`depot-construction-${runtime.revision + 1}`),
        cost,
        ...(command.factoryId === undefined
          ? {}
          : { factoryId: command.factoryId }),
        ...(command.instanceId === undefined
          ? {}
          : { instanceId: command.instanceId }),
        ...(command.resourceId === undefined
          ? {}
          : { resourceId: command.resourceId }),
        ...(command.contract === undefined
          ? {}
          : { contract: command.contract }),
      });
    } else if (command.type === 'PLACE_DRILL')
      runtime.placeDrill(
        command.mineId,
        asId<WorldEntityId>(
          `drill-${runtime.revision + 1}-${command.position.x}-${command.position.y}`,
        ),
        command.position,
      );
    else if (command.type === 'REMOVE_STATION_RULE')
      runtime.removeStationRule(command.entityId, command.resourceId);
    else if (command.type === 'CONFIGURE_STATION')
      runtime.configureStation(
        command.entityId,
        command.resourceId,
        command.mode,
        command.target,
        command.priority,
        command.maximum,
      );
    else if (command.type === 'CANCEL_CONSTRUCTION')
      runtime.cancelConstruction(command.siteId);
    else if (command.type === 'DISMANTLE_ENTITY')
      runtime.dismantleEntity(command.entityId);
    else if (command.type === 'DISMANTLE_SELECTION')
      commandFailures = runtime.dismantleSelection(
        command.entityIds,
        command.railEdgeIds,
      );
    else if (command.type === 'CANCEL_DISMANTLE')
      runtime.cancelDismantle(command.entityId);
    else if (command.type === 'DESTROY_DISMANTLED_ENTITY')
      runtime.destroyDismantledEntity(command.entityId);
    else if (command.type === 'REPLACE_FACTORY')
      runtime.replaceFactory(command.entityId, {
        transform: {
          position: command.position,
          size: gridSize(command.size.width, command.size.height),
          rotation: command.rotation,
        },
        cost: command.cost,
        factoryId: command.factoryId,
        instanceId: command.instanceId,
        contract: command.contract,
      });
    else if (command.type === 'SET_TIME_CONTROL')
      runtime.setTimeControl(command.paused, command.timeScale);
    else if (command.type === 'ADVANCE')
      exhausted = runtime.advanceTo(
        command.target,
        command.eventBudget,
      ).exhaustedBudget;
    else if (command.type === 'CONTINUE_ADVANCE')
      exhausted = runtime.continueAdvance(command.eventBudget).exhaustedBudget;
    else if (command.type === 'PLACE_ENTITY') runtime.place(command.entity);
    else if (command.type === 'REMOVE_ENTITY') runtime.remove(command.entityId);
    else if (command.type === 'ADD_RAIL_NODE')
      runtime.addRailNode(command.node);
    else if (command.type === 'ADD_RAIL_EDGE')
      runtime.addRailEdge(command.edge);
    else if (command.type === 'ADD_TRAFFIC_STATION') {
      const { buffer, ...station } = command.station;
      runtime.addTrafficStation({
        ...station,
        ...(buffer === undefined
          ? {}
          : {
              buffer: new WorldBuffer(
                buffer.resourceId,
                buffer.capacity,
                buffer.quantity,
              ),
            }),
      });
    } else if (command.type === 'QUEUE_POD_PRODUCTION')
      runtime.queuePodProduction(command.depotId);
    else if (command.type === 'CANCEL_POD_PRODUCTION')
      runtime.cancelPodProduction(command.depotId);
    else if (command.type === 'DISPATCH') runtime.dispatch();
    else if (command.type === 'WAKE_DESTINATION')
      runtime.wakeDestination(command.stationId);
    runtime.capturePresentation();
    const presentation = runtime.presentation.finish(runtime.logicalTime);
    const deltaStarted = performance.now();
    const delta = buildWorldDelta(
      baseRevision,
      beforeEntityIds,
      { ...runtime.snapshot(), presentation },
      runtime.takeDrillExtractionEvents(),
      runtime.takeGridChanges(),
    );
    deltaMs = performance.now() - deltaStarted;
    respond({
      protocolVersion: WORLD_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: exhausted ? 'ADVANCE_PAUSED' : 'DELTA',
      delta,
      ...(commandFailures === undefined || commandFailures.length === 0
        ? {}
        : { commandFailures }),
    });
  } catch (error) {
    if (rollbackState !== undefined) {
      runtime = deserializeWorldRuntime(rollbackState);
      runtime.takeGridChanges();
    } else if (runtime !== undefined) {
      // Force client reconciliation after a partially executed multi-event advance.
      runtime.revision += 1;
    }
    respond({
      protocolVersion: WORLD_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: 'ERROR',
      error: error instanceof Error ? error.message : 'World worker failed',
      ...(runtime === undefined ? {} : { revision: runtime.revision }),
    });
  }
};
