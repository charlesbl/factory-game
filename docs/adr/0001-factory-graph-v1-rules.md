# ADR 0001: Factory graph V1 rules

Status: accepted — 2026-07-01

V1 uses directed acyclic graphs, integer-grid coordinates, Manhattan polyline
length, one resource per edge, typed ports, and no implicit junction at visual
crossings. It compiles one coupled programme and rejects independent productive
components. Declared outputs are mandatory.

Routing priority is shortest path first. Equal choices use `y`, `x`, then stable
ID. A multi-input machine is ordered by its maximum mandatory-input distance,
total distance, `y`, `x`, then ID. The solver maximises activity in that order and
then minimises travelled distance. Inactive machines may compile only with an
explanation.

Contracts are immutable and content-addressed. Instances own integer boundary
buffers and exact, one-item-capacity WIP. Recompilation creates a revision;
compatible WIP is retained and incompatible WIP enters maintenance. Nested
footprints add a one-cell structural overhead and never compress child area.

V1 prohibits cycles and independent programmes. Explicit buffers, recycling,
power, advanced priority nodes, and multiple programmes remain versioned future
extensions. External rail logistics is a separate discrete system.
