import { describe, expect, it } from 'vitest';
import { asId, gridPoint } from '../domain';
import type { EdgeId, RouteHandleId } from '../domain';
import { createDemoBlueprint, createMachineNode } from '../ui/demo-blueprint';
import { addBridgeAt } from './commands';
import { validatePhysicalRouting } from './routing';

describe('physical route validation', () => {
  it.each([
    [5, 6],
    [5, 0],
    [7, 5],
    [-1, 5],
  ])('allows a route one grid step outside a node at (%i, %i)', (x, y) => {
    const blueprint = createDemoBlueprint();
    const obstacle = createMachineNode(
      asId('obstacle'),
      asId('ironIngot'),
      x,
      y,
    );
    const diagnostics = validatePhysicalRouting({
      ...blueprint,
      edges: new Map([
        [asId('edge-ore'), blueprint.edges.get(asId('edge-ore'))!],
      ]),
      nodes: new Map(blueprint.nodes).set(obstacle.id, obstacle),
    });
    expect(diagnostics).toEqual([]);
  });

  it('rejects a route touching the visible footprint', () => {
    const blueprint = createDemoBlueprint();
    const obstacle = createMachineNode(
      asId('obstacle'),
      asId('ironIngot'),
      5,
      5,
    );
    expect(
      validatePhysicalRouting({
        ...blueprint,
        nodes: new Map(blueprint.nodes).set(obstacle.id, obstacle),
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'MACHINE_KEEPOUT',
        details: expect.objectContaining({ nodeId: obstacle.id }),
      }),
    );
  });

  it('rejects a route passing back through its own origin node', () => {
    const blueprint = createDemoBlueprint();
    const edge = blueprint.edges.get(asId<EdgeId>('edge-ore'))!;
    expect(
      validatePhysicalRouting({
        ...blueprint,
        edges: new Map([
          [
            edge.id,
            {
              ...edge,
              routeHandles: [
                { id: asId('backwards'), position: gridPoint(2, 5) },
              ],
            },
          ],
        ]),
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: 'MACHINE_KEEPOUT',
        details: expect.objectContaining({ nodeId: edge.sourceNodeId }),
      }),
    );
  });

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
