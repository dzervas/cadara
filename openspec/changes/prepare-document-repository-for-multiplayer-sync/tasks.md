## 1. Repository Metadata

- [ ] 1.1 Extend repository state metadata with causal document heads and change-source information.
- [ ] 1.2 Add repository subscription events for local and peer-originated authored document changes.
- [ ] 1.3 Add tests for subscribing, unsubscribing, and receiving head changes without exposing Automerge handles.

## 2. Local Peer Sync

- [ ] 2.1 Add `@automerge/automerge-repo-network-broadcastchannel` and same-origin browser peer sync using `BroadcastChannelNetworkAdapter`.
- [ ] 2.2 Wire peer-originated repository notifications to editor snapshot refresh through the modeling service.
- [ ] 2.3 Add multi-repository or multi-tab-style tests proving peer changes merge and survive refresh from local storage.

## 3. Head-Aware Modeling Freshness

- [ ] 3.1 Add repository head metadata to snapshot provenance used by modeling mutations.
- [ ] 3.2 Map current-head mutations to accepted/rejected outcomes using existing modeling validation and rebuild paths.
- [ ] 3.3 Report stale-head or conflict outcomes when a local mutation targets a snapshot superseded by peer changes.

## 4. Collaborative Authored Document Semantics

- [ ] 4.1 Define deterministic concurrent feature insertion, movement, deletion, and order normalization behavior.
- [ ] 4.2 Define concurrent scalar edit semantics for labels, variables, settings, and cursor state.
- [ ] 4.3 Add tests for concurrent feature insertions, move/delete races, rename conflicts, cursor validation, and variable conflicts.

## 5. Merge Validation Diagnostics

- [ ] 5.1 Rebuild merged authored document state after peer changes and surface explicit merge/rebuild diagnostics.
- [ ] 5.2 Add stable diagnostic codes for invalid dependencies, missing cursor targets, unresolved variable cycles, and invalid durable references caused by merge.
- [ ] 5.3 Verify merge diagnostics do not silently delete, reorder, or retarget authored records.

## 6. Verification

- [ ] 6.1 Add boundary tests preventing Automerge and `automerge-repo` networking imports outside repository implementation modules.
- [ ] 6.2 Update editor runtime tests for repository-driven snapshot refresh after peer changes.
- [ ] 6.3 Run `bun run test`.
- [ ] 6.4 Run `bun run lint`.
