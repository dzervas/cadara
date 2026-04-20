## Context

The current editor can render numeric, enum, boolean, reference, collection, diagnostics, and custom fields from a declarative form schema. Advanced solid features such as sweep and loft already carry `participants`, `operationIntent`, and `options`, but the option shape is currently too weak for richer CAD controls like twist type, path section count, continuity mode, and extent mode.

Extrude and revolve are core typed contracts rather than advanced-solid option-bag features. This change should support both worlds: shared option primitives for reuse, while preserving strongly typed feature contracts where they already exist.

## Goals / Non-Goals

**Goals:**
- Define a reusable option descriptor model for enum, boolean, angle, positive number, positive integer, nested group, and discriminated union options.
- Allow option fields to declare authored value metadata so literals and expressions survive draft, history, hydration, preview, and rebuild.
- Let feature authoring definitions drive conditional visibility and validation without adding feature switches to the inspector.
- Keep reference selection represented by participants or reference fields rather than expression values.

**Non-Goals:**
- Do not implement extrude, revolve, sweep, or loft geometry in this substrate change.
- Do not convert all existing feature contracts into `AdvancedSolidFeatureParameters`.
- Do not add surface or thin feature variants.

## Decisions

1. Preserve typed feature contracts and share primitives.

   Extrude and revolve should keep typed parameter contracts because they are central kernel operations with feature-specific invariants. Advanced features can continue to use `participants` and `options`, but those options should be described by typed descriptors rather than anonymous `Record<string, unknown>` values.

2. Represent mutually exclusive option shapes as discriminated groups.

   Controls such as sweep twist and feature extent mode should be modeled as one active variant at a time. This avoids invalid states like `twistType: angle` with stale `turns` and `pitch` values leaking into durable history.

3. Keep conditional presentation feature-authored.

   Feature authoring definitions should compute hidden/disabled/error state from draft state and provide it through the form schema. The inspector remains a renderer and patch dispatcher.

4. Treat references separately from option expressions.

   References remain durable targets owned by participants or reference fields. Numeric, angle, integer, boolean, and enum options can be expression-capable where the feature declares an authored value kind.

## Risks / Trade-offs

- Generic descriptors can become too loose -> require discriminants, explicit value kinds, and feature-owned validation for option-specific invariants.
- Nested form support can complicate the inspector -> keep groups presentational and let patch semantics remain field-owned.
- Expression support for enum/boolean options can surprise users -> reuse existing value-kind validation and diagnostics rather than adding feature-local expression parsing.
