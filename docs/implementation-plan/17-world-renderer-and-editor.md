# Stage 17 — World renderer and editor

Status: implemented — 2026-07-06

Depends on: Stage 16

## Mission

Replace the React demonstration diagram with a scalable top-down world editor
without coupling render frames to simulation state.

## Implementation

1. Mount a PixiJS 8 WebGL application inside the React world workspace.
2. Maintain terrain, ore, rail, entity, pod, reservation, selection, and ghost
   layers. Chunk terrain into 32 × 32 containers and cull invisible chunks.
3. Implement pan, bounded zoom, inverse-camera tile picking, keyboard camera
   controls, selection, and an accessible entity list.
4. Interpolate pod motion from logical start/end timestamps. Never send a world
   command from the ticker or derive authoritative position from wall time.
5. Add tools and previews for directional orthogonal rail, explicit junctions,
   stations, factories, depots, storage, mine heads, drills, rotation, and
   cancellation.
6. Route every confirmed edit through versioned world-worker commands and ignore
   stale revisions.

## Tests and acceptance

- E2E tests cover camera controls, picking, valid/invalid ghosts, direction
  display, rotation, keyboard operation, and accessible inspection.
- Deterministic screenshots cover terrain, deposits, buildings, rails,
  reservations, and blocked pods.
- The 256² reference world with 200 moving pods sustains 60 FPS and no ordinary
  UI task exceeds 50 ms on the documented reference machine.
