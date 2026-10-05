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
      case "sketchTangentHandle":
        if (target.sketchId !== sketchId) return null;
        return "authoredPoint";
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

/**
 * A click within this many px of the previous selecting click may cycle
 * (the viewport's click/drag threshold; T11-D4).
 */
export const SKETCH_PICK_CYCLE_RADIUS_PX = 6;

/**
 * The repeated-click cycle (T11d, T11-D4/D5, review R-1): what the previous
 * selecting click picked, kept by the viewport in a ref; `null` when no
 * cycle is anchored.
 */
export interface SketchPickCycle {
  /** Client position of the previous selecting click. */
  readonly x: number;
  readonly y: number;
  /** Ordered target keys (`getPrimitiveRefKey`) of the stack it resolved. */
  readonly stackKeys: readonly string[];
  /** Index in that stack of the target it picked. */
  readonly index: number;
  /** Its selection context (`getSketchSelectionCycleContext().key`). */
  readonly contextKey: string;
}

/** The pointer and the stack resolved at it. */
export interface SketchPickCyclePointer {
  readonly x: number;
  readonly y: number;
  readonly stackKeys: readonly string[];
  readonly contextKey: string;
  /**
   * Whether the selection still holds the previous pick, the stack entry at
   * this index (per the context's cycle mode).
   */
  readonly retainsPick: (index: number) => boolean;
}

export type SketchPickCycleEvent =
  | ({
      readonly type: "clicked";
      /** `MouseEvent.detail` of the `click` (pointer events report 0). */
      readonly detail: number;
      /** False where the context does not cycle (mode `none`). */
      readonly cycles: boolean;
    } & SketchPickCyclePointer)
  /** Escape, a selection change from elsewhere, an Undo, a stack change. */
  | { readonly type: "reset" };

/**
 * The stack index the next single click advances to, or `null` when no
 * cycle is armed. Armed: the stack has at least 2 entries (with one there
 * is nothing to cycle, and a repeated click keeps its ordinary meaning,
 * e.g. toggling an Offset target off; T11d review R-1), the pointer is
 * within `SKETCH_PICK_CYCLE_RADIUS_PX` of the previous selecting click, in
 * the same context, on a stack with equal ordered keys, and the selection
 * still holds what that click picked.
 */
export function getArmedSketchPickCycleIndex(
  cycle: SketchPickCycle | null,
  pointer: SketchPickCyclePointer,
): number | null {
  if (
    !cycle ||
    cycle.stackKeys.length < 2 ||
    Math.hypot(pointer.x - cycle.x, pointer.y - cycle.y) >
      SKETCH_PICK_CYCLE_RADIUS_PX ||
    pointer.contextKey !== cycle.contextKey ||
    pointer.stackKeys.length !== cycle.stackKeys.length ||
    pointer.stackKeys.some((key, index) => key !== cycle.stackKeys[index]) ||
    !pointer.retainsPick(cycle.index)
  ) {
    return null;
  }
  return (cycle.index + 1) % cycle.stackKeys.length;
}

/**
 * The stack index the next single click would pick: the armed cycle's next
 * index, else 0. Hover previews it and the release dispatch carries it, so
 * both equal what that click selects.
 */
export function getSketchPickPreviewIndex(
  cycle: SketchPickCycle | null,
  pointer: SketchPickCyclePointer,
): number {
  return getArmedSketchPickCycleIndex(cycle, pointer) ?? 0;
}

/**
 * The cycle reducer. A single click (`detail === 1`) in a cycling context
 * picks the preview index (wrapping) and anchors the cycle there; any other
 * click (connected selection, `detail >= 2`), a non-cycling context, an
 * empty stack or a reset clears it.
 */
export function reduceSketchPickCycle(
  cycle: SketchPickCycle | null,
  event: SketchPickCycleEvent,
): SketchPickCycle | null {
  if (
    event.type === "reset" ||
    event.detail !== 1 ||
    !event.cycles ||
    event.stackKeys.length === 0
  ) {
    return null;
  }
  return {
    x: event.x,
    y: event.y,
    stackKeys: event.stackKeys,
    index: getSketchPickPreviewIndex(cycle, event),
    contextKey: event.contextKey,
  };
}
