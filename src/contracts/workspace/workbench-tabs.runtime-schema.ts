import typia from "typia";

import type { DocumentId } from "@/contracts/shared/ids";
import { validateContract } from "@/contracts/shared/validation";

export type WorkbenchTabStorageKind = "browser" | "filesystem" | "cloud";

export interface WorkbenchTab {
  documentId: DocumentId;
  title: string;
  storageKind: WorkbenchTabStorageKind;
  storageDescriptor: string | null;
}

export interface WorkbenchTabsState {
  tabs: readonly WorkbenchTab[];
  activeDocumentId: DocumentId;
}

export interface WorkbenchTabsPayload {
  version: 2;
  tabs: WorkbenchTab[];
  activeDocumentId: DocumentId;
}

export interface WorkbenchTabsLoadResult {
  ok: true;
  state: WorkbenchTabsState | null;
}

export interface WorkbenchTabsLoadFailure {
  ok: false;
  reasonCode: "invalid-json" | "invalid-shape";
  message: string;
}

const workbenchTabsPayloadValidator =
  typia.createValidateEquals<WorkbenchTabsPayload>();

function validateWorkbenchTabsPayloadInvariants(
  payload: WorkbenchTabsPayload,
): string | null {
  if (payload.tabs.length < 1 || payload.tabs.length > 64) {
    return "Workbench tabs payload must contain between 1 and 64 tabs.";
  }

  for (const tab of payload.tabs) {
    if (tab.title.length < 1 || tab.title.length > 256) {
      return "Workbench tab titles must contain between 1 and 256 characters.";
    }

    if (
      tab.storageDescriptor !== null &&
      tab.storageDescriptor.length > 512
    ) {
      return "Workbench tab storage descriptors must be 512 characters or fewer.";
    }
  }

  return payload.tabs.some(
    (tab) => tab.documentId === payload.activeDocumentId,
  )
    ? null
    : "activeDocumentId must reference a tab present in tabs.";
}

export function parseWorkbenchTabsPayload(
  input: unknown,
): WorkbenchTabsLoadResult | WorkbenchTabsLoadFailure {
  const parsed = validateContract(workbenchTabsPayloadValidator, input);
  if (!parsed.success) {
    return {
      ok: false,
      reasonCode: "invalid-shape",
      message:
        parsed.issues[0]?.message ?? "Workbench tabs payload was malformed.",
    };
  }

  const invariantFailure = validateWorkbenchTabsPayloadInvariants(parsed.data);
  if (invariantFailure) {
    return {
      ok: false,
      reasonCode: "invalid-shape",
      message: invariantFailure,
    };
  }

  return {
    ok: true,
    state: {
      tabs: parsed.data.tabs,
      activeDocumentId: parsed.data.activeDocumentId,
    },
  };
}

export function serializeWorkbenchTabsState(
  state: WorkbenchTabsState,
): WorkbenchTabsPayload {
  return {
    version: 2,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    activeDocumentId: state.activeDocumentId,
  };
}
