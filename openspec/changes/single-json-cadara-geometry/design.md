## Context

`.cadara` files currently have two competing meanings. Older document/file-menu and local-sync requirements describe `.cadara` as authored document JSON, while the geometry asset substrate later introduced ZIP-backed `.cadara` packages with `document.json` plus `assets/sha256/*.bin` members. That package model also made `baked-mesh` a separately stored geometry blob, which turns mesh imports into persistent file payloads instead of authored CAD data.

The desired contract is narrower: `.cadara` is one JSON object that can be inspected, synced, imported, exported, and tested as authored model data. STEP/STP is the only retained source payload because exact STEP import is a kernel-contract rebuild input. Mesh source files remain transient, and baked mesh data must not be persisted as packaged bytes.

## Goals / Non-Goals

**Goals:**
- Restore `.cadara` to a single JSON object payload for export, import, local open, local save, and autosync.
- Remove ZIP package creation/parsing/sync code in the context of this change.
- Remove `baked-mesh` as a separately packaged geometry asset format for `.cadara` persistence.
- Preserve exact STEP rebuild by representing retained STEP source data in JSON.
- If baked mesh data remains persisted, represent it as structured, format-neutral authored JSON data rather than filetype-specific bytes.
- Add a temporary “Probably Broken” chip near the STL/3MF import modal title.

**Non-Goals:**
- No backwards compatibility for ZIP `.cadara` packages.
- No migration for existing documents that rely on packaged `baked-mesh` blob assets.
- No OBJ import support.
- No guarantee that STL/3MF mesh import becomes production-ready as part of this change.

## Decisions

### `.cadara` is single JSON, not a ZIP container

Remove `src/lib/cadara-package.ts` and related ZIP/package call sites instead of keeping a dual reader/writer. Import, export, local open, local save, and autosync should all read and write one serialized authored document JSON object.

Alternative considered: keep ZIP reading as a compatibility fallback. Rejected because the change is explicitly contract-breaking and retaining compatibility would preserve the ambiguous file model.

### STEP retained data is JSON document data

STEP imports may continue to retain exact source content, but the retained payload must be represented inside the authored document JSON. The implementation can choose the smallest contract-compliant representation, such as UTF-8 STEP source text or a validated JSON string encoding, as long as the kernel rebuild path receives equivalent bytes and the authored document remains one JSON object.

Alternative considered: keep STEP files as package members. Rejected because `.cadara` must be convertible to a single JSON object.

### Baked mesh is not a packageable asset

`baked-mesh` must stop being stored as a standalone binary/blob asset in `.cadara`. If the application still persists mesh-derived geometry, it must be a structured JSON geometry record with vertices, indices, reconstruction provenance, and neutral units/orientation metadata. The record must not embed STL/3MF source bytes or an encoded file payload.

Alternative considered: continue storing baked mesh JSON as bytes behind the asset store. Rejected because it still behaves like a file sequence and hides model data from the authored document contract.

### Mesh import remains visibly suspect

Until the mesh import path is reworked or removed, the STL/3MF import review modal should show a “Probably Broken” chip near the title. This is intentionally blunt because the flow can currently commit geometry that does not meet normal CAD editability expectations.

Alternative considered: remove STL/3MF import immediately. Rejected for this proposal because the requested UI change is a warning chip, while persistence contract cleanup is the primary scope.

## Risks / Trade-offs

- Existing ZIP `.cadara` files will fail to open → This is accepted; no migration or compatibility path will be implemented.
- Removing package asset storage may temporarily reduce successful mesh restore cases → Mesh persistence is intentionally being narrowed until it can be represented as authored JSON data.
- Encoding STEP in JSON can increase file size → Prefer clarity and contract correctness over compact packaging.
- Tests that assumed self-contained package blobs will fail → Update them to assert single JSON serialization and STEP-only retained source data.
