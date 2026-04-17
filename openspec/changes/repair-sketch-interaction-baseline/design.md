## Context

The current viewport already resolves hover targets while sketch constraint tools are active, but click selection can be bypassed by the active-tool guard in the viewport click handler. The toolbar also uses the same dark shell, icon assets, and Mantine action controls across part and sketch modes, so icon foreground visibility needs to be corrected at the shared toolbar presentation layer.

## Goals / Non-Goals

**Goals:**
- Make sketch-mode toolbar tools legible on the dark shell.
- Let active constraint tools receive valid viewport selections.
- Preserve drawing-tool click behavior for line, rectangle, circle, and similar pointer-created geometry.
- Keep the fix small enough to unblock later sketch proposals.

**Non-Goals:**
- Move sketch tool UI into the viewport.
- Add direct geometry editing.
- Add richer constraint previews or annotation glyphs.
- Change durable sketch document schemas.

## Decisions

### Treat constraint tools differently from drawing tools in click routing

Drawing tools use sketch pointer movement and release to construct new geometry, so they should keep the current pointer-release flow. Constraint tools select existing sketch geometry, so viewport clicks must still dispatch `viewport.selectionRequested` while a constraint tool is active.

Alternative considered: always allow selection while any sketch tool is active. Rejected because drawing tools would start competing with their own construction lifecycle.

### Fix toolbar visibility at the shared presentation layer

The toolbar issue should be corrected through shared toolbar icon/button styling or icon filtering rather than patching individual sketch tools. This keeps the part and sketch toolbar behavior consistent and avoids duplicating visual exceptions in tool definitions.

Alternative considered: swap sketch icons for separate light assets. Rejected unless shared styling cannot make the existing local SVG assets readable.

## Risks / Trade-offs

- [Constraint click routing could accidentally select targets while a drawing tool is active] -> Gate the selection path to registered constraint tools and cover drawing-tool behavior with tests.
- [Icon contrast fixes could alter part-mode button appearance] -> verify active, inactive, dropdown, and search result toolbar states.
- [Selection filters may reject valid sketch geometry if catalog state is stale] -> add tests around active constraint tool picking using the existing selection filter and catalog.

## Migration Plan

1. Adjust toolbar presentation for visible icon/foreground contrast.
2. Update viewport click routing so active constraint tools receive valid selections.
3. Add targeted tests for toolbar visibility and constraint click dispatch.
4. Validate that existing drawing-tool pointer construction still works.

## Open Questions

- Whether local SVG assets should be normalized to currentColor in a later visual cleanup if CSS filtering is not robust enough.
