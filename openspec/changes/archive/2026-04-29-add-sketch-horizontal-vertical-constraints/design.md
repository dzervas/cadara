## Context

The sketch contract and solver already have durable `horizontal` and `vertical` constraint kinds, and line-tool snap inference can author them automatically. What is missing is explicit user-facing authoring for existing lines plus a clear contract that these orientations are measured in sketch-plane coordinates, not world coordinates and not dimension axes.

This change crosses the sketch constraint registry, shared tool metadata, sketch-session tests, and solver-facing behavioral docs, so a short design is useful before implementation.

## Goals / Non-Goals

**Goals:**
- Add explicit Horizontal and Vertical sketch constraint tools for line entities.
- Reuse the existing `horizontal` and `vertical` durable constraint kinds instead of introducing new schema variants.
- Make the orientation semantics explicit: horizontal means parallel to the sketch plane X axis, vertical means parallel to the sketch plane Y axis.
- Reuse existing public glyph assets for toolbar and annotation consistency.

**Non-Goals:**
- Do not add new horizontal/vertical dimension behavior.
- Do not add projected-reference variants for horizontal or vertical in this change.
- Do not change solver math beyond clarifying and testing the existing sketch-plane-axis behavior.
- Do not redesign the broader constraint toolbar grouping.

## Decisions

### 1. Add standalone `constraintHorizontal` and `constraintVertical` tools
These should behave like other explicit constraint commands, not like dimension variants. Each tool selects one local line and commits immediately without value entry.

**Why:** This matches the user mental model and keeps the behavior clearly separate from horizontal/vertical distance dimensions.

**Alternative considered:** Reusing the Dimension dropdown or overloading `dimensionHorizontal` / `dimensionVertical`.
**Why not:** Those tools author measurements, require value workflows, and would blur two different sketch concepts.

### 2. Commit existing durable constraint kinds instead of adding new schema
The authoring layer should emit the current `horizontal` or `vertical` `ConstraintDefinition` records keyed by `entityId`.

**Why:** The contract, annotation pipeline, deletion cleanup, and solver already understand these kinds, so the smallest change is to expose them explicitly.

**Alternative considered:** Adding new tool-specific constraint kinds.
**Why not:** It duplicates existing domain concepts and increases solver and persistence surface area for no gain.

### 3. Define orientation relative to sketch-plane axes
The change should document and test that horizontal/vertical are resolved in sketch coordinates. For an XY sketch that is world X/Y; for any other support plane it is still the sketch-local X/Y frame.

**Why:** This is the core ambiguity the user called out, and it keeps constraint semantics consistent with the rest of the 2D sketch contract.

**Alternative considered:** Defining orientation against world axes.
**Why not:** Authored sketch points and dimensions already live in sketch-plane coordinates, so world-axis behavior would be inconsistent and harder to reason about.

### 4. Reuse existing `sketch-horizontal.svg` and `sketch-vertical.svg` assets for tool icons
Add tool icon IDs for the toolbar and map existing constraint/history presentation to those same assets.

**Why:** The assets already exist for committed annotation glyphs, so reuse keeps the UI consistent and minimizes new asset work.

**Alternative considered:** Shipping new icons.
**Why not:** It adds work without changing behavior.

## Risks / Trade-offs

- **Tool ambiguity with dimensions** → Keep separate tool IDs, labels, and tooltips that explicitly say they constrain line orientation rather than create a distance.
- **Axis semantics remain implicit in code** → Add targeted tests around non-XY sketch supports and update solver-spec language to make the contract explicit.
- **Partial UI wiring leaves annotations or history without icons** → Update shared tool icon unions/mappings and regression tests together with the new tool definitions.
