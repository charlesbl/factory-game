# ADR 0003: PCB-style conveyor routing schema

- Status: superseded by ADR 0004
- Date: 2026-07-02

## Context

The V1 graph stored logical connectivity and visual geometry in one edge. That
cannot distinguish player-owned route handles from passive orthogonal bends,
persist an unfinished route, or represent a crossing that stays disconnected.

## Decision

Blueprint schema V2 separates logical `TransportNet` records from physical
`ConveyorTrack` and `ConveyorTransition` records. V1 edges remain as a compiled
compatibility projection while runtime and UI consumers migrate. Loading V1
creates one manual primary-layer net and track per edge and retains the original
record until the migrated save succeeds.

Schema V3 adds stable `RouteConnector` records to completed edges and saved
`LooseConnection` records for unfinished routes. Interior V1/V2 polyline points
become deterministic connector IDs during migration. Loose connections are
saved and undoable but are excluded from compilation input.

The editor uses two bounded layers (`primary` and `bridge`). A route may change
layers only through a saved, visible, capacity-limited transition. Machine
clearance is one cell. Sources remain separate directed nets when they meet.
Capacity upgrades are explicit. Ordinary geometry is deterministic: each pair
of player-owned connectors is joined by a straight segment or one passive
right-angle bend. Moving a machine or connector only rematerializes the affected
connection; no autorouter moves handles. Invalid crossings and keepout overlaps
are committed and reported by diagnostics. A bridge is inserted through a
context action on a route rather than an editor mode.

Selection, machine movement, connection creation, connector editing, measuring,
and bridge insertion are contextual and simultaneously available. A connection
may be started from an input or output, but completed logical edges are always
normalised from output to input. Intermediate connectors are private to one
point-to-point connection; explicit junction machines provide branching.

Canonical ordering uses persistent IDs. Derived segment and junction IDs use
track IDs, layer IDs, segment indexes, and grid positions. Duplicate persistent
IDs are rejected before maps are constructed.

## Consequences

Logical intent survives geometry edits and unfinished routes cannot carry flow. Physical
length, crossings, keepouts, transitions, and shared segment capacity become
validatable inputs to compilation. Schema V1 and V2 remain readable, while all
new blueprint payloads are deterministic schema V3 documents. The routing worker,
automatic/manual lock state, and persistent editor modes are retired.
