## Context

After the raster image model is replaced with a committed `referenceImage` sketch operation and the sketch editor can host special editor modes, calibration must be implemented without reintroducing image state into the main sketch solver. The dedicated calibration workflow should solve only image-local transform and anchor constraints, then export the solved anchors back into the sketch as fixed reference points.

The user explicitly wants this solver isolated in its own folder and extendable later, rather than woven into the existing sketch solver code.

## Goals / Non-Goals

**Goals:**
- Add a dedicated reference-image calibration mode on top of the sketch special editor mode contract.
- Add a dedicated calibration solver that is physically and logically separate from the generic sketch solver.
- Solve only operation-local image state: transform, anchors, and calibration constraints.
- Export solved anchors into the main sketch as read-only fixed reference points.
- Support image replacement while preserving anchor UV positions.
- Provide a calibration panel with feature-editor-like structure, including scale-mode and anchor-visibility toggles.

**Non-Goals:**
- Reuse the generic sketch solver for image calibration.
- Export lines, guide rails, or image boundary geometry into the main sketch.
- Reintroduce image-owned points, entities, or constraints into the flat local sketch graph.

## Decisions

### 1. Calibration uses a dedicated solver subsystem in its own folder

Recommended structure:
- `src/domain/reference-image-calibration/solver/` for solver input/output contracts and solve implementation
- `src/domain/reference-image-calibration/mode/` for mode lifecycle, interaction, and panel bindings
- `src/domain/reference-image-calibration/export/` for fixed anchor-point projection into the main sketch

Why:
- It keeps image-specific solving separate from `src/contracts/sketch/solver-core.ts`.
- It leaves room for later calibration capabilities without contaminating generic sketch solving.
- It matches the user's structural requirement directly.

Alternative considered:
- Reuse the generic sketch solver on a synthetic hidden sub-sketch.
- Rejected because it keeps image calibration conceptually entangled with the main sketch solver boundary.

### 2. Calibration solves transform parameters, not synthetic corner geometry

The solver will treat the image as transformable operation-owned state rather than as four free sketch corners. The operation-local state will include:
- image transform
- anchor definitions
- calibration constraints
- a scale mode toggle that chooses locked-aspect or independent X/Y scale solving

Why:
- The user does not want images to participate directly in the main sketch solver.
- Translation, rotation, and scaling are the real calibration problem.
- This keeps the solver state small and purpose-built.

Alternative considered:
- Persist four free corners and solve them directly.
- Rejected because that recreates the geometry-first model the user wants removed.

### 3. Main sketch consumes fixed anchor exports only

Solved anchors will be exported from the reference-image operation as read-only fixed reference points consumable by the main sketch for snapping and constraints. No lines or other guide geometry will be exported in this change.

Why:
- The user explicitly wants only anchor points exposed.
- Fixed exports let the main sketch use image-derived references without letting the main sketch mutate image calibration state.
- This aligns naturally with the codebase's existing concept of read-only reference geometry.

Alternative considered:
- Export local sketch points that participate fully in the main solver.
- Rejected because it would let image-owned state leak back into the generic sketch graph.

### 4. Calibration UI uses a dedicated structured panel

The calibration mode panel will follow the feature editor's structured visual direction while remaining a dedicated mode panel contract. It will include:
- scale-mode toggle
- anchor-visibility toggle, default off
- anchor management
- calibration diagnostics
- replace image action

Why:
- The user explicitly requested a feature-editor-like continuation.
- This keeps calibration UI coherent with the rest of the workbench while preserving a clean domain boundary.

## Risks / Trade-offs

- [Dedicated solver adds another solving subsystem] → Keep the input/output contract narrow and isolate the code physically in its own folder so the new boundary remains understandable.
- [Anchor export may drift from calibration state] → Treat exported anchor points as derived data recomputed from the committed calibration result rather than as separately editable state.
- [Two scale modes increase solver surface area] → Keep the transform model explicit and make the scale-mode toggle drive solver degree-of-freedom rules rather than forking the entire workflow.
- [Replace-image behavior could silently break calibrations] → Preserve anchor UV locations across replacement and surface diagnostics when the new image dimensions make the current calibration invalid or incomplete.

## Migration Plan

- Build the isolated calibration solver and operation-local calibration contracts.
- Implement the reference-image calibration mode on top of the special-mode host.
- Export solved anchor points as fixed sketch reference points.
- Remove any remaining dependence on the old image-specific sketch-solver path.

## Open Questions

- None for this proposal set. The desired scope and structural constraints are clear enough to proceed.
