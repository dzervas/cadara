import type { ImportBinding } from "@/contracts/import/binding";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type {
  DocumentVariableId,
  FeatureId,
  SketchId,
} from "@/contracts/shared/ids";

/**
 * The orchestrator collects adapter responses and surfaces them as a single import result.
 */
export interface ImportResult {
  createdEntityIds: {
    featureIds: FeatureId[];
    sketchIds: SketchId[];
    variableIds: DocumentVariableId[];
  };
  appliedBinding?: ImportBinding;
  diagnostics: ModelingDiagnostic[];
}
