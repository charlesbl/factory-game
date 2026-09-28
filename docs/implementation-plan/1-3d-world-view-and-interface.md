# Priority 1 — Final qualification of the 3D world and interface

Status as of 2026-09-28: the Three.js implementation is in place; final 1F/1G qualification remains open.

This plan contains only unfinished work. Completed implementation, migration, and acceptance work has been removed. Automated test work is omitted as requested.

## Remaining work

### 1. Refresh the production performance profile

Run the isolated production-browser profile after the 2026-09-28 rail and lifecycle corrections. Use the existing 256 × 256 fixture (500 entities, 200 moving pods, 2,000 rail cells) and fixed camera/build route. Record Standard, Low, and High results in [performance.md](../performance.md) and refresh its raw report.

Resolve or explicitly document the outstanding budget exceptions from the previous sample: main-thread tasks above 50 ms, the 10 publications/s target, and draw calls above the original 200/350 targets. Compare frame pacing and interaction feedback with their stated budgets.

Refresh the 1024 × 1024 overview measurement and capture after renderer readiness reports its final metrics. The current working-view evidence predates that readiness correction.

### 2. Keep station/depot hookups visible and prevent rails from crossing buildings

The 3D hookup crane and marker already exist. Preserve and qualify them as the clear connection point for each Station and Depot. The marker plate itself must sit fully outside the rotated building footprint, beside the exterior on the rail-connection side, aligned with the hookup cell used by the worker; it must never appear inside or overlap the building volume. The crane arm may reach from the building to this exterior marker. Keep the marker clearly readable at normal zoom.

Add rail-path clearance validation against occupied building cells. Check every cell traversed by each orthogonal segment, including segments whose endpoints are outside the building. Apply the same rule to the placement preview and the worker's final command so no new rail can pass through any building footprint. A Station or Depot may be connected only at its external hookup cell. Keep a rejected draft editable and show why it was rejected.

### 3. Check model fidelity after loading and during LOD changes

Compare representative production models at the same camera and zoom before and after asset loading, then inspect them at close, normal, and overview distances as LOD changes. Include straight rails, turns, junctions, and station/depot hookups.

Confirm that loading or LOD selection does not replace a detailed model with the wrong or incomplete shape. Rails must remain continuous and recognisable; a reduction in detail at distance is acceptable only when the intended LOD preserves their silhouette and connection geometry. If the reported loss of detail reproduces, correct the asset selection, LOD transition, or model assembly and capture the before/after result.

### 4. Refresh final ready-state captures

Regenerate the primary production captures that predate the 2026-09-28 interface and rail changes. Cover the normal world view, close/normal/overview cameras, desktop and narrow HUD, construction, blocked traffic, and valid/invalid previews. Include a valid rail connection at a station/depot hookup, showing the marker beside and outside the building; a rejected rail crossing through a building; and the representative models after loading at the tested LODs. Keep the already refreshed rail-action and station/depot hookup captures. Update the [capture index](../visual-baselines/world/README.md).

### 5. Finish the remaining in-app acceptance flows

- Select and open a placed factory that differs from the catalogue selection, edit its blueprint, verify the placed instance stays unchanged, then explicitly replace it and review the footprint, cost, and recovery confirmation.
- Show a factory waiting on input or blocked on output, and a drill whose mine output is full. Confirm machinery animation stops and the inspector reports only the state the worker knows.

### 6. Close the 1F/1G qualification record

After the items above, record the final gate status and any accepted performance exceptions here and in the performance report.