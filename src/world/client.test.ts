import { describe, expect, it } from 'vitest';
import {
  WorldRuntime,
  applyWorldDelta,
  defaultWorldGenerationConfig,
  type WorldDelta,
  type WorldSnapshot,
} from './index';

const unchangedDelta = (snapshot: WorldSnapshot): WorldDelta => ({
  baseRevision: snapshot.revision,
  revision: snapshot.revision + 1,
  logicalTime: snapshot.logicalTime + 50_000n,
  entities: snapshot.entities,
  removedEntityIds: [],
  railNodes: snapshot.railNodes,
  railEdges: snapshot.railEdges,
  railBlocks: snapshot.railBlocks,
  pods: snapshot.pods,
  missions: snapshot.missions,
  stations: snapshot.stations,
  buildings: snapshot.buildings,
  diagnostics: snapshot.diagnostics,
  oreChanges: [],
  paused: snapshot.paused,
  timeScale: snapshot.timeScale,
  scheduledEvents: snapshot.scheduledEvents,
});

describe('world client deltas', () => {
  it('preserves the grid when a frequent clock delta has no ore changes', () => {
    const snapshot = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('client-delta'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    }).snapshot();
    const advanced = applyWorldDelta(snapshot, unchangedDelta(snapshot));
    expect(advanced.grid).toBe(snapshot.grid);
  });

  it('copies the ore storage only when an ore cell changes', () => {
    const snapshot = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('client-ore-delta'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    }).snapshot();
    const index = snapshot.grid.oreRemaining.findIndex((amount) => amount > 0);
    const amount = snapshot.grid.oreRemaining[index]!;
    const changed = applyWorldDelta(snapshot, {
      ...unchangedDelta(snapshot),
      oreChanges: [{ index, remaining: amount - 1 }],
    });
    expect(changed.grid).not.toBe(snapshot.grid);
    expect(changed.grid.oreRemaining[index]).toBe(amount - 1);
    expect(snapshot.grid.oreRemaining[index]).toBe(amount);
  });
});
