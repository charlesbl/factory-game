# ADR 0005: Procedural world and rendering boundary

Status: accepted — 2026-07-06

## Context

The previous world screen represented one compiled factory and its buffers as
React cards. It had no authoritative geography, resource deposits, placement,
or rendering architecture suitable for thousands of visible cells.

## Decision

V1 uses a finite 256 × 256 orthogonal grid generated from a versioned string
seed. The generator is deterministic, uses a fixed integer PRNG, creates
impassable obstacle regions, a 32 × 32 starting clearing, and three finite
patches each of iron and copper. At least one patch of each resource is reachable
from the clearing; deterministic corridor carving repairs a disconnected result.

Terrain, ore kind, remaining integer ore, and occupancy use typed arrays. The
complete generated arrays are authoritative save data. The seed and generator
version are retained for diagnosis, not used to reconstruct a saved map.

World simulation and generation live in a dedicated worker. PixiJS 8 renders an
imperative WebGL scene from revisioned snapshots. React owns navigation,
inspectors, commands, and accessible alternatives. Render frames may interpolate
timestamped pod motion but never mutate simulation state.

World buildings occupy integer rectangular footprints and may rotate by quarter
turns. Obstacles, occupied cells, and map boundaries invalidate placement.

## Consequences

- The factory editor and world renderer remain separate spatial systems.
- A missing WebGL implementation is an unsupported rendering environment in V1.
- Generator changes require a new generator version but no save regeneration.
- Diagonal construction, bridges, terrain editing, and an infinite world remain
  future extensions.

