/**
 * Re-export barrel for backward compatibility.
 * The implementation now lives in ./modeling-service/ sub-modules.
 */
export {
  createModelingService,
  createSketchSolverService,
  modelingRuntimeValidators,
} from "./modeling-service/index";

export type {
  ModelingService,
  ModelingServiceOptions,
  ModelingServiceDocumentChangeEvent,
  ModelingHistoryRestoreDiagnostic,
  ModelingHistoryRestoreState,
  SketchSolverService,
  ModelingFeatureMutationResult,
  ModelingDeleteFeatureResult,
  ModelingDeleteTargetResult,
  ModelingRenameBodyResult,
  ModelingReorderFeatureResult,
  ModelingReorderDocumentHistoryResult,
  ModelingSetFeatureCursorResult,
  ModelingCommitSketchResult,
  ModelingDocumentVariableMutationResult,
  ModelingCreateFeatureInput,
  ModelingAddDocumentVariableInput,
  ModelingUpdateFeatureInput,
  ModelingUpdateDocumentVariableInput,
  ModelingDeleteFeatureInput,
  ModelingDeleteTargetInput,
  ModelingRenameBodyInput,
  ModelingReorderFeatureInput,
  ModelingReorderDocumentHistoryInput,
  ModelingSetFeatureCursorInput,
  ModelingExportDocumentInput,
  ModelingExportDocumentResult,
  ModelingImportDocumentInput,
  ModelingDocumentFileMutationResult,
  ModelingCommitSketchCorrelation,
  ModelingCommitSketchInput,
  ModelingEvaluatePreviewInput,
  ModelingProjectSketchExternalReferencesInput,
  ModelingPreviewResult,
  ModelingResolvedReferenceResult,
} from "./modeling-service/index";
