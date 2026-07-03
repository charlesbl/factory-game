import type { EdgeId, NetId, NodeId, PortId, ResourceId, TrackId, TransitionId } from '../domain'

export type DiagnosticSeverity = 'error' | 'warning' | 'info'
export type DiagnosticCode =
  | 'BROKEN_REFERENCE' | 'PORT_DIRECTION' | 'RESOURCE_MISMATCH' | 'NON_POSITIVE_CAPACITY'
  | 'CONNECTION_LIMIT' | 'ZERO_LENGTH' | 'CYCLE' | 'UNREACHABLE_INPUT' | 'UNROUTED_OUTPUT'
  | 'INDEPENDENT_COMPONENT' | 'MISSING_CHILD_CONTRACT' | 'LIMITED_INPUT' | 'LIMITED_OUTPUT'
  | 'LONGER_PATH' | 'INTERNAL_VERIFICATION'
  | 'UNROUTED_INTENT' | 'MACHINE_KEEPOUT' | 'ILLEGAL_CROSSING' | 'INVALID_TRANSITION'
  | 'TRANSITION_CAPACITY' | 'INSUFFICIENT_CLEARANCE' | 'ORPHANED_TRACK' | 'ENDPOINT_DETACHED'
  | 'DUPLICATE_SEGMENT' | 'NON_ORTHOGONAL_TRACK' | 'SHARED_CAPACITY'
export interface DiagnosticEntity { readonly nodeId?: NodeId; readonly edgeId?: EdgeId; readonly netId?: NetId; readonly trackId?: TrackId; readonly transitionId?: TransitionId; readonly portId?: PortId; readonly resourceId?: ResourceId }
export interface CompileDiagnostic {
  readonly code: DiagnosticCode
  readonly severity: DiagnosticSeverity
  readonly entity: DiagnosticEntity
  readonly details?: Readonly<Record<string, string>>
}

export const diagnosticText = (diagnostic: CompileDiagnostic): string => {
  const value = diagnostic.details?.value
  const connected = diagnostic.details?.connected
  const limit = diagnostic.details?.limit
  const messages: Record<DiagnosticCode, string> = {
    BROKEN_REFERENCE: 'A connection references a missing node or port.', PORT_DIRECTION: 'A connection must run from an output to an input.',
    RESOURCE_MISMATCH: 'Connected ports carry different resources.', NON_POSITIVE_CAPACITY: 'Connection capacity must be positive.',
    CONNECTION_LIMIT: connected !== undefined && limit !== undefined ? `This port accepts ${limit} route${limit === '1' ? '' : 's'}, but ${connected} are connected.` : 'A port has too many connections.', ZERO_LENGTH: 'A connection must have a positive logical length.',
    CYCLE: 'Cycles require an explicit buffer and are not supported in V1.', UNREACHABLE_INPUT: 'A mandatory machine input has no path.',
    UNROUTED_OUTPUT: 'An output has no destination.', INDEPENDENT_COMPONENT: 'A factory may contain only one productive component in V1.',
    MISSING_CHILD_CONTRACT: 'The sub-factory contract is unavailable.', LIMITED_INPUT: `Machine activity is limited by ${value ?? 'an input'}.`,
    LIMITED_OUTPUT: `Production is limited by ${value ?? 'an output path'}.`, LONGER_PATH: 'This branch is inactive because a shorter path has priority.',
    INTERNAL_VERIFICATION: 'Exact conservation verification failed.',
    UNROUTED_INTENT: 'This transport intent has not been routed and carries no flow.', MACHINE_KEEPOUT: 'A conveyor passes through a machine keepout.',
    ILLEGAL_CROSSING: 'Incompatible conveyors cross on the same routing layer.', INVALID_TRANSITION: 'The bridge transition has invalid layer or capacity settings.',
    TRANSITION_CAPACITY: 'The bridge is saturated by the routes that use it.', INSUFFICIENT_CLEARANCE: 'A conveyor is too close to a machine or incompatible route.',
    ORPHANED_TRACK: 'This conveyor is not owned by a valid transport intent.', ENDPOINT_DETACHED: 'A conveyor endpoint is detached from its expected port.',
    DUPLICATE_SEGMENT: 'This conveyor contains a duplicate zero-length segment.', NON_ORTHOGONAL_TRACK: 'Conveyors must use orthogonal grid segments.',
    SHARED_CAPACITY: 'The logical routes on this shared trunk request more than its capacity.',
  }
  return messages[diagnostic.code]
}
