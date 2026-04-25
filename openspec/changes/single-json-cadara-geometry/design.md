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

### Accepted STEP import must complete before full OCC materialization

The user-visible STEP import flow cannot treat full OCC materialization as part of the synchronous "accept import" path. Once translated Cadara B-rep data has been structurally validated and persisted, the import flow needs a presentation-ready result that can clear lower-right progress and refresh the viewport without waiting for the expensive restore bridge to finish.

That means the system needs two distinct phases:

1. Persisted import completion:
   - STEP review accepted
   - Cadara B-rep baked
   - embedded asset validated
   - authored document persisted
   - viewport can render the imported geometry through a direct faceted path

2. Background kernel materialization:
   - translated Cadara B-rep is restored into OCC
   - optional topology naming and richer editability are established
   - failures surface as diagnostics rather than an indefinitely pending import

Alternative considered: keep one "import is not done until OCC restore is done" phase. Rejected because the current restore bridge can remain CPU-bound for minutes on large manifold imports, which violates the workbench requirement that accepted import progress completes deterministically.

### Persisted Cadara B-rep needs a direct faceted presentation path

Translated Cadara B-rep already persists explicit vertices, faces, and triangle indices. The workbench should use that persisted topology to build an immediate faceted render/export path for imported STEP bodies without routing back through `cadaraBrep -> ASCII STL -> StlAPI.Read` first.

This path is intentionally presentation-first, not a claim that full analytic OCC topology has already been reconstructed. It exists so imported geometry can appear in the viewport, clear import progress, and survive reopen/refresh even when full OCC materialization remains expensive.

Alternative considered: reuse only the OCC snapshot path and wait for the kernel to remesh the imported body every time. Rejected because it couples basic visibility to the slowest and least reliable part of the restore pipeline.

### OCC materialization should be backgrounded and diagnosable

After persistence, the OCC restore path should run as a background materialization phase with explicit timing and failure reporting for the major steps:

- Cadara B-rep to transient bridge payload generation
- OCC read/restore of that payload
- shell/solid construction
- tracked body creation
- topology naming setup
- snapshot/render generation

If this phase fails or exceeds a bounded time budget, the imported faceted body should remain visible and the feature should surface a materialization diagnostic instead of leaving the workbench progress surface pending forever.

Alternative considered: add timing logs only during development. Rejected because the failure mode is specifically a user-visible stuck progress state, so the system needs stable diagnostics and bounded behavior in production code paths.

### Imported faceted bodies may need reduced or deferred topology naming

Large translated STEP imports can create thousands of faces, edges, and vertices. Seeding selector-backed topology naming for every primitive during initial materialization is a likely hotspot and may not be necessary before the body is visible.

The system should allow imported faceted bodies to defer or narrow topology naming work until a downstream editability path actually needs it, or to apply a cheaper naming strategy for presentation-only imported bodies.

Alternative considered: preserve full eager topology naming behavior for imported faceted bodies. Rejected because it front-loads expensive work into the path that needs to complete quickly for the UI.

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
- A direct faceted presentation path can expose imported bodies before full OCC editability exists → Acceptable if diagnostics clearly distinguish "visible" from "fully materialized."
- Background materialization introduces another asynchronous state to manage → Acceptable because the alternative is a user-visible stuck import flow with no bounded completion behavior.
