import type {
  ExtrudeProfileRef,
  ExtrudeSurfaceProfileRef,
  RevolveAxisRef,
} from "@/contracts/modeling/schema";
import type { FeatureResultBodyType } from "@/core/feature-authoring/definition";
import type {
  PrimitiveRef,
  SelectionFilter,
  SelectionSemantic,
} from "@/core/editor/schema";
import { primitiveRefEquals } from "@/core/editor/schema";

/** Refuse body-set inputs before hydration can drop roles, kinds or duplicates. */
export function hasExactBodyParticipants(
  parameters: import("@/contracts/modeling/advanced-solid").AdvancedSolidFeatureParameters,
  roles: readonly string[],
  maximum = Infinity,
) {
  if (parameters.participants.length !== roles.length) return false;
  const bodies = new Set<string>();
  return roles.every(role => {
    const participants = parameters.participants.filter(p => p.role === role);
    if (participants.length !== 1) return false;
    const targets = participants[0]!.targets;
    return targets.length > 0 && targets.length <= maximum && targets.every(t => {
      if (t.kind !== "body" || bodies.has(t.bodyId)) return false;
      bodies.add(t.bodyId);
      return true;
    });
  });
}

/** Canonical body operations must not lose duplicate roles/refs to hydration. */
export function hasExactBodyOperationParticipants(
  parameters: import("@/contracts/modeling/advanced-solid").AdvancedSolidFeatureParameters,
  referenceRole: string,
  referenceKinds: readonly PrimitiveRef["kind"][],
  referenceRequired = true,
  allowTargetBody = false,
) {
  const seen = new Set<string>();
  let hasBody = false;
  let hasReference = false;
  for (const p of parameters.participants) {
    if (seen.has(p.role) || p.targets.length === 0) return false;
    seen.add(p.role);
    if (p.role === "body" || (allowTargetBody && p.role === "targetBody")) {
      if (p.targets.some(t => t.kind !== "body")) return false;
      if (p.targets.some((t, i) => p.targets.slice(0, i).some(other => primitiveRefEquals(t, other)))) return false;
      if (p.role === "body") hasBody = true;
    } else if (p.role === referenceRole) {
      if (p.targets.length !== 1 || !referenceKinds.includes(p.targets[0]!.kind)) return false;
      hasReference = true;
    } else return false;
  }
  return hasBody && (hasReference || !referenceRequired);
}

export {
  buildAdvancedSolidParticipants,
  isAdvancedOperationIntent,
  toFeaturePhaseDiagnostics,
  validateAdvancedSolidDraft,
} from "@/core/feature-authoring/features/advanced-solid-helpers";
export {
  acceptAuthoredPatch,
  authoredBooleanLiteral,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredNumberLiteral,
  authoredStringLiteral,
  expressionCapableAuthoredValue,
  isFiniteAuthoredNumber,
  isPositiveAuthoredNumber,
} from "@/core/feature-authoring/features/authored-value-helpers";
export {
  createAdvancedOperationIntentFields,
  createBooleanOperationFields,
  createReferenceCollectionField,
  createResultBodyTypeField,
} from "@/core/feature-authoring/features/form-field-factories";

export function asExtrudeProfileRef(
  value: PrimitiveRef | null,
): ExtrudeProfileRef | null {
  if (!value) {
    return null;
  }

  switch (value.kind) {
    case "region":
    case "face":
      return value;
    default:
      return null;
  }
}

/**
 * Coerces a selection target into a profile seed for the active result body
 * type. Open sketch curves are accepted only while surface mode is active.
 */
export function asResultBodyTypeProfileRef(
  value: PrimitiveRef | null,
  resultBodyType: FeatureResultBodyType,
): ExtrudeSurfaceProfileRef | null {
  return resultBodyType === "surface" && value?.kind === "sketchEntity"
    ? value
    : asExtrudeProfileRef(value);
}

export function asRevolveAxisRef(
  value: PrimitiveRef | null,
): RevolveAxisRef | null {
  if (!value) {
    return null;
  }

  switch (value.kind) {
    case "edge":
    case "construction":
      return value;
    default:
      return null;
  }
}

export function asBodyRef(
  value: PrimitiveRef | null,
): Extract<PrimitiveRef, { kind: "body" }> | null {
  return value?.kind === "body" ? value : null;
}

export function asFaceRef(
  value: PrimitiveRef | null,
): Extract<PrimitiveRef, { kind: "face" }> | null {
  return value?.kind === "face" ? value : null;
}

export function asEdgeRef(
  value: PrimitiveRef | null,
): Extract<PrimitiveRef, { kind: "edge" }> | null {
  return value?.kind === "edge" ? value : null;
}

export function asSketchPointRef(
  value: PrimitiveRef | null,
): Extract<PrimitiveRef, { kind: "sketchPoint" }> | null {
  return value?.kind === "sketchPoint" ? value : null;
}

export function asUpToTargetRef(
  value: PrimitiveRef | null,
): Extract<PrimitiveRef, { kind: "face" | "body" | "vertex" }> | null {
  return value?.kind === "face" ||
    value?.kind === "body" ||
    value?.kind === "vertex"
    ? value
    : null;
}

export function createSingleTargetSelectionFilter(
  baseFilter: SelectionFilter,
  input: {
    id: string;
    label: string;
    targetKind: "face" | "body" | "vertex";
  },
): SelectionFilter {
  const acceptedSemantics: Record<
    "face" | "body" | "vertex",
    readonly SelectionSemantic[]
  > = {
    face: ["face"],
    body: ["body"],
    vertex: ["vertex"],
  };

  return {
    ...baseFilter,
    allowedKinds: [input.targetKind],
    label: input.label,
    requirements: [
      {
        id: input.id,
        label: input.label,
        description: `Select one ${input.targetKind} target.`,
        slots: [
          {
            id: input.id,
            label: input.label,
            description: `Select one ${input.targetKind} target.`,
            acceptedKinds: [input.targetKind],
            acceptedSemantics: acceptedSemantics[input.targetKind],
          },
        ],
      },
    ],
  };
}

export function asSweepPathRef(
  value: PrimitiveRef | null,
): Extract<PrimitiveRef, { kind: "edge" | "sketchEntity" }> | null {
  return value?.kind === "edge" || value?.kind === "sketchEntity"
    ? value
    : null;
}

export function asPlaneReferenceTarget(
  value: PrimitiveRef | null,
): Extract<PrimitiveRef, { kind: "construction" | "face" }> | null {
  return value?.kind === "construction" || value?.kind === "face"
    ? value
    : null;
}

export function filterTargets<TTarget extends PrimitiveRef>(
  value: unknown,
  coerce: (target: PrimitiveRef | null) => TTarget | null,
) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is TTarget => coerce(entry as PrimitiveRef) !== null,
      )
    : [];
}

export function appendUniqueTarget<TTarget extends PrimitiveRef>(
  current: readonly TTarget[],
  target: TTarget,
) {
  return current.some((entry) => primitiveRefEquals(entry, target))
    ? current
    : [...current, target];
}

export function createMissingInputDiagnostic(input: {
  feature: string;
  phase: "preview" | "commit";
  suffix: string;
  message: string;
}) {
  return {
    code: `feature-${input.phase}-missing-${input.suffix}`,
    severity:
      input.phase === "preview" ? ("warning" as const) : ("error" as const),
    message: input.message
      .replace("preview", input.phase)
      .replace("Preview", input.phase === "commit" ? "Commit" : "Preview"),
    target: null,
    detail: null,
  };
}
