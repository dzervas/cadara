import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  LINEAR_PATTERN_OPTION_DESCRIPTORS,
  validateAdvancedSolidFeatureDefinition,
  type AdvancedFeatureOptionDescriptor,
} from "@/contracts/modeling/advanced-solid";
import type {
  FeatureAuthoringDefinition,
  LinearPatternFeatureParameterDraft,
} from "@/core/feature-authoring/definition";
import {
  createSelectionFilterForRequirement,
  linearPatternSelectionFilter,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  authoredBooleanLiteral,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredNumberLiteral,
  createMissingInputDiagnostic,
  expressionCapableAuthoredValue,
  isPositiveAuthoredNumber,
  toFeaturePhaseDiagnostics,
} from "@/core/feature-authoring/features/shared";

export const linearPatternParticipants = [
  {
    role: "body",
    label: "Seed bodies",
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ["body"],
  },
  {
    role: "direction",
    label: "Linear direction",
    required: true,
    cardinality: { min: 1, max: 1 },
    acceptedKinds: ["construction", "face", "edge", "sketchEntity"],
  },
] as const;

export const linearPatternOptions = LINEAR_PATTERN_OPTION_DESCRIPTORS.filter(
  (descriptor) => descriptor.key !== "centered",
) satisfies readonly AdvancedFeatureOptionDescriptor[];

type LinearPatternDirectionTarget = NonNullable<
  LinearPatternFeatureParameterDraft["directionTarget"]
>;

function asLinearPatternDirectionTarget(
  value: PrimitiveRef | null,
): LinearPatternDirectionTarget | null {
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

function boolPatch(
  value: unknown,
  current: LinearPatternFeatureParameterDraft["oppositeDirection"],
) {
  if (value === "true") return true;
  if (value === "false") return false;
  return acceptAuthoredPatch(
    value,
    current,
    (entry): entry is boolean => typeof entry === "boolean",
  );
}

function buildLinearPatternDefinition(draft: LinearPatternFeatureParameterDraft) {
  return {
    kind: "linearPattern" as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        ...(draft.bodyTargets.length > 0
          ? [{ role: "body" as const, targets: draft.bodyTargets }]
          : []),
        ...(draft.directionTarget
          ? [{ role: "direction" as const, targets: [draft.directionTarget] }]
          : []),
      ],
      options: {
        instanceCount: authoredDefinitionValue(draft.instanceCount, 3),
        spacing: authoredDefinitionValue(draft.spacing, 10),
        oppositeDirection: authoredDefinitionValue(
          draft.oppositeDirection,
          false,
        ),
      },
    },
  };
}

function getLinearPatternValidationDiagnostics(
  draft: LinearPatternFeatureParameterDraft,
) {
  return validateAdvancedSolidFeatureDefinition(buildLinearPatternDefinition(draft), {
    featureKind: "linearPattern",
    participants: linearPatternParticipants,
    options: linearPatternOptions,
  });
}

export const linearPatternAuthoringDefinition = {
  metadata: {
    kind: "linearPattern",
    name: "Linear Pattern",
    tooltip: "Copy selected seed bodies along an explicit linear direction.",
    icon: "linearPattern",
    toolId: "linearPattern",
    groupId: "patterns",
    modes: ["part"],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: linearPatternSelectionFilter,
  advancedParticipants: linearPatternParticipants,
  advancedOptions: linearPatternOptions,
  createDraft(input) {
    const selectedBody = asBodyRef(input.selectedTarget);
    const selectedDirection = asLinearPatternDirectionTarget(input.selectedTarget);
    return {
      bodyTargets: selectedBody ? [selectedBody] : [],
      directionTarget: selectedDirection,
      instanceCount: 3,
      spacing: 10,
      oppositeDirection: false,
    };
  },
  hydrateDraft(feature) {
    return {
      bodyTargets: filterBodyTargets(
        feature.parameters.participants.find(
          (participant) => participant.role === "body",
        )?.targets ?? [],
      ),
      directionTarget: asLinearPatternDirectionTarget(
        (feature.parameters.participants.find(
          (participant) => participant.role === "direction",
        )?.targets[0] ?? null) as PrimitiveRef | null,
      ),
      instanceCount: (feature.parameters.options?.instanceCount ??
        3) as LinearPatternFeatureParameterDraft["instanceCount"],
      spacing: (feature.parameters.options?.spacing ??
        10) as LinearPatternFeatureParameterDraft["spacing"],
      oppositeDirection: (feature.parameters.options?.oppositeDirection ??
        false) as LinearPatternFeatureParameterDraft["oppositeDirection"],
    };
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      bodyTargets:
        patch.bodyTargets === undefined
          ? draft.bodyTargets
          : filterBodyTargets(patch.bodyTargets),
      directionTarget:
        patch.directionTarget === undefined
          ? draft.directionTarget
          : asLinearPatternDirectionTarget(
              patch.directionTarget as PrimitiveRef | null,
            ),
      instanceCount: acceptAuthoredPatch(
        patch.instanceCount,
        draft.instanceCount,
        (value): value is number => typeof value === "number",
      ),
      spacing: acceptAuthoredPatch(
        patch.spacing,
        draft.spacing,
        (value): value is number => typeof value === "number",
      ),
      oppositeDirection: boolPatch(
        patch.oppositeDirection,
        draft.oppositeDirection,
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

    const directionTarget = asLinearPatternDirectionTarget(target);
    return directionTarget ? this.applyPatch(draft, { directionTarget }) : draft;
  },
  getPrimarySelectionTarget(draft) {
    return draft.bodyTargets[0] ?? draft.directionTarget ?? null;
  },
  getPreviewLabel(draft, prefix) {
    if (draft.bodyTargets.length === 0) {
      return "Select one or more seed bodies to pattern";
    }
    if (!draft.directionTarget) {
      return "Select one linear pattern direction";
    }
    const instanceCount = authoredNumberLiteral(draft.instanceCount);
    if (instanceCount !== null && (!Number.isInteger(instanceCount) || instanceCount < 2)) {
      return "Enter a pattern instance count of at least 2";
    }
    if (!isPositiveAuthoredNumber(draft.spacing)) {
      return "Enter a positive pattern spacing";
    }
    return `${prefix} copy-only linear pattern from ${draft.bodyTargets.length} seed bod${draft.bodyTargets.length === 1 ? "y" : "ies"}`;
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getLinearPatternValidationDiagnostics(input.draft);
    if (diagnostics.length > 0) {
      return toFeaturePhaseDiagnostics({ phase: input.phase, diagnostics });
    }

    return [
      createMissingInputDiagnostic({
        feature: "linearPattern",
        phase: input.phase,
        suffix: "references",
        message:
          "Linear pattern preview requires seed bodies, one explicit direction, instance count, spacing, and direction mode.",
      }),
    ];
  },
  buildDefinition(draft) {
    return getLinearPatternValidationDiagnostics(draft).length === 0
      ? buildLinearPatternDefinition(draft)
      : null;
  },
  getFormSchema(session) {
    return {
      sections: [
        {
          id: "references",
          title: "References",
          fields: [
            {
              kind: "referenceCollection",
              id: "linear-pattern-bodies",
              label: "Seed bodies",
              value: session.draft.bodyTargets,
              emptyLabel: "No seed bodies selected",
              helper:
                "Select each durable body that should be copied by the pattern.",
              error:
                session.draft.bodyTargets.length > 0
                  ? null
                  : { message: "Select at least one seed body." },
              advancedParticipant: {
                role: "body",
                required: true,
                cardinality: { min: 1, max: null },
                selectedCount: session.draft.bodyTargets.length,
              },
              picker: {
                mode: "appendUnique",
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(
                  linearPatternSelectionFilter,
                  "linear-pattern-body",
                  "Linear pattern seed bodies",
                ),
                itemLabel: "Seed body",
              },
              patch: { patchKey: "bodyTargets" },
            },
            {
              kind: "referencePicker",
              id: "linear-pattern-direction",
              label: "Linear direction",
              value: session.draft.directionTarget,
              emptyLabel: "No direction selected",
              helper:
                "Select one construction plane, planar face, linear edge, or sketch line direction.",
              error: session.draft.directionTarget
                ? null
                : { message: "Select one linear direction." },
              advancedParticipant: {
                role: "direction",
                required: true,
                cardinality: { min: 1, max: 1 },
                selectedCount: session.draft.directionTarget ? 1 : 0,
              },
              picker: {
                mode: "replace",
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(
                  linearPatternSelectionFilter,
                  "linear-pattern-direction",
                  "Linear pattern direction",
                ),
              },
              patch: { patchKey: "directionTarget" },
            },
          ],
        },
        {
          id: "parameters",
          title: "Parameters",
          fields: [
            {
              kind: "numeric",
              id: "linear-pattern-instance-count",
              label: "Instance count",
              value: authoredNumberFormValue(session.draft.instanceCount),
              input: "number",
              step: 1,
              error:
                authoredNumberLiteral(session.draft.instanceCount) !== null &&
                (!Number.isInteger(authoredNumberLiteral(session.draft.instanceCount)) ||
                  authoredNumberLiteral(session.draft.instanceCount)! < 2)
                  ? { message: "Instance count must be an integer of at least 2." }
                  : null,
              authoredValue: expressionCapableAuthoredValue(
                session.draft.instanceCount,
                { kind: "positiveInteger" },
              ),
              patch: { patchKey: "instanceCount" },
            },
            {
              kind: "numeric",
              id: "linear-pattern-spacing",
              label: "Spacing",
              value: authoredNumberFormValue(session.draft.spacing),
              input: "number",
              step: 0.1,
              error: isPositiveAuthoredNumber(session.draft.spacing)
                ? null
                : { message: "Spacing must be greater than zero." },
              authoredValue: expressionCapableAuthoredValue(session.draft.spacing, {
                kind: "positiveNumber",
              }),
              patch: { patchKey: "spacing" },
            },
            {
              kind: "enum",
              id: "linear-pattern-opposite-direction",
              label: "Opposite direction",
              value: authoredBooleanLiteral(session.draft.oppositeDirection, false)
                ? "true"
                : "false",
              options: [
                { value: "false", label: "Forward" },
                { value: "true", label: "Opposite" },
              ],
              patch: { patchKey: "oppositeDirection" },
            },
          ],
        },
        {
          id: "diagnostics",
          title: "Diagnostics",
          fields: [
            {
              kind: "diagnostics",
              id: "linear-pattern-diagnostics",
              label: "Diagnostics",
              diagnostics: session.diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"linearPattern">;
