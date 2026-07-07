# Stage 20 — World persistence, integration, and proof

Status: implemented — 2026-07-06

Depends on: Stages 16–19

## Mission

Make the complete worldview authoritative, resumable, diagnosable, and proven at
the V1 scale.

## Implementation

1. Let one world worker own generation, entities, factory actors, mines, requests,
   traffic, construction, reservations, and the logical scheduler.
2. Version every command and response, attach world revisions, return snapshots
   or deltas, and reject stale UI responses.
3. Save the complete grid, remaining ore, entities, contracts, inventories, rail,
   blocks, pods, missions, reservations, construction states, and logical time in
   one IndexedDB transaction.
4. Accept only the current save schema. Remove legacy migrations, recovery
   adapters, and partial legacy imports; reject incompatible data before writes.
5. Advance live and offline play through the same event handlers with a resumable
   budget.
6. Remove direct Supply/Collect demonstration mutations and connect factory world
   buffers exclusively through stations and pod deliveries.
7. Add world scenarios to invariant and performance harnesses.

## Tests and V1 gate

- Current-schema export/import is logically byte-equivalent; every older or
  malformed schema is rejected without changing stored state.
- Saves during movement, blocked unloading, extraction, construction, and
  dismantling resume exactly.
- Offline subdivision gives the same state as one continuous advancement.
- Generation does not block the UI; ordinary save/load completes within two
  seconds; the 256²/200-pod scene meets the renderer budget.
- V1 is complete only when the player can generate a world, construct and replace
  factories, mine finite iron and copper, configure storage and requests, and
  observe collision-free pod logistics without traversing an internal blueprint.
