import { launchWorldBrowser } from './world-browser.mjs';
import { writeFile } from 'node:fs/promises';
const browser = await launchWorldBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 2,
  });
  await page.goto('http://127.0.0.1:5173');
  const results = await page.evaluate(async () => {
    const { WorldRenderer } =
      await import('/src/rendering/world/WorldRenderer.ts');
    const { createReviewFixture } =
      await import('/src/world/review-fixture.ts');
    const { occupiedCells } = await import('/src/world/placement.ts');
    const { Box3, Vector3 } =
      await import('/node_modules/three/build/three.module.js');
    const { runtime } = createReviewFixture();
    runtime.setTimeControl(true, 1);
    const base = runtime.snapshot();
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '100' });
    document.body.append(host);
    let renderer;
    await new Promise((resolve, reject) => {
      renderer = new WorldRenderer(host, base, {
        onSelect() {},
        onSelectEntity() {},
        onHover() {},
        onReady: resolve,
        onAssetError: reject,
      });
    });
    renderer.setQuality('high');
    renderer.zoom(0.2);
    const frame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    const assert = (condition, message) => {
      if (!condition) throw Error(message);
    };
    const rotations = [];
    let entity;
    for (const [width, height] of [
      [1, 1],
      [4, 2],
      [2, 25],
      [25, 2],
    ])
      for (const rotation of [0, 1, 2, 3]) {
        entity = {
          id: 'review-factory',
          kind: 'factory',
          factoryId: 'review',
          instanceId: 'review',
          stationId: 'review',
          state: 'ACTIVE',
          createdAt: 0n,
          transform: {
            position: { x: 20, y: 20 },
            size: { width, height },
            rotation,
          },
        };
        const snapshot = {
          ...base,
          revision: base.revision + rotation + 1,
          entities: [...base.entities, entity],
        };
        renderer.setSnapshot(snapshot);
        renderer.setTransient({
          activeTool: 'factory',
          selectedEntityId: entity.id,
          ghost: { kind: 'factory', transform: entity.transform, valid: false },
        });
        renderer.focus({
          x: 20 + (rotation % 2 ? height : width) / 2 - 0.5,
          y: 20 + (rotation % 2 ? width : height) / 2 - 0.5,
        });
        await frame();
        renderer.scene.updateMatrixWorld(true);
        const cells = occupiedCells(entity.transform);
        const expected = {
          minX: Math.min(...cells.map((p) => p.x)),
          maxX: Math.max(...cells.map((p) => p.x)) + 1,
          minZ: Math.min(...cells.map((p) => p.y)),
          maxZ: Math.max(...cells.map((p) => p.y)) + 1,
        };
        const bounds = new Box3();
        let parts = 0;
        renderer.scene.traverse((object) => {
          if (!object.isInstancedMesh) return;
          object.userData.instanceIdentities?.forEach((id, slot) => {
            if (!id.startsWith('review-factory:')) return;
            const matrix = object.matrix.clone();
            object.getMatrixAt(slot, matrix);
            object.geometry.computeBoundingBox();
            bounds.union(
              object.geometry.boundingBox.clone().applyMatrix4(matrix),
            );
            parts++;
          });
        });
        assert(parts > 5, 'Expected an assembled factory kit');
        assert(
          bounds.min.x >= expected.minX - 0.001 &&
            bounds.max.x <= expected.maxX + 0.001 &&
            bounds.min.z >= expected.minZ - 0.001 &&
            bounds.max.z <= expected.maxZ + 0.001,
          'Factory assembly outside occupancy',
        );
        const ghostBounds = new Box3().setFromObject(renderer.ghostGroup);
        assert(
          ghostBounds.min.x >= expected.minX - 0.001 &&
            ghostBounds.max.x <= expected.maxX + 0.001 &&
            ghostBounds.min.z >= expected.minZ - 0.001 &&
            ghostBounds.max.z <= expected.maxZ + 0.001,
          'Ghost outside occupancy',
        );
        const projected = new Vector3(
          (expected.minX + expected.maxX) / 2,
          1,
          (expected.minZ + expected.maxZ) / 2,
        ).project(renderer.camera);
        const rect = renderer.renderer.domElement.getBoundingClientRect();
        const pick = renderer.pick(
          rect.left + ((projected.x + 1) * rect.width) / 2,
          rect.top + ((1 - projected.y) * rect.height) / 2,
        );
        assert(
          pick?.id === entity.id,
          'High-DPI picking disagrees: ' +
            JSON.stringify({ width, height, rotation, pick, projected }),
        );
        assert(
          [...renderer.assets.materials].every(
            (m) => !m.transparent && m.opacity === 1,
          ),
          'Ghost changed cached materials',
        );
        const socket = renderer.entityDraws
          .get(entity.id)
          .group.getObjectByName('socket_loading');
        assert(socket, 'Missing assembled loading socket');
        const socketPosition = socket.getWorldPosition(new Vector3());
        assert(
          socketPosition.x >= expected.minX &&
            socketPosition.x <= expected.maxX &&
            socketPosition.z >= expected.minZ &&
            socketPosition.z <= expected.maxZ,
          'Rotated socket outside footprint',
        );
        rotations.push({
          rotation,
          footprint: [width, height],
          socket: socketPosition.toArray(),
          expected,
          bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
          parts,
          pick,
        });
      }
    const sameGroup = renderer.entityDraws.get(entity.id).group;
    for (let i = 0; i < 10; i++)
      renderer.setSnapshot({
        ...renderer.snapshot,
        revision: renderer.snapshot.revision + 1,
      });
    assert(
      renderer.entityDraws.get(entity.id).group === sameGroup,
      'Dynamic snapshots rebuilt static assembly',
    );
    renderer.focus({ x: 0, y: 0 });
    await frame();
    const outside = new Vector3(-1, 0, -1).project(renderer.camera),
      rect = renderer.renderer.domElement.getBoundingClientRect();
    assert(
      renderer.pointAt(
        rect.left + ((outside.x + 1) * rect.width) / 2,
        rect.top + ((1 - outside.y) * rect.height) / 2,
      ) === undefined,
      'Outside hit clamped into map',
    );
    renderer.setTransient({ activeTool: 'select' });
    const reloads = [];
    for (let i = 0; i < 5; i++) {
      renderer.setSnapshot({ ...base, worldId: base.worldId + ':' + i });
      await frame();
      reloads.push({
        geometries: renderer.renderer.info.memory.geometries,
        textures: renderer.renderer.info.memory.textures,
        objects: renderer.scene.children.length,
      });
    }
    assert(
      reloads.every(
        (r) =>
          r.geometries === reloads[0].geometries &&
          r.textures === reloads[0].textures,
      ),
      'GPU resource count grows after world reload',
    );
    let frames = 0;
    renderer.scene.onBeforeRender = () => frames++;
    host.style.display = 'none';
    await new Promise((resolve) => setTimeout(resolve, 100));
    const beforeHidden = frames;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(frames === beforeHidden, 'Hidden viewport still renders');
    host.style.display = 'block';
    for (let i = 0; i < 30 && frames === beforeHidden; i++) await frame();
    assert(frames > beforeHidden, 'Visible viewport did not resume');
    const drawingRatio = renderer.renderer.domElement.width / host.clientWidth;
    renderer.dispose();
    let lateReady = false;
    const late = new WorldRenderer(host, base, {
      onSelect() {},
      onSelectEntity() {},
      onHover() {},
      onReady() {
        lateReady = true;
      },
    });
    late.dispose();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert(
      !lateReady &&
        host.querySelectorAll('canvas').length === 0 &&
        late.assets.geometries.size === 0,
      'Late load survived renderer disposal',
    );
    host.remove();
    return {
      rotations,
      drawingRatio,
      reloads,
      unchangedTopology: true,
      outsideHitRejected: true,
      hiddenResume: true,
      lateLoadDisposed: true,
    };
  });
  await writeFile(
    'docs/world-renderer-review-results.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
/* global document, requestAnimationFrame */
