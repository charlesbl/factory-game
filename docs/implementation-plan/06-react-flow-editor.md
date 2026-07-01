# Stage 06 — Build the React Flow editor

## Mission

Replace the card-based factory interior with a spatial editor that manipulates the
`FactoryBlueprint`. React Flow is a rendering and interaction adapter; it never
becomes the business source of truth.

## Dependency

The stable version recorded on 1 July 2026 is `@xyflow/react@12.11.1`. Before
installation, check the latest stable version and peer dependencies, then install
the latest exact version compatible with React 19.

## Principles

- Convert React Flow pixel positions to grid positions in every command.
- Keep only a blueprint projection and UI state in the React Flow store: selection, viewport, and drag preview.
- Validate local port compatibility before emitting an edge-creation command.
- Memoise custom nodes and edges.
- Flow animations never contain simulation logic.

## Work

1. Create a `FactoryGraphEditor` view mounted from the existing navigation.
2. Create visual nodes for machines, junctions, inputs, outputs, and sub-factories.
3. Display separate handles for every port and resource type.
4. Implement placement, snapped movement, connection, deletion, multi-selection, and duplication.
5. Display only straight or orthogonal polyline connections in V1.
6. Add accessible keyboard shortcuts and buttons for undo/redo.
7. Add zoom, pan, fit-to-view, and a minimap if it remains readable.
8. Retain the existing catalogue and sub-factory navigation screens where needed.
9. Add an overlay layer ready for rates and diagnostics without calculating them.
10. Prevent global rerenders with narrow selectors, stable callbacks, and memoised components.

## Required tests

- unit tests for pixel/grid conversion;
- E2E placement of a machine;
- E2E connection of compatible ports;
- visible rejection of an incompatible connection;
- move, undo, and redo;
- navigation into a sub-factory and back to its parent;
- keyboard and accessible-label coverage for primary actions.

## Acceptance criteria

- Reloading reproduces the exact saved logical geometry.
- Moving the camera changes neither blueprint nor revision.
- No business rule exists only inside a React component.
- A 250-node test graph remains interactive at 60 FPS on the development machine, excluding compilation.
- Existing views not replaced by this stage continue to work.
- `npm run check` and `npm run test:e2e` pass.

## Out of scope

- Solver and real-rate display.
- Automatic obstacle routing.
- PixiJS rendering, unless stage 14 later proves it necessary.

