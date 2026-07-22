import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  CIRCULAR_PATTERN_OPTION_DESCRIPTORS,
  validateAdvancedSolidFeatureDefinition,
} from "@/contracts/modeling/advanced-solid";
import type {
  CircularPatternFeatureParameterDraft,
  FeatureAuthoringDefinition,
} from "@/core/feature-authoring/definition";
import {
  circularPatternSelectionFilter,
  createSelectionFilterForRequirement,
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
  toFeaturePhaseDiagnostics,
} from "@/core/feature-authoring/features/shared";

export const circularPatternParticipants = [
  {
    role: "body",
    label: "Seed bodies",
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ["body"],
  },
  {
    role: "axis",
    label: "Pattern axis",
    required: true,
    cardinality: { min: 1, max: 1 },
    acceptedKinds: ["construction", "face", "edge", "sketchEntity"],
  },
] as const;

export const circularPatternOptions = CIRCULAR_PATTERN_OPTION_DESCRIPTORS;

type CircularPatternAxisTarget = NonNullable<
  CircularPatternFeatureParameterDraft["axisTarget"]
>;

function asCircularPatternAxisTarget(
  value: PrimitiveRef | null,
): CircularPatternAxisTarget | null {
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
  current: CircularPatternFeatureParameterDraft["oppositeDirection"],
) {
  if (value === "true") return true;
  if (value === "false") return false;
  return acceptAuthoredPatch(
    value,
    current,
    (entry): entry is boolean => typeof entry === "boolean",
  );
}

function buildCircularPatternDefinition(draft: CircularPatternFeatureParameterDraft) {
  return {
    kind: "circularPattern" as const,
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
        instanceCount: authoredDefinitionValue(draft.instanceCount, 4),
        angleDegrees: authoredDefinitionValue(draft.angleDegrees, 360),
        equalSpace: authoredDefinitionValue(draft.equalSpace, true),
        oppositeDirection: authoredDefinitionValue(
          draft.oppositeDirection,
          false,
        ),
      },
    },
  };
}

function getCircularPatternValidationDiagnostics(
  draft: CircularPatternFeatureParameterDraft,
) {
  return validateAdvancedSolidFeatureDefinition(
    buildCircularPatternDefinition(draft),
    {
      featureKind: "circularPattern",
      participants: circularPatternParticipants,
      options: circularPatternOptions,
    },
  );
}

export const circularPatternAuthoringDefinition = {
  metadata: {
    kind: "circularPattern",
    name: "Circular Pattern",
    tooltip: "Copy selected seed bodies around an explicit axis.",
    icon: "circularPattern",
    toolId: "circularPattern",
    groupId: "patterns",
    modes: ["part"],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: circularPatternSelectionFilter,
  advancedParticipants: circularPatternParticipants,
  advancedOptions: circularPatternOptions,
  createDraft(input) {
    const selectedBody = asBodyRef(input.selectedTarget);
    const selectedAxis = asCircularPatternAxisTarget(input.selectedTarget);
    return {
      bodyTargets: selectedBody ? [selectedBody] : [],
      axisTarget: selectedAxis,
      instanceCount: 4,
      angleDegrees: 360,
      equalSpace: true,
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
      axisTarget: asCircularPatternAxisTarget(
        (feature.parameters.participants.find(
          (participant) => participant.role === "axis",
        )?.targets[0] ?? null) as PrimitiveRef | null,
      ),
      instanceCount: (feature.parameters.options?.instanceCount ??
        4) as CircularPatternFeatureParameterDraft["instanceCount"],
      angleDegrees: (feature.parameters.options?.angleDegrees ??
        360) as CircularPatternFeatureParameterDraft["angleDegrees"],
      equalSpace: (feature.parameters.options?.equalSpace ??
        true) as CircularPatternFeatureParameterDraft["equalSpace"],
      oppositeDirection: (feature.parameters.options?.oppositeDirection ??
        false) as CircularPatternFeatureParameterDraft["oppositeDirection"],
    };
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      bodyTargets:
        patch.bodyTargets === undefined
          ? draft.bodyTargets
          : filterBodyTargets(patch.bodyTargets),
      axisTarget:
        patch.axisTarget === undefined
          ? draft.axisTarget
          : asCircularPatternAxisTarget(patch.axisTarget as PrimitiveRef | null),
      instanceCount: acceptAuthoredPatch(
        patch.instanceCount,
        draft.instanceCount,
        (value): value is number => typeof value === "number",
      ),
      angleDegrees: acceptAuthoredPatch(
        patch.angleDegrees,
        draft.angleDegrees,
        (value): value is number => typeof value === "number",
      ),
      equalSpace: boolPatch(patch.equalSpace, draft.equalSpace),
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

    const axisTarget = asCircularPatternAxisTarget(target);
    return axisTarget ? this.applyPatch(draft, { axisTarget }) : draft;
  },
  getPrimarySelectionTarget(draft) {
    return draft.bodyTargets[0] ?? draft.axisTarget ?? null;
  },
  getPreviewLabel(draft, prefix) {
    if (draft.bodyTargets.length === 0) {
      return "Select one or more seed bodies to pattern";
    }
    if (!draft.axisTarget) {
      return "Select one circular pattern axis";
    }
    const instanceCount = authoredNumberLiteral(draft.instanceCount);
    if (instanceCount !== null && (!Number.isInteger(instanceCount) || instanceCount < 2)) {
      return "Enter a pattern instance count of at least 2";
    }
    const angleDegrees = authoredNumberLiteral(draft.angleDegrees);
    if (angleDegrees !== null && (angleDegrees === 0 || Math.abs(angleDegrees) > 360)) {
      return "Enter a non-zero pattern angle no greater than 360 degrees";
    }
    return `${prefix} copy-only circular pattern from ${draft.bodyTargets.length} seed bod${draft.bodyTargets.length === 1 ? "y" : "ies"}`;
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getCircularPatternValidationDiagnostics(input.draft);
    if (diagnostics.length > 0) {
      return toFeaturePhaseDiagnostics({ phase: input.phase, diagnostics });
    }

    return [
      createMissingInputDiagnostic({
        feature: "circularPattern",
        phase: input.phase,
        suffix: "references",
        message:
          "Circular pattern preview requires seed bodies, one explicit axis, instance count, angle, equal-space mode, and direction mode.",
      }),
    ];
  },
  buildDefinition(draft) {
    return getCircularPatternValidationDiagnostics(draft).length === 0
      ? buildCircularPatternDefinition(draft)
      : null;
  },
  getFormSchema(session) {
    const angleDegrees = authoredNumberLiteral(session.draft.angleDegrees);
    return {
      sections: [
        {
          id: "references",
          title: "References",
          fields: [
            {
              kind: "referenceCollection",
              id: "circular-pattern-bodies",
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
                  circularPatternSelectionFilter,
                  "circular-pattern-body",
                  "Circular pattern seed bodies",
                ),
                itemLabel: "Seed body",
              },
              patch: { patchKey: "bodyTargets" },
            },
            {
              kind: "referencePicker",
              id: "circular-pattern-axis",
              label: "Pattern axis",
              value: session.draft.axisTarget,
              emptyLabel: "No axis selected",
              helper:
                "Select one construction plane, planar face, linear edge, or sketch line axis.",
              error: session.draft.axisTarget
                ? null
                : { message: "Select one pattern axis." },
              advancedParticipant: {
                role: "axis",
                required: true,
                cardinality: { min: 1, max: 1 },
                selectedCount: session.draft.axisTarget ? 1 : 0,
              },
              picker: {
                mode: "replace",
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(
                  circularPatternSelectionFilter,
                  "circular-pattern-axis",
                  "Circular pattern axis",
                ),
              },
              patch: { patchKey: "axisTarget" },
            },
          ],
        },
        {
          id: "parameters",
          title: "Parameters",
          fields: [
            {
              kind: "numeric",
              id: "circular-pattern-instance-count",
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
              id: "circular-pattern-angle-degrees",
              label: "Angle degrees",
              value: authoredNumberFormValue(session.draft.angleDegrees),
              input: "number",
              step: 1,
              error:
                angleDegrees !== null &&
                (angleDegrees === 0 || Math.abs(angleDegrees) > 360)
                  ? { message: "Angle must be non-zero and no more than 360 degrees." }
                  : null,
              authoredValue: expressionCapableAuthoredValue(
                session.draft.angleDegrees,
                { kind: "angle" },
              ),
              patch: { patchKey: "angleDegrees" },
            },
            {
              kind: "enum",
              id: "circular-pattern-equal-space",
              label: "Equal space",
              value: authoredBooleanLiteral(session.draft.equalSpace, true)
                ? "true"
                : "false",
              options: [
                { value: "true", label: "Equal" },
                { value: "false", label: "Angle step" },
              ],
              patch: { patchKey: "equalSpace" },
            },
            {
              kind: "enum",
              id: "circular-pattern-opposite-direction",
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
              id: "circular-pattern-diagnostics",
              label: "Diagnostics",
              diagnostics: session.diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"circularPattern">;
