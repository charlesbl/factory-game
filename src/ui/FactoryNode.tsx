import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { resourceById } from '../domain'
import type { PortId, RateRaw, ResourceId } from '../domain'
import type { BlueprintNode } from '../editor'
import { formatMachinePortRate, formatPortRate } from './factory-node-rates'

export interface FactoryNodeData extends Record<string, unknown> { readonly node: BlueprintNode; readonly portResources?: ReadonlyMap<PortId, ResourceId>; readonly portFlows?: ReadonlyMap<PortId, RateRaw>; readonly activity?: number; readonly diagnostic?: string; readonly issueSeverity?: 'error' | 'warning' | 'info' }
export type FactoryFlowNode = Node<FactoryNodeData, 'factory'>

const kindIcon: Record<BlueprintNode['kind'], string> = { machine: '⬡', junction: '◆', 'external-input': '→', 'external-output': '←', 'sub-factory': '▣' }
export const FactoryNodeView = ({ data, selected }: NodeProps<FactoryFlowNode>) => {
  const { node } = data
  return <article className={`graph-node graph-node--${node.kind}${selected ? ' is-selected' : ''}${data.issueSeverity !== undefined ? ` has-${data.issueSeverity}` : ''}`} aria-label={`${node.kind}: ${node.name}${data.diagnostic === undefined ? '' : `. ${data.diagnostic}`}`}>
    <header><span className="graph-node__icon" aria-hidden="true">{kindIcon[node.kind]}</span><span>{node.name}</span></header>
    {node.kind === 'machine' && <div className="activity"><span style={{ width: `${data.activity ?? 0}%` }} /><small>{Math.round(data.activity ?? 0)}%</small></div>}
    <div className="ports">
      {node.ports.map((port, index) => {
        const resourceId = data.portResources?.get(port.id)
        const resource = resourceId === undefined ? undefined : resourceById.get(resourceId)
        const resourceName = resourceId === undefined ? 'Any' : resource?.name ?? resourceId
        const flow = data.portFlows === undefined ? undefined : data.portFlows.get(port.id) ?? 0n
        const rate = node.kind === 'machine' ? formatMachinePortRate(flow, port.capacity) : formatPortRate(flow, port.capacity)
        const top = 48 + index * 28
        return <div className={`port-row port-row--${port.direction}`} key={port.id} style={{ color: resource?.colour }}>
          <Handle id={port.id} type={port.direction === 'input' ? 'target' : 'source'} position={port.direction === 'input' ? Position.Left : Position.Right} style={{ top, background: resource?.colour }} aria-label={`${port.direction} ${resourceName}`} />
          <span className="port-resource">{resourceName}</span><small className="port-rate" title={node.kind === 'machine' ? 'Current recipe flow' : 'Current flow / port capacity'}>{rate}</small>
        </div>
      })}
    </div>
    {data.diagnostic !== undefined && <p className={`node-diagnostic node-diagnostic--${data.issueSeverity ?? 'info'}`}><b aria-hidden="true">!</b>{data.diagnostic}</p>}
  </article>
}
