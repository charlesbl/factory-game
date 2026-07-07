# Stage 19 — Mining, storage, and construction

Status: implemented — 2026-07-06

Depends on: Stages 16 and 18; approved construction catalogue data

## Mission

Make world expansion consume, produce, store, and recover only explicit integer
materials transported by pods.

## Implementation

1. Add data-driven build costs to component and major-building definitions and
   compile a canonical factory bill of materials.
2. Create persistent construction sites with dedicated requirements, deliveries,
   completion, cancellation, and evacuation states.
3. Implement mine-head placement outside deposits and connected drill ghosts on
   matching ore, including closest-first construction and per-tile exhaustion.
4. Implement shared-capacity multi-resource storage with per-resource limits and
   manual request/provider rules.
5. Implement exact dismantling, priority recovery buffers, request-first salvage,
   and forced nearest-storage fallback.
6. Preserve the external station during factory replacement and forbid implicit
   updates from changed blueprint drafts.

## Tests and acceptance

- Partial, complete, cancelled, blocked, and resumed construction conserve every
  item.
- Mine topology, construction order, output backpressure, exhaustion, and drill
  salvage are deterministic.
- Dismantling returns exactly 100% and sleeps when no valid destination exists.
- No operation creates a player inventory, hidden fractional stock, teleport, or
  material sink.
