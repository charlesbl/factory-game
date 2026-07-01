# Stage 12 — Explain flows and calculate the footprint

## Mission

Make compiler results understandable without exposing the solver. Add the external
footprint, projected ports, and construction tools that make spatial constraints
pleasant to manipulate.

## Diagnostic overlay

Display at least:

- current rate, compiled rate, and capacity of every line;
- saturation through colour and width;
- priority path and alternatives;
- actual and nominal activity of every machine;
- limiting ingredient and first limiting segment;
- structured reason for a runtime stop;
- net boundary rates;
- integer buffers and boundary WIP phases.

Generate text from structured codes and data. Do not store only preformatted
sentences in the compiler.

## V1 footprint

1. Calculate the grid bounding box of nodes and polylines.
2. Add a configurable constant structural margin.
3. Reserve cells required for external ports.
4. Preserve the complete compiled footprint of sub-factories.
5. Add constant nesting overhead if the stage 03 ADR confirms it.
6. Project external ports onto the perimeter in stable, non-overlapping order.

Projection must not change contract rates without triggering compilation.

## Usability work

- validity preview while creating a connection;
- snap and alignment guides;
- quick line construction and explicit junction insertion;
- orthogonal polyline editing;
- inspection focused on one resource;
- a panel summarising contract, footprint, and diagnostics;
- parent/child navigation retaining one viewport per factory;
- high-contrast mode and symbols that do not rely only on colour.

## Required tests

- footprint snapshots for compact, elongated, and nested shapes;
- projected ports do not overlap and remain stably ordered;
- every major diagnostic code has user-facing rendering;
- E2E display of the limiting segment on a saturated bus;
- E2E full output followed by resumption;
- keyboard accessibility and contrast for essential information.

## Acceptance criteria

- A player can explain why a machine is running at 60% by inspecting the screen.
- An inactive branch distinguishes “longer path” from “no path”.
- Additional nesting never reduces a sub-factory footprint.
- Overlays trigger no compilation.
- `npm run check` and `npm run test:e2e` pass.

## Out of scope

- New programmable priority nodes.
- Automatic layout optimisation.
- PixiJS rendering without demonstrated need.

