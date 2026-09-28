import * as THREE from 'three';

/** World-space chunk broad phase; moving pods are maintained separately. */
export class SpatialPicking {
  private buckets: { bounds: THREE.Box3; objects: THREE.Object3D[] }[] = [];
  private dynamic: THREE.Object3D[] = [];
  rebuild(objects: readonly THREE.Object3D[]) {
    const chunks = new Map<
      string,
      { bounds: THREE.Box3; objects: THREE.Object3D[] }
    >();
    this.dynamic = [];
    for (const object of objects) {
      if (object.userData.worldPick?.kind === 'pod') {
        this.dynamic.push(object);
        continue;
      }
      object.updateWorldMatrix(true, false);
      const bounds = new THREE.Box3().setFromObject(object);
      for (
        let x = Math.floor(bounds.min.x / 32);
        x <= Math.floor(bounds.max.x / 32);
        x++
      )
        for (
          let z = Math.floor(bounds.min.z / 32);
          z <= Math.floor(bounds.max.z / 32);
          z++
        ) {
          const key = `${x}:${z}`;
          const bucket = chunks.get(key) ?? {
            bounds: new THREE.Box3(),
            objects: [],
          };
          bucket.bounds.union(bounds);
          bucket.objects.push(object);
          chunks.set(key, bucket);
        }
    }
    this.buckets = [...chunks.values()];
  }
  candidates(ray: THREE.Ray, tolerance: number) {
    const found = new Set<THREE.Object3D>();
    for (const bucket of this.buckets)
      if (ray.intersectsBox(bucket.bounds.clone().expandByScalar(tolerance)))
        for (const object of bucket.objects) found.add(object);
    for (const object of this.dynamic) {
      object.updateWorldMatrix(true, false);
      if (
        ray.intersectsBox(
          new THREE.Box3().setFromObject(object).expandByScalar(tolerance),
        )
      )
        found.add(object);
    }
    return [...found];
  }
}

export function segmentDistance(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
