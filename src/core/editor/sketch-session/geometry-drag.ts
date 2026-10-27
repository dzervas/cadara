import type { SketchSessionState } from "./types";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
import {
  resolveHandleFromTarget,
  resolveSketchDragIntent,
} from "./drag-intent";
import type { SketchDragHandle, SketchDragIntent } from "./drag-intent";
import {
  isDrawingSketchTool,
  rebuildSessionCommitRequest,
} from "./tool-authoring";
import { selectSketchEditTarget } from "./edit-tool-activation";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  orderedSplineOccurrences,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import {
  mirrorSeedTangentOf,
  syncMirrorOutputStructures,
  mirrorRootSeedOccurrence,
} from "@/contracts/sketch/mirror-requirements";
import {
  startInteractiveSolveSessionForDrag,
  solveDragEdit,
} from "./drag-solve";
import { getSketchSessionDerivationSettings } from "./session-definition";
import {
  describeSketchSessionUnsatisfiedRequirements,
  getSketchSessionInvalidFeedback,
} from "./session-feedback";
import { withLiveSolveBasis } from "./session-live-solve";
import type { SketchDragTarget } from "@/core/sketch-solver";
import { resolveSketchSnap } from "@/core/sketch-snapping/snap-candidates";

export function beginSketchGeometryDrag(
  session: SketchSessionState,
  target: PrimitiveRef,
  point: SketchPoint,
  explicitHandle?: SketchDragHandle,
): SketchSessionState {
  // Guards: must be in a compatible state.
  if (
    session.status === "drawing" ||
    (session.activeTool !== null && !isDrawingSketchTool(session.activeTool))
  ) {
    return session;
  }

  // D9: non-draggable targets return unchanged.
  if (
    target.kind !== "sketchPoint" &&
    target.kind !== "sketchEntity" &&
    target.kind !== "sketchTangentHandle"
  ) {
    return session;
  }

  // Resolve the handle from the explicit parameter or from the PrimitiveRef +
  // definition, judged against the live solve (D9′: a failed mirror's copy
  // is not draggable).
  const handle: SketchDragHandle | null =
    explicitHandle ??
    resolveHandleFromTarget(
      session.definition,
      target,
      session.liveSolve?.solvedSnapshot ?? null,
    );
  if (!handle) {
    return session;
  }

  // Resolve the drag intent.
  const intent = resolveSketchDragIntent(session.definition, handle);
  if (!intent) {
    return session;
  }

  // For point targets, select the edit target (existing behavior).
  let base = session;
  if (target.kind === "sketchPoint") {
    const selected = selectSketchEditTarget(session, target);
    if (
      !selected.activeEditTarget ||
      selected.activeEditTarget.pointId !== target.pointId
    ) {
      return session;
    }
    base = selected;
  }

  // D1: automatic → authored conversion at handle grab.
  // Grabbing an automatic tangent's handle converts it to authored with the
  // visible (mean-arm) vector so the curve does not change at grab, then
  // recompiles the session. Cancel restores the original definition.
  let workingDefinition = base.definition;
  if (intent.kind === "tangentVector" && handle.kind === "tangentHandle") {
    const converted = prepareSketchTangentEditDefinition(
      workingDefinition,
      intent.entityId,
      intent.occurrenceId,
      session.modelingTolerance,
    );
    if (converted) {
      workingDefinition = converted;
    }
  }

  return startDragWithIntent(
    base,
    workingDefinition,
    target,
    handle,
    intent,
    point,
  );
}

// D10 handle resolution is now exported from drag-intent.ts.

/**
 * Convert an automatic tangent to authored using the visible (mean-arm)
 * vector from the spline reconstruction. Returns the mutated definition,
 * or null if the tangent is already authored or the reconstruction fails.
 *
 * T15d ([TECH] T-12): on a mirror output the occurrence's tangent is a
 * driven slot, so the conversion is made on the authority: the root seed
 * occurrence becomes authored with the reflected visible vector (the
 * owner's `mirrorSeedTangentOf`), and the owner's structural sync makes
 * the output occurrence authored to match. The drag then targets the
 * output's (driven) vector slot through the coupled solve.
 */
export function prepareSketchTangentEditDefinition(
  definition: SketchDefinition,
  entityId: SketchEntityId,
  occurrenceId: string,
  modelingTolerance: number,
): SketchDefinition | null {
  const entity = definition.entities.find((e) => e.entityId === entityId);
  if (!entity || entity.kind !== "spline") return null;
  const ordered = orderedSplineOccurrences(entity);
  if (!ordered) return null;
  const occIndex = ordered.findIndex(
    (occ) => occ.occurrenceId === occurrenceId,
  );
  if (occIndex < 0) return null;
  const occurrence = ordered[occIndex]!;
  if (occurrence.tangent.kind === "authored") return null;

  // Reconstruct the spline to get the visible automatic vector.
  const positions = Object.fromEntries(
    definition.points.map((p) => [p.pointId, p.position]),
  ) as Record<SketchPointId, readonly [number, number]>;
  const reconstruction = reconstructSplineAggregate(entity, positions);
  if (reconstruction.validity !== "valid") return null;
  const visibleVector = reconstruction.handles[occIndex];
  if (!visibleVector) return null;

  const seed = mirrorSeedTangentOf({
    definition,
    modelingTolerance,
    entityId,
    occurrenceId,
    vector: visibleVector,
  });
  const authored = seed ?? { entityId, occurrenceId, vector: visibleVector };
  // Mutate the definition to convert this occurrence to authored.
  const converted = {
    ...definition,
    entities: definition.entities.map((e) => {
      if (e.entityId !== authored.entityId || e.kind !== "spline") return e;
      return {
        ...e,
        pointOccurrences: e.pointOccurrences.map((occ) =>
          occ.occurrenceId === authored.occurrenceId &&
          occ.tangent.kind === "automatic"
            ? {
                ...occ,
                tangent: {
                  kind: "authored" as const,
                  vector: authored.vector,
                },
              }
            : occ,
        ),
      };
    }),
  };
  return seed
    ? syncMirrorOutputStructures({ definition: converted, modelingTolerance })
    : converted;
}

/** Start the drag with the resolved intent. */
function startDragWithIntent(
  session: SketchSessionState,
  workingDefinition: SketchDefinition,
  target: PrimitiveRef,
  handle: SketchDragHandle,
  intent: SketchDragIntent,
  pointerDown: SketchPoint,
): SketchSessionState {
  const grabOffset = computeGrabOffset(workingDefinition, intent, pointerDown);

  // B14: a sketch whose requirements are not acceptable has no drag session.
  const started = startInteractiveSolveSessionForDrag(
    workingDefinition,
    session.projectedReferences,
    session.solverTolerances,
    getSketchSessionDerivationSettings(session),
    session.documentVariables,
    intent,
    session.offsetPlans,
  );
  if (started.kind === "unacceptable") {
    // T17c5 review A-4: a conflict is explained before a degenerate span
    // (the T17c3 feedback order).
    const conflict = started.degenerateSpan
      ? describeSketchSessionUnsatisfiedRequirements(session)
      : null;
    return {
      ...session,
      validationMessage: conflict
        ? `Geometry can't be dragged until the sketch solves: ${conflict}`
        : started.message,
    };
  }
  const interactiveSolveSession = started.session;

  // If the definition was modified (auto→authored conversion), update it.
  const baseSession =
    workingDefinition !== session.definition
      ? { ...session, definition: workingDefinition }
      : session;

  return {
    ...baseSession,
    activeTool: null,
    status: "idle",
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    toolStagedEntities: [],
    activeDrag: {
      target,
      handle,
      intent,
      preDragDefinition: session.definition,
      startPoint: pointerDown,
      currentPoint: pointerDown,
      grabOffset,
      status: "dragging",
      message: null,
      interactiveSolveSession,
    },
    validationMessage: null,
  };
}

/**
 * Compute the grab offset between the pointer-down position and the
 * logical position of the drag target. The offset is applied every frame
 * so the target never jumps to the pointer.
 */
function computeGrabOffset(
  definition: SketchDefinition,
  intent: SketchDragIntent,
  pointerDown: SketchPoint,
): SketchPoint {
  switch (intent.kind) {
    case "point": {
      const pointDef = definition.points.find(
        (p) => p.pointId === intent.pointId,
      );
      if (!pointDef) return [0, 0];
      return [
        pointDef.position[0] - pointerDown[0],
        pointDef.position[1] - pointerDown[1],
      ];
    }
    case "translate": {
      // For body drags, the pointer is the reference for the shared delta.
      // Offset is the first point's position minus the pointer.
      const firstPointDef = definition.points.find(
        (p) => p.pointId === intent.pointIds[0],
      );
      if (!firstPointDef) return [0, 0];
      return [
        firstPointDef.position[0] - pointerDown[0],
        firstPointDef.position[1] - pointerDown[1],
      ];
    }
    case "radius": {
      // A-1: scalar radial offset stored as [radialOffset, 0].
      // targetRadius = |pointer − centre| + radialOffset, so
      // radialOffset = currentRadius − |pointerDown − centre|.
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc"))
        return [0, 0];
      const center = definition.points.find(
        (p) => p.pointId === entity.centerPointId,
      );
      if (!center) return [0, 0];
      const distToPointer = Math.hypot(
        pointerDown[0] - center.position[0],
        pointerDown[1] - center.position[1],
      );
      const currentRadius =
        entity.kind === "circle"
          ? entity.radius
          : Math.hypot(
              definition.points.find((p) => p.pointId === entity.startPointId)!
                .position[0] - center.position[0],
              definition.points.find((p) => p.pointId === entity.startPointId)!
                .position[1] - center.position[1],
            );
      return [currentRadius - distToPointer, 0];
    }
    case "tangentVector": {
      // For handle drags, the offset is the handle tip (fit point + vector)
      // minus the pointer. The definition may already have been converted
      // from automatic to authored at this point.
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || entity.kind !== "spline") return [0, 0];
      const occurrence = entity.pointOccurrences.find(
        (occ) => occ.occurrenceId === intent.occurrenceId,
      );
      if (!occurrence) return [0, 0];
      const fitPoint = definition.points.find(
        (p) => p.pointId === occurrence.pointId,
      );
      if (!fitPoint) return [0, 0];
      if (occurrence.tangent.kind === "authored") {
        const tipX = fitPoint.position[0] + occurrence.tangent.vector[0];
        const tipY = fitPoint.position[1] + occurrence.tangent.vector[1];
        return [tipX - pointerDown[0], tipY - pointerDown[1]];
      }
      // Automatic tangent: compute visible vector from reconstruction.
      const positions = Object.fromEntries(
        definition.points.map((p) => [p.pointId, p.position]),
      ) as Record<SketchPointId, readonly [number, number]>;
      const reconstruction = reconstructSplineAggregate(entity, positions);
      if (reconstruction.validity !== "valid") return [0, 0];
      const ordered = orderedSplineOccurrences(entity);
      if (!ordered) return [0, 0];
      const occIdx = ordered.findIndex(
        (occ) => occ.occurrenceId === intent.occurrenceId,
      );
      if (occIdx < 0) return [0, 0];
      const vec = reconstruction.handles[occIdx]!;
      return [
        fitPoint.position[0] + vec[0] - pointerDown[0],
        fitPoint.position[1] + vec[1] - pointerDown[1],
      ];
    }
  }
}

export function updateSketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
  options?: { exactZero?: boolean },
): SketchSessionState {
  if (!session.activeDrag) {
    return session;
  }

  return applySketchGeometryDrag(session, point, false, options);
}

export function finishSketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
  options?: { exactZero?: boolean },
): SketchSessionState {
  if (!session.activeDrag) {
    return session;
  }

  const drag = session.activeDrag;
  const updated = applySketchGeometryDrag(session, point, true, options);
  // A gesture with no accepted frame (click-only, or every frame blocked)
  // restores the pre-drag state, undoing an automatic→authored tangent
  // conversion made at grab. Otherwise the last accepted frame is kept.
  if (!drag.acceptedFrame && updated.definition === session.definition) {
    return {
      ...cancelSketchGeometryDrag(session),
      validationMessage: updated.validationMessage,
    };
  }
  if (drag.interactiveSolveSession) {
    drag.interactiveSolveSession.disposed = true;
  }

  return {
    ...updated,
    activeDrag: null,
  };
}

/**
 * Cancel the current drag gesture, restoring the exact pre-drag state
 * (definition including any automatic→authored tangent conversion at grab,
 * live/solved basis consistent with that definition) with no history entry.
 * T12c will wire Escape/pointercancel/tool switch/Finish to this function.
 */
export function cancelSketchGeometryDrag(
  session: SketchSessionState,
): SketchSessionState {
  if (!session.activeDrag) {
    return session;
  }

  const interactiveSolveSession = session.activeDrag.interactiveSolveSession;
  if (interactiveSolveSession) {
    interactiveSolveSession.disposed = true;
  }

  const { preDragDefinition } = session.activeDrag;
  const restored = {
    ...session,
    definition: preDragDefinition,
    activeDrag: null,
  };
  // Without an accepted frame or grab conversion the basis is still current.
  return preDragDefinition === session.definition
    ? restored
    : withLiveSolveBasis(restored, preDragDefinition);
}

function applySketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
  complete: boolean,
  options?: { exactZero?: boolean },
): SketchSessionState {
  const drag = session.activeDrag;

  if (!drag) {
    return session;
  }
  if (
    !drag.pendingSolve &&
    point[0] === drag.startPoint[0] &&
    point[1] === drag.startPoint[1] &&
    drag.currentPoint[0] === drag.startPoint[0] &&
    drag.currentPoint[1] === drag.startPoint[1]
  ) {
    return session;
  }

  // Build the SketchDragTarget from the intent, raw pointer, and grab offset.
  // For most intents, the solver target is pointer + offset (Cartesian).
  // For radius, the offset is a scalar radial offset applied differently.
  const dragTarget = buildDragTarget(
    session.definition,
    drag.intent,
    point,
    drag.grabOffset,
    options?.exactZero,
    session.sketchUnitsPerPixel ?? null,
  );

  const edit = solveDragEdit(
    session.definition,
    session.projectedReferences,
    session.solverTolerances,
    getSketchSessionDerivationSettings(session),
    session.documentVariables,
    drag.intent,
    dragTarget,
    drag.interactiveSolveSession,
    complete,
  );

  if (edit.kind === "pending") {
    // A held snapshot is not a newly accepted pointer goal. In particular it
    // must not clear a previous refusal cue, establish a new live basis, or
    // promote acceptedFrame/currentPoint while its actual verdict is unknown.
    return {
      ...session,
      activeDrag: {
        ...drag,
        pendingSolve: true,
        interactiveSolveSession: edit.interactiveSolveSession,
      },
    };
  }

  if (edit.kind === "blocked") {
    // T12f: carry structured feedback on activeDrag; no global
    // validationMessage during the drag (issue 05: local cue only).
    return {
      ...session,
      activeDrag: complete
        ? null
        : {
            ...drag,
            pendingSolve: undefined,
            currentPoint: point,
            status: "blocked",
            message: edit.message,
            feedback: edit.feedback ?? null,
          },
      // O26: do not repeat the local drag refusal in the global status on
      // release. Failures without a previously displayed cue still need status.
      validationMessage:
        complete && drag.feedback?.text !== edit.message ? edit.message : null,
    };
  }

  const definition = edit.definition;

  // Every accepted frame is a new live solve basis; regions stay stale while
  // the drag is active and are derived once it completes (no active drag).
  const next = withLiveSolveBasis(
    {
      ...session,
      definition,
      toolStagedEntities: [],
      activeDrag: complete
        ? null
        : {
            ...drag,
            pendingSolve: undefined,
            currentPoint: point,
            status: "dragging",
            message: null,
            // T12f: clear feedback on an accepted (moving) frame.
            feedback: null,
            acceptedFrame: true,
            interactiveSolveSession: edit.interactiveSolveSession,
          },
      commitRequest: rebuildSessionCommitRequest(session, definition),
      validationMessage: null,
    },
    definition,
    edit.solvedSnapshot,
  );
  // T17c3: a completed drag that leaves the profiles unavailable (e.g. a fit
  // point dropped on its neighbour) is explained, as a commit is (T15b O-1).
  return complete && next.liveRegions.status === "unavailable"
    ? {
        ...next,
        validationMessage:
          getSketchSessionInvalidFeedback(next) ??
          "Sketch profiles are unavailable until the sketch is corrected.",
      }
    : next;
}

/**
 * T12b: build the solver drag target from the intent, raw pointer position,
 * and grab offset. Every intent maps to one SketchDragTarget variant.
 *
 * For point/translate/tangent intents, the offset is Cartesian:
 *   target = pointer + grabOffset.
 * For radius, the grab offset is a scalar radial offset (A-1):
 *   targetRadius = |pointer − centre| + grabOffset[0].
 */
function buildDragTarget(
  definition: SketchDefinition,
  intent: SketchDragIntent,
  pointer: SketchPoint,
  grabOffset: SketchPoint,
  exactZero?: boolean,
  sketchUnitsPerPixel: number | null = null,
): SketchDragTarget {
  // Cartesian offset for non-radius intents.
  const offsetPoint: SketchPoint = [
    pointer[0] + grabOffset[0],
    pointer[1] + grabOffset[1],
  ];

  switch (intent.kind) {
    case "point": {
      // O17: drag targets used raw cursor coordinates, so T17c's exact-drop
      // rows passed while a human's near drop never reached the neighbour.
      // Snap the logical fit point (including its grab offset) before the
      // solve, using the same measured pixel radius as drawing. This is a
      // position snap only: no Coincident is authored, so dragging apart
      // remains the recovery from a degenerate span.
      const neighbours = new Set<SketchPointId>();
      for (const entity of definition.entities) {
        if (entity.kind !== "spline") continue;
        const occurrences = orderedSplineOccurrences(entity);
        if (!occurrences) continue;
        occurrences.forEach((occurrence, index) => {
          if (occurrence.pointId !== intent.pointId) return;
          for (const adjacent of [index - 1, index + 1]) {
            const neighbour =
              entity.closure === "smooth"
                ? occurrences[
                    (adjacent + occurrences.length) % occurrences.length
                  ]
                : occurrences[adjacent];
            if (neighbour && neighbour.pointId !== intent.pointId)
              neighbours.add(neighbour.pointId);
          }
        });
      }
      const snap = resolveSketchSnap({
        pointer: offsetPoint,
        sketchUnitsPerPixel,
        geometries: definition.points
          .filter((point) => neighbours.has(point.pointId))
          .map((point) => ({
            kind: "point",
            source: { kind: "localPoint", pointId: point.pointId },
            point: point.position,
            label: "Spline fit point",
          })),
      });
      return {
        kind: "sketchPoint",
        pointId: intent.pointId,
        position: snap.snappedPoint,
      };
    }
    case "translate": {
      // Delta = offsetPoint minus the first defining point's current position.
      const firstPoint = definition.points.find(
        (p) => p.pointId === intent.pointIds[0],
      );
      const delta: SketchPoint = firstPoint
        ? [
            offsetPoint[0] - firstPoint.position[0],
            offsetPoint[1] - firstPoint.position[1],
          ]
        : [0, 0];
      return {
        kind: "sketchTranslate",
        pointIds: intent.pointIds,
        delta,
      };
    }
    case "radius": {
      // A-1: scalar radial offset. targetRadius = |pointer − centre| + radialOffset.
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
        return {
          kind: "sketchRadius",
          entityId: intent.entityId,
          targetRadius: 1,
        };
      }
      const center = definition.points.find(
        (p) => p.pointId === entity.centerPointId,
      );
      const targetRadius = center
        ? Math.hypot(
            pointer[0] - center.position[0],
            pointer[1] - center.position[1],
          ) + grabOffset[0]
        : 1;
      return {
        kind: "sketchRadius",
        entityId: intent.entityId,
        targetRadius,
      };
    }
    case "tangentVector": {
      if (exactZero) {
        // T15d: Rv(0) = 0 for every axis, so on a mirror copy the exact-zero
        // pin is the same requirement on the root seed occurrence, the
        // tangent's authority (a hard pin on the copy's driven slot only
        // converges near zero).
        const authority =
          mirrorRootSeedOccurrence(
            definition,
            intent.entityId,
            intent.occurrenceId,
          ) ?? intent;
        return {
          kind: "sketchTangentVector",
          entityId: authority.entityId,
          occurrenceId: authority.occurrenceId,
          targetVector: [0, 0],
          exactZero,
        };
      }
      // Target vector = offsetPoint minus the fit point's position.
      const fitPoint = definition.points.find(
        (p) => p.pointId === intent.pointId,
      );
      const targetVector: SketchPoint = fitPoint
        ? [
            offsetPoint[0] - fitPoint.position[0],
            offsetPoint[1] - fitPoint.position[1],
          ]
        : [0, 0];
      return {
        kind: "sketchTangentVector",
        entityId: intent.entityId,
        occurrenceId: intent.occurrenceId,
        targetVector,
        exactZero,
      };
    }
  }
}
