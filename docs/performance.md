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
