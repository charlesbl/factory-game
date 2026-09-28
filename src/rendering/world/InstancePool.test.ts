import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { InstancePool } from './InstancePool';
import { SpatialPicking, segmentDistance } from './SpatialPicking';

describe('render identity and picking', () => {
  it('keeps the moved neighbour identity and matrix when removing a batch slot', () => {
    const pool = new InstancePool(),
      geometry = new THREE.BoxGeometry(),
      material = new THREE.MeshBasicMaterial();
    const entries = ['first', 'middle', 'last'].map((id, index) => {
      const group = new THREE.Group();
      group.position.x = index * 3;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'body';
      group.add(mesh);
      return { id, group, chunk: '0:0' };
    });
    pool.rebuild(entries);
    const batch = pool.root.children[0] as THREE.InstancedMesh;
    pool.removeIdentity('middle:body:0');
    expect(batch.count).toBe(2);
    expect(pool.resolve(batch, 1)).toBe('last:body:0');
    const matrix = new THREE.Matrix4();
    batch.getMatrixAt(1, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBe(6);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(6, 0, 5),
      new THREE.Vector3(0, 0, -1),
    );
    const hit = ray.intersectObject(batch)[0]!;
    expect(pool.resolve(batch, hit.instanceId!)).toBe('last:body:0');
    pool.clear();
    geometry.dispose();
    material.dispose();
  });
  it('culls distant chunks and measures rail tolerance in screen pixels', () => {
    const index = new SpatialPicking();
    const near = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const far = near.clone();
    far.position.x = 1000;
    index.rebuild([near, far]);
    expect(
      index.candidates(
        new THREE.Ray(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)),
        0.1,
      ),
    ).toEqual([near]);
    expect(segmentDistance(15, 6, 0, 0, 30, 0)).toBe(6);
    expect(segmentDistance(34, 3, 0, 0, 30, 0)).toBe(5);
    near.geometry.dispose();
    (near.material as THREE.Material).dispose();
  });
  it('dismantles only the picked identity after a mid-batch removal compacts the pool', () => {
    const pool = new InstancePool(),
      geometry = new THREE.BoxGeometry(),
      material = new THREE.MeshBasicMaterial();
    const entries = ['former-a', 'former-b', 'former-c'].map((id, index) => {
      const group = new THREE.Group();
      group.position.x = index * 3;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'body';
      group.add(mesh);
      return { id, group, chunk: '0:0' };
    });
    pool.rebuild(entries);
    const batch = pool.root.children[0] as THREE.InstancedMesh;
    pool.removeIdentity('former-b:body:0');
    expect(batch.count).toBe(2);
    // The moved neighbour is picked at its matrix position; identity follows
    // the instance so a dismantle can never hit the wrong building.
    const ray = new THREE.Raycaster(
      new THREE.Vector3(6, 0, 5),
      new THREE.Vector3(0, 0, -1),
    );
    const hit = ray.intersectObject(batch)[0]!;
    const picked = pool.resolve(batch, hit.instanceId!)!;
    expect(picked).toBe('former-c:body:0');
    pool.removeIdentity(picked);
    expect(batch.count).toBe(1);
    expect(pool.resolve(batch, 0)).toBe('former-a:body:0');
    pool.clear();
    geometry.dispose();
    material.dispose();
  });
});
