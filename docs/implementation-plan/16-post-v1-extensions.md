# Stage 16 — Extend the system after V1 validation

## Mission

Implement, one at a time and behind explicit schema versions, the capabilities
deliberately excluded from V1. This is an ordered backlog, not authorisation to
develop everything in one change.

Every extension begins with an ADR, a gameplay prototype, and tests proving that
it preserves determinism, conservation, diagnostics, and event-driven simulation.

## Extension A — Power, heat, and cooling

1. Add nominal consumption or production coupled to `u_m` in machine definitions.
2. Decide whether these quantities are graph flows, global factory budgets, or separate networks.
3. Add the corresponding solver constraints without an opaque objective.
4. Version `FactoryContract` with `energyRate`, `heatRate`, or equivalent constraints.
5. Wake an instance only when relevant network availability changes.
6. Display the limiting constraint as clearly as a material resource.

## Extension B — Explicit filter and priority nodes

1. Every advanced behaviour is a visible, placed, and costly node.
2. A filter limits accepted resources without hidden edge configuration.
3. A priority node defines a visible, stable local order.
4. A ratio distributor has a capacity, footprint, and exact rules; it is not a free property of every junction.
5. Extend validation, solver, serialisation, diagnostics, and duplication for each type.

## Extension C — Multiple independent programmes

1. Detect genuinely independent components after validating resources and outputs.
2. Compile a contract containing several `CompiledProgram` values instead of arbitrary decoupling.
3. Give every programme its own phases, state, and next event.
4. Share footprint and ports without letting one blocked output stop unrelated programmes.
5. Measure additional memory cost before broad activation.

## Extension D — Cycles, recycling, and catalysts

1. A cycle must contain an explicit buffer, delay, or state that breaks the instantaneous equation.
2. Define start conditions through initial stock, catalyst, or start-up cost.
3. Extend the contract with `startupCost` and required runtime state.
4. Prove that the cycle creates no material and can be saved exactly.
5. Explain empty, primed, and blocked cycles visually.

## Extension E — Production-grade numbers and solver

Consider only if stage 14 demonstrates a GLPK or quantisation limitation:

- a specialised integer solver operating directly at fixed-point granularity;
- an exact rational solver for reasonably sized graphs;
- a Rust/WASM core behind `FlowSolver`;
- parallel decomposition by proven-independent resource or component.

The replacement must reproduce reference contracts exactly or include an
explicitly approved gameplay-rule migration.

## Common required tests

- generative conservation and determinism;
- versioned contracts and saves;
- migration from the previous version;
- diagnostics for every new limiting cause;
- memory, compilation, and event benchmarks;
- no runtime dependency on the compiled blueprint.

## Acceptance criteria for each extension

- An ADR and gameplay prototype have been approved.
- The extension remains optional in legacy data.
- Existing blueprints produce the same observable contract.
- New state saves and advances offline correctly.
- All applicable stage 14 invariants and budgets remain green.

## Permanent prohibitions

- arbitrary hidden logic on every connection;
- secret optimisation contradicting visible geometry;
- unlimited fractional storage;
- polling all instances on every tick;
- a cycle without explicit physical state.

