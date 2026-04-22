## 1. Contract And Validation

- [x] 1.1 Add versioned geometry asset manifest types to the authored model document contract.
- [x] 1.2 Update authored document runtime validation and migration so existing documents normalize to an empty asset manifest.
- [x] 1.3 Add structured geometry asset diagnostics for missing, corrupt, unsupported, and unavailable assets.
- [x] 1.4 Add contract tests for valid manifests, duplicate/conflicting asset records, and legacy migration.

## 2. Asset Storage

- [x] 2.1 Add a content-addressed geometry asset store interface for immutable blob put/get/has operations.
- [x] 2.2 Implement IndexedDB-backed asset storage keyed by hash with byte-length and hash verification.
- [x] 2.3 Add deterministic test helpers for creating and validating medium-size asset blobs.
- [x] 2.4 Add tests for dedupe, corrupt blob rejection, missing blob lookup, and storage failure diagnostics.

## 3. Repository And Peer Sync

- [x] 3.1 Extend document repository mutation/load results to include asset availability metadata and diagnostics.
- [x] 3.2 Update Automerge repository writes so raw asset bytes stay outside the Automerge authored document envelope.
- [x] 3.3 Ensure local mutations that introduce asset refs store and verify required blobs before publishing Automerge manifests.
- [x] 3.4 Add peer asset advertisement and automatic blob transfer for manifests received through repository sync.
- [x] 3.5 Add tests proving local asset mutations are atomic and peers receive required blobs automatically.

## 4. Self-Contained Local Documents

- [x] 4.1 Define the ZIP-backed `.cadara` package layout for authored JSON plus geometry blobs.
- [x] 4.2 Update local open/save sync to read and write authored documents with included geometry assets.
- [x] 4.3 Ensure browser-local file handles and sync binding metadata remain outside saved payloads.
- [x] 4.4 Add open/save tests for documents with assets in a fresh repository profile.

## 5. Modeling Restore Integration

- [x] 5.1 Add modeling-service asset resolution hooks used by OCC restore paths.
- [x] 5.2 Surface missing/corrupt asset diagnostics without dropping authored features silently.
- [x] 5.3 Update telemetry and bug-report summaries to include asset diagnostics without raw bytes.
- [x] 5.4 Run `bun run test`, `bun run lint`, and `bun run build`.
