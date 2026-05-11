import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  SWEEP_ADVANCED_OPTION_DESCRIPTORS,
  type AdvancedFeatureValidationDiagnostic,
  type AdvancedParticipantRole,
  type AdvancedSolidOperationIntent,
  type SweepAdvancedOptions,
  type SweepProfileControl,
} from "@/contracts/modeling/advanced-solid";
import {
  getAuthoredLiteralValue,
  isExpressionAuthoredValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { DurableRef } from "@/contracts/shared/references";
import type {
  FeatureAuthoringDefinition,
  SweepFeatureParameterDraft,
} from "@/core/feature-authoring/definition";
import {
  createSelectionFilterForRequirement,
  sweepSelectionFilter,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  asExtrudeProfileRef,
  asFaceRef,
  asSweepPathRef,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredNumberLiteral,
  authoredStringLiteral,
  buildAdvancedSolidParticipants,
  createAdvancedOperationIntentFields,
  createMissingInputDiagnostic,
  createReferenceCollectionField,
  expressionCapableAuthoredValue,
  filterTargets,
  isAdvancedOperationIntent,
  isPositiveAuthoredNumber,
  toFeaturePhaseDiagnostics,
  validateAdvancedSolidDraft,
} from "@/core/feature-authoring/features/shared";

const sweepParticipants = [
  {
    role: "profile",
    label: "Profile targets",
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ["region", "face"],
  },
  {
    role: "path",
    label: "Path target",
    required: true,
    cardinality: { min: 1, max: 1 },
    acceptedKinds: ["edge", "sketchEntity"],
  },
  {
    role: "guideCurve",
    label: "Guide curve targets",
    required: false,
    cardinality: { min: 0, max: null },
    acceptedKinds: ["edge", "sketchEntity"],
  },
  {
    role: "lockProfileFace",
    label: "Lock profile faces",
    required: false,
    cardinality: { min: 0, max: null },
    acceptedKinds: ["face"],
  },
  {
    role: "lockProfileDirection",
    label: "Lock profile direction",
    required: false,
    cardinality: { min: 0, max: 1 },
    acceptedKinds: ["edge", "construction"],
  },
  {
    role: "targetBody",
    label: "Boolean target bodies",
    required: false,
    cardinality: { min: 0, max: null },
    acceptedKinds: ["body"],
  },
] as const;

const sweepOperationIntent = {
  supportedIntents: ["create", "add", "subtract", "intersect"],
  requiredParticipantsByIntent: {
    add: ["targetBody"],
    subtract: ["targetBody"],
    intersect: ["targetBody"],
  },
} as const;

function getTargetsForRole(
  draft: SweepFeatureParameterDraft,
  role: AdvancedParticipantRole,
) {
  switch (role) {
    case "profile":
      return draft.profileTargets;
    case "path":
      return draft.pathTarget ? [draft.pathTarget] : [];
    case "guideCurve":
      return draft.guideCurveTargets;
    case "lockProfileFace":
      return draft.lockProfileFaceTargets;
    case "lockProfileDirection":
      return draft.lockProfileDirectionTarget
        ? [draft.lockProfileDirectionTarget]
        : [];
    case "targetBody":
      return draft.targetBodyTargets;
    default:
      return [];
  }
}

function buildSweepParticipants(draft: SweepFeatureParameterDraft) {
  return buildAdvancedSolidParticipants(sweepParticipants, (role) =>
    getTargetsForRole(draft, role),
  );
}

function asLockProfileDirectionRef(
  value: PrimitiveRef | null,
): Extract<PrimitiveRef, { kind: "edge" | "construction" }> | null {
  return value?.kind === "edge" || value?.kind === "construction"
    ? value
    : null;
}

function isSweepProfileControl(value: unknown): value is SweepProfileControl {
  return (
    value === "none" ||
    value === "keepProfileOrientation" ||
    value === "lockProfileFaces" ||
    value === "lockProfileDirection"
  );
}

function isSweepTwistType(
  value: unknown,
): value is SweepFeatureParameterDraft["options"]["twist"]["type"] {
  return (
    value === "none" ||
    value === "turns" ||
    value === "angle" ||
    value === "pitch"
  );
}

function createSweepDefaultOptions(): SweepFeatureParameterDraft["options"] {
  return {
    profileControl: "none",
    twist: {
      type: "none",
      turns: 1,
      angle: Math.PI / 2,
      pitch: 1,
    },
    endScale: 1,
  };
}

function coerceSweepProfileControlOption(
  value: unknown,
  fallback: SweepFeatureParameterDraft["options"]["profileControl"],
): SweepFeatureParameterDraft["options"]["profileControl"] {
  const literal = getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>);
  return isSweepProfileControl(literal)
    ? (value as SweepFeatureParameterDraft["options"]["profileControl"])
    : fallback;
}

function sanitizeSweepTwistOption(
  twist: SweepFeatureParameterDraft["options"]["twist"],
): SweepAdvancedOptions["twist"] {
  switch (twist.type) {
    case "turns":
      return {
        type: "turns",
        turns: authoredDefinitionValue(twist.turns ?? 1, 1),
      };
    case "angle":
      return {
        type: "angle",
        angle: authoredDefinitionValue(twist.angle ?? Math.PI / 2, Math.PI / 2),
      };
    case "pitch":
      return {
        type: "pitch",
        pitch: authoredDefinitionValue(twist.pitch ?? 1, 1),
      };
    default:
      return { type: "none" };
  }
}

function buildSweepOptions(
  draft: SweepFeatureParameterDraft,
): SweepAdvancedOptions {
  return {
    profileControl: authoredDefinitionValue(
      draft.options.profileControl,
      "none",
    ),
    twist: sanitizeSweepTwistOption(draft.options.twist),
    endScale: authoredDefinitionValue(draft.options.endScale, 1),
  };
}

function getOptionPatchObject(patch: Record<string, unknown>) {
  return patch.options &&
    typeof patch.options === "object" &&
    !Array.isArray(patch.options)
    ? (patch.options as Record<string, unknown>)
    : null;
}

function mergeSweepOptions(
  current: SweepFeatureParameterDraft["options"],
  patch: Record<string, unknown>,
): SweepFeatureParameterDraft["options"] {
  const optionPatch = getOptionPatchObject(patch);
  if (!optionPatch) {
    return current;
  }

  const twistPatch =
    optionPatch.twist &&
    typeof optionPatch.twist === "object" &&
    !Array.isArray(optionPatch.twist)
      ? (optionPatch.twist as Record<string, unknown>)
      : null;
  const nextTwistType = isSweepTwistType(twistPatch?.type)
    ? twistPatch.type
    : current.twist.type;

  return {
    profileControl: acceptAuthoredPatch(
      optionPatch.profileControl,
      current.profileControl,
      isSweepProfileControl,
    ),
    twist: {
      ...current.twist,
      type: nextTwistType,
      turns: acceptAuthoredPatch(
        twistPatch?.turns,
        current.twist.turns ?? 1,
        (value): value is number => typeof value === "number",
      ),
      angle: acceptAuthoredPatch(
        twistPatch?.angle,
        current.twist.angle ?? Math.PI / 2,
        (value): value is number => typeof value === "number",
      ),
      pitch: acceptAuthoredPatch(
        twistPatch?.pitch,
        current.twist.pitch ?? 1,
        (value): value is number => typeof value === "number",
      ),
    },
    endScale: acceptAuthoredPatch(
      optionPatch.endScale,
      current.endScale,
      (value): value is number => typeof value === "number",
    ),
  };
}

function createSweepValidationDiagnostic(input: {
  message: string;
  role: AdvancedParticipantRole | null;
  target?: DurableRef | null;
}): AdvancedFeatureValidationDiagnostic {
  return {
    code: "advanced-feature-invalid-option",
    severity: "error",
    message: input.message,
    role: input.role,
    target: input.target ?? null,
  };
}

function getSweepValidationDiagnostics(draft: SweepFeatureParameterDraft) {
  const options = buildSweepOptions(draft);
  const diagnostics = validateAdvancedSolidDraft({
    featureKind: "sweep",
    operationIntent: draft.operationIntent,
    participants: buildSweepParticipants(draft),
    participantDescriptors: sweepParticipants,
    operationIntentDescriptor: sweepOperationIntent,
    optionDescriptors: SWEEP_ADVANCED_OPTION_DESCRIPTORS,
    options,
  });

  const profileControl = authoredStringLiteral(
    draft.options.profileControl,
    "none",
  );
  if (
    profileControl === "lockProfileFaces" &&
    draft.lockProfileFaceTargets.length === 0
  ) {
    diagnostics.push(
      createSweepValidationDiagnostic({
        role: "lockProfileFace",
        message: "Lock profile faces requires at least one face reference.",
      }),
    );
  }

  if (
    profileControl === "lockProfileDirection" &&
    !draft.lockProfileDirectionTarget
  ) {
    diagnostics.push(
      createSweepValidationDiagnostic({
        role: "lockProfileDirection",
        message:
          "Lock profile direction requires exactly one edge or construction reference.",
      }),
    );
  }

  return diagnostics;
}

export const sweepAuthoringDefinition = {
  metadata: {
    kind: "sweep",
    name: "Sweep",
    tooltip: "Create a swept solid or surface.",
    icon: "sweep",
    toolId: "sweep",
    groupId: "features",
    modes: ["part"],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: sweepSelectionFilter,
  advancedParticipants: sweepParticipants,
  advancedOptions: SWEEP_ADVANCED_OPTION_DESCRIPTORS,
  operationIntent: sweepOperationIntent,
  createDraft(input) {
    const profileTarget = asExtrudeProfileRef(input.selectedTarget);
    const pathTarget = asSweepPathRef(input.selectedTarget);
    return {
      profileTargets: profileTarget ? [profileTarget] : [],
      pathTarget,
      guideCurveTargets: [],
      lockProfileFaceTargets: [],
      lockProfileDirectionTarget: null,
      operationIntent: "create",
      targetBodyTargets: [],
      options: createSweepDefaultOptions(),
    };
  },
  hydrateDraft(feature) {
    const getParticipantTargets = (role: AdvancedParticipantRole) =>
      feature.parameters.participants.find(
        (participant) => participant.role === role,
      )?.targets ?? [];

    const pathTargets = getParticipantTargets("path");
    const lockProfileDirectionTargets = getParticipantTargets(
      "lockProfileDirection",
    );
    const featureOptions = feature.parameters.options ?? {};
    const twist =
      featureOptions.twist &&
      typeof featureOptions.twist === "object" &&
      !Array.isArray(featureOptions.twist)
        ? (featureOptions.twist as Record<string, unknown>)
        : {};
    const twistType = isSweepTwistType(twist.type) ? twist.type : "none";
    const defaultOptions = createSweepDefaultOptions();
    return {
      profileTargets: filterTargets(
        getParticipantTargets("profile"),
        asExtrudeProfileRef,
      ),
      pathTarget: asSweepPathRef(pathTargets[0] ?? null),
      guideCurveTargets: filterTargets(
        getParticipantTargets("guideCurve"),
        asSweepPathRef,
      ),
      lockProfileFaceTargets: filterTargets(
        getParticipantTargets("lockProfileFace"),
        asFaceRef,
      ),
      lockProfileDirectionTarget: asLockProfileDirectionRef(
        lockProfileDirectionTargets[0] ?? null,
      ),
      operationIntent: feature.parameters.operationIntent ?? "create",
      targetBodyTargets: filterTargets(
        getParticipantTargets("targetBody"),
        asBodyRef,
      ),
      options: {
        profileControl: coerceSweepProfileControlOption(
          featureOptions.profileControl,
          defaultOptions.profileControl,
        ),
        twist: {
          type: twistType,
          turns: (twist.turns ??
            defaultOptions.twist.turns) as MaybeAuthoredValue<number>,
          angle: (twist.angle ??
            defaultOptions.twist.angle) as MaybeAuthoredValue<number>,
          pitch: (twist.pitch ??
            defaultOptions.twist.pitch) as MaybeAuthoredValue<number>,
        },
        endScale: (featureOptions.endScale ??
          defaultOptions.endScale) as MaybeAuthoredValue<number>,
      },
    };
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      profileTargets:
        patch.profileTargets === undefined && patch.profileTarget === undefined
          ? draft.profileTargets
          : Array.isArray(patch.profileTargets)
            ? filterTargets(patch.profileTargets, asExtrudeProfileRef)
            : asExtrudeProfileRef(patch.profileTarget as PrimitiveRef | null)
              ? [patch.profileTarget as (typeof draft.profileTargets)[number]]
              : draft.profileTargets,
      pathTarget:
        patch.pathTarget === undefined
          ? draft.pathTarget
          : asSweepPathRef(patch.pathTarget as PrimitiveRef | null),
      guideCurveTargets:
        patch.guideCurveTargets === undefined
          ? draft.guideCurveTargets
          : filterTargets(patch.guideCurveTargets, asSweepPathRef),
      lockProfileFaceTargets:
        patch.lockProfileFaceTargets === undefined
          ? draft.lockProfileFaceTargets
          : filterTargets(patch.lockProfileFaceTargets, asFaceRef),
      lockProfileDirectionTarget:
        patch.lockProfileDirectionTarget === undefined
          ? draft.lockProfileDirectionTarget
          : asLockProfileDirectionRef(
              patch.lockProfileDirectionTarget as PrimitiveRef | null,
            ),
      operationIntent: acceptAuthoredPatch(
        patch.operationIntent,
        draft.operationIntent,
        isAdvancedOperationIntent,
      ),
      targetBodyTargets:
        patch.targetBodyTargets === undefined
          ? draft.targetBodyTargets
          : filterTargets(patch.targetBodyTargets, asBodyRef),
      options: mergeSweepOptions(draft.options, patch),
    };
  },
  applySelection(draft, target) {
    if (target.kind === "region" || target.kind === "face") {
      return {
        ...draft,
        profileTargets: appendUniqueTarget(draft.profileTargets, target),
      };
    }

    const pathTarget = asSweepPathRef(target);
    if (pathTarget && !draft.pathTarget) {
      return this.applyPatch(draft, { pathTarget });
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
    return (
      draft.pathTarget ??
      draft.profileTargets[0] ??
      draft.lockProfileDirectionTarget ??
      draft.lockProfileFaceTargets[0] ??
      draft.targetBodyTargets[0] ??
      null
    );
  },
  getPreviewLabel(draft, prefix) {
    if (draft.profileTargets.length === 0) {
      return "Select one or more sketch regions or planar faces for sweep";
    }
    if (!draft.pathTarget) {
      return "Select one edge or sketch entity for sweep path";
    }
    if (
      authoredStringLiteral(draft.operationIntent, "create") !== "create" &&
      draft.targetBodyTargets.length === 0
    ) {
      return "Select a target body for sweep boolean operation";
    }
    const profileControl = authoredStringLiteral(
      draft.options.profileControl,
      "none",
    );
    if (
      profileControl === "lockProfileFaces" &&
      draft.lockProfileFaceTargets.length === 0
    ) {
      return "Select one or more faces to lock sweep profile orientation";
    }
    if (
      profileControl === "lockProfileDirection" &&
      !draft.lockProfileDirectionTarget
    ) {
      return "Select an edge or construction reference to lock sweep profile direction";
    }
    return `${prefix} sweep with explicit profile and path`;
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getSweepValidationDiagnostics(input.draft);
    if (diagnostics.length > 0) {
      return toFeaturePhaseDiagnostics({ phase: input.phase, diagnostics });
    }

    return [
      createMissingInputDiagnostic({
        feature: "sweep",
        phase: input.phase,
        suffix: "references",
        message: "Sweep preview requires profile and path references.",
      }),
    ];
  },
  buildDefinition(draft) {
    return getSweepValidationDiagnostics(draft).length === 0
      ? {
          kind: "sweep",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            operationIntent: authoredDefinitionValue(
              draft.operationIntent,
              "create",
            ) as AdvancedSolidOperationIntent,
            participants: buildSweepParticipants(draft),
            options: buildSweepOptions(draft),
          },
        }
      : null;
  },
  getFormSchema(session) {
    const diagnostics = session.diagnostics;
    const operationIntent = authoredStringLiteral(
      session.draft.operationIntent,
      "create",
    );
    const profileControl = authoredStringLiteral(
      session.draft.options.profileControl,
      "none",
    );
    const twistType = session.draft.options.twist.type;
    const twistTurns = session.draft.options.twist.turns ?? 1;
    const twistAngle = session.draft.options.twist.angle ?? Math.PI / 2;
    const twistPitch = session.draft.options.twist.pitch ?? 1;
    const endScale = authoredNumberLiteral(session.draft.options.endScale);
    const endScaleIsValid =
      isExpressionAuthoredValue(session.draft.options.endScale) ||
      (endScale !== null && endScale > 0);
    return {
      sections: [
        {
          id: "references",
          title: "References",
          fields: [
            {
              ...createReferenceCollectionField({
                id: "sweep-profile",
                label: "Profile targets",
                value: session.draft.profileTargets,
                helper:
                  "Accepted targets: derived sketch regions or planar faces.",
                error:
                  session.draft.profileTargets.length > 0
                    ? null
                    : { message: "Select at least one profile target." },
                participant: sweepParticipants[0],
                selectionFilter: sweepSelectionFilter,
                selectionRequirementId: "sweep-profile",
                selectionRequirementLabel: "Sweep profile",
                itemLabel: "Profile",
                patchKey: "profileTargets",
              }),
            },
            {
              kind: "referencePicker",
              id: "sweep-path",
              label: "Path target",
              value: session.draft.pathTarget,
              emptyLabel: "None selected",
              helper:
                "Accepted targets: one durable edge or one sketch entity.",
              error: session.draft.pathTarget
                ? null
                : { message: "Select a sweep path." },
              advancedParticipant: {
                role: "path",
                required: true,
                cardinality: { min: 1, max: 1 },
                selectedCount: session.draft.pathTarget ? 1 : 0,
              },
              picker: {
                mode: "replace",
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(
                  sweepSelectionFilter,
                  "sweep-path",
                  "Sweep path",
                ),
              },
              patch: { patchKey: "pathTarget" },
            },
            createReferenceCollectionField({
              id: "sweep-guide-curves",
              label: "Guide curves",
              value: session.draft.guideCurveTargets,
              helper:
                "Guide curves are stored in the contract and reported as unsupported by the initial OCC builder.",
              participant: sweepParticipants[2],
              selectionFilter: sweepSelectionFilter,
              selectionRequirementId: "sweep-guide-curve",
              selectionRequirementLabel: "Sweep guide curve",
              itemLabel: "Guide curve",
              patchKey: "guideCurveTargets",
            }),
            {
              ...createReferenceCollectionField({
                id: "sweep-lock-profile-faces",
                label: "Lock profile faces",
                value: session.draft.lockProfileFaceTargets,
                helper: "Accepted targets: one or more durable body faces.",
                error:
                  profileControl !== "lockProfileFaces" ||
                  session.draft.lockProfileFaceTargets.length > 0
                    ? null
                    : { message: "Select at least one lock face." },
                participant: sweepParticipants[3],
                selectionFilter: sweepSelectionFilter,
                selectionRequirementId: "sweep-lock-profile-face",
                selectionRequirementLabel: "Lock profile face",
                itemLabel: "Lock face",
                patchKey: "lockProfileFaceTargets",
              }),
              hidden: profileControl !== "lockProfileFaces",
            },
            {
              kind: "referencePicker",
              id: "sweep-lock-profile-direction",
              label: "Lock profile direction",
              value: session.draft.lockProfileDirectionTarget,
              emptyLabel: "None selected",
              helper:
                "Accepted targets: one durable edge or construction reference.",
              hidden: profileControl !== "lockProfileDirection",
              error:
                profileControl !== "lockProfileDirection" ||
                session.draft.lockProfileDirectionTarget
                  ? null
                  : { message: "Select one lock direction reference." },
              advancedParticipant: {
                role: "lockProfileDirection",
                required: profileControl === "lockProfileDirection",
                cardinality: {
                  min: profileControl === "lockProfileDirection" ? 1 : 0,
                  max: 1,
                },
                selectedCount: session.draft.lockProfileDirectionTarget ? 1 : 0,
              },
              picker: {
                mode: "replace",
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(
                  sweepSelectionFilter,
                  "sweep-lock-profile-direction",
                  "Lock profile direction",
                ),
              },
              patch: { patchKey: "lockProfileDirectionTarget" },
            },
          ],
        },
        {
          id: "parameters",
          title: "Parameters",
          fields: [
            ...createAdvancedOperationIntentFields({
              prefix: "sweep",
              operationIntent,
              operationValue: session.draft.operationIntent,
              targetBodyTargets: session.draft.targetBodyTargets,
              selectionFilter: sweepSelectionFilter,
              selectionRequirementId: "sweep-boolean-target",
              selectionRequirementLabel: "Sweep target body",
            }),
            {
              kind: "optionGroup",
              id: "sweep-advanced-options",
              label: "Advanced controls",
              fields: [
                {
                  kind: "enum",
                  id: "sweep-profile-control",
                  label: "Profile control",
                  value: profileControl,
                  options: [
                    { value: "none", label: "none" },
                    {
                      value: "keepProfileOrientation",
                      label: "keepProfileOrientation",
                    },
                    { value: "lockProfileFaces", label: "lockProfileFaces" },
                    {
                      value: "lockProfileDirection",
                      label: "lockProfileDirection",
                    },
                  ],
                  patch: { patchKey: "options", valuePath: ["profileControl"] },
                },
                {
                  kind: "discriminatedOptionGroup",
                  id: "sweep-twist",
                  label: "Twist",
                  discriminant: {
                    kind: "enum",
                    id: "sweep-twist-type",
                    label: "Twist type",
                    value: twistType,
                    options: [
                      { value: "none", label: "none" },
                      { value: "turns", label: "turns" },
                      { value: "angle", label: "angle" },
                      { value: "pitch", label: "pitch" },
                    ],
                    patch: {
                      patchKey: "options",
                      valuePath: ["twist", "type"],
                    },
                  },
                  variants: [
                    { value: "none", label: "None", fields: [] },
                    {
                      value: "turns",
                      label: "Turns",
                      fields: [
                        {
                          kind: "numeric",
                          id: "sweep-twist-turns",
                          label: "Turns",
                          value: authoredNumberFormValue(twistTurns),
                          input: "number",
                          step: 0.25,
                          error: isPositiveAuthoredNumber(twistTurns)
                            ? null
                            : { message: "Turns must be greater than zero." },
                          authoredValue: expressionCapableAuthoredValue(
                            twistTurns,
                            { kind: "positiveNumber" },
                          ),
                          patch: {
                            patchKey: "options",
                            valuePath: ["twist", "turns"],
                          },
                        },
                      ],
                    },
                    {
                      value: "angle",
                      label: "Angle",
                      fields: [
                        {
                          kind: "numeric",
                          id: "sweep-twist-angle",
                          label: "Angle",
                          value: authoredNumberFormValue(
                            twistAngle,
                            (value) => value * (180 / Math.PI),
                          ),
                          input: "angleDegrees",
                          step: 5,
                          authoredValue: expressionCapableAuthoredValue(
                            twistAngle,
                            { kind: "angle" },
                          ),
                          patch: {
                            patchKey: "options",
                            valuePath: ["twist", "angle"],
                          },
                        },
                      ],
                    },
                    {
                      value: "pitch",
                      label: "Pitch",
                      fields: [
                        {
                          kind: "numeric",
                          id: "sweep-twist-pitch",
                          label: "Pitch",
                          value: authoredNumberFormValue(twistPitch),
                          input: "number",
                          step: 0.1,
                          error: isPositiveAuthoredNumber(twistPitch)
                            ? null
                            : { message: "Pitch must be greater than zero." },
                          authoredValue: expressionCapableAuthoredValue(
                            twistPitch,
                            { kind: "positiveNumber" },
                          ),
                          patch: {
                            patchKey: "options",
                            valuePath: ["twist", "pitch"],
                          },
                        },
                      ],
                    },
                  ],
                },
                {
                  kind: "numeric",
                  id: "sweep-end-scale",
                  label: "End scale",
                  value: authoredNumberFormValue(
                    session.draft.options.endScale,
                  ),
                  input: "number",
                  step: 0.1,
                  error: endScaleIsValid
                    ? null
                    : { message: "End scale must be greater than zero." },
                  authoredValue: expressionCapableAuthoredValue(
                    session.draft.options.endScale,
                    { kind: "positiveNumber" },
                  ),
                  patch: { patchKey: "options", valuePath: ["endScale"] },
                },
              ],
            },
          ],
        },
        {
          id: "diagnostics",
          title: "Diagnostics",
          fields: [
            {
              kind: "diagnostics",
              id: "sweep-diagnostics",
              label: "Diagnostics",
              diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"sweep">;
