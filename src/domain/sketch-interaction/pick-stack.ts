import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import type { SketchId } from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchSessionState } from "@/domain/editor/sketch-session";

/**
 * The sketch editor's pick classes, in priority order (T11c, T11-D1;
 * issue 04 "Picking priority"):
 * 1. `authoredPoint`: points of the edited sketch, including driven points
 *    of offset/mirror outputs, centres and Point-tool points.
 * 2. `authoredCurve`: ordinary authored curves; a derived output counts by
 *    its own construction flag, and a non-accepted ([TECH] G19) output stays
 *    in its class.
 * 3. `constructionCurve`: construction authored curves.
 * 4. References (datum origin and axes, projected/external geometry, model
 *    edges/vertices and other sketches visible in sketch mode), points
 *    (`referencePoint`) before curves (`referenceCurve`).
 * 5. `region`, then `referenceImage`, then `face` (faces and bodies), then
 *    `constructionPlane` (raycast-only surfaces).
 */
export const SKETCH_PICK_CLASSES = [
  "authoredPoint",
  "authoredCurve",
  "constructionCurve",
  "referencePoint",
  "referenceCurve",
  "region",
  "referenceImage",
  "face",
  "constructionPlane",
] as const;

export type SketchPickClass = (typeof SKETCH_PICK_CLASSES)[number];

/**
 * One mapped viewport candidate. `metric` is `screen` for screen-space
 * (projected) candidates, whose `distance` is in px from the pointer, and
 * `ray` for raycast-only candidates, whose `distance` is along the pointer
 * ray. `ownerBodyTarget` is the target picked instead when `target` itself
 * is not eligible (a topology hit standing for its body).
 */
export interface SketchPickStackCandidate {
  readonly key: string;
  readonly target: PrimitiveRef;
  readonly ownerBodyTarget: PrimitiveRef | null;
  readonly metric: "screen" | "ray";
  readonly distance: number;
  readonly depth: number;
}

export interface SketchPickStackEntry<
  TCandidate extends SketchPickStackCandidate,
> {
  /** The eligible (mapped) target this entry selects. */
  readonly target: PrimitiveRef;
  readonly pickClass: SketchPickClass;
  readonly candidate: TCandidate;
}

/**
 * The full ordered pick stack at one pointer position (T11c, T11-D1); the
 * sketch editor's only candidate ranking. Each candidate is first mapped
 * to an eligible target (`acceptsTarget` on its target, else on its owner
 * body); ineligible candidates are dropped before ordering. The class comes
 * from the target, with construction looked up in the session's display
 * definition (`getSketchSessionDisplayDefinition`, built once per pick by
 * the caller and shared with the curve collector); entities and points of the edited sketch that are not in it
 * (staged previews) are never candidates, and annotation targets (a
 * separate DOM layer) are not either. Order: class, then screen-space
 * before raycast-only candidates, then distance, depth and key. Candidates
 * mapped to one target keep only the best-ordered one.
 */
export function resolveSketchPickStack<
  TCandidate extends SketchPickStackCandidate,
>({
  session,
  displayDefinition: definition,
  candidates,
  acceptsTarget,
}: {
  session: SketchSessionState;
  displayDefinition: SketchDefinition;
  candidates: readonly TCandidate[];
  acceptsTarget: (target: PrimitiveRef) => boolean;
}): SketchPickStackEntry<TCandidate>[] {
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const pointIds = new Set(definition.points.map((point) => point.pointId));
  const entities = new Map(
    definition.entities.map((entity) => [entity.entityId, entity] as const),
  );
  const classify = (target: PrimitiveRef): SketchPickClass | null => {
    switch (target.kind) {
      case "sketchPoint":
        if (target.sketchId !== sketchId) return "referencePoint";
        return pointIds.has(target.pointId) ? "authoredPoint" : null;
      case "sketchEntity": {
        if (target.sketchId !== sketchId) return "referenceCurve";
        const entity = entities.get(target.entityId);
        if (!entity) return null;
        if (entity.kind === "point") return "authoredPoint";
        return entity.isConstruction ? "constructionCurve" : "authoredCurve";
      }
      case "sketchDatumReference":
      case "projectedReferenceGeometry":
        return target.geometryKind === "point"
          ? "referencePoint"
          : "referenceCurve";
      case "sketchExternalReference":
      case "vertex":
        return "referencePoint";
      case "edge":
      case "loop":
        return "referenceCurve";
      case "region":
        return "region";
      case "sketchOperation":
        return "referenceImage";
      case "face":
      case "body":
        return "face";
      case "construction":
        return "constructionPlane";
      case "constraint":
      case "dimension":
      case "sketch":
      case "feature":
        return null;
    }
  };

  const seen = new Set<string>();
  return candidates
    .flatMap((candidate) => {
      const target = acceptsTarget(candidate.target)
        ? candidate.target
        : candidate.ownerBodyTarget && acceptsTarget(candidate.ownerBodyTarget)
          ? candidate.ownerBodyTarget
          : null;
      const pickClass = target ? classify(target) : null;
      return target && pickClass ? [{ target, pickClass, candidate }] : [];
    })
    .sort(
      (left, right) =>
        SKETCH_PICK_CLASSES.indexOf(left.pickClass) -
          SKETCH_PICK_CLASSES.indexOf(right.pickClass) ||
        Number(left.candidate.metric === "ray") -
          Number(right.candidate.metric === "ray") ||
        left.candidate.distance - right.candidate.distance ||
        left.candidate.depth - right.candidate.depth ||
        left.candidate.key.localeCompare(right.candidate.key),
    )
    .filter((entry) => {
      const key = getPrimitiveRefKey(entry.target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
