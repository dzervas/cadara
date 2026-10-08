import { expect, test } from "vitest";

import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  getSketchAnnotationDescriptors,
  startSketchDraw,
} from "@/domain/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";

// T14b T-7, logic lane (descriptor seam `getSketchAnnotationDescriptors`): an
// arc's end bindings are constraint-class contextual descriptors (glyph
// Coincident), not dimension chips. Display only: they stay dimension records.
test("T14b T-7: a three-point arc's end bindings are Coincident constraint descriptors, not dimension chips", () => {
  let session = startSketchDraw(
    beginSketchTool(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      "threePointArc",
    ),
    [2, 0],
  );
  session = acceptSketchDraw(session, [-2, 0]);
  session = acceptSketchDraw(session, [0, 2]);
  const bindingIds = session.definition.dimensions
    .filter(
      (dimension) =>
        dimension.kind === "arcStartPointCoincident" ||
        dimension.kind === "arcEndPointCoincident",
    )
    .map((dimension) => dimension.dimensionId);
  expect(bindingIds, "premise: the arc authors two bindings").toHaveLength(2);

  const descriptors = getSketchAnnotationDescriptors(session);
  expect(
    descriptors.filter((descriptor) => descriptor.status === "dimension"),
    "No always-visible dimension chip.",
  ).toEqual([]);
  const bindings = descriptors.filter((descriptor) =>
    bindingIds.includes(descriptor.id as never),
  );
  expect(bindings).toHaveLength(2);
  for (const binding of bindings) {
    expect(binding.status).toBe("constraint");
    expect(binding.glyphKind).toBe("constraintCoincident");
    expect(binding.target.kind, "the record stays a dimension").toBe(
      "dimension",
    );
    expect(binding.visibleLabel).toBeUndefined();
    expect(binding.dragHandle).toBeUndefined();
  }
});
