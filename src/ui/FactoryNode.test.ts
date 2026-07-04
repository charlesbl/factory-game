import { describe, expect, it } from 'vitest'
import { asId, parseRate } from '../domain'
import type { PortId, ResourceId } from '../domain'
import type { FactoryContract } from '../compiler'
import type { SubFactoryNode } from '../editor'
import { hasActivityMeter } from './factory-node-activity'
import { formatPortFlow, formatPortRate, nominalPortRate, portMeterLimit, portUtilizationPercent } from './factory-node-rates'

describe('factory node port rates', () => {
  it('shows activity for machines and nested factories', () => {
    expect(hasActivityMeter('machine')).toBe(true)
    expect(hasActivityMeter('sub-factory')).toBe(true)
    expect(hasActivityMeter('junction')).toBe(false)
  })

  it('distinguishes the current recipe flow from the port capacity', () => {
    expect(formatPortRate(parseRate('2'), parseRate('4'))).toBe('2/s (max 4/s)')
    expect(formatPortRate(parseRate('1'), parseRate('2'))).toBe('1/s (max 2/s)')
  })

  it('falls back to capacity while no compiled flow is available', () => {
    expect(formatPortRate(undefined, parseRate('4'))).toBe('4/s')
  })

  it('formats the current flow without mixing it with capacity', () => {
    expect(formatPortFlow(parseRate('2'))).toBe('2/s')
    expect(formatPortFlow(undefined)).toBe('—/s')
  })

  it('calculates a bounded utilization percentage for the meter', () => {
    expect(portUtilizationPercent(parseRate('2'), parseRate('4'))).toBe(50)
    expect(portUtilizationPercent(parseRate('5'), parseRate('4'))).toBe(100)
    expect(portUtilizationPercent(undefined, parseRate('4'))).toBeUndefined()
  })

  it('measures machines against the craft rate instead of connector capacity', () => {
    const craftRate = parseRate('4')
    const connectorCapacity = parseRate('6')

    expect(portUtilizationPercent(parseRate('2'), portMeterLimit(craftRate, connectorCapacity))).toBe(50)
  })

  it('keeps connector capacity as the meter limit when there is no craft rate', () => {
    expect(portUtilizationPercent(parseRate('2'), portMeterLimit(undefined, parseRate('6')))).toBe(33)
  })

  it('uses the pinned child contract rates for a sub-factory port', () => {
    const resourceId = asId<ResourceId>('ironOre')
    const node: SubFactoryNode = {
      id: asId('sub-factory'), kind: 'sub-factory', name: 'Smelter', factoryId: asId('smelter'), version: 1, contractId: asId('contract'),
      position: { x: 0, y: 0 }, footprint: { x: 0, y: 0, width: 4, height: 4 },
      ports: [{ id: asId('input'), contractPortId: asId('contract-input'), direction: 'input', resourceId, capacity: parseRate('8'), anchor: { x: 0, y: 1 } }],
    }
    const childContract: FactoryContract = {
      schemaVersion: 1, blueprintHash: 'contract', inputRates: new Map([[resourceId, parseRate('2')]]), outputRates: new Map(),
      inputPorts: [], outputPorts: [], footprint: { x: 0, y: 0, width: 2, height: 2 }, machineActivity: new Map(), edgeFlows: new Map(), diagnostics: [],
    }

    expect(nominalPortRate(node, 0, childContract)).toBe(parseRate('2'))
  })

  it('uses each child contract port rate when several ports carry the same resource', () => {
    const resourceId = asId<ResourceId>('ironOre')
    const rates = ['6', '6', '4'].map(parseRate)
    const ports = rates.map((rate, index) => ({
      id: asId<PortId>(`input-${index}`), contractPortId: asId<PortId>(`contract-input-${index}`), direction: 'input' as const,
      resourceId, capacity: rate, anchor: { x: 0, y: index + 1 },
    }))
    const node: SubFactoryNode = {
      id: asId('sub-factory'), kind: 'sub-factory', name: 'Smelter', factoryId: asId('smelter'), version: 1, contractId: asId('contract'),
      position: { x: 0, y: 0 }, footprint: { x: 0, y: 0, width: 4, height: 5 }, ports,
    }
    const childContract: FactoryContract = {
      schemaVersion: 1, blueprintHash: 'contract', inputRates: new Map([[resourceId, parseRate('16')]]), outputRates: new Map(),
      inputPorts: ports.map((port, index) => ({ portId: port.contractPortId, resourceId, capacity: port.capacity, rate: rates[index]!, position: { x: 0, y: index + 1 } })),
      outputPorts: [], footprint: { x: 0, y: 0, width: 4, height: 5 }, machineActivity: new Map(), edgeFlows: new Map(), diagnostics: [],
    }

    expect(ports.map((_, index) => nominalPortRate(node, index, childContract))).toEqual(rates)
  })

  it('does not invent per-port rates when a legacy contract only has an aggregate', () => {
    const resourceId = asId<ResourceId>('ironOre')
    const ports = [0, 1, 2].map((index) => ({
      id: asId<PortId>(`input-${index}`), contractPortId: asId<PortId>(`contract-input-${index}`), direction: 'input' as const,
      resourceId, capacity: parseRate('6'), anchor: { x: 0, y: index + 1 },
    }))
    const node: SubFactoryNode = {
      id: asId('legacy-sub-factory'), kind: 'sub-factory', name: 'Smelter', factoryId: asId('smelter'), version: 1, contractId: asId('legacy-contract'),
      position: { x: 0, y: 0 }, footprint: { x: 0, y: 0, width: 4, height: 5 }, ports,
    }
    const childContract: FactoryContract = {
      schemaVersion: 1, blueprintHash: 'legacy-contract', inputRates: new Map([[resourceId, parseRate('16')]]), outputRates: new Map(),
      inputPorts: ports.map((port, index) => ({ portId: port.contractPortId, resourceId, capacity: port.capacity, position: { x: 0, y: index + 1 } })),
      outputPorts: [], footprint: { x: 0, y: 0, width: 4, height: 5 }, machineActivity: new Map(), edgeFlows: new Map(), diagnostics: [],
    }

    expect(ports.map((_, index) => nominalPortRate(node, index, childContract))).toEqual([undefined, undefined, undefined])
  })
})
