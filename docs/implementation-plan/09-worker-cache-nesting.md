# Stage 09 — Move compilation to a worker, cache it, and support nesting

## Mission

Make compilation non-blocking, content-addressed, and reusable by sub-factories. A
compiled sub-factory appears to its parent as an ordinary node without recursive
traversal of its graph.

## Worker protocol

Define versioned, serialisable messages:

```ts
type CompileRequest = {
  requestId: string
  blueprint: SerializedBlueprint
  childContracts: SerializedFactoryContract[]
}

type CompileResponse =
  | { requestId: string; ok: true; contract: SerializedFactoryContract }
  | { requestId: string; ok: false; diagnostics: CompileDiagnostic[] }
```

Ignore stale responses by `requestId` and revision. UI debouncing is permitted,
but an explicit compile command must start immediately.

## Cache and hash

- canonise the blueprint, recipe definitions, and child contract hashes;
- calculate SHA-256 through Web Crypto inside the worker;
- use the hash as the immutable contract key;
- reuse the same in-memory contract object when already loaded;
- never treat the cache as authoritative persistent data.

## Nesting

1. Compile dirty children first.
2. Recompile a parent only when a child's observable hash changes.
3. Maintain a reverse child-to-parent index.
4. Detect and reject recursive blueprint references.
5. Project child ports, rates, and footprint onto the parent node.
6. Retain independent caches for unaffected branches.

## Work

1. Extract a pure compilation API suitable for a worker.
2. Implement message codecs without unencoded `Map` or `bigint` values.
3. Add the worker, client, logical cancellation, and error handling.
4. Add canonisation, hashing, and a bounded memory cache.
5. Add the shared contract registry.
6. Add sub-factory nodes to the compiler.
7. Add the dependency graph and targeted upward invalidation.
8. Connect editor preview to the worker.

## Required tests

- stale response ignored after a newer edit;
- identical hash for equivalent serialisations;
- visual-only change does not affect the hash;
- two instances of one blueprint share a contract;
- child modification invalidates only ancestors;
- unchanged child contract does not invalidate the parent;
- recursive reference rejected;
- worker failure is shown without losing the blueprint.

## Acceptance criteria

- Heavy compilation does not block React interactions.
- Parent compilation reads only a child contract, never the child graph.
- The cache is bounded and exposes development metrics.
- Diagnostics return with the exact blueprint revision.
- `npm run check` and preview E2E tests pass.

## Out of scope

- IndexedDB cache persistence.
- Runtime instances.
- Distributed or server-side compilation.

