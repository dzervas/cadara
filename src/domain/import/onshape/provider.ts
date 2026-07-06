/**
 * Onshape capture-bundle import provider (probe-less v1).
 *
 * Composes the pure translation modules into an `ImportProvider`: a
 * non-mutating review that validates the bundle and plans per-feature fidelity,
 * a schema-driven review form with studio selection and demotion controls, and
 * a prepare step that emits history-ordered actions for the parametric-tier
 * features (document variables and datum-plane sketches) plus an honest
 * fidelity report. Solid features degrade to `baked` with capability reason
 * codes while the history probe is absent.
 */
import type { ImportPreparedActions, ImportPreparedActionRef } from "@/contracts/import/actions";
import type { ImportDiagnostic } from "@/contracts/import/diagnostics";
import type { ImportProvider } from "@/contracts/import/provider";
import type { ImportReviewEnvelope } from "@/contracts/import/review";
import type { ResolvedImportSource } from "@/contracts/import/source";
import type { LocalFileImportBinding } from "@/contracts/import/binding";
import { IMPORT_CONTRACT_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  validateOnshapeCaptureBundle,
  type OnshapeCaptureBundle,
} from "@/contracts/import/onshape-capture-bundle";
import type {
  AddDocumentVariableRequest,
  CommitSketchRequest,
} from "@/contracts/modeling/schema";
import type { RequestId } from "@/contracts/shared/ids";
import type {
  FeatureEditorFormSchema,
  FeatureEditorFormField,
} from "@/core/feature-authoring/form-schema";

import {
  listPartStudios,
  readPartStudio,
} from "@/domain/import/onshape/bundle-reader";
import {
  planStudioFidelity,
  type FeaturePlan,
  type FidelityTier,
} from "@/domain/import/onshape/fidelity-planner";
import {
  verificationUnavailable,
  type GroundTruthVerification,
} from "@/domain/import/onshape/ground-truth";
import {
  projectPointToPlane,
  translateSketch,
  type SolvedSketchEntityGeometry,
} from "@/domain/import/onshape/sketch-translator";
import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";

const ACCEPTED_EXTENSION = ".onshape-capture.json";

export interface OnshapeStudioReview {
  elementId: string;
  name: string;
  hasBodies: boolean;
  featurePlans: FeaturePlan[];
  tierCounts: Record<FidelityTier, number>;
  verification: GroundTruthVerification;
}

export interface OnshapeImportReview {
  valid: boolean;
  studios: OnshapeStudioReview[];
  defaultStudioId: string | null;
}

export interface OnshapeImportSelections {
  studioElementId: string | null;
  /** Feature ids the user demoted from parametric to baked. */
  demotedFeatureIds: string[];
}

function decodeBundle(source: ResolvedImportSource): OnshapeCaptureBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(source.bytes));
  } catch {
    return null;
  }
  const result = validateOnshapeCaptureBundle(parsed);
  return result.success ? result.data : null;
}

function reviewStudio(
  bundle: OnshapeCaptureBundle,
  elementId: string,
): OnshapeStudioReview {
  const read = readPartStudio(bundle, elementId);
  const plan = planStudioFidelity(read);
  return {
    elementId: read.studio.elementId,
    name: read.studio.name,
    hasBodies: read.studio.groundTruth.hasBodies,
    featurePlans: plan.featurePlans,
    tierCounts: plan.tierCounts,
    verification: verificationUnavailable(read.studio.groundTruth.hasBodies),
  };
}

function extractVariable(
  parameters: readonly unknown[] | undefined,
): { name: string; expression: string | null } | null {
  let name: string | null = null;
  let expression: string | null = null;
  for (const parameter of parameters ?? []) {
    if (typeof parameter !== "object" || parameter === null) {
      continue;
    }
    const parameterId = (parameter as { parameterId?: unknown }).parameterId;
    const raw = parameter as { value?: unknown; expression?: unknown };
    if (parameterId === "name" && typeof raw.value === "string") {
      name = raw.value;
    }
    // Only the authored expression text is trusted; the captured evaluated
    // value is intentionally ignored (it can be absent/zero in the bundle).
    if (parameterId === "value" && typeof raw.expression === "string") {
      expression = raw.expression;
    }
  }
  return name ? { name, expression } : null;
}

function summaryField(id: string, label: string, value: string): FeatureEditorFormField {
  return { kind: "summary", id, label, value };
}

function sanitizeCorrelationPart(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}

export const onshapeImportProvider: ImportProvider<
  OnshapeImportReview,
  OnshapeImportSelections,
  FeatureEditorFormSchema
> = {
  id: "onshape-capture-bundle",
  label: "Onshape Capture Bundle",
  acceptedFileTypes: [
    { extension: ACCEPTED_EXTENSION, mediaType: "application/json" },
  ],

  accepts(source) {
    return source.name.toLowerCase().endsWith(ACCEPTED_EXTENSION);
  },

  async review({ source }) {
    const bundle = decodeBundle(source);
    if (!bundle) {
      const envelope: ImportReviewEnvelope<OnshapeImportReview> = {
        providerReview: { valid: false, studios: [], defaultStudioId: null },
        proposedActionKinds: [],
        diagnostics: [
          {
            severity: "error",
            message:
              "The selected file is not a valid Onshape capture bundle (envelope validation failed or unsupported format version).",
            code: "onshape-bundle-invalid",
          },
        ],
      };
      return envelope;
    }

    const studioList = listPartStudios(bundle);
    const studios = studioList.map((entry) =>
      reviewStudio(bundle, entry.elementId),
    );
    const defaultStudio =
      studios.find((studio) => studio.hasBodies) ?? studios[0] ?? null;

    const diagnostics: ImportDiagnostic[] = studios.flatMap((studio) =>
      studio.verification.status === "unavailable"
        ? [
            {
              severity: "warning" as const,
              message: `Ground-truth verification is unavailable for "${studio.name}"; imported geometry was not checked against the captured model.`,
              code: "onshape-verification-unavailable",
            },
          ]
        : [],
    );

    return {
      providerReview: {
        valid: true,
        studios,
        defaultStudioId: defaultStudio?.elementId ?? null,
      },
      proposedActionKinds: ["addDocumentVariable", "commitSketch"],
      diagnostics,
    };
  },

  createDefaultSelections(review) {
    return {
      studioElementId: review.providerReview.defaultStudioId,
      demotedFeatureIds: [],
    };
  },

  getReviewFormSchema(review, selections) {
    const { studios } = review.providerReview;
    const selected =
      studios.find((studio) => studio.elementId === selections.studioElementId) ??
      studios[0] ??
      null;

    const studioField: FeatureEditorFormField = {
      kind: "enum",
      id: "studio",
      label: "Part Studio",
      value: selected?.elementId ?? "",
      options: studios.map((studio) => ({
        value: studio.elementId,
        label: `${studio.name} (${studio.featurePlans.length} features)`,
      })),
      patch: { patchKey: "studioElementId" },
    };

    const reportFields: FeatureEditorFormField[] = selected
      ? selected.featurePlans.map((plan) =>
          summaryField(
            `feature-${plan.onshapeFeatureId}`,
            plan.label,
            `${plan.tier}${plan.suppressed ? " (suppressed)" : ""} — ${plan.reasonCodes.join(", ")}`,
          ),
        )
      : [];

    const verificationValue = selected
      ? selected.verification.status === "unavailable"
        ? "Unavailable — geometry was not verified against the captured model."
        : selected.verification.status === "noGroundTruth"
          ? "No captured geometry to verify."
          : selected.verification.status
      : "No studio selected.";

    const schema: FeatureEditorFormSchema = {
      sections: [
        { id: "studio-selection", title: "Studio", fields: [studioField] },
        {
          id: "fidelity-report",
          title: "Per-feature fidelity",
          fields: reportFields,
        },
        {
          id: "verification",
          title: "Ground-truth verification",
          fields: [
            summaryField("verification-status", "Status", verificationValue),
          ],
        },
      ],
    };
    return schema;
  },

  applySelectionPatch(_review, selections, patch) {
    const next: OnshapeImportSelections = { ...selections };
    if (typeof patch.studioElementId === "string") {
      next.studioElementId = patch.studioElementId;
    }
    if (Array.isArray(patch.demotedFeatureIds)) {
      next.demotedFeatureIds = patch.demotedFeatureIds.filter(
        (id): id is string => typeof id === "string",
      );
    }
    return next;
  },

  async prepare({ source, selections, capabilities }) {
    const bundle = decodeBundle(source);
    if (!bundle) {
      return {
        diagnostics: [
          {
            severity: "error",
            message: "The Onshape bundle could not be read during prepare.",
            code: "onshape-bundle-invalid",
          },
        ],
      };
    }

    const elementId =
      selections.studioElementId ?? bundle.partStudios[0]?.elementId ?? "";
    const read = readPartStudio(bundle, elementId);
    const plan = planStudioFidelity(read);
    const demoted = new Set(selections.demotedFeatureIds);
    const featuresById = new Map(read.features.map((f) => [f.featureId, f]));

    const context = capabilities.context;
    const addDocumentVariables: AddDocumentVariableRequest[] = [];
    const commitSketches: CommitSketchRequest[] = [];
    const orderedActions: ImportPreparedActionRef[] = [];
    const diagnostics: ImportDiagnostic[] = [];

    for (const featurePlan of plan.featurePlans) {
      const demotedByUser = demoted.has(featurePlan.onshapeFeatureId);
      if (featurePlan.tier !== "parametric" || demotedByUser) {
        if (demotedByUser) {
          diagnostics.push({
            severity: "info",
            message: `"${featurePlan.label}" was demoted to baked by the reviewer.`,
            code: "onshape-feature-demoted",
          });
        } else {
          diagnostics.push({
            severity: "warning",
            message: `"${featurePlan.label}" (${featurePlan.featureType}) imported as ${featurePlan.tier}: ${featurePlan.reasonCodes.join(", ")}.`,
            code: "onshape-feature-degraded",
          });
        }
        continue;
      }

      if (featurePlan.target.kind === "variable") {
        const feature = featuresById.get(featurePlan.onshapeFeatureId);
        const variable = extractVariable(feature?.parameters);
        if (!variable) {
          diagnostics.push({
            severity: "warning",
            message: `Variable feature "${featurePlan.label}" had no readable name/value and was skipped.`,
            code: "onshape-variable-unreadable",
          });
          continue;
        }
        const translated = translateOnshapeExpression({
          expression: variable.expression,
        });
        if (translated.diagnostic) {
          diagnostics.push({
            severity: "warning",
            message: translated.diagnostic.message,
            code: translated.diagnostic.code,
          });
        }
        addDocumentVariables.push({
          contractVersion: context.contractVersion,
          documentId: context.documentId,
          baseRevisionId: context.baseRevisionId,
          name: variable.name,
          valueText: translated.valueText,
        });
        orderedActions.push({
          kind: "addDocumentVariable",
          index: addDocumentVariables.length - 1,
        });
        continue;
      }

      if (featurePlan.target.kind === "sketch") {
        const planeKey = featurePlan.target.planeKey;
        const solved = read.solvedSketchesByFeatureId.get(
          featurePlan.onshapeFeatureId,
        );
        const entities: SolvedSketchEntityGeometry[] = (
          solved?.entities ?? []
        ).map((curve) => ({
          entityId: curve.entityId,
          entityType: curve.entityType,
          isConstruction: curve.isConstruction,
          start: curve.start3d
            ? projectPointToPlane(curve.start3d, planeKey)
            : undefined,
          end: curve.end3d
            ? projectPointToPlane(curve.end3d, planeKey)
            : undefined,
          center: curve.center3d
            ? projectPointToPlane(curve.center3d, planeKey)
            : undefined,
          // Onshape radii are in meters; sketch units are millimeters.
          radius: curve.radius === undefined ? undefined : curve.radius * 1000,
        }));
        const translation = translateSketch({
          featureId: featurePlan.onshapeFeatureId,
          label: featurePlan.label,
          planeKey,
          entities,
        });
        for (const sketchDiagnostic of translation.diagnostics) {
          diagnostics.push({
            severity: "info",
            message: sketchDiagnostic.message,
            code: sketchDiagnostic.code,
          });
        }
        // The provider owns solver correlation ids per the commit contract
        // ("Editor- or orchestrator-owned correlation IDs"); a null correlation
        // skips projection/solve/region derivation, which the mock and real
        // kernel lanes require for a committed import sketch.
        const correlationRoot = `request_import_${sanitizeCorrelationPart(featurePlan.onshapeFeatureId)}`;
        commitSketches.push({
          contractVersion: context.contractVersion,
          documentId: context.documentId,
          baseRevisionId: context.baseRevisionId,
          solverCorrelation: {
            requestId: correlationRoot as RequestId,
            projectionRequestId: `${correlationRoot}_project` as RequestId,
            validationRequestId: `${correlationRoot}_validate` as RequestId,
            solveRequestId: `${correlationRoot}_solve` as RequestId,
            regionRequestId: `${correlationRoot}_regions` as RequestId,
          },
          sketchId: null,
          sketchLabel: featurePlan.label,
          plane: translation.plane,
          definition: translation.definition,
        });
        orderedActions.push({
          kind: "commitSketch",
          index: commitSketches.length - 1,
        });
      }
    }

    if (plan.requiresStudioBake) {
      diagnostics.push({
        severity: "warning",
        message:
          "Non-parametric solid geometry could not be materialized: baking requires the geometry-import capability, which is not available. The final-state body was not imported.",
        code: "onshape-bake-unavailable",
      });
    }

    diagnostics.push({
      severity: "info",
      message: `Fidelity: ${plan.tierCounts.parametric} parametric, ${plan.tierCounts.baked} baked, ${plan.tierCounts.geometryOnly} geometry-only.`,
      code: "onshape-fidelity-summary",
    });

    const binding: LocalFileImportBinding = {
      schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
      kind: "localFile",
      fileName: source.name,
      fingerprint: source.fingerprint,
      refreshPolicy: "manual",
    };

    const actions: ImportPreparedActions = {
      addDocumentVariables,
      commitSketches,
      orderedActions,
      binding,
      diagnostics,
    };
    return actions;
  },
};
