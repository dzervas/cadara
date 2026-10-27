import type {
  SketchSessionState,
  SketchAnnotationEditTarget,
  SketchSharedDimensionEdit,
  SketchAnnotationEditState,
} from "./types";
import {
  getEditableAnnotationValue,
  buildAnnotationEditPresentation,
} from "./annotation-edit-presentation";
import {
  normalizeConstraintValue,
  getSessionSketchId,
  rebuildSessionCommitRequest,
} from "./tool-authoring";
import {
  isReferenceDimension,
  requireDrivingDimensionValue,
  isAcceptedConstraintStatus,
} from "@/contracts/sketch/schema";
import type {
  DimensionDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import {
  withSketchToolValidation,
  getSketchSessionDerivationSettings,
  createSketchDimensionRef,
} from "./session-definition";
import type { DimensionId, SketchEntityId } from "@/contracts/shared/ids";
import { applySolvedSketchToDefinition } from "./definition-patches";
import { resolveSketchDimensionValues } from "@/domain/modeling/sketch-dimension-expressions";
import type { AuthoredSketchDerivationSettings } from "@/domain/modeling/sketch-dimension-expressions";
import {
  probeSketchDimensionRedundancy,
  solveSketchDefinitionCore,
} from "@/core/sketch-solver";
import {
  getAuthoredLiteralValue,
  createLiteralAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { AuthoredValue } from "@/contracts/modeling/authored-values";
import { applySketchOffsetDistanceUpdate } from "./offset-actions";
import {
  getSketchSessionSharedMirrorDimensions,
  sharedMirrorDriverRefusal,
  getSketchSessionInvalidFeedback,
} from "./session-feedback";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import { getPointPosition } from "./annotation-reference-geometry";
import { buildSketchAnnotationDescriptors } from "./annotation-descriptors";
import {
  withLiveSolveBasis,
  hasAcceptedLiveSolveOfDefinition,
} from "./session-live-solve";
import type {
  ProjectedSketchReferenceRecord,
  SolverTolerancePolicy,
} from "@/contracts/solver/schema";

export function beginSketchAnnotationEdit(
  session: SketchSessionState,
  target: SketchAnnotationEditTarget,
  options: {
    /** T16f: a Dimension tool routed to this driver (re-armed afterwards). */
    shared?: SketchSharedDimensionEdit;
    /** T16f: why a commit was refused and this edit opened instead. */
    message?: string;
  } = {},
): SketchSessionState {
  const editable = getEditableAnnotationValue(session, target);

  if (!editable) {
    return {
      ...session,
      status: "idle",
      toolPresentation: null,
      activeAnnotationEdit: null,
      activeEditTarget: null,
      activeDrag: null,
      validationMessage: null,
      toolChain: null,
    };
  }

  const edit: SketchAnnotationEditState = {
    target,
    pendingValue: editable.value,
    ...(options.shared ? { shared: options.shared } : {}),
  };

  return {
    ...session,
    activeTool: null,
    status: "awaitingValue",
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: buildAnnotationEditPresentation(
      session,
      edit,
      options.message ?? null,
    ),
    constraintAuthoring: null,
    activeAnnotationEdit: edit,
    activeEditTarget: null,
    activeDrag: null,
  };
}

export function patchSketchAnnotationEditValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const edit = session.activeAnnotationEdit;

  if (!edit) {
    return session;
  }

  const intent = patch.intent;

  if (intent === "cancelAnnotationValue") {
    return clearSketchAnnotationEdit(session);
  }

  // T16f: "Add as reference instead" switches what the routed popup commits.
  if (
    intent === "setSharedDimensionReference" &&
    edit.shared?.referenceLabel != null
  ) {
    const nextEdit = {
      ...edit,
      shared: { ...edit.shared, addsReference: patch.reference === true },
    };
    return {
      ...session,
      activeAnnotationEdit: nextEdit,
      toolPresentation: buildAnnotationEditPresentation(session, nextEdit),
    };
  }

  if (
    intent === "makeAnnotationDriving" ||
    intent === "replaceAnnotationDrivers"
  ) {
    const conflicts = getDrivingConversionConflicts(session, edit);
    if (conflicts !== null) {
      if (intent !== "replaceAnnotationDrivers" || conflicts.length === 0) {
        return refuseDrivingConversion(session, edit, conflicts);
      }
      // Recompute at confirmation: never apply a stale list after another edit.
      const definition = {
        ...session.definition,
        dimensions: session.definition.dimensions.map((d) =>
          conflicts.includes(d.dimensionId)
            ? { ...d, reference: true as const }
            : d,
        ),
      };
      if (edit.pendingValue === null) return session;
      const replaced = commitSketchAnnotationEditValue(
        { ...session, definition },
        { ...edit, pendingValue: edit.pendingValue },
      );
      return replaced.activeAnnotationEdit || !replaced.liveSolve?.accepted
        ? refuseDrivingConversion(session, edit, conflicts)
        : replaced;
    }
    const nextEdit = {
      ...edit,
      driving: true as const,
      drivingConflicts: undefined,
    };
    return {
      ...session,
      activeAnnotationEdit: nextEdit,
      toolPresentation: buildAnnotationEditPresentation(session, nextEdit),
    };
  }

  if ("value" in patch) {
    if (
      edit.shared?.addsReference ||
      (getEditableAnnotationValue(session, edit.target)?.reference &&
        !edit.driving)
    ) {
      // The reference's measured value is read-only.
      return session;
    }
    const nextEdit = {
      ...edit,
      pendingValue: normalizeConstraintValue(
        patch.value as number | null | undefined,
      ),
    };

    return {
      ...session,
      activeAnnotationEdit: nextEdit,
      toolPresentation: buildAnnotationEditPresentation(session, nextEdit),
      // Typing clears this popup's refusal, not the session's region diagnostics.
    };
  }

  if (intent === "makeAnnotationReference") {
    if (
      edit.driving &&
      getEditableAnnotationValue(session, edit.target)?.reference
    ) {
      const nextEdit = {
        ...edit,
        driving: undefined,
        pendingValue: getEditableAnnotationValue(session, edit.target)!.value,
      };
      return {
        ...session,
        activeAnnotationEdit: nextEdit,
        toolPresentation: buildAnnotationEditPresentation(session, nextEdit),
      };
    }
    return makeSketchAnnotationReference(session, edit);
  }

  if (intent !== "commitAnnotationValue") {
    return session;
  }

  if (edit.pendingValue === null) {
    return {
      ...session,
      toolPresentation: buildAnnotationEditPresentation(
        session,
        edit,
        "Enter a value before saving.",
      ),
    };
  }

  return commitSketchAnnotationEditValue(session, {
    ...edit,
    pendingValue: edit.pendingValue,
  });
}

export function clearSketchAnnotationEdit(
  session: SketchSessionState,
): SketchSessionState {
  return {
    ...session,
    status: "idle",
    toolPresentation: null,
    activeAnnotationEdit: null,
    validationMessage: null,
  };
}

/** Completed Make reference intent shares the browser annotation mutation and solve owner. */
export function makeSketchAnnotationReference(
  session: SketchSessionState,
  edit: SketchAnnotationEditState,
): SketchSessionState {
  if (edit.target.kind === "offsetDistance") return session;
  const definition = makeReferenceDimensionInDefinition(session.definition, edit.target);
  const target = edit.target;
  const alreadyReference = target.kind === "dimension" && session.definition.dimensions.some(d => d.dimensionId === target.dimensionId && isReferenceDimension(d));
  // A satisfied no-op must not inherit another command's refusal feedback or create an authored action.
  if (alreadyReference) return { ...session, validationMessage: null };
  if (definition === session.definition) {
    return session.activeAnnotationEdit
      ? withSketchToolValidation(session, "This requirement cannot be a reference measurement.")
      : { ...session, validationMessage: "This requirement cannot be a reference measurement." };
  }
  return commitEditedAnnotationDefinition(session, edit, definition);
}

/**
 * O6: use the creation-time solver probe, not constraintState (a consistent
 * redundant driver can still be "satisfied"). Find a sufficient, irreducible
 * set of existing dimensions to release; unrelated drivers are reintroduced.
 * All trials are detached definitions: neither refusal nor preview authors edits.
 */
function getDrivingConversionConflicts(
  session: SketchSessionState,
  edit: SketchAnnotationEditState,
): readonly DimensionId[] | null {
  const target = edit.target;
  if (target.kind !== "dimension") return null;
  const candidate = session.definition.dimensions.find(
    (d) => d.dimensionId === target.dimensionId,
  );
  if (!candidate || !isReferenceDimension(candidate)) return null;
  const settings = getSketchSessionDerivationSettings(session);
  if (!session.liveSolve?.accepted) return [];
  const authoredBasis = applySolvedSketchToDefinition(
    session.definition,
    session.liveSolve.solvedSnapshot,
    settings,
  );
  const resolved = resolveSketchDimensionValues({
    definition: authoredBasis,
    variables: session.documentVariables,
  });
  if (!resolved.ok) return [];
  const basis = resolved.definition;
  const others = basis.dimensions.filter(
    (d) => d.dimensionId !== candidate.dimensionId,
  );
  const determined = (released: ReadonlySet<string>) => {
    const dimensions = others.filter((d) => !released.has(d.dimensionId));
    return (
      probeSketchDimensionRedundancy({
        definition: {
          ...basis,
          dimensions,
          dimensionIds: dimensions.map((d) => d.dimensionId),
        },
        candidate,
        projectedReferences: session.projectedReferences,
        tolerances: session.solverTolerances,
        ...settings,
      }).kind !== "independent"
    );
  };
  if (!determined(new Set())) return null;
  const released = new Set(
    others
      .filter(
        (d) =>
          !isReferenceDimension(d) &&
          d.kind !== "arcStartPointCoincident" &&
          d.kind !== "arcEndPointCoincident",
      )
      .map((d) => d.dimensionId),
  );
  if (determined(released)) return [];
  for (const id of [...released]) {
    released.delete(id);
    if (determined(released)) released.add(id);
  }
  return [...released];
}

function refuseDrivingConversion(
  session: SketchSessionState,
  edit: SketchAnnotationEditState,
  conflicts: readonly DimensionId[],
): SketchSessionState {
  const labels = conflicts.map(
    (id) =>
      session.definition.dimensions.find((d) => d.dimensionId === id)!.label,
  );
  const message = conflicts.length
    ? `Cannot make driving: conflicts with ${labels.join(", ")}. Make those dimensions references instead?`
    : "Cannot make driving: the sketch is invalid or this quantity is determined by other constraints. Change those requirements first.";
  const nextEdit = { ...edit, driving: undefined, drivingConflicts: conflicts };
  return {
    ...session,
    activeAnnotationEdit: nextEdit,
    ...(!session.activeAnnotationEdit ? { validationMessage: message } : {}),
    toolPresentation: buildAnnotationEditPresentation(
      session,
      nextEdit,
      message,
    ),
  };
}

/** Updates share browser annotation conversion, conflict retention and solve preparation. */
export function updateSketchDimensionValue(
  session: SketchSessionState,
  dimensionId: import("@/contracts/shared/ids").DimensionId,
  value: number | string,
): SketchSessionState {
  const pendingValue = normalizeConstraintValue(value);
  if (pendingValue === null) return session.activeAnnotationEdit
    ? withSketchToolValidation(session, "Enter a value before saving.")
    : { ...session, validationMessage: "Enter a value before saving." };
  return commitSketchAnnotationEditValue(session, {
    target: createSketchDimensionRef(getSessionSketchId(session), dimensionId),
    pendingValue,
  });
}

export function commitSketchAnnotationEditValue(
  session: SketchSessionState,
  edit: SketchAnnotationEditState & {
    pendingValue: AuthoredValue<number>;
  },
): SketchSessionState {
  const target = edit.target;
  if (target.kind === "offsetDistance") {
    return applySketchOffsetDistanceUpdate(
      clearSketchAnnotationEdit(session),
      target.derivationId,
      edit.pendingValue,
    );
  }
  const madeDriving =
    target.kind === "dimension"
      ? session.definition.dimensions.find(
          (dimension) =>
            dimension.dimensionId === target.dimensionId &&
            isReferenceDimension(dimension),
        )
      : undefined;
  if (madeDriving) {
    const conflicts = getDrivingConversionConflicts(session, edit);
    if (conflicts !== null)
      return refuseDrivingConversion(session, edit, conflicts);
  }
  // T16f ([TECH] T16-12/A-9): making a reference driving when a
  // corresponding driver exists would add a second driver of one mirrored
  // quantity: refused here, in the domain commit path, and that driver's
  // edit opens instead.
  const driver = madeDriving
    ? getSketchSessionSharedMirrorDimensions(session, madeDriving)[0]
    : undefined;
  if (driver) {
    return beginSketchAnnotationEdit(
      session,
      createSketchDimensionRef(
        getSessionSketchId(session),
        driver.dimension.dimensionId,
      ),
      { message: sharedMirrorDriverRefusal(driver) },
    );
  }
  // T13d review R-1: a reference shows (and prefills) magnitudes; making a
  // signed point-pair reference driving keeps the current geometry by
  // storing its points in the measured direction.
  const signedMeasured =
    madeDriving && getSignedPointPairAxis(madeDriving)
      ? getReferenceMeasuredValues(session).get(madeDriving.dimensionId)
      : undefined;
  return commitEditedAnnotationDefinition(
    session,
    edit,
    orientSignedPointPairDimension(
      updateAnnotationValueInDefinition(
        session.definition,
        target,
        edit.pendingValue,
      ),
      target,
      signedMeasured !== undefined &&
        signedMeasured !== null &&
        signedMeasured < 0
        ? -1
        : 1,
    ),
  );
}

/** The axis of a signed point-pair dimension (h/v `distance`, `horizontal/verticalDistance`). */
function getSignedPointPairAxis(
  dimension: DimensionDefinition,
): "horizontal" | "vertical" | null {
  switch (dimension.kind) {
    case "distance":
      return dimension.axis === "aligned" ? null : dimension.axis;
    case "horizontalDistance":
      return "horizontal";
    case "verticalDistance":
      return "vertical";
    default:
      return null;
  }
}

/**
 * T13d review R-1: `measuredSign` is the sign of the reference's measured
 * value in its stored point order (the popup shows magnitudes). The
 * committed signed value is `typed × measuredSign`; when it is negative the
 * two points are swapped (the dimension line offset re-based onto the new
 * first point, as the Dimension tool does) and the magnitude stored, so the
 * same geometry is driven with a positive value and nothing moves.
 */
function orientSignedPointPairDimension(
  definition: SketchDefinition,
  target: SketchConstraintRef | SketchDimensionRef,
  measuredSign: 1 | -1,
): SketchDefinition {
  if (target.kind !== "dimension") {
    return definition;
  }
  const dimensions = definition.dimensions.map(
    (dimension): DimensionDefinition => {
      if (
        dimension.dimensionId !== target.dimensionId ||
        isReferenceDimension(dimension) ||
        (dimension.kind !== "distance" &&
          dimension.kind !== "horizontalDistance" &&
          dimension.kind !== "verticalDistance")
      ) {
        return dimension;
      }
      const axis = getSignedPointPairAxis(dimension);
      const literal = getAuthoredLiteralValue(
        requireDrivingDimensionValue(dimension, dimension.value),
      );
      const signed = literal === null ? measuredSign : literal * measuredSign;
      if (!axis || signed >= 0) {
        return dimension;
      }
      const [firstId, secondId] = dimension.pointIds;
      const first = getPointPosition(definition, firstId);
      const second = getPointPosition(definition, secondId);
      const across = axis === "horizontal" ? 1 : 0;
      const placement = dimension.annotationPlacement;
      return {
        ...dimension,
        pointIds: [secondId, firstId],
        value:
          literal === null
            ? dimension.value
            : createLiteralAuthoredValue(Math.abs(literal)),
        ...(placement && first && second
          ? {
              annotationPlacement: {
                ...placement,
                offset: placement.offset + first[across] - second[across],
                // cadara-bmy0: the swapped ends reverse the line.
                ...(placement.labelPosition === undefined
                  ? {}
                  : { labelPosition: 1 - placement.labelPosition }),
              },
            }
          : {}),
      };
    },
  );
  return dimensions.some(
    (dimension, index) => dimension !== definition.dimensions[index],
  )
    ? { ...definition, dimensions }
    : definition;
}

/** The solve's (signed) measured value of each reference dimension. */
function getReferenceMeasuredValues(session: SketchSessionState) {
  return new Map(
    buildSketchAnnotationDescriptors(
      session,
    ).solvedSnapshot.dimensionStatuses.map((entry) => [
      entry.dimensionId,
      entry.solvedValue,
    ]),
  );
}

/**
 * Commits an annotation edit (a value, or T13d's Make reference / Make
 * driving) as one authored change. A conflicting result is retained
 * (T13c D6) and explained (D7).
 */
function commitEditedAnnotationDefinition(
  session: SketchSessionState,
  edit: SketchAnnotationEditState,
  updatedFullDefinition: SketchDefinition,
): SketchSessionState {
  if (updatedFullDefinition === session.definition) {
    return session;
  }

  const solved = solveEditedAnnotationDefinition(
    updatedFullDefinition,
    session.projectedReferences,
    session.solverTolerances,
    getSketchSessionDerivationSettings(session),
  );

  if (solved.kind === "blocked") {
    return {
      ...session,
      toolPresentation: buildAnnotationEditPresentation(
        session,
        edit,
        solved.message,
      ),
      ...(!session.activeAnnotationEdit ? { validationMessage: solved.message } : {}),
    };
  }

  const nextDefinition = solved.definition;
  const committed = withLiveSolveBasis(
    {
      ...session,
      definition: nextDefinition,
      toolStagedEntities: [],
      status: "idle",
      toolPresentation: null,
      activeAnnotationEdit: null,
      activeEditTarget: null,
      activeDrag: null,
      validationMessage: null,
      commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
    },
    nextDefinition,
    solved.kind === "accepted" ? solved.solvedSnapshot : undefined,
  );

  // T13c (D6, D7): a confirmed conflicting value is retained as authored and
  // leaves the sketch invalid; the status text explains which requirements
  // conflict and how to recover.
  return {
    ...committed,
    // T15b (O-1): explained whenever profiles are unavailable (as after Undo/Redo).
    validationMessage:
      committed.liveRegions.status !== "unavailable"
        ? null
        : getSketchSessionInvalidFeedback(
            committed,
            [
              edit.target.kind === "offsetDistance"
                ? edit.target.derivationId
                : edit.target.kind === "constraint"
                  ? edit.target.constraintId
                  : edit.target.dimensionId,
            ],
            // T13e2 (review R-1): the edit caused the invalidity only if the
            // sketch was accepted before it.
            hasAcceptedLiveSolveOfDefinition(session),
          ),
  };
}

function solveEditedAnnotationDefinition(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  // T17p3 review A-2: one source of the document variables, the settings.
  derivation: AuthoredSketchDerivationSettings,
) {
  const resolvedDefinition = resolveSketchDimensionValues({
    definition,
    variables: derivation.documentVariables,
  });
  if (!resolvedDefinition.ok) {
    return {
      kind: "blocked" as const,
      message:
        resolvedDefinition.diagnostics[0]?.message ??
        "Dimension value could not be resolved.",
    };
  }

  const solved = solveSketchDefinitionCore({
    definition: resolvedDefinition.definition,
    projectedReferences,
    tolerances,
    ...derivation,
    partialSolvePolicy: "bestEffort",
  });
  const constraintsSatisfied = solved.solvedSnapshot.constraintStatuses.every(
    (status) => isAcceptedConstraintStatus(status.status),
  );
  const dimensionsSatisfied = solved.solvedSnapshot.dimensionStatuses.every(
    (status) => status.status !== "unsatisfied",
  );

  if (
    solved.status.solveState !== "solved" ||
    !constraintsSatisfied ||
    !dimensionsSatisfied
  ) {
    // T13c (D6): the same retention rule as creating a conflicting
    // dimension: the authored edit is kept unchanged and the sketch reads
    // invalid until the user corrects or undoes it.
    return { kind: "retained" as const, definition };
  }

  return {
    kind: "accepted" as const,
    definition: applySolvedSketchToDefinition(
      definition,
      solved.solvedSnapshot,
      derivation,
    ),
    solvedSnapshot: solved.solvedSnapshot,
  };
}

export function updateAnnotationValueInDefinition(
  definition: SketchDefinition,
  target: SketchConstraintRef | SketchDimensionRef,
  value: AuthoredValue<number>,
): SketchDefinition {
  if (target.kind === "constraint") {
    const constraints = definition.constraints.map((constraint) => {
      if (
        constraint.constraintId !== target.constraintId ||
        constraint.kind !== "angle"
      ) {
        return constraint;
      }

      const literalValue = getAuthoredLiteralValue(value);
      if (literalValue === null) {
        return constraint;
      }

      return {
        ...constraint,
        valueRadians: (literalValue * Math.PI) / 180,
      };
    });
    const edited = constraints.some(
      (constraint, index) => constraint !== definition.constraints[index],
    );

    return edited
      ? {
          ...definition,
          constraints,
        }
      : definition;
  }

  let editedCircleRadiusEntityId: SketchEntityId | null = null;
  const dimensions = definition.dimensions.map(
    (dimension): DimensionDefinition => {
      if (dimension.dimensionId !== target.dimensionId) {
        return dimension;
      }

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
          if (dimension.kind === "circleRadius") {
            editedCircleRadiusEntityId = dimension.entityId;
          }

          // T13d: committing a value on a reference dimension makes it
          // driving. (The spread widens `kind` to the case union; each member
          // keeps its own kind at runtime.)
          return {
            ...withoutReferenceMarker(dimension),
            value,
          } as DimensionDefinition;
        case "lineAngle": {
          const literalValue = getAuthoredLiteralValue(value);
          return {
            ...withoutReferenceMarker(dimension),
            // T17p2 (F-2): a literal angle is stored as a literal wrapper
            // (it was written bare before).
            valueRadians:
              literalValue === null
                ? value
                : createLiteralAuthoredValue((literalValue * Math.PI) / 180),
          };
        }
        case "arcStartPointCoincident":
        case "arcEndPointCoincident":
          return dimension;
        default: {
          const exhaustive: never = dimension;
          return exhaustive;
        }
      }
    },
  );
  const edited = dimensions.some(
    (dimension, index) => dimension !== definition.dimensions[index],
  );

  return edited
    ? {
        ...definition,
        entities:
          editedCircleRadiusEntityId && getAuthoredLiteralValue(value) !== null
            ? definition.entities.map((entity) =>
                entity.entityId === editedCircleRadiusEntityId &&
                entity.kind === "circle"
                  ? { ...entity, radius: getAuthoredLiteralValue(value)! }
                  : entity,
              )
            : definition.entities,
        dimensions,
      }
    : definition;
}

function withoutReferenceMarker<TDimension extends DimensionDefinition>(
  dimension: TDimension,
): TDimension {
  if (!isReferenceDimension(dimension)) {
    return dimension;
  }
  const driving = { ...dimension };
  delete (driving as { reference?: true }).reference;
  return driving;
}

/**
 * T13d (D9′): the dimension as a reference: it only measures; its stored
 * value is kept and ignored. Arc endpoint bindings and constraints are left
 * unchanged (they cannot be references).
 */
export function makeReferenceDimensionInDefinition(
  definition: SketchDefinition,
  target: SketchConstraintRef | SketchDimensionRef,
): SketchDefinition {
  if (target.kind !== "dimension") {
    return definition;
  }
  let edited = false;
  const dimensions = definition.dimensions.map(
    (dimension): DimensionDefinition => {
      if (
        dimension.dimensionId !== target.dimensionId ||
        isReferenceDimension(dimension) ||
        dimension.kind === "arcStartPointCoincident" ||
        dimension.kind === "arcEndPointCoincident"
      ) {
        return dimension;
      }
      edited = true;
      // D9′: the stored value is kept untouched (ignored while a reference),
      // so a concurrent value edit still merges into a valid document.
      return { ...dimension, reference: true };
    },
  );
  return edited ? { ...definition, dimensions } : definition;
}
