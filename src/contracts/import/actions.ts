import type {
  AddDocumentVariableRequest,
  CommitSketchRequest,
  CreateFeatureRequest,
} from "@/contracts/modeling/schema";
import type { ImportBinding } from "@/contracts/import/binding";
import type { ImportDiagnostic } from "@/contracts/import/diagnostics";

export type ImportPreparedActionKind =
  | "createFeature"
  | "commitSketch"
  | "addDocumentVariable";

/**
 * References a single prepared action by its kind and index into the matching
 * kind array (`createFeatures`, `commitSketches`, `addDocumentVariables`).
 */
export interface ImportPreparedActionRef {
  kind: ImportPreparedActionKind;
  index: number;
}

/**
 * The orchestrator applies these through existing adapter methods.
 */
export interface ImportPreparedActions {
  createFeatures?: CreateFeatureRequest[];
  commitSketches?: CommitSketchRequest[];
  addDocumentVariables?: AddDocumentVariableRequest[];
  /**
   * Optional explicit interleaved order across the kind arrays. When present,
   * the orchestrator applies actions in exactly this sequence (single revision
   * chain, atomic failure) instead of the grouped default. The sequence MUST be
   * a permutation referencing every prepared action exactly once.
   */
  orderedActions?: ImportPreparedActionRef[];
  binding?: ImportBinding;
  diagnostics?: ImportDiagnostic[];
}
