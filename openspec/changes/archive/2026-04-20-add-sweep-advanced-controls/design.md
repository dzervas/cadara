## Context

Sweep currently captures profile, path, optional guide curves, operation intent, target bodies, and an untyped options object. Onshape exposes additional sweep controls for profile control, twist by turns/angle/pitch, and scale. Its scale behavior proportionally transforms the profile size at the end of the sweep path.

## Goals / Non-Goals

**Goals:**
- Add typed sweep options for profile control, twist, and scale.
- Represent twist as one active discriminated variant.
- Add any reference participants required by lock profile faces or lock profile direction.
- Implement OCC geometry rather than only returning unsupported diagnostics.

**Non-Goals:**
- Do not add surface or thin sweep creation.
- Do not add merge-scope behavior beyond existing operation intent and target-body semantics.
- Do not preserve inactive twist values in durable feature definitions.

## Decisions

1. Model twist as a discriminated union.

   Durable sweep definitions should contain exactly one active twist shape: none, turns, angle, or pitch. UI draft state may remember previous values, but buildDefinition must persist only the active variant.

2. Model scale as end-scale.

   Sweep scale follows Onshape-like behavior: a positive scale factor proportionally transforms the profile size at the end of the sweep path. Factor `1` is equivalent to no scale.

3. Add explicit lock references.

   `lockProfileFaces` requires one or more durable face references. `lockProfileDirection` requires exactly one durable edge or construction reference. Mate-connector-like direction references can be added later if the public reference contract grows them.

4. Define a minimum implemented geometry matrix.

   This change must successfully execute default profile control, keep profile orientation, lock profile faces, lock profile direction, twist by turns, twist by angle, twist by pitch, and non-1 end scale in at least one representative profile/path case each. More complex combinations can return diagnostics, but these baseline controls cannot be treated as unsupported.

## Risks / Trade-offs

- Lock profile behavior depends on path frame construction -> define frame behavior in tests around representative paths.
- Pitch semantics can be confused with total turns -> document pitch as frequency for full revolutions along the path and validate units consistently.
- OCC support may expose unsupported combinations -> implement the minimum matrix above and return explicit diagnostics for more complex invalid geometry.
