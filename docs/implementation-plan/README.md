# Remaining implementation plan

This plan was audited against the current worktree on 2026-07-06. It contains
only work that is not implemented, or whose current implementation does not yet
meet the acceptance criteria in [`factory-graph-design.md`](../factory-graph-design.md).
Completed work has intentionally been removed.

The accepted V1 rules remain defined by
[`ADR 0001`](../adr/0001-factory-graph-v1-rules.md),
[`ADR 0005`](../adr/0005-procedural-world-and-rendering.md),
[`ADR 0006`](../adr/0006-directional-pod-traffic.md), and
[`ADR 0007`](../adr/0007-world-construction-and-recovery.md). ADR 0006
supersedes the abstract travel rules in ADR 0002. Keep `npm run check` and
`npm run test:e2e` green after every section.

## Execution order

| Order | Remaining scope | Depends on |
|---:|---|---|
| 1 | Domain, editor, and language regression gaps | Current code |
| 2 | Complete graph validation and path calculation | 1 |
| 3 | Replace the greedy allocator with the specified exact contract solver | 2 |
| 4 | Complete worker hashing, nesting, and invalidation | 3 |
| 5 | Complete graph-editor interactions and navigation | 1; may run alongside 2-4 |
| 6 | Close runtime, boundary, diagnostic, and footprint gaps | 3-5 |
| 7 | Complete current-schema persistence and offline progress | 4 and 6 |
| 8 | Prove invariants and performance budgets | 2-7 |
| 9 | [World domain and procedural generation](16-world-domain-and-generation.md) | 7-8 |
| 10 | [World renderer and editor](17-world-renderer-and-editor.md) | 9 |
| 11 | [Pod logistics and traffic](18-pod-logistics-and-traffic.md) | 9-10 |
| 12 | [Mining, storage, and construction](19-mining-storage-and-construction.md) | 9 and 11 |
| 13 | [World persistence, integration, and proof](20-world-persistence-integration-and-proof.md) | 9-12 |

## 1. Domain, editor, and language regression gaps

### Language regression

- Add an automated check for known French UI phrases and prohibited legacy
  spellings under active source and public assets.
- Add a current-save fixture proving that translated display names do not change
  persisted IDs or quantities.

### Domain model

- Validate item and recipe JSON at runtime instead of trusting TypeScript casts.
  Reject malformed arrays, invalid IDs, unknown resource references, invalid
  quantities, and duplicate definitions with structured errors.
- Complete the numeric API with explicit capacity types and structured range or
  overflow errors for persistent quantities.
- Add reusable test builders and regression tests for invalid catalogue data,
  world-quantity overflow, and every persistent exact-number codec.

### Blueprint commands

- Make a multi-command transaction increment the logical revision at most once.
  It must also remain one undo/redo entry.
- Produce accurate `ChangeSet` resources and child-contract dependencies for add,
  remove, recipe-change, external-port, and sub-factory commands.
- Validate duplicate or dangling external ports and invalid perimeter offsets.
- Add generative valid command sequences and prove undo/redo plus serialisation
  for every command, including external ports, recipes, sub-factories, and
  transactions.

## 2. Graph validation and paths

- Detect duplicate IDs before deserialisation can collapse them into a `Map`.
- Validate every integer coordinate, footprint, anchor, perimeter offset, port
  capacity, and connection limit, including data loaded from storage.
- Check reachability from boundary inputs to mandatory inputs and from mandatory
  outputs to boundary outputs; direct connection alone is not sufficient.
- Detect and reject additional independent productive components.
- Validate child-contract presence and compatibility against every sub-factory
  port.
- Replace the sorted-array route search with the specified tested priority queue.
  Stable Dijkstra ordering must use distance, geometry, and persistent IDs.
- Retain ordered equal-cost and longer alternatives plus predecessors so the UI
  can explain route selection.
- Calculate the multi-input machine priority key from maximum mandatory-input
  distance, total mandatory-input distance, `y`, `x`, and node ID.
- Return useful partial indexes, paths, components, and diagnostics when
  validation fails.
- Add one fixture per diagnostic, crossing-without-junction coverage, equal-path
  geometry and ID fallbacks, alternative-path coverage, child compatibility,
  independent components, and permutation properties.

## 3. Exact solver and immutable contract

The current `ExactDagFlowSolver` is a deterministic greedy allocator. It does not
implement the accepted coupled lexicographic optimisation and must be replaced,
not extended as if it were the final solver.

- Implement the `FlowSolver` adapter around the installed `glpk.js` dependency;
  no GLPK type may escape the adapter.
- Model machine activity, edge flow, boundary flow, recipe coupling, junction
  conservation, and edge/port capacities as constraints with stable names.
- Maximise machine activity sequentially in the stage-2 priority order, freeze
  each optimum, then minimise total flow distance and the final stable tie cost.
- Quantise every result down to fixed-point precision, reconstruct flows in stable
  order, and verify all equations and capacities again with `bigint`.
- Fail with an internal diagnostic when exact reconstruction cannot verify the
  floating-point solver result.
- Decompose final flows into stable paths and identify the limiting ingredient
  and first limiting segment for every reduced or inactive machine.
- Canonically serialise the complete immutable contract, including diagnostics
  and path explanations.
- Add fixtures for competing consumers, saturated shared buses, secondary paths,
  multi-input limits, output backpressure, geometry and ID ties, conservation,
  permutation invariance, and canonical contract snapshots.

## 4. Worker, content hash, cache, and nesting

- Define the content hash from logical blueprint data, recipe definitions, and
  child contract hashes. Exclude names, revisions, viewport state, and other
  non-compiling edits.
- Pass child contracts through `CompilationClient`; compile dirty children first
  and let parents read only immutable child contracts.
- Connect the dependency graph to editor changes, invalidate only ancestors whose
  observable child hash changed, and retain unaffected caches.
- Detect recursive blueprint references before compilation and return a
  displayable diagnostic.
- Project child ports, rates, and complete footprint, including nesting overhead,
  onto sub-factory nodes.
- Add a shared contract registry so equivalent blueprints and instances reuse the
  same immutable in-memory contract.
- Surface worker failures without losing the blueprint and expose bounded-cache
  metrics in development tools.
- Test stale responses, equivalent serialisations, non-compiling edits, shared
  contracts, targeted ancestor invalidation, unchanged children, recursion, and
  worker failure.

## 5. Graph editor completion

The proposed long-term interaction and routing model is detailed in
[`17-pcb-style-factory-editor.md`](17-pcb-style-factory-editor.md). Implement it
incrementally and require an ADR before introducing its versioned net/track
schema.

- Add placement and editing flows for external inputs, external outputs, and
  sub-factories; the current catalogue only creates machines and junctions.
- Add parent/child factory navigation and retain a viewport per factory.
- Add a validity preview while dragging a connection, before command execution.
- Add editable orthogonal polylines, explicit route geometry, snap/alignment
  guides, quick line construction, and explicit junction insertion.
- Add a resource-focused inspection mode.
- Complete keyboard and screen-reader behaviour for connection, movement,
  selection, duplication, deletion, undo, and redo.
- Add E2E coverage for compatible and incompatible connections, move/undo/redo,
  saved geometry reload, and parent/child navigation.
- Measure the actual 250-node editor interaction and meet the 60 FPS target on the
  documented reference machine.

## 6. Runtime, boundary, diagnostics, and footprint

### Event runtime and world boundary

- Process all actors at one logical timestamp as a stable atomic batch: advance,
  transition, publish external effects, wake affected actors, then reschedule.
- Add an injectable logical clock and test it independently from display time.
- Connect factories through a world facade that transfers integer items and wakes
  actors on input delivery or released output space; the current UI buttons are
  only a single-instance demonstration.
- Expose a structured stop reason containing the responsible port, resource, and
  buffer.
- Connect React through a snapshot-store adapter without rerendering for invisible
  micro-events.
- Add runtime tests for `0.30/s` and `2.50/s`, simultaneous actors, stale events,
  pause/resume, full-output sleep and wake, secondary-output backpressure, no
  extra input absorption while blocked, long-run integer inventories, and
  generative phase conservation.

### Diagnostics and footprint

- Show runtime rate separately from compiled rate, priority paths and alternatives,
  nominal versus actual activity, limiting ingredient, first limiting segment,
  structured runtime stop reason, boundary buffers, and WIP phases.
- Ensure every diagnostic code has an accessible text and non-colour rendering.
- Preserve the full child footprint and apply the ADR's one-cell nesting overhead.
- Handle perimeter overflow explicitly when more ports request cells than a side
  can provide; never silently overlap ports.
- Add footprint snapshots for compact, elongated, and nested factories.
- Add E2E scenarios for a saturated bus, full output followed by exact resumption,
  keyboard-only diagnosis, and high-contrast essential information.

## 7. Saving and offline progress

- Implement a validated load path that reconstructs blueprints, contracts,
  instances, inventories, dependencies, and logical time. Recompile a missing or
  disposable contract instead of treating it as authoritative.
- Include inventory and dependency records in atomic saves and remove stale
  records when authoritative objects are deleted.
- Validate every record and critical field before import or load. Accept only the
  current schema and reject incompatible data without modifying stored state.
- Complete versioned export/import and prove logical byte equivalence after a
  round trip.
- Implement recompilation actions for incompatible WIP: continue under the old
  contract or explicitly recycle/dispose residue. Never round or return a free
  item during recompilation or dismantling.
- Persist and resume an exhausted offline event budget. Add grouped advancement
  only where equivalence to event-by-event execution is proven.
- Test database round trips, incompatible-schema rejection, interrupted
  transactions, missing contracts, compatible and incompatible WIP, exact offline
  continuation, and material conservation during dismantling.

## 8. Invariants and performance evidence

- Add bounded generators for valid and invalid DAGs, rational recipes,
  capacities, blueprints, contracts, and event sequences.
- Add properties for every remaining invariant: capacity bounds, bounded WIP,
  collection permutation, time subdivision, save/load identity, deterministic
  contracts, sleeping blocked actors, and backpressure without destruction.
- Make failing seeds easy to copy into a permanent regression test.
- Benchmark actual compilation at 50, 250, and 1,000 nodes; actual editor
  interaction at 250, 500, and 1,000 nodes; actual runtime instance storage at
  10,000, 100,000, and 1,000,000 instances; scheduler active ratios; save/load;
  and offline advancement over one day and one month.
- Measure UI tasks against the 50 ms blocking budget, ordinary save load against
  two seconds, and the complete minimal-instance representation against 128 bytes.
  Typed-array allocation alone is not the complete instance measurement.
- Record CPU, memory, build, browser, datasets, and results on the reference
  machine. Optimise only bottlenecks demonstrated by those profiles.

## 9–13. Worldview integration

The abstract logistics milestone is replaced by the ordered worldview plans:

- [world domain and procedural generation](16-world-domain-and-generation.md);
- [PixiJS world renderer and editor](17-world-renderer-and-editor.md);
- [directional pod logistics and traffic](18-pod-logistics-and-traffic.md);
- [mining, storage, and construction](19-mining-storage-and-construction.md); and
- [persistence, integration, and proof](20-world-persistence-integration-and-proof.md).

These stages are part of V1, not post-V1 extensions. The old abstract rail
prototype may be reused only where it satisfies ADR 0006.

## V1 completion gate

V1 is complete only when all sections above pass and:

- a player can build, navigate, save, reload, and diagnose a nested spatial
  factory graph;
- identical logical blueprints always produce identical exact contracts;
- runtime and logistics use contracts and integer world buffers without traversing
  internal graphs;
- a seeded finite world can be generated, rendered, built on, exhausted, saved,
  reloaded, and advanced offline exactly;
- factories, mines, storage, stations, depots, and directional rail form one
  material-conserving construction and delivery loop;
- pods never collide, and blocked destinations or circular gridlocks are visible
  without polling or hidden recovery;
- WIP remains bounded and exact across backpressure, recompilation, save/load, and
  offline progress;
- blocked actors schedule no work; and
- the full invariant suite and measured performance budgets pass.
