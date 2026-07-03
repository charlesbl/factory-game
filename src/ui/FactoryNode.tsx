import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { formatRate, recipeById, resourceById } from '../domain'
import type { PortId, RateRaw, ResourceId } from '../domain'
import type { BlueprintNode } from '../editor'
import { formatPortFlow, portUtilizationPercent } from './factory-node-rates'
import { gridToPixel } from './grid-projection'

export interface FactoryNodeData extends Record<string, unknown> { readonly node: BlueprintNode; readonly portResources?: ReadonlyMap<PortId, ResourceId>; readonly portFlows?: ReadonlyMap<PortId, RateRaw>; readonly activity?: number; readonly diagnostic?: string; readonly issueSeverity?: 'error' | 'warning' | 'info'; readonly onPortPointerDown?: (nodeId: BlueprintNode['id'], portId: PortId) => void }
export type FactoryFlowNode = Node<FactoryNodeData, 'factory'>

const kindIcon: Record<BlueprintNode['kind'], string> = { machine: '⬡', junction: '◆', 'external-input': '→', 'external-output': '←', 'sub-factory': '▣' }
export const FactoryNodeView = ({ data, selected }: NodeProps<FactoryFlowNode>) => {
  const { node } = data
  const recipe = node.kind === 'machine' ? recipeById.get(node.recipeId) : undefined
  return <article className={`graph-node graph-node--${node.kind}${selected ? ' is-selected' : ''}${data.issueSeverity !== undefined ? ` has-${data.issueSeverity}` : ''}`} style={{ width: gridToPixel(node.footprint.width), height: gridToPixel(node.footprint.height) }} aria-label={`${node.kind}: ${node.name}${data.diagnostic === undefined ? '' : `. ${data.diagnostic}`}`}>
    <header><span className="graph-node__icon" aria-hidden="true">{kindIcon[node.kind]}</span><span>{node.name}</span></header>
    {node.kind === 'machine' && <div className="activity"><span style={{ width: `${data.activity ?? 0}%` }} /><small>{Math.round(data.activity ?? 0)}%</small></div>}
    <div className="ports">
      {node.ports.map((port, portIndex) => {
        const resourceId = data.portResources?.get(port.id)
        const resource = resourceId === undefined ? undefined : resourceById.get(resourceId)
        const resourceName = resourceId === undefined ? 'Any' : resource?.name ?? resourceId
        const directionIndex = node.ports.slice(0, portIndex).filter((candidate) => candidate.direction === port.direction).length
        const craftFlow = (port.direction === 'input' ? recipe?.inputs : recipe?.outputs)?.[directionIndex]?.rate
        const flow = data.portFlows === undefined ? undefined : data.portFlows.get(port.id) ?? 0n
        const displayedFlow = formatPortFlow(flow)
        const utilization = portUtilizationPercent(flow, port.capacity)
        const flowState = flow === undefined ? 'pending' : flow === 0n ? 'idle' : flow >= port.capacity ? 'saturated' : 'active'
        const craftDescription = craftFlow === undefined ? '' : `; craft rate ${formatRate(craftFlow)}/s`
        const rateDescription = flow === undefined ? `Flow unavailable; capacity ${formatRate(port.capacity)}/s${craftDescription}` : `Flow ${displayedFlow}; capacity ${formatRate(port.capacity)}/s; utilization ${utilization ?? 0}%${craftDescription}`
        const top = gridToPixel(port.anchor.y)
        return <div className={`port-row port-row--${port.direction} is-${flowState}`} key={port.id} style={{ color: resource?.colour, top: top - 9 }}>
          <Handle id={port.id} type={port.direction === 'input' ? 'target' : 'source'} position={port.direction === 'input' ? Position.Left : Position.Right} style={{ top: 9, background: resource?.colour }} aria-label={`${port.direction} ${resourceName}`} tabIndex={0} data-route-node-id={node.id} data-route-port-id={port.id} onPointerDown={(event) => { event.stopPropagation(); data.onPortPointerDown?.(node.id, port.id) }} />
          <span className="port-resource">{resourceName}</span>
          <small className="port-rate" title={rateDescription} aria-label={`${port.direction} ${resourceName}, ${rateDescription}`}>
            <span className="port-rate__values">
              <span className="port-rate__value">{displayedFlow}</span>
              {craftFlow !== undefined && <span className="port-rate__craft"><b aria-hidden="true">⚙</b>{formatRate(craftFlow)}/s</span>}
            </span>
            <span className="port-rate__meter" aria-hidden="true"><i style={{ width: `${utilization ?? 0}%` }} /></span>
          </small>
        </div>
      })}
    </div>
    {data.diagnostic !== undefined && <p className={`node-diagnostic node-diagnostic--${data.issueSeverity ?? 'info'}`}><b aria-hidden="true">!</b>{data.diagnostic}</p>}
  </article>
}
