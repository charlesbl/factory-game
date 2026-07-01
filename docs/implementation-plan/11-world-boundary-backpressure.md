# Stage 11 — Connect contracts to the world and handle backpressure

## Mission

Replace current production with event-driven contract execution. The world handles
integer items only; fractions remain inside each instance's bounded WIP.

## Buffers and WIP

- one input and output buffer per boundary port or resource;
- integer quantities and capacities;
- input reserve: an integer item removed from a buffer and then partially consumed;
- output reserve: partial work until one complete unit exists;
- default WIP capacity of one unit per resource;
- no world API can directly read or move WIP.

## Atomic rules

Whenever a factory wakes:

1. advance phases to the current time;
2. materialise every complete output its buffers can accept;
3. load required integer inputs when their reserves are empty;
4. enter `WAITING_INPUT` if a mandatory input is missing;
5. enter `OUTPUT_BLOCKED` if the next output cannot materialise before the WIP limit;
6. otherwise schedule the next internal event.

Adding an input wakes factories waiting for that input. Releasing output space
wakes factories blocked on that output.

## Legacy code migration

1. Make `Inventory` strictly integer and bounded, or create `WorldInventory` and adapt the legacy class.
2. Add a world facade that atomically transfers items between inventories and ports.
3. Replace `Game.tryConsumeFactory` with compiled instances and the scheduler.
4. Temporarily retain manual crafting through a separate event-driven adapter.
5. Change `GameLoop` so it advances logical time and notifies the UI instead of producing every 50 ms.
6. Connect React through snapshots without rerendering for invisible micro-events.
7. Remove legacy rate addition only after migration and save tests pass.

## Backpressure

- one blocked output stops the complete coupled programme;
- uncommitted inputs remain in their buffers;
- committed WIP is neither destroyed nor returned;
- the blocking reason identifies the responsible port, resource, and buffer;
- releasing space resumes from the preserved phase exactly.

## Required tests

- integer input loading with fractional consumption;
- exact output materialisation;
- empty input buffer followed by delivery wake-up;
- full output buffer followed by removal wake-up;
- secondary output blocking the entire programme;
- no additional input absorbed while blocked;
- world inventories remain integer after long simulations;
- legacy/new comparison for a simple recipe where rules coincide.

## Acceptance criteria

- `Game.update` no longer consumes fractions from the global inventory.
- Public types cannot construct a fractional world item.
- A blocked factory is not polled every frame.
- Backpressure and resumption preserve material exactly.
- The game remains playable with at least one compiled factory.
- `npm run check` and production E2E scenarios pass.

## Out of scope

- Trains and automatic transport between sites.
- Final IndexedDB persistence.
- Contract changes with incompatible WIP.

