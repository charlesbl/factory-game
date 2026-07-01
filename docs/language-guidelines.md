# Language guidelines

Factory Game uses clear international English in source, documentation, data,
diagnostics, and interface text. Headings, controls, and diagnostics use sentence
case. Stable persisted IDs are language-neutral and are never translated.

| Preferred term | Meaning |
|---|---|
| factory | An editable blueprint or compiled world actor |
| machine | A node executing one fixed recipe |
| recipe | Exact coupled input and output quantities |
| resource | A typed material transported inside a graph |
| item | One integer unit in the world |
| buffer | Finite integer world storage |
| rate / throughput | Items per second |
| footprint | Occupied integer-grid rectangle |
| work in progress (WIP) | Bounded fractional state inside a compiled instance |

Machine-readable dates use ISO 8601. Displayed values use locale-aware formatting.
Accessibility names describe actions rather than exposing raw IDs.
