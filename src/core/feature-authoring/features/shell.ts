import type { FeatureAuthoringDefinition } from "@/core/feature-authoring/definition";
import {
  getBooleanScopeBodyTargets,
  hasBooleanTargetScope,
  isBooleanOperation,
  toBooleanScope,
} from "@/core/feature-authoring/definition";
import {
  createSelectionFilterForRequirement,
  shellSelectionFilter,
} from "@/core/editor/schema";
import { SHELL_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  asFaceRef,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredStringLiteral,
  createMissingInputDiagnostic,
  expressionCapableAuthoredValue,
  isPositiveAuthoredNumber,
} from "@/core/feature-authoring/features/shared";

function isShellDirection(value: unknown): value is "inside" | "outside" {
  return value === "inside" || value === "outside";
}

function isShellMode(value: unknown): value is "openFaces" | "offsetAllFaces" {
  return value === "openFaces" || value === "offsetAllFaces";
}

export const shellAuthoringDefinition = {
  metadata: {
    kind: "shell",
    name: "Shell",
    tooltip: "Hollow a solid body.",
    icon: "shell",
    toolId: "shell",
    groupId: "features",
    modes: ["part"],
  },
  featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
  selectionFilter: shellSelectionFilter,
  advancedParticipants: [
    {
      role: "body",
      label: "Source body",
      required: true,
      cardinality: { min: 1, max: 1 },
      acceptedKinds: ["body"],
    },
    {
      role: "face",
      label: "Removable faces",
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
    const selectedFace = asFaceRef(input.selectedTarget);
    const bodyTarget =
      asBodyRef(input.selectedTarget) ??
      (selectedFace
        ? { kind: "body" as const, bodyId: selectedFace.bodyId }
        : null);
    return {
      mode: "openFaces",
      bodyTarget,
      faceTargets: selectedFace ? [selectedFace] : [],
      thickness: 1,
      direction: "inside",
      operation: "intersect",
      booleanScope: bodyTarget
        ? { kind: "targetBody", bodyId: bodyTarget.bodyId }
        : { kind: "standalone" },
    };
  },
  hydrateDraft(feature) {
    return {
      mode: feature.parameters.mode ?? "openFaces",
      bodyTarget: feature.parameters.bodyTarget,
      faceTargets: [...feature.parameters.faceTargets],
      thickness: feature.parameters.thickness,
      direction: feature.parameters.direction ?? "inside",
      operation: feature.parameters.operation,
      booleanScope: feature.parameters.booleanScope,
    };
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      mode: isShellMode(patch.mode) ? patch.mode : draft.mode,
      bodyTarget:
        patch.bodyTarget === undefined
          ? draft.bodyTarget
          : asBodyRef(patch.bodyTarget as Parameters<typeof asBodyRef>[0]),
      faceTargets:
        patch.faceTargets === undefined && patch.faceTarget === undefined
          ? draft.faceTargets
          : Array.isArray(patch.faceTargets)
            ? patch.faceTargets.filter(
                (
                  entry,
                ): entry is Extract<
                  (typeof draft.faceTargets)[number],
                  { kind: "face" }
                > => entry?.kind === "face",
              )
            : asFaceRef(patch.faceTarget as Parameters<typeof asFaceRef>[0])
              ? [patch.faceTarget as (typeof draft.faceTargets)[number]]
              : draft.faceTargets,
      thickness: acceptAuthoredPatch(
        patch.thickness,
        draft.thickness,
        (value): value is number => typeof value === "number",
      ),
      direction: isShellDirection(patch.direction)
        ? patch.direction
        : draft.direction,
      operation: acceptAuthoredPatch(
        patch.operation,
        draft.operation,
        isBooleanOperation,
      ),
      booleanScope: toBooleanScope(patch, draft.booleanScope),
    };
  },
  applySelection(draft, target) {
    if (target.kind === "body") {
      return this.applyPatch(draft, {
        bodyTarget: target,
        booleanTargetBodyId:
          authoredStringLiteral(draft.operation, "newBody") === "newBody"
            ? undefined
            : target.bodyId,
      });
    }

    if (target.kind === "face") {
      const bodyTarget = { kind: "body" as const, bodyId: target.bodyId };
      return {
        ...draft,
        bodyTarget: draft.bodyTarget ?? bodyTarget,
        faceTargets: appendUniqueTarget(draft.faceTargets, target),
        booleanScope:
          authoredStringLiteral(draft.operation, "newBody") === "newBody" ||
          getBooleanScopeBodyTargets(draft.booleanScope).length > 0
            ? draft.booleanScope
            : { kind: "targetBody", bodyId: bodyTarget.bodyId },
      };
    }

    return draft;
  },
  getPrimarySelectionTarget(draft) {
    return draft.faceTargets[0] ?? draft.bodyTarget;
  },
  getPreviewLabel(draft, prefix) {
    if (!draft.bodyTarget) {
      return "Select a body to shell";
    }
    if (draft.mode === "openFaces" && draft.faceTargets.length === 0) {
      return "Select one or more removable faces for shell";
    }
    return `${prefix} shell on ${draft.bodyTarget.bodyId}`;
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = [];

    if (
      !input.draft.bodyTarget ||
      (input.draft.mode === "openFaces" && input.draft.faceTargets.length === 0)
    ) {
      diagnostics.push(
        createMissingInputDiagnostic({
          feature: "shell",
          phase: input.phase,
          suffix: "shell-inputs",
          message:
            input.draft.mode === "openFaces"
              ? "Shell preview requires one body and at least one removable face."
              : "Whole-solid shell offset preview requires one body.",
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
          feature: "shell",
          phase: input.phase,
          suffix: "boolean-target",
          message: "Select at least one target body before previewing shell.",
        }),
      );
    }

    return diagnostics;
  },
  buildDefinition(draft) {
    const operation = authoredStringLiteral(draft.operation, "newBody");
    const hasRequiredTargets =
      draft.bodyTarget != null &&
      (draft.mode === "offsetAllFaces" || draft.faceTargets.length > 0);
    return hasRequiredTargets &&
      draft.bodyTarget &&
      hasBooleanTargetScope(operation, draft.booleanScope)
      ? {
          kind: "shell",
          featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
          parameters: {
            ...(draft.mode === "offsetAllFaces"
              ? { mode: "offsetAllFaces" as const, faceTargets: [] as const }
              : { faceTargets: draft.faceTargets }),
            bodyTarget: draft.bodyTarget,
            thickness: authoredDefinitionValue(draft.thickness, 1),
            direction: draft.direction,
            operation: authoredDefinitionValue(draft.operation, operation),
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
              kind: "enum",
              id: "shell-mode",
              label: "Mode",
              value: session.draft.mode,
              options: [
                { value: "openFaces", label: "Open faces" },
                { value: "offsetAllFaces", label: "Offset all faces" },
              ],
              patch: { patchKey: "mode" },
            },
            {
              kind: "referencePicker",
              id: "shell-body",
              label: "Source body",
              value: session.draft.bodyTarget,
              emptyLabel: "None selected",
              helper: "Shell requires one explicit source body.",
              error: session.draft.bodyTarget
                ? null
                : { message: "Select a source body." },
              advancedParticipant: {
                role: "body",
                required: true,
                cardinality: { min: 1, max: 1 },
                selectedCount: session.draft.bodyTarget ? 1 : 0,
              },
              picker: {
                mode: "replace",
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(
                  shellSelectionFilter,
                  "shell-body",
                  "Shell body",
                ),
              },
              patch: { patchKey: "bodyTarget" },
            },
            {
              kind: "referenceCollection",
              id: "shell-faces",
              label: "Removable faces",
              value: session.draft.faceTargets,
              emptyLabel: "None selected",
              helper:
                session.draft.mode === "offsetAllFaces"
                  ? "Offset-all shell does not use removable faces."
                  : "The draft preserves each removable face explicitly.",
              hidden: session.draft.mode === "offsetAllFaces",
              error:
                session.draft.mode === "offsetAllFaces" ||
                session.draft.faceTargets.length > 0
                  ? null
                  : { message: "Select at least one removable face." },
              advancedParticipant: {
                role: "face",
                required: session.draft.mode === "openFaces",
                cardinality: {
                  min: session.draft.mode === "openFaces" ? 1 : 0,
                  max: session.draft.mode === "openFaces" ? null : 0,
                },
                selectedCount:
                  session.draft.mode === "openFaces"
                    ? session.draft.faceTargets.length
                    : 0,
              },
              picker: {
                mode: "appendUnique",
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(
                  shellSelectionFilter,
                  "shell-face",
                  "Shell faces",
                ),
                itemLabel: "Face",
              },
              patch: { patchKey: "faceTargets" },
            },
          ],
        },
        {
          id: "parameters",
          title: "Parameters",
          fields: [
            {
              kind: "numeric",
              id: "shell-thickness",
              label: "Thickness",
              value: authoredNumberFormValue(session.draft.thickness),
              input: "number",
              step: 0.1,
              directionToggle: {
                patch: { patchKey: "direction" },
                value: session.draft.direction,
                forwardValue: "inside",
                reverseValue: "outside",
                forwardLabel: "Inside",
                reverseLabel: "Outside",
              },
              authoredValue: expressionCapableAuthoredValue(
                session.draft.thickness,
                { kind: "positiveNumber" },
              ),
              error: isPositiveAuthoredNumber(session.draft.thickness)
                ? null
                : { message: "Thickness must be greater than zero." },
              patch: { patchKey: "thickness" },
            },
            {
              kind: "enum",
              id: "shell-operation",
              label: "Operation",
              value: operation,
              options: [
                { value: "newBody", label: "newBody" },
                { value: "join", label: "join" },
                { value: "cut", label: "cut" },
                { value: "intersect", label: "intersect" },
              ],
              authoredValue: expressionCapableAuthoredValue(
                session.draft.operation,
                {
                  kind: "enumString",
                  options: ["newBody", "join", "cut", "intersect"],
                },
              ),
              patch: { patchKey: "operation" },
            },
            {
              kind: "referenceCollection",
              id: "shell-target-bodies",
              label: "Boolean target bodies",
              value: booleanTargetBodies,
              emptyLabel: "None selected",
              helper:
                "Join, cut, and intersect require at least one explicit target body.",
              hidden: operation === "newBody",
              error:
                operation === "newBody" || booleanTargetBodies.length > 0
                  ? null
                  : { message: "Select at least one target body." },
              advancedParticipant: {
                role: "targetBody",
                required: operation !== "newBody",
                cardinality: {
                  min: operation === "newBody" ? 0 : 1,
                  max: null,
                },
                selectedCount: booleanTargetBodies.length,
              },
              picker: {
                mode: "appendUnique",
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(
                  shellSelectionFilter,
                  "shell-boolean-target",
                  "Shell target body",
                ),
                itemLabel: "Target body",
              },
              patch: { patchKey: "booleanTargetBodyIds" },
            },
          ],
        },
        {
          id: "diagnostics",
          title: "Diagnostics",
          fields: [
            {
              kind: "diagnostics",
              id: "shell-diagnostics",
              label: "Diagnostics",
              diagnostics: session.diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"shell">;
