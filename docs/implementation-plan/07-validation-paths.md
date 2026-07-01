# Stage 07 — Validate the graph and calculate paths

## Mission

Build the deterministic front end of the compiler: structural validation,
indexing, cycle detection, and stable path calculation. Do not introduce the LP
solver in this stage.

## Expected pipeline

```text
FactoryBlueprint
  -> normalise
  -> validate ports/types/geometry
  -> build adjacency indexes
  -> detect cycles/components
  -> calculate stable shortest paths
  -> ValidatedGraph | CompileFailure
```

## Minimum validation

- unique IDs and valid references;
- source-to-destination directions;
- identical or correctly inferred resources;
- strictly positive capacity;
- per-port connection limits;
- unreachable mandatory nodes or ports;
- outputs without a destination or external port;
- directed cycles;
- additional independent productive components;
- non-integer geometry or unintended zero length;
- missing or incompatible child contracts.

Line crossings without a junction are valid and add no logical edge.

## Algorithms

- Kahn's algorithm for topological order and basic cycle detection;
- Tarjan only when detailed explanation of a cyclic component requires it;
- Dijkstra per resource, with integer length as weight;
- an internal, tested priority queue implementation;
- neighbour ordering by distance, `y`, `x`, and edge ID.

The result must retain predecessors required to reconstruct and explain paths, not
only a distance.

## Work

1. Define `CompileDiagnostic`, stable codes, and entity references.
2. Normalise blueprints into canonical order.
3. Build compact indexes by node, port, and resource.
4. Implement validation as independent passes.
5. Implement topological ordering and component detection.
6. Implement stable Dijkstra and ordered alternative reconstruction.
7. Calculate the multi-input machine priority key defined in stage 03.
8. Return useful partial results to the editor even when compilation fails.

## Required tests

- one minimal fixture for every diagnostic;
- geometrically resolved equal-length paths;
- unchanged results after inserting nodes in a different order;
- simple cycles, cycles with branches, and self-loops;
- crossing lines without a junction;
- saturable alternative paths retained in order;
- generative proof that permuting input maps does not change canonical output.

## Expected files

```text
src/compiler/
  diagnostics.ts
  normalize.ts
  validate.ts
  indexes.ts
  topological-sort.ts
  shortest-paths.ts
  machine-priority.ts
```

## Acceptance criteria

- The same canonical blueprint produces byte-for-byte identical results.
- Every error references at least one displayable entity.
- No floating point affects distances or tie-breaking.
- The partial compiler imports neither React nor React Flow.
- `npm run check` passes.

## Out of scope

- Rate allocation.
- Worker and cache.
- Automatic repair of invalid graphs.

