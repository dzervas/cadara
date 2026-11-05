import { pointLineSignedDistance } from "./line-residuals";
import type { SketchCompiledSolveProgram } from "./system-types";
import type { SolvedSketchSnapshot } from "@/contracts/sketch/schema";

/**
 * T13a2 (issue 05, Q3): the guarded arc quantities of one frame, each a
 * signed value whose sign is the arc's orientation and whose magnitude is
 * its radius:
 * - `radius:<arc>`: an arc's radius variable where it is an authority
 *   variable (radius through zero mirrors the arc);
 * - `side:<tangent>`: for a line↔arc tangent, the signed distance from the
 *   line to the arc's centre; the centre is a radius away from the line, so
 *   the side changes only through radius zero (the arc turns inside out,
 *   e.g. a collapsing fillet). A point-defined arc's radius is a distance
 *   (never negative), so this is its radius-through-zero signal.
 * The minor/major sweep (start×end about the centre) is deliberately not
 * guarded: it changes on a legitimate sweep through 180° and is noise on a
 * semicircle.
 */
export function guardedArcQuantities(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
  snapshot: SolvedSketchSnapshot,
) {
  const signs = new Map<string, number>();
  const authority = new Set(
    program.system.parameterProjection.authorityVariableIndices,
  );
  for (const state of program.system.entityStates.values()) {
    if (state.kind === "arc" && authority.has(state.baseIndex)) {
      signs.set(`radius:${state.entityId}`, values[state.baseIndex]!);
    }
  }
  const points = new Map(
    snapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
  );
  const arcCenters = new Map(
    snapshot.solvedEntities.flatMap((entity) =>
      entity.kind === "arc" ? [[entity.entityId, entity.centerPosition]] : [],
    ),
  );
  const entities = new Map(
    program.definition.entities.map((entity) => [entity.entityId, entity]),
  );
  for (const constraint of program.definition.constraints) {
    if (constraint.kind !== "tangent") continue;
    const [first, second] = constraint.entityIds.map((id) => entities.get(id));
    const line =
      first?.kind === "lineSegment"
        ? first
        : second?.kind === "lineSegment"
          ? second
          : null;
    const arc =
      first?.kind === "arc" ? first : second?.kind === "arc" ? second : null;
    if (!line || !arc) continue;
    const center = arcCenters.get(arc.entityId);
    const start = points.get(line.startPointId);
    const end = points.get(line.endPointId);
    if (!center || !start || !end) continue;
    signs.set(
      `side:${constraint.constraintId}`,
      pointLineSignedDistance(center, start, end),
    );
  }
  return signs;
}

