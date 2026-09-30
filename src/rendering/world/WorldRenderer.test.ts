import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WorldRenderer } from './WorldRenderer';

describe('world renderer resource lifecycle', () => {
  it('disposes detached instanced meshes to release instance buffers', () => {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      2,
    );
    const dispose = vi.spyOn(mesh, 'dispose');
    const root = new THREE.Group();
    root.add(mesh);
    const renderer = {
      geometry: {},
      assets: { geometries: new Set(), materials: new Set() },
      materials: {},
    } as unknown as WorldRenderer;
    const disposeDetached = (
      WorldRenderer.prototype as unknown as {
        disposeDetached: (root: THREE.Object3D) => void;
      }
    ).disposeDetached;

    disposeDetached.call(renderer, root);

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('does not reapply an unchanged quality mode', () => {
    const applyQuality = vi.fn();
    const renderer = {
      qualityMode: 'high',
      applyQuality,
      lastQualityCheck: 0,
    } as unknown as WorldRenderer;

    WorldRenderer.prototype.setQuality.call(renderer, 'high');

    expect(applyQuality).not.toHaveBeenCalled();
  });

  it('applies the initial quality mode', () => {
    const applyQuality = vi.fn();
    const renderer = {
      qualityMode: undefined,
      applyQuality,
    } as unknown as WorldRenderer;

    WorldRenderer.prototype.setQuality.call(renderer, 'standard');

    expect(applyQuality).toHaveBeenCalledWith('standard');
  });
});
