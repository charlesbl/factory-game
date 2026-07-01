# Stage 01 — Modernise the toolchain

## Mission

Move the project to a modern, reproducible foundation without changing gameplay
rules. At the end of this stage, the existing application must run on React 19,
TypeScript 6, Vite 8, ESLint 10, and Vitest 4.

## Reference state

The project currently uses React 18, TypeScript 4.8, Vite 3, and an outdated
ESLint stack. The versions below were retrieved from npm on **1 July 2026**.

Before implementation, rerun `npm view` for every package. If a newer stable
version exists and all peer dependencies remain compatible, use that version and
update this table.

### Runtime

| Package | Reference stable version |
|---|---:|
| `react` | `19.2.7` |
| `react-dom` | `19.2.7` |
| `use-local-storage-state` | `19.5.0` |
| `web-vitals` | `5.3.0` |

### Toolchain and quality

| Package | Reference stable version |
|---|---:|
| `typescript` | `6.0.3` |
| `vite` | `8.1.2` |
| `@vitejs/plugin-react` | `6.0.3` |
| `@types/react` | `19.2.17` |
| `@types/react-dom` | `19.2.3` |
| `@types/node` | `24.13.2` — latest branch matching the Node 24 runtime |
| `eslint` | `10.6.0` |
| `@eslint/js` | `10.0.1` |
| `typescript-eslint` | `8.62.1` |
| `eslint-plugin-react-hooks` | `7.1.1` |
| `eslint-plugin-react-refresh` | `0.5.3` |
| `globals` | `17.7.0` |
| `vitest` | `4.1.9` |
| `fast-check` | `4.8.0` |
| `@fast-check/vitest` | `0.4.1` |
| `@playwright/test` | `1.61.1` |

Use **Node.js `24.18.0` LTS** and npm `11.18.0`. Add `engines`,
`packageManager`, `.nvmrc`, and `.node-version`. Save dependency versions exactly,
without `^` or `~`, to make installations reproducible.

## Packages to remove

Remove these packages instead of attempting to retain their old configuration:

- `@typescript-eslint/eslint-plugin`, replaced by the unified `typescript-eslint` package;
- `eslint-config-standard-with-typescript`;
- `eslint-plugin-import`;
- `eslint-plugin-n`;
- `eslint-plugin-promise`;
- `eslint-plugin-react`, whose latest stable version does not declare ESLint 10 compatibility;
- `vite-plugin-eslint`, which is unnecessary when linting is a separate verification command.

## Work

1. Correct the package name to `factory-game`.
2. Set the Node and npm versions and add an `engines` section.
3. Replace dependencies with their latest compatible stable versions using `--save-exact`.
4. Recreate `package-lock.json` with the selected npm version. Do not edit it manually.
5. Migrate the Vite configuration to Vite 8.
6. Move TypeScript to a strict configuration compatible with TypeScript 6 and React 19.
7. Replace the historical ESLint setup with an `eslint.config.js` flat configuration.
8. Fix compilation and lint errors caused by the upgrades without refactoring gameplay.
9. Configure Vitest with a Node environment for future domain tests.
10. Add one minimal smoke test for an existing pure function.
11. Configure Playwright and a smoke test that opens the home page. Download Chromium only.
12. Add `typecheck`, `lint`, `test`, `test:watch`, `test:e2e`, `build`, and `check` scripts.
13. Update the Dockerfile and any CI configuration to Node 24.

## Expected scripts

`npm run check` must explicitly run type checking, linting, unit tests, and the
production build in that order. Keep E2E tests separate so Chromium is not
required for every local verification.

## Files likely to change

- `package.json`
- `package-lock.json`
- `vite.config.ts`
- `tsconfig.json`
- `tsconfig.node.json`
- `eslint.config.js`
- `vitest.config.ts` if not integrated into Vite
- `playwright.config.ts`
- `.nvmrc`
- `.node-version`
- `Dockerfile`
- source files requiring compatibility-only changes

## Acceptance criteria

- `node --version` reports Node 24 LTS.
- `npm install` produces no peer-dependency errors.
- `npm outdated` reports no outdated direct dependencies at implementation time.
- `npm run check` passes.
- `npm run test:e2e` passes with Chromium.
- Existing application behaviour is preserved.
- The application emits no React warnings about keys, effects, or deprecated APIs on load.
- The lockfile is committed and installation is reproducible.

## Out of scope

- New factory model.
- React Flow, GLPK, or IndexedDB.
- Visual redesign.
- Gameplay changes not required by the upgrade.

## Required handover

Report the installed versions, removed packages, compatibility problems,
source adaptations, and the result of every validation command.

