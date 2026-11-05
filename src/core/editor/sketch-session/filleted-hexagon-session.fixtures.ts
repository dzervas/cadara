import { expect } from "vitest";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import {
  createNewSketchSession,
  beginSketchTool,
  startSketchDraw,
  acceptSketchDraw,
  withLiveSolveBasis,
} from "./index";
import { createDimensionId } from "./session-definition";
import { createSessionCommitFactories } from "./tool-authoring";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createSketchFilletMutation } from "@/core/sketch-editing/operations";

export function createFilletedHexagonSession(equalSides = true) {
  let session = enterSketchSession(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  session = startSketchDraw(
    beginSketchTool(session, "inscribedPolygon"),
    [0, 0],
  );
  session = beginSketchTool(acceptSketchDraw(session, [1, 0]), "line");
  const circle = session.definition.entities.find((e) => e.kind === "circle")!;
  const radiusId = createDimensionId(2, "circle-radius");
  const constraints = session.definition.constraints.filter(
    (c) => equalSides || c.kind !== "equalLength",
  );
  const sizedDefinition = {
    ...session.definition,
    constraints,
    constraintIds: constraints.map((c) => c.constraintId),
    dimensionIds: [...session.definition.dimensionIds, radiusId],
    dimensions: [
      ...session.definition.dimensions,
      {
        kind: "circleRadius" as const,
        dimensionId: radiusId,
        label: "Construction radius",
        entityId: circle.entityId,
        value: createLiteralAuthoredValue(1),
      },
    ],
  };
  session = withLiveSolveBasis(
    { ...session, definition: sizedDefinition },
    sizedDefinition,
  );
  const sides = session.definition.entities.filter(
    (e) => e.kind === "lineSegment",
  );
  const mutation = createSketchFilletMutation({
    definition: session.definition,
    entityIds: sides.slice(0, 2).map((e) => e.entityId),
    radius: 0.15,
    sequence: 2,
    factories: createSessionCommitFactories(2, "sketch_draft" as never),
  });
  expect(mutation.valid).toBe(true);
  const definition = mutation.definition!;
  session = withLiveSolveBasis({ ...session, definition }, definition);
  expect(session.liveSolve!.accepted).toBe(true);
  return session;
}
