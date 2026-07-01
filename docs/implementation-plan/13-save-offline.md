# Stage 13 — Save, migrate, and simulate offline

## Mission

Replace monolithic local persistence with versioned storage supporting blueprints,
shared contracts, and many instances while retaining legacy saves.

## Dependency

The stable version recorded on 1 July 2026 is `dexie@4.4.4`. Check the latest
stable version before installation and save it exactly. At the end of migration,
remove `use-local-storage-state` if it has no remaining consumers, then rerun
`npm outdated`.

## IndexedDB schema

Minimum logical tables:

- `metadata`: format, last save, and logical clock;
- `blueprints`: editable revisions;
- `contracts`: cache addressed by hash;
- `instances`: compact runtime state;
- `inventories`: world buffers;
- `dependencies`: parent/child relationships if they are not cheap to rebuild.

Give each record its own schema version where useful. Contracts may be deleted and
recompiled; blueprints and instance state are authoritative.

## Serialisation

- encode `bigint` values as decimal strings;
- do not silently ignore unknown critical fields;
- validate all data on load;
- write in an atomic transaction;
- retain a recovery backup before a destructive migration;
- never round phases or time.

## Legacy save migration

1. Detect the current localStorage format.
2. Load it through legacy classes or a dedicated parser.
3. Create an explicit migration blueprint.
4. Preserve integer items; report unrepresentable legacy fractions as controlled, tested migration debt.
5. Delete the old save only after successful validation and IndexedDB commit.
6. Provide versioned JSON export and import.

## Recompilation with WIP

Use explicit migration:

- retain reserves whose resource and role remain compatible;
- put instances with incompatible reserves into `MAINTENANCE`;
- provide an explicit action to finish under the old contract or convert residue through a recycling/waste recipe;
- never return a whole item automatically from a fraction;
- apply the same rule to dismantling.

## Offline simulation

1. Calculate logical duration since the last save.
2. Advance event by event while below a processing budget.
3. Use grouped calculation only when supply, capacity, and destinations remain constant and equivalence is tested.
4. Stop cleanly on missing input or full output.
5. Never replay missed frames or ticks.

## Required tests

- complete round-trip of blueprints, contracts, instances, and WIP;
- migration fixture for every legacy version;
- simulated interruption during a transaction;
- missing contract recompiled on load;
- export then logically byte-identical import;
- offline progress equivalent to event-by-event advancement;
- contract change with compatible and incompatible reserves;
- no material creation during dismantling.

## Acceptance criteria

- A valid legacy save migrates without silent loss.
- Reloading changes no phase, material, or next logical event.
- A long absence causes no per-tick traversal.
- Corruption produces a message and recovery option, never a silently empty game.
- `use-local-storage-state` is removed when unused.
- `npm run check` and migration tests pass.

## Out of scope

- Cloud synchronisation.
- Multiplayer.
- Server-side saves.

