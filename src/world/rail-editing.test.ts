import { describe, expect, it } from 'vitest';
import { asId, gridPoint } from '../domain';
import { WorldRuntime } from './runtime';
import { generateWorld } from './generation';
import { defaultWorldGenerationConfig } from './model';
import { parseWorldRuntime, stringifyWorldRuntime } from './serialization';

const create = () =>
  new WorldRuntime(
    generateWorld({
      ...defaultWorldGenerationConfig('rail-editing'),
      width: 64,
      height: 64,
    }),
  );
const at = (runtime: WorldRuntime, x: number, y: number) =>
  [...runtime.railNodes.values()].find(
    (n) => n.position.x === x && n.position.y === y,
  )!;
const path = (runtime: WorldRuntime, points: number[][]) =>
  runtime.placeRailPath(points.map(([x, y]) => gridPoint(x!, y!)));
const expectCellEdges = (runtime: WorldRuntime) => {
  for (const edge of runtime.railEdges.values()) {
    expect(edge.length).toBe(1);
    expect(edge.points).toHaveLength(2);
    const [from, to] = edge.points;
    expect(Math.abs(from!.x - to!.x) + Math.abs(from!.y - to!.y)).toBe(1);
    expect(runtime.rails.blocks.has(`block:${edge.id}`)).toBe(true);
  }
};

describe('rail construction topology', () => {
  it('joins a second build to the middle of an existing directed rail and preserves it after reload', () => {
    const runtime = create();
    path(runtime, [
      [10, 10],
      [20, 10],
    ]);
    path(runtime, [
      [15, 5],
      [15, 10],
    ]);
    expect(runtime.railEdges.size).toBe(15);
    expectCellEdges(runtime);
    const restored = parseWorldRuntime(stringifyWorldRuntime(runtime));
    expect(
      restored.rails.route(at(restored, 15, 5).id, at(restored, 20, 10).id)
        ?.distance,
    ).toBe(10);
    expect(
      restored.rails.route(at(restored, 10, 10).id, at(restored, 20, 10).id)
        ?.distance,
    ).toBe(10);
    expect(
      restored.rails.route(at(restored, 15, 5).id, at(restored, 10, 10).id),
    ).toBeUndefined();
  });
  it('branches from the middle and connects existing endpoints passed by a later line', () => {
    const runtime = create();
    path(runtime, [
      [10, 10],
      [20, 10],
    ]);
    path(runtime, [
      [15, 10],
      [15, 15],
    ]);
    path(runtime, [
      [12, 15],
      [18, 15],
    ]);
    expect(
      runtime.rails.route(at(runtime, 10, 10).id, at(runtime, 18, 15).id)
        ?.distance,
    ).toBe(13);
    expect(runtime.railEdges.size).toBe(21);
    expectCellEdges(runtime);
  });
  it('connects crossings through automatic junctions and preserves them when explicitly configured', () => {
    const runtime = create();
    path(runtime, [
      [10, 10],
      [20, 10],
    ]);
    path(runtime, [
      [15, 5],
      [15, 15],
    ]);
    expect(runtime.railEdges.size).toBe(20);
    expect(at(runtime, 15, 10).kind).toBe('junction');
    expect(
      runtime.rails.route(at(runtime, 10, 10).id, at(runtime, 15, 15).id)
        ?.distance,
    ).toBe(10);
    runtime.placeControlNode('junction', gridPoint(15, 10));
    expect(runtime.railEdges.size).toBe(20);
    expectCellEdges(runtime);
    expect(
      runtime.rails.route(at(runtime, 10, 10).id, at(runtime, 15, 15).id)
        ?.distance,
    ).toBe(10);
  });
  it('reuses overlapping cell edges and duplicate clicks while preserving reverse travel', () => {
    const runtime = create();
    path(runtime, [
      [10, 10],
      [15, 10],
    ]);
    path(runtime, [
      [15, 10],
      [15, 10],
      [20, 10],
    ]);
    expect(runtime.railEdges.size).toBe(10);
    path(runtime, [
      [12, 10],
      [25, 10],
    ]);
    expect(runtime.railEdges.size).toBe(15);
    expect(runtime.railNodes.size).toBe(16);
    const [edgeId] = path(runtime, [
      [10, 10],
      [25, 10],
    ]);
    expect(runtime.railEdges.has(edgeId!)).toBe(true);
    expect(runtime.railEdges.size).toBe(15);
    path(runtime, [
      [25, 10],
      [10, 10],
    ]);
    expect(runtime.railEdges.size).toBe(30);
    expectCellEdges(runtime);
    expect(
      runtime.rails.route(at(runtime, 25, 10).id, at(runtime, 10, 10).id)
        ?.distance,
    ).toBe(15);
  });
  it('preserves corners, branches, stations, explicit junctions and a pod resting at a node', () => {
    const runtime = create();
    // The station building anchors at (14, 8); its rail node is the hookup
    // cell (15, 10) outside the footprint, on the line below.
    runtime.placeControlNode('station', gridPoint(14, 8));
    runtime.placeControlNode('junction', gridPoint(20, 10));
    path(runtime, [
      [10, 10],
      [25, 10],
      [25, 15],
    ]);
    path(runtime, [
      [20, 10],
      [20, 15],
    ]);
    expect(runtime.railEdges.size).toBe(25);
    expect(at(runtime, 15, 10).kind).toBe('station');
    expect(at(runtime, 20, 10).kind).toBe('junction');
    runtime.addPod('waiting', at(runtime, 25, 15).id, 'rest');
    path(runtime, [
      [25, 15],
      [25, 20],
    ]);
    expect(at(runtime, 25, 15)).toBeDefined();
    expect(runtime.railEdges.size).toBe(30);
    expectCellEdges(runtime);
  });
  it('rejects invalid drafts before changing topology', () => {
    const runtime = create();
    path(runtime, [
      [10, 10],
      [20, 10],
    ]);
    const before = stringifyWorldRuntime(runtime);
    expect(() =>
      path(runtime, [
        [15, 10],
        [15, 15],
        [17, 18],
      ]),
    ).toThrow(/cardinal/);
    expect(() =>
      path(runtime, [
        [15, 10],
        [70, 10],
      ]),
    ).toThrow(/inside/);
    expect(stringifyWorldRuntime(runtime)).toBe(before);
  });
  it('preserves reserved cell blocks and active routes while joining existing nodes or extending rails', () => {
    const runtime = create();
    const [id] = path(runtime, [
      [10, 10],
      [20, 10],
    ]);
    runtime.rails.reserve(id!, 'pod');
    const before = stringifyWorldRuntime(runtime);
    expect(() => runtime.removeRailEdge(id!)).toThrow(/active pod route/);
    expect(stringifyWorldRuntime(runtime)).toBe(before);
    path(runtime, [
      [15, 5],
      [15, 10],
    ]);
    runtime.placeControlNode('junction', gridPoint(15, 10));
    expect(runtime.rails.blocks.get(`block:${id}`)?.reservedById).toBe('pod');
    path(runtime, [
      [20, 10],
      [25, 10],
    ]);
    expect(runtime.railEdges.has(id!)).toBe(true);
    expect(runtime.railEdges.size).toBe(20);
    runtime.rails.releaseReservation(id!, 'pod');
    const route = runtime.rails.route(
      at(runtime, 10, 10).id,
      at(runtime, 25, 10).id,
    )!;
    runtime.traffic.missions.set('future', {
      id: 'future',
      providerId: 'provider',
      requesterId: 'requester',
      podId: 'pod',
      resourceId: asId('ironPlate'),
      quantity: 1,
      createdAt: 0n,
      approachRoute: { nodeIds: [], edgeIds: [], distance: 0 },
      deliveryRoute: route,
      status: 'TO_PROVIDER',
    });
    expect(() => runtime.removeRailEdge(id!)).toThrow(/active pod route/);
    path(runtime, [
      [15, 5],
      [15, 10],
    ]);
    path(runtime, [
      [25, 10],
      [30, 10],
    ]);
    expect(runtime.railEdges.has(id!)).toBe(true);
    expect(runtime.railEdges.size).toBe(25);
    expect(runtime.traffic.missions.get('future')?.deliveryRoute).toEqual(
      route,
    );
    expect(
      route.edgeIds.every((edgeId) => runtime.railEdges.has(asId(edgeId))),
    ).toBe(true);
    expectCellEdges(runtime);
  });
});
