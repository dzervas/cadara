## 1. Regression Coverage

- [x] 1.1 Add a focused `bun:test` case that creates or patches a profile-capable feature draft with at least two selected profile references and asserts the built feature definition preserves both references in order.
- [x] 1.2 Include coverage for extrude or revolve `parameters.profiles` and at least one profile-family participant shape if the audit finds an untested multi-profile feature path.

## 2. Authoring Contract Audit

- [x] 2.1 Audit profile-consuming feature authoring definitions and record which profile inputs are single-profile by design versus multi-profile capable.
  - Audit: `extrude` and `revolve` are multi-profile capable through ordered `parameters.profiles`; `sweep` is multi-profile capable through ordered `profile` participants but OCC currently reports unsupported multi-profile geometry; `loft` requires two or more ordered `profile` participants. Revolve `axis` and sweep `path` remain single-reference by design.
- [x] 2.2 Update any multi-profile-capable feature form field that is still singular so it uses a collection-backed reference field with the correct picker cardinality.
- [x] 2.3 Update draft patching, hydration, and definition builders for any audited gap so multiple selected profiles are preserved instead of collapsed.

## 3. Runtime And Adapter Handling

- [x] 3.1 Verify contract validation accepts non-empty multi-profile collections and rejects singular `profile` payloads, empty collections, and duplicate profile references where the feature contract forbids them.
- [x] 3.2 Verify preview, commit, update, rebuild, and operation-history replay pass the full profile collection or profile participant target list through to adapter requests.
- [x] 3.3 Add or update adapter diagnostics for valid multi-profile payloads that the current geometry kernel cannot model.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
