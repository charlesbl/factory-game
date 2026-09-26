# Priority 1 — 3D world view and game interface

Status: planned. Repository reviewed on 2026-09-26.

Read this as an execution specification. Decisions and invariants are mandatory;
values described as initial targets are tuning parameters. Concentrate review on
the failure cases below. Routine component scaffolding is left to the implementer.

## 1. Intended result

Replace the current world presentation with a complete Three.js game view:
volumetric cubic factories, low poly terrain, physical rail geometry, animated
cargo pods, warm lighting, readable construction previews, and a polished React
interface. The player should be able to recognise buildings by their silhouettes,
understand material movement at a glance, and build comfortably at several zoom
levels.

**Architecture decision: go directly to Three.js for the world.** React owns the
HUD and panels; Three.js owns the scene, camera, lighting, and animation. Remove
PixiJS after interaction parity is complete. No new PixiJS work is required.

This document is the first implementation priority for the visual overhaul. It
supersedes the renderer choice and presentation requirements of
[stage 17](17-world-renderer-and-editor.md). The domain, logistics, construction,
and persistence work in stages 16 and 18–20 provides its integration baseline.
The internal factory graph remains an editor with its existing gameplay model;
its entry points and shared interface styling should fit the new world workspace.

The result must include production assets and a finished interface. A scene of
unadorned placeholder boxes only completes the initial technical milestone.

### Scope and precedence

Implement this plan against the current repository; do not restart stages 16–20
or complete the unrelated graph-editor/solver roadmap first. Preserve domain
rules, integer quantities, construction costs, directional traffic, and current
save compatibility. Required client/worker corrections and read-only presentation
fields are in scope where identified below. Changes to placement eligibility,
rail routing, recovery rules, or the persisted gameplay model require a separate
explicit decision, not an inference from a drawing or UI requirement.

The code defines what is available today; this document defines the new
presentation and its acceptance gates. Older plans marked “implemented” are not
proof that every UI action or transport field exists. Record a newly discovered
blocking discrepancy here and resolve the smallest required integration gap.
Module names in section 6 are suggestions; ownership boundaries are mandatory.
Optional features are explicitly labelled. An initial target may be tuned with
recorded measurements and rationale; it may not be silently dropped.

## 2. Current implementation and constraints

| Area | Current evidence | Consequence for this work |
|---|---|---|
| World rendering | [WorldCanvas.tsx](../../src/ui/WorldCanvas.tsx) draws PixiJS rectangles, lines, and circles; terrain containers use 32 × 32 cells | Replace the rendering implementation and keep chunked spatial organisation |
| World workspace | [WorldView.tsx](../../src/ui/WorldView.tsx) owns worker lifecycle, commands, saving, tools, selection, and a one-second advancement timer | Extract session and interaction responsibilities before adding more visual systems |
| Worker boundary | [client.ts](../../src/world/client.ts) and [protocol.ts](../../src/world/protocol.ts) expose versioned commands, snapshots, and deltas | Keep the worker authoritative; publish accepted state to a presentation store |
| Delta shape | Deltas currently replace most entity/logistics collections; ore changes are sparse; the client clones the ore array | Do not assume a truly incremental entity stream; add explicit change sets where profiling justifies them |
| World geometry | [model.ts](../../src/world/model.ts) uses integer grid coordinates, footprints, and quarter turns | Define one grid-to-3D mapping and use it for models, picking, ghosts, and rail |
| Existing buildings | Factory footprint comes from the contract; mine/storage/depot are currently 4 × 4, station is 2 × 2, drill is 1 × 1 | Generate a modular factory kit and read actual domain footprints |
| Simulation presentation | Snapshots include pause, speeds 1/5/20, building states, cargo, construction materials, and pod movement timestamps | Use these values for animation and feedback; make time handling explicit |
| Rail semantics | [worldRailVisual.ts](../../src/ui/worldRailVisual.ts) derives connectivity; rail paths are directional | Reuse semantic helpers; a visual crossing must not create a junction |
| UI and assets | [app.css](../../src/ui/app.css) contains the existing world panels; public assets contain app icons but no world model library | Add a scoped world theme and a reproducible model pipeline |
| Verification | Vitest, Playwright, and [performance notes](../performance.md) already exist | Extend the established tools with focused renderer and interaction coverage |

Current pod rendering advances a display clock from elapsed wall time without
applying the snapshot's pause or speed controls. Address this during replacement.
The current terrain/ore drawing is also keyed to world identity; the new renderer
must update depletion within an existing world.

### Integration gaps to resolve in stage 1C

These are current source limitations, not capabilities the new view can assume:

| Gap and source | Required treatment |
|---|---|
| `WorldRuntime.snapshot()` returns its live grid; `deltaBetween()` in [world.worker.ts](../../src/world/world.worker.ts) takes before/after snapshots around mutations | Capture independent pre-command ore values or a worker-owned change journal. Comparing aliases of the same mutated array cannot detect depletion. Prove that an actual extraction produces an ore delta |
| `WorldDelta` has no occupancy changes; `applyWorldDelta()` retains the old occupancy array | Publish authoritative occupancy changes and apply them immutably before local placement checks. Do not infer worker occupancy-slot numbers from entity order or renderer instance slots |
| `baseRevision` is transmitted but not checked by `WorldClient`; validation reply revision is not exposed in `WorldClientResult` | Validate delta continuity in the client and expose the actual validation revision to the interaction controller |
| `PodMotion` has endpoints/times but no edge ID or completed-movement history | Add the bounded movement/state transport specified in section 6; mission delivery routes alone do not describe trips to providers or depots |
| Factory snapshots report state and buffers, but not measured throughput or a structured downstream cause; drill `ACTIVE` is a lifecycle state | Show only known facts. Add read-only worker metadata for any stronger claim or animation, rather than guessing production from existence or buffer differences |
| `WorldSnapshot` omits generation seed/spawn and the placed factory's contract metadata | Publish or retain accepted read-only metadata where camera Home, deterministic decoration, or contract display needs it. Do not access nonexistent snapshot fields or substitute the currently edited blueprint's contract |
| `placeControlNode()` creates/upgrades a node but does not split an existing edge passing through that tile | Connect new paths by their actual endpoint IDs. Do not display a connected crossing merely because a junction marker occupies the crossing tile |
| Local `WorldView` placement requires a station for depots; `validateGhost()` exempts depots, while paid site delivery still needs a real station | Preserve a usable station-backed depot construction flow and identify this UI precondition accurately. Do not advertise unsupported station-free deliveries or change domain rules in the renderer |

Mine heads belong **outside** ore patches; drills belong on matching, non-exhausted
ore and must touch their selected mine or its drill chain. Use
[catalogue.ts](../../src/domain/catalogue.ts), [placement.ts](../../src/world/placement.ts),
[runtime.ts](../../src/world/runtime.ts), and [systems.ts](../../src/world/systems.ts)
for costs, occupied cells, station eligibility, and mining rules. Do not use an
illustration of a mine over a deposit as a placement specification.

Several ADR files linked by the older roadmap are absent in the current worktree.
Use the source files and available plans as the baseline, and record the new
rendering decisions in this document. Do not restore deleted documents as part
of this task.

### Decisions that must not be reinterpreted

| Requirement | Common wrong implementation | Required interpretation |
|---|---|---|
| Real 3D | Isometric sprites, CSS transforms, or a generated screenshot behind controls | Actual mesh geometry, perspective, depth testing, lighting, and freely rotatable camera |
| Direct Three.js | A new Pixi/Three hybrid, or an unrelated engine/framework rewrite | One Three.js world canvas and React HUD; old Pixi only as a temporary comparison option |
| Cubic low poly style | Plain identical boxes recoloured by building type | Production models with distinct silhouettes, coherent materials, and readable mechanical details |
| Asset generation | Treating a PNG as a GLB, or assuming a prompt guarantees valid topology | Image generation supplies references; Blender produces editable geometry and verified exports |
| Factory model | Making one fixed 4 × 4 factory or rendering every internal blueprint machine in the world | A modular exterior fitted to the compiled footprint; the existing abstract world actor remains authoritative |
| 3D terrain | Adding slopes, bridges, collision physics, or new elevation rules | Visual height around the existing flat logical grid; occupied cells still come from the domain |
| Simulation isolation | Moving pods or completing construction by render delta time | Display accepted worker state; render code never creates resources, updates occupancy, or issues ADVANCE |
| Existing delta protocol | Treating every returned entity as newly added, or rebuilding all meshes every tick | Collections currently represent replacement state; reconcile by ID and geometry signature |
| Save compatibility | Serializing Three.js objects or changing world schema to store the camera | Keep world saves authoritative and graphics-free; version UI preferences separately |
| Finished delivery | Leaving final content as placeholders or preserving two renderers indefinitely | Complete the model pack and interaction parity, then remove PixiJS |

Use human-readable building names in the HUD, but retain persistent IDs internally.
Never use a mesh name, array index, or instance slot as the world object's identity.
Protocol version, generated-world schema, and serialized save schema are separate
version numbers in this repository. A new presentation message does not justify
incrementing all three or invalidating existing saves.

## 3. Visual direction

### World and camera

Build a bright industrial diorama with a restrained palette and substantial
three-dimensional forms:

- Cubic volumes, stepped roofs, broad panels, small bevels, and simple exposed
  machinery. Cylinders use about 6–10 sides where a round part is needed.
- Cream painted factory bodies, dark graphite bases, muted teal equipment,
  copper-orange extraction machinery, and amber service details.
- Sage ground, dusty paths, faceted rocks, and sparse cubic vegetation. Obstacle
  cells receive visible rocks or other solid scenery. Keep buildable land legible.
- One warm sun with soft shadows, a cool sky fill, modest distance fog, and a
  consistent exposure. Use contact shading to anchor buildings.
- A perspective camera with an initial vertical field of view around 40 degrees,
  azimuth around 45 degrees, and elevation around 50 degrees. Tune on the first
  finished scene. Clamp elevation to roughly 35–75 degrees and avoid the horizon.
- Close view shows vents, cargo, moving drill heads, and rail details. Normal
  view clearly shows building kinds and activity. Overview simplifies details
  and reveals the network. Provide a top view preset using the same perspective
  camera and scene: use approximately 89 degrees elevation as an explicit
  exception to the orbit clamp, retain azimuth, and restore the previous orbit
  on exit. Avoid the exactly vertical camera singularity.

Keep buildable surfaces at the logical ground plane for this release. Height
variation belongs to obstacle scenery, vegetation, foundations, and the map edge.
The visual overhaul must not imply slopes, bridges, or elevated construction that
the placement and logistics rules do not support.

### Palette and material rules

These are initial art tokens to refine together in the first finished scene.

| Role | Starting colour | Use |
|---|---|---|
| Ground | #819778 | Muted sage landscape |
| Structure | #E8DEC7 | Warm cream main panels |
| Equipment | #4C9690 | Teal machinery and roof details |
| Foundation | #3D4B50 | Graphite bases and rail hardware |
| Extraction | #C77B4A | Mine/drill accents and iron-bearing rock details |
| Service | #D9B45F | Depot identification and construction details |
| Panel | #202D33 | Opaque slate HUD surfaces |
| Text | #F3F0E7 | Primary interface text |
| Warning | #EDB85F | Waiting and construction feedback |
| Error | #DC7468 | Blocked or invalid actions |

Colours communicate categories, while icons, shapes, patterns, and text carry
status. Keep resource swatches consistent with the catalogue and inspector.
Materials should be matte with restrained metallic accents; avoid noisy textures.
Use selection outlines only around relevant objects. Atmospheric effects must
preserve the readability of ghosts, ports, and rail direction.

### Visible activity and states

| State | World presentation | Interface explanation |
|---|---|---|
| Running factory | Slow roof fan or piston and a small steady activity light | Labelled contract/measured rates where available, and input/output buffers |
| Waiting for input | Machinery stopped, amber input symbol | Missing input and station status |
| Output blocked | Stopped output machinery, blocked-output symbol | Known blocking buffers/stations; downstream cause only when reported |
| Paused | Production animation frozen, pause symbol | World pause or actor pause as applicable |
| Invalid / maintenance factory | Stopped machinery and distinct status icon | Reported actor state; only show a cause if supplied |
| Construction | Foundation, scaffold modules, then structural modules as materials arrive | Delivered/required material counts |
| Dismantling or evacuation | Marked footprint, striped service frame | Outstanding evacuation and salvage |
| Active/ghost/exhausted drill | Head moves only for reported extraction / outlined structure / parked head and depleted patch | Actual drill state, ore remaining, and known output blockage |
| Loaded pod | Visible cargo insert and direction of travel | Resource and integer cargo quantity |
| Blocked pod | Stationary pod with a distinct warning marker | Destination blocked, berth wait, or gridlock |
| Disconnected rail | End cap or broken-link symbol | Connection explanation using existing helpers |

Animation communicates reported state. A decorative fan must never imply
production while the corresponding factory is blocked. Construction visuals use
delivered materials; they must not finish according to an independent timer.

World pause overrides actor animation. A drill can remain `ACTIVE` while a full
mine buffer prevents extraction; use worker-reported extraction events or
activity metadata to drive its head. A persisted drill in `GHOST` state is a
selectable, authoritative construction object, distinct from the transient
cursor preview. Never remove it as part of cancelling a placement gesture.

Construction progress is the sum of `min(delivered, required)` per required
resource divided by total required quantity. Clamp it to [0, 1]; if total required
is zero, avoid division and wait for the accepted lifecycle transition. Even a
100% preview remains a site until the worker replaces it. Label this as material
delivery progress, not elapsed build time. Some non-factory dismantles remove
the entity immediately while salvage remains at its station: show that accepted
recovery state at the station, without inventing an occupied building footprint.

“Throughput” must distinguish compiled contract rate from measured output. A
buffer delta includes logistics transfers and is not a production measurement.
Without authoritative cause data, show “Output blocked” and the known buffer or
station facts; do not assert that a particular downstream factory caused it.

## 4. Pleasant interface and interaction

### Workspace layout

Use the available application area as a continuous world viewport. Overlay compact
controls with consistent spacing, rounded corners, clear text, and quiet borders.

| Region | Contents and behaviour |
|---|---|
| Top bar | World/factory navigation, world label, save status, pause and 1×/5×/20× controls, settings |
| Bottom build dock | Select, factories, mining, storage, logistics, and dismantle; current tool has a label and shortcut |
| Build catalogue | Searchable drawer with thumbnails, footprint, material cost, and placement requirements |
| Right inspector | Selected building/rail/pod, state, buffers, station rules, open-factory action, and relevant recovery actions |
| Upper corner alerts | Compact actionable problems; selecting an alert focuses its world location |
| Lower corner | Compass, zoom/home controls, hideable minimap, and an overlay selector |
| Near cursor | Short placement feedback and cost; avoid covering the candidate footprint |

Keep developer information such as revisions and raw entity IDs in a debug panel.
Use clear international English following [language guidelines](../language-guidelines.md).
Display only resource totals that exist or can be derived unambiguously; do not
invent a global inventory when stock belongs to individual buildings.

The current save slot is `main`, and `WorldSnapshot` has no editable world name.
Use a display label such as “World”; world renaming and multiple save slots are
outside this plan. Preserve seeded generation and its replacement confirmation.
The minimap is part of stage 1E, but can be hidden by the player or narrow layout;
it shows the camera area and can focus the camera without issuing build commands.
Initial overlays are the build grid/footprints, ore, and logistics direction,
reservations, and warnings. Their toggle state is a UI preference.

At 1366 × 768 the dock and inspector must leave a usable building area; use one
drawer at a time on narrow screens. Preserve the camera across factory navigation.
Start with 14–16 px body text and 44 px control targets. Essential text needs 4.5:1
contrast, essential control boundaries 3:1, visible keyboard focus, and a reduced
motion setting. Check actual rendered colours rather than assuming the palette
meets these targets.

Use 390 × 844 CSS pixels as the initial narrow-layout acceptance size, with no
page-wide horizontal scroll and a closable inspector/drawer. Honour
`prefers-reduced-motion` initially and allow an explicit preference: disable
decorative animation and animated camera transitions, while retaining accurate
pod positions and status markers. Expose action results through a concise live
region; do not announce every simulation tick or every moving pod.

### Input contract

| Input | Action |
|---|---|
| Left click | Select or confirm the current placement step |
| Left drag in the rail tool | Preview one orthogonal draft segment; release adds it to the draft without committing |
| Middle drag or Space + left drag | Pan on the ground plane |
| Right drag | Orbit, with no placement command on release |
| Wheel / trackpad zoom | Zoom toward the ground point under the pointer |
| Arrow keys | Pan while the viewport is focused; move the grid cursor instead when keyboard placement mode is enabled |
| Q / E | Rotate camera in quarter-turn steps |
| R / Shift + R | Rotate a rotatable building preview clockwise/counterclockwise; no effect for fixed-orientation tools |
| Home | Return to a useful view of spawn or the active working area |
| Enter / Escape | Confirm the current draft / cancel and return to selection |
| Delete | Open the relevant dismantle/remove action for the selection |

Preserve Select S, Rail T, Erase rail X, Junction J, Station G, Factory F, Mine M,
Drill D, Storage B, Depot P, and Dismantle C. Centralise keyboard handling and
activate shortcuts only inside the focused world workspace. Ignore inputs,
textareas, selects, contenteditable content, menus, and modal dialogs; do not
intercept Ctrl/Meta/Alt browser shortcuts. Ignore key repeat for confirmation,
deletion, tool changes, and quarter turns. Cancel a shortcut's browser default
only when the controller actually handles it.

Use a pointer gesture state machine with a drag threshold and pointer capture.
Handle pointer cancellation, lost capture, window blur, and leaving the viewport.
DOM panels consume their own events; clicking through the HUD must never place
a building. Provide visible camera buttons for users without a middle mouse
button and explicit touch select/build, two-finger pan, and pinch controls.
Remove superseded WorldView window key handlers when installing the controller;
otherwise one key can execute both the old and new actions. Switching tools or
opening a modal cancels an in-progress pointer gesture.

Start with a 5 CSS-pixel drag threshold. Commit clicks on pointer-up only when
the gesture began on the canvas, remains a click, and ends over the canvas.
Crossing the threshold suppresses the subsequent click. Captured camera drags
may continue outside the canvas; a build gesture ending outside cancels its
current step. Suppress the canvas context menu for right-drag. Use exactly one
owner for camera gestures; do not register overlapping controller and camera
library handlers. Left-drag with other build tools does not paint an area or
place multiple objects.

On touch, one finger positions/selects and a visible Confirm button commits a
build step; expose camera orbit buttons. A second contact cancels any pending
one-finger build gesture before two-finger pan/pinch begins. End of pinch must
not become a placement tap. Provide visible Confirm and Cancel controls for rail
drafts and keyboard placement too.

### Placement feedback that must stay accurate

The ghost shows the real model, occupied cells, orientation, cost, and required
station adjacency. Distinguish valid, invalid, and validation-pending states.
Local checks provide immediate feedback; accepted worker commands determine
whether a site exists. A green ghost is not authority to modify local world state.

Use the existing domain cost/footprint definitions and compiled contract. Do not
copy their values into the asset manifest as new gameplay rules. A loading socket
on the artwork does not satisfy station adjacency. Preview failure should explain
the real reason: terrain, occupancy, bounds, deposit, or missing eligible station.

Preserve rail drawing, confirmation, direction indicators, explicit junction
placement, edge removal, factory selection/opening, construction cancellation,
and station configuration. Use an inline explanation for invalid placement.
Use an in-app confirmation for destructive actions that currently require one,
including their consequences; do not add a world undo button without authoritative
command support.

Provide an accessible building/rail/problem list that can select and focus the
same objects as the canvas. Add a keyboard grid cursor and placement controls so
construction and inspection have a usable alternative to pointer picking.

Expose a “Keyboard placement” toggle. In that mode arrows move one logical cell,
Enter performs the tool's click step, and the visible Confirm action commits a
rail draft. Escape clears the draft and exits to selection. Announce cursor
coordinates and placement errors; keep focus in the workspace after an action
and restore it after a modal closes.

### Tool and action parity contract

| Tool/action | Required behaviour and authoritative command |
|---|---|
| Factory / mine / storage / depot | Read footprints and costs from the compiled contract or `worldContent`; rotate only these building previews. Validate the current intent and submit `CREATE_SITE`. A factory requires a ready contract for the selected factory and current draft, not a previous compilation |
| Station / junction | Submit `PLACE_CONTROL_NODE`; stations use `worldContent.stationFootprint`, rotation 0, and their actual rail-node anchor. A junction is a rail node, not a 1 × 1 building that reserves occupancy |
| Drill | Capture a selected mine's ID when entering the tool, keep it across successive placements, show its resource/chain, and submit `PLACE_DRILL`. Clicking the next tile must not lose the mine binding; leaving the tool or removal of the mine clears it |
| Rail | First click starts a draft; subsequent clicks/drag endpoints add cardinal segments. Snap to the dominant displacement axis, X on ties, and ignore duplicate points. Show arrows in point order. Enter or Confirm sends one `PLACE_RAIL_PATH`; Escape cancels. Retain a rejected draft |
| Erase rail / Delete on rail | Highlight the entire edge that `REMOVE_RAIL_EDGE` would remove, even when hovering a middle tile. Surface active-route rejection. At overlapping edges, expose candidate edge selection so either direction can be selected and removed deliberately |
| Dismantle / cancel site | Use `DISMANTLE_ENTITY` only for the supported building kinds and `CANCEL_CONSTRUCTION` with the site's **entity ID**. Do not use low-level `REMOVE_ENTITY` to bypass material recovery; station/drill deletion is not added implicitly |
| Configure storage logistics | Preserve resource, request/provide mode, target, and priority supported by `CONFIGURE_STATION`, addressed to the building entity. Display existing station state; do not infer editable min/max-batch or arbitrary station-rule controls from snapshot display fields |
| Open / replace factory | Open the selected entity's `factoryId`, which may differ from the current catalogue selection. Blueprint edits do not silently alter placed actors. Expose the existing `REPLACE_FACTORY` flow with current contract, footprint/cost preview, station preservation, and consequence confirmation |
| Time / save / generate | Pause changes only pause; choosing 1×/5×/20× changes speed while preserving the current pause state. Provide save/retry status and seeded regeneration; replace the current world only after successful preparation |

`VALIDATE_GHOST` currently supports only factory/mine/storage/depot. Do not cast
other tools into that union. For drill/control-node/rail previews, reuse read-only
domain validation or add typed validation requests in 1C. Local success remains
pending until the applicable validation completes; every commit validates again
in the worker. Match a reply to all inputs, including mine/resource/station ID
and factory contract hash. Never submit a stale compiled contract just because
its footprint happens to match.

Degree-based helpers in `worldRailVisual.ts` describe endpoint attachment, not
directed reachability to a destination. Use traffic diagnostics for route claims.
To join a crossing with current commands, create the node first and draw paths
ending/starting there. Adding a node over an existing unsplit edge does not join
that edge. Automatic edge splitting is a separate topology change, outside this
renderer migration. Do not simulate it by moving meshes or inventing rail IDs.

## 5. Asset production plan

### Deliverables and storage

Create these directories during implementation:

~~~text
assets/world/
  art-direction.md
  prompts/                    # Versioned briefs and image-generation prompts
  concepts/                   # Selected image references
  source/                     # Editable .blend files
  recipes/                    # Declarative geometry/material parameters
  provenance.json             # Origin, prompt/tool/version, rights, modifications
scripts/assets/
  build_world_assets.py       # Blender batch generation and GLB export
  render_world_previews.py    # Consistent thumbnails and review sheets
  validate_world_assets.mjs   # Manifest, geometry, footprint, and budget checks
public/assets/world/
  manifest.json               # Asset pack version and content-hashed URLs
  models/                     # Runtime .glb exports including explicit LODs
  textures/                   # Shared palette/detail maps when required
  thumbnails/                 # Model-derived WebP/PNG build-menu images
docs/visual-baselines/world/   # Reference compositions and acceptance captures
~~~

Source assets are development inputs; ship only the runtime pack. Keep selected
reference images, prompts, model recipes, and final exports in the repository.
Record the Blender version and export settings so another developer can rebuild
the same pack without a paid generation service.

Recipes and build scripts are the source of truth for generated geometry;
`.blend` files are editable review outputs. Feed any manual geometry correction
back into the recipe/script, or explicitly declare and version that `.blend` as
an authored input. A clean rebuild must not silently discard an approved change.
Normal `npm run dev`, tests, and production builds use checked-in runtime assets
and must not require Blender or regenerate images. Run the full asset pipeline
when its inputs change; validate the checked-in pack in the final acceptance gate.

### Initial asset inventory

Budgets below are initial maximum exported triangle counts per assembled
standard-sized asset at LOD0. Large factories use a module budget and screen-space
detail limits. LOD1 should generally use no more than 40% of LOD0 triangles; LOD2
retains only the recognisable silhouette.

| Asset | Required shape and variants | LOD0 budget | Priority |
|---|---|---:|---|
| Factory kit | Corner/wall/roof bays, plinth, door/loading socket, vent/fan, compact and elongated assemblies | 3,000 for a typical assembly; 150 per repeated bay | First scene |
| Mine head | 4 × 4 service building, cubic hopper, extraction tower, iron/copper accents | 2,000 | First scene |
| Drill | 1 × 1 base, separate head/shaft, active and exhausted appearance | 800 | First scene |
| Storage | 4 × 4 warehouse with stacked crate silhouette and loading face | 1,800 | First scene |
| Station | 2 × 2 loading platform, canopy/gantry, directional socket markers | 1,200 | First scene |
| Depot | 4 × 4 service shed, recognisable pod bays and amber roof feature | 2,000 | First scene base; variants later |
| Cargo pod | Squat cubic chassis, directional front, separate cargo insert | 500 | First scene |
| Rail kit | Straight module, corner fitting, endpoint, junction, station approach, arrow marker | 160 per repeated module | First scene |
| Construction kit | Foundation, scaffold, crates, partial frame, dismantling marker | 800 per standard assembly | First scene base; variants later |
| Terrain kit | Chunk surfaces, exposed side walls, rocks, sparse cubic vegetation | 40–250 per prop | First scene |
| Ore kit | Distinct iron/copper clusters plus exhausted appearance | 200 per cluster | First scene |
| UI assets | Model thumbnails, consistent SVG tool icons, resource/status symbols | 256 px thumbnails; small vectors | Complete pack |

Rail corner fittings decorate the logical turn inside its occupied route; do not
round routes into neighbouring cells. Loading sockets are display metadata mapped
to actual station positions, and must not define new logistics connections.

### Image generation instructions

Use the built-in image generation tool for concept references, one request per
asset/variant. Reuse the selected world composition as the style reference.
Save selected outputs locally with the exact prompt, reference, and tool metadata.
If the image tool or Blender is unavailable, report which deliverable is blocked
and continue independent integration work; do not substitute fake exports or
claim the corresponding art gate passed. Image regeneration is not required for
a deterministic asset rebuild from checked-in references and recipes.
Generated front/side/top views can disagree: resolve that disagreement in the
model recipe before modelling. Never infer that an attractive reference already
satisfies a triangle budget, footprint, pivot, or material contract.

**Prompt A — target world composition**

~~~text
Use case: stylized-concept
Asset type: art direction reference for a browser factory-building game
Primary request: a coherent low poly cubic industrial diorama with actual
three-dimensional buildings and a pleasant, readable construction-game camera.
Scene: sage ground with faceted rock obstacles, one cream and teal factory,
an orange-accent mine head, a small drill on visible ore, a storage warehouse,
a loading station, and directional rails carrying squat cargo pods.
Style: large cuboid masses, small bevels, stepped roofs, simple mechanical parts,
matte surfaces, restrained detail, clear differences between building silhouettes.
Camera: elevated three-quarter perspective, about 50 degrees above the ground,
readable roof and front faces, composition suitable for a 16:9 game viewport.
Lighting: warm afternoon sun, cool sky fill, soft contact shadows, subtle fog.
Palette: cream, graphite, muted teal, copper-orange, sage, amber accents.
Constraints: grid-aligned footprints, rails on the ground, one consistent scale,
space around buildings for placement, no text, no watermark, no baked interface.
Avoid: photorealism, dense surface noise, neon cyberpunk, excessive bloom,
flat sprites, impossible elevated transport, tiny unreadable machinery.
~~~

**Prompt B — reusable building reference sheet**

~~~text
Use case: stylized-concept
Asset type: modelling reference for [asset ID and building kind]
Input image: selected world composition, used as the style and material reference.
Primary request: isolated [building description from the inventory] with a
[width] by [depth] ground footprint, approximately [height] units high.
Composition: front, side, top, and three-quarter views of the same design,
neutral background, consistent proportions, generous separation between views.
Geometry: cubic primary body, a small number of readable secondary masses,
[distinctive roof or mechanical feature], clearly visible loading side.
Materials: retain the reference palette and matte finish.
Constraints: no typography, no brand marks, no scenery, no dramatic perspective
in the orthographic views; keep the geometry consistent across all views.
~~~

For the first factory, specify a 4 × 4 reference with a graphite plinth, cream
wall bays, teal stepped roof, one large roof fan, and an obvious loading face.
For the drill, specify a 1 × 1 plinth, an orange support frame, and a separate
vertical head. For the pod, specify a roughly 0.65 × 0.9 unit chassis, a visible
front marker, and a removable cargo box. Reference dimensions guide production;
verify actual dimensions in Blender.

**Prompt C — interface composition reference**

~~~text
Use case: ui-mockup
Asset type: visual reference for the factory game's world HUD
Input image: selected world composition as the central game viewport.
Primary request: a calm industrial game interface using opaque dark slate panels,
warm light text, restrained teal accents, generous spacing, and clear hierarchy.
Composition: compact navigation and time controls above the world, a small bottom
build dock, an open right inspector, and a compact compass/minimap in a free corner.
Show a selected factory, material buffers, and a placement cost preview.
Constraints: preserve the world art direction, readable controls, no ornamental
dashboard charts, no huge panels covering the centre.
~~~

Implement the final interface in React/CSS and icons in SVG. Render build-menu
thumbnails from the approved GLBs so the menu matches the placed model.

### Deterministic 3D generation instructions

Implement the factory style primarily from cubes, bevelled boxes, short prisms,
and low-sided cylinders. Store dimensions, material slots, and optional features
in declarative recipes. A Blender Python build should:

1. Load the shared palette and a named asset recipe; use a fixed seed for variants.
2. Construct a ground-centred parent and named static/animated child meshes.
3. Apply scale and rotation, remove hidden/internal faces, use deliberate flat
   normals, and restrict bevels to visible silhouette edges.
4. Merge static parts by material while preserving moving parts and named sockets.
5. Build LOD variants explicitly, with stable origins and sockets.
6. Export GLB, generate standard preview views, and emit measured metadata.

Start with a factory wall bay, corner, and roof bay. Assemble compact, long, wide,
and minimum-sized factories before modelling decorative details. Fill arbitrary
contract footprints with repeated bays and clipped end pieces; use a compact
fallback assembly for very small footprints. Do not stretch doors, windows, or
fans to fit a differently shaped factory.

Factory assemblies must also scale in memory: perimeter bays may grow with the
perimeter, but use broad roof/plinth surfaces instead of one scene object per
interior cell. The 3,000-triangle example applies to a 4 × 4 assembly; measure
compact, minimum-sized, and elongated valid contract footprints separately.

Example production brief for the first recipe:

~~~text
Asset: factory-wall-bay-v1
Exported module extent: 1.0 X by 0.15 Z by 1.2 Y units
Geometry: cream panel, graphite lower band, shallow teal service box
Origin: ground centre; mounting direction documented in metadata
Materials: shared palette base, shared metal accents
Bevel: one segment, about 0.02 units on visible edges
Budget: at most 150 exported triangles
Output: editable source, reproducible recipe, GLB LOD0/LOD1/LOD2,
front/side/top previews, bounds and material counts in manifest
~~~

Use Blender's glTF export conventions and verify the exported result in the game
asset viewer. Exported material appearance and axes are the contract; inspect them
after export, because Blender authoring materials may require conversion.
See the [Blender glTF export documentation](https://docs.blender.org/manual/en/3.2/addons/import_export/scene_gltf2.html)
for format background only; that historical manual is not the required Blender
version. Pin the production Blender version, consult its matching manual, and
verify exporter options with that executable before writing batch scripts.

Provide future package commands such as `assets:build`, `assets:validate`, and
`assets:preview`, each wrapping the checked-in scripts. These commands do not exist
yet. The build wrapper should accept a configured Blender executable and support
both a single asset and the full pack.

### Export contract and review gate

- Runtime units: one grid tile equals one world unit. GLB output is Y-up, with
  authored front facing +Z. Blender authoring may remain Z-up; export converts once.
- Root pivot: centre of the ground footprint, Y = 0. Static child transforms are
  baked; animated child pivots and sockets remain meaningful.
- Verify the orientation after GLB export with an asymmetric front marker.
  Applying a second "Blender correction" rotation in the runtime can put every
  model sideways. Keep unit scale at the root and forbid negative/mirrored scale.
- All orientations and every animated pose stay within the authoritative
  footprint. Use a small margin inside its edge; do not let decorative pipes
  suggest an occupied neighbour.
- Shared materials: normally one palette material plus one accent/emissive
  material. Keep most static complete assets within two material draw groups;
  count moving parts as additional submissions even if they share a material.
- Prefer solid colours, vertex colours, or a small shared palette texture.
  Optional detail atlases should be at most 1024² initially, with correct colour
  space, padding, and mipmaps. Do not bake directional sunlight into base colour.
- Name relevant nodes consistently: root, body, fan, drill_head, cargo,
  socket_loading, anchor_status. Only require names applicable to that asset.
- Shared mesh/material caches are immutable. Do not tint a shared material for a
  selected or invalid building and accidentally change every building. Use
  instance attributes, dedicated overlay materials, or owned material variants.
- Store an asset version, content hash, GLB/LOD URLs, bounds, pivot, footprint
  policy, material count, triangle count, sockets, animation parts, thumbnail,
  and source/provenance reference in the manifest.
- Target at most 250 KB per ordinary building GLB and 75 KB per small prop before
  transport compression; measure the whole pack as well as individual files.
- Validate missing files, unsupported materials/extensions, non-finite transforms,
  footprint overflow, bad normals, floating bases, incorrect axes, missing LODs,
  unexpected cameras/lights, and inconsistent thumbnail scale.
- Inspect every model in an in-game asset gallery under production lighting.
  Include the four quarter turns, close/normal/overview distances, ghost state,
  and adjacent buildings. A beautiful offline render alone does not pass.

Define and validate the manifest schema in 1A before loading assets. Separate
manifest schema version from pack content version and from gameplay schemas.
Asset IDs identify art; the render adapter maps entity kinds to them without
adding art IDs to saves. Declare exactly how each LOD URL resolves, the bounds
of all animation poses, and named sockets in exported local coordinates.
LOD switching uses projected size in CSS pixels with hysteresis, keeping pivots,
selection, and animation phase stable. A tiny mesh may reuse the same file for
multiple LOD entries if this is declared; never leave a missing URL as a fallback.

Validate bounds on final assemblies, not just individual bays. Resolve manifest,
model, texture, and thumbnail URLs relative to the deployed application base so
subpath hosting works. Define a bounded load queue and deduplicate asset requests.
Handle manifest failure as well as individual GLB failure with a retryable React
error and correct-footprint fallbacks. Fallbacks keep the game usable during
failure; they do not satisfy the finished-model acceptance gate.

## 6. Technical architecture

### Renderer and dependency decision

Add Three.js and compatible TypeScript declarations at pinned, verified versions.
Use direct Three.js behind a small imperative renderer interface. This matches
the current canvas integration and makes resource ownership, instancing, and the
frame loop explicit. React components render the HUD and lifecycle host.

Use WebGL 2 for the initial renderer. Three.js documents WebGL 2 as the backend
of [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html). Treat WebGPU
as a later measured improvement. Avoid introducing a second scene framework or
physics engine for this presentation work.

Load GLBs through
[GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), with only the decoder
support the chosen asset exports actually need. Initially keep the small palette
pack simple; add geometry/texture compression only with measured loading benefits.

### Ownership and data flow

~~~mermaid
flowchart TD
    Input[Pointer, keyboard, HUD actions] --> Tools[World interaction controller]
    Tools --> Session[World session and command queue]
    Session --> Client[Existing WorldClient]
    Client --> Worker[World worker: authoritative simulation]
    Worker --> Client
    Client --> Store[Accepted snapshot and presentation store]
    Store --> Adapter[Render adapter and spatial indexes]
    Adapter --> Renderer[Three.js renderer]
    Store --> HUD[React HUD selectors]
    Assets[Versioned asset manifest and GLBs] --> Renderer
    Clock[Buffered presentation clock] --> Renderer
    Camera[Camera and quality preferences] --> Renderer
    Renderer --> Picks[Typed picking results]
    Picks --> Tools
    Session --> Persistence[Existing world save path]
~~~

The frame loop reads accepted state and updates visual transforms. It cannot issue
simulation commands. Simulation modules must not import Three.js, browser canvas
types, meshes, or asset IDs. Logical geometry and persistent IDs remain the shared
language across the boundary.

A world session owns the worker for the application's world lifetime. Switching
between the world and factory editor should not recreate the authoritative session.
Viewport mount/unmount controls GPU resources independently of session lifetime.
Keep advancement/offline progression owned by that session; mounting the renderer
must not introduce a second clock pump.

Create the session on first world entry and own it above the conditional workspace
in [App.tsx](../../src/App.tsx). Once created, an unpaused world keeps advancing
while the factory/library workspace is open. Navigation does not reload its save
or apply offline time again. Dispose it only on application teardown or explicit
world replacement. Prepare a replacement before retiring the old session; a
failed load/generation must preserve the old world and saved record. Only the
active session pumps time or writes the `main` slot. A React StrictMode remount
must not create a second persistent worker or dispose a still-owned session.

### Proposed module layout

~~~text
src/application/world/
  WorldSession.ts             # Worker lifecycle, clock pumping, commands, saves
  WorldStore.ts               # Accepted immutable state and selector subscriptions
src/rendering/world/
  index.ts                    # Public renderer API with no Three.js types
  WorldRenderer.ts            # Scene lifetime and frame scheduling
  RenderAdapter.ts            # Domain snapshot -> derived visual records
  RenderClock.ts              # Pause/speed-aware buffered presentation time
  GridSpace.ts                # Grid/world transforms and quarter turns
  CameraRig.ts                # Constrained pan/orbit/zoom and view presets
  Picking.ts                  # Chunk candidates, proxy hits, stable IDs
  AssetRegistry.ts            # Manifest, GLBs, caches, reference ownership
  InstancePool.ts             # Chunk/material/LOD batches and instance ID maps
  layers/
    TerrainLayer.ts
    OreLayer.ts
    BuildingLayer.ts
    RailLayer.ts
    PodLayer.ts
    OverlayLayer.ts
    EffectsLayer.ts
  quality.ts                  # Presets, resolution, shadows, detail budgets
src/ui/world/
  WorldViewport.tsx           # Canvas host, resize, error/loading boundary
  WorldInteraction.ts         # Tool and pointer gesture state machines
  WorldHud.tsx
  BuildDock.tsx
  BuildCatalogue.tsx
  SelectionInspector.tsx
  WorldAlerts.tsx
  WorldMinimap.tsx
  WorldAccessibility.tsx
  world.css
~~~

Migrate reusable content from WorldBuildingInspector rather than duplicating its
buffer and station logic. Keep WorldView as the composition boundary initially;
split it along the responsibilities above. Match repository naming conventions
when creating the actual files.

The renderer interface should expose lifecycle, size/quality changes, accepted
render-state updates, camera commands, transient overlays, and typed pick events.
Use discriminated picks for tile, building ID, rail edge/node ID, and pod ID.
The selected object should survive model replacement or instance-buffer compaction.
Clear selection only when its authoritative ID disappears or the world changes;
do not silently select a different object that now occupies the same tile. Keep
the catalogue's selected blueprint separate from selected placed factory identity.

### Coordinates and picking

- Map logical (x, y) to world (X = x, Y = height, Z = y). Tile centre is
  (x + 0.5, 0, y + 0.5); tile extent is half-open on its positive edges.
- Treat entity position as the minimum corner of the rotated occupied rectangle,
  matching the current domain. Compute its centre using rotatedSize, then place
  the ground-centred model there.
- Define rotation 1 as a clockwise turn on the map: with this mapping, use
  a Y rotation of -PI/2. Verify all four turns with a non-square asymmetric model
  and visible front marker. Keep the conversion in GridSpace.
- Example: a logical 4 × 2 factory at (10, 20) has centre (12, 0, 21) at rotation
  0 and centre (11, 0, 22) at rotation 1, whose occupied rectangle is 2 × 4.
  Recompute the centre after rotation; rotating around the old centre shifts
  the visible building away from its authoritative occupied cells.
- Map rail nodes, every `edge.points` entry, and pod endpoint positions to tile
  centres using the same +0.5 X/Z offset. Do not apply the entity bounding-box
  centre formula to them. A 2 × 2 station placed at (10, 20) has model centre
  (11, 0, 21), but its node at (10, 20) lies at (10.5, 0, 20.5). Fit the loading
  artwork to that node; never move the logical track to the model's centre.
- Raycast against the ground plane for placement coordinates. Use lightweight
  bounds/proxies for selecting buildings and pods. Ignore decorative mesh hits
  while laying a rail or footprint.
- Query a chunk/spatial index before testing candidates. For instanced objects,
  map the hit instance index back to a persistent entity ID.
- Define hit priority by tool. Selection can prefer a building/pod surface; rail
  editing prefers rail/node proxies; placement always resolves a ground cell.
- Match a reasonable screen-space tolerance for thin rails at overview zoom.
  Start at 6 CSS pixels and use deterministic distance/ID ordering for ties.
  Reject placement hits outside `[0, width) × [0, height)`; never clamp an
  outside click into a valid boundary cell. Clamp the camera target separately.
  Handle missing/parallel ground intersections and zero-sized canvases as no hit.
- Normalize pointer coordinates with the canvas's CSS bounding rectangle, not
  window size or drawing-buffer pixels. Zoom anchoring uses the continuous ground
  intersection before and after zoom; flooring that point to a tile creates jumps.
- Keep selection/ghost depth offsets small and consistent to prevent z-fighting.
  Place labels with screen-space projection and hide or offset occluded labels.

### State synchronisation and timing

1. Accept snapshots only for the active session/world. Apply a delta only if
   `baseRevision === accepted.revision` and `revision >= baseRevision`; revisions
   can jump by more than one during a command. Discard obsolete replies and
   request `SNAPSHOT` on a continuity gap before allowing further edits. Never
   apply the partial delta while resynchronising. Use a session generation token
   even when regenerating the same seed/world ID. Extend the existing client;
   do not create a competing response listener or revision tracker in the renderer.
   Discarding a payload must still settle its pending request; never strand a
   promise in the command queue by silently ignoring its response.
2. Publish accepted snapshots through a store. React subscribes to HUD selectors;
   the renderer receives state directly. Pointer hover and per-frame animation
   must not update the entire WorldView React tree.
3. Separate structural changes from frequent dynamic state. Rebuild entity/rail
   geometry only when its geometry signature changes. Update ore depletion from
   changed cells and dirty chunks. Apply occupancy changes before publishing the
   same accepted revision to local validation. Initial full snapshots rebuild
   caches; routine deltas must not trigger full-world GPU reconstruction.
   Do not mutate received typed arrays, transfer their buffers away, or treat a
   new snapshot object as evidence that every object's geometry changed.
4. Move the current one-second timer into WorldSession. Target 10 worker
   publications per wall-clock second, independent of requestAnimationFrame.
   This is a live advancement/publication cadence, not a new simulation timestep.
   Use the clock/queue contract below; `ADVANCE_PAUSED` means event-budget
   exhaustion and must not be confused with the player's `paused` flag.
5. Keep bounded accepted movement history and render about one publication
   interval behind. Interpolate on known rail segments using logical timestamps,
   honour pause and 1×/5×/20× speed, and clamp to accepted history when the worker
   is late. The initial buffer is 100 ms of wall time: at 20× it represents
   2,000,000 logical ticks, not 100,000. Render time must never exceed the latest
   accepted `logicalTime`. Convert bounded timestamp differences to Number;
   keep absolute simulation times as bigint.
6. Snapshot endpoints alone can miss intermediate turns at high speed. Implement
   a bounded presentation movement stream for accepted intervals, including edge
   ID and start/end times, as part of stage 1C. Derive it from actual movement
   events and use `edge.points` for distance-based path sampling. The stream
   must also carry timestamped cargo/state transitions. Do not infer the
   actual edge from endpoint coordinates when parallel edges exist, or infer
   all travel from a mission's delivery route. Never interpolate diagonally
   between unrelated samples.
7. Any new transport fields require a protocol version update and client/worker
   coverage. Update the constant, literal command/response types, worker response
   values, and fixtures together; the current version is repeated in those places.
   These additions do not require a new saved world schema.
   On history overflow or offline catch-up, snap to accepted state with a brief
   catch-up indicator instead of replaying an unbounded animation backlog.
8. Pause freezes pod and production animation immediately on the accepted pause.
   Camera movement and interface transitions remain usable. Background tabs
   stop rendering; on return, resume from accepted state and existing advancement
   semantics rather than replaying elapsed render frames.

Sample cargo, warning state, and movement from the same presentation time: showing
newly unloaded cargo on a visually arriving pod contradicts the buffered motion.
The inspector may show latest authoritative values. On pause, jump the presentation
to the accepted paused state so it cannot remain parked behind that inspector.
Reset the interpolation history after load, offline catch-up, or world replacement.

The movement stream must have a defined interval, sequence, and limits in both
the worker and client. Start with a 2-second wall-time-equivalent history window
and a hard cap of 20,000 records, whichever is reached first; record any tuning.
The session converts retention to logical ticks using the accepted speed; worker
event recording uses logical timestamps, never a wall clock to drive simulation.
Include pod ID, edge ID, logical interval, and a deterministic order for events sharing
a timestamp. Retain the corresponding edge geometry until history expires, or
reset affected history when topology is removed. Duplicate intervals are ignored;
missing/overflowed intervals explicitly reset to the accepted snapshot. Preserve
state for stationary periods as well as motion, and publish after complete
authoritative transitions. Generating this stream must not consume randomness,
change event ordering, or alter serialized state. Suppress history collection
during long offline catch-up and mark the discontinuity.

### Session clock, queue, and persistence contract

`SimTime` is measured in microseconds: one logical second is `1_000_000n` ticks.
For a running live interval, anchor logical time `t0` to `performance.now()` at
`p0`; its target is `t0 + BigInt(Math.floor((now - p0) * 1000)) * BigInt(timeScale)`.
Carry that anchor across publications so slow responses do not lose elapsed time.
Use `Date.now()` only for persisted offline elapsed time, clamped non-negative;
do not mix its epoch with the monotonic live clock.

Allow at most one in-flight advancement and retain one latest desired target,
not a queue of timer callbacks. If `pendingAdvanceTarget` exists, continue that
target using `CONTINUE_ADVANCE` before sending another `ADVANCE`; yield between
bounded batches so user edits/time controls can run. Pause immediately stops
scheduling new advancement; the already executing batch may finish. After the
pause command is accepted, send neither advancement command until resume, even
if a pending target exists. The worker currently does not enforce this for callers.
Keep a pending target for resume/save; do not clear it in the renderer. On speed
change/resume, settle that existing target once when running, then rebase the live
anchor without charging the paused interval or applying a new speed retroactively.
Retain elapsed running time spent processing that backlog as advancement still
due; re-anchoring must not erase it. With a fake clock, equal elapsed running
intervals must produce the same final time regardless of publication frequency.

Coalesce ghost validation to at most 10 requests per second, with at most one
in flight and one replaceable latest intent. User commits/time controls take
priority over unsent validation and routine ticks; use `WorldClient.command`
to assign revisions when commands are sent. Disable duplicate submission of the
same pending action without dropping unrelated UI intent through a global busy
flag. Validation replies must expose their validated revision; stale validation
can never turn the current ghost green. A changed accepted revision marks cached
validation pending and schedules revalidation if the intent remains active.

The existing worker can mutate before returning `ERROR` for some multi-step
commands. Do not equate rejection with automatic rollback: refresh the snapshot
and reconcile before the next edit. Retain the failed draft and show the error;
never automatically replay the mutation. Schedule resynchronisation without
waiting for a request queued behind the currently blocked queue entry. Reject
pending requests on disposal, worker failure, and protocol mismatch; surface a
recoverable session error rather than leaving the UI pending forever.

Preserve immediate saves after meaningful accepted edits. Decouple routine clock
publication from database writes: use a bounded autosave interval, a serialized
save queue, and a visible dirty/saving/saved state. Keep camera, HUD layout, and
quality preferences in a separately versioned UI record.

Start with a 10-second dirty autosave interval, an explicit Save action, and a
best-effort flush on document hide; do not rely on asynchronous unload handlers.
Save status refers to the snapshot/revision actually serialized and committed,
not the latest visible revision. A failed write stays dirty and offers Retry.
Associate the offline timestamp with the wall time already accounted for by the
captured checkpoint, including any serialized pending target; do not blindly
stamp the later database completion time. On an unpaused load, first settle that
pending target, then add elapsed offline time to the completed checkpoint once.
A paused save retains its pending target without advancing until resumed.
Test this with delayed writes and exhausted budgets so elapsed time is neither
lost nor counted twice. Validate load data before replacing the session or
writing the saved record; never overwrite an unreadable save with a starter world.

Key camera state by world identity and reset transient tools/history on world
replacement. Store target, distance, azimuth, elevation, and view preset as plain
numbers; validate and clamp them to the loaded map. Malformed UI preferences
fall back to defaults without preventing the authoritative save from loading.

### Rendering layers and performance structure

**Terrain and ore.** Keep 32 × 32 logical chunks initially. Build merged ground
meshes and instanced scenery within each chunk; never create a React component or
independent draw call for every cell. Cull terrain, ore, and props together.
Generate visual variants from seed + coordinates + asset-pack version without
consuming the domain generator's random stream. Update ore amount/depletion
without regenerating unrelated chunks.
Buildable-cell decoration must not resemble a blocking obstacle. Hide it under
accepted footprints and rail corridors without changing terrain or occupancy.
Keep ore identifiable under drills; a mined-out patch can retain its resource
identity without implying remaining stock. Attach a boundary-spanning building
to a batch with bounds covering the entire model, not just its anchor tile.

**Buildings.** Resolve entity kind, footprint, and state to an asset recipe.
For a placed building, use `entity.transform`, not the current editor contract;
only a placement/replacement preview uses the selected new contract's footprint.
Pool shared geometry and materials; batch repeated static pieces by chunk,
material, and LOD. Drive a small set of fan/head/cargo transforms separately.
Only near or selected buildings need all animated parts. A model load failure
uses a labelled geometric fallback with the correct footprint.
Entity state ACTIVE means a constructed factory exists; it does not mean it is
producing. Drive production animation from the matching WorldBuildingSnapshot
state RUNNING, including its paused/blocked alternatives.

**Rails and pods.** Build rail geometry on topology changes, including directional
markers and explicit junction fittings. Cache node/edge lookup maps. Pool pod
chassis and cargo instances and update only matrices/status attributes each frame.
Show reservations and traffic states in a toggleable logistics overlay, with
essential warnings visible in the default view.

**Overlays and effects.** Keep ghosts, selection outlines, footprints, connection
arrows, and status markers in dedicated layers. Budget DOM labels to selected,
hovered, or important objects. Use pooled modest effects; stop production effects
with production. The minimap can use a small Canvas 2D surface based on the same
world data, updated at a low frequency.
Transient placement previews should not write depth or cast ordinary building
shadows. Keep those previews out of picking and occupancy; use a dedicated
material/overlay so transparency sorting cannot hide the footprint or contaminate
the final model.
Authoritative drill ghosts remain selectable and represented in occupancy.

Use [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) for repeated
geometry/material pairs. Mark changed instance buffers for upload and maintain
their bounds after transforms change. Chunk batches so visibility and picking do
not require testing one global batch spanning the entire world.
An imported GLB scene can contain several meshes; it is not one instancable
geometry. Extract compatible static parts and compose their authored local
transforms with each entity transform. Keep animated parts separate, and account
for every material group in the draw-call budget. Swap-removing a pool entry must
update both ID-to-slot and slot-to-ID maps before the next pick.

**Lighting and image output.** Start with one directional shadow light and
hemisphere fill, shared matte materials, sRGB display output, and one explicit
tone-mapping choice. Keep the shadow region near the camera's working area;
do not allocate a high-resolution shadow map for the entire 1024² world. Use
simple contact decals on the low preset. Add ambient occlusion only after its
measured cost fits the quality budget. Keep bloom off by default.

**Lifetime.** Resize with ResizeObserver and cap the drawing resolution. Reuse
materials, geometries, and loaded models. Reference-count shared resources and
dispose scene-owned buffers, textures, render targets, controls, subscriptions,
and frame callbacks on teardown. Account for React development remounts and late
asynchronous loads. Recover a lost graphics context by rebuilding from the
accepted snapshot without restarting or changing the simulation.
While the viewport is hidden, detached, or has zero size, suspend its frame loop
and defer size-dependent allocations. Do not equate graphics-context recovery
with worker recovery: if the worker itself fails, stop commands and offer an
explicit reload of the last successful save with its unsaved-loss consequence.

## 7. Performance and loading targets

These are acceptance targets to measure during implementation, not claims about
the current game. Record CPU, GPU, RAM, OS, browser, resolution, quality preset,
production build, seed, fixture size, and warm-up procedure in performance.md.
Stage 1A must name actual reference hardware/browser versions; current performance
notes do not provide a complete GPU baseline. Check in a deterministic fixture
builder or current-schema fixture with valid occupancy, stations, traffic, and
materials. Record counts per kind and ensure all 200 pods actually move during
the run; render-only dummy meshes do not measure session/worker performance.

| Measure | Initial target |
|---|---|
| Standard play fixture | 256 × 256 world, 500 mixed buildings, 200 moving pods, 2,000 rail cells |
| Standard frame pacing | 60 FPS target, p95 frame interval at most 20 ms over a 60-second camera/build/traffic run |
| Low preset fixture | Same world, reduced resolution/detail/shadows; 30 FPS target and p95 at most 35 ms |
| Input feedback | Hover/ghost response within 50 ms; authoritative confirmation measured separately |
| Main-thread work | No routine task over 50 ms while navigating or placing |
| Draw submissions | Initial target at most 200 main-scene calls and 350 total including shadows/effects in the standard working view |
| Visible geometry | Initial target at most 500,000 main-scene triangles at standard detail |
| Runtime asset download | At most 5 MB compressed for the first playable scene; at most 15 MB for the initial full pack |
| GPU allocations | Initial estimated budget at most 256 MB for textures, geometry, targets, and shadows |
| First view | Placeholder scene within 2 seconds and primary assets within 5 seconds on documented 20 Mbps/100 ms cold-load conditions |
| Lifetime | No monotonic resource growth after 20 world/editor switches and repeated world reloads |

Use a fixed camera route and interaction script after a recorded warm-up. Report
local pointer feedback separately from worker validation/commit latency. Include
worker round-trip time, serialization/structured-clone cost, ore/occupancy diff
work, and save frequency at 10 publications/s; changing the timer alone does not
make full collection replacement or a million-cell scan inexpensive.
Estimate GPU bytes from actual buffers/textures/targets; Three.js object counts
are not byte measurements. Count submissions across shadow and effect passes,
and record cold transfer bytes separately from decoded GPU allocation. Time first
view from entering the workspace; identify world generation/load or offline
catch-up separately so a loading placeholder cannot be reported as playable.

Also exercise a 1024 × 1024 generated world: it must not allocate one scene object
per tile or require the whole map to be visible. Record separate overview results,
since its visibility differs from a normal working view.

Provide low, standard, and high presets. Start with pixel-ratio caps of 1, 1.5,
and 2 respectively; high remains constrained by the device. Reduce resolution,
shadow quality, effects, and prop density in that order before hiding essential
gameplay information. Allow a manual override and use slow, hysteretic automatic
changes so quality does not oscillate.

Lazy-load Three.js and the world asset pack when the world workspace opens.
Prioritise terrain and buildings near the working area, then prefetch likely build
assets. Use content-hashed immutable asset URLs and a versioned manifest. Warm
needed shaders during loading and spread large scene uploads across frames.

If WebGL 2 is unavailable, show a clear capability message with the accessible
entity/problem lists, inspection, navigation, and save access. If context recovery
fails, offer a retry. These are React states; they do not require keeping a second
world renderer.

## 8. Implementation sequence

Each stage should land with a usable intermediate result, explicit evidence, and
no unrelated gameplay changes.

| Stage | Work | Depends on | Exit evidence |
|---|---|---|---|
| 1A — Reference and contracts | Capture current scenarios, generate world/building/UI concepts, establish palette, axes, manifest schema, reference hardware, and performance fixtures | Current code | Selected reference composition, written asset contract, baseline captures and command-parity checklist |
| 1B — Three.js foundation | Add pinned dependencies, viewport lifecycle, camera, GridSpace, picking proxies, lighting, chunked placeholder ground | 1A | Navigable real 3D scene with accurate picking, resize, and clean teardown; immutable fixture data is sufficient here |
| 1C — State and interaction integration | Extract WorldSession/store, correct delta/occupancy/ore handling, add validation and movement transport, connect saves and every tool/action in section 4 | 1B | Real worker interactions with correct pause/speed, recovery, and save continuity; required transport tests pass |
| 1D — First finished scene | Build scripts and the first building/drill/rail/pod/terrain/ore assets plus base depot and construction kit; load through manifest | 1A–1C | One functioning production route matches the target art, including cargo and construction feedback |
| 1E — Complete world and HUD | Finish depot/construction/terrain variants, modular factory sizes, dock, catalogue, inspector, alerts, accessibility, minimap | 1D | Every existing entity/tool/state is represented and usable across target viewport sizes |
| 1F — Optimisation and reliability | Instance/cull/LOD, quality presets, loading budgets, clock/history edge cases, context recovery, save continuity | 1E | Measured budgets, interaction coverage, stable resource lifetime |
| 1G — Switch and cleanup | Make Three.js default, remove Pixi renderer/dependency, retire old styles, update documentation and captures | 1F | Full parity checklist, asset pack checks, regression suite, and visual review pass |

For each stage record changed files, completed checklist items, exact verification
commands/results, and remaining blockers. Only mark a stage complete when its
exit evidence exists. Infrastructure may use placeholders through 1C; full
instancing/LOD tuning lands in 1F, but chunk boundaries and stable-ID reconciliation
must exist from 1B/1C so optimisation does not require a second architecture.

A temporary development renderer flag may compare the existing canvas with the
new scene during stages 1B–1F. Only one viewport renderer mounts at a time and
both consume the same accepted world state. Remove that flag and the Pixi import,
component, CSS, dependency, and lockfile entries at 1G after verifying no other
consumer remains.

Build stage 1D as a complete visible slice before producing many cosmetic
variants. Its exit criteria must include a screenshot from the running game,
a short camera orbit, valid/invalid placement, and moving cargo at normal speed.
This catches lighting, scale, pivot, and UI problems before the full pack is made.

## 9. Verification and acceptance

These checks belong to implementation, not to writing this plan. Use unit tests
for pure transforms/state handling and Playwright for the actual interactions.
Avoid tests that merely assert a component or a mocked renderer was called.

### Failure cases that must be exercised

| Scenario | Required evidence |
|---|---|
| Non-square 4 × 2 factory, all four rotations, map boundary, high-DPI canvas | Mesh, ghost, click target, sockets, and occupied cells agree; outside-map placement is rejected |
| Remove an instanced building, compact the pool, then select its former neighbour | Persistent identity remains correct; no wrong building is inspected or dismantled |
| Repeated dynamic snapshots with unchanged topology | Pod/status updates do not rebuild terrain, rail, or factory geometry |
| Actual worker extraction reaches zero without changing world ID | Nonempty ore delta reaches the client; patch and drill update in the same session |
| Place/remove/rebuild on one tile through successive deltas | Client occupancy matches the worker; ghost validity changes without a full reload |
| Delta has a mismatched base, a valid multi-revision jump, or belongs to a replaced session with the same world ID | Valid jumps apply; gaps resynchronise and old sessions cannot mutate accepted state |
| Pod crosses two turns between publications at 20× | Motion follows the accepted path and never cuts diagonally across terrain |
| Pause mid-motion, late worker, exhausted budget, background tab, history overflow | No extrapolation through a blocked section, invented cargo, or unbounded catch-up animation |
| Old ghost reply arrives after rotation, tool change, or world load | Reply is ignored; confirmation uses current intent and worker validation |
| Pan/orbit ends over a building; pointer cancelled; click or type in HUD | No unintended placement, deletion, camera movement, or duplicate shortcut execution |
| GLB with several static parts and one moving part | Instanced assembly preserves local transforms; only the intended part animates |
| Select/ghost one object sharing a material with many others | Other objects keep their materials; the ghost does not affect depth, shadows, or picking |
| Construct, cancel, replace, dismantle, and evacuate with materials in transit | Visual stages follow accepted world state and material counts; no invented world undo |
| Cross unsplit rails and add a marker; separately draw paths sharing an explicit junction endpoint | First crossing remains unconnected; only actual shared endpoint IDs establish connectivity |
| Factory ACTIVE but WAITING_INPUT/OUTPUT_BLOCKED; active drill with full mine output | Machinery stays stopped; inspector reports known facts and does not invent a downstream cause |
| Mine head on ore, drill on wrong/exhausted ore, second drill after first placement | Correct rejection reasons and persistent mine binding; no cursor action changes the domain rules |
| Select a placed factory different from the catalogue selection, open it, edit its blueprint, then replace it | Correct factory opens; only explicit accepted replacement changes the placed contract/footprint |
| Rejected multi-step command or protocol mismatch | Snapshot reconciliation or explicit session error; no optimistic rollback, duplicate mutation, or unresolved request |
| Save during movement/construction, reload; open factory and return | Current saves remain valid; logical state is intact and world camera is restored |
| Delayed/failed database write, paused speed change, saved pending target, hidden-tab catch-up | Accurate save status; no movement while paused and no lost/doubled advancement on resume/load |
| Failed load/generation or late save from the previous session | Last valid world/save survives; old callbacks cannot overwrite the active slot |
| Context loss, missing asset, late load after unmount, 20 workspace switches | Useful fallback/recovery, one session clock, no duplicate events or increasing GPU resource counts |
| No WebGL 2, missing manifest, subpath hosting, zero-size/hidden viewport | DOM fallback remains usable, URLs resolve, and retry cannot create duplicate sessions |
| Keyboard-only build/inspect/cancel, reduced motion, 390 × 844 layout, two-finger gesture ending over a ghost | Essential interactions and focus remain available; pan/pinch does not submit a build command |

Fixtures must cover every entity kind and station configuration as well as the
failure cases above. Use a renderer-ready signal for screenshots, with fixed
seed, camera, logical time, asset version, and decorative animation phase.
Capture a pinned browser/environment and allow a small pixel tolerance; a
cross-GPU image mismatch alone is not a gameplay failure.

Use real worker round trips for delta, time, and save integration cases. Prove
that enabling/disabling presentation recording gives identical logical saved
state for the same command sequence. Inject clocks for deterministic pause/speed
and queue tests. The renderer-ready signal must wait for accepted state, required
assets, shader preparation, and one completed frame; do not replace readiness
with arbitrary screenshot sleeps. Exercise fallback assets in separate captures.

At completed stages run the repository checks relevant to the changes. At the
final switch run `npm run check` and `npm run test:e2e`. Measure performance in a
production browser on documented hardware; software-rendered CI is not FPS evidence.
Also run the implemented `assets:validate` command and one clean asset rebuild
with the pinned Blender version. Existing `npm run check` does not validate a new
asset manifest unless that check is explicitly added. Update E2E selectors and
flows for in-app confirmations rather than keeping native dialogs solely for
old tests. A failed or unrun mandatory gate must be reported as such.

### Visual acceptance

Capture the same finished world at close, normal, and overview distances,
including a selected building, build ghost, active construction, and blocked
traffic. Capture the HUD at 1366 × 768 and 1920 × 1080, plus a narrow layout.

The overhaul is complete only when:

- Perspective, visible height, material shading, and cast/contact shadows clearly
  establish a three-dimensional world.
- Every building kind is recognisable by shape at normal zoom, and menu thumbnails
  match the models the player places.
- Large and oddly proportioned factories fit their real footprints with coherent
  modules; station approaches and rails remain visible.
- Models share a consistent scale, palette, edge treatment, and lighting; they
  have no floating foundations, broken normals, obvious seams, or z-fighting.
- Construction, ore depletion, traffic direction, cargo, and blocked states are
  understandable without opening a debug panel.
- The dock and inspector are comfortable to use, preserve a useful working area,
  and expose all existing world actions.
- Performance and asset budgets have measured evidence, existing saves load, and
  the worker remains the sole authority for material and logistics state.
- The shipped world renderer and its minimap have no PixiJS dependency.

Record any changed decision here with its reason and measured evidence. Begin
implementation at stage 1A, then follow the dependencies above.
