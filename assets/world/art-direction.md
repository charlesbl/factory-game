# World pack 1.0.0

The selected composition is `concepts/world-v1.png`: a bright, matte industrial
diorama, sage ground, cream factory shells, teal machines, graphite foundations,
copper extraction equipment and amber service equipment. The five exact prompts
and references are checked in beside this file; provenance records their origin.
These pictures are references, not playable assets. The factory reference's text
and vertical fan are omitted: production uses a horizontal roof fan. The HUD
reference's invented inventory and power totals are omitted. Mine heads remain
outside deposits. Logical terrain is flat, and rails never create a bridge.

## Runtime contract

`public/assets/world/manifest.json` has schema version 1; the content pack version
is independent of worker protocol 3 and existing gameplay/save schemas 1/2.
Every entry identifies an original recipe and editable `.blend`, a tile footprint,
centred ground pivot, +Z front, bounds, animation bounds, named sockets, moving
parts, three LODs and one thumbnail. Each LOD carries its content SHA-256, URL,
byte size, measured triangles, material count and bounds. Runtime URLs respect
Vite's base path. `assets:validate` is the executable manifest/GLB contract.

One metre equals one tile. Runtime axes are +X east, +Y up, +Z south. Blender
authors Z-up and exports Y-up once. A quarter turn follows the grid convention
and rotates by minus pi/2 in Three.js. Footprints, occupancy and eligibility come
from gameplay; sockets indicate visuals, not independent docking rules.

All geometry is original and defined by `recipes/pack-v1.json`. Static parts merge
into `body`; `fan`, `drill_head`, `cargo` and `trolley` retain their authored transforms.
Materials use vertex colours, matte PBR and no textures. There are no lights,
cameras, animation clips or compression extensions in the exports. Unused UVs
are omitted. Exported floats are quantized to 1e-5 to eliminate bevel rounding
noise; PNG render timestamps are stripped before hashing.

Factory shells fit the accepted rectangular footprint. Walls repeat along the
perimeter, with fixed loading faces and mechanical details, fewer bays at LOD1
and a simple shell at LOD2. Roof bays remain fixed in size. Internal factory
machines remain represented by the existing factory actor and graph editor.

`hookup-crane` and `hookup-marker` are decorative 1 × 1 overlays for a
station/depot hookup cell and never imply occupancy. They follow the rail-prop
footprint semantics (`footprint` 1 × 1, `policy` `fixed`), author front +Z away
from the building, and pivot at the hookup cell's ground-centred tile. The crane
is graphite `#3D4B50` with amber `#D9B45F` service accents: a mast on the
building side (-Z) rising to 1.28 m with a 1.35 m arm cantilevered over the
origin and a `trolley` hook above the cell centre (`socket_hook` at 0.78 m).
The marker is a flat 0.9 × 0.9 m graphite rail-stop plate with an amber stop bar
toward +Z, 0.058 m tall (`socket_stop` at the plate centre).

Ground pivot rule: every GLB's geometry starts at Y = 0 within 0.001 m.
`terrain-surface` is the single exception by design: it is the ground slab and
must span Y -0.18 to 0 so its top face sits flush with the ground plane.

## LOD1 budget exceptions

LOD1 must use at most 40% of an asset's LOD0 triangles. The table below is the
single source of truth for documented exceptions: `validate_world_assets.mjs`
parses it and requires the recorded counts to match the measured triangle counts
exactly. Assets absent from the table are enforced at 40%.

| asset | lod0 | lod1 | reason |
|---|---:|---:|---|
| hookup-marker | 24 | 12 | The flat 0.9 m plate is a single 12-triangle slab and cannot be split; the amber stop bar is LOD0-only. The 24-triangle prop cap leaves no budget to raise LOD0 above the 12/24 ratio. |
| rail-arrow | 36 | 36 | The shaft plus two rotated barbs are the minimal three-box arrow glyph; dropping either barb leaves a directionless dash. |
| rail-corner | 60 | 48 | Four rail arms preserve both continuous inner and outer tracks of the elbow at every LOD. The corner pad is LOD0-only. |
| rail-straight | 48 | 24 | The two 12-triangle rails are the minimal rail silhouette; ties are LOD0-only. |
| terrain-rock | 40 | 20 | The coarsest icosphere is 20 triangles; the remaining single boulder is the silhouette and cannot be reduced further. The small chunk is LOD0-only. |
| terrain-surface | 12 | 12 | A single 12-triangle ground slab has no lower representation. |

## Rebuild and review

Blender **4.5.0**, build `8cb6b388974a`, is pinned. Set `BLENDER_PATH` to its
executable, or use the wrapper's documented local portable installation path.

```
npm run assets:build
npm run assets:preview
npm run assets:validate
npm run assets:build -- --asset factory
npm run assets:build -- --output-root benchmarks/generated/clean-assets
npm run assets:preview -- --output-root benchmarks/generated/clean-assets
node scripts/assets/validate_world_assets.mjs benchmarks/generated/clean-assets/public/assets/world
```

Normal development and production builds use the checked-in runtime pack without
Blender. The clean rebuild on 2026-09-27 matched all 63 GLB and 21 thumbnail
hashes; the 2026-09-28 hookup/LOD-budget rebuild matched all 69 GLB and 23
thumbnail hashes between its scratch and clean runs.
The validator measured 4,352 LOD0 triangles across 23 assets and 1.22 MB for the
full uncompressed runtime pack. Thumbnails use Cycles, 16 samples, 256 square,
orthographic scale 6.3, fixed lighting and transparent backgrounds.

Open `/?asset-gallery` for production lighting, footprint bounds, socket markers,
LOD selection, quarter turns and camera presets. Review captures live in
`docs/visual-baselines/world`. Construction progress is accepted material delivery,
factory activity uses reported actor state, and drill motion uses actual
extraction events. Reduced motion freezes decorative parts, not logistics state.
