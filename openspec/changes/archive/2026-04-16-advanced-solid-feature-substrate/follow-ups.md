## Advanced Solid Follow-Up Proposal Candidates

### Profile/path/surface generators

- `add-sweep-feature`: first proving feature for this family. Uses `profile`, `path`, optional `guideCurve`, optional `targetBody`, and operation intent `create`, `add`, `subtract`, or `intersect` when target bodies are present.
- `add-loft-feature`: follows sweep after section ordering and guide-curve diagnostics are proven. Uses repeated `profile` sections, optional `guideCurve`, optional `path`, and feature-declared operation intent.
- `add-wrap-feature`: depends on a semantics decision for whether wrap is a profile/path operation or a projection feature. Uses `profile`, `face` or `body` carrier targets, and possibly `path` only if the follow-up defines curve-driven wrapping.

Recommended first proving feature: `sweep`, because it proves profile plus path roles, guide-curve extension points, and operation intent without committing to loft section ordering or wrap projection semantics.

Known substrate gaps before broad rollout: wrap needs a projection/carrier role if `face` and `body` are too weak; loft may need ordered participant groups rather than independent role buckets.

### Body and region operations

- `add-split-feature`: first proving feature for this family. Uses `targetBody` plus `toolBody`, `plane`, or `face` tool participants and explicit unsupported-case diagnostics for multi-tool or non-manifold results.
- `add-thicken-feature`: uses `face` targets, optional `targetBody`, and operation intent for adding or subtracting offset surface results.
- `add-delete-solid-feature`: uses `body` or `targetBody` participants and should define whether deletion is a feature operation, timeline suppression, or direct body removal.
- `add-enclose-feature`: high-risk follow-up. Must define whether enclosing-region seeds can be faces only, profiles only, bodies only, or mixed `enclosingRegionSeed` participants from the start.

Recommended first proving feature: `split`, because it exercises target-body and tool-body roles with clear unsupported-case diagnostics and avoids enclose region solving.

Known substrate gaps before broad rollout: enclose may need grouped region seeds with ownership and closure validation; delete-solid may need document-state semantics beyond normal feature rebuild.

### Local topology modifiers

- `add-chamfer-feature`: first proving feature for this family. Uses `edge` and optional `face` participants, distance parameters, and role-specific diagnostics for unsupported edge chains.
- `add-face-blend-feature`: uses `face` participants and blend law parameters after chamfer proves topology modifier selection.
- `add-hole-feature`: uses `face`, `axis`, `plane`, and placement references, and should decide whether sketch points or explicit placement references own positioning.
- `add-external-thread-feature`: must decide whether external thread is cosmetic/thread annotation, fully geometric, or dual-mode.

Recommended first proving feature: `chamfer`, because it mirrors fillet-style topology targeting while proving different local-modifier parameter payloads.

Known substrate gaps before broad rollout: hole placement may need a placement-reference role distinct from `axis`; external thread may need an annotation contract separate from solid geometry.

### Transform and duplication operations

- `add-mirror-feature`: first proving feature for this family. Uses `body` or `targetBody` plus `plane` or `axis` mirror references and declares whether it creates new bodies or modifies selected bodies.
- `add-transform-feature`: must decide whether transforms initially support bodies only, or also features and sketches as timeline-level transform references.

Recommended first proving feature: `mirror`, because it proves transform references with simpler semantics than arbitrary transform matrices and timeline-level entity movement.

Known substrate gaps before broad rollout: transform likely needs structured transform operators beyond a generic `transformReference`; feature/sketch transforms may need timeline ownership rules.

## Unresolved Semantics

- `enclose`: decide the smallest useful enclosing contract: face-only regions, profile-only regions, solid-body seeds, or mixed `enclosingRegionSeed` groups. Also decide whether boolean operation intent is required for every enclose result or only when target bodies are present.
- `wrap`: decide whether wrap belongs to profile/path generation, projection, or a separate carrier-surface family. Define the carrier target role and whether accepted targets are faces, bodies, sketches, or all three.
- `transform`: decide the initial transform target scope. Body-only transforms can use current durable body references; feature and sketch transforms need timeline-level semantics and probably a different rebuild contract.
- `external thread`: decide whether the first implementation is cosmetic/thread metadata, fully modeled geometry, or a dual contract. Fully modeled geometry requires explicit performance and topology naming expectations.

## Milestone E2E Acceptance Criteria

The advanced-feature milestone is complete only when every implemented advanced feature has an extrude-like e2e flow test that covers:

- tool activation from the toolbar or command path
- required participant selection by role
- role-specific validation feedback for missing or invalid participants
- preview or structured unsupported-case diagnostics without committed-state mutation
- commit of supported payloads through the modeling service boundary
- visible feature tree or timeline presence
- resulting document, snapshot, or geometry state
- user-visible structured rejection for any contract-valid but kernel-unsupported case included in the implemented feature scope

