## Context

The current workbench architecture has a useful foundation: `WorkbenchApp` composes document-scoped services, `EditorProvider` owns the TEA-style editor event loop, and the modeling service remains the durable document boundary. The problem is that the human-facing module layout and React composition do not reflect those boundaries.

`src/app/workbench/cad-workbench.tsx` currently reads multiple contexts, derives view state, owns shell-local UI state, coordinates document and tab actions, performs workbench mutations, wires debug/reporting/performance bridges, and renders the full shell. Nearby `src/app/workbench/controllers/*` and `src/application/workbench/*` continue the same broad object-returning orchestration style. The 3D viewport is also coupled both by a large callback prop surface and by hidden reads from editor/runtime context.

This proposal treats the cleanup as an internal breaking architecture change. The aim is readability, ownership clarity, and safer future CAD feature work, not compatibility with the current file layout.

## Goals / Non-Goals

**Goals:**

- Make `src/app` bootstrap/composition-only and move workbench feature code behind a dedicated workbench module boundary.
- Separate workbench runtime/session composition, command/use-case orchestration, shell UI composition, and viewport integration.
- Replace aggregate "controller object soup" with named commands/use-cases and thin React adapters.
- Define an explicit 3D viewport boundary using `ViewportModel`, `ViewportIntent`, and `ViewportCommand` ports.
- Remove hidden workbench/editor context reads from viewport internals.
- Keep document, sketch, selection, command, history, and modeling mutation ownership outside the viewport.
- Add file-level ownership comments for large/convoluted files when useful, with the required `// SLOP:` prefix.

**Non-Goals:**

- Do not redesign the editor state machine or replace the existing `EditorEventLoop`.
- Do not choose Jotai, channels, or another state library as part of the proposal.
- Do not change user-facing CAD behavior as part of the architectural split.
- Do not move all UI code into a generic reusable component library.
- Do not preserve old hook, controller, or folder names if they obscure ownership.

## Decisions

### 1. Use a dedicated workbench feature module, with `src/app` as bootstrap only

The workbench should become a named feature module that owns its runtime composition, controller/actions, shell, viewport adapter, document/session helpers, history helpers, and debug integration. `src/app` should only create application-level dependencies and mount the workbench.

Alternative considered: keep the current `src/app/workbench` location and continue extracting subfolders. That preserves less churn, but it keeps reinforcing `app` as both bootstrap and feature implementation, which is the naming problem being fixed.

### 2. Split commands/use-cases from React controller adapters

Document-facing or browser-facing workbench actions should be named commands/use-cases with explicit inputs and outputs. React hooks should bind current state and callbacks to those commands rather than becoming the command implementation itself.

Alternative considered: keep adding `useWorkbench*Controller` hooks. That makes tests easy to inject but continues the pattern where ownership is hidden inside objects of callbacks.

### 3. Define the viewport as a ported subsystem

The viewport should consume a single explicit model, emit typed intents, and accept typed commands. It may internally split rendering, picking, camera, overlays, and local transient state however it needs, but it should not interpret editor runtime ownership by reading global context.

Alternative considered: pass all data through props and callbacks without formal port types. That reduces ceremony but leaves the same sprawling contract, just spread across more files.

### 4. Defer channels/Jotai until after the typed boundary exists

The first implementation should establish the model/intent/command types and a minimal transport. If a channel, Jotai atoms, `useSyncExternalStore`, or another mechanism becomes useful, it must implement the same port contract. It must not become a second source of truth for editor or document state.

Alternative considered: adopt Jotai immediately for viewport/workbench communication. That risks replacing callback soup with atom soup before the ownership contract is clear.

### 5. Use `// SLOP:` comments as explicit debt markers, not decoration

Large or convoluted files that remain after a migration step should get a top-of-file ownership/debt comment only when it helps readers. Those comments must start with `// SLOP:` so architectural debt is searchable and clearly differentiated from ordinary comments.

Alternative considered: require comments on every module. That creates noise and does not solve ownership confusion.

## Risks / Trade-offs

- [Risk] The architecture cleanup can become a broad rename-only churn. -> Mitigation: each task should remove or clarify one concrete ownership problem, and tests should target seams or boundary rules.
- [Risk] A viewport port can over-abstract normal React composition. -> Mitigation: keep the first port small and based on existing observed data flow: scene model, interaction model, overlays, intents, and commands.
- [Risk] Splitting files can hide behavior across too many tiny modules. -> Mitigation: split by stable product/runtime concern, not by arbitrary hook size.
- [Risk] Channels or atoms could become hidden global state. -> Mitigation: specs forbid them from owning document, editor, sketch, selection, command, history, or modeling mutation state.
- [Risk] Existing UI tests may depend on file locations or test IDs around the viewport. -> Mitigation: preserve user-visible behavior and deliberate test harness seams unless a task explicitly replaces them.

## Migration Plan

1. Establish the new workbench module structure and move app-layer workbench files behind it with import updates.
2. Add or update static boundary coverage for `src/app` bootstrap-only behavior and prohibited viewport context reads.
3. Extract named workbench commands/use-cases for document actions, object actions, variable actions, debug actions, and tab close/save coordination.
4. Introduce the viewport model/intent/command types and adapt `CadWorkbench` through a viewport adapter.
5. Refactor `ThreeCadViewport` internals to consume only the viewport model and emit intents/commands through the port.
6. Split shell composition into visible regions after the controller/action boundary is clear.
7. Add `// SLOP:` comments to any intentionally retained large/convoluted files, or split them enough that no comment is useful.

Rollback is ordinary code rollback; no persisted document format or external API changes are intended.

## Open Questions

- Should the dedicated workbench module live at `src/workbench`, `src/features/workbench`, or another local convention?
- Should the viewport module live inside the workbench module or as a sibling feature module such as `src/viewport`?
- After the typed port exists, is a channel/external store needed for imperative viewport commands, or is a small callback/ref-based command bridge enough?
