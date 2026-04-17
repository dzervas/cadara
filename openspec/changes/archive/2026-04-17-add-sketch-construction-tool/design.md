## Context

Authored sketch points and entities already carry `isConstruction`, and region extraction already ignores construction entities. The missing product behavior is the editor loop around those flags: a toolbar affordance, a selection-mode toggle for existing geometry, a persistent modifier for newly created geometry, and viewport rendering rules that make construction geometry visible only while its sketch is being edited.

The implementation should stay inside the existing sketch editor boundaries. Toolbar state and transient modifier state belong in the sketch session/editor layer, accepted construction flag changes are durable sketch mutations, and profile creation should continue to rely on the authored sketch definition instead of a viewport-only visibility rule.

## Goals / Non-Goals

**Goals:**

- Add a sketch-mode Construction toolbar tool that supports both existing-geometry toggle mode and persistent new-geometry modifier mode.
- Persist construction state on authored sketch point/entity records using the existing `isConstruction` fields.
- Ensure new geometry created while the modifier is active is marked construction at commit time.
- Render construction sketch geometry as dashed wire geometry only during active sketch editing.
- Preserve profile/region extraction behavior so construction entities do not define profile boundaries.
- Add focused `bun:test` coverage across editor state, commit construction propagation, profile exclusion, and renderable styling/visibility.

**Non-Goals:**

- Add new solver math, kernel APIs, or a new sketch geometry type.
- Add construction support for projected external references unless they already map to authored sketch point/entity records.
- Change constraint authoring semantics; construction geometry remains selectable for constraints and direct edits while editing the sketch.
- Add new visual treatments for finished model construction planes or part-mode construction features.

## Decisions

### Construction is an authored flag, not a distinct entity kind

Use the existing `isConstruction` fields on `SketchPointDefinition` and `SketchEntityDefinition`. Toggling construction edits those fields on the selected authored records, and drawing tools receive construction context when producing commit contributions.

Alternative considered: introduce separate construction entity variants. That would duplicate shape-specific fields, make tool commits more complex, and require broader schema migration without adding behavior the current model cannot represent.

### Toolbar Construction has two editor-owned states

The sketch session should distinguish selection toggle mode from persistent modifier mode. Activating Construction enters a construction-target selection state. If the next action is selecting a supported sketch vertex/point or edge/entity, the editor toggles that existing geometry and leaves drawing tools unchanged. If the next action is activating a drawing tool, the editor keeps Construction visually selected as a modifier and activates the requested drawing tool so new geometry commits with `isConstruction: true`.

Alternative considered: make Construction only a normal one-shot tool. That would satisfy toggling existing geometry but would make construction drawing require per-tool checkboxes or duplicated construction variants for every drawing tool.

### Edge toggles do not implicitly toggle shared endpoint records

Selecting an edge/entity toggles that entity record. Its endpoint point records are not automatically toggled because endpoints can be shared by normal geometry and turning them construction would create surprising side effects. Selecting a vertex/point explicitly toggles the point or point-entity record associated with that target.

Alternative considered: cascade edge toggles into all referenced points. That is simpler to implement but risks changing normal geometry through shared points.

### Rendering is driven by edit context and construction styling metadata

Finished document renderables should omit construction-only sketch geometry outside active sketch editing. During sketch editing, merged sketch display renderables should include construction geometry with a dashed wire style so it remains useful for layout while reading differently from profile-producing geometry.

Alternative considered: always emit construction renderables and hide them in React components. Keeping visibility and styling in renderable composition is easier to test and avoids scattering construction checks across viewport components.

## Risks / Trade-offs

- Shared endpoint expectations can be confusing → Add tests and keep the behavior explicit: edge toggles affect the entity only, vertex toggles affect the selected point/point entity.
- Active button state can become ambiguous when another drawing tool is also active → Treat Construction as a modifier flag that can be selected alongside one active drawing tool, and add toolbar tests for the visual selected state.
- Existing renderable schemas may lack a dashed-line style field → Extend the smallest existing renderable/style contract needed and cover it with renderable composition or viewport feedback tests.
- Construction circles and arcs must not leak into profile extraction → Add region extraction tests that prove construction closed curves and construction boundary segments do not create regions.

## Migration Plan

No persisted schema migration is expected because authored sketch records already include construction flags. Existing sketch creation paths should continue to set `isConstruction: false` by default, and the new modifier only changes records created or toggled after this feature is implemented.

## Open Questions

None for this proposal. Assumptions are captured in the design decisions above.
