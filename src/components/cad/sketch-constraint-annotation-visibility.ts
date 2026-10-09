import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { type PrimitiveRef, getPrimitiveRefKey } from "@/core/editor/schema";
import {
  getSketchAnnotationContextRefs,
  isSketchAnnotationDrawnInViewport,
  type SketchAnnotationContext,
  type SketchAnnotationDescriptor,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";

export { getSketchAnnotationContextRefs };

/**
 * T14b (T-1): `pinned` annotations are full controls (interactive only in the
 * idle select context, T-5); a `preview` is a passive hint that never takes
 * the pointer, not even when hovered.
 */
export type SketchAnnotationVisibility = "pinned" | "preview" | "hidden";

interface SketchAnnotationVisibilityContext {
  hoverTarget: PrimitiveRef | null;
  /** The active selection: an annotation in it is the active annotation. */
  selection: readonly PrimitiveRef[];
  /** T14c: the retained owners and the last selected annotation. */
  annotationContext: SketchAnnotationContext | null;
  definition: SketchDefinition | null;
  /** T14e (T-11): the Show all switch pins every drawn annotation. */
  showAll?: boolean;
}

export function resolveSketchAnnotationVisibility(
  annotation: SketchAnnotationDescriptor,
  context: SketchAnnotationVisibilityContext,
): SketchAnnotationVisibility {
  return createSketchAnnotationVisibilityResolver(context)(annotation);
}

/**
 * The visibility of every annotation under one context: the pinned and
 * preview geometry sets are built once (T14b review A-4), not per annotation.
 */
function createSketchAnnotationVisibilityResolver(
  context: SketchAnnotationVisibilityContext,
) {
  // T14c: the selection and the retained owners both pin `ctx()`.
  const pinnedGeometry = new Set(
    [
      ...context.selection,
      ...(context.annotationContext?.owners ?? []),
    ].flatMap((target) =>
      [
        target,
        ...getSketchAnnotationContextRefs(target, context.definition),
      ].map(getPrimitiveRefKey),
    ),
  );
  const previewGeometry = new Set(
    context.hoverTarget
      ? getSketchAnnotationContextRefs(
          context.hoverTarget,
          context.definition,
        ).map(getPrimitiveRefKey)
      : [],
  );
  const affects = (
    annotation: SketchAnnotationDescriptor,
    geometry: ReadonlySet<string>,
  ) =>
    annotation.affectedGeometryRefs.some((geometryRef) =>
      geometry.has(getPrimitiveRefKey(geometryRef)),
    );

  return (
    annotation: SketchAnnotationDescriptor,
  ): SketchAnnotationVisibility => {
    // T14e (Q1/A-9): an arc's own end binding is drawn only as a problem.
    if (!isSketchAnnotationDrawnInViewport(annotation)) {
      return "hidden";
    }
    if (
      context.showAll ||
      annotation.status === "dimension" ||
      annotation.constraintDisplay?.isAffectedOverconstraint ||
      context.selection.some((target) =>
        annotationTargetsEqual(target, annotation.target),
      ) ||
      annotationTargetsEqual(
        context.annotationContext?.last ?? null,
        annotation.target,
      ) ||
      affects(annotation, pinnedGeometry)
    ) {
      return "pinned";
    }

    return affects(annotation, previewGeometry) ? "preview" : "hidden";
  };
}

export interface SketchAnnotationLayerItem {
  annotation: SketchAnnotationDescriptor;
  visibility: Exclude<SketchAnnotationVisibility, "hidden">;
  isInteractive: boolean;
  /** In the active selection. */
  isSelected: boolean;
  /** T14c: the context's last annotation while it is not selected. */
  isLast: boolean;
}

/**
 * The annotation layer's model for one render: the rendered items, the label
 * drag handles that may carry a drag (interactive chips only: a chip that
 * turns passive drops its drag, review A-1), and whether the editor's
 * annotation hover is stale (its annotation no longer renders as a control,
 * review A-2; no pointer leave will ever clear it).
 */
export function resolveSketchAnnotationLayer(
  annotations: readonly SketchAnnotationDescriptor[],
  context: SketchAnnotationVisibilityContext & {
    hoveredAnnotation: SketchConstraintRef | SketchDimensionRef | null;
    interactive: boolean;
  },
) {
  const visibilityOf = createSketchAnnotationVisibilityResolver(context);
  const items = annotations.flatMap(
    (annotation): SketchAnnotationLayerItem[] => {
      const visibility = visibilityOf(annotation);
      return visibility === "hidden"
        ? []
        : [
            {
              annotation,
              visibility,
              isInteractive: context.interactive && visibility === "pinned",
              isSelected: context.selection.some((target) =>
                annotationTargetsEqual(target, annotation.target),
              ),
              // T14c: the last selected annotation, subdued while inactive.
              isLast:
                annotationTargetsEqual(
                  context.annotationContext?.last ?? null,
                  annotation.target,
                ) &&
                !context.selection.some((target) =>
                  annotationTargetsEqual(target, annotation.target),
                ),
            },
          ];
    },
  );
  const interactiveItems = items.filter((item) => item.isInteractive);

  return {
    items,
    dragHandleIds: new Set(
      interactiveItems.flatMap(({ annotation }) =>
        annotation.dragHandle ? [annotation.dragHandle.id] : [],
      ),
    ),
    hoverIsStale:
      context.hoveredAnnotation !== null &&
      !interactiveItems.some(({ annotation }) =>
        annotationTargetsEqual(context.hoveredAnnotation, annotation.target),
      ),
  };
}

/**
 * T14b (T-5/R-6): annotations take the pointer only in the idle select
 * context: no tool, edit tool, special mode, annotation edit or geometry drag,
 * and the pick chooser closed. Otherwise they render passive.
 */
export function isSketchAnnotationIdleContext(
  session: SketchSessionState | null,
  chooserOpen: boolean,
) {
  return (
    session !== null &&
    !chooserOpen &&
    session.activeTool === null &&
    session.activeEditTool === null &&
    session.activeSpecialMode === null &&
    session.activeAnnotationEdit === null &&
    session.activeDrag === null
  );
}

export function annotationTargetsEqual(
  left: PrimitiveRef | null,
  right: SketchConstraintRef | SketchDimensionRef,
) {
  if (left?.kind === "constraint") {
    return (
      right.kind === "constraint" &&
      left.sketchId === right.sketchId &&
      left.constraintId === right.constraintId
    );
  }

  return (
    left?.kind === "dimension" &&
    right.kind === "dimension" &&
    left.sketchId === right.sketchId &&
    left.dimensionId === right.dimensionId
  );
}
