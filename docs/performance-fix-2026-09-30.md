# Performance investigation — 2026-09-30

The supplied screenshot reports 2.8 FPS, frame p95 441.8 ms, worker RPC p95
718.1 ms, worker processing p95 3.7 ms, and 1,447 missions. The difference
between worker processing and RPC does not by itself identify simulation as the
main bottleneck.

## Changes

- Stop passing the raw world snapshot as an enumerable React component prop.
  React's development performance tracks recursively inspect props, including
  the grid's large typed arrays, and clone the resulting metadata. Canvas and
  inspector receive a snapshot getter instead. A browser regression requires
  multiple actual canvas prop measures with fewer than 100 metadata entries.
- Mount object lists only while their browser and inspector are open.
- Prune delivered missions, keeping salvage receipts needed for dismantling or
  restoration. Transmit only active missions. Preserve mission sequence numbers
  across pruning and save/load; skip dispatch reservation scans with no idle pods.
- Preserve unchanged rail topology across worker deltas, so traffic/time changes
  do not rebuild rail render signatures and picking indexes.
- Keep traffic geometry and materials between updates; update occupancy lines
  and colors only where block state changes.
- Cache minimap terrain/ore until map data, ore visibility, or dimensions change.
- Remove the renderer's 15.5 ms frame gate. Rendering now follows display refresh.
- Use a real five-second profiler window, add frame p99/max, the 4.17 ms budget,
  timer delay, client queue delay, per-request RPC residual wait, and recent
  versus session long tasks. Worker sending time is explicitly the previous
  response's measurement. Make the panel scrollable and label active missions.

## Measurements and limits

A synthetic world matches the screenshot's counts: 26 entities, 701 rails and
8 pods. Its saved state additionally contains 1,447 delivered receipts. This is
a separate test world, not the user's actual saved world.

The available Chromium GPU is SwiftShader. Explicit hardware Vulkan failed to
create a WebGL context. For the CPU experiment, the renderer initializes normally,
then browser response instrumentation skips only `WebGLRenderer.render`.
Simulation, worker transport, React, scene synchronization, animations and the
profiler continue running. GPU submission is therefore excluded; these numbers
are **not measured game FPS** and do not validate 240 FPS on hardware.

Both ten-second runs use a production build, a 640 × 480 viewport, a closed
inspector, standard quality, and the browser's 60 Hz requestAnimationFrame clock.
The intermediate run precedes rail topology sharing and incremental traffic
geometry; it already includes mission pruning and the snapshot getter.

Raw samples: [world-cpu-profile-2026-09-30.json](world-cpu-profile-2026-09-30.json).

| CPU experiment | Intermediate | Final |
| --- | ---: | ---: |
| Scene synchronization p95 | 22.0 ms | 0.8 ms |
| Timer delay p95 | 13.8 ms | 1.2 ms |
| Frame maximum | 33.3 ms | 16.8 ms |
| Long tasks during measurement | 0 | 0 |
| Animation CPU p95 | 0.2 ms | 0.3 ms |

An isolated snapshot-plus-clone experiment on 1,447 completed missions with
40-edge routes reduced mission payload p95 from 34.76 ms to 0.034 ms and its JSON
size from 788,956 bytes to 2 bytes. This measures only the discarded history,
not the entire worker response or the game frame rate.

Validation: `npm run check` passes (assets, types, lint, formatting, 183 unit
tests and production build). Two additional Playwright regressions pass for
React metadata and hidden object lists. Coverage includes real deliveries,
mission identifiers after save/load, salvage reclamation/restoration, rail
topology invalidation, traffic occupancy colors and minimap invalidation.

The remaining acceptance check is sustained full rendering on the user's
hardware and saved world, with F3 showing frame p95/p99 and recent long tasks.
