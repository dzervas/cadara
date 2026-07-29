import typia from "typia";

import type {
  ImportDeferredTopologyRef,
  ImportDeferredFeatureBooleanScope,
  ImportDeferredValue,
  ImportPreparedActions,
  ImportPreparedActionRef,
} from "@/contracts/import/actions";
import {
  validateImportBindingInvariants,
  validateImportDiagnosticInvariants,
} from "@/contracts/import/base-validation";
import {
  ContractValidationError,
  validateContract,
  type ContractValidationIssue,
  type ContractValidationResult,
} from "@/contracts/shared/validation";
export {
  requireImportBinding,
  requireImportDiagnostic,
  requireImportSource,
  requireResolvedImportSource,
  validateImportBinding,
  validateImportDiagnostic,
  validateImportSource,
  validateResolvedImportSource,
} from "@/contracts/import/base-validation";

const importPreparedActionsValidator =
  typia.createValidateEquals<ImportPreparedActions>();

function getActionAtOrderedPosition(
  actions: ImportPreparedActions,
  actionIndex: number,
): ImportPreparedActionRef | null {
  return actions.orderedActions?.[actionIndex] ?? null;
}

function isDeferredValue(value: unknown): value is ImportDeferredValue {
  if (!value || typeof value !== "object") {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "sketchIdOf" ||
    kind === "regionOf" ||
    kind === "bodyOf" ||
    kind === "constructionOf" ||
    kind === "featureOf"
  );
}

function isDeferredTopologyRef(value: unknown): value is ImportDeferredTopologyRef {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { kind?: unknown }).kind === "topologyOf",
  );
}

function collectTopologySlots(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
) {
  if (!value || typeof value !== "object") return;
  if ((value as { kind?: unknown }).kind === "topologySlot") {
    issues.push({
      path,
      expected: "prepared import reference",
      value,
      message: "Internal topologySlot references must be resolved before preparing import actions.",
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectTopologySlots(entry, `${path}.${index}`, issues),
    );
    return;
  }
  Object.entries(value).forEach(([key, entry]) =>
    collectTopologySlots(entry, path ? `${path}.${key}` : key, issues),
  );
}

function expectedProducerKind(
  value: ImportDeferredValue,
): ImportPreparedActionRef["kind"] {
  switch (value.kind) {
    case "sketchIdOf":
    case "regionOf":
      return "commitSketch";
    case "bodyOf":
    case "constructionOf":
    case "featureOf":
      return "createFeature";
  }
}

function validateDeferredReference(
  actions: ImportPreparedActions,
  value: ImportDeferredValue,
  consumerPosition: number,
  path: string,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  if (!Number.isInteger(value.actionIndex)) {
    return [
      {
        path: `${path}.actionIndex`,
        expected: "integer ordered action index",
        value: value.actionIndex,
        message: `Deferred ${value.kind} reference must use an integer actionIndex.`,
      },
    ];
  }

  if (value.actionIndex < 0 || value.actionIndex >= (actions.orderedActions?.length ?? 0)) {
    issues.push({
      path: `${path}.actionIndex`,
      expected: `ordered action index in [0, ${actions.orderedActions?.length ?? 0})`,
      value: value.actionIndex,
      message: `Deferred ${value.kind} reference points outside the ordered action sequence at index ${value.actionIndex}.`,
    });
    return issues;
  }

  if (value.actionIndex >= consumerPosition) {
    issues.push({
      path: `${path}.actionIndex`,
      expected: `backward reference before ordered position ${consumerPosition}`,
      value: value.actionIndex,
      message: `Deferred ${value.kind} reference must point backward from consuming action ${consumerPosition}.`,
    });
  }

  const producer = getActionAtOrderedPosition(actions, value.actionIndex);
  const expectedKind = expectedProducerKind(value);
  if (producer?.kind !== expectedKind) {
    issues.push({
      path: `${path}.actionIndex`,
      expected: `${expectedKind} producer`,
      value: producer?.kind ?? null,
      message: `Deferred ${value.kind} reference at ${path} must point to an earlier ${expectedKind} action.`,
    });
  }

  return issues;
}

function collectUnblessedDeferredValues(
  value: unknown,
  path: string,
  blessed: ReadonlySet<unknown>,
  issues: ContractValidationIssue[],
) {
  if (isDeferredValue(value)) {
    if (!blessed.has(value)) {
      issues.push({
        path,
        expected: "deferred value only at import contract blessed positions",
        value,
        message: `Deferred ${value.kind} reference is not allowed at ${path}.`,
      });
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectUnblessedDeferredValues(entry, `${path}.${index}`, blessed, issues),
    );
    return;
  }

  Object.entries(value).forEach(([key, entry]) =>
    collectUnblessedDeferredValues(entry, path ? `${path}.${key}` : key, blessed, issues),
  );
}

function validateDeferredExtrudeEndTarget(input: {
  actions: ImportPreparedActions;
  end: unknown;
  orderedPosition: number;
  path: string;
  issues: ContractValidationIssue[];
  blessed: Set<unknown>;
}) {
  if (!input.end || typeof input.end !== "object") return;
  const end = input.end as { kind?: unknown; target?: unknown };
  const expectedKind =
    end.kind === "upToFace"
      ? "face"
      : end.kind === "upToPart"
        ? "body"
        : end.kind === "upToVertex"
          ? "vertex"
          : null;
  if (!expectedKind) return;

  // An up-to-vertex extent may instead terminate at an exact authored sketch
  // point committed earlier in this import. That reference is durable, not a
  // live-topology rematch, so it is validated as a deferred sketch id.
  if (
    end.kind === "upToVertex" &&
    typeof end.target === "object" &&
    end.target !== null &&
    (end.target as { kind?: unknown }).kind === "sketchPoint"
  ) {
    const sketchId = (end.target as { sketchId?: unknown }).sketchId;
    if (!isDeferredValue(sketchId)) return;
    input.blessed.add(sketchId);
    const sketchPath = `${input.path}.target.sketchId`;
    if (sketchId.kind !== "sketchIdOf") {
      input.issues.push({
        path: sketchPath,
        expected: "sketchIdOf deferred reference",
        value: sketchId.kind,
        message:
          "An up-to-vertex sketch-point target may defer only through sketchIdOf.",
      });
      return;
    }
    input.issues.push(
      ...validateDeferredReference(
        input.actions,
        sketchId,
        input.orderedPosition,
        sketchPath,
      ),
    );
    return;
  }

  if (!isDeferredTopologyRef(end.target)) return;

  if (end.target.expectedKind !== expectedKind) {
    input.issues.push({
      path: `${input.path}.target.expectedKind`,
      expected: expectedKind,
      value: end.target.expectedKind,
      message: `${String(end.kind)} topologyOf target must resolve a ${expectedKind}.`,
    });
  }
  const hasEarlierProducer =
    input.actions.orderedActions
      ?.slice(0, input.orderedPosition)
      .some((entry) => entry.kind === "createFeature") ?? false;
  if (!hasEarlierProducer) {
    input.issues.push({
      path: `${input.path}.target`,
      expected: "an earlier createFeature producer action",
      value: input.orderedPosition,
      message: `${String(end.kind)} topologyOf target must follow its topology producer.`,
    });
  }
}

function validateImportDeferredValueInvariants(
  actions: ImportPreparedActions,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  const blessed = new Set<unknown>();

  actions.orderedActions?.forEach((ref, orderedPosition) => {
    if (ref.kind !== "createFeature") {
      return;
    }
    const request = actions.createFeatures?.[ref.index];
    if (!request?.definition) {
      return;
    }
    if (request.definition.kind === "featureReplay") {
      request.definition.parameters.sourceFeatureIds.forEach((sourceFeatureId, sourceIndex) => {
        if (!isDeferredValue(sourceFeatureId)) return;
        const sourcePath = `createFeatures.${ref.index}.definition.parameters.sourceFeatureIds.${sourceIndex}`;
        blessed.add(sourceFeatureId);
        if (sourceFeatureId.kind !== "featureOf") {
          issues.push({
            path: sourcePath,
            expected: "featureOf deferred source feature reference",
            value: sourceFeatureId,
            message: "Feature replay source feature ids may defer only through featureOf.",
          });
          return;
        }
        issues.push(
          ...validateDeferredReference(
            actions,
            sourceFeatureId,
            orderedPosition,
            sourcePath,
          ),
        );
      });
      return;
    }
    if (request.definition.kind === "bakedBody") {
      const replacement = request.definition.parameters.replacement;
      replacement.actionIndexes.forEach((actionIndex, replacementIndex) => {
        const producer = actions.orderedActions?.[actionIndex];
        if (
          !Number.isInteger(actionIndex) ||
          actionIndex < 0 ||
          actionIndex >= orderedPosition ||
          producer?.kind !== "createFeature"
        ) {
          issues.push({
            path: `createFeatures.${ref.index}.definition.parameters.replacement.actionIndexes.${replacementIndex}`,
            expected: "a prior createFeature ordered action position",
            value: actionIndex,
            message:
              "Baked checkpoint replacement scope must name only prior imported feature outputs.",
          });
        }
      });
      return;
    }
    if (
      request.definition.kind !== "extrude" &&
      request.definition.kind !== "revolve"
    ) {
      const parameters = request.definition.parameters as {
        participants?: readonly {
          targets: readonly unknown[];
        }[];
      };
      parameters.participants?.forEach((participant, participantIndex) => {
        participant.targets.forEach((target, targetIndex) => {
          const targetPath = `createFeatures.${ref.index}.definition.parameters.participants.${participantIndex}.targets.${targetIndex}`;
          if (isDeferredValue(target)) {
            blessed.add(target);
            if (target.kind !== "regionOf" && target.kind !== "constructionOf") {
              issues.push({
                path: targetPath,
                expected: "regionOf or constructionOf deferred reference",
                value: target.kind,
                message:
                  "Only regionOf and constructionOf deferred references are allowed as direct advanced participant targets.",
              });
            } else {
              issues.push(
                ...validateDeferredReference(
                  actions,
                  target,
                  orderedPosition,
                  targetPath,
                ),
              );
            }
            return;
          }
          if (
            !target ||
            typeof target !== "object" ||
            ((target as { kind?: unknown }).kind !== "sketchEntity" &&
              (target as { kind?: unknown }).kind !== "sketchPoint")
          ) {
            return;
          }
          const sketchId = (target as { sketchId?: unknown }).sketchId;
          if (!isDeferredValue(sketchId)) return;
          blessed.add(sketchId);
          const path = `${targetPath}.sketchId`;
          if (sketchId.kind !== "sketchIdOf") {
            issues.push({
              path,
              expected: "sketchIdOf deferred reference",
              value: sketchId.kind,
              message:
                "Only sketchIdOf deferred references are allowed in advanced sketch target positions.",
            });
          } else {
            issues.push(
              ...validateDeferredReference(
                actions,
                sketchId,
                orderedPosition,
                path,
              ),
            );
          }
        });
      });
      return;
    }

    request.definition.parameters.profiles.forEach((profile, profileIndex) => {
      const profilePath = `createFeatures.${ref.index}.definition.parameters.profiles.${profileIndex}`;
      if (isDeferredValue(profile)) {
        blessed.add(profile);
        issues.push(
          ...validateDeferredReference(
            actions,
            profile,
            orderedPosition,
            profilePath,
          ),
        );
      }
      if (isDeferredTopologyRef(profile)) {
        if (profile.expectedKind !== "face") {
          issues.push({
            path: `${profilePath}.expectedKind`,
            expected: "face",
            value: profile.expectedKind,
            message: "A topologyOf profile selector must resolve a planar face.",
          });
        }
        const hasEarlierProducer =
          actions.orderedActions
            ?.slice(0, orderedPosition)
            .some((entry) => entry.kind === "createFeature") ?? false;
        if (!hasEarlierProducer) {
          issues.push({
            path: profilePath,
            expected: "an earlier createFeature producer action",
            value: orderedPosition,
            message: "A topologyOf profile selector must follow its face producer.",
          });
        }
      }
      // An open sketch-curve profile is an exact authored entity reference whose
      // owning sketch is committed earlier in this import, so only its sketch id
      // defers, exactly like the revolve axis.
      if (
        profile &&
        typeof profile === "object" &&
        (profile as { kind?: unknown }).kind === "sketchEntity"
      ) {
        const sketchId = (profile as { sketchId?: unknown }).sketchId;
        if (isDeferredValue(sketchId)) {
          blessed.add(sketchId);
          const sketchPath = `${profilePath}.sketchId`;
          if (sketchId.kind === "sketchIdOf") {
            issues.push(
              ...validateDeferredReference(actions, sketchId, orderedPosition, sketchPath),
            );
          } else {
            issues.push({
              path: sketchPath,
              expected: "sketchIdOf deferred reference",
              value: sketchId.kind,
              message:
                "An open sketch-curve profile may defer only through sketchIdOf.",
            });
          }
        }
      }
    });

    if (request.definition.kind === "extrude") {
      const extent = request.definition.parameters.extent;
      if (extent.mode === "oneSide" || extent.mode === "symmetric") {
        validateDeferredExtrudeEndTarget({
          actions,
          end: extent.end,
          orderedPosition,
          path: `createFeatures.${ref.index}.definition.parameters.extent.end`,
          issues,
          blessed,
        });
      } else {
        validateDeferredExtrudeEndTarget({
          actions,
          end: extent.firstEnd,
          orderedPosition,
          path: `createFeatures.${ref.index}.definition.parameters.extent.firstEnd`,
          issues,
          blessed,
        });
        validateDeferredExtrudeEndTarget({
          actions,
          end: extent.secondEnd,
          orderedPosition,
          path: `createFeatures.${ref.index}.definition.parameters.extent.secondEnd`,
          issues,
          blessed,
        });
      }
    }

    if (
      request.definition.kind === "extrude" &&
      request.definition.parameters.startExtent.kind === "sketchPointOffset"
    ) {
      // A sketch-point start offset defers only through `sketchIdOf`, exactly
      // like the up-to-vertex sketch-point terminator: it is an exact authored
      // reference committed earlier in this import, not a topology rematch.
      const sketchId = request.definition.parameters.startExtent.target.sketchId;
      const startPath = `createFeatures.${ref.index}.definition.parameters.startExtent.target.sketchId`;
      if (isDeferredValue(sketchId)) {
        blessed.add(sketchId);
        if (sketchId.kind === "sketchIdOf") {
          issues.push(
            ...validateDeferredReference(actions, sketchId, orderedPosition, startPath),
          );
        } else {
          issues.push({
            path: startPath,
            expected: "sketchIdOf deferred reference",
            value: sketchId.kind,
            message:
              "An extrude sketch-point start offset may defer only through sketchIdOf.",
          });
        }
      }
    }
    if (
      request.definition.kind === "extrude" &&
      request.definition.parameters.startExtent.kind === "entityOffset"
    ) {
      // An entity start offset names live topology, so it rematches at apply
      // exactly like an up-to terminator: the selector must want an edge or a
      // face and must follow the action that produces it.
      const target: unknown = request.definition.parameters.startExtent.target;
      const startPath = `createFeatures.${ref.index}.definition.parameters.startExtent.target`;
      if (isDeferredTopologyRef(target)) {
        if (target.expectedKind !== "edge" && target.expectedKind !== "face") {
          issues.push({
            path: `${startPath}.expectedKind`,
            expected: "edge or face",
            value: target.expectedKind,
            message:
              "An extrude entity start offset topologyOf selector must resolve an edge or a face.",
          });
        }
        const hasEarlierProducer =
          actions.orderedActions
            ?.slice(0, orderedPosition)
            .some((entry) => entry.kind === "createFeature") ?? false;
        if (!hasEarlierProducer) {
          issues.push({
            path: startPath,
            expected: "an earlier createFeature producer action",
            value: orderedPosition,
            message:
              "An extrude entity start offset must follow its topology producer.",
          });
        }
      }
    }
    if (request.definition.kind === "revolve") {
      const axis = request.definition.parameters.axis;
      if (axis.kind === "sketchEntity" && isDeferredValue(axis.sketchId)) {
        blessed.add(axis.sketchId);
        issues.push(
          ...validateDeferredReference(
            actions,
            axis.sketchId,
            orderedPosition,
            `createFeatures.${ref.index}.definition.parameters.axis.sketchId`,
          ),
        );
      }
    }

    // A surface extrude carries no boolean state at all, so there is no scope to
    // validate; the structural union already rejects boolean fields there.
    const parameters = request.definition.parameters;
    const scope: ImportDeferredFeatureBooleanScope =
      "booleanScope" in parameters ? parameters.booleanScope : { kind: "standalone" };
    if (scope.kind === "targetBody" && isDeferredValue(scope.bodyId)) {
      blessed.add(scope.bodyId);
      issues.push(
        ...validateDeferredReference(
          actions,
          scope.bodyId,
          orderedPosition,
          `createFeatures.${ref.index}.definition.parameters.booleanScope.bodyId`,
        ),
      );
    }
    if (
      scope.kind === "targetBody" &&
      isDeferredTopologyRef(scope.bodyId) &&
      scope.bodyId.expectedKind !== "body"
    ) {
      issues.push({
        path: `createFeatures.${ref.index}.definition.parameters.booleanScope.bodyId.expectedKind`,
        expected: "body",
        value: scope.bodyId.expectedKind,
        message: "Boolean target topologyOf selectors must resolve a body.",
      });
    }
    if (scope.kind === "targetBodies") {
      scope.bodyIds.forEach((bodyId, bodyIndex) => {
        if (isDeferredTopologyRef(bodyId) && bodyId.expectedKind !== "body") {
          issues.push({
            path: `createFeatures.${ref.index}.definition.parameters.booleanScope.bodyIds.${bodyIndex}.expectedKind`,
            expected: "body",
            value: bodyId.expectedKind,
            message: "Boolean target topologyOf selectors must resolve bodies.",
          });
        }
      });
    }
  });

  actions.orderedActions?.forEach((ref, orderedPosition) => {
    if (ref.kind !== "commitSketch") {
      return;
    }
    const request = actions.commitSketches?.[ref.index];
    const support = request?.plane?.support;
    if (!support) {
      return;
    }
    const path = `commitSketches.${ref.index}.plane.support`;
    // A `topologyOf` support rematches a probed face against live topology, so
    // it must resolve a face produced by an earlier imported feature action.
    if (isDeferredTopologyRef(support)) {
      if (support.expectedKind !== "face") {
        issues.push({
          path: `${path}.expectedKind`,
          expected: "face",
          value: support.expectedKind,
          message: "Sketch-plane topologyOf supports must resolve a face.",
        });
      }
      const hasEarlierProducer =
        actions.orderedActions
          ?.slice(0, orderedPosition)
          .some((entry) => entry.kind === "createFeature") ?? false;
      if (!hasEarlierProducer) {
        issues.push({
          path,
          expected: "an earlier createFeature producer action",
          value: orderedPosition,
          message:
            "A topologyOf sketch-plane support must follow the feature action that produces its face.",
        });
      }
      return;
    }
    if (!isDeferredValue(support)) {
      return;
    }
    // The contract only permits `constructionOf` at sketch-plane support
    // positions (Typia enforces the structural union); here we enforce the
    // ordered backward-reference-to-a-createFeature invariant.
    blessed.add(support);
    issues.push(
      ...validateDeferredReference(actions, support, orderedPosition, path),
    );
  });

  collectUnblessedDeferredValues(actions, "", blessed, issues);
  collectTopologySlots(actions, "", issues);

  if (blessed.size > 0 && !actions.orderedActions) {
    issues.push({
      path: "orderedActions",
      expected: "ordered action sequence for deferred references",
      value: null,
      message: "Deferred import references require orderedActions so actionIndex is unambiguous.",
    });
  }

  return issues;
}
export function validateImportOrderedActionsInvariants(
  actions: ImportPreparedActions,
): ContractValidationIssue[] {
  const orderedActions = actions.orderedActions;
  if (!orderedActions) {
    return [];
  }

  const arrayLengths: Record<string, number> = {
    createFeature: actions.createFeatures?.length ?? 0,
    commitSketch: actions.commitSketches?.length ?? 0,
    addDocumentVariable: actions.addDocumentVariables?.length ?? 0,
  };
  const totalActions =
    arrayLengths.createFeature +
    arrayLengths.commitSketch +
    arrayLengths.addDocumentVariable;

  const issues: ContractValidationIssue[] = [];
  const seen = new Set<string>();

  orderedActions.forEach((ref, position) => {
    const path = `orderedActions.${position}`;
    const length = arrayLengths[ref.kind] ?? 0;
    if (
      !Number.isInteger(ref.index) ||
      ref.index < 0 ||
      ref.index >= length
    ) {
      issues.push({
        path,
        expected: `${ref.kind} index in [0, ${length})`,
        value: ref.index,
        message: `Ordered action references out-of-range ${ref.kind} index ${ref.index}.`,
      });
      return;
    }

    const key = `${ref.kind}:${ref.index}`;
    if (seen.has(key)) {
      issues.push({
        path,
        expected: `unique ${ref.kind} reference`,
        value: ref.index,
        message: `Ordered action duplicates ${ref.kind} index ${ref.index}.`,
      });
      return;
    }
    seen.add(key);
  });

  if (seen.size !== totalActions) {
    issues.push({
      path: "orderedActions",
      expected: `permutation of ${totalActions} prepared actions`,
      value: seen.size,
      message: `Ordered action sequence must reference every prepared action exactly once (referenced ${seen.size} of ${totalActions}).`,
    });
  }

  return issues;
}

function validateImportPreparedActionsInvariants(
  actions: ImportPreparedActions,
): ContractValidationIssue[] {
  return [
    ...(actions.binding
      ? validateImportBindingInvariants(actions.binding, "binding")
      : []),
    ...(actions.diagnostics ?? []).flatMap((diagnostic, index) =>
      validateImportDiagnosticInvariants(
        diagnostic,
        `diagnostics.${index}`,
      ),
    ),
    ...validateImportOrderedActionsInvariants(actions),
    ...validateImportDeferredValueInvariants(actions),
  ];
}

export function validateImportPreparedActions(
  value: unknown,
): ContractValidationResult<ImportPreparedActions> {
  const result = validateContract(importPreparedActionsValidator, value);
  if (!result.success) {
    return result;
  }

  const issues = validateImportPreparedActionsInvariants(result.data);
  return issues.length === 0
    ? result
    : { success: false, data: result.data, issues };
}

export function requireImportPreparedActions(
  value: unknown,
): ImportPreparedActions {
  const result = validateImportPreparedActions(value);
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.issues[0];
  throw new ContractValidationError(
    firstIssue?.message ?? "Import prepared actions validation failed.",
    value,
    result.issues,
  );
}
