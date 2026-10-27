import type { SketchCoreValidationResult } from "./solve-types";
import { makeDiagnostic } from "./solver-geometry";
import type { SketchCompiledSolveProgram } from "./system-types";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  NumericSketchDefinition as SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchSolveDiagnostic,
  SolvedSketchEntityGeometryRecord,
} from "@/contracts/sketch/schema";
import {
  orderedSplineOccurrences,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";

/**
 * T17c3 (issue 08: a degenerate span is reported, its profiles blocked):
 * the one label-based text of a spline span between two consecutive fit
 * points at the same place (`spanIndex` of its reconstruction; the last
 * span of a smooth closure wraps to the first fit point).
 */
export function describeDegenerateSplineSpan(
  spline: Extract<SketchEntityDefinition, { kind: "spline" }>,
  spanIndex: number,
  pointLabel: (pointId: string) => string | undefined,
): string {
  const occurrences = orderedSplineOccurrences(spline) ?? [];
  const [first, second] = [spanIndex, spanIndex + 1].map((index) => {
    const pointId = occurrences[index % occurrences.length]?.pointId ?? "";
    return pointLabel(pointId) ?? pointId;
  });
  return `${spline.label} has two consecutive fit points at the same place (${first} and ${second}); the sketch's profiles are blocked. Undo, or drag one of them apart (delete the Coincident between them first, if there is one).`;
}

export const COINCIDENT_SPLINE_SPAN_CODE = "invalid-spline-coincident-points";

/** T17c5: the splines a drag recovers, and the seed points of each span's ends. */
export interface DegenerateSplineSpanRecovery {
  splineIds: ReadonlySet<SketchEntityId>;
  /**
   * The two ends of every recovered span, as authored and mapped to their
   * seed points (review RR-1: a join on either pair holds the span).
   */
  spanEnds: readonly (readonly [SketchPointId, SketchPointId])[];
}

export const NO_DEGENERATE_SPLINE_SPAN_RECOVERY: DegenerateSplineSpanRecovery = {
  splineIds: new Set(),
  spanEnds: [],
};

/**
 * T17c5 (issue 08 :107, recovery by dragging): the splines whose
 * coincident-span validation a drag of `dragPointId` re-judges at each
 * solve's values instead of the authored positions, when those spans are
 * the definition's only authored errors. A spline qualifies when every
 * coincident span of its authored reconstruction has the dragged point as
 * one end, both read through the mirror/pattern/transform outputs back to
 * their seed points (review R-1: a copy of the seed span is the same span,
 * moved by the same drag). Whether a declared join holds the two ends
 * together is decided on the start's solve
 * (`isDegenerateSplineSpanRecoveryStart`).
 */
export function degenerateSplineSpanDragRecovery(
  definition: SketchDefinition,
  validation: SketchCoreValidationResult,
  dragPointId: SketchPointId | undefined,
): DegenerateSplineSpanRecovery {
  const flagged = new Set(
    validation.diagnostics.flatMap((diagnostic) =>
      diagnostic.code === COINCIDENT_SPLINE_SPAN_CODE &&
      diagnostic.target?.kind === "entity"
        ? [diagnostic.target.entityId]
        : [],
    ),
  );
  if (
    !dragPointId ||
    flagged.size === 0 ||
    validation.diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        diagnostic.code !== COINCIDENT_SPLINE_SPAN_CODE,
    )
  )
    return NO_DEGENERATE_SPLINE_SPAN_RECOVERY;
  const seedPoint = new Map<SketchPointId, SketchPointId>();
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind === "offset") continue;
    for (const output of relationship.outputs)
      output.outputPointIds.forEach((pointId, index) => {
        const seed = output.seedPointIds[index];
        if (seed !== undefined && seed !== pointId)
          seedPoint.set(pointId, seed);
      });
  }
  const seedOf = (pointId: SketchPointId): SketchPointId => {
    const seed = seedPoint.get(pointId);
    return seed === undefined ? pointId : seedOf(seed);
  };
  const dragged = seedOf(dragPointId);
  const positions = Object.fromEntries(
    definition.points.map((point) => [point.pointId, point.position]),
  ) as Record<SketchPointId, SketchPoint2D>;
  const splineIds = new Set<SketchEntityId>();
  const spanEnds: (readonly [SketchPointId, SketchPointId])[] = [];
  for (const entity of definition.entities) {
    if (entity.kind !== "spline" || !flagged.has(entity.entityId)) continue;
    const occurrences = orderedSplineOccurrences(entity) ?? [];
    const ends = reconstructSplineAggregate(entity, positions).diagnostics.map(
      (span) => {
        if (span.code !== "coincident-points" || span.spanIndex === undefined)
          return null;
        const first = occurrences[span.spanIndex]?.pointId;
        const second =
          occurrences[(span.spanIndex + 1) % occurrences.length]?.pointId;
        if (first === undefined || second === undefined) return null;
        const pair = [seedOf(first), seedOf(second)] as const;
        return pair.includes(dragged) ? [[first, second] as const, pair] : null;
      },
    );
    if (ends.length === 0 || ends.some((pair) => pair === null)) continue;
    splineIds.add(entity.entityId);
    spanEnds.push(
      ...(ends as (readonly [SketchPointId, SketchPointId])[][]).flat(),
    );
  }
  return { splineIds, spanEnds };
}

/**
 * T17c5: the coincident-span errors of the recovered splines at a solve's
 * values (the authored check's own text, judged on the solved
 * reconstruction).
 */
export function recoveredSplineSpanDiagnostics(
  program: SketchCompiledSolveProgram,
  solvedEntities: readonly SolvedSketchEntityGeometryRecord[],
): SketchSolveDiagnostic[] {
  const { splineIds } = program.degenerateSplineSpanRecovery;
  if (splineIds.size === 0) return [];
  return solvedEntities.flatMap((solved) => {
    const entity = program.definition.entities.find(
      (candidate) => candidate.entityId === solved.entityId,
    );
    if (
      solved.kind !== "spline" ||
      entity?.kind !== "spline" ||
      !splineIds.has(entity.entityId)
    )
      return [];
    return solved.reconstruction.diagnostics.flatMap((diagnostic) =>
      diagnostic.code === "coincident-points" &&
      diagnostic.spanIndex !== undefined
        ? [
            makeDiagnostic(
              COINCIDENT_SPLINE_SPAN_CODE,
              "error",
              describeDegenerateSplineSpan(
                entity,
                diagnostic.spanIndex,
                (pointId) =>
                  program.definition.points.find(
                    (point) => point.pointId === pointId,
                  )?.label,
              ),
              { kind: "entity", entityId: entity.entityId },
            ),
          ]
        : [],
    );
  });
}
