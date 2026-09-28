import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';

const server = await createServer({ server: { middlewareMode: true } });
try {
  const { createPerformanceFixture } = await server.ssrLoadModule(
    '/src/world/performance-fixture.ts',
  );
  const { serializeWorldRuntime } = await server.ssrLoadModule(
    '/src/world/serialization.ts',
  );
  const { stringifyExact } = await server.ssrLoadModule(
    '/src/domain/serialization.ts',
  );
  const large = process.argv.includes('--large');
  const visual = process.argv.includes('--visual');
  const { WorldRuntime } = await server.ssrLoadModule('/src/world/runtime.ts');
  const { defaultWorldGenerationConfig } = await server.ssrLoadModule(
    '/src/world/model.ts',
  );
  const runtime = large
    ? WorldRuntime.generate({
        ...defaultWorldGenerationConfig('world-large-v1'),
        width: 1024,
        height: 1024,
      })
    : createPerformanceFixture();
  if (visual) {
    const { asId, gridPoint, gridSize } = await server.ssrLoadModule(
      '/src/domain/index.ts',
    );
    const node = runtime.placeControlNode('station', gridPoint(134, 144));
    const stationId = asId('visual-construction-station');
    runtime.place({
      id: asId('visual-station'),
      kind: 'station',
      stationId,
      railNodeId: node.id,
      transform: {
        position: gridPoint(134, 144),
        size: gridSize(2, 2),
        rotation: 0,
      },
      createdAt: runtime.logicalTime,
    });
    const site = runtime.createConstructionSite({
      targetKind: 'storage',
      stationId,
      transform: {
        position: gridPoint(136, 144),
        size: gridSize(4, 4),
        rotation: 0,
      },
      cost: [{ resourceId: asId('ironPlate'), quantity: 40 }],
    });
    runtime.traffic.stations
      .get('site:' + site.id + ':ironPlate')
      .buffer.add(20);
    runtime.advanceTo(6_000_000n);
    const requester = runtime.traffic.stations.get('fixture-request-55').buffer;
    requester.add(requester.freeSpace);
    runtime.advanceTo(16_000_000n);
    runtime.setTimeControl(true, 1);
  }
  await mkdir('benchmarks/generated', { recursive: true });
  await writeFile(
    large
      ? 'benchmarks/generated/world-large-v1.json'
      : visual
        ? 'benchmarks/generated/world-visual-v1.json'
        : 'benchmarks/generated/world-performance-v1.json',
    JSON.stringify({
      id: 'main',
      schemaVersion: 2,
      revision: runtime.revision,
      payload: stringifyExact(serializeWorldRuntime(runtime)),
    }),
  );
  console.log(
    `Prepared ${runtime.entities.size} entities, ${runtime.traffic.pods.size} pods.`,
  );
} finally {
  await server.close();
}
