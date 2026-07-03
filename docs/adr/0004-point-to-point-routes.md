# ADR 0004: Point-to-point routes and dynamic junction connectors

- Status: accepted
- Date: 2026-07-03

## Context

The V3 blueprint duplicated every player route across logical edges, multi-target
nets, physical tracks, and transitions. That model allowed shared trunks even
though the editor requires explicit junction nodes for every split and merge.
Route resource and capacity were also repeated despite being fixed by endpoints.

## Decision

Schema V4 stores one point-to-point edge per route. An edge owns only its source,
target, ordered route handles, and bridge markers. Geometry, resource, capacity,
layers, and bridge transitions are derived. A connector is occupied by at most
one completed or incomplete route; route capacity is the minimum endpoint
capacity.

Junctions expose one free connector per direction until three routes occupy that
side. Their resource is inferred across the connected junction component. An
untyped junction component may be connected internally, but compilation requires
at least one typed endpoint. Different typed resources cannot be joined.

Every contact between distinct routes on the same layer is invalid. Crossings
must be avoided or represented by a bridge. V4 deliberately does not load V1,
V2, or V3 blueprints.

## Consequences

`TransportNet`, `ConveyorTrack`, `ConveyorTransition`, duplicated capacities,
implicit physical junctions, and route labels are removed. Compiler flow limits
come exclusively from connectors, while bridge geometry remains persistent and
editable without introducing another capacity layer.
