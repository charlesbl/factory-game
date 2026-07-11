import { describe, expect, it } from 'vitest';
import { asId, gridPoint } from '../domain';
import type { EdgeId, RouteHandleId } from '../domain';
import { createDemoBlueprint } from '../ui/demo-blueprint';
import { addBridgeAt } from './commands';
import { edgeRoute, materializeHandleRoute } from './connector-route';
import { routeBridgeMarkers, routeSections } from './routing';

describe('point-to-point route geometry', () => {
  it('materializes stable orthogonal spans from private handles', () => {
    const route = materializeHandleRoute(
      gridPoint(0, 0),
      [{ id: asId<RouteHandleId>('handle-a'), position: gridPoint(4, 3) }],
      'horizontal',
    );
    expect(route.points).toEqual([
      gridPoint(0, 0),
      gridPoint(4, 0),
      gridPoint(4, 3),
    ]);
    expect(route.spans).toHaveLength(1);
  });

  it('derives bridge sections and markers directly from a route', () => {
    const blueprint = createDemoBlueprint();
    const edge = blueprint.edges.get(asId<EdgeId>('edge-ore'))!;
    const cells = edgeRoute(blueprint, edge).points;
    const bridged = addBridgeAt(edge.id, gridPoint(6, 5)).apply(
      blueprint,
    ).blueprint;
    expect(bridged.edges.get(edge.id)?.bridges).toHaveLength(1);
    expect(routeSections(bridged, bridged.edges.get(edge.id)!)).toEqual(
      expect.arrayContaining([expect.objectContaining({ layerId: 'bridge' })]),
    );
    expect(
      routeBridgeMarkers(bridged, bridged.edges.get(edge.id)!),
    ).toHaveLength(2);
    expect(cells.length).toBeGreaterThan(2);
  });
});
