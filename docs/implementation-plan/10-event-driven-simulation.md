# Stage 10 — Implement event-driven simulation

## Mission

Create a pure runtime that executes a `FactoryContract` without traversing its
graph and without per-tick polling. Keep it isolated from the legacy world system;
stage 11 performs the integration.

## Instance state

```ts
type FactoryState =
  | 'RUNNING'
  | 'WAITING_INPUT'
  | 'OUTPUT_BLOCKED'
  | 'PAUSED'
  | 'INVALID'
```

An instance contains only its ID, contract reference, boundary buffers, WIP
phases, state, last advanced time, event generation, and optional next event.

## Scheduler

Implement a binary heap ordered by:

```text
(eventTime, actorId, eventSequence)
```

Every event stores the actor's current generation. Ignore an old event whose
generation no longer matches, avoiding expensive removal from the heap.

At one logical date:

1. extract all relevant events;
2. advance every actor to that date;
3. apply internal transitions in stable order;
4. publish external effects;
5. wake affected actors;
6. schedule their next events.

## Advancement calculation

- add `rateRaw * deltaTime` to every phase;
- calculate input depletion and output completion using integer ceiling division;
- process simultaneous thresholds atomically;
- do not schedule an actor with no future event;
- interpolate visuals elsewhere without logical mutation.

## Work

1. Create a compact `FactoryRuntimeInstance` independent of the blueprint.
2. Implement the heap and typed events.
3. Implement `advanceTo`, `computeNextEvent`, and state transitions.
4. Implement pause, resume, invalidation, and a WIP-empty contract swap for tests.
5. Add an injectable logical clock.
6. Add counters for processed events, scheduled actors, and sleeping actors.
7. Prepare a snapshot subscription API for React through `useSyncExternalStore` without importing React into the runtime.

## Required tests

- `0.30/s` and `2.50/s` rates from the design examples;
- identical result from one `advanceTo` call or one thousand intermediate calls;
- simultaneous events in stable order;
- stale event ignored after a wake-up;
- blocked factory absent from the heap;
- pause and resume without creating material;
- exact snapshot save and continuation;
- generative conservation tests for phases.

## Acceptance criteria

- Simulation never reads blueprint nodes or edges.
- A sleeping factory performs zero work per display tick.
- Results depend on neither framerate nor call subdivision.
- Every persistent time and phase uses `bigint`.
- `npm run check` passes.

## Out of scope

- Transport between world actors.
- React animation.
- Grouped offline simulation.

