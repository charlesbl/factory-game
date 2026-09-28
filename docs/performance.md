# Performance reference

The reproducible harness is `npm run benchmark`. It covers 50, 250, and 1,000
node stable paths; 10,000, 100,000, and 1,000,000 compact instance records; and
integer world-buffer operations. Browser interaction is covered separately by
the 250-node editor E2E fixture.

Reference run: Windows, Node 24.11.1, production Vite build, Chromium. Results
must be recorded from the current machine rather than treated as universal
guarantees. The compact structure-of-arrays scenario uses 9 bytes per instance
(one state byte and one 64-bit logical time) before variable buffers and contract
references, below the 128-byte target. Blocked actors have no scheduled event by
construction and automated test.

Large benchmarks are intentionally manual. The normal CI path runs exact unit,
generative, compiler, runtime, and build checks without allocating a million
objects.

## 2026-07-01 reference results

| Scenario | Mean |
|---|---:|
| Stable route, 50 nodes | 0.125 ms |
| Stable route, 250 nodes | 2.14 ms |
| Stable route, 1,000 nodes | 29.3 ms |
| Allocate 10,000 compact records | 0.065 ms |
| Allocate 100,000 compact records | 0.346 ms |
| Allocate 1,000,000 compact records | 0.338 ms |
| Integer batch operation | 0.0004 ms |

Typed-array allocation is lazy at the operating-system level, so its timing is
not an object-allocation claim; the useful result is the deterministic 9 MB raw
storage footprint for one million minimal records. The 250-node path calculation
is well under the 100 ms edit-preview budget.


## 2026-09-27 Three.js world reference

Reference machine: Intel Core i7-8700K (3.70 GHz), AMD Radeon RX 9070 XT
(driver 32.0.31035.1003), about 15.9 GiB system RAM, Windows 11 Pro
10.0.26200, Node 24.11.1, Chromium 149.0.7827.55. ANGLE reports the actual
AMD D3D11 device. These results are hardware-rendered, not software CI results.

The production Vite preview runs on port 4173. The viewport is 1366 x 768 at
DPR 1. The deterministic seed is world-performance-v1: a 256 x 256 world,
90 factories, 100 storage buildings, 200 stations, 90 depots, 10 mines and
10 drills (500 entities), plus 200 real pods and 2,000 directed rail cells.
The fixture test verifies that every pod moves during 60 logical seconds.

After five seconds of warm-up, scripts/world-performance.mjs runs the same
12-step camera route for about 61 seconds, with six ghost interactions and an
authoritative junction placement. The session, worker, traffic and 10-second
autosave remain active. No competing test or asset build ran during this sample.
Raw samples: [world-performance-results.json](world-performance-results.json).

| Measure | Standard | Low |
|---|---:|---:|
| Frames / elapsed | 3,667 / 61.18 s | 3,671 / 61.25 s |
| p95 frame interval | 16.7 ms | 16.7 ms |
| Mean frame interval | 16.68 ms | 16.68 ms |
| Assets/shaders/frame ready after entry | 2,307 ms | 1,866 ms |
| Maximum measured local feedback upper bound | 44.7 ms | 31.2 ms |
| Tasks exceeding 50 ms | 1 (59 ms) | 1 (63 ms) |
| Maximum main / all-pass draw submissions | 232 / 372 | 224 / 224 |
| Maximum main-scene triangles | 163,534 | 161,062 |
| Maximum estimated GPU bytes | 20,745,816 | 12,357,208 |
| Worker RPC p95 | 492 ms | 493.6 ms |
| Worker processing p95 | 481.7 ms | 487.2 ms |
| Worker delta preparation p95 | 2.6 ms | 2.6 ms |
| Main-thread delta application p95 | 0.2 ms | 0.2 ms |
| Worker-side postMessage call p95 | 4 ms | 4 ms |
| Main-thread save JSON encoding p95 | 0 ms | 0.1 ms |

Local feedback measures a conservative two-animation-frame bound after a DOM
input event; it is distinct from authoritative validation/commit latency. Worker
postMessage timings measure the synchronous sender call, not a complete clone
cost isolated from scheduling. JSON save encoding runs in the worker. Seven SAVE
requests were observed per route (periodic saves plus explicit placement save).

Both runs issued 361 ADVANCE requests: about 5.9 publications/s under this camera
and validation workload. The scheduler targets 100 ms, permits one advancement in
flight and prioritizes the latest validation intent. This is **not evidence of a
sustained 10 publications/s** at the initial load target. The raw report includes
per-command timings rather than hiding this behind the timer setting.

The initial 200-main/350-total draw-call target was exceeded by 16%/6%. A proposed
working-view budget is 240 main and 400 total: chunk/material/LOD boundaries keep
culling bounded, and measured frame pacing and geometry/allocation budgets have
substantial headroom. The original target remains visible in the plan; this is an
explicit tuning proposal, not a claim that the initial budget passed. The isolated
59/63 ms tasks also remain an exception to the initial 50 ms routine-task target.
The later rail reconciliation correction avoids rebuilding unrelated edges when
an isolated junction changes. A fresh isolated profile of that correction is
still due; the numbers above precede the final rail/lifecycle review fixes.

GPU allocation estimates count actual unique geometry/index/instance buffers,
framebuffers and shadow targets. They are not driver VRAM measurements. The
runtime pack has 63 GLBs and 21 thumbnails for 21 assets, 4,376 total LOD0
triangles and 1.22 MB uncompressed. The station/depot hookup marker and the
continuous rail-corner assembly now keep their authored silhouettes at tested LODs.

Separate qualification used a cold cache, 20 Mbps and 100 ms network latency:
first frame 1,113 ms; required assets ready 3,490 ms; transferred bytes 1,151,122.
Twenty world/editor switches retained 32 geometries, 3 textures and 5,763 scene
objects. Five renderer world reloads retained 27 geometries and 3 textures.

The 1024 x 1024 starter fixture reached first frame in 3,170 ms and assets ready
in 3,602 ms. Its overview measured 948 main / 975 total calls, 235,620 main
triangles, 3,408 scene objects and an estimated 21,478,816 GPU bytes. This is a
separate visibility stress case, outside the standard working-view call budget.
Its earlier working-view sample was taken before the post-readiness metric refresh
and must not be used as a final model count; the harness now waits for ready
metrics and that capture will be refreshed. There is no object per logical tile.

Visual qualification: 390 px viewport / 390 px document width, sampled minimum
text contrast 7.29:1 and control-border contrast 3.74:1. The model gallery exercises
21 assets, three LODs and four rotations. See
[world-qualification-results.json](world-qualification-results.json),
[world-renderer-review-results.json](world-renderer-review-results.json) and the
[capture index](visual-baselines/world/README.md).

Reproduce sequentially, without another browser workload using the GPU:

    npm run build
    npx vite preview --host 127.0.0.1 --port 4173
    node scripts/world-fixture.mjs
    node scripts/world-fixture.mjs --visual
    node scripts/world-fixture.mjs --large
    node scripts/world-performance.mjs
    node scripts/world-qualification.mjs

The renderer and command review scripts use the development server on 5173.
Production build warnings about chunks above 500 kB remain informational; Three.js
and the model pack load when entering the world workspace.
