import { describe, expect, it } from 'vitest';
import { asId, gridPoint } from '../domain';
import type { RailEdgeId, RailNodeId } from '../domain';
import type { WorldRailEdge, WorldRailNode } from '../world';
import {
  railEdgeAt,
  railEdgeConnectionState,
  railNodeConnectionState,
  railNodeDegrees,
} from './worldRailVisual';

const node = (
  id: string,
  x: number,
  kind: WorldRailNode['kind'],
): WorldRailNode => ({
  id: asId<RailNodeId>(id),
  position: gridPoint(x, 0),
  kind,
});
const edge = (
  id: string,
  from: string,
  to: string,
  start: number,
  end: number,
): WorldRailEdge => ({
  id: asId<RailEdgeId>(id),
  from: asId<RailNodeId>(from),
  to: asId<RailNodeId>(to),
  points: [gridPoint(start, 0), gridPoint(end, 0)],
  length: Math.abs(end - start),
});

describe('world rail visual state', () => {
  it('finds the rail segment under any tile along its path', () => {
    const rail = edge('edge', 'station', 'end', 2, 8);
    expect(railEdgeAt({ railEdges: [rail] }, gridPoint(5, 0))?.id).toBe('edge');
    expect(railEdgeAt({ railEdges: [rail] }, gridPoint(5, 1))).toBeUndefined();
  });

  it('shows a station-to-station rail as connected', () => {
    const rail = edge('edge', 'from', 'to', 0, 5);
    const nodes = [node('from', 0, 'station'), node('to', 5, 'station')];
    const degrees = railNodeDegrees([rail]);
    expect(
      railEdgeConnectionState(
        rail,
        new Map(nodes.map((item) => [item.id, item])),
        degrees,
      ),
    ).toBe('connected');
    expect(nodes.map((item) => railNodeConnectionState(item, degrees))).toEqual(
      ['connected', 'connected'],
    );
  });

  it('shows a loose end and its rail as disconnected', () => {
    const rail = edge('edge', 'station', 'loose', 0, 5);
    const station = node('station', 0, 'station');
    const loose = node('loose', 5, 'endpoint');
    const degrees = railNodeDegrees([rail]);
    expect(railNodeConnectionState(loose, degrees)).toBe('disconnected');
    expect(
      railEdgeConnectionState(
        rail,
        new Map([
          [station.id, station],
          [loose.id, loose],
        ]),
        degrees,
      ),
    ).toBe('disconnected');
  });
});
