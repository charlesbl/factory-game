import { useState } from 'react'
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react'
import type { FactoryId } from '../domain'
import type { FactoryVersionRef } from '../editor'
import { buildDependencyDag, latestVersion, versionKey, versionsByKey, type FactoryDefinition, type FactoryVersion } from '../factories'

interface Props { readonly definitions: readonly FactoryDefinition[]; readonly versions: readonly FactoryVersion[] }

export const FactoryDependencyView = ({ definitions, versions }: Props) => {
  const publishedDefinitions = definitions.filter((definition) => latestVersion(definition.id, versions) !== undefined)
  const [factoryId, setFactoryId] = useState<FactoryId | undefined>(() => publishedDefinitions[0]?.id)
  const available = versions.filter((version) => version.factoryId === factoryId).sort((a, b) => b.version - a.version)
  const [requestedVersion, setRequestedVersion] = useState<number | undefined>()
  const root = available.find((version) => version.version === requestedVersion) ?? available[0]
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]))
  const graph = root === undefined ? undefined : buildDependencyDag(root, versionsByKey(versions))
  const depth = new Map<string, number>()
  if (graph !== undefined) {
    depth.set(versionKey(root!), 0); const pending: FactoryVersionRef[] = [root!]
    while (pending.length > 0) { const parent = pending.shift()!; const parentDepth = depth.get(versionKey(parent)) ?? 0; for (const edge of graph.edges.filter((item) => versionKey(item.parent) === versionKey(parent))) { const key = versionKey(edge.child); if (depth.has(key)) continue; depth.set(key, parentDepth + 1); pending.push(edge.child) } }
  }
  const nodes: Node[] = (() => {
    if (graph === undefined) return []
    const rows = new Map<number, number>()
    return graph.versions.map((ref) => { const x = (depth.get(versionKey(ref)) ?? 0) * 260; const row = rows.get(x) ?? 0; rows.set(x, row + 1); return { id: versionKey(ref), position: { x, y: row * 130 }, data: { label: `${definitionById.get(ref.factoryId)?.name ?? ref.factoryId} · v${ref.version}` }, className: versionKey(ref) === versionKey(root!) ? 'dependency-root' : 'dependency-node' } })
  })()
  const edges: Edge[] = graph?.edges.map((edge) => ({ id: `${versionKey(edge.parent)}>${versionKey(edge.child)}`, source: versionKey(edge.parent), target: versionKey(edge.child), animated: false })) ?? []
  return <section className="dependency-view" aria-label="Factory dependencies">
    <header className="dependency-toolbar panel"><div><span className="eyebrow">Published graph</span><h2>Dependencies</h2></div><label>Factory<select aria-label="Dependency factory" value={factoryId ?? ''} onChange={(event) => { setFactoryId(event.target.value as FactoryId); setRequestedVersion(undefined) }}>{publishedDefinitions.map((definition) => <option key={definition.id} value={definition.id}>{definition.name}</option>)}</select></label><label>Version<select aria-label="Dependency version" value={root?.version ?? ''} onChange={(event) => setRequestedVersion(Number(event.target.value))}>{available.map((version) => <option key={version.version} value={version.version}>v{version.version}</option>)}</select></label></header>
    <div className="dependency-canvas">{root === undefined ? <p>No published version.</p> : <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable><Background /><Controls /></ReactFlow>}</div>
  </section>
}
