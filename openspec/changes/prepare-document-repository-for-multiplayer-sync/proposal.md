## Why

After the local-only `DocumentRepository` exists, the next risk is baking single-writer revision assumptions into a CRDT-backed document. This change prepares the repository and modeling boundary for multiplayer sync by introducing causal document heads, local peer updates, and explicit merge semantics without exposing Automerge to UI code.

## What Changes

- Extend `DocumentRepository` to support causal heads, change notifications, and remote/local update metadata needed for multi-writer documents.
- Add local cross-tab sync using `automerge-repo` browser networking so multiple tabs can observe and merge document changes.
- Define how concurrent CAD mutations are represented, accepted, rejected, or diagnosed when Automerge can merge the data structure but CAD semantics need additional validation.
- Replace purely linear revision assumptions at repository boundaries with head-aware revision metadata while preserving user-facing revision and snapshot fields where possible.
- Add deterministic behavior for concurrent edits to ordered authored data such as feature order, sketch records, variables, labels, and document cursor state.
- Keep multiplayer readiness behind `DocumentRepository` and modeling service contracts, with no direct Automerge handle usage in React components, editor state, or viewport rendering.

## Capabilities

### New Capabilities
- `document-repository-sync`: Defines head-aware repository behavior, local peer synchronization, change subscriptions, and merge diagnostics required for future multiplayer support.
- `collaborative-authored-document`: Defines deterministic multi-writer semantics for authored CAD document fields including ordered features, cursor state, labels, variables, and concurrent mutation validation.

### Modified Capabilities
- `durable-modeling-contract`: Mutation freshness and snapshot revision semantics must support causal heads in addition to the existing linear revision display model.

## Impact

- Affected dependencies: add `@automerge/automerge-repo-network-broadcastchannel` for local peer communication between browser tabs.
- Affected domain code: `DocumentRepository`, modeling service mutation freshness checks, editor snapshot refresh triggers, merge diagnostics, and conflict reporting.
- Affected tests: multi-repository or multi-tab-style tests for concurrent edits, deterministic ordered merges, stale/head-aware mutation outcomes, and no implementation leaks outside repository/domain boundaries.
- Out of scope: hosted collaboration servers, user accounts, permissions, presence cursors, remote awareness UI, and cloud document sharing.
