import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173');
  const result = await page.evaluate(async () => {
    const { WorldClient } = await import('/src/world/client.ts');
    const { WorldRuntime } = await import('/src/world/runtime.ts');
    const { defaultWorldGenerationConfig } =
      await import('/src/world/model.ts');
    const { serializeWorldRuntime } =
      await import('/src/world/serialization.ts');
    const { compileBlueprint, serializeContract } =
      await import('/src/compiler/index.ts');
    const { createDemoBlueprint } = await import('/src/ui/demo-blueprint.ts');
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('world-lifecycle-review'),
      width: 64,
      height: 64,
    });
    runtime.world.grid.terrain.fill(0);
    runtime.world.grid.oreKinds.fill(0);
    runtime.world.grid.oreRemaining.fill(0);
    const station = (id, x, y) => {
      const node = runtime.placeControlNode('station', { x, y });
      runtime.place({
        id,
        kind: 'station',
        stationId: id,
        railNodeId: node.id,
        transform: {
          position: { x, y },
          size: { width: 2, height: 2 },
          rotation: 0,
        },
        createdAt: 0n,
      });
      return node;
    };
    const provider = station('review-provider', 8, 20),
      target = station('review-target', 10, 18);
    // Node positions are hookup cells; route the L through a cardinal bend.
    const bend = { x: provider.position.x, y: target.position.y };
    runtime.placeRailPath([provider.position, bend, target.position]);
    runtime.placeRailPath([target.position, bend, provider.position]);
    const storage = runtime.createConstructionSite({
      targetKind: 'storage',
      stationId: 'review-provider',
      cost: [],
      transform: {
        position: { x: 8, y: 22 },
        size: { width: 4, height: 4 },
        rotation: 0,
      },
    });
    runtime.storageInventories.get(storage.id).add('circuit', 100);
    runtime.storageInventories.get(storage.id).add('ironOre', 100);
    runtime.configureStation(storage.id, 'ironOre', 'provide', 0, 0);
    runtime.configureStation(storage.id, 'circuit', 'provide', 0, 0);
    const contract = compileBlueprint(createDemoBlueprint());
    const factory = runtime.createConstructionSite({
      targetKind: 'factory',
      stationId: 'review-target',
      cost: [],
      factoryId: 'review-original',
      instanceId: 'review-original',
      contract: serializeContract(contract),
      transform: {
        position: { x: 8, y: 10 },
        size: contract.footprint,
        rotation: 0,
      },
    });
    runtime.addTrafficStation({
      id: 'review-depot',
      railNodeId: target.id,
      role: 'depot',
      priority: 0,
      target: 0,
      minBatch: 0,
      maxBatch: 0,
      depotCapacity: 2,
    });
    runtime.addPod('review-pod', target.id, 'review-depot');
    const client = new WorldClient();
    const assert = (value, message) => {
      if (!value) throw Error(message);
    };
    try {
      await client.load(serializeWorldRuntime(runtime));
      const replaced = await client.command({
        type: 'REPLACE_FACTORY',
        entityId: factory.id,
        position: factory.transform.position,
        size: contract.footprint,
        rotation: 0,
        cost: [{ resourceId: 'circuit', quantity: 40 }],
        factoryId: 'review-replacement',
        instanceId: 'review-replacement',
        contract: serializeContract(contract),
      });
      const site = replaced.snapshot.entities.find(
        (e) =>
          e.kind === 'construction-site' &&
          e.transform.position.x === 8 &&
          e.transform.position.y === 10,
      );
      assert(site, 'Replacement did not create accepted construction');
      assert(
        replaced.snapshot.entities.find((e) => e.id === 'review-target')
          .linkedEntityId === site.id,
        'Replacement lost its station',
      );
      let moving, last;
      for (let time = 1; time <= 400; time++) {
        const next = await client.advance(BigInt(time) * 100_000n);
        last = next.snapshot;
        moving = next.snapshot.pods.find(
          (p) =>
            p.cargo &&
            p.state === 'TO_REQUESTER' &&
            next.snapshot.missions.some(
              (m) =>
                m.id === p.missionId &&
                m.requesterId === 'site:' + site.id + ':circuit',
            ),
        );
        if (moving) break;
      }
      assert(
        moving,
        'Expected real materials in transit to construction: ' +
          JSON.stringify(
            {
              pods: last.pods,
              missions: last.missions,
              stations: last.stations,
            },
            (_, v) => (typeof v === 'bigint' ? v.toString() : v),
          ),
      );
      const cancelled = await client.command({
        type: 'CANCEL_CONSTRUCTION',
        siteId: site.id,
      });
      assert(
        cancelled.snapshot.entities.find((e) => e.id === site.id)?.state ===
          'EVACUATING',
        'Cancelled site disappeared before its in-flight delivery arrived',
      );
      assert(
        cancelled.snapshot.pods.find((p) => p.id === moving.id)?.cargo
          ?.quantity === moving.cargo.quantity,
        'Cancel changed in-flight cargo',
      );
      const checkpoint = await client.save();
      const restored = await client.load(checkpoint.state);
      assert(
        restored.snapshot.entities.some((e) => e.id === site.id),
        'Evacuating site was not restored',
      );
      await client.command({
        type: 'CONFIGURE_STATION',
        entityId: storage.id,
        resourceId: 'circuit',
        mode: 'request',
        target: 100,
        priority: 0,
      });
      const completed = await client.advance(100_000_000n);
      assert(
        !completed.snapshot.entities.some((e) => e.id === site.id),
        'Cancellation did not finish evacuation: ' +
          JSON.stringify(completed.snapshot, (_, v) =>
            typeof v === 'bigint'
              ? v.toString()
              : v instanceof Int32Array ||
                  v instanceof Uint8Array ||
                  v instanceof Uint32Array
                ? []
                : v,
          ),
      );
      assert(
        completed.snapshot.buildings
          .find((b) => b.entityId === storage.id)
          .inventory.items.find((i) => i.resourceId === 'circuit').quantity ===
          100,
        'Cancel lost or duplicated materials',
      );
      const built = await client.command({
        type: 'CREATE_SITE',
        targetKind: 'factory',
        position: factory.transform.position,
        size: contract.footprint,
        rotation: 0,
        stationId: 'review-target',
        cost: [],
        factoryId: 'review-dismantle',
        instanceId: 'review-dismantle',
        contract: serializeContract(contract),
      });
      const builtFactory = built.snapshot.entities.find(
        (e) => e.kind === 'factory' && e.factoryId === 'review-dismantle',
      );
      let incoming;
      for (let time = 1001; time < 1200; time++) {
        const next = await client.advance(BigInt(time) * 100_000n);
        incoming = next.snapshot.pods.find(
          (p) =>
            p.cargo &&
            p.state === 'TO_REQUESTER' &&
            next.snapshot.missions.some(
              (m) =>
                m.id === p.missionId &&
                m.requesterId ===
                  'factory-input:' + builtFactory.id + ':ironOre',
            ),
        );
        if (incoming) break;
      }
      assert(incoming, 'Expected input delivery before dismantling');
      const dismantled = await client.command({
        type: 'DISMANTLE_ENTITY',
        entityId: builtFactory.id,
      });
      assert(
        dismantled.snapshot.stations.some(
          (s) => s.id === 'factory-input:' + builtFactory.id + ':ironOre',
        ),
        'Dismantle removed an incoming delivery address',
      );
      const duringRecovery = await client.save();
      await client.load(duringRecovery.state);
      for (const [resourceId, target] of [
        ['ironOre', 100],
        ...contract.billOfMaterials.map((i) => [i.resourceId, i.quantity * 2]),
      ]) {
        await client.command({
          type: 'CONFIGURE_STATION',
          entityId: storage.id,
          resourceId,
          mode: 'request',
          target,
          priority: 0,
        });
      }
      const recovered = await client.advance(200_000_000n);
      assert(
        !recovered.snapshot.entities.some((e) => e.id === builtFactory.id),
        'Dismantle did not complete',
      );
      const recoveredItems = recovered.snapshot.buildings.find(
        (b) => b.entityId === storage.id,
      ).inventory.items;
      assert(
        recoveredItems.find((i) => i.resourceId === 'ironOre').quantity === 100,
        'Dismantle lost incoming cargo',
      );
      for (const item of contract.billOfMaterials)
        assert(
          recoveredItems.find((i) => i.resourceId === item.resourceId)
            ?.quantity ===
            item.quantity * 2,
          'Salvage material conservation failed',
        );
      assert(
        !recovered.snapshot.stations.some((s) => s.id.startsWith('salvage:')),
        'Completed salvage stations leaked',
      );
      return {
        dismantledDuringTransit: true,
        exactRecoveryAfterReload: true,
        replacement: true,
        stationPreserved: true,
        inFlightCargo: moving.cargo.quantity,
        cancelledDuringTransit: true,
        checkpointRestored: true,
        evacuationCompleted: true,
      };
    } finally {
      client.dispose();
    }
  });
  await writeFile(
    'docs/world-command-review-results.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
