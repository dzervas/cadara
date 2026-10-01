import {
  buildFeatureDefinition,
  getFeaturePrimarySelectionTarget,
  type FeatureEditSessionState,
} from "@/domain/editor/feature-editing";
import {
  getSketchSessionDerivationSettings,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import {
  buildSketchPlaneCommitRequest,
  getSketchPlaneEditSelectionTarget,
} from "@/domain/editor/sketch-plane-editing";
import { buildSelectionTargetCatalog } from "@/domain/modeling/document-snapshot-view";
import type {
  DocumentFeatureCursor,
  WorkspaceSnapshot,
  ModelingDiagnostic,
} from "@/contracts/modeling/schema";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type {
  DocumentId,
  FeatureId,
  RequestId,
  RevisionId,
  SketchId,
} from "@/contracts/shared/ids";
import type { AuthoredActionSketch } from "@/contracts/modeling/authored-actions";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import { resolveSketchDerivationDistances } from "@/domain/modeling/sketch-dimension-expressions";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { requireSketchOffsetPublications } from "@/contracts/solver/runtime-schema";
import type {
  DeriveSketchRegionsRequest,
  ProjectedSketchReferenceRecord,
  SolverTolerancePolicy,
} from "@/contracts/solver/schema";
import type {
  RegionRecord,
  SketchSolveDiagnostic,
} from "@/contracts/sketch/schema";
import type { AppResultAsync } from "@/contracts/errors";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import { hydrateFeatureSessionFromSnapshot } from "@/core/editor/state-machine";
import type {
  EditorEffect,
  EditorEffectRuntime,
  EditorEvent,
} from "@/core/editor/state-machine";
import {
  createEditorEffectFailureEvent,
  getAppErrorRevisionId,
  getDurableDiagnosticTarget,
  isModelingMutationError,
  modelingMutationErrorToDiagnostic,
} from "@/core/editor/state-machine/error-mapping";
import { SketchRegionDerivationSupersededError } from "@/domain/solver/sketch-constraint-solver-adapter";

export function createEffectExecutor(runtime: EditorEffectRuntime) {
  return async function executeEffect(
    effect: EditorEffect,
  ): Promise<EditorEvent> {
    switch (effect.type) {
      case "document.fetchSnapshot": {
        try {
          const snapshot = await runtime.getCurrentDocumentSnapshot();

          return {
            type: "effect.snapshotLoaded",
            payload: {
              requestId: effect.requestId,
              documentId: snapshot.document.documentId,
              revisionId: snapshot.document.revisionId,
              snapshot,
              selectionCatalog: buildSelectionTargetCatalog(snapshot),
              preserveRenderRecordsOnFeatureDiagnostics:
                effect.preserveRenderRecordsOnFeatureDiagnostics,
            },
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Snapshot refresh failed.",
          );
        }
      }
      case "sketch.openSession": {
        try {
          const snapshot = await runtime.getCurrentDocumentSnapshot();
          const session = openSketchSessionFromSelection(
            effect.selection.slice(),
            snapshot,
          );

          if (!session) {
            return {
              type: "effect.sketchSessionOpenFailed",
              requestId: effect.requestId,
              documentId: snapshot.document.documentId,
              revisionId: snapshot.document.revisionId,
              commandSessionId: effect.commandSessionId,
              message:
                "Sketch requires an existing sketch, construction plane, or planar face selection.",
            };
          }

          return {
            type: "effect.sketchSessionOpened",
            requestId: effect.requestId,
            documentId: snapshot.document.documentId,
            revisionId: snapshot.document.revisionId,
            commandSessionId: effect.commandSessionId,
            session,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Sketch session could not be opened.",
          );
        }
      }
      case "feature.hydrateFromSelection": {
        try {
          const snapshot = await runtime.getCurrentDocumentSnapshot();
          const session = hydrateFeatureSessionFromSnapshot(
            snapshot,
            effect.selectedFeatureId,
          );

          if (!session) {
            return {
              type: "effect.featureSessionHydrationFailed",
              requestId: effect.requestId,
              documentId: snapshot.document.documentId,
              revisionId: snapshot.document.revisionId,
              commandSessionId: effect.commandSessionId,
              message: `Feature ${effect.selectedFeatureId} cannot be edited in the current feature session flow.`,
            };
          }

          return {
            type: "effect.featureSessionHydrated",
            requestId: effect.requestId,
            documentId: snapshot.document.documentId,
            revisionId: snapshot.document.revisionId,
            commandSessionId: effect.commandSessionId,
            session,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Feature session hydration failed.",
          );
        }
      }
      case "feature.evaluatePreview": {
        try {
          const result = await runtime.evaluatePreview({
            baseRevisionId: effect.baseRevisionId,
            featureSession: effect.featureSession,
          });

          return {
            type: "effect.featurePreviewCompleted",
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            revisionId: result.revisionId,
            stale: result.stale,
            diagnostics: result.diagnostics,
            renderables: result.renderables,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Feature preview failed.",
          );
        }
      }
      case "feature.commit": {
        try {
          const result = await runtime.commitFeature({
            baseRevisionId: effect.baseRevisionId,
            baseRepositoryHeads: effect.mutationBasis.baseRepositoryHeads,
            featureSession: effect.featureSession,
          });

          return {
            type: "effect.featureCommitted",
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            revisionId: result.revisionId,
            featureId: result.featureId,
            accepted: result.accepted,
            diagnostics: result.diagnostics,
            actualRevisionId: result.actualRevisionId,
            errorContext: result.errorContext,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Feature commit failed.",
          );
        }
      }
      case "sketch.commit": {
        try {
          const result = await runtime.commitSketch({
            requestId: effect.requestId,
            baseRevisionId: effect.baseRevisionId,
            baseRepositoryHeads: effect.mutationBasis.baseRepositoryHeads,
            session: effect.session,
            publicationBase: effect.publicationBase,
          });

          if (!result) {
            return {
              type: "effect.sketchCommitted",
              requestId: effect.requestId,
              documentId: effect.documentId,
              commandSessionId: effect.commandSessionId,
              baseRevisionId: effect.baseRevisionId,
              revisionId: effect.baseRevisionId,
              accepted: true,
              diagnostics: [],
            };
          }

          return {
            type: "effect.sketchCommitted",
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            revisionId: result.revisionId,
            accepted: result.accepted,
            diagnostics: result.diagnostics,
            actualRevisionId: result.actualRevisionId,
            publishedSketchId: result.publishedSketchId,
            durabilityPending: result.durabilityPending,
            errorContext: result.errorContext,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Sketch commit failed.",
          );
        }
      }
      case "sketchPlane.commit": {
        try {
          const result = await runtime.commitSketchPlane({
            requestId: effect.requestId,
            baseRevisionId: effect.baseRevisionId,
            baseRepositoryHeads: effect.mutationBasis.baseRepositoryHeads,
            session: effect.session,
          });

          return {
            type: "effect.sketchPlaneCommitted",
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            revisionId: result.revisionId,
            accepted: result.accepted,
            diagnostics: result.diagnostics,
            actualRevisionId: result.actualRevisionId,
            errorContext: result.errorContext,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Sketch plane commit failed.",
          );
        }
      }
      case "sketch.projectReferences": {
        try {
          const result = await runtime.projectSketchReferences({
            requestId: effect.requestId,
            documentId: effect.documentId,
            baseRevisionId: effect.baseRevisionId,
            session: effect.session,
          });

          return {
            type: "effect.sketchReferencesProjected",
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            projectedReferences: result.projectedReferences,
            diagnostics: result.diagnostics,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Sketch reference projection failed.",
          );
        }
      }
      case "sketch.deriveRegions": {
        // Real failures are not caught: they must reach the event loop's error
        // reporting, which then dispatches the standard failure event.
        if (!runtime.deriveSketchRegions) {
          throw new Error("Live sketch region derivation is not available.");
        }

        let result: Awaited<
          ReturnType<NonNullable<EditorEffectRuntime["deriveSketchRegions"]>>
        >;
        try {
          result = await runtime.deriveSketchRegions({
            requestId: effect.requestId,
            documentId: effect.documentId,
            baseRevisionId: effect.baseRevisionId,
            basis: effect.basis,
          });
        } catch (error: unknown) {
          if (!(error instanceof SketchRegionDerivationSupersededError)) {
            throw error;
          }
          // Superseded by a newer request for this document: a newer
          // generation of the same command session (T08b-g5: emitted while
          // this one was in flight, so it owns `pendingRegionRequest`), a
          // newer command session, or a restarted loop. In every case the
          // reducer discards this request's failure event as stale.
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Sketch region derivation was superseded.",
          );
        }

        return {
          type: "effect.sketchRegionsDerived",
          requestId: effect.requestId,
          documentId: effect.documentId,
          commandSessionId: effect.commandSessionId,
          baseRevisionId: effect.baseRevisionId,
          generation: effect.generation,
          regions: result.regions,
          diagnostics: result.diagnostics,
          offsetPublications: result.offsetPublications,
        };
      }
      case "sketch.publishOffsetPreview": {
        // U-G3: the same derivation boundary as live regions ([TECH] G1).
        // Real failures reach the event loop's error reporting.
        if (!runtime.deriveSketchRegions) {
          throw new Error("Offset preview publication is not available.");
        }
        let result: Awaited<
          ReturnType<NonNullable<EditorEffectRuntime["deriveSketchRegions"]>>
        >;
        try {
          result = await runtime.deriveSketchRegions({
            requestId: effect.requestId,
            documentId: effect.documentId,
            baseRevisionId: effect.baseRevisionId,
            basis: effect.basis,
          });
        } catch (error: unknown) {
          if (!(error instanceof SketchRegionDerivationSupersededError)) {
            throw error;
          }
          // Superseded by a newer derivation for this document; the reducer
          // drops this stale request's failure event (request-id check).
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Offset preview publication was superseded.",
          );
        }
        return {
          type: "effect.sketchOffsetPreviewPublished",
          requestId: effect.requestId,
          documentId: effect.documentId,
          commandSessionId: effect.commandSessionId,
          baseRevisionId: effect.baseRevisionId,
          derivationId: effect.derivationId,
          offsetPublications: result.offsetPublications,
        };
      }
      case "sketch.importReferenceImages": {
        try {
          if (!runtime.importSketchReferenceImages) {
            throw new Error(
              "Sketch reference-image import runtime is not available.",
            );
          }

          const result = await runtime.importSketchReferenceImages({
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            baseRepositoryHeads: effect.mutationBasis.baseRepositoryHeads,
            session: effect.session,
            payloads: effect.payloads,
          });

          return {
            type: "effect.sketchReferenceImageImportCompleted",
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            status: result.status,
            revisionId: result.revisionId,
            snapshot: result.snapshot,
            selectionCatalog: result.selectionCatalog,
            session: result.session,
            importedCount: result.importedCount,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Sketch reference-image import failed.",
          );
        }
      }
      case "sketch.specialModeEffect": {
        try {
          if (!runtime.runSketchSpecialModeEffect) {
            throw new Error(
              "Sketch special mode effect runtime is not available.",
            );
          }

          const result = await runtime.runSketchSpecialModeEffect({
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            modeId: effect.modeId,
            effectId: effect.effectId,
            kind: effect.kind,
            payload: effect.payload,
          });

          return {
            type: "effect.sketchSpecialModeEffectCompleted",
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            effectId: result.effectId,
            payload: result.payload,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Sketch special mode effect failed.",
          );
        }
      }
      case "document.moveHistoryCursor": {
        try {
          if (!runtime.setDocumentCursor) {
            throw new Error(
              "Document history cursor mutation runtime is not available.",
            );
          }

          const result = await runtime.setDocumentCursor({
            baseRevisionId: effect.baseRevisionId,
            baseRepositoryHeads: effect.mutationBasis.baseRepositoryHeads,
            cursor: effect.cursor,
            transient: effect.transient,
          });

          const snapshot = result.accepted
            ? await runtime.getCurrentDocumentSnapshot()
            : undefined;

          return {
            type: "effect.documentCursorMoved",
            requestId: effect.requestId,
            documentId: effect.documentId,
            baseRevisionId: effect.baseRevisionId,
            revisionId: result.revisionId,
            accepted: result.accepted,
            snapshot,
            diagnostics: result.diagnostics,
            actualRevisionId: result.actualRevisionId,
            errorContext: result.errorContext,
          };
        } catch (error: unknown) {
          return createEditorEffectFailureEvent(
            effect,
            error,
            "Document history cursor move failed.",
          );
        }
      }
      default:
        return {
          type: "effect.snapshotFailed",
          requestId: "request_unreachable",
          documentId: null,
          revisionId: null,
          error: "Unsupported effect.",
        };
    }
  };
}

export async function runEditorEffect(
  effect: EditorEffect,
  runtime: EditorEffectRuntime,
): Promise<EditorEvent> {
  return createEffectExecutor(runtime)(effect);
}

export function createModelingServiceEditorEffectRuntime(modelingService: {
  getCurrentDocumentSnapshot(): Promise<WorkspaceSnapshot>;
  projectSketchExternalReferences(input: {
    solverSchemaVersion: typeof SOLVER_SCHEMA_VERSION;
    requestId: RequestId;
    revisionId: RevisionId;
    sketchId: NonNullable<SketchSessionState["sketchId"]>;
    plane: SketchPlaneDefinition["frame"];
    tolerances: SolverTolerancePolicy;
    references: {
      referenceId: SketchSessionState["definition"]["referenceIds"][number];
      reference: SketchSessionState["definition"]["references"][number];
    }[];
  }): Promise<{
    projectedReferences: ProjectedSketchReferenceRecord[];
    diagnostics: ProjectedSketchReferenceRecord["diagnostics"];
  }>;
  sketchSolver: {
    /** See `SketchSolverAdapter.supersedesRegionDerivation`. */
    readonly supersedesRegionDerivation?: boolean;
    deriveSketchRegions(
      input: Omit<DeriveSketchRegionsRequest, "contractVersion">,
    ): Promise<{
      regions: RegionRecord[];
      diagnostics: SketchSolveDiagnostic[];
      offsetPublications: unknown;
    }>;
    createCommitCorrelation(requestId: RequestId): {
      requestId: RequestId;
      projectionRequestId: RequestId;
      validationRequestId: RequestId;
      solveRequestId: RequestId;
      regionRequestId: RequestId;
    };
    projectExternalReferences(input: {
      solverSchemaVersion: typeof SOLVER_SCHEMA_VERSION;
      requestId: RequestId;
      documentId: DocumentId;
      revisionId: RevisionId;
      sketchId: NonNullable<SketchSessionState["sketchId"]>;
      plane: SketchPlaneDefinition["frame"];
      tolerances: SolverTolerancePolicy;
      references: {
        referenceId: SketchSessionState["definition"]["referenceIds"][number];
        reference: SketchSessionState["definition"]["references"][number];
      }[];
    }): Promise<{
      projectedReferences: ProjectedSketchReferenceRecord[];
      diagnostics: ProjectedSketchReferenceRecord["diagnostics"];
    }>;
  } | null;
  commitSketch: (input: {
    requestId: RequestId;
    baseRevisionId: RevisionId;
    baseRepositoryHeads?: readonly string[];
    publicationBase?: {
      actionContextId: SketchId;
      expectedSketch: AuthoredActionSketch | null;
    };
    sketchId: SketchSessionState["commitRequest"] extends null
      ? never
      : NonNullable<SketchSessionState["commitRequest"]>["sketchId"];
    sketchLabel: SketchSessionState["commitRequest"] extends null
      ? never
      : NonNullable<SketchSessionState["commitRequest"]>["sketchLabel"];
    plane: SketchPlaneDefinition;
    definition: SketchSessionState["commitRequest"] extends null
      ? never
      : NonNullable<SketchSessionState["commitRequest"]>["definition"];
    solverCorrelation: {
      requestId: RequestId;
      projectionRequestId: RequestId;
      validationRequestId: RequestId;
      solveRequestId: RequestId;
      regionRequestId: RequestId;
    } | null;
  }) => AppResultAsync<{
    revisionId: RevisionId;
    sketchId: SketchId;
    durabilityPending?: boolean;
    revisionState:
      | { kind: "accepted" }
      | { kind: "conflict"; actualRevisionId: RevisionId }
      | { kind: "rejected"; reasonCode: string };
    diagnostics: ModelingDiagnostic[];
  }>;
  evaluatePreview: (input: {
    baseRevisionId: RevisionId;
    previewId: FeatureEditSessionState["previewId"];
    replacesFeatureId: FeatureId | null;
    definition: NonNullable<ReturnType<typeof buildFeatureDefinition>>;
  }) => Promise<{
    revisionId: RevisionId;
    stale: boolean;
    diagnostics: ModelingDiagnostic[];
    renderables: RenderableEntityRecord[];
  }>;
  createFeature: (input: {
    baseRevisionId: RevisionId;
    baseRepositoryHeads?: readonly string[];
    definition: NonNullable<ReturnType<typeof buildFeatureDefinition>>;
  }) => AppResultAsync<{
    revisionId: RevisionId;
    featureId: FeatureId;
    revisionState:
      | { kind: "accepted" }
      | { kind: "conflict"; actualRevisionId: RevisionId }
      | { kind: "rejected"; reasonCode: string };
    diagnostics: ModelingDiagnostic[];
  }>;
  updateFeature: (input: {
    baseRevisionId: RevisionId;
    baseRepositoryHeads?: readonly string[];
    definition: NonNullable<ReturnType<typeof buildFeatureDefinition>>;
    featureId: FeatureId;
  }) => AppResultAsync<{
    revisionId: RevisionId;
    featureId: FeatureId;
    revisionState:
      | { kind: "accepted" }
      | { kind: "conflict"; actualRevisionId: RevisionId }
      | { kind: "rejected"; reasonCode: string };
    diagnostics: ModelingDiagnostic[];
  }>;
  setFeatureCursor: (input: {
    baseRevisionId: RevisionId;
    baseRepositoryHeads?: readonly string[];
    cursor: DocumentFeatureCursor;
    persistHistory?: boolean;
  }) => AppResultAsync<{
    revisionId: RevisionId;
    revisionState:
      | { kind: "accepted" }
      | { kind: "conflict"; actualRevisionId: RevisionId }
      | { kind: "rejected"; reasonCode: string };
    diagnostics: ModelingDiagnostic[];
  }>;
}): EditorEffectRuntime {
  return {
    supersedesSketchRegionDerivation:
      modelingService.sketchSolver?.supersedesRegionDerivation === true,
    getCurrentDocumentSnapshot: () =>
      modelingService.getCurrentDocumentSnapshot(),
    async commitSketch(input) {
      // Evaluate with resolved derivation distances so committed geometry is
      // current, while the persisted relationships keep authored expressions.
      const commitDefinition = {
        ...evaluateSketchDerivations({
          definition: resolveSketchDerivationDistances({
            definition: input.session.definition,
            variables: input.session.documentVariables,
          }),
          ...getSketchSessionDerivationSettings(input.session),
        }).definition,
        derivedRelationships: input.session.definition.derivedRelationships,
      };
      const result = await modelingService.commitSketch({
        requestId: input.requestId,
        baseRevisionId: input.baseRevisionId,
        baseRepositoryHeads: input.baseRepositoryHeads,
        publicationBase: input.publicationBase,
        sketchId: input.session.commitRequest?.sketchId ?? null,
        sketchLabel:
          input.session.commitRequest?.sketchLabel ?? input.session.sketchLabel,
        plane: input.session.commitRequest?.plane ?? input.session.plane,
        definition: commitDefinition,
        solverCorrelation: modelingService.sketchSolver
          ? modelingService.sketchSolver.createCommitCorrelation(
              input.requestId,
            )
          : null,
      });

      if (result.isErr()) {
        if (!isModelingMutationError(result.error)) {
          throw result.error;
        }

        const actualRevisionId = getAppErrorRevisionId(
          result.error,
          "actualRevisionId",
        );

        return {
          revisionId: actualRevisionId ?? input.baseRevisionId,
          accepted: false,
          diagnostics: [
            modelingMutationErrorToDiagnostic(
              result.error,
              getDurableDiagnosticTarget(input.session.planeTarget),
            ),
          ],
          actualRevisionId,
          errorContext: result.error.context,
        };
      }

      return {
        revisionId: result.value.revisionId,
        accepted: true,
        diagnostics: result.value.diagnostics,
        publishedSketchId: result.value.sketchId,
        durabilityPending: result.value.durabilityPending,
      };
    },
    async commitSketchPlane(input) {
      const request = buildSketchPlaneCommitRequest(input.session);
      if (!request) {
        throw new Error(
          "Sketch plane commit failed because the selected plane is unavailable.",
        );
      }

      const result = await modelingService.commitSketch({
        requestId: input.requestId,
        baseRevisionId: input.baseRevisionId,
        baseRepositoryHeads: input.baseRepositoryHeads,
        ...request,
        solverCorrelation: modelingService.sketchSolver
          ? modelingService.sketchSolver.createCommitCorrelation(
              input.requestId,
            )
          : null,
      });

      if (result.isErr()) {
        if (!isModelingMutationError(result.error)) {
          throw result.error;
        }

        const actualRevisionId = getAppErrorRevisionId(
          result.error,
          "actualRevisionId",
        );

        return {
          revisionId: actualRevisionId ?? input.baseRevisionId,
          accepted: false,
          diagnostics: [
            modelingMutationErrorToDiagnostic(
              result.error,
              getDurableDiagnosticTarget(
                getSketchPlaneEditSelectionTarget(input.session),
              ),
            ),
          ],
          actualRevisionId,
          errorContext: result.error.context,
        };
      }

      return {
        revisionId: result.value.revisionId,
        accepted: true,
        diagnostics: result.value.diagnostics,
      };
    },
    async projectSketchReferences(input) {
      const sketchId =
        input.session.sketchId ??
        ("sketch_draft" as NonNullable<SketchSessionState["sketchId"]>);
      const externalReferences = input.session.definition.references;

      if (externalReferences.length === 0) {
        return {
          projectedReferences: [],
          diagnostics: [],
        };
      }

      return modelingService.projectSketchExternalReferences({
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: input.requestId,
        revisionId: input.baseRevisionId,
        sketchId,
        plane: input.session.plane.frame,
        tolerances: input.session.solverTolerances,
        references: externalReferences.map((reference) => ({
          referenceId: reference.referenceId,
          reference,
        })),
      });
    },
    async deriveSketchRegions(input) {
      if (!modelingService.sketchSolver) {
        throw new Error(
          "Live sketch regions require the modeling service sketch solver.",
        );
      }

      // Same async boundary the kernel uses, at the session's document tolerance.
      const result = await modelingService.sketchSolver.deriveSketchRegions({
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: input.requestId,
        documentId: input.documentId,
        revisionId: input.baseRevisionId,
        sketchId: input.basis.sketchId,
        definition: input.basis.definition,
        solvedSnapshot: input.basis.solvedSnapshot,
        projectedReferences: input.basis.projectedReferences,
        modelingTolerance: input.basis.modelingTolerance,
      });

      return {
        regions: result.regions,
        diagnostics: result.diagnostics,
        // Crosses the derivation-worker boundary as plain data: validated
        // before any offset publication is trusted ([TECH] G17).
        offsetPublications: requireSketchOffsetPublications(
          result.offsetPublications,
        ),
      };
    },
    async runSketchSpecialModeEffect() {
      throw new Error("No sketch special mode runtime has been registered.");
    },
    async evaluatePreview(input) {
      const definition = buildFeatureDefinition(input.featureSession);

      if (!definition) {
        throw new Error(
          "Feature preview failed because the draft is incomplete.",
        );
      }

      const result = await modelingService.evaluatePreview({
        baseRevisionId: input.baseRevisionId,
        previewId: input.featureSession.previewId,
        replacesFeatureId:
          input.featureSession.mode === "edit"
            ? input.featureSession.featureId
            : null,
        definition,
      });

      return {
        revisionId: result.revisionId,
        stale: result.stale,
        diagnostics: result.diagnostics,
        renderables: result.renderables,
      };
    },
    async commitFeature(input) {
      const definition = buildFeatureDefinition(input.featureSession);

      if (!definition) {
        throw new Error(
          "Feature commit failed because the draft is incomplete.",
        );
      }

      const baseInput = {
        baseRevisionId: input.baseRevisionId,
        baseRepositoryHeads: input.baseRepositoryHeads,
        definition,
      };

      const result =
        input.featureSession.mode === "edit" && input.featureSession.featureId
          ? await modelingService.updateFeature({
              ...baseInput,
              featureId: input.featureSession.featureId,
            })
          : await modelingService.createFeature({
              ...baseInput,
            });

      if (result.isErr()) {
        if (!isModelingMutationError(result.error)) {
          throw result.error;
        }

        const actualRevisionId = getAppErrorRevisionId(
          result.error,
          "actualRevisionId",
        );

        return {
          revisionId: actualRevisionId ?? input.baseRevisionId,
          featureId:
            input.featureSession.featureId ?? ("feature_rejected" as FeatureId),
          accepted: false,
          diagnostics: [
            modelingMutationErrorToDiagnostic(
              result.error,
              getDurableDiagnosticTarget(
                getFeaturePrimarySelectionTarget(input.featureSession),
              ),
            ),
          ],
          actualRevisionId,
          errorContext: result.error.context,
        };
      }

      return {
        revisionId: result.value.revisionId,
        featureId: result.value.featureId,
        accepted: true,
        diagnostics: result.value.diagnostics,
      };
    },
    async setDocumentCursor(input) {
      const result = await modelingService.setFeatureCursor({
        baseRevisionId: input.baseRevisionId,
        baseRepositoryHeads: input.baseRepositoryHeads,
        cursor: input.cursor,
        persistHistory: input.transient ? false : undefined,
      });

      if (result.isErr()) {
        if (!isModelingMutationError(result.error)) {
          throw result.error;
        }

        const actualRevisionId = getAppErrorRevisionId(
          result.error,
          "actualRevisionId",
        );

        return {
          revisionId: actualRevisionId ?? input.baseRevisionId,
          accepted: false,
          diagnostics: [modelingMutationErrorToDiagnostic(result.error)],
          actualRevisionId,
          errorContext: result.error.context,
        };
      }

      return {
        revisionId: result.value.revisionId,
        accepted: true,
        diagnostics: result.value.diagnostics,
      };
    },
  };
}
