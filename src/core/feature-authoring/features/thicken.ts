import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
  type AdvancedParticipantRole,
  type AdvancedSolidOperationIntent,
} from "@/contracts/modeling/advanced-solid";
import type {
  FeatureAuthoringDefinition,
  ThickenFeatureParameterDraft,
} from "@/core/feature-authoring/definition";
import {
  createSelectionFilterForRequirement,
  thickenSelectionFilter,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  asFaceRef,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredNumberLiteral,
  authoredStringLiteral,
  createMissingInputDiagnostic,
  expressionCapableAuthoredValue,
  isPositiveAuthoredNumber,
} from "@/core/feature-authoring/features/shared";

export const thickenParticipants = [
  {
    role: "face",
    label: "Face targets",
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ["face"],
  },
  {
    role: "targetBody",
    label: "Boolean target bodies",
    required: false,
    cardinality: { min: 0, max: null },
    acceptedKinds: ["body"],
  },
] as const;

export const thickenOperationIntent = {
  supportedIntents: ["create", "add", "subtract", "intersect"],
  requiredParticipantsByIntent: {
    add: ["targetBody"],
    subtract: ["targetBody"],
    intersect: ["targetBody"],
  },
} as const;

export const thickenOptions = [
  {
    key: "thickness",
    label: "Thickness",
    required: true,
    valueKind: "positiveNumber",
  },
] as const;

function isOperationIntent(
  value: unknown,
): value is AdvancedSolidOperationIntent {
  return (
    value === "create" ||
    value === "add" ||
    value === "subtract" ||
    value === "intersect"
  );
}

function isThickenSide(value: unknown): value is "oneSide" | "symmetric" {
  return value === "oneSide" || value === "symmetric";
}

function isNormalDirection(value: unknown): value is "positive" | "negative" {
  return value === "positive" || value === "negative";
}

function filterTargets<TTarget extends PrimitiveRef>(
  value: unknown,
  coerce: (target: PrimitiveRef | null) => TTarget | null,
) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is TTarget => coerce(entry as PrimitiveRef) !== null,
      )
    : [];
}

function getTargetsForRole(
  draft: ThickenFeatureParameterDraft,
  role: AdvancedParticipantRole,
) {
  switch (role) {
    case "face":
      return draft.faceTargets;
    case "targetBody":
      return draft.targetBodyTargets;
    default:
      return [];
  }
}

function buildThickenParticipants(draft: ThickenFeatureParameterDraft) {
  return thickenParticipants
    .map((participant) => ({
      role: participant.role,
      targets: getTargetsForRole(draft, participant.role),
    }))
    .filter((participant) => participant.targets.length > 0);
}

function buildThickenDefinition(draft: ThickenFeatureParameterDraft) {
  return {
    kind: "thicken" as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: authoredDefinitionValue(
        draft.operationIntent,
        "create",
      ) as AdvancedSolidOperationIntent,
      participants: buildThickenParticipants(draft),
      options: {
        thickness: authoredDefinitionValue(draft.options.thickness, 1),
        side: authoredDefinitionValue(draft.options.side, "oneSide"),
        direction: draft.options.direction,
      },
    },
  };
}

function getThickenValidationDiagnostics(draft: ThickenFeatureParameterDraft) {
  const diagnostics = validateAdvancedSolidFeatureDefinition(
    buildThickenDefinition(draft) as never,
    {
      featureKind: "thicken",
      participants: thickenParticipants,
      operationIntent: thickenOperationIntent,
      options: thickenOptions,
    },
  );

  if (!isThickenSide(authoredStringLiteral(draft.options.side, "oneSide"))) {
    diagnostics.push({
      code: "advanced-feature-invalid-option",
      severity: "error",
      role: null,
      target: null,
      message: "Side must be oneSide or symmetric.",
    });
  }

  if (!isNormalDirection(draft.options.direction)) {
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

export const thickenAuthoringDefinition = {
  metadata: {
    kind: "thicken",
    name: "Thicken",
    tooltip: "Offset selected faces into a solid.",
    icon: "thicken",
    toolId: "thicken",
    groupId: "features",
    modes: ["part"],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: thickenSelectionFilter,
  advancedParticipants: thickenParticipants,
  operationIntent: thickenOperationIntent,
  createDraft(input) {
    const faceTarget = asFaceRef(input.selectedTarget);
    return {
      faceTargets: faceTarget ? [faceTarget] : [],
      operationIntent: "create",
      targetBodyTargets: [],
      options: {
        thickness: 1,
        side: "oneSide",
        direction: "positive",
      },
    };
  },
  hydrateDraft(feature) {
    const getParticipantTargets = (role: AdvancedParticipantRole) =>
      feature.parameters.participants.find(
        (participant) => participant.role === role,
      )?.targets ?? [];
    const thickness = feature.parameters.options?.thickness;
    const side = feature.parameters.options?.side;
    const direction = feature.parameters.options?.direction;

    return {
      faceTargets: filterTargets(getParticipantTargets("face"), asFaceRef),
      operationIntent: feature.parameters.operationIntent ?? "create",
      targetBodyTargets: filterTargets(
        getParticipantTargets("targetBody"),
        asBodyRef,
      ),
      options: {
        thickness: (thickness ??
          1) as ThickenFeatureParameterDraft["options"]["thickness"],
        side: (isThickenSide(side)
          ? side
          : (side ??
            "oneSide")) as ThickenFeatureParameterDraft["options"]["side"],
        direction: isNormalDirection(direction) ? direction : "positive",
      },
    };
  },
  applyPatch(draft, patch) {
    const optionPatch = patch.options;
    const directionPatch =
      patch.direction ??
      (optionPatch && typeof optionPatch === "object"
        ? (optionPatch as { direction?: unknown }).direction
        : undefined);
    return {
      ...draft,
      faceTargets:
        patch.faceTargets === undefined && patch.faceTarget === undefined
          ? draft.faceTargets
          : Array.isArray(patch.faceTargets)
            ? filterTargets(patch.faceTargets, asFaceRef)
            : asFaceRef(patch.faceTarget as PrimitiveRef | null)
              ? [patch.faceTarget as (typeof draft.faceTargets)[number]]
              : draft.faceTargets,
      operationIntent: acceptAuthoredPatch(
        patch.operationIntent,
        draft.operationIntent,
        isOperationIntent,
      ),
      targetBodyTargets:
        patch.targetBodyTargets === undefined
          ? draft.targetBodyTargets
          : filterTargets(patch.targetBodyTargets, asBodyRef),
      options: {
        thickness: acceptAuthoredPatch(
          patch.thickness ??
            (optionPatch && typeof optionPatch === "object"
              ? (optionPatch as { thickness?: unknown }).thickness
              : undefined),
          draft.options.thickness,
          (value): value is number => typeof value === "number",
        ),
        side: acceptAuthoredPatch(
          patch.side ??
            (optionPatch && typeof optionPatch === "object"
              ? (optionPatch as { side?: unknown }).side
              : undefined),
          draft.options.side,
          isThickenSide,
        ) as ThickenFeatureParameterDraft["options"]["side"],
        direction: isNormalDirection(directionPatch)
          ? directionPatch
          : draft.options.direction,
      },
    };
  },
  applySelection(draft, target) {
    const faceTarget = asFaceRef(target);
    if (faceTarget) {
      return {
        ...draft,
        faceTargets: appendUniqueTarget(draft.faceTargets, faceTarget),
      };
    }

    const bodyTarget = asBodyRef(target);
    return bodyTarget &&
      authoredStringLiteral(draft.operationIntent, "create") !== "create"
      ? this.applyPatch(draft, {
          targetBodyTargets: appendUniqueTarget(
            draft.targetBodyTargets,
            bodyTarget,
          ),
        })
      : draft;
  },
  getPrimarySelectionTarget(draft) {
    return draft.faceTargets[0] ?? draft.targetBodyTargets[0] ?? null;
  },
  getPreviewLabel(draft, prefix) {
    if (draft.faceTargets.length === 0) {
      return "Select one or more faces for thicken";
    }
    const thickness = authoredNumberLiteral(draft.options.thickness);
    if (thickness !== null && thickness <= 0) {
      return "Enter a positive thicken thickness";
    }
    if (
      authoredStringLiteral(draft.operationIntent, "create") !== "create" &&
      draft.targetBodyTargets.length === 0
    ) {
      return "Select a target body for thicken boolean operation";
    }
    return `${prefix} thicken on ${draft.faceTargets.length} face${draft.faceTargets.length === 1 ? "" : "s"}`;
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getThickenValidationDiagnostics(input.draft);
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
        feature: "thicken",
        phase: input.phase,
        suffix: "references",
        message:
          "Thicken preview requires at least one face target and a positive thickness.",
      }),
    ];
  },
  buildDefinition(draft) {
    return getThickenValidationDiagnostics(draft).length === 0
      ? (buildThickenDefinition(draft) as never)
      : null;
  },
  getFormSchema(session) {
    const diagnostics = session.diagnostics;
    const operationIntent = authoredStringLiteral(
      session.draft.operationIntent,
      "create",
    );
    const side = authoredStringLiteral(session.draft.options.side, "oneSide");
    return {
      sections: [
        {
          id: "references",
          title: "References",
          fields: [
            {
              kind: "referenceCollection",
              id: "thicken-faces",
              label: "Face targets",
              value: session.draft.faceTargets,
              emptyLabel: "None selected",
              helper:
                "Accepted targets: durable body faces. Each selected face is stored explicitly.",
              error:
                session.draft.faceTargets.length > 0
                  ? null
                  : { message: "Select at least one face target." },
              advancedParticipant: {
                role: "face",
                required: true,
                cardinality: { min: 1, max: null },
                selectedCount: session.draft.faceTargets.length,
              },
              picker: {
                mode: "appendUnique",
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(
                  thickenSelectionFilter,
                  "thicken-face",
                  "Thicken faces",
                ),
                itemLabel: "Face",
              },
              patch: { patchKey: "faceTargets" },
            },
            {
              kind: "referenceCollection",
              id: "thicken-target-bodies",
              label: "Boolean target bodies",
              value: session.draft.targetBodyTargets,
              emptyLabel: "None selected",
              hidden: operationIntent === "create",
              helper: "Boolean intents require explicit durable target bodies.",
              error:
                operationIntent === "create" ||
                session.draft.targetBodyTargets.length > 0
                  ? null
                  : { message: "Select at least one target body." },
              advancedParticipant: {
                role: "targetBody",
                required: operationIntent !== "create",
                cardinality: {
                  min: operationIntent === "create" ? 0 : 1,
                  max: null,
                },
                selectedCount: session.draft.targetBodyTargets.length,
              },
              picker: {
                mode: "appendUnique",
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(
                  thickenSelectionFilter,
                  "thicken-boolean-target",
                  "Thicken target body",
                ),
                itemLabel: "Body",
              },
              patch: { patchKey: "targetBodyTargets" },
            },
          ],
        },
        {
          id: "parameters",
          title: "Parameters",
          fields: [
            {
              kind: "numeric",
              id: "thicken-thickness",
              label: "Thickness",
              value: authoredNumberFormValue(session.draft.options.thickness),
              input: "number",
              step: 0.1,
              directionToggle: {
                patch: { patchKey: "direction" },
                value: session.draft.options.direction,
                forwardValue: "positive",
                reverseValue: "negative",
                forwardLabel: "Positive normal",
                reverseLabel: "Negative normal",
              },
              error: isPositiveAuthoredNumber(session.draft.options.thickness)
                ? null
                : { message: "Thickness must be greater than zero." },
              authoredValue: expressionCapableAuthoredValue(
                session.draft.options.thickness,
                { kind: "positiveNumber" },
              ),
              patch: { patchKey: "thickness" },
            },
            {
              kind: "enum",
              id: "thicken-side",
              label: "Side",
              value: side,
              options: [
                { value: "oneSide", label: "oneSide" },
                { value: "symmetric", label: "symmetric" },
              ],
              authoredValue: expressionCapableAuthoredValue(
                session.draft.options.side,
                { kind: "enumString", options: ["oneSide", "symmetric"] },
              ),
              patch: { patchKey: "side" },
            },
            {
              kind: "enum",
              id: "thicken-operation-intent",
              label: "Operation",
              value: operationIntent,
              options: [
                { value: "create", label: "create" },
                { value: "add", label: "add" },
                { value: "subtract", label: "subtract" },
                { value: "intersect", label: "intersect" },
              ],
              authoredValue: expressionCapableAuthoredValue(
                session.draft.operationIntent,
                {
                  kind: "enumString",
                  options: ["create", "add", "subtract", "intersect"],
                },
              ),
              patch: { patchKey: "operationIntent" },
            },
          ],
        },
        {
          id: "diagnostics",
          title: "Diagnostics",
          fields: [
            {
              kind: "diagnostics",
              id: "thicken-diagnostics",
              label: "Diagnostics",
              diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"thicken">;
