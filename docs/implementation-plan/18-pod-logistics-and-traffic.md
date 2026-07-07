# Stage 18 — Pod logistics and traffic

Status: implemented — 2026-07-06

Depends on: Stages 16–17

## Mission

Replace abstract arrival jobs with deterministic, visible, collision-free pod
missions on directional rail.

## Implementation

1. Store orthogonal directional rail topology and derive one exclusive block per
   station, depot, junction, or intervening edge section.
2. Cache stable shortest paths by rail revision and reject disconnected missions.
3. Represent request creation, atomic assignment, movement, handling, blocked
   unloading, wake-up, direct reassignment, and depot return as events.
4. Apply the requester, provider, and pod tie-breaks from ADR 0006.
5. Reserve stock and pod capacity together; retain cargo at full destinations.
6. Wake only pods affected by a released block, berth, stock source, or
   destination capacity. Never poll the inactive fleet.
7. Publish structured mission, route, queue, reservation, cargo, and gridlock
   diagnostics for the world inspector.

## Tests and acceptance

- No block can have two occupants or reservations in any generated event trace.
- Equal-cost networks, simultaneous releases, provider competition, and pod ties
  have stable results independent of insertion order.
- Save/load and offline advancement during every mission phase are equivalent to
  uninterrupted live execution.
- Circular saturation remains conserved, visible, and stable without automatic
  recovery.
