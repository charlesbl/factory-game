import { bench, describe } from 'vitest'
import { asId, gridPoint } from '../src/domain'
import type { NodeId, ResourceId } from '../src/domain'
import { WorldBuffer } from '../src/simulation'
import { RailNetwork } from '../src/logistics'
import { edgeRoute } from '../src/editor'
import { createDemoBlueprint } from '../src/ui/demo-blueprint'

describe('world scale', () => {
  for (const count of [10_000, 100_000, 1_000_000]) bench(`allocate ${count.toLocaleString()} compact instance records`, () => {
    const states = new Uint8Array(count); const times = new BigInt64Array(count); states[count - 1] = 1; times[count - 1] = 1n
  }, { iterations: count === 1_000_000 ? 3 : 10 })
  bench('move one integer batch', () => { const buffer = new WorldBuffer(asId<ResourceId>('ironOre'), 100, 50); buffer.remove(10); buffer.add(10) })
})

describe('path scale', () => {
  for (const count of [50, 250, 1_000]) bench(`stable route through ${count} rail nodes`, () => {
    const network = new RailNetwork()
    for (let index = 0; index < count; index += 1) network.addNode({ id: `n-${index}`, position: gridPoint(index, 0) })
    for (let index = 1; index < count; index += 1) network.addEdge({ id: `e-${index}`, from: `n-${index - 1}`, to: `n-${index}`, bidirectional: true })
    network.route('n-0', `n-${count - 1}`)
  }, { iterations: count === 1_000 ? 2 : 10 })
})

describe('PCB editor scale', () => {
  for (const count of [250, 500, 1_000]) {
    const blueprint = createDemoBlueprint(); const template = blueprint.nodes.get(asId<NodeId>('node-iron-output'))!
    const nodes = new Map(blueprint.nodes)
    for (let index = 0; index < count; index += 1) {
      const id = asId<NodeId>(`benchmark-obstacle-${index}`)
      nodes.set(id, { ...template, id, position: gridPoint(20 + index % 50, 20 + Math.floor(index / 50)), ports: [] })
    }
    const crowded = { ...blueprint, nodes }; const edge = blueprint.edges.get(asId('edge-ore'))!
    bench(`materialize connector route with ${count} nearby components`, () => edgeRoute(crowded, edge), { iterations: count === 1_000 ? 2 : 5 })
  }
})
