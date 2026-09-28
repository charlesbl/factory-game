import type { WorldEntityId } from '../domain';
import type { WorldDelta } from './protocol';
import type { WorldSnapshot } from './model';
import type { WorldRuntime } from './runtime';

export const buildWorldDelta = (
  baseRevision: number,
  beforeEntityIds: ReadonlySet<WorldEntityId>,
  after: WorldSnapshot,
  drillExtractionIds: WorldSnapshot['drillExtractionIds'],
  gridChanges: ReturnType<WorldRuntime['takeGridChanges']>,
): WorldDelta => {
  const currentEntityIds = new Set(after.entities.map((entity) => entity.id));
  const removed = [...beforeEntityIds].filter(
    (id) => !currentEntityIds.has(id),
  );
  return {
    presentation: after.presentation,
    baseRevision,
    revision: after.revision,
    logicalTime: after.logicalTime,
    entities: after.entities,
    removedEntityIds: removed,
    occupancyChanges: gridChanges.occupancyChanges,
    railNodes: after.railNodes,
    railEdges: after.railEdges,
    railBlocks: after.railBlocks,
    pods: after.pods,
    missions: after.missions,
    stations: after.stations,
    buildings: after.buildings,
    diagnostics: after.diagnostics,
    oreChanges: gridChanges.oreChanges,
    drillExtractionIds,
    paused: after.paused,
    timeScale: after.timeScale,
    scheduledEvents: after.scheduledEvents,
    ...(after.pendingAdvanceTarget === undefined
      ? {}
      : { pendingAdvanceTarget: after.pendingAdvanceTarget }),
  };
};
