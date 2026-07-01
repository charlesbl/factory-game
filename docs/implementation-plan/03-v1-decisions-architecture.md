# Stage 03 — Fix the V1 decisions and architecture

## Mission

Turn open areas in the design document into unambiguous technical rules. This
stage mainly produces documentation and module boundaries; it does not yet
implement the solver or editor.

## V1 decisions to adopt

Unless the project owner explicitly approves a contradiction, adopt these rules:

1. Internal graphs are directed and acyclic.
2. One connection transports exactly one resource.
3. Visual crossings do not create implicit junctions.
4. Coordinates and routing points are integers on a grid.
5. Logical length is the Manhattan length of the polyline in grid units.
6. A compiled factory contains one coupled programme.
7. V1 rejects multiple independent production components inside one factory.
8. Each WIP reserve has a logical capacity of one item unless prototyping proves a recipe needs more.
9. Declared outputs are mandatory; a blocked output blocks the complete programme.
10. Ties are resolved by `y`, then `x`, then persistent identifier.
11. A multi-input machine receives a global priority based on maximum mandatory-input distance, total mandatory-input distance, `y`, `x`, and identifier.
12. The solver maximises machine activity in that priority order, then minimises total flow distance.
13. Compilation may succeed with an inactive machine when diagnostics explain it and the contract does not advertise its nominal output.
14. Contracts are immutable, content-addressed, and shared between instances.
15. Recompilation creates a new revision; stage 13 implements WIP migration without rounding or free returns.

## Reference architecture

```text
src/
  domain/          pure business types, grid, exact numbers
  editor/          blueprints and undo/redo commands
  compiler/        validation, paths, solver, contracts
  simulation/      instances, events, buffers, and WIP
  persistence/     schemas, migrations, IndexedDB
  workers/         compilation worker and protocol
  ui/              React components and rendering adapters
  Game/            legacy system retained temporarily during migration
```

Permitted dependency direction:

```text
ui ──► editor ──► domain
ui ──► simulation ──► domain
workers ──► compiler ──► domain
persistence ──► domain/editor/simulation
```

`domain`, `compiler`, and `simulation` must never import React, the DOM, or view components.

## Work

1. Create an ADR recording the V1 decisions and rejected alternatives.
2. Create the architecture directories with short README files describing responsibilities and allowed imports.
3. Define naming conventions for `Definition`, `Blueprint`, `Contract`, `Instance`, and `SaveRecord`.
4. Define persistent ID conventions and an injectable factory for deterministic tests.
5. Define migration boundaries from `src/Game` without moving all classes yet.
6. Document compatibility: legacy gameplay remains executable until stage 11 switches the world to the new runtime.

## Deliverables

- `docs/adr/0001-factory-graph-v1-rules.md`
- an architecture README in every new module
- an updated dependency diagram if decisions change

## Acceptance criteria

- Every ambiguity under “Edge cases requiring decisions” has either a V1 decision or a named future stage.
- No core module depends on React.
- Multi-input priority rules are precise enough to test without human interpretation.
- The migration strategy keeps the application playable during intermediate stages.
- `npm run check` passes.

## Out of scope

- Domain structure implementation.
- Visual editor.
- Validation and resolution algorithms.

