import type { ImportCapabilities } from "@/contracts/import/capabilities";
import type {
  ImportPreparedActions,
  ImportPreparedActionRef,
} from "@/contracts/import/actions";
import { validateImportOrderedActionsInvariants } from "@/contracts/import/validation";
import type { ImportProvider } from "@/contracts/import/provider";
import type { ImportResult } from "@/contracts/import/result";
import type { ImportReviewEnvelope } from "@/contracts/import/review";
import type { ResolvedImportSource } from "@/contracts/import/source";
import type {
  ModelingDiagnostic,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";
import { hashGeometryAssetBytes } from "@/domain/modeling/geometry-asset-store";
import { registerEmbeddedBinaryAsset } from "@/domain/modeling/embedded-binary-asset-registry";
import type { ModelingService } from "@/domain/modeling/modeling-service";

export async function resolveLocalFileImportSource(
  file: File,
): Promise<ResolvedImportSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fingerprint = await hashGeometryAssetBytes(bytes);

  return {
    name: file.name,
    origin: {
      kind: "localFile",
      fileName: file.name,
    },
    mediaType: file.type.trim().length > 0 ? file.type : null,
    bytes,
    fingerprint,
  };
}

export function createImportCapabilities(
  _modelingService: ModelingService,
  snapshot: WorkspaceSnapshot,
): ImportCapabilities {
  return {
    context: {
      contractVersion: CONTRACT_VERSION,
      documentId: snapshot.document.documentId,
      baseRevisionId: snapshot.document.revisionId,
    },
    modeling: {
      async bakeGeometry() {
        throw new Error("Geometry import baking is not implemented yet.");
      },
      async reconstructMeshToBrep() {
        throw new Error("Mesh-to-B-rep reconstruction is not implemented yet.");
      },
    },
    sketch: {
      async convertVectorToSketch() {
        throw new Error("Vector-to-sketch conversion is not implemented yet.");
      },
    },
    assets: {
      async registerGeometryAsset() {
        throw new Error("Geometry asset registration is not implemented yet.");
      },
      async storeEmbeddedBinary(input) {
        const hash = await hashGeometryAssetBytes(input.bytes);
        const assetId = `asset_embedded_${hash.slice("sha256:".length, "sha256:".length + 16)}`;
        registerEmbeddedBinaryAsset({
          assetId,
          bytes: input.bytes,
          mediaType: input.mediaType,
        });
        return assetId;
      },
    },
    // The sandboxed kernel history probe is intentionally absent: the platform
    // has no per-entity geometric-signature extraction yet. Absence is
    // explicit (`history` omitted) so providers detect it and degrade
    // topological reference resolution to the baked tier rather than relying on
    // a stub that fabricates signatures. Deferred to add-kernel-topology-signatures.
  };
}

export function toImportModelingDiagnostics(
  diagnostics: readonly {
    severity: ModelingDiagnostic["severity"];
    message: string;
    code?: string;
  }[],
): ModelingDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code ?? "import-diagnostic",
    severity: diagnostic.severity,
    message: diagnostic.message,
    target: null,
    detail: null,
  }));
}

export async function createImportSession(input: {
  provider: ImportProvider<unknown, unknown, FeatureEditorFormSchema>;
  source: ResolvedImportSource;
  capabilities: ImportCapabilities;
}) {
  const review = await input.provider.review({
    source: input.source,
    capabilities: input.capabilities,
  });
  const selections = input.provider.createDefaultSelections(review);

  return {
    providerId: input.provider.id,
    resolvedSource: input.source,
    review,
    selections,
    formSchema: input.provider.getReviewFormSchema(review, selections),
    diagnostics: [],
  };
}

export async function applyImportPreparedActions(input: {
  modelingService: ModelingService;
  baseRevisionId: WorkspaceSnapshot["document"]["revisionId"];
  actions: ImportPreparedActions;
  /**
   * Reverts the last `appliedOperationCount` committed operations to keep the
   * import atomic on mid-sequence failure. Injected by the caller because the
   * durable-history revert lives at the repository layer; called once with the
   * number of operations that were applied before the failure.
   */
  rollback?: (appliedOperationCount: number) => Promise<void>;
}) {
  let revisionId = input.baseRevisionId;
  const diagnostics: ModelingDiagnostic[] = [
    ...toImportModelingDiagnostics(input.actions.diagnostics ?? []),
  ];
  const createdEntityIds: ImportResult["createdEntityIds"] = {
    featureIds: [],
    sketchIds: [],
    variableIds: [],
  };
  let appliedOperationCount = 0;

  const applyVariable = async (index: number) => {
    const request = (input.actions.addDocumentVariables ?? [])[index];
    const result = await input.modelingService.addDocumentVariable({
      ...request,
      baseRevisionId: revisionId,
    });
    if (result.isErr()) {
      throw result.error;
    }
    revisionId = result.value.revisionId;
    createdEntityIds.variableIds.push(result.value.variableId);
    diagnostics.push(...result.value.diagnostics);
    appliedOperationCount += 1;
  };

  const applyFeature = async (index: number) => {
    const request = (input.actions.createFeatures ?? [])[index];
    const result = await input.modelingService.createFeature({
      ...request,
      baseRevisionId: revisionId,
    });
    if (result.isErr()) {
      throw result.error;
    }
    revisionId = result.value.revisionId;
    createdEntityIds.featureIds.push(result.value.featureId);
    diagnostics.push(...result.value.diagnostics);
    appliedOperationCount += 1;
  };

  const applySketch = async (index: number) => {
    const request = (input.actions.commitSketches ?? [])[index];
    const result = await input.modelingService.commitSketch({
      ...request,
      baseRevisionId: revisionId,
    });
    if (result.isErr()) {
      throw result.error;
    }
    revisionId = result.value.revisionId;
    createdEntityIds.sketchIds.push(result.value.sketchId);
    diagnostics.push(...result.value.diagnostics);
    appliedOperationCount += 1;
  };

  const applyByKind = async (ref: ImportPreparedActionRef) => {
    switch (ref.kind) {
      case "addDocumentVariable":
        return applyVariable(ref.index);
      case "createFeature":
        return applyFeature(ref.index);
      case "commitSketch":
        return applySketch(ref.index);
    }
  };

  // Build the ordered ref list for both the explicit and grouped paths, so a
  // single application loop can enforce atomic rollback uniformly.
  let refs: ImportPreparedActionRef[];
  if (input.actions.orderedActions) {
    // Reject omissions/duplicates before applying any action, keeping the
    // import atomic. Only the ordered-sequence permutation invariant is checked
    // here; per-request structural validity is the adapter's responsibility, as
    // in the grouped path.
    const issues = validateImportOrderedActionsInvariants(input.actions);
    if (issues.length > 0) {
      throw new Error(
        issues[0]?.message ?? "Invalid ordered import action sequence.",
      );
    }
    refs = input.actions.orderedActions;
  } else {
    refs = [
      ...(input.actions.addDocumentVariables ?? []).map(
        (_request, index): ImportPreparedActionRef => ({
          kind: "addDocumentVariable",
          index,
        }),
      ),
      ...(input.actions.createFeatures ?? []).map(
        (_request, index): ImportPreparedActionRef => ({
          kind: "createFeature",
          index,
        }),
      ),
      ...(input.actions.commitSketches ?? []).map(
        (_request, index): ImportPreparedActionRef => ({
          kind: "commitSketch",
          index,
        }),
      ),
    ];
  }

  let failure: unknown = null;
  for (const ref of refs) {
    try {
      await applyByKind(ref);
    } catch (error) {
      failure = error;
      break;
    }
  }

  if (failure) {
    // Atomic failure: revert every already-applied operation so no partial
    // import is committed. Rollback errors are surfaced, never swallowed.
    if (appliedOperationCount > 0 && input.rollback) {
      await input.rollback(appliedOperationCount);
    }
    const message =
      failure instanceof Error ? failure.message : String(failure);
    diagnostics.push({
      code: "import-apply-failed",
      severity: "error",
      message: `Import failed and was rolled back: ${message}`,
      target: null,
      detail: null,
    });
    return {
      revisionId: input.baseRevisionId,
      createdEntityIds: { featureIds: [], sketchIds: [], variableIds: [] },
      diagnostics,
      appliedOperationCount,
      rolledBack: appliedOperationCount > 0,
    };
  }

  return {
    revisionId,
    createdEntityIds,
    diagnostics,
    appliedOperationCount,
    rolledBack: false,
  };
}

export async function prepareImportActions<TReview, TSelections>(input: {
  provider: ImportProvider<TReview, TSelections, FeatureEditorFormSchema>;
  source: ResolvedImportSource;
  review: ImportReviewEnvelope<TReview>;
  selections: TSelections;
  capabilities: ImportCapabilities;
}) {
  return input.provider.prepare({
    source: input.source,
    review: input.review,
    selections: input.selections,
    capabilities: input.capabilities,
  });
}
