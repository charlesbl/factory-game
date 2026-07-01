# Stage 14 — Prove invariants and scalability

## Mission

Turn performance and determinism objectives into measurable tests and budgets.
Optimise only limits demonstrated by profiling.

## Generative invariants

Use `fast-check` and `@fast-check/vitest` to generate bounded DAGs, rational
recipes, capacities, and event sequences. Verify:

1. conservation of every resource;
2. every capacity is respected;
3. world items are always integers;
4. WIP is always bounded;
5. permutation of collections does not change results;
6. subdividing time does not change results;
7. save/load round-trips preserve state;
8. an identical blueprint produces an identical contract;
9. a blocked actor has no future event;
10. backpressure causes no implicit destruction.

Print failure seeds and make them reusable.

## Required benchmarks

Create reproducible scenarios for:

- compilation of 50, 250, and 1,000 nodes;
- editor interaction with 250, 500, and 1,000 visible nodes;
- creation of 10,000, 100,000, and 1,000,000 minimal instances;
- scheduler behaviour at different active-actor ratios;
- saving and loading realistic volumes;
- offline advancement over one logical day and month.

## Initial budgets

Measure on a documented reference machine:

- dragging and zooming 250 nodes: median 60 FPS;
- ordinary edit preview: under 100 ms for 250 nodes;
- no UI-blocking task longer than 50 ms;
- blocked factory: zero scheduled events;
- minimal instance target: below 128 bytes excluding variable buffers;
- ordinary initial save load: under 2 seconds.

These are initial budgets. Any change requires measured justification and user
experience evidence.

## Strategies permitted after profiling

- structure-of-arrays storage and typed arrays grouped by contract;
- lazily allocated buffers;
- periodic compaction of stale heap events;
- bounded LRU caches for contracts and paths;
- simplified rendering by zoom level;
- replacement of the React Flow floor with PixiJS only if the editor remains the bottleneck after documented optimisation;
- replacement of GLPK behind `FlowSolver` if it is the bottleneck or produces unacceptable determinism.

The PixiJS version observed on 1 July 2026 is `pixi.js@8.19.0`, for conditional
reference only. Do not install it without a benchmark-based decision.

## Work

1. Add generators for valid and invalid graphs.
2. Add invariant suites separate from example tests.
3. Add Node and browser benchmark harnesses.
4. Document the reference machine, browser, build, and dataset.
5. Profile CPU and memory for every scenario.
6. Fix proven bottlenecks without changing observable rules.
7. Add a lightweight CI check and keep large benchmarks as a reproducible manual command.

## Acceptance criteria

- Every design-document invariant has at least one automated test.
- Generative counterexamples are reproducible.
- Budgets are measured and recorded, not estimated.
- The “millions of factories” goal has a real memory measurement and known limits.
- Every conditional dependency or optimisation is supported by a profile.
- `npm run check`, E2E tests, and the invariant suite pass.

## Out of scope

- An absolute promise of one million simultaneously active instances.
- A Rust/WASM rewrite without benchmarks.
- Railway logistics.

