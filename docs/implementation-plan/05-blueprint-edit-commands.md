# Stage 05 — Model the blueprint and edit commands

## Mission

Implement a pure editable graph independent of React Flow. Every change goes
through a reversible command to support undo/redo, incremental compilation, and
deterministic tests.

## Target model

```ts
interface FactoryBlueprint {
  readonly id: FactoryId
  readonly revision: number
  readonly name: string
  readonly nodes: ReadonlyMap<NodeId, BlueprintNode>
  readonly edges: ReadonlyMap<EdgeId, BlueprintEdge>
  readonly externalPorts: readonly ExternalPort[]
}
```

The minimum node variants are machine, junction, external input, external output,
and sub-factory. Every port has a stable ID, direction, resource, capacity, and
anchor on the node footprint.

## Minimum commands

- add, move, and remove a node;
- connect and disconnect two ports;
- change connection geometry;
- change a recipe where the machine type permits it;
- add, move, and remove an external port;
- replace a sub-factory contract reference;
- rename the factory;
- group several commands into one atomic transaction.

Every command returns a new blueprint or a reversible patch. It declares whether
it affects compilation. Purely visual changes do not increment the logical revision.

## Work

1. Define node, port, and connection types.
2. Implement an editing store without a React dependency.
3. Implement commands and transactions.
4. Add undo/redo with a configurable limit.
5. Inject the ID factory for tests and duplication.
6. Define canonical serialisation: maps sorted by ID, integer coordinates, and no UI properties.
7. Calculate a change set that tells the compiler which resources or sub-factories are invalidated.
8. Add an initial adapter from a legacy `Factory` to a simple blueprint containing its disconnected machines; this is a migration aid, not a valid compilation.

## Required tests

- every command followed by its inverse restores the exact canonical blueprint;
- removing a node removes its edges in the same transaction;
- connections reject incompatible port directions or resources;
- duplication creates new stable IDs without changing the original;
- a visual-only change does not change the logical revision;
- undo/redo remains deterministic after serialisation and loading;
- generative tests cover valid command sequences.

## Expected files

```text
src/editor/
  blueprint.ts
  nodes.ts
  edges.ts
  commands/
  history.ts
  canonicalize.ts
  change-set.ts
  index.ts
```

## Acceptance criteria

- The blueprint contains no React component or selection state.
- Every mutation goes through a tested command.
- Canonical serialisation is byte-for-byte stable for the same graph.
- Logical positions use integer grid coordinates.
- `npm run check` passes.

## Out of scope

- Visual graph rendering.
- Global cycle and path validation.
- Rate calculation.

