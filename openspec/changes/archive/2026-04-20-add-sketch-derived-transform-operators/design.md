## Context

Existing part-mode mirror and transform features operate on bodies. The requested tools are sketch-mode operators. The user explicitly requires durable referenced and related geometry, so static duplication is out of scope. The sketch graph must represent a relationship between seed geometry, transform parameters, and generated/derived geometry.

## Goals / Non-Goals

**Goals:**
- Add sketch-mode mirror, linear pattern, circular pattern, and transform operators.
- Persist durable relationships from derived geometry back to selected seed geometry and transform references.
- Update or preserve supported derived geometry when seed geometry changes.
- Make derived geometry selectable, renderable, persistable, and usable in profiles where supported.

**Non-Goals:**
- Reuse part-mode feature contracts for sketch entity transforms.
- Create one-time static copies as the accepted behavior.
- Implement every possible associative solve case in the first slice.

## Decisions

1. Add explicit sketch derivation relationships instead of static copies.

   Rationale: static copies fail the user's requirement. Explicit derivation records make seed references, parameters, and derived outputs inspectable and testable.

2. Keep derived output geometry addressable.

   Rationale: users need to select, style, profile, and inspect derived geometry. The implementation can decide whether outputs are stored records, generated views, or hybrid records, but target identity must be stable.

3. Treat unsupported associative updates as diagnostics.

   Rationale: mirror and pattern relationships can cross many entity families. It is better to preserve valid records with clear diagnostics than silently detach derived geometry.

## Risks / Trade-offs

- [Associative relationships can complicate direct editing] -> Define which edits apply to seeds, derived outputs, or transform parameters and reject ambiguous direct edits with feedback.
- [Profile extraction over derived geometry may duplicate or miss regions] -> Add tests for supported loops and diagnostics for unsupported derived profiles.
- [Solver constraints may conflict with derivation relationships] -> Keep derivation evaluation explicit and report conflicts instead of mutating seed geometry silently.
- [History rollback must preserve relationship consistency] -> Cover operation history and cursor movement before broad UI polish.

## Migration Plan

No migration is needed for existing sketches. New derivation records should be ignored only by versions that do not support this change; within this version they must validate or report diagnostics explicitly.
