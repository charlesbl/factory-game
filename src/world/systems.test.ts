import { describe, expect, it } from 'vitest';
import { asId, gridPoint, gridSize } from '../domain';
import type { ResourceId, WorldEntityId } from '../domain';
import {
  ConstructionSiteRuntime,
  MineRuntime,
  OreKind,
  SharedInventory,
  SharedInventoryBuffer,
  chooseSalvageDestination,
  defaultWorldGenerationConfig,
  generateWorld,
  gridIndex,
} from './index';

const iron = asId<ResourceId>('ironPlate');
const ore = asId<ResourceId>('ironOre');

describe('world construction and storage', () => {
  it('completes atomically and evacuates exact delivered material when cancelled', () => {
    const site = new ConstructionSiteRuntime([
      { resourceId: iron, quantity: 4 },
    ]);
    site.deliver(iron, 2);
    expect(site.state).toBe('WAITING');
    site.cancel();
    expect(site.state).toBe('EVACUATING');
    expect(site.salvage.snapshot()).toEqual([
      { resourceId: iron, quantity: 2 },
    ]);
    site.evacuate(iron, 2);
    expect(site.state).toBe('REMOVED');
    const complete = new ConstructionSiteRuntime([
      { resourceId: iron, quantity: 4 },
    ]);
    complete.deliver(iron, 4);
    expect(complete.state).toBe('READY');
    expect(complete.complete()).toEqual([{ resourceId: iron, quantity: 4 }]);
    expect(complete.state).toBe('COMPLETED');
  });
  it('enforces shared and per-resource storage capacity', () => {
    const copper = asId<ResourceId>('copperPlate');
    const storage = new SharedInventory(10, [{ resourceId: iron, maximum: 4 }]);
    storage.add(iron, 4);
    storage.add(copper, 6);
    expect(storage.freeSpace).toBe(0);
    expect(() => storage.add(iron, 1)).toThrow(/full/);
  });
  it('shares capacity across the resource buffers exposed to stations', () => {
    const copper = asId<ResourceId>('copperPlate');
    const storage = new SharedInventory(10);
    const ironBuffer = new SharedInventoryBuffer(storage, iron);
    const copperBuffer = new SharedInventoryBuffer(storage, copper);
    ironBuffer.add(6);
    expect(copperBuffer.freeSpace).toBe(4);
    copperBuffer.add(4);
    expect(ironBuffer.freeSpace).toBe(0);
    expect(() => copperBuffer.add(1)).toThrow(/full/);
  });
  it('serves compatible demand before the nearest fallback storage', () => {
    expect(
      chooseSalvageDestination(3, [
        {
          id: 'storage',
          kind: 'storage',
          distance: 1,
          priority: 0,
          freeSpace: 10,
        },
        {
          id: 'request',
          kind: 'request',
          distance: 20,
          priority: 2,
          freeSpace: 3,
        },
      ])?.id,
    ).toBe('request');
  });
});

describe('modular mines', () => {
  it('builds closest connected drill ghosts, depletes their own tiles, and salvages exactly', () => {
    const world = generateWorld({
      ...defaultWorldGenerationConfig('mine-system'),
      width: 64,
      height: 64,
      spawnClearingSize: 16,
      orePerTile: 2,
    });
    let drill = gridPoint(0, 0);
    let main = gridPoint(0, 0);
    let found = false;
    for (
      let index = 0;
      index < world.grid.oreKinds.length && !found;
      index += 1
    )
      if (world.grid.oreKinds[index] === OreKind.IRON) {
        const x = index % world.grid.width;
        const y = Math.floor(index / world.grid.width);
        for (const candidate of [
          gridPoint(x + 1, y),
          gridPoint(x - 1, y),
          gridPoint(x, y + 1),
          gridPoint(x, y - 1),
        ]) {
          const adjacentIndex = gridIndex(world.grid, candidate);
          if (
            adjacentIndex >= 0 &&
            world.grid.oreKinds[adjacentIndex] === OreKind.NONE
          ) {
            drill = gridPoint(x, y);
            main = candidate;
            found = true;
            break;
          }
        }
      }
    expect(found).toBe(true);
    const mine = new MineRuntime(
      world.grid,
      { position: main, size: gridSize(1, 1), rotation: 0 },
      ore,
      OreKind.IRON,
      [{ resourceId: iron, quantity: 1 }],
    );
    const id = asId<WorldEntityId>('drill-1');
    mine.placeDrill(id, drill, 0n);
    mine.construction.add(iron, 1);
    expect(mine.buildNext()?.id).toBe(id);
    expect(mine.extract()).toBe(1);
    expect(mine.extract()).toBe(1);
    expect(mine.drills.get(id)?.state).toBe('EXHAUSTED');
    expect(world.grid.oreRemaining[gridIndex(world.grid, drill)]).toBe(0);
    mine.dismantleDrill(id);
    expect(mine.salvage.snapshot()).toEqual([
      { resourceId: iron, quantity: 1 },
    ]);
  });
});
