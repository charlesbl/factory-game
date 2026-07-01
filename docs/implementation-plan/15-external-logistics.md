# Stage 15 — Add external logistics

## Mission

Build a discrete world transport system based on batches, deliberately separate
from the continuous internal graph. Begin only after contracts, buffers, saves,
and performance budgets are stable.

## V1 model

- directed or bidirectional rails according to their definition;
- vehicles with integer capacity, speed, state, and optional fuel;
- stations connected to world buffers, never WIP;
- provider stations publishing available stock;
- requester stations publishing demand and thresholds;
- depots assigning idle vehicles;
- integer batch delivery;
- atomic reservation of items and transport capacity.

## Separate architecture

```text
FactoryRuntime <-> WorldBuffer <-> Station <-> DeliveryJob <-> Vehicle
```

The dispatcher knows nothing about internal factory nodes. It sees only world
ports, stocks, capacities, and requests.

## Decisions required before implementation

1. rail direction and crossing rules;
2. path choice through Dijkstra or A* with integer costs;
3. segment reservation or abstract travel time in V1;
4. minimum and maximum batch sizes;
5. request priority and stable tie-breaking;
6. behaviour when a destination becomes full;
7. whether fuel and depots are included or deferred;
8. whether railway deadlocks are simulated or abstracted.

## Recommended increments

1. Instantly connected provider and requester to validate demand and reservation.
2. Delivery jobs and vehicles with fixed travel time.
3. Rail graph and stable path calculation.
4. Depots and vehicle assignment.
5. Capacity, fuel, and unavailability.
6. Signalling or network reservation if gameplay requires it.

## Events

- request created, changed, or satisfied;
- provider stock becomes available;
- vehicle assigned;
- loading completed;
- arrival at a station;
- unloading possible or destination blocked;
- vehicle returned to a depot.

These events use the same logical clock and stable ordering rules as factories,
but distinct actor types.

## Required tests

- no fractional delivery;
- reservations prevent two vehicles from loading the same items;
- priority and tie-breaking are reproducible;
- a full requester waits without loss;
- an exhausted provider wakes when production resumes;
- stable paths on equal-cost networks;
- save during transit and exact continuation;
- equivalent offline simulation;
- many inactive stations without global polling.

## Acceptance criteria

- World logistics never traverses an internal blueprint.
- Every stock and batch is an integer.
- Inactive or blocked transport is not polled every tick.
- A full destination destroys neither cargo nor production.
- Dispatch decisions are deterministic and explained in the UI.
- Save, load, and offline progress cover vehicles in transit.
- `npm run check`, relevant E2E tests, and benchmarks pass.

## V1 exclusions

- Opaque adaptive routing.
- Cost-free teleportation between stations after the validation increment.
- Factorio-style circuit-network complexity without a new design document.

