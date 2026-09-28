import { expect, it } from 'vitest';
import { createPerformanceFixture } from './performance-fixture';
import {
  deserializeWorldRuntime,
  serializeWorldRuntime,
} from './serialization';

it('rebuilds a valid standard fixture and all 200 pods move during the fixed run', () => {
  const fixture = createPerformanceFixture();
  const runtime = deserializeWorldRuntime(serializeWorldRuntime(fixture));
  expect(runtime.entities.size).toBe(500);
  expect(runtime.traffic.pods.size).toBe(200);
  expect(
    [...runtime.railEdges.values()].reduce((sum, edge) => sum + edge.length, 0),
  ).toBe(2000);
  const moved = new Set<string>();
  for (let second = 1; second <= 60; second++) {
    runtime.beginPresentation();
    runtime.advanceTo(BigInt(second) * 1_000_000n);
    runtime.capturePresentation();
    for (const record of runtime.presentation.finish(runtime.logicalTime)
      .records)
      if (record.pod.motion) moved.add(record.pod.id);
  }
  expect(moved.size).toBe(200);
}, 45_000);
