import * as THREE from 'three';
import type { WorldRailBlock, WorldRailEdge } from '../../world/model';

/** Static rail geometry with incremental occupancy/reservation colors. */
export class TrafficOverlay {
  readonly object = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true }),
  );
  private edges: readonly WorldRailEdge[] | undefined;
  private fullPositions = new Float32Array();
  private readonly ranges = new Map<string, { start: number; end: number }>();
  private readonly states = new Map<string, number>();
  private readonly palette = [
    new THREE.Color('#4c9690'),
    new THREE.Color('#e8dec7'),
    new THREE.Color('#edb85f'),
  ];

  update(edges: readonly WorldRailEdge[], blocks: readonly WorldRailBlock[]) {
    if (edges !== this.edges) this.rebuild(edges);
    const states = new Map(
      blocks.map((block) => [
        block.edgeId,
        block.occupantId ? 2 : block.reservedById ? 1 : 0,
      ]),
    );
    const positions = this.object.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const colors = this.object.geometry.getAttribute(
      'color',
    ) as THREE.BufferAttribute;
    for (const edge of edges) {
      const state = states.get(edge.id) ?? 0;
      if (this.states.get(edge.id) === state) continue;
      this.states.set(edge.id, state);
      const range = this.ranges.get(edge.id)!;
      const color = this.palette[state]!;
      for (let offset = range.start; offset < range.end; offset += 18) {
        // Collapse the occupied-block line when free, preserving the arrows.
        for (let axis = 0; axis < 3; axis++) {
          const a = this.fullPositions[offset + axis]!;
          const b = this.fullPositions[offset + axis + 3]!;
          positions.array[offset + axis] = state === 0 ? (a + b) / 2 : a;
          positions.array[offset + axis + 3] = state === 0 ? (a + b) / 2 : b;
        }
        for (let vertex = offset; vertex < offset + 18; vertex += 3) {
          colors.array[vertex] = color.r;
          colors.array[vertex + 1] = color.g;
          colors.array[vertex + 2] = color.b;
        }
      }
      if (range.end > range.start) {
        positions.addUpdateRange(range.start, range.end - range.start);
        colors.addUpdateRange(range.start, range.end - range.start);
        positions.needsUpdate = true;
        colors.needsUpdate = true;
      }
    }
  }

  private rebuild(edges: readonly WorldRailEdge[]) {
    this.edges = edges;
    this.ranges.clear();
    this.states.clear();
    const positions: number[] = [];
    const line = (ax: number, az: number, bx: number, bz: number) =>
      positions.push(ax + 0.5, 0.32, az + 0.5, bx + 0.5, 0.32, bz + 0.5);
    for (const edge of edges) {
      const start = positions.length;
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!;
        const b = edge.points[i]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (!length) continue;
        const dx = (b.x - a.x) / length;
        const dz = (b.y - a.y) / length;
        const x = (a.x + b.x) / 2;
        const z = (a.y + b.y) / 2;
        line(a.x, a.y, b.x, b.y);
        line(
          x - dx * 0.28 - dz * 0.18,
          z - dz * 0.28 + dx * 0.18,
          x + dx * 0.28,
          z + dz * 0.28,
        );
        line(
          x - dx * 0.28 + dz * 0.18,
          z - dz * 0.28 - dx * 0.18,
          x + dx * 0.28,
          z + dz * 0.28,
        );
      }
      this.ranges.set(edge.id, { start, end: positions.length });
    }
    this.fullPositions = new Float32Array(positions);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3),
    );
    // Bound all possible occupied lines before free lines are collapsed.
    geometry.computeBoundingSphere();
    this.object.geometry.dispose();
    this.object.geometry = geometry;
  }
}
