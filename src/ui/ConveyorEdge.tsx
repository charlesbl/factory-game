import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react'
import type { RoutingLayerId } from '../editor'

export interface ConveyorSectionView { readonly layerId: RoutingLayerId; readonly points: readonly { readonly x: number; readonly y: number }[] }
export interface ConveyorEdgeData extends Record<string, unknown> {
  readonly sections: readonly ConveyorSectionView[]
  readonly label?: string
  readonly labelPosition?: { readonly x: number; readonly y: number }
  readonly width: number
  readonly invalid?: boolean
  readonly saturated?: boolean
  readonly locked?: boolean
  readonly ratsnest?: boolean
  readonly transitions?: readonly { readonly x: number; readonly y: number }[]
  readonly junctions?: readonly { readonly x: number; readonly y: number }[]
  readonly drcMarkers?: readonly { readonly x: number; readonly y: number }[]
}
export type ConveyorFlowEdge = Edge<ConveyorEdgeData, 'conveyor'>
const pathFor = (points: ConveyorSectionView['points']): string => points.length === 0 ? '' : `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')}`

export const ConveyorEdgeView = ({ id, data, markerEnd, selected, style }: EdgeProps<ConveyorFlowEdge>) => {
  if (data === undefined) return null
  const paths = data.sections.filter((section) => section.points.length > 1)
  return <>
    {paths.map((section, index) => <BaseEdge
      id={`${id}-${index}`}
      key={`${section.layerId}-${index}`}
      path={pathFor(section.points)}
      {...(index === paths.length - 1 && markerEnd !== undefined ? { markerEnd } : {})}
      className={`conveyor-path conveyor-path--${section.layerId}${selected ? ' is-selected' : ''}${data.invalid === true ? ' is-invalid' : ''}${data.saturated === true ? ' is-saturated' : ''}${data.ratsnest === true ? ' is-ratsnest' : ''}`}
      style={{ ...style, strokeWidth: data.width }}
      interactionWidth={18}
    />)}
    {data.transitions?.map((point, index) => <g className="bridge-marker" key={`bridge-${index}`} transform={`translate(${point.x} ${point.y})`}><circle r="7" /><path d="M -5 0 L 5 0 M -2 -3 L 2 0 L -2 3" /></g>)}
    {data.junctions?.map((point, index) => <circle className="junction-marker" key={`junction-${index}`} cx={point.x} cy={point.y} r="4" />)}
    {data.drcMarkers?.map((point, index) => <g className="drc-marker" key={`drc-${index}`} transform={`translate(${point.x} ${point.y})`}><circle r="8" /><text y="3" textAnchor="middle">!</text></g>)}
  </>
}
