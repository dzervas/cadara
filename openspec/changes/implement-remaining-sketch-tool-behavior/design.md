## Context

The sketch tool architecture already supports registry-backed drawing tools for line, rectangle, and circle, plus constraint/dimension authoring flows. The toolbar still exposes Spline, Trim, Offset, and a primary Dimension trigger without durable behavior. A recent reducer guard prevents those passive tools from dropping the active sketch session, but the tools still need real authoring workflows.

## Goals / Non-Goals

**Goals:**
- Implement Spline, Trim, Offset, and the primary Dimension trigger as real sketch-mode commands.
- Keep tool-specific behavior in domain tool/session modules and declarative presentation schemas.
- Produce valid authored sketch definitions and commit requests for accepted operations.
- Preserve sketch-session camera/tool state and current modeling/solver boundaries.

**Non-Goals:**
- Implement SVG fill/stroke/style behavior; that is covered by `implement-svg-sketch-style-behavior`.
- Redesign all sketch curve math or region extraction beyond what these tools require.
- Add NURBS-level spline editing if a simpler first spline representation satisfies the visible tool contract.
- Make projected reference geometry generate profile boundaries.

## Decisions

### Treat Dimension as an alias for aligned distance

The primary `dimension` button should activate the same workflow as `dimensionDistance`. This avoids introducing a second dimension authoring flow and matches the current dropdown family, where aligned distance is the default variant.

Alternative considered: keep `dimension` as a dropdown-only trigger. Rejected because search/shortcut/direct activation can dispatch `dimension`, and it should not corrupt or no-op editor state.

### Add Spline through the sketch tool registry

Spline should be a registered sketch drawing tool with its own module, metadata, activation behavior, pointer lifecycle, validation, presentation, and commit contribution. If the current sketch contract cannot represent the selected spline curve directly, extend the authored/solved sketch schema in the smallest compatible way rather than storing splines as unrelated ad hoc entities.

Alternative considered: approximate splines as multiple line segments. Rejected for the named Spline tool because that would make future editing and constraints ambiguous.

### Implement Trim and Offset as sketch edit tools, not drawing tools

Trim and Offset operate on existing sketch entities and need selection, hover, and preview state rather than a simple two-point drawing lifecycle. They should reuse sketch session state and schema presentation, but their mutations should be represented as edit operations on the draft sketch definition.

Alternative considered: force them into `SketchToolDefinition` as drawing tools. Rejected because selection-driven edit tools have different state and validation needs from line/rectangle/circle.

### Keep accepted edits as authored sketch mutations

Accepted trim and offset operations should update the sketch draft/commit request through domain helpers and continue to commit through the existing sketch commit path. UI and viewport components should only dispatch interactions and render presentation.

Alternative considered: write geometry directly from viewport handlers. Rejected because durable sketch mutations must remain behind editor/domain logic and modeling boundaries.

## Risks / Trade-offs

- [Spline schema could be too broad] -> start with one explicit supported spline representation and validation, leaving advanced spline edit handles for later.
- [Trim behavior is ambiguous around overlapping or tangent curves] -> support clear intersections first and surface validation for unsupported ambiguity.
- [Offset can produce invalid self-intersections or impossible curves] -> preview supported cases and reject invalid offsets without changing the draft.
- [More edit tools can bloat sketch session state] -> keep shared edit-tool state minimal and move tool-specific geometry logic into dedicated helpers.

## Migration Plan

1. Register Dimension alias behavior and add reducer tests proving `dimension` stays in sketch editing.
2. Add spline contract/runtime support and a `spline` sketch tool module.
3. Add trim edit-tool state, hit testing, draft mutation helpers, and feedback.
4. Add offset edit-tool state, numeric controls, preview, and draft mutation helpers.
5. Remove these tools from the passive/no-op sketch tool guard as each becomes implemented.
6. Run focused tests, then `bun run test` and `bun run lint`.

## Open Questions

- Whether first-version Spline should support fit-point splines only or include control-point editing immediately.
- Whether first-version Trim should support circles/arcs in addition to line segments.
- Whether first-version Offset should support chain selection or only one entity per operation.
