import { expect, test } from "vitest";
import { getToolById } from "@/core/tools/tool-registry";
import { getToolIconAssetFileName } from "@/core/tools/tool-icons";

// Logic lane: tool metadata must select the approved semantic glyph, not the
// old family fallback (e.g. every arc using Circle or every polygon using Line).
test("tool variants resolve to their own semantic assets", () => {
  for (const id of [
    "midpointLine",
    "centerPointRectangle",
    "alignedRectangle",
    "threePointCircle",
    "centerPointArc",
    "threePointArc",
    "tangentArc",
    "inscribedPolygon",
    "circumscribedPolygon",
    "dimensionDistance",
    "dimensionHorizontal",
    "dimensionVertical",
    "dimensionRadius",
    "projectReference",
    "importImage",
    "hole",
    "sketchMirror",
    "sketchTransform",
    "sketchLinearPattern",
    "sketchCircularPattern",
  ] as const) {
    expect(getToolIconAssetFileName(getToolById(id).icon), id).toBe(
      `${id}.svg`,
    );
  }
});
