import { describe, expect, it } from 'vitest'
import { asId, gridPoint, parseRate } from '../domain'
import type { NetId, ResourceId, TrackId } from '../domain'
import { createDemoBlueprint } from '../ui/demo-blueprint'
import type { ConveyorTrack } from './blueprint'
import { blueprintTracks } from './blueprint'
import { canonicalBlueprint, deserializeBlueprint } from './canonicalize'
import { derivePhysicalGraph, orthogonalLength, validatePhysicalRouting } from './routing'

describe('PCB conveyor routing', () => {
  it('uses visible Manhattan distance and rejects diagonal geometry', () => {
    expect(orthogonalLength([gridPoint(0, 0), gridPoint(4, 0), gridPoint(4, 3)])).toBe(7)
    expect(() => orthogonalLength([gridPoint(0, 0), gridPoint(3, 4)])).toThrow('orthogonal')
  })

  it('derives byte-stable segment and junction IDs', () => {
    const blueprint = deserializeBlueprint(JSON.parse(canonicalBlueprint(createDemoBlueprint())))
    const first = derivePhysicalGraph(blueprint)
    const second = derivePhysicalGraph({ ...blueprint, tracks: new Map([...blueprintTracks(blueprint)].reverse()) })
    expect(second).toEqual(first)
  })

  it('keeps the migrated default factory physically valid', () => {
    const migrated = deserializeBlueprint(JSON.parse(canonicalBlueprint(createDemoBlueprint())))
    expect(validatePhysicalRouting(migrated).filter((item) => item.severity === 'error')).toEqual([])
  })

  it('reports incompatible same-layer crossings without relying on colour', () => {
    const blueprint = deserializeBlueprint(JSON.parse(canonicalBlueprint(createDemoBlueprint())))
    const crossing: ConveyorTrack = { id: asId<TrackId>('track-crossing'), netIds: [asId<NetId>('net-crossing')], resourceId: asId<ResourceId>('copperOre'), capacity: parseRate('2'), layerId: 'primary', points: [gridPoint(5, 3), gridPoint(5, 7)] }
    const invalid = { ...blueprint, tracks: new Map(blueprintTracks(blueprint)).set(crossing.id, crossing) }
    expect(validatePhysicalRouting(invalid)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ILLEGAL_CROSSING' })]))
  })

  it('rejects duplicate persistent IDs before constructing maps', () => {
    const serialized = JSON.parse(canonicalBlueprint(createDemoBlueprint()))
    serialized.tracks.push(serialized.tracks[0])
    expect(() => deserializeBlueprint(serialized)).toThrow('Duplicate track ID')
  })

  it('diagnoses shared trunk demand against one physical capacity', () => {
    const blueprint = deserializeBlueprint(JSON.parse(canonicalBlueprint(createDemoBlueprint())))
    const ore = blueprint.nets!.get(asId<NetId>('net-ore'))!; const second = { ...ore, id: asId<NetId>('net-ore-second') }
    const oreTrack = blueprint.tracks!.get(asId<TrackId>('track-ore'))!
    const shared = { ...blueprint, nets: new Map(blueprint.nets).set(second.id, second), tracks: new Map(blueprint.tracks).set(oreTrack.id, { ...oreTrack, netIds: [ore.id, second.id] }) }
    expect(validatePhysicalRouting(shared)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SHARED_CAPACITY', severity: 'warning' })]))
  })
})
