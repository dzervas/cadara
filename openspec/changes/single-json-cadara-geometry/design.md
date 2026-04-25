## Context

`.cadara` files currently have two competing meanings. Older document/file-menu and local-sync requirements describe `.cadara` as authored document JSON, while the geometry asset substrate later introduced ZIP-backed `.cadara` packages with `document.json` plus `assets/sha256/*.bin` members. That package model also made `baked-mesh` a separately stored geometry blob, which turns mesh imports into persistent file payloads instead of authored CAD data.

The desired contract is narrower: `.cadara` is one JSON object that can be inspected, synced, imported, exported, and tested as authored model data. STEP/STP source files are transient import inputs; persistence stores the translated Cadara B-rep geometry needed to rebuild imported bodies. Mesh source files remain transient, and baked mesh data must not be persisted as packaged bytes.

## Goals / Non-Goals

**Goals:**
- Restore `.cadara` to a single JSON object payload for export, import, local open, local save, and autosync.
- Remove ZIP package creation/parsing/sync code in the context of this change.
- Remove `baked-mesh` as a separately packaged geometry asset format for `.cadara` persistence.
- Preserve STEP import rebuild by translating STEP source into Cadara B-rep JSON before persistence.
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

### STEP imports bake into Cadara B-rep JSON

STEP imports must not retain original STEP text or bytes. The import path should treat STEP files as transient exchange inputs, translate them through the active kernel into a Cadara-owned B-rep JSON representation, and persist that translated geometry inside the authored document.

The persisted Cadara B-rep representation must be kernel-neutral. It may contain explicit geometry and topology records such as solids, shells, faces, loops, coedges, edges, vertices, surfaces, curves, and tessellated fallback triangles, but it must not contain OpenCascade-specific field names, kernel-native serialized payloads, opaque geometry strings, or byte sequences. Any kernel-specific bridge format belongs only in transient runtime conversion code and must be derived from the Cadara JSON when needed.

Alternative considered: keep STEP text inside JSON. Rejected because it preserves a file-format payload instead of storing Cadara geometry.

Alternative considered: persist OpenCascade ASCII BRep inside JSON. Rejected because it leaks the current kernel into the document contract and requires future kernels to parse an OCCT-native serialization.

### STEP commit validates embedded assets before kernel materialization

Prepared STEP import commits validate the generated Cadara B-rep JSON structurally before persistence instead of rebuilding that generated JSON through OpenCascade as a pre-commit gate. The validation checks the authored document contract, embedded geometry presence, content hash, byte length, and selected-solid references. Runtime OCC materialization remains a restore/render concern after the authored document is safely persisted.

Alternative considered: require `validateAuthoredModelDocument` to fully restore the translated B-rep through the OCC worker before repository mutation. Rejected because large faceted imports can spend minutes in the Cadara-B-rep-to-OCC bridge and topology naming setup after baking has already succeeded, leaving the import progress unresolved even though the persisted authored geometry is structurally valid.

### Baked mesh is not a packageable asset

`baked-mesh` must stop being stored as a standalone binary/blob asset in `.cadara`. If the application still persists mesh-derived geometry, it must be a structured JSON geometry record with vertices, indices, reconstruction provenance, and neutral units/orientation metadata. The record must not embed STL/3MF source bytes or an encoded file payload.

Alternative considered: continue storing baked mesh JSON as bytes behind the asset store. Rejected because it still behaves like a file sequence and hides model data from the authored document contract.

### Mesh import remains visibly suspect

Until the mesh import path is reworked or removed, the STL/3MF import review modal should show a “Probably Broken” chip near the title. This is intentionally blunt because the flow can currently commit geometry that does not meet normal CAD editability expectations.

Alternative considered: remove STL/3MF import immediately. Rejected for this proposal because the requested UI change is a warning chip, while persistence contract cleanup is the primary scope.

## Risks / Trade-offs

- Existing ZIP `.cadara` files will fail to open → This is accepted; no migration or compatibility path will be implemented.
- Removing package asset storage may temporarily reduce successful mesh restore cases → Mesh persistence is intentionally being narrowed until it can be represented as authored JSON data.
- Encoding translated B-rep JSON can increase file size → Prefer clarity and contract correctness over compact packaging.
- Tests that assumed self-contained package blobs will fail → Update them to assert single JSON serialization and translated STEP geometry data.
