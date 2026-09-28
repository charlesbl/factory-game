import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface WorldAsset {
  readonly id: string;
  readonly footprint: readonly [number, number];
  readonly animationParts: readonly string[];
  readonly lods: readonly {
    readonly url: string;
    readonly sha256: string;
    readonly triangles: number;
  }[];
  readonly thumbnail: { readonly url: string };
}
export interface WorldManifest {
  readonly schemaVersion: 1;
  readonly packVersion: string;
  readonly assets: readonly WorldAsset[];
}

export const worldAssetUrl = (relative: string) =>
  `${import.meta.env.BASE_URL}assets/world/${relative}`;

/** A bounded, deduplicated loader. Cache objects are immutable; clones own only transforms. */
export class AssetRegistry {
  readonly geometries = new Set<THREE.BufferGeometry>();
  readonly materials = new Set<THREE.Material>();
  readonly models = new Map<string, THREE.Group>();
  manifest: WorldManifest | undefined;
  private readonly loader = new GLTFLoader();
  private disposed = false;
  private readonly requests = new Map<string, Promise<THREE.Group>>();

  async load(onProgress: (loaded: number, total: number) => void = () => {}) {
    const response = await fetch(worldAssetUrl('manifest.json'));
    if (!response.ok)
      throw new Error(`World asset manifest unavailable (${response.status}).`);
    const manifest = (await response.json()) as WorldManifest;
    if (
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.assets) ||
      manifest.assets.length === 0
    )
      throw new Error('Unsupported or empty world asset manifest.');
    this.manifest = manifest;
    const queue = manifest.assets.flatMap((asset: WorldAsset) =>
      asset.lods.map((lod, index) => ({
        key: `${asset.id}:${index}`,
        url: lod.url,
      })),
    );
    let loaded = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (!this.disposed) {
          const next = queue.shift();
          if (!next) return;
          const model = await this.loadModel(next.url);
          if (this.disposed) return;
          this.models.set(next.key, model);
          onProgress(++loaded, manifest.assets.length * 3);
        }
      }),
    );
  }
  private loadModel(url: string) {
    let request = this.requests.get(url);
    if (!request) {
      request = this.loader.loadAsync(worldAssetUrl(url)).then(({ scene }) => {
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          this.geometries.add(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            this.materials.add(material);
        });
        if (this.disposed) this.disposeResources();
        return scene;
      });
      this.requests.set(url, request);
    }
    return request;
  }
  create(id: string, lod = 0) {
    return this.models.get(`${id}:${lod}`)?.clone(true);
  }
  private disposeResources() {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
  dispose() {
    this.disposed = true;
    this.disposeResources();
    this.models.clear();
  }
}
