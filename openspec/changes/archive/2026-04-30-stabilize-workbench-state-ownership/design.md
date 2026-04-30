## Context

The current workbench has three overlapping state owners for document-facing behavior:
- the editor runtime owns command-session state and some refresh sequencing
- application hooks own additional mutation flow and local undo/redo stacks
- `CadWorkbench` owns document-adjacent state resets and manual snapshot patching

That split causes integration breakage because accepted mutations are not sequenced through one authority. Instead, multiple flows call `modelingService` directly and repair state afterward by dispatching `document.refreshRequested` or by manually loading snapshots into the runtime.

Assumption: this change preserves the existing editor runtime as the authoritative editor-state owner. Removing or replacing the runtime wrapper is a separate change and is not part of this proposal.

## Goals / Non-Goals

**Goals:**
- Establish one explicit ownership model for workbench state.
- Keep command-session state, document refresh sequencing, and accepted mutation sequencing under one authoritative runtime-owned path.
- Limit application controllers to browser-facing coordination, command entry mapping, notifications, and non-authoritative UI adapters.
- Reduce shell-local state to layout and presentation concerns.
- Eliminate ad hoc refresh bridging and manual snapshot patching for ordinary workbench mutations.

**Non-Goals:**
- Replacing the editor runtime implementation strategy.
- Reworking boot-time service creation, OCC warmup, or provider bootstrap.
- Changing user-visible workbench behavior beyond ownership and sequencing cleanup.
- Redesigning every existing controller at once if a narrower migration path preserves the ownership model.

## Decisions

### Decision: Define a four-layer ownership model

The change will codify four distinct owners:
- shell-local UI state: modal visibility, sidebar width, ephemeral presentation toggles
- application controllers: browser APIs, trigger normalization, notifications, and mapping external actions into runtime requests
- editor runtime: command sessions, mutation request sequencing, accepted refresh sequencing, and document-facing editor state
- modeling service: durable mutation execution and snapshot production

Alternatives considered:
- Keep the current mixed ownership and document it better.
  Rejected because the problem is structural, not a naming issue.
- Move all browser coordination into the runtime.
  Rejected because file pickers, popup handling, and notification presentation are not editor-domain state.

### Decision: Application controllers SHALL request document changes through runtime-owned paths

Controllers may still gather browser input or package mutation payloads, but they will not become owners of accepted document state transitions. For ordinary rename, variable edit, import completion, history movement, and similar flows, controllers hand off to runtime-owned actions or effect requests instead of mutating `modelingService` and forcing a refresh afterward.

Alternatives considered:
- Allow direct controller mutations if they dispatch a refresh after success.
  Rejected because that preserves the exact split ownership causing integration fragility.

### Decision: Manual snapshot patching is reserved for explicit document replacement flows

There are a small number of flows, such as opening or importing a whole document file, where the application may need to replace the active document basis in one step. Those flows may use a dedicated document-replacement handoff into the runtime, but that handoff must be explicit and treated differently from ordinary incremental mutations.

Alternatives considered:
- Ban all application-triggered snapshot replacement.
  Rejected because whole-document file actions genuinely need a replacement path.
- Keep arbitrary `applyLoadedSnapshot()` escape hatches.
  Rejected because they erase the distinction between authoritative replacement and ad hoc repair.

### Decision: Workbench history coordination becomes a selector/dispatcher, not a second history store

The shared history coordinator may decide which undo context is active, but it must not become a second owner of authoritative document mutation state. Any temporary compatibility stack that remains during migration must be clearly transitional and converging toward runtime-owned sequencing.

Alternatives considered:
- Preserve React-local undo stacks as a permanent workbench concern.
  Rejected because it keeps history semantics split across runtime, controller, and service layers.

### Decision: Enforce ownership with architecture tests and surface-specific APIs

The workbench should expose narrow controller and runtime APIs that make illegal ownership patterns difficult. Regression tests should fail when shell code or app controllers reintroduce direct document mutation plus ad hoc refresh paths for flows covered by this change.

Alternatives considered:
- Rely on review discipline.
  Rejected because the codebase already drifted past that boundary.

## Risks / Trade-offs

- [Migration touches many user-facing flows] → Phase by concern: history, rename/variable actions, import completion, then document actions.
- [Runtime API expansion could become leaky] → Keep runtime-facing requests aligned to user-facing workflows, not generic “do anything” escape hatches.
- [Some file-action flows may still require explicit replacement hooks] → Name and isolate document-replacement APIs so they do not become a general refresh backdoor.
- [Temporary coexistence during migration could confuse ownership] → Mark transitional paths in tasks and remove compatibility bridges before closing the change.

## Migration Plan

1. Introduce the ownership contract and runtime/application handoff APIs.
2. Move high-risk workbench mutations off direct controller-to-service paths.
3. Restrict shell state to UI-local concerns and remove document-adjacent repair logic from `CadWorkbench`.
4. Collapse duplicate history and import completion sequencing behind shared authoritative paths.
5. Add or update regression tests that fail when covered flows bypass the ownership model.

Rollback is straightforward because the change is internal. Any migrated flow can temporarily revert to its prior controller path, but the change should not be considered complete until the compatibility path is removed.

## Open Questions

- Whether the runtime should expose dedicated mutation request events for every migrated workbench action or a narrower set of document-action families.
- Whether document file replacement should be represented as a distinct runtime event or as a specialized application-to-runtime adapter outside the ordinary command flow.
