import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { Matrix4, Quaternion, Vector3 } from 'three';

const root = resolve(process.argv[2] ?? 'public/assets/world');
const manifest = JSON.parse(
  readFileSync(resolve(root, 'manifest.json'), 'utf8'),
);
const recipes = JSON.parse(
  readFileSync('assets/world/recipes/pack-v1.json', 'utf8'),
);
const provenance = JSON.parse(
  readFileSync('assets/world/provenance.json', 'utf8'),
);
const artDirection = readFileSync('assets/world/art-direction.md', 'utf8');
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.up, '+Y');
assert.equal(manifest.front, '+Z');
assert.equal(manifest.blenderVersion, '4.5.0');
assert(
  /^\d+\.\d+\.\d+$/.test(manifest.packVersion ?? ''),
  'packVersion must be a semantic version string',
);
assert.equal(
  manifest.packVersion,
  provenance.packVersion,
  'packVersion must match assets/world/provenance.json',
);
assert.deepEqual(
  manifest.assets.map((a) => a.id).sort(),
  recipes.assets.map((a) => a.id).sort(),
);
const recipeById = new Map(recipes.assets.map((a) => [a.id, a]));
// assets/world/art-direction.md is the single source of truth for documented
// LOD1 budget exceptions: `| asset | lod0 | lod1 | reason |` rows under the
// `## LOD1 budget exceptions` heading, with counts matching the measured ones.
const exceptions = new Map();
{
  const section = artDirection.split(/^## LOD1 budget exceptions$/m)[1];
  assert(
    section !== undefined,
    'art-direction.md must contain a "## LOD1 budget exceptions" section',
  );
  for (const line of section.split(/^## /m)[0].split('\n')) {
    const row = line.match(
      /^\| *([a-z][a-z0-9-]*) *\| *(\d+) *\| *(\d+) *\| *(.+?) *\|$/,
    );
    if (row === null) continue;
    const [, id, lod0, lod1, reason] = row;
    assert(!exceptions.has(id), `Duplicate LOD1 exception: ${id}`);
    assert(recipeById.has(id), `LOD1 exception for unknown asset: ${id}`);
    assert(reason.length > 0, `LOD1 exception ${id} needs a reason`);
    exceptions.set(id, { lod0: Number(lod0), lod1: Number(lod1) });
  }
}
function checkBounds(value, label) {
  assert(value && typeof value === 'object', `${label}: missing bounds`);
  for (const key of ['min', 'max'])
    assert(
      Array.isArray(value[key]) &&
        value[key].length === 3 &&
        value[key].every(Number.isFinite),
      `${label}.${key}: expected three finite numbers`,
    );
  for (let axis = 0; axis < 3; axis++)
    assert(value.min[axis] <= value.max[axis], `${label}: min exceeds max`);
}
let total = 0;
let triangles = 0;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
function file(url) {
  assert.equal(typeof url, 'string');
  const path = resolve(root, url);
  assert(path.startsWith(root + sep), 'Asset path escapes the pack');
  assert(existsSync(path), `Missing asset: ${url}`);
  return readFileSync(path);
}
// Sources/provenance live at the build output root (the default pack root's
// parent); a scratch pack resolves them against its own output root as well.
const outputRoot = root.endsWith(`${sep}public${sep}assets${sep}world`)
  ? root.slice(0, -`${sep}public${sep}assets${sep}world`.length)
  : resolve('.');
function reference(url) {
  for (const base of [resolve('.'), outputRoot]) {
    const path = resolve(base, url);
    if (existsSync(path)) return path;
  }
  return undefined;
}
function parseGlb(data) {
  assert.equal(data.readUInt32LE(0), 0x46546c67, 'Not a GLB');
  assert.equal(data.readUInt32LE(4), 2);
  assert.equal(data.readUInt32LE(8), data.length);
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
  return { gltf, binary: data.subarray(28 + jsonLength) };
}
const forbiddenKeys = new Set([
  'extensions',
  'extensionsUsed',
  'extensionsRequired',
  'baseColorTexture',
  'normalTexture',
  'occlusionTexture',
  'emissiveTexture',
  'metallicRoughnessTexture',
]);
function scanJson(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanJson(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(
      !forbiddenKeys.has(key),
      `${path}.${key}: glTF extensions and texture slots are forbidden`,
    );
    if (key === 'textures' || key === 'images')
      assert(
        Array.isArray(child) && child.length === 0,
        `${path}.${key}: textures/images must be empty`,
      );
    scanJson(child, `${path}.${key}`);
  }
}
function accessor(gltf, binary, index) {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  assert(bytes && dimensions, 'Unsupported accessor');
  const reader = {
    5121: 'readUInt8',
    5123: 'readUInt16LE',
    5125: 'readUInt32LE',
    5126: 'readFloatLE',
  }[a.componentType];
  return Array.from({ length: a.count }, (_, i) =>
    Array.from({ length: dimensions }, (_, component) => {
      const value = binary[reader](
        (view.byteOffset ?? 0) +
          (a.byteOffset ?? 0) +
          i * (view.byteStride ?? dimensions * bytes) +
          component * bytes,
      );
      assert(Number.isFinite(value), 'Non-finite geometry attribute');
      return value;
    }),
  );
}
for (const asset of manifest.assets) {
  const recipe = recipeById.get(asset.id);
  assert(recipe !== undefined, `${asset.id}: missing recipe`);
  assert.equal(asset.lods.length, 3, `${asset.id}: missing LOD`);
  assert.deepEqual(
    asset.pivot,
    [0, 0, 0],
    `${asset.id}: pivot must be ground-centre`,
  );
  assert.equal(asset.front, '+Z', `${asset.id}: front must be +Z`);
  assert(
    Number.isInteger(asset.version) && asset.version >= 1,
    `${asset.id}: version must be a positive integer`,
  );
  assert.equal(
    asset.policy,
    recipe.policy,
    `${asset.id}: policy must match the recipe`,
  );
  checkBounds(asset.bounds, `${asset.id}.bounds`);
  checkBounds(asset.animationBounds, `${asset.id}.animationBounds`);
  for (const path of [asset.source, asset.recipe, asset.provenance])
    assert(reference(path), `Missing provenance/source: ${path}`);
  for (const [level, lod] of asset.lods.entries()) {
    const data = file(lod.url);
    total += data.length;
    assert.equal(sha256(data), lod.sha256, `${asset.id}: stale hash`);
    assert(
      lod.url.includes(lod.sha256.slice(0, 12)),
      'URL must contain content hash',
    );
    assert.equal(data.length, lod.bytes);
    assert(
      data.length <= (asset.footprint[0] >= 2 ? 250_000 : 75_000),
      `${asset.id}: download budget exceeded`,
    );
    const { gltf, binary } = parseGlb(data);
    scanJson(gltf, `${asset.id}:gltf`);
    assert(!gltf.cameras?.length, 'Unexpected camera');
    assert(
      (gltf.materials?.length ?? 0) <= 2,
      'Material budget exceeded (two material draw groups)',
    );
    assert.equal(
      lod.materials,
      gltf.materials?.length ?? 0,
      `${asset.id}: LOD${level} materials must match the GLB material count`,
    );
    for (const material of gltf.materials ?? []) {
      assert(
        !material.alphaMode || material.alphaMode === 'OPAQUE',
        'World assets must be opaque',
      );
    }
    let measuredTriangles = 0;
    const min = new Vector3(Infinity, Infinity, Infinity),
      max = new Vector3(-Infinity, -Infinity, -Infinity);
    function visit(index, parent) {
      const node = gltf.nodes[index];
      const values = [
        ...(node.translation ?? []),
        ...(node.rotation ?? []),
        ...(node.scale ?? []),
        ...(node.matrix ?? []),
      ];
      assert(
        values.every(Number.isFinite) &&
          (!node.matrix || node.matrix.length === 16),
        `${asset.id}: non-finite or malformed node transform`,
      );
      const local = node.matrix
        ? new Matrix4().fromArray(node.matrix)
        : new Matrix4().compose(
            new Vector3().fromArray(node.translation ?? [0, 0, 0]),
            new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
            new Vector3().fromArray(node.scale ?? [1, 1, 1]),
          );
      {
        const e = local.elements;
        const determinant =
          e[0] * (e[5] * e[10] - e[6] * e[9]) -
          e[4] * (e[1] * e[10] - e[2] * e[9]) +
          e[8] * (e[1] * e[6] - e[2] * e[5]);
        assert(
          determinant > 0,
          `${asset.id}: mirrored or degenerate node scale (determinant ${determinant})`,
        );
        const scale = new Vector3();
        local.decompose(new Vector3(), new Quaternion(), scale);
        assert(
          scale.x > 0 && scale.y > 0 && scale.z > 0,
          `${asset.id}: negative decomposed node scale`,
        );
      }
      const matrix = parent.clone().multiply(local);
      for (const primitive of node.mesh === undefined
        ? []
        : gltf.meshes[node.mesh].primitives) {
        assert(
          primitive.mode === undefined || primitive.mode === 4,
          'Expected triangles',
        );
        const positions = accessor(gltf, binary, primitive.attributes.POSITION);
        assert(primitive.attributes.NORMAL !== undefined, 'Missing normals');
        for (const normal of accessor(
          gltf,
          binary,
          primitive.attributes.NORMAL,
        ))
          assert(Math.abs(Math.hypot(...normal) - 1) < 0.02, 'Invalid normal');
        measuredTriangles +=
          (primitive.indices === undefined
            ? positions.length
            : gltf.accessors[primitive.indices].count) / 3;
        for (const position of positions) {
          const p = new Vector3().fromArray(position).applyMatrix4(matrix);
          min.min(p);
          max.max(p);
        }
      }
      for (const child of node.children ?? []) visit(child, matrix);
    }
    for (const index of gltf.scenes[gltf.scene ?? 0].nodes) {
      const node = gltf.nodes[index];
      const rotation = node.rotation ?? [0, 0, 0, 1];
      assert(
        !node.matrix
          ? rotation.every(Number.isFinite) &&
              Math.hypot(rotation[0], rotation[1], rotation[2]) < 1e-6 &&
              Math.abs(Math.abs(rotation[3]) - 1) < 1e-6
          : (() => {
              const q = new Quaternion();
              new Matrix4()
                .fromArray(node.matrix)
                .decompose(new Vector3(), q, new Vector3());
              return Math.hypot(q.x, q.y, q.z) < 1e-6;
            })(),
        `${asset.id}: root node rotation must be identity`,
      );
      visit(index, new Matrix4());
    }
    assert.equal(
      measuredTriangles,
      lod.triangles,
      `${asset.id}: triangle metadata mismatch`,
    );
    assert(
      measuredTriangles <= asset.budget,
      `${asset.id}: triangle budget exceeded (${measuredTriangles})`,
    );
    const tolerance = 0.002;
    assert(
      min.x >= -asset.footprint[0] / 2 - tolerance &&
        max.x <= asset.footprint[0] / 2 + tolerance &&
        min.z >= -asset.footprint[1] / 2 - tolerance &&
        max.z <= asset.footprint[1] / 2 + tolerance,
      `${asset.id}: footprint overflow`,
    );
    if (asset.id === 'terrain-surface')
      assert(
        Math.abs(max.y) < 0.001,
        `terrain-surface: top face must sit flush at Y=0 (got ${max.y})`,
      );
    else
      assert(
        Math.abs(min.y) < 0.001,
        `${asset.id}: ground-centre pivot requires the base at Y≈0 (got ${min.y})`,
      );
    for (let i = 0; i < 3; i++) {
      assert(Math.abs(min.getComponent(i) - lod.bounds.min[i]) < tolerance);
      assert(Math.abs(max.getComponent(i) - lod.bounds.max[i]) < tolerance);
    }
    if (level === 0) {
      triangles += measuredTriangles;
      for (const name of [
        ...asset.animationParts,
        ...Object.keys(asset.sockets),
      ])
        assert(
          gltf.nodes.some((node) => node.name === name),
          `${asset.id}: missing ${name}`,
        );
    }
  }
  const [lod0, lod1] = asset.lods;
  const exception = exceptions.get(asset.id);
  if (exception !== undefined) {
    assert.equal(
      exception.lod0,
      lod0.triangles,
      `${asset.id}: art-direction exception records lod0 ${exception.lod0} but the pack has ${lod0.triangles}`,
    );
    assert.equal(
      exception.lod1,
      lod1.triangles,
      `${asset.id}: art-direction exception records lod1 ${exception.lod1} but the pack has ${lod1.triangles}`,
    );
  } else {
    assert(
      lod1.triangles * 5 <= lod0.triangles * 2,
      `${asset.id}: LOD1 ${lod1.triangles} exceeds 40% of LOD0 ${lod0.triangles} (max ${Math.floor(lod0.triangles * 0.4)}); reduce it or document an exception in assets/world/art-direction.md`,
    );
  }
  const thumbnail = file(asset.thumbnail.url);
  total += thumbnail.length;
  assert.equal(sha256(thumbnail), asset.thumbnail.sha256);
  assert(
    Number.isInteger(asset.thumbnail.width) &&
      Number.isInteger(asset.thumbnail.height),
    `${asset.id}: thumbnail width/height must be integers`,
  );
  assert.equal(
    asset.thumbnail.width,
    thumbnail.readUInt32BE(16),
    `${asset.id}: thumbnail width must match the PNG`,
  );
  assert.equal(
    asset.thumbnail.height,
    thumbnail.readUInt32BE(20),
    `${asset.id}: thumbnail height must match the PNG`,
  );
  assert.equal(
    asset.thumbnail.width,
    256,
    `${asset.id}: thumbnails are 256 square`,
  );
  assert.equal(
    asset.thumbnail.height,
    256,
    `${asset.id}: thumbnails are 256 square`,
  );
  assert.equal(asset.thumbnail.scale, 6.3);
}
assert(total <= 15_000_000, 'Full pack exceeds initial download budget');
console.log(
  `Validated ${manifest.assets.length} assets, ${manifest.assets.length * 3} GLBs, ${triangles} LOD0 triangles, ${(total / 1_000_000).toFixed(2)} MB before compression.`,
);
