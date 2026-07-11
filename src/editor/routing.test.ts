import { describe, expect, it } from 'vitest';
import { asId, gridPoint } from '../domain';
import type { EdgeId, RouteHandleId } from '../domain';
import { createDemoBlueprint } from '../ui/demo-blueprint';
import { addBridgeAt } from './commands';
import { validatePhysicalRouting } from './routing';

describe('physical route validation', () => {
  it('rejects every same-layer contact, even for the same resource', () => {
    const blueprint = createDemoBlueprint();
    const ore = blueprint.edges.get(asId<EdgeId>('edge-ore'))!;
    const crossing = {
      ...ore,
      id: asId<EdgeId>('edge-crossing'),
      sourceNodeId: blueprint.edges.get(asId<EdgeId>('edge-ingot'))!
        .sourceNodeId,
      sourcePortId: blueprint.edges.get(asId<EdgeId>('edge-ingot'))!
        .sourcePortId,
      routeHandles: [
        { id: asId<RouteHandleId>('cross-handle'), position: gridPoint(5, 4) },
      ],
    };
    const invalid = {
      ...blueprint,
      edges: new Map(blueprint.edges).set(crossing.id, crossing),
    };
    expect(validatePhysicalRouting(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ILLEGAL_CROSSING' }),
      ]),
    );
  });

  it('moves the selected crossing onto the bridge layer', () => {
    const blueprint = createDemoBlueprint();
    const edge = blueprint.edges.get(asId<EdgeId>('edge-ore'))!;
    const bridged = addBridgeAt(edge.id, gridPoint(6, 5)).apply(
      blueprint,
    ).blueprint;
    expect(
      validatePhysicalRouting(bridged).filter(
        (item) => item.code === 'INVALID_BRIDGE',
      ),
    ).toHaveLength(0);
  });
});
