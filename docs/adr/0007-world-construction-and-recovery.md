# ADR 0007: World construction, mining, storage, and recovery

Status: accepted — 2026-07-06

## Context

World placement needs material consequences without introducing a player avatar
or a hidden personal inventory. Dismantling and cancelled construction must also
preserve the game's material-conservation guarantees.

## Decision

Each new world bootstraps with one prebuilt 500-item storage containing 200 iron
plates, 100 copper wires, and 40 circuits, plus one eight-slot depot and two pods.
This hub is the only free major infrastructure in V1.

Factories, mine heads, storage buildings, and depots begin as persistent ghosts
linked to one adjacent external station. Pods deliver their complete data-driven
bill of materials. Completion is atomic. Rails, junctions, and stations are free
in V1 so the initial network cannot deadlock its own construction.

A mine head is outside its ore patch. Drill ghosts must occupy matching ore and
connect orthogonally to the mine or another drill. The nearest constructible
ghost is completed first, followed by placement time and ID. Each active drill
produces one integer item per extraction event and removes it from its own tile.

Storage has shared finite capacity with optional per-resource limits and manual
request/provider rules. Dismantling recovers exactly the original bill of
materials. Recovery and cancelled-site buffers first serve compatible requests,
then force their remaining material to the nearest reachable storage with space.
If no destination exists, dismantling sleeps without destroying material.

A placed factory never changes because its blueprint draft changes. Replacing it
means dismantling the old instance, preserving its station, then constructing the
new version.

## Consequences

- Build costs and factory bills of materials are domain data, not UI constants.
- V1 uses the existing plate, wire, and circuit tree for its initial build costs;
  those values remain data rather than simulation constants.
- No construction, cancellation, or dismantling operation may teleport, round,
  or discard items.
