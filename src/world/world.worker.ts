/// <reference lib="webworker" />
import { asId, gridSize, worldContent } from '../domain';
import type { StationId, WorldEntityId } from '../domain';
import { WorldBuffer } from '../simulation';
import type { WorldCommand, WorldDelta, WorldWorkerResponse } from './protocol';
import { WORLD_PROTOCOL_VERSION } from './protocol';
import {
  deserializeWorldRuntime,
  serializeWorldRuntime,
} from './serialization';
import { WorldRuntime } from './runtime';
import type { WorldSnapshot } from './model';

let runtime: WorldRuntime | undefined;
const respond = (response: WorldWorkerResponse): void =>
  self.postMessage(response);
const deltaBetween = (
  before: WorldSnapshot,
  after: WorldSnapshot,
): WorldDelta => {
  const removed = before.entities
    .filter((entity) => !after.entities.some((next) => next.id === entity.id))
    .map((entity) => entity.id);
  const oreChanges: { index: number; remaining: number }[] = [];
  for (let index = 0; index < after.grid.oreRemaining.length; index += 1)
    if (after.grid.oreRemaining[index] !== before.grid.oreRemaining[index])
      oreChanges.push({ index, remaining: after.grid.oreRemaining[index]! });
  return {
    baseRevision: before.revision,
    revision: after.revision,
    logicalTime: after.logicalTime,
    entities: after.entities,
    removedEntityIds: removed,
    railNodes: after.railNodes,
    railEdges: after.railEdges,
    railBlocks: after.railBlocks,
    pods: after.pods,
    missions: after.missions,
    stations: after.stations,
    buildings: after.buildings,
    diagnostics: after.diagnostics,
    oreChanges,
    paused: after.paused,
    timeScale: after.timeScale,
    scheduledEvents: after.scheduledEvents,
    ...(after.pendingAdvanceTarget === undefined
      ? {}
      : { pendingAdvanceTarget: after.pendingAdvanceTarget }),
  };
};
self.onmessage = (event: MessageEvent<WorldCommand>) => {
  const command = event.data;
  try {
    if (command.protocolVersion !== WORLD_PROTOCOL_VERSION)
      throw new Error('Unsupported world worker protocol');
    if (command.type === 'GENERATE') {
      runtime = WorldRuntime.generate(command.config);
      respond({
        protocolVersion: 2,
        requestId: command.requestId,
        type: 'READY',
        snapshot: runtime.snapshot(),
      });
      return;
    }
    if (command.type === 'LOAD') {
      runtime = deserializeWorldRuntime(command.state);
      respond({
        protocolVersion: 2,
        requestId: command.requestId,
        type: 'READY',
        snapshot: runtime.snapshot(),
      });
      return;
    }
    if (runtime === undefined)
      throw new Error('World worker is not initialised');
    if (command.type === 'SAVE') {
      respond({
        protocolVersion: 2,
        requestId: command.requestId,
        type: 'SAVE_RESULT',
        revision: runtime.revision,
        state: serializeWorldRuntime(runtime),
      });
      return;
    }
    if (command.type === 'SNAPSHOT') {
      respond({
        protocolVersion: 2,
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
      const validation = runtime.validateGhost(
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
        protocolVersion: 2,
        requestId: command.requestId,
        type: 'VALIDATION',
        revision: runtime.revision,
        validation,
      });
      return;
    }
    const before = runtime.snapshot();
    let exhausted = false;
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
        stationId: command.stationId,
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
    else if (command.type === 'CONFIGURE_STATION')
      runtime.configureStation(
        command.entityId,
        command.resourceId,
        command.mode,
        command.target,
        command.priority,
      );
    else if (command.type === 'CANCEL_CONSTRUCTION')
      runtime.cancelConstruction(command.siteId);
    else if (command.type === 'DISMANTLE_ENTITY')
      runtime.dismantleEntity(command.entityId);
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
    const delta = deltaBetween(before, runtime.snapshot());
    respond({
      protocolVersion: 2,
      requestId: command.requestId,
      type: exhausted ? 'ADVANCE_PAUSED' : 'DELTA',
      delta,
    });
  } catch (error) {
    respond({
      protocolVersion: 2,
      requestId: command.requestId,
      type: 'ERROR',
      error: error instanceof Error ? error.message : 'World worker failed',
      ...(runtime === undefined ? {} : { revision: runtime.revision }),
    });
  }
};
