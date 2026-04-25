## Why

The `.cadara` document format drifted from a single authored JSON document into a ZIP package that can contain arbitrary geometry asset blobs. That conflicts with the desired kernel contract: Cadara documents must be inspectable and representable as one JSON object, with imported STEP geometry translated into kernel-neutral Cadara-owned B-rep data instead of retained source files or kernel-native serializations.

## What Changes

- **BREAKING**: Remove ZIP-backed `.cadara` package behavior and the code paths that create, parse, open, save, or sync `.cadara` as a sequence of files.
- **BREAKING**: Stop treating `baked-mesh` assets as separately stored geometry blobs in `.cadara` files.
- **BREAKING**: Do not keep backwards compatibility for existing ZIP `.cadara` packages or old documents that require external packaged mesh blobs.
- Keep STEP/STP imports as kernel-contract geometry assets, but store translated Cadara B-rep JSON rather than STEP source text, bytes, OpenCascade-specific serialized BRep strings, or package members.
- Require any persisted baked mesh geometry to live inside the single authored JSON object as structured, format-neutral geometry data, roughly alongside the rest of authored geometry, not as filetype-specific bytes.
- Keep mesh source files transient: STL and 3MF source bytes are not saved in `.cadara`.
- Add a temporary “Probably Broken” chip near the title of STL/3MF import modal pages so users understand the current mesh import path is not trustworthy while the contract is corrected.

## Capabilities

### New Capabilities
- `single-json-cadara-geometry`: Defines the single-object `.cadara` persistence contract for translated STEP B-rep data and structured baked mesh geometry.

### Modified Capabilities
- `geometry-asset-substrate`: Remove self-contained ZIP package requirements and constrain retained asset behavior to the single JSON document contract.
- `local-file-system-document-sync`: Replace ZIP-backed autosync/open behavior with single JSON read/write behavior and no compatibility path for packaged `.cadara` files.
- `mesh-baked-geometry-import`: Clarify that mesh source files and baked mesh results are not persisted as separate file/blob assets.
- `workbench-document-file-menu`: Update document import/export expectations from ZIP package handling to single JSON `.cadara` payloads.

## Impact

- `src/lib/cadara-package.ts` and related ZIP helpers/tests should be removed in the context of this change.
- `.cadara` import/export, local file sync, repository asset collection, and package MIME handling must be simplified to single JSON payloads.
- Geometry asset contracts and runtime schemas must stop allowing arbitrary packageable `baked-mesh` blobs for `.cadara` persistence, and must reject kernel-native BRep blob/string storage in translated STEP geometry.
- Existing ZIP `.cadara` files and packaged `baked-mesh` assets are intentionally not migrated.
- The STL/3MF import modal UI gains a visible “Probably Broken” chip near its title.
