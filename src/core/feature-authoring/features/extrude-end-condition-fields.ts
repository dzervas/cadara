import type {
  ExtrudeEndCondition,
  LinearExtentDirection,
  UpToOffsetDirection,
} from "@/contracts/modeling/schema";
import type { MaybeAuthoredValue } from "@/contracts/modeling/authored-values";
import type { SelectionFilter } from "@/core/editor/schema";
import type { ExtrudeFeatureEndConditionDraft } from "@/core/feature-authoring/definition";
import * as shared from "@/core/feature-authoring/features/shared";
import type { FeatureEditorFormField } from "@/core/feature-authoring/form-schema";

/**
 * Extrude's end-condition draft patching and form fields. Extrude uses them for
 * each extent side; Hole uses them for its single end so both tools offer the
 * same end conditions with the same controls.
 */
export interface ExtrudeEndConditionFieldKeys {
  /** Prefix of every field id, e.g. `extrude` or `extrude-second`. */
  idPrefix: string;
  /** Prefix of every field label, e.g. `Second `. */
  labelPrefix: string;
  condition: string;
  direction: string;
  depth: string;
  draftAngle: string;
  target: string;
  offsetDistance: string;
  offsetDirection: string;
}

const EXTRUDE_END_CONDITION_KINDS = [
  "blind",
  "upToNext",
  "upToFace",
  "upToPart",
  "upToVertex",
  "throughAll",
] as const satisfies readonly ExtrudeEndCondition["kind"][];

function isExtrudeDirection(
  value: unknown,
): value is LinearExtentDirection {
  return value === "positive" || value === "negative";
}

export function isExtrudeEndConditionKind(
  value: unknown,
): value is ExtrudeEndCondition["kind"] {
  return EXTRUDE_END_CONDITION_KINDS.includes(
    value as ExtrudeEndCondition["kind"],
  );
}

function isOffsetDirection(value: unknown): value is UpToOffsetDirection {
  return value === "shorten" || value === "extend";
}

function coerceTargetForEnd(kind: ExtrudeEndCondition["kind"], value: unknown) {
  const target = shared.asUpToTargetRef(
    value as Parameters<typeof shared.asUpToTargetRef>[0],
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

/**
 * Apply a form patch to one end condition. `fallbackBlindDistance` is the
 * depth a non-blind end takes when it is switched to blind.
 */
export function patchExtrudeEndCondition(
  end: ExtrudeFeatureEndConditionDraft,
  patch: Record<string, unknown>,
  keys: ExtrudeEndConditionFieldKeys,
  fallbackBlindDistance: MaybeAuthoredValue<number> = 12,
): ExtrudeFeatureEndConditionDraft {
  const patchedKind = patch[keys.condition];
  const patchedDirection = patch[keys.direction];
  const patchedOffsetDirection = patch[keys.offsetDirection];
  const nextKind = isExtrudeEndConditionKind(patchedKind)
    ? patchedKind
    : end.kind;
  const direction = isExtrudeDirection(patchedDirection)
    ? patchedDirection
    : "direction" in end
      ? end.direction
      : "positive";
  const draftAngle = shared.acceptAuthoredPatch(
    patch[keys.draftAngle],
    "draftAngle" in end ? (end.draftAngle ?? 0) : 0,
    (value): value is number => typeof value === "number",
  );
  const offsetDistance = shared.acceptAuthoredPatch(
    patch[keys.offsetDistance],
    "offset" in end ? (end.offset?.distance ?? 0) : 0,
    (value): value is number => typeof value === "number",
  );
  const offsetDirection = isOffsetDirection(patchedOffsetDirection)
    ? patchedOffsetDirection
    : "offset" in end
      ? (end.offset?.direction ?? "shorten")
      : "shorten";
  const offset = shared.isFiniteAuthoredNumber(offsetDistance)
    ? { distance: offsetDistance, direction: offsetDirection }
    : undefined;

  if (nextKind === "blind") {
    return {
      kind: "blind",
      direction,
      distance: shared.acceptAuthoredPatch(
        patch[keys.depth],
        end.kind === "blind" ? end.distance : fallbackBlindDistance,
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
    coerceTargetForEnd(nextKind, patch[keys.target]) ??
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

export function extrudeEndHasRequiredTarget(
  end: ExtrudeFeatureEndConditionDraft,
) {
  if (end.kind === "upToFace") {
    return end.target.bodyId.length > 0 && end.target.faceId.length > 0;
  }
  if (end.kind === "upToPart") {
    return end.target.bodyId.length > 0;
  }
  if (end.kind === "upToVertex") {
    return end.target.kind === "sketchPoint"
      ? end.target.sketchId.length > 0 && end.target.pointId.length > 0
      : end.target.bodyId.length > 0 && end.target.vertexId.length > 0;
  }
  return true;
}

export function extrudeEndHasValidScalars(
  end: ExtrudeFeatureEndConditionDraft,
) {
  return (
    (end.kind !== "blind" || shared.isPositiveAuthoredNumber(end.distance)) &&
    (!("draftAngle" in end) ||
      end.draftAngle === undefined ||
      shared.isFiniteAuthoredNumber(end.draftAngle)) &&
    (!("offset" in end) ||
      end.offset === undefined ||
      shared.isFiniteAuthoredNumber(end.offset.distance))
  );
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

export function extrudeEndConditionFields(input: {
  end: ExtrudeFeatureEndConditionDraft;
  keys: ExtrudeEndConditionFieldKeys;
  includeDraftAngle: boolean;
  /** Base filter the up-to target picker narrows to one face, body or vertex. */
  selectionFilter: SelectionFilter;
}): FeatureEditorFormField[] {
  const { end, keys } = input;
  const { idPrefix, labelPrefix } = keys;
  const fields: FeatureEditorFormField[] = [
    {
      kind: "enum",
      id: `${idPrefix}-end-condition`,
      label: `${labelPrefix}End condition`,
      value: end.kind,
      options: EXTRUDE_END_CONDITION_KINDS.map((value) => ({
        value,
        label: endConditionLabel(value),
      })),
      patch: { patchKey: keys.condition },
    },
  ];

  if (end.kind === "blind") {
    fields.push({
      kind: "numeric",
      id: `${idPrefix}-depth`,
      label: `${labelPrefix}Depth`,
      value: shared.authoredNumberFormValue(end.distance),
      input: "number",
      step: 0.1,
      directionToggle: {
        patch: { patchKey: keys.direction },
        value: end.direction,
        forwardValue: "positive",
        reverseValue: "negative",
        forwardLabel: "Positive normal",
        reverseLabel: "Negative normal",
      },
      authoredValue: shared.expressionCapableAuthoredValue(end.distance, {
        kind: "positiveNumber",
      }),
      error: shared.isPositiveAuthoredNumber(end.distance)
        ? null
        : { message: "Depth must be greater than zero." },
      patch: { patchKey: keys.depth },
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
      patch: { patchKey: keys.direction },
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
      value: extrudeEndHasRequiredTarget(end) ? end.target : null,
      emptyLabel: "None selected",
      helper: `Accepted target: one ${targetKind}.`,
      error: extrudeEndHasRequiredTarget(end)
        ? null
        : { message: `Select one ${targetKind} target.` },
      picker: {
        mode: "replace",
        allowsMultiple: false,
        selectionFilter: shared.createSingleTargetSelectionFilter(
          input.selectionFilter,
          {
            id: `${idPrefix}-up-to-target`,
            label: `${labelPrefix}${endConditionLabel(end.kind)} target`,
            targetKind,
          },
        ),
      },
      patch: { patchKey: keys.target },
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
        value: shared.authoredNumberFormValue(end.offset?.distance ?? 0),
        input: "number",
        step: 0.1,
        authoredValue: shared.expressionCapableAuthoredValue(
          end.offset?.distance ?? 0,
          {
            kind: "finiteNumber",
          },
        ),
        error:
          end.offset?.distance === undefined ||
          shared.isFiniteAuthoredNumber(end.offset.distance)
            ? null
            : { message: "Offset must be finite." },
        patch: { patchKey: keys.offsetDistance },
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
        patch: { patchKey: keys.offsetDirection },
      },
    );
  }

  if (!input.includeDraftAngle) {
    return fields;
  }

  fields.push({
    kind: "numeric",
    id: `${idPrefix}-draft-angle`,
    label: `${labelPrefix}Draft angle (degrees)`,
    value: shared.authoredNumberFormValue(
      end.draftAngle ?? 0,
      (value) => value * (180 / Math.PI),
    ),
    input: "angleDegrees",
    step: 1,
    authoredValue: shared.expressionCapableAuthoredValue(end.draftAngle ?? 0, {
      kind: "angle",
    }),
    error:
      end.draftAngle === undefined ||
      shared.isFiniteAuthoredNumber(end.draftAngle)
        ? null
        : { message: "Draft angle must be finite." },
    patch: { patchKey: keys.draftAngle },
  });

  return fields;
}
