import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { asId } from '../domain';
import type { WorldEntityId } from '../domain';
import { WorldRuntime, defaultWorldGenerationConfig } from '../world';
import { WorldBuildingInspector } from './WorldBuildingInspector';

describe('WorldBuildingInspector pod production', () => {
  it('shows queue progress and disables production at global capacity', () => {
    const runtime = WorldRuntime.generate({
      ...defaultWorldGenerationConfig('pod-inspector'),
      width: 64,
      height: 64,
      spawnClearingSize: 24,
    });
    const depotId = asId<WorldEntityId>('world-starter-depot');
    for (let index = 0; index < 6; index += 1)
      runtime.queuePodProduction(depotId);
    const snapshot = runtime.snapshot();
    const depot = snapshot.entities.find((entity) => entity.id === depotId)!;
    const html = renderToStaticMarkup(
      <WorldBuildingInspector
        entity={depot}
        snapshot={snapshot}
        onQueuePod={() => undefined}
        onCancelPod={() => undefined}
      />,
    );
    expect(html).toContain('Global capacity');
    expect(html).toContain('2 + 6 / 8');
    expect(html).toContain('6 order(s) queued');
    expect(html).toContain('Build pod');
    expect(html).toContain('Global pod capacity is full');
    expect(html).toContain('Cancel latest order');
  });
});
