import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { formatRate, resourceById } from '../domain';
import type { PortId, RateRaw, ResourceId } from '../domain';
import type { FactoryContract } from '../compiler';
import type { BlueprintNode } from '../editor';
import { hasActivityMeter } from './factory-node-activity';
import {
  formatPortFlow,
  nominalPortRate,
  portMeterLimit,
  portUtilizationPercent,
} from './factory-node-rates';
import { gridToPixel } from './grid-projection';

export interface FactoryNodeData extends Record<string, unknown> {
  readonly node: BlueprintNode;
  readonly childContract?: FactoryContract;
  readonly portResources?: ReadonlyMap<PortId, ResourceId>;
  readonly portFlows?: ReadonlyMap<PortId, RateRaw>;
  readonly activity?: number;
  readonly diagnostic?: string;
  readonly issueSeverity?: 'error' | 'warning' | 'info';
  readonly onPortPointerDown?: (
    nodeId: BlueprintNode['id'],
    portId: PortId,
  ) => void;
}
export type FactoryFlowNode = Node<FactoryNodeData, 'factory'>;

const kindIcon: Record<BlueprintNode['kind'], string> = {
  machine: '⬡',
  junction: '◆',
  'external-input': '→',
  'external-output': '←',
  'sub-factory': '▣',
};
export const FactoryNodeView = ({
  data,
  selected,
}: NodeProps<FactoryFlowNode>) => {
  const { node } = data;
  return (
    <article
      className={`graph-node graph-node--${node.kind}${selected ? ' is-selected' : ''}${data.issueSeverity !== undefined ? ` has-${data.issueSeverity}` : ''}`}
      style={{
        width: gridToPixel(node.footprint.width),
        height: gridToPixel(node.footprint.height),
      }}
      aria-label={`${node.kind}: ${node.name}${data.diagnostic === undefined ? '' : `. ${data.diagnostic}`}`}
    >
      <header>
        <span className="graph-node__icon" aria-hidden="true">
          {kindIcon[node.kind]}
        </span>
        <span>{node.name}</span>
      </header>
      {hasActivityMeter(node.kind) && (
        <div className="activity">
          <span style={{ width: `${data.activity ?? 0}%` }} />
          <small>{Math.round(data.activity ?? 0)}%</small>
        </div>
      )}
      <div className="ports">
        {node.ports.map((port, portIndex) => {
          const resourceId = data.portResources?.get(port.id);
          const resource =
            resourceId === undefined ? undefined : resourceById.get(resourceId);
          const resourceName =
            resourceId === undefined ? 'Any' : (resource?.name ?? resourceId);
          const craftFlow = nominalPortRate(
            node,
            portIndex,
            data.childContract,
          );
          const flow =
            data.portFlows === undefined
              ? undefined
              : (data.portFlows.get(port.id) ?? 0n);
          const displayedFlow = formatPortFlow(flow);
          const meterLimit = portMeterLimit(craftFlow, port.capacity);
          const utilization = portUtilizationPercent(flow, meterLimit);
          const flowState =
            flow === undefined
              ? 'pending'
              : flow === 0n
                ? 'idle'
                : flow >= meterLimit
                  ? 'saturated'
                  : 'active';
          const limitDescription =
            craftFlow === undefined
              ? `connector capacity ${formatRate(port.capacity)}/s`
              : `craft rate ${formatRate(craftFlow)}/s; connector capacity ${formatRate(port.capacity)}/s`;
          const rateDescription =
            flow === undefined
              ? `Flow unavailable; ${limitDescription}`
              : `Flow ${displayedFlow}; ${limitDescription}; utilization ${utilization ?? 0}%`;
          const top = gridToPixel(port.anchor.y);
          return (
            <div
              className={`port-row port-row--${port.direction} is-${flowState}`}
              key={port.id}
              style={{ color: resource?.colour, top: top - 9 }}
            >
              <Handle
                id={port.id}
                type={port.direction === 'input' ? 'target' : 'source'}
                position={
                  port.direction === 'input' ? Position.Left : Position.Right
                }
                style={{ top: 9, background: resource?.colour }}
                aria-label={`${port.direction} ${resourceName}`}
                tabIndex={0}
                data-route-node-id={node.id}
                data-route-port-id={port.id}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  data.onPortPointerDown?.(node.id, port.id);
                }}
              />
              <span className="port-resource">{resourceName}</span>
              <small
                className="port-rate"
                title={rateDescription}
                aria-label={`Flow details for ${resourceName} (${port.direction}): ${rateDescription}`}
              >
                <span className="port-rate__values">
                  <span className="port-rate__value">{displayedFlow}</span>
                  {craftFlow !== undefined && (
                    <span className="port-rate__craft">
                      <b aria-hidden="true">⚙</b>
                      {formatRate(craftFlow)}/s
                    </span>
                  )}
                </span>
                <span className="port-rate__meter" aria-hidden="true">
                  <i style={{ width: `${utilization ?? 0}%` }} />
                </span>
              </small>
            </div>
          );
        })}
      </div>
      {data.diagnostic !== undefined && (
        <p
          className={`node-diagnostic node-diagnostic--${data.issueSeverity ?? 'info'}`}
        >
          <b aria-hidden="true">!</b>
          {data.diagnostic}
        </p>
      )}
    </article>
  );
};
