# Graph-based factory system

> Design document — product vision, simulation rules, and architectural constraints.
>
> Status: the design direction has been accepted. Some exact parameters and edge
> cases still need prototyping; they are collected near the end of this document.

## 1. Problem to solve

The current system converges too easily towards a single “super-factory” capable
of producing everything quickly. Once the player obtains this factory, few
interesting decisions remain: logistics, factory shape, and production-chain
organisation have too little impact.

The new system must make a factory's internal organisation a design problem in
its own right. The player must not merely own the correct machines; they must
connect them, supply them, and remove their products within a constrained space.

The desired complexity must be **emergent**. It should arise from a small set of
spatial and logistical rules interacting with one another, rather than from an
accumulation of configuration panels, manual ratios, and invisible exceptions.

## 2. Overall vision

The game deliberately contains two distinct logistical layers.

### 2.1 Inside a factory

The interior is an editable spatial graph:

- machines and sub-factories are nodes;
- their ports are resource input and output points;
- conveyors are edges;
- several lines can merge into higher-capacity lines or buses;
- connection length, capacity, and topology have real effects;
- flows are expressed as continuous rates, generally displayed in units per second.

The player primarily places and connects elements. They influence the result
through graph geometry rather than by configuring every branch.

When the player modifies the interior, the graph is resolved and then
**compiled**. Once compiled, it is replaced by a compact contract describing its
external rates.

### 2.2 In the world

The world handles discrete objects:

- every transported or stored item is an integer;
- inventories contain integer quantities;
- factories operate through input and output buffers;
- future external transport may use miniature railways, stations, providers,
  requesters, and logic similar to Factorio train networks with LTN.

World logistics is not an extension of the internal graph. The two layers should
contrast with each other: the interior is about rates and circuit design, whereas
the exterior is about stocks, deliveries, batches, and vehicle availability.

The external railway system is a future development. This document concentrates
on the factory layer and on the boundary between a compiled factory and the world.

## 3. Design objectives

The system must:

1. prevent a simple accumulation of machines from automatically creating a perfect factory;
2. make topology, distance, capacity, and occupied space meaningful;
3. produce deterministic, predictable results;
4. avoid micro-configuration of splitters and priorities;
5. let players change behaviour by physically changing the graph;
6. explain visually why a machine is running, slowing down, or blocked;
7. support nested factories without recursively simulating all their graphs;
8. eventually support a very large number of compiled factories;
9. retain integer items in the world even when internal ratios are fractional;
10. avoid a global calculation on every tick.

## 4. Non-objectives

The system does not attempt to:

- simulate each item individually inside a compiled factory;
- permit arbitrary internal behaviour comparable to a programmable computer;
- secretly optimise a factory on the player's behalf;
- require a manual policy at every junction;
- guarantee that a poorly designed factory still reaches its theoretical rate;
- use one second as the logical simulation step.

The `/s` suffix is a unit of measurement and display. It is not the frequency at
which the simulation must be evaluated.

## 5. Vocabulary

### Editable factory

The spatial graph that the player is currently building or modifying.

### Compiled factory

The validated result of an editable graph. For the current simulation, its
contents are replaced by a rate contract, a footprint, and a set of ports.

### Node

A machine, sub-factory, input, output, junction, or other functional graph element.

### Edge

A logistical connection between two ports. An edge has at least a direction,
length, and capacity.

### Bus

A high-capacity connection, or set of connections, used as a shared trunk by
several flows.

### Discrete buffer

A visible inventory containing integer items only. It belongs to the world layer.

### Internal reserve / WIP

A fractional quantity of material or product currently being transformed. WIP
means *work in progress*. This reserve belongs to the compiled actor and is not a
general-purpose logistical inventory.

### Contract

An immutable summary of a compiled version: input and output vectors per second,
ports, footprint, and any additional costs.

## 6. Building the internal graph

### 6.1 Machines

Each machine has:

- a fixed recipe;
- one or more typed input ports;
- one or more typed output ports;
- a maximum production capacity;
- a spatial footprint;
- optionally, power, cooling, or another shared constraint.

For normalised activity `u` between `0` and `1`:

```text
consumption rate = nominal input rate × u
production rate  = nominal output rate × u
0 ≤ u ≤ 1
```

A machine with several inputs cannot consume one ingredient while ignoring the
others. Its activity is calculated jointly so that all recipe ratios are respected.

### 6.2 Connections

A connection has at least:

- an origin and a destination;
- an accepted resource type, either explicit or inferred;
- a maximum capacity;
- a length calculated from its geometry;
- a saturation state.

A straight line is the basic connection. Lines may join to form a wider line or
bus. The visual representation should make the available capacity understandable
without opening a properties panel.

A free connection with no capacity or distance effect would make placement merely
cosmetic. Capacity and distance must therefore influence resolution.

### 6.3 Ports

Ports make machine layout meaningful. They define:

- where a resource may enter or leave;
- how many connections can be attached;
- an optional initial line direction;
- the space required to connect a machine to a bus.

The number and position of ports are easier to understand than a long list of
abstract parameters.

## 7. Deterministic routing policy

The central policy is: **serve the shortest available path first**.

This policy is deliberately implicit and universal. The player manipulates it by
changing graph geometry.

### 7.1 Conceptual order

For a given resource:

1. identify valid paths;
2. use the shortest total path first;
3. when it reaches capacity, make the next path available;
4. if several paths have exactly the same length, use a stable tie-breaker;
5. keep the decision identical while graph and capacities remain unchanged.

The stable order may derive from a visible property, for example top-left to
bottom-right geometry. A technical identifier may be the final tie-breaker, but it
must not be the only explanation perceptible to the player.

### 7.2 Several consumers

If several machines request the same resource, the machine reachable through the
shortest total path is supplied first. A distant machine receives the remaining
rate after higher-priority paths are satisfied or saturated.

This rule naturally creates:

- priority consumers placed near a source or bus;
- long branches supplied by surplus;
- trade-offs between compactness and congestion;
- backup lines used only when primary paths saturate.

### 7.3 Junctions and buses

A junction does not need a ratio configuration screen. It follows the same
distance and capacity rules as the rest of the graph.

- At a merge, flows add up to the shared line's capacity.
- At a split, the shortest total path is served first.
- If a priority branch is saturated, the remaining flow may use subsequent branches.
- If the shared bus saturates, downstream branches cannot all receive their nominal demand.

Advanced filter, priority, or distribution nodes may be introduced later. They
must be explicit objects placed in the graph, not hidden parameters on every line.

### 7.4 Unique result

A flow graph does not naturally have a unique solution. The result becomes
deterministic through a hierarchy of rules, for example:

1. respect recipes and resource conservation;
2. respect machine, port, and connection capacities;
3. use the shortest paths first;
4. use later paths only after earlier paths saturate;
5. apply a stable geometric tie-breaker;
6. use a stable identifier as the final fallback.

The implementation may use minimum-cost flow, a linear constraint solver, or a
specialised algorithm. The technical choice is secondary: the observable rules
above are the gameplay contract.

The solver must not invent an opaque policy that produces “what seems most useful”.
Recipes, connections, and output ports placed by the player define demand.

## 8. Missing resources, surplus, and backpressure

The default behaviour remains simple and physical.

### Missing input

A machine reduces its activity to the rate compatible with all its inputs. If an
essential ingredient is absent, its activity falls to zero.

### Blocked output

If a product can no longer be removed and its permitted reserve is full, the
producing machine slows down and then stops. This blockage propagates upstream as
backpressure.

### Input surplus

Surplus remains upstream. A machine does not absorb more material than its recipe
and output capacity allow it to transform.

### Output surplus

Surplus first fills the explicitly available buffer. Production stops when that
buffer is full. No resource is destroyed implicitly.

Any grinder, disposal unit, or recycling system must be an explicit machine with
a cost and capacity.

## 9. Compiling a factory

### 9.1 When to compile

Compilation is triggered when a structural change affects the graph:

- adding, removing, or moving a machine;
- adding, removing, or modifying a connection;
- changing a recipe;
- modifying an external port;
- modifying or recompiling a sub-factory;
- changing a property that affects capacities or distances.

Moving the camera, opening a panel, or changing a purely visual element must not
invalidate the contract.

### 9.2 Conceptual stages

Compilation:

1. validates graph structure and port types;
2. builds possible paths;
3. applies capacities and the shortest-path policy;
4. calculates sustainable activity for every machine;
5. verifies resource conservation;
6. calculates net boundary rates;
7. calculates the footprint and external ports;
8. produces an immutable, versioned contract;
9. caches that contract until the next relevant modification.

### 9.3 Validity

Compilation must reject or clearly report:

- an unreachable mandatory input;
- an output with neither a destination nor an external port;
- a resource mismatch on a connection;
- zero capacity or an unintentionally isolated component;
- an unsupported cycle;
- inconsistent net production;
- ambiguity that the tie-breaking rules cannot resolve.

A factory may compile with inactive or under-supplied machines if the interface
explicitly presents them as such. It must never advertise their nominal rate as
actually available.

## 10. Compiled factory contract

For the first version, a compiled factory represents **one fixed, coupled
production programme**.

A contract contains at least:

```text
FactoryContract
  version
  inputRates:  resource -> rational quantity per second
  outputRates: resource -> rational quantity per second
  inputPorts
  outputPorts
  footprint
  routing/compile hash
```

It may also contain:

```text
  energyRate
  heatRate
  startupCost
  diagnostics
  visualSummary
```

Example:

```text
Inputs:
  copper   0.30/s
  iron     1.25/s

Outputs:
  circuit  2.50/s
```

Rates may be fractional. There is no need to find a shared integer cycle such as
“6 copper and 25 iron every 20 seconds”.

### 10.1 Coupled programme

All contract rates describe the same programme. At full speed, all inputs are
consumed and all outputs are produced in the advertised proportions.

If a required resource is missing or one mandatory output is blocked, the entire
programme stops. This strict but clear rule avoids encoding every possible
combination of internal behaviour into the contract.

The fractional buffer solves non-integer ratios. It does not automatically let an
independent branch continue when the rest of the factory is blocked.

A future version may detect genuinely independent subgraphs and compile several
programmes inside one envelope. This is not required for the first version.

## 11. Boundary between continuous flows and discrete items

A compiled factory has two storage layers.

```text
World                                      Compiled factory

integer items -> integer input buffer -> fractional input reserve
                                                |
                                      continuous production
                                                |
integer items <- integer output buffer <- fractional output reserve
```

### 11.1 Discrete buffers

Input and output buffers:

- contain integer item counts only;
- are visible and accessible to world logistics;
- have finite capacity;
- are the factory's actual logistical reserve.

### 11.2 Fractional reserves

For each contract resource, the compiled actor keeps a small internal reserve:

- an input reserve represents an integer item already committed to the process
  and then partially consumed;
- an output reserve represents a partially manufactured product;
- conveyors and trains cannot access these reserves directly;
- they represent work in progress, not hidden free storage.

Each reserve should have a small capacity, ideally around one unit per port or
resource. A factory must not absorb thousands of items into an invisible
fractional inventory.

### 11.3 Loading an input

When an input reserve is empty and production needs to continue:

1. the factory removes one integer item from the corresponding discrete buffer;
2. the internal reserve increases by `1`;
3. the reserve is consumed continuously at the contract rate;
4. a new integer item is required when it reaches zero.

Example for `0.30 copper/s`:

```text
t = 0.000 s: load one copper, reserve = 1.00
t = 1.000 s: reserve = 0.70
t = 2.000 s: reserve = 0.40
t = 3.000 s: reserve = 0.10
t = 3.333 s: reserve = 0.00, next copper required
```

An item loaded into the reserve is considered committed to manufacturing. It is
no longer simultaneously available in the external inventory.

### 11.4 Materialising an output

Production continuously increases the fractional output reserve. Whenever it
reaches one unit:

1. an integer item is created in the discrete output buffer;
2. the fractional reserve decreases by `1`;
3. the item becomes available to world logistics.

At `2.50 circuits/s`, one circuit is completed every `0.40 s` while the factory
runs at full speed.

### 11.5 Full output

If the discrete buffer cannot accept the next item:

- the output reserve may progress up to its WIP limit;
- production stops before exceeding that limit;
- the entire programme remains blocked until space becomes available;
- no unlimited stock accumulates outside the world.

## 12. Event-driven simulation

A blocked factory must not be checked on every tick. It wakes only for a relevant event.

### 12.1 Possible events

- an item enters an input buffer;
- space becomes available in an output buffer;
- an input reserve reaches zero;
- an output reserve reaches one whole unit;
- a time, power, or start-up cost becomes due;
- the factory is enabled, disabled, or recompiled.

### 12.2 Advancement

When a factory can run, the engine directly calculates the date of its next
internal event:

```text
time until input depletion
  = available reserve / input rate

time until output creation
  = amount missing before one unit / output rate
```

The nearest event is scheduled. At that time, all reserves advance by the elapsed
duration, then the necessary loading, materialisation, or blocking operations are
applied.

Simultaneous events must be processed atomically in a stable order so that results
do not depend on framerate.

### 12.3 Minimal states

A compiled instance may use these states:

```text
RUNNING          production in progress
WAITING_INPUT    at least one mandatory input cannot be loaded
OUTPUT_BLOCKED   at least one mandatory output cannot be removed
PAUSED           stopped by the player or system
INVALID          contract missing, stale, or invalid
```

A factory belongs in the event queue only when it genuinely has a future event.

### 12.4 Display

Animations may be interpolated every frame from the last state and scheduled next
event. They must not drive production logic.

The game can therefore display continuously animated conveyors and machines
without simulating every internal item.

## 13. Numeric representation

Compiled rates must avoid cumulative floating-point drift.

Acceptable solutions include:

- exact fractions with integer numerator and denominator;
- fixed-point integers with defined precision;
- integer phase accumulators comparable to Bresenham's algorithm.

Examples:

```text
2.50/s = 5/2 per second
0.30/s = 3/10 per second
1.25/s = 5/4 per second
```

The interface may round values for readability, but tooltips and diagnostics must
provide the exact value or sufficient precision.

Simulation and saves must retain exact phase or reserve values. Reloading a game
must neither create nor remove a production fraction.

## 14. Nested factories

A compiled sub-factory appears in its parent graph as an ordinary node:

- its ports are its compiled external ports;
- its rates come from its contract;
- its footprint is its compiled shape;
- its internal graph is not traversed during normal parent resolution.

When a sub-factory changes:

1. invalidate its contract;
2. recompile it;
3. if its observable contract changed, mark its parent dirty;
4. propagate invalidation only through the affected parent chain;
5. preserve unrelated branch caches.

A hash of the graph, recipes, and child contracts may identify a compilation. Two
instances using exactly the same blueprint can share one immutable contract while
retaining their own buffers and runtime reserves.

This separation is essential:

- **the contract** is shared and describes what a factory can do;
- **the instance** owns its world state, integer items, and WIP;
- **the editable graph** is needed only to modify or inspect the design.

## 15. Shape and occupied space

A factory's external shape must derive from what is built inside it. This prevents
a constant-size abstract box from containing an arbitrary number of machines.

A possible first rule uses:

- the bounding box of machines and connections;
- a structural or circulation margin;
- the space required by external ports;
- optionally, costs related to power, cooling, or maintenance.

External ports must be projected onto the shape's perimeter. A well-organised
factory may therefore be more compact and easier to connect without becoming
arbitrarily small.

Nesting must not permit infinite recursive compression. A sub-factory's footprint
inside its parent retains its compiled occupied space, optionally with structural
overhead. Additional depth must never erase physical area already required.

This mechanic should nevertheless avoid turning every design into a tedious
Tetris exercise. Margins, routing, and alignment tools need prototyping to find
the correct level of friction.

## 16. Readability and diagnostics

Players should not need to understand the solver. They must be able to understand
the result by looking at their factory.

Diagnostic mode should display:

- current rate and capacity of each line;
- a visual saturation code;
- the current priority path;
- unused backup paths;
- actual and nominal activity of every machine;
- the limiting ingredient of a machine;
- the first limiting segment of a path;
- the exact reason for a stoppage;
- net factory rates;
- fractional reserves and discrete boundary buffers.

Examples of useful messages:

```text
Machine at 60% — copper bus saturated at 12/12 units/s
Machine stopped — no path to iron input
Factory blocked — circuit buffer full
Branch inactive — path longer than the priority branch
```

A preview must be recalculated during or immediately after a modification so that
the player sees the consequence of their action.

## 17. Simulation invariants

The following rules must remain true regardless of implementation:

1. no resource is created or destroyed without an explicit recipe;
2. a world item is always an integer;
3. a fraction can exist only in a compiled instance's WIP;
4. WIP has finite capacity;
5. an input committed to WIP no longer exists in the discrete buffer;
6. an output exists in the world only after reaching one whole unit;
7. the logical result does not depend on framerate;
8. the same graph and data produce the same contract;
9. routing ties are resolved in a stable manner;
10. a blocked output causes backpressure rather than implicit destruction;
11. a compiled factory does not execute its internal graph in the world;
12. an inactive factory with no future event consumes no CPU time per tick.

## 18. Gameplay consequences

### Emergent complexity

A few rules create many situations:

- moving a machine closer to a source naturally gives it priority;
- building a bus reduces the number of lines but creates a saturation point;
- adding a longer line increases backup capacity;
- compacting a factory shortens some distances but complicates access to ports;
- enlarging a factory simplifies routing but increases its footprint;
- a poorly evacuated secondary output can block an entire coupled programme;
- a specialised factory is efficient but less flexible than separate programmes.

### No free configuration

The player does not select a `70/30` ratio in a window. They obtain different
behaviour by:

- changing distances;
- adding or removing capacity;
- moving a junction;
- splitting a bus;
- adding an explicit filter or priority machine if such tools are unlocked.

Advanced configuration, when available, must have a spatial cost and belong to the graph.

## 19. Performance and scalability

The system may eventually contain a very large number of instances. Its
performance principles are therefore structural:

- resolve a graph only after a relevant modification;
- cache compiled contracts;
- share contracts between identical instances;
- propagate invalidation only to affected parents;
- never recursively traverse a compiled graph during world execution;
- use an event queue for active instances;
- remove blocked instances from the queue until an external event occurs;
- group or analytically calculate long offline periods;
- keep animation as a visual projection separate from logical simulation.

“Millions of factories” remains an objective to measure rather than an immediate
guarantee. Memory per instance, event-queue size, and actual world delivery
frequency are likely to matter more than contract cost itself.

## 20. Saving and offline simulation

An instance save must contain at least:

- contract identifier and version;
- discrete buffers;
- exact fractional reserves;
- current state;
- logical date of the last advancement;
- next scheduled event, if any.

On load, the contract must be found or recompiled if its version is no longer
valid. Instance state must then be restored without rounding material.

For a long absence, the engine may advance from event to event or use a grouped
calculation while supply, buffers, and transport remain constant. It must not
replay every missed tick.

## 21. Recommended first-version restrictions

To retain a simple, compilable contract, the first version should impose:

- fixed recipes;
- typed ports;
- directional connections with fixed capacity;
- a universal shortest-path policy;
- one coupled programme per compiled factory;
- no arbitrary logical condition inside the graph;
- no hidden adaptive routing;
- no unlimited internal storage;
- no cycles, except possibly through an explicit buffer type designed for them;
- backpressure when any mandatory output is blocked.

These restrictions are not merely technical. They make behaviour predictable and
give the compiled factory a clear identity: it is a fixed material programme, not
an autonomous logistical intelligence.

## 22. Suggested implementation progression

### Phase 1 — Static graph

- machine placement;
- typed ports;
- straight connections;
- length and capacity calculation;
- path and error visualisation.

### Phase 2 — Resolution

- normalised machine activity;
- resource conservation;
- shortest path and saturation;
- stable tie-breaking;
- bottleneck diagnostics.

### Phase 3 — Compilation

- input/output contract calculation per second;
- compilation cache and hash;
- sub-factory nodes;
- targeted upward invalidation.

### Phase 4 — World execution

- discrete buffers;
- fractional reserves;
- materialisation of integer outputs;
- blocking and backpressure;
- event-driven engine.

### Phase 5 — Footprint and usability

- compiled shape;
- projection of ports onto the perimeter;
- bus construction and alignment tools;
- rate and diagnostic overlays.

### Phase 6 — External logistics

- rails and vehicles;
- provider and requester stations;
- depots and fuel;
- batch distribution between world buffers.

## 23. Edge cases requiring decisions

The general principles are fixed, but the following points require a prototype or
explicit decision.

### Recompilation with WIP

What happens to an already committed fraction when the contract changes? Options include:

- prohibit recompilation until the instance is drained;
- retain only compatible reserves;
- convert WIP into explicit waste;
- place the instance in maintenance until residue is processed.

Automatically returning a whole item would be exploitable and violate conservation.

### Dismantling

Whole items still present in buffers may be returned. Fractional WIP must not be
rounded for free. It may be lost after confirmation, retained in a residue
container, or require a draining phase.

### Multiple outputs

In the initial coupled model, one blocked output stops the entire contract. This
rule must be tested to ensure it creates interesting logistical problems without
becoming frustrating, particularly for low-rate by-products.

### Independent components

A factory containing two completely independent graphs could:

- be rejected and require two factories;
- compile as two separate internal programmes;
- remain one coupled programme for simplicity.

The first and third options are simplest. The second is more flexible but makes
runtime state more complex.

### Geometric ties

The exact tie-breaking order must remain stable after saving, duplication, and
group movement. A decision is needed on whether position, construction order, or
a persistent identifier is the final criterion.

### Internal cycles

Cycles may represent recycling or catalysts, but significantly complicate
compilation. The first version should probably prohibit them. A later version may
require an explicit buffer or delay to break the loop.

### WIP capacity

“Approximately one item per resource” is a direction, not a final value. The limit
must prevent hidden storage without creating artificial blockages for fast or
multiple outputs.

### Footprint

The exact formula must balance spatial constraint with editing comfort. A bounding
box alone may encourage strange shapes; an envelope, grid, or structural cost may
produce better results.

## 24. Summary of the chosen direction

The heart of the system fits into one sentence:

> The player builds a spatial logistical circuit, the game compiles it into a
> fixed rate programme, and the world executes that programme using integer items
> and a small amount of event-driven fractional work in progress.

The structural rules are:

- an internal spatial graph made of machines and capacity-limited connections;
- deterministic routing by shortest path, followed by saturation and stable tie-breaking;
- behaviour changed through geometry rather than micro-configuration;
- a compiled contract expressed as rational inputs and outputs per second;
- initially one coupled programme;
- integer world buffers and limited fractional internal WIP;
- creation of a world item only when a whole unit has been produced;
- backpressure when outputs can no longer be removed;
- event-driven simulation without graph recalculation or per-tick polling;
- nested factories represented by contracts and footprints;
- separate, discrete, batch-oriented world logistics.

This architecture makes internal design a genuine logistical problem while
keeping its compiled result compact, reusable, nestable, and inexpensive to simulate.
