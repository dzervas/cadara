import {
  VIEWPORT_FLOATING_PANEL_GAP_PX,
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX,
} from "@/components/cad/viewport-overlay-layout";
import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchPickClass } from "@/domain/sketch-interaction/pick-stack";

/**
 * The hint's left edge: in the top-left overlay row, past the sketch tool
 * panel (`VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX`) that shares the floating panel slot (Offset, constraints), so
 * an active tool's panel never covers it.
 */
export const SKETCH_PICK_HINT_LEFT_PX =
  VIEWPORT_FLOATING_PANEL_LEFT_PX +
  VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX +
  VIEWPORT_FLOATING_PANEL_GAP_PX;

/**
 * The overlap hint (T11d, T11-D7): what the next click picks and how many
 * other eligible candidates lie under the pointer.
 */
export interface SketchPickHintModel {
  readonly label: string;
  readonly more: number;
  /** Whether a repeated click cycles in this selection context. */
  readonly cycles: boolean;
}

/**
 * The hint for a hovered pick stack in a selection context: shown when it
 * has at least 2 eligible candidates, labelled by the one the next click
 * would pick (`stack[0]`, or `stack[next]` while a cycle is armed).
 */
export function createSketchPickHint({
  stack,
  previewTarget,
  cycles,
  definition,
}: {
  stack: readonly PrimitiveRef[];
  previewTarget: PrimitiveRef | null;
  cycles: boolean;
  definition: SketchDefinition;
}): SketchPickHintModel | null {
  if (stack.length < 2 || !previewTarget) return null;
  return {
    label: getSketchPickTargetLabel(previewTarget, definition),
    more: stack.length - 1,
    cycles,
  };
}

export function getSketchPickHintText(hint: SketchPickHintModel) {
  return [
    `«${hint.label}»`,
    `${hint.more} more here${hint.cycles ? " — click again to cycle" : ""}`,
    "Alt+click to choose",
  ].join(" · ");
}

/** One candidate chooser item (T11e, T11-D6): label plus class tag. */
export interface SketchPickChooserItem {
  readonly key: string;
  readonly target: PrimitiveRef;
  readonly label: string;
  readonly tag: string;
  /** Whether the target is selected now (marked, like the prototype's `.sel`). */
  readonly selected: boolean;
}

const SKETCH_PICK_CLASS_TAGS: Record<SketchPickClass, string> = {
  authoredPoint: "Point",
  authoredCurve: "Curve",
  constructionCurve: "Construction",
  referencePoint: "Reference",
  referenceCurve: "Reference",
  region: "Region",
  referenceImage: "Image",
  face: "Face",
  constructionPlane: "Plane",
};

/**
 * The chooser items for the eligible candidates of a pick stack, in stack
 * order; `classOf` gives each target's pick class.
 */
export function createSketchPickChooserItems({
  targets,
  classOf,
  isSelected,
  definition,
}: {
  targets: readonly PrimitiveRef[];
  classOf: (target: PrimitiveRef) => SketchPickClass | undefined;
  isSelected: (target: PrimitiveRef) => boolean;
  definition: SketchDefinition;
}): SketchPickChooserItem[] {
  return targets.map((target) => {
    const pickClass = classOf(target);
    return {
      key: getPrimitiveRefKey(target),
      target,
      label: getSketchPickTargetLabel(target, definition),
      tag: pickClass ? SKETCH_PICK_CLASS_TAGS[pickClass] : "",
      selected: isSelected(target),
    };
  });
}

/**
 * The open chooser's keydown, run by a window capture-phase listener so it
 * sees every key first, wherever focus is (T11e review R-1): Escape closes
 * the chooser and is consumed (`preventDefault`, which the shortcut
 * resolver skips, and `stopPropagation`), so it never also runs
 * `editor.cancel` (review A-5(b)). Other keys pass; arrow keys and Enter
 * are Mantine `Menu`'s.
 */
export function handleSketchPickChooserKeyDown(
  event: {
    readonly key: string;
    preventDefault: () => void;
    stopPropagation: () => void;
  },
  onClose: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }
}

/** A short human label for a pick-stack target. */
export function getSketchPickTargetLabel(
  target: PrimitiveRef,
  definition: SketchDefinition,
): string {
  switch (target.kind) {
    case "sketchEntity": {
      const entity = definition.entities.find(
        (entry) => entry.entityId === target.entityId,
      );
      if (!entity) return "Sketch curve";
      return entity.isConstruction && !/construction/i.test(entity.label)
        ? `Construction ${entity.label.charAt(0).toLowerCase()}${entity.label.slice(1)}`
        : entity.label;
    }
    case "sketchPoint":
      return (
        definition.points.find((entry) => entry.pointId === target.pointId)
          ?.label ?? "Point"
      );
    case "sketchDatumReference":
      return target.datumId === "origin"
        ? "Origin"
        : target.datumId === "xAxis"
          ? "X axis"
          : "Y axis";
    case "projectedReferenceGeometry":
      return target.geometryKind === "point"
        ? "Projected point"
        : "Projected curve";
    case "sketchExternalReference":
      return "Reference";
    case "sketchOperation":
      return "Reference image";
    case "construction":
      return "Plane";
    default:
      return `${target.kind.charAt(0).toUpperCase()}${target.kind.slice(1)}`;
  }
}
