# Graph-based factory implementation plan

This directory turns [`factory-graph-design.md`](../factory-graph-design.md) into
stages that an AI coding agent can execute independently. Each document defines
its scope, required decisions, expected files, tests, acceptance criteria, and
handover requirements.

## Rules for an implementing agent

1. Read the complete design document, this index, and the current stage before changing code.
2. Run `git status --short` and preserve unrelated user changes.
3. Complete one stage at a time. Do not anticipate later stages except for a small, explicitly documented prerequisite.
4. Keep the build, lint checks, and tests passing at the end of every stage.
5. Never use interface pixels as logical data. Positions, lengths, and priorities use the domain's integer grid.
6. Never introduce floating-point `number` values into persistent simulation state.
7. Record any divergence from this plan in the stage document and final handover.
8. Before adding a package, check its latest stable version and peer dependencies with `npm view <package> version peerDependencies engines`.
9. Write source code, user-facing text, diagnostics, comments, tests, and new documentation in international English after stage 02.

## Stage order

| Stage | Document | Main outcome | Depends on |
|---:|---|---|---|
| 01 | [Modernise the toolchain](01-modernise-toolchain.md) | Modern runtime, tests, linting, and builds | — |
| 02 | [Migrate the project to international English](02-project-language-migration.md) | English UI, source terminology, data, and language rules | 01 |
| 03 | [V1 decisions and architecture](03-v1-decisions-architecture.md) | Ambiguities resolved and module boundaries fixed | 02 |
| 04 | [Domain model and exact numbers](04-domain-exact-numbers.md) | Pure types, integer grid, and fixed-point arithmetic | 03 |
| 05 | [Blueprint and edit commands](05-blueprint-edit-commands.md) | React-independent editable graph | 04 |
| 06 | [Visual graph editor](06-react-flow-editor.md) | Placement and connections with React Flow | 05 |
| 07 | [Validation and paths](07-validation-paths.md) | Structural validation and stable Dijkstra paths | 05 |
| 08 | [Solver and contract](08-solver-contract.md) | Deterministic compiled rates | 07 |
| 09 | [Worker, cache, and nesting](09-worker-cache-nesting.md) | Asynchronous compilation and sub-factories | 08 |
| 10 | [Event-driven simulation](10-event-driven-simulation.md) | Runtime without per-tick production polling | 04, 08 |
| 11 | [World boundary and backpressure](11-world-boundary-backpressure.md) | Integer buffers, WIP, and backpressure | 10 |
| 12 | [Diagnostics, footprint, and usability](12-diagnostics-footprint-ux.md) | Visual explanations and compiled shape | 06, 09, 11 |
| 13 | [Saving and offline progress](13-save-offline.md) | IndexedDB, migrations, and offline advancement | 09, 11 |
| 14 | [Quality and scalability](14-quality-performance.md) | Generative invariants and benchmarks | 09–13 |
| 15 | [External logistics](15-external-logistics.md) | Rails, stations, and batch deliveries | 11, 13, 14 |
| 16 | [Post-V1 extensions](16-post-v1-extensions.md) | Power, advanced nodes, multiple programmes, and controlled cycles | 14; 15 where relevant |

Stages 06 and 07 may proceed in parallel after stage 05. All other dependencies
must be respected.

## Global definition of done

The V1 system is complete when:

- a player can build and diagnose a spatial factory graph;
- the same blueprint always produces the same contract;
- a compiled factory never executes its internal graph in the world;
- the world contains integer items only;
- fractions exist only as bounded WIP;
- blocked factories are not polled on every tick;
- sub-factories share immutable contracts;
- save, load, and offline progress preserve material exactly;
- the invariant tests and performance budgets from stage 14 pass.

Stage 16 is a structured backlog for capabilities described as future or optional
in the design document. It does not block the V1 definition of done.

