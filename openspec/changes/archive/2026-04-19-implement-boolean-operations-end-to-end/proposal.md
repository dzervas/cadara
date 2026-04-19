## Why

The toolbar exposes a Combine boolean tool, but it is not wired into feature authoring or the modeling contract, so activating it behaves like a no-op from the user's perspective. Boolean operations need to work as a full feature flow: select bodies, choose join/cut/intersect, preview the result, commit it, persist it, and rebuild it after refresh.

## What Changes

- Replace the static no-op Combine toolbar entry with a registered feature authoring definition for a body-to-body boolean Combine feature.
- Add a typed Combine feature payload with explicit operation intent, target bodies, and tool bodies so UI state, snapshots, history, and kernel execution do not infer participants from selection order.
- Add Combine feature-session form behavior for selecting target/tool bodies, switching between join/cut/intersect, previewing, committing, and editing committed Combine features.
- Execute Combine through the modeling service and OpenCascade adapter using the existing boolean policy helpers where they fit, with structured diagnostics for missing bodies, unsupported payloads, empty boolean results, and stale references.
- Update viewport/tree/render behavior so committed Combine results visibly replace or create the expected body outputs and do not leave consumed tool bodies looking unchanged.
- Add focused unit, contract, kernel, and Playwright coverage proving the UI flow is not a no-op and that committed results survive rebuild/reload.

## Capabilities

### New Capabilities
- `combine-feature`: Defines the user-facing Combine boolean feature, including operation modes, participant roles, preview/commit behavior, diagnostics, and rebuild expectations.

### Modified Capabilities
- `advanced-solid-feature-substrate`: Add Combine as a concrete body operation feature using target/tool body participants and explicit operation intent.
- `durable-modeling-contract`: Extend the typed feature contract, runtime validation, snapshots, and mutation payloads to include Combine.
- `feature-authoring-definition`: Require Combine to be owned by a registered feature authoring module instead of a standalone toolbar-only command.
- `feature-session-forms`: Define Combine create/edit form behavior, reference preservation, preview readiness, and commit readiness.
- `frontend-modeling-boundary`: Require Combine preview and commit to flow through the modeling service boundary.
- `occ-basic-feature-operations`: Require OpenCascade-backed body boolean execution for Combine join, cut, and intersect.
- `feature-flow-e2e-harness`: Strengthen boolean e2e coverage so it verifies visible committed geometry and persisted rebuild output.

## Impact

- Affected code includes tool registration, feature authoring definitions, feature form schemas, editor session orchestration, shared modeling contracts and zod schemas, operation-history serialization, snapshot hydration, mock and OpenCascade kernel adapters, render exports, feature/object tree derivation, and e2e harness helpers.
- No new runtime dependency is expected; implementation should reuse existing Mantine form primitives, the feature authoring registry, modeling service APIs, OpenCascade boolean builders, and `bun:test`/Playwright coverage already in the repo.
- Existing extrude/revolve/shell boolean-scope behavior should remain compatible; this change adds direct body-to-body Combine behavior rather than replacing profile-based boolean operations.
