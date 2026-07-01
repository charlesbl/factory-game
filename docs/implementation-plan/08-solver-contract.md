# Stage 08 — Resolve flows and produce a contract

## Mission

Turn a `ValidatedGraph` into a deterministic rate allocation and then an immutable
`FactoryContract`. Implement coupled recipes, capacities, priorities, and
bottleneck diagnostics.

## Dependency

The stable version recorded on 1 July 2026 is `glpk.js@5.0.0`, requiring Node 20
or later. Check the latest stable version before installation and save it exactly.

GLPK is an implementation detail behind a `FlowSolver` interface. No GLPK type may
escape its adapter.

## Variables and constraints

- `u_m`: continuous activity for each machine, where `0 <= u_m <= 1`;
- `f_e`: rate on each edge, where `0 <= f_e <= edge capacity`;
- boundary variables for external inputs and outputs;
- conservation of each resource at every junction;
- recipe consumption and production proportional to the same `u_m`;
- port and connection capacities;
- no creation or destruction outside an explicit recipe.

## Deterministic objective

1. Order machines by the priority key from stage 03.
2. Maximise the first machine's `u_m`, freeze its optimum, and continue in order.
3. After freezing all activities, minimise `sum(f_e × edge length)`.
4. Apply a final stable cost derived from geometry and then identifier.

Do not replace this with “maximise total production”; that would change the
shortest-priority gameplay rule.

## Canonisation and exact verification

GLPK calculates with floating point. Never accept its output directly:

1. quantise activities and rates to domain fixed-point precision;
2. never round above a capacity;
3. reconstruct or adjust flows in stable order;
4. verify every equation with `bigint`;
5. fail compilation with an internal diagnostic if exact verification fails.

The final contract contains no floating-point value from GLPK.

## Minimum contract

```ts
interface FactoryContract {
  readonly schemaVersion: number
  readonly blueprintHash: string
  readonly inputRates: ReadonlyMap<ResourceId, Rate>
  readonly outputRates: ReadonlyMap<ResourceId, Rate>
  readonly inputPorts: readonly CompiledPort[]
  readonly outputPorts: readonly CompiledPort[]
  readonly footprint: GridRect
  readonly machineActivity: ReadonlyMap<NodeId, FixedRatio>
  readonly edgeFlows: ReadonlyMap<EdgeId, Rate>
  readonly diagnostics: readonly CompileDiagnostic[]
}
```

## Work

1. Create the solver interface and GLPK adapter.
2. Build the LP with stable names traceable to entities.
3. Implement sequential lexicographic optimisation.
4. Quantise and exactly verify the result.
5. Decompose flows into stable paths for the overlay.
6. Identify the first limiting input or segment for every machine.
7. Calculate net boundary rates and the immutable contract.
8. Produce canonical contract serialisation.

## Required tests

- a simple line at full capacity;
- two consumers where the nearer one is served first;
- a secondary path used after saturation;
- a saturated shared bus;
- a multi-input machine limited by one ingredient;
- insufficient output capacity reducing upstream activity;
- geometric ties and final ID fallback;
- exact conservation in every fixture;
- the same contract after permuting nodes and edges;
- canonical snapshots for major gameplay examples.

## Acceptance criteria

- The same blueprint produces the same contract and diagnostics.
- Every constraint is verified again using `bigint`.
- No rate exceeds capacity, even by one fixed-point unit.
- No machine advertises more than its sustainable activity.
- The solver can be replaced through its interface without changing domain or UI code.
- `npm run check` passes.

## Out of scope

- World execution of the contract.
- MILP with arbitrary logic.
- Cycles, programmable filters, or general internal storage.

