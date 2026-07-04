import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import { type PrimitiveRef, primitiveRefEquals } from "@/core/editor/schema";
import type { SketchAnnotationDescriptor } from "@/domain/editor/sketch-session";

export type SketchAnnotationVisibility = "visible" | "faded" | "hidden";

export function resolveSketchAnnotationVisibility(
  annotation: SketchAnnotationDescriptor,
  context: {
    hoveredAnnotation: SketchConstraintRef | SketchDimensionRef | null;
    selectedAnnotation: SketchConstraintRef | SketchDimensionRef | null;
    hoverTarget: PrimitiveRef | null;
    selection: readonly PrimitiveRef[];
  },
): SketchAnnotationVisibility {
  if (annotation.status === "dimension") {
    return "visible";
  }

  if (annotation.constraintDisplay?.isAffectedOverconstraint) {
    return "visible";
  }

  if (
    annotationTargetsEqual(context.hoveredAnnotation, annotation.target) ||
    annotationTargetsEqual(context.selectedAnnotation, annotation.target)
  ) {
    return "visible";
  }

  if (
    annotation.affectedGeometryRefs.some((geometryRef) =>
      context.selection.some((target) =>
        primitiveRefEquals(geometryRef, target),
      ),
    )
  ) {
    return "visible";
  }

  const hoverTarget = context.hoverTarget;
  if (
    hoverTarget &&
    annotation.affectedGeometryRefs.some((geometryRef) =>
      primitiveRefEquals(geometryRef, hoverTarget),
    )
  ) {
    return "faded";
  }

  return "hidden";
}

export function annotationTargetsEqual(
  left: SketchConstraintRef | SketchDimensionRef | null,
  right: SketchConstraintRef | SketchDimensionRef,
) {
  if (!left || left.kind !== right.kind || left.sketchId !== right.sketchId) {
    return false;
  }

  return left.kind === "constraint"
    ? right.kind === "constraint" && left.constraintId === right.constraintId
    : right.kind === "dimension" && left.dimensionId === right.dimensionId;
}
