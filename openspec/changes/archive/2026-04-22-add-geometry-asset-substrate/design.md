## Context

The current authored model document persists sketches, feature definitions, order, cursor, and body labels. OCC shapes, render records, tessellated buffers, and topology maps are derived during restore and are intentionally excluded from the durable JSON. Imported geometry introduces large immutable bytes that must be available during rebuild, while the Automerge repository currently stores a compact authored-document envelope and replaces that document on mutation.

Imported STEP files and generated baked geometry need to be portable with the document and automatically available to peers. Medium-size imports make direct Automerge fields unsuitable for raw bytes because they would inflate sync history and merge memory.

## Goals / Non-Goals

**Goals:**
- Add immutable, content-addressed geometry assets that are referenced by the authored document and included in self-contained saves.
- Keep large asset bytes outside Automerge CRDT fields while allowing peer sync to receive required blobs automatically.
- Provide explicit diagnostics for missing, corrupt, unsupported, or unavailable assets.
- Preserve the rule that render exports and OCC runtime structures are derived, not authored.

**Non-Goals:**
- Implement STEP import, STL import, 3MF import, or mesh reconstruction in this change.
- Introduce editable binary geometry inside Automerge maps or lists.
- Store browser-local file handles or sync bindings inside the authored document.

## Decisions

1. Store authored asset records as a manifest, not raw bytes.
   - The authored document gains `assets` entries with asset id, content hash, byte length, format, media type, provenance, and owner feature ids.
   - Alternative considered: embed base64 in the authored document. This is simpler but conflicts with medium-size imports and automatic collaboration.

2. Store bytes in an immutable content-addressed blob store.
   - Asset bytes are keyed by hash and validated before use.
   - Reusing the same asset hash deduplicates storage and peer transfer.
   - Alternative considered: store assets by feature id. This makes replacement and dedupe harder and weakens integrity checks.

3. Store saved `.cadara` documents as ZIP packages.
   - Local save/export writes the authored model document plus all referenced geometry blobs into one portable representation.
   - The package contains a normalized authored JSON member and content-addressed asset blob members.
   - Browser file handles remain outside the authored payload and outside the package.

4. Let Automerge advertise assets and sync blobs separately.
   - Automerge stores the small manifest and feature references.
   - The repository layer detects missing referenced assets and transfers blobs to peers outside the CRDT object graph.
   - A local mutation that introduces new asset references must store and verify the required blobs before publishing the Automerge manifest.

5. Treat missing assets as document diagnostics.
   - Restore must not silently drop features or substitute empty geometry.
   - Missing/corrupt asset diagnostics should preserve enough target/provenance context for UI and bug reports.

## Risks / Trade-offs

- [Risk] A ZIP-backed `.cadara` format changes assumptions that saved documents are plain JSON. → Mitigation: preserve a normalized authored JSON member inside the package and gate package parsing through existing document-open validation.
- [Risk] A manifest could publish before required local blobs are durable. → Mitigation: require repository mutations that introduce asset refs to verify blob storage before Automerge publication.
- [Risk] Peer blob transfer can lag behind Automerge metadata. → Mitigation: load the document with explicit missing-asset diagnostics until the required blob arrives, then refresh.
- [Risk] Large assets increase local storage pressure. → Mitigation: use content-addressed dedupe and expose storage/write failures as repository diagnostics.
- [Risk] Asset schema changes can strand existing documents. → Mitigation: version asset manifest records independently inside the authored document schema.

## Migration Plan

Existing documents migrate with an empty `assets` array. Existing local-file bindings remain external to the authored payload. Repository load should tolerate documents without assets and should only initialize blob sync when asset records are present.

## Open Questions

- Whether asset blobs are garbage-collected immediately when no current authored feature references them, or retained for undo/history until compaction.
