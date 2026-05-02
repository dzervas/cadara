# AGENTS

## Design Context

Strategic design context lives in `PRODUCT.md` at the project root — register, target users, brand personality, anti-references, and design principles. Read it before any UI/UX-shaping work. Key load-bearing principles: interop is identity, visible tools beat hidden tools, treat hobbyists as professionals, browser-native is invisible, density-but-readable. Reference for feel: Plasticity (with tools kept visible). Anti-references: SolidWorks, FreeCAD, Rhino, TinkerCAD, generic SaaS dashboards.

## Stack

- Runtime/package manager: Bun
- App framework: React 19 + TypeScript
- Bundler/dev server: Vite on port `3000`
- UI primitives: Mantine as the primary shell component library
- Styling: Mantine theme tokens first, Tailwind CSS v4 for layout glue, minimal custom CSS
- 3D viewport: Three.js

## Interface Overview

- Top toolbar: icon-only CAD tools with tooltips, search, undo/redo on the left, mode-aware tool switching between `part` and `sketch`, and dropdown support for tool families like pattern variants.
- Left sidebar: feature tree at the top and parts/objects at the bottom, both kept visually compact for dense CAD-style navigation.
- Main viewport: Three.js canvas with an XY grid, three perpendicular reference planes (`XY`, `YZ`, `XZ`), right-click rotate, middle-mouse pan, and a clickable view cube overlay for fast camera orientation changes.

## Important Architecture

- Tool definitions live in `src/domain/tools/` and are the source of truth for ids, groups, icons, modes, and dropdown families.
- Tool/group hooks are strongly typed through `ToolActionBus`; clicking a tool dispatches the group event first and the tool event second.
- UI components live under `src/components/`; tool logic, schemas, and scene helpers stay in `src/domain/` and `src/hooks/`.
- `ToolActionProvider` supplies the current mode and the shared action bus to the UI.
- Mantine theme configuration should live in a central theme module with an easily editable dark-first colors tuple as the source of truth for shell chrome.
- Prefer Mantine components and theme overrides over bespoke UI wrappers, long Tailwind class stacks, or custom shell CSS.
- NEVER silence unhandled exceptions. They must either bubble up and handled by the error handling component or handled gracefully

## Current Behavior Rules

- All toolbar actions currently `console.log` through subscribers installed in the workbench.
- Entering sketch mode is triggered by the `Sketch` tool.
- Returning to part mode is triggered by `Finish Sketch`.
- Keep UI, domain definitions, and future CAD behavior split cleanly; do not mix scene logic or event contracts into presentational components.
- Preserve the dense dark CAD-style feel, but prefer fewer lines of code over decorative eye candy when the behavioral contract stays the same.

## Active Technologies

- TypeScript strict mode on React 19 + React 19, Vite 8, Bun, Three.js, Mantine, Tailwind CSS v4, OpenCascade.js
- Always prefer @react-three packages to interact with three.js (@react-three/drai, @react-three/fiber, etc.)
- Runtime contract validation uses `zod`; prefer shared schemas for transport and persistence boundaries, and keep domain invariants in plain TypeScript when schemas do not make the code smaller or clearer.
- Stateful editor/runtime orchestration uses the TEA-style `EditorEventLoop`; keep orchestration logic in domain/contracts and application seams, and avoid leaking event-loop concerns into presentational components.
- Non-E2E tests use `bun:test`; add or update `.spec.ts` / `.spec.tsx` coverage with the smallest possible structural change instead of introducing another unit test runner.

## Testing Policy

1. Read `docs/testing.md` in the current turn before making any test-related edit.
2. In a `commentary` update before editing tests, state:
   - the chosen lane: `logic`, `ui`, `e2e`, or `static`
   - the seam being tested
   - why that lane is correct under `docs/testing.md`
3. Only then edit or add tests.
4. In the final response, explicitly confirm:
   - `docs/testing.md` was reviewed
   - which lane was used
   - what seam the test covers

## Validation

After a set of changes, run `bun run test:all`
