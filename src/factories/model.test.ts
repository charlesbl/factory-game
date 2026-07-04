import { describe, expect, it } from 'vitest'
import { asId } from '../domain'
import type { ContractId, FactoryId, NodeId, PortId } from '../domain'
import { createBlueprint, type FactoryBlueprint, type SubFactoryNode } from '../editor'
import type { FactoryContract } from '../compiler'
import { buildDependencyDag, dependencyPathToFactory, versionKey, versionsByKey, wouldCreateIdentityCycle, type FactoryVersion } from './model'

const id = (value: string) => asId<FactoryId>(value)
const contract = (hash: string): FactoryContract => ({ schemaVersion: 1, blueprintHash: hash, inputRates: new Map(), outputRates: new Map(), inputPorts: [], outputPorts: [], footprint: { x: 0, y: 0, width: 4, height: 4 }, machineActivity: new Map(), edgeFlows: new Map(), diagnostics: [] })
const blueprint = (factoryId: FactoryId, children: readonly { factoryId: FactoryId; version: number }[] = []): FactoryBlueprint => {
  const base = createBlueprint(factoryId)
  const nodes = children.map((child, index): SubFactoryNode => ({ id: asId<NodeId>(`child-${factoryId}-${index}`), kind: 'sub-factory', name: child.factoryId, factoryId: child.factoryId, version: child.version, contractId: asId<ContractId>(`hash-${child.factoryId}-${child.version}`), position: { x: index, y: 0 }, footprint: { x: 0, y: 0, width: 2, height: 2 }, ports: [{ id: asId<PortId>(`port-${factoryId}-${index}`), contractPortId: asId<PortId>(`contract-port-${factoryId}-${index}`), direction: 'input', resourceId: asId('ironOre'), capacity: 1n, anchor: { x: 0, y: 1 } }] }))
  return { ...base, nodes: new Map(nodes.map((node) => [node.id, node])) }
}
const version = (factoryId: FactoryId, number: number, children: readonly { factoryId: FactoryId; version: number }[] = []): FactoryVersion => ({ factoryId, version: number, blueprint: blueprint(factoryId, children), contract: contract(`hash-${factoryId}-${number}`), publishedAt: '2026-01-01T00:00:00.000Z' })

describe('versioned factory dependencies', () => {
  it('rejects identity recursion even when the repeated factory has another version', () => {
    const a = id('factory-a'); const b = id('factory-b'); const b2 = version(b, 2, [{ factoryId: a, version: 1 }]); const a1 = version(a, 1)
    const index = versionsByKey([a1, b2]); const path = wouldCreateIdentityCycle(a, b2, index)
    expect(path?.map(versionKey)).toEqual(['factory-b@2', 'factory-a@1'])
  })

  it('returns the shortest deterministic path and keeps shared DAG nodes once', () => {
    const a = id('factory-a'); const b = id('factory-b'); const c = id('factory-c'); const d = id('factory-d')
    const versions = [version(a, 3, [{ factoryId: b, version: 1 }, { factoryId: c, version: 1 }]), version(b, 1, [{ factoryId: d, version: 1 }]), version(c, 1, [{ factoryId: d, version: 1 }]), version(d, 1)]
    const index = versionsByKey(versions); const dag = buildDependencyDag(versions[0]!, index)
    expect(dag.versions.map(versionKey).sort()).toEqual(['factory-a@3', 'factory-b@1', 'factory-c@1', 'factory-d@1'])
    expect(dag.edges).toHaveLength(4)
    expect(dependencyPathToFactory(versions[0]!, d, index)?.map(versionKey)).toEqual(['factory-a@3', 'factory-b@1', 'factory-d@1'])
  })
})
