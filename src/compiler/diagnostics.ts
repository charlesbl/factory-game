import type { EdgeId, NodeId, PortId, ResourceId } from '../domain';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticCode =
  | 'BROKEN_REFERENCE'
  | 'PORT_DIRECTION'
  | 'RESOURCE_MISMATCH'
  | 'PORT_OCCUPIED'
  | 'UNTYPED_ROUTE'
  | 'JUNCTION_PORT_LIMIT'
  | 'ZERO_LENGTH'
  | 'CYCLE'
  | 'UNREACHABLE_INPUT'
  | 'UNROUTED_OUTPUT'
  | 'INDEPENDENT_COMPONENT'
  | 'MISSING_CHILD_CONTRACT'
  | 'LIMITED_INPUT'
  | 'LIMITED_OUTPUT'
  | 'LONGER_PATH'
  | 'INTERNAL_VERIFICATION'
  | 'MACHINE_KEEPOUT'
  | 'ILLEGAL_CROSSING'
  | 'INVALID_BRIDGE'
  | 'INSUFFICIENT_CLEARANCE'
  | 'NON_ORTHOGONAL_ROUTE';
export interface DiagnosticEntity {
  readonly nodeId?: NodeId;
  readonly edgeId?: EdgeId;
  readonly portId?: PortId;
  readonly resourceId?: ResourceId;
}
export interface CompileDiagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly entity: DiagnosticEntity;
  readonly details?: Readonly<Record<string, string>>;
}

export const diagnosticText = (diagnostic: CompileDiagnostic): string => {
  const value = diagnostic.details?.value;
  const messages: Record<DiagnosticCode, string> = {
    BROKEN_REFERENCE: 'A route references a missing node or port.',
    PORT_DIRECTION: 'A route must run from an output to an input.',
    RESOURCE_MISMATCH: 'Connected ports carry different resources.',
    PORT_OCCUPIED: 'A connector can carry only one route.',
    UNTYPED_ROUTE:
      'This route connects only Any junctions and needs a typed connection.',
    JUNCTION_PORT_LIMIT:
      'A junction accepts at most three input and three output routes.',
    ZERO_LENGTH: 'A route must have a positive logical length.',
    CYCLE: 'Cycles require an explicit buffer and are not supported in V1.',
    UNREACHABLE_INPUT: 'A mandatory machine input has no path.',
    UNROUTED_OUTPUT: 'An output has no destination.',
    INDEPENDENT_COMPONENT:
      'A factory may contain only one productive component in V1.',
    MISSING_CHILD_CONTRACT: 'The sub-factory contract is unavailable.',
    LIMITED_INPUT: `Machine activity is limited by ${value ?? 'an input'}.`,
    LIMITED_OUTPUT: `Production is limited by ${value ?? 'an output path'}.`,
    LONGER_PATH: 'This branch is inactive because a shorter path has priority.',
    INTERNAL_VERIFICATION: 'Exact conservation verification failed.',
    MACHINE_KEEPOUT: 'A route passes through a machine keepout.',
    ILLEGAL_CROSSING:
      'Routes touch on the same layer; add a bridge or move one route.',
    INVALID_BRIDGE: 'The bridge is not on a valid interior route segment.',
    INSUFFICIENT_CLEARANCE: 'A route is too close to a machine.',
    NON_ORTHOGONAL_ROUTE: 'Routes must use orthogonal grid segments.',
  };
  return messages[diagnostic.code];
};
