import typia from "typia";

import type {
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
  return kind === "sketchIdOf" || kind === "regionOf" || kind === "bodyOf";
}

function expectedProducerKind(
  value: ImportDeferredValue,
): ImportPreparedActionRef["kind"] {
  switch (value.kind) {
    case "sketchIdOf":
    case "regionOf":
      return "commitSketch";
    case "bodyOf":
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
    if (request.definition.kind !== "extrude") {
      return;
    }

    request.definition.parameters.profiles.forEach((profile, profileIndex) => {
      if (isDeferredValue(profile)) {
        blessed.add(profile);
        // ImportDeferredExtrudeProfileRef only permits regionOf at profile
        // positions; Typia enforces that structural union before invariants run.
        issues.push(
          ...validateDeferredReference(
            actions,
            profile,
            orderedPosition,
            `createFeatures.${ref.index}.definition.parameters.profiles.${profileIndex}`,
          ),
        );
      }
    });

    const scope = request.definition.parameters.booleanScope;
    if (
      scope.kind === "targetBody" &&
      isDeferredValue(scope.bodyId)
    ) {
      blessed.add(scope.bodyId);
      if (scope.bodyId.kind !== "bodyOf") {
        issues.push({
          path: `createFeatures.${ref.index}.definition.parameters.booleanScope.bodyId`,
          expected: "bodyOf deferred reference",
          value: scope.bodyId.kind,
          message: "Only bodyOf deferred references are allowed in boolean target body positions.",
        });
      } else {
        issues.push(
          ...validateDeferredReference(
            actions,
            scope.bodyId,
            orderedPosition,
            `createFeatures.${ref.index}.definition.parameters.booleanScope.bodyId`,
          ),
        );
      }
    }
  });

  collectUnblessedDeferredValues(actions, "", blessed, issues);

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
