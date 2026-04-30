## Context

The current workbench composes rendering, editor integration, document file actions, import entry, history coordination, notifications, local sync reactions, bug reporting, and layout state inside one application component. At the same time, tool activation and command routing are split across `CadWorkbench`, `useToolActions`, shortcut wiring, and editor-runtime integration helpers, which makes it difficult to identify the canonical owner of a behavior.

The repo already has useful separations such as `domain/`, `contracts/`, `components/`, and `hooks/`, but those boundaries have drifted. Lower layers currently import `app/` helpers, and the application shell has become the place where unrelated orchestration accumulates. This change focuses on clarifying architecture and code ownership without changing the boot path or runtime startup sequence.

## Goals / Non-Goals

**Goals:**
- Reduce `CadWorkbench` to composition, rendering, and narrow UI-local state.
- Introduce explicit application-owned controllers for major workbench flows such as history, import entry, document file actions, and notifications.
- Ensure toolbar actions, shortcut actions, and other command entrypoints reuse the same application action paths.
- Re-establish one-way dependency boundaries so `app/` is the composition layer and lower layers do not import from it.
- Preserve current user-visible behavior while making the code easier to reason about and extend.

**Non-Goals:**
- Refactoring the boot path, startup lifecycle, OCC warmup flow, or service creation topology.
- Replacing the editor runtime, modeling service, or tool registry contracts.
- Rewriting existing UI presentation components unless required to remove orchestration leakage.
- Changing feature behavior, import behavior, shortcut semantics, or undo/redo semantics beyond what is needed to unify ownership.

## Decisions

### Decision: Introduce an application controller layer under `src/app/`

The workbench will gain a small set of concern-specific application controllers or hooks under `src/app/` that own non-render orchestration. Expected slices are:
- history coordination
- import entry and session kickoff
- document file actions
- workbench notifications and transient feedback
- viewport or shell interaction adapters where orchestration currently sits in the shell

`CadWorkbench` remains the top-level composition point, but it delegates orchestration to those controllers and renders a mostly declarative shell.

Alternatives considered:
- Keep the large component and extract only helper functions.
  Rejected because it reduces line count without changing ownership.
- Push orchestration into `components/` or generic `hooks/`.
  Rejected because application-specific behavior would remain diffusely owned.

### Decision: Keep the editor runtime as the owner of editor session state, but move non-runtime command coordination into application controllers

The editor runtime remains the source of truth for editor state, command sessions, snapshot sequencing, and document cursor requests. Application controllers own the browser-facing coordination around that runtime, such as resolving which action path to invoke, opening file pickers, and mapping results into runtime events or workbench notifications.

This preserves the existing runtime investment while removing duplicated orchestration from `useToolActions`, shortcut handlers, and the workbench shell.

Alternatives considered:
- Move all workbench coordination into the runtime.
  Rejected because the user explicitly excluded boot-path work and because browser/file-menu concerns do not belong inside the editor runtime.
- Leave command coordination split between hooks and the shell.
  Rejected because it preserves the integration problem.

### Decision: Define one shared application entrypoint per command family

Each command family will have one application-owned entrypoint reused by all triggers:
- tool activation entrypoint
- history action entrypoint
- generic part import entrypoint
- document file action entrypoints

Toolbar clicks, shortcut handlers, inspector buttons, and future command sources call those shared entrypoints instead of implementing their own parallel orchestration. `ToolActionBus` may remain for event publication or logging, but it must not be a second business-logic path.

Alternatives considered:
- Continue letting toolbar and shortcut flows each compose their own logic.
  Rejected because it creates drift and duplicate bug surfaces.

### Decision: Make `app/` a strict top layer and move shared shapes downward when needed

When a lower layer needs a type or helper that currently lives under `app/`, the shared piece will move to a neutral module in `domain/`, `contracts/`, or `lib/` based on ownership. Lower layers must not import `app/` modules after this refactor.

This makes the dependency graph legible again and prevents presentational or domain code from depending on application composition details.

Alternatives considered:
- Leave import direction informal and rely on convention.
  Rejected because the current codebase already drifted past that point.

### Decision: Add boundary-focused regression checks

The change should include lightweight regression checks that fail when lower layers import `app/` modules or when the primary workbench shell regains forbidden orchestration responsibilities. The checks do not need a new lint dependency; a small test or scripted assertion is sufficient if it is stable and cheap.

Alternatives considered:
- Rely on code review only.
  Rejected because the existing architecture drift happened under normal iteration.

## Risks / Trade-offs

- [Controller sprawl] → Keep controllers aligned to user-facing concerns and forbid “misc” orchestration buckets.
- [Boundary cleanup moves many small helpers] → Prefer moving only the truly shared pieces and leave purely application-specific logic in `app/`.
- [Behavior regressions while unifying entrypoints] → Keep spec deltas focused on behavioral parity and add targeted tests around history, import entry, and shortcut-triggered actions.
- [Over-abstracting presentational code] → Keep rendering props concrete and domain-shaped; avoid introducing generic wrapper layers with no ownership value.
- [Runtime/application boundary confusion persists] → Document the split explicitly: runtime owns editor session state; application controllers own browser-facing coordination and command entry selection.

## Migration Plan

1. Create the new application architecture slices and move orchestration behind them without changing behavior.
2. Rewire toolbar, shortcut, and inspector triggers to the shared entrypoints.
3. Reduce `CadWorkbench` to composition plus narrow UI-local state.
4. Remove lower-layer imports from `app/` by relocating shared helpers downward.
5. Add regression checks for boundary direction and orchestration ownership.

Rollback is low risk because the change is internal. If a slice destabilizes behavior, the affected controller can be reverted independently without touching boot-path code.

## Open Questions

- Whether boundary regression checks should live as `bun:test` assertions, a dedicated architecture test, or an existing lint-adjacent script.
- Whether notification dispatch should become a dedicated application store/provider now or remain a controller local to the workbench composition layer.
