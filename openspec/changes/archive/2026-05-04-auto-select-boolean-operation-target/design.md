## Context

Boolean-capable feature authoring already has explicit operation fields and target-body selectors. Basic features such as extrude and revolve use `newBody`, `join`, `cut`, and `intersect` with `booleanScope`; advanced features use `create`, `add`, `subtract`, and `intersect` with participant targets. The current selector contract only gates visibility and persistence of explicit target choices.

The requested improvement is a small UX defaulting layer: when a draft feature preview clearly relates to an existing body, initialize the operation and target body to the likely CAD intent. The committed modeling contract should remain explicit, and kernel execution should not infer hidden boolean participants at commit time.

## Goals / Non-Goals

**Goals:**

- Preselect operation intent and target body for boolean-capable create flows when preview geometry gives a clear signal.
- Use the priority order: volumetric intersection -> cut/subtract, coplanar face contact -> join/add, otherwise new/create.
- Keep the heuristic conservative, cheap enough for preview-time use, and recoverable by direct user override.
- Share the rule across extrude, revolve, and future boolean-capable feature authoring definitions instead of hard-coding it in UI components.

**Non-Goals:**

- Do not change persisted feature-definition shapes or kernel boolean semantics.
- Do not add global automatic boolean inference during rebuild or commit.
- Do not try to solve full CAD intent recognition, multi-body feature planning, or advanced ambiguous-contact classification.
- Do not hide operation/target controls from the user after preselection.

## Decisions

### Keep Preselection In Feature Authoring State

Add the heuristic at the feature-session/draft seam, after a preview result and the current committed body set are available, and before form fields are presented as untouched defaults. Store the result by patching the same operation and target fields the user can already edit.

Rationale: feature authoring already owns operation fields, target selectors, draft validation, and definition building. This keeps presentational components simple and keeps the modeling service from silently inventing boolean scope during commit.

Alternative considered: infer boolean scope inside OCC execution. Rejected because it would make persisted definitions incomplete and make replay sensitive to changing document geometry.

### Use A Small Spatial Classification Contract

Introduce a domain-level classification helper that compares one preview result against existing body renderables/topology and returns one of:

- `intersects`, with a target body candidate
- `coplanarContact`, with a target body candidate
- `none`
- `unknown`

The implementation should prefer existing modeling tolerance, body ids, face plane data, and preview geometry data. It may start with simple broad-phase filtering plus an existing OCC/mesh-backed confirmation path if available. It should not require exact boolean execution for every candidate before the user commits.

Rationale: the authoring layer needs a stable, testable intent result, not direct OCC or Three.js details. `unknown` lets failures fall back to ordinary create behavior without swallowing actual preview errors elsewhere.

Alternative considered: classify directly in React form components from rendered meshes. Rejected because operation intent should be feature-domain behavior, not presentational state.

### Prioritize Stronger Evidence And Keep Tie Handling Conservative

When multiple candidates exist, prefer the candidate with the strongest intersection signal. If intersection evidence is unavailable but coplanar contact exists, prefer the largest or nearest coplanar face candidate. If candidates tie or classification is ambiguous, leave the draft as `newBody`/`create` with no target.

Rationale: accidental boolean defaults are worse than asking the user to choose manually. The heuristic should improve obvious cases without creating surprising commits.

### Preserve Manual Overrides

Track whether the operation or target-body field has been manually changed in the session. Once touched, later preview updates must not overwrite it unless the user explicitly clears/restarts the feature session.

Rationale: preview geometry can change while a user edits dimensions or selections. Automatic defaults should help at entry, not fight the user's chosen operation.

## Risks / Trade-offs

- [Risk] Preview classification may be unavailable for some feature types or adapter states. -> Mitigation: return `unknown` and keep `newBody`/`create`.
- [Risk] Coplanar contact can be confused with coincident but unrelated geometry. -> Mitigation: only apply merge/join when face/body identity and tolerance checks are reliable; otherwise fall back to new.
- [Risk] Running expensive geometry checks on every form edit could make previews feel slow. -> Mitigation: use broad-phase candidate filtering, debounce/reuse preview results, and limit exact checks to candidate bodies.
- [Risk] Users may disagree with the heuristic. -> Mitigation: keep controls visible and preserve manual overrides.

## Migration Plan

1. Add the classification result type and helper behind the feature authoring/application seam.
2. Route successful preview updates through the heuristic only for boolean-capable create sessions whose operation/target fields are still untouched.
3. Patch basic features to `cut`/`join`/`newBody` and advanced features to `subtract`/`add`/`create` with the selected target-body field populated when applicable.
4. Add focused behavior coverage for clear intersection, clear coplanar contact, fallback-to-new, and manual override preservation.

Rollback is straightforward: remove the preview-to-draft preselection call while leaving existing explicit boolean target selector behavior intact.

## Open Questions

- Which existing preview result shape exposes the lowest-cost reliable geometry for coplanar contact? If none does, the first implementation should add the smallest adapter-owned query needed for this heuristic.
- Should `intersect` ever be auto-selected? This proposal intentionally excludes it because the user requested only new/merge/cut defaults and `intersect` is less commonly inferred from placement alone.
