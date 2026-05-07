## Context

Filesystem-linked documents already treat the disk file as authoritative during worker `load`: the document sync worker restores the local file binding, reads the current file, validates it as an authored model document, normalizes the loaded document id to the active document id, and refreshes the repository from that file before returning.

That fixed stale browser state, but it also means unchanged linked files are handled like replacements. The worker calls `repository.mutate` even when the validated file document matches the cached repository document it just loaded. That changes repository metadata and forces the modeling side to treat reload as a fresh authored restore, losing the opportunity to reuse cached geometry and asset availability already associated with the repository result.

`docs/testing.md` was reviewed for this proposal. The primary test lane is `logic`, because the behavior is observable at the exported document sync worker and repository boundaries without UI rendering. The seam is `src/infrastructure/workers/document-sync-worker-runtime.ts` plus the worker-backed repository load result contract.

## Goals / Non-Goals

**Goals:**

- Always read and validate the authoritative linked filesystem file before trusting cached browser repository state.
- Detect when the validated file document matches the cached repository document for the active document id.
- Return the cached repository load result unchanged when the file matches so downstream geometry/cache metadata remains reusable.
- Refresh the repository from the file when the file differs.
- Preserve explicit failure behavior for unreadable or invalid files.
- Add focused logic-lane coverage for matching, mismatching, invalid, unreadable, missing-binding, id-normalized, metadata-preserving, and no-autosync cases.

**Non-Goals:**

- Do not introduce a new file format, sidecar geometry file, or embedded geometry cache.
- Do not skip the linked file read on reload.
- Do not change browser-only document restore behavior.
- Do not change OpenCascade rebuild internals or native topology cache policy.
- Do not add UI indicators or user-facing reload controls.

## Decisions

### Compare after contract parsing and document-id normalization

The worker should compare authored documents only after the linked file has been parsed through the authored document runtime schema and normalized to the active `documentId`. This preserves the existing contract that a linked file can be rebound to the active document identity while avoiding raw text comparisons that would miss equivalent JSON formatting.

Alternative considered: compare raw file text or file metadata such as name, size, and mtime before parsing. That is cheaper, but it is not enough to prove that the cached authored document matches the authoritative file contract and would create false misses or false hits depending on serialization details.

### Reuse the repository load result on match

When the normalized file document equals the cached repository document, the worker should post the original successful `repository.load` result. It should not call `repository.mutate`, should not enqueue autosync, and should not synthesize fresh metadata.

This keeps repository heads, source, diagnostics, and asset availability tied to the cached state that produced them. It also gives the modeling service a stable signal that no authored replacement happened, which is the only path that can preserve cached geometry.

Alternative considered: still call `repository.mutate` with the matching document and rely on repository internals to detect no-op changes. That pushes the contract into every repository implementation and still risks new heads or local-change notifications for a no-op reload.

### Refresh repository state on mismatch

When the normalized file document differs from the cached repository document, the worker should keep the current behavior: mutate the repository with the file document and return that mutation result. The disk file remains authoritative, and the cached geometry is invalid for the changed authored document.

Alternative considered: return the file document directly without updating the repository. That would make the visible reload correct but leave the browser cache stale and make later tab or reload behavior inconsistent.

### Keep failure states explicit

If the bound file cannot be read or does not validate as an authored model document, the worker must return the failed load result and must not fall back to the cached repository document. The cache is only a performance optimization after the authoritative file has been proven equivalent.

Alternative considered: use cached geometry when the file is temporarily unreadable. That makes reload appear faster but violates the existing linked-file authority rule and risks silently showing stale data.

## Risks / Trade-offs

- [Risk] Authored document equality is implemented with incidental object ordering. -> Mitigation: centralize the comparison behind a named helper and feed it parsed contract documents rather than raw JSON.
- [Risk] A matching document still triggers repository notifications through an overlooked mutate path. -> Mitigation: test the worker with a repository fake that records mutation calls and emitted metadata.
- [Risk] Asset availability or diagnostics are dropped when reusing cache. -> Mitigation: assert the exact cached `loadResult` metadata, diagnostics, and asset availability are returned on match.
- [Risk] The optimization accidentally applies to browser-only documents. -> Mitigation: keep the branch behind restored filesystem binding presence and cover the no-binding path.
- [Risk] The modeling service still rebuilds despite the worker reusing cached load output. -> Mitigation: add a modeling-service level logic test only if implementation shows the worker-level contract is insufficient to prevent rebuild.

## Migration Plan

1. Add or extract a small authored-document equality helper in the domain/modeling or contract layer.
2. Update document sync worker load to compare the cached repository document with the normalized linked-file document before mutating.
3. Return the cached load result on match and the mutation result on mismatch.
4. Add logic-lane tests at the worker seam and extend repository client tests only where transport behavior changes.
5. Run `bun run test:all`.

Rollback is local: remove the equality branch and restore the previous always-mutate behavior for filesystem-bound loads.

## Open Questions

- None for proposal scope. If implementation reveals that worker-level load result reuse does not preserve geometry by itself, add the smallest modeling-service seam change and test needed to avoid restore/rebuild for unchanged repository metadata.
