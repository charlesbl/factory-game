import * as THREE from 'three';

interface Batch {
  readonly mesh: THREE.InstancedMesh;
  readonly slots: string[];
  readonly byId: Map<string, number>;
  readonly sources: THREE.Mesh[];
}

/** Chunk-local immutable mesh parts with explicit persistent identity maps. */
export class InstancePool {
  readonly root = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly matrix = new THREE.Matrix4();
  private readonly staticParts = new WeakMap<
    THREE.Group,
    { id: string; mesh: THREE.Mesh; matrix: THREE.Matrix4 }[]
  >();

  rebuild(
    entries: readonly {
      readonly id: string;
      readonly chunk: string;
      readonly group: THREE.Group;
    }[],
    dynamic = false,
  ) {
    this.clear();
    const parts = new Map<
      string,
      { id: string; mesh: THREE.Mesh; matrix: THREE.Matrix4 }[]
    >();
    for (const entry of entries) {
      entry.group.updateMatrixWorld(true);
      let collected = dynamic ? undefined : this.staticParts.get(entry.group);
      if (!collected) {
        collected = [];
        let partIndex = 0;
        entry.group.traverse((object) => {
          if (
            !(object instanceof THREE.Mesh) ||
            object.userData.worldPick ||
            object.userData.dynamic ||
            Array.isArray(object.material)
          )
            return;
          collected!.push({
            id: entry.id + ':' + object.name + ':' + partIndex++,
            mesh: object,
            matrix: object.matrixWorld.clone(),
          });
          object.visible = false;
        });
        if (!dynamic) {
          this.staticParts.set(entry.group, collected);
          // The batch now owns static transforms. Remove their source tree from
          // frame traversal; keep animated parts, lines and picking proxies.
          for (const part of collected) part.mesh.removeFromParent();
          const prune = (object: THREE.Object3D) => {
            for (const child of [...object.children]) {
              prune(child);
              if (
                !child.children.length &&
                !(child instanceof THREE.Mesh) &&
                !(child instanceof THREE.LineSegments) &&
                !child.userData.dynamic &&
                !child.name.startsWith('socket_')
              )
                child.removeFromParent();
            }
          };
          prune(entry.group);
        }
      }
      for (const part of collected) {
        const key =
          entry.chunk +
          ':' +
          part.mesh.geometry.uuid +
          ':' +
          (part.mesh.material as THREE.Material).uuid;
        const list = parts.get(key) ?? [];
        list.push(part);
        parts.set(key, list);
      }
    }
    for (const [key, list] of parts) {
      const source = list[0]!.mesh;
      const mesh = new THREE.InstancedMesh(
        source.geometry,
        source.material,
        list.length,
      );
      mesh.castShadow = source.castShadow;
      mesh.receiveShadow = source.receiveShadow;
      const slots: string[] = [];
      const byId = new Map<string, number>();
      list.forEach((part, slot) => {
        mesh.setMatrixAt(slot, part.matrix);
        slots.push(part.id);
        byId.set(part.id, slot);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      mesh.userData.instanceIdentities = slots;
      this.batches.set(key, {
        mesh,
        slots,
        byId,
        sources: dynamic ? list.map((part) => part.mesh) : [],
      });
    }
  }
  update() {
    for (const { mesh, sources } of this.batches.values()) {
      sources.forEach((source, slot) => {
        this.matrix.copy(source.matrixWorld);
        if (source.userData.instanceVisible === false)
          this.matrix.scale(new THREE.Vector3(0, 0, 0));
        mesh.setMatrixAt(slot, this.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
  resolve(mesh: THREE.InstancedMesh, slot: number): string | undefined {
    return (mesh.userData.instanceIdentities as string[] | undefined)?.[slot];
  }
  removeIdentity(id: string) {
    for (const [key, batch] of this.batches)
      if (batch.byId.has(id)) this.remove(key, id);
  }
  remove(key: string, id: string) {
    const batch = this.batches.get(key);
    const slot = batch?.byId.get(id);
    if (!batch || slot === undefined) return;
    const last = batch.mesh.count - 1;
    if (slot !== last) {
      const movedId = batch.slots[last]!;
      batch.mesh.getMatrixAt(last, this.matrix);
      batch.mesh.setMatrixAt(slot, this.matrix);
      batch.slots[slot] = movedId;
      batch.byId.set(movedId, slot);
      if (batch.sources.length) batch.sources[slot] = batch.sources[last]!;
    }
    batch.slots.pop();
    batch.sources.pop();
    batch.byId.delete(id);
    batch.mesh.count -= 1;
    batch.mesh.instanceMatrix.needsUpdate = true;
    batch.mesh.computeBoundingSphere();
  }
  clear() {
    for (const { mesh } of this.batches.values()) mesh.dispose();
    this.root.clear();
    this.batches.clear();
  }
}
