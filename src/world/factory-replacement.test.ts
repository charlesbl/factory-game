import { describe, expect, it } from 'vitest';
import { compileBlueprint, isContract, serializeContract } from '../compiler';
import { asId, gridPoint, gridSize } from '../domain';
import type {
  FactoryId,
  InstanceId,
  ResourceId,
  StationId,
  WorldEntityId,
} from '../domain';
import { createBlueprint } from '../editor';
import { createDemoBlueprint } from '../ui/demo-blueprint';
import {
  defaultWorldGenerationConfig,
  deserializeWorldRuntime,
  generateWorld,
  rotatedSize,
  serializeWorldRuntime,
  TerrainKind,
  WorldRuntime,
  type QuarterTurn,
} from './index';

const fixture = (rotation: QuarterTurn, side: 'east' | 'south') => {
  const runtime = new WorldRuntime(
    generateWorld({
      ...defaultWorldGenerationConfig('factory-replacement'),
      width: 64,
      height: 64,
    }),
  );
  runtime.world.grid.terrain.fill(TerrainKind.BUILDABLE);
  const compiled = compileBlueprint(createDemoBlueprint());
  if (!isContract(compiled)) throw new Error('Demo failed to compile');
  const size = gridSize(compiled.footprint.width, compiled.footprint.height);
  const rotated = rotatedSize(size, rotation);
  const stationPosition =
    side === 'east'
      ? gridPoint(10 + rotated.width, 10)
      : gridPoint(10, 10 + rotated.height);
  const stationNode = runtime.placeControlNode('station', stationPosition);
  const stationId = asId<StationId>('replacement-station');
  const stationEntityId = asId<WorldEntityId>('replacement-station-entity');
  runtime.place({
    id: stationEntityId,
    kind: 'station',
    stationId,
    railNodeId: stationNode.id,
    transform: { position: stationPosition, size: gridSize(2, 2), rotation: 0 },
    createdAt: 0n,
  });
  const factoryId = asId<FactoryId>('factory-main');
  const original = runtime.createConstructionSite({
    targetKind: 'factory',
    transform: { position: gridPoint(10, 10), size, rotation },
    stationId,
    cost: [],
    factoryId,
    instanceId: asId('original-instance'),
    contract: serializeContract(compiled),
  });
  const smaller = compileBlueprint(createBlueprint(factoryId));
  if (!isContract(smaller)) throw new Error('Empty factory failed to compile');
  const target = {
    transform: {
      position:
        side === 'east'
          ? gridPoint(stationPosition.x - 1, 10)
          : gridPoint(10, stationPosition.y - 1),
      size: gridSize(1, 1),
      rotation,
    },
    cost: [],
    factoryId,
    instanceId: asId<InstanceId>('replacement-instance'),
    contract: serializeContract(smaller),
  };
  return {
    runtime,
    original,
    target,
    stationId,
    stationEntityId,
    stationPosition,
  };
};

describe('factory replacement station connection', () => {
  it.each([0, 1, 2, 3] as const)(
    'moves the smaller factory next to its station at rotation %i',
    (rotation) => {
      for (const side of ['east', 'south'] as const) {
        const { runtime, original, target, stationEntityId, stationPosition } =
          fixture(rotation, side);
        const before = serializeWorldRuntime(runtime);
        expect(
          runtime.validateGhost(
            'factory',
            original.transform,
            undefined,
            undefined,
            false,
            original.id,
          ),
        ).toEqual({ valid: true });
        expect(serializeWorldRuntime(runtime)).toEqual(before);
        expect(
          runtime.validateGhost(
            'factory',
            target.transform,
            undefined,
            undefined,
            false,
            original.id,
          ),
        ).toEqual({ valid: true });
        runtime.replaceFactory(original.id, target);
        const replacement = [...runtime.entities.values()].find(
          (entity) => entity.kind === 'factory',
        )!;
        expect(replacement.transform).toEqual(target.transform);
        expect(runtime.entities.get(stationEntityId)).toMatchObject({
          linkedEntityId: replacement.id,
          transform: { position: stationPosition },
        });
        expect(
          runtime.factoryInstances.get(replacement.id)?.contract.blueprintHash,
        ).toBe(target.contract.blueprintHash);

        const restored = deserializeWorldRuntime(
          serializeWorldRuntime(runtime),
        );
        expect(restored.entities.get(stationEntityId)).toMatchObject({
          linkedEntityId: replacement.id,
        });
        // Cancelling a later dismantle must also preserve the station link.
        restored.dismantleEntity(replacement.id);
        expect(() => restored.cancelDismantle(replacement.id)).not.toThrow();
        expect(restored.entities.get(stationEntityId)).toMatchObject({
          linkedEntityId: replacement.id,
        });
      }
    },
  );

  it('keeps the station for construction deliveries through save and completion', () => {
    const { runtime, original, target, stationEntityId, stationId } = fixture(
      0,
      'east',
    );
    const resourceId = asId<ResourceId>('ironPlate');
    runtime.replaceFactory(original.id, {
      ...target,
      cost: [{ resourceId, quantity: 5 }],
    });
    const site = [...runtime.entities.values()].find(
      (entity) => entity.kind === 'construction-site',
    )!;
    expect(site).toMatchObject({ stationId, transform: target.transform });
    const restored = deserializeWorldRuntime(serializeWorldRuntime(runtime));
    const request = restored.traffic.stations.get(
      `site:${site.id}:${resourceId}`,
    )!;
    expect(request.railNodeId).toBe(
      (restored.entities.get(stationEntityId) as { railNodeId: string })
        .railNodeId,
    );
    request.buffer!.add(5);
    restored.advanceTo(restored.logicalTime + 1n);
    expect(restored.entities.get(site.id)).toMatchObject({
      kind: 'factory',
      stationId,
    });
  });

  it('still requires an adjacent station for a new factory', () => {
    const { runtime, target, stationId } = fixture(0, 'east');
    expect(() =>
      runtime.createConstructionSite({
        ...target,
        targetKind: 'factory',
        transform: { ...target.transform, position: gridPoint(2, 2) },
        stationId,
      }),
    ).toThrow('MISSING_STATION');
  });

  it('rejects a disconnected replacement before changing the original factory', () => {
    const { runtime, original, target } = fixture(0, 'east');
    const before = serializeWorldRuntime(runtime);
    const disconnected = {
      ...target,
      transform: { ...target.transform, position: gridPoint(10, 10) },
    };
    expect(
      runtime.validateGhost(
        'factory',
        disconnected.transform,
        undefined,
        undefined,
        false,
        original.id,
      ),
    ).toEqual({ valid: false, reason: 'MISSING_STATION' });
    expect(() => runtime.replaceFactory(original.id, disconnected)).toThrow(
      'MISSING_STATION',
    );
    expect(serializeWorldRuntime(runtime)).toEqual(before);
  });

  it('still rejects replacements that overlap the station', () => {
    const { runtime, original, target, stationPosition } = fixture(0, 'east');
    const before = serializeWorldRuntime(runtime);
    expect(() =>
      runtime.replaceFactory(original.id, {
        ...target,
        transform: { ...target.transform, position: stationPosition },
      }),
    ).toThrow('OCCUPIED');
    expect(serializeWorldRuntime(runtime)).toEqual(before);
  });
});
