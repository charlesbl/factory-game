# Priority 1 — 3D world and interface qualification

Status as of 2026-09-29: integration and final qualification are complete.
Functional acceptance (1F) passes. The performance record (1G) is complete with
measured exceptions; strict compliance with every original budget is **not**
achieved. No change to those budgets or user acceptance of exceptions is assumed.

## Integration completed

- Connected depot pod production and cancellation to the world commands.
- Restored keyboard previews, overlays and minimap after renderer recreation;
  cleaned up camera persistence listeners when renderer creation fails.
- Corrected the minimap viewport projection and retained camera persistence.
- Avoided unnecessary logistics route searches when no idle pod or unmet demand
  exists. Updated the representative fixtures for the current building footprints.

## Qualification record

| Area | Result and evidence |
|---|---|
| Production performance | Isolated Standard, Low and High profiles on the 256 × 256 world: 500 entities, 200 moving pods and 2,000 directed rail cells. Hardware and all exceptions are recorded in [performance.md](../performance.md). |
| Large world | Refreshed 1024 × 1024 working and overview metrics after readiness, with [raw evidence](../world-qualification-results.json). |
| Exterior hookups and rail clearance | Station/depot markers remain outside rotated footprints. Connection flows and footprint rejection pass; a rejected crossing retains its editable draft and reason. [Integration evidence](../world-integration-review-results.json). |
| Models and LOD | All 69 GLBs load. Same-camera before/after captures and three-LOD inspection cover straight rails, corners, junctions, hookups, station, depot and factory. [Model evidence](../world-model-review-results.json). |
| Final captures | Refreshed desktop/narrow HUD, close/normal/overview, construction, blocked traffic, previews and rail/model captures. [Capture index](../visual-baselines/world/README.md). |
| Placed factory editing | Selecting a placed factory opens its blueprint even when the catalogue selection differs; edits preserve the placed instance until explicit replacement and its footprint/cost/recovery confirmation. Targeted browser scenarios passed. |
| Stopped machinery | Waiting/output-blocked factories and a drill with full output retain stationary animation transforms; inspectors use the worker's known state. Model report and state browser scenarios passed. |
| Renderer lifecycle | Twenty world/editor switches retain identical geometry/texture/object counts. Five renderer reloads retain stable resources. Forced WebGL loss/restoration restores the same ghost and visible minimap. |

## Validation scope

Production build, TypeScript, asset validation (23 assets / 69 GLBs), targeted
lint/format checks, 46 focused unit tests and the 500-entity performance fixture
passed. Ten targeted browser scenarios passed across separate runs: placed
factory selection/edit/replacement, camera persistence, exterior hookups,
construction, dismantling, paused save/load and stopped machinery. The camera
scenario uses CPU minimap readback to avoid a Chromium GPU/CPU rasterizer switch
changing its image hash. The full repository suite was not run.

## Performance exceptions

The original 200 main / 350 total draw submissions, routine main-thread tasks
below 50 ms and sustained 10 publications/s targets remain the reference.
Standard/High frame pacing, task outliers, publication cadence and draw submissions
have explicit measured exceptions in [performance.md](../performance.md).
The 1024 × 1024 overview is reported separately as a visibility stress case.

The requested qualification work is closed with these exceptions documented.
Further optimization is required before claiming a strict performance-budget pass;
no budget relaxation has been approved.
