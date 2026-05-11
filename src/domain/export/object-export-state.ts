import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { DurableRef } from "@/contracts/shared/references";
import { isDurablePrimitiveRef, type PrimitiveRef } from "@/core/editor/schema";

export interface ObjectExportModalState {
  target: DurableRef;
  label: string;
  baseRevisionId: WorkspaceSnapshot["document"]["revisionId"];
}

export function createObjectExportModalState(
  snapshot: WorkspaceSnapshot | null,
  target: PrimitiveRef,
  label: string,
): ObjectExportModalState | null {
  if (!snapshot) {
    return null;
  }

  if (!isDurablePrimitiveRef(target)) {
    return null;
  }

  return {
    target,
    label,
    baseRevisionId: snapshot.document.revisionId,
  };
}
