import type { BlueprintNode } from '../editor';

export const hasActivityMeter = (kind: BlueprintNode['kind']): boolean =>
  kind === 'machine' || kind === 'sub-factory';
