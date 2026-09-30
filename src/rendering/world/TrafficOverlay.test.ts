import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { asId, gridPoint } from '../../domain';
import type { WorldRailEdge, WorldRailBlock } from '../../world/model';
import { TrafficOverlay } from './TrafficOverlay';

const edge: WorldRailEdge = {
  id: asId('edge'),
  from: asId('from'),
  to: asId('to'),
  length: 2,
  points: [gridPoint(0, 0), gridPoint(2, 0)],
};

describe('traffic overlay', () => {
  it('reuses geometry while updating occupancy and reservation colors', () => {
    const overlay = new TrafficOverlay();
    const edges = [edge];
    overlay.update(edges, []);
    const geometry = overlay.object.geometry;
    const positions = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
    const arrows = Array.from(positions.array.slice(6));
    expect(positions.array.slice(0, 3)).toEqual(positions.array.slice(3, 6));
    const initialVersion = colors.version;
    overlay.update(edges, []);
    expect(colors.version).toBe(initialVersion);

    const block: WorldRailBlock = { id: asId('block'), edgeId: edge.id };
    overlay.update(edges, [{ ...block, reservedById: asId('pod') }]);
    expect(overlay.object.geometry).toBe(geometry);
    expect(positions.array[0]).toBe(0.5);
    expect(positions.array[3]).toBe(2.5);
    const reserved = new THREE.Color('#e8dec7');
    expect(colors.array[0]).toBeCloseTo(reserved.r);
    expect(Array.from(positions.array.slice(6))).toEqual(arrows);

    overlay.update(edges, [{ ...block, occupantId: asId('pod') }]);
    expect(colors.array[0]).toBeCloseTo(new THREE.Color('#edb85f').r);
    overlay.update(edges, []);
    expect(positions.array.slice(0, 3)).toEqual(positions.array.slice(3, 6));
    expect(colors.array[0]).toBeCloseTo(new THREE.Color('#4c9690').r);
    expect(overlay.object.geometry).toBe(geometry);
  });

  it('rebuilds changed topology and releases the old buffers', () => {
    const overlay = new TrafficOverlay();
    overlay.update([edge], []);
    const previous = overlay.object.geometry;
    const dispose = vi.spyOn(previous, 'dispose');
    overlay.update(
      [{ ...edge, points: [gridPoint(0, 0), gridPoint(0, 2)] }],
      [],
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(overlay.object.geometry).not.toBe(previous);
    expect(overlay.object.geometry.getAttribute('position').array[2]).toBe(1.5);
  });
});
