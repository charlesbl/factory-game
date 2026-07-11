import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import {
  buildDependencyDag,
  draftKey,
  versionDependencies,
  versionKey,
  versionsByKey,
  type FactoryDefinition,
  type FactoryDraft,
  type FactoryVersion,
} from '../factories';

interface Props {
  readonly definitions: readonly FactoryDefinition[];
  readonly versions: readonly FactoryVersion[];
  readonly root: FactoryVersion | FactoryDraft;
}

export const FactoryDependencyGraph = ({
  definitions,
  versions,
  root,
}: Props) => {
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const versionIndex = versionsByKey(versions);
  const isPublished = 'version' in root;
  const rootId = isPublished ? versionKey(root) : draftKey(root.factoryId);
  const graphNodes = new Map<string, { readonly label: string }>();
  const graphEdges = new Map<
    string,
    { readonly source: string; readonly target: string }
  >();

  if (isPublished) {
    const graph = buildDependencyDag(root, versionIndex);
    for (const ref of graph.versions)
      graphNodes.set(versionKey(ref), {
        label: `${definitionById.get(ref.factoryId)?.name ?? ref.factoryId} · v${ref.version}`,
      });
    for (const edge of graph.edges)
      graphEdges.set(`${versionKey(edge.parent)}>${versionKey(edge.child)}`, {
        source: versionKey(edge.parent),
        target: versionKey(edge.child),
      });
  } else {
    graphNodes.set(rootId, {
      label: `${definitionById.get(root.factoryId)?.name ?? root.factoryId} · Draft`,
    });
    for (const dependency of versionDependencies(root.blueprint)) {
      const graph = buildDependencyDag(dependency, versionIndex);
      const dependencyId = versionKey(dependency);
      graphEdges.set(`${rootId}>${dependencyId}`, {
        source: rootId,
        target: dependencyId,
      });
      for (const ref of graph.versions)
        graphNodes.set(versionKey(ref), {
          label: `${definitionById.get(ref.factoryId)?.name ?? ref.factoryId} · v${ref.version}`,
        });
      for (const edge of graph.edges)
        graphEdges.set(`${versionKey(edge.parent)}>${versionKey(edge.child)}`, {
          source: versionKey(edge.parent),
          target: versionKey(edge.child),
        });
    }
  }

  const depth = new Map<string, number>([[rootId, 0]]);
  const pending: string[] = [rootId];

  while (pending.length > 0) {
    const parentId = pending.shift()!;
    const parentDepth = depth.get(parentId) ?? 0;
    for (const edge of [...graphEdges.values()].filter(
      (item) => item.source === parentId,
    )) {
      if (depth.has(edge.target)) continue;
      depth.set(edge.target, parentDepth + 1);
      pending.push(edge.target);
    }
  }

  const rows = new Map<number, number>();
  const nodes: Node[] = [...graphNodes].map(([id, data]) => {
    const x = (depth.get(id) ?? 0) * 260;
    const row = rows.get(x) ?? 0;
    rows.set(x, row + 1);
    return {
      id,
      position: { x, y: row * 130 },
      data,
      className: id === rootId ? 'dependency-root' : 'dependency-node',
    };
  });
  const edges: Edge[] = [...graphEdges].map(([id, edge]) => ({
    id,
    source: edge.source,
    target: edge.target,
    animated: false,
  }));

  return (
    <section
      className="version-dependency-graph"
      aria-label="Factory dependencies"
    >
      <h4>
        {isPublished ? 'Published dependency graph' : 'Draft dependency graph'}
      </h4>
      <div className="dependency-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </section>
  );
};
