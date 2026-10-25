import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import type { DocumentId } from "@/contracts/shared/ids";
import type { ModelingService } from "@/application/modeling/modeling-service";
import { type DocumentRepository, type LocalFileSyncDocumentRepository } from "@/contracts/modeling/document-repository";
import { isLocalFileSyncDocumentRepository } from "@/core/modeling/document-repository";
import { createLocalFileBindingMetadata } from "@/core/modeling/local-file-binding-metadata";
import type { WorkbenchTab } from "@/core/workspace/workbench-tabs";
import { downloadDocumentExportResult } from "@/lib/download-export";
import { ensureLocalFileWritePermission, queryLocalFilePermission, readCadaraDocumentFile, readLocalCadaraDocument, showOpenLocalDocumentPicker, showSaveLocalDocumentPicker, writeTextToLocalFileHandle } from "@/lib/local-file-system-access";
import { type LocalFileSystemFileHandle } from "@/contracts/modeling/local-file-system-access";

export type WorkbenchDocumentActionResult =
  | { status: "success"; documentId: DocumentId; message: string }
  | { status: "cancelled" }
  | { status: "user-error"; message: string }
  | {
      status: "unexpected-error";
      source: string;
      message: string;
      error: unknown;
    };

interface WorkbenchDocumentFileActionIo {
  downloadDocumentExportResult: typeof downloadDocumentExportResult;
  ensureLocalFileWritePermission: typeof ensureLocalFileWritePermission;
  queryLocalFilePermission: typeof queryLocalFilePermission;
  readCadaraDocumentFile: typeof readCadaraDocumentFile;
  readLocalCadaraDocument: typeof readLocalCadaraDocument;
  showOpenLocalDocumentPicker: typeof showOpenLocalDocumentPicker;
  showSaveLocalDocumentPicker: typeof showSaveLocalDocumentPicker;
  writeTextToLocalFileHandle: typeof writeTextToLocalFileHandle;
}

const defaultIo: WorkbenchDocumentFileActionIo = {
  downloadDocumentExportResult,
  ensureLocalFileWritePermission,
  queryLocalFilePermission,
  readCadaraDocumentFile,
  readLocalCadaraDocument,
  showOpenLocalDocumentPicker,
  showSaveLocalDocumentPicker,
  writeTextToLocalFileHandle,
};

interface WorkbenchDocumentFileActionCallbacks {
  reportDocumentFileActionFailure: (
    source: string,
    message: string,
    error: unknown,
  ) => void;
  showWorkbenchError: (message: string) => void;
  showWorkbenchInfo: (message: string) => void;
}

export async function openDocumentCopyAsTab(input: {
  file: File;
  repository: DocumentRepository | null;
  createDocumentId: () => DocumentId;
  openTab: (tab: WorkbenchTab) => void;
  io?: Partial<WorkbenchDocumentFileActionIo>;
}): Promise<WorkbenchDocumentActionResult> {
  if (!input.repository) {
    return {
      status: "user-error",
      message:
        "Document open requires the repository-backed workbench session.",
    };
  }

  const io = { ...defaultIo, ...input.io };
  let payload: unknown;
  try {
    payload = await io.readCadaraDocumentFile(input.file);
  } catch (error: unknown) {
    return {
      status: "user-error",
      message:
        error instanceof Error &&
        error.message.includes("ZIP-backed .cadara packages are unsupported")
          ? "Open failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document."
          : "Open failed. Select a valid cadara JSON document.",
    };
  }

  const parsed = parseAuthoredModelDocument(structuredClone(payload));
  if (!parsed.ok) {
    return {
      status: "user-error",
      message: parsed.diagnostic.message,
    };
  }

  const documentId = input.createDocumentId();
  const result = await input.repository.initialize({
    documentId,
    document: {
      ...parsed.document,
      documentId,
    },
  });
  if (!result.ok) {
    return {
      status: "user-error",
      message: result.status.diagnostic.message,
    };
  }

  input.openTab({
    documentId,
    title: parsed.document.name,
    storageKind: "browser",
    storageDescriptor: null,
  });
  return {
    status: "success",
    documentId,
    message: `Opened ${input.file.name}.`,
  };
}

export async function openLinkedDocumentAsTab(input: {
  repository: DocumentRepository | null;
  createDocumentId: () => DocumentId;
  openTab: (tab: WorkbenchTab) => void;
  io?: Partial<WorkbenchDocumentFileActionIo>;
}): Promise<WorkbenchDocumentActionResult> {
  if (!isLocalFileSyncDocumentRepository(input.repository)) {
    return {
      status: "user-error",
      message:
        "Linked file saving requires the repository-backed workbench session.",
    };
  }

  const io = { ...defaultIo, ...input.io };
  const pickerResult = await io.showOpenLocalDocumentPicker();
  if (!pickerResult.ok) {
    if (pickerResult.reason === "cancelled") {
      return { status: "cancelled" };
    }
    if (pickerResult.reason === "unsupported") {
      return {
        status: "user-error",
        message: "Linked file saving is unavailable in the current browser.",
      };
    }

    return {
      status: "unexpected-error",
      source: "workbench.file.openLinked",
      message: "Open linked document failed.",
      error: pickerResult.error,
    };
  }

  if (!(await io.ensureLocalFileWritePermission(pickerResult.handle))) {
    return {
      status: "user-error",
      message: "Local file write permission was denied.",
    };
  }

  return openLinkedDocumentHandleAsTab({
    repository: input.repository,
    handle: pickerResult.handle,
    createDocumentId: input.createDocumentId,
    openTab: input.openTab,
    io,
  });
}

/**
 * A .cadara file the operating system handed to the installed app (manifest
 * `file_handlers`, `launchQueue`). With write access already granted it
 * opens linked, like Open… → linked; otherwise it opens as a browser copy at
 * once (`linked: false`) and the caller offers `allowSavingToLaunchedFile`,
 * because asking for write access needs a user click.
 */
export async function openLaunchedDocumentFileAsTab(input: {
  repository: DocumentRepository | null;
  handle: LocalFileSystemFileHandle;
  createDocumentId: () => DocumentId;
  openTab: (tab: WorkbenchTab) => void;
  io?: Partial<WorkbenchDocumentFileActionIo>;
}): Promise<{ linked: boolean; result: WorkbenchDocumentActionResult }> {
  const io = { ...defaultIo, ...input.io };
  if (
    isLocalFileSyncDocumentRepository(input.repository) &&
    (await io.queryLocalFilePermission(input.handle, "readwrite")) === "granted"
  ) {
    return {
      linked: true,
      result: await openLinkedDocumentHandleAsTab({
        repository: input.repository,
        handle: input.handle,
        createDocumentId: input.createDocumentId,
        openTab: input.openTab,
        io,
      }),
    };
  }

  return {
    linked: false,
    result: await openDocumentCopyAsTab({
      file: await input.handle.getFile(),
      repository: input.repository,
      createDocumentId: input.createDocumentId,
      openTab: input.openTab,
      io,
    }),
  };
}

/**
 * The "Allow saving" click on a launched file opened as a browser copy: asks
 * for write access (the click is the required user activation) and, when
 * granted, writes the document's current state to the file and links it, so
 * later changes save there too (the Save As → linked path). `kept` means the
 * user declined: the document stays a browser copy.
 */
export async function allowSavingToLaunchedFile(input: {
  handle: LocalFileSystemFileHandle;
  modelingService: Pick<
    ModelingService,
    "bindLocalFile" | "currentDocumentId" | "exportCurrentDocument"
  >;
  io?: Partial<WorkbenchDocumentFileActionIo>;
}): Promise<
  | { status: "linked"; message: string }
  | { status: "kept" }
  | Exclude<
      LinkWorkbenchLocalFileResult,
      { ok: true } | { status: "permission-denied" }
    >
> {
  const linked = await linkWorkbenchLocalFile({
    modelingService: input.modelingService,
    handle: input.handle,
    io: { ...defaultIo, ...input.io },
  });
  if (linked.ok)
    return {
      status: "linked",
      message: `Saved ${input.handle.name}. Future changes will save to that file.`,
    };
  return linked.status === "permission-denied" ? { status: "kept" } : linked;
}

type LinkWorkbenchLocalFileResult =
  | { ok: true }
  | { ok: false; status: "permission-denied" }
  | { ok: false; status: "bind-failed"; message: string }
  | { ok: false; status: "write-failed"; error: unknown };

/** Writes the current document to `handle`, then links the document to it. */
async function linkWorkbenchLocalFile(input: {
  modelingService: Pick<
    ModelingService,
    "bindLocalFile" | "currentDocumentId" | "exportCurrentDocument"
  >;
  handle: LocalFileSystemFileHandle;
  io: WorkbenchDocumentFileActionIo;
}): Promise<LinkWorkbenchLocalFileResult> {
  if (!(await input.io.ensureLocalFileWritePermission(input.handle))) {
    return { ok: false, status: "permission-denied" };
  }

  const result = await input.modelingService.exportCurrentDocument();
  const writeResult = await input.io.writeTextToLocalFileHandle(
    input.handle,
    result.payload,
  );
  if (!writeResult.ok) {
    return writeResult.reason === "permission-denied"
      ? { ok: false, status: "permission-denied" }
      : { ok: false, status: "write-failed", error: writeResult.error };
  }

  const binding = await input.modelingService.bindLocalFile({
    handle: input.handle,
    metadata: createLocalFileBindingMetadata(
      input.modelingService.currentDocumentId,
      input.handle,
    ),
  });
  return binding.ok
    ? { ok: true }
    : {
        ok: false,
        status: "bind-failed",
        message:
          binding.diagnostics[0]?.message ??
          "Local file sync target could not be bound.",
      };
}

async function openLinkedDocumentHandleAsTab(input: {
  repository: LocalFileSyncDocumentRepository;
  handle: LocalFileSystemFileHandle;
  createDocumentId: () => DocumentId;
  openTab: (tab: WorkbenchTab) => void;
  io: WorkbenchDocumentFileActionIo;
}): Promise<WorkbenchDocumentActionResult> {
  let payload: unknown;
  try {
    payload = await input.io.readLocalCadaraDocument(input.handle);
  } catch (error: unknown) {
    return {
      status: "user-error",
      message:
        error instanceof Error &&
        error.message.includes("ZIP-backed .cadara packages are unsupported")
          ? "Open failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document."
          : "Open failed. Select a valid cadara JSON document.",
    };
  }

  const parsed = parseAuthoredModelDocument(structuredClone(payload));
  if (!parsed.ok) {
    return {
      status: "user-error",
      message: parsed.diagnostic.message,
    };
  }

  const documentId = input.createDocumentId();
  const mutateResult = await input.repository.initialize({
    documentId,
    document: {
      ...parsed.document,
      documentId,
    },
  });
  if (!mutateResult.ok) {
    return {
      status: "user-error",
      message: mutateResult.status.diagnostic.message,
    };
  }

  const bindResult = await input.repository.bindLocalFile({
    documentId,
    handle: input.handle,
    metadata: createLocalFileBindingMetadata(documentId, input.handle),
  });
  if (!bindResult.ok) {
    await input.repository.reset(documentId);
    return {
      status: "user-error",
      message: bindResult.message,
    };
  }

  input.openTab({
    documentId,
    title: parsed.document.name,
    storageKind: "filesystem",
    storageDescriptor: input.handle.name,
  });
  return {
    status: "success",
    documentId,
    message: `Opened ${input.handle.name}. Future changes will save to that file.`,
  };
}

export async function saveWorkbenchLocalFile(
  input: {
    modelingService: Pick<
      ModelingService,
      "bindLocalFile" | "currentDocumentId" | "exportCurrentDocument"
    >;
    io?: Partial<WorkbenchDocumentFileActionIo>;
  } & Pick<
    WorkbenchDocumentFileActionCallbacks,
    | "reportDocumentFileActionFailure"
    | "showWorkbenchError"
    | "showWorkbenchInfo"
  >,
): Promise<boolean> {
  const io = { ...defaultIo, ...input.io };
  const pickerResult = await io.showSaveLocalDocumentPicker();
  if (!pickerResult.ok) {
    if (pickerResult.reason === "cancelled") {
      return false;
    }
    if (pickerResult.reason === "unsupported") {
      input.showWorkbenchError(
        "Linked file saving is unavailable in the current browser.",
      );
      return false;
    }

    input.reportDocumentFileActionFailure(
      "workbench.file.saveLinked",
      "Save linked document failed.",
      pickerResult.error,
    );
    return false;
  }

  try {
    const linked = await linkWorkbenchLocalFile({
      modelingService: input.modelingService,
      handle: pickerResult.handle,
      io,
    });
    if (!linked.ok) {
      switch (linked.status) {
        case "permission-denied":
          input.showWorkbenchError("Local file write permission was denied.");
          return false;
        case "bind-failed":
          input.showWorkbenchError(linked.message);
          return false;
        case "write-failed":
          input.reportDocumentFileActionFailure(
            "workbench.file.saveLinked",
            "Save linked document failed.",
            linked.error,
          );
          return false;
      }
    }

    input.showWorkbenchInfo(
      `Saved ${pickerResult.handle.name}. Future changes will save to that file.`,
    );
    return true;
  } catch (error: unknown) {
    input.reportDocumentFileActionFailure(
      "workbench.file.saveLinked",
      "Save linked document failed.",
      error,
    );
    return false;
  }
}

export async function exportWorkbenchDocument(
  input: {
    modelingService: Pick<ModelingService, "exportCurrentDocument">;
    io?: Partial<WorkbenchDocumentFileActionIo>;
  } & Pick<
    WorkbenchDocumentFileActionCallbacks,
    "reportDocumentFileActionFailure" | "showWorkbenchInfo"
  >,
): Promise<boolean> {
  const io = { ...defaultIo, ...input.io };
  try {
    const result = await input.modelingService.exportCurrentDocument();
    io.downloadDocumentExportResult(result);
    input.showWorkbenchInfo(`Downloaded ${result.filename}.`);
    return true;
  } catch (error) {
    input.reportDocumentFileActionFailure(
      "workbench.file.downloadCopy",
      "Download failed.",
      error,
    );
    return false;
  }
}
