import type { FactoryContract } from '../compiler';
import type { FactoryId } from '../domain';
import type { FactoryBlueprint, FactoryVersionRef } from '../editor';

export interface FactoryDefinition {
  readonly id: FactoryId;
  readonly name: string;
  readonly nextVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FactoryDraft {
  readonly factoryId: FactoryId;
  readonly baseVersion?: number;
  readonly blueprint: FactoryBlueprint;
  readonly autosavedAt: string;
}

export interface FactoryVersion extends FactoryVersionRef {
  readonly blueprint: FactoryBlueprint;
  readonly contract: FactoryContract;
  readonly publishedAt: string;
  readonly recovered?: boolean;
}

export interface FactoryDependency {
  readonly parent:
    FactoryVersionRef | { readonly factoryId: FactoryId; readonly draft: true };
  readonly child: FactoryVersionRef;
}

export const versionKey = (ref: FactoryVersionRef): string =>
  `${ref.factoryId}@${ref.version}`;
export const draftKey = (factoryId: FactoryId): string => `draft:${factoryId}`;

export const versionDependencies = (
  blueprint: FactoryBlueprint,
): readonly FactoryVersionRef[] => {
  const unique = new Map<string, FactoryVersionRef>();
  for (const node of blueprint.nodes.values())
    if (node.kind === 'sub-factory') {
      const ref = { factoryId: node.factoryId, version: node.version };
      unique.set(versionKey(ref), ref);
    }
  return [...unique.values()].sort((a, b) =>
    versionKey(a).localeCompare(versionKey(b)),
  );
};

export const versionsByKey = (
  versions: readonly FactoryVersion[],
): ReadonlyMap<string, FactoryVersion> =>
  new Map(versions.map((version) => [versionKey(version), version]));

/** Returns the shortest deterministic dependency path ending at targetFactoryId. */
export const dependencyPathToFactory = (
  start: FactoryVersionRef,
  targetFactoryId: FactoryId,
  versions: ReadonlyMap<string, FactoryVersion>,
): readonly FactoryVersionRef[] | undefined => {
  const pending: {
    readonly ref: FactoryVersionRef;
    readonly path: readonly FactoryVersionRef[];
  }[] = [{ ref: start, path: [start] }];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.shift()!;
    const key = versionKey(current.ref);
    if (visited.has(key)) continue;
    visited.add(key);
    if (current.ref.factoryId === targetFactoryId) return current.path;
    const version = versions.get(key);
    if (version === undefined) continue;
    for (const child of versionDependencies(version.blueprint))
      pending.push({ ref: child, path: [...current.path, child] });
  }
  return undefined;
};

export const wouldCreateIdentityCycle = (
  parentFactoryId: FactoryId,
  child: FactoryVersionRef,
  versions: ReadonlyMap<string, FactoryVersion>,
): readonly FactoryVersionRef[] | undefined =>
  dependencyPathToFactory(child, parentFactoryId, versions);

export interface DependencyDag {
  readonly versions: readonly FactoryVersionRef[];
  readonly edges: readonly {
    readonly parent: FactoryVersionRef;
    readonly child: FactoryVersionRef;
  }[];
}

export const buildDependencyDag = (
  root: FactoryVersionRef,
  versions: ReadonlyMap<string, FactoryVersion>,
): DependencyDag => {
  const nodes = new Map<string, FactoryVersionRef>();
  const edges = new Map<
    string,
    { parent: FactoryVersionRef; child: FactoryVersionRef }
  >();
  const pending = [root];
  while (pending.length > 0) {
    const parent = pending.shift()!;
    const parentKey = versionKey(parent);
    if (nodes.has(parentKey)) continue;
    nodes.set(parentKey, parent);
    const version = versions.get(parentKey);
    for (const child of version === undefined
      ? []
      : versionDependencies(version.blueprint)) {
      const childKey = versionKey(child);
      edges.set(`${parentKey}->${childKey}`, { parent, child });
      pending.push(child);
    }
  }
  return { versions: [...nodes.values()], edges: [...edges.values()] };
};

export const latestVersion = (
  factoryId: FactoryId,
  versions: readonly FactoryVersion[],
): FactoryVersion | undefined =>
  versions
    .filter((version) => version.factoryId === factoryId)
    .sort((a, b) => b.version - a.version)[0];
