/**
 * T17c2 ([TECH] T17-16, T17-plan review B-1; issue 08: "Explicit Close
 * spline produces a smoothly wrapped curve"): the Close spline
 * selection-context state and the "Close Spline" session action.
 *
 * Offered for exactly one open spline (selected itself, or through its fit
 * points or tangent handles) with no tool armed. The action writes the
 * spline's `closure` (`"open"` → `"smooth"`) and, on a trimmed or split
 * piece, drops its `endSpanParameterLengths` (T17c2 review, orchestrator
 * option B: fixed end spans mean nothing once the curve wraps, and the
 * wrapped reconstruction rejects them); no fit point is added or removed
 * and authored tangents are kept; the existing wrapped reconstruction
 * closes it (`spline-geometry.ts`). Refused (T17b0 P-10), each with a
 * label-based reason shown on the disabled button: fewer than 3 fit
 * points; an offset source; part of a mirror (either side); part of a pattern or
 * transform (either side); without a solve of the current sketch; ends
 * already joined (one point, a satisfied Coincident class (C4), or the same
 * solved position).
 */
import { declaredJoinClasses } from "@/contracts/sketch/region-extraction";
import { RELATIONSHIP_NOUN } from "@/contracts/sketch/mirror-requirements";
import type {
  SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import { orderedSplineOccurrences } from "@/contracts/sketch/spline-geometry";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchSessionState } from "./types";
import { getSessionSketchId } from "./tool-authoring";
import { hasAcceptedLiveSolveOfDefinition } from "./session-live-solve";
import { rebuildSessionForDefinition } from "./definition-authoring";

type SplineEntity = Extract<SketchEntityDefinition, { kind: "spline" }>;

export interface SketchCloseSplineState {
  entityId: string;
  label: string;
  /** Why Close spline is refused (label-based); null when it can close. */
  refusal: string | null;
}

/**
 * The Close spline state for `selection`: the one open spline it selects,
 * with its refusal. Null (hidden) when the selection is not exactly one
 * spline, the spline is already closed (positional or smooth), or a drag,
 * tool, special mode or annotation edit owns the panel slot.
 */
export function computeSketchCloseSplineState(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
): SketchCloseSplineState | null {
  if (
    session.activeDrag ||
    session.activeSpecialMode ||
    session.activeTool ||
    session.activeAnnotationEdit
  )
    return null;
  const spline = selectedSpline(session, selection);
  if (!spline || spline.closure !== "open") return null;
  return {
    entityId: spline.entityId,
    label: spline.label,
    refusal: closeSplineRefusal(session, spline),
  };
}

/**
 * "Close Spline": the selected open spline's `closure` set to `"smooth"`
 * (its `endSpanParameterLengths` dropped), re-solved as one authored
 * candidate. The same session when there is no
 * such spline or Close spline is refused (nothing is written).
 */
export function applySketchCloseSpline(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
): SketchSessionState {
  const state = computeSketchCloseSplineState(session, selection);
  if (!state || state.refusal !== null) return session;
  const definition: SketchDefinition = {
    ...session.definition,
    entities: session.definition.entities.map((entity) =>
      entity.entityId === state.entityId && entity.kind === "spline"
        ? closedSmoothly(entity)
        : entity,
    ),
  };
  return rebuildSessionForDefinition(session, { definition });
}

function closedSmoothly(spline: SplineEntity): SplineEntity {
  const closed: SplineEntity = { ...spline, closure: "smooth" };
  delete closed.endSpanParameterLengths;
  return closed;
}

/** The one spline every selected ref belongs to, else null. */
function selectedSpline(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
): SplineEntity | null {
  const sketchId = getSessionSketchId(session);
  const splines = session.definition.entities.filter(
    (entity): entity is SplineEntity => entity.kind === "spline",
  );
  const ids = new Set<string>();
  for (const ref of selection) {
    if (
      (ref.kind === "sketchEntity" || ref.kind === "sketchTangentHandle") &&
      ref.sketchId === sketchId &&
      splines.some((spline) => spline.entityId === ref.entityId)
    )
      ids.add(ref.entityId);
    else if (ref.kind === "sketchPoint" && ref.sketchId === sketchId) {
      const owners = splines.filter((spline) =>
        spline.pointOccurrences.some(
          (occurrence) => occurrence.pointId === ref.pointId,
        ),
      );
      if (owners.length === 0) return null;
      for (const owner of owners) ids.add(owner.entityId);
    } else return null;
  }
  if (ids.size !== 1) return null;
  const [id] = ids;
  return splines.find((spline) => spline.entityId === id) ?? null;
}

/** P-10's refusal set, in order; null when `spline` can close. */
function closeSplineRefusal(
  session: SketchSessionState,
  spline: SplineEntity,
): string | null {
  const definition = session.definition;
  const label = spline.label;
  const occurrences =
    orderedSplineOccurrences(spline) ?? spline.pointOccurrences;
  if (occurrences.length < 3)
    return `${label} has ${occurrences.length} fit points; closing a spline needs at least 3.`;
  for (const relationship of definition.derivedRelationships ?? []) {
    const seed = relationship.seedEntityIds.includes(spline.entityId);
    const copy = relationship.outputs.some(
      (output) => output.outputEntityId === spline.entityId,
    );
    if (relationship.kind === "offset") {
      if (seed)
        return `${label} is the source of offset ‘${relationship.label}’; closing it would change the offset. Remove the offset first (select it, then Offset → Remove offset).`;
      continue;
    }
    if (!seed && !copy) continue;
    if (relationship.kind === "mirror")
      return `${label} is part of mirror ‘${relationship.label}’. To close it, select it, then Mirror → Remove mirror.`;
    return `${label} is part of ${RELATIONSHIP_NOUN[relationship.kind].toLowerCase()} ‘${relationship.label}’; a spline in a pattern or transform can't be closed.`;
  }
  if (!hasAcceptedLiveSolveOfDefinition(session))
    return "Close spline needs a solved sketch; fix the problem shown above first, or Undo.";
  const first = occurrences[0]!.pointId;
  const last = occurrences.at(-1)!.pointId;
  const solved = session.liveSolve!.solvedSnapshot;
  const position = (pointId: string) =>
    solved.solvedPoints.find((point) => point.pointId === pointId)
      ?.solvedPosition;
  // One point id is one member of a declared-join class, so the class test
  // also covers ends sharing a point.
  const classes = declaredJoinClasses(definition, solved);
  const [a, b] = [position(first), position(last)];
  if (
    classes.find(first) === classes.find(last) ||
    (a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1])
  )
    return `${label}'s first and last fit points are already joined; it is closed by position.`;
  return null;
}
