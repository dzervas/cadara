import type {
  ExtrudeEndCondition,
  ExtrudeFeatureExtent,
  ExtrudeFeatureParameters,
  ExtrudeProfileRef,
  ExtrudeSurfaceProfileRef,
  ModelingDiagnostic,
} from "@/contracts/modeling/schema";
import type {
  ExtrudeFeatureEndConditionDraft,
  FeatureAuthoringDefinition,
  FeatureResultBodyType,
} from "@/core/feature-authoring/definition";
import { getExtrudeFeatureExtent } from "@/contracts/modeling/feature-extents";
import {
  getBooleanScopeBodyTargets,
  hasBooleanTargetScope,
  isResultBodyType,
  resolveResultBodyTypeVariant,
} from "@/core/feature-authoring/definition";
import {
  createSelectionFilterForRequirement,
  extrudeSelectionFilter,
} from "@/core/editor/schema";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import * as shared from "@/core/feature-authoring/features/shared";
import {
  extrudeEndConditionFields,
  extrudeEndHasRequiredTarget,
  extrudeEndHasValidScalars,
  patchExtrudeEndCondition,
  type ExtrudeEndConditionFieldKeys,
} from "@/core/feature-authoring/features/extrude-end-condition-fields";
import type { FeatureEditorFormField } from "@/core/feature-authoring/form-schema";

const DEFAULT_FIRST_END: ExtrudeFeatureEndConditionDraft = {
  kind: "blind",
  direction: "positive",
  distance: 5,
  draftAngle: 0,
};

const DEFAULT_SECOND_END: ExtrudeFeatureEndConditionDraft = {
  kind: "blind",
  direction: "negative",
  distance: 5,
  draftAngle: 0,
};

function isExtentMode(
  value: unknown,
): value is "oneSide" | "symmetric" | "twoSide" {
  return value === "oneSide" || value === "symmetric" || value === "twoSide";
}

function ensureEndSupportsMode(
  mode: "oneSide" | "symmetric" | "twoSide",
  end: ExtrudeFeatureEndConditionDraft,
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

function definitionEnd(
  end: ExtrudeFeatureEndConditionDraft,
  resultBodyType: FeatureResultBodyType,
): ExtrudeEndCondition {
  const draft =
    resultBodyType === "surface"
      ? {}
      : {
          draftAngle: shared.authoredDefinitionValue(end.draftAngle ?? 0, 0),
        };
  switch (end.kind) {
    case "blind":
      return {
        kind: "blind",
        direction: end.direction,
        distance: shared.authoredDefinitionValue(end.distance, 12),
        ...draft,
      };
    case "upToNext":
    case "upToFace":
    case "upToPart":
    case "upToVertex":
      return {
        kind: end.kind,
        direction: end.direction,
        ...("target" in end ? { target: end.target } : {}),
        ...draft,
        ...(end.offset
          ? {
              offset: {
                ...end.offset,
                distance: shared.authoredDefinitionValue(
                  end.offset.distance,
                  0,
                ),
              },
            }
          : {}),
      } as ExtrudeEndCondition;
    case "throughAll":
      return { kind: "throughAll", direction: end.direction, ...draft };
  }
}

function extrudeEndKeys(prefix: "first" | "second"): ExtrudeEndConditionFieldKeys {
  return prefix === "first"
    ? {
        idPrefix: "extrude",
        labelPrefix: "",
        condition: "endCondition",
        direction: "direction",
        depth: "depth",
        draftAngle: "draftAngle",
        target: "upToTarget",
        offsetDistance: "upToOffsetDistance",
        offsetDirection: "upToOffsetDirection",
      }
    : {
        idPrefix: "extrude-second",
        labelPrefix: "Second ",
        condition: "secondEndCondition",
        direction: "secondDirection",
        depth: "secondDepth",
        draftAngle: "secondDraftAngle",
        target: "secondUpToTarget",
        offsetDistance: "secondUpToOffsetDistance",
        offsetDirection: "secondUpToOffsetDirection",
      };
}

function patchEnd(
  end: ExtrudeFeatureEndConditionDraft,
  patch: Record<string, unknown>,
  prefix: "first" | "second",
) {
  return patchExtrudeEndCondition(end, patch, extrudeEndKeys(prefix));
}

function endFields(
  prefix: "first" | "second",
  end: ExtrudeFeatureEndConditionDraft,
  resultBodyType: FeatureResultBodyType,
): FeatureEditorFormField[] {
  return extrudeEndConditionFields({
    end,
    keys: extrudeEndKeys(prefix),
    includeDraftAngle: resultBodyType !== "surface",
    selectionFilter: extrudeSelectionFilter,
  });
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
    const profileTarget = shared.asExtrudeProfileRef(input.selectedTarget);
    return {
      resultBodyType: "solid",
      profileTargets: profileTarget ? [profileTarget] : [],
      startExtent: { kind: "profilePlane" },
      extentMode: "oneSide",
      firstEnd: DEFAULT_FIRST_END,
      secondEnd: DEFAULT_SECOND_END,
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    };
  },
  hydrateDraft(feature) {
    const parameters = feature.parameters;
    const extent = getExtrudeFeatureExtent(parameters);
    return {
      resultBodyType: parameters.resultBodyType,
      profileTargets: parameters.profiles as readonly ExtrudeSurfaceProfileRef[],
      startExtent: parameters.startExtent,
      extentMode: extent.mode,
      firstEnd: extent.mode === "twoSide" ? extent.firstEnd : extent.end,
      secondEnd:
        extent.mode === "twoSide" ? extent.secondEnd : DEFAULT_SECOND_END,
      operation:
        parameters.resultBodyType === "solid"
          ? parameters.operation
          : "newBody",
      booleanScope:
        parameters.resultBodyType === "solid"
          ? parameters.booleanScope
          : { kind: "standalone" },
    };
  },
  applyPatch(draft, patch) {
    const extentMode = isExtentMode(patch.extentMode)
      ? patch.extentMode
      : draft.extentMode;
    const resultBodyType = isResultBodyType(patch.resultBodyType)
      ? patch.resultBodyType
      : draft.resultBodyType;
    const patchedProfileTargets =
      patch.profileTargets === undefined && patch.profileTarget === undefined
        ? draft.profileTargets
        : Array.isArray(patch.profileTargets)
          ? patch.profileTargets.filter(
              (entry): entry is (typeof draft.profileTargets)[number] =>
                shared.asResultBodyTypeProfileRef(
                  entry as Parameters<
                    typeof shared.asResultBodyTypeProfileRef
                  >[0],
                  resultBodyType,
                ) !== null,
            )
          : shared.asResultBodyTypeProfileRef(
                patch.profileTarget as Parameters<
                  typeof shared.asResultBodyTypeProfileRef
                >[0],
                resultBodyType,
              )
            ? [patch.profileTarget as (typeof draft.profileTargets)[number]]
            : draft.profileTargets;
    return {
      ...draft,
      ...resolveResultBodyTypeVariant(draft, patch, patchedProfileTargets),
      extentMode,
      firstEnd: ensureEndSupportsMode(
        extentMode,
        patchEnd(draft.firstEnd, patch, "first"),
      ),
      secondEnd: patchEnd(draft.secondEnd, patch, "second"),
    };
  },
  applySelection(draft, target) {
    const profileTarget = shared.asResultBodyTypeProfileRef(
      target,
      draft.resultBodyType,
    );
    if (profileTarget) {
      return {
        ...draft,
        profileTargets: shared.appendUniqueTarget(
          draft.profileTargets,
          profileTarget,
        ),
      };
    }

    const bodyTarget = shared.asBodyRef(target);
    return bodyTarget &&
      shared.authoredStringLiteral(draft.operation, "newBody") !== "newBody"
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
    const diagnostics: ModelingDiagnostic[] = [];

    if (input.draft.profileTargets.length === 0) {
      diagnostics.push(
        shared.createMissingInputDiagnostic({
          feature: "extrude",
          phase: input.phase,
          suffix: "profile",
          message:
            "Select a derived sketch region or planar face before previewing extrude.",
        }),
      );
    }

    if (
      !extrudeEndHasValidScalars(input.draft.firstEnd) ||
      !extrudeEndHasRequiredTarget(input.draft.firstEnd)
    ) {
      diagnostics.push(
        shared.createMissingInputDiagnostic({
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
      (!extrudeEndHasValidScalars(input.draft.secondEnd) ||
        !extrudeEndHasRequiredTarget(input.draft.secondEnd))
    ) {
      diagnostics.push(
        shared.createMissingInputDiagnostic({
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
        shared.authoredStringLiteral(input.draft.operation, "newBody"),
        input.draft.booleanScope,
      )
    ) {
      diagnostics.push(
        shared.createMissingInputDiagnostic({
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
    const operation = shared.authoredStringLiteral(draft.operation, "newBody");
    const firstEnd = ensureEndSupportsMode(draft.extentMode, draft.firstEnd);
    const buildEnd = (end: ExtrudeFeatureEndConditionDraft) =>
      definitionEnd(end, draft.resultBodyType);
    const extent: ExtrudeFeatureExtent =
      draft.extentMode === "twoSide"
        ? {
            mode: "twoSide",
            firstEnd: buildEnd(firstEnd),
            secondEnd: buildEnd(draft.secondEnd),
          }
        : draft.extentMode === "symmetric"
          ? {
              mode: "symmetric",
              end: buildEnd(firstEnd) as Extract<
                ExtrudeEndCondition,
                { kind: "blind" | "throughAll" }
              >,
            }
          : { mode: "oneSide", end: buildEnd(firstEnd) };
    const solidProfiles = draft.profileTargets.filter(
      (entry): entry is ExtrudeProfileRef => entry.kind !== "sketchEntity",
    );

    if (
      draft.profileTargets.length === 0 ||
      !extrudeEndHasValidScalars(firstEnd) ||
      !extrudeEndHasRequiredTarget(firstEnd) ||
      (draft.extentMode === "twoSide" &&
        (!extrudeEndHasValidScalars(draft.secondEnd) ||
          !extrudeEndHasRequiredTarget(draft.secondEnd)))
    ) {
      return null;
    }

    if (draft.resultBodyType === "surface") {
      return {
        kind: "extrude",
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          resultBodyType: "surface",
          profiles: draft.profileTargets as readonly [
            ExtrudeSurfaceProfileRef,
            ...ExtrudeSurfaceProfileRef[],
          ],
          startExtent: draft.startExtent,
          extent,
        },
      };
    }

    return solidProfiles.length === draft.profileTargets.length &&
      hasBooleanTargetScope(operation, draft.booleanScope)
      ? {
          kind: "extrude",
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            resultBodyType: "solid",
            profiles: [solidProfiles[0]!, ...solidProfiles.slice(1)],
            startExtent: draft.startExtent,
            extent,
            operation: shared.authoredDefinitionValue(
              draft.operation,
              operation,
            ),
            booleanScope: draft.booleanScope,
          },
        }
      : null;
  },
  getFormSchema(session) {
    const booleanTargetBodies = getBooleanScopeBodyTargets(
      session.draft.booleanScope,
    );
    const operation = shared.authoredStringLiteral(
      session.draft.operation,
      "newBody",
    );
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
                session.draft.resultBodyType === "surface"
                  ? "Accepted targets: derived sketch regions, planar faces, or open sketch curves."
                  : "Accepted targets: derived sketch regions or planar faces.",
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
                  session.draft.resultBodyType === "surface"
                    ? "extrude-surface-profile"
                    : "extrude-profile",
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
            shared.createResultBodyTypeField({
              prefix: "extrude",
              resultBodyType: session.draft.resultBodyType,
            }),
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
              session.draft.resultBodyType,
            ),
            ...(session.draft.extentMode === "twoSide"
              ? endFields(
                  "second",
                  session.draft.secondEnd,
                  session.draft.resultBodyType,
                )
              : []),
            ...(session.draft.resultBodyType === "surface"
              ? []
              : shared.createBooleanOperationFields({
                  prefix: "extrude",
                  operation,
                  operationValue: session.draft.operation,
                  booleanTargetBodies,
                  selectionFilter: extrudeSelectionFilter,
                  selectionRequirementId: "extrude-target-body",
                  selectionRequirementLabel: "Extrude target body",
                })),
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

/** Prepare canonical parameters through the same draft/builder as browser edits. */
export function prepareExtrudeFeatureDefinition(parameters: ExtrudeFeatureParameters) {
  const ends = parameters.extent.mode === "twoSide"
    ? [parameters.extent.firstEnd, parameters.extent.secondEnd]
    : [parameters.extent.end];
  // The browser surface form omits draft controls; a semantic caller must not
  // have an explicitly requested unsupported draft silently stripped instead.
  if (parameters.resultBodyType === "surface" && ends.some(end => end.draftAngle !== undefined)) return null;
  return extrudeAuthoringDefinition.buildDefinition(
    extrudeAuthoringDefinition.hydrateDraft({
      kind: "extrude",
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters,
    }),
  );
}
