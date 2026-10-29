import typia from "typia";
import type { DocumentId } from "@/contracts/shared/ids";

export interface WorkbenchProjectSession {
  schemaVersion: 1;
  projectId: string;
  activeDocumentId: DocumentId;
}

export const validateWorkbenchProjectSession =
  typia.createValidateEquals<WorkbenchProjectSession>();
