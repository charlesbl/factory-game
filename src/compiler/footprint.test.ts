import { describe, expect, it } from 'vitest'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import { compileBlueprint, isContract } from './compile'
import { projectExternalPorts } from './footprint'

describe('compiled footprint', () => {
  it('projects ports onto stable, non-overlapping perimeter cells', () => {
    const blueprint = createDemoBlueprint(); const compiled = compileBlueprint(blueprint); if (!isContract(compiled)) throw new Error('Fixture must compile')
    const ports = projectExternalPorts(blueprint, compiled.footprint); const cells = ports.map((port) => `${port.position.x}:${port.position.y}`)
    expect(new Set(cells).size).toBe(cells.length)
    expect(ports[0]?.position.x === compiled.footprint.x || ports[0]?.position.y === compiled.footprint.y).toBe(true)
    expect(projectExternalPorts(blueprint, compiled.footprint)).toEqual(ports)
  })
})
