## 1. Sketch datum reference infrastructure

- [x] 1.1 Add stable sketch-session datum reference identities and selection-target plumbing for the origin point, sketch-local X axis, and sketch-local Y axis.
- [x] 1.2 Render read-only pickable datum point and axis guides during active sketch editing and bind hover or selection highlighting to those datum targets.
- [x] 1.3 Exclude sketch datum references from drag, delete, and profile-producing local-geometry flows.

## 2. Constraint and dimension authoring

- [x] 2.1 Extend sketch constraint target resolution so compatible point and line workflows can accept sketch datum references alongside local and projected targets.
- [x] 2.2 Update compatible constraint tools to commit durable origin-targeted and axis-targeted records without creating local proxy geometry.
- [x] 2.3 Update the Distance dimension workflow to preview and commit supported point-to-origin and line-to-axis relationships against sketch datum references.

## 3. Durable resolution and solve behavior

- [x] 3.1 Add durable datum operand storage and modeling-boundary plumbing for committed constraints and dimensions that reference the origin point or sketch axes.
- [x] 3.2 Resolve datum operands from the owning sketch-plane frame during solve, validation, rebuild, and sketch re-entry, including explicit diagnostics for invalid datum resolution.
- [x] 3.3 Update committed annotation rendering and selection so datum-targeted constraints and dimensions highlight the referenced origin point or axis.

## 4. Regression coverage

- [x] 4.1 Add schema and solver coverage for origin-targeted and axis-targeted durable records, including rotated or face-backed sketch planes.
- [x] 4.2 Add sketch-session and constraint-registry tests for datum picking, supported authoring flows, and rejected incompatible target combinations.
- [x] 4.3 Add viewport or interaction coverage for datum guide rendering, read-only behavior, hover or selection feedback, and annotation reselection.
