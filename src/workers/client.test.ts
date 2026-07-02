import { describe, expect, it } from 'vitest'
import { asId, gridPoint } from '../domain'
import type { NodeId } from '../domain'
import { moveNode } from '../editor'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import { CompilationClient } from './client'

describe('CompilationClient scheduling', () => {
  it('finishes the active preview, skips superseded work, and compiles the latest blueprint', async () => {
    const client = new CompilationClient()
    const initial = createDemoBlueprint()
    const firstMove = moveNode(asId<NodeId>('node-furnace'), gridPoint(8, 3)).apply(initial).blueprint
    const latestMove = moveNode(asId<NodeId>('node-furnace'), gridPoint(9, 3)).apply(firstMove).blueprint

    const active = client.compile(initial)
    const superseded = client.compile(firstMove)
    const latest = client.compile(latestMove)

    const skippedResult = await superseded
    expect(skippedResult).toMatchObject({ generation: 2, revision: 1, stale: true })
    expect(skippedResult.contract).toBeUndefined()

    const activeResult = await active
    expect(activeResult).toMatchObject({ generation: 1, revision: 0, stale: true })
    expect(activeResult.contract).toBeDefined()

    const latestResult = await latest
    expect(latestResult).toMatchObject({ generation: 3, revision: 2, stale: false })
    expect(latestResult.contract).toBeDefined()
    client.dispose()
  })
})
