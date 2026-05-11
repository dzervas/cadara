import type {
  ExtrudeEndCondition,
  ExtrudeFeatureExtent,
  LinearExtentDirection,
  UpToOffsetDirection,
} from "@/contracts/modeling/schema";
import type { FeatureAuthoringDefinition } from "@/core/feature-authoring/definition";
import { getExtrudeFeatureExtent } from "@/contracts/modeling/feature-extents";
import {
  getBooleanScopeBodyTargets,
  hasBooleanTargetScope,
  isBooleanOperation,
  toBooleanScope,
} from "@/core/feature-authoring/definition";
import {
  createSelectionFilterForRequirement,
  extrudeSelectionFilter,
} from "@/core/editor/schema";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  asExtrudeProfileRef,
  asUpToTargetRef,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredStringLiteral,
  createBooleanOperationFields,
  createMissingInputDiagnostic,
  createSingleTargetSelectionFilter,
  expressionCapableAuthoredValue,
  isFiniteAuthoredNumber,
  isPositiveAuthoredNumber,
} from "@/core/feature-authoring/features/shared";
import type { FeatureEditorFormField } from "@/core/feature-authoring/form-schema";

const DEFAULT_FIRST_END: ExtrudeEndCondition = {
  kind: "blind",
  direction: "positive",
  distance: 5,
  draftAngle: 0,
};

const DEFAULT_SECOND_END: ExtrudeEndCondition = {
  kind: "blind",
  direction: "negative",
  distance: 5,
  draftAngle: 0,
};

function isExtrudeDirection(value: unknown): value is LinearExtentDirection {
  return value === "positive" || value === "negative";
}

function isExtentMode(
  value: unknown,
): value is "oneSide" | "symmetric" | "twoSide" {
  return value === "oneSide" || value === "symmetric" || value === "twoSide";
}

function isEndConditionKind(
  value: unknown,
): value is ExtrudeEndCondition["kind"] {
  return (
    value === "blind" ||
    value === "upToNext" ||
    value === "upToFace" ||
    value === "upToPart" ||
    value === "upToVertex" ||
    value === "throughAll"
  );
}

function isOffsetDirection(value: unknown): value is UpToOffsetDirection {
  return value === "shorten" || value === "extend";
}

function ensureEndSupportsMode(
  mode: "oneSide" | "symmetric" | "twoSide",
  end: ExtrudeEndCondition,
) {
  return mode === "symmetric" &&
    end.kind !== "blind" &&
    end.kind !== "throughAll"
    ? {
        ...DEFAULT_FIRST_END,
        direction: end.direction,
        draftAngle: end.draftAngle,
      }
    : end;
}

function coerceTargetForEnd(kind: ExtrudeEndCondition["kind"], value: unknown) {
  const target = asUpToTargetRef(
    value as Parameters<typeof asUpToTargetRef>[0],
  );
  if (kind === "upToFace") {
    return target?.kind === "face" ? target : null;
  }
  if (kind === "upToPart") {
    return target?.kind === "body" ? target : null;
  }
  if (kind === "upToVertex") {
    return target?.kind === "vertex" ? target : null;
  }
  return null;
}

function patchEnd(
  end: ExtrudeEndCondition,
  patch: Record<string, unknown>,
  prefix: "first" | "second",
): ExtrudeEndCondition {
  const conditionKey =
    prefix === "first" ? "endCondition" : "secondEndCondition";
  const directionKey = prefix === "first" ? "direction" : "secondDirection";
  const depthKey = prefix === "first" ? "depth" : "secondDepth";
  const draftKey = prefix === "first" ? "draftAngle" : "secondDraftAngle";
  const targetKey = prefix === "first" ? "upToTarget" : "secondUpToTarget";
  const offsetDistanceKey =
    prefix === "first" ? "upToOffsetDistance" : "secondUpToOffsetDistance";
  const offsetDirectionKey =
    prefix === "first" ? "upToOffsetDirection" : "secondUpToOffsetDirection";
  const nextKind = isEndConditionKind(patch[conditionKey])
    ? patch[conditionKey]
    : end.kind;
  const direction = isExtrudeDirection(patch[directionKey])
    ? patch[directionKey]
    : "direction" in end
      ? end.direction
      : "positive";
  const draftAngle = acceptAuthoredPatch(
    patch[draftKey],
    "draftAngle" in end ? (end.draftAngle ?? 0) : 0,
    (value): value is number => typeof value === "number",
  );
  const offsetDistance = acceptAuthoredPatch(
    patch[offsetDistanceKey],
    "offset" in end ? (end.offset?.distance ?? 0) : 0,
    (value): value is number => typeof value === "number",
  );
  const offsetDirection = isOffsetDirection(patch[offsetDirectionKey])
    ? patch[offsetDirectionKey]
    : "offset" in end
      ? (end.offset?.direction ?? "shorten")
      : "shorten";
  const offset = isFiniteAuthoredNumber(offsetDistance)
    ? { distance: offsetDistance, direction: offsetDirection }
    : undefined;

  if (nextKind === "blind") {
    return {
      kind: "blind",
      direction,
      distance: acceptAuthoredPatch(
        patch[depthKey],
        end.kind === "blind" ? end.distance : 12,
        (value): value is number => typeof value === "number",
      ),
      draftAngle,
    };
  }

  if (nextKind === "throughAll") {
    return { kind: "throughAll", direction, draftAngle };
  }

  if (nextKind === "upToNext") {
    return offset
      ? { kind: "upToNext", direction, offset, draftAngle }
      : { kind: "upToNext", direction, draftAngle };
  }

  const target =
    coerceTargetForEnd(nextKind, patch[targetKey]) ??
    ("target" in end ? coerceTargetForEnd(nextKind, end.target) : null);
  if (nextKind === "upToFace") {
    return {
      kind: "upToFace",
      direction,
      draftAngle,
      ...(offset ? { offset } : {}),
      target:
        target?.kind === "face"
          ? target
          : { kind: "face", bodyId: "" as never, faceId: "" as never },
    };
  }
  if (nextKind === "upToPart") {
    return {
      kind: "upToPart",
      direction,
      draftAngle,
      ...(offset ? { offset } : {}),
      target:
        target?.kind === "body"
          ? target
          : { kind: "body", bodyId: "" as never },
    };
  }
  return {
    kind: "upToVertex",
    direction,
    draftAngle,
    ...(offset ? { offset } : {}),
    target:
      target?.kind === "vertex"
        ? target
        : { kind: "vertex", bodyId: "" as never, vertexId: "" as never },
  };
}

function endHasRequiredTarget(end: ExtrudeEndCondition) {
  if (end.kind === "upToFace") {
    return end.target.bodyId.length > 0 && end.target.faceId.length > 0;
  }
  if (end.kind === "upToPart") {
    return end.target.bodyId.length > 0;
  }
  if (end.kind === "upToVertex") {
    return end.target.bodyId.length > 0 && end.target.vertexId.length > 0;
  }
  return true;
}

function endHasValidScalars(end: ExtrudeEndCondition) {
  return (
    (end.kind !== "blind" || isPositiveAuthoredNumber(end.distance)) &&
    (!("draftAngle" in end) ||
      end.draftAngle === undefined ||
      isFiniteAuthoredNumber(end.draftAngle)) &&
    (!("offset" in end) ||
      end.offset === undefined ||
      isFiniteAuthoredNumber(end.offset.distance))
  );
}

function definitionEnd(end: ExtrudeEndCondition): ExtrudeEndCondition {
  switch (end.kind) {
    case "blind":
      return {
        ...end,
        distance: authoredDefinitionValue(end.distance, 12),
        draftAngle: authoredDefinitionValue(end.draftAngle ?? 0, 0),
      };
    case "upToNext":
    case "upToFace":
    case "upToPart":
    case "upToVertex":
      return {
        ...end,
        draftAngle: authoredDefinitionValue(end.draftAngle ?? 0, 0),
        ...(end.offset
          ? {
              offset: {
                ...end.offset,
                distance: authoredDefinitionValue(end.offset.distance, 0),
              },
            }
          : {}),
      } as ExtrudeEndCondition;
    case "throughAll":
      return {
        ...end,
        draftAngle: authoredDefinitionValue(end.draftAngle ?? 0, 0),
      };
  }
}

function endConditionLabel(kind: ExtrudeEndCondition["kind"]) {
  switch (kind) {
    case "blind":
      return "Blind";
    case "upToNext":
      return "Up to next";
    case "upToFace":
      return "Up to face";
    case "upToPart":
      return "Up to part";
    case "upToVertex":
      return "Up to vertex";
    case "throughAll":
      return "Through all";
  }
}

function endFields(
  prefix: "first" | "second",
  end: ExtrudeEndCondition,
): FeatureEditorFormField[] {
  const idPrefix = prefix === "first" ? "extrude" : "extrude-second";
  const labelPrefix = prefix === "first" ? "" : "Second ";
  const conditionKey =
    prefix === "first" ? "endCondition" : "secondEndCondition";
  const directionKey = prefix === "first" ? "direction" : "secondDirection";
  const depthKey = prefix === "first" ? "depth" : "secondDepth";
  const draftKey = prefix === "first" ? "draftAngle" : "secondDraftAngle";
  const targetKey = prefix === "first" ? "upToTarget" : "secondUpToTarget";
  const offsetDistanceKey =
    prefix === "first" ? "upToOffsetDistance" : "secondUpToOffsetDistance";
  const offsetDirectionKey =
    prefix === "first" ? "upToOffsetDirection" : "secondUpToOffsetDirection";
  const fields: FeatureEditorFormField[] = [
    {
      kind: "enum",
      id: `${idPrefix}-end-condition`,
      label: `${labelPrefix}End condition`,
      value: end.kind,
      options: [
        "blind",
        "upToNext",
        "upToFace",
        "upToPart",
        "upToVertex",
        "throughAll",
      ].map((value) => ({
        value,
        label: endConditionLabel(value as ExtrudeEndCondition["kind"]),
      })),
      patch: { patchKey: conditionKey },
    },
  ];

  if (end.kind === "blind") {
    fields.push({
      kind: "numeric",
      id: `${idPrefix}-depth`,
      label: `${labelPrefix}Depth`,
      value: authoredNumberFormValue(end.distance),
      input: "number",
      step: 0.1,
      directionToggle: {
        patch: { patchKey: directionKey },
        value: end.direction,
        forwardValue: "positive",
        reverseValue: "negative",
        forwardLabel: "Positive normal",
        reverseLabel: "Negative normal",
      },
      authoredValue: expressionCapableAuthoredValue(end.distance, {
        kind: "positiveNumber",
      }),
      error: isPositiveAuthoredNumber(end.distance)
        ? null
        : { message: "Depth must be greater than zero." },
      patch: { patchKey: depthKey },
    });
  } else {
    fields.push({
      kind: "enum",
      id: `${idPrefix}-direction`,
      label: `${labelPrefix}Direction`,
      value: end.direction,
      options: [
        { value: "positive", label: "Positive normal" },
        { value: "negative", label: "Negative normal" },
      ],
      patch: { patchKey: directionKey },
    });
  }

  if (
    end.kind === "upToFace" ||
    end.kind === "upToPart" ||
    end.kind === "upToVertex"
  ) {
    const targetKind =
      end.kind === "upToFace"
        ? "face"
        : end.kind === "upToPart"
          ? "body"
          : "vertex";
    fields.push({
      kind: "referencePicker",
      id: `${idPrefix}-up-to-target`,
      label: `${labelPrefix}${endConditionLabel(end.kind)} target`,
      value: endHasRequiredTarget(end) ? end.target : null,
      emptyLabel: "None selected",
      helper: `Accepted target: one ${targetKind}.`,
      error: endHasRequiredTarget(end)
        ? null
        : { message: `Select one ${targetKind} target.` },
      picker: {
        mode: "replace",
        allowsMultiple: false,
        selectionFilter: createSingleTargetSelectionFilter(
          extrudeSelectionFilter,
          {
            id: `${idPrefix}-up-to-target`,
            label: `${labelPrefix}${endConditionLabel(end.kind)} target`,
            targetKind,
          },
        ),
      },
      patch: { patchKey: targetKey },
    });
  }

  if (
    end.kind === "upToNext" ||
    end.kind === "upToFace" ||
    end.kind === "upToPart" ||
    end.kind === "upToVertex"
  ) {
    fields.push(
      {
        kind: "numeric",
        id: `${idPrefix}-up-to-offset`,
        label: `${labelPrefix}Offset`,
        value: authoredNumberFormValue(end.offset?.distance ?? 0),
        input: "number",
        step: 0.1,
        authoredValue: expressionCapableAuthoredValue(
          end.offset?.distance ?? 0,
          {
            kind: "finiteNumber",
          },
        ),
        error:
          end.offset?.distance === undefined ||
          isFiniteAuthoredNumber(end.offset.distance)
            ? null
            : { message: "Offset must be finite." },
        patch: { patchKey: offsetDistanceKey },
      },
      {
        kind: "enum",
        id: `${idPrefix}-up-to-offset-direction`,
        label: `${labelPrefix}Offset direction`,
        value: end.offset?.direction ?? "shorten",
        options: [
          { value: "shorten", label: "Shorten" },
          { value: "extend", label: "Extend" },
        ],
        patch: { patchKey: offsetDirectionKey },
      },
    );
  }

  fields.push({
    kind: "numeric",
    id: `${idPrefix}-draft-angle`,
    label: `${labelPrefix}Draft angle (degrees)`,
    value: authoredNumberFormValue(
      end.draftAngle ?? 0,
      (value) => value * (180 / Math.PI),
    ),
    input: "angleDegrees",
    step: 1,
    authoredValue: expressionCapableAuthoredValue(end.draftAngle ?? 0, {
      kind: "angle",
    }),
    error:
      end.draftAngle === undefined || isFiniteAuthoredNumber(end.draftAngle)
        ? null
        : { message: "Draft angle must be finite." },
    patch: { patchKey: draftKey },
  });

  return fields;
}

export const extrudeAuthoringDefinition = {
  metadata: {
    kind: "extrude",
    name: "Extrude",
    tooltip: "Create an extruded solid or surface.",
    icon: "extrude",
    toolId: "extrude",
    groupId: "features",
    modes: ["part"],
  },
  featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
  selectionFilter: extrudeSelectionFilter,
  advancedParticipants: [
    {
      role: "profile",
      label: "Profile targets",
      required: true,
      cardinality: { min: 1, max: null },
      acceptedKinds: ["region", "face"],
    },
    {
      role: "targetBody",
      label: "Boolean target bodies",
      required: false,
      cardinality: { min: 0, max: null },
      acceptedKinds: ["body"],
    },
  ],
  operationIntent: {
    supportedIntents: ["create", "add", "subtract", "intersect"],
    requiredParticipantsByIntent: {
      add: ["targetBody"],
      subtract: ["targetBody"],
      intersect: ["targetBody"],
    },
  },
  createDraft(input) {
    const profileTarget = asExtrudeProfileRef(input.selectedTarget);
    return {
      profileTargets: profileTarget ? [profileTarget] : [],
      extentMode: "oneSide",
      firstEnd: DEFAULT_FIRST_END,
      secondEnd: DEFAULT_SECOND_END,
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    };
  },
  hydrateDraft(feature) {
    const extent = getExtrudeFeatureExtent(feature.parameters);
    return {
      profileTargets: [...feature.parameters.profiles],
      extentMode: extent.mode,
      firstEnd: extent.mode === "twoSide" ? extent.firstEnd : extent.end,
      secondEnd:
        extent.mode === "twoSide" ? extent.secondEnd : DEFAULT_SECOND_END,
      operation: feature.parameters.operation,
      booleanScope: feature.parameters.booleanScope,
    };
  },
  applyPatch(draft, patch) {
    const extentMode = isExtentMode(patch.extentMode)
      ? patch.extentMode
      : draft.extentMode;
    return {
      ...draft,
      profileTargets:
        patch.profileTargets === undefined && patch.profileTarget === undefined
          ? draft.profileTargets
          : Array.isArray(patch.profileTargets)
            ? patch.profileTargets.filter(
                (entry): entry is (typeof draft.profileTargets)[number] =>
                  asExtrudeProfileRef(
                    entry as Parameters<typeof asExtrudeProfileRef>[0],
                  ) !== null,
              )
            : asExtrudeProfileRef(
                  patch.profileTarget as Parameters<
                    typeof asExtrudeProfileRef
                  >[0],
                )
              ? [patch.profileTarget as (typeof draft.profileTargets)[number]]
              : draft.profileTargets,
      extentMode,
      firstEnd: ensureEndSupportsMode(
        extentMode,
        patchEnd(draft.firstEnd, patch, "first"),
      ),
      secondEnd: patchEnd(draft.secondEnd, patch, "second"),
      operation: acceptAuthoredPatch(
        patch.operation,
        draft.operation,
        isBooleanOperation,
      ),
      booleanScope: toBooleanScope(patch, draft.booleanScope),
    };
  },
  applySelection(draft, target) {
    if (target.kind === "region" || target.kind === "face") {
      return {
        ...draft,
        profileTargets: appendUniqueTarget(draft.profileTargets, target),
      };
    }

    const bodyTarget = asBodyRef(target);
    return bodyTarget &&
      authoredStringLiteral(draft.operation, "newBody") !== "newBody"
      ? this.applyPatch(draft, { booleanTargetBodyId: bodyTarget.bodyId })
      : draft;
  },
  getPrimarySelectionTarget(draft) {
    return draft.profileTargets[0] ?? null;
  },
  getPreviewLabel(draft, prefix) {
    return draft.profileTargets.length > 0
      ? `${prefix} extrude on ${draft.profileTargets.length} profile${draft.profileTargets.length === 1 ? "" : "s"}`
      : "Select one or more sketch regions or planar faces for extrude";
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = [];

    if (input.draft.profileTargets.length === 0) {
      diagnostics.push(
        createMissingInputDiagnostic({
          feature: "extrude",
          phase: input.phase,
          suffix: "profile",
          message:
            "Select a derived sketch region or planar face before previewing extrude.",
        }),
      );
    }

    if (
      !endHasValidScalars(input.draft.firstEnd) ||
      !endHasRequiredTarget(input.draft.firstEnd)
    ) {
      diagnostics.push(
        createMissingInputDiagnostic({
          feature: "extrude",
          phase: input.phase,
          suffix: "end-condition",
          message:
            "Complete the active extrude end condition before previewing extrude.",
        }),
      );
    }

    if (
      input.draft.extentMode === "twoSide" &&
      (!endHasValidScalars(input.draft.secondEnd) ||
        !endHasRequiredTarget(input.draft.secondEnd))
    ) {
      diagnostics.push(
        createMissingInputDiagnostic({
          feature: "extrude",
          phase: input.phase,
          suffix: "second-end-condition",
          message:
            "Complete the second extrude end condition before previewing extrude.",
        }),
      );
    }

    if (
      !hasBooleanTargetScope(
        authoredStringLiteral(input.draft.operation, "newBody"),
        input.draft.booleanScope,
      )
    ) {
      diagnostics.push(
        createMissingInputDiagnostic({
          feature: "extrude",
          phase: input.phase,
          suffix: "boolean-target",
          message: "Select at least one target body before previewing extrude.",
        }),
      );
    }

    return diagnostics;
  },
  buildDefinition(draft) {
    const operation = authoredStringLiteral(draft.operation, "newBody");
    const firstEnd = ensureEndSupportsMode(draft.extentMode, draft.firstEnd);
    const extent: ExtrudeFeatureExtent =
      draft.extentMode === "twoSide"
        ? {
            mode: "twoSide",
            firstEnd: definitionEnd(firstEnd),
            secondEnd: definitionEnd(draft.secondEnd),
          }
        : draft.extentMode === "symmetric"
          ? {
              mode: "symmetric",
              end: definitionEnd(firstEnd) as Extract<
                ExtrudeEndCondition,
                { kind: "blind" | "throughAll" }
              >,
            }
          : { mode: "oneSide", end: definitionEnd(firstEnd) };

    return draft.profileTargets.length > 0 &&
      hasBooleanTargetScope(operation, draft.booleanScope) &&
      endHasValidScalars(firstEnd) &&
      endHasRequiredTarget(firstEnd) &&
      (draft.extentMode !== "twoSide" ||
        (endHasValidScalars(draft.secondEnd) &&
          endHasRequiredTarget(draft.secondEnd)))
      ? {
          kind: "extrude",
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: draft.profileTargets as readonly [
              (typeof draft.profileTargets)[number],
              ...(typeof draft.profileTargets)[number][],
            ],
            startExtent: { kind: "profilePlane" },
            extent,
            operation: authoredDefinitionValue(
              draft.operation,
              operation,
            ) as typeof operation,
            booleanScope: draft.booleanScope,
          },
        }
      : null;
  },
  getFormSchema(session) {
    const booleanTargetBodies = getBooleanScopeBodyTargets(
      session.draft.booleanScope,
    );
    const operation = authoredStringLiteral(session.draft.operation, "newBody");
    return {
      sections: [
        {
          id: "references",
          title: "References",
          fields: [
            {
              kind: "referenceCollection",
              id: "extrude-profile",
              label: "Profile targets",
              value: session.draft.profileTargets,
              emptyLabel: "None selected",
              helper:
                "Accepted targets: derived sketch regions or planar faces.",
              error:
                session.draft.profileTargets.length > 0
                  ? null
                  : { message: "Select at least one profile target." },
              advancedParticipant: {
                role: "profile",
                required: true,
                cardinality: { min: 1, max: null },
                selectedCount: session.draft.profileTargets.length,
              },
              picker: {
                mode: "appendUnique",
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(
                  extrudeSelectionFilter,
                  "extrude-profile",
                  "Extrude profile",
                ),
                itemLabel: "Profile",
              },
              patch: { patchKey: "profileTargets" },
            },
          ],
        },
        {
          id: "parameters",
          title: "Parameters",
          fields: [
            {
              kind: "enum",
              id: "extrude-extent-mode",
              label: "Extent mode",
              value: session.draft.extentMode,
              options: [
                { value: "oneSide", label: "One side" },
                { value: "symmetric", label: "Symmetric" },
                { value: "twoSide", label: "Two side" },
              ],
              patch: { patchKey: "extentMode" },
            },
            ...endFields(
              "first",
              ensureEndSupportsMode(
                session.draft.extentMode,
                session.draft.firstEnd,
              ),
            ),
            ...(session.draft.extentMode === "twoSide"
              ? endFields("second", session.draft.secondEnd)
              : []),
            ...createBooleanOperationFields({
              prefix: "extrude",
              operation,
              operationValue: session.draft.operation,
              booleanTargetBodies,
              selectionFilter: extrudeSelectionFilter,
              selectionRequirementId: "extrude-target-body",
              selectionRequirementLabel: "Extrude target body",
            }),
          ],
        },
        {
          id: "diagnostics",
          title: "Diagnostics",
          fields: [
            {
              kind: "diagnostics",
              id: "extrude-diagnostics",
              label: "Diagnostics",
              diagnostics: session.diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"extrude">;
