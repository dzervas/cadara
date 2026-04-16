## Context

The active `profile-based-feature-contract` already requires extrude and revolve definitions to use `parameters.profiles` instead of a singular `parameters.profile`. The remaining risk is drift: newer profile-consuming feature slices can declare profile participants or form fields without consistently exposing multi-profile selection, preserving order, or proving the behavior with a focused test.

This change treats multi-profile support as a feature-authoring contract for every feature that accepts multiple profiles, while leaving features that are intrinsically single-profile unchanged.

## Goals / Non-Goals

**Goals:**

- Audit profile-consuming feature definitions and identify which profile roles support more than one profile.
- Ensure multi-profile-capable authoring definitions expose collection-backed profile form fields and preserve selected profile order.
- Ensure draft hydration and definition building do not collapse multiple profile references to a single profile.
- Add a focused `bun:test` regression that selects multiple profiles for a profile-capable feature and asserts the emitted contract payload preserves the expected profile collection.

**Non-Goals:**

- Add support for whole-sketch inference or implicit profile discovery.
- Change profile geometry semantics for features that require exactly one profile.
- Replace advanced-solid participant modeling for sweep, loft, or future advanced features.
- Broaden OCC support beyond returning explicit diagnostics for valid but unsupported multi-profile geometry.

## Decisions

Use feature-owned cardinality as the source of truth. Extrude and revolve can continue using `parameters.profiles`; advanced profile-family features should continue declaring profile participants with explicit cardinality. This avoids forcing every feature into the same parameter shape when some features already use role-based participant arrays.

Keep authoring fields collection-backed where multiple profiles are accepted. A profile field that allows more than one profile must use the existing reference collection form behavior, including ordered values where the target feature cares about sequence. This is simpler than adding a special multi-profile UI path per feature.

Add a regression at the feature-authoring boundary first. That test should build or patch a draft with at least two profile references, then assert the resulting feature definition contains the same two references in the expected collection or participant role. This catches the common failure mode before adapter-specific geometry support is involved.

Do not require every profile-consuming feature to accept multiple profiles. Sweep-like features may intentionally require one profile plus another role such as a path. Their contract should remain explicit about cardinality rather than silently accepting extra profile targets.

## Risks / Trade-offs

- [Existing code may already satisfy extrude/revolve] -> Mitigate by making the implementation task an audit plus a regression test, then changing only gaps found by the test.
- [Different feature families store profile collections differently] -> Mitigate by validating each feature against its declared contract shape instead of introducing a one-size-fits-all parameter format.
- [Adapter support may lag authoring support] -> Mitigate by preserving profile collections in requests and returning explicit unsupported-profile-group diagnostics when geometry cannot be built.
