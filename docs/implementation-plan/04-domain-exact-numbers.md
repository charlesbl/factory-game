# Stage 04 — Build the domain model and exact numbers

## Mission

Create the pure TypeScript core shared by the editor, compiler, simulation, and
persistence layers. Every persistent representation must be deterministic and
independent of framerate.

## Required numeric representation

Use `bigint` fixed-point arithmetic:

```ts
const RATE_SCALE = 1_000_000n
const TIME_TICKS_PER_SECOND = 1_000_000n

type RateRaw = bigint       // micro-items per second
type SimTime = bigint       // logical microseconds
type WorkRaw = bigint       // RateRaw × SimTime
```

One completed item equals `RATE_SCALE * TIME_TICKS_PER_SECOND` work units. Domain
operations must explicitly define rounding. Quantise capacities and rates down
when rounding up could violate a constraint.

`number` remains acceptable for display and temporary pointer coordinates, never
for persistent rates, phases, inventories, or logical time.

## Types to provide

- opaque or branded IDs for factories, nodes, ports, edges, resources, and contracts;
- `GridPoint`, `GridSize`, `GridRect`, and `Polyline`;
- `Rate`, `Capacity`, `SimTime`, and `WorkPhase`;
- immutable resource, recipe, machine, and port definitions;
- structured parsing and overflow errors;
- JSON codecs that serialise `bigint` values as decimal strings.

## Work

1. Implement the primitives without external dependencies.
2. Provide addition, subtraction, comparison, duration multiplication, ceiling division for the next event, and user formatting.
3. Protect world quantities with safe integers and an explicit maximum capacity.
4. Convert current JSON data through an adapter without removing legacy classes.
5. Validate resource and recipe JSON at runtime with typed local parsing functions.
6. Add readable test builders.

## Required tests

- exact decimal conversion for `2.50`, `0.30`, and `1.25`;
- no drift after many advancements;
- ceiling division for time to threshold;
- JSON round-trip of every `bigint` value;
- rejection of negative rates and non-integer coordinates;
- fast-check properties for addition, comparison, and serialisation;
- proof that two temporal subdivisions of the same duration produce the same final phase.

## Expected files

```text
src/domain/
  ids.ts
  fixed.ts
  geometry.ts
  resources.ts
  recipes.ts
  machines.ts
  serialization.ts
  index.ts
```

## Acceptance criteria

- The module imports neither React nor the DOM.
- No persistent logical state uses floating point.
- Numeric examples from the design document pass exactly.
- Types are externally immutable.
- Adapters read existing resource data without changing it.
- `npm run check` passes.

## Out of scope

- Editable graph.
- Solver.
- Final world inventories.

