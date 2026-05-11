import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createDurableHistoryAvailability } from "@/contracts/modeling/durable-history.runtime-schema";
import {
  createEmptyDocumentLocalDurableHistoryState,
  type DocumentLocalDurableHistoryState,
  type DurableHistoryAvailability,
  type PersistedSketchDraftSession,
} from "@/contracts/modeling/durable-history";
import type { DocumentId } from "@/contracts/shared/ids";
import type {
  GeometryAssetBlobInput,
  GeometryAssetHash,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import type {
  GeometryAssetDocumentRepository,
  DocumentRepositoryChangeEvent,
  DocumentRepositoryMetadata,
  DocumentRepositoryLoadResult,
  DocumentRepositoryMutationResult,
  DocumentRepositoryRestoreStatus,
} from "@/domain/modeling/document-repository";
import {
  collectAssetAvailability,
  createMemoryGeometryAssetStore,
  storeGeometryAssetInputsForManifest,
  type GeometryAssetStore,
} from "@/domain/modeling/geometry-asset-store";

export class MemoryDocumentRepository implements GeometryAssetDocumentRepository {
  readonly savedDocuments: AuthoredModelDocument[] = [];
  private readonly documents = new Map<DocumentId, AuthoredModelDocument>();
  private readonly historyState = new Map<
    DocumentId,
    DocumentLocalDurableHistoryState
  >();
  private readonly assetStore: GeometryAssetStore;
  private readonly statuses = new Map<
    DocumentId,
    DocumentRepositoryRestoreStatus
  >();
  private readonly metadata = new Map<DocumentId, DocumentRepositoryMetadata>();
  private readonly listeners = new Map<
    DocumentId,
    Set<(event: DocumentRepositoryChangeEvent) => void>
  >();

  constructor(
    initialDocuments: AuthoredModelDocument[] = [],
    assetStore: GeometryAssetStore = createMemoryGeometryAssetStore(),
  ) {
    this.assetStore = assetStore;
    for (const document of initialDocuments) {
      this.documents.set(document.documentId, structuredClone(document));
      this.historyState.set(
        document.documentId,
        createEmptyDocumentLocalDurableHistoryState(),
      );
      this.statuses.set(document.documentId, {
        kind: "restored",
        documentId: document.documentId,
      });
      this.metadata.set(
        document.documentId,
        createMemoryMetadata(document.documentId, document, "restore"),
      );
    }
  }

  async load(input: {
    documentId: DocumentId;
    seedDocument: AuthoredModelDocument;
  }): Promise<DocumentRepositoryLoadResult> {
    const existing = this.documents.get(input.documentId);
    if (existing) {
      const result = parseAuthoredModelDocument(structuredClone(existing));
      if (!result.ok) {
        return this.fail(input.documentId, result.diagnostic);
      }

      const status = {
        kind: "restored" as const,
        documentId: input.documentId,
      };
      const metadata = createMemoryMetadata(
        input.documentId,
        result.document,
        "restore",
      );
      const assets = await collectAssetAvailability(
        this.assetStore,
        result.document.assets.records,
      );
      this.statuses.set(input.documentId, status);
      const metadataWithAssets = {
        ...metadata,
        assetAvailability: assets.availability,
      };
      this.metadata.set(input.documentId, metadataWithAssets);
      this.ensureHistoryState(input.documentId);
      return {
        ok: true,
        document: result.document,
        diagnostics: assets.diagnostics,
        assetAvailability: assets.availability,
        status,
        metadata: metadataWithAssets,
      };
    }

    const result = parseAuthoredModelDocument(
      structuredClone(input.seedDocument),
    );
    if (!result.ok) {
      return this.fail(input.documentId, result.diagnostic);
    }

    this.documents.set(input.documentId, structuredClone(result.document));
    this.ensureHistoryState(input.documentId);
    const status = { kind: "seeded" as const, documentId: input.documentId };
    const metadata = createMemoryMetadata(
      input.documentId,
      result.document,
      "seed",
    );
    const assets = await collectAssetAvailability(
      this.assetStore,
      result.document.assets.records,
    );
    this.statuses.set(input.documentId, status);
    const metadataWithAssets = {
      ...metadata,
      assetAvailability: assets.availability,
    };
    this.metadata.set(input.documentId, metadataWithAssets);
    this.notify(
      input.documentId,
      result.document,
      status,
      metadataWithAssets,
      assets.diagnostics,
      assets.availability,
    );
    return {
      ok: true,
      document: result.document,
      diagnostics: assets.diagnostics,
      assetAvailability: assets.availability,
      status,
      metadata: metadataWithAssets,
    };
  }

  async mutate(input: {
    documentId: DocumentId;
    document: AuthoredModelDocument;
    assets?: readonly GeometryAssetBlobInput[];
  }): Promise<DocumentRepositoryMutationResult> {
    const result = parseAuthoredModelDocument(structuredClone(input.document));
    if (!result.ok) {
      return this.fail(input.documentId, result.diagnostic);
    }

    const stored = await storeGeometryAssetInputsForManifest(
      this.assetStore,
      result.document.assets.records,
      input.assets ?? [],
    );
    if (!stored.ok) {
      return this.fail(input.documentId, {
        reasonCode: stored.diagnostic.code,
        message: stored.diagnostic.message,
      });
    }

    const assets = await collectAssetAvailability(
      this.assetStore,
      result.document.assets.records,
    );
    if (assets.diagnostics.length > 0) {
      const diagnostic = assets.diagnostics[0]!;
      return this.fail(input.documentId, {
        reasonCode: diagnostic.code,
        message: diagnostic.message,
      });
    }

    const previousDocument = this.documents.get(input.documentId);
    this.documents.set(input.documentId, structuredClone(result.document));
    this.savedDocuments.push(structuredClone(result.document));
    this.recordCommittedDocumentMutation(
      input.documentId,
      previousDocument ?? null,
    );
    const status = { kind: "restored" as const, documentId: input.documentId };
    const metadata = createMemoryMetadata(
      input.documentId,
      result.document,
      "local",
    );
    const metadataWithAssets = {
      ...metadata,
      assetAvailability: assets.availability,
    };
    this.statuses.set(input.documentId, status);
    this.metadata.set(input.documentId, metadataWithAssets);
    this.notify(
      input.documentId,
      result.document,
      status,
      metadataWithAssets,
      [],
      assets.availability,
    );
    return {
      ok: true,
      document: result.document,
      diagnostics: [],
      assetAvailability: assets.availability,
      status,
      metadata: metadataWithAssets,
    };
  }

  async receivePeerDocument(
    document: AuthoredModelDocument,
  ): Promise<DocumentRepositoryMutationResult> {
    const result = parseAuthoredModelDocument(structuredClone(document));
    if (!result.ok) {
      return this.fail(document.documentId, result.diagnostic);
    }

    this.documents.set(document.documentId, structuredClone(result.document));
    const historyState = this.ensureHistoryState(document.documentId);
    historyState.undoStack = [];
    historyState.redoStack = [];
    const status = {
      kind: "restored" as const,
      documentId: document.documentId,
    };
    const assets = await collectAssetAvailability(
      this.assetStore,
      result.document.assets.records,
    );
    const metadata = {
      ...createMemoryMetadata(document.documentId, result.document, "peer"),
      assetAvailability: assets.availability,
    };
    this.statuses.set(document.documentId, status);
    this.metadata.set(document.documentId, metadata);
    this.notify(
      document.documentId,
      result.document,
      status,
      metadata,
      assets.diagnostics,
      assets.availability,
    );
    return {
      ok: true,
      document: result.document,
      diagnostics: assets.diagnostics,
      assetAvailability: assets.availability,
      status,
      metadata,
    };
  }

  subscribe(
    documentId: DocumentId,
    listener: (event: DocumentRepositoryChangeEvent) => void,
  ) {
    const listeners = this.listeners.get(documentId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(documentId, listeners);

    return () => {
      listeners.delete(listener);
    };
  }

  async reset(
    documentId: DocumentId,
  ): Promise<DocumentRepositoryRestoreStatus> {
    this.documents.delete(documentId);
    this.historyState.delete(documentId);
    const status = { kind: "reset" as const, documentId };
    this.statuses.set(documentId, status);
    this.metadata.set(documentId, { documentId, heads: [], source: "reset" });
    return status;
  }

  getRestoreStatus(documentId: DocumentId): DocumentRepositoryRestoreStatus {
    return this.statuses.get(documentId) ?? { kind: "pending", documentId };
  }

  getMetadata(documentId: DocumentId): DocumentRepositoryMetadata {
    return (
      this.metadata.get(documentId) ?? {
        documentId,
        heads: [],
        source: "restore",
      }
    );
  }

  async getDurableHistoryAvailability(
    documentId: DocumentId,
  ): Promise<DurableHistoryAvailability> {
    const state = this.ensureHistoryState(documentId);
    return createDurableHistoryAvailability({
      canUndo: state.undoStack.length > 0,
      canRedo: state.redoStack.length > 0,
    });
  }

  async undoDurableHistory(
    documentId: DocumentId,
  ): Promise<DocumentRepositoryMutationResult | null> {
    const state = this.ensureHistoryState(documentId);
    const nextState = structuredClone(state);
    const nextDocument = nextState.undoStack.pop();
    const currentDocument = this.documents.get(documentId);
    if (!nextDocument || !currentDocument) {
      return null;
    }

    nextState.redoStack.push(structuredClone(currentDocument));
    return this.applyHistoryDocument(
      documentId,
      nextDocument,
      "undo",
      nextState,
    );
  }

  async redoDurableHistory(
    documentId: DocumentId,
  ): Promise<DocumentRepositoryMutationResult | null> {
    const state = this.ensureHistoryState(documentId);
    const nextState = structuredClone(state);
    const nextDocument = nextState.redoStack.pop();
    const currentDocument = this.documents.get(documentId);
    if (!nextDocument || !currentDocument) {
      return null;
    }

    nextState.undoStack.push(structuredClone(currentDocument));
    return this.applyHistoryDocument(
      documentId,
      nextDocument,
      "redo",
      nextState,
    );
  }

  async getSketchDraftHistory(documentId: DocumentId, draftKey: string) {
    const entry =
      this.ensureHistoryState(documentId).draftSessions[draftKey] ?? null;
    return {
      session: entry ? structuredClone(entry.current) : null,
      availability: createDraftHistoryAvailability(entry),
    };
  }

  async saveSketchDraftHistory(
    documentId: DocumentId,
    draftKey: string,
    session: PersistedSketchDraftSession,
  ) {
    const state = this.ensureHistoryState(documentId);
    const current = state.draftSessions[draftKey];
    const nextSession = structuredClone(session);
    if (!current) {
      state.draftSessions[draftKey] = {
        current: nextSession,
        undoStack: [],
        redoStack: [],
      };
      return createDraftHistoryAvailability(state.draftSessions[draftKey]);
    }

    if (draftSessionsEqual(current.current, nextSession)) {
      return createDraftHistoryAvailability(current);
    }

    current.undoStack.push(current.current);
    if (current.undoStack.length > MAX_DRAFT_UNDO_STACK_SIZE) {
      current.undoStack.splice(
        0,
        current.undoStack.length - MAX_DRAFT_UNDO_STACK_SIZE,
      );
    }
    current.redoStack = [];
    current.current = nextSession;
    return createDraftHistoryAvailability(current);
  }

  async undoSketchDraftHistory(documentId: DocumentId, draftKey: string) {
    const entry =
      this.ensureHistoryState(documentId).draftSessions[draftKey] ?? null;
    if (!entry) {
      return {
        session: null,
        availability: createDurableHistoryAvailability({
          canUndo: false,
          canRedo: false,
        }),
      };
    }

    const nextSession = entry.undoStack.pop();
    if (!nextSession) {
      return {
        session: structuredClone(entry.current),
        availability: createDraftHistoryAvailability(entry),
      };
    }

    entry.redoStack.push(entry.current);
    entry.current = nextSession;
    return {
      session: structuredClone(entry.current),
      availability: createDraftHistoryAvailability(entry),
    };
  }

  async redoSketchDraftHistory(documentId: DocumentId, draftKey: string) {
    const entry =
      this.ensureHistoryState(documentId).draftSessions[draftKey] ?? null;
    if (!entry) {
      return {
        session: null,
        availability: createDurableHistoryAvailability({
          canUndo: false,
          canRedo: false,
        }),
      };
    }

    const nextSession = entry.redoStack.pop();
    if (!nextSession) {
      return {
        session: structuredClone(entry.current),
        availability: createDraftHistoryAvailability(entry),
      };
    }

    entry.undoStack.push(entry.current);
    entry.current = nextSession;
    return {
      session: structuredClone(entry.current),
      availability: createDraftHistoryAvailability(entry),
    };
  }

  async clearSketchDraftHistory(
    documentId: DocumentId,
    draftKey: string,
  ): Promise<void> {
    delete this.ensureHistoryState(documentId).draftSessions[draftKey];
  }

  async getGeometryAssetBytes(hash: GeometryAssetHash) {
    const asset = [...this.documents.values()]
      .flatMap((document) => document.assets.records)
      .find((record) => record.hash === hash);
    if (!asset) {
      return null;
    }

    return this.getGeometryAssetRecord(asset);
  }

  async getGeometryAssetRecord(asset: GeometryAssetRecord) {
    const result = await this.assetStore.get(asset);
    return result.ok ? result.bytes : null;
  }

  private fail(
    documentId: DocumentId,
    diagnostic: Extract<
      DocumentRepositoryRestoreStatus,
      { kind: "failed" }
    >["diagnostic"],
  ): Extract<DocumentRepositoryLoadResult, { ok: false }> {
    const status = { kind: "failed" as const, documentId, diagnostic };
    this.statuses.set(documentId, status);
    return { ok: false, status };
  }

  private ensureHistoryState(documentId: DocumentId) {
    const existing = this.historyState.get(documentId);
    if (existing) {
      return existing;
    }

    const created = createEmptyDocumentLocalDurableHistoryState();
    this.historyState.set(documentId, created);
    return created;
  }

  private recordCommittedDocumentMutation(
    documentId: DocumentId,
    previousDocument: AuthoredModelDocument | null,
  ) {
    if (!previousDocument) {
      return;
    }

    const state = this.ensureHistoryState(documentId);
    state.undoStack.push(structuredClone(previousDocument));
    state.redoStack = [];
  }

  private async applyHistoryDocument(
    documentId: DocumentId,
    document: AuthoredModelDocument,
    source: Extract<DocumentRepositoryMetadata["source"], "undo" | "redo">,
    nextHistoryState: DocumentLocalDurableHistoryState,
  ): Promise<DocumentRepositoryMutationResult> {
    this.documents.set(documentId, structuredClone(document));
    this.historyState.set(documentId, structuredClone(nextHistoryState));
    const status = { kind: "restored" as const, documentId };
    const assets = await collectAssetAvailability(
      this.assetStore,
      document.assets.records,
    );
    const metadata = {
      ...createMemoryMetadata(documentId, document, source),
      assetAvailability: assets.availability,
    };
    this.statuses.set(documentId, status);
    this.metadata.set(documentId, metadata);
    this.notify(
      documentId,
      document,
      status,
      metadata,
      assets.diagnostics,
      assets.availability,
    );
    return {
      ok: true,
      document: structuredClone(document),
      diagnostics: assets.diagnostics,
      assetAvailability: assets.availability,
      status,
      metadata,
    };
  }

  private notify(
    documentId: DocumentId,
    document: AuthoredModelDocument,
    status: DocumentRepositoryRestoreStatus,
    metadata: DocumentRepositoryMetadata,
    diagnostics: DocumentRepositoryChangeEvent["diagnostics"] = [],
    assetAvailability: DocumentRepositoryChangeEvent["assetAvailability"] = [],
  ) {
    for (const listener of this.listeners.get(documentId) ?? []) {
      listener({
        document: structuredClone(document),
        diagnostics,
        assetAvailability,
        status,
        metadata,
      });
    }
  }
}

function createDraftHistoryAvailability(
  entry:
    | {
        undoStack: unknown[];
        redoStack: unknown[];
      }
    | null
    | undefined,
): DurableHistoryAvailability {
  return createDurableHistoryAvailability({
    canUndo: (entry?.undoStack.length ?? 0) > 0,
    canRedo: (entry?.redoStack.length ?? 0) > 0,
  });
}

const MAX_DRAFT_UNDO_STACK_SIZE = 50;

function draftSessionsEqual(
  left: PersistedSketchDraftSession,
  right: PersistedSketchDraftSession,
) {
  return (
    left.sequence === right.sequence &&
    left.sketchId === right.sketchId &&
    left.historyCursor.kind === right.historyCursor.kind &&
    (left.historyCursor.kind === "item" && right.historyCursor.kind === "item"
      ? left.historyCursor.itemId === right.historyCursor.itemId
      : true)
  );
}

export function createMemoryDocumentRepository(
  initialDocuments?: AuthoredModelDocument[],
  assetStore?: GeometryAssetStore,
) {
  return new MemoryDocumentRepository(initialDocuments, assetStore);
}

function createMemoryMetadata(
  documentId: DocumentId,
  document: AuthoredModelDocument,
  source: DocumentRepositoryMetadata["source"],
): DocumentRepositoryMetadata {
  return {
    documentId,
    heads: [`memory:${document.revisionId}`],
    source,
  };
}
