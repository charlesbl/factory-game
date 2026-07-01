# Stage 02 — Migrate the project to international English

## Mission

Translate and standardise the entire project in clear international English
before the architectural rewrite expands its vocabulary. This includes
user-facing text, source identifiers, comments, diagnostics, data labels, tests,
and developer documentation.

English becomes the canonical source language. This stage does not introduce a
multi-language localisation framework, but it must avoid choices that would make
one difficult to add later.

## Language standard

Create `docs/language-guidelines.md` and define these rules:

- use clear international English and avoid region-specific idioms;
- use consistent technical terms from `factory-graph-design.md`;
- prefer `factory`, `machine`, `recipe`, `resource`, `item`, `input`, `output`,
  `buffer`, `rate`, `throughput`, `footprint`, and `work in progress`;
- use ISO 8601 for machine-readable dates and locale-aware formatting for displayed values;
- use sentence case for headings, buttons, and diagnostics;
- keep stable technical IDs language-neutral and never translate persisted IDs;
- set the document language to `en` unless a more specific locale is genuinely required.

## Scope

Translate or rename:

- all visible React text, button labels, empty states, errors, and tooltips;
- machine, recipe, and item display names in JSON data;
- TypeScript classes, methods, variables, interfaces, comments, and logs that use French or misspelled English;
- file and directory names such as the misspelled `Ressources` naming;
- CSS identifiers only where they contain French or misleading terminology;
- test names, fixtures, snapshots, and E2E selectors;
- README files and developer documentation not already translated;
- HTML metadata, manifest descriptions, and accessibility labels.

## Persistence and compatibility rules

- Do not translate stable item, recipe, machine, factory, contract, or save IDs.
- Do not rename serialised fields without a versioned migration and regression fixture.
- Display names may change while IDs remain stable.
- If source property names stored directly in old saves must change, accept both old
  and new names during migration and write only the new schema afterwards.
- Do not invalidate existing local saves merely to improve terminology.

## Work

1. Add the language guideline and an approved terminology table.
2. Inventory non-English and misspelled strings with `rg`, including accented characters.
3. Translate all user-facing strings and accessibility labels.
4. Translate display names in resource JSON while preserving IDs.
5. Rename French or misspelled source symbols and files using refactor-safe changes.
6. Replace free-form console messages with consistent English wording.
7. Update tests, snapshots, imports, save adapters, and documentation links.
8. Set `<html lang="en">` and review the web manifest and metadata.
9. Add a lightweight automated check for known French UI phrases and prohibited legacy spellings.
10. Load representative old saves and verify that IDs and quantities remain unchanged.

## Required tests

- the complete application builds after file and symbol renames;
- all main screens have English text in Playwright snapshots or assertions;
- old save fixtures still load;
- data IDs are identical before and after the migration;
- no known French UI phrase remains under `src` or `public`;
- no import references a renamed legacy path;
- accessibility names are meaningful English, not raw IDs.

## Acceptance criteria

- All Markdown documentation, source code, comments, tests, data display names,
  metadata, and visible UI use international English.
- Stable identifiers and existing save compatibility are preserved.
- `Ressources` and other known misspellings no longer appear in active source paths or identifiers.
- `docs/language-guidelines.md` is the canonical terminology reference.
- `npm run check` and `npm run test:e2e` pass.
- A repository-wide search finds no unexplained French user-facing text.

## Out of scope

- Runtime language switching.
- Translation catalogues for additional languages.
- Gameplay or visual redesign.
- Renaming externally published URLs unless separately approved.

## Required handover

List renamed files and public symbols, translated data sets, compatibility
migrations, intentionally retained non-English proper nouns, and validation results.

