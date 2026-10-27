import { keptSketchWithheldRegionText } from "./region-feedback";
import type {
  SemanticSketchGeometryEdit,
  SemanticSketchLabelTarget,
} from "@/contracts/semantic/schema";
import type { SketchDragTarget } from "@/core/sketch-solver";
import type { SketchSessionState } from "./types";
import {
  getSessionSketchId,
  getSketchSessionInvalidFeedback,
  getSketchSessionDerivationSettings,
  rebuildSessionCommitRequest,
  rebuildSessionForDefinition,
  withLiveSolveBasis,
} from "./internals";
import {
  resolveHandleFromTarget,
  resolveSketchDragIntent,
  type SketchDragIntent,
} from "./drag-intent";
import { prepareSketchPointMerge, prepareSketchTangentEditDefinition, solveDragEdit } from "./editing";

/** One completed parameter edit through the same solver and target gate as browser edits. */
export function updateSketchGeometry(
  session: SketchSessionState,
  edit: SemanticSketchGeometryEdit,
): SketchSessionState {
  const refuse = (message: string) => ({
    ...session,
    validationMessage: message,
  });
  if (edit.target.sketchId !== getSessionSketchId(session))
    return refuse("Sketch target is unavailable.");
  if (edit.kind === "trim" || edit.kind === "extend" || edit.kind === "split")
    return refuse("Sketch intersection edits require an exact accepted query result.");
  if (edit.kind === "mergePoints") {
    if (edit.destination.sketchId !== getSessionSketchId(session))
      return refuse("Merge destination is unavailable.");
    const prepared = prepareSketchPointMerge(session, edit.target.pointId, edit.destination.pointId);
    return prepared.result.valid ? { ...prepared.session, validationMessage: null } : refuse(prepared.result.message);
  }
  const handle = resolveHandleFromTarget(
    session.definition,
    edit.target,
    session.liveSolve?.solvedSnapshot ?? null,
  );
  if (!handle) return refuse("Sketch target is not editable.");
  let definition = session.definition;
  let intent: SketchDragIntent | null = null;
  let target: SketchDragTarget;
  switch (edit.kind) {
    case "point": {
      const point = session.definition.points.find(
        (p) => p.pointId === edit.target.pointId,
      );
      if (!point || !edit.position.every(Number.isFinite))
        return refuse("Point target and coordinates must be valid.");
      // A uniquely owned circle/arc center has the same whole-entity meaning
      // as a browser center grab; targeting just its scalar point deforms arcs.
      intent = resolveSketchDragIntent(session.definition, handle);
      if (!intent || (intent.kind !== "point" && intent.kind !== "translate"))
        return refuse("Point target is not editable.");
      target = intent.kind === "translate"
        ? {
            kind: "sketchTranslate",
            pointIds: intent.pointIds,
            delta: [edit.position[0] - point.position[0], edit.position[1] - point.position[1]],
          }
        : {
            kind: "sketchPoint",
            pointId: intent.pointId,
            position: edit.position,
          };
      break;
    }
    case "translate": {
      intent = resolveSketchDragIntent(session.definition, {
        kind: "entityBody", entityId: edit.target.entityId,
      });
      if (intent?.kind !== "translate" || !edit.delta.every(Number.isFinite))
        return refuse("Translation target and coordinates must be valid.");
      target = { kind: "sketchTranslate", pointIds: intent.pointIds, delta: edit.delta };
      break;
    }
    case "radius":
      intent = resolveSketchDragIntent(session.definition, {
        kind: "rim",
        entityId: edit.target.entityId,
      });
      if (!intent || !Number.isFinite(edit.radius) || edit.radius <= 0)
        return refuse("Radius must be positive on a circle or arc.");
      target = {
        kind: "sketchRadius",
        entityId: edit.target.entityId,
        targetRadius: edit.radius,
      };
      break;
    case "tangent": {
      const entity = session.definition.entities.find(
        (e) => e.entityId === edit.target.entityId,
      );
      if (
        entity?.kind !== "spline" ||
        !entity.pointOccurrences.some(
          (o) =>
            o.occurrenceId === edit.target.occurrenceId &&
            o.pointId === edit.target.pointId,
        )
      )
        return refuse("Tangent occurrence is unavailable.");
      intent = resolveSketchDragIntent(session.definition, handle);
      if (
        intent?.kind !== "tangentVector" ||
        !edit.vector.every(Number.isFinite)
      )
        return refuse("Tangent target and vector must be valid.");
      definition =
        prepareSketchTangentEditDefinition(
          session.definition,
          edit.target.entityId,
          edit.target.occurrenceId,
          session.modelingTolerance,
        ) ?? session.definition;
      target = {
        kind: "sketchTangentVector",
        entityId: edit.target.entityId,
        occurrenceId: edit.target.occurrenceId,
        targetVector: edit.vector,
        exactZero: edit.vector[0] === 0 && edit.vector[1] === 0,
      };
      break;
    }
  }
  const result = solveDragEdit(
    definition,
    session.projectedReferences,
    session.solverTolerances,
    getSketchSessionDerivationSettings(session),
    session.documentVariables,
    intent,
    target,
  );
  if (result.kind === "blocked") return refuse(result.message);
  const next = withLiveSolveBasis(
    {
      ...session,
      definition: result.definition,
      toolStagedEntities: [],
      activeDrag: null,
      commitRequest: rebuildSessionCommitRequest(session, result.definition),
      validationMessage: null,
    },
    result.definition,
    result.solvedSnapshot,
  );
  return next.liveRegions.status === "unavailable"
    ? { ...next, validationMessage: getSketchSessionInvalidFeedback(next) ??
        "Sketch profiles are unavailable until the sketch is corrected." }
    : next;
}

/** Labels are authored metadata, not a client-side alias override. */
export function setSketchItemLabel(
  session: SketchSessionState,
  target: SemanticSketchLabelTarget,
  label: string,
): SketchSessionState {
  if (target.sketchId !== getSessionSketchId(session) || !label.trim())
    return {
      ...session,
      validationMessage: "Sketch target and label must be valid.",
    };
  if (target.kind === "sketch")
    return session.sketchLabel === label
      ? { ...session, validationMessage: keptSketchWithheldRegionText(session) }
      : {
          ...session,
          sketchLabel: label,
          commitRequest: rebuildSessionCommitRequest(
            { ...session, sketchLabel: label },
            session.definition,
          ),
          validationMessage: keptSketchWithheldRegionText(session),
        };
  const definition = session.definition;
  const selected =
    target.kind === "sketchPoint"
      ? definition.points.find((p) => p.pointId === target.pointId)
      : target.kind === "sketchEntity"
        ? definition.entities.find((e) => e.entityId === target.entityId)
        : target.kind === "dimension"
          ? definition.dimensions.find(
              (d) => d.dimensionId === target.dimensionId,
            )
          : definition.constraints.find(
              (c) => c.constraintId === target.constraintId,
            );
  if (!selected)
    return { ...session, validationMessage: "Sketch target is unavailable." };
  if (selected.label === label) return { ...session, validationMessage: keptSketchWithheldRegionText(session) };
  const points =
    target.kind === "sketchPoint"
      ? definition.points.map((p) =>
          p.pointId === target.pointId ? { ...p, label } : p,
        )
      : definition.points;
  const entities =
    target.kind === "sketchEntity"
      ? definition.entities.map((e) =>
          e.entityId === target.entityId ? { ...e, label } : e,
        )
      : definition.entities;
  const dimensions =
    target.kind === "dimension"
      ? definition.dimensions.map((d) =>
          d.dimensionId === target.dimensionId ? { ...d, label } : d,
        )
      : definition.dimensions;
  const constraints =
    target.kind === "constraint"
      ? definition.constraints.map((c) =>
          c.constraintId === target.constraintId ? { ...c, label } : c,
        )
      : definition.constraints;
  return rebuildSessionForDefinition(session, {
    definition: { ...definition, points, entities, dimensions, constraints },
  });
}
