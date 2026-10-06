/**
 * T13d UI spec support: a rectangle + circle sketch session with a driving
 * bottom length and a circle diameter (5), the diameter optionally made a
 * reference through its edit popup's Make reference action.
 */
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchTool,
  createNewSketchSession,
  patchSketchConstraintValue,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import type { PrimitiveRef } from "@/core/editor/schema";

function dimension(
  session: SketchSessionState,
  target: PrimitiveRef,
  placement: [number, number],
) {
  return beginSketchTool(
    patchSketchConstraintValue(
      pinSketchConstraintPreview(
        selectSketchConstraintTarget(
          beginSketchTool(session, "dimensionDistance"),
          target,
        ),
        placement,
      ),
      { intent: "commitConstraintValue" },
    ),
    "line",
  );
}

export function editDimension(session: SketchSessionState, index: number) {
  return beginSketchAnnotationEdit(session, {
    kind: "dimension",
    sketchId: session.sketchId ?? "sketch_draft",
    dimensionId: session.definition.dimensions[index]!.dimensionId,
  } as Parameters<typeof beginSketchAnnotationEdit>[1]);
}

export function makeCircleWithDiameterSession(options: { reference: boolean }) {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [1, 1]),
    [5, 4],
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "circle"), [12, 1]),
    [14.5, 1],
  );
  const circle = session.definition.entities.find(
    (entity) => entity.kind === "circle",
  )!;
  const bottom = session.definition.entities.find(
    (entity) => entity.label === "Rectangle 1 bottom",
  )!;
  session = dimension(beginSketchTool(session, "line"), circle.target, [15, 3]);
  session = dimension(session, bottom.target, [3, 0]);
  return options.reference
    ? patchSketchConstraintValue(editDimension(session, 0), {
        intent: "makeAnnotationReference",
      })
    : session;
}
