# PCB-style factory editor

> Status: proposed complete target specification.
>
> This document refines the graph-editor work in stage 5. It does not change the
> accepted conservation, compilation, or runtime rules by itself. Schema and
> gameplay changes require an ADR before implementation.

## 1. Vision

Editing a factory should feel closer to laying out a printed circuit board than
to arranging boxes in a generic node editor.

The player places spatial components, connects typed pads, routes visible tracks,
shares trunks, and fixes design-rule violations. Geometry is not decorative: it
determines route length, occupied space, capacity, and which consumers receive
priority.

The analogy is:

| PCB concept | Factory concept |
|---|---|
| Component | Machine or sub-factory |
| Pad | Typed input or output port |
| Trace | Conveyor track |
| Net | Intended transport connection for one resource |
| Copper pour or bus | Shared high-capacity conveyor trunk |
| Junction | Conveyor merge or split |
| Board edge connector | Factory external port |
| Keepout | Machine footprint and required clearance |
| Design-rule check (DRC) | Routing and factory diagnostics |
| Ratsnest | Unrouted transport intent |
| Autorouter | Deterministic conveyor router |

This metaphor must remain understandable to players who have never designed a
PCB. PCB terminology describes the interaction model, not required knowledge.
The interface should continue to use factory terms such as machine, port,
conveyor, route, merge, and split.

## 2. Product goals

The editor should:

1. make factory layout feel like engineering a physical transport circuit;
2. make the visible conveyor geometry authoritative for compilation;
3. support fast manual routing and useful automatic routing;
4. create merges and splits naturally when compatible tracks meet;
5. preserve resource conservation and shared capacity on common trunks;
6. explain incomplete, invalid, saturated, and inactive routes directly on the
   canvas;
7. remain responsive while routing and compilation run outside the interaction
   path;
8. produce deterministic results from identical blueprints;
9. keep undo, redo, save, load, and duplication predictable;
10. leave room for advanced tools without requiring micro-configuration on every
    junction.

## 3. Non-goals

The complete PCB-style editor still does not attempt to provide:

- an unbounded number of conveyor layers;
- arbitrary free-form curves or off-grid geometry;
- animated individual items as simulation authority;
- a globally optimal autorouter;
- automatic ratio configuration at every split;
- hidden routes that do not correspond to visible tracks;
- live collaborative editing;
- electrical concepts that have no useful factory equivalent;
- silent crossings, hidden junctions, or capacity-free layer transitions.

The completed editor includes a primary conveyor layer and an explicit crossing
mechanism. A bridge, underpass, or lift transition moves a track to another layer,
allowing two routes to cross without connecting. Every transition is visible,
capacity-limited, and included in route length and compilation.

## 4. Core design principle: netlist and physical routing

A PCB editor separates the intended connectivity from the copper that implements
it. The factory editor should make the same distinction.

```text
Machines and transport intent
            |
            v
Logical transport nets
            |
            v
Physical conveyor tracks
            |
            v
Derived merges, splits, and segments
            |
            v
Validated flow graph
            |
            v
Compiled factory contract
```

### 4.1 Logical transport intent

The logical layer records what the player wants to connect. It contains stable
machine and port IDs plus resource-compatible source and destination intent.

It must survive physical rerouting. Moving a machine should not forget that its
iron output was intended to feed a particular bus or consumer.

An incomplete logical connection is displayed as an unobtrusive ratsnest line.
It is not a conveyor and has no capacity until it is routed.

### 4.2 Physical conveyor routing

The physical layer records orthogonal track geometry on the integer grid. It is
the source of truth for:

- length;
- bends;
- occupied cells;
- merges and splits;
- shared trunk capacity;
- clearance and collision diagnostics;
- the transport graph consumed by the compiler.

Logical connectivity must never grant flow through an unrouted or invalid track.

### 4.3 Derived transport graph

The compiler should not require every automatic merge or split to be stored as a
user-authored node. It should derive stable transport vertices where:

- a track begins or ends at a port;
- compatible tracks meet;
- a track branches;
- capacity or conveyor class changes;
- an explicit routing device is placed.

Derived IDs must be deterministic from persistent track IDs and grid positions.
This prevents selection, diagnostics, and animation from flickering after an
equivalent recalculation.

## 5. Spatial and routing rules

### 5.1 Grid and track geometry

Tracks are orthogonal polylines snapped to the factory grid and assigned to a
routing layer. Their
physical length is the sum of their visible segments.

For an orthogonal segment from `(x1, y1)` to `(x2, y2)`:

```text
length = abs(x2 - x1) + abs(y2 - y1)
```

This is no longer an approximation: it is the true length of the drawn conveyor.
The route inspector should display the total in metres.

Every stored track must begin and end at the absolute position of its attached
port or junction. Compilation must still project endpoints from current port
positions so legacy or stale geometry cannot silently affect route priority.

### 5.2 Occupancy and clearance

Machines define keepout rectangles from their footprints. Tracks may not pass
through these rectangles except at their own ports.

Clearance is defined per routing layer. The recommended default is one grid cell
around machines and zero cells between compatible parallel tracks, subject to
capacity and readability rules. The chosen clearance must be visible during
routing and validated after load.

### 5.3 Bends

Bends are allowed on grid intersections. The router may apply a small bend cost
to favour readable paths when two candidates have equal physical length.

Bend cost affects route selection by the editor, not conveyor distance or flow
priority unless a later gameplay rule explicitly assigns a physical cost to
bends.

### 5.4 Crossings and routing layers

Two tracks intersecting on the same layer must connect through a compatible
junction. If their resources or directions are incompatible, the intersection is
a design-rule error.

Tracks on different layers may cross without connecting. A route changes layer
only through an explicit bridge, underpass, or lift transition. A transition has:

- a persistent ID and grid position;
- an entry and exit layer;
- a direction and resource type;
- capacity and physical length;
- a small keepout footprint;
- visible entry and exit markers.

The autorouter may propose a transition when routing around an obstacle is
significantly longer or impossible. The preview must make the non-connecting
crossing unambiguous before commit. Manual routing can insert, move, replace, or
remove transitions.

A crossing must never alternate silently between connected and disconnected
semantics. Layer membership and transition devices are canonical blueprint data.

## 6. Automatic merges and splits

### 6.1 Creation

When a new route touches an existing compatible track, the editor may reuse that
track and create a derived merge or split at the contact point.

Reuse is allowed only when:

- resource types are identical;
- directions are compatible;
- the shared segment has a valid capacity class;
- the contact does not violate a machine keepout or clearance rule;
- both tracks occupy the same routing layer at the contact point;
- the resulting graph remains valid under the current cycle rules.

The preview must show the proposed shared segment and junction before commit.

### 6.2 Semantics

A shared track has one capacity. Capacity is not duplicated for every logical
connection using it.

At a merge:

```text
outgoing flow = sum(incoming flows)
outgoing flow <= shared track capacity
```

At a split:

```text
incoming flow = sum(outgoing flows)
each segment respects its own capacity
```

The existing conservation rules therefore remain applicable. Automatic routing
changes how the graph is built, not the meaning of flow.

### 6.3 Priority

Automatic junctions do not gain hidden priorities or ratios. The accepted path,
distance, capacity, and stable tie-breaking rules continue to determine flow.

Advanced behaviour must use an explicit placed device such as a priority splitter
or filter. Such a device has a footprint, capacity, and visible effect.

## 7. Interaction model

### 7.1 Primary tools

The editor needs a small tool set:

- **Select**: inspect, move, duplicate, and delete components or tracks.
- **Place**: place machines, sub-factories, routing devices, and boundary ports.
- **Route**: start from a port or track and commit an orthogonal conveyor path.
- **Layer/bridge**: choose a routing layer or insert an explicit transition for a
  non-connecting crossing.
- **Measure**: inspect distance, capacity, and path priority without modifying the
  blueprint.

Keyboard shortcuts and temporary tool switching should support rapid repeated
layout work.

### 7.2 Routing gesture

A basic routing interaction is:

1. select a compatible source port or existing track;
2. move the pointer to preview an orthogonal candidate;
3. click to pin an intermediate corner when desired;
4. hover over a compatible port or track to preview connection or reuse;
5. cross an occupied cell by routing around it, merging, or previewing an explicit
   layer transition;
6. click to commit the route as one undoable transaction;
7. press Escape to cancel without changing the blueprint.

The preview displays length, resource, capacity, merges, splits, collisions, and
whether the route would create a cycle.

### 7.3 Ratsnest

Unrouted intent is represented by a thin, low-emphasis straight guide between
ports. It must be visually distinct from a conveyor and excluded from flow
compilation.

The ratsnest helps the player move components before committing to detailed
routing, just as in a PCB layout tool.

### 7.4 Moving a machine

Dragging a machine should:

1. keep pointer movement local and immediate;
2. show attached tracks as a ghost preview;
3. preserve locked or manually pinned geometry where possible;
4. shove nearby unlocked tracks and reroute only affected automatic sections;
5. retain the last valid compiled result while preview work is running;
6. discard superseded queued work and calculate the latest position next;
7. commit the final machine position and route changes as one undo entry.

The preview may temporarily be stale, but it must be labelled as recalculating.
An older result must never overwrite a newer displayed generation.

### 7.5 Track editing

The player should be able to:

- drag a segment parallel to itself;
- move or remove a corner;
- add a corner to a straight segment;
- lock a manually approved segment against autorouting;
- move a track between layers through an explicit transition;
- insert, move, or remove a bridge or underpass;
- change conveyor capacity through an explicit upgrade action;
- delete a branch without deleting the shared trunk used by other nets.

Selection should distinguish the logical connection, physical track, shared
segment, and derived junction when that distinction matters.

## 8. Deterministic autorouting

### 8.1 Scope

The autorouter is an assistant, not a hidden global optimiser. It should find a
good valid route quickly and produce the same result for the same blueprint.

A deterministic grid-based A* implementation is suitable. Its search state
includes grid position, routing layer, and entry direction. Transition edges let
the search move between layers through valid bridge or lift placements.

### 8.2 Candidate cost

The routing cost may combine:

```text
physical length
+ bend penalty
+ keepout and clearance penalties
+ congestion penalty
+ layer-transition cost
+ penalty for changing existing approved geometry
- compatible shared-trunk reuse bonus
```

Physical length remains the gameplay distance. Other terms select a readable
candidate but must not be reported as metres.

### 8.3 Stable ordering

Equal-cost candidates must be resolved using stable values such as:

1. candidate cost;
2. physical length;
3. bend count;
4. ordered grid coordinates;
5. persistent net and track IDs.

No result may depend on `Map` insertion order, worker timing, pointer sampling
frequency, or framerate.

### 8.4 Local rerouting

Moving one machine should dirty only:

- nets attached to that machine;
- shared segments whose occupancy or capacity changes;
- downstream diagnostics and contracts affected by those segments.

The completed implementation performs local invalidation. A debug or recovery
command may rebuild the complete routing graph to verify that incremental and
full results are identical.

## 9. Design-rule checks

PCB-style editing depends on immediate, local diagnostics. The editor should
detect and explain at least:

- unrouted logical intent;
- track through a machine keepout;
- illegal same-layer crossing;
- missing, incompatible, or over-capacity layer transition;
- insufficient clearance;
- resource mismatch;
- incompatible direction at a merge or split;
- shared segment over capacity;
- dangling or orphaned track;
- track endpoint not attached to its expected port;
- zero-length or duplicate segment;
- unsupported directed cycle;
- unreachable mandatory machine input;
- output with no valid destination.

Errors block compilation. Warnings may allow compilation when the result remains
well-defined, for example a valid but saturated shared trunk.

Diagnostics must be visible through more than colour: use line style, icons,
text, and inspector details.

## 10. Visual language

The canvas should communicate the board-like model without imitating an
electronics application literally.

- Machines are component bodies with clearly placed ports.
- Ports resemble pads and show resource colour plus direction.
- Conveyors use orthogonal tracks with width related to capacity class.
- Routing layers use distinguishable line treatments in addition to colour.
- Bridges and underpasses show explicit entry, span, and exit markers.
- Shared trunks appear visually wider than branches.
- Merges and splits use small explicit junction markers.
- Unrouted intent uses thin ratsnest guides.
- Selected paths highlight every physical segment they use.
- Saturation uses animation and a non-colour pattern.
- Invalid geometry uses a DRC marker anchored to the responsible cell or segment.
- Locked manual segments show a subtle lock indicator.

The minimap should display component footprints and major trunks without labels.

## 11. Inspector requirements

Selecting a route or track should show:

- resource;
- physical length in metres;
- nominal and current throughput;
- capacity;
- source and destination ports;
- shared segments and their users;
- merges and splits encountered;
- routing layers and transitions encountered;
- whether the route is automatic, manual, or partially locked;
- priority rank and tie-break explanation;
- first limiting segment;
- current DRC violations.

Selecting a shared trunk should show aggregate flow and every logical net using
it. The player must be able to understand why a visually wide shared section is
saturated.

## 12. Proposed data model

The exact schema requires an ADR, but implementation should aim for a separation
similar to:

```text
FactoryBlueprint
  nodes: Map<NodeId, BlueprintNode>
  nets: Map<NetId, TransportNet>
  tracks: Map<TrackId, ConveyorTrack>
  externalPorts: ExternalPort[]

TransportNet
  id
  resourceId
  sourcePortIds
  targetPortIds
  requestedCapacity

ConveyorTrack
  id
  netIds
  resourceId
  capacity
  layerId
  points
  routing: automatic | manual
  lockedPointIndexes

ConveyorTransition
  id
  resourceId
  position
  entryLayerId
  exitLayerId
  direction
  capacity
  length
```

The physical graph derived for compilation contains directed segments and
junctions. It should not expose transient A* nodes as persistent domain objects.

Track sharing raises an ownership question: deleting one net must remove only
segments no longer used by any remaining net. Reference counts should be derived
from canonical net-to-track membership rather than updated imperatively.

## 13. Compilation pipeline

The proposed editor changes the front of compilation but not its contract with
the simulation.

```text
1. Validate components, ports, nets, and stored geometry.
2. Project every endpoint from the current absolute port position.
3. Split physical tracks into canonical directed segments per layer.
4. Insert explicit layer-transition segments and keep unrelated crossings
   disconnected.
5. Derive stable merge and split junctions.
6. Validate occupancy, resources, direction, and capacity.
7. Build the flow graph and ordered paths.
8. Solve sustainable machine activity and segment flows.
9. Generate diagnostics and path explanations.
10. Produce and cache the immutable factory contract.
```

The content hash includes logical nets, physical geometry, capacity classes,
component positions, recipes, and observable child contracts. It excludes
selection, viewport, hover state, ratsnest animation, and other presentation-only
state.

## 14. Asynchronous work and responsiveness

Routing and compilation have different outputs but may share one worker pipeline.

- Pointer movement and local ghost rendering remain on the main thread.
- Autorouting and flow compilation run in workers.
- At most one calculation of each class is active.
- Only the newest pending snapshot is retained.
- A completed older result may be displayed as a labelled provisional preview.
- The newest generation is always calculated next.
- Worker results carry generation and blueprint revision identifiers.
- Stale generations never replace newer displayed results.

Targets on the reference machine:

- pointer and drag feedback within one animation frame;
- ordinary local route preview within 50 ms;
- ordinary compile preview within 100 ms;
- no main-thread task over 50 ms caused by routing or compilation.

Large graphs may display a coarse ghost first and refine the route asynchronously.

## 15. Commands, history, and persistence

One visible action must correspond to one history transaction.

Examples:

- committing a route plus two derived junctions is one undo entry;
- moving a machine plus rerouting three automatic branches is one undo entry;
- deleting one net and pruning unused shared segments is one undo entry;
- dragging a preview creates no history entries until release.

Persistent geometry must be canonical and versioned. Loading should validate it
before constructing maps that could collapse duplicate IDs.

Automatic repair may project stale endpoints to current ports, but it must not
silently discard manually pinned bends. Any destructive repair requires a clear
diagnostic or migration report.

## 16. Migration from the current graph editor

The current blueprint stores one point-to-point edge with a polyline per
connection. A migration can treat each edge as one logical net and one physical
track:

1. create one `TransportNet` from the edge source and target ports;
2. create one `ConveyorTrack` from its capacity, resource, and points;
3. project track endpoints from absolute port positions;
4. mark the imported track as manual so migration does not unexpectedly reroute
   the player's layout;
5. derive junctions where imported compatible tracks already meet;
6. keep legacy tracks on the primary layer and report crossings, overlaps, and
   invalid geometry through DRC diagnostics;
7. preserve the original blueprint as a recovery record until the migrated save
   validates and commits.

Existing compiled contracts are disposable cache data and should be rebuilt from
the migrated blueprint.

## 17. Implementation stages

### Stage A — Interaction prototype

- Prototype orthogonal route drawing over the current editor.
- Add port-to-port endpoint projection and route-length display.
- Test selection, corners, cancellation, and one-step undo.
- Decide grid density, clearance, and preferred visual treatment.

Exit criterion: routing one connection feels faster and clearer than creating a
generic graph edge.

### Stage B — Manual tracks and DRC

- Persist editable orthogonal polylines.
- Add machine keepouts, crossing checks, and orphan diagnostics.
- Add segment and corner editing.
- Use physical tracks as compilation geometry.

Exit criterion: a complete factory can be built and diagnosed without automatic
routing.

### Stage C — Netlist separation

- Introduce versioned logical nets and ratsnest rendering.
- Migrate current point-to-point edges.
- Derive canonical segments and stable junction IDs.
- Preserve save/load and undo/redo equivalence.

Exit criterion: logical intent survives physical rerouting and incomplete routes
cannot carry flow.

### Stage D — Automatic routing

- Implement deterministic grid A* in a worker.
- Add bend, clearance, congestion, and geometry-change costs.
- Preview and commit automatic routes.
- Add local invalidation and generation ordering.

Exit criterion: ordinary connections route within the preview budget and produce
stable geometry.

### Stage E — Shared trunks, merges, and splits

- Add compatible-track reuse to route candidates.
- Derive merges and splits.
- Enforce shared segment capacity and conservation.
- Add trunk inspection and saturation diagnostics.

Exit criterion: multiple machines can visibly share a trunk without duplicating
capacity or requiring manual junction placement.

### Stage F — Move and shove routing

- Preserve locked geometry while moving components.
- Reroute affected automatic branches only.
- Add ghost tracks and provisional compile overlays.
- Commit move and reroute as one transaction.

Exit criterion: rearranging a populated factory remains fluid and never corrupts
logical connectivity.

### Stage G — Crossings and routing layers

- Add the primary and bridge routing layers.
- Add explicit, capacity-limited bridge or underpass transitions.
- Extend A* search, route length, selection, DRC, persistence, and compilation
  across layers.
- Render non-connecting crossings unambiguously.
- Support automatic transition proposals and complete manual editing.

Exit criterion: incompatible routes can cross without connecting, and every
crossing has stable, visible, saved, and compiled semantics.

### Stage H — Polish and advanced devices

- Add measurement and path-explanation tools.
- Improve keyboard routing and accessible diagnostics.
- Add explicit filters and priorities through separate approved gameplay
  extensions.
- Benchmark 250, 500, and 1,000-node editing scenarios.

## 18. Test strategy

Unit and property tests should cover:

- canonical segment splitting and junction derivation;
- route length from visible orthogonal geometry;
- conservation at every merge and split;
- shared capacity across several nets;
- stable A* ties under map and insertion-order permutations;
- same-layer crossing, cross-layer isolation, transition capacity, clearance,
  keepout, orphan, and resource diagnostics;
- move/reroute generation ordering;
- deletion from shared trunks;
- command transaction and undo/redo identity;
- schema migration and recovery;
- canonical save/load round trips.

Browser tests should cover:

- manual route creation and cancellation;
- route preview around a machine;
- automatic merge into a compatible trunk;
- refusal to merge incompatible resources;
- non-connecting crossing through a bridge or underpass;
- manual and automatic layer transitions;
- moving a component with locked and automatic tracks;
- route selection and length inspection;
- keyboard-only routing and DRC diagnosis;
- saved geometry after reload.

Performance tests should include crowded layouts where naïve A* exploration and
track-sharing candidates are most expensive.

## 19. Acceptance criteria

The PCB-style editor is ready for normal use when:

- all conveyors visible on the canvas correspond to physical compiled segments;
- all compiled physical segments are visible and inspectable;
- unrouted intent is clearly different and carries no flow;
- track length equals the visible orthogonal path length;
- automatic merges and splits conserve resources and share capacity;
- moving a machine preserves intent and reroutes only affected automatic tracks;
- equivalent blueprints produce byte-equivalent canonical routing and contracts;
- every invalid crossing, transition, collision, orphan, or mismatch has an
  actionable DRC diagnostic;
- routes on different layers cross without exchanging flow unless an explicit
  transition connects them;
- route, move, delete, undo, redo, save, and reload browser scenarios pass;
- interaction and compilation remain within the measured performance budgets.

## 20. Decisions required before schema work

An ADR should settle these questions after the interaction prototype:

1. Are two routing layers sufficient, or should the schema support a bounded
   configurable layer catalogue from the start?
2. Does touching a compatible track default to merge, or require a modifier or
   explicit confirmation?
3. Are shared trunks automatically upgraded, or must capacity always be placed
   explicitly?
4. Which geometry is locked by default after a player manually edits an automatic
   route?
5. May the autorouter move existing unlocked tracks, or only choose free cells and
   reusable trunks?
6. How much clearance exists around machines and parallel conveyors?
7. Are several sources allowed on one directional net, or represented as
   separate nets meeting at a merge?
8. Should the completed crossing device be presented as a bridge, underpass,
   lift, or a family of capacity classes with the same graph semantics?
9. When may the autorouter insert a layer transition automatically, and when must
   it ask for confirmation?

Recommended answers are: two bounded layers, explicit merge preview, explicit
capacity upgrades, manual edits lock affected segments, local shove routing,
one-cell machine clearance, separate directed nets at merges, a visible bridge
device, and confirmation before an autorouter adds a new transition.

## 21. Summary

The editor should treat a factory as a physical transport board:

- machines are spatial components;
- ports are typed pads;
- logical nets record transport intent;
- conveyors are orthogonal tracks;
- explicit routing layers and bridges allow crossings without connection;
- compatible tracks can form shared trunks;
- merges and splits are derived, visible, and capacity-limited;
- DRC diagnostics explain invalid or incomplete layouts;
- deterministic workers route and compile without blocking interaction;
- the resulting physical graph compiles into the existing immutable factory
  contract.

The key architectural choice is to separate **what should be connected** from
**how it is physically routed**. That separation makes PCB-like interaction,
automatic rerouting, ratsnest guidance, shared trunks, and reliable undo possible
without weakening the factory's conservation rules.
