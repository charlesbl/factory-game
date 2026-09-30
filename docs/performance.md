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

## In-game profiler

Open the world and press **F3** or select **Perf** in the overlay controls. The
panel reports rolling p95 timings for frame intervals, the renderer update,
WebGL CPU submission, snapshot synchronization, and world-worker RPC,
processing, delta preparation/application, and message submission. It also
shows draw calls, triangles, entity counts, mission-history growth, browser heap,
long tasks, and an estimated GPU buffer size. Profiling is opt-in and keeps only
a bounded sample window.

`GPU p95` is populated only when the browser supports WebGL timer queries.
`WebGL CPU submit` is the main-thread time spent submitting the render, not GPU
execution time. Browser heap and GPU buffer estimates have browser/driver
limitations; for out-of-memory investigations, use the memory capture procedure
below as well.

## 2026-07-01 reference results

| Scenario                           |      Mean |
| ---------------------------------- | --------: |
| Stable route, 50 nodes             |  0.125 ms |
| Stable route, 250 nodes            |   2.14 ms |
| Stable route, 1,000 nodes          |   29.3 ms |
| Allocate 10,000 compact records    |  0.065 ms |
| Allocate 100,000 compact records   |  0.346 ms |
| Allocate 1,000,000 compact records |  0.338 ms |
| Integer batch operation            | 0.0004 ms |

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
Archived samples: [world-performance-reference-2026-09-27.json](world-performance-reference-2026-09-27.json).

| Measure                                     |        Standard |             Low |
| ------------------------------------------- | --------------: | --------------: |
| Frames / elapsed                            | 3,667 / 61.18 s | 3,671 / 61.25 s |
| p95 frame interval                          |         16.7 ms |         16.7 ms |
| Mean frame interval                         |        16.68 ms |        16.68 ms |
| Assets/shaders/frame ready after entry      |        2,307 ms |        1,866 ms |
| Maximum measured local feedback upper bound |         44.7 ms |         31.2 ms |
| Tasks exceeding 50 ms                       |       1 (59 ms) |       1 (63 ms) |
| Maximum main / all-pass draw submissions    |       232 / 372 |       224 / 224 |
| Maximum main-scene triangles                |         163,534 |         161,062 |
| Maximum estimated GPU bytes                 |      20,745,816 |      12,357,208 |
| Worker RPC p95                              |          492 ms |        493.6 ms |
| Worker processing p95                       |        481.7 ms |        487.2 ms |
| Worker delta preparation p95                |          2.6 ms |          2.6 ms |
| Main-thread delta application p95           |          0.2 ms |          0.2 ms |
| Worker-side postMessage call p95            |            4 ms |            4 ms |
| Main-thread save JSON encoding p95          |            0 ms |          0.1 ms |

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
The September 29 profile below supersedes this sample for the current code.
Hardware and fixture placement differ, so the two runs are not a controlled
before/after comparison.

## 2026-09-29 final Three.js qualification

Machine: Intel N150, 15.4 GiB RAM, Linux 6.12.107+deb13-amd64, Node 26.10.0,
Chromium 149.0.7827.55. ANGLE uses Vulkan 1.4.305 on Intel Graphics (ADL-N,
0x46D4), Mesa. This is hardware rendering with `WORLD_ANGLE=vulkan`.

The isolated production run uses the same seed, entity/pod/rail counts, viewport,
five-second warm-up and twelve-step camera/build route described above. Storage
placement was corrected to clear the current elongated factory footprint; pods
are added after topology creation. Real traffic, worker publications and autosave
remain active. No competing browser, build or test workload ran during the profile.
Raw samples: [world-performance-results.json](world-performance-results.json).

| Measure                                  |        Standard |             Low |            High |
| ---------------------------------------- | --------------: | --------------: | --------------: |
| Frames / elapsed                         | 3,609 / 64.60 s | 3,602 / 63.36 s | 3,556 / 65.32 s |
| p95 frame interval                       |         33.3 ms |         16.8 ms |         33.3 ms |
| Mean frame interval                      |        17.89 ms |        17.59 ms |        18.37 ms |
| Assets/shaders/frame ready after entry   |       11,256 ms |       11,635 ms |       12,088 ms |
| Maximum local feedback upper bound       |         77.8 ms |         42.9 ms |         80.2 ms |
| Long tasks (≥50 ms) / maximum            |       8 / 77 ms |       2 / 78 ms |      12 / 73 ms |
| Maximum main / all-pass draw submissions |       251 / 425 |       251 / 251 |       251 / 431 |
| Maximum main-scene triangles             |         182,778 |         182,778 |         183,066 |
| Maximum estimated GPU bytes              |      22,616,264 |      14,227,656 |      47,782,024 |
| Worker RPC p95                           |      1,040.8 ms |        962.5 ms |      1,164.0 ms |
| Worker processing p95                    |      1,009.4 ms |        941.0 ms |      1,135.8 ms |
| Worker delta preparation p95             |          5.9 ms |          6.9 ms |          6.5 ms |
| Main-thread delta application p95        |          0.3 ms |          0.3 ms |          0.4 ms |
| Worker-side postMessage call p95         |         12.3 ms |         12.5 ms |         13.5 ms |
| Main-thread save JSON encoding p95       |          0.1 ms |          0.1 ms |          0.0 ms |
| Completed ADVANCE requests / second      |      142 / 2.20 |      159 / 2.51 |      131 / 2.01 |
| Completed SAVE requests                  |               7 |               8 |               6 |
| Browser page errors                      |               0 |               0 |               0 |

Timings use the same definitions as the archived run; p95 is the sorted sample at
floor(count × 0.95). Publication rates count completed ADVANCE RPCs during the
measurement window. Long-task durations are browser-rounded: the numbers strictly
above 50 ms are 5, 2 and 11 respectively. Ready time includes entering the loaded
500-entity session and preparing the renderer, not just fetching model files.

### Budget disposition

- **Frame pacing:** Low is close to the 16.7 ms interval for 60 FPS at p95;
  Standard and High miss that interval at p95. Mean pacing also exceeds 16.7 ms
  in every mode. This is not a stable 60 FPS claim on this machine.
- **Local feedback:** the conservative two-frame bound remains below 100 ms in
  every sample. Standard/High exceed 50 ms. These bounds do not measure the time
  to receive an authoritative worker result; the RPC figures show longer waits.
- **Main-thread work:** every quality mode has tasks exceeding the original
  50 ms routine-task budget. No blanket pass is claimed.
- **Publication cadence:** 2.01–2.51 completed ADVANCE requests/s misses the
  10/s target. The scheduler allows one advancement in flight and prioritizes
  validation intent. Worker processing remains the dominant measured RPC cost;
  skipping dispatch searches without idle pods or unmet demand does not remove
  this bottleneck throughout the route.
- **Draw submissions:** all modes exceed the original 200-main target by 25.5%.
  Standard/High exceed 350 total by 21.4%/23.1%; Low stays below the total target.
  The earlier proposed 240/400 budget would also fail for Standard/High and is
  not adopted. Chunk/material/LOD batching needs further optimization.
- **Initial readiness:** this populated fixture takes 11.3–12.1 seconds on the
  N150. The lighter cold-start scenario below should not be substituted for it.

These are documented exceptions completing the requested qualification record,
not approved changes to acceptance budgets. Strict performance acceptance remains
unmet. The archived Windows result cannot establish the size of a regression or
improvement on this different CPU/GPU.

### Assets, lifecycle and large-world evidence

GPU allocation estimates count unique geometry/index/instance buffers,
framebuffers and shadow targets; they are not driver VRAM measurements. Asset
validation passes for 23 assets, 69 GLBs and 23 thumbnails, 4,376 total LOD0
triangles and 1.22 MB uncompressed. The loading comparison includes all 69 GLBs,
connected straight/corner/junction rails and three exterior station/depot hookups.
Eight representative assets were captured at each of three LODs.

Separate September 28 qualification used a cold cache, 20 Mbps and 100 ms network
latency: first frame 997 ms; required assets ready 3,348 ms; transferred bytes
1,183,240. Twenty world/editor switches retained 38 geometries, 3 textures and
11,633 scene objects. Five isolated renderer world reloads retained 32 geometries,
3 textures and 18 scene objects. These counts describe different fixtures.
Forced WebGL context restoration retained the validated ghost and visible minimap.

The 1024 × 1024 starter fixture reached first frame in 3,465 ms and readiness in
4,352 ms. Both metrics samples below were collected after readiness:

| View | Main / total calls | Main / total triangles | Scene objects | Estimated GPU bytes |
|---|---:|---:|---:|---:|
| Working | 34 / 55 | 7,448 / 15,908 | 3,430 | 21,575,032 |
| Overview | 952 / 983 | 235,716 / 248,520 | 3,428 | 21,482,816 |

The overview is a separate visibility stress case outside the working-view
call budget. There is no object per logical tile.

Visual qualification: 390 px viewport / 390 px document width, sampled minimum
text contrast 7.29:1 and control-border contrast 3.74:1. The model gallery covers
23 assets, three LODs and four rotations. Waiting/output-blocked factory fans and
a drill with full output remain stationary with decorative motion enabled.
See [world-qualification-results.json](world-qualification-results.json),
[world-renderer-review-results.json](world-renderer-review-results.json),
[world-model-review-results.json](world-model-review-results.json),
[world-integration-review-results.json](world-integration-review-results.json)
and the [capture index](visual-baselines/world/README.md).

### Reproduction

Run sequentially without another browser workload using the GPU. Keep the preview
server running in a separate terminal while running the capture scripts:

    npm run build
    npx vite preview --host 127.0.0.1 --port 4173

    node scripts/world-fixture.mjs
    node scripts/world-fixture.mjs --visual
    node scripts/world-fixture.mjs --large
    node scripts/world-performance.mjs
    node scripts/world-qualification.mjs
    node scripts/world-integration-review.mjs

On Linux, `WORLD_ANGLE=vulkan` selects the backend used for the current profile;
the browser process must have GPU render-device access and a working Vulkan
driver. The helper defaults to D3D11 on Windows. Always inspect the reported GPU
before treating a result as hardware-rendered.

### Intermittent browser out-of-memory reports

`scripts/world-memory.mjs` samples browser page heap and DOM metrics, renderer
canvas CSS/backing dimensions and DPR, WebGL context state, scene allocation
estimates, and Chromium renderer/GPU process memory once per second. It keeps
the world worker and periodic save active. This helps distinguish JavaScript
heap growth from renderer-process or GPU-process growth; process RSS is not a
measurement of dedicated VRAM, and `worldStats.estimatedGpuBytes` is an estimate
rather than a driver reading.

Run it on the affected machine with the same browser and display setup where the
crash occurs. Start the production preview in a separate terminal, then collect
at least one two-minute sample for each fixture/quality combination you want to
compare. Output goes to stdout unless a new report path is supplied; an existing
report is never overwritten.

    node scripts/world-memory.mjs --browser-channel chrome --duration-ms 120000 --quality high --output /tmp/world-memory-high.json
    node scripts/world-memory.mjs --browser-channel msedge --duration-ms 120000 --fixture world-large-v1 --quality high --output /tmp/world-memory-large.json

Set `--viewport` and `--device-scale-factor` to match the affected display; the
defaults are 1366 × 768 and DPR 1. Use `WORLD_URL` to target a different preview
URL and `WORLD_ANGLE` to select a graphics backend where supported. Compare heap,
per-process RSS/private bytes, canvas backing pixels, context loss and renderer
estimates at the time of failure. If the browser crashes before the sample ends,
the report records page crash/disconnect events and retains the preceding
samples. A browser-internal GPU memory counter or operating-system GPU diagnostic
is still needed to attribute dedicated VRAM exhaustion.

The renderer, command and model review scripts use the development server on 5173.
Production build warnings about chunks above 500 kB remain informational; Three.js
and the model pack load when entering the world workspace.

The 2026-09-30 investigation of excessive browser and worker overhead is recorded
in [performance-fix-2026-09-30.md](performance-fix-2026-09-30.md), with its isolated
CPU profile in [world-cpu-profile-2026-09-30.json](world-cpu-profile-2026-09-30.json).
