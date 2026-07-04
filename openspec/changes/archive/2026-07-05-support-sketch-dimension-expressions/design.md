## Context

The current implementation has numeric assumptions at every sketch dimension layer:

- Viewport floating inputs use `type="number"` and coerce input through `Number(...)` before patching sketch state.
- `SketchToolFloatingInputDescriptor`, `SketchConstraintAuthoringState`, and `SketchAnnotationEditState` represent pending dimension values as `number | null`.
- Durable `DimensionDefinition` records store concrete `value: number` or `valueRadians: number` fields.
- Sketch definition normalization rejects non-number dimension payloads.
- Solver code reads numeric dimension values directly.

Feature values already have an authored value wrapper (`literal` or `expression`) and a shared resolver that evaluates expression text against current document variables before execution. Sketch dimensions need the same preservation and resolution model, but the change must not leak expression concerns into React presentation components or the numerical sketch solver.

## Goals / Non-Goals

**Goals:**

- Preserve raw expression text for eligible sketch dimension magnitudes.
- Keep numeric literals ergonomic and backward-compatible, including existing saved sketches with numeric dimension values.
- Resolve all sketch dimension expressions to concrete finite numbers before solver execution.
- Keep the solver contract numeric-only after resolution.
- Reuse existing document-variable and authored-value helpers where they fit.
- Keep sketch target references, annotation placement, and expression-authored values as separate concepts in the durable schema.
- Add focused coverage at domain seams rather than broad UI snapshots.

**Non-Goals:**

- Add expressions to geometric constraints that are not driving dimensions, except existing editable angle constraints if explicitly needed by the final implementation seam.
- Add expressions to sketch point coordinates, entity geometry, IDs, references, target selection, or annotation placement.
- Add unit algebra, dimensional-analysis typing, or a new expression language.
- Rewrite the sketch solver to understand authored expression wrappers.
- Redesign the feature expression editor UI or add a feature-inspector-style panel to sketch dimensions.
- Silently migrate authored expression dimensions back to literal numbers after successful resolution.

## Decisions

### Keep durable authored values at the sketch dimension contract boundary

Eligible driving dimension fields should store either a literal numeric source or an expression source. Existing literal numeric payloads should normalize deliberately into the canonical authored literal shape, matching the feature-expression migration pattern.

The likely eligible fields are linear/radial dimension `value` fields and angle dimension `valueRadians`, with UI still allowed to present angle dimensions in degrees. Reference operands, dimension IDs, labels, kind discriminants, and annotation placement remain non-expression fields.

Alternative considered: store `valueText` beside the existing numeric `value`. That would duplicate sources of truth, create unclear precedence, and invite stale resolved values in persisted sketches.

### Resolve dimensions before solver calls, not inside the solver

Introduce a sketch-dimension value resolution seam in the modeling/domain layer that takes an authored sketch definition and current document variables and returns either a solver-ready sketch definition with concrete numeric dimension values or diagnostics. The existing solver and low-level solve helpers should continue to receive numeric values only.

Alternative considered: teach `solveSketchDefinitionCore` to evaluate expression wrappers. That would mix document-variable resolution and diagnostics into numerical solver code and violate the current frontend/modeling/solver separation.

### Reuse expression infrastructure, but keep sketch-specific validation explicit

Use the existing math.js-backed document-variable evaluation path and authored-value helpers where possible. Add sketch-dimension-specific result validation so linear/radial dimensions enforce positive finite numbers where they already have a minimum, while signed horizontal/vertical dimensions and angular values preserve their existing domain semantics.

Alternative considered: route sketch dimension expressions through feature field descriptors. That may reduce code, but it risks coupling sketch contracts to feature-editor form metadata. A small shared lower-level resolver or adapter is preferable if it keeps responsibilities clear.

### Keep transient sketch authoring state text-capable without moving validation into React

Floating input descriptors for expression-capable sketch values should carry editable text or authored-value draft state, not just a parsed number. React inputs should preserve user text and dispatch patches; domain sketch-session code should own parsing literal numbers, preserving expression text, applying min/value-kind validation, and producing presentation validation messages.

Alternative considered: parse in the input component and dispatch either number or expression. That repeats domain rules in UI code and makes other future floating-input consumers inherit sketch-specific behavior.

### Preserve annotation editing semantics

Reopening a committed dimension annotation should seed the input with the authored source: numeric literals formatted as before and expression-authored dimensions as their raw expression text. Accepting an edit should update the same durable dimension target and preserve annotation placement.

Angle dimensions may continue to display/edit degrees, but the persisted authored source must be unambiguous. The implementation should either store angle authored values in the canonical solver unit with clear UI conversion behavior or introduce a dedicated angle-value adapter with tests proving raw expression text is not accidentally converted as a string.

Alternative considered: always evaluate an edited angle expression in degrees and persist only converted radians as a literal. That would break the core requirement that raw expression text survives editing and variable changes.

### Fail visibly and keep authored data intact when expressions break

If a document variable change makes a committed sketch dimension expression invalid, the authored sketch dimension should remain unchanged and rebuild/solve should report diagnostics. The system must not silently replace the expression with the last good numeric value, delete the dimension, or ignore the failure.

Alternative considered: reject variable edits that break any dependent sketch dimensions. That may be stricter than current feature-expression behavior and would tightly couple variable mutation acceptance to every downstream sketch. Reporting rebuild diagnostics keeps variable ownership and dependent execution separate.

## Risks / Trade-offs

- [Large schema surface] Dimension values appear in contracts, normalization, history, session state, labels, and tests. Mitigation: introduce the authored-value contract first, then migrate call sites through a single resolver seam rather than ad hoc conversions.
- [Solver regression] Accidentally passing authored wrappers into solver code would fail at runtime. Mitigation: keep solver input types numeric and add tests around the modeling/solver boundary.
- [Angle unit ambiguity] Angle dimensions are stored in radians but edited in degrees. Mitigation: define one conversion seam and cover literal and expression-authored angle edits explicitly.
- [UI text validation drift] Text inputs can preserve invalid intermediate strings. Mitigation: React only stores/forwards text; domain presentation owns validation and commit gating.
- [Persistence compatibility] Existing sketches store numbers. Mitigation: normalize legacy numeric payloads to literal authored values, and preserve malformed-payload rejection for unsupported shapes.

## Migration Plan

Existing numeric sketch dimension payloads should load as authored literal values. New persisted sketches should use the canonical authored wrapper shape for eligible dimension magnitude fields. Rollback would require either a downgrade transform that resolves expression-authored dimensions to literals, losing expression text, or blocking rollback for documents containing expression-authored sketch dimensions.

## Open Questions

- Should editable angle constraint annotations, if separate from `lineAngle` dimensions, become expression-capable in the same slice or remain numeric until a dedicated constraint-value expression change?
- Should compact dimension annotation text show raw expression text, resolved value, or both when space allows? The minimum requirement is that accessible/editing state preserves raw expression text and diagnostics expose failures.
