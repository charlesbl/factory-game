# Stage 16 — World domain and procedural generation

## Mission

Create the authoritative, deterministic spatial world on which every later
worldview system depends.

## Implementation

1. Add branded IDs for worlds, entities, stations, rail nodes and edges, blocks,
   pods, deliveries, and construction sites.
2. Define current-schema `WorldGenerationConfig`, `GeneratedWorld`, world entity
   unions, compact grid arrays, snapshots, and canonical serialized forms.
3. Generate a finite 256 × 256 map in the world worker with the versioned integer
   PRNG and parameters accepted in ADR 0005.
4. Create obstacle regions, clear the start zone, grow three finite iron and
   copper patches, and guarantee one reachable patch of each resource.
5. Implement quarter-turn footprint transforms, bounds/terrain/occupancy checks,
   stable entity slots, and exact occupancy release.
6. Keep generated arrays authoritative in saves; never regenerate a loaded map.

## Tests and acceptance

- Same seed and config produce byte-identical arrays.
- Spawn and resource reachability guarantees hold over bounded generated seeds.
- Every ore quantity is an integer and only ore cells contain quantities.
- Placement rejects every overlap, obstacle, and out-of-bounds rotation.
- Serialization restores terrain, remaining ore, occupancy-relevant entities,
  generator metadata, revision, and logical time exactly.

