# ADR 0006: Directional pod traffic and request logistics

Status: accepted — 2026-07-06
Supersedes: ADR 0002 rail direction and abstract travel rules

## Context

ADR 0002 deliberately represented travel as one exact arrival event and allowed
bidirectional edges by default. A physical world with visible pods requires
exclusive track capacity, queues, junction arbitration, and an explainable
position throughout a mission.

## Decision

Every V1 rail edge is orthogonal and directional. Crossings connect only through
an explicit node. Stations, depots, and junctions derive capacity-one blocks.
A pod reserves a block before entry and releases it at the exact exit event;
two pods can never reserve or occupy the same block.

Pods are identical, carry one resource, hold ten items, and travel at ten grid
cells per second. Loading and unloading each occupy the station's single berth
for one logical second regardless of batch size.

Requests are ordered by descending priority, creation time, and station ID.
Providers are ordered by descending priority, route distance, and ID. The idle
pod with the shortest route to the selected provider wins, with pod ID as the
stable tie. Provider stock and pod capacity are reserved atomically. A mission's
route does not change after assignment.

After unloading, a pod is reassigned immediately when possible; otherwise it
travels to the nearest reachable depot with capacity. A full destination retains
cargo and wakes the pod only when space is released.

The engine prevents collisions and rear-end overlap. A saturated directed cycle
may gridlock; V1 diagnoses the blocking chain and does not reroute, reverse, or
delete pods automatically.

## Consequences

- Existing bidirectional rail data is not accepted by the new current-only world
  schema.
- Block transitions, handling, assignment, and wake-ups are logical-clock events.
- Route caches are keyed by rail revision and invalidated only by topology edits.

