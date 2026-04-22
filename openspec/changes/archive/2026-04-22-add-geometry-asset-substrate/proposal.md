## Why

Imported geometry cannot be stored safely as OCC runtime objects, render records, or large Automerge fields. The document format needs a self-contained, immutable asset substrate before STEP files or baked mesh reconstruction results can become durable authored geometry.

## What Changes

- Add a geometry asset manifest to the authored model document for immutable imported or generated geometry assets.
- Add content-addressed asset identities using hash, byte length, format, media type, and ownership/provenance metadata.
- Store asset bytes outside the Automerge object graph while keeping the saved `.cadara` document self-contained.
- Add repository and sync behavior that automatically transfers required geometry assets to peers when Automerge document references appear.
- Add diagnostics for missing, corrupt, unsupported, or unavailable geometry assets during document restore and peer sync.
- Keep derived render exports, OCC runtime state, topology maps, and viewport tessellation out of persisted authored assets.

## Capabilities

### New Capabilities
- `geometry-asset-substrate`: Durable storage, validation, packaging, and repository sync for immutable geometry assets referenced by authored model documents.

### Modified Capabilities
- `authored-model-document`: Authored documents gain a geometry asset manifest that participates in validation and serialization.
- `document-repository`: Repository-backed documents persist and retrieve asset blobs associated with authored documents.
- `document-repository-sync`: Peer sync advertises and transfers referenced immutable geometry blobs automatically.
- `local-file-system-document-sync`: Saved local documents remain self-contained by including geometry assets without storing browser-local file handles.
- `application-error-pipeline`: Document diagnostics and telemetry summarize geometry asset availability without attaching large asset payloads.

## Impact

- Contracts: authored document schema/runtime schema, document repository interfaces, repository worker protocol, diagnostics.
- Storage: IndexedDB-backed Automerge repository gains a companion immutable blob store keyed by asset hash.
- File sync: `.cadara` persistence needs a self-contained representation for authored JSON plus geometry assets.
- Modeling restore: OCC restore paths must request asset bytes by ID and fail visibly when required assets are missing or invalid.
- Testing: contract validation, repository sync, local file save/load, peer sync, and missing-asset diagnostics.
