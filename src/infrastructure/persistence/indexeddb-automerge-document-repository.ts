import { initializeBase64Wasm, Repo } from "@automerge/automerge-repo/slim";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { getActorId } from "@automerge/automerge/slim";
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
} from "@/domain/modeling/document-repository";
import {
  collectAssetAvailability,
  createIndexedDbGeometryAssetStore,
  storeGeometryAssetInputsForManifest,
  type GeometryAssetStore,
} from "@/domain/modeling/geometry-asset-store";

import { AuthoredActionHistory } from "@/domain/modeling/authored-action-history";
import {
  applyCollaborativeWrites,
  DocumentProvenanceConflict,
  createCollaborativeDocument,
  documentActionState,
  materializeCollaborativeDocument,
  updateDocumentProvenance,
  type CollaborativeDocument,
} from "@/domain/modeling/collaborative-document";
import type { AuthoredActionResult } from "@/contracts/modeling/authored-actions";
import {
  createLocalStorageDocumentRepositoryUrlStore,
  MemoryDocumentRepositoryUrlStore,
  type DocumentRepositoryUrlStore,
} from "./document-repository-url-store";

export interface AutomergeHandleLike<T> {
  readonly url: AutomergeUrl;
  readonly documentId: string;
  whenReady(): Promise<void>;
  doc(): T;
  heads?(): readonly string[];
  change(callback: (document: T) => void): void;
  on(event: "change", callback: () => void): void;
}
export interface AutomergeRepositoryLike {
  create<T>(initialValue?: T): AutomergeHandleLike<T>;
  find<T>(id: AutomergeUrl): Promise<AutomergeHandleLike<T>>;
  delete(id: AutomergeUrl): void;
  flush?(documents?: string[]): Promise<void>;
}
let wasm: Promise<void> | undefined;
function prepare() {
  wasm ??= initializeBase64Wasm(automergeWasmBase64).catch((error: unknown) => {
    wasm = undefined;
    throw error;
  });
  return wasm;
}
export interface IndexedDbAutomergeDocumentRepositoryOptions {
  repo?: AutomergeRepositoryLike;
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
  private readonly queues = new Map<DocumentId, Promise<unknown>>();
  private readonly options: IndexedDbAutomergeDocumentRepositoryOptions;
  constructor(options: IndexedDbAutomergeDocumentRepositoryOptions = {}) {
    this.options = options;
    this.repo = options.repo ?? null;
    this.urlStore = options.urlStore ?? new MemoryDocumentRepositoryUrlStore();
    this.assetStore =
      options.assetStore ??
      createIndexedDbGeometryAssetStore({
        databaseName: `${options.databaseName ?? "cad-authored-documents"}-geometry-assets`,
      });
  }
  private async getRepo() {
    if (!this.repo) {
      await prepare();
      this.repo ??= new Repo({
        storage: new IndexedDBStorageAdapter(
          this.options.databaseName ?? "cad-authored-documents",
          this.options.storeName ?? "documents",
        ),
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
    const previous = this.queues.get(documentId) ?? Promise.resolve();
    // A rejected operation is returned to its caller; it must not poison subsequent transactions.
    const next = previous.then(action, action);
    this.queues.set(documentId, next);
    return next;
  }
  load(
    input: Parameters<DocumentRepository["load"]>[0],
  ): Promise<DocumentRepositoryLoadResult> {
    return this.enqueue(input.documentId, async () => {
      try {
        const repo = await this.getRepo();
        const existing = this.handles.get(input.documentId);
        const url = this.urlStore.get(input.documentId);
        if (!existing && !url)
          return this.seed(input.documentId, input.seedDocument);
        const handle =
          existing ?? (await repo.find<CollaborativeDocument>(url!));
        await handle.whenReady();
        const document = materializeCollaborativeDocument(handle.doc());
        const parsed = parseAuthoredModelDocument(document);
        if (!parsed.ok) return this.fail(input.documentId, parsed.diagnostic);
        if (parsed.document.documentId !== input.documentId)
          return this.fail(input.documentId, {
            reasonCode: "identity-mismatch",
            message: "Document identity does not match.",
          });
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
    this.install(documentId, handle);
    this.urlStore.set(documentId, handle.url);
    this.actions.set(documentId, new AuthoredActionHistory());
    return this.publish(documentId, handle, "seed");
  }
  mutate(
    input: Parameters<DocumentRepository["mutate"]>[0],
  ): Promise<DocumentRepositoryMutationResult> {
    return this.enqueue(input.documentId, async () => {
      const unresolved = this.durabilityFailures.get(input.documentId);
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
    if (!handle)
      return this.fail(documentId, {
        reasonCode: "document-not-initialized",
        message: "Load or initialize the document before editing.",
      });
    const unresolved = this.durabilityFailures.get(documentId);
    if (unresolved) return { ok: false, status: unresolved };
    const staged = this.owner(documentId).fork();
    let result: AuthoredActionResult = { status: "unchanged" };
    try {
      const identity = this.identity(documentId);
      this.localChanges.add(documentId);
      handle.change((storage) => {
        const current = documentActionState(
          materializeCollaborativeDocument(storage),
        );
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
          updateDocumentProvenance(storage, input.document, input.expected);
      });
      // DocHandle.change emits synchronously. Only suppress that local echo;
      // peer changes arriving while flush awaits must still reach subscribers.
      this.localChanges.delete(documentId);
      const checked = result as AuthoredActionResult;
      if (checked.status === "blocked")
        return this.fail(documentId, {
          reasonCode: checked.reason,
          message: `Document action blocked: ${checked.reason} (${checked.targets.map((p) => p.join(".")).join(", ")})`,
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
      (await this.getDurableHistoryAvailability(documentId)).canUndo
        ? this.transact(documentId, "undo", undefined, actionSequence)
        : null,
    );
  }
  redoDurableHistory(
    documentId: DocumentId,
    actionSequence?: number,
  ): Promise<DocumentRepositoryMutationResult | null> {
    return this.enqueue(documentId, async () =>
      (await this.getDurableHistoryAvailability(documentId)).canRedo
        ? this.transact(documentId, "redo", undefined, actionSequence)
        : null,
    );
  }
  private install(
    documentId: DocumentId,
    handle: AutomergeHandleLike<CollaborativeDocument>,
  ) {
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
    const actorId = getActorId(snapshot);
    const parsed = parseAuthoredModelDocument(
      materializeCollaborativeDocument(snapshot),
    );
    if (!parsed.ok) return this.fail(documentId, parsed.diagnostic);
    const assets = await collectAssetAvailability(
      this.assetStore,
      parsed.document.assets.records,
    );
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
    const status = unresolved ?? {
      kind: source === "seed" ? ("seeded" as const) : ("restored" as const),
      documentId,
    };
    const metadata: DocumentRepositoryMetadata = {
      actorId,
      documentId,
      heads,
      source,
      storageKey: handle.url,
      assetAvailability: assets.availability,
    };
    this.statuses.set(documentId, status);
    this.metadata.set(documentId, metadata);
    const appliedLive = {
      document: parsed.document,
      diagnostics: assets.diagnostics,
      assetAvailability: assets.availability,
      metadata,
    };
    const result = {
      ok: true as const,
      ...appliedLive,
      status,
    };
    this.publishedEvents.set(documentId, structuredClone(result));
    for (const listener of this.listeners.get(documentId) ?? [])
      listener(structuredClone(result));
    return unresolved ? { ok: false, status: unresolved, appliedLive } : result;
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
      const url = this.urlStore.get(documentId);
      if (url) (await this.getRepo()).delete(url);
      this.handles.delete(documentId);
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
    const record = [...this.handles.values()]
      .flatMap(
        (handle) =>
          materializeCollaborativeDocument(handle.doc()).assets.records,
      )
      .find((record) => record.hash === hash);
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
