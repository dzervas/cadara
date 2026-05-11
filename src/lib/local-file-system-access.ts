import { serializeAuthoredDocumentJson } from "@/contracts/modeling/authored-document-serialization";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";

export type LocalFileSystemPermissionMode = "read" | "readwrite";
export type LocalFileSystemPermissionState = "granted" | "denied" | "prompt";

export interface LocalFileSystemPermissionDescriptor {
  mode: LocalFileSystemPermissionMode;
}

export interface LocalFileSystemWritableFileStream {
  write(data: string | Uint8Array | ArrayBuffer | Blob): Promise<void> | void;
  close(): Promise<void> | void;
  abort?(): Promise<void> | void;
}

export interface LocalFileSystemFileHandle {
  readonly kind?: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<LocalFileSystemWritableFileStream>;
  queryPermission?(
    descriptor: LocalFileSystemPermissionDescriptor,
  ): Promise<LocalFileSystemPermissionState>;
  requestPermission?(
    descriptor: LocalFileSystemPermissionDescriptor,
  ): Promise<LocalFileSystemPermissionState>;
}

export interface LocalFileSystemPickerType {
  description: string;
  accept: Record<string, string[]>;
}

export interface LocalFileSystemOpenPickerOptions {
  multiple: false;
  excludeAcceptAllOption: boolean;
  types: LocalFileSystemPickerType[];
}

export interface LocalFileSystemSavePickerOptions {
  suggestedName: string;
  excludeAcceptAllOption: boolean;
  types: LocalFileSystemPickerType[];
}

export interface LocalFileSystemPickerEnvironment {
  isSecureContext?: boolean;
  showOpenFilePicker?: (
    options: LocalFileSystemOpenPickerOptions,
  ) => Promise<LocalFileSystemFileHandle[]>;
  showSaveFilePicker?: (
    options: LocalFileSystemSavePickerOptions,
  ) => Promise<LocalFileSystemFileHandle>;
}

export type LocalFileSystemSupport =
  | { supported: true }
  | {
      supported: false;
      reason:
        | "insecure-context"
        | "missing-open-picker"
        | "missing-save-picker";
    };

export type LocalFilePickerResult =
  | { ok: true; handle: LocalFileSystemFileHandle }
  | { ok: false; reason: "unsupported"; support: LocalFileSystemSupport }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "failed"; error: unknown };

export type LocalFileWriteResult =
  | { ok: true }
  | { ok: false; reason: "permission-denied" }
  | { ok: false; reason: "failed"; error: unknown };

const CADARA_JSON_ACCEPT: Record<string, string[]> = {
  "application/json": [".cadara", ".json"],
  "application/vnd.cadara+json": [".cadara"],
};

export const CADARA_OPEN_FILE_PICKER_OPTIONS: LocalFileSystemOpenPickerOptions =
  {
    multiple: false,
    excludeAcceptAllOption: false,
    types: [
      {
        description: "Cadara document",
        accept: CADARA_JSON_ACCEPT,
      },
    ],
  };

export const CADARA_SAVE_FILE_PICKER_OPTIONS: LocalFileSystemSavePickerOptions =
  {
    suggestedName: "document.cadara",
    excludeAcceptAllOption: false,
    types: [
      {
        description: "Cadara document",
        accept: CADARA_JSON_ACCEPT,
      },
    ],
  };

export function getLocalFileSystemOpenSupport(
  environment: LocalFileSystemPickerEnvironment = globalThis,
): LocalFileSystemSupport {
  if (environment.isSecureContext === false) {
    return { supported: false, reason: "insecure-context" };
  }

  if (typeof environment.showOpenFilePicker !== "function") {
    return { supported: false, reason: "missing-open-picker" };
  }

  return { supported: true };
}

export function getLocalFileSystemSaveSupport(
  environment: LocalFileSystemPickerEnvironment = globalThis,
): LocalFileSystemSupport {
  if (environment.isSecureContext === false) {
    return { supported: false, reason: "insecure-context" };
  }

  if (typeof environment.showSaveFilePicker !== "function") {
    return { supported: false, reason: "missing-save-picker" };
  }

  return { supported: true };
}

export async function showOpenLocalDocumentPicker(
  environment: LocalFileSystemPickerEnvironment = globalThis,
): Promise<LocalFilePickerResult> {
  const support = getLocalFileSystemOpenSupport(environment);
  if (!support.supported) {
    return { ok: false, reason: "unsupported", support };
  }
  const showOpenFilePicker = environment.showOpenFilePicker!;

  try {
    const handles = await showOpenFilePicker(CADARA_OPEN_FILE_PICKER_OPTIONS);
    const handle = handles[0];
    return handle ? { ok: true, handle } : { ok: false, reason: "cancelled" };
  } catch (error: unknown) {
    return isPickerAbort(error)
      ? { ok: false, reason: "cancelled" }
      : { ok: false, reason: "failed", error };
  }
}

export async function showSaveLocalDocumentPicker(
  environment: LocalFileSystemPickerEnvironment = globalThis,
): Promise<LocalFilePickerResult> {
  const support = getLocalFileSystemSaveSupport(environment);
  if (!support.supported) {
    return { ok: false, reason: "unsupported", support };
  }
  const showSaveFilePicker = environment.showSaveFilePicker!;

  try {
    return {
      ok: true,
      handle: await showSaveFilePicker(CADARA_SAVE_FILE_PICKER_OPTIONS),
    };
  } catch (error: unknown) {
    return isPickerAbort(error)
      ? { ok: false, reason: "cancelled" }
      : { ok: false, reason: "failed", error };
  }
}

export async function readLocalFileText(handle: LocalFileSystemFileHandle) {
  return (await handle.getFile()).text();
}

export async function readLocalCadaraDocument(
  handle: LocalFileSystemFileHandle,
): Promise<unknown> {
  return readCadaraDocumentFile(await handle.getFile());
}

export async function readCadaraDocumentFile(file: File): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isZipPayload(bytes)) {
    throw new Error(
      "ZIP-backed .cadara packages are unsupported. Select a single JSON .cadara document.",
    );
  }

  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function queryLocalFilePermission(
  handle: LocalFileSystemFileHandle,
  mode: LocalFileSystemPermissionMode,
): Promise<LocalFileSystemPermissionState> {
  return handle.queryPermission?.({ mode }) ?? "prompt";
}

export async function requestLocalFilePermission(
  handle: LocalFileSystemFileHandle,
  mode: LocalFileSystemPermissionMode,
): Promise<LocalFileSystemPermissionState> {
  return handle.requestPermission?.({ mode }) ?? "prompt";
}

export async function ensureLocalFileWritePermission(
  handle: LocalFileSystemFileHandle,
) {
  const current = await queryLocalFilePermission(handle, "readwrite");
  if (current === "granted") {
    return true;
  }

  return (await requestLocalFilePermission(handle, "readwrite")) === "granted";
}

export async function createLocalFileWritableStream(
  handle: LocalFileSystemFileHandle,
) {
  return handle.createWritable();
}

export async function writeTextToLocalFileHandle(
  handle: LocalFileSystemFileHandle,
  text: string | Uint8Array,
): Promise<LocalFileWriteResult> {
  const hasPermission = await ensureLocalFileWritePermission(handle);
  if (!hasPermission) {
    return { ok: false, reason: "permission-denied" };
  }

  let writable: LocalFileSystemWritableFileStream | null = null;
  try {
    writable = await createLocalFileWritableStream(handle);
    await writable.write(text);
    await writable.close();
    return { ok: true };
  } catch (error: unknown) {
    if (writable?.abort) {
      try {
        await writable.abort();
      } catch (abortError: unknown) {
        console.warn(
          "Local file writable abort failed after write failure.",
          abortError,
        );
      }
    }
    return { ok: false, reason: "failed", error };
  }
}

export function serializeLocalAuthoredDocument(document: unknown) {
  return serializeAuthoredDocumentJson(document);
}

export function createLocalAuthoredDocumentPayload(
  document: AuthoredModelDocument,
) {
  return serializeAuthoredDocumentJson(document);
}

function isPickerAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isZipPayload(bytes: Uint8Array) {
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}
