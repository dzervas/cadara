import type {
  SketchSessionState,
  SketchAnnotationEditState,
  SketchAnnotationEditTarget,
} from "./types";
import {
  isReferenceDimension,
  requireDrivingDimensionValue,
} from "@/contracts/sketch/schema";
import type {
  SketchDefinition,
  DimensionDefinition,
  DimensionAnnotationPlacement,
  DimensionLineAnnotationPlacement,
} from "@/contracts/sketch/schema";
import type { SketchDimensionRef } from "@/contracts/shared/references";
import type { SketchPoint } from "@/contracts/modeling/schema";
import {
  getPointPosition,
  getReferenceLineGeometry,
  getReferencePointGeometry,
  getEntityAnchor,
} from "./annotation-reference-geometry";
import {
  inferPointPairLabelPlacement,
  getPointDatumDistanceGeometry,
  getCircleLikeGeometry,
  createPlacedCircleDimensionLine,
  getLineSegmentGeometry,
  getLineAnnotationPlacementFromPoint,
  createPlacedLineLength,
  getSketchLineIntersection,
  getSketchLineDirectionFromCenter,
  getSketchAngleArcSide,
} from "./annotation-geometry";
import {
  withDimensionLabelPosition,
  inferParallelLineDimensionPlacement,
  createPlacedParallelLineDistance,
  inferLinePointDimensionPlacement,
} from "@/core/sketch-constraints/registry";
import type {
  SketchToolPresentationSchema,
  SketchToolAnchorDescriptor,
} from "@/core/sketch-tools/editor-schema";
import {
  getAuthoredFormText,
  getAuthoredLiteralValue,
  createLiteralAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { AuthoredValue } from "@/contracts/modeling/authored-values";
import {
  getSketchSessionSharedMirrorDimensions,
  describeSharedMirrorPath,
} from "./session-feedback";
import { getTargetKey } from "./tool-authoring";
import { buildSketchAnnotationDescriptors } from "./annotation-descriptors";
import { addAnchorOffset } from "../../../core/editor/sketch-session/definition-patches";

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
      return inferPointPairLabelPlacement(first, second, axis, point);
    }
    case "pointDatumDistance": {
      const measured = getPointDatumDistanceGeometry(
        definition,
        session,
        dimension,
      );
      return measured
        ? inferPointPairLabelPlacement(
            measured.point,
            measured.datum,
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

      const placement: DimensionLineAnnotationPlacement = {
        kind: "dimensionLine",
        offset: 0,
        angleRadians: Math.atan2(
          point[1] - circle.center[1],
          point[0] - circle.center[0],
        ),
      };
      return withDimensionLabelPosition(
        placement,
        createPlacedCircleDimensionLine(circle, dimension.kind, placement),
        point,
      );
    }
    case "lineLength": {
      const line = getLineSegmentGeometry(definition, dimension.entityId);
      if (!line) {
        return null;
      }
      const placement = getLineAnnotationPlacementFromPoint(line, point);
      return withDimensionLabelPosition(
        placement,
        createPlacedLineLength(line, placement),
        point,
      );
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
      const placement = first
        ? inferParallelLineDimensionPlacement(first, point)
        : null;
      return placement && first && second
        ? withDimensionLabelPosition(
            placement,
            createPlacedParallelLineDistance(first, second, placement),
            point,
          )
        : placement;
    }
    case "linePointDistance": {
      const line = getReferenceLineGeometry(
        definition,
        session,
        dimension.line,
      );
      const measured = getReferencePointGeometry(
        definition,
        session,
        dimension.point,
      );
      return line && measured
        ? inferLinePointDimensionPlacement(line, measured, point)
        : null;
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
  const reference = edit.driving ? null : (editable?.reference ?? null);
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
        id: `annotation-edit-${annotationEditTargetKey(edit.target)}`,
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
      id: `annotation-edit-${annotationEditTargetKey(edit.target)}`,
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
      // O5: the same visible switch as creation; reference values cannot be
      // typed or submitted. The switch stages conversion, Save authors it.
      ...(reference
        ? {
            readOnly: true as const,
            hideSubmit: true as const,
            readout: `Measured ${reference.measuredValue === null ? "—" : `${reference.measuredValue.toFixed(2)} ${editable?.unit ?? ""}`.trim()}`,
            modeSwitch: {
              label: "Make driving",
              checked: false,
              action: {
                type: "patch" as const,
                patch: { intent: "makeAnnotationDriving" },
              },
            },
            ...(edit.drivingConflicts?.length
              ? {
                  secondaryAction: {
                    label: "Make those references",
                    action: {
                      type: "patch" as const,
                      patch: { intent: "replaceAnnotationDrivers" },
                    },
                  },
                }
              : {}),
          }
        : (sharedPresentation ??
          (editable?.canBeReference || edit.driving
            ? {
                ...(duplicates ? { readout: duplicates } : {}),
                modeSwitch: {
                  label: "Make driving",
                  checked: true,
                  action: {
                    type: "patch" as const,
                    patch: { intent: "makeAnnotationReference" },
                  },
                },
              }
            : {}))),
      confirmLabel: "Save",
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

function annotationEditTargetKey(target: SketchAnnotationEditTarget) {
  return target.kind === "offsetDistance"
    ? target.derivationId
    : getTargetKey(target);
}

export function getEditableAnnotationValue(
  session: SketchSessionState,
  target: SketchAnnotationEditTarget,
): {
  label: string;
  /** The edit's initial value; a reference dimension's is its measured value. */
  value: AuthoredValue<number> | null;
  unit?: string;
  min?: number;
  anchor?: SketchToolAnchorDescriptor;
  /** T13d: a driving numeric dimension, which can be made a reference. */
  canBeReference?: true;
  /** T13d: a reference dimension and its measured value (display units). */
  reference?: { measuredValue: number | null };
} | null {
  if (target.kind === "offsetDistance") {
    const relationship = session.definition.derivedRelationships?.find(
      (entry) =>
        entry.kind === "offset" && entry.derivationId === target.derivationId,
    );
    if (relationship?.kind !== "offset") return null;
    const entityId =
      relationship.outputs[0]?.outputEntityId ?? relationship.seedEntityIds[0];
    const point = entityId ? getEntityAnchor(session.definition, entityId) : null;
    return {
      label: "Offset distance",
      value: relationship.distance,
      unit: "mm",
      anchor: {
        kind: "sketchPoint",
        point: point ?? [0, 0],
        offset: { x: 18, y: -18 },
      },
    };
  }
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
      value: createLiteralAuthoredValue(
        (constraint.valueRadians * 180) / Math.PI,
      ),
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
    const valueRadians = requireDrivingDimensionValue(
      dimension,
      dimension.valueRadians,
    );
    const literalRadians = getAuthoredLiteralValue(valueRadians);
    return {
      label,
      value:
        literalRadians === null
          ? valueRadians
          : createLiteralAuthoredValue((literalRadians * 180) / Math.PI),
      unit,
      min,
      anchor,
      canBeReference: true,
    };
  }

  return {
    label,
    value: requireDrivingDimensionValue(dimension, dimension.value),
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
