import {
  collectAssetAvailability,
  storeGeometryAssetInputsForManifest,
} from "@/application/modeling/geometry-asset-persistence";
import { createIndexedDbGeometryAssetStore } from "@/infrastructure/persistence/indexeddb-geometry-asset-store";
import {
  initializeWasm,
  parseAutomergeUrl,
  Repo,
} from "@automerge/automerge-repo/slim";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { getActorId, getMissingDeps } from "@automerge/automerge/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import type {
  AuthoredModelDocument,
  AuthoredModelDocumentDiagnostic,
} from "@/contracts/modeling/authored-document";
import type { DocumentId } from "@/contracts/shared/ids";
import type {
  GeometryAssetHash,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";

import type {
  DocumentRepository,
  GeometryAssetDocumentRepository,
  DocumentRepositoryChangeEvent,
  DocumentRepositoryChangeSource,
  DocumentRepositoryMetadata,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMutationResult,
  DocumentRepositoryRestoreStatus,
} from "@/contracts/modeling/document-repository";
import {
  type GeometryAssetStore,
} from "@/core/modeling/geometry-asset-store";

import { AuthoredActionHistory } from "@/core/modeling/authored-action-history";
import { describeBlockedDocumentAction } from "@/core/modeling/document-action-blocked";
import {
  applyCollaborativeWrites,
  DocumentProvenanceConflict,
  createCollaborativeDocument,
  documentActionState,
  materializeCollaborativeDocument,
  updateDocumentProvenance,
  type CollaborativeDocument,
} from "@/core/modeling/collaborative-document";
import type { AuthoredActionResult } from "@/contracts/modeling/authored-actions";
import {
  createLocalStorageDocumentRepositoryUrlStore,
  MemoryDocumentRepositoryUrlStore,
  type DocumentRepositoryUrlStore,
} from "./document-repository-url-store";
import { AutomergeChunkKeyRecorder } from "./automerge-chunk-key-recorder";
import {
  MATERIALIZED_DOCUMENT_FORMAT,
  parseMaterializedDocumentRecord,
  type MaterializedDocumentEvent,
  type MaterializedDocumentRecord,
  type MaterializedDocumentStore,
} from "./indexeddb-materialized-document-store";

export interface AutomergeHandleLike<T> {
  readonly url: AutomergeUrl;
  readonly documentId: string;
  whenReady(): Promise<void>;
  doc(): T;
  heads?(): readonly string[];
  isReady?(): boolean;
  off?(event: "change", callback: () => void): void;
  change(callback: (document: T) => void): void;
  on(event: "change", callback: () => void): void;
}
export interface AutomergeRepositoryLike {
  create<T>(initialValue?: T): AutomergeHandleLike<T>;
  find<T>(id: AutomergeUrl): Promise<AutomergeHandleLike<T>>;
  findWithProgress?<T>(id: AutomergeUrl): { handle: AutomergeHandleLike<T> };
  delete(id: AutomergeUrl): void;
  flush?(documents?: string[]): Promise<void>;
}
/** The Automerge module's bytes. initializeBase64Wasm decodes them with a
 * callback per byte, about 170 ms of a reload's critical path for 2.7 MB. */
function decodeAutomergeWasm() {
  const binary = atob(automergeWasmBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
let wasm: Promise<void> | undefined;
function prepare() {
  wasm ??= initializeWasm(decodeAutomergeWasm()).catch((error: unknown) => {
    wasm = undefined;
    throw error;
  });
  return wasm;
}
/** What a load read from storage: a cache record that provably is the
 * stored document, or the Automerge handle being loaded. */
type StoredDocumentRead =
  | { kind: "materialized"; record: MaterializedDocumentRecord }
  | {
      kind: "automerge";
      handle: Promise<AutomergeHandleLike<CollaborativeDocument>>;
    };

function sameStrings(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** A fresh Automerge-style actor id (32 hex digits). */
function createSessionActorId() {
  return crypto.randomUUID().replaceAll("-", "");
}

export interface IndexedDbAutomergeDocumentRepositoryOptions {
  repo?: AutomergeRepositoryLike;
  /** With `repo`: the recorder that repo stores through; the
   * materialized-document cache needs it. Without `repo` the repository
   * builds both over IndexedDB. */
  chunkKeyRecorder?: AutomergeChunkKeyRecorder;
  /** cadara-dx2k.17: answer reloads from the last published document while
   * the stored chunk keys are those it was materialized from. */
  materializedDocuments?: {
    store: MaterializedDocumentStore;
    /** This build's identity (see MaterializedDocumentRecord.compatibility). */
    compatibility: string;
    report(event: MaterializedDocumentEvent): void;
  };
  urlStore?: DocumentRepositoryUrlStore;
  databaseName?: string;
  storeName?: string;
  assetStore?: GeometryAssetStore;
  localPeerSync?: false | { channelName?: string; peerWaitMs?: number };
}
export class IndexedDbAutomergeDocumentRepository implements GeometryAssetDocumentRepository {
  private repo: AutomergeRepositoryLike | null;
  private readonly urlStore: DocumentRepositoryUrlStore;
  private readonly assetStore: GeometryAssetStore;
  private readonly handles = new Map<
    DocumentId,
    AutomergeHandleLike<CollaborativeDocument>
  >();
  private readonly actions = new Map<DocumentId, AuthoredActionHistory>();
  private readonly statuses = new Map<
    DocumentId,
    DocumentRepositoryRestoreStatus
  >();
  private readonly metadata = new Map<DocumentId, DocumentRepositoryMetadata>();
  private readonly durabilityFailures = new Map<
    DocumentId,
    Extract<DocumentRepositoryRestoreStatus, { kind: "failed" }>
  >();
  private readonly publicationVersions = new Map<DocumentId, number>();
  private readonly publishedEvents = new Map<
    DocumentId,
    DocumentRepositoryChangeEvent
  >();
  private readonly listeners = new Map<
    DocumentId,
    Set<(event: DocumentRepositoryChangeEvent) => void>
  >();
  private readonly localChanges = new Set<DocumentId>();
  /** Missing copies can still arrive from a peer after initial discovery ends. */
  private readonly missingCopyWatches = new Map<DocumentId, () => void>();
  /** Released by releaseSupersededHandle until a load or initialize installs a handle. */
  private readonly supersededDocuments = new Set<DocumentId>();
  private readonly queues = new Map<DocumentId, Promise<unknown>>();
  /** Reads started by preload; the next load of the same URL takes its handle. */
  private readonly preloads = new Map<
    DocumentId,
    { url: AutomergeUrl; read: Promise<StoredDocumentRead> }
  >();
  /**
   * The actor id a load answered from the materialized-document cache
   * reported before the Automerge handle (and its own actor) existed. It
   * stays this session's reported actor until another handle replaces it,
   * so provenance keyed by it does not change mid-session.
   */
  private readonly sessionActorIds = new Map<DocumentId, string>();
  /** A stored copy that failed to load after the cache answered; writes refuse with it. */
  private readonly materializedAnswerFailures = new Map<
    DocumentId,
    Extract<DocumentRepositoryRestoreStatus, { kind: "failed" }>
  >();
  /** Latest publication per document awaiting its cache record. */
  private readonly pendingMaterializedWrites = new Map<
    DocumentId,
    {
      handle: AutomergeHandleLike<CollaborativeDocument>;
      document: AuthoredModelDocument;
      heads: string[];
    }
  >();
  private readonly materializedWriters = new Set<DocumentId>();
  /** Starts the Automerge load queued behind a cached answer (see settleLoad). */
  private readonly deferredLoads = new Map<DocumentId, () => void>();
  private chunkKeyRecorder: AutomergeChunkKeyRecorder | null;
  private readonly options: IndexedDbAutomergeDocumentRepositoryOptions;
  constructor(options: IndexedDbAutomergeDocumentRepositoryOptions = {}) {
    this.options = options;
    this.repo = options.repo ?? null;
    this.chunkKeyRecorder = options.chunkKeyRecorder ?? null;
    this.urlStore = options.urlStore ?? new MemoryDocumentRepositoryUrlStore();
    this.assetStore =
      options.assetStore ??
      createIndexedDbGeometryAssetStore({
        databaseName: `${options.databaseName ?? "cad-authored-documents"}-geometry-assets`,
      });
  }
  getAutomergeRepository() {
    return this.getRepo();
  }
  /** The recorder the repository's own Repo stores through; null for an injected Repo without one. */
  private getChunkKeyRecorder() {
    if (!this.chunkKeyRecorder && !this.options.repo)
      this.chunkKeyRecorder = new AutomergeChunkKeyRecorder(
        new IndexedDBStorageAdapter(
          this.options.databaseName ?? "cad-authored-documents",
          this.options.storeName ?? "documents",
        ),
      );
    return this.chunkKeyRecorder;
  }
  private async getRepo() {
    if (!this.repo) {
      await prepare();
      this.repo ??= new Repo({
        storage: this.getChunkKeyRecorder()!,
        network:
          this.options.localPeerSync && typeof BroadcastChannel !== "undefined"
            ? [
                new BroadcastChannelNetworkAdapter({
                  channelName:
                    this.options.localPeerSync.channelName ??
                    "cad-authored-documents",
                  peerWaitMs: this.options.localPeerSync.peerWaitMs ?? 100,
                }),
              ]
            : [],
      }) as AutomergeRepositoryLike;
    }
    return this.repo;
  }
  private enqueue<T>(
    documentId: DocumentId,
    action: () => Promise<T>,
  ): Promise<T> {
    // A request queued behind a deferred Automerge load starts that load.
    this.settleLoad(documentId);
    const previous = this.queues.get(documentId) ?? Promise.resolve();
    // A rejected operation is returned to its caller; it must not poison subsequent transactions.
    const next = previous.then(action, action);
    this.queues.set(documentId, next);
    return next;
  }
  async preload(documentId: DocumentId) {
    const url = this.urlStore.get(documentId);
    if (!url || this.handles.has(documentId) || this.preloads.has(documentId))
      return;
    const read = this.readStoredDocument(documentId, url);
    // The load that takes this read awaits it and reports its failure.
    read
      .then((stored) =>
        stored.kind === "automerge" ? stored.handle : undefined,
      )
      .catch(() => undefined);
    this.preloads.set(documentId, { url, read });
  }
  /**
   * The cache record when it provably is the stored document, otherwise
   * the started Automerge load. The cache check reads no Automerge data, so
   * a hit leaves the worker free to answer before the Automerge load.
   */
  private readStoredDocument(
    documentId: DocumentId,
    url: AutomergeUrl,
  ): Promise<StoredDocumentRead> {
    const load = (): StoredDocumentRead => ({
      kind: "automerge",
      handle: this.getRepo().then((repo) =>
        repo.find<CollaborativeDocument>(url),
      ),
    });
    if (!this.options.materializedDocuments || !this.getChunkKeyRecorder())
      return Promise.resolve(load());
    return this.readMaterializedDocument(documentId, url).then((record) =>
      record ? { kind: "materialized", record } : load(),
    );
  }
  private async readMaterializedDocument(
    documentId: DocumentId,
    url: AutomergeUrl,
  ) {
    const cache = this.options.materializedDocuments;
    const recorder = this.getChunkKeyRecorder();
    if (!cache || !recorder) return null;
    try {
      const [value, storedKeys] = await Promise.all([
        cache.store.read(url),
        recorder.storedChunkKeys(parseAutomergeUrl(url).documentId),
      ]);
      if (value === undefined) {
        cache.report({ kind: "miss", automergeUrl: url, reason: "absent" });
        return null;
      }
      const record = parseMaterializedDocumentRecord(value, {
        compatibility: cache.compatibility,
        automergeUrl: url,
      });
      if (typeof record === "string") {
        cache.report({
          kind: "degraded",
          automergeUrl: url,
          reason: `corrupt-entry: ${record}`,
        });
        return null;
      }
      // The Automerge load reports the mismatch with its usual reason.
      if (record.document.documentId !== documentId) {
        cache.report({
          kind: "miss",
          automergeUrl: url,
          reason: "identity-mismatch",
        });
        return null;
      }
      // Another tab's write, a compaction, a reset or lost storage.
      if (!sameStrings(storedKeys, record.chunkKeys)) {
        cache.report({
          kind: "miss",
          automergeUrl: url,
          reason: "chunk-keys-changed",
        });
        return null;
      }
      cache.report({ kind: "hit", automergeUrl: url });
      return record;
    } catch (error) {
      cache.report({
        kind: "degraded",
        automergeUrl: url,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  /**
   * Awaits a stored document's handle and checks it is a complete document
   * of this identity: the diagnostic when not.
   */
  private async openStoredHandle(
    documentId: DocumentId,
    url: AutomergeUrl,
    found: Promise<AutomergeHandleLike<CollaborativeDocument>>,
  ): Promise<
    | { ok: true; handle: AutomergeHandleLike<CollaborativeDocument> }
    | { ok: false; diagnostic: AuthoredModelDocumentDiagnostic }
  > {
    let handle: AutomergeHandleLike<CollaborativeDocument>;
    try {
      handle = await found;
    } catch (error) {
      // automerge-repo 2.5 reports missing chunks (and no peer holding
      // them) only through this message.
      if (
        error instanceof Error &&
        error.message === `Document ${url} is unavailable`
      ) {
        this.watchMissingCopy(documentId, url);
        return {
          ok: false,
          diagnostic: {
            reasonCode: "automerge-document-missing",
            message:
              "This browser no longer has its stored copy of the document, for example because site data was cleared. Reset stored history to start fresh.",
          },
        };
      }
      throw error;
    }
    await handle.whenReady();
    const stored = handle.doc();
    // cadara-rnsb (CADARA-14): changes whose base snapshot was deleted
    // (another tab reset the document, then a tab still holding it
    // wrote again) stay queued, so the document reads as empty.
    if (
      (!stored.format || !stored.authored) &&
      getMissingDeps(stored, []).length > 0
    )
      return {
        ok: false,
        diagnostic: {
          reasonCode: "automerge-document-incomplete",
          message:
            "The stored copy of this document is incomplete, typically because it was reset or cleared in another tab. Reset stored history to start fresh.",
        },
      };
    const parsed = parseAuthoredModelDocument(
      materializeCollaborativeDocument(stored),
    );
    if (!parsed.ok) return { ok: false, diagnostic: parsed.diagnostic };
    if (parsed.document.documentId !== documentId)
      return {
        ok: false,
        diagnostic: {
          reasonCode: "identity-mismatch",
          message: "Document identity does not match.",
        },
      };
    return { ok: true, handle };
  }
  /**
   * Automerge's unavailable handle can become ready when a late peer arrives.
   * Observe that handle without accepting any local seed or writes as a copy.
   */
  private watchMissingCopy(documentId: DocumentId, url: AutomergeUrl) {
    this.clearMissingCopyWatch(documentId);
    const handle =
      this.repo?.findWithProgress?.<CollaborativeDocument>(url).handle;
    if (!handle) return;
    const current = () =>
      this.missingCopyWatches.get(documentId) === stop &&
      this.urlStore.get(documentId) === url &&
      !this.handles.has(documentId);
    const recover = () => {
      // Automerge emits change before its ready transition, so inspect readiness
      // in the queued turn, not inside its synchronous change callback.
      void this.enqueue(documentId, async () => {
        if (!current()) {
          if (this.missingCopyWatches.get(documentId) === stop) stop();
          return;
        }
        if (!handle.isReady?.()) return;
        stop();
        try {
          const opened = await this.openStoredHandle(
            documentId,
            url,
            Promise.resolve(handle),
          );
          if (
            this.urlStore.get(documentId) !== url ||
            this.handles.has(documentId)
          )
            return;
          if (!opened.ok) {
            this.fail(documentId, opened.diagnostic);
            return;
          }
          this.materializedAnswerFailures.delete(documentId);
          this.install(documentId, opened.handle);
          await this.publish(documentId, opened.handle, "peer");
        } catch (error) {
          this.failure(documentId, "automerge-load-failed", error);
        }
      });
    };
    const stop = () => {
      handle.off?.("change", recover);
      if (this.missingCopyWatches.get(documentId) === stop)
        this.missingCopyWatches.delete(documentId);
    };
    this.missingCopyWatches.set(documentId, stop);
    handle.on("change", recover);
    // The handle may have become ready between find's rejection and attachment.
    recover();
  }
  private clearMissingCopyWatch(documentId: DocumentId) {
    this.missingCopyWatches.get(documentId)?.();
  }
  load(
    input: Parameters<DocumentRepository["load"]>[0],
  ): Promise<DocumentRepositoryLoadResult> {
    return this.enqueue(input.documentId, async () => {
      this.clearMissingCopyWatch(input.documentId);
      const preload = this.preloads.get(input.documentId);
      this.preloads.delete(input.documentId);
      this.materializedAnswerFailures.delete(input.documentId);
      try {
        // Never flushes a released handle's pending durability retry.
        this.releaseSupersededHandle(input.documentId);
        const existing = this.handles.get(input.documentId);
        const url = this.urlStore.get(input.documentId);
        if (!existing && !url)
          return this.seed(input.documentId, input.seedDocument);
        let found: Promise<AutomergeHandleLike<CollaborativeDocument>>;
        if (existing) found = Promise.resolve(existing);
        else {
          const read = await (preload?.url === url
            ? preload.read
            : this.readStoredDocument(input.documentId, url!));
          if (read.kind === "materialized")
            return this.answerFromMaterializedDocument(
              input.documentId,
              url!,
              read.record,
            );
          found = read.handle;
        }
        const opened = await this.openStoredHandle(
          input.documentId,
          url ?? existing!.url,
          found,
        );
        if (!opened.ok) return this.fail(input.documentId, opened.diagnostic);
        const { handle } = opened;
        // Another handle reports its own Automerge actor.
        if (!existing) this.sessionActorIds.delete(input.documentId);
        const repo = await this.getRepo();
        this.install(input.documentId, handle);
        // Explicit load retries unresolved durability, never merely relabels live state as restored.
        if (this.durabilityFailures.has(input.documentId)) {
          await repo.flush?.([handle.documentId]);
          this.durabilityFailures.delete(input.documentId);
        }
        return this.publish(input.documentId, handle, "restore");
      } catch (error) {
        if (this.durabilityFailures.has(input.documentId))
          return this.durabilityFailed(input.documentId, error);
        return this.failure(input.documentId, "automerge-load-failed", error);
      }
    });
  }
  initialize(
    input: Parameters<DocumentRepository["initialize"]>[0],
  ): Promise<DocumentRepositoryMutationResult> {
    return this.enqueue(input.documentId, async () => {
      const unresolved = this.durabilityFailures.get(input.documentId);
      if (unresolved) return { ok: false, status: unresolved };
      try {
        const parsed = parseAuthoredModelDocument(
          structuredClone(input.document),
        );
        if (!parsed.ok) return this.fail(input.documentId, parsed.diagnostic);
        const stored = await storeGeometryAssetInputsForManifest(
          this.assetStore,
          parsed.document.assets.records,
          input.assets ?? [],
        );
        if (!stored.ok)
          return this.fail(input.documentId, {
            reasonCode: stored.diagnostic.code,
            message: stored.diagnostic.message,
          });
        return await this.seed(input.documentId, parsed.document);
      } catch (error) {
        return this.failure(
          input.documentId,
          "automerge-initialize-failed",
          error,
        );
      }
    });
  }
  private async seed(
    documentId: DocumentId,
    document: AuthoredModelDocument,
  ): Promise<DocumentRepositoryLoadResult> {
    const parsed = parseAuthoredModelDocument(structuredClone(document));
    if (!parsed.ok) return this.fail(documentId, parsed.diagnostic);
    if (document.documentId !== documentId)
      return this.fail(documentId, {
        reasonCode: "identity-mismatch",
        message: "Document identity does not match.",
      });
    const repo = await this.getRepo();
    const handle = repo.create(createCollaborativeDocument(parsed.document));
    await handle.whenReady();
    await repo.flush?.([handle.documentId]);
    this.materializedAnswerFailures.delete(documentId);
    this.sessionActorIds.delete(documentId);
    this.install(documentId, handle);
    this.urlStore.set(documentId, handle.url);
    this.actions.set(documentId, new AuthoredActionHistory());
    return this.publish(documentId, handle, "seed");
  }
  mutate(
    input: Parameters<DocumentRepository["mutate"]>[0],
  ): Promise<DocumentRepositoryMutationResult> {
    return this.enqueue(input.documentId, async () => {
      if (this.releaseSupersededHandle(input.documentId))
        return this.superseded(input.documentId);
      const unresolved =
        this.durabilityFailures.get(input.documentId) ??
        this.materializedAnswerFailures.get(input.documentId);
      if (unresolved) return { ok: false, status: unresolved };
      const parsed = parseAuthoredModelDocument(
        structuredClone(input.document),
      );
      if (!parsed.ok) return this.fail(input.documentId, parsed.diagnostic);
      const stored = await storeGeometryAssetInputsForManifest(
        this.assetStore,
        parsed.document.assets.records,
        input.assets ?? [],
      );
      if (!stored.ok)
        return this.fail(input.documentId, {
          reasonCode: stored.diagnostic.code,
          message: stored.diagnostic.message,
        });
      const assets = await collectAssetAvailability(
        this.assetStore,
        parsed.document.assets.records,
      );
      if (assets.diagnostics.length)
        return this.fail(input.documentId, {
          reasonCode: assets.diagnostics[0]!.code,
          message: assets.diagnostics[0]!.message,
        });
      return this.transact(input.documentId, "local", input);
    });
  }
  private async transact(
    documentId: DocumentId,
    source: "local" | "undo" | "redo",
    input?: Parameters<DocumentRepository["mutate"]>[0],
    actionSequence?: number,
  ): Promise<DocumentRepositoryMutationResult> {
    const handle = this.handles.get(documentId);
    const failedAnswer = this.materializedAnswerFailures.get(documentId);
    if (!handle && failedAnswer) return { ok: false, status: failedAnswer };
    if (!handle)
      return this.fail(documentId, {
        reasonCode: "document-not-initialized",
        message: "Load or initialize the document before editing.",
      });
    const unresolved = this.durabilityFailures.get(documentId);
    if (unresolved) return { ok: false, status: unresolved };
    const staged = this.owner(documentId).fork();
    let result: AuthoredActionResult = { status: "unchanged" };
    let checkedDocument: AuthoredModelDocument | undefined;
    try {
      const identity = this.identity(documentId);
      const direction = input ? "commit" : source === "undo" ? "undo" : "redo";
      const ledger = staged.entries(identity);
      const entries = direction === "commit" ? [] : ledger[direction];
      const entry =
        actionSequence === undefined
          ? entries.at(-1)
          : entries.find((candidate) => candidate.sequence === actionSequence);
      this.localChanges.add(documentId);
      // cadara-yrt: read the current state from the immutable document, not
      // the change proxy, which materializes every value it is asked for
      // through Automerge (seconds on a mid-size document). change() applies
      // synchronously to this same state, so checks stay inside the atomic
      // boundary.
      const snapshot = handle.doc();
      checkedDocument = materializeCollaborativeDocument(snapshot);
      const current = documentActionState(checkedDocument);
      handle.change((storage) => {
        result = input
          ? staged.commit(
              identity,
              current,
              documentActionState(input.document),
              input.label ?? "Edit document",
              documentActionState(input.expected),
            )
          : staged[source === "undo" ? "undo" : "redo"](
              identity,
              current,
              actionSequence,
            );
        if (result.status === "blocked") return;
        if (result.status === "applied")
          applyCollaborativeWrites(storage, result.writes);
        if (input)
          updateDocumentProvenance(
            storage,
            input.document,
            input.expected,
            snapshot,
          );
      });
      // DocHandle.change emits synchronously. Only suppress that local echo;
      // peer changes arriving while flush awaits must still reach subscribers.
      this.localChanges.delete(documentId);
      const checked = result as AuthoredActionResult;
      if (checked.status === "blocked")
        return this.fail(documentId, {
          reasonCode: checked.reason,
          message: describeBlockedDocumentAction({
            direction,
            label:
              direction === "commit"
                ? (input?.label ?? "Edit document")
                : (entry?.label ?? "this action"),
            result: checked,
            current: checkedDocument,
            history: [...ledger.undo, ...ledger.redo],
          }),
        });
      // change() has already applied and may have shared these writes. The ledger must
      // match that live state, even if the subsequent durability barrier fails.
      this.actions.set(documentId, staged);
      const pending = {
        kind: "failed" as const,
        documentId,
        diagnostic: {
          reasonCode: "automerge-durability-pending",
          message: "Document changes are applied; persistence is pending.",
        },
      };
      this.durabilityFailures.set(documentId, pending);
      this.statuses.set(documentId, pending);
      await (await this.getRepo()).flush?.([handle.documentId]);
      this.durabilityFailures.delete(documentId);
      return await this.publish(documentId, handle, source);
    } catch (error) {
      if (this.durabilityFailures.has(documentId)) {
        const failed = this.durabilityFailed(documentId, error);
        const published = await this.publish(documentId, handle, source);
        return !published.ok && published.appliedLive
          ? { ...failed, appliedLive: published.appliedLive }
          : failed;
      }
      return this.failure(
        documentId,
        error instanceof DocumentProvenanceConflict
          ? "provenance-conflict"
          : "automerge-write-failed",
        error,
      );
    } finally {
      this.localChanges.delete(documentId);
    }
  }
  private owner(documentId: DocumentId) {
    let owner = this.actions.get(documentId);
    if (!owner) {
      owner = new AuthoredActionHistory();
      this.actions.set(documentId, owner);
    }
    return owner;
  }
  private identity(documentId: DocumentId) {
    const handle = this.handles.get(documentId);
    if (!handle) throw new Error("Document actor unavailable before load");
    return {
      actorId: getActorId(handle.doc()),
      documentId,
      context: { kind: "document" as const },
    };
  }
  async getDurableHistoryAvailability(documentId: DocumentId) {
    if (!this.handles.has(documentId))
      return { canUndo: false, canRedo: false };
    const entries = this.owner(documentId).entries(this.identity(documentId));
    return {
      canUndo: entries.undo.length > 0,
      canRedo: entries.redo.length > 0,
      undoEntries: entries.undo.map(({ sequence, label }) => ({
        sequence,
        label,
      })),
      redoEntries: entries.redo.map(({ sequence, label }) => ({
        sequence,
        label,
      })),
    };
  }
  undoDurableHistory(
    documentId: DocumentId,
    actionSequence?: number,
  ): Promise<DocumentRepositoryMutationResult | null> {
    return this.enqueue(documentId, async () =>
      this.releaseSupersededHandle(documentId)
        ? this.superseded(documentId)
        : (await this.getDurableHistoryAvailability(documentId)).canUndo
          ? this.transact(documentId, "undo", undefined, actionSequence)
          : null,
    );
  }
  redoDurableHistory(
    documentId: DocumentId,
    actionSequence?: number,
  ): Promise<DocumentRepositoryMutationResult | null> {
    return this.enqueue(documentId, async () =>
      this.releaseSupersededHandle(documentId)
        ? this.superseded(documentId)
        : (await this.getDurableHistoryAvailability(documentId)).canRedo
          ? this.transact(documentId, "redo", undefined, actionSequence)
          : null,
    );
  }
  /**
   * cadara-l99p: every tab's worker has its own Repo over one IndexedDB
   * database, and automerge-repo tells no other tab about a delete. The URL
   * store, which each request refreshes from the tabs' shared localStorage,
   * is the pointer they share: a reset deletes it and a replace (initialize)
   * moves it. Writing a handle it no longer points at would leave changes
   * without their deleted snapshot (incomplete storage, CADARA-14) or edit
   * a replaced document, so such a handle is dropped unwritten, like reset()
   * drops it but without deleting anything. Returns whether the handle was
   * released, now or by an earlier request: later writes keep the superseded
   * refusal, not "Load or initialize the document before editing."
   */
  private releaseSupersededHandle(documentId: DocumentId) {
    const handle = this.handles.get(documentId);
    if (!handle || handle.url === this.urlStore.get(documentId))
      return this.supersededDocuments.has(documentId);
    this.supersededDocuments.add(documentId);
    this.handles.delete(documentId);
    this.sessionActorIds.delete(documentId);
    this.actions.delete(documentId);
    this.metadata.delete(documentId);
    this.publishedEvents.delete(documentId);
    this.durabilityFailures.delete(documentId);
    this.publicationVersions.set(
      documentId,
      (this.publicationVersions.get(documentId) ?? 0) + 1,
    );
    return true;
  }
  private superseded(documentId: DocumentId) {
    return this.fail(documentId, {
      reasonCode: "automerge-document-superseded",
      message:
        "This document was reset or replaced in another tab, so this tab can no longer save to it. Reload the tab to open the stored version.",
    });
  }
  private install(
    documentId: DocumentId,
    handle: AutomergeHandleLike<CollaborativeDocument>,
  ) {
    this.clearMissingCopyWatch(documentId);
    this.supersededDocuments.delete(documentId);
    if (this.handles.get(documentId) === handle) return;
    this.handles.set(documentId, handle);
    this.publicationVersions.set(
      documentId,
      (this.publicationVersions.get(documentId) ?? 0) + 1,
    );
    this.publishedEvents.delete(documentId);
    handle.on("change", () => {
      if (
        this.handles.get(documentId) !== handle ||
        this.localChanges.has(documentId)
      )
        return;
      // Peer changes never clear or rewrite this actor's ledger.
      void this.publish(documentId, handle, "peer");
    });
  }
  private async publish(
    documentId: DocumentId,
    handle: AutomergeHandleLike<CollaborativeDocument>,
    source: DocumentRepositoryChangeSource,
  ): Promise<DocumentRepositoryLoadResult> {
    const version = (this.publicationVersions.get(documentId) ?? 0) + 1;
    this.publicationVersions.set(documentId, version);
    const snapshot = handle.doc();
    const heads = [...(handle.heads?.() ?? [])];
    const actorId =
      this.sessionActorIds.get(documentId) ?? getActorId(snapshot);
    const parsed = parseAuthoredModelDocument(
      materializeCollaborativeDocument(snapshot),
    );
    if (!parsed.ok) return this.fail(documentId, parsed.diagnostic);
    const assets = await collectAssetAvailability(
      this.assetStore,
      parsed.document.assets.records,
    );
    // Worker requests can replace the shared URL while asset storage is read,
    // before their repository operations reach this document's queue.
    if (
      this.handles.get(documentId) === handle &&
      this.releaseSupersededHandle(documentId)
    )
      return this.superseded(documentId);
    if (
      this.handles.get(documentId) !== handle ||
      this.publicationVersions.get(documentId) !== version
    ) {
      if (source !== "peer" && this.handles.get(documentId) === handle)
        return this.publish(documentId, handle, source);
      return {
        ok: false,
        status: {
          kind: "failed",
          documentId,
          diagnostic: {
            reasonCode: "publication-superseded",
            message:
              "A newer document context or publication superseded this result.",
          },
        },
      };
    }
    const unresolved = this.durabilityFailures.get(documentId);
    const result = this.announce(
      documentId,
      parsed.document,
      assets,
      {
        actorId,
        documentId,
        heads,
        source,
        storageKey: handle.url,
        assetAvailability: assets.availability,
      },
      unresolved,
    );
    if (unresolved)
      return { ok: false, status: unresolved, appliedLive: result };
    this.scheduleMaterializedDocumentWrite(
      documentId,
      handle,
      parsed.document,
      heads,
    );
    return result;
  }
  /** Records and broadcasts a publication; the announced result. */
  private announce(
    documentId: DocumentId,
    document: AuthoredModelDocument,
    assets: Awaited<ReturnType<typeof collectAssetAvailability>>,
    metadata: DocumentRepositoryMetadata,
    unresolved?: Extract<DocumentRepositoryRestoreStatus, { kind: "failed" }>,
  ) {
    const status = unresolved ?? {
      kind:
        metadata.source === "seed"
          ? ("seeded" as const)
          : ("restored" as const),
      documentId,
    };
    this.statuses.set(documentId, status);
    this.metadata.set(documentId, metadata);
    const result = {
      ok: true as const,
      document,
      diagnostics: assets.diagnostics,
      assetAvailability: assets.availability,
      metadata,
      status,
    };
    this.publishedEvents.set(documentId, structuredClone(result));
    for (const listener of this.listeners.get(documentId) ?? [])
      listener(structuredClone(result));
    return result;
  }
  /**
   * cadara-dx2k.17: answers a load with a cache record whose chunk keys are
   * the stored ones, and queues the Automerge load behind it, so every
   * later request for the document (mutate, undo, redo, reset, load) runs
   * once the handle is installed.
   */
  private async answerFromMaterializedDocument(
    documentId: DocumentId,
    url: AutomergeUrl,
    record: MaterializedDocumentRecord,
  ): Promise<DocumentRepositoryLoadResult> {
    this.publicationVersions.set(
      documentId,
      (this.publicationVersions.get(documentId) ?? 0) + 1,
    );
    const assets = await collectAssetAvailability(
      this.assetStore,
      record.document.assets.records,
    );
    const actorId = createSessionActorId();
    this.sessionActorIds.set(documentId, actorId);
    this.supersededDocuments.delete(documentId);
    const result = this.announce(documentId, record.document, assets, {
      actorId,
      documentId,
      heads: [...record.heads],
      source: "restore",
      storageKey: url,
      assetAvailability: assets.availability,
    });
    // The load waits for settleLoad or the next request for the document:
    // its ~1 s of synchronous Automerge work on this worker would otherwise
    // delay the open's later requests (normalizing the answer, restoring
    // the file binding) by that much.
    let start!: () => void;
    const settled = new Promise<void>((resolve) => {
      start = resolve;
    });
    void this.enqueue(documentId, async () => {
      await settled;
      await this.installAfterMaterializedAnswer(documentId, url, record.heads);
    });
    // Set after enqueueing, which starts any earlier deferred load.
    this.deferredLoads.set(documentId, start);
    return result;
  }
  settleLoad(documentId: DocumentId) {
    const start = this.deferredLoads.get(documentId);
    this.deferredLoads.delete(documentId);
    start?.();
  }
  /**
   * Loads the Automerge document a cached answer stood for. Equal heads are
   * the answered document: nothing is published. Other heads (a write
   * landed between the key check and this load, or a peer change merged
   * during it) are published as a peer change. A failed load refuses later
   * writes with the reason the load would have reported.
   */
  private async installAfterMaterializedAnswer(
    documentId: DocumentId,
    url: AutomergeUrl,
    answeredHeads: readonly string[],
  ) {
    try {
      const repo = await this.getRepo();
      const opened = await this.openStoredHandle(
        documentId,
        url,
        repo.find<CollaborativeDocument>(url),
      );
      // Another tab reset or replaced the document since the answer: this
      // tab refuses writes as it does for a released handle.
      if (this.urlStore.get(documentId) !== url) {
        this.supersededDocuments.add(documentId);
        this.sessionActorIds.delete(documentId);
        return;
      }
      if (!opened.ok) {
        this.materializedAnswerFailed(documentId, opened.diagnostic);
        return;
      }
      const answered = this.publishedEvents.get(documentId);
      this.install(documentId, opened.handle);
      if (
        answered &&
        sameStrings([...(opened.handle.heads?.() ?? [])], answeredHeads)
      ) {
        this.publishedEvents.set(documentId, answered);
        return;
      }
      await this.publish(documentId, opened.handle, "peer");
    } catch (error) {
      this.materializedAnswerFailed(documentId, {
        reasonCode: "automerge-load-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  private materializedAnswerFailed(
    documentId: DocumentId,
    diagnostic: AuthoredModelDocumentDiagnostic,
  ) {
    const status = { kind: "failed" as const, documentId, diagnostic };
    this.materializedAnswerFailures.set(documentId, status);
    this.statuses.set(documentId, status);
    this.options.materializedDocuments?.report({
      kind: "degraded",
      automergeUrl: this.urlStore.get(documentId) ?? "",
      reason: `stored-copy-failed-after-answer: ${diagnostic.reasonCode}`,
    });
  }
  /** Records the publication off the request path; the latest one wins. */
  private scheduleMaterializedDocumentWrite(
    documentId: DocumentId,
    handle: AutomergeHandleLike<CollaborativeDocument>,
    document: AuthoredModelDocument,
    heads: string[],
  ) {
    if (!this.options.materializedDocuments || !this.getChunkKeyRecorder())
      return;
    this.pendingMaterializedWrites.set(documentId, { handle, document, heads });
    if (this.materializedWriters.has(documentId)) return;
    this.materializedWriters.add(documentId);
    void (async () => {
      try {
        for (;;) {
          const pending = this.pendingMaterializedWrites.get(documentId);
          if (!pending) return;
          this.pendingMaterializedWrites.delete(documentId);
          await this.writeMaterializedDocument(documentId, pending);
        }
      } finally {
        this.materializedWriters.delete(documentId);
      }
    })();
  }
  /**
   * Stores the record only when storage provably holds exactly the
   * published document: after a flush, the handle is still at the published
   * heads and the stored chunk keys are the ones the recorder holds (see
   * AutomergeChunkKeyRecorder). Anything else skips; a failure is reported
   * and leaves the next reload on the Automerge load.
   */
  private async writeMaterializedDocument(
    documentId: DocumentId,
    pending: {
      handle: AutomergeHandleLike<CollaborativeDocument>;
      document: AuthoredModelDocument;
      heads: string[];
    },
  ) {
    const cache = this.options.materializedDocuments!;
    const recorder = this.getChunkKeyRecorder()!;
    const { handle, document, heads } = pending;
    const skip = (reason: string) =>
      cache.report({ kind: "skipped", automergeUrl: handle.url, reason });
    try {
      const current = () =>
        this.handles.get(documentId) === handle &&
        !this.durabilityFailures.has(documentId) &&
        sameStrings([...(handle.heads?.() ?? [])], heads);
      if (!current() || heads.length === 0) return skip("superseded");
      await (await this.getRepo()).flush?.([handle.documentId]);
      if (!current()) return skip("superseded");
      if (getMissingDeps(handle.doc(), []).length > 0)
        return skip("missing-dependencies");
      const chunkKeys = await recorder.storedChunkKeys(handle.documentId);
      if (!current()) return skip("superseded");
      if (!sameStrings(chunkKeys, recorder.heldChunkKeys(handle.documentId)))
        return skip("storage-holds-other-chunks");
      await cache.store.write({
        format: MATERIALIZED_DOCUMENT_FORMAT,
        compatibility: cache.compatibility,
        automergeUrl: handle.url,
        chunkKeys,
        heads,
        document,
      });
      cache.report({ kind: "stored", automergeUrl: handle.url });
    } catch (error) {
      cache.report({
        kind: "degraded",
        automergeUrl: handle.url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  subscribe(
    documentId: DocumentId,
    listener: (event: DocumentRepositoryChangeEvent) => void,
  ) {
    const listeners = this.listeners.get(documentId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(documentId, listeners);
    const published = this.publishedEvents.get(documentId);
    if (published)
      listener({
        ...structuredClone(published),
        status: this.durabilityFailures.get(documentId) ?? published.status,
      });
    return () => {
      listeners.delete(listener);
    };
  }
  reset(documentId: DocumentId): Promise<DocumentRepositoryRestoreStatus> {
    return this.enqueue(documentId, async () => {
      const unresolved = this.durabilityFailures.get(documentId);
      if (unresolved) return unresolved;
      this.clearMissingCopyWatch(documentId);
      const url = this.urlStore.get(documentId);
      if (url) {
        (await this.getRepo()).delete(url);
        // The deleted chunks already invalidate the record; this frees it.
        const cache = this.options.materializedDocuments;
        cache?.store.remove(url).catch((error: unknown) =>
          cache.report({
            kind: "degraded",
            automergeUrl: url,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      this.handles.delete(documentId);
      this.sessionActorIds.delete(documentId);
      this.materializedAnswerFailures.delete(documentId);
      this.actions.delete(documentId);
      this.urlStore.delete(documentId);
      const status = { kind: "reset" as const, documentId };
      this.statuses.set(documentId, status);
      this.metadata.delete(documentId);
      this.publishedEvents.delete(documentId);
      this.publicationVersions.set(
        documentId,
        (this.publicationVersions.get(documentId) ?? 0) + 1,
      );
      return status;
    });
  }
  getRestoreStatus(documentId: DocumentId): DocumentRepositoryRestoreStatus {
    return this.statuses.get(documentId) ?? { kind: "pending", documentId };
  }
  getMetadata(documentId: DocumentId): DocumentRepositoryMetadata {
    return (
      this.metadata.get(documentId) ?? {
        actorId: "",
        documentId,
        heads: [],
        source: "restore",
      }
    );
  }
  private fail(
    documentId: DocumentId,
    diagnostic: AuthoredModelDocumentDiagnostic,
  ): Extract<DocumentRepositoryLoadResult, { ok: false }> {
    const status = this.durabilityFailures.get(documentId) ?? {
      kind: "failed" as const,
      documentId,
      diagnostic,
    };
    this.statuses.set(documentId, status);
    return { ok: false, status };
  }
  private durabilityFailed(documentId: DocumentId, error: unknown) {
    const status = {
      kind: "failed" as const,
      documentId,
      diagnostic: {
        reasonCode: "automerge-durability-failed",
        message: `Document changes are applied but not durably saved. Load to retry persistence before further edits: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
    this.durabilityFailures.set(documentId, status);
    this.statuses.set(documentId, status);
    return { ok: false as const, status };
  }
  private failure(documentId: DocumentId, reasonCode: string, error: unknown) {
    return this.fail(documentId, {
      reasonCode,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  async getGeometryAssetBytes(hash: GeometryAssetHash) {
    const record = [
      ...[...this.handles.values()].flatMap(
        (handle) =>
          materializeCollaborativeDocument(handle.doc()).assets.records,
      ),
      // A load answered from the cache publishes before its handle exists.
      ...[...this.publishedEvents.values()].flatMap(
        (event) => event.document.assets.records,
      ),
    ].find((record) => record.hash === hash);
    return record ? this.getGeometryAssetRecord(record) : null;
  }
  async getGeometryAssetRecord(record: GeometryAssetRecord) {
    const result = await this.assetStore.get(record);
    return result.ok ? result.bytes : null;
  }
}

export function createIndexedDbAutomergeDocumentRepository(
  options?: IndexedDbAutomergeDocumentRepositoryOptions,
) {
  return new IndexedDbAutomergeDocumentRepository(options);
}
export {
  createLocalStorageDocumentRepositoryUrlStore,
  MemoryDocumentRepositoryUrlStore,
};
export type { DocumentRepositoryUrlStore };
