import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  CHAMFER_WIDTH_OPTION_DESCRIPTORS,
  validateAdvancedSolidFeatureDefinition,
  type ChamferAdvancedOptions,
  type ChamferWidthForm,
} from "@/contracts/modeling/advanced-solid";
import type {
  ChamferFeatureParameterDraft,
  FeatureAuthoringDefinition,
} from "@/core/feature-authoring/definition";
import {
  chamferSelectionFilter,
  createSelectionFilterForRequirement,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asEdgeRef,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredNumberLiteral,
  authoredStringLiteral,
  createMissingInputDiagnostic,
  expressionCapableAuthoredValue,
  isFiniteAuthoredNumber,
  isPositiveAuthoredNumber,
} from "@/core/feature-authoring/features/shared";

export const chamferParticipants = [
  {
    role: "edge",
    label: "Edge targets",
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ["edge"],
  },
] as const;

export const chamferOptions = CHAMFER_WIDTH_OPTION_DESCRIPTORS;

function filterEdgeTargets(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Extract<PrimitiveRef, { kind: "edge" }> =>
          asEdgeRef(entry as PrimitiveRef | null) !== null,
      )
    : [];
}

function chamferWidthForm(options: ChamferAdvancedOptions): ChamferWidthForm {
  return authoredStringLiteral(options.widthForm ?? "equalOffsets", "equalOffsets");
}

function normalizeChamferOptions(
  options: Record<string, unknown> | undefined,
): ChamferAdvancedOptions {
  const widthForm = authoredStringLiteral(
    (options?.widthForm as ChamferAdvancedOptions["widthForm"]) ?? "equalOffsets",
    "equalOffsets",
  );

  if (widthForm === "twoOffsets") {
    return {
      widthForm,
      distance1: (options?.distance1 ?? options?.distance ?? 1) as ChamferAdvancedOptions["distance1"],
      distance2: (options?.distance2 ?? options?.distance ?? 1) as ChamferAdvancedOptions["distance2"],
    };
  }

  if (widthForm === "offsetAngle") {
    return {
      widthForm,
      distance: (options?.distance ?? 1) as ChamferAdvancedOptions["distance"],
      angle: (options?.angle ?? 45) as ChamferAdvancedOptions["angle"],
    };
  }

  return {
    widthForm: "equalOffsets",
    distance: (options?.distance ?? 1) as ChamferAdvancedOptions["distance"],
  };
}

function buildChamferOptions(options: ChamferAdvancedOptions) {
  const widthForm = chamferWidthForm(options);
  if (widthForm === "twoOffsets") {
    return {
      widthForm: authoredDefinitionValue("twoOffsets", "twoOffsets"),
      distance1: authoredDefinitionValue(options.distance1 ?? 1, 1),
      distance2: authoredDefinitionValue(options.distance2 ?? 1, 1),
    };
  }

  if (widthForm === "offsetAngle") {
    return {
      widthForm: authoredDefinitionValue("offsetAngle", "offsetAngle"),
      distance: authoredDefinitionValue(options.distance ?? 1, 1),
      angle: authoredDefinitionValue(options.angle ?? 45, 45),
    };
  }

  return {
    widthForm: authoredDefinitionValue("equalOffsets", "equalOffsets"),
    distance: authoredDefinitionValue(options.distance ?? 1, 1),
  };
}

function applyChamferOptionsPatch(
  options: ChamferAdvancedOptions,
  patch: Record<string, unknown>,
): ChamferAdvancedOptions {
  const widthForm = acceptAuthoredPatch(
    patch.widthForm,
    options.widthForm ?? "equalOffsets",
    (value): value is ChamferWidthForm =>
      value === "equalOffsets" || value === "twoOffsets" || value === "offsetAngle",
  );
  const literalWidthForm = authoredStringLiteral(widthForm, "equalOffsets");

  if (literalWidthForm === "twoOffsets") {
    return {
      widthForm: literalWidthForm,
      distance1: acceptAuthoredPatch(
        patch.distance1,
        options.distance1 ?? options.distance ?? 1,
        (value): value is number => typeof value === "number",
      ),
      distance2: acceptAuthoredPatch(
        patch.distance2,
        options.distance2 ?? options.distance ?? 1,
        (value): value is number => typeof value === "number",
      ),
    };
  }

  if (literalWidthForm === "offsetAngle") {
    return {
      widthForm: literalWidthForm,
      distance: acceptAuthoredPatch(
        patch.distance,
        options.distance ?? options.distance1 ?? 1,
        (value): value is number => typeof value === "number",
      ),
      angle: acceptAuthoredPatch(
        patch.angle,
        options.angle ?? 45,
        (value): value is number => typeof value === "number",
      ),
    };
  }

  return {
    widthForm: literalWidthForm,
    distance: acceptAuthoredPatch(
      patch.distance,
      options.distance ?? options.distance1 ?? 1,
      (value): value is number => typeof value === "number",
    ),
  };
}

function isExecutableChamferAngle(value: ChamferAdvancedOptions["angle"]) {
  if (value === undefined) return false;
  const literal = authoredNumberLiteral(value);
  return literal !== null && literal > 0 && literal < 90;
}

function buildChamferDefinition(draft: ChamferFeatureParameterDraft) {
  return {
    kind: "chamfer" as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [{ role: "edge" as const, targets: draft.edgeTargets }],
      options: buildChamferOptions(draft.options),
    },
  };
}

function getChamferValidationDiagnostics(draft: ChamferFeatureParameterDraft) {
  const diagnostics = validateAdvancedSolidFeatureDefinition(buildChamferDefinition(draft), {
    featureKind: "chamfer",
    participants: chamferParticipants,
    options: chamferOptions,
  });
  if (
    chamferWidthForm(draft.options) === "offsetAngle" &&
    !isExecutableChamferAngle(
      draft.options.angle,
    )
  ) {
    diagnostics.push({
      code: "advanced-feature-invalid-option",
      severity: "error",
      message:
        "Distance + angle chamfer requires an angle greater than 0 and less than 90 degrees.",
      role: null,
      target: null,
    });
  }
  return diagnostics;
}

export const chamferAuthoringDefinition = {
  metadata: {
    kind: "chamfer",
    name: "Chamfer",
    tooltip: "Bevel selected edges.",
    icon: "chamfer",
    toolId: "chamfer",
    groupId: "features",
    modes: ["part"],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: chamferSelectionFilter,
  advancedParticipants: chamferParticipants,
  createDraft(input) {
    const edgeTarget = asEdgeRef(input.selectedTarget);
    return {
      edgeTargets: edgeTarget ? [edgeTarget] : [],
      options: { widthForm: "equalOffsets", distance: 1 },
    };
  },
  hydrateDraft(feature) {
    const edgeTargets =
      feature.parameters.participants.find(
        (participant) => participant.role === "edge",
      )?.targets ?? [];
    return {
      edgeTargets: filterEdgeTargets(edgeTargets),
      options: normalizeChamferOptions(feature.parameters.options),
    };
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      edgeTargets:
        patch.edgeTargets === undefined && patch.edgeTarget === undefined
          ? draft.edgeTargets
          : Array.isArray(patch.edgeTargets)
            ? filterEdgeTargets(patch.edgeTargets)
            : asEdgeRef(patch.edgeTarget as PrimitiveRef | null)
              ? [patch.edgeTarget as (typeof draft.edgeTargets)[number]]
              : draft.edgeTargets,
      options: applyChamferOptionsPatch(draft.options, patch),
    };
  },
  applySelection(draft, target) {
    return target.kind === "edge"
      ? {
          ...draft,
          edgeTargets: appendUniqueTarget(draft.edgeTargets, target),
        }
      : draft;
  },
  getPrimarySelectionTarget(draft) {
    return draft.edgeTargets[0] ?? null;
  },
  getPreviewLabel(draft, prefix) {
    if (draft.edgeTargets.length === 0) {
      return "Select one or more edges for chamfer";
    }
    const options = draft.options;
    const widthForm = chamferWidthForm(options);
    const distances =
      widthForm === "twoOffsets"
        ? [
            authoredNumberLiteral(options.distance1 ?? 1),
            authoredNumberLiteral(options.distance2 ?? 1),
          ]
        : [authoredNumberLiteral(options.distance ?? 1)];
    if (distances.some((distance) => distance !== null && distance <= 0)) {
      return "Enter positive chamfer distances";
    }
    if (widthForm === "offsetAngle" && !isExecutableChamferAngle(options.angle)) {
      return "Enter a chamfer angle greater than 0 and less than 90 degrees";
    }
    return `${prefix} chamfer on ${draft.edgeTargets.length} edge${draft.edgeTargets.length === 1 ? "" : "s"}`;
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getChamferValidationDiagnostics(input.draft);
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
        feature: "chamfer",
        phase: input.phase,
        suffix: "edge",
        message: "Chamfer preview requires at least one edge target.",
      }),
    ];
  },
  buildDefinition(draft) {
    return getChamferValidationDiagnostics(draft).length === 0
      ? buildChamferDefinition(draft)
      : null;
  },
  getFormSchema(session) {
    const options = session.draft.options;
    const widthForm = chamferWidthForm(options);
    const distance = options.distance ?? 1;
    const distance1 = options.distance1 ?? distance;
    const distance2 = options.distance2 ?? distance;
    const angle = options.angle ?? 45;
    return {
      sections: [
        {
          id: "references",
          title: "References",
          fields: [
            {
              kind: "referenceCollection",
              id: "chamfer-edges",
              label: "Edge targets",
              value: session.draft.edgeTargets,
              emptyLabel: "None selected",
              helper:
                "Each selected durable edge is preserved explicitly in the draft.",
              error:
                session.draft.edgeTargets.length > 0
                  ? null
                  : { message: "Select at least one edge target." },
              advancedParticipant: {
                role: "edge",
                required: true,
                cardinality: { min: 1, max: null },
                selectedCount: session.draft.edgeTargets.length,
              },
              picker: {
                mode: "appendUnique",
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(
                  chamferSelectionFilter,
                  "chamfer-edge",
                  "Chamfer edges",
                ),
                itemLabel: "Edge",
              },
              patch: { patchKey: "edgeTargets" },
            },
          ],
        },
        {
          id: "parameters",
          title: "Parameters",
          fields: [
            {
              kind: "enum",
              id: "chamfer-width-form",
              label: "Width form",
              value: widthForm,
              options: [
                { value: "equalOffsets", label: "Equal offsets" },
                { value: "twoOffsets", label: "Two offsets" },
                { value: "offsetAngle", label: "Distance + angle" },
              ],
              patch: { patchKey: "widthForm" },
            },
            ...(widthForm === "twoOffsets"
              ? [
                  {
                    kind: "numeric" as const,
                    id: "chamfer-distance-1",
                    label: "Distance 1",
                    value: authoredNumberFormValue(distance1),
                    input: "number" as const,
                    step: 0.1,
                    authoredValue: expressionCapableAuthoredValue(distance1, {
                      kind: "positiveNumber",
                    }),
                    error: isPositiveAuthoredNumber(distance1)
                      ? null
                      : { message: "Distance 1 must be greater than zero." },
                    patch: { patchKey: "distance1" },
                  },
                  {
                    kind: "numeric" as const,
                    id: "chamfer-distance-2",
                    label: "Distance 2",
                    value: authoredNumberFormValue(distance2),
                    input: "number" as const,
                    step: 0.1,
                    authoredValue: expressionCapableAuthoredValue(distance2, {
                      kind: "positiveNumber",
                    }),
                    error: isPositiveAuthoredNumber(distance2)
                      ? null
                      : { message: "Distance 2 must be greater than zero." },
                    patch: { patchKey: "distance2" },
                  },
                ]
              : [
                  {
                    kind: "numeric" as const,
                    id: "chamfer-distance",
                    label: "Distance",
                    value: authoredNumberFormValue(distance),
                    input: "number" as const,
                    step: 0.1,
                    authoredValue: expressionCapableAuthoredValue(distance, {
                      kind: "positiveNumber",
                    }),
                    error: isPositiveAuthoredNumber(distance)
                      ? null
                      : { message: "Distance must be greater than zero." },
                    patch: { patchKey: "distance" },
                  },
                  ...(widthForm === "offsetAngle"
                    ? [
                        {
                          kind: "numeric" as const,
                          id: "chamfer-angle",
                          label: "Angle",
                          value: authoredNumberFormValue(angle),
                          input: "angleDegrees" as const,
                          step: 1,
                          authoredValue: expressionCapableAuthoredValue(angle, {
                            kind: "angle",
                          }),
                          error: isFiniteAuthoredNumber(angle) && isExecutableChamferAngle(angle)
                            ? null
                            : {
                                message:
                                  "Angle must be greater than 0 and less than 90 degrees.",
                              },
                          patch: { patchKey: "angle" },
                        },
                      ]
                    : []),
                ]),
          ],
        },
        {
          id: "diagnostics",
          title: "Diagnostics",
          fields: [
            {
              kind: "diagnostics",
              id: "chamfer-diagnostics",
              label: "Diagnostics",
              diagnostics: session.diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"chamfer">;
