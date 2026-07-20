import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
} from "@/contracts/modeling/advanced-solid";
import type {
  FeatureAuthoringDefinition,
  TransformFeatureParameterDraft,
} from "@/core/feature-authoring/definition";
import {
  createSelectionFilterForRequirement,
  transformSelectionFilter,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  asPlaneReferenceTarget,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredNumberLiteral,
  createMissingInputDiagnostic,
  expressionCapableAuthoredValue,
  isPositiveAuthoredNumber,
} from "@/core/feature-authoring/features/shared";

export const transformParticipants = [
  {
    role: "body",
    label: "Body targets",
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ["body"],
  },
  {
    role: "transformReference",
    label: "Transform reference",
    required: false,
    cardinality: { min: 0, max: 1 },
    acceptedKinds: ["construction", "face"],
  },
  {
    role: "axis",
    label: "Rotation axis",
    required: false,
    cardinality: { min: 0, max: 1 },
    acceptedKinds: ["construction", "face", "edge", "sketchEntity"],
  },
] as const;

export const transformOptions = [
  {
    key: "transformType",
    label: "Transform type",
    required: false,
    valueKind: "enum",
    enumValues: ["translation", "rotation"],
  },
  {
    key: "distance",
    label: "Distance",
    required: false,
    valueKind: "positiveNumber",
  },
  {
    key: "angle",
    label: "Angle",
    required: false,
    valueKind: "angle",
  },
] as const;

function isNormalDirection(value: unknown): value is "positive" | "negative" {
  return value === "positive" || value === "negative";
}

function isTransformType(value: unknown): value is "translation" | "rotation" {
  return value === "translation" || value === "rotation";
}

function asAxisReferenceTarget(value: PrimitiveRef | null) {
  return value?.kind === "construction" ||
    value?.kind === "face" ||
    value?.kind === "edge" ||
    value?.kind === "sketchEntity"
    ? value
    : null;
}

function filterBodyTargets(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Extract<PrimitiveRef, { kind: "body" }> =>
          asBodyRef(entry as PrimitiveRef) !== null,
      )
    : [];
}

function buildTransformDefinition(draft: TransformFeatureParameterDraft) {
  if (draft.transformType === "rotation") {
    return {
      kind: "transform" as const,
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          ...(draft.bodyTargets.length > 0
            ? [{ role: "body" as const, targets: draft.bodyTargets }]
            : []),
          ...(draft.axisTarget
            ? [{ role: "axis" as const, targets: [draft.axisTarget] }]
            : []),
        ],
        options: {
          transformType: "rotation" as const,
          angle: authoredDefinitionValue(draft.angle, 0),
        },
      },
    };
  }

  return {
    kind: "transform" as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        ...(draft.bodyTargets.length > 0
          ? [{ role: "body" as const, targets: draft.bodyTargets }]
          : []),
        ...(draft.transformReferenceTarget
          ? [
              {
                role: "transformReference" as const,
                targets: [draft.transformReferenceTarget],
              },
            ]
          : []),
      ],
      options: {
        distance: authoredDefinitionValue(draft.distance, 1),
        direction: draft.direction,
      },
    },
  };
}

function getTransformValidationDiagnostics(
  draft: TransformFeatureParameterDraft,
) {
  const diagnostics = validateAdvancedSolidFeatureDefinition(
    buildTransformDefinition(draft),
    {
      featureKind: "transform",
      participants: transformParticipants,
      options: transformOptions,
    },
  );

  if (!isNormalDirection(draft.direction)) {
    diagnostics.push({
      code: "advanced-feature-invalid-option",
      severity: "error",
      role: null,
      target: null,
      message: "Direction must be positive or negative.",
    });
  }

  return diagnostics;
}

export const transformAuthoringDefinition = {
  metadata: {
    kind: "transform",
    name: "Transform",
    tooltip:
      "Translate selected bodies along an explicit planar reference normal.",
    icon: "transform",
    toolId: "transform",
    groupId: "transforms",
    modes: ["part"],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: transformSelectionFilter,
  advancedParticipants: transformParticipants,
  createDraft(input) {
    const selectedBody = asBodyRef(input.selectedTarget);
    const selectedReference = asPlaneReferenceTarget(input.selectedTarget);
    return {
      bodyTargets: selectedBody ? [selectedBody] : [],
      transformReferenceTarget: selectedReference,
      distance: 1,
      direction: "positive",
      transformType: "translation",
      axisTarget: null,
      angle: 0,
    };
  },
  hydrateDraft(feature) {
    const direction = feature.parameters.options?.direction;
    const transformType = feature.parameters.options?.transformType;
    return {
      bodyTargets: filterBodyTargets(
        feature.parameters.participants.find(
          (participant) => participant.role === "body",
        )?.targets ?? [],
      ),
      transformReferenceTarget: asPlaneReferenceTarget(
        feature.parameters.participants.find(
          (participant) => participant.role === "transformReference",
        )?.targets[0] ?? null,
      ),
      distance: (feature.parameters.options?.distance ??
        1) as TransformFeatureParameterDraft["distance"],
      direction: isNormalDirection(direction) ? direction : "positive",
      transformType: isTransformType(transformType)
        ? transformType
        : "translation",
      axisTarget: asAxisReferenceTarget(
        (feature.parameters.participants.find(
          (participant) => participant.role === "axis",
        )?.targets[0] ?? null) as PrimitiveRef | null,
      ),
      angle: (feature.parameters.options?.angle ??
        0) as TransformFeatureParameterDraft["angle"],
    };
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      bodyTargets:
        patch.bodyTargets === undefined
          ? draft.bodyTargets
          : filterBodyTargets(patch.bodyTargets),
      transformReferenceTarget:
        patch.transformReferenceTarget === undefined
          ? draft.transformReferenceTarget
          : asPlaneReferenceTarget(
              patch.transformReferenceTarget as PrimitiveRef | null,
            ),
      distance: acceptAuthoredPatch(
        patch.distance,
        draft.distance,
        (value): value is number => typeof value === "number",
      ),
      direction: isNormalDirection(patch.direction)
        ? patch.direction
        : draft.direction,
      transformType: isTransformType(patch.transformType)
        ? patch.transformType
        : draft.transformType,
      axisTarget:
        patch.axisTarget === undefined
          ? draft.axisTarget
          : asAxisReferenceTarget(patch.axisTarget as PrimitiveRef | null),
      angle: acceptAuthoredPatch(
        patch.angle,
        draft.angle,
        (value): value is number => typeof value === "number",
      ),
    };
  },
  applySelection(draft, target) {
    const bodyTarget = asBodyRef(target);
    if (bodyTarget) {
      return this.applyPatch(draft, {
        bodyTargets: appendUniqueTarget(draft.bodyTargets, bodyTarget),
      });
    }

    if (draft.transformType === "rotation") {
      const axisTarget = asAxisReferenceTarget(target);
      return axisTarget ? this.applyPatch(draft, { axisTarget }) : draft;
    }

    const referenceTarget = asPlaneReferenceTarget(target);
    return referenceTarget
      ? this.applyPatch(draft, { transformReferenceTarget: referenceTarget })
      : draft;
  },
  getPrimarySelectionTarget(draft) {
    return (
      draft.bodyTargets[0] ??
      (draft.transformType === "rotation"
        ? draft.axisTarget
        : draft.transformReferenceTarget) ??
      null
    );
  },
  getPreviewLabel(draft, prefix) {
    if (draft.bodyTargets.length === 0) {
      return "Select one or more bodies to transform";
    }
    if (draft.transformType === "rotation") {
      if (!draft.axisTarget) {
        return "Select one rotation axis reference";
      }
      const angle = authoredNumberLiteral(draft.angle);
      if (angle === null || angle === 0) {
        return "Enter a non-zero rotation angle";
      }
      return `${prefix} rotation on ${draft.bodyTargets.length} bod${draft.bodyTargets.length === 1 ? "y" : "ies"}`;
    }
    if (!draft.transformReferenceTarget) {
      return "Select one transform reference plane";
    }
    const distance = authoredNumberLiteral(draft.distance);
    if (distance !== null && distance <= 0) {
      return "Enter a positive transform distance";
    }
    return `${prefix} transform on ${draft.bodyTargets.length} bod${draft.bodyTargets.length === 1 ? "y" : "ies"}`;
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getTransformValidationDiagnostics(input.draft);
    if (diagnostics.length > 0) {
      return diagnostics.map((diagnostic) => ({
        code: `feature-${input.phase}-${diagnostic.code}`,
        severity:
          input.phase === "preview" ? ("warning" as const) : ("error" as const),
        message: diagnostic.message,
        target: diagnostic.target,
        detail: {
          kind: "advancedFeatureValidation" as const,
          diagnostic,
        },
      }));
    }

    return [
      createMissingInputDiagnostic({
        feature: "transform",
        phase: input.phase,
        suffix: "references",
        message:
          "Transform preview requires body targets, one explicit transform reference, and a positive distance.",
      }),
    ];
  },
  buildDefinition(draft) {
    return getTransformValidationDiagnostics(draft).length === 0
      ? buildTransformDefinition(draft)
      : null;
  },
  getFormSchema(session) {
    const isRotation = session.draft.transformType === "rotation";
    const bodyField = {
      kind: "referenceCollection" as const,
      id: "transform-bodies",
      label: "Body targets",
      value: session.draft.bodyTargets,
      emptyLabel: "No body targets selected",
      helper: "Select each explicit durable body that should be transformed.",
      error:
        session.draft.bodyTargets.length > 0
          ? null
          : { message: "Select at least one body." },
      advancedParticipant: {
        role: "body" as const,
        required: true,
        cardinality: { min: 1, max: null },
        selectedCount: session.draft.bodyTargets.length,
      },
      picker: {
        mode: "appendUnique" as const,
        allowsMultiple: true,
        selectionFilter: createSelectionFilterForRequirement(
          transformSelectionFilter,
          "transform-body",
          "Transform bodies",
        ),
        itemLabel: "Body",
      },
      patch: { patchKey: "bodyTargets" },
    };
    const typeField = {
      kind: "enum" as const,
      id: "transform-type",
      label: "Transform type",
      value: session.draft.transformType,
      options: [
        { value: "translation", label: "Translation" },
        { value: "rotation", label: "Rotation" },
      ],
      authoredValue: expressionCapableAuthoredValue(
        session.draft.transformType,
        { kind: "enumString", options: ["translation", "rotation"] },
      ),
      patch: { patchKey: "transformType" },
    };
    const referenceField = isRotation
      ? {
          kind: "referencePicker" as const,
          id: "transform-axis",
          label: "Rotation axis",
          value: session.draft.axisTarget,
          emptyLabel: "No rotation axis selected",
          helper:
            "Select one construction plane, planar face, linear edge, or sketch line. Bodies rotate about this axis.",
          error: session.draft.axisTarget
            ? null
            : { message: "Select one rotation axis." },
          advancedParticipant: {
            role: "axis" as const,
            required: true,
            cardinality: { min: 1, max: 1 },
            selectedCount: session.draft.axisTarget ? 1 : 0,
          },
          picker: {
            mode: "replace" as const,
            allowsMultiple: false,
            selectionFilter: createSelectionFilterForRequirement(
              transformSelectionFilter,
              "transform-axis",
              "Rotation axis",
            ),
          },
          patch: { patchKey: "axisTarget" },
        }
      : {
          kind: "referencePicker" as const,
          id: "transform-reference",
          label: "Transform reference",
          value: session.draft.transformReferenceTarget,
          emptyLabel: "No transform reference selected",
          helper:
            "Select one planar face or construction plane. The initial transform path translates along its normal.",
          error: session.draft.transformReferenceTarget
            ? null
            : { message: "Select one transform reference." },
          advancedParticipant: {
            role: "transformReference" as const,
            required: true,
            cardinality: { min: 1, max: 1 },
            selectedCount: session.draft.transformReferenceTarget ? 1 : 0,
          },
          picker: {
            mode: "replace" as const,
            allowsMultiple: false,
            selectionFilter: createSelectionFilterForRequirement(
              transformSelectionFilter,
              "transform-reference",
              "Transform reference",
            ),
          },
          patch: { patchKey: "transformReferenceTarget" },
        };
    const parameterField = isRotation
      ? {
          kind: "numeric" as const,
          id: "transform-angle",
          label: "Angle",
          value: authoredNumberFormValue(session.draft.angle),
          input: "angleDegrees" as const,
          step: 1,
          error:
            authoredNumberLiteral(session.draft.angle) === 0
              ? { message: "Angle must be non-zero." }
              : null,
          authoredValue: expressionCapableAuthoredValue(session.draft.angle, {
            kind: "angle",
          }),
          patch: { patchKey: "angle" },
        }
      : {
          kind: "numeric" as const,
          id: "transform-distance",
          label: "Distance",
          value: authoredNumberFormValue(session.draft.distance),
          input: "number" as const,
          step: 0.1,
          directionToggle: {
            patch: { patchKey: "direction" },
            value: session.draft.direction,
            forwardValue: "positive",
            reverseValue: "negative",
            forwardLabel: "Positive normal",
            reverseLabel: "Negative normal",
          },
          error: isPositiveAuthoredNumber(session.draft.distance)
            ? null
            : { message: "Distance must be greater than zero." },
          authoredValue: expressionCapableAuthoredValue(session.draft.distance, {
            kind: "positiveNumber",
          }),
          patch: { patchKey: "distance" },
        };
    return {
      sections: [
        {
          id: "references",
          title: "References",
          fields: [typeField, bodyField, referenceField],
        },
        {
          id: "parameters",
          title: "Parameters",
          fields: [parameterField],
        },
        {
          id: "diagnostics",
          title: "Diagnostics",
          fields: [
            {
              kind: "diagnostics",
              id: "transform-diagnostics",
              label: "Diagnostics",
              diagnostics: session.diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"transform">;
