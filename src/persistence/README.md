# Persistence

Current-schema codecs, IndexedDB records, import/export, and offline advancement.
Incompatible schemas are rejected before any authoritative record is replaced;
there is no legacy migration path. The current export is save schema 4 and world
schema 2 in the dedicated `factory-game-world-v1` database.
