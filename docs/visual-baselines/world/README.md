# World visual review

The pre-migration view is `current-1366.png`. The refreshed September 28–29 review
uses pack 1.0.0 and Chromium 149.0.7827.55 with Intel Vulkan rendering on Linux,
as recorded in
[performance.md](../../performance.md). These are review artifacts, not portable
pixel-perfect assertions across different GPU drivers.

Regenerate fixtures and captures with:

```
node scripts/world-fixture.mjs
node scripts/world-fixture.mjs --visual
node scripts/world-fixture.mjs --large
npm run build
npx vite preview --host 127.0.0.1 --port 4173
node scripts/world-qualification.mjs
node scripts/world-performance.mjs
```

For the Linux Vulkan backend used here, set `WORLD_ANGLE=vulkan`; the browser
process needs access to the GPU render device and an installed Vulkan driver.
The performance report records the actual GPU, CPU, OS and browser.

Run the two browser harnesses sequentially, without unit tests or Blender renders
competing for the CPU/GPU. Readiness waits for accepted state, all required assets,
shader preparation and a completed frame. The visual fixture is paused at
16,000,000 logical microseconds and disables decorative animation. The performance
fixture runs actual traffic and records its accepted logical times.

| Capture | Scenario |
|---|---|
| `starter-1366.png` | New seeded world after cold asset loading |
| `finished-{close,normal,overview}-1366.png` | Same paused 502-entity review world, selected elongated factory, fixed camera presets |
| `finished-1920.png`, `finished-390.png` | Desktop and narrow HUD; the latter must have no horizontal overflow |
| `ghost-invalid.png`, `ghost-valid.png` | Worker-validated station previews and keyboard cursor |
| `construction-inspector.png` | Accepted half-delivered storage site and its material counts |
| `blocked-traffic-inspector.png` | Real blocked delivery with loaded pod and reported traffic state |
| `large-overview.png` | Separate 1024 × 1024 visibility stress case |
| `asset-gallery.png` | All 23 exported models under production lighting |
| `hookup-station-selected.png`, `hookup-station-crane.png` | Exterior station marker and crane beside the connected rail |
| `hookup-depot-ghost.png`, `hookup-blocked-reason.png` | Depot placement and occupied hookup rejection |
| `rail-crossing-rejected.png` | Earlier capture of a rejected rail path; recapture with the integration review for the drag UI |
| `models-before-loading.png`, `models-after-loading.png` | Identical camera before and after the 69 GLBs load, including connected rails and hookups |
| `model-lods.png` | Eight representative assets at each of their three LODs |
| `performance-{standard,low,high}.png` | Last view of each running performance route |

`/?asset-gallery` provides all three LODs, four quarter turns, footprint bounds,
named sockets and orbit/top controls. `scripts/world-renderer-review.mjs` uses the
development server to exercise actual assemblies at DPR 2, rotated 4 × 2
footprints, ghost material isolation, picking, outside hits, unchanged topology,
world replacement resource counts, hidden viewport suspension and late disposal.
The JSON reports alongside this directory retain numerical evidence.

With the development server on port 5173, `node scripts/world-model-review.mjs`
captures loading/LOD fidelity and checks stopped machinery transforms. With the
production preview on port 4173, `node scripts/world-integration-review.mjs`
exercises depot production/cancellation, rejected rail placements and WebGL context
restoration, including restoration of the placement ghost and minimap.
