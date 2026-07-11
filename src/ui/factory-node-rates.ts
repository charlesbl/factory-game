import { formatRate } from '../domain';
import { recipeById } from '../domain';
import type { FactoryContract } from '../compiler';
import type { BlueprintNode } from '../editor';
import type { RateRaw } from '../domain';

export const nominalPortRate = (
  node: BlueprintNode,
  portIndex: number,
  childContract?: FactoryContract,
): RateRaw | undefined => {
  const port = node.ports[portIndex];
  if (port === undefined) return undefined;
  if (node.kind === 'sub-factory') {
    const subFactoryPort = node.ports[portIndex];
    if (subFactoryPort === undefined || childContract === undefined)
      return undefined;
    const contractPorts =
      subFactoryPort.direction === 'input'
        ? childContract.inputPorts
        : childContract.outputPorts;
    const contractPort = contractPorts.find(
      (candidate) => candidate.portId === subFactoryPort.contractPortId,
    );
    if (contractPort?.rate !== undefined) return contractPort.rate;
    const resourcePorts = contractPorts.filter(
      (candidate) => candidate.resourceId === subFactoryPort.resourceId,
    );
    const resourceRate = (
      subFactoryPort.direction === 'input'
        ? childContract.inputRates
        : childContract.outputRates
    ).get(subFactoryPort.resourceId);
    if (resourcePorts.length <= 1) return resourceRate;
    return undefined;
  }
  if (node.kind !== 'machine') return undefined;
  const recipe = recipeById.get(node.recipeId);
  const directionIndex = node.ports
    .slice(0, portIndex)
    .filter((candidate) => candidate.direction === port.direction).length;
  return (port.direction === 'input' ? recipe?.inputs : recipe?.outputs)?.[
    directionIndex
  ]?.rate;
};

export const formatPortRate = (
  flow: RateRaw | undefined,
  capacity: RateRaw,
): string =>
  flow === undefined
    ? `${formatRate(capacity)}/s`
    : `${formatRate(flow)}/s (max ${formatRate(capacity)}/s)`;

export const formatPortFlow = (flow: RateRaw | undefined): string =>
  `${flow === undefined ? '—' : formatRate(flow)}/s`;

export const portMeterLimit = (
  craftRate: RateRaw | undefined,
  connectorCapacity: RateRaw,
): RateRaw => craftRate ?? connectorCapacity;

export const portUtilizationPercent = (
  flow: RateRaw | undefined,
  limit: RateRaw,
): number | undefined => {
  if (flow === undefined) return undefined;
  if (limit === 0n) return flow === 0n ? 0 : 100;
  return Math.min(100, Number((flow * 100n) / limit));
};
