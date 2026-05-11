import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import type { DocumentId } from "@/contracts/shared/ids";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import {
  type DocumentRepository,
  type LocalFileSyncDocumentRepository,
  isLocalFileSyncDocumentRepository,
} from "@/domain/modeling/document-repository";
import { createLocalFileBindingMetadata } from "@/domain/modeling/local-file-binding-store";
import type { WorkbenchTab } from "@/domain/workspace/workbench-tabs";
import { downloadDocumentExportResult } from "@/lib/download-export";
import {
  ensureLocalFileWritePermission,
  readCadaraDocumentFile,
  readLocalCadaraDocument,
  showOpenLocalDocumentPicker,
  showSaveLocalDocumentPicker,
  type LocalFileSystemFileHandle,
  writeTextToLocalFileHandle,
} from "@/lib/local-file-system-access";

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
  readCadaraDocumentFile: typeof readCadaraDocumentFile;
  readLocalCadaraDocument: typeof readLocalCadaraDocument;
  showOpenLocalDocumentPicker: typeof showOpenLocalDocumentPicker;
  showSaveLocalDocumentPicker: typeof showSaveLocalDocumentPicker;
  writeTextToLocalFileHandle: typeof writeTextToLocalFileHandle;
}

const defaultIo: WorkbenchDocumentFileActionIo = {
  downloadDocumentExportResult,
  ensureLocalFileWritePermission,
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
  const result = await input.repository.mutate({
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
  const mutateResult = await input.repository.mutate({
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
    if (!(await io.ensureLocalFileWritePermission(pickerResult.handle))) {
      input.showWorkbenchError("Local file write permission was denied.");
      return false;
    }

    const result = await input.modelingService.exportCurrentDocument();
    const writeResult = await io.writeTextToLocalFileHandle(
      pickerResult.handle,
      result.payload,
    );
    if (!writeResult.ok) {
      if (writeResult.reason === "permission-denied") {
        input.showWorkbenchError("Local file write permission was denied.");
        return false;
      }

      input.reportDocumentFileActionFailure(
        "workbench.file.saveLinked",
        "Save linked document failed.",
        writeResult.error,
      );
      return false;
    }

    const binding = await input.modelingService.bindLocalFile({
      handle: pickerResult.handle,
      metadata: createLocalFileBindingMetadata(
        input.modelingService.currentDocumentId,
        pickerResult.handle,
      ),
    });
    if (!binding.ok) {
      input.showWorkbenchError(
        binding.diagnostics[0]?.message ??
          "Local file sync target could not be bound.",
      );
      return false;
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
