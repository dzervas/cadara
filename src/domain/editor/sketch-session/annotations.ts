import type { SketchDerivationSettings } from "@/contracts/sketch/derived-geometry";
import {
  isAcceptedConstraintStatus,
  isReferenceDimension,
} from "@/contracts/sketch/schema";
import type {
  DocumentVariableRecord,
  SketchPoint,
} from "@/contracts/modeling/schema";
import {
  createLiteralAuthoredValue,
  getAuthoredFormText,
  getAuthoredLiteralValue,
  isExpressionAuthoredValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
  SketchStyleId,
} from "@/contracts/shared/ids";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import type {
  ConstraintDefinition,
  DimensionAnnotationPlacement,
  DimensionDefinition,
  LocalCollinearTargetOperand,
  ProjectedSketchGeometryRef,
  RegionRecord,
  SketchDefinition,
  SketchStyleDefinition,
  SketchStyleRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  orderedSplinePointIds,
  solvedCubicSpanPoint,
  solvedCubicSpans,
  type SolvedCubicSpan,
} from "@/contracts/sketch/spline-geometry";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import { linkedMirrorRefs } from "@/contracts/sketch/mirror-requirements";
import { resolveSketchDimensionValues } from "@/domain/modeling/sketch-dimension-expressions";
import {
  type ProjectedSketchReferenceRecord,
  type SolverTolerancePolicy,
} from "@/contracts/solver/schema";
import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import type {
  SketchStylePatch,
  SketchStyleToolId,
} from "@/domain/sketch-styles/definition";
import type {
  SketchToolAnchorDescriptor,
  SketchToolOverlayDescriptor,
  SketchToolPresentationSchema,
} from "@/core/sketch-tools/editor-schema";
import { getSketchEntityDefiningPointIds } from "./drag-intent";
import type {
  SketchAnnotationContext,
  SketchAnnotationDescriptor,
  SketchAnnotationEditState,
  SketchAnnotationGlyphKind,
  SketchAnnotationProblem,
  SketchDimensionAnnotationDragHandle,
  SketchSessionState,
  SketchSharedDimensionEdit,
} from "./types";
import {
  describeSharedMirrorPath,
  getSessionSketchId,
  getSketchSessionMirrorHealth,
  getSketchSessionSharedMirrorDimensions,
  sharedMirrorDriverRefusal,
  describeSketchSessionUnsatisfiedRequirements,
  getSketchSessionInvalidFeedback,
  hasAcceptedLiveSolveOfDefinition,
  withLiveSolveBasis,
  resolveSketchDefinitionForSolve,
  getTargetKey,
  normalizeConstraintValue,
  rebuildSessionCommitRequest,
  createSketchConstraintRef,
  createSketchDimensionRef,
  createSketchEntityRef,
  createSketchPointRef,
  getSketchSessionDerivationSettings,
  getSketchSessionSolvedSnapshot,
} from "./internals";
import {
  addAnchorOffset,
  getSketchDatumGuideExtent,
  applySolvedSketchToDefinition,
} from "./definition-patches";
// T16f review R-3: re-arming a routed Dimension tool (an import cycle with
// `constraints.ts`, used only at call time, as `tools.ts` ↔ `constraints.ts`).
import { rearmSharedDimensionTool } from "./constraints";
import {
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
} from "./annotation-display";

export function beginSketchAnnotationEdit(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef,
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
    validationMessage: options.message ?? null,
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

  if ("value" in patch) {
    if (edit.shared?.addsReference) {
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
      // T16f review A-2: typing clears a refusal shown by this popup, in the
      // popup and the session alike.
      validationMessage: null,
    };
  }

  if (intent === "makeAnnotationReference") {
    return commitEditedAnnotationDefinition(
      session,
      edit,
      makeReferenceDimensionInDefinition(session.definition, edit.target),
    );
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

export function applyStylePatchToDefinition(
  definition: SketchDefinition,
  solvedRegions: readonly RegionRecord[],
  targets: readonly Extract<
    PrimitiveRef,
    { kind: "region" | "sketchEntity" }
  >[],
  patch: SketchStylePatch,
  toolId: SketchStyleToolId,
): SketchDefinition {
  if (toolId === "fill") {
    return applyFillStylePatchToDefinition(
      definition,
      solvedRegions,
      targets,
      patch,
    );
  }

  if (isFillStylePatch(patch)) {
    return definition;
  }

  const entityIds = new Set(
    targets
      .filter(
        (target): target is Extract<PrimitiveRef, { kind: "sketchEntity" }> =>
          target.kind === "sketchEntity",
      )
      .map((target) => target.entityId),
  );

  let didChange = false;

  const entities = definition.entities.map((entity) => {
    if (!entityIds.has(entity.entityId)) {
      return entity;
    }

    const nextStyle = applySketchStyleDefinitionPatch(entity.style, patch);
    if (nextStyle === entity.style) {
      return entity;
    }

    didChange = true;
    return { ...entity, style: nextStyle };
  });

  if (!didChange) {
    return definition;
  }

  return {
    ...definition,
    entities,
  };
}

export function applyFillStylePatchToDefinition(
  definition: SketchDefinition,
  solvedRegions: readonly RegionRecord[],
  targets: readonly Extract<
    PrimitiveRef,
    { kind: "region" | "sketchEntity" }
  >[],
  patch: SketchStylePatch,
): SketchDefinition {
  if (!isFillStylePatch(patch)) {
    return definition;
  }

  const liveRegionIds = new Set(solvedRegions.map((region) => region.regionId));
  const regionIds = targets.flatMap((target) =>
    target.kind === "region" && liveRegionIds.has(target.regionId)
      ? [target.regionId]
      : [],
  );

  if (regionIds.length === 0) {
    return definition;
  }

  const styles = [...(definition.styles ?? [])];
  const styleIds = [...(definition.styleIds ?? [])];
  let didChange = false;

  for (const regionId of regionIds) {
    const index = styles.findIndex(
      (style) =>
        style.target.kind === "region" && style.target.regionId === regionId,
    );
    const current =
      index >= 0 ? styles[index]! : createDefaultRegionStyleRecord(regionId);
    const next = applyRegionFillPatch(current, patch);
    if (next === current) {
      continue;
    }

    if (!styleIds.includes(next.styleId)) {
      styleIds.push(next.styleId);
    }

    if (index >= 0) {
      styles[index] = next;
    } else {
      styles.push(next);
    }
    didChange = true;
  }

  return didChange
    ? {
        ...definition,
        styleIds,
        styles,
      }
    : definition;
}

export function isFillStylePatch(patch: SketchStylePatch): patch is Extract<
  SketchStylePatch,
  {
    field: "fillMode" | "fillColor" | "gradientStartColor" | "gradientEndColor";
  }
> {
  return (
    patch.field === "fillMode" ||
    patch.field === "fillColor" ||
    patch.field === "gradientStartColor" ||
    patch.field === "gradientEndColor"
  );
}

export function createDefaultRegionStyleRecord(
  regionId: RegionRecord["regionId"],
): SketchStyleRecord {
  return {
    styleId: `sketch_style_${regionId}` as SketchStyleId,
    label: `Region ${regionId} style`,
    target: { kind: "region", regionId },
    fill: { kind: "none" },
    stroke: {
      color: "var(--cad-foreground)",
      opacity: 0,
      width: 0,
      lineCap: "round",
      lineJoin: "round",
      miterLimit: 4,
    },
  };
}

export function applyRegionFillPatch(
  style: SketchStyleRecord,
  patch: Extract<
    SketchStylePatch,
    {
      field:
        | "fillMode"
        | "fillColor"
        | "gradientStartColor"
        | "gradientEndColor";
    }
  >,
): SketchStyleRecord {
  const current = sketchStyleRecordToDefinition(style);
  const nextDefinition = applySketchStyleDefinitionPatch(current, patch);
  const nextFill = sketchStyleDefinitionToFill(nextDefinition);

  if (JSON.stringify(style.fill) === JSON.stringify(nextFill)) {
    return style;
  }

  return {
    ...style,
    fill: nextFill,
  };
}

export function applySketchStyleDefinitionPatch(
  style: SketchStyleDefinition | undefined,
  patch: SketchStylePatch,
): SketchStyleDefinition {
  const next = { ...(style ?? {}) };

  switch (patch.field) {
    case "fillMode":
      if (next.fillMode === patch.value) {
        return style ?? next;
      }
      next.fillMode = patch.value;
      break;
    case "fillColor":
      if (next.fillColor === patch.value) {
        return style ?? next;
      }
      next.fillColor = patch.value;
      break;
    case "gradientStartColor":
      if (next.gradientStartColor === patch.value) {
        return style ?? next;
      }
      next.gradientStartColor = patch.value;
      break;
    case "gradientEndColor":
      if (next.gradientEndColor === patch.value) {
        return style ?? next;
      }
      next.gradientEndColor = patch.value;
      break;
    case "strokeEnabled":
      if (next.strokeEnabled === patch.value) {
        return style ?? next;
      }
      next.strokeEnabled = patch.value;
      break;
    case "strokeColor":
      if (next.strokeColor === patch.value) {
        return style ?? next;
      }
      next.strokeColor = patch.value;
      break;
    case "strokeWidth":
      if (next.strokeWidth === patch.value) {
        return style ?? next;
      }
      next.strokeWidth = patch.value;
      break;
    case "strokeCap":
      if (next.strokeCap === patch.value) {
        return style ?? next;
      }
      next.strokeCap = patch.value;
      break;
    case "strokeJoin":
      if (next.strokeJoin === patch.value) {
        return style ?? next;
      }
      next.strokeJoin = patch.value;
      break;
    case "strokeMiterLimit":
      if (next.strokeMiterLimit === patch.value) {
        return style ?? next;
      }
      next.strokeMiterLimit = patch.value;
      break;
    case "strokeDashSize":
      if (next.strokeDashSize === patch.value) {
        return style ?? next;
      }
      next.strokeDashSize = patch.value;
      break;
    case "strokeGapSize":
      if (next.strokeGapSize === patch.value) {
        return style ?? next;
      }
      next.strokeGapSize = patch.value;
      break;
  }

  return next;
}

export function sketchStyleRecordToDefinition(
  style: SketchStyleRecord | undefined,
): SketchStyleDefinition | undefined {
  if (!style) {
    return undefined;
  }

  return {
    ...sketchStyleFillToDefinition(style.fill),
    strokeEnabled: style.stroke.opacity > 0 && style.stroke.width > 0,
    strokeColor: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeCap: style.stroke.lineCap,
    strokeJoin: style.stroke.lineJoin,
    strokeMiterLimit: style.stroke.miterLimit,
    strokeDashSize: style.stroke.dashSize,
    strokeGapSize: style.stroke.gapSize,
  };
}

export function sketchStyleFillToDefinition(
  fill: SketchStyleRecord["fill"],
): SketchStyleDefinition {
  if (fill.kind === "none") {
    return { fillMode: "none" };
  }

  if (fill.kind === "solid") {
    return {
      fillMode: "solid",
      fillColor: fill.color,
    };
  }

  return {
    fillMode: "gradient",
    gradientStartColor: fill.gradient.startColor,
    gradientEndColor: fill.gradient.endColor,
  };
}

export function sketchStyleDefinitionToFill(
  style: SketchStyleDefinition,
): SketchStyleRecord["fill"] {
  if (style.fillMode === "none" || style.fillMode === undefined) {
    return { kind: "none" };
  }

  if (style.fillMode === "gradient") {
    return {
      kind: "gradient",
      gradient: {
        kind: "linear",
        angleRadians: 0,
        startColor:
          style.gradientStartColor ?? style.fillColor ?? "var(--cad-accent)",
        startOpacity: 0.42,
        endColor: style.gradientEndColor ?? "var(--cad-surface)",
        endOpacity: 0.28,
      },
    };
  }

  return {
    kind: "solid",
    color: style.fillColor ?? "var(--cad-accent)",
    opacity: 0.42,
  };
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

export function commitSketchAnnotationEditValue(
  session: SketchSessionState,
  edit: SketchAnnotationEditState & {
    pendingValue: MaybeAuthoredValue<number>;
  },
): SketchSessionState {
  const target = edit.target;
  const madeDriving =
    target.kind === "dimension"
      ? session.definition.dimensions.find(
          (dimension) =>
            dimension.dimensionId === target.dimensionId &&
            isReferenceDimension(dimension),
        )
      : undefined;
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
        edit.target,
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
      const literal = getAuthoredLiteralValue(dimension.value);
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
    session.documentVariables,
  );

  if (solved.kind === "blocked") {
    return {
      ...session,
      toolPresentation: buildAnnotationEditPresentation(
        session,
        edit,
        solved.message,
      ),
      validationMessage: solved.message,
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
              edit.target.kind === "constraint"
                ? edit.target.constraintId
                : edit.target.dimensionId,
            ],
            // T13e2 (review R-1): the edit caused the invalidity only if the
            // sketch was accepted before it.
            hasAcceptedLiveSolveOfDefinition(session),
          ),
  };
}

export function solveEditedAnnotationDefinition(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  derivation: SketchDerivationSettings,
  documentVariables: readonly DocumentVariableRecord[] = [],
) {
  const resolvedDefinition = resolveSketchDimensionValues({
    definition,
    variables: documentVariables,
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
  value: MaybeAuthoredValue<number>,
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
            valueRadians:
              literalValue === null ? value : (literalValue * Math.PI) / 180,
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

export function updateDimensionAnnotationPlacementInDefinition(
  session: SketchSessionState,
  definition: SketchDefinition,
  target: SketchDimensionRef,
  point: SketchPoint,
): SketchDefinition {
  const dimensions = definition.dimensions.map((dimension) => {
    if (dimension.dimensionId !== target.dimensionId) {
      return dimension;
    }

    const placement = inferCommittedDimensionAnnotationPlacement(
      session,
      definition,
      dimension,
      point,
    );
    if (!placement) {
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
        return placement.kind === "dimensionLine"
          ? { ...dimension, annotationPlacement: placement }
          : dimension;
      case "lineAngle":
        return placement.kind === "angleArc"
          ? { ...dimension, annotationPlacement: placement }
          : dimension;
      case "arcStartPointCoincident":
      case "arcEndPointCoincident":
        return dimension;
    }
  });
  const edited = dimensions.some(
    (dimension, index) => dimension !== definition.dimensions[index],
  );

  return edited
    ? {
        ...definition,
        dimensions,
      }
    : definition;
}

export function inferCommittedDimensionAnnotationPlacement(
  session: SketchSessionState,
  definition: SketchDefinition,
  dimension: DimensionDefinition,
  point: SketchPoint,
): DimensionAnnotationPlacement | null {
  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance": {
      const first = getPointPosition(definition, dimension.pointIds[0]);
      const second = getPointPosition(definition, dimension.pointIds[1]);
      if (!first || !second) {
        return null;
      }

      const axis =
        dimension.kind === "distance"
          ? dimension.axis
          : dimension.kind === "horizontalDistance"
            ? "horizontal"
            : "vertical";
      return getPointPairAnnotationPlacementFromPoint(
        first,
        second,
        axis,
        point,
      );
    }
    case "pointDatumDistance": {
      const first = getReferencePointGeometry(
        definition,
        session,
        dimension.point,
      );
      const second = getReferencePointGeometry(
        definition,
        session,
        dimension.datum,
      );
      return first && second
        ? getPointPairAnnotationPlacementFromPoint(
            first,
            second,
            dimension.axis,
            point,
          )
        : null;
    }
    case "circleRadius":
    case "diameter": {
      const circle = getCircleLikeGeometry(definition, dimension.entityId);
      if (!circle) {
        return null;
      }

      return {
        kind: "dimensionLine",
        offset: 0,
        angleRadians: Math.atan2(
          point[1] - circle.center[1],
          point[0] - circle.center[0],
        ),
      };
    }
    case "lineLength": {
      const line = getLineSegmentGeometry(definition, dimension.entityId);
      return line ? getLineAnnotationPlacementFromPoint(line, point) : null;
    }
    case "lineDistance": {
      const line = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[0],
      );
      return line ? getLineAnnotationPlacementFromPoint(line, point) : null;
    }
    case "linePointDistance": {
      const line = getReferenceLineGeometry(
        definition,
        session,
        dimension.line,
      );
      return line ? getLineAnnotationPlacementFromPoint(line, point) : null;
    }
    case "lineAngle": {
      const first = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[0],
      );
      const second = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[1],
      );
      if (!first || !second) {
        return null;
      }

      const center = getSketchLineIntersection(first, second) ?? first.start;
      const firstVector = getSketchLineDirectionFromCenter(first, center);
      const secondVector = getSketchLineDirectionFromCenter(second, center);
      return {
        kind: "angleArc",
        radius: Math.max(
          0.1,
          Math.hypot(point[0] - center[0], point[1] - center[1]),
        ),
        side: getSketchAngleArcSide({
          center,
          startVector: firstVector,
          endVector: secondVector,
          point,
        }),
      };
    }
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return null;
    default: {
      const exhaustive: never = dimension;
      return exhaustive;
    }
  }
}

export function buildAnnotationEditPresentation(
  session: SketchSessionState,
  edit: SketchAnnotationEditState,
  validationMessage: string | null = null,
): SketchToolPresentationSchema {
  const editable = getEditableAnnotationValue(session, edit.target);
  const label = editable?.label ?? "Value";
  const reference = editable?.reference ?? null;
  const shared = edit.shared;
  // T16f ([TECH] T16-12): a routed Dimension tool edits the driver it
  // shares (shown in its own kind) or, with "Add as reference instead",
  // commits its picks as a reference measurement.
  const sharedPresentation = shared
    ? {
        readout: shared.readout,
        ...(shared.referenceLabel === null
          ? {}
          : {
              modeSwitch: {
                label: "Add as reference instead",
                checked: shared.addsReference,
                action: {
                  type: "patch" as const,
                  patch: {
                    intent: "setSharedDimensionReference",
                    reference: !shared.addsReference,
                  },
                },
              },
            }),
      }
    : null;
  const duplicates =
    !shared && !reference && edit.target.kind === "dimension"
      ? describeSharedMirrorDuplicates(session, edit.target)
      : null;

  if (shared?.addsReference && shared.referenceLabel !== null) {
    const measured = shared.authoring.pendingValue;
    return {
      prompts: [
        {
          id: "annotation-edit-prompt",
          text: `Add ${shared.referenceLabel.toLowerCase()} reference`,
        },
      ],
      floatingInput: {
        id: `annotation-edit-${getTargetKey(edit.target)}`,
        label: `${shared.referenceLabel} (reference)`,
        value:
          measured === null
            ? null
            : getAuthoredFormText(measured, formatMeasuredEditText),
        unit: editable?.unit,
        min: editable?.min,
        ...sharedPresentation!,
        readOnly: true,
        confirmLabel: "Add reference",
        cancelLabel: "Cancel",
        anchor: editable?.anchor,
        placement: "target",
        submitAction: {
          type: "patch",
          patch: { intent: "commitConstraintValue" },
        },
        cancelAction: {
          type: "patch",
          patch: { intent: "cancelAnnotationValue" },
        },
      },
      validation: [],
    };
  }

  return {
    prompts: [
      {
        id: "annotation-edit-prompt",
        text: `Edit ${label.toLowerCase()}`,
      },
    ],
    floatingInput: {
      id: `annotation-edit-${getTargetKey(edit.target)}`,
      label: reference ? `${label} (reference)` : label,
      value:
        edit.pendingValue === null
          ? null
          : reference &&
              reference.measuredValue !== null &&
              getAuthoredLiteralValue(edit.pendingValue) ===
                reference.measuredValue
            ? formatMeasuredEditText(reference.measuredValue)
            : getAuthoredFormText(edit.pendingValue),
      unit: editable?.unit,
      min: editable?.min,
      // T13d: a reference dimension's popup shows its measured value
      // read-only; confirming commits it as driving with the typed (by
      // default the measured) value. A driving dimension offers Make reference.
      ...(reference
        ? {
            readout: `Measured ${
              reference.measuredValue === null
                ? "—"
                : `${reference.measuredValue.toFixed(2)} ${editable?.unit ?? ""}`.trim()
            }`,
          }
        : sharedPresentation
          ? sharedPresentation
          : editable?.canBeReference
            ? {
                ...(duplicates ? { readout: duplicates } : {}),
                secondaryAction: {
                  label: "Make reference",
                  action: {
                    type: "patch" as const,
                    patch: { intent: "makeAnnotationReference" },
                  },
                },
              }
            : {}),
      confirmLabel: reference ? "Make driving" : "Save",
      cancelLabel: "Cancel",
      anchor: editable?.anchor,
      placement: "target",
      submitAction: {
        type: "patch",
        patch: { intent: "commitAnnotationValue" },
      },
      cancelAction: {
        type: "patch",
        patch: { intent: "cancelAnnotationValue" },
      },
    },
    validation: validationMessage
      ? [
          {
            id: "annotation-edit-value-required",
            message: validationMessage,
            severity: "error",
          },
        ]
      : [],
  };
}

/**
 * T16f ([TECH] T16-13): a persisted duplicate (another driving dimension
 * of the same mirrored quantity) is explained in either one's popup; null
 * when there is none.
 */
function describeSharedMirrorDuplicates(
  session: SketchSessionState,
  target: SketchDimensionRef,
): string | null {
  const dimension = session.definition.dimensions.find(
    (entry) => entry.dimensionId === target.dimensionId,
  );
  const others = dimension
    ? getSketchSessionSharedMirrorDimensions(session, dimension)
    : [];
  if (others.length === 0) {
    return null;
  }
  return `Also sized by ${others.map((entry) => entry.dimension.label).join(", ")} through ${describeSharedMirrorPath(others[0]!.mirrors)}; ${others.length === 1 ? "both" : "all"} must match`;
}

/** Display text of a measured value; the exact value is what gets committed. */
function formatMeasuredEditText(value: number) {
  return String(Number(value.toFixed(6)));
}

export function getEditableAnnotationValue(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef,
): {
  label: string;
  /** The edit's initial value; a reference dimension's is its measured value. */
  value: MaybeAuthoredValue<number> | null;
  unit?: string;
  min?: number;
  anchor?: SketchToolAnchorDescriptor;
  /** T13d: a driving numeric dimension, which can be made a reference. */
  canBeReference?: true;
  /** T13d: a reference dimension and its measured value (display units). */
  reference?: { measuredValue: number | null };
} | null {
  const { descriptors, solvedSnapshot } =
    buildSketchAnnotationDescriptors(session);
  const annotation = descriptors.find(
    (entry) => getTargetKey(entry.target) === getTargetKey(target),
  );
  const anchor = annotation
    ? addAnchorOffset(annotation.anchor, { x: 18, y: -18 })
    : undefined;

  if (target.kind === "constraint") {
    const constraint = session.definition.constraints.find(
      (entry) => entry.constraintId === target.constraintId,
    );

    if (constraint?.kind !== "angle") {
      return null;
    }

    return {
      label: "Angle",
      value: (constraint.valueRadians * 180) / Math.PI,
      unit: "deg",
      anchor,
    };
  }

  const dimension = session.definition.dimensions.find(
    (entry) => entry.dimensionId === target.dimensionId,
  );

  if (
    !dimension ||
    dimension.kind === "arcStartPointCoincident" ||
    dimension.kind === "arcEndPointCoincident"
  ) {
    return null;
  }

  const label = getDimensionEditLabel(dimension);
  const angle = dimension.kind === "lineAngle";
  const unit = angle ? "deg" : "mm";
  const min = angle ? 0.1 : 0.01;

  if (isReferenceDimension(dimension)) {
    const solvedValue =
      solvedSnapshot.dimensionStatuses.find(
        (entry) => entry.dimensionId === dimension.dimensionId,
      )?.solvedValue ?? null;
    // Review R-1: magnitudes (a signed point pair may measure negative).
    const measuredValue =
      solvedValue === null
        ? null
        : angle
          ? (solvedValue * 180) / Math.PI
          : Math.abs(solvedValue);
    return {
      label,
      value:
        measuredValue === null
          ? null
          : createLiteralAuthoredValue(measuredValue),
      unit,
      min,
      anchor,
      reference: { measuredValue },
    };
  }

  if (dimension.kind === "lineAngle") {
    const literalRadians = getAuthoredLiteralValue(dimension.valueRadians);
    return {
      label,
      value:
        literalRadians === null
          ? dimension.valueRadians
          : createLiteralAuthoredValue((literalRadians * 180) / Math.PI),
      unit,
      min,
      anchor,
      canBeReference: true,
    };
  }

  return {
    label,
    value: dimension.value,
    unit,
    min,
    anchor,
    canBeReference: true,
  };
}

function getDimensionEditLabel(
  dimension: Exclude<
    DimensionDefinition,
    { kind: "arcStartPointCoincident" | "arcEndPointCoincident" }
  >,
) {
  switch (dimension.kind) {
    case "distance":
    case "pointDatumDistance":
      return dimension.axis === "horizontal"
        ? "Horizontal distance"
        : dimension.axis === "vertical"
          ? "Vertical distance"
          : "Distance";
    case "horizontalDistance":
      return "Horizontal distance";
    case "verticalDistance":
      return "Vertical distance";
    case "circleRadius":
      return "Radius";
    case "diameter":
      return "Diameter";
    case "lineLength":
      return "Length";
    case "lineDistance":
    case "linePointDistance":
      return "Distance";
    case "lineAngle":
      return "Angle";
  }
}

/**
 * T14c: selecting an annotation drops any open annotation edit, point edit
 * target or drag. With none open the session object is kept, so a lifecycle
 * click never re-runs anything keyed on the session (R-7).
 */
export function selectSketchAnnotation(
  session: SketchSessionState,
): SketchSessionState {
  // T16f review R-3 (issue 04): dropping a routed Dimension tool's edit
  // (e.g. a click on the driver's own label) keeps that tool armed, as its
  // Cancel does.
  const shared = session.activeAnnotationEdit?.shared;
  if (shared) {
    return rearmSharedDimensionTool(
      {
        ...session,
        activeAnnotationEdit: null,
        activeEditTarget: null,
        activeDrag: null,
        validationMessage: null,
      },
      shared,
    );
  }
  // T17f (T16f review): a dropped edit takes its popup with it, as its
  // Cancel does (status, presentation and the popup's refusal).
  if (session.activeAnnotationEdit)
    return {
      ...clearSketchAnnotationEdit(session),
      activeEditTarget: null,
      activeDrag: null,
    };
  return session.activeEditTarget || session.activeDrag
    ? {
        ...session,
        activeEditTarget: null,
        activeDrag: null,
      }
    : session;
}

/**
 * T14b (T-4) `ctx(G)`: the geometry whose contextual annotations a hover or
 * selection of G shows. An entity brings its defining points (line ends,
 * arc/circle centre and ends, fit points); a tangent handle its fit point and
 * spline; a region, face, image or datum nothing.
 */
export function getSketchAnnotationContextRefs(
  target: PrimitiveRef,
  definition: SketchDefinition | null,
): readonly PrimitiveRef[] {
  switch (target.kind) {
    case "sketchEntity":
      return [
        target,
        ...(definition
          ? getSketchEntityDefiningPointIds(definition, target.entityId)
          : []
        ).map((pointId) => ({
          kind: "sketchPoint" as const,
          sketchId: target.sketchId,
          pointId,
        })),
      ];
    case "sketchPoint":
    case "projectedReferenceGeometry":
      return [target];
    case "sketchTangentHandle":
      return [
        {
          kind: "sketchPoint",
          sketchId: target.sketchId,
          pointId: target.pointId,
        },
        {
          kind: "sketchEntity",
          sketchId: target.sketchId,
          entityId: target.entityId,
        },
      ];
    default:
      return [];
  }
}

/**
 * The geometry an annotation of the session's definition affects, or null
 * when the definition no longer holds it.
 */
export function getSketchAnnotationAffectedGeometryRefs(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef,
): readonly PrimitiveRef[] | null {
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  if (target.kind === "constraint") {
    const constraint = session.definition.constraints.find(
      (entry) => entry.constraintId === target.constraintId,
    );
    return constraint
      ? getConstraintAffectedGeometryRefs(sketchId, constraint)
      : null;
  }
  const dimension = session.definition.dimensions.find(
    (entry) => entry.dimensionId === target.dimensionId,
  );
  return dimension
    ? getDimensionAffectedGeometryRefs(sketchId, dimension)
    : null;
}

/**
 * T14c: whether an annotation is one of the contextual annotations the
 * owners pin, i.e. it affects a selected owner itself or `ctx()` of one (the
 * same rule the annotation layer pins by).
 */
export function isSketchAnnotationInContext(
  session: SketchSessionState,
  target: SketchConstraintRef | SketchDimensionRef,
  owners: readonly PrimitiveRef[],
) {
  const pinned = new Set(
    owners.flatMap((owner) =>
      [owner, ...getSketchAnnotationContextRefs(owner, session.definition)].map(
        getPrimitiveRefKey,
      ),
    ),
  );
  const affected = getSketchAnnotationAffectedGeometryRefs(session, target);
  // T16f ([TECH] T16-14): a dimension is also in the context of its
  // geometry's mirror counterparts (selecting the copy brings the seed's
  // dimension into context).
  const linked =
    affected && target.kind === "dimension"
      ? getSketchMirrorLinkedGeometryRefs(session, affected)
      : [];
  return (
    [...(affected ?? []), ...linked].some((ref) =>
      pinned.has(getPrimitiveRefKey(ref)),
    ) ?? false
  );
}

/**
 * T16f ([TECH] T16-14): the counterparts of the sketch entities and points
 * among `refs` through the healthy mirrors of the session's live solve
 * (copies, originals, copies of copies), never one of `refs`; none without
 * a live solve (health unknown). One owner index per definition (A-10).
 */
export function getSketchMirrorLinkedGeometryRefs(
  session: Pick<SketchSessionState, "sketchId" | "definition" | "liveSolve">,
  refs: readonly PrimitiveRef[],
): PrimitiveRef[] {
  const health = getSketchSessionMirrorHealth(session);
  const local = refs.flatMap(
    (ref): Parameters<typeof linkedMirrorRefs>[1][number][] =>
      ref.kind === "sketchEntity"
        ? [{ kind: "entity", entityId: ref.entityId }]
        : ref.kind === "sketchPoint"
          ? [{ kind: "point", pointId: ref.pointId }]
          : [],
  );
  if (!health || local.length === 0) {
    return [];
  }
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  return linkedMirrorRefs(session.definition, local, health).map((ref) =>
    ref.kind === "entity"
      ? createSketchEntityRef(sketchId, ref.entityId)
      : createSketchPointRef(sketchId, ref.pointId),
  );
}

/**
 * T14c: the lifecycle context without the refs the session's definition no
 * longer holds (after a deletion, Undo or Redo); null once nothing is left.
 */
export function pruneSketchAnnotationContext(
  context: SketchAnnotationContext | null,
  session: SketchSessionState,
): SketchAnnotationContext | null {
  if (!context) {
    return null;
  }

  const { definition } = session;
  const pointIds = new Set(definition.points.map((point) => point.pointId));
  const entityIds = new Set(definition.entityIds);
  const owners = context.owners.filter((owner) => {
    switch (owner.kind) {
      case "sketchPoint":
        return pointIds.has(owner.pointId);
      case "sketchEntity":
        return entityIds.has(owner.entityId);
      case "sketchTangentHandle":
        return entityIds.has(owner.entityId) && pointIds.has(owner.pointId);
      default:
        return true;
    }
  });
  const last =
    context.last &&
    getSketchAnnotationAffectedGeometryRefs(session, context.last)
      ? context.last
      : null;

  if (owners.length === 0 && last === null) {
    return null;
  }

  return owners.length === context.owners.length && last === context.last
    ? context
    : { owners, last };
}

/**
 * T14g (T-10): the context with its wheel closed; null when nothing else is
 * retained (no owners, no `last`).
 */
export function withoutSketchAnnotationWheel(
  context: SketchAnnotationContext | null,
): SketchAnnotationContext | null {
  if (!context?.wheel) {
    return context;
  }
  return context.owners.length === 0 && context.last === null
    ? null
    : { owners: context.owners, last: context.last };
}

/**
 * Deletes the annotation the selection holds (`selection[0]`, T14c: the
 * editor selection is the only annotation selection).
 */
export function deleteSelectedSketchAnnotation(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
): SketchSessionState {
  const selected = selection[0];

  if (selected?.kind !== "constraint" && selected?.kind !== "dimension") {
    return session;
  }

  const nextFullDefinition =
    selected.kind === "constraint"
      ? {
          ...session.definition,
          constraintIds: session.definition.constraintIds.filter(
            (constraintId) => constraintId !== selected.constraintId,
          ),
          constraints: session.definition.constraints.filter(
            (constraint) => constraint.constraintId !== selected.constraintId,
          ),
        }
      : {
          ...session.definition,
          dimensionIds: session.definition.dimensionIds.filter(
            (dimensionId) => dimensionId !== selected.dimensionId,
          ),
          dimensions: session.definition.dimensions.filter(
            (dimension) => dimension.dimensionId !== selected.dimensionId,
          ),
        };
  const nextDefinition = nextFullDefinition;

  return withLiveSolveBasis(
    {
      ...session,
      definition: nextDefinition,
      sequence: session.sequence + 1,
      toolStagedEntities: [],
      activeAnnotationEdit: null,
      activeEditTarget: null,
      activeSpecialMode: null,
      activeDrag: null,
      validationMessage: null,
      commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
    },
    nextDefinition,
  );
}

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

function buildSketchAnnotationDescriptors(session: SketchSessionState): {
  descriptors: SketchAnnotationDescriptor[];
  solvedSnapshot: SolvedSketchSnapshot;
} {
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const resolvedDimensionValues = resolveDimensionEffectiveValues(session);
  const solved = solveSketchDefinitionCore({
    definition: resolveSketchDefinitionForSolve(
      session.definition,
      session.documentVariables,
    ),
    projectedReferences: session.projectedReferences,
    tolerances: session.solverTolerances,
    ...getSketchSessionDerivationSettings(session),
    partialSolvePolicy: "bestEffort",
  });
  const constraintDisplaySummary = getSketchConstraintDisplaySummary({
    sketchId,
    definition: session.definition,
    solvedSnapshot: solved.solvedSnapshot,
  });
  // T13d (D12): a reference dimension shows the solve's measured value.
  const measuredValues = new Map(
    solved.solvedSnapshot.dimensionStatuses.map((entry) => [
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
    solved.solvedSnapshot,
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
  return { descriptors, solvedSnapshot: solved.solvedSnapshot };
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
    if (id && diagnostic.severity !== "info" && !diagnosticMessages.has(id)) {
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
      return { status: "conflict", explanation: conflictExplanation };
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

export function createDimensionAnnotationDragHandle(
  dimension: DimensionDefinition,
): SketchDimensionAnnotationDragHandle | undefined {
  switch (dimension.kind) {
    case "distance":
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

export function getConstraintGlyphKind(
  constraint: ConstraintDefinition,
): SketchAnnotationGlyphKind {
  switch (constraint.kind) {
    case "coincident":
      return "constraintCoincident";
    case "collinear":
    case "collinearProjectedLine":
      return "constraintCollinear";
    case "parallel":
    case "equalOffset":
      return "constraintParallel";
    case "equalLength":
      return "constraintEqual";
    case "horizontal":
      return "constraintHorizontal";
    case "vertical":
      return "constraintVertical";
    case "fixPoint":
      return "constraintFixed";
    case "angle":
      return "constraintAngle";
    case "perpendicular":
    case "perpendicularProjectedLine":
      return "constraintPerpendicular";
    case "tangentProjectedCurve":
    case "tangent":
      return "constraintTangent";
    case "midpoint":
    case "midpointProjectedLine":
      return "constraintMidpoint";
    case "normal":
    case "normalProjectedCurve":
      return "constraintNormal";
    case "symmetric":
    case "symmetricProjectedLine":
      return "constraintSymmetric";
    case "pointOnProjectedCurve":
    case "pointOnCurve":
      return "constraintPierce";
    case "coincidentProjectedPoint":
      return "constraintCoincident";
    case "parallelProjectedLine":
      return "constraintParallel";
    case "concentric":
    case "concentricProjectedCurve":
      return "constraintConcentric";
  }
}

export function getDimensionGlyphKind(
  dimension: DimensionDefinition,
): SketchAnnotationGlyphKind {
  switch (dimension.kind) {
    case "distance":
    case "pointDatumDistance":
      if (dimension.axis === "horizontal") {
        return "dimensionHorizontal";
      }

      if (dimension.axis === "vertical") {
        return "dimensionVertical";
      }

      return "dimensionDistance";
    case "horizontalDistance":
      return "dimensionHorizontal";
    case "verticalDistance":
      return "dimensionVertical";
    case "circleRadius":
    case "diameter":
      return "dimensionRadius";
    case "lineLength":
    case "lineDistance":
    case "linePointDistance":
      return "dimensionDistance";
    case "lineAngle":
      return "dimensionAngle";
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return "constraintCoincident";
  }
}

export function getConstraintAffectedGeometryRefs(
  sketchId: SketchId,
  constraint: ConstraintDefinition,
): readonly PrimitiveRef[] {
  switch (constraint.kind) {
    case "coincident":
    case "angle":
      return constraint.pointIds.map((pointId) =>
        createSketchPointRef(sketchId, pointId),
      );
    case "fixPoint":
      return [createSketchPointRef(sketchId, constraint.pointId)];
    case "horizontal":
    case "vertical":
      return [createSketchEntityRef(sketchId, constraint.entityId)];
    case "equalOffset":
      return constraint.pairs.flatMap((pair) => [
        createSketchEntityRef(sketchId, pair.seedEntityId),
        createSketchEntityRef(sketchId, pair.offsetEntityId),
      ]);
    case "parallel":
    case "perpendicular":
    case "equalLength":
    case "tangent":
    case "concentric":
      return constraint.entityIds.map((entityId) =>
        createSketchEntityRef(sketchId, entityId),
      );
    case "midpoint":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
      ];
    case "midpointProjectedLine":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ];
    case "pointOnCurve":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ];
    case "collinear":
      return [
        createCollinearTargetPrimitiveRef(sketchId, constraint.target),
        createSketchEntityRef(sketchId, constraint.line.entityId),
      ];
    case "collinearProjectedLine":
      return [
        createCollinearTargetPrimitiveRef(sketchId, constraint.target),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ];
    case "normal":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ];
    case "normalProjectedCurve":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ];
    case "symmetric":
      return [
        ...constraint.pointIds.map((pointId) =>
          createSketchPointRef(sketchId, pointId),
        ),
        createSketchEntityRef(sketchId, constraint.axis.entityId),
      ];
    case "symmetricProjectedLine":
      return [
        ...constraint.pointIds.map((pointId) =>
          createSketchPointRef(sketchId, pointId),
        ),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ];
    case "coincidentProjectedPoint":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedPoint, sketchId)!,
      ];
    case "pointOnProjectedCurve":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ];
    case "parallelProjectedLine":
    case "perpendicularProjectedLine":
      return [
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ];
    case "tangentProjectedCurve":
      return [
        createSketchEntityRef(sketchId, constraint.curve.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ];
    case "concentricProjectedCurve":
      return [
        createSketchEntityRef(sketchId, constraint.curve.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ];
  }
}

export function getDimensionAffectedGeometryRefs(
  sketchId: SketchId,
  dimension: DimensionDefinition,
): readonly PrimitiveRef[] {
  const operandRef = (operand: {
    kind: string;
    pointId?: SketchPointId;
    entityId?: SketchEntityId;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  }): PrimitiveRef | null => {
    if (operand.kind === "localPoint" && operand.pointId) {
      return createSketchPointRef(sketchId, operand.pointId);
    }

    if (operand.kind === "localEntity" && operand.entityId) {
      return createSketchEntityRef(sketchId, operand.entityId);
    }

    if (operand.kind === "projectedGeometry" && operand.reference) {
      return createProjectedPrimitiveRef(operand.reference);
    }

    if (operand.kind === "sketchDatum" && operand.datum) {
      return {
        kind: "sketchDatumReference",
        sketchId,
        datumId: operand.datum,
        geometryKind: operand.datum === "origin" ? "point" : "lineSegment",
      };
    }

    return null;
  };

  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance":
      return dimension.pointIds.map((pointId) =>
        createSketchPointRef(sketchId, pointId),
      );
    case "pointDatumDistance":
      return [
        createSketchPointRef(sketchId, dimension.point.pointId),
        createReferencePrimitiveRef(dimension.datum, sketchId)!,
      ];
    case "circleRadius":
    case "diameter":
      return [createSketchEntityRef(sketchId, dimension.entityId)];
    case "lineLength":
      return [createSketchEntityRef(sketchId, dimension.entityId)];
    case "lineDistance":
    case "lineAngle":
      return dimension.lines
        .map(operandRef)
        .filter((ref): ref is PrimitiveRef => ref !== null);
    case "linePointDistance":
      return [operandRef(dimension.line), operandRef(dimension.point)].filter(
        (ref): ref is PrimitiveRef => ref !== null,
      );
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return [
        createSketchEntityRef(sketchId, dimension.entityId),
        createSketchPointRef(sketchId, dimension.pointId),
      ];
  }
}

export function createConstraintAnnotationAnchor(
  session: SketchSessionState,
  constraint: ConstraintDefinition,
): SketchToolAnchorDescriptor {
  const definition = session.definition;
  switch (constraint.kind) {
    case "coincident":
    case "angle":
      return createOffsetAnnotationAnchor(
        getAveragePointPosition(definition, constraint.pointIds),
      );
    case "fixPoint":
      return createOffsetAnnotationAnchor(
        getPointPosition(definition, constraint.pointId),
      );
    case "horizontal":
    case "vertical":
      return createOffsetAnnotationAnchor(
        getEntityAnchor(definition, constraint.entityId),
      );
    case "equalOffset":
      return createOffsetAnnotationAnchor(
        getAverageEntityAnchor(
          definition,
          constraint.pairs.flatMap((pair) => [
            pair.seedEntityId,
            pair.offsetEntityId,
          ]),
        ),
      );
    case "parallel":
    case "perpendicular":
    case "equalLength":
    case "tangent":
    case "concentric":
      return createOffsetAnnotationAnchor(
        getAverageEntityAnchor(definition, constraint.entityIds),
      );
    case "midpoint":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getEntityAnchor(definition, constraint.line.entityId),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "midpointProjectedLine":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getReferenceGeometryAnchor(session, constraint.projectedLine),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "pointOnCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getEntityAnchor(
              definition,
              constraint.curve.entityId,
              getSketchSessionSolvedSnapshot(session),
            ),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "collinear":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getCollinearTargetAnchor(definition, constraint.target),
            getEntityAnchor(definition, constraint.line.entityId),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "collinearProjectedLine":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getCollinearTargetAnchor(definition, constraint.target),
            getReferenceGeometryAnchor(session, constraint.projectedLine),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "normal":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getEntityAnchor(definition, constraint.line.entityId),
            getEntityAnchor(definition, constraint.curve.entityId),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "normalProjectedCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getEntityAnchor(definition, constraint.line.entityId),
            getReferenceGeometryAnchor(session, constraint.projectedCurve),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "symmetric":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getAveragePointPosition(definition, constraint.pointIds),
            getEntityAnchor(definition, constraint.axis.entityId),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "symmetricProjectedLine":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getAveragePointPosition(definition, constraint.pointIds),
            getReferenceGeometryAnchor(session, constraint.projectedLine),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "coincidentProjectedPoint":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getReferenceGeometryAnchor(session, constraint.projectedPoint),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "pointOnProjectedCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getReferenceGeometryAnchor(session, constraint.projectedCurve),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "parallelProjectedLine":
    case "perpendicularProjectedLine":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getEntityAnchor(definition, constraint.line.entityId),
            getReferenceGeometryAnchor(session, constraint.projectedLine),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "tangentProjectedCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getEntityAnchor(definition, constraint.curve.entityId),
            getReferenceGeometryAnchor(session, constraint.projectedCurve),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "concentricProjectedCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getEntityAnchor(definition, constraint.curve.entityId),
            getReferenceGeometryAnchor(session, constraint.projectedCurve),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
  }
}

export function createDimensionAnnotationAnchor(
  session: SketchSessionState,
  definition: SketchDefinition,
  dimension: DimensionDefinition,
): SketchToolAnchorDescriptor {
  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance": {
      const first = getPointPosition(definition, dimension.pointIds[0]);
      const second = getPointPosition(definition, dimension.pointIds[1]);
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const axis =
        dimension.kind === "distance"
          ? dimension.axis
          : dimension.kind === "horizontalDistance"
            ? "horizontal"
            : "vertical";
      const line = createPlacedPointDimensionLine(
        first,
        second,
        axis,
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getSketchMidpoint(line.start, line.end),
        offset: { x: 0, y: -18 },
      };
    }
    case "pointDatumDistance": {
      const first = getReferencePointGeometry(
        definition,
        session,
        dimension.point,
      );
      const second = getReferencePointGeometry(
        definition,
        session,
        dimension.datum,
      );
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const line = createPlacedPointDimensionLine(
        first,
        second,
        dimension.axis,
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getSketchMidpoint(line.start, line.end),
        offset: { x: 0, y: -18 },
      };
    }
    case "circleRadius":
    case "diameter": {
      const circle = getCircleLikeGeometry(definition, dimension.entityId);
      if (!circle) {
        return createOffsetAnnotationAnchor(
          getEntityAnchor(definition, dimension.entityId),
          { x: 22, y: -22 },
        );
      }

      const angle = dimension.annotationPlacement?.angleRadians ?? 0;
      const end: SketchPoint = [
        circle.center[0] + Math.cos(angle) * circle.radius,
        circle.center[1] + Math.sin(angle) * circle.radius,
      ];
      return { kind: "sketchPoint", point: end, offset: { x: 16, y: -16 } };
    }
    case "lineLength": {
      const lineGeometry = getLineSegmentGeometry(
        definition,
        dimension.entityId,
      );
      if (!lineGeometry) {
        return createOffsetAnnotationAnchor(
          getEntityAnchor(definition, dimension.entityId),
          { x: 0, y: -28 },
        );
      }

      const line = createPlacedLineLength(
        lineGeometry,
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getSketchMidpoint(line.start, line.end),
        offset: { x: 0, y: -18 },
      };
    }
    case "lineDistance": {
      const first = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[0],
      );
      const second = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[1],
      );
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const line = createPlacedLineDistance(
        first,
        getSketchMidpoint(second.start, second.end),
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getSketchMidpoint(line.start, line.end),
        offset: { x: 0, y: -18 },
      };
    }
    case "linePointDistance": {
      const lineGeometry = getReferenceLineGeometry(
        definition,
        session,
        dimension.line,
      );
      const point = getReferencePointGeometry(
        definition,
        session,
        dimension.point,
      );
      if (!lineGeometry || !point) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const line = createPlacedLineDistance(
        lineGeometry,
        point,
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getSketchMidpoint(line.start, line.end),
        offset: { x: 0, y: -18 },
      };
    }
    case "lineAngle": {
      const first = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[0],
      );
      const second = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[1],
      );
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const center = getSketchLineIntersection(first, second) ?? first.start;
      const firstVector = getSketchLineDirectionFromCenter(first, center);
      const secondVector = getSketchLineDirectionFromCenter(second, center);
      const radius = dimension.annotationPlacement?.radius ?? 1;
      const side = dimension.annotationPlacement?.side ?? "minor";
      return {
        kind: "sketchPoint",
        point: getSketchAngleLabelPoint(
          center,
          firstVector,
          secondVector,
          radius,
          side,
        ),
        offset: { x: 12, y: -12 },
      };
    }
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return createOffsetAnnotationAnchor(
        getAveragePointPosition(
          definition,
          [
            getEntityAnchorPointId(definition, dimension.entityId),
            dimension.pointId,
          ].filter((pointId): pointId is SketchPointId => Boolean(pointId)),
        ),
      );
  }
}

export function buildCommittedDimensionOverlays(
  session: SketchSessionState,
  definition: SketchDefinition,
): readonly SketchToolOverlayDescriptor[] {
  return definition.dimensions.flatMap(
    (dimension): SketchToolOverlayDescriptor[] => {
      switch (dimension.kind) {
        case "distance":
        case "horizontalDistance":
        case "verticalDistance": {
          const first = getPointPosition(definition, dimension.pointIds[0]);
          const second = getPointPosition(definition, dimension.pointIds[1]);
          if (!first || !second) {
            return [];
          }

          const axis =
            dimension.kind === "distance"
              ? dimension.axis
              : dimension.kind === "horizontalDistance"
                ? "horizontal"
                : "vertical";
          const line = createPlacedPointDimensionLine(
            first,
            second,
            axis,
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: axis,
              start: line.start,
              end: line.end,
              value: isReferenceDimension(dimension) ? null : dimension.value,
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getSketchMidpoint(line.start, line.end),
                offset: { x: 0, y: -18 },
              },
              extensionLines: [
                {
                  id: `${dimension.dimensionId}-extension-a`,
                  label: "Extension",
                  start: first,
                  end: line.start,
                },
                {
                  id: `${dimension.dimensionId}-extension-b`,
                  label: "Extension",
                  start: second,
                  end: line.end,
                },
              ],
            },
          ];
        }
        case "pointDatumDistance": {
          const first = getReferencePointGeometry(
            definition,
            session,
            dimension.point,
          );
          const second = getReferencePointGeometry(
            definition,
            session,
            dimension.datum,
          );
          if (!first || !second) {
            return [];
          }

          const line = createPlacedPointDimensionLine(
            first,
            second,
            dimension.axis,
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: dimension.axis,
              start: line.start,
              end: line.end,
              value: isReferenceDimension(dimension) ? null : dimension.value,
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getSketchMidpoint(line.start, line.end),
                offset: { x: 0, y: -18 },
              },
              extensionLines: [
                {
                  id: `${dimension.dimensionId}-extension-a`,
                  label: "Extension",
                  start: first,
                  end: line.start,
                },
                {
                  id: `${dimension.dimensionId}-extension-b`,
                  label: "Extension",
                  start: second,
                  end: line.end,
                },
              ],
            },
          ];
        }
        case "circleRadius":
        case "diameter": {
          const circle = getCircleLikeGeometry(definition, dimension.entityId);
          if (!circle) {
            return [];
          }

          const angle = dimension.annotationPlacement?.angleRadians ?? 0;
          const direction: SketchPoint = [Math.cos(angle), Math.sin(angle)];
          const start: SketchPoint =
            dimension.kind === "diameter"
              ? [
                  circle.center[0] - direction[0] * circle.radius,
                  circle.center[1] - direction[1] * circle.radius,
                ]
              : circle.center;
          const end: SketchPoint = [
            circle.center[0] + direction[0] * circle.radius,
            circle.center[1] + direction[1] * circle.radius,
          ];
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind:
                dimension.kind === "diameter" ? "diameter" : "radius",
              start,
              end,
              value: isReferenceDimension(dimension) ? null : dimension.value,
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: end,
                offset: { x: 16, y: -16 },
              },
            },
          ];
        }
        case "lineLength": {
          const lineGeometry = getLineSegmentGeometry(
            definition,
            dimension.entityId,
          );
          if (!lineGeometry) {
            return [];
          }

          const line = createPlacedLineLength(
            lineGeometry,
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: "lineLength",
              start: line.start,
              end: line.end,
              value: isReferenceDimension(dimension) ? null : dimension.value,
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getSketchMidpoint(line.start, line.end),
                offset: { x: 0, y: -18 },
              },
              extensionLines:
                line.offset === 0
                  ? []
                  : [
                      {
                        id: `${dimension.dimensionId}-extension-a`,
                        label: "Extension",
                        start: lineGeometry.start,
                        end: line.start,
                      },
                      {
                        id: `${dimension.dimensionId}-extension-b`,
                        label: "Extension",
                        start: lineGeometry.end,
                        end: line.end,
                      },
                    ],
            },
          ];
        }
        case "lineDistance": {
          const first = getReferenceLineGeometry(
            definition,
            session,
            dimension.lines[0],
          );
          const second = getReferenceLineGeometry(
            definition,
            session,
            dimension.lines[1],
          );
          if (!first || !second) {
            return [];
          }

          const line = createPlacedLineDistance(
            first,
            getSketchMidpoint(second.start, second.end),
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: "lineDistance",
              start: line.start,
              end: line.end,
              value: isReferenceDimension(dimension) ? null : dimension.value,
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getSketchMidpoint(line.start, line.end),
                offset: { x: 0, y: -18 },
              },
            },
          ];
        }
        case "linePointDistance": {
          const lineGeometry = getReferenceLineGeometry(
            definition,
            session,
            dimension.line,
          );
          const point = getReferencePointGeometry(
            definition,
            session,
            dimension.point,
          );
          if (!lineGeometry || !point) {
            return [];
          }

          const line = createPlacedLineDistance(
            lineGeometry,
            point,
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: "pointLineDistance",
              start: line.start,
              end: line.end,
              value: isReferenceDimension(dimension) ? null : dimension.value,
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getSketchMidpoint(line.start, line.end),
                offset: { x: 0, y: -18 },
              },
            },
          ];
        }
        case "lineAngle": {
          const first = getReferenceLineGeometry(
            definition,
            session,
            dimension.lines[0],
          );
          const second = getReferenceLineGeometry(
            definition,
            session,
            dimension.lines[1],
          );
          if (!first || !second) {
            return [];
          }

          const center =
            getSketchLineIntersection(first, second) ?? first.start;
          const firstVector = getSketchLineDirectionFromCenter(first, center);
          const secondVector = getSketchLineDirectionFromCenter(second, center);
          const radius = dimension.annotationPlacement?.radius ?? 1;
          const side = dimension.annotationPlacement?.side ?? "minor";
          const start: SketchPoint = [
            center[0] + firstVector[0] * radius,
            center[1] + firstVector[1] * radius,
          ];
          const end: SketchPoint = [
            center[0] + secondVector[0] * radius,
            center[1] + secondVector[1] * radius,
          ];
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "angleArc",
              label: dimension.label,
              center,
              start,
              end,
              radius,
              side,
              witnessLines: createAngleWitnessLines(
                `${dimension.dimensionId}-overlay`,
                first,
                second,
                start,
                end,
              ),
              labelAnchor: {
                kind: "sketchPoint",
                point: getSketchAngleLabelPoint(
                  center,
                  firstVector,
                  secondVector,
                  radius,
                  side,
                ),
                offset: { x: 12, y: -12 },
              },
            },
          ];
        }
        case "arcStartPointCoincident":
        case "arcEndPointCoincident":
          return [];
      }
    },
  );
}

export function getSketchMidpoint(
  first: SketchPoint,
  second: SketchPoint,
): SketchPoint {
  return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
}

export function normalizeSketchVector(vector: SketchPoint): SketchPoint {
  const length = Math.hypot(vector[0], vector[1]);
  return length <= 1e-6 ? [1, 0] : [vector[0] / length, vector[1] / length];
}

export function projectPointOntoLineSegment(
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
): SketchPoint {
  const vector: SketchPoint = [
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
  ];
  const lengthSquared = vector[0] * vector[0] + vector[1] * vector[1];

  if (lengthSquared <= 1e-9) {
    return line.start;
  }

  const offset: SketchPoint = [
    point[0] - line.start[0],
    point[1] - line.start[1],
  ];
  const ratio = Math.max(
    0,
    Math.min(
      1,
      (offset[0] * vector[0] + offset[1] * vector[1]) / lengthSquared,
    ),
  );

  return [line.start[0] + vector[0] * ratio, line.start[1] + vector[1] * ratio];
}

export function createAngleWitnessLines(
  id: string,
  first: { start: SketchPoint; end: SketchPoint },
  second: { start: SketchPoint; end: SketchPoint },
  start: SketchPoint,
  end: SketchPoint,
) {
  return [
    createAngleWitnessLine(`${id}-witness-a`, first, start),
    createAngleWitnessLine(`${id}-witness-b`, second, end),
  ].filter((line): line is NonNullable<typeof line> => line !== null);
}

export function createAngleWitnessLine(
  id: string,
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
) {
  const anchor = projectPointOntoLineSegment(line, point);

  return Math.hypot(point[0] - anchor[0], point[1] - anchor[1]) <= 1e-6
    ? null
    : {
        id,
        label: "Witness",
        start: anchor,
        end: point,
      };
}

export function getSketchCrossProduct(first: SketchPoint, second: SketchPoint) {
  return first[0] * second[1] - first[1] * second[0];
}

export function getSketchLineIntersection(
  first: { start: SketchPoint; end: SketchPoint },
  second: { start: SketchPoint; end: SketchPoint },
): SketchPoint | null {
  const firstVector: SketchPoint = [
    first.end[0] - first.start[0],
    first.end[1] - first.start[1],
  ];
  const secondVector: SketchPoint = [
    second.end[0] - second.start[0],
    second.end[1] - second.start[1],
  ];
  const denominator = getSketchCrossProduct(firstVector, secondVector);

  if (Math.abs(denominator) <= 1e-9) {
    return null;
  }

  const delta: SketchPoint = [
    second.start[0] - first.start[0],
    second.start[1] - first.start[1],
  ];
  const t = getSketchCrossProduct(delta, secondVector) / denominator;

  return [
    first.start[0] + firstVector[0] * t,
    first.start[1] + firstVector[1] * t,
  ];
}

export function getSketchLineDirectionFromCenter(
  line: { start: SketchPoint; end: SketchPoint },
  center: SketchPoint,
): SketchPoint {
  const midpoint = getSketchMidpoint(line.start, line.end);
  const towardMidpoint = normalizeSketchVector([
    midpoint[0] - center[0],
    midpoint[1] - center[1],
  ]);
  const lineUnit = normalizeSketchVector([
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
  ]);
  const dot = towardMidpoint[0] * lineUnit[0] + towardMidpoint[1] * lineUnit[1];

  return dot >= 0 ? lineUnit : [-lineUnit[0], -lineUnit[1]];
}

export function normalizeSketchSignedAngleDelta(delta: number) {
  if (delta > Math.PI) {
    return delta - Math.PI * 2;
  }

  if (delta < -Math.PI) {
    return delta + Math.PI * 2;
  }

  return delta;
}

export function normalizeSketchPositiveAngleDelta(delta: number) {
  const normalized = delta % (Math.PI * 2);
  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

export function getSketchAngleArcSide(input: {
  center: SketchPoint;
  startVector: SketchPoint;
  endVector: SketchPoint;
  point: SketchPoint;
}): "minor" | "major" {
  const startAngle = Math.atan2(input.startVector[1], input.startVector[0]);
  const endAngle = Math.atan2(input.endVector[1], input.endVector[0]);
  const pointAngle = Math.atan2(
    input.point[1] - input.center[1],
    input.point[0] - input.center[0],
  );
  const minorDelta = normalizeSketchSignedAngleDelta(endAngle - startAngle);
  const minorSweep = Math.abs(minorDelta);

  if (minorSweep <= 1e-9) {
    return "minor";
  }

  const pointSweep =
    minorDelta >= 0
      ? normalizeSketchPositiveAngleDelta(pointAngle - startAngle)
      : normalizeSketchPositiveAngleDelta(startAngle - pointAngle);

  return pointSweep <= minorSweep ? "minor" : "major";
}

export function getSketchAngleLabelPoint(
  center: SketchPoint,
  firstVector: SketchPoint,
  secondVector: SketchPoint,
  radius: number,
  side: "minor" | "major",
): SketchPoint {
  const labelDirection = normalizeSketchVector(
    side === "major"
      ? [
          -(firstVector[0] + secondVector[0]),
          -(firstVector[1] + secondVector[1]),
        ]
      : [firstVector[0] + secondVector[0], firstVector[1] + secondVector[1]],
  );

  return [
    center[0] + labelDirection[0] * radius,
    center[1] + labelDirection[1] * radius,
  ];
}

export function getPointPairAnnotationPlacementFromPoint(
  first: SketchPoint,
  second: SketchPoint,
  axis: "aligned" | "horizontal" | "vertical",
  point: SketchPoint,
): DimensionAnnotationPlacement {
  if (axis === "horizontal") {
    return { kind: "dimensionLine", offset: point[1] - first[1] };
  }

  if (axis === "vertical") {
    return { kind: "dimensionLine", offset: point[0] - first[0] };
  }

  const axisVector = normalizeSketchVector([
    second[0] - first[0],
    second[1] - first[1],
  ]);
  const normal: SketchPoint = [-axisVector[1], axisVector[0]];
  return {
    kind: "dimensionLine",
    offset:
      (point[0] - first[0]) * normal[0] + (point[1] - first[1]) * normal[1],
  };
}

export function getLineAnnotationPlacementFromPoint(
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
): DimensionAnnotationPlacement {
  return {
    kind: "dimensionLine",
    offset: getSketchLineSignedDistance(point, line),
  };
}

export function getSketchLineSignedDistance(
  point: SketchPoint,
  line: { start: SketchPoint; end: SketchPoint },
) {
  const axisVector = normalizeSketchVector([
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
  ]);
  const normal: SketchPoint = [-axisVector[1], axisVector[0]];
  return (
    (point[0] - line.start[0]) * normal[0] +
    (point[1] - line.start[1]) * normal[1]
  );
}

export function getLineSegmentGeometry(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): { start: SketchPoint; end: SketchPoint } | null {
  const entity = definition.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
  if (!entity || entity.kind !== "lineSegment") {
    return null;
  }

  const start = getPointPosition(definition, entity.startPointId);
  const end = getPointPosition(definition, entity.endPointId);
  return start && end ? { start, end } : null;
}

export function getCircleLikeGeometry(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): { center: SketchPoint; radius: number } | null {
  const entity = definition.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
  if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
    return null;
  }

  const center = getPointPosition(definition, entity.centerPointId);
  if (!center) {
    return null;
  }

  if (entity.kind === "circle") {
    return { center, radius: entity.radius };
  }

  const start = getPointPosition(definition, entity.startPointId);
  return start
    ? { center, radius: Math.hypot(start[0] - center[0], start[1] - center[1]) }
    : null;
}

export function createPlacedPointDimensionLine(
  first: SketchPoint,
  second: SketchPoint,
  axis: "aligned" | "horizontal" | "vertical",
  placement: DimensionAnnotationPlacement | undefined,
): { start: SketchPoint; end: SketchPoint } {
  if (axis === "horizontal") {
    const y =
      first[1] + (placement?.kind === "dimensionLine" ? placement.offset : -1);
    return { start: [first[0], y], end: [second[0], y] };
  }

  if (axis === "vertical") {
    const x =
      first[0] + (placement?.kind === "dimensionLine" ? placement.offset : 1);
    return { start: [x, first[1]], end: [x, second[1]] };
  }

  const axisVector = normalizeSketchVector([
    second[0] - first[0],
    second[1] - first[1],
  ]);
  const normal: SketchPoint = [-axisVector[1], axisVector[0]];
  const offset = placement?.kind === "dimensionLine" ? placement.offset : 0;
  return {
    start: [first[0] + normal[0] * offset, first[1] + normal[1] * offset],
    end: [second[0] + normal[0] * offset, second[1] + normal[1] * offset],
  };
}

export function createPlacedLineDistance(
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
  placement: DimensionAnnotationPlacement | undefined,
): { start: SketchPoint; end: SketchPoint } {
  const axisVector = normalizeSketchVector([
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
  ]);
  const normal: SketchPoint = [-axisVector[1], axisVector[0]];
  const signedDistance =
    (point[0] - line.start[0]) * normal[0] +
    (point[1] - line.start[1]) * normal[1];
  const offset =
    placement?.kind === "dimensionLine" ? placement.offset : signedDistance;
  const projected: SketchPoint = [
    point[0] - normal[0] * signedDistance,
    point[1] - normal[1] * signedDistance,
  ];
  return {
    start: [
      projected[0] + normal[0] * offset,
      projected[1] + normal[1] * offset,
    ],
    end: [
      point[0] + normal[0] * (offset - signedDistance),
      point[1] + normal[1] * (offset - signedDistance),
    ],
  };
}

export function createPlacedLineLength(
  line: { start: SketchPoint; end: SketchPoint },
  placement: DimensionAnnotationPlacement | undefined,
): { start: SketchPoint; end: SketchPoint; offset: number } {
  const axisVector = normalizeSketchVector([
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
  ]);
  const normal: SketchPoint = [-axisVector[1], axisVector[0]];
  const offset = placement?.kind === "dimensionLine" ? placement.offset : 0;

  return {
    start: [
      line.start[0] + normal[0] * offset,
      line.start[1] + normal[1] * offset,
    ],
    end: [line.end[0] + normal[0] * offset, line.end[1] + normal[1] * offset],
    offset,
  };
}

export function createOffsetAnnotationAnchor(
  point: SketchPoint | null,
  offset = { x: 18, y: -18 },
): SketchToolAnchorDescriptor {
  return {
    kind: "sketchPoint",
    point: point ?? [0, 0],
    offset,
  };
}

export function createProjectedPrimitiveRef(
  reference: ProjectedSketchGeometryRef & {
    kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
  },
): PrimitiveRef {
  return {
    kind: "projectedReferenceGeometry",
    referenceId: reference.referenceId,
    geometryId: reference.geometryId,
    geometryKind:
      reference.kind === "projectedPoint"
        ? "point"
        : reference.kind === "projectedLineSegment"
          ? "lineSegment"
          : reference.kind === "projectedCircle"
            ? "circle"
            : reference.kind === "projectedArc"
              ? "arc"
              : "spline",
  };
}

export function createReferencePrimitiveRef(
  operand: {
    kind: string;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
  sketchId: SketchId,
): PrimitiveRef | null {
  if (operand.kind === "projectedGeometry" && operand.reference) {
    return createProjectedPrimitiveRef(operand.reference);
  }

  if (operand.kind === "sketchDatum" && operand.datum) {
    return {
      kind: "sketchDatumReference",
      sketchId,
      datumId: operand.datum,
      geometryKind: operand.datum === "origin" ? "point" : "lineSegment",
    };
  }

  return null;
}

export function getDatumAnchor(
  datum: "origin" | "xAxis" | "yAxis",
): SketchPoint {
  switch (datum) {
    case "origin":
      return [0, 0];
    case "xAxis":
    case "yAxis":
      return [0, 0];
  }
}

export function getProjectedGeometryAnchor(
  session: SketchSessionState,
  reference: ProjectedSketchGeometryRef & {
    kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
  },
): SketchPoint | null {
  const projectedReference = session.projectedReferences.find(
    (entry) => entry.referenceId === reference.referenceId,
  );

  if (!projectedReference || projectedReference.status !== "projected") {
    return null;
  }

  const geometry = projectedReference.geometry.find(
    (entry) => entry.geometryId === reference.geometryId,
  );

  if (!geometry) {
    return null;
  }

  switch (geometry.kind) {
    case "point":
      return geometry.position;
    case "lineSegment":
      return [
        (geometry.startPosition[0] + geometry.endPosition[0]) / 2,
        (geometry.startPosition[1] + geometry.endPosition[1]) / 2,
      ];
    case "circle":
    case "arc":
      return geometry.centerPosition;
    case "spline":
      // Its start point: the first sample, or pole 0 of the first span.
      return geometry.representation.kind === "sourceSamples"
        ? (geometry.representation.points[0] ?? null)
        : (geometry.representation.spans[0]?.poles[0] ?? null);
  }
}

export function getReferenceGeometryAnchor(
  session: SketchSessionState,
  operand: {
    kind: string;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
): SketchPoint | null {
  if (operand.kind === "projectedGeometry" && operand.reference) {
    return getProjectedGeometryAnchor(session, operand.reference);
  }

  if (operand.kind === "sketchDatum" && operand.datum) {
    return getDatumAnchor(operand.datum);
  }

  return null;
}

export function createCollinearTargetPrimitiveRef(
  sketchId: SketchId,
  target: LocalCollinearTargetOperand,
): PrimitiveRef {
  return target.kind === "localPoint"
    ? createSketchPointRef(sketchId, target.pointId)
    : createSketchEntityRef(sketchId, target.entityId);
}

export function getCollinearTargetAnchor(
  definition: SketchDefinition,
  target: LocalCollinearTargetOperand,
): SketchPoint | null {
  return target.kind === "localPoint"
    ? getPointPosition(definition, target.pointId)
    : getEntityAnchor(definition, target.entityId);
}

export function getReferenceLineGeometry(
  definition: SketchDefinition,
  session: SketchSessionState,
  operand: {
    kind: string;
    entityId?: SketchEntityId;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
): { start: SketchPoint; end: SketchPoint } | null {
  if (operand.kind === "localEntity" && operand.entityId) {
    return getLineSegmentGeometry(definition, operand.entityId);
  }

  if (operand.kind === "projectedGeometry" && operand.reference) {
    const reference = operand.reference;
    const projectedReference = session.projectedReferences.find(
      (entry) => entry.referenceId === reference.referenceId,
    );
    const geometry = projectedReference?.geometry.find(
      (entry) => entry.geometryId === reference.geometryId,
    );
    return geometry?.kind === "lineSegment"
      ? { start: geometry.startPosition, end: geometry.endPosition }
      : null;
  }

  if (
    operand.kind === "sketchDatum" &&
    operand.datum &&
    operand.datum !== "origin"
  ) {
    const extent = getSketchDatumGuideExtent(
      definition,
      session.projectedReferences,
    );
    return operand.datum === "xAxis"
      ? { start: [-extent, 0], end: [extent, 0] }
      : { start: [0, -extent], end: [0, extent] };
  }

  return null;
}

export function getReferencePointGeometry(
  definition: SketchDefinition,
  session: SketchSessionState,
  operand: {
    kind: string;
    pointId?: SketchPointId;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
): SketchPoint | null {
  if (operand.kind === "localPoint" && operand.pointId) {
    return getPointPosition(definition, operand.pointId);
  }

  return getReferenceGeometryAnchor(session, operand);
}

export function getPointPosition(
  definition: SketchDefinition,
  pointId: SketchPointId,
): SketchPoint | null {
  return (
    definition.points.find((point) => point.pointId === pointId)?.position ??
    null
  );
}

export function getAveragePointPosition(
  definition: SketchDefinition,
  pointIds: readonly SketchPointId[],
): SketchPoint | null {
  const points = pointIds.flatMap((pointId) => {
    const position = getPointPosition(definition, pointId);
    return position ? [position] : [];
  });

  return getAverageSketchPoint(points);
}

export function getAverageEntityAnchor(
  definition: SketchDefinition,
  entityIds: readonly SketchEntityId[],
): SketchPoint | null {
  const points = entityIds.flatMap((entityId) => {
    const position = getEntityAnchor(definition, entityId);
    return position ? [position] : [];
  });

  return getAverageSketchPoint(points);
}

export function getEntityAnchor(
  definition: SketchDefinition,
  entityId: SketchEntityId,
  /** T08b-g5b: places a derived offset shell's anchor on its solved curve. */
  solvedSnapshot: SolvedSketchSnapshot | null = null,
): SketchPoint | null {
  const entity = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );

  if (!entity) {
    return null;
  }

  switch (entity.kind) {
    case "lineSegment":
      return getAveragePointPosition(definition, [
        entity.startPointId,
        entity.endPointId,
      ]);
    case "point":
      return getPointPosition(definition, entity.pointId);
    case "circle":
      return getPointPosition(definition, entity.centerPointId);
    case "arc":
      return getPointPosition(definition, entity.centerPointId);
    case "spline":
      return getAveragePointPosition(definition, orderedSplinePointIds(entity));
    case "ellipse":
      return getPointPosition(definition, entity.centerPointId);
    case "ellipticalArc":
      return getPointPosition(definition, entity.centerPointId);
    case "conic":
      return getAveragePointPosition(definition, [
        entity.startPointId,
        entity.controlPointId,
        entity.endPointId,
      ]);
    case "bezierCurve":
      return getAveragePointPosition(definition, entity.controlPointIds);
    case "profileText":
      return getPointPosition(definition, entity.anchorPointId);
    case "derivedPiecewiseCubic":
      return getDerivedShellAnchor(definition, entityId, solvedSnapshot);
  }
}

/**
 * A derived offset shell's anchor lies on the curve (T08b-g5b): the point at
 * the middle of the drawn (`queryDomain`) source-parameter range of its
 * solved spans, provisional or certified. Without its solved record, the
 * shell's start terminal driven point (the mean of the terminals can lie off
 * an open curve).
 */
function getDerivedShellAnchor(
  definition: SketchDefinition,
  entityId: SketchEntityId,
  solvedSnapshot: SolvedSketchSnapshot | null,
): SketchPoint | null {
  const record = solvedSnapshot?.solvedEntities.find(
    (entry) => entry.entityId === entityId,
  );
  const spans = record ? solvedCubicSpans(record) : [];
  const drawn = (span: SolvedCubicSpan) => span.queryDomain ?? span.interval;
  const first = spans[0];
  const last = spans.at(-1);
  if (first && last) {
    const middle = (drawn(first)[0] + drawn(last)[1]) / 2;
    const span =
      spans.find(
        (candidate) =>
          drawn(candidate)[0] <= middle && middle <= drawn(candidate)[1],
      ) ?? last;
    const [low, high] = span.interval;
    return solvedCubicSpanPoint(
      span,
      Math.min(1, Math.max(0, (middle - low) / (high - low))),
    );
  }
  const output = definition.derivedRelationships
    ?.flatMap((relationship) =>
      relationship.kind === "offset" ? relationship.piecewiseCubicOutputs : [],
    )
    .find((candidate) => candidate.outputEntityId === entityId);
  return output ? getPointPosition(definition, output.startPointId) : null;
}

export function getEntityAnchorPointId(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): SketchPointId | null {
  const entity = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );

  if (!entity) {
    return null;
  }

  switch (entity.kind) {
    case "lineSegment":
      return entity.startPointId;
    case "point":
      return entity.pointId;
    case "circle":
    case "arc":
      return entity.centerPointId;
    case "spline":
      return orderedSplinePointIds(entity)[0] ?? null;
    case "ellipse":
    case "ellipticalArc":
      return entity.centerPointId;
    case "conic":
      return entity.startPointId;
    case "bezierCurve":
      return entity.controlPointIds[0] ?? null;
    case "profileText":
      return entity.anchorPointId;
    case "derivedPiecewiseCubic":
      return null;
  }
}

export function getAverageSketchPoint(
  points: readonly SketchPoint[],
): SketchPoint | null {
  if (points.length === 0) {
    return null;
  }

  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

export function describeConstraint(constraint: ConstraintDefinition) {
  switch (constraint.kind) {
    case "coincident":
      return "Coincident points";
    case "parallel":
      return "Parallel lines";
    case "equalOffset":
      return "Equal line offsets";
    case "equalLength":
      return "Equal-length lines";
    case "horizontal":
      return "Horizontal line";
    case "vertical":
      return "Vertical line";
    case "fixPoint":
      return "Fixed point";
    case "angle":
      return `${((constraint.valueRadians * 180) / Math.PI).toFixed(1)} deg`;
    case "perpendicular":
      return "Perpendicular lines";
    case "midpoint":
      return "Point at midpoint";
    case "midpointProjectedLine":
      return "Point at projected midpoint";
    case "pointOnCurve":
      return "Point on curve";
    case "collinear":
      return "Collinear";
    case "collinearProjectedLine":
      return "Collinear to projected line";
    case "coincidentProjectedPoint":
      return "Coincident projected point";
    case "pointOnProjectedCurve":
      return "Point on projected curve";
    case "parallelProjectedLine":
      return "Parallel to projected line";
    case "perpendicularProjectedLine":
      return "Perpendicular to projected line";
    case "tangentProjectedCurve":
      return "Tangent to projected curve";
    case "tangent":
      return "Tangent curves";
    case "concentric":
      return "Concentric curves";
    case "concentricProjectedCurve":
      return "Concentric with projected curve";
    case "normal":
      return "Line normal to curve";
    case "normalProjectedCurve":
      return "Line normal to projected curve";
    case "symmetric":
      return "Symmetric points";
    case "symmetricProjectedLine":
      return "Symmetric points about projected line";
  }
}

const CALCULATED_DIMENSION_SYMBOL = "\u0192"; // ƒ denotes an expression-driven value.

function formatAuthoredDimensionNumber(
  value: MaybeAuthoredValue<number>,
  digits: number,
  resolvedValue?: number,
) {
  if (isExpressionAuthoredValue(value)) {
    return resolvedValue === undefined
      ? `${CALCULATED_DIMENSION_SYMBOL} ${getAuthoredFormText(value)}`
      : `${CALCULATED_DIMENSION_SYMBOL} ${resolvedValue.toFixed(digits)}`;
  }

  const literal = getAuthoredLiteralValue(value);
  return literal === null
    ? getAuthoredFormText(value)
    : literal.toFixed(digits);
}

function formatAuthoredDimensionDegrees(
  value: MaybeAuthoredValue<number>,
  digits: number,
  resolvedRadians?: number,
) {
  if (isExpressionAuthoredValue(value)) {
    return resolvedRadians === undefined
      ? `${CALCULATED_DIMENSION_SYMBOL} ${getAuthoredFormText(value)}`
      : `${CALCULATED_DIMENSION_SYMBOL} ${((resolvedRadians * 180) / Math.PI).toFixed(digits)}`;
  }

  const literal = getAuthoredLiteralValue(value);
  return literal === null
    ? getAuthoredFormText(value)
    : ((literal * 180) / Math.PI).toFixed(digits);
}
/**
 * T13d (D12): a reference dimension's measured value in parentheses, e.g.
 * "(24.00)" or "(60.0°)"; "(—)" when the quantity is undefined.
 */
function formatReferenceDimensionValue(
  dimension: DimensionDefinition,
  measuredValue: number | null,
) {
  if (measuredValue === null) {
    return "(—)";
  }
  return dimension.kind === "lineAngle"
    ? `(${((measuredValue * 180) / Math.PI).toFixed(1)}°)`
    : `(${Math.abs(measuredValue).toFixed(2)})`;
}

function getDimensionQuantityNoun(dimension: DimensionDefinition) {
  switch (dimension.kind) {
    case "circleRadius":
      return "radius";
    case "diameter":
      return "diameter";
    case "lineLength":
      return "length";
    case "lineAngle":
      return "angle";
    default:
      return "distance";
  }
}

export function describeDimension(
  dimension: DimensionDefinition,
  resolvedValue?: number | null,
) {
  if (isReferenceDimension(dimension)) {
    // Review A-5: the angle's "°" is its unit.
    const unit = dimension.kind === "lineAngle" ? "" : " mm";
    return `${formatReferenceDimensionValue(dimension, resolvedValue ?? null)}${unit} reference ${getDimensionQuantityNoun(dimension)}`;
  }
  const resolved = resolvedValue ?? undefined;
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
      return `${formatAuthoredDimensionNumber(dimension.value, 2, resolved)} mm ${getDimensionQuantityNoun(dimension)}`;
    case "lineAngle":
      return `${formatAuthoredDimensionDegrees(dimension.valueRadians, 1, resolved)} deg angle`;
    case "arcStartPointCoincident":
      return "Arc start coincident";
    case "arcEndPointCoincident":
      return "Arc end coincident";
  }
}

export function formatDimensionVisibleLabel(
  dimension: DimensionDefinition,
  resolvedValue?: number | null,
) {
  if (isReferenceDimension(dimension)) {
    return formatReferenceDimensionValue(dimension, resolvedValue ?? null);
  }
  const resolved = resolvedValue ?? undefined;
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
      return formatAuthoredDimensionNumber(dimension.value, 2, resolved);
    case "lineAngle":
      return `${formatAuthoredDimensionDegrees(dimension.valueRadians, 1, resolved)}°`;
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return "Coincident";
  }
}
