import type {
  SketchSessionState,
  SketchAnnotationDescriptor,
  SketchAnnotationProblem,
  SketchDimensionAnnotationDragHandle,
} from "./types";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import type {
  DimensionDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { resolveSketchDimensionValues } from "@/domain/modeling/sketch-dimension-expressions";
import type { SketchId } from "@/contracts/shared/ids";
import { SKETCH_NOT_SOLVED_YET } from "./session-live-solve";
import {
  getSketchConstraintDisplaySummary,
  getSketchConstraintDisplayForTarget,
} from "./annotation-display";
import {
  createSketchConstraintRef,
  createSketchDimensionRef,
  createSketchEntityRef,
} from "./session-definition";
import {
  getConstraintGlyphKind,
  createConstraintAnnotationAnchor,
  getConstraintAffectedGeometryRefs,
  getDimensionGlyphKind,
  createDimensionAnnotationAnchor,
  getDimensionAffectedGeometryRefs,
} from "./annotation-anchors";
import {
  describeConstraint,
  describeDimension,
  formatDimensionVisibleLabel,
} from "./annotation-labels";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import { getSketchMirrorLinkedGeometryRefs } from "./annotation-selection";
import { describeSketchSessionUnsatisfiedRequirements } from "./session-feedback";

function resolveDimensionEffectiveValues(
  session: SketchSessionState,
): Map<DimensionDefinition["dimensionId"], number> {
  const effectiveValues = new Map<DimensionDefinition["dimensionId"], number>();
  const resolved = resolveSketchDimensionValues({
    definition: session.definition,
    variables: session.documentVariables,
  });
  if (!resolved.ok) {
    return effectiveValues;
  }

  for (const dimension of resolved.definition.dimensions) {
    if (isReferenceDimension(dimension)) {
      continue;
    }
    const value =
      dimension.kind === "lineAngle"
        ? dimension.valueRadians
        : "value" in dimension
          ? dimension.value
          : undefined;
    if (value !== undefined) {
      effectiveValues.set(dimension.dimensionId, value);
    }
  }

  return effectiveValues;
}

export function getSketchAnnotationDescriptors(
  session: SketchSessionState,
): SketchAnnotationDescriptor[] {
  return buildSketchAnnotationDescriptors(session).descriptors;
}

export function buildSketchAnnotationDescriptors(session: SketchSessionState): {
  descriptors: SketchAnnotationDescriptor[];
  solvedSnapshot: SolvedSketchSnapshot;
} {
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const resolvedDimensionValues = resolveDimensionEffectiveValues(session);
  // T17o (T17g3 ADV-1, T14 T-16): the annotations read the session's live
  // solve, the one the display draws, never a second solve of their own
  // (it could disagree, e.g. over offset publications, and cost a full solve
  // per drag frame). Without a live solve nothing is judged yet.
  const solvedSnapshot =
    session.liveSolve?.solvedSnapshot ?? SKETCH_NOT_SOLVED_YET;
  const constraintDisplaySummary = getSketchConstraintDisplaySummary({
    sketchId,
    definition: session.definition,
    solvedSnapshot,
  });
  // T13d (D12): a reference dimension shows the solve's measured value.
  const measuredValues = new Map(
    solvedSnapshot.dimensionStatuses.map((entry) => [
      entry.dimensionId,
      entry.solvedValue,
    ]),
  );
  const dimensionDisplayValue = (dimension: DimensionDefinition) =>
    isReferenceDimension(dimension)
      ? (measuredValues.get(dimension.dimensionId) ?? null)
      : resolvedDimensionValues.get(dimension.dimensionId);
  const problemOf = createSketchAnnotationProblemResolver(
    session,
    solvedSnapshot,
  );

  const descriptors: SketchAnnotationDescriptor[] = [
    ...session.definition.constraints.map((constraint) => {
      const constraintDisplay = getSketchConstraintDisplayForTarget(
        createSketchConstraintRef(sketchId, constraint.constraintId),
        constraintDisplaySummary,
      );
      return {
        id: constraint.constraintId,
        target: createSketchConstraintRef(sketchId, constraint.constraintId),
        glyphKind: getConstraintGlyphKind(constraint),
        anchor: createConstraintAnnotationAnchor(session, constraint),
        affectedGeometryRefs: getConstraintAffectedGeometryRefs(
          sketchId,
          constraint,
        ),
        constraintDisplay,
        label: constraint.label,
        detail: describeConstraint(constraint),
        status: "constraint" as const,
        ...(constraintDisplay.isAffectedOverconstraint
          ? { problem: problemOf(constraint.constraintId) }
          : {}),
      };
    }),
    ...session.definition.dimensions.map((dimension) => {
      const constraintDisplay = getSketchConstraintDisplayForTarget(
        createSketchDimensionRef(sketchId, dimension.dimensionId),
        constraintDisplaySummary,
      );
      const annotation = {
        id: dimension.dimensionId,
        target: createSketchDimensionRef(sketchId, dimension.dimensionId),
        glyphKind: getDimensionGlyphKind(dimension),
        anchor: createDimensionAnnotationAnchor(
          session,
          session.definition,
          dimension,
        ),
        affectedGeometryRefs: getDimensionAffectedGeometryRefs(
          sketchId,
          dimension,
        ),
        constraintDisplay,
        label: dimension.label,
        detail: describeDimension(dimension, dimensionDisplayValue(dimension)),
        ...(constraintDisplay.isAffectedOverconstraint
          ? { problem: problemOf(dimension.dimensionId) }
          : {}),
      };

      // T14b (T-7): an arc's end binding ties the arc to its own end point.
      // It reads as a Coincident constraint, never as an always-visible
      // dimension chip (display only; the schema is unchanged). T14e (Q1):
      // it names its arc, for the viewport policy and the list grouping.
      if (
        dimension.kind === "arcStartPointCoincident" ||
        dimension.kind === "arcEndPointCoincident"
      ) {
        return {
          ...annotation,
          status: "constraint" as const,
          arcBinding: {
            arc: createSketchEntityRef(sketchId, dimension.entityId),
            arcLabel:
              session.definition.entities.find(
                (entity) => entity.entityId === dimension.entityId,
              )?.label ?? "Arc",
          },
        };
      }

      // T16f ([TECH] T16-14): both sides of a mirror highlight together.
      const affectedKeys = new Set(
        annotation.affectedGeometryRefs.map(getPrimitiveRefKey),
      );
      const linkedGeometryRefs = getSketchMirrorLinkedGeometryRefs(
        session,
        annotation.affectedGeometryRefs,
      ).filter((ref) => !affectedKeys.has(getPrimitiveRefKey(ref)));

      return {
        ...annotation,
        ...(linkedGeometryRefs.length > 0 ? { linkedGeometryRefs } : {}),
        status: "dimension" as const,
        visibleLabel: formatDimensionVisibleLabel(
          dimension,
          dimensionDisplayValue(dimension),
        ),
        ...(isReferenceDimension(dimension)
          ? { reference: true as const }
          : {}),
        dragHandle: createDimensionAnnotationDragHandle(dimension),
      };
    }),
  ];
  return { descriptors, solvedSnapshot };
}

/**
 * T14e (T-17): why a problem annotation is one, from the descriptor solve's
 * requirement statuses and error diagnostics. A conflict carries the T13 D7
 * explanation of the session's live solve (the same text as the status box);
 * a blocked or erroring requirement its targeted diagnostic's message.
 */
function createSketchAnnotationProblemResolver(
  session: SketchSessionState,
  snapshot: SolvedSketchSnapshot,
) {
  const statuses = new Map<string, string>([
    ...snapshot.constraintStatuses.map(
      (entry) => [entry.constraintId as string, entry.status] as const,
    ),
    ...snapshot.dimensionStatuses.map(
      (entry) => [entry.dimensionId as string, entry.status] as const,
    ),
  ]);
  const diagnosticMessages = new Map<string, string>();
  for (const diagnostic of snapshot.diagnostics) {
    const id =
      diagnostic.target?.kind === "constraint"
        ? diagnostic.target.constraintId
        : diagnostic.target?.kind === "dimension"
          ? diagnostic.target.dimensionId
          : null;
    // Generic residual warnings keep the actionable multi-requirement conflict
    // explanation; operand admission errors carry their own precise refusal.
    if (
      id && diagnostic.severity !== "info" &&
      diagnostic.code !== "solver-requirement-unsatisfied" &&
      !diagnosticMessages.has(id)
    ) {
      diagnosticMessages.set(id, diagnostic.message);
    }
  }
  let conflictExplanation: string | null | undefined;

  return (id: string): SketchAnnotationProblem => {
    const status = statuses.get(id);
    if (status === "blocked") {
      return {
        status: "blocked",
        explanation: diagnosticMessages.get(id) ?? null,
      };
    }
    if (status === "unsatisfied" || status === "conflicting") {
      conflictExplanation ??=
        describeSketchSessionUnsatisfiedRequirements(session);
      return {
        status: "conflict",
        explanation: diagnosticMessages.get(id) ?? conflictExplanation,
      };
    }
    return { status: "error", explanation: diagnosticMessages.get(id) ?? null };
  };
}

/**
 * T14e (Q1/A-9): whether an annotation is drawn in the viewport at all. An
 * arc's own end binding is not, unless it is a problem: no hover, selection,
 * context or Show all draws it. Every other annotation is subject to the
 * contextual visibility rules.
 */
export function isSketchAnnotationDrawnInViewport(
  annotation: SketchAnnotationDescriptor,
) {
  return !annotation.arcBinding || annotation.problem !== undefined;
}

/** T14e: one row of the Constraints list. */
export interface SketchAnnotationListRow {
  annotation: SketchAnnotationDescriptor;
  /** The problem mark's status text (T-17); null when not a problem. */
  problemText: string | null;
  /** Q1/A-9: an arc's own end binding offers no one-click delete. */
  deletable: boolean;
  /** Q1/A-9: the arc a binding row is listed under. */
  group: { key: string; label: string } | null;
}

const SKETCH_ANNOTATION_PROBLEM_STATUS_TEXT = {
  conflict: "Conflict",
  blocked: "Blocked",
  error: "Error",
} as const;

/**
 * T14e (T-11/T-17, Q1/A-9): the Constraints list, the complete selectable
 * escape hatch: problems first (each with its status text), then every other
 * annotation in descriptor order, then each arc's end bindings together
 * under that arc (no delete). Stable: a pure function of the descriptors.
 */
export function getSketchAnnotationListRows(
  annotations: readonly SketchAnnotationDescriptor[],
): SketchAnnotationListRow[] {
  const rowOf = (
    annotation: SketchAnnotationDescriptor,
  ): SketchAnnotationListRow => ({
    annotation,
    problemText: annotation.problem
      ? `${SKETCH_ANNOTATION_PROBLEM_STATUS_TEXT[annotation.problem.status]}${
          annotation.problem.explanation
            ? `: ${annotation.problem.explanation}`
            : ""
        }`
      : null,
    deletable: !annotation.arcBinding,
    group: annotation.arcBinding
      ? {
          key: getPrimitiveRefKey(annotation.arcBinding.arc),
          label: annotation.arcBinding.arcLabel,
        }
      : null,
  });
  const problems = annotations.filter((annotation) => annotation.problem);
  const rest = annotations.filter((annotation) => !annotation.problem);
  const bindingsByArc = new Map<string, SketchAnnotationDescriptor[]>();
  for (const annotation of rest) {
    if (annotation.arcBinding) {
      const key = getPrimitiveRefKey(annotation.arcBinding.arc);
      bindingsByArc.set(key, [...(bindingsByArc.get(key) ?? []), annotation]);
    }
  }

  return [
    ...problems,
    ...rest.filter((annotation) => !annotation.arcBinding),
    ...[...bindingsByArc.values()].flat(),
  ].map(rowOf);
}

function createDimensionAnnotationDragHandle(
  dimension: DimensionDefinition,
): SketchDimensionAnnotationDragHandle | undefined {
  switch (dimension.kind) {
    case "distance":
    case "pointDatumDistance":
    case "horizontalDistance":
    case "verticalDistance":
    case "circleRadius":
    case "diameter":
    case "lineLength":
    case "lineDistance":
    case "linePointDistance":
    case "lineAngle":
      return {
        id: `${dimension.dimensionId}-annotation-drag`,
        dimensionId: dimension.dimensionId,
      };
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return undefined;
  }
}
