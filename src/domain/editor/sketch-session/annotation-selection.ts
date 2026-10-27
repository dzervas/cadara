import type { SketchSessionState, SketchAnnotationContext } from "./types";
import { rearmSharedDimensionTool } from "./constraints";
import { clearSketchAnnotationEdit } from "./annotation-editing";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { getSketchEntityDefiningPointIds } from "./drag-intent";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import type { SketchId } from "@/contracts/shared/ids";
import {
  getConstraintAffectedGeometryRefs,
  getDimensionAffectedGeometryRefs,
} from "./annotation-anchors";
import { getSketchSessionMirrorHealth } from "./session-feedback";
import { linkedMirrorRefs } from "@/contracts/sketch/mirror-requirements";
import {
  createSketchEntityRef,
  createSketchPointRef,
} from "./session-definition";
import { withLiveSolveBasis } from "./session-live-solve";
import { rebuildSessionCommitRequest } from "./tool-authoring";

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
