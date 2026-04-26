## Context

Sketches today are purely geometric — points, curves, constraints, dimensions. There is no concept of binary content or image references in the sketch definition. The sketch solver works on a flat constraint graph of 2D points and geometric relationships.

The import-provider-contract established `ImportCapabilities.assets.storeEmbeddedBinary()` for persisting non-geometry binary content and returning a durable asset ID. The sketch entity union is a closed discriminated union in `src/contracts/sketch/schema.ts` that can be extended with new kinds.

The existing `fixPoint` constraint pins a sketch point to an absolute 2D position. The existing `SketchPlaneDefinition` already supports arbitrary planes (construction planes and body faces) with full world-space frame embedding.

## Goals / Non-Goals

**Goals:**
- An `imageReference` sketch entity that places an image on a sketch plane as construction geometry, controlled by 4 corner points that participate in the normal constraint graph.
- An `ImageImportProvider` on the import-provider-contract that accepts image files and produces a `CommitSketchRequest` with the image reference entity and initial fixPoint constraints.
- Viewport rendering of image reference entities as textured quads on the sketch plane.
- Calibration of scale, rotation, and position using existing sketch tools and constraints — no new constraint kinds.

**Non-Goals:**
- Image editing, cropping, or filtering — the image is used as-is.
- Automatic feature detection or dimension extraction from images.
- OCR or text recognition from images.
- Image tracing (automatic conversion of image content to sketch geometry).
- Opacity or layer ordering controls for the image — first version renders at fixed opacity behind sketch geometry.
- Non-planar image projection (e.g., wrapping onto curved surfaces).

## Decisions

### 1. Image as a sketch entity with 4 corner points, not as a sketch-level background

**Decision:** The image is a first-class `imageReference` sketch entity with 4 corner `SketchPointId` references. The corners are regular sketch points that participate in the constraint solver like any other points.

**Alternative considered:** A sketch-level `backgroundImage` field on `SketchDefinition` with a separate transform (translation, rotation, scale) outside the constraint graph. This would be simpler but makes calibration a separate UI concern disconnected from the solver. The user would calibrate through a custom image-transform panel rather than through sketch constraints.

**Rationale:** Making the corners regular sketch points means:
- The solver naturally handles the image transform — no special image-aware solver logic.
- Calibration uses existing constraint kinds (fixPoint, dimension, horizontal, vertical) — no new constraint types.
- The user's mental model is consistent: everything on the sketch is constrained geometry.
- Warp/perspective correction falls out naturally from 4 independent corner points.

### 2. Always `isConstruction: true`

**Decision:** Image reference entities are always construction geometry. They cannot contribute to profile regions.

**Rationale:** An image is not a geometric boundary. It has no edges for the region solver to close. Allowing it in the region graph would be meaningless and would break region derivation. The `isConstruction` flag is already respected throughout the sketch pipeline.

### 3. Initial placement from pixel dimensions with a heuristic scale

**Decision:** When the provider creates the initial sketch, the 4 corner points are placed at positions computed from the image's pixel dimensions using a heuristic scale (e.g., 1 pixel = 0.1mm, capped so the image fits within a reasonable sketch-space extent). All 4 corners get `fixPoint` constraints at these positions. The image appears at a usable size immediately.

**Alternative considered:** Place the image at 1:1 pixel-to-unit scale. For a 4000×3000 photo this produces a 4-meter-wide image in sketch space, which is unwieldy. For a 100×100 icon it's tiny.

**Rationale:** A bounded heuristic (e.g., longest side maps to 200mm, preserving aspect ratio) gives a reasonable starting size. The user then calibrates to real dimensions by constraining a calibration line. The exact heuristic is an implementation detail, not a contract concern.

### 4. Calibration through fixPoint relaxation + dimensional constraints

**Decision:** The calibration workflow is:
1. Image appears with all 4 corners fixed.
2. User draws a line over a known-dimension feature (e.g., ruler) and adds a dimension constraint.
3. User draws a line over a known-orientation feature and adds a vertical/horizontal constraint.
4. The solver is overconstrained — the user removes or relaxes fixPoint constraints on corners to give the solver freedom to adjust the image.
5. As the solver moves corner points, the image rendering follows.

No dedicated "calibrate image" tool or mode. Standard sketch editing.

**Alternative considered:** A dedicated calibration wizard that asks the user to pick two points for scale and two points for orientation, then computes the transform analytically. This is more guided but introduces a separate UI flow that doesn't compose with the constraint system.

**Rationale:** Using the constraint solver means calibration is incremental, reversible (undo), and composable with other sketch geometry. The user can refine calibration at any time by adding/removing constraints. Power users can do perspective correction by independently positioning corners.

### 5. Embedded binary storage via ImportCapabilities, not inlined in sketch JSON

**Decision:** The image bytes are stored via `capabilities.assets.storeEmbeddedBinary()` during the provider's `prepare()` phase. The sketch entity stores only the `embeddedBinaryId` returned by the capability. The image bytes live in the `.cadara` package as a separate blob, not in the sketch definition JSON.

**Rationale:** Images can be megabytes. Inlining them in JSON would bloat the sketch definition, slow down serialization/deserialization, and break the existing invariant that sketch definitions are lightweight geometric data. The embedded binary asset system already handles content-addressed storage and ZIP packaging.

### 6. Provider produces a single CommitSketchRequest

**Decision:** The `ImageImportProvider.prepare()` returns `ImportPreparedActions` with one `CommitSketchRequest`. The sketch contains:
- 4 `SketchPointDefinition` entries for the corners
- 1 `imageReference` entity referencing those points and the embedded binary
- 4 `fixPoint` constraints pinning corners to their initial positions
- No other entities or constraints

The user adds calibration geometry after the sketch is committed, using normal sketch editing.

**Alternative considered:** Provider creates a richer initial sketch with pre-positioned calibration lines. This assumes a specific calibration workflow that may not match the user's intent.

**Rationale:** Minimal initial sketch. The provider's job is to place the image. Calibration is the user's job, using standard sketch tools they already know.

### 7. Rendering as a textured quad in the sketch viewport

**Decision:** The sketch viewport renderer checks for `imageReference` entities and renders the referenced image as a texture mapped to the 4 corner points. The image is rendered behind (lower z-order than) all other sketch geometry. Opacity is fixed at first version (e.g., 50% or configurable via entity style).

**Rationale:** Three.js `PlaneGeometry` + `TextureLoader` + UV mapping to 4 points is straightforward. The existing sketch rendering pipeline already iterates over entities by kind. Adding a case for `imageReference` that renders a textured mesh instead of a curve is a localized change.

## Risks / Trade-offs

**[Large images and memory]** → A 20MB photograph stored as an embedded binary and loaded as a Three.js texture uses significant memory. Mitigation: the provider can downsample during prepare if the image exceeds a size threshold, storing a reduced-resolution copy. The original resolution is not needed for sketch calibration.

**[Solver performance with many fixPoint constraints]** → 4 additional fixPoint constraints and 4 points are negligible for the solver. Not a real risk.

**[Overconstrained initial state]** → The initial sketch has 4 fixPoint constraints (8 DOF consumed) on 4 points (8 DOF total). Adding any calibration constraint without removing a fixPoint makes the system overconstrained. Mitigation: the UI should surface solver overconstrain diagnostics clearly so the user knows to remove fixPoint constraints. The proposal mentions this workflow explicitly.

**[No undo for fixPoint removal during calibration]** → Standard sketch undo already handles constraint add/remove. No special handling needed.

**[Texture UV mapping for non-rectangular quads]** → When corners are moved independently (warp), the quad is no longer rectangular. Simple bilinear UV mapping on a two-triangle quad may show visible seam artifacts for extreme warps. Mitigation: acceptable for v1; perspective-correct interpolation can be added later if users need it.
