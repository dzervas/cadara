# AGENTS

CADara is a browser-native parametric CAD app: Bun, React 19, TypeScript strict, Vite, Mantine, Tailwind v4, Three.js through `@react-three/*`, OpenCascade (WASM), Automerge.

## Environment

Tooling comes from PATH. `devenv shell` (or direnv) provides Bun, Playwright's chromium and fonts. Without devenv: install the Bun version in `package.json` `packageManager` and run `bunx playwright install chromium` once. Every checkout or jj workspace needs its own `bun install --frozen-lockfile`.

`@playwright/test` is pinned exactly to devenv's Playwright version. Change both together (see the `"//"` note in `package.json`).

## Where things live

| What | Where |
| --- | --- |
| Domain terms | `GLOSSARY.md` |
| Product intent, users, design principles | `PRODUCT.md` (read before UI/UX work) |
| Visual design system | `DESIGN.md` (+ generated `DESIGN.json`); icons: `src/assets/icons/DESIGN.md` |
| Architecture decisions | `docs/adr/NNNN-*.md` |
| How a subsystem works | `docs/architecture/` |
| Living how-to guides (testing, debug platform, Discord) | `docs/*.md` |
| Dated research notes | `docs/research/` |
| Finished plans and spikes (historical, not authoritative) | `docs/archive/` |
| Task playbooks | `.agents/skills/` |
| CLI and SDK docs (shipped in the CLI package) | `src/cli/*.md` |
| Work tracking | beads (`bd`) |

New docs go in the matching row. Files live in the repo, so links point only at tracked paths. `.scratch/` is private scratch space and is never linked.

### Source layers

`docs/adr/0001-layered-runtime-boundaries.md` defines the layers; `test/static/` enforces them.

- `src/contracts`: schemas, contract types, Typia runtime validation.
- `src/core`: pure logic (tools in `src/core/tools`, sketch constraints, feature authoring).
- `src/application`: orchestration; the TEA-style editor event loop is `src/application/editor/editor-event-loop.ts`.
- `src/infrastructure`: browser, worker, storage, OCC and rendering adapters.
- `src/components`, `src/hooks`, `src/workbench`, `src/theme`: UI. Mantine theme lives in `src/theme/workbench-theme.ts`.
- `src/domain`: legacy mix still being migrated out; put new code in the layers above.

## Rules

- Exceptions bubble to the error handling path (`reported-error-boundary`) or are handled with a visible outcome; every catch does one of the two.
- UI: Mantine components and theme tokens first, Tailwind for layout glue, minimal custom CSS. Keep the dense dark CAD feel.
- Presentational components stay free of scene logic, event contracts and event-loop concerns.
- Keep files under 2000 lines and 50 KB so they fit one read; `test/static/file-size-budget.spec.ts` enforces it.
- Name files after what they contain (`sketch-constraint-registry.ts`, not another `registry.ts`), never after the project phase that produced them. Rename when you touch a file anyway.
- Comments state the invariant or the reason in words a reader without the tracker understands; ticket IDs and evidence paths belong in the commit message.

## Testing

1. Read `docs/testing.md` before any test-related edit.
2. Before editing tests, state the lane (`logic`, `ui`, `e2e`, `static`), the seam under test and why that lane fits.
3. In the final response, confirm `docs/testing.md` was reviewed, the lane used and the seam covered.

Vitest runs through `bun run test`, never `bun test`. Run `bun run test` (about a minute) while working and before handing off. Add the slower lanes your change calls for, chosen with the table in `docs/testing.md` (Choosing validation lanes); `bun run test:all` is for changes that cross several of those areas.
